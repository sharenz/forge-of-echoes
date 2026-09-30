// Instances: one SimRun each — a character's hideout, or a map opened from its map device — with the
// players currently inside, their input → intent plumbing, per-viewer snapshots and event fan-out, and
// (maps) the instanced loot behind the sim's drop tokens.
//
// Tick (fixed 60 Hz, driven by the Game's scheduler):
//   every member: run.setIntent(id, queue.next(intent))  (idle intent while their socket is gone)
//   run.step() → events collected per viewer (AOI + priority) → outcomes handed to the host (Game)
//   → deferred runtime updates (level-ups, flask pickups) → every SNAPSHOT_EVERY ticks: one binary snapshot
//   + one 'events' message per connected member (paced per viewer when their link is congested).
//
// Loot rolls draw from a fresh server-entropy Rng per hook call instead of the sim's loot stream (unless
// GameOptions.privateLootRng is false): item uids are raw generator output, so a client that sees one
// could otherwise recover the stream and predict every later drop in the map (src/game/online.ts).
//
// Ground items (GAME_SPEC §12 "Drop items on the floor"): any instance — hideout or map — can hold PUBLIC
// drops (DropSpec.owner 0) that players put on the floor. Their tokens share the instance's token space
// with instanced loot; hooks.tryPickup hands a public token to whoever clicked it (host.pickupPublic).
// They expire (the Game's maintenance calls expireGroundItems) and are lost with the instance (logged).
import type { Theme } from '../contracts/content';
import type { RunSetup } from '../contracts/game';
import type { Item, MapItem } from '../contracts/items';
import { MAX_PARTY_SIZE, PORTALS_PER_MAP, SNAPSHOT_EVERY } from '../contracts/net';
import type { PortalInfo, ZoneInfo } from '../contracts/net';
import { SIM_DT } from '../contracts/sim';
import type {
  DropSpec, DropTone, KillLootContext, PlayerView, PropView, RunHooks, SimOutcome, SimRun,
} from '../contracts/sim';
import type { Rng } from '../contracts/rng';
import { hideoutSeed, redactSetupForClient, rules } from '../game';
import { createSnapshotEncoder, encodeMessage } from '../net';
import type { NetSnapshotEncoder } from '../net';
import { createRun, drainHookErrors } from '../sim';
import type { SimPlayerJoin, SimPlayerUpdate } from '../sim';
import type { Logger } from './log';
import { CONGESTION_STREAK, EVENTS_COMPRESS_MIN_CHARS, SNAPSHOT_BACKPRESSURE_BYTES, idleIntent } from './session';
import type { PlayerSession } from './session';

export const TICK_MS = SIM_DT * 1000;
/** At most this many catch-up steps per scheduler pass; a longer stall is dropped, not replayed. */
export const MAX_CATCHUP_STEPS = 5;

/** What an instance needs from the Game. */
export interface InstanceHost {
  readonly log: Logger;
  debugMerchantEnabled(ownerId: string): boolean;
  /** Authoritative outcomes of one tick (may move players out of `inst`). */
  handleOutcomes(inst: Instance, outcomes: readonly SimOutcome[]): void;
  /** A player touched their own drop: add it to their character; false when it does not fit. */
  pickup(inst: MapInstance, session: PlayerSession, item: Item, label: string, tone: DropTone): boolean;
  /**
   * A player clicked a public ground item: give it to them; false (changing nothing) when it does not fit.
   * Must never throw after granting the item (the token is consumed right after it returns true).
   */
  pickupPublic(inst: Instance, session: PlayerSession, drop: GroundItem): boolean;
  /** After every tick of `inst` (outcomes handled, runtime updates applied, before the snapshot). */
  afterTick(inst: Instance): void;
  /** ZoneInfo.portal for a zone (hideout: the owner's open map; map: the map's own portals). */
  zonePortal(inst: Instance): PortalInfo | null;
  /** The Rng for one loot roll: fresh server-only entropy (default), or the sim's own stream (replays). */
  lootRng(simRng: Rng): Rng;
  /** Encoding or sending a snapshot for this viewer threw (the other viewers were served). */
  viewerFailed(inst: Instance, session: PlayerSession, err: unknown): void;
}

export interface TickStats {
  ticks: number;
  /** Total ms spent in tick() (step + outcomes + snapshots). */
  totalMs: number;
  maxMs: number;
  /** Scheduler passes that fell behind by more than MAX_CATCHUP_STEPS. */
  overruns: number;
}

