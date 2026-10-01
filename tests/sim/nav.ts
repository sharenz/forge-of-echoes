// Walking around scenery for the scripted players (tests/sim/bot.ts and the event policies in tests/sim-events/sweep.ts).
//
// The bot used to steer in straight lines with a soft push away from props. That is fine on open ground and in a field of
// pillars, but a hand-crafted layout has real walls (the church of Glass Sepulchre, the moat of Hollow Ossuary): a goal on the far
// side of a wall pinned the bot against it for the rest of the run. `Nav.steer` returns the point to walk toward: the goal itself
// while the straight line is clear (so open-ground play is exactly what it always was), otherwise the farthest visible point of
// a shortest path over a coarse grid of walkable cells (BFS from the goal, cached while the goal stays in its cell).
//
// Everything is deterministic: no RNG, fixed neighbour order, ties broken by cell index.
import { PLAYER_RADIUS } from '../../src/sim/constants';

export interface NavProp {
  x: number;
  y: number;
  radius: number;
}

const CELL = 8;
/** A cell is blocked when its centre lies within a prop's radius plus this (player radius, a little margin, half a cell of sampling error). */
const BLOCK_MARGIN = PLAYER_RADIUS + 1;
const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
];
/** How far along the path (cells) the bot looks for the farthest visible waypoint. */
const LOOKAHEAD = 40;
/** Once a detour is needed, keep following the path for at least this many calls even if the straight line clears. */
const HOLD = 45;

export class Nav {
  private n = 0;
  private size = 0;
  private blocked = new Uint8Array(0);
  private sig = '';
  private goalCell = -1;
  private dist = new Int32Array(0);
  private queue = new Int32Array(0);
  private fieldAge = 0;
  /** Calls left in which a clear straight line does not cancel an ongoing detour (stops flip-flopping at the edge of a line of sight). */
  private hold = 0;
  private lastGoal: { x: number; y: number } | null = null;
  private goalAge = 0;

