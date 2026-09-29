// Client-side prediction of the local player's movement with server reconciliation.
//
//  • predict(): every 60 Hz input tick is recorded (seq, move, held slots) and applied at once with the shared sim
//    `movePlayer`, so the local player reacts with zero latency.
//  • reconcile(): on each newer snapshot, inputs up to its ackSeq are dropped, the authoritative position is taken
//    as the new base and the still-unacked inputs are replayed on top of it. With identical inputs this lands on
//    the exact position the server will compute; what the client cannot know (crowd slow, knockback, shoves)
//    shows up as a small difference.
//  • The cast slow (timed actives move at 70 %) is predicted per input tick by CastModel, which replays the sim's
//    casting rules from the snapshot's cast/slot state: a held, usable timed skill starts a cast on that very tick,
//    a cast ends after its (learned) cast time, and back-to-back casts chain with the sim's carry. So spam-casting
//    while kiting predicts exactly instead of wobbling between full and slowed speed.
//  • That difference never pops: it becomes a visual offset that decays at CORRECTION_RATE (~10/s). Errors above
//    SNAP_DISTANCE, a fresh dash/teleport, death and respawn snap immediately.
//  • The base move speed is not part of the WorldView; it is recovered from the authoritative velocity of the
//    acked input (vx/vy = dir · speed · (1 − slow)), keeping the recent maximum so a horde's crowd slow (sim-only)
//    does not drag the estimate down. A hint from the rules (setHints) seeds it before the first moving snapshot.
//  • Cast times are not in the WorldView either: they are learned from two consecutive snapshots of the same cast
//    (total = Δticks·SIM_DT / Δprogress) or given as hints from the rules (SkillRuntimeDef.castTime).
//  • Player debuffs (GAME_SPEC §13) come from the viewer's record and run forward per replayed/predicted input tick
//    exactly as the sim runs them (DebuffClock): Rooted and Frozen hold her (Frozen also holds her cast and starts
//    none), Chilled moves and casts at 1 − PLAYER_CHILL_SLOW, a tar pool of the newest snapshot slows her while her
//    feet are in it, and the slow passed to movePlayer is the sim's own playerSlow(cast, debuff, ground). Timers run
//    down after the move, twice as fast under Cinder Ward. A root that lands while inputs are in flight shows up as a
//    correction that slides her back to where it caught her. Samples taken under any of these (or right after one
//    ended) never feed the learned base speed or cast times, so a sim detail that differs costs a small blended
//    correction, never a skewed estimate.
//  • A chain hook's drag (the sim's pullPlayer): once her 'pull' event arrives (notePull, right after the snapshot of
//    its tick), its start tick is matched against the authoritative record and the drag replaces her own movement for
//    its PULL_STEPS ticks exactly as the sim lerps it (resolvePlayerAt of from→to at 1 − pullTime / pullTotal). The
//    hook itself cannot be foreseen, so each pull costs one blended correction instead of one per snapshot.
import type { SkillId } from '../contracts/content';
import { LOADOUT_SLOTS } from '../contracts/items';
import type { InputMessage } from '../contracts/net';
import { SIM_DT, SIM_HZ } from '../contracts/sim';
import type { AreaView, PlayerAnim, PlayerDebuffView, PropView } from '../contracts/sim';
// The movement module alone (not '../sim'): keeps the rest of the simulation out of the client bundle. It is where
// the sim keeps every rule a predicting client must share (movePlayer, the cast / debuff / ground slows, the chill).
import {
  CAST_SLOW, PLAYER_CHILL_SLOW, areaSlowAt, debuffMoveSlow, movePlayer, playerSlow, predictionSlow, resolvePlayerAt,
} from '../sim/movement';
// Plain numbers of the sim (a leaf module the movement rules import too): shared, never copied.
import { PULL_TIME, WARD_DEBUFF_RATE } from '../sim/constants';
import { TICK_MS } from './clock';
import { moveVector } from './input';
import type { MoveVector } from './input';
import type { PlayerRecord } from './snapshot';

const INPUT_RING = 512;
export const SNAP_DISTANCE = 64;
export const CORRECTION_RATE = 10;
/** GAME_SPEC §3 base move speed, used until the first moving snapshot (or a hint) reveals the real one. */
export const DEFAULT_MOVE_SPEED = 110;
const SPEED_SAMPLES = 32;
/** Speed samples older than this (server ticks) no longer count toward the max. */
const SPEED_WINDOW_TICKS = 90;
const MOVING_EPS = 0.05;
/** Plausible cast-time range for learned values (s). */
const MIN_CAST_TIME = SIM_DT;
const MAX_CAST_TIME = 10;
/** Two progress samples at most this many ticks apart are compared to learn a cast time. */
const CAST_LEARN_MAX_TICKS = 8;

/** Chilled (GAME_SPEC §13): the sim's PLAYER_CHILL_SLOW as a speed factor, for moving and for casting. */
export const CHILL_MOVE_FACTOR = 1 - PLAYER_CHILL_SLOW;
export const CHILL_CAST_FACTOR = 1 - PLAYER_CHILL_SLOW;
/** WARD_DEBUFF_RATE: while Cinder Ward is up, debuff timers run this many times as fast (durations halved). */
export { PULL_TIME, WARD_DEBUFF_RATE };
/** Speed samples this close to a tar pool's rim (units) are not trusted for the base-speed estimate. */
const TAR_LEARN_MARGIN = 6;

/** The sim's drag (player.ts): pullTotal = max(DT, PULL_TIME), pullTime −= DT per tick, u = 1 − pullTime / total. */
const PULL_TOTAL = Math.max(SIM_DT, PULL_TIME);
/** Lerp fraction after each drag step (index 0 = the hit tick itself, where she still stands at `from`). */
const PULL_U: readonly number[] = (() => {
  const u = [0];
  let t = PULL_TOTAL;
  while (t > 0) {
    t = Math.max(0, t - SIM_DT);
    u.push(PULL_TOTAL > 0 ? 1 - t / PULL_TOTAL : 1);
  }
  return u;
})();
/** Ticks a drag replaces her own movement (16 for 0.25 s: the float timer outlives 15 steps by a hair). */
export const PULL_STEPS = PULL_U.length - 1;
/** A record farther than this from the drag line (units) is not being dragged (blinked out, shoved, re-hooked). */
const PULL_MATCH_DIST = 4;

