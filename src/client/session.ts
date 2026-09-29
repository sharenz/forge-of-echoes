// One connected character: the replicated world (src/net ClientWorld + EventTimeline), zone and portal state,
// the authoritative CharacterSave with optimistic predictions, command request/response, the 60 Hz input
// pipeline (keyboard / click-to-pick-up walk / auto-attack / autopilot → InputMessage → prediction + wire), the
// trade window, the crafting bench and the HUD. DOM-free: the app (app.ts) owns rendering, audio and the browser;
// tests drive a session with a fake `send`.
import type { SfxId } from '../contracts/audio';
import type { SkillId } from '../contracts/content';
import type { GameRulesApi, MerchantOffer, Result, RunSetup } from '../contracts/game';
import { CURRENCY_STASH_MAX } from '../contracts/items';
import type { CharacterSave, Item, ItemLocation } from '../contracts/items';
import { TRADE_ACCEPT_LOCK_MS, TRADE_MAX_ITEMS } from '../contracts/net';
import type { ClientMessage, Command, InputMessage, PortalInfo, ServerMessage, TradeInfo, ZoneInfo } from '../contracts/net';
import type { SimEvent } from '../contracts/sim';
import type { HudState, Toast, UiState } from '../contracts/ui';
import { tradeOfferError } from '../game';
import { SNAPSHOT_VERSION, createClientWorld, createEventTimeline } from '../net';
import type { EventTimeline, NetClientWorld } from '../net';
import { leadAim, pickAutoTarget, type Point } from './autoattack';
import { AutoWalk, findDrop, inPickupReach } from './autowalk';
import type { Autopilot } from './bot';
import { CommandTracker, type CommandResult } from './commands';
import { buildHud, localPlayer, type TellInfo } from './hud';
import { hoveredMonster } from './monster-hover';
import { shouldSendInput, toInputMessage, type InputSample } from './input';
import { CharacterSync } from './optimistic';
import {
  addInvite, addTradeRequest, closePanel, pushChat, pushToast, removeInvite, removeTradeRequest, visibleLeftPanel,
  withCharacter, withParty, withRunSummary, withServerClockOffset, withTrade, withZone,
} from './state';
import type { StateBox } from './store';

/**
 * Fallback expiry of an invite card. The server expires invites after a minute but renews one silently when the
 * inviter asks again, so the client cannot know the real deadline: a card stays for a few minutes, and answering
 * a lapsed one just toasts the server's "expired" error.
 */
export const INVITE_TTL_MS = 5 * 60_000;
/**
 * Fallback expiry of a trade request card. The server expires requests after a minute but a repeated request only
 * renews it (no second message), so the card stays a while longer; answering a lapsed one toasts "expired".
 */
export const TRADE_REQUEST_CARD_TTL_MS = 3 * 60_000;
/** How long a craft's toast waits for the pushed character to tell what happened (scar, finish…). */
const CRAFT_ANALYSIS_MS = 1200;
/** The autopilot re-sends a pickup click for the same item at most this often (ms). */
const BOT_PICKUP_INTERVAL_MS = 700;
/** Clock-offset samples whose round trip is this much worse than the smoothed one are skipped (queued pongs). */
const CLOCK_RTT_OUTLIER = 2;
/** The UI's serverClockOffset follows the estimate once it moved at least this far (ms): no 1 Hz re-renders. */
const CLOCK_UI_STEP_MS = 20;
/** The server's 'trade' result text for a completed swap (it also sends its own "Trade with … completed." toast). */
const TRADE_COMPLETED_RE = /^trade completed/i;
/** The server's refusal for stash use outside a hideout (special tabs included), said locally before sending. */
export const STASH_HIDEOUT_ERROR = 'The stash can only be used in a hideout.';
/** A partial-stack amount that is not a whole number of items (the wire allows 1..CURRENCY_STASH_MAX). */
const BAD_COUNT_ERROR = 'That amount cannot be moved.';

/** `count` for moveItem / quickMove: absent (the whole stack) or a whole number the wire accepts. */
export function validMoveCount(count: number | undefined): boolean {
  return count === undefined || (Number.isInteger(count) && count >= 1 && count <= CURRENCY_STASH_MAX);
}

/** Snapshots decoded in a row (≈ 3 s at 30 Hz) before the world counts as readable (the app's ReloadGuard). */
export const WORLD_READABLE_SNAPSHOTS = 90;
/** After a reconnect's 'welcome': the longest wait for the server's re-sent party and invites (ms). */
export const SOCIAL_RESYNC_MS = 5000;

/**
 * Snapshots the replica could not decode (ClientWorld counts them in stats().decodeErrors instead of throwing). The
 * connection counts these: a steady stream of them means a newer snapshot format — a reload brings the new bundle.
 */
export class SnapshotUnreadableError extends Error {
  constructor(version: number) {
    super(`world snapshot format ${version} could not be decoded (this client reads format ${SNAPSHOT_VERSION})`);
    this.name = 'SnapshotUnreadableError';
  }
}

/**
 * The party and invite cards shown from before a reconnect, until the server's re-sent state confirms them. The
 * server re-sends the party (when there is one) and pending invites right after the 'zone' of a new socket, but
 * never an explicit "no party" — so whatever it has not re-sent by the first snapshot after that zone is gone
 * (dissolved or kicked while away, or not restored by a server update).
 */
interface SocialResync {
  zoned: boolean;
  party: boolean;
  invites: Set<string>;
  deadline: number;
}

export interface SessionDeps {
  box: StateBox;
  rules: GameRulesApi;
  /** Send a message on the socket (false when it is not open). */
  send(msg: ClientMessage): boolean;
  /** Monotonic client ms (performance.now). */
  now(): number;
  /** Wall-clock ms (chat timestamps). */
  wallNow(): number;
  sound(id: SfxId): void;
  /**
   * Entered an instance: the app resets the presenter and fades. `resumed`: the same instance again after a
   * reconnect (a short drop) — the picture, corpses and camera stay.
   */
  zoneEntered?(zone: ZoneInfo, resumed: boolean): void;
  /** Inject a world replica (tests); default createClientWorld(). */
  world?: NetClientWorld;
}

interface PendingCraft {
  targetUid: string;
  before: Item | null;
  sentWith: CharacterSave | null;
  message: string | null;
  deadline: number;
}

type ToastTone = Toast['tone'];

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Input options for one tick. */
export interface TickOptions {
  /** Menu open (or another reason): no local input, the world keeps running. */
  blocked: boolean;
  autoAttack: boolean;
  bot: Autopilot | null;
  /** Render alpha of the last frame (auto-attack aims at the monster where it is drawn). */
  alpha: number;
}