  /** (Re)build the blocked grid when the solid props or the arena changed. */
  private sync(props: readonly NavProp[], arenaRadius: number): void {
    let h = 0;
    let count = 0;
    for (let k = 0; k < props.length; k++) {
      const p = props[k];
      if (!(p.radius > 0)) continue;
      count++;
      h = (h * 31 + Math.round(p.x * 4) * 7 + Math.round(p.y * 4) * 13 + Math.round(p.radius * 4)) | 0;
    }
    const sig = `${Math.round(arenaRadius)}:${count}:${h}`;
    if (sig === this.sig) return;
    this.sig = sig;
    this.n = Math.ceil(arenaRadius / CELL) + 1;
    this.size = this.n * 2;
    this.blocked = new Uint8Array(this.size * this.size);
    this.dist = new Int32Array(this.size * this.size);
    this.queue = new Int32Array(this.size * this.size);
    this.goalCell = -1;
    const lim = arenaRadius - PLAYER_RADIUS - 2;
    for (let j = 0; j < this.size; j++) {
      for (let i = 0; i < this.size; i++) {
        const x = (i - this.n + 0.5) * CELL;
        const y = (j - this.n + 0.5) * CELL;
        if (x * x + y * y > lim * lim) this.blocked[j * this.size + i] = 1;
      }
    }
    for (let k = 0; k < props.length; k++) {
      const p = props[k];
      if (!(p.radius > 0)) continue;
      const reach = p.radius + BLOCK_MARGIN;
      const i0 = Math.max(0, Math.floor((p.x - reach) / CELL) + this.n);
      const i1 = Math.min(this.size - 1, Math.floor((p.x + reach) / CELL) + this.n);
      const j0 = Math.max(0, Math.floor((p.y - reach) / CELL) + this.n);
      const j1 = Math.min(this.size - 1, Math.floor((p.y + reach) / CELL) + this.n);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const dx = (i - this.n + 0.5) * CELL - p.x;
          const dy = (j - this.n + 0.5) * CELL - p.y;
          if (dx * dx + dy * dy < reach * reach) this.blocked[j * this.size + i] = 1;
        }
      }
    }
  }

  private cellOf(x: number, y: number): number {
    const i = Math.floor(x / CELL) + this.n;
    const j = Math.floor(y / CELL) + this.n;
    if (i < 0 || j < 0 || i >= this.size || j >= this.size) return -1;
    return j * this.size + i;
  }

  private centre(k: number): { x: number; y: number } {
    const i = k % this.size;
    const j = (k - i) / this.size;
    return { x: (i - this.n + 0.5) * CELL, y: (j - this.n + 0.5) * CELL };
  }

  /** The nearest unblocked cell to a point (the point's own when free), searched in growing squares. */
  private freeCellNear(x: number, y: number): number {
    const c = this.cellOf(x, y);
    if (c >= 0 && !this.blocked[c]) return c;
    const ci = Math.floor(x / CELL) + this.n;
    const cj = Math.floor(y / CELL) + this.n;
    for (let r = 1; r <= 14; r++) {
      let best = -1;
      let bd = Infinity;
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = ci + di;
          const j = cj + dj;
          if (i < 0 || j < 0 || i >= this.size || j >= this.size) continue;
          const k = j * this.size + i;
          if (this.blocked[k]) continue;
          const q = this.centre(k);
          const d = (q.x - x) * (q.x - x) + (q.y - y) * (q.y - y);
          if (d < bd) {
            bd = d;
            best = k;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** True when the straight segment between two points crosses no blocked cell. */
  private clearLine(ax: number, ay: number, bx: number, by: number): boolean {
    const len = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.ceil(len / 4));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const k = this.cellOf(ax + (bx - ax) * t, ay + (by - ay) * t);
      if (k < 0 || this.blocked[k]) return false;
    }
    return true;
  }

  private flood(goal: number): void {
    this.dist.fill(-1);
    this.goalCell = goal;
    this.fieldAge = 0;
    let head = 0;
    let tail = 0;
    this.dist[goal] = 0;
    this.queue[tail++] = goal;
    const size = this.size;
    while (head < tail) {
      const k = this.queue[head++];
      const i = k % size;
      const j = (k - i) / size;
      const d = this.dist[k] + 1;
      for (const [di, dj] of NEIGHBOURS) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= size || nj >= size) continue;
        const nk = nj * size + ni;
        if (this.blocked[nk] || this.dist[nk] >= 0) continue;
        if (di && dj && (this.blocked[j * size + ni] || this.blocked[nj * size + i])) continue;
        this.dist[nk] = d;
        this.queue[tail++] = nk;
      }
    }
  }

  /**
   * The point to walk toward from (px, py) to reach (gx, gy): the goal itself when the straight line is clear or the goal is
   * unreachable (the old straight-line behaviour), else the farthest visible waypoint along the shortest path.
   */
  steer(props: readonly NavProp[], arenaRadius: number, px: number, py: number, gx: number, gy: number): { x: number; y: number } {
    if (Math.hypot(gx - px, gy - py) < 30) return { x: gx, y: gy };
    this.sync(props, arenaRadius);
    if (this.clearLine(px, py, gx, gy)) {
      if (this.hold <= 0) return { x: gx, y: gy };
      this.hold--;
    } else {
      this.hold = HOLD;
    }
    const goal = this.freeCellNear(gx, gy);
    if (goal < 0) return { x: gx, y: gy };
    // The field is reused while the goal stays in its cell; a field of a moving goal is refreshed every 20 calls at most.
    if (goal !== this.goalCell || (this.fieldAge++ > 600)) this.flood(goal);
    let cur = this.cellOf(px, py);
    if (cur < 0) return { x: gx, y: gy };
    if (this.dist[cur] < 0) {
      // Standing in a blocked cell (hugging a prop): step to the reachable neighbour with the smallest distance.
      cur = this.bestNeighbour(cur, true);
      if (cur < 0) return { x: gx, y: gy };
    }
    if (this.dist[cur] < 0) return { x: gx, y: gy };
    let target = cur;
    for (let s = 0; s < LOOKAHEAD; s++) {
      const next = this.bestNeighbour(cur, false);
      if (next < 0 || next === cur) break;
      cur = next;
      const q = this.centre(cur);
      if (this.clearLine(px, py, q.x, q.y)) target = cur;
      if (this.dist[cur] === 0) break;
    }
    const q = this.centre(target);
    return q;
  }

  /**
   * For movers that only know a heading (the event policies steer straight along their own "toward the goal" vector): when a wall
   * stands in the way along (dx, dy) within `reach` u, the unit heading to walk instead, taken toward the first open ground past it
   * (which lies on the way to a goal beyond the wall); otherwise the heading unchanged.
   */
  around(props: readonly NavProp[], arenaRadius: number, px: number, py: number, dx: number, dy: number, reach = 200): { x: number; y: number } {
    const l = Math.hypot(dx, dy);
    if (l < 1e-6) return { x: dx, y: dy };
    const ux = dx / l;
    const uy = dy / l;
    this.sync(props, arenaRadius);
    // A detour under way keeps its goal (a fresh one every tick would flip sides at the slightest change of heading).
    if (this.goalAge++ > 240) this.lastGoal = null;
    const lg = this.lastGoal;
    if (lg && this.hold > 0 && Math.hypot(lg.x - px, lg.y - py) > 30 && (lg.x - px) * ux + (lg.y - py) * uy > 0.3 * Math.hypot(lg.x - px, lg.y - py)) {
      const wp = this.steer(props, arenaRadius, px, py, lg.x, lg.y);
      const wl = Math.hypot(wp.x - px, wp.y - py);
      if (wl > 1e-3) return { x: (wp.x - px) / wl, y: (wp.y - py) / wl };
    }
    let t = 6;
    let hit = -1;
    for (; t <= reach; t += 6) {
      const k = this.cellOf(px + ux * t, py + uy * t);
      if (k < 0) return { x: ux, y: uy };
      if (this.blocked[k]) {
        hit = t;
        break;
      }
    }
    if (hit < 0) {
      return { x: ux, y: uy };
    }
    for (t = hit; t <= reach + 240; t += 6) {
      const k = this.cellOf(px + ux * t, py + uy * t);
      if (k < 0) return { x: ux, y: uy };
      if (!this.blocked[k]) {
        this.lastGoal = { x: px + ux * (t + 16), y: py + uy * (t + 16) };
        this.goalAge = 0;
        const wp = this.steer(props, arenaRadius, px, py, this.lastGoal.x, this.lastGoal.y);
        const wl = Math.hypot(wp.x - px, wp.y - py);
        return wl < 1e-3 ? { x: ux, y: uy } : { x: (wp.x - px) / wl, y: (wp.y - py) / wl };
      }
    }
    return { x: ux, y: uy };
  }

  private bestNeighbour(k: number, allowBlockedSelf: boolean): number {
    const size = this.size;
    const i = k % size;
    const j = (k - i) / size;
    let best = -1;
    let bd = allowBlockedSelf ? Infinity : this.dist[k];
    for (const [di, dj] of NEIGHBOURS) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= size || nj >= size) continue;
      const nk = nj * size + ni;
      const d = this.dist[nk];
      if (d < 0) continue;
      if (di && dj && !allowBlockedSelf && (this.blocked[j * size + ni] || this.blocked[nj * size + i])) continue;
      if (d < bd) {
        bd = d;
        best = nk;
      }
    }
    return best;
  }
}