export interface PredictionEnv {
  arenaRadius: number;
  props: readonly PropView[];
  /**
   * The newest snapshot's areas (tar pools slow her: the sim's areaSlowAt at her feet before each step). Only
   * kind/x/y/radius are read.
   */
  areas: Pick<AreaView, 'kind' | 'x' | 'y' | 'radius'>[];
}

export function createPredictionEnv(props: readonly PropView[]): PredictionEnv {
  return { arenaRadius: 0, props, areas: [] };
}

/** True when (x, y) is inside a tar pool of `areas`, its rim widened by `margin`. */
function nearTar(areas: readonly Pick<AreaView, 'kind' | 'x' | 'y' | 'radius'>[], x: number, y: number, margin: number): boolean {
  for (let k = 0; k < areas.length; k++) {
    const a = areas[k];
    if (a.kind !== 'tarPool') continue;
    const r = a.radius + margin;
    if ((x - a.x) * (x - a.x) + (y - a.y) * (y - a.y) <= r * r) return true;
  }
  return false;
}

/**
 * A debuff timer from its millisecond wire value, rebuilt to the sim's exact double where possible: the sim sets it to
 * `duration` and subtracts SIM_DT (× WARD_DEBUFF_RATE under the ward) once per tick, and expires it at `≤ 0`. When the
 * wire value is consistent with k whole ticks run off `duration` (tick-aligned durations like the root's 1.4 s), the
 * same k subtractions are replayed, so an expiry that falls exactly on a tick boundary is decided like the sim does.
 */
export function debuffTimerAt(remainingMs: number, duration: number): number {
  if (!(remainingMs > 0) || !(duration > 0)) return remainingMs > 0 ? remainingMs : 0;
  const k = Math.round((duration - remainingMs) / SIM_DT);
  if (k >= 0 && k <= duration * SIM_HZ + 1 && Math.abs(duration - k * SIM_DT - remainingMs) <= 0.0005 + 1e-9) {
    let t = duration;
    for (let j = 0; j < k; j++) t -= SIM_DT;
    return t > 0 ? t : remainingMs;
  }
  return remainingMs;
}

/** Index of the movement-relevant debuffs in DebuffClock.timers. */
const ROOTED = 0;
const FROZEN = 1;
const CHILLED = 2;
const TRACKED: readonly PlayerDebuffView['id'][] = ['rooted', 'frozen', 'chilled'];

/**
 * The debuffs that change how she moves and casts, run forward tick by tick from the latest authoritative record the
 * way the sim runs them: a tick's casting and movement see the timers as they were after the previous tick, then the
 * ward and the timers run down (debuffs tick after the move; ×WARD_DEBUFF_RATE while Cinder Ward is up).
 */
export class DebuffClock {
  /** Seconds left of rooted / frozen / chilled (≤ 0 = inactive). */
  readonly timers = new Float64Array(TRACKED.length);
  /** Cinder Ward seconds left. */
  ward = 0;
  /** Debuff time run off since the record (Σ per-tick steps): every other debuff's timer is `remaining − elapsed`. */
  elapsed = 0;

  load(debuffs: readonly PlayerDebuffView[] | undefined, wardTime: number): void {
    this.timers.fill(0);
    this.ward = wardTime > 0 ? wardTime : 0;
    this.elapsed = 0;
    if (!debuffs) return;
    for (let k = 0; k < debuffs.length; k++) {
      const d = debuffs[k];
      const i = TRACKED.indexOf(d.id);
      if (i >= 0) this.timers[i] = Math.max(this.timers[i], debuffTimerAt(d.remaining, d.duration));
    }
  }

  get rooted(): boolean {
    return this.timers[ROOTED] > 0;
  }
  get frozen(): boolean {
    return this.timers[FROZEN] > 0;
  }
  get chilled(): boolean {
    return this.timers[CHILLED] > 0;
  }
  /** Any movement debuff left (the speed estimate only learns from records without one). */
  get any(): boolean {
    return this.rooted || this.frozen || this.chilled;
  }

  /** The ward's own countdown comes first in the sim's tick (before casting and movement). */
  beginTick(): void {
    if (this.ward > 0) {
      this.ward -= SIM_DT;
      if (this.ward <= 0) this.ward = 0;
    }
  }

  /** After the move: every running timer loses one step. */
  endTick(): void {
    const step = SIM_DT * (this.ward > 0 ? WARD_DEBUFF_RATE : 1);
    const t = this.timers;
    for (let k = 0; k < t.length; k++) {
      if (t[k] <= 0) continue;
      t[k] -= step;
      if (t[k] <= 0) t[k] = 0;
    }
    this.elapsed += step;
  }

  /** Copy the timers and the ward into `buf` (DEBUFF_STATE_SIZE numbers). */
  save(buf: Float64Array): void {
    buf.set(this.timers);
    buf[TRACKED.length] = this.ward;
  }

  /** Back to a saved state (elapsed counts from there again). */
  restore(buf: Float64Array): void {
    for (let k = 0; k < TRACKED.length; k++) this.timers[k] = buf[k];
    this.ward = buf[TRACKED.length];
    this.elapsed = 0;
  }

  /** Seconds left of a record's debuff at her predicted present (0 = run out). */
  left(d: PlayerDebuffView): number {
    const i = TRACKED.indexOf(d.id);
    if (i >= 0) return this.timers[i];
    const r = d.remaining - this.elapsed;
    return r > 0 ? r : 0;
  }
}

const DEBUFF_STATE_SIZE = TRACKED.length + 1;

/** Optional exact numbers from the shared rules (rules.playerRuntime): base speed and per-skill cast times. */
export interface PredictionHints {
  moveSpeed?: number;
  /** Seconds after cast speed; 0 = instant. Skills not listed are learned from snapshots. */
  castTimes?: Partial<Record<SkillId, number>>;
}