export class GameSession {
  readonly world: NetClientWorld;
  readonly timeline: EventTimeline;
  readonly commands = new CommandTracker();
  readonly character = new CharacterSync();
  characterId: string | null = null;
  zone: ZoneInfo | null = null;
  portal: PortalInfo | null = null;
  tell: TellInfo | null = null;
  lastMapSetup: RunSetup | null = null;
  rttMs = 0;
  private disposed = false;
  /** A socket reopened since the last 'zone' (the next zone may resume the same instance). */
  private reopened = false;
  /** Party / invites awaiting the server's re-sent social state after a reconnect (null = nothing to check). */
  private resync: SocialResync | null = null;
  /** Snapshots decoded in a row (capped at WORLD_READABLE_SNAPSHOTS). */
  private cleanSnapshots = 0;
  /** The page is hidden: nothing is drawn, so incoming cosmetic events are not queued (the tell is still tracked). */
  private eventsSuspended = false;
  private readonly discardScratch: SimEvent[] = [];
  /** Projectile speed of the basic attack (auto-attack lead); 0 for non-projectile skills. */
  private basicProjectileSpeed = 0;
  private autoAttackSlot = -1;
  /** Monotonic per connection. */
  seq = 0;
  private lastSent: InputMessage | null = null;
  private ticksSinceSend = 0;
  private toastId = 0;
  private chatId = 0;
  private readonly inviteTimes = new Map<string, number>();
  private luck: { itemQuantity: number; itemRarity: number } | null = null;
  private modLines: string[] = [];
  private crafts: PendingCraft[] = [];
  private readonly targetScratch: Point = { x: 0, y: 0 };
  private readonly sample: InputSample = { moveX: 0, moveY: 0, held: 0, flask: -1 };
  /** Click-to-pick-up: walking the character to a ground item that was out of reach. */
  readonly walk = new AutoWalk();
  /** Bumped per pickup click: only the newest click's failure is worth a toast (the server answers superseded ones). */
  private pickupSerial = 0;
  private botPickupId = -1;
  private botPickupAt = 0;
  /** The last trade state the server sent (optimistic changes roll back to it on a refusal). */
  private serverTrade: TradeInfo | null = null;
  /** A trade we closed locally (cancel): late updates of it must not bring the window back. */
  private cancelledTradeId: string | null = null;
  private readonly tradeRequestTimes = new Map<string, number>();
  /** Server clock estimate: serverTime ≈ wallNow() + clockOffset. */
  private clockOffset: number | null = null;
  private clockRtt = 0;
  /** Keycap labels for the loadout slots (the app fills them from the keyboard layout), or null for the defaults. */
  keyLabels: readonly string[] | null = null;

  constructor(private readonly deps: SessionDeps) {
    this.world = deps.world ?? createClientWorld();
    this.timeline = createEventTimeline();
  }

  private get box(): StateBox {
    return this.deps.box;
  }

  private get rules(): GameRulesApi {
    return this.deps.rules;
  }

  get state(): UiState {
    return this.box.get();
  }

  /** The zone's run setup while in a map. */
  get setup(): RunSetup | null {
    return this.zone?.kind === 'map' ? this.zone.setup : null;
  }

  // ---------------------------------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------------------------------

  /**
   * A new socket opened: sequence numbers restart; the server will send welcome/character/zone again. `canResume`:
   * the character may still be where it was (a short drop). After a server update (4004) it cannot: the restarted
   * server numbers its instances and players from scratch, so the same instanceId and player id are a coincidence
   * — a new zone entry (presenter reset, fade), never an in-place resume.
   */
  connectionOpened(canResume = true): void {
    this.reopened = canResume && this.zone !== null;
    this.seq = 0;
    this.lastSent = null;
    this.ticksSinceSend = 0;
  }

  /**
   * The socket dropped: pending commands fail (the reconnect replays state), predictions go, a walk to an item stops.
   * The server cancels an open trade and forgets trade requests when a socket drops, so they go here too (a trade
   * that is somehow still open comes back with the reconnect).
   */
  connectionLost(): void {
    this.commands.failAll('The connection was lost.');
    this.crafts = [];
    this.walk.cancel('manual');
    if (this.character.dropPredictions()) this.applyCharacter();
    const hadTrade = !!this.state.trade;
    this.serverTrade = null;
    this.cancelledTradeId = null;
    this.tradeRequestTimes.clear();
    if (hadTrade || this.state.tradeRequests.length) {
      this.box.update((s) => ({ ...withTrade(s, null), tradeRequests: s.tradeRequests.length ? [] : s.tradeRequests }));
    }
    if (hadTrade) this.toast('The connection dropped, so the trade was cancelled.', 'info');
  }

  /** The session is over (left the game): late answers must not touch the UI any more. */
  dispose(): void {
    this.disposed = true;
    this.resync = null;
    this.commands.failAll('Left the game.');
    this.crafts = [];
    this.timeline.clear();
  }

  setRtt(ms: number): void {
    this.rttMs = this.rttMs === 0 ? ms : this.rttMs * 0.8 + ms * 0.2;
    this.world.setRtt(ms);
  }

  // ---------------------------------------------------------------------------------------------
  // Server messages
  // ---------------------------------------------------------------------------------------------

  /**
   * A binary world snapshot. Throws SnapshotUnreadableError when the replica could not decode it (the connection
   * counts those and ends the session with 'reload' once they keep coming).
   */
  snapshot(data: ArrayBuffer, receivedAt: number): void {
    if (!this.zone) return;
    // The server's re-sent social state precedes the new zone's first snapshot.
    if (this.resync?.zoned) this.settleResync();
    const before = this.world.stats().decodeErrors;
    this.world.pushSnapshot(data, receivedAt);
    if (this.world.stats().decodeErrors !== before) {
      this.cleanSnapshots = 0;
      throw new SnapshotUnreadableError(data.byteLength > 0 ? new Uint8Array(data, 0, 1)[0] : -1);
    }
    if (this.cleanSnapshots < WORLD_READABLE_SNAPSHOTS) this.cleanSnapshots++;
  }

  /** The replica has decoded a steady run of snapshots: this bundle can read the server's world. */
  get worldReadable(): boolean {
    return this.cleanSnapshots >= WORLD_READABLE_SNAPSHOTS;
  }