/** An item a player put on the floor: public (DropSpec.owner 0), anyone in the instance may pick it up. */
export interface GroundItem {
  readonly token: number;
  readonly dropId: number;
  readonly item: Item;
  readonly label: string;
  readonly tone: DropTone;
  readonly droppedById: string;
  readonly droppedByName: string;
  /** Wall ms. */
  readonly droppedAt: number;
  readonly expiresAt: number;
}

function plainProp(p: PropView): PropView {
  return { id: p.id, kind: p.kind, x: p.x, y: p.y, radius: p.radius, state: p.state, variant: p.variant, interactive: p.interactive };
}

export abstract class Instance {
  abstract readonly kind: 'hideout' | 'map';
  readonly run: SimRun;
  /** Members by sim player id (join order). */
  readonly members = new Map<number, PlayerSession>();
  /** Stable PlayerView objects of the members (positions for AOI filtering). */
  private readonly views = new Map<number, PlayerView>();
  private readonly encoder: NetSnapshotEncoder = createSnapshotEncoder();
  private readonly runtimeQueue = new Map<PlayerSession, SimPlayerUpdate>();
  private nextPlayerId = 1;
  /** Drop tokens (instanced loot and ground items share one space). */
  private nextToken = 1;
  /** Public ground items by token. */
  readonly groundItems = new Map<number, GroundItem>();
  private inStep = false;
  private accumulator = 0;
  private lastAdvance = -1;
  /** Wall ms since which the instance has been empty (0 while occupied). */
  emptySince: number;
  disposed = false;
  readonly stats: TickStats = { ticks: 0, totalMs: 0, maxMs: 0, overruns: 0 };
  /** Snapshot bytes sent (diagnostics). */
  bytesSent = 0;

  protected constructor(
    protected readonly host: InstanceHost,
    readonly id: string,
    readonly ownerId: string,
    public ownerName: string,
    readonly setup: RunSetup | null,
    now: number,
  ) {
    const hooks: RunHooks = {
      rollKillLoot: (ctx, ids, rng) => this.rollKillLoot(ctx, ids, rng),
      rollChestLoot: (ids, rng) => this.rollChestLoot(ids, rng),
      tryPickup: (id, token) => this.tryPickup(id, token),
    };
    const config = rules.buildRunConfig(setup, hooks);
    // Every hideout gets its owner's own decor layout (stable across restarts).
    if (!setup) config.seed = hideoutSeed(ownerId);
    this.run = createRun(config);
    this.emptySince = now;
  }

  protected abstract rollKillLoot(ctx: KillLootContext, playerIds: readonly number[], rng: Rng): DropSpec[];
  protected abstract rollChestLoot(playerIds: readonly number[], rng: Rng): DropSpec[];
  /** A player touched / clicked one of their OWN (instanced) drops. */
  protected abstract tryOwnPickup(playerId: number, token: number): boolean;

  protected allocateToken(): number {
    for (let k = 0; k < 0x10000; k++) {
      const token = this.nextToken;
      this.nextToken = this.nextToken >= 0xfffffff0 ? 1 : this.nextToken + 1;
      if (!this.groundItems.has(token) && !this.tokenInUse(token)) return token;
    }
    throw new Error(`instance ${this.id}: no free drop token`);
  }

  /** Subclasses holding their own tokens (instanced loot) report them here. */
  protected tokenInUse(_token: number): boolean {
    return false;
  }

  /**
   * hooks.tryPickup: a public ground item goes to whoever clicked it (all or nothing — the token is
   * consumed only after the host granted it); anything else is instanced loot for its owner.
   */
  private tryPickup(playerId: number, token: number): boolean {
    const ground = this.groundItems.get(token);
    if (!ground) return this.tryOwnPickup(playerId, token);
    const s = this.members.get(playerId);
    if (!s) return false;
    if (!this.host.pickupPublic(this, s, ground)) return false;
    this.groundItems.delete(token);
    return true;
  }