/** Progress travels as a u16 fraction: its resolution in cast time is total / 65535. */
const PROGRESS_STEPS = 65535;

/**
 * Elapsed time of a running cast from its (quantised) progress, reproducing the sim's float arithmetic where it
 * matters. The sim accumulates `time += SIM_DT` per tick from the start carry (0 for a cast that did not chain off
 * another), and releases at `time >= total` — so a cast time that is a whole number of ticks (0.45 s = 27 ticks)
 * is decided by float rounding (27 accumulated ticks are 0.44999999999999996 < 0.45: it releases on tick 28).
 * When the progress is consistent with a carry-free start, the exact accumulated value is rebuilt.
 */
export function castTimeAt(progress: number, total: number): number {
  const approx = progress * total;
  const n = Math.round(approx / SIM_DT);
  if (n >= 0 && n <= MAX_CAST_TIME * SIM_HZ && Math.abs(approx - n * SIM_DT) <= total / PROGRESS_STEPS + 1e-9) {
    let t = 0;
    for (let k = 0; k < n; k++) t += SIM_DT;
    return t;
  }
  return approx;
}

/**
 * A charge timer from its millisecond wire value. The sim sets it to the cooldown when a charge is spent and
 * decrements it by SIM_DT per tick, regaining the charge at `timer <= 0`; when the value is consistent with such a
 * countdown, the exact accumulated float is rebuilt (a 1.2 s cooldown ends on a tick boundary, decided by rounding).
 */
export function chargeTimerAt(timerMs: number, cooldown: number): number {
  if (!(timerMs > 0) || !(cooldown > 0)) return timerMs;
  const k = Math.round((cooldown - timerMs) / SIM_DT);
  if (k >= 0 && k <= cooldown * SIM_HZ + 1 && Math.abs(cooldown - k * SIM_DT - timerMs) <= 0.0005 + 1e-9) {
    let t = cooldown;
    for (let j = 0; j < k; j++) t -= SIM_DT;
    return t;
  }
  return timerMs;
}

/**
 * A learned cast time within measurement error of a whole number of ticks is taken to be exactly that (base cast
 * times like 0.3 / 0.45 / 0.5 s are): k / SIM_HZ is the same double as the literal the rules use.
 */
function snapCastTime(total: number): number {
  const k = Math.round(total / SIM_DT);
  return k > 0 && Math.abs(total - k * SIM_DT) < 1e-4 ? k / SIM_HZ : total;
}

const castProbe: { castSkill: SkillId | null; slots: PlayerRecord['slots'] } = { castSkill: null, slots: [] };

/**
 * The cast part of the movement slow of a record (the shared sim rule, predictionSlow). Called with the cast state
 * alone: the debuff and ground slows are combined per predicted tick (DebuffClock, playerSlow), never twice.
 */
export function castSlowOf(rec: Pick<PlayerRecord, 'castSkill' | 'slots'>): number {
  castProbe.castSkill = rec.castSkill;
  castProbe.slots = rec.slots;
  return predictionSlow(castProbe);
}

/** Dynamic CastModel state saved per predicted input: cast slot, time, total, then charges and timers per slot. */
const CAST_STATE_SIZE = 3 + 2 * LOADOUT_SLOTS;

/**
 * The sim's casting rules, as far as they decide the movement slow: one timed cast at a time (any active may cut the
 * basic attack short; only actives slow), held skills start as soon as usable (a charge and the focus), charges come
 * back on the skill's cooldown, a cast releases at `time >= total` and its overshoot carries into a back-to-back
 * cast. Instant skills (cast time 0) and skills whose cast time is still unknown never start a modelled cast, and focus
 * regeneration is not modelled (a focus-starved caster's first cast may be corrected once).
 *
 * The float arithmetic mirrors the sim's operation for operation, so cast ends and charge returns that fall exactly
 * on a tick boundary are decided the same way. The exact state per input is saved (save/restore); when a snapshot
 * agrees with the saved state within wire quantisation, prediction continues from the exact value.
 */
export class CastModel {
  castSlot = -1;
  private basicSlot = -1;
  time = 0;
  total = 0;
  focus = 0;
  alive = false;
  readonly castTime = new Float64Array(LOADOUT_SLOTS);
  readonly charges = new Float64Array(LOADOUT_SLOTS);
  readonly maxCharges = new Float64Array(LOADOUT_SLOTS);
  readonly timer = new Float64Array(LOADOUT_SLOTS);
  readonly cooldown = new Float64Array(LOADOUT_SLOTS);
  readonly cost = new Float64Array(LOADOUT_SLOTS);

  /** Static per-slot parameters (cast times, cooldowns, costs) and focus from the viewer's record. */
  private loadParams(rec: PlayerRecord, castTimes: ReadonlyMap<SkillId, number>): void {
    this.alive = !rec.dead;
    this.focus = rec.focus;
    const n = Math.min(rec.slots.length, LOADOUT_SLOTS);
    this.basicSlot = -1;
    for (let s = 0; s < LOADOUT_SLOTS; s++) {
      const sv = s < n ? rec.slots[s] : null;
      const id = sv ? sv.skillId : null;
      if (id === 'emberLance') this.basicSlot = s;
      this.castTime[s] = id === null ? -1 : castTimes.get(id) ?? -1;
      this.maxCharges[s] = sv ? sv.maxCharges : 0;
      this.cooldown[s] = sv ? sv.cooldownTotal : 0;
      this.cost[s] = sv ? Math.max(0, sv.focusCost) : 0;
    }
  }

  /** Loadout slot of the record's running cast, -1 for none, -2 for a skill not in the loadout. */
  private static castSlotOf(rec: PlayerRecord): number {
    if (rec.castSkill === null) return -1;
    const n = Math.min(rec.slots.length, LOADOUT_SLOTS);
    for (let s = 0; s < n; s++) if (rec.slots[s].skillId === rec.castSkill) return s;
    return -2;
  }