  handle(msg: ServerMessage): void {
    switch (msg.t) {
      case 'welcome': {
        this.characterId = msg.characterId;
        this.clockSample(msg.serverTime, this.rttMs, true);
        const s = this.state;
        this.resync = s.party || s.invites.length
          ? { zoned: false, party: false, invites: new Set(), deadline: this.deps.now() + SOCIAL_RESYNC_MS }
          : null;
        break;
      }
      case 'character':
        this.onCharacter(msg.character);
        break;
      case 'zone':
        this.onZone(msg.zone);
        break;
      case 'portal':
        this.portal = msg.portal;
        break;
      case 'events':
        if (!this.zone) break;
        // The replica learns her own chain-hook drags ('pull') from these — also while nothing is drawn, or the
        // prediction would fight the server's drag until the next snapshot corrects it.
        this.world.noteEvents(msg.tick, msg.events);
        if (this.eventsSuspended) this.trackTell(msg.events, 0);
        else this.timeline.push(msg.tick, msg.events);
        break;
      case 'result':
        this.commands.settle(msg.id, { ok: msg.ok, error: msg.error, message: msg.message, offers: msg.offers });
        break;
      case 'toast':
        this.toast(msg.text, msg.tone);
        if (msg.tone === 'bad') this.deps.sound('uiError');
        break;
      case 'party':
        if (this.resync) this.resync.party = true;
        this.box.update((s) => withParty(s, msg.party));
        break;
      case 'invite': {
        // The server re-sends pending invites after a reconnect: a card already up only gets its timer renewed.
        this.resync?.invites.add(msg.invite.inviteId);
        const known = this.state.invites.some((i) => i.inviteId === msg.invite.inviteId);
        this.inviteTimes.set(msg.invite.inviteId, this.deps.now());
        this.box.update((s) => addInvite(s, msg.invite));
        if (!known) this.deps.sound('partyInvite');
        break;
      }
      case 'chat': {
        const mine = msg.fromName !== '' && msg.fromName === this.character.display?.name;
        this.box.update((s) => pushChat(s, { id: ++this.chatId, fromName: msg.fromName, text: msg.text, time: msg.time, channel: msg.channel }));
        if (!mine) this.deps.sound('chat');
        break;
      }
      case 'runSummary':
        this.box.update((s) => withRunSummary(s, msg.summary, this.lastMapSetup));
        break;
      case 'pong':
        // RTT itself comes from the connection (it stamps the arrival); the server time sets the clock offset.
        this.clockSample(msg.serverTime, this.deps.now() - msg.time, false);
        break;
      case 'tradeRequest': {
        // The server re-sends pending requests after a reconnect: a card already up only gets its timer renewed.
        const known = this.state.tradeRequests.some((r) => r.requestId === msg.request.requestId);
        this.tradeRequestTimes.set(msg.request.requestId, this.deps.now());
        this.box.update((s) => addTradeRequest(s, msg.request));
        if (!known) this.deps.sound('partyInvite');
        break;
      }
      case 'trade':
        this.onTrade(msg.trade, msg.result);
        break;
    }
  }

  /**
   * One server-time sample: `serverTime` was stamped about half a round trip before now. The first sample is taken
   * as is; later ones blend in (outliers with a much slower round trip, e.g. a pong queued behind snapshots, skip).
   */
  private clockSample(serverTime: number, rtt: number, reset: boolean): void {
    if (!Number.isFinite(serverTime) || serverTime <= 0 || !Number.isFinite(rtt) || rtt < 0 || rtt > 30_000) return;
    const sample = serverTime + rtt / 2 - this.deps.wallNow();
    if (reset || this.clockOffset === null) {
      this.clockOffset = sample;
      this.clockRtt = rtt;
    } else {
      if (this.clockRtt > 0 && rtt > this.clockRtt * CLOCK_RTT_OUTLIER + 20) return;
      this.clockOffset += (sample - this.clockOffset) * 0.25;
      this.clockRtt += (rtt - this.clockRtt) * 0.25;
    }
    const offset = this.clockOffset;
    if (Math.abs(offset - this.state.serverClockOffset) >= CLOCK_UI_STEP_MS || this.state.serverClockOffset === 0) {
      this.box.update((s) => withServerClockOffset(s, offset));
    }
  }

  /** Server time now (ms), from the clock offset estimate. */
  serverNow(): number {
    return this.deps.wallNow() + (this.clockOffset ?? this.state.serverClockOffset);
  }

  private onTrade(trade: TradeInfo | null, result: string | undefined): void {
    this.serverTrade = trade;
    if (trade) {
      // A late update of a trade we just cancelled must not reopen its window.
      if (trade.tradeId === this.cancelledTradeId) return;
      const isNew = this.state.trade?.tradeId !== trade.tradeId;
      this.cancelledTradeId = null;
      this.box.update((s) => withTrade(s, trade));
      if (isNew) {
        for (const [id] of this.tradeRequestTimes) {
          if (!this.state.tradeRequests.some((r) => r.requestId === id)) this.tradeRequestTimes.delete(id);
        }
        this.deps.sound('uiOpen');
      }
      return;
    }
    const wasOpen = !!this.state.trade;
    this.cancelledTradeId = null;
    this.box.update((s) => withTrade(s, null));
    if (!result) return;
    if (TRADE_COMPLETED_RE.test(result)) {
      // The server toasts "Trade with <name> completed." itself.
      this.deps.sound('buy');
      return;
    }
    this.toast(result, 'info');
    if (wasOpen) this.deps.sound('uiClose');
  }

  private onCharacter(ch: CharacterSave): void {
    this.character.fromServer(ch);
    this.applyCharacter();
    // Move speed and cast times follow level, gear, attributes and skill ranks: refresh the prediction's numbers.
    this.updatePredictionHints();
    this.analyzeCrafts();
  }

  /** Drop the party and invite cards the server did not re-send after a reconnect (see SocialResync). */
  private settleResync(): void {
    const r = this.resync;
    if (!r) return;
    this.resync = null;
    const s = this.state;
    const party = r.party ? s.party : null;
    const invites = s.invites.filter((i) => r.invites.has(i.inviteId));
    if (party === s.party && invites.length === s.invites.length) return;
    for (const i of s.invites) if (!r.invites.has(i.inviteId)) this.inviteTimes.delete(i.inviteId);
    this.box.update((st) => ({
      ...withParty(st, party),
      invites: st.invites.filter((i) => r.invites.has(i.inviteId)),
    }));
  }