  /**
   * Put `item` on the floor at (x, y) as a public drop dropped by `by`. Throws (changing nothing) when the
   * sim refuses it; the caller removes the item from the character only after this returned.
   */
  dropOnGround(item: Item, by: PlayerSession, x: number, y: number, now: number, ttlMs: number): GroundItem {
    const token = this.allocateToken();
    const spec = rules.dropSpec(item, token, 0, true);
    const dropId = this.run.spawnDrop(spec, x, y);
    const ground: GroundItem = {
      token, dropId, item, label: spec.label, tone: spec.tone,
      droppedById: by.characterId, droppedByName: by.name, droppedAt: now, expiresAt: now + ttlMs,
    };
    this.groundItems.set(token, ground);
    return ground;
  }

  /** Remove ground items whose time is up; returns them (for the log). */
  expireGroundItems(now: number): GroundItem[] {
    const out: GroundItem[] = [];
    for (const [token, g] of this.groundItems) {
      if (g.expiresAt > now) continue;
      this.groundItems.delete(token);
      try {
        this.run.removeDrop(g.dropId);
      } catch (err) {
        this.host.log.warn('removeDrop failed', { instance: this.id, err });
      }
      out.push(g);
    }
    return out;
  }
  /** Hooks for subclasses around membership changes. */
  protected onJoin(_session: PlayerSession): void {}
  protected onLeave(_session: PlayerSession): void {}

  get theme(): Theme {
    return this.run.config.theme;
  }

  get mapName(): string {
    return this.run.config.mapName;
  }

  get tier(): number {
    return this.run.config.tier;
  }

  get playerCount(): number {
    return this.members.size;
  }

  get hasRoom(): boolean {
    return this.members.size < MAX_PARTY_SIZE;
  }

  memberByCharacter(characterId: string): PlayerSession | null {
    for (const s of this.members.values()) if (s.characterId === characterId) return s;
    return null;
  }

  /** The member's current view (dead flag, position). */
  viewOf(session: PlayerSession): PlayerView | null {
    return this.views.get(session.playerId) ?? null;
  }

  isDead(session: PlayerSession): boolean {
    return this.viewOf(session)?.dead ?? false;
  }

  private allocatePlayerId(): number {
    // Fresh ids (1..255, wrapping) so a newcomer never inherits a leaver's id on clients mid-interpolation.
    for (let k = 0; k < 255; k++) {
      const id = this.nextPlayerId;
      this.nextPlayerId = (this.nextPlayerId % 255) + 1;
      if (!this.members.has(id)) return id;
    }
    throw new Error('instance: no free player id');
  }

  /** Put a session into this instance (the caller checked access and room). */
  join(session: PlayerSession, extra: Partial<SimPlayerJoin> = {}): void {
    if (this.disposed) throw new Error(`instance ${this.id} is disposed`);
    if (!this.hasRoom) throw new Error(`instance ${this.id} is full`);
    const id = this.allocatePlayerId();
    const ch = session.record.ch;
    const join: SimPlayerJoin = { id, name: ch.name, level: ch.level, runtime: rules.playerRuntime(ch, this.setup), ...extra };
    this.run.addPlayer(join);
    const view = this.run.view.players.find((p) => p.id === id);
    if (!view) throw new Error('instance: joined player has no view');
    this.members.set(id, session);
    this.views.set(id, view);
    session.instance = this;
    session.playerId = id;
    session.resetInput(false);
    this.emptySince = 0;
    this.onJoin(session);
  }

  /** Take a session out (removes the player from the sim together with their un-picked drops). */
  leave(session: PlayerSession, now: number): void {
    if (session.instance !== this) return;
    const id = session.playerId;
    this.onLeave(session);
    this.members.delete(id);
    this.views.delete(id);
    this.runtimeQueue.delete(session);
    try {
      this.run.removePlayer(id);
    } catch (err) {
      this.host.log.warn('removePlayer failed', { instance: this.id, err });
    }
    session.instance = null;
    session.playerId = 0;
    session.outbox.clear();
    if (this.members.size === 0) this.emptySince = now;
  }

  /**
   * Refresh a member's resolved stats/skills/loadout/belt from their character (after gear, skill, flask or
   * level changes). Inside a step the update is deferred to the end of the tick.
   */
  updateRuntime(session: PlayerSession, extra: SimPlayerUpdate = {}): void {
    if (session.instance !== this) return;
    if (this.inStep) {
      const prev = this.runtimeQueue.get(session);
      this.runtimeQueue.set(session, { ...prev, ...extra, restore: (prev?.restore ?? false) || (extra.restore ?? false) });
      return;
    }
    const update: SimPlayerUpdate = { ...rules.playerRuntime(session.record.ch, this.setup), ...extra };
    this.run.updatePlayer(session.playerId, update);
  }