  /** Reset to the authoritative state of `rec` (the viewer's full record) after its tick. */
  load(rec: PlayerRecord, castTimes: ReadonlyMap<SkillId, number>): void {
    this.loadParams(rec, castTimes);
    const n = Math.min(rec.slots.length, LOADOUT_SLOTS);
    for (let s = 0; s < LOADOUT_SLOTS; s++) {
      const sv = s < n ? rec.slots[s] : null;
      this.charges[s] = sv ? sv.charges : 0;
      this.timer[s] = sv ? chargeTimerAt(sv.cooldown, sv.cooldownTotal) : 0;
    }
    this.castSlot = -1;
    this.time = 0;
    this.total = 0;
    const slot = CastModel.castSlotOf(rec);
    if (slot === -1) return;
    const slowed = castSlowOf(rec) > 0;
    const total = rec.castSkill !== null ? castTimes.get(rec.castSkill) ?? 0 : 0;
    if (total > 0) {
      this.castSlot = slot >= 0 ? slot : LOADOUT_SLOTS;
      this.total = total;
      this.time = castTimeAt(rec.castProgress, total);
    } else if (slowed) {
      // First sight of this active: its end is unknown, keep slowing until a snapshot says otherwise.
      this.castSlot = slot >= 0 ? slot : LOADOUT_SLOTS;
      this.total = Infinity;
    }
    // (An unknown basic-attack cast is ignored: it neither slows nor blocks an active.)
  }

  /** Save the dynamic state into `buf` at `at` (CAST_STATE_SIZE numbers). */
  save(buf: Float64Array, at: number): void {
    buf[at] = this.castSlot;
    buf[at + 1] = this.time;
    buf[at + 2] = this.total;
    for (let s = 0; s < LOADOUT_SLOTS; s++) {
      buf[at + 3 + s] = this.charges[s];
      buf[at + 3 + LOADOUT_SLOTS + s] = this.timer[s];
    }
  }

  /** Back to a state saved by `save` (the static parameters stay as loaded), with `focus` left. */
  restoreState(buf: Float64Array, at: number, focus: number): void {
    this.castSlot = buf[at];
    this.time = buf[at + 1];
    this.total = buf[at + 2];
    for (let s = 0; s < LOADOUT_SLOTS; s++) {
      this.charges[s] = buf[at + 3 + s];
      this.timer[s] = buf[at + 3 + LOADOUT_SLOTS + s];
    }
    this.focus = focus;
  }

  /**
   * Continue from a saved state if it matches the record within wire quantisation (cast slot and progress, charges,
   * millisecond timers); otherwise load from the record. Returns true when the saved state was kept.
   */
  restore(buf: Float64Array, at: number, rec: PlayerRecord, castTimes: ReadonlyMap<SkillId, number>): boolean {
    const slot = buf[at];
    const time = buf[at + 1];
    const total = buf[at + 2];
    let ok = !rec.dead && CastModel.castSlotOf(rec) === slot;
    if (ok && slot >= 0) {
      ok = total > 0 && total < Infinity && Math.abs(time - rec.castProgress * total) <= (1.5 * total) / PROGRESS_STEPS + 1e-7;
    }
    const n = Math.min(rec.slots.length, LOADOUT_SLOTS);
    for (let s = 0; ok && s < n; s++) {
      const sv = rec.slots[s];
      const timer = buf[at + 3 + LOADOUT_SLOTS + s];
      ok = buf[at + 3 + s] === sv.charges && Math.abs(Math.max(0, timer) - sv.cooldown) <= 0.0006;
    }
    if (!ok) {
      this.load(rec, castTimes);
      return false;
    }
    this.loadParams(rec, castTimes);
    this.castSlot = slot;
    this.time = time;
    this.total = total;
    for (let s = 0; s < LOADOUT_SLOTS; s++) {
      this.charges[s] = buf[at + 3 + s];
      this.timer[s] = buf[at + 3 + LOADOUT_SLOTS + s];
    }
    return true;
  }

  /**
   * One sim tick with the held mask of its input; returns the cast `slow` of that tick's movement. `castRate` scales
   * cast progress (Chilled); `canAct` false (Frozen) holds a running cast and starts none.
   */
  step(held: number, castRate = 1, canAct = true): number {
    if (!this.alive) return 0;
    // Charges regenerate first (the sim's tickCharges).
    for (let s = 0; s < LOADOUT_SLOTS; s++) {
      const max = this.maxCharges[s];
      if (this.cooldown[s] <= 0) {
        this.charges[s] = max;
        this.timer[s] = 0;
      } else if (this.charges[s] >= max) {
        this.timer[s] = 0;
      } else {
        this.timer[s] -= SIM_DT;
        if (this.timer[s] <= 0) {
          this.charges[s]++;
          this.timer[s] = this.charges[s] < max ? this.timer[s] + this.cooldown[s] : 0;
        }
      }
    }
    // The running cast advances and may release (its overshoot carries into a back-to-back cast).
    let carry = 0;
    if (!canAct) return this.castSlot >= 0 && this.castSlot !== this.basicSlot ? CAST_SLOW : 0;
    if (this.castSlot >= 0) {
      this.time += castRate === 1 ? SIM_DT : SIM_DT * castRate;
      if (this.time >= this.total) {
        carry = Math.min(SIM_DT, this.time - this.total);
        this.castSlot = -1;
      }
    }
    // Held timed skills start as soon as usable.
    if (held !== 0) {
      for (let o = 0; o <= LOADOUT_SLOTS; o++) {
        const s = o === LOADOUT_SLOTS ? this.basicSlot : o;
        if (s < 0 || (o < LOADOUT_SLOTS && s === this.basicSlot)) continue;
        if ((held & (1 << s)) === 0) continue;
        const ct = this.castTime[s];
        if (!(ct > 0)) continue;
        if (this.castSlot >= 0 && !(this.castSlot === this.basicSlot && s !== this.basicSlot)) continue;
        if (this.charges[s] < 1 || this.focus + 1e-9 < this.cost[s]) continue;
        this.focus -= this.cost[s];
        if (this.cooldown[s] > 0) {
          this.charges[s]--;
          if (this.timer[s] <= 0) this.timer[s] = this.cooldown[s];
        }
        this.castSlot = s;
        this.time = carry;
        this.total = ct;
      }
    }
    return this.castSlot >= 0 && this.castSlot !== this.basicSlot ? CAST_SLOW : 0;
  }
}