  private onZone(zone: ZoneInfo): void {
    const prev = this.zone;
    if (this.resync) this.resync.zoned = true;
    this.walk.cancel('manual');
    // After a short drop the server resumes the character in place: same instance, same sim player.
    const resumed = this.reopened && !!prev && prev.instanceId === zone.instanceId && prev.localPlayerId === zone.localPlayerId;
    this.reopened = false;
    this.zone = zone;
    this.portal = zone.portal;
    if (!resumed) this.tell = null;
    if (zone.kind === 'map' && zone.setup) this.lastMapSetup = zone.setup;
    // Even on a resume the replica starts over: input sequence numbers restart with the new socket.
    this.world.setZone(zone);
    this.timeline.clear();
    this.timeline.setLocalPlayer(zone.localPlayerId);
    this.lastSent = null;
    this.box.update((s) => withZone(s, zone, this.characterId, resumed));
    this.applyCharacter();
    this.updatePredictionHints();
    this.deps.zoneEntered?.(zone, resumed);
  }

  /** Push the displayed character (+ derived stats, luck, map mod lines) into the UI state. */
  private applyCharacter(): void {
    const ch = this.character.display;
    if (!ch) return;
    const setup = this.setup;
    const derived = safe(() => this.rules.deriveStats(ch, setup), this.state.derived);
    this.luck = setup ? safe(() => this.rules.lootLuck(setup, ch), null) : null;
    this.modLines = setup ? safe(() => {
      const desc = this.rules.describeItem(setup.map, ch);
      return [...desc.implicits, ...desc.affixes].map((l) => l.text);
    }, []) : [];
    this.box.update((s) => withCharacter(s, ch, derived, (uid) => !!safe(() => this.rules.findItem(ch, uid), null)));
  }

  private updatePredictionHints(): void {
    const ch = this.character.authoritative;
    if (!ch) return;
    const rt = safe(() => this.rules.playerRuntime(ch, this.setup), null);
    if (!rt) return;
    const castTimes: Partial<Record<SkillId, number>> = {};
    for (const k of rt.skills) castTimes[k.id] = k.castTime;
    this.world.setPredictionHints({ moveSpeed: rt.stats.moveSpeed, castTimes });
    this.autoAttackSlot = rt.loadout.indexOf('emberLance');
    const basic = rt.skills.find((k) => k.id === 'emberLance');
    this.basicProjectileSpeed = basic && basic.projectiles > 0 ? basic.projectileSpeed : 0;
  }

  // ---------------------------------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------------------------------

  /** Housekeeping once per frame: optimistic settle, command timeouts, invite expiry, craft analysis. */
  tick(now: number): void {
    if (this.resync && now >= this.resync.deadline) this.settleResync();
    if (this.character.tick(now)) this.applyCharacter();
    // Timed-out commands resolve as failures; their callers toast the error.
    this.commands.expire(now);
    if (this.inviteTimes.size) {
      for (const [id, at] of this.inviteTimes) {
        if (now - at < INVITE_TTL_MS) continue;
        this.inviteTimes.delete(id);
        this.box.update((s) => removeInvite(s, id));
      }
    }
    if (this.tradeRequestTimes.size) {
      for (const [id, at] of this.tradeRequestTimes) {
        if (now - at < TRADE_REQUEST_CARD_TTL_MS) continue;
        this.tradeRequestTimes.delete(id);
        this.box.update((s) => removeTradeRequest(s, id));
      }
    }
    if (this.crafts.length) this.analyzeCrafts();
  }

  /** Cosmetic events due at the current render tick (call after world.update). Tracks the wave tell. */
  drainEvents(out: SimEvent[]): SimEvent[] {
    const start = out.length;
    this.timeline.drain(this.world.renderTick, out);
    this.trackTell(out, start);
    return out;
  }

  /**
   * Frames have stalled (the tab is throttled or the GPU hangs): throw away what is due or stale instead of letting
   * it pile up for one giant burst on the next frame. The wave tell is still tracked. Returns the count dropped.
   */
  discardDueEvents(): number {
    const scratch = this.discardScratch;
    this.drainEvents(scratch);
    const n = scratch.length;
    scratch.length = 0;
    return n;
  }

  /**
   * The page was hidden (true) or shown again (false). While hidden, 'events' are not queued at all — a friend
   * may fight on for minutes — and on return the world starts from the present, not from a backlog.
   */
  setEventsSuspended(suspended: boolean): void {
    if (this.eventsSuspended === suspended) return;
    this.eventsSuspended = suspended;
    this.timeline.clear();
  }

  private trackTell(events: readonly SimEvent[], start: number): void {
    for (let i = start; i < events.length; i++) {
      const e = events[i];
      if (e.t === 'waveTell') {
        this.tell = { wave: e.wave, families: e.families, lieutenant: e.lieutenant, boss: e.boss, at: this.deps.now() };
      } else if (e.t === 'waveStart' && this.tell && e.wave >= this.tell.wave) {
        this.tell = null;
      }
    }
  }

  hud(now: number, fps: number, cursor: Point | null = null, alpha = 1): HudState | null {
    if (!this.zone) return null;
    const hud = buildHud({
      view: this.world.view,
      localPlayerId: this.zone.localPlayerId,
      zone: this.zone,
      characterId: this.characterId,
      character: this.character.display,
      xpToNext: (l) => safe(() => this.rules.xpToNext(l), 0),
      portal: this.portal,
      tell: this.tell,
      luck: this.luck,
      modLines: this.modLines,
      now,
      fps,
      pingMs: this.rttMs,
      keyLabels: this.keyLabels,
    });
    if (hud) hud.hoveredMonster = hoveredMonster(this.world.view.monsters, cursor, alpha);
    return hud;
  }

  // ---------------------------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------------------------

  /**
   * One 60 Hz input tick: sample → (autopilot | block | click-to-pick-up walk + auto-attack) → InputMessage →
   * local prediction and, when worth it, the wire. Returns the message (null outside a zone).
   */
  inputTick(sample: InputSample, cursor: Point, opts: TickOptions): InputMessage | null {
    const zone = this.zone;
    if (!zone) return null;
    const view = this.world.view;
    const s = this.sample;
    s.moveX = sample.moveX;
    s.moveY = sample.moveY;
    s.held = sample.held;
    s.flask = sample.flask;
    let aimX = cursor.x;
    let aimY = cursor.y;
    if (opts.bot) {
      this.walk.cancel('manual');
      const b = opts.bot.step(view, zone.localPlayerId, zone.kind);
      s.moveX = b.moveX;
      s.moveY = b.moveY;
      s.held = b.held;
      s.flask = b.flask;
      aimX = b.aimX;
      aimY = b.aimY;
      if (b.pickup >= 0) this.botPickup(b.pickup);
    } else if (opts.blocked) {
      this.walk.cancel('manual');
      s.moveX = 0;
      s.moveY = 0;
      s.held = 0;
      s.flask = -1;
    } else {
      if (this.walk.active) this.stepWalk(s);
      // Auto-attack only when no slot is held by hand (a held skill aims at the cursor).
      if (opts.autoAttack && this.autoAttackSlot >= 0 && s.held === 0 && this.autoAim(cursor, opts.alpha)) {
        s.held = 1 << this.autoAttackSlot;
        aimX = this.targetScratch.x;
        aimY = this.targetScratch.y;
      }
    }
    this.seq = (this.seq + 1) >>> 0;
    const msg = toInputMessage(this.seq, s, aimX, aimY);
    this.world.predict(msg);
    this.ticksSinceSend++;
    if (shouldSendInput(msg, this.lastSent, this.ticksSinceSend) && this.deps.send(msg)) {
      this.lastSent = msg;
      this.ticksSinceSend = 0;
    }
    return msg;
  }