  /** Apply the updates deferred during the step. One player's failing update never stops the others. */
  private flushRuntimeUpdates(): void {
    if (this.runtimeQueue.size === 0) return;
    const queued = [...this.runtimeQueue];
    this.runtimeQueue.clear();
    for (const [session, extra] of queued) {
      try {
        this.updateRuntime(session, extra);
      } catch (err) {
        this.host.log.error('runtime update failed', { instance: this.id, character: session.name, err });
      }
    }
  }

  /** Advance by wall time (fixed steps, ≤ MAX_CATCHUP_STEPS per call). Frozen while nobody is inside. */
  advance(nowMs: number): number {
    if (this.lastAdvance < 0 || this.members.size === 0) {
      this.lastAdvance = nowMs;
      this.accumulator = 0;
      return 0;
    }
    this.accumulator += Math.max(0, nowMs - this.lastAdvance);
    this.lastAdvance = nowMs;
    let steps = 0;
    while (this.accumulator >= TICK_MS && steps < MAX_CATCHUP_STEPS && !this.disposed && this.members.size > 0) {
      this.tick();
      this.accumulator -= TICK_MS;
      steps++;
    }
    if (this.accumulator >= TICK_MS) {
      // Fell behind (a long GC pause or an overloaded host): drop the backlog rather than fast-forwarding.
      this.stats.overruns++;
      this.accumulator = 0;
    }
    return steps;
  }

  /** Exactly one fixed tick (the scheduler calls this; tests may call it directly). */
  tick(): void {
    const t0 = performance.now();
    const run = this.run;
    for (const s of this.members.values()) {
      run.setIntent(s.playerId, s.conn ? s.input.next(s.intent) : idleIntent(s.intent));
    }
    this.inStep = true;
    let outcomes: SimOutcome[];
    try {
      run.step();
      const events = run.drainEvents();
      if (events.length > 0) {
        for (const s of this.members.values()) {
          if (!s.conn) continue;
          const v = this.views.get(s.playerId);
          if (v) s.outbox.collect(events, s.playerId, v.x, v.y);
        }
      }
      outcomes = run.drainOutcomes();
      if (outcomes.length > 0) this.host.handleOutcomes(this, outcomes);
    } finally {
      this.inStep = false;
    }
    if (this.disposed) return;
    this.flushRuntimeUpdates();
    this.host.afterTick(this);
    if (this.disposed) return;
    const hookErrors = drainHookErrors(run);
    if (hookErrors.length > 0) this.host.log.error('sim hook failed', { instance: this.id, count: hookErrors.length, err: hookErrors[0] });
    if (run.view.tick % SNAPSHOT_EVERY === 0) this.sendSnapshots();
    const ms = performance.now() - t0;
    this.stats.ticks++;
    this.stats.totalMs += ms;
    if (ms > this.stats.maxMs) this.stats.maxMs = ms;
  }

  /**
   * One binary snapshot (+ the events collected since the last one) per connected member, paced per viewer:
   *   • unsent data at CONGESTION_STREAK snapshot times in a row → every second snapshot (15 Hz) until the
   *     socket has drained completely (events accumulate into the next packet meanwhile);
   *   • more than SNAPSHOT_BACKPRESSURE_BYTES unsent → skip entirely (the next snapshot supersedes it) and
   *     shed the cosmetic events, keeping the essential ones.
   * 'zone', 'result' and 'character' are never skipped (they don't go through here).
   * One viewer's failure never costs the others their snapshot.
   */
  sendSnapshots(): void {
    const view = this.run.view;
    let failed: [PlayerSession, unknown][] | null = null;
    for (const s of this.members.values()) {
      const conn = s.conn;
      if (!conn || !conn.open) {
        s.outbox.clear();
        continue;
      }
      const link = s.link;
      const buffered = conn.bufferedAmount;
      if (buffered > 0) {
        if (++link.backlogStreak >= CONGESTION_STREAK) link.halfRate = true;
      } else {
        link.backlogStreak = 0;
        link.halfRate = false;
      }
      if (buffered > SNAPSHOT_BACKPRESSURE_BYTES) {
        link.skipped++;
        s.outbox.shed();
        continue;
      }
      if (link.halfRate && (link.phase++ & 1) === 1) {
        link.skipped++;
        continue;
      }
      try {
        const snap = this.encoder.encode(view, s.playerId, s.input.ackSeq);
        this.bytesSent += snap.byteLength;
        conn.sendBinary(snap);
        const events = s.outbox.take();
        if (events) {
          const text = encodeMessage({ t: 'events', tick: view.tick, events });
          conn.sendText(text, text.length > EVENTS_COMPRESS_MIN_CHARS);
        }
        link.failures = 0;
      } catch (err) {
        s.outbox.clear();
        (failed ??= []).push([s, err]);
      }
    }
    // Reported after the loop: the host may move the viewer out of this instance.
    if (failed) for (const [s, err] of failed) this.host.viewerFailed(this, s, err);
  }