export class LocalPredictor {
  // Unacked inputs (ring buffer, oldest first).
  private readonly seqs = new Float64Array(INPUT_RING);
  private readonly moveXs = new Float32Array(INPUT_RING);
  private readonly moveYs = new Float32Array(INPUT_RING);
  private readonly helds = new Uint8Array(INPUT_RING);
  /** CastModel state after each input (valid when castSaved[i] = 1). */
  private readonly castStates = new Float64Array(INPUT_RING * CAST_STATE_SIZE);
  private readonly castSaved = new Uint8Array(INPUT_RING);
  private head = 0;
  private count = 0;

  // Speed estimate samples (server tick, base speed).
  private readonly speedTick = new Float64Array(SPEED_SAMPLES);
  private readonly speedValue = new Float32Array(SPEED_SAMPLES);
  private speedHead = 0;
  private speedCount = 0;
  private hintSpeed = 0;
  /** The previous authoritative record moved under a debuff or near tar (its successor's velocity may still carry it). */
  private prevDirty = false;

  /** Cast times per skill (s): learned from snapshots, or hinted by the rules. */
  readonly castTimes = new Map<SkillId, number>();
  private readonly cast = new CastModel();
  /** Movement debuffs run forward from the latest authoritative record, and the input ticks predicted since. */
  readonly debuffs = new DebuffClock();
  private sinceAuth = 0;
  private lastCastSkill: SkillId | null = null;
  private lastCastProgress = 0;
  private lastCastTick = -1;

  // The replay base: the latest authoritative record after its tick (position, cast and debuff state), kept so a
  // late piece of knowledge (a hook's 'pull') can re-run the unacked inputs without waiting for the next snapshot.
  private baseTick = -1;
  private baseX = 0;
  private baseY = 0;
  private baseSlow = 0;
  private baseFocus = 0;
  private readonly baseCast = new Float64Array(CAST_STATE_SIZE);
  private readonly baseDebuffs = new Float64Array(DEBUFF_STATE_SIZE);

  // A chain hook's drag (the sim's pullPlayer), from her 'pull' event.
  private pullActive = false;
  private pullFromX = 0;
  private pullFromY = 0;
  private pullToX = 0;
  private pullToY = 0;
  /** Server tick of the hit (the drag moves her on the PULL_STEPS ticks after it); -1 until matched to a record. */
  private pullStart = -1;
  /** Tick of the events batch the pull came with: the hit happened on or before it. */
  private pullBatchTick = 0;

  /** True once an authoritative position is known. */
  hasBase = false;
  /** Predicted position after the latest input, and one input earlier (for sub-tick render smoothing). */
  x = 0;
  y = 0;
  prevX = 0;
  prevY = 0;
  /** Visual correction offset (decays to 0). */
  errX = 0;
  errY = 0;
  /** Base move speed estimate (units/s) and the predicted slow of the latest input tick (1 while held or dragged). */
  moveSpeed = DEFAULT_MOVE_SPEED;
  slow = 0;
  dead = false;

  /** Latest input (movement drives the local run/idle anim and facing; aim drives cast facing). */
  hasInput = false;
  inputMoveX = 0;
  inputMoveY = 0;
  inputAimX = 0;
  inputAimY = 0;

  /** Diagnostics. */
  corrections = 0;
  snaps = 0;
  lastError = 0;
  /** Drags replayed from a 'pull' event (matched to a record). */
  pulls = 0;

  private authTick = -1;
  private authX = 0;
  private authY = 0;
  private authAnim: PlayerAnim = 'idle';
  private authAnimTime = 0;
  private authDead = false;

  // Sub-tick render phase: estimated client time of the latest predicted input tick.
  private ticksSinceFrame = 0;
  private tickTime = Number.NaN;
  private lastFrameNow = Number.NaN;
  private frac = 1;

  // Scratch objects for movePlayer calls (the sim returns a fresh result object).
  private readonly dir: MoveVector = { x: 0, y: 0, len: 0 };
  private readonly state = { x: 0, y: 0 };
  private readonly move = { moveX: 0, moveY: 0 };
  private readonly params: { speed: number; arenaRadius: number; props: readonly PropView[]; slow: number } = {
    speed: DEFAULT_MOVE_SPEED, arenaRadius: 0, props: [], slow: 0,
  };

  /** Zone change: forget the inputs and the authoritative state (learned speed and cast times are kept). */
  reset(): void {
    this.head = 0;
    this.count = 0;
    this.speedHead = 0;
    this.speedCount = 0;
    this.prevDirty = false;
    this.hasBase = false;
    this.x = this.y = this.prevX = this.prevY = 0;
    this.errX = this.errY = 0;
    this.slow = 0;
    this.dead = false;
    this.hasInput = false;
    this.cast.alive = false;
    this.cast.castSlot = -1;
    this.debuffs.load(undefined, 0);
    this.sinceAuth = 0;
    this.lastCastSkill = null;
    this.lastCastTick = -1;
    this.baseTick = -1;
    this.clearPull();
    this.authTick = -1;
    this.authDead = false;
    this.authAnim = 'idle';
    this.authAnimTime = 0;
    this.ticksSinceFrame = 0;
    this.tickTime = Number.NaN;
    this.lastFrameNow = Number.NaN;
    this.frac = 1;
    this.lastError = 0;
  }

  /** Exact numbers from the rules; they take effect for every following prediction. */
  setHints(hints: PredictionHints): void {
    if (hints.moveSpeed !== undefined && Number.isFinite(hints.moveSpeed) && hints.moveSpeed > 0) {
      this.hintSpeed = hints.moveSpeed;
      this.moveSpeed = hints.moveSpeed;
      this.speedCount = 0;
    }
    if (hints.castTimes) {
      for (const [id, t] of Object.entries(hints.castTimes) as [SkillId, number | undefined][]) {
        if (t !== undefined && Number.isFinite(t) && t >= 0 && t <= MAX_CAST_TIME) this.castTimes.set(id, t);
      }
    }
  }