  /**
   * Auto-attack: the monster nearest the cursor within reach of the player, led for the render delay and the bolt's
   * flight, written into targetScratch. False when there is nothing to shoot at.
   */
  private autoAim(cursor: Point, alpha: number): boolean {
    const zone = this.zone;
    if (!zone) return false;
    const view = this.world.view;
    const me = localPlayer(view, zone.localPlayerId);
    if (!me || me.dead) return false;
    const i = pickAutoTarget(view.monsters, alpha, me, cursor);
    if (i < 0) return false;
    // Lead the target: it is drawn in the past and the bolt needs time to get there.
    const delay = (this.world.interpDelayMs + this.rttMs) / 1000;
    leadAim(view.monsters, i, alpha, me, delay, this.basicProjectileSpeed, this.targetScratch);
    return true;
  }

  // ---------------------------------------------------------------------------------------------
  // Click to pick up (GAME_SPEC §12)
  // ---------------------------------------------------------------------------------------------

  /** The local player's feet as predicted (null while dead or not replicated yet). */
  private localFeet(): Point | null {
    const zone = this.zone;
    if (!zone) return null;
    const me = localPlayer(this.world.view, zone.localPlayerId);
    if (!me || me.dead) return null;
    return this.world.predictedPosition() ?? me;
  }

  /**
   * A left click on a ground item (Presenter.dropAt found it under the cursor). In reach: pick it up now. Out of
   * reach: walk there first (steering replaces the keyboard until the walk ends) and pick it up on arrival. Returns
   * true when the click was consumed (the item is in the replica), so the basic attack does not fire.
   */
  clickDrop(dropId: number): boolean {
    if (!this.zone) return false;
    const drop = findDrop(this.world.view.drops, dropId);
    if (!drop) return false;
    const me = this.localFeet();
    if (!me) return true; // dead: the click is still not an attack
    if (inPickupReach(me, drop)) {
      this.walk.cancel('manual');
      this.sendPickup(dropId);
    } else {
      this.walk.start(dropId);
    }
    return true;
  }

  /** A click that was not on an item (an attack, a portal, a hideout object) ends a walk to an item. */
  cancelWalk(): void {
    this.walk.cancel('manual');
  }

  private stepWalk(s: InputSample): void {
    const dropId = this.walk.dropId;
    const manual = s.moveX !== 0 || s.moveY !== 0;
    const r = this.walk.step(this.localFeet(), this.world.view.drops, manual, s);
    if (r === 'arrived') this.sendPickup(dropId);
  }

  /** Send a pickup click. Only the newest click's refusal is toasted ("Your inventory is full.", "That item is gone."). */
  sendPickup(dropId: number, quiet = false): void {
    const serial = ++this.pickupSerial;
    void this.command({ c: 'pickup', dropId }, { quiet: true, onOk: () => undefined }).then((r) => {
      if (this.disposed || r.ok || r.lost || quiet || serial !== this.pickupSerial) return;
      this.commandFailed(r.error ?? 'That item cannot be picked up.');
    });
  }

  private botPickup(dropId: number): void {
    const now = this.deps.now();
    if (dropId === this.botPickupId && now - this.botPickupAt < BOT_PICKUP_INTERVAL_MS) return;
    this.botPickupId = dropId;
    this.botPickupAt = now;
    this.sendPickup(dropId, true);
  }

  // ---------------------------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------------------------

  toast(text: string, tone: ToastTone = 'info'): void {
    this.box.update((s) => pushToast(s, { id: ++this.toastId, text, tone }));
  }

  private commandFailed(error: string): void {
    this.toast(error, 'bad');
    this.deps.sound('uiError');
  }

  /**
   * Send a command. `predict` (deterministic commands only) shows the local rules' result at once. On failure the
   * error is toasted with the error sound; on success `onOk` runs (default: toast the server's message, if any).
   */
  command(
    cmd: Command,
    opts: {
      predict?: (ch: CharacterSave) => Result<CharacterSave>;
      /** The prediction is on screen (feedback that belongs with the visual, e.g. its sound). */
      onPredicted?: (next: CharacterSave) => void;
      onOk?: (r: CommandResult) => void;
      quiet?: boolean;
    } = {},
  ): Promise<CommandResult> {
    let predicted = false;
    if (opts.predict) {
      const base = this.character.base;
      const r = base ? safe(() => opts.predict!(base), null) : null;
      if (r && !r.ok) {
        this.commandFailed(r.error);
        return Promise.resolve({ ok: false, error: r.error });
      }
      if (r && r.ok) {
        this.character.predict(r.value);
        predicted = true;
        this.applyCharacter();
        opts.onPredicted?.(r.value);
      }
    }
    const { id, result } = this.commands.issue(cmd, this.deps.now());
    if (!this.deps.send({ t: 'cmd', id, cmd })) {
      this.commands.settle(id, { ok: false, error: 'Not connected to the server.' });
    }
    return result.then((r) => {
      if (this.disposed) return r;
      if (predicted && this.character.resolved(r.ok, this.deps.now())) this.applyCharacter();
      if (!r.ok) {
        // A command lost with the connection stays quiet: the "Reconnecting" badge says it all, and the server
        // re-sends the full state (character, zone, party) when the link is back.
        if (!opts.quiet && !r.lost) this.commandFailed(r.error ?? 'That did not work.');
      } else if (opts.onOk) opts.onOk(r);
      else if (r.message && !opts.quiet) this.toast(r.message, 'info');
      return r;
    });
  }

  // --- items -----------------------------------------------------------------------------------

