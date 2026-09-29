// Server-tick clock for the client's interpolation buffer (a jitter buffer for snapshots).
//
//  • Every snapshot arrival gives a sample  offset = receivedAt − tick·TICK_MS  (client ms at which that tick
//    "became visible"). The least-delayed path through the network is the floor of those offsets: a sliding-window
//    minimum (2 s), projected forward with the estimated clock drift. `liveTick(now)` = the newest tick that the
//    least-delayed path would have delivered by `now`.
//  • Drift: a server whose tick rate differs from the client's clock (a loaded server dropping catch-up steps, clock
//    skew) makes the offsets slope. Per-second block minima are fitted with a least-squares line (±5 % clamp), so the
//    floor, the live tick and the render clock's rate all follow the server's real tick rate.
//  • Lateness of a sample above the floor is jitter. The render delay is sized from a robust statistic, not a peak:
//    the 95th percentile of lateness over the last 2.5 s, counted per delivery event (snapshots delivered together by a
//    TCP stall or a main-thread hitch are ONE event carrying the burst's worst lateness). One stall or hitch is
//    therefore ignored — the ≤ 100 ms extrapolate-then-hold path covers it — while recurring jitter raises the delay:
//      delay = clamp(max(2.2 · snapshotInterval, snapshotInterval + jitterP95 + 4 ms), 50, 150) ms.
//  • A persistent step up in latency (route change, server dropped time) looks like "every recent sample is late".
//    When the last 12 events are all later than max(20 ms, 2 × median lateness), the floor is rebased onto them
//    instead of waiting 2 s for the old minimum to leave the window.
//  • The render clock runs at the server's tick rate and is steered toward liveTick(now) − delay with a time warp
//    (≤ 10 %, ≤ 20 % when catching up more than a snapshot interval, never backwards); errors above 200 ms (first
//    snapshot, tab restored, long stall) snap. `holdAt()` pauses it while the stream is starved, so a late burst is
//    caught up smoothly instead of teleporting everything forward.
import { SNAPSHOT_EVERY } from '../contracts/net';
import { SIM_HZ } from '../contracts/sim';

export const TICK_MS = 1000 / SIM_HZ;
export const MIN_INTERP_DELAY_MS = 50;
export const MAX_INTERP_DELAY_MS = 150;
/** Render delay in snapshot intervals when the network is clean. */
export const INTERP_INTERVALS = 2.2;
/** Largest server/client tick-rate mismatch the drift estimate accepts (fraction). */
export const MAX_DRIFT = 0.05;

const SAMPLE_SLOTS = 128; // ≈ 4 s of arrivals at 30 Hz
const BASE_WINDOW_MS = 2000;
const JITTER_WINDOW_MS = 2500;
const JITTER_PERCENTILE = 0.95;
/** Arrivals closer together than this belong to one delivery burst. */
const BURST_MS = 3;
const DRIFT_BLOCK_MS = 1000;
const DRIFT_BLOCKS = 6;
const DRIFT_MIN_BLOCK_SAMPLES = 6;
const REBASE_EVENTS = 12;
const REBASE_MIN_MS = 20;
const SNAP_MS = 200;
const MAX_WARP = 0.1;
const CATCHUP_WARP = 0.2;
const STEER_PER_MS = 0.004; // ~250 ms time constant
const INTERVAL_SMOOTHING = 0.1;

export class SnapshotClock {
  // Arrival samples (ring): raw offset, arrival time, lateness above the floor, and whether the sample continued a
  // delivery burst (only burst heads count as jitter events).
  private readonly sampleOffset = new Float64Array(SAMPLE_SLOTS);
  private readonly sampleAt = new Float64Array(SAMPLE_SLOTS);
  private readonly sampleLate = new Float64Array(SAMPLE_SLOTS);
  private readonly sampleBurst = new Uint8Array(SAMPLE_SLOTS);
  private sampleHead = 0;
  private sampleCount = 0;
  private lastArrival = Number.NaN;
  /** Samples that arrived before this time are ignored by the floor (set by a rebase). */
  private floorFrom = -Infinity;
  private readonly scratch = new Float64Array(SAMPLE_SLOTS);

  // Drift: minima of consecutive 1 s blocks of raw offsets.
  private readonly blockAt = new Float64Array(DRIFT_BLOCKS);
  private readonly blockMin = new Float64Array(DRIFT_BLOCKS);
  private blockHead = 0;
  private blockCount = 0;
  private curBlockStart = Number.NaN;
  private curBlockMin = Infinity;
  private curBlockMinAt = 0;
  private curBlockSamples = 0;

