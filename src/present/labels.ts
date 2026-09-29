// Drop-label stacking (pure, allocation-free after construction). The resolved boxes (x, top, w, h) are also what
// Presenter.dropAt hit-tests, so a click lands on exactly the plate the player sees.
//
// Every label wants to sit centred above its drop. Overlapping plates are resolved greedily, nearest-to-camera
// first: labels are placed in order of their desired position from the bottom of the screen up (ties broken by a
// stable key, so a pile of loot never reshuffles between frames), and a label that would overlap one already
// placed hops to just above it, repeatedly, until it is clear. Labels only ever move up, so the loop terminates
// and the item closest to the player keeps its label right on top of it.

export class LabelStacker {
  private cap: number;
  private xs: Float32Array; // centre x
  private ys: Float32Array; // desired top y → resolved top y
  private ws: Float32Array;
  private hs: Float32Array;
  private keys: Float64Array;
  private order: Int32Array;
  private placed: Int32Array;
  count = 0;

  constructor(capacity = 64) {
    this.cap = capacity;
    this.xs = new Float32Array(capacity);
    this.ys = new Float32Array(capacity);
    this.ws = new Float32Array(capacity);
    this.hs = new Float32Array(capacity);
    this.keys = new Float64Array(capacity);
    this.order = new Int32Array(capacity);
    this.placed = new Int32Array(capacity);
  }

  get capacity(): number {
    return this.cap;
  }

  reset(): void {
    this.count = 0;
  }

  /**
   * Add a label: centre x, desired top y, width, height, and a stable key (e.g. the drop id). Returns its index,
   * or −1 when full.
   */
  add(cx: number, top: number, w: number, h: number, key: number): number {
    if (this.count >= this.cap) return -1;
    const i = this.count++;
    this.xs[i] = cx;
    this.ys[i] = top;
    this.ws[i] = w;
    this.hs[i] = h;
    this.keys[i] = key;
    return i;
  }

  /** Resolve overlaps; `gap` is the vertical spacing kept between stacked plates. */
  solve(gap = 1): void {
    const n = this.count;
    const order = this.order;
    for (let i = 0; i < n; i++) order[i] = i;
    // Insertion sort by desired bottom (descending), then key: n is small and mostly sorted frame to frame.
    for (let i = 1; i < n; i++) {
      const v = order[i];
      let j = i - 1;
      while (j >= 0 && this.before(v, order[j])) {
        order[j + 1] = order[j];
        j--;
      }
      order[j + 1] = v;
    }
    const placed = this.placed;
    let np = 0;
    const xs = this.xs;
    const ys = this.ys;
    const ws = this.ws;
    const hs = this.hs;
    for (let k = 0; k < n; k++) {
      const i = order[k];
      const left = xs[i] - ws[i] / 2;
      const right = xs[i] + ws[i] / 2;
      let top = ys[i];
      // Hop above any overlapping placed label until clear (bounded by the number of placed labels).
      for (let guard = 0; guard <= np; guard++) {
        let moved = false;
        for (let q = 0; q < np; q++) {
          const j = placed[q];
          const jl = xs[j] - ws[j] / 2;
          const jr = xs[j] + ws[j] / 2;
          if (right <= jl || left >= jr) continue;
          const jt = ys[j];
          const jb = jt + hs[j];
          if (top + hs[i] + gap <= jt || top >= jb + gap) continue;
          top = jt - hs[i] - gap;
          moved = true;
        }
        if (!moved) break;
      }
      ys[i] = top;
      placed[np++] = i;
    }
  }

  /** Resolved top y of label i. */
  top(i: number): number {
    return this.ys[i];
  }

  x(i: number): number {
    return this.xs[i];
  }

  /** Width of label i (as added). */
  w(i: number): number {
    return this.ws[i];
  }

  /** Height of label i (as added). */
  h(i: number): number {
    return this.hs[i];
  }

  private before(a: number, b: number): boolean {
    const ba = this.ys[a] + this.hs[a];
    const bb = this.ys[b] + this.hs[b];
    if (ba !== bb) return ba > bb;
    return this.keys[a] < this.keys[b];
  }
}
