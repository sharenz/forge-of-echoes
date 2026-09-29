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
import type { SkillId } from '../contracts/content';
import { LOADOUT_SLOTS } from '../contracts/items';
import type { InputMessage } from '../contracts/net';
import { SIM_DT, SIM_HZ } from '../contracts/sim';
import type { PlayerAnim, PropView } from '../contracts/sim';
// The movement module alone (not '../sim'): keeps the rest of the simulation out of the client bundle.
import { CAST_SLOW, movePlayer, predictionSlow } from '../sim/movement';
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

export interface PredictionEnv {
  arenaRadius: number;
  props: readonly PropView[];
}

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

/** The sim checks held slots in this order each tick: the actives first, the basic attack (slot 0) last. */
const CAST_ORDER = [1, 2, 3, 4, 5, 0] as const;
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
    for (let s = 0; s < LOADOUT_SLOTS; s++) {
      const sv = s < n ? rec.slots[s] : null;
      const id = sv ? sv.skillId : null;
      this.castTime[s] = id === null ? -1 : castTimes.get(id) ?? -1;
      this.maxCharges[s] = sv ? sv.maxCharges : 0;
      this.cooldown[s] = sv ? sv.cooldownTotal : 0;
      this.cost[s] = sv ? Math.max(0, sv.focusCost) : 0;
    }
  }

  /** Loadout slot of the record's running cast (0 = basic), -1 for none, -2 for a skill not in the loadout. */
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
    const slowed = predictionSlow(rec) > 0;
    const total = rec.castSkill !== null ? castTimes.get(rec.castSkill) ?? 0 : 0;
    if (total > 0) {
      this.castSlot = slot >= 0 ? slot : 1;
      this.total = total;
      this.time = castTimeAt(rec.castProgress, total);
    } else if (slowed) {
      // First sight of this active: its end is unknown, keep slowing until a snapshot says otherwise.
      this.castSlot = slot >= 1 ? slot : 1;
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

  /** One sim tick with the held mask of its input; returns the `slow` of that tick's movement. */
  step(held: number): number {
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
    if (this.castSlot >= 0) {
      this.time += SIM_DT;
      if (this.time >= this.total) {
        carry = Math.min(SIM_DT, this.time - this.total);
        this.castSlot = -1;
      }
    }
    // Held timed skills start as soon as usable.
    if (held !== 0) {
      for (let o = 0; o < CAST_ORDER.length; o++) {
        const s = CAST_ORDER[o];
        if ((held & (1 << s)) === 0) continue;
        const ct = this.castTime[s];
        if (!(ct > 0)) continue;
        if (this.castSlot >= 0 && !(this.castSlot === 0 && s !== 0)) continue;
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
    return this.castSlot > 0 ? CAST_SLOW : 0;
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

  /** Cast times per skill (s): learned from snapshots, or hinted by the rules. */
  readonly castTimes = new Map<SkillId, number>();
  private readonly cast = new CastModel();
  private lastCastSkill: SkillId | null = null;
  private lastCastProgress = 0;
  private lastCastTick = -1;

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
  /** Base move speed estimate (units/s) and the predicted slow of the latest input tick. */
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
    this.hasBase = false;
    this.x = this.y = this.prevX = this.prevY = 0;
    this.errX = this.errY = 0;
    this.slow = 0;
    this.dead = false;
    this.hasInput = false;
    this.cast.alive = false;
    this.cast.castSlot = -1;
    this.lastCastSkill = null;
    this.lastCastTick = -1;
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
    this.slow = this.cast.step(input.held);
    this.cast.save(this.castStates, at * CAST_STATE_SIZE);
    this.castSaved[at] = 1;
    this.prevX = this.x;
    this.prevY = this.y;
    const next = this.step(this.x, this.y, input.moveX, input.moveY, this.slow, env);
    this.x = next.x;
    this.y = next.y;
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

    // 2. Base speed from the acked input's effective velocity (at the snapshot's tick the slow is exactly
    //    predictionSlow(rec): the view is written after that tick's cast update and movement).
    const ackSlow = predictionSlow(rec);
    if (haveAcked && !rec.dead) {
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

    // 4. Replay the unacked inputs from the authoritative position, re-deriving each tick's cast slow.
    this.dead = rec.dead;
    // The cast state the replay starts from: our own exact state after the acked input if the server agrees with it,
    // else rebuilt from the record. (The acked entry was just dropped; its slot is not reused before the next input.)
    if (ackedAt >= 0) this.cast.restore(this.castStates, ackedAt * CAST_STATE_SIZE, rec, this.castTimes);
    else this.cast.load(rec, this.castTimes);
    this.slow = ackSlow;
    let px = rec.x;
    let py = rec.y;
    let ppx = px;
    let ppy = py;
    if (!rec.dead) {
      for (let k = 0; k < this.count; k++) {
        const i = (this.head + k) % INPUT_RING;
        ppx = px;
        ppy = py;
        this.slow = this.cast.step(this.helds[i]);
        this.cast.save(this.castStates, i * CAST_STATE_SIZE);
        this.castSaved[i] = 1;
        const next = this.step(px, py, this.moveXs[i], this.moveYs[i], this.slow, env);
        px = next.x;
        py = next.y;
      }
    }

    // 5. Keep what is on screen continuous: the jump between old and new prediction becomes the visual offset.
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

    this.authTick = tick;
    this.authX = rec.x;
    this.authY = rec.y;
    this.authAnim = rec.anim;
    this.authAnimTime = rec.animTime;
    this.authDead = rec.dead;
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
