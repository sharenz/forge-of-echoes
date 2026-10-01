import { isScarabId } from '../data/scarabs';
// The Game: every online character (PlayerSession), every instance (hideouts and maps), parties and
// portals, and the fixed-step scheduler that drives the instances. The WebSocket layer (server.ts) only
// attaches/detaches Connections and forwards raw frames; tests drive the same object with fake connections.
//
// Moving between instances always goes through moveTo(): leave (sim removePlayer, run bookkeeping) → join
// (sim addPlayer with the character's runtime) → 'zone' → optional 'runSummary'. A character is in at most
// one instance; a dropped socket keeps it in place for a reconnect grace period (idle intent), after which
// the session ends and the character is saved and released.
//
// Robustness: one failing outcome, viewer or instance never takes more down with it than necessary —
// outcomes and snapshot viewers are isolated individually; only a failing sim step disposes an instance.
//
// Restart safety (GAME_SPEC §11): parties, open maps and "which map a character stands in" are written to
// SQLite on every change. restore() (startup) rebuilds the parties and recreates every open, uncleared map as
// a fresh run of the same setup with the same portals; a returning player who was inside is placed straight
// back into it without paying a portal. shutdown() keeps those maps (runs end neutrally) instead of closing
// and refunding them, and keeps parties exactly as they are (leaders included); beginDrain() announces a
// restart and keeps the world running meanwhile. After a restart — graceful or a crash — every party gets a
// fresh idle window, and its stored leader RESTORED_LEADER_WAIT_MS to reconnect before leadership moves.
// An open map's row is only ever written together with its owner's consumed map item, and a refund only
// together with the deletion of that row, so no crash can leave a map both restorable and refunded.
import { randomInt, randomUUID } from 'node:crypto';
import type { GameRulesApi, OpenMapOptions, RunEndInput, RunSetup } from '../contracts/game';
import type { CharacterSave, Item, MapItem } from '../contracts/items';
import type { Rng } from '../contracts/rng';
import { createRng, hashString } from '../core/rng';
import type { AtlasAreaId } from '../contracts/atlas';
import { ATLAS_RARE_DOOR_CHANCE, ATLAS_START, findAtlasArea } from '../data/progression/atlas';
import { refillBelt } from '../game/progression/flasks';
import { markWarmed, wantsWarmup } from '../game/progression/guide';
import { atlasCreditFor, creditEventCompletion, discoverAfterBoss, newAtlas, paidTerritoryFee } from '../game/progression/atlas';
import { paidEntranceKey } from '../game/progression/runs';
import { normalizeRunSurge, refundSurge } from '../game/progression/surge';
import { atlasEventIdOf } from '../game/progression/map-event-rules';
import { PORTALS_PER_MAP, PROTOCOL_VERSION } from '../contracts/net';
import type { Command, PartyInfo, PartyMemberInfo, PortalInfo, RunSummaryInfo, ServerMessage } from '../contracts/net';
import { SIM_HZ } from '../contracts/sim';
import type { DropTone, SimOutcome } from '../contracts/sim';
import { recordDeath, restoreRunSetup, rules, stowItem, withItemLocks, withServerEntropy } from '../game';
import { parseClientMessage } from '../net';
import type { CharacterRecord, CharacterStore } from './characters';
import { handleCommand } from './commands';
import type { CommandResult } from './commands';
import type { Connection } from './connection';
import type { GameDatabase, OpenMapRow } from './db';
import { GroundService } from './ground';
import { MapInstance } from './instance';
import type { GroundItem, Instance, InstanceHost, MapParticipant } from './instance';
import { InstanceManager } from './instances';
import type { Logger } from './log';
import { PARTY_IDLE_TTL_MS, PartyService } from './party';
import type { Party } from './party';
import { PlayerSession } from './session';
import type { ToastTone } from './session';
import { TradeDesk } from './trade';

/** Close codes (contracts/net.ts). */
export const CLOSE_BAD_AUTH = 4001;
export const CLOSE_PROTOCOL = 4002;
export const CLOSE_REPLACED = 4003;
export const CLOSE_SHUTDOWN = 4004;
/** Standard codes used for abuse and server errors. */
export const CLOSE_POLICY = 1008;
export const CLOSE_SERVER_ERROR = 1011;

export interface GameOptions {
  db: GameDatabase;
  store: CharacterStore;
  logger: Logger;
  /** Drive instances from real time (default true). Tests pass false and call stepAll(). */
  autoTick?: boolean;
  /** How long a character stays in its instance after its socket drops (default 20 s). */
  reconnectGraceMs?: number;
  /** An empty hideout is disposed after this long (default 60 s). */
  hideoutIdleMs?: number;
  /** An empty map is closed after this long (default 10 min). */
  mapIdleMs?: number;
  /** Wall clock (ms). */
  now?: () => number;
  /**
   * Server-only entropy (u32): mixed into the character rng before crafting, buying and opening maps, and
   * seeding every loot roll. Default: node:crypto. Tests may pin it for reproducible drops.
   */
  entropy?: () => number;
  /**
   * Loot rolls use fresh server entropy instead of the Rng the sim hands to the hooks (default true). The
   * sim's stream is recoverable from item uids a client sees, so leaving this on keeps drops unpredictable;
   * false restores the contract's replayable loot (balance runs, replays).
   */
  privateLootRng?: boolean;
}

/** Rate-dropped / malformed messages tolerated per abuse window (60 s) before the socket is closed (1008). */
const MAX_DROPPED_MESSAGES = 900;
const MAX_INVALID_MESSAGES = 50;
const SCHEDULER_INTERVAL_MS = 4;
/** A status line (players, instances, tick cost) this often while anyone is online. */
const STATUS_LOG_INTERVAL_MS = 5 * 60_000;
const MAINTENANCE_INTERVAL_MS = 500;
/** Connected sockets re-check that their login session still exists (expiry, purge) this often. */
const TOKEN_RECHECK_MS = 60_000;
/** Consecutive snapshot failures for one viewer before they are moved (home, or disconnected at home). */
const MAX_VIEWER_FAILURES = 3;
/** Run summaries of players who were offline when their run ended wait this long for their next login. */
const PENDING_SUMMARY_TTL_MS = 60 * 60_000;
const MAX_PENDING_SUMMARIES = 2000;
/** Parties nobody returned to are looked for this often. */
const PARTY_SWEEP_INTERVAL_MS = 60_000;
/**
 * After a restart every restored party keeps its stored leader this long (at least the reconnect grace),
 * even while only other members are back: whoever reconnects first must not take over the party. A leader
 * who has not returned by then hands over as usual.
 */
export const RESTORED_LEADER_WAIT_MS = 2 * 60_000;
/** Told to a player placed back into a map that a restart recreated. */
export const RESTORED_MAP_TOAST = 'The server was updated — the fight restarted from wave 1.';
/** Shown when entering a hideout refilled the flask belt (the guide's flask decision). */
export const FLASKS_REFILLED_TOAST = 'Your flasks are refilled. Home always tops them up.';
const SHUTDOWN_REASON = 'The server is updating. You will be reconnected in a moment.';
/**
 * character_maps rows can also say "visiting this party member's hideout" (written at shutdown only): the map id
 * column then holds this key, which never matches a map (map keys are UUIDs).
 */
const hideoutLocationKey = (ownerId: string): string => `hideout:${ownerId}`;
/**
 * Coming back from a map, a player appears this far in front of (south of) the hideout's open portal: "next to the
 * portals" (GAME_SPEC §11), outside its walk-in and latch radius (16 / 26) and clear of its "N portals" plate.
 * Walking north takes them straight back in.
 */