  /**
   * Move an item (drag and drop). `count` moves part of a stack: a split, or a withdrawal from a Crafting Stash slot
   * ("cstash:<id>"); without it the rules move the whole stack (a slot gives a full backpack stack). Checked with the
   * local rules first — an impossible move is refused here without a round trip — then shown at once. A move that
   * changes nothing (a slot dropped back on its own Crafting Stash page, a Map Stash map on the Map Stash) is done
   * here: true, nothing sent.
   */
  moveItem(uid: string, to: ItemLocation, count?: number): boolean {
    const ch = this.character.base;
    if (!ch) return false;
    if (!validMoveCount(count)) {
      this.commandFailed(BAD_COUNT_ERROR);
      return false;
    }
    const check = safe(() => this.rules.moveItem(ch, uid, to, count), { ok: false as const, error: 'That item cannot go there.' });
    if (!check.ok) {
      this.commandFailed(check.error);
      return false;
    }
    if (check.value === ch) return true;
    if (to.kind === 'equipment' || to.kind === 'belt') this.deps.sound('equip');
    const cmd: Command = count === undefined ? { c: 'moveItem', uid, to } : { c: 'moveItem', uid, to, count };
    void this.command(cmd, {
      predict: (base) => (base === ch ? check : this.rules.moveItem(base, uid, to, count)),
      quiet: false,
    });
    return true;
  }

  /**
   * Ctrl-click. With the stash open, maps/currency file into their dedicated tabs and gear uses the selected normal tab. The
   * Map Stash files a backpack map, either Crafting Stash tab files a backpack currency stack into its slot. A Map
   * Stash map or a Crafting Stash slot goes to the backpack; `count` (Shift+Ctrl-click: 1) withdraws that many from a
   * slot instead of a full stack. Without the stash: equip / unequip, load the belt, or the map device. A click the
   * rules answer with "nothing changes" sends nothing.
   */
  quickMove(uid: string, count?: number): void {
    if (!validMoveCount(count)) {
      this.commandFailed(BAD_COUNT_ERROR);
      return;
    }
    const stashTab = this.quickMoveTab();
    const cmd: Command = count === undefined ? { c: 'quickMove', uid, stashTab } : { c: 'quickMove', uid, stashTab, count };
    const ctx = count === undefined ? { stashTab } : { stashTab, count };
    const ch = this.character.base;
    const local = ch ? safe(() => this.rules.quickMove(ch, uid, ctx), null) : null;
    if (local?.ok && local.value === ch) return;
    void this.command(cmd, { predict: (base) => (base === ch && local ? local : this.rules.quickMove(base, uid, ctx)) });
  }

  /**
   * The stash tab a Ctrl-click files into: the open tab while the stash is the panel the player sees on the left
   * (only in a hideout), else none — never a tab hidden behind another left panel for the moment before the UI
   * closes it.
   */
  quickMoveTab(): UiState['stashTab'] | null {
    const s = this.state;
    return s.zone === 'hideout' && visibleLeftPanel(s.openPanels) === 'stash' ? s.stashTab : null;
  }

  /**
   * "Deposit all" on the Crafting Stash tabs: every currency stack in the backpack files into its slot. Shown at once
   * with its sound; the server's answer ("Stored N currency in the Crafting Stash." and what stayed behind) becomes
   * the toast — 'good' when the backpack is clear of currency, 'info' when some stayed (a full slot, a stack in the
   * trade offer).
   */
  depositAllCurrency(): void {
    if (this.state.zone !== 'hideout') {
      this.commandFailed(STASH_HIDEOUT_ERROR);
      return;
    }
    const sentWith = this.character.authoritative;
    let predicted: CharacterSave | null = null;
    void this.command({ c: 'depositAllCurrency' }, {
      predict: (base) => this.rules.depositAllCurrency(base),
      onPredicted: (next) => {
        predicted = next;
        this.deps.sound('pickupCurrency');
      },
      onOk: (r) => {
        if (!predicted) this.deps.sound('pickupCurrency');
        // The server's push (it comes before the answer) says what stayed; without it yet, the lock-aware
        // prediction does — the same rules the server ran.
        const server = this.character.authoritative;
        const after = server !== sentWith ? server : predicted;
        const left = !!after?.backpack.entries.some((e) => e.item.kind === 'currency');
        this.toast(r.message ?? 'Your currency is in the Crafting Stash.', left ? 'info' : 'good');
      },
    });
  }

  discardItem(uid: string): void {
    void this.command({ c: 'discardItem', uid }, { predict: (base) => this.rules.discardItem(base, uid) });
  }

  armCurrency(uid: string): void {
    const ch = this.character.display;
    const found = ch ? safe(() => this.rules.findItem(ch, uid), null) : null;
    if (!found || found.item.kind !== 'currency') return;
    if (!this.state.craftingAllowed) {
      this.toast('Crafting only works in a hideout.', 'bad');
      this.deps.sound('uiError');
      return;
    }
    const currencyId = found.item.currencyId;
    this.box.update((s) => ({ ...s, armed: { uid, currencyId }, affixChoice: null }));
    this.deps.sound('craftArm');
  }

  disarm(): void {
    this.box.update((s) => (s.armed || s.affixChoice ? { ...s, armed: null, affixChoice: null } : s));
  }

  applyArmed(targetUid: string): void {
    const s = this.state;
    const armed = s.armed;
    const ch = this.character.display;
    if (!armed || !ch) return;
    const err = safe(() => this.rules.craftingTargetError(ch, armed.uid, targetUid), 'That cannot be crafted.');
    if (err) {
      this.toast(err, 'bad');
      this.deps.sound('uiError');
      return;
    }
    const info = this.rules.content.currencies[armed.currencyId];
    if (info?.needsAffixChoice) {
      this.box.update((st) => ({ ...st, affixChoice: { currencyUid: armed.uid, targetUid, currencyId: armed.currencyId } }));
      return;
    }
    this.craft(armed.uid, targetUid);
  }

  chooseAffix(affixIndex: number): void {
    const c = this.state.affixChoice;
    if (!c) return;
    this.box.update((s) => ({ ...s, affixChoice: null }));
    this.craft(c.currencyUid, c.targetUid, affixIndex);
  }

  cancelAffixChoice(): void {
    this.box.update((s) => (s.affixChoice ? { ...s, affixChoice: null } : s));
  }

  /** applyCurrency: random, so never predicted. The toast and sound wait for the pushed item to tell the outcome. */
  private craft(currencyUid: string, targetUid: string, affixIndex?: number): void {
    const cmd: Command = affixIndex === undefined ? { c: 'applyCurrency', currencyUid, targetUid } : { c: 'applyCurrency', currencyUid, targetUid, affixIndex };
    this.craftCommand(cmd, targetUid);
  }