  /** Learned or hinted cast time of a skill (s), or 0 when unknown. */
  castTimeOf(skill: SkillId): number {
    return this.castTimes.get(skill) ?? 0;
  }

  /** Number of inputs not yet acknowledged by the server. */
  get pendingCount(): number {
    return this.count;
  }

  private step(x: number, y: number, moveX: number, moveY: number, slow: number, env: PredictionEnv): { x: number; y: number } {
    this.state.x = x;
    this.state.y = y;
    this.move.moveX = moveX;
    this.move.moveY = moveY;
    const p = this.params;
    p.speed = this.moveSpeed;
    p.arenaRadius = env.arenaRadius;
    p.props = env.props;
    p.slow = slow;
    return movePlayer(this.state, this.move, p, SIM_DT);
  }

  /** Record one input tick and advance the prediction by SIM_DT. */
  addInput(input: InputMessage, env: PredictionEnv): void {
    if (this.count === INPUT_RING) {
      // Never acked for 8+ s (server stalled): forget the oldest input.
      this.head = (this.head + 1) % INPUT_RING;
      this.count--;
    }
    const at = (this.head + this.count) % INPUT_RING;
    this.seqs[at] = input.seq;
    this.moveXs[at] = input.moveX;
    this.moveYs[at] = input.moveY;
    this.helds[at] = input.held & 0xff;
    this.castSaved[at] = 0;
    this.count++;
    this.hasInput = true;
    this.inputMoveX = input.moveX;
    this.inputMoveY = input.moveY;
    this.inputAimX = input.aimX;
    this.inputAimY = input.aimY;
    this.ticksSinceFrame++;
    if (!this.hasBase || this.dead) return;
    this.prevX = this.x;
    this.prevY = this.y;
    const next = this.advance(input.held, input.moveX, input.moveY, this.x, this.y, env);
    this.cast.save(this.castStates, at * CAST_STATE_SIZE);
    this.castSaved[at] = 1;
    this.x = next.x;
    this.y = next.y;
  }

  /**
   * One predicted server tick after the base record: the cast model and the debuffs run as the sim runs them, then
   * either her own move (under the tick's slow) or, while a known drag lasts, the drag's position. Sets `slow`.
   */
  private advance(held: number, moveX: number, moveY: number, x: number, y: number, env: PredictionEnv): { x: number; y: number } {
    this.slow = this.tick(held, x, y, env);
    const pullStep = this.pullStepAt(this.baseTick + this.sinceAuth);
    if (pullStep > 0) {
      // The sim's drag replaces her movement (vx = vy = 0): nothing she presses moves her.
      this.slow = 1;
      return this.pullPosition(pullStep, env);
    }
    return this.step(x, y, moveX, moveY, this.slow, env);
  }

  /**
   * The next input tick after the authoritative record: advances the cast model under the debuffs still running then
   * and returns the movement slow for a player standing at (x, y).
   */
  private tick(held: number, x: number, y: number, env: PredictionEnv): number {
    this.sinceAuth++;
    const d = this.debuffs;
    d.beginTick();
    const frozen = d.frozen;
    const chilled = d.chilled;
    const castSlow = this.cast.step(held, frozen ? 0 : chilled ? CHILL_CAST_FACTOR : 1, !frozen);
    const ground = env.areas.length > 0 ? areaSlowAt(env.areas, x, y) : 0;
    const slow = playerSlow(castSlow, debuffMoveSlow(chilled, frozen || d.rooted), ground);
    d.endTick();
    return slow;
  }

  /** The movement slow at the record's own tick (for the speed estimate and the first predicted frame). */
  private recordSlow(rec: PlayerRecord, env: PredictionEnv): number {
    const d = this.debuffs;
    const ground = env.areas.length > 0 ? areaSlowAt(env.areas, rec.x, rec.y) : 0;
    return playerSlow(castSlowOf(rec), debuffMoveSlow(d.chilled, d.frozen || d.rooted), ground);
  }

  private recordSpeed(tick: number, speed: number): void {
    this.speedTick[this.speedHead] = tick;
    this.speedValue[this.speedHead] = speed;
    this.speedHead = (this.speedHead + 1) % SPEED_SAMPLES;
    if (this.speedCount < SPEED_SAMPLES) this.speedCount++;
    let best = 0;
    for (let k = 0; k < this.speedCount; k++) {
      if (tick - this.speedTick[k] <= SPEED_WINDOW_TICKS && this.speedValue[k] > best) best = this.speedValue[k];
    }
    if (best > 0) this.moveSpeed = best;
  }

  /** Learn a cast time from two consecutive snapshots of the same running cast. */
  private observeCast(rec: PlayerRecord, tick: number): void {
    const skill = rec.castSkill;
    if (this.debuffs.chilled || this.debuffs.frozen) {
      // Chilled / frozen casts progress at a debuffed rate: nothing to learn about the skill's own cast time. (The
      // next record starts a fresh pair, so a pair never spans a debuffed tick.)
      this.lastCastSkill = null;
      this.lastCastTick = -1;
      return;
    }
    if (skill !== null && skill === this.lastCastSkill && tick > this.lastCastTick && tick - this.lastCastTick <= CAST_LEARN_MAX_TICKS) {
      const dp = rec.castProgress - this.lastCastProgress;
      if (dp > 1e-4) {
        const total = ((tick - this.lastCastTick) * SIM_DT) / dp;
        if (total >= MIN_CAST_TIME && total <= MAX_CAST_TIME) {
          const known = this.castTimes.get(skill);
          // Refine a consistent estimate; replace one that no longer fits (cast speed changed).
          const next = known !== undefined && Math.abs(known - total) < known * 0.02 ? known + (total - known) * 0.3 : total;
          this.castTimes.set(skill, snapCastTime(next));
        }
      }
    }
    this.lastCastSkill = skill;
    this.lastCastProgress = rec.castProgress;
    this.lastCastTick = tick;
  }