const ARRIVAL_BESIDE_PORTAL = 52;
/** Sideways offsets tried in turn so a party coming back together doesn't stack. */
const ARRIVAL_FAN = [0, -26, 26, -52, 52] as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export class Game implements InstanceHost {
  debugMerchantEnabled(ownerId: string): boolean { return this.db.debugMerchantEnabled(ownerId); }
  readonly log: Logger;
  readonly db: GameDatabase;
  readonly store: CharacterStore;
  readonly instances: InstanceManager;
  readonly parties: PartyService;
  readonly trades: TradeDesk;
  readonly ground: GroundService;
  /**
   * Rules for command handling and pickups: identical to `rules`, but reseeding the character rng from server
   * entropy before random outcomes, and refusing to touch items locked in an open trade offer.
   */
  readonly serverRules: GameRulesApi;
  readonly now: () => number;
  /** Online characters by character id. */
  readonly sessions = new Map<string, PlayerSession>();
  private readonly byConnection = new Map<number, PlayerSession>();
  /** Last known name/level of party members who went offline. */
  private readonly memberCache = new Map<string, { name: string; level: number }>();
  private readonly dirtyParties = new Set<string>();
  private readonly reconnectGraceMs: number;
  private readonly hideoutIdleMs: number;
  private readonly mapIdleMs: number;
  private readonly statsMark = new WeakMap<Instance, { ticks: number; totalMs: number; overruns: number }>();
  /** Summaries of runs that ended while their player had no socket (crash, grace expiry), by character. */
  private readonly pendingSummaries = new Map<string, { summary: RunSummaryInfo; at: number }>();
  private readonly entropy: () => number;
  private lastStatusLog = 0;
  private lastTokenCheck = 0;
  private lastPartySweep = 0;
  /** Wall ms until which party leadership is not repaired (restored leaders get time to reconnect). */
  private leaderRepairAfter = 0;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private maintenanceTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private draining = false;

  constructor(private readonly opts: GameOptions) {
    this.log = opts.logger;
    this.db = opts.db;
    this.store = opts.store;
    this.now = opts.now ?? Date.now;
    this.reconnectGraceMs = opts.reconnectGraceMs ?? 20_000;
    this.hideoutIdleMs = opts.hideoutIdleMs ?? 60_000;
    this.mapIdleMs = opts.mapIdleMs ?? 10 * 60_000;
    this.entropy = opts.entropy ?? (() => randomInt(0, 2 ** 32));
    this.trades = new TradeDesk(this);
    this.ground = new GroundService(this);
    this.serverRules = withItemLocks(withServerEntropy(rules, this.entropy), (ch) => this.trades.lockedUids(ch.id));
    this.instances = new InstanceManager(this);
    this.parties = new PartyService(this.now, {
      save: (party) => this.persistParty(party),
      remove: (partyId) => this.guard('party delete', () => this.db.deleteParty(partyId)),
    });
    this.store.onSharedChange = (rec) => {
      this.sessions.get(rec.id)?.pushCharacter('soon');
      this.guard('shared stash trade revalidate', () => this.trades.characterChanged(rec.id));
    };
  }

  // =========================================================================================
  // Scheduler
  // =========================================================================================

  start(): void {
    if (this.opts.autoTick !== false && !this.tickTimer) {
      this.tickTimer = setInterval(() => this.pump(performance.now()), SCHEDULER_INTERVAL_MS);
    }
    if (!this.maintenanceTimer) {
      this.maintenanceTimer = setInterval(() => this.guard('maintenance', () => this.maintenance()), MAINTENANCE_INTERVAL_MS);
      this.maintenanceTimer.unref?.();
    }
  }

  private stopTimers(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.maintenanceTimer) clearInterval(this.maintenanceTimer);
    this.tickTimer = null;
    this.maintenanceTimer = null;
  }

  /** Advance every occupied instance to wall time `nowMs` (fixed 60 Hz steps). */
  pump(nowMs: number): void {
    for (const inst of this.instances.list()) {
      if (inst.disposed) continue;
      try {
        inst.advance(nowMs);
      } catch (err) {
        this.guard('crash recovery', () => this.crashInstance(inst, err));
      }
    }
    this.guard('party broadcast', () => this.flushParties());
  }

  /** Tests: exactly `ticks` fixed steps of every occupied instance, as fast as possible. */
  stepAll(ticks = 1): void {
    for (let k = 0; k < ticks; k++) {
      for (const inst of this.instances.list()) {
        if (inst.disposed || inst.playerCount === 0) continue;
        try {
          inst.tick();
        } catch (err) {
          this.guard('crash recovery', () => this.crashInstance(inst, err));
        }
      }
      this.guard('party broadcast', () => this.flushParties());
    }
  }

  /**
   * Periodic housekeeping: reconnect grace, ground item expiry, idle instances, invite and trade request
   * expiry, parties nobody returned to.
   */
  maintenance(): void {
    const now = this.now();
    for (const inst of this.instances.list()) if (inst.kind === 'hideout')
      inst.run.setDebugMerchant(this.debugMerchantEnabled(inst.ownerId));
    // During a drain nobody can reconnect (4004), so a dropped socket keeps its character in place until the
    // shutdown: that records where it stood, and the restart puts it back there.
    if (!this.draining) {
      for (const s of [...this.sessions.values()]) {
        if (!s.conn && s.disconnectedAt > 0 && now - s.disconnectedAt >= this.reconnectGraceMs) this.endSession(s);
      }
    }
    if (this.leaderRepairAfter > 0 && now >= this.leaderRepairAfter) {
      // The wait for restored leaders is over: parties whose leader stayed away get one who is in play.
      this.leaderRepairAfter = 0;
      for (const party of this.parties.list()) this.dirtyParties.add(party.id);
    }
    this.guard('ground expiry', () => this.ground.expire(now));
    this.guard('closed-map atlas credit', () => this.awardClosedAtlasCredits());
    for (const inst of this.instances.list()) {
      if (!inst.disposed && inst instanceof MapInstance && inst.atlasPendingCredits.size) this.guard('atlas credit', () => this.awardAtlasCredit(inst));
      if (inst.disposed || inst.playerCount > 0) continue;
      const idle = now - inst.emptySince;
      if (inst instanceof MapInstance) {
        // A map a restart recreated waits for the players who were inside, even with no portals left.
        const waiting = now < inst.awaitingReturnUntil;
        if (inst.cleared) this.closeMap(inst, 'cleared');
        else if (inst.portalsRemaining <= 0 && !waiting) this.closeMap(inst, 'no portals left');
        else if (idle >= this.mapIdleMs) this.closeMap(inst, 'idle');
      } else if (idle >= this.hideoutIdleMs && inst.groundItems.size === 0) {
        // A hideout with items on the ground stays until they expire (someone may come back for them).
        inst.dispose();
        this.instances.remove(inst);
      }
    }
    this.parties.expireInvites();
    this.trades.expire();
    if (now - this.lastPartySweep >= PARTY_SWEEP_INTERVAL_MS) {
      this.lastPartySweep = now;
      this.guard('party sweep', () => this.sweepParties(now));
    }
    this.flushParties();
    if (now - this.lastTokenCheck >= TOKEN_RECHECK_MS) {
      this.lastTokenCheck = now;
      this.recheckTokens(now);
      for (const [id, p] of this.pendingSummaries) if (now - p.at > PENDING_SUMMARY_TTL_MS) this.pendingSummaries.delete(id);
    }
    if (now - this.lastStatusLog >= STATUS_LOG_INTERVAL_MS) {
      this.lastStatusLog = now;
      if (this.sessions.size > 0) this.logStatus();
    }
  }

  /** A socket outliving its login (the session expired or was purged) is closed like a logout. */
  private recheckTokens(now: number): void {
    for (const s of this.sessions.values()) {
      if (!s.conn) continue;
      const account = this.db.sessionAccount(s.tokenHash, now);
      if (account && account.id === s.accountId) continue;
      this.log.info('session expired', { character: s.name });
      s.conn.close(CLOSE_BAD_AUTH, 'Your session has expired. Please log in again.');
    }
  }

  /** One line for operators: who is online, how many instances, and what the ticks cost. */
  private logStatus(): void {
    let ticks = 0;
    let ms = 0;
    let worst = 0;
    let overruns = 0;
    for (const inst of this.instances.list()) {
      const st = inst.stats;
      const prev = this.statsMark.get(inst) ?? { ticks: 0, totalMs: 0, overruns: 0 };
      const dt = st.ticks - prev.ticks;
      const dms = st.totalMs - prev.totalMs;
      ticks += dt;
      ms += dms;
      overruns += st.overruns - prev.overruns;
      if (dt > 0) worst = Math.max(worst, dms / dt);
      this.statsMark.set(inst, { ticks: st.ticks, totalMs: st.totalMs, overruns: st.overruns });
    }
    const maps = this.instances.list().filter((i) => i.kind === 'map').length;
    this.log.info('status', {
      players: this.sessions.size,
      instances: this.instances.size,
      maps,
      parties: this.parties.partyCount,
      trades: this.trades.openTrades,
      avgTickMs: ticks > 0 ? ms / ticks : 0,
      worstTickMs: worst,
      overruns,
    });
  }

  /** Run `fn`, logging instead of throwing (timers and socket callbacks must never crash the process). */
  guard(what: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.log.error(`${what} failed`, { err });
    }
  }

  // =========================================================================================
  // Connections
  // =========================================================================================

  isInPlay(characterId: string): boolean {
    return this.sessions.has(characterId);
  }

  /** The session a connection is bound to (null before attach / after replacement). */
  characterOf(conn: Connection): PlayerSession | null {
    return this.byConnection.get(conn.id) ?? null;
  }

  /** Characters of `accountId` in play (connected or within their reconnect grace), except `exceptId`. */
  charactersInPlay(accountId: string, exceptId = ''): number {
    let n = 0;
    for (const s of this.sessions.values()) if (s.accountId === accountId && s.characterId !== exceptId) n++;
    return n;
  }

  /**
   * Bind an authenticated connection to its character: a newer socket replaces (kicks) an older one and
   * takes over the character where it stands; otherwise the character loads and appears in its hideout.
   * Returns false when the character cannot be loaded.
   */
  attach(conn: Connection, characterId: string, tokenHash: string): boolean {
    if (this.closed || this.draining) {
      conn.close(CLOSE_SHUTDOWN, SHUTDOWN_REASON);
      return false;
    }
    let s = this.sessions.get(characterId);
    const resumed = !!s;
    if (s) {
      const old = s.conn;
      if (old) {
        this.byConnection.delete(old.id);
        old.close(CLOSE_REPLACED, 'This character logged in from somewhere else.');
      }
    } else {
      const record = this.store.acquire(characterId);
      if (!record) return false;
      s = new PlayerSession(record, this.now);
      this.sessions.set(characterId, s);
    }
    s.conn = conn;
    s.tokenHash = tokenHash;
    s.disconnectedAt = 0;
    s.resetAbuse();
    s.resetInput(true);
    this.byConnection.set(conn.id, s);
    this.memberCache.set(characterId, { name: s.name, level: s.record.ch.level });

    // A fresh login that lands in a hideout starts with full flasks (before the first character push, so the client never sees stale belts).
    if (!s.instance) this.guard('login refill', () => this.refillAtLogin(s));
    s.send({ t: 'welcome', protocol: PROTOCOL_VERSION, characterId, tickRate: SIM_HZ, serverTime: Date.now() });
    s.flushCharacter();
    const joinedParty = this.parties.partyOf(characterId);
    if (joinedParty) this.parties.setIdle(joinedParty.id, 0);
    try {
      if (s.instance) this.sendZone(s);
      else this.placeNewSession(s);
    } catch (err) {
      // Could not place the character anywhere: give up on this login cleanly (the caller closes with 1011).
      this.log.error('could not place character', { character: s.name, err });
      this.byConnection.delete(conn.id);
      this.endSession(s);
      return false;
    }
    // A run that ended while this character had no socket (instance crash, reconnect grace ran out).
    const pending = this.pendingSummaries.get(characterId);
    if (pending) {
      this.pendingSummaries.delete(characterId);
      s.send({ t: 'runSummary', summary: pending.summary });
    }
    const party = this.parties.partyOf(characterId);
    if (party) s.send({ t: 'party', party: this.partyInfo(party) });
    for (const inv of this.parties.invitesFor(characterId)) {
      s.send({ t: 'invite', invite: { inviteId: inv.id, fromCharacterId: inv.fromId, fromName: inv.fromName } });
    }
    this.trades.resend(s);
    this.markParty(characterId);
    this.flushParties();
    this.log.info(resumed ? 'player reconnected' : 'player joined', { character: s.name, ip: conn.ip, players: this.sessions.size });
    return true;
  }

  /** A connection closed. The character stays in its instance for the reconnect grace period. */
  detach(conn: Connection): void {
    const s = this.byConnection.get(conn.id);
    this.byConnection.delete(conn.id);
    if (!s || s.conn !== conn) return;
    s.conn = null;
    s.disconnectedAt = this.now();
    s.input.clear();
    s.outbox.clear();
    this.guard('pickup cancel', () => this.ground.cancel(s));
    this.guard('trade cancel', () => this.trades.sessionGone(s.characterId, 'disconnected'));
    this.markParty(s.characterId);
    this.flushParties();
    this.log.info('player disconnected', { character: s.name });
  }

  /** Close every socket authenticated with this session token (logout). */
  kickToken(tokenHash: string): void {
    for (const s of this.sessions.values()) {
      if (s.conn && s.tokenHash === tokenHash) s.conn.close(CLOSE_BAD_AUTH, 'You logged out.');
    }
  }

  /** A deleted (offline) character leaves any party it was still listed in. */
  forgetCharacter(characterId: string): void {
    this.leaveParty(characterId, 'left');
    this.parties.dropInvitesOf(characterId);
    this.memberCache.delete(characterId);
    this.flushParties();
  }

  /** The session's time is up (grace expired or forced): leave everything, save and release. */
  endSession(s: PlayerSession): void {
    if (this.sessions.get(s.characterId) !== s) return;
    if (s.conn) {
      this.byConnection.delete(s.conn.id);
      s.conn = null;
    }
    this.guard('pickup cancel', () => this.ground.cancel(s));
    this.guard('trade cancel', () => this.trades.sessionGone(s.characterId, 'offline'));
    const summary = this.leaveInstance(s);
    if (summary && !this.closed) this.holdSummary(s.characterId, summary);
    this.sessions.delete(s.characterId);
    s.dispose();
    this.store.release(s.record);
    this.parties.dropInvitesOf(s.characterId);
    const party = this.parties.partyOf(s.characterId);
    // Party frames keep showing offline members by their last known name and level.
    if (party) this.memberCache.set(s.characterId, { name: s.name, level: s.record.ch.level });
    else this.memberCache.delete(s.characterId);
    // A shutdown leaves parties exactly as they are (they are restored on startup).
    if (party && !this.closed) {
      const isOnline = (id: string) => this.sessions.has(id);
      const newLeader = this.parties.handOffLeadership(s.characterId, isOnline);
      if (!party.members.some(isOnline)) {
        // Nobody left in play: the party waits for its members (cleaned up after PARTY_IDLE_TTL_MS).
        this.parties.setIdle(party.id, this.now());
      } else {
        this.systemChat(party.members, `${s.name} went offline.`);
        if (newLeader) this.systemChat(party.members, `${this.nameOf(newLeader)} now leads the party.`);
        this.dirtyParties.add(party.id);
      }
    }
    this.flushParties();
    this.log.info('player left', { character: s.name, players: this.sessions.size });
  }

  /** Send a run summary now, or keep it for the next login when the player has no socket right now. */
  private deliverSummary(s: PlayerSession, summary: RunSummaryInfo): void {
    if (s.online) s.send({ t: 'runSummary', summary });
    else if (!this.closed) this.holdSummary(s.characterId, summary);
  }

  /** Keep a run summary for a player without a socket; it is delivered on their next login. */
  private holdSummary(characterId: string, summary: RunSummaryInfo): void {
    this.pendingSummaries.delete(characterId);
    if (this.pendingSummaries.size >= MAX_PENDING_SUMMARIES) {
      const oldest = this.pendingSummaries.keys().next().value;
      if (oldest !== undefined) this.pendingSummaries.delete(oldest);
    }
    this.pendingSummaries.set(characterId, { summary, at: this.now() });
  }

  /** Raw frame from a connection. Every path is validated; nothing here may throw. */
  onMessage(conn: Connection, data: unknown, isBinary: boolean): void {
    const s = this.byConnection.get(conn.id);
    if (!s || s.conn !== conn) return;
    if (!s.messages.take(this.now())) {
      if (s.noteAbuse('dropped') > MAX_DROPPED_MESSAGES) conn.close(CLOSE_POLICY, 'Too many messages.');
      return;
    }
    if (isBinary) {
      this.rejectMessage(s, null, 'binary frames are not accepted');
      return;
    }
    const parsed = parseClientMessage(data);
    if (!parsed.ok) {
      this.rejectMessage(s, data, parsed.error);
      return;
    }
    const msg = parsed.value;
    try {
      switch (msg.t) {
        case 'input':
          if (s.instance) s.input.push(msg);
          break;
        case 'ping':
          s.send({ t: 'pong', time: msg.time, serverTime: Date.now(), serverTick: s.instance?.run.view.tick ?? 0 });
          break;
        case 'cmd':
          this.runCommand(s, msg.id, msg.cmd);
          break;
      }
    } catch (err) {
      this.log.error('message handling failed', { character: s.name, type: msg.t, err });
    }
    this.flushParties();
  }

  private rejectMessage(s: PlayerSession, raw: unknown, error: string): void {
    if (s.noteAbuse('invalid') > MAX_INVALID_MESSAGES) {
      s.conn?.close(CLOSE_POLICY, 'Too many invalid messages.');
      return;
    }
    const id = commandIdOf(raw);
    if (id !== null) s.send({ t: 'result', id, ok: false, error: `Invalid command (${error}).` });
    else s.toast(`The server rejected a message (${error}).`, 'bad');
  }

  private runCommand(s: PlayerSession, id: number, cmd: Command): void {
    if (!s.commands.take(this.now())) {
      s.send({ t: 'result', id, ok: false, error: 'You are doing that too quickly.' });
      return;
    }
    const before = s.record.ch;
    let res: ReturnType<typeof handleCommand>;
    try {
      res = handleCommand(this, s, cmd, id);
    } catch (err) {
      this.log.error('command failed', { character: s.name, command: cmd.c, err });
      res = { ok: false, error: 'Something went wrong. Please try again.' };
    }
    // null: the answer comes later (a pickup click still out of reach) — through answer().
    if (res === null) return;
    // A result that changed the character follows its 'character' push (never arrives before the new state).
    this.answer(s, id, res, s.record.ch !== before);
  }

  /** Send the one result of command `id` (now, or later for deferred commands). */
  answer(s: PlayerSession, id: number, res: CommandResult, changed = res.ok): void {
    const msg: Extract<ServerMessage, { t: 'result' }> = res.ok
      ? {
        t: 'result', id, ok: true,
        ...(res.message !== undefined ? { message: res.message } : {}),
        ...(res.offers !== undefined ? { offers: res.offers } : {}),
        ...(res.board !== undefined ? { board: res.board } : {}),
      }
      : { t: 'result', id, ok: false, error: res.error };
    s.sendResult(msg, changed);
  }

  // =========================================================================================
  // Characters
  // =========================================================================================

  /** Replace a session's character state (saved debounced) and push it to the client. */
  setCharacter(s: PlayerSession, next: CharacterRecord['ch'], push: 'now' | 'soon' | 'lazy' = 'soon'): void {
    this.store.set(s.record, next);
    s.pushCharacter(push);
    // An open trade offer must still describe the character's items.
    this.guard('trade revalidate', () => this.trades.characterChanged(s.characterId));
  }

  /** Write a session's character now (item hand-overs: dropped on the floor, picked up from it). */
  flushSave(s: PlayerSession): void {
    this.guard('save', () => this.store.flush(s.record));
  }

  nameOf(characterId: string): string {
    return this.sessions.get(characterId)?.name ?? this.memberCache.get(characterId)?.name ?? 'Someone';
  }

  /** Change a character whether it is online (pushed) or not (loaded, saved, released). */
  private updateCharacter(characterId: string, change: (ch: CharacterSave) => CharacterSave): void {
    const s = this.sessions.get(characterId);
    if (s) {
      this.setCharacter(s, change(s.record.ch));
      return;
    }
    const rec = this.store.acquire(characterId);
    if (!rec) return;
    try {
      this.store.set(rec, change(rec.ch));
    } finally {
      this.store.release(rec);
    }
  }

  /**
   * Log a participant's involvement in `map` as over (once). 'neutral' is for ends that are nobody's fault
   * (server shutdown, instance crash): kills, time and finds count, but not as a failed map.
   */
  private endParticipantRun(map: MapInstance, p: MapParticipant, result: RunEndInput['result'] | 'neutral'): void {
    if (p.ended) return;
    p.ended = true;
    const input: RunEndInput = {
      result: result === 'neutral' ? 'abandoned' : result,
      tier: map.tier, kills: p.kills, seconds: map.secondsInside(p), raresFound: p.raresFound, uniquesFound: p.uniquesFound,
    };
    this.guard('run end', () =>
      this.updateCharacter(p.characterId, (ch) => {
        const next = rules.applyRunEnd(ch, input);
        return result === 'neutral' ? { ...next, stats: { ...next.stats, mapsFailed: ch.stats.mapsFailed } } : next;
      }),
    );
  }

  /** The run summary of a participant (their whole involvement in the map, all entries). */
  private runSummary(map: MapInstance, p: MapParticipant, dead: boolean): RunSummaryInfo {
    return {
      result: map.cleared ? 'cleared' : dead ? 'failed' : 'abandoned',
      mapName: map.mapName,
      tier: map.tier,
      seconds: map.secondsInside(p),
      kills: p.kills,
      xpGained: p.xpGained,
      levelsGained: p.levelsGained,
      itemsFound: p.itemsFound.map((i) => ({ label: i.label, tone: i.tone })),
    };
  }

  // =========================================================================================
  // Instances & movement
  // =========================================================================================

  canAccess(characterId: string, ownerId: string): boolean {
    return characterId === ownerId || this.parties.sameParty(characterId, ownerId);
  }

  sendZone(s: PlayerSession): void {
    if (s.instance) s.send({ t: 'zone', zone: s.instance.zoneInfo(s) });
  }

  /** The owner's hideout, created (with the portal of an already open map) on demand. */
  hideoutFor(ownerId: string, ownerName: string): Instance {
    const { hideout, created } = this.instances.ensureHideout(ownerId, ownerName, this.now());
    if (created) {
      const map = this.instances.activeMapOf(ownerId);
      if (map && map.portalsRemaining > 0) hideout.run.setPortal(map.portalsRemaining);
    }
    return hideout;
  }

  /** Take a session out of its instance; returns the run summary when it left a map. */
  private leaveInstance(s: PlayerSession): RunSummaryInfo | null {
    const inst = s.instance;
    if (!inst) return null;
    // A click waiting for reach dies with the area it was made in.
    this.ground.cancel(s);
    if (!(inst instanceof MapInstance)) {
      inst.leave(s, this.now());
      this.markParty(s.characterId);
      return null;
    }
    const dead = inst.isDead(s);
    inst.leave(s, this.now());
    // Out of the map for good — unless the server is stopping: then it remembers where to put them back.
    if (!this.closed) this.clearLocation(s.characterId);
    this.markParty(s.characterId);
    const p = inst.participant(s);
    // Done with a cleared map: it counts now (re-entering later changes nothing).
    if (inst.cleared) this.endParticipantRun(inst, p, 'cleared');
    return this.runSummary(inst, p, dead);
  }

  /**
   * Move a session into `target` (access and room already checked by the caller). Returns false when the
   * join failed and the session was sent home instead (`onJoinFailed` runs first, e.g. to refund a portal).
   */
  moveTo(s: PlayerSession, target: Instance, onJoinFailed?: () => void, at: { x: number; y: number } | null = null): boolean {
    if (s.instance === target) {
      this.sendZone(s);
      return true;
    }
    const cameFrom = s.instance;
    const summary = this.leaveInstance(s);
    // Home refills the belt for free (first-run guide): done before the join so the sim starts with full flasks. A first placement
    // after login was refilled in attach() (before the first character push), and a restored map is no hideout.
    const refilled = target.kind === 'hideout' && cameFrom !== null ? this.refillFlasks(s) : 0;
    try {
      target.join(s, at ? { x: at.x, y: at.y } : {});
    } catch (err) {
      this.log.error('join failed', { character: s.name, instance: target.id, err });
      if (target.ownerId !== s.characterId || target.kind !== 'hideout') {
        onJoinFailed?.();
        s.toast('That area could not be entered.', 'bad');
        this.sendHome(s);
        if (summary) this.deliverSummary(s, summary);
        return false;
      }
      throw err;
    }
    this.sendZone(s);
    if (target instanceof MapInstance) this.guard('map entry', () => this.recordMapEntry(s, target));
    if (summary) this.deliverSummary(s, summary);
    // Said only when you come home from a map: a fresh login or a visit to a friend's hideout tops up quietly.
    if (refilled > 0 && summary) s.toast(FLASKS_REFILLED_TOAST, 'flask');
    this.markParty(s.characterId);
    return true;
  }

  /** The belt of a character about to be placed in a hideout (not back into a map after a restart): topped up, silently, no push. */
  private refillAtLogin(s: PlayerSession): void {
    let inMap = false;
    try {
      const loc = this.db.characterMap(s.characterId);
      inMap = !!loc && loc.mapId !== hideoutLocationKey(loc.ownerId);
    } catch { /* an unreadable location places the character at home */ }
    const r = inMap ? null : refillBelt(s.record.ch);
    if (r) this.store.set(s.record, r.character);
  }

  /** Top up the belt of a session entering a hideout; the number of charges added (0 = nothing was missing). */
  private refillFlasks(s: PlayerSession): number {
    const r = refillBelt(s.record.ch);
    if (!r) return 0;
    this.setCharacter(s, r.character, 'lazy');
    return r.charges;
  }

  /**
   * Where someone coming back from a map appears in `hideout`: just in front of its open map portal, fanned out
   * sideways past anyone already standing there. null (the usual courtyard spot) when no portal is open.
   */
  private besidePortal(hideout: Instance): { x: number; y: number } | null {
    const view = hideout.run.view;
    const portal = view.props.find((p) => p.kind === 'portal' && p.state > 0);
    if (!portal) return null;
    const y = portal.y + ARRIVAL_BESIDE_PORTAL;
    for (const dx of ARRIVAL_FAN) {
      const x = portal.x + dx;
      if (!view.players.some((p) => Math.hypot(p.x - x, p.y - y) < 18)) return { x, y };
    }
    return { x: portal.x, y };
  }

  /** Send a session to its own hideout (`besidePortal`: coming back from its own map, next to the portals). */
  sendHome(s: PlayerSession, besidePortal = false): void {
    const hideout = this.hideoutFor(s.characterId, s.name);
    if (s.instance !== hideout && !hideout.hasRoom) {
      // Only reachable through a party change not yet enforced: make room by sending a stranger home.
      for (const other of [...hideout.members.values()]) {
        if (other.characterId !== s.characterId && !this.parties.sameParty(other.characterId, s.characterId)) {
          this.sendHome(other);
          break;
        }
      }
      if (!hideout.hasRoom) throw new Error(`hideout of ${s.name} is full`);
    }
    this.moveTo(s, hideout, undefined, besidePortal ? this.besidePortal(hideout) : null);
  }

  /**
   * Leave a map (death → respawn, "leave map", the return portal, the map closing) back to the hideout whose
   * portals lead into it — the map owner's — so a party member lands next to the portals and can walk straight
   * back in. Falls back to the player's own hideout when that hideout isn't theirs to visit any more (they left
   * the party) or it is full.
   */
  sendBackFromMap(s: PlayerSession, map: Instance): void {
    if (map.kind === 'map' && map.ownerId !== s.characterId && this.canAccess(s.characterId, map.ownerId)) {
      const hideout = this.hideoutFor(map.ownerId, map.ownerName);
      if (s.instance === hideout || hideout.hasRoom) {
        this.moveTo(s, hideout, undefined, this.besidePortal(hideout));
        return;
      }
    }
    this.sendHome(s, map.kind === 'map' && map.ownerId === s.characterId);
  }

  /**
   * Enter the owner's map through the portal in their hideout (walk-in outcome or a click). Returns a
   * player-facing reason when the portal can't be used (null = entered, or the join failed and was handled).
   */
  private enterPortal(s: PlayerSession, hideout: Instance): string | null {
    const map = this.instances.activeMapOf(hideout.ownerId);
    if (!map) return 'The portal has faded.';
    if (!this.canAccess(s.characterId, map.ownerId)) return `Only ${map.ownerName}'s party can use this portal.`;
    if (map.portalsRemaining <= 0) return 'No portals remain.';
    if (!map.hasRoom) return 'The map is full.';
    // Spent before the move so the new zone shows the right count; given back if the join fails.
    map.portalsRemaining--;
    if (!this.moveTo(s, map, () => map.portalsRemaining++)) return null;
    this.portalChanged(map);
    this.log.info('portal entered', { character: s.name, map: map.id, portals: map.portalsRemaining });
    return null;
  }

  /** Click-to-use a portal prop in the player's current instance (the hideout's map portal or a map's return portal). */
  usePortal(s: PlayerSession, propId: number): { ok: true } | { ok: false; error: string } {
    const inst = s.instance;
    if (!inst) return { ok: false, error: 'You are not in an area.' };
    if (inst.isDead(s)) return { ok: false, error: 'You are dead.' };
    const prop = inst.run.view.props.find((p) => p.id === propId);
    if (inst.kind === 'hideout' && prop?.kind === 'portal') {
      if (prop.state <= 0) return { ok: false, error: 'The portal is closed.' };
      const error = this.enterPortal(s, inst);
      return error ? { ok: false, error } : { ok: true };
    }
    if (inst.kind === 'map' && prop?.kind === 'returnPortal') {
      this.sendBackFromMap(s, inst);
      return { ok: true };
    }
    return { ok: false, error: 'There is no portal there.' };
  }

  /** Open a new map from the device in the session's own hideout. */
  activateMapDevice(s: PlayerSession, opts: OpenMapOptions = {}): { ok: true; message: string } | { ok: false; error: string } {
    const inst = s.instance;
    if (!inst || inst.kind !== 'hideout' || inst.ownerId !== s.characterId) {
      return { ok: false, error: 'Maps can only be opened at the map device in your own hideout.' };
    }
    const item = s.record.ch.mapDevice;
    if (!item) return { ok: false, error: 'Place a map in the Map Device first.' };
    const old = this.instances.activeMapOf(s.characterId);
    // Party members still fighting in the previous map keep it alive. Former members who stayed behind
    // after the party changed do not: they cannot come back in anyway, and they must not block the owner.
    const inUse = old ? [...old.members.values()].filter((m) => this.canAccess(m.characterId, old.ownerId)).length : 0;
    if (inUse > 0) {
      return { ok: false, error: `Your previous map is still in use (${inUse} player${inUse === 1 ? '' : 's'} inside).` };
    }
    const opened = this.serverRules.openMap(s.record.ch, { ...opts, now: this.now() });
    if (!opened.ok) return { ok: false, error: opened.error };
    if (old) this.closeMap(old, 'replaced');
    // The account's very first map opens gently (first-run guide): the opening waits for a first move or cast. Granted once.
    const evidence = { characters: [opened.value.character], atlas: opened.value.character.atlas };
    const gentle = wantsWarmup(opened.value.character.guide, evidence);
    const setup = gentle ? { ...opened.value.setup, warmup: true as const } : opened.value.setup;
    const map = this.instances.createMap(s.characterId, s.name, setup, this.now(), randomUUID());
    map.sourceItem = item;
    const guide = gentle && opened.value.character.guide ? markWarmed(opened.value.character.guide) : opened.value.character.guide;
    this.setCharacter(s, guide === opened.value.character.guide ? opened.value.character : { ...opened.value.character, guide });
    // portalChanged() writes the open run in ONE transaction with the consumed map item (persistMap): a
    // crash right now neither loses the map nor keeps it twice (item in the device + a restorable run).
    this.portalChanged(map);
    const text = `${s.name} opened ${map.mapName} (Tier ${map.tier}): ${map.portalsTotal} portals.`;
    this.systemChat(this.parties.partyOf(s.characterId)?.members ?? [], text);
    this.log.info('map opened', { character: s.name, map: map.id, name: map.mapName, tier: map.tier });
    return { ok: true, message: `The portals to ${map.mapName} are open.` };
  }

  /** Portal count / state of a map changed: hideout portal prop, 'portal' messages, party frames. */
  private portalChanged(map: MapInstance): void {
    if (!map.disposed) this.persistMap(map);
    const open = !map.disposed && map.portalsRemaining > 0;
    const info = map.disposed ? null : map.portalInfo();
    const hideout = this.instances.hideoutOf(map.ownerId);
    if (hideout && !hideout.disposed) {
      hideout.run.setPortal(open ? map.portalsRemaining : 0);
      for (const m of hideout.members.values()) m.send({ t: 'portal', portal: open ? info : null });
    }
    // Players inside the map track its portals too (HUD "portals left").
    if (!map.disposed) for (const m of map.members.values()) m.send({ t: 'portal', portal: info });
    this.markParty(map.ownerId);
  }

  zonePortal(inst: Instance): PortalInfo | null {
    if (inst instanceof MapInstance) return inst.portalInfo();
    const map = this.instances.activeMapOf(inst.ownerId);
    return map && map.portalsRemaining > 0 ? map.portalInfo() : null;
  }

  /**
   * Close a map for good: everyone still inside goes home, every participant's run is logged. 'shutdown' is
   * only used for maps a restart cannot keep (cleared, or their row could not be written): that is nobody's
   * failure, so uncleared runs end neutrally and the owner gets the map item back.
   */
  closeMap(map: MapInstance, reason: 'cleared' | 'no portals left' | 'idle' | 'replaced' | 'shutdown'): void {
    if (map.disposed) return;
    for (const s of [...map.members.values()]) {
      if (reason === 'replaced') s.toast(`${map.ownerName} closed ${map.mapName}.`, 'info');
      this.guard('send back', () => this.sendBackFromMap(s, map));
    }
    map.dispose();
    this.instances.remove(map);
    const shutdown = reason === 'shutdown';
    const refund = shutdown && !map.cleared && map.sourceItem !== null;
    // A refund deletes the row itself, in the same transaction that gives the item back.
    if (!refund) this.deleteMapRow(map);
    const result: RunEndInput['result'] | 'neutral' = map.cleared
      ? 'cleared'
      : shutdown ? 'neutral' : map.portalsRemaining <= 0 ? 'failed' : 'abandoned';
    for (const p of map.participants.values()) this.endParticipantRun(map, p, result);
    if (refund) this.guard('map refund', () => this.refundMap(map));
    this.guard('portal update', () => this.portalChanged(map));
    this.log.info('map closed', { map: map.id, owner: map.ownerName, reason, result, ticks: map.stats.ticks });
  }

  /**
   * Give the owner back the map item of a map that ended through no fault of theirs (it could not be kept).
   * The item and the deletion of the map's row are saved together; when that write fails, both stay as
   * they are and the next start deals with the row (restores the run, or refunds it then).
   */
  private refundMap(map: MapInstance): void {
    const item = map.sourceItem;
    if (!item) return;
    if (this.refundMapItem(map.ownerId, item, map.mapKey, () => this.db.deleteOpenMap(map.mapKey), paidEntranceKey(map.setup), map.setup.entranceScrap, map.setup.scarabs, map.setup.surge)) map.sourceItem = null;
  }

  /**
   * Put a map item back into its owner's Map Device, backpack or stash, saving it at once in ONE transaction
   * with `alsoWrite` (the deletion of the map's row). All or nothing: when the write fails (logged) the
   * character is unchanged and false is returned.
   */
  private refundMapItem(ownerId: string, item: MapItem, mapKey: string, alsoWrite: () => void, refundKey?: import('../contracts/content').CurrencyId, entranceScrap = 0, scarabs: readonly import('../contracts/content').ScarabId[] = [], surge?: RunSetup['surge']): boolean {
    const extra: Item[] = refundKey ? [{ kind: 'currency', currencyId: refundKey, count: 1, uid: `refund-key:${mapKey}` }] : [];
    scarabs.forEach((currencyId, index) => extra.push({ kind: 'currency', currencyId, count: 1, uid: `refund-scarab:${mapKey}:${index}` }));
    const fee = paidTerritoryFee(entranceScrap);
    if (fee) extra.push({ kind: 'currency', currencyId: 'scrap', count: fee, uid: `refund-scrap:${mapKey}` });
    // An unrestorable run also gives its surge charge back (D 7.2): same transaction, exact (nothing once the forge day has turned over).
    const restoreSurge = surge ? (ch: CharacterSave): CharacterSave => {
      const atlas = refundSurge(ch.atlas, surge, this.now());
      return atlas === ch.atlas || !atlas ? ch : { ...ch, atlas };
    } : undefined;
    return this.returnToOwner(ownerId, item, { what: 'map refund', done: 'map refunded' }, { map: mapKey }, alsoWrite, extra, restoreSurge);
  }

  /**
   * Give `item` back to a character (online or not): Map Device (maps), backpack, stash, or a new "Recovered"
   * tab, saved at once — in ONE transaction with `alsoWrite` when given. All or nothing: when it does not fit or
   * the write fails (logged as `log.what`), the character is unchanged and false is returned.
   */
  private returnToOwner(
    ownerId: string, item: Item, log: { what: string; done: string }, ctx: Record<string, unknown>, alsoWrite?: () => void,
    extraItems: readonly Item[] = [], transform?: (ch: CharacterSave) => CharacterSave,
  ): boolean {
    const what = log.what;
    const s = this.sessions.get(ownerId);
    const rec = s ? s.record : this.store.acquire(ownerId);
    if (!rec) {
      this.log.error(`${what} failed: owner not found`, { ...ctx, owner: ownerId });
      return false;
    }
    try {
      const r = stowItem(rec.ch, item);
      if (!r.ok) {
        this.log.error(`${what} did not fit`, { ...ctx, owner: ownerId, error: r.error });
        return false;
      }
      let next = r.value.character;
      for (const extra of extraItems) {
        const placed = stowItem(next, extra);
        if (!placed.ok) { this.log.error(`${what} extra item did not fit`, { ...ctx, owner: ownerId }); return false; }
        next = placed.value.character;
      }
      if (transform) next = transform(next);
      if (!this.store.commit(rec, next, alsoWrite)) {
        this.log.error(`${what} could not be saved`, { ...ctx, owner: ownerId });
        return false;
      }
      if (s && !this.closed) {
        s.pushCharacter('soon');
        this.guard('trade revalidate', () => this.trades.characterChanged(ownerId));
      }
      this.log.info(log.done, { ...ctx, owner: ownerId, where: r.value.where });
      return true;
    } finally {
      if (!s) this.store.release(rec);
    }
  }

  /**
   * Shutdown: items players dropped on the floor go back to whoever dropped them (marked new) instead of
   * vanishing with the area — a deploy must not eat an item that was being handed to a friend.
   */
  private returnGroundItems(): void {
    for (const inst of this.instances.list()) {
      if (inst.disposed) continue;
      for (const [token, g] of [...inst.groundItems]) {
        const back = this.returnToOwner(g.droppedById, { ...g.item, isNew: true }, { what: 'ground item return', done: 'ground item returned' }, {
          item: g.label, droppedBy: g.droppedByName, instance: inst.id,
        });
        if (back) inst.groundItems.delete(token);
      }
    }
  }

  /**
   * An instance's sim step threw: dispose it and bring everyone inside home with their run summary
   * (protected against crash loops). A crash is the server's fault: uncleared runs end neutrally.
   */
  private crashInstance(inst: Instance, err: unknown): void {
    this.log.error('instance crashed', { instance: inst.id, kind: inst.kind, owner: inst.ownerName, err });
    const members = [...inst.members.values()];
    const summaries = new Map<PlayerSession, RunSummaryInfo>();
    if (inst instanceof MapInstance) {
      for (const s of members) {
        this.guard('crash summary', () => summaries.set(s, this.runSummary(inst, inst.participant(s), inst.isDead(s))));
      }
    }
    inst.dispose();
    this.instances.remove(inst);
    for (const s of members) {
      s.instance = null;
      s.playerId = 0;
      this.ground.cancel(s);
      if (inst instanceof MapInstance) this.clearLocation(s.characterId);
      this.markParty(s.characterId);
    }
    if (inst instanceof MapInstance) {
      this.deleteMapRow(inst);
      for (const p of inst.participants.values()) this.endParticipantRun(inst, p, inst.cleared ? 'cleared' : 'neutral');
      this.guard('portal update', () => this.portalChanged(inst));
    }
    const now = this.now();
    for (const s of members) {
      const summary = summaries.get(s) ?? null;
      s.crashMoves = s.crashMoves.filter((t) => now - t < 60_000);
      s.crashMoves.push(now);
      if (s.crashMoves.length >= 3) {
        s.conn?.close(CLOSE_SERVER_ERROR, 'The server ran into a problem with this character.');
        this.guard('end session', () => this.endSession(s));
        if (summary) this.holdSummary(s.characterId, summary);
        continue;
      }
      this.guard('send home', () => {
        s.toast('Something went wrong in that area. You were returned to your hideout.', 'bad');
        this.sendHome(s);
        if (summary) this.deliverSummary(s, summary);
      });
    }
  }

  /** Snapshots for one viewer keep failing: move them somewhere safe, or drop the socket as a last resort. */
  viewerFailed(inst: Instance, s: PlayerSession, err: unknown): void {
    const failures = ++s.link.failures;
    if (failures === 1) this.log.error('snapshot failed', { instance: inst.id, character: s.name, err });
    if (failures < MAX_VIEWER_FAILURES || s.instance !== inst) return;
    s.link.failures = 0;
    if (inst.kind === 'hideout' && inst.ownerId === s.characterId) {
      s.conn?.close(CLOSE_SERVER_ERROR, 'The server ran into a problem with this character.');
      return;
    }
    this.guard('send home', () => {
      s.toast('Something went wrong in that area. You were returned to your hideout.', 'bad');
      this.sendHome(s);
    });
  }

  lootRng(simRng: Rng): Rng {
    return this.opts.privateLootRng === false ? simRng : createRng(this.entropy());
  }

  // =========================================================================================
  // InstanceHost: outcomes and loot
  // =========================================================================================

  /**
   * The authoritative outcomes of one tick. Each is handled on its own: one that throws (odd data, a rules
   * edge case) is logged and skipped, and the rest of the tick — XP, pickups, portals — still happens.
   */
  handleOutcomes(inst: Instance, outcomes: readonly SimOutcome[]): void {
    for (const o of outcomes) {
      // Looked up first: a move that fails half-way has already taken the player out of `inst`.
      const s = 'playerId' in o && o.playerId > 0 ? inst.members.get(o.playerId) : undefined;
      try {
        this.handleOutcome(inst, o);
      } catch (err) {
        this.log.error('outcome failed', { instance: inst.id, outcome: o.t, character: s?.name, err });
        // A failed move may have left the player outside every instance: bring them home.
        if (s && !s.instance && this.sessions.get(s.characterId) === s) this.guard('send home', () => this.sendHome(s));
      }
    }
  }

  private handleOutcome(inst: Instance, o: SimOutcome): void {
    switch (o.t) {
      case 'xp':
        this.grantXp(inst, o.amount);
        break;
      case 'kill':
        if (inst instanceof MapInstance && o.playerId > 0) {
          const s = inst.members.get(o.playerId);
          if (s) inst.participant(s).kills++;
        }
        break;
      case 'flaskUsed': {
        const s = inst.members.get(o.playerId);
        if (!s) break;
        this.setCharacter(s, rules.consumeFlask(s.record.ch, o.slot));
        inst.updateRuntime(s);
        break;
      }
      case 'playerDied': {
        const s = inst.members.get(o.playerId);
        if (!s) break;
        this.setCharacter(s, recordDeath(s.record.ch));
        const party = this.parties.partyOf(s.characterId);
        if (party) this.systemChat(party.members, `${s.name} has fallen.`);
        this.markParty(s.characterId);
        break;
      }
      case 'cleared':
        if (inst instanceof MapInstance && !inst.cleared) {
          inst.cleared = true;
          const area = findAtlasArea(inst.setup.atlasAreaId);
          if (area?.noBoss || area?.encounters) this.queueAtlasCredit(inst);
          for (const m of inst.members.values()) m.toast(`${inst.mapName} cleared!`, 'good');
          this.portalChanged(inst);
          this.log.info('map cleared', { map: inst.id, owner: inst.ownerName, seconds: Math.round(inst.run.view.time) });
        }
        break;
      case 'bossDefeated':
        if (inst instanceof MapInstance && inst.setup.atlasAreaId && !findAtlasArea(inst.setup.atlasAreaId)?.encounters) {
          this.queueAtlasCredit(inst);
        }
        break;
      case 'enterPortal': {
        const s = inst.members.get(o.playerId);
        if (s && inst.kind === 'hideout') {
          const error = this.enterPortal(s, inst);
          if (error) s.toast(error, 'bad');
        }
        break;
      }
      case 'returnPortal': {
        const s = inst.members.get(o.playerId);
        if (s && inst.kind === 'map') this.sendBackFromMap(s, inst);
        break;
      }
      case 'pickup': // granted synchronously in tryPickup (hooks) — nothing left to do
      case 'waveStart':
      case 'chestOpened':
        break;
      case 'eventComplete': {
        // First completion of an encounter kind (any grade) is one Atlas point for every present account. The credit is an
        // idempotent set insertion on the account's progress, so a restart or a repeat cannot double it.
        const id = atlasEventIdOf(o.kind);
        if (!id || !(inst instanceof MapInstance)) break;
        for (const s of [...inst.members.values()]) {
          const atlas = s.record.ch.atlas ?? newAtlas();
          const next = creditEventCompletion(atlas, id);
          if (next === atlas) continue;
          this.store.set(s.record, { ...s.record.ch, atlas: next });
          s.toast('Atlas point earned: a new encounter completed.', 'good');
          s.pushCharacter('soon');
        }
        break;
      }
    }
  }

  /** Present party accounts receive one receipt, including dead members; the absent owner gets none. */
  private queueAtlasCredit(map: MapInstance): void {
    for (const s of map.members.values()) if (!map.atlasCredits.has(s.record.accountId)) {
      map.atlasPendingCredits.set(s.record.accountId, s.characterId);
    }
    this.persistMap(map);
    this.awardAtlasCredit(map);
  }

  /** A pending account's progress and its run receipt commit together; failed writes retry in maintenance. */
  private awardAtlasCredit(map: MapInstance): void {
    const areaId = map.setup.atlasAreaId;
    if (!areaId) return;
    for (const [accountId, characterId] of map.atlasPendingCredits) {
      const rec = this.store.acquire(characterId);
      if (!rec) { this.db.deleteAtlasCredit(map.mapKey, accountId); map.atlasPendingCredits.delete(accountId); this.persistMap(map); continue; }
      try {
        if (rec.accountId !== accountId) { this.db.deleteAtlasCredit(map.mapKey, accountId); map.atlasPendingCredits.delete(accountId); this.persistMap(map); continue; }
        const rng = createRng(map.setup.seed ^ hashString(accountId));
        const result = discoverAfterBoss(rec.ch.atlas ?? newAtlas(), areaId, rng.chance(ATLAS_RARE_DOOR_CHANCE), atlasCreditFor(areaId, map.setup.map.tier, rng.next()));
        const credited = new Set(map.atlasCredits).add(accountId);
        const pending = new Map(map.atlasPendingCredits);
        pending.delete(accountId);
        const owner = this.store.peek(map.ownerId);
        // Every write of an open run includes its owner's pending consumed-map state, even when the
        // recipient is a guest on a different account and an earlier owner save failed.
        if (!this.store.commit(rec, { ...rec.ch, atlas: result.progress }, () => {
          this.db.saveOpenMap(this.mapRow(map, credited, pending));
          this.db.deleteAtlasCredit(map.mapKey, accountId);
        }, owner ? [owner] : [])) continue;
        map.atlasCredits.add(accountId);
        map.atlasPendingCredits.delete(accountId);
        map.persisted = true;
        this.sessions.get(characterId)?.pushCharacter('soon');
        const names = result.revealed.map((id) => findAtlasArea(id)!.name);
        for (const s of map.members.values()) if (s.record.accountId === accountId) {
          s.toast(names.length ? `Atlas revealed: ${names.join(', ')}.` : 'Atlas completion recorded.', 'good');
        }
      } finally {
        this.store.release(rec);
      }
    }
  }

  /** Awards left by closed maps use the same deterministic reveal roll and commit with their receipt deletion. */
  private awardClosedAtlasCredits(): void {
    const active = new Set(this.instances.list().filter((i): i is MapInstance => i instanceof MapInstance).map(i => i.mapKey));
    for (const receipt of this.db.loadAtlasCredits()) {
      if (active.has(receipt.mapId)) continue;
      const area = findAtlasArea(receipt.areaId), rec = this.store.acquire(receipt.characterId);
      try {
        if (!rec || rec.accountId !== receipt.accountId || !area) {
          this.db.deleteAtlasCredit(receipt.mapId, receipt.accountId); continue;
        }
        const rng = createRng(receipt.seed ^ hashString(receipt.accountId));
        const result = discoverAfterBoss(rec.ch.atlas ?? newAtlas(), area.id, rng.chance(ATLAS_RARE_DOOR_CHANCE), atlasCreditFor(area.id, receipt.tier, rng.next()));
        if (this.store.commit(rec, { ...rec.ch, atlas: result.progress }, () => this.db.deleteAtlasCredit(receipt.mapId, receipt.accountId)))
          this.sessions.get(receipt.characterId)?.pushCharacter('soon');
      } finally { if (rec) this.store.release(rec); }
    }
  }

  /**
   * Shared XP: every living player in the instance gets the full amount. Living only, as src/sim advises:
   * a corpse lying beside a carry would otherwise level for free while costing the party no pressure — the
   * way back into the fight is respawn + a portal (GAME_SPEC §11 says "every player"; see the index notes).
   */
  private grantXp(inst: Instance, amount: number): void {
    if (!(amount > 0)) return;
    for (const s of [...inst.members.values()]) {
      if (inst.isDead(s)) continue;
      try {
        this.grantXpTo(inst, s, amount);
      } catch (err) {
        this.log.error('xp grant failed', { instance: inst.id, character: s.name, amount, err });
      }
    }
  }

  private grantXpTo(inst: Instance, s: PlayerSession, amount: number): void {
    const before = s.record.ch.level;
    const { character, levelsGained } = rules.grantXp(s.record.ch, amount);
    this.store.set(s.record, character);
    if (inst instanceof MapInstance) {
      const p = inst.participant(s);
      p.xpGained += amount;
      p.levelsGained += levelsGained;
    }
    if (levelsGained > 0) {
      inst.updateRuntime(s, { restore: true, level: character.level });
      s.toast(`Level ${character.level}! You gained ${levelsGained > 1 ? `${levelsGained} levels` : 'a level'}.`, 'good');
      this.memberCache.set(s.characterId, { name: s.name, level: character.level });
      const party = this.parties.partyOf(s.characterId);
      if (party) this.systemChat(party.members.filter((m) => m !== s.characterId), `${s.name} reached level ${character.level}.`);
      this.markParty(s.characterId);
      s.pushCharacter('soon');
      this.log.info('level up', { character: s.name, from: before, to: character.level });
    } else s.pushCharacter('lazy');
  }

  pickup(inst: MapInstance, s: PlayerSession, item: Item, label: string, tone: DropTone): boolean {
    // Lock-aware: a pickup never tops up a stack offered in a trade.
    const r = this.serverRules.addToBackpack(s.record.ch, item);
    if (!r.ok) {
      const now = this.now();
      // A click answers "inventory full" itself; walk-over pickups get a (rate-limited) toast.
      if (!this.ground.isClicking(s) && now - s.lastBackpackFullToast > 4000) {
        s.lastBackpackFullToast = now;
        s.toast(r.error || 'Your backpack is full.', 'bad');
      }
      return false;
    }
    this.store.set(s.record, r.value);
    inst.recordFound(s, label, tone);
    if (tone === 'rare' || tone === 'unique') {
      s.toast(label, tone);
      if (tone === 'unique') {
        const party = this.parties.partyOf(s.characterId);
        if (party) this.systemChat(party.members.filter((m) => m !== s.characterId), `${s.name} found ${label}!`);
      }
    }
    // Flask pickups refill matching belt slots first: the sim needs the new charges.
    if (item.kind === 'flask') inst.updateRuntime(s);
    s.pushCharacter('soon');
    return true;
  }

  /**
   * Someone clicked a public ground item: it goes into their backpack (marked new) and their save is
   * written at once. All or nothing, and nothing after the grant may throw (the sim would leave the drop
   * on the floor and the item would exist twice).
   */
  pickupPublic(inst: Instance, s: PlayerSession, drop: GroundItem): boolean {
    const r = this.serverRules.addToBackpack(s.record.ch, { ...drop.item, isNew: true });
    if (!r.ok) return false;
    this.store.set(s.record, r.value);
    try {
      this.flushSave(s);
      if (drop.item.kind === 'flask') inst.updateRuntime(s);
      if (drop.tone === 'rare' || drop.tone === 'unique') s.toast(drop.label, drop.tone);
      s.pushCharacter('soon');
      this.log.info('ground item picked up', {
        character: s.name, item: drop.label, droppedBy: drop.droppedByName, instance: inst.id,
      });
    } catch (err) {
      this.log.error('ground pickup follow-up failed', { character: s.name, err });
    }
    return true;
  }

  afterTick(inst: Instance): void {
    this.guard('pending pickups', () => this.ground.afterTick(inst));
  }

  // =========================================================================================
  // Parties
  // =========================================================================================

  markParty(characterId: string): void {
    const party = this.parties.partyOf(characterId);
    if (party) this.dirtyParties.add(party.id);
  }

  /**
   * Broadcast PartyInfo to every online member of each changed party. A party whose leader is no longer
   * in play gets a leader who is (so someone can always invite, kick and promote) — except while the server
   * shuts down (sessions end one by one; parties are kept exactly as they are) and while restored leaders
   * still have time to reconnect after a restart (RESTORED_LEADER_WAIT_MS).
   */
  flushParties(): void {
    if (this.dirtyParties.size === 0) return;
    const ids = [...this.dirtyParties];
    this.dirtyParties.clear();
    const inPlay = (id: string) => this.sessions.has(id);
    const repair = !this.closed && this.now() >= this.leaderRepairAfter;
    for (const id of ids) {
      const party = this.parties.get(id);
      if (!party) continue;
      const newLeader = repair ? this.parties.repairLeadership(id, inPlay) : null;
      if (newLeader) this.systemChat(party.members, `${this.nameOf(newLeader)} now leads the party.`);
      const info = this.partyInfo(party);
      for (const m of party.members) this.sessions.get(m)?.send({ t: 'party', party: info });
    }
  }

  partyInfo(party: Party): PartyInfo {
    const members: PartyMemberInfo[] = party.members.map((id) => {
      const s = this.sessions.get(id);
      const cached = this.memberCache.get(id);
      const inst = s?.instance ?? null;
      const map = this.instances.activeMapOf(id);
      return {
        characterId: id,
        name: s?.name ?? cached?.name ?? 'Unknown',
        level: s?.record.ch.level ?? cached?.level ?? 1,
        online: s?.online ?? false,
        isLeader: id === party.leaderId,
        zone: inst
          ? inst.kind === 'map'
            ? { kind: 'map', ownerName: inst.ownerName, mapName: inst.mapName, tier: inst.tier }
            : { kind: 'hideout', ownerName: inst.ownerName }
          : null,
        activeMap: map ? map.portalInfo() : null,
      };
    });
    return { id: party.id, leaderId: party.leaderId, members };
  }

  /** A system line ('' sender) in the chat of the given characters. */
  systemChat(characterIds: readonly string[], text: string): void {
    const msg = { t: 'chat' as const, fromName: '', text, time: Date.now() };
    for (const id of characterIds) this.sessions.get(id)?.send(msg);
  }

  /**
   * Send everyone among `ids` who stands in an instance they may no longer use back home. 'hideouts' only
   * clears hideouts (nothing to lose there); 'all' also pulls people out of maps, ending their stay.
   */
  enforceAccess(ids: readonly string[], scope: 'all' | 'hideouts'): void {
    for (const id of ids) {
      const s = this.sessions.get(id);
      const inst = s?.instance;
      if (!s || !inst || this.canAccess(id, inst.ownerId)) continue;
      if (scope === 'hideouts' && inst.kind !== 'hideout') continue;
      s.toast(`You are no longer in ${inst.ownerName}'s party.`, 'info');
      this.sendHome(s);
    }
  }

  /**
   * Remove a character from its party (leave or kick) with all the messaging.
   *   left    the leaver goes home if they stand in someone else's instance; everyone else keeps playing
   *           where they are — friends fighting in the leaver's map finish their run (they just can't
   *           re-enter) — and only visitors in hideouts that are no longer theirs to visit go home.
   *   kicked  the leader asked for a clean cut: the kicked player leaves every instance of the others, and
   *           the others leave the kicked player's hideout and map.
   * A party left with one member dissolves; one left with nobody in play waits for its members.
   */
  leaveParty(characterId: string, how: 'left' | 'kicked'): boolean {
    const party = this.parties.partyOf(characterId);
    if (!party) return false;
    const before = party.members.slice();
    const name = this.nameOf(characterId);
    const inPlay = (id: string) => this.sessions.has(id);
    const res = this.parties.remove(characterId, inPlay);
    this.sessions.get(characterId)?.send({ t: 'party', party: null });
    if (!this.sessions.has(characterId)) this.memberCache.delete(characterId);
    const remaining = before.filter((m) => m !== characterId);
    this.systemChat(remaining, how === 'kicked' ? `${name} was removed from the party.` : `${name} left the party.`);
    const orphaned = res.orphaned.slice();
    // Nobody of the rest in play: the party waits for them, like any party whose members went offline.
    if (res.party && !res.party.members.some(inPlay)) this.parties.setIdle(res.party.id, this.now());
    else if (res.party) {
      if (res.newLeaderId) this.systemChat(res.party.members, `${this.nameOf(res.newLeaderId)} now leads the party.`);
      this.dirtyParties.add(res.party.id);
    }
    for (const m of orphaned) {
      if (!this.sessions.has(m)) this.memberCache.delete(m);
      this.sessions.get(m)?.send({ t: 'party', party: null });
    }
    if (how === 'kicked') this.enforceAccess(before, 'all');
    else {
      this.enforceAccess([characterId], 'all');
      this.enforceAccess(remaining, 'hideouts');
    }
    return true;
  }

  // =========================================================================================
  // Restart safety: persistence and restore
  // =========================================================================================

  /** Write a party (every change; `active` = now while someone is in play, else since when nobody is). */
  private persistParty(party: Party): void {
    this.guard('party save', () => this.db.saveParty({
      id: party.id,
      leaderId: party.leaderId,
      members: party.members.slice(),
      created: party.created,
      active: party.idleSince > 0 ? party.idleSince : this.now(),
    }));
  }

  /**
   * Write an open map's row (setup, portals, cleared, everyone who entered) in ONE transaction with its
   * owner's pending character state (when the owner is in memory). The owner's state in memory has the map
   * item consumed from the moment the map exists, so the saved world never holds both a restorable run and
   * the item that opened it — not even when an earlier write failed. Never throws; `map.persisted` tells.
   */
  private mapRow(map: MapInstance, credits = map.atlasCredits, pending = map.atlasPendingCredits): OpenMapRow {
    return {
      mapId: map.mapKey,
      ownerId: map.ownerId,
      ownerName: map.ownerName,
      setup: JSON.stringify({ ...map.setup, ...(credits.size ? { atlasCredits: [...credits] } : {}), ...(pending.size ? { atlasPendingCredits: [...pending] } : {}) }),
      portalsRemaining: map.portalsRemaining,
      portalsTotal: map.portalsTotal,
      cleared: map.cleared,
      participants: JSON.stringify([...map.everEntered].map(([id, name]) => ({ id, name }))),
      created: map.createdAt,
      updated: this.now(),
    };
  }

  private persistMap(map: MapInstance): void {
    const row = this.mapRow(map);
    const owner = this.store.peek(map.ownerId);
    try {
      this.store.writeTogether(owner ? [owner] : [], () => {
        this.db.saveOpenMap(row);
        if (map.setup.atlasAreaId) for (const [accountId, characterId] of map.atlasPendingCredits)
          this.db.saveAtlasCredit({ mapId: map.mapKey, accountId, characterId, areaId: map.setup.atlasAreaId, seed: map.setup.seed, tier: map.setup.map.tier });
      });
      map.persisted = true;
    } catch (err) {
      map.persisted = false;
      this.log.error('map save failed', { map: map.id, owner: map.ownerName, err });
    }
  }

  private deleteMapRow(map: MapInstance): void {
    this.guard('map row delete', () => this.db.deleteOpenMap(map.mapKey));
  }

  /** A player entered a map: remember it (a restart puts them back) and who has been inside. */
  private recordMapEntry(s: PlayerSession, map: MapInstance): void {
    this.db.setCharacterMap({ characterId: s.characterId, mapId: map.mapKey, ownerId: map.ownerId, mapName: map.mapName, updated: this.now() });
    this.persistMap(map);
  }

  private clearLocation(characterId: string): void {
    this.guard('map location clear', () => this.db.clearCharacterMap(characterId));
  }

  /** A character's name even when offline (party frames, hideouts of offline owners). */
  private ownerNameOf(characterId: string): string {
    return this.sessions.get(characterId)?.name ?? this.memberCache.get(characterId)?.name ?? this.db.characterById(characterId)?.name ?? 'Someone';
  }

  /**
   * Where a fresh session starts: its own hideout — unless it was inside a map when the server stopped.
   * Then it goes straight back into that map (recreated by restore(); no portal is spent), or, when the map
   * is gone, to the map owner's hideout (its own if it may not visit it). A character that was visiting a
   * party member's hideout when the server stopped goes back to that hideout.
   */
  private placeNewSession(s: PlayerSession): void {
    let loc: ReturnType<GameDatabase['characterMap']> = null;
    try {
      loc = this.db.characterMap(s.characterId);
    } catch (err) {
      this.log.error('map location lookup failed', { character: s.name, err });
    }
    if (!loc) {
      this.sendHome(s);
      return;
    }
    if (loc.mapId === hideoutLocationKey(loc.ownerId)) {
      // Visiting a party member's hideout when the server stopped: back there (quietly), else home.
      this.clearLocation(s.characterId);
      if (loc.ownerId !== s.characterId && this.canAccess(s.characterId, loc.ownerId)) {
        const hideout = this.hideoutFor(loc.ownerId, this.ownerNameOf(loc.ownerId));
        if (hideout.hasRoom) {
          this.moveTo(s, hideout);
          return;
        }
      }
      this.sendHome(s);
      return;
    }
    const map = this.instances.mapByKey(loc.mapId);
    if (map && this.canAccess(s.characterId, map.ownerId) && map.hasRoom) {
      if (this.moveTo(s, map)) {
        if (map.restored) s.toast(RESTORED_MAP_TOAST, 'info');
        this.log.info('placed back into map', { character: s.name, map: map.id, owner: map.ownerName, restored: map.restored });
      }
      return;
    }
    this.clearLocation(s.characterId);
    const text = !map
      ? `The server was updated — ${loc.mapName} has ended.`
      : !this.canAccess(s.characterId, map.ownerId)
        ? `The server was updated — you are no longer in ${map.ownerName}'s party.`
        : `The server was updated — ${loc.mapName} is full.`;
    if (loc.ownerId !== s.characterId && this.canAccess(s.characterId, loc.ownerId)) {
      const hideout = this.hideoutFor(loc.ownerId, this.ownerNameOf(loc.ownerId));
      if (hideout.hasRoom) {
        this.moveTo(s, hideout);
        s.toast(text, 'info');
        return;
      }
    }
    this.sendHome(s);
    s.toast(text, 'info');
  }

  /**
   * Startup: bring back the parties and the open maps of the last run. Every uncleared map becomes a fresh
   * run of the same setup (same seed, recomputed with the current rules) with the same portals left; its
   * portal shows in the owner's hideout as soon as that exists. A map that cannot be rebuilt is refunded.
   * Never throws: a bad row is logged and skipped.
   */
  restore(): void {
    const now = this.now();
    let partyRows: ReturnType<GameDatabase['loadParties']> = [];
    try {
      partyRows = this.db.loadParties();
    } catch (err) {
      this.log.error('party restore failed', { err });
    }
    // A restart starts every party's idle window afresh: after a crash the stored `active` may be far behind
    // (it is only written when the party changes, not while its members keep playing), and downtime is no
    // reason to dissolve anyone's party. Stored leaders get RESTORED_LEADER_WAIT_MS to come back.
    const { restored, dropped } = this.parties.restore(partyRows.map((r) => ({
      id: r.id, leaderId: r.leaderId, members: r.members.map((m) => m.id), created: r.created, idleSince: now,
    })));
    this.lastPartySweep = now;
    if (restored.length > 0) this.leaderRepairAfter = now + Math.max(this.reconnectGraceMs, RESTORED_LEADER_WAIT_MS);
    for (const id of dropped) this.guard('party delete', () => this.db.deleteParty(id));
    for (const row of partyRows) {
      for (const m of row.members) if (this.parties.partyOf(m.id)) this.memberCache.set(m.id, { name: m.name, level: m.level });
    }

    let mapRows: OpenMapRow[] = [];
    try {
      mapRows = this.db.loadOpenMaps();
    } catch (err) {
      this.log.error('map restore failed', { err });
    }
    let maps = 0;
    for (const row of mapRows) {
      this.guard('map restore', () => {
        if (this.restoreMap(row, now)) maps++;
      });
    }
    this.guard('closed-map atlas restore', () => this.awardClosedAtlasCredits());
    if (restored.length > 0 || mapRows.length > 0) this.log.info('restored after restart', { parties: restored.length, maps, mapRows: mapRows.length });
  }

  /**
   * Recreate one stored map (true), or drop it (cleared) / refund it (unrestorable). A refund and the
   * deletion of the row are one transaction; if that fails, the row stays for the next start.
   */
  private restoreMap(row: OpenMapRow, now: number): boolean {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(row.setup);
    } catch {
      parsed = null;
    }
    const seed = isRecord(parsed) && typeof parsed.seed === 'number' ? parsed.seed : Number.NaN;
    if (row.cleared) {
      const saved = parsed;
      this.db.transaction(() => {
        // Backfill pending receipts from pre-queue releases before deleting a completed map.
        if (isRecord(saved) && findAtlasArea(saved.atlasAreaId) && Number.isFinite(seed) && Array.isArray(saved.atlasPendingCredits)) {
          const credited = new Set(Array.isArray(saved.atlasCredits) ? saved.atlasCredits : []);
          for (const pair of saved.atlasPendingCredits) if (Array.isArray(pair) && pair.length === 2
            && pair.every(id => typeof id === 'string') && !credited.has(pair[0]) && this.db.accountById(pair[0])) {
            this.db.saveAtlasCredit({ mapId: row.mapId, accountId: pair[0], characterId: pair[1], areaId: saved.atlasAreaId as string, seed, tier: isRecord(saved.map) && typeof saved.map.tier === 'number' ? saved.map.tier : 0 });
          }
        }
        this.db.deleteOpenMap(row.mapId);
      });
      return false;
    }
    const setup: RunSetup | null = restoreRunSetup(parsed, seed);
    const owner = this.db.characterById(row.ownerId);
    if (!setup || !owner || this.instances.activeMapOf(row.ownerId)) {
      // The run cannot come back: the map item goes back to its owner, if it is still a valid map.
      const item = restoreRunSetup(isRecord(parsed) ? (parsed.sourceMap ?? parsed.map) : null, 0)?.map ?? null;
      if (owner && item) this.refundMapItem(row.ownerId, item, row.mapId, () => this.db.deleteOpenMap(row.mapId), paidEntranceKey(parsed), isRecord(parsed) ? paidTerritoryFee(parsed.entranceScrap) : 0, isRecord(parsed) && Array.isArray(parsed.scarabs) ? parsed.scarabs.slice(0, 4).filter(isScarabId) : [], isRecord(parsed) ? normalizeRunSurge(parsed.surge) : undefined);
      else {
        this.db.deleteOpenMap(row.mapId);
        this.log.error('open map could not be restored', { map: row.mapId, owner: row.ownerName });
      }
      return false;
    }
    const map = this.instances.createMap(row.ownerId, owner.name, setup, now, row.mapId);
    const total = Number.isInteger(row.portalsTotal) && row.portalsTotal > 0 ? row.portalsTotal : PORTALS_PER_MAP;
    map.portalsTotal = total;
    map.portalsRemaining = Math.max(0, Math.min(total, Number.isInteger(row.portalsRemaining) ? row.portalsRemaining : 0));
    map.createdAt = row.created > 0 ? row.created : now;
    map.restored = true;
    map.awaitingReturnUntil = now + this.mapIdleMs;
    map.sourceItem = setup.sourceMap ?? setup.map;
    if (isRecord(parsed)) {
      if (Array.isArray(parsed.atlasCredits)) for (const id of parsed.atlasCredits) if (typeof id === 'string') map.atlasCredits.add(id);
      if (Array.isArray(parsed.atlasPendingCredits)) for (const pair of parsed.atlasPendingCredits) {
        if (Array.isArray(pair) && pair.length === 2 && pair.every((id) => typeof id === 'string') && !map.atlasCredits.has(pair[0])) {
          map.atlasPendingCredits.set(pair[0], pair[1]);
        }
      }
    }
    try {
      const list = JSON.parse(row.participants) as unknown;
      if (Array.isArray(list)) {
        for (const p of list) if (isRecord(p) && typeof p.id === 'string' && typeof p.name === 'string') map.everEntered.set(p.id, p.name);
      }
    } catch {
      // participants are informational only
    }
    this.persistMap(map);
    this.log.info('map restored', { map: map.id, owner: owner.name, name: map.mapName, tier: map.tier, portals: map.portalsRemaining });
    return true;
  }

  /** Dissolve parties nobody has been in play for since PARTY_IDLE_TTL_MS. */
  private sweepParties(now: number): void {
    for (const party of this.parties.staleParties(now, PARTY_IDLE_TTL_MS)) {
      if (party.members.some((id) => this.sessions.has(id))) {
        this.parties.setIdle(party.id, 0);
        continue;
      }
      for (const m of this.parties.dissolve(party.id)) this.memberCache.delete(m);
      this.log.info('idle party dissolved', { party: party.id });
    }
  }

  // =========================================================================================
  // Shutdown
  // =========================================================================================

  /**
   * A restart is coming: tell everyone (system chat + toast) and refuse new logins (4004, the client comes
   * back after the restart). The world keeps running until shutdown().
   */
  beginDrain(seconds: number): void {
    if (this.closed || this.draining) return;
    this.draining = true;
    const n = Math.max(0, Math.round(seconds));
    const text = `Server update in ${n} second${n === 1 ? '' : 's'} — your party and open maps are kept.`;
    const line: ServerMessage = { t: 'chat', fromName: '', text, time: Date.now() };
    for (const s of this.sessions.values()) {
      s.send(line);
      s.toast(text, 'info');
    }
    this.log.info('draining for restart', { seconds: n, players: this.sessions.size });
  }

  get isDraining(): boolean {
    return this.draining;
  }

  /**
   * Stop: close every socket (4004 — the client reconnects after the restart), keep every open uncleared map
   * for restore() (its participants' runs are logged neutrally; nobody is sent anywhere and nothing is
   * refunded), log cleared or unwritable maps as before, leave parties as they are, and flush all saves.
   */
  shutdown(): void {
    if (this.closed) return;
    this.closed = true;
    this.draining = false;
    this.stopTimers();
    for (const s of this.sessions.values()) {
      if (s.conn) {
        this.byConnection.delete(s.conn.id);
        s.conn.close(CLOSE_SHUTDOWN, SHUTDOWN_REASON);
        s.conn = null;
      }
    }
    this.guard('trades', () => this.trades.closeAll('The server is restarting. The trade was cancelled.'));
    this.ground.clear();
    this.guard('ground items', () => this.returnGroundItems());
    let kept = 0;
    for (const inst of this.instances.list()) {
      if (inst.disposed) continue;
      if (!(inst instanceof MapInstance)) {
        if (inst.groundItems.size > 0) this.log.info('ground items lost', { instance: inst.id, owner: inst.ownerName, count: inst.groundItems.size });
        continue;
      }
      if (!inst.cleared) this.persistMap(inst);
      if (!inst.cleared && inst.persisted) {
        // Kept: the runs so far count (kills, time, finds); the fight restarts after the restart.
        for (const p of inst.participants.values()) this.endParticipantRun(inst, p, 'neutral');
        for (const s of inst.members.values()) this.guard('map location', () => this.recordMapEntry(s, inst));
        if (inst.groundItems.size > 0) this.log.info('ground items lost', { instance: inst.id, owner: inst.ownerName, count: inst.groundItems.size });
        kept++;
        continue;
      }
      // Log each participant's run as over (their loot and XP are already on the character).
      for (const s of [...inst.members.values()]) this.guard('leave', () => this.leaveInstance(s));
      this.guard('close map', () => this.closeMap(inst, 'shutdown'));
    }
    // Visitors of a party member's hideout go back to it after the restart, not to their own.
    for (const s of this.sessions.values()) {
      const inst = s.instance;
      if (!inst || inst.kind !== 'hideout' || inst.ownerId === s.characterId) continue;
      this.guard('hideout location', () => this.db.setCharacterMap({
        characterId: s.characterId, mapId: hideoutLocationKey(inst.ownerId), ownerId: inst.ownerId,
        mapName: `${inst.ownerName}'s hideout`, updated: this.now(),
      }));
    }
    // Parties stay exactly as they are; their "last active" time is now.
    for (const party of this.parties.list()) this.persistParty(party);
    for (const s of [...this.sessions.values()]) this.guard('end session', () => this.endSession(s));
    this.store.flushAll();
    this.log.info('game stopped', { mapsKept: kept, parties: this.parties.partyCount });
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Diagnostics for logs and tests. */
  status(): { players: number; instances: number; parties: number; trades: number } {
    return { players: this.sessions.size, instances: this.instances.size, parties: this.parties.partyCount, trades: this.trades.openTrades };
  }
}

/** The id of a (malformed) command frame, if it has a usable one — so its sender gets a proper result. */
function commandIdOf(raw: unknown): number | null {
  let text: string | null = null;
  if (typeof raw === 'string') text = raw;
  else if (raw instanceof Uint8Array || raw instanceof ArrayBuffer) {
    const bytes = raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw;
    if (bytes.byteLength <= 16384) text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8');
  }
  if (!text || text.length > 16384) return null;
  try {
    const v = JSON.parse(text) as { t?: unknown; id?: unknown };
    if (v && typeof v === 'object' && v.t === 'cmd' && Number.isSafeInteger(v.id) && (v.id as number) >= 0) return v.id as number;
  } catch {
    // not JSON
  }
  return null;
}

export type { ToastTone };