  /** A random craft (currency or bench recipe): the toast and sound wait for the pushed item to tell the outcome. */
  private craftCommand(cmd: Command, targetUid: string): void {
    const ch = this.character.authoritative;
    const before = ch ? safe(() => this.rules.findItem(ch, targetUid)?.item ?? null, null) : null;
    const entry: PendingCraft = { targetUid, before, sentWith: ch, message: null, deadline: Infinity };
    void this.command(cmd, {
      onOk: (r) => {
        entry.message = r.message ?? 'Crafted.';
        entry.deadline = this.deps.now() + CRAFT_ANALYSIS_MS;
        this.crafts.push(entry);
        this.analyzeCrafts();
      },
    });
  }

  /** Resolve finished crafts: compare the target before/after for the right sound and toast colour. */
  private analyzeCrafts(): void {
    if (!this.crafts.length) return;
    const now = this.deps.now();
    const ch = this.character.authoritative;
    const keep: PendingCraft[] = [];
    for (const c of this.crafts) {
      // The server pushes the character right before or shortly after the result: wait for a newer one.
      const answered = ch !== null && ch !== c.sentWith;
      if (!answered && now < c.deadline) {
        keep.push(c);
        continue;
      }
      const after = answered && ch ? safe(() => this.rules.findItem(ch, c.targetUid)?.item ?? null, null) : null;
      const { sound, tone } = craftFeedback(c.before, after);
      this.deps.sound(sound);
      this.toast(c.message ?? 'Crafted.', tone);
    }
    this.crafts = keep;
  }

  addStashTab(): void {
    void this.command({ c: 'addStashTab' }, { predict: (base) => this.rules.addStashTab(base) });
  }

  renameStashTab(tab: number, name: string): void {
    void this.command({ c: 'renameStashTab', tab, name }, { predict: (base) => this.rules.renameStashTab(base, tab, name) });
  }

  clearNewFlags(): void {
    void this.command({ c: 'clearNewFlags' }, { predict: (base) => ({ ok: true, value: this.rules.clearNewFlags(base) }), quiet: true });
  }

  /**
   * Drop an item on the floor at your feet (a public drop: anyone nearby may pick it up). Shown gone at once where
   * the server allows it (backpack, equipment, belt; the stash and the Map Stash in a hideout); the server's refusal
   * brings it back. A Crafting Stash slot is refused here (it is not an item).
   */
  dropItem(uid: string): void {
    const ch = this.character.display;
    const found = ch ? safe(() => this.rules.findItem(ch, uid), null) : null;
    if (!ch || !found) return;
    const zone = this.zone;
    const me = zone ? localPlayer(this.world.view, zone.localPlayerId) : null;
    if (me?.dead) {
      this.commandFailed("You can't drop items while you are dead.");
      return;
    }
    const where = found.location.kind;
    if (where === 'currencyStash') {
      // A Crafting Stash slot is not an item: the rules (and the server) say to take the currency out first.
      const r = safe(() => this.rules.discardItem(ch, uid), null);
      if (!r || !r.ok) {
        this.commandFailed(r && !r.ok ? r.error : 'Take currency out of the Crafting Stash first.');
        return;
      }
    }
    const inHideout = zone?.kind === 'hideout';
    const predictable =
      where === 'backpack' || where === 'equipment' || where === 'belt' || ((where === 'stash' || where === 'mapStash') && inHideout);
    void this.command({ c: 'dropItem', uid }, predictable ? { predict: (base) => this.rules.discardItem(base, uid) } : {});
  }

  // --- crafting bench ----------------------------------------------------------------------------

  private benchTarget(): string | null {
    const uid = this.state.benchItemUid;
    if (!uid) return null;
    if (!this.state.craftingAllowed) {
      this.commandFailed('The crafting bench works only in a hideout.');
      return null;
    }
    return uid;
  }

  /** Apply a bench recipe to the bench item (random value within the tier: never predicted). */
  benchCraft(recipeId: string): void {
    const uid = this.benchTarget();
    if (!uid) return;
    const ch = this.character.display;
    const recipe = ch ? safe(() => [...this.rules.benchRecipes(ch, uid), ...this.rules.benchServices(ch, uid)].find((r) => r.id === recipeId) ?? null, null) : null;
    if (recipe && !recipe.available) {
      this.commandFailed(recipe.reason ?? 'That recipe cannot be used on this item right now.');
      return;
    }
    const service = ch ? this.rules.benchServices(ch, uid).find(s => s.id === recipeId) : null;
    this.craftCommand({ c: 'benchCraft', targetUid: uid, recipeId,
      ...(service ? { expectedScrap: service.cost[0].count } : {}) }, uid);
  }

  /** Remove the bench item's crafted affix (free and deterministic: predicted). */
  benchClear(): void {
    const uid = this.benchTarget();
    if (!uid) return;
    void this.command({ c: 'benchClear', targetUid: uid }, {
      predict: (base) => {
        const r = this.rules.clearCraftedAffix(base, uid);
        return r.ok ? { ok: true, value: r.value.character } : r;
      },
      onOk: (r) => {
        this.deps.sound('craftApply');
        this.toast(r.message ?? 'The crafted affix was removed.', 'good');
      },
    });
  }

  // --- trading -----------------------------------------------------------------------------------

  tradeRequest(name: string): void {
    const n = name.trim().replace(/\s+/g, ' ');
    if (!n) return;
    // The server toasts "Trade request sent to …" (or "still pending") itself.
    void this.command({ c: 'tradeRequest', name: n }, { onOk: () => undefined });
  }

  tradeRespond(requestId: string, accept: boolean): void {
    this.tradeRequestTimes.delete(requestId);
    this.box.update((s) => removeTradeRequest(s, requestId));
    void this.command({ c: 'tradeRespond', requestId, accept }, { onOk: () => undefined });
  }

  /** Put the window back to the server's word after a refused optimistic change. */
  private restoreTrade(tradeId: string): void {
    const server = this.serverTrade;
    if (!server || server.tradeId !== tradeId || this.state.trade?.tradeId !== tradeId) return;
    this.box.update((s) => withTrade(s, server));
  }