  /**
   * Rebase on the authoritative state of the viewer at `tick` (inputs ≤ ackSeq applied) and replay the rest.
   */
  reconcile(rec: PlayerRecord, ackSeq: number, tick: number, env: PredictionEnv): void {
    // 1. Drop acked inputs, remembering the move of the input the snapshot's velocity came from.
    let ackedMoveX = 0;
    let ackedMoveY = 0;
    let haveAcked = false;
    let ackedAt = -1;
    while (this.count > 0 && this.seqs[this.head] <= ackSeq) {
      if (this.seqs[this.head] === ackSeq) {
        ackedMoveX = this.moveXs[this.head];
        ackedMoveY = this.moveYs[this.head];
        haveAcked = true;
        ackedAt = this.castSaved[this.head] ? this.head : -1;
      }
      this.head = (this.head + 1) % INPUT_RING;
      this.count--;
    }

    // 2. Base speed from the acked input's effective velocity (at the snapshot's tick the cast slow is exactly
    //    predictionSlow(rec): the view is written after that tick's cast update and movement). Only clean samples
    //    count: under a root/freeze/chill or near a tar pool the slow is the sim's business, not a speed change. A
    //    record's debuff list is post-tick: a chill that ran out on its very tick is gone from the list although the
    //    tick's velocity was still chilled — so the record after a debuffed one does not count either.
    this.debuffs.load(rec.dead ? undefined : rec.debuffs, rec.wardTime);
    this.sinceAuth = 0;
    const ackSlow = this.recordSlow(rec, env);
    const dirty = this.debuffs.any || nearTar(env.areas, rec.x, rec.y, TAR_LEARN_MARGIN);
    const clean = !dirty && !this.prevDirty;
    this.prevDirty = dirty;
    if (haveAcked && !rec.dead && clean) {
      this.move.moveX = ackedMoveX;
      this.move.moveY = ackedMoveY;
      const dir = moveVector(this.move, this.dir);
      const factor = dir.len * (1 - ackSlow);
      if (dir.len > MOVING_EPS && factor > 1e-3) {
        const base = Math.hypot(rec.vx, rec.vy) / factor;
        if (Number.isFinite(base) && base > 1) this.recordSpeed(tick, base);
      }
    }
    if (this.speedCount === 0 && this.hintSpeed > 0) this.moveSpeed = this.hintSpeed;
    this.observeCast(rec, tick);

    // 3. Snap conditions: first base, death/respawn, a fresh dash (Rift Step blinks), or a teleport-sized jump.
    let snap = !this.hasBase || rec.dead !== this.authDead;
    if (!snap && rec.anim === 'dash' && (this.authAnim !== 'dash' || rec.animTime < this.authAnimTime)) snap = true;
    if (!snap && this.authTick >= 0 && tick > this.authTick) {
      const moved = Math.hypot(rec.x - this.authX, rec.y - this.authY);
      const plausible = this.moveSpeed * (tick - this.authTick) * SIM_DT * 1.5 + 16;
      if (moved > plausible) snap = true;
    }

    // 4. The replay base. The cast state it starts from: our own exact state after the acked input if the server
    //    agrees with it, else rebuilt from the record. (The acked entry was just dropped; its slot is not reused before
    //    the next input.)
    this.dead = rec.dead;
    if (ackedAt >= 0) this.cast.restore(this.castStates, ackedAt * CAST_STATE_SIZE, rec, this.castTimes);
    else this.cast.load(rec, this.castTimes);
    this.cast.save(this.baseCast, 0);
    this.baseFocus = this.cast.focus;
    this.debuffs.save(this.baseDebuffs);
    this.baseTick = tick;
    this.baseX = rec.x;
    this.baseY = rec.y;
    this.baseSlow = ackSlow;
    this.syncPull(rec, tick, env);

    // 5. Replay the unacked inputs from the authoritative position and keep what is on screen continuous.
    this.replay(env, snap);

    this.authTick = tick;
    this.authX = rec.x;
    this.authY = rec.y;
    this.authAnim = rec.anim;
    this.authAnimTime = rec.animTime;
    this.authDead = rec.dead;
  }

  /**
   * Re-run every unacked input from the replay base (re-deriving each tick's cast slow, debuffs and drag), then turn
   * the jump between the old and the new prediction into the decaying visual offset (or snap).
   */
  private replay(env: PredictionEnv, snapIn: boolean): void {
    let snap = snapIn;
    this.cast.restoreState(this.baseCast, 0, this.baseFocus);
    this.debuffs.restore(this.baseDebuffs);
    this.sinceAuth = 0;
    // A record taken mid-drag: held there (vx = vy = 0), whatever its own slow says.
    this.slow = this.pullStepAt(this.baseTick) > 0 ? 1 : this.baseSlow;
    let px = this.baseX;
    let py = this.baseY;
    let ppx = px;
    let ppy = py;
    if (!this.dead) {
      for (let k = 0; k < this.count; k++) {
        const i = (this.head + k) % INPUT_RING;
        ppx = px;
        ppy = py;
        const next = this.advance(this.helds[i], this.moveXs[i], this.moveYs[i], px, py, env);
        this.cast.save(this.castStates, i * CAST_STATE_SIZE);
        this.castSaved[i] = 1;
        px = next.x;
        py = next.y;
      }
    }

    if (this.hasBase) {
      const f = this.frac;
      const dx = this.prevX + (this.x - this.prevX) * f - (ppx + (px - ppx) * f);
      const dy = this.prevY + (this.y - this.prevY) * f - (ppy + (py - ppy) * f);
      this.lastError = Math.hypot(dx, dy);
      // `jump` = how far the on-screen position moves if we snap now (offset so far + this discontinuity).
      let jump: number;
      if (!snap) {
        if (this.lastError > 1e-3) this.corrections++;
        this.errX += dx;
        this.errY += dy;
        jump = Math.hypot(this.errX, this.errY);
        if (jump > SNAP_DISTANCE) snap = true;
      } else jump = Math.hypot(this.errX + dx, this.errY + dy);
      if (snap && jump > 1e-3) this.snaps++;
    }
    if (snap) {
      this.errX = 0;
      this.errY = 0;
    }
    this.x = px;
    this.y = py;
    this.prevX = ppx;
    this.prevY = ppy;
    this.hasBase = true;
  }