  /** Floor offset at `baseAt` (ms); the floor at time t is baseOffset + drift·(t − baseAt). */
  baseOffset = 0;
  baseAt = 0;
  /** d(offset)/d(client ms): > 0 when the server ticks slower than SIM_HZ by the client's clock. */
  drift = 0;
  /** Smoothed tick distance between consecutive snapshots, in server ms (ticks · TICK_MS). */
  intervalMs = SNAPSHOT_EVERY * TICK_MS;
  /** Robust jitter estimate (ms): 95th percentile of per-event lateness over the last 2.5 s. */
  jitterMs = 0;
  /** Lateness of the latest sample (ms, diagnostics). */
  lastLateMs = 0;
  /** Number of floor rebases (diagnostics). */
  rebases = 0;
  /** Current render position on the server timeline (fractional ticks). */
  renderTick = 0;
  newestTick = -1;
  private started = false;
  private lastNow = Number.NaN;

  reset(): void {
    this.sampleHead = 0;
    this.sampleCount = 0;
    this.lastArrival = Number.NaN;
    this.floorFrom = -Infinity;
    this.blockHead = 0;
    this.blockCount = 0;
    this.curBlockStart = Number.NaN;
    this.curBlockMin = Infinity;
    this.curBlockSamples = 0;
    this.baseOffset = 0;
    this.baseAt = 0;
    this.drift = 0;
    this.intervalMs = SNAPSHOT_EVERY * TICK_MS;
    this.jitterMs = 0;
    this.lastLateMs = 0;
    this.renderTick = 0;
    this.newestTick = -1;
    this.started = false;
    this.lastNow = Number.NaN;
  }

  get hasSamples(): boolean {
    return this.sampleCount > 0;
  }

  /** Server ticks per client millisecond (the render clock's rate). */
  get ticksPerMs(): number {
    return (1 - this.drift) / TICK_MS;
  }

  /** Floor offset projected to client time t. */
  private floorAt(t: number): number {
    return this.baseOffset + this.drift * (t - this.baseAt);
  }

  /** Record a snapshot arrival. */
  onSnapshot(tick: number, receivedAt: number): void {
    const offset = receivedAt - tick * TICK_MS;
    const burst = this.sampleCount > 0 && Math.abs(receivedAt - this.lastArrival) < BURST_MS;
    this.lastArrival = receivedAt;
    const slot = this.sampleHead;
    this.sampleOffset[slot] = offset;
    this.sampleAt[slot] = receivedAt;
    this.sampleBurst[slot] = burst ? 1 : 0;
    this.sampleHead = (slot + 1) % SAMPLE_SLOTS;
    if (this.sampleCount < SAMPLE_SLOTS) this.sampleCount++;

    this.trackDrift(offset, receivedAt);
    this.recomputeFloor(receivedAt);
    let late = offset - this.floorAt(receivedAt);
    late = late < 0 ? 0 : late > MAX_INTERP_DELAY_MS ? MAX_INTERP_DELAY_MS : late;
    this.sampleLate[slot] = late;
    this.lastLateMs = late;
    if (!burst) this.checkRebase(receivedAt);
    this.jitterMs = this.lateness(receivedAt, JITTER_PERCENTILE);

    if (this.newestTick >= 0 && tick > this.newestTick) {
      const gap = Math.min((tick - this.newestTick) * TICK_MS, 500);
      this.intervalMs += (gap - this.intervalMs) * INTERVAL_SMOOTHING;
    }
    if (tick > this.newestTick) this.newestTick = tick;
  }

  /** Sliding-window minimum of the drift-projected offsets (the newest sample always counts). */
  private recomputeFloor(now: number): void {
    // Clamped to `now` so a caller clock that stepped backwards still keeps its newest samples.
    const horizon = Math.min(Math.max(now - BASE_WINDOW_MS, this.floorFrom), now);
    let min = Infinity;
    for (let k = 0; k < this.sampleCount; k++) {
      const at = this.sampleAt[k];
      if (at < horizon) continue;
      const projected = this.sampleOffset[k] + this.drift * (now - at);
      if (projected < min) min = projected;
    }
    this.baseOffset = min;
    this.baseAt = now;
  }

  /** Per-event lateness percentile over the jitter window (0 when empty). */
  private lateness(now: number, q: number): number {
    const horizon = now - JITTER_WINDOW_MS;
    const s = this.scratch;
    let n = 0;
    for (let k = 0; k < this.sampleCount; k++) {
      if (this.sampleBurst[k] || this.sampleAt[k] < horizon) continue;
      s[n++] = this.sampleLate[k];
    }
    if (n === 0) return 0;
    const sorted = s.subarray(0, n).sort();
    return sorted[Math.floor(q * (n - 1))];
  }

