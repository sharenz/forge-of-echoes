// Impact convergence guard: a tiny direct-mapped spatial cache of recent impact flashes (square cells, short
// memory). When a focus-fired target keeps getting hit — four players on one rare, a party on the training dummy —
// only the first couple of flashes per cell land in full and the rest are thinned, so additive light, sparks and
// impact stars never fuse into a white blob that hides the target (CONCEPTS pillar 5: VFX never hide enemies).
// The same guard keeps ground danger readable: meteor showers and fire pools piling onto one spot share one
// cell's worth of light (areas.ts, events.ts).
//
// Direct-mapped on purpose: a collision simply restarts that slot's window (allowing one extra flash), which is
// harmless and keeps the lookup allocation-free and O(1).

const SLOTS = 256;
const EMPTY = 0x7fffffff;

export class ImpactHeat {
  private readonly key = new Int32Array(SLOTS).fill(EMPTY);
  private readonly start = new Float64Array(SLOTS);
  private readonly count = new Uint8Array(SLOTS);
  private readonly inv: number;

  /**
   * `window`: how long a cell remembers its impacts, in the units of `now` (seconds, or 0 with a frame counter
   * as `now` for a per-frame guard). `cell`: cell size in world units.
   */
  constructor(private readonly window = 0.1, cell = 32) {
    this.inv = 1 / cell;
  }

  /**
   * Record an impact at (x, y) at time `now`. Returns how many impacts the cell already had inside the current
   * window (0 for the first one).
   */
  touch(x: number, y: number, now: number): number {
    const cx = Math.floor(x * this.inv) & 0xffff;
    const cy = Math.floor(y * this.inv) & 0xffff;
    const k = ((cx << 16) | cy) | 0;
    let h = Math.imul(k ^ (k >>> 15), 0x2c1b3c6d);
    h ^= h >>> 12;
    const slot = h & (SLOTS - 1);
    if (this.key[slot] !== k || now - this.start[slot] > this.window || now < this.start[slot]) {
      this.key[slot] = k;
      this.start[slot] = now;
      this.count[slot] = 0;
    }
    const n = this.count[slot];
    if (n < 255) this.count[slot] = n + 1;
    return n;
  }

  clear(): void {
    this.key.fill(EMPTY);
  }
}

/**
 * Per-frame proximity accumulator: weights recorded at points, and the weight already recorded within `near` of a
 * point. Unlike a cell grid it never splits two coincident things across a cell boundary. An optional third
 * coordinate `z` (e.g. a circle's radius) takes part in the distance, so only shapes alike in it count as near.
 * O(n) per query with n capped (a frame's ground lights or telegraphs), allocation-free; reset() once per frame.
 */
export class Proximity {
  private readonly xs: Float32Array;
  private readonly ys: Float32Array;
  private readonly zs: Float32Array;
  private readonly ws: Float32Array;
  private readonly near2: number;
  private n = 0;

  constructor(private readonly cap: number, near: number) {
    this.xs = new Float32Array(cap);
    this.ys = new Float32Array(cap);
    this.zs = new Float32Array(cap);
    this.ws = new Float32Array(cap);
    this.near2 = near * near;
  }

  reset(): void {
    this.n = 0;
  }

  /** Summed weight recorded within `near` of (x, y, z) so far this frame. */
  sum(x: number, y: number, z = 0): number {
    let s = 0;
    for (let i = 0; i < this.n; i++) {
      const dx = this.xs[i] - x;
      const dy = this.ys[i] - y;
      const dz = this.zs[i] - z;
      if (dx * dx + dy * dy + dz * dz < this.near2) s += this.ws[i];
    }
    return s;
  }

  /** Record weight `w` at (x, y, z) (ignored once full: later points then see a lower sum, never a higher one). */
  add(x: number, y: number, w: number, z = 0): void {
    if (this.n >= this.cap) return;
    this.xs[this.n] = x;
    this.ys[this.n] = y;
    this.zs[this.n] = z;
    this.ws[this.n] = w;
    this.n++;
  }
}
