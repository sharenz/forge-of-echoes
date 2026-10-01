// Uniform spatial grids.
//  - SpatialGrid: monsters, rebuilt every tick with a counting sort (no allocation, cache-friendly).
//  - PropGrid: static solid props, each inserted into every cell it can touch, so a mover only
//    ever inspects the props of its own cell.
import type { MonsterStore } from './stores';
import { clamp } from './math';

export class SpatialGrid {
  readonly cell: number;
  readonly inv: number;
  readonly origin: number;
  readonly cols: number;
  readonly cellStart: Int32Array;
  readonly items: Int32Array;
  /** Largest radius among monsters in the last build (query padding). */
  maxRadius = 0;
  private readonly cursor: Int32Array;
  private readonly slotCell: Int32Array;

  /** Covers the square [-halfExtent, halfExtent]²; positions outside clamp to the border cells. */
  constructor(halfExtent: number, cellSize: number, capacity: number) {
    this.cell = cellSize;
    this.inv = 1 / cellSize;
    this.cols = Math.max(1, Math.ceil((halfExtent * 2) / cellSize));
    this.origin = -(this.cols * cellSize) / 2;
    const cells = this.cols * this.cols;
    this.cellStart = new Int32Array(cells + 1);
    this.cursor = new Int32Array(cells);
    this.items = new Int32Array(capacity);
    this.slotCell = new Int32Array(capacity);
  }

  col(v: number): number {
    return clamp(Math.floor((v - this.origin) * this.inv), 0, this.cols - 1);
  }

  build(m: MonsterStore): void {
    const counts = this.cursor;
    counts.fill(0);
    // Slots past the high-water mark are dead and never read (query only returns built items).
    const cap = m.hwm;
    const alive = m.alive;
    const xs = m.x;
    const ys = m.y;
    const rs = m.radius;
    const cols = this.cols;
    let maxR = 0;
    for (let i = 0; i < cap; i++) {
      if (!alive[i]) {
        this.slotCell[i] = -1;
        continue;
      }
      const c = this.col(ys[i]) * cols + this.col(xs[i]);
      this.slotCell[i] = c;
      counts[c]++;
      if (rs[i] > maxR) maxR = rs[i];
    }
    this.maxRadius = maxR;
    const start = this.cellStart;
    start[0] = 0;
    const cells = cols * cols;
    for (let c = 0; c < cells; c++) {
      start[c + 1] = start[c] + counts[c];
      counts[c] = start[c];
    }
    for (let i = 0; i < cap; i++) {
      const c = this.slotCell[i];
      if (c >= 0) this.items[counts[c]++] = i;
    }
  }

  /**
   * Writes monster slots from every cell overlapping the box into `out` and returns the count.
   * Candidates are not distance-filtered and may include slots that died since the rebuild.
   */
  query(minX: number, minY: number, maxX: number, maxY: number, out: Int32Array): number {
    const c0 = this.col(minX);
    const c1 = this.col(maxX);
    const r0 = this.col(minY);
    const r1 = this.col(maxY);
    const start = this.cellStart;
    const items = this.items;
    const limit = out.length;
    let n = 0;
    for (let r = r0; r <= r1; r++) {
      const rowBase = r * this.cols;
      for (let c = c0; c <= c1; c++) {
        const cell = rowBase + c;
        const end = start[cell + 1];
        for (let k = start[cell]; k < end && n < limit; k++) out[n++] = items[k];
      }
    }
    return n;
  }
}

export interface SolidCircle {
  x: number;
  y: number;
  radius: number;
  /** Tall cover: stops straight-flying projectiles (src/sim/cover.ts). */
  tall?: boolean;
}

export class PropGrid {
  private readonly cell: number;
  private readonly inv: number;
  private readonly origin: number;
  private readonly cols: number;
  private cells: SolidCircle[][];
  private readonly pad: number;
  /** How many tall-cover props were inserted (0 = shots never need a cover scan). */
  tallCount = 0;

  /** `pad` = largest radius of anything that collides with props. */
  constructor(halfExtent: number, cellSize: number, pad: number) {
    this.cell = cellSize;
    this.inv = 1 / cellSize;
    this.cols = Math.max(1, Math.ceil((halfExtent * 2) / cellSize));
    this.origin = -(this.cols * cellSize) / 2;
    this.pad = pad;
    this.cells = [];
    this.clear();
  }

  clear(): void {
    this.tallCount = 0;
    this.cells = [];
    for (let i = 0; i < this.cols * this.cols; i++) this.cells.push([]);
  }

  private col(v: number): number {
    return clamp(Math.floor((v - this.origin) * this.inv), 0, this.cols - 1);
  }

  insert(p: SolidCircle): void {
    if (p.radius <= 0) return;
    if (p.tall) this.tallCount++;
    const reach = p.radius + this.pad;
    const c0 = this.col(p.x - reach);
    const c1 = this.col(p.x + reach);
    const r0 = this.col(p.y - reach);
    const r1 = this.col(p.y + reach);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.cells[r * this.cols + c].push(p);
  }

  /** Solid props that a circle centred in this point's cell could touch. */
  near(x: number, y: number): readonly SolidCircle[] {
    return this.cells[this.col(y) * this.cols + this.col(x)];
  }
}

/** Scratch result for push-out helpers (avoids allocating tuples in hot loops). */
export const pushOut = { x: 0, y: 0, hit: false };

/**
 * Resolve a circle against nearby solid props: pushes it out of every overlap.
 * Result in `pushOut` (x, y, hit).
 */
export function resolveProps(grid: PropGrid, x: number, y: number, r: number): typeof pushOut {
  let px = x;
  let py = y;
  let hit = false;
  const list = grid.near(x, y);
  for (let k = 0; k < list.length; k++) {
    const p = list[k];
    const dx = px - p.x;
    const dy = py - p.y;
    const rr = p.radius + r;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr) continue;
    hit = true;
    const d = Math.sqrt(d2);
    if (d < 1e-4) {
      px = p.x + rr;
      continue;
    }
    const push = (rr - d) / d;
    px += dx * push;
    py += dy * push;
  }
  pushOut.x = px;
  pushOut.y = py;
  pushOut.hit = hit;
  return pushOut;
}