  zoneInfo(session: PlayerSession): ZoneInfo {
    const cfg = this.run.config;
    return {
      instanceId: this.id,
      kind: this.kind,
      ownerCharacterId: this.ownerId,
      ownerName: this.ownerName,
      theme: cfg.theme,
      arenaRadius: cfg.arenaRadius,
      mapName: cfg.mapName,
      tier: cfg.tier,
      localPlayerId: session.playerId,
      props: this.run.view.props.map(plainProp),
      setup: this.setup ? redactSetupForClient(this.setup) : null,
      portal: this.host.zonePortal(this),
    };
  }

  dispose(): void {
    if (this.groundItems.size > 0) {
      const items = [...this.groundItems.values()].map((g) => g.label);
      this.host.log.info('ground items lost', { instance: this.id, owner: this.ownerName, count: items.length, items: items.join(', ') });
      this.groundItems.clear();
    }
    this.disposed = true;
    this.members.clear();
    this.views.clear();
    this.runtimeQueue.clear();
  }
}

// ---------------------------------------------------------------------------
// Hideout
// ---------------------------------------------------------------------------

export class HideoutInstance extends Instance {
  readonly kind = 'hideout' as const;

  constructor(host: InstanceHost, id: string, ownerId: string, ownerName: string, now: number) {
    super(host, id, ownerId, ownerName, null, now);
    this.run.setDebugMerchant(host.debugMerchantEnabled(ownerId));
  }

  // Only the training dummy lives here: it never dies and nothing drops.
  protected rollKillLoot(): DropSpec[] {
    return [];
  }

  protected rollChestLoot(): DropSpec[] {
    return [];
  }