  /**
   * Replace your offer (backpack uids, at most TRADE_MAX_ITEMS). Shown at once — both accepts cleared and accepting
   * locked, exactly as the server will answer — and confirmed by its 'trade' message; a refusal rolls back.
   */
  tradeOffer(uids: string[]): void {
    const trade = this.state.trade;
    if (!trade) return;
    const offer = [...new Set(uids)];
    const same = offer.length === trade.yourItems.length && offer.every((uid, i) => trade.yourItems[i]?.uid === uid);
    if (same) return;
    const ch = this.character.display;
    if (offer.length > TRADE_MAX_ITEMS) {
      this.commandFailed(`You can offer at most ${TRADE_MAX_ITEMS} items.`);
      return;
    }
    const error = ch ? safe(() => tradeOfferError(ch, offer), null) : null;
    if (error) {
      this.commandFailed(error);
      return;
    }
    const items = ch ? offer.map((uid) => safe(() => this.rules.findItem(ch, uid)?.item ?? null, null)) : [];
    if (items.length === offer.length && items.every((it): it is Item => !!it)) {
      const lockedUntil = this.serverNow() + TRADE_ACCEPT_LOCK_MS;
      this.box.update((s) =>
        s.trade?.tradeId === trade.tradeId
          ? withTrade(s, { ...s.trade, yourItems: items, youAccepted: false, theyAccepted: false, acceptLockedUntil: Math.max(s.trade.acceptLockedUntil, lockedUntil) })
          : s,
      );
    }
    void this.command({ c: 'tradeOffer', tradeId: trade.tradeId, uids: offer }, { onOk: () => undefined }).then((r) => {
      if (!r.ok) this.restoreTrade(trade.tradeId);
    });
  }

  tradeAccept(accept: boolean): void {
    const trade = this.state.trade;
    if (!trade || trade.youAccepted === accept) return;
    this.box.update((s) => (s.trade?.tradeId === trade.tradeId ? withTrade(s, { ...s.trade, youAccepted: accept }) : s));
    void this.command({ c: 'tradeAccept', tradeId: trade.tradeId, accept }, { onOk: () => undefined }).then((r) => {
      if (!r.ok) this.restoreTrade(trade.tradeId);
    });
  }

  /** Close the trade for both sides. The window goes at once; the server confirms with the result text. */
  tradeCancel(): void {
    const trade = this.state.trade;
    if (!trade) return;
    this.cancelledTradeId = trade.tradeId;
    this.box.update((s) => withTrade(s, null));
    void this.command({ c: 'tradeCancel', tradeId: trade.tradeId }, { quiet: true, onOk: () => undefined }).then((r) => {
      if (r.ok || r.lost || this.disposed) return;
      // Still open on the server (the refusal says why): show it again rather than hide a trade that locks items.
      if (this.serverTrade?.tradeId === trade.tradeId) {
        this.cancelledTradeId = null;
        this.box.update((s) => withTrade(s, this.serverTrade));
        this.commandFailed(r.error ?? 'The trade could not be cancelled.');
      }
    });
  }

  // --- character ---------------------------------------------------------------------------------

  allocateAttribute(attr: 'str' | 'dex' | 'int'): void {
    void this.command({ c: 'allocateAttribute', attr }, { predict: (base) => this.rules.allocateAttribute(base, attr) });
  }

  rankUpSkill(skillId: SkillId): void {
    void this.command({ c: 'rankUpSkill', skillId }, { predict: (base) => this.rules.rankUpSkill(base, skillId) });
  }

  setLoadoutSlot(slot: number, skillId: SkillId | null): void {
    void this.command({ c: 'setLoadoutSlot', slot, skillId }, { predict: (base) => this.rules.setLoadoutSlot(base, slot, skillId) });
  }

  // --- hideout -----------------------------------------------------------------------------------

  activateMapDevice(areaId?: import('../contracts/atlas').AtlasAreaId): void {
    void this.command({ c: 'activateMapDevice', ...(areaId ? { areaId } : {}) }, {
      onOk: (r) => {
        if (r.message) this.toast(r.message, 'good');
        this.box.update((s) => closePanel(s, 'mapDevice'));
      },
    });
  }

  merchantOffers(): MerchantOffer[] {
    const ch = this.character.display;
    return ch ? safe(() => this.rules.merchantOffers(ch), []) : [];
  }

  buyOffer(offerId: string): void {
    void this.command({ c: 'buyOffer', offerId }, {
      onOk: (r) => {
        this.deps.sound('buy');
        this.toast(r.message ?? 'Bought.', 'good');
      },
    });
  }

  // --- party & social ----------------------------------------------------------------------------

  partyInvite(name: string): void {
    void this.command({ c: 'partyInvite', name }, { onOk: (r) => this.toast(r.message ?? `Invited ${name}.`, 'info') });
  }

  partyRespond(inviteId: string, accept: boolean): void {
    this.inviteTimes.delete(inviteId);
    this.box.update((s) => removeInvite(s, inviteId));
    void this.command({ c: 'partyRespond', inviteId, accept }, { onOk: (r) => r.message && this.toast(r.message, 'good') });
  }

  partyLeave(): void {
    void this.command({ c: 'partyLeave' }, { onOk: () => this.toast('You left the party.', 'info') });
  }

  partyKick(characterId: string): void {
    void this.command({ c: 'partyKick', characterId });
  }

  partyPromote(characterId: string): void {
    void this.command({ c: 'partyPromote', characterId });
  }

  visitHideout(characterId: string): void {
    void this.command({ c: 'visitHideout', characterId });
  }

  goHome(): void {
    if (this.characterId) this.visitHideout(this.characterId);
  }

  sendChat(text: string, channel: import('../contracts/net').ChatChannel = 'global'): void {
    const t = text.trim();
    if (!t) return;
    void this.command({ c: 'chat', text: t, channel }, { onOk: () => undefined });
  }

  // --- portals & map ----------------------------------------------------------------------------

  /** Use an open portal prop: a hideout's map portal (enter the owner's map, costs a portal) or a return portal. */
  usePortal(propId: number): void {
    void this.command({ c: 'usePortal', propId });
  }

  leaveMap(): void {
    void this.command({ c: 'leaveMap' });
  }

  respawn(): void {
    void this.command({ c: 'respawn' });
  }
}

/** Sound and toast colour for a finished craft, from the target item before and after. */
export function craftFeedback(before: Item | null, after: Item | null): { sound: SfxId; tone: ToastTone } {
  if (!before || !after) return { sound: 'craftApply', tone: 'good' };
  if (before.kind === 'equipment' && after.kind === 'equipment') {
    if (after.scars.length > before.scars.length) return { sound: 'craftScar', tone: 'bad' };
    if (after.stability === 0 && before.stability > 0) return { sound: 'craftFinish', tone: 'rare' };
    if (after.rarity === 'rare' && before.rarity !== 'rare') return { sound: 'craftRare', tone: 'rare' };
    return { sound: 'craftApply', tone: 'good' };
  }
  if (before.kind === 'map' && after.kind === 'map') {
    if (after.corrupted && !before.corrupted) return { sound: 'craftCorrupt', tone: 'unique' };
    if (after.rarity === 'rare' && before.rarity !== 'rare') return { sound: 'craftRare', tone: 'rare' };
  }
  return { sound: 'craftApply', tone: 'good' };
}