  /**
   * Every one of the last REBASE_EVENTS delivery events was clearly late: the path got slower for good (or the server
   * dropped time). Move the floor onto the new level at once and forget the old samples.
   */
  private checkRebase(now: number): void {
    let seen = 0;
    let minLate = Infinity;
    let oldestAt = now;
    for (let back = 1; back <= this.sampleCount && seen < REBASE_EVENTS; back++) {
      const k = (this.sampleHead - back + SAMPLE_SLOTS) % SAMPLE_SLOTS;
      if (this.sampleAt[k] < this.floorFrom) break;
      if (this.sampleBurst[k]) continue;
      seen++;
      if (this.sampleLate[k] < minLate) minLate = this.sampleLate[k];
      oldestAt = this.sampleAt[k];
    }
    if (seen < REBASE_EVENTS) return;
    const threshold = Math.max(REBASE_MIN_MS, 2 * this.lateness(now, 0.5));
    if (minLate <= threshold) return;
    this.rebases++;
    this.floorFrom = oldestAt;
    // The old level is not drift: restart the block history from here.
    this.blockCount = 0;
    this.curBlockStart = Number.NaN;
    this.recomputeFloor(now);
    for (let back = 1; back <= this.sampleCount; back++) {
      const k = (this.sampleHead - back + SAMPLE_SLOTS) % SAMPLE_SLOTS;
      if (this.sampleAt[k] < oldestAt) break;
      const late = this.sampleOffset[k] - this.floorAt(this.sampleAt[k]);
      this.sampleLate[k] = late < 0 ? 0 : late > MAX_INTERP_DELAY_MS ? MAX_INTERP_DELAY_MS : late;
    }
  }

  /** Fit the slope of the per-second offset minima (least squares over the last DRIFT_BLOCKS blocks). */
  private trackDrift(offset: number, at: number): void {
    if (Number.isNaN(this.curBlockStart)) {
      this.curBlockStart = at;
      this.curBlockMin = Infinity;
      this.curBlockSamples = 0;
    }
    if (at - this.curBlockStart >= DRIFT_BLOCK_MS) {
      if (this.curBlockSamples >= DRIFT_MIN_BLOCK_SAMPLES) {
        this.blockAt[this.blockHead] = this.curBlockMinAt;
        this.blockMin[this.blockHead] = this.curBlockMin;
        this.blockHead = (this.blockHead + 1) % DRIFT_BLOCKS;
        if (this.blockCount < DRIFT_BLOCKS) this.blockCount++;
        this.fitDrift();
      }
      this.curBlockStart = at;
      this.curBlockMin = Infinity;
      this.curBlockSamples = 0;
    }
    this.curBlockSamples++;
    if (offset < this.curBlockMin) {
      this.curBlockMin = offset;
      this.curBlockMinAt = at;
    }
  }

  private fitDrift(): void {
    const n = this.blockCount;
    if (n < 3) return;
    let mt = 0;
    let mo = 0;
    for (let k = 0; k < n; k++) {
      mt += this.blockAt[k];
      mo += this.blockMin[k];
    }
    mt /= n;
    mo /= n;
    let cov = 0;
    let varT = 0;
    for (let k = 0; k < n; k++) {
      const dt = this.blockAt[k] - mt;
      cov += dt * (this.blockMin[k] - mo);
      varT += dt * dt;
    }
    if (varT <= 0) return;
    const slope = cov / varT;
    this.drift = slope > MAX_DRIFT ? MAX_DRIFT : slope < -MAX_DRIFT ? -MAX_DRIFT : slope;
  }

  /** Target delay of the render clock behind the live edge (client ms). */
  delayMs(): number {
    const interval = this.intervalMs / (1 - this.drift);
    const d = Math.max(INTERP_INTERVALS * interval, interval + this.jitterMs + 4);
    return d < MIN_INTERP_DELAY_MS ? MIN_INTERP_DELAY_MS : d > MAX_INTERP_DELAY_MS ? MAX_INTERP_DELAY_MS : d;
  }

  /** Newest server tick expected to have arrived by client time `now` (fractional). */
  liveTick(now: number): number {
    return (now - this.floorAt(now)) / TICK_MS;
  }

  /** Never render past `tick` (the stream is starved): the clock waits there and catches up once data arrives. */
  holdAt(tick: number): void {
    if (this.renderTick > tick) this.renderTick = tick;
  }

  /** Advance to client time `now` (ms) and return the render tick. */
  advance(now: number): number {
    if (!this.hasSamples) return this.renderTick;
    const dt = Number.isNaN(this.lastNow) ? 0 : Math.min(Math.max(now - this.lastNow, 0), 250);
    this.lastNow = now;
    const rate = this.ticksPerMs;
    const target = this.liveTick(now) - this.delayMs() * rate;
    if (!this.started) {
      this.renderTick = target;
      this.started = true;
      return this.renderTick;
    }
    const step = dt * rate;
    this.renderTick += step;
    const err = target - this.renderTick;
    if (Math.abs(err) > SNAP_MS * rate) {
      this.renderTick = target;
    } else {
      const catchingUp = err > this.intervalMs / TICK_MS;
      const cap = step * (catchingUp ? CATCHUP_WARP : MAX_WARP);
      const corr = err * Math.min(1, dt * STEER_PER_MS);
      this.renderTick += corr > cap ? cap : corr < -cap ? -cap : corr;
    }
    return this.renderTick;
  }
}