  protected tryOwnPickup(): boolean {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

/** One character's involvement in a map instance (run summary + applyRunEnd once it is over). */
export interface MapParticipant {
  readonly characterId: string;
  name: string;
  /** Kill credits of this player. */
  kills: number;
  /** Sim ticks spent inside, all entries summed (plus the current stay while inside). */
  ticksInside: number;
  enteredAtTick: number;
  inside: boolean;
  xpGained: number;
  levelsGained: number;
  itemsFound: { label: string; tone: DropTone }[];
  raresFound: number;
  uniquesFound: number;
  /** applyRunEnd was applied for this map. */
  ended: boolean;
}

interface LootEntry {
  playerId: number;
  characterId: string;
  item: Item;
  label: string;
  tone: DropTone;
}

/** Kept per summary (the run summary lists at most this many found items). */
const MAX_SUMMARY_ITEMS = 120;

export class MapInstance extends Instance {
  readonly kind = 'map' as const;
  declare readonly setup: RunSetup;
  /** The map item the owner put into the device (refunded only when the map cannot be kept over a restart). */
  sourceItem: MapItem | null = null;
  portalsRemaining = PORTALS_PER_MAP;
  portalsTotal = PORTALS_PER_MAP;
  cleared = false;
  /** Account discovery is awarded once per run, even when a restart recreates the boss. */
  readonly atlasCredits = new Set<string>();
  /** Boss participants awaiting an atomic discovery + map-row commit (account → character). */
  readonly atlasPendingCredits = new Map<string, string>();
  /** Persistent id (database row; survives restarts, unlike the instance id). */
  readonly mapKey: string;
  /** Wall ms the map was opened (kept over restarts). */
  createdAt: number;
  /** Recreated after a server restart (a fresh run of the same map). */
  restored = false;
  /** Wall ms until which a restored map waits for the players who were inside (even with 0 portals left). */
  awaitingReturnUntil = 0;
  /** Its database row is up to date (false after a failed write: then a shutdown refunds instead). */
  persisted = false;
  /** Everyone who has ever entered (kept over restarts; the database row lists them). */
  readonly everEntered = new Map<string, string>();
  readonly participants = new Map<string, MapParticipant>();
  private readonly loot = new Map<number, LootEntry>();

  constructor(host: InstanceHost, id: string, ownerId: string, ownerName: string, setup: RunSetup, now: number, mapKey: string) {
    super(host, id, ownerId, ownerName, setup, now);
    this.mapKey = mapKey;
    this.createdAt = now;
  }

  protected override tokenInUse(token: number): boolean {
    return this.loot.has(token);
  }

  portalInfo(): PortalInfo {
    return {
      ownerCharacterId: this.ownerId,
      ownerName: this.ownerName,
      mapName: this.mapName,
      tier: this.tier,
      remaining: this.portalsRemaining,
      total: this.portalsTotal,
      cleared: this.cleared,
    };
  }

  participant(session: PlayerSession): MapParticipant {
    let p = this.participants.get(session.characterId);
    if (!p) {
      p = {
        characterId: session.characterId,
        name: session.name,
        kills: 0,
        ticksInside: 0,
        enteredAtTick: 0,
        inside: false,
        xpGained: 0,
        levelsGained: 0,
        itemsFound: [],
        raresFound: 0,
        uniquesFound: 0,
        ended: false,
      };
      this.participants.set(session.characterId, p);
    }
    return p;
  }

  /** Seconds a participant has spent inside so far. */
  secondsInside(p: MapParticipant): number {
    const ticks = p.ticksInside + (p.inside ? this.run.view.tick - p.enteredAtTick : 0);
    return Math.round(ticks * SIM_DT);
  }

  protected override onJoin(session: PlayerSession): void {
    const p = this.participant(session);
    p.inside = true;
    p.enteredAtTick = this.run.view.tick;
    this.everEntered.set(session.characterId, session.name);
  }

  protected override onLeave(session: PlayerSession): void {
    const p = this.participant(session);
    if (p.inside) p.ticksInside += this.run.view.tick - p.enteredAtTick;
    p.inside = false;
    // The sim deletes the leaver's drops; forget the items behind them.
    for (const [token, entry] of this.loot) if (entry.playerId === session.playerId) this.loot.delete(token);
  }

  recordFound(session: PlayerSession, label: string, tone: DropTone): void {
    const p = this.participant(session);
    if (p.itemsFound.length < MAX_SUMMARY_ITEMS) p.itemsFound.push({ label, tone });
    if (tone === 'rare') p.raresFound++;
    if (tone === 'unique') p.uniquesFound++;
  }

  private register(playerId: number, session: PlayerSession, items: readonly Item[], out: DropSpec[]): void {
    for (const item of items) {
      const token = this.allocateToken();
      const spec = rules.dropSpec(item, token, playerId);
      this.loot.set(token, { playerId, characterId: session.characterId, item, label: spec.label, tone: spec.tone });
      out.push(spec);
    }
  }

  // Instanced loot: every player present rolls separately with their own character (personal luck).
  // Each roll gets fresh server entropy by default (see the header).
  protected rollKillLoot(ctx: KillLootContext, playerIds: readonly number[], simRng: Rng): DropSpec[] {
    const out: DropSpec[] = [];
    const rng = this.host.lootRng(simRng);
    for (const id of playerIds) {
      const s = this.members.get(id);
      if (!s) continue;
      this.register(id, s, rules.rollKillLoot(this.setup, ctx, rng, s.record.ch), out);
    }
    return out;
  }

  protected rollChestLoot(playerIds: readonly number[], simRng: Rng): DropSpec[] {
    const out: DropSpec[] = [];
    const rng = this.host.lootRng(simRng);
    for (const id of playerIds) {
      const s = this.members.get(id);
      if (!s) continue;
      this.register(id, s, rules.rollChestLoot(this.setup, rng, s.record.ch), out);
    }
    return out;
  }

  protected tryOwnPickup(playerId: number, token: number): boolean {
    const entry = this.loot.get(token);
    if (!entry || entry.playerId !== playerId) return false;
    const s = this.members.get(playerId);
    if (!s || s.characterId !== entry.characterId) return false;
    if (!this.host.pickup(this, s, entry.item, entry.label, entry.tone)) return false;
    this.loot.delete(token);
    return true;
  }

  /** Items waiting on the ground for someone (diagnostics/tests). */
  get lootOnGround(): number {
    return this.loot.size;
  }
}