  // --- chain hook drags --------------------------------------------------------------------------------------

  /**
   * Her own 'pull' event (a chain hook hit her; `batchTick` = the tick of the events batch it came in, sent right
   * after the snapshot of that tick). When the latest record already covers the hit, the drag is matched and the
   * unacked inputs are replayed with it at once; otherwise the next snapshot does it.
   */
  notePull(fromX: number, fromY: number, toX: number, toY: number, batchTick: number, env: PredictionEnv): void {
    if (![fromX, fromY, toX, toY, batchTick].every(Number.isFinite)) return;
    this.pullActive = true;
    this.pullFromX = fromX;
    this.pullFromY = fromY;
    this.pullToX = toX;
    this.pullToY = toY;
    this.pullStart = -1;
    this.pullBatchTick = batchTick;
    if (!this.hasBase || this.dead || this.baseTick < batchTick) return;
    this.matchPull(this.baseX, this.baseY, this.baseTick, env);
    if (this.pullActive) this.replay(env, false);
  }

  private clearPull(): void {
    this.pullActive = false;
    this.pullStart = -1;
  }

  /** Drag step (1..PULL_STEPS) the sim applies on server tick `t`, or 0 when no known drag moves her then. */
  private pullStepAt(t: number): number {
    if (!this.pullActive || this.pullStart < 0) return 0;
    const k = t - this.pullStart;
    return k >= 1 && k <= PULL_STEPS ? k : 0;
  }

  /** Where the drag puts her after step k (0 = the hit tick: `from`). Returns a reused object. */
  private pullPosition(k: number, env: PredictionEnv): { x: number; y: number } {
    if (k <= 0) {
      this.state.x = this.pullFromX;
      this.state.y = this.pullFromY;
      return this.state;
    }
    // Operation for operation the sim's moveTo(from + (to − from) · u).
    const u = PULL_U[k < PULL_STEPS ? k : PULL_STEPS];
    const o = resolvePlayerAt(
      this.pullFromX + (this.pullToX - this.pullFromX) * u, this.pullFromY + (this.pullToY - this.pullFromY) * u,
      env.arenaRadius, env.props,
    );
    this.state.x = o.x;
    this.state.y = o.y;
    return this.state;
  }

  /**
   * Find the drag step a record at (x, y) on server tick `tick` shows (the nearest point of the drag line; ties → the
   * earlier step) and fix the hit tick from it. A record off the line, or one past the drag, ends it.
   */
  private matchPull(x: number, y: number, tick: number, env: PredictionEnv): void {
    let best = -1;
    let bestD = Infinity;
    for (let k = 0; k <= PULL_STEPS; k++) {
      const p = this.pullPosition(k, env);
      const d = Math.hypot(x - p.x, y - p.y);
      if (d < bestD - 1e-9) {
        bestD = d;
        best = k;
      }
    }
    if (!(bestD <= PULL_MATCH_DIST) || best >= PULL_STEPS) {
      this.clearPull();
      return;
    }
    this.pullStart = tick - best;
    this.pulls++;
  }

  /** Keep a known drag in step with a new authoritative record (match it, check it, or end it). */
  private syncPull(rec: PlayerRecord, tick: number, env: PredictionEnv): void {
    if (!this.pullActive) return;
    if (rec.dead) {
      this.clearPull();
      return;
    }
    if (this.pullStart < 0) {
      // A record from before the batch may predate the hit: wait for one that covers it.
      if (tick >= this.pullBatchTick) this.matchPull(rec.x, rec.y, tick, env);
      return;
    }
    const k = tick - this.pullStart;
    if (k < 0 || k >= PULL_STEPS) {
      this.clearPull();
      return;
    }
    // Still where the drag puts her? A Rift Step (it breaks the drag) or a shove says otherwise.
    const p = this.pullPosition(k, env);
    if (!(Math.hypot(rec.x - p.x, rec.y - p.y) <= PULL_MATCH_DIST)) this.clearPull();
  }

  /**
   * Advance the render phase to client time `now` and return the smoothed on-screen position in `out`.
   * The latest input tick is assumed to have happened at most one tick ago; between input ticks the position
   * glides from the previous to the latest prediction, so high-refresh displays stay smooth.
   */
  frame(now: number, out: { x: number; y: number }): void {
    const dt = Number.isNaN(this.lastFrameNow) ? 0 : Math.min(Math.max(now - this.lastFrameNow, 0), 250);
    this.lastFrameNow = now;
    if (this.ticksSinceFrame > 0) {
      const t = Number.isNaN(this.tickTime) ? now : this.tickTime + this.ticksSinceFrame * TICK_MS;
      this.tickTime = t > now ? now : t < now - TICK_MS ? now - TICK_MS : t;
      this.ticksSinceFrame = 0;
    }
    const f = Number.isNaN(this.tickTime) ? 1 : Math.min(1, Math.max(0, (now - this.tickTime) / TICK_MS));
    this.frac = f;
    if (dt > 0 && (this.errX !== 0 || this.errY !== 0)) {
      const k = Math.exp((-CORRECTION_RATE * dt) / 1000);
      this.errX *= k;
      this.errY *= k;
      if (Math.abs(this.errX) < 1e-3 && Math.abs(this.errY) < 1e-3) this.errX = this.errY = 0;
    }
    out.x = this.prevX + (this.x - this.prevX) * f + this.errX;
    out.y = this.prevY + (this.y - this.prevY) * f + this.errY;
  }

  /** Normalised direction of the latest input (a reused object). */
  inputDirection(): MoveVector {
    this.move.moveX = this.inputMoveX;
    this.move.moveY = this.inputMoveY;
    return moveVector(this.move, this.dir);
  }

  /** True while the latest input moves the (alive, placed) player. */
  get moving(): boolean {
    if (!this.hasInput || !this.hasBase || this.dead) return false;
    return this.inputDirection().len > MOVING_EPS && this.moveSpeed * (1 - this.slow) > 0;
  }
}
