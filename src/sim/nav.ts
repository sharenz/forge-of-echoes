// Monster wall navigation for hand-crafted layouts (docs/atlas-rework/D-territory.md 10.5a).
//
// Monsters steer straight at their target (behaviour.ts steer); a layout has real walls, so a pack standing on the far side of one
// pressed against it for ever. This file adds a cheap, deterministic detour that leaves every brain alone while the way is clear:
//
//  1. A coarse grid of walkable cells (NAV_CELL u), built once per layout from the solid props at monster clearance and rebuilt when
//     the set of solid props changes (event props, destructibles): the "blocked" bytes.
//  2. A flow field per target player: a breadth-first flood from the player's cell (distance + next-hop per cell), refreshed at a low
//     rate (FIELD_INTERVAL ticks, at most FIELD_BUDGET floods per tick) and only while some monster needs it. Shared by every monster
//     that targets that player.
//  3. After a brain has set a monster's velocity, `navSteer` checks (every LINE_PERIOD ticks, staggered per slot) whether the straight
//     line to the target is blocked by a solid prop. Only then, and only for a monster that is walking toward the target, is the
//     velocity re-aimed at the cell NAV_LOOK hops further down the field (same speed). A clear line, a retreating monster, any attack
//     state, ghosts, event-script monsters and old-generator maps are not touched: tuned behaviour is unchanged where the way is open.
//  4. Last resort: a non-boss monster held behind scenery (blocked line, moved < STALL_MOVED u) for STALL_NUDGE s is pushed one step along
//     the field every half second; after STALL_RELOCATE s it is moved to the nearest free point of a spawn lane that no player can see
//     and that is connected to the target. Counted in `navStats`.
//
// No RNG anywhere: every choice is a pure function of the world state in a fixed iteration order.
import { PACK_MIN_DISTANCE } from './constants';
import { resolveProps } from './grid';
import { MFLAG, MSTATE } from './stores';
import type { PlayerState, World } from './world';

const NAV_CELL = 16;
/** Clearance kept around a solid prop (a mid-sized monster body; larger ones slide on the ordinary prop resolution). */
const NAV_CLEAR = 11;
/** Extra block margin for a cell whose centre stands this share of a cell from the prop (sampling error). */
const NAV_MARGIN = NAV_CELL * 0.45;
/** Hops ahead on the field the monster aims at (smooths the zigzag of an eight-neighbour flood). */
const NAV_LOOK = 3;
const LINE_PERIOD = 8;
const LINE_STEP = 8;
const FIELD_INTERVAL = 20;
const FIELD_BUDGET = 2;
const SYNC_PERIOD = 30;
const STALL_PERIOD = 30;
const STALL_MOVED = 16;
const STALL_NUDGE = 4;
const STALL_RELOCATE = 8;
/** A relocation point is at least this far from every living player (off screen). */
const UNSEEN = Math.max(PACK_MIN_DISTANCE, 640);
const LANE_SAMPLE = 48;

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

export interface NavStats {
  /** Monsters moved out of a pin to a lane point out of view. */
  relocated: number;
  /** Half-second nudges along the field. */
  nudged: number;
  /** Floods run. */
  floods: number;
  /** Ticks-monsters spent following the field (activity measure). */
  followTicks: number;
  /** Rebuilds of the blocked grid. */
  rebuilds: number;
}

interface Field {
  dist: Int16Array;
  nxt: Int32Array;
  goal: number;
  pcell: number;
  tick: number;
  valid: boolean;
}

class Nav {
  readonly n: number;
  readonly half: number;
  readonly blocked: Uint8Array;
  private readonly queue: Int32Array;
  private sig = '';
  readonly fields: Field[] = [];
  floodsThisTick = 0;
  floodTick = -1;
  readonly stats: NavStats = { relocated: 0, nudged: 0, floods: 0, followTicks: 0, rebuilds: 0 };
  // Per monster slot.
  readonly owner: Uint32Array;
  readonly line: Uint8Array;
  readonly lineTick: Int32Array;
  readonly anchorX: Float32Array;
  readonly anchorY: Float32Array;
  readonly anchorT: Float32Array;
  readonly nudgedAt: Float32Array;
  /** Belt drift (u) a monster has been carried since its stall anchor was set: stallCheck measures movement net of it. */
  readonly driftX: Float32Array;
  readonly driftY: Float32Array;
  /** Relocation candidates: lane samples (or a ring when the layout has no lanes). */
  readonly spawnPoints: { x: number; y: number }[] = [];

  constructor(w: World) {
    this.n = Math.max(8, Math.ceil((w.arenaRadius * 2) / NAV_CELL) + 2);
    this.half = (this.n * NAV_CELL) / 2;
    this.blocked = new Uint8Array(this.n * this.n);
    this.queue = new Int32Array(this.n * this.n);
    const cap = w.monsters.capacity;
    this.owner = new Uint32Array(cap);
    this.line = new Uint8Array(cap);
    this.lineTick = new Int32Array(cap);
    this.anchorX = new Float32Array(cap);
    this.anchorY = new Float32Array(cap);
    this.anchorT = new Float32Array(cap);
    this.nudgedAt = new Float32Array(cap);
    this.driftX = new Float32Array(cap);
    this.driftY = new Float32Array(cap);
    this.collectSpawnPoints(w);
    this.sync(w, true);
  }

  private collectSpawnPoints(w: World): void {
    const c = w.layout?.compiled;
    const R = w.arenaRadius;
    const lim = R - 80;
    if (c) {
      for (const lane of c.lanes) {
        if (lane.path.length === 0 || lane.length <= 0) continue;
        for (let s = 0; s <= lane.length; s += LANE_SAMPLE) {
          const p = pointOnPath(lane.path, s);
          if (p.x * p.x + p.y * p.y <= lim * lim) this.spawnPoints.push(p);
        }
      }
    }
    if (this.spawnPoints.length === 0) {
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2;
        this.spawnPoints.push({ x: Math.cos(a) * lim * 0.8, y: Math.sin(a) * lim * 0.8 });
      }
    }
  }

  cellOf(x: number, y: number): number {
    const i = Math.floor((x + this.half) / NAV_CELL);
    const j = Math.floor((y + this.half) / NAV_CELL);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return -1;
    return j * this.n + i;
  }

  cx(k: number): number {
    return ((k % this.n) + 0.5) * NAV_CELL - this.half;
  }

  cy(k: number): number {
    return (Math.floor(k / this.n) + 0.5) * NAV_CELL - this.half;
  }

  /** Rebuild the blocked grid when the solid props changed (cheap signature; checked every SYNC_PERIOD ticks). */
  sync(w: World, force = false): void {
    let count = 0;
    for (let k = 0; k < w.props.length; k++) if (w.props[k].solid) count++;
    const sig = `${count}:${w.nextPropId}:${w.props.length}`;
    if (!force && sig === this.sig) return;
    this.sig = sig;
    this.stats.rebuilds++;
    const n = this.n;
    const b = this.blocked;
    b.fill(0);
    const lim = w.arenaRadius - 14;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = (i + 0.5) * NAV_CELL - this.half;
        const y = (j + 0.5) * NAV_CELL - this.half;
        if (x * x + y * y > lim * lim) b[j * n + i] = 1;
      }
    }
    for (let k = 0; k < w.props.length; k++) {
      const p = w.props[k];
      if (!p.solid) continue;
      const reach = p.radius + NAV_CLEAR + NAV_MARGIN;
      const i0 = Math.max(0, Math.floor((p.x - reach + this.half) / NAV_CELL));
      const i1 = Math.min(n - 1, Math.floor((p.x + reach + this.half) / NAV_CELL));
      const j0 = Math.max(0, Math.floor((p.y - reach + this.half) / NAV_CELL));
      const j1 = Math.min(n - 1, Math.floor((p.y + reach + this.half) / NAV_CELL));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const dx = (i + 0.5) * NAV_CELL - this.half - p.x;
          const dy = (j + 0.5) * NAV_CELL - this.half - p.y;
          if (dx * dx + dy * dy < reach * reach) b[j * n + i] = 1;
        }
      }
    }
    for (const f of this.fields) f.valid = false; // the walls moved: every field is stale
  }

  /** The nearest free cell to `c` (itself when free), looking up to `maxR` rings out; -1 when none. */
  freeNear(c: number, maxR: number): number {
    if (c < 0) return -1;
    if (!this.blocked[c]) return c;
    const n = this.n;
    const ci = c % n;
    const cj = (c - ci) / n;
    for (let r = 1; r <= maxR; r++) {
      let best = -1;
      let bd = Infinity;
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = ci + di;
          const j = cj + dj;
          if (i < 0 || j < 0 || i >= n || j >= n) continue;
          const k = j * n + i;
          if (this.blocked[k]) continue;
          const d = di * di + dj * dj;
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

  /** Breadth-first flood from `goal` over free cells (diagonals only when both sides are free). */
  flood(f: Field, goal: number): void {
    const n = this.n;
    const dist = f.dist;
    const nxt = f.nxt;
    dist.fill(-1);
    nxt.fill(-1);
    const q = this.queue;
    const b = this.blocked;
    let head = 0;
    let tail = 0;
    dist[goal] = 0;
    q[tail++] = goal;
    while (head < tail) {
      const k = q[head++];
      const i = k % n;
      const j = (k - i) / n;
      const d = dist[k] + 1;
      for (let s = 0; s < 8; s++) {
        const ni = i + DX[s];
        const nj = j + DY[s];
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const nk = nj * n + ni;
        if (b[nk] || dist[nk] >= 0) continue;
        if (s >= 4 && (b[j * n + ni] || b[nj * n + i])) continue;
        dist[nk] = d;
        nxt[nk] = k;
        q[tail++] = nk;
      }
    }
    f.goal = goal;
  }

  /** The field for player slot `k`, refreshed lazily at a low rate; null when the player stands somewhere unreachable. */
  field(w: World, k: number, p: PlayerState): Field | null {
    let f = this.fields[k];
    if (!f) {
      f = this.fields[k] = { dist: new Int16Array(this.n * this.n), nxt: new Int32Array(this.n * this.n), goal: -1, pcell: -1, tick: -1e9, valid: false };
    }
    const pc = this.cellOf(p.x, p.y);
    const age = w.tick - f.tick;
    if (this.floodTick !== w.tick) {
      this.floodTick = w.tick;
      this.floodsThisTick = 0;
    }
    const stale = !f.valid || (age >= FIELD_INTERVAL && pc !== f.pcell) || age >= FIELD_INTERVAL * 6;
    if (stale && (!f.valid || age >= FIELD_INTERVAL * 3 || this.floodsThisTick < FIELD_BUDGET)) {
      this.floodsThisTick++;
      this.stats.floods++;
      f.tick = w.tick;
      f.pcell = pc;
      const goal = this.freeNear(pc, 4);
      if (goal < 0) {
        f.valid = false;
        f.tick = w.tick - FIELD_INTERVAL * 2; // retry soon
        return null;
      }
      this.flood(f, goal);
      f.valid = true;
    }
    return f.valid ? f : null;
  }
}

function pointOnPath(path: readonly { x: number; y: number }[], s: number): { x: number; y: number } {
  let left = s;
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1];
    const b = path[k];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= l || k === path.length - 1) {
      const t = l > 0 ? Math.min(1, left / l) : 0;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    left -= l;
  }
  return { x: path[0].x, y: path[0].y };
}

const navs = new WeakMap<World, Nav>();

/** The navigation state of a layout world (null for the old procedural arenas and the hideout: they never navigate). */
function navOf(w: World): Nav | null {
  if (!w.layout) return null;
  let nav = navs.get(w);
  if (!nav) {
    nav = new Nav(w);
    navs.set(w, nav);
  }
  return nav;
}

/** Debug counters of a world's navigation (null when it has none). */
export function navStats(w: World): Readonly<NavStats> | null {
  return navs.get(w)?.stats ?? null;
}

let enabled = true;

/** Tests and tools: switch monster navigation off (A/B comparisons in the sweeps) or on again. */
export function setNavEnabled(on: boolean): void {
  enabled = on;
}

/**
 * ai.ts integrate: monster `i` was carried (dx, dy) u by a flow zone this tick. Recorded so the anti-stuck rules measure only the
 * monster's own movement: drift along a rail is neither progress nor a reason to forgive a stall.
 */
export function navDrift(w: World, i: number, dx: number, dy: number): void {
  const nav = navs.get(w);
  if (!nav) return;
  nav.driftX[i] += dx;
  nav.driftY[i] += dy;
}

/** Called once per tick before the monster loop: keeps the blocked grid in step with the solid props. */
export function navBeginTick(w: World): Nav | null {
  const nav = enabled ? navOf(w) : null;
  if (nav && w.tick % SYNC_PERIOD === 0) nav.sync(w);
  return nav;
}

/** True when a body of radius `r` walking the straight line (ax, ay) -> (bx, by) would touch a solid prop. */
function lineBlocked(w: World, ax: number, ay: number, bx: number, by: number, r: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.ceil(len / LINE_STEP);
  const grid = w.propGrid;
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    const x = ax + dx * t;
    const y = ay + dy * t;
    const list = grid.near(x, y);
    for (let k = 0; k < list.length; k++) {
      const p = list[k];
      const ex = x - p.x;
      const ey = y - p.y;
      const rr = p.radius + r;
      if (ex * ex + ey * ey < rr * rr) return true;
    }
  }
  return false;
}

/**
 * Re-aim monster `i`'s velocity round the walls between it and its target `t` (dx, dy, d: the vector to it and its length).
 * Returns true when the field steered it. Call after the brain, before integration; `hunting`/`chase` gates are checked here.
 * `owned` marks monsters an event script drives (never navigated, never relocated).
 */
export function navSteer(w: World, nav: Nav, i: number, t: PlayerState, dx: number, dy: number, d: number, hunting: boolean, owned: boolean): boolean {
  const m = w.monsters;
  const fl = m.flags[i];
  if (!hunting || owned || t.dead || d < 30 || m.state[i] !== MSTATE.chase || fl & (MFLAG.ghost | MFLAG.frozen | MFLAG.fixture)) {
    if (nav.owner[i] === m.id[i]) nav.line[i] = 0;
    return false;
  }
  const id = m.id[i];
  const x = m.x[i];
  const y = m.y[i];
  const fresh = nav.owner[i] !== id;
  if (fresh) {
    nav.owner[i] = id;
    nav.line[i] = 0;
    nav.lineTick[i] = -1e9;
    nav.anchorX[i] = x;
    nav.anchorY[i] = y;
    nav.anchorT[i] = w.time;
    nav.nudgedAt[i] = 0;
    nav.driftX[i] = 0;
    nav.driftY[i] = 0;
  }
  if (w.tick - nav.lineTick[i] >= LINE_PERIOD && (w.tick + i) % LINE_PERIOD === 0) {
    nav.lineTick[i] = w.tick;
    const r = m.radius[i];
    const was = nav.line[i];
    nav.line[i] = lineBlocked(w, x, y, t.x, t.y, r < 8 ? 8 : r > 16 ? 16 : r) ? 1 : 0;
    if (!was && nav.line[i]) {
      nav.anchorX[i] = x;
      nav.anchorY[i] = y;
      nav.anchorT[i] = w.time;
      nav.driftX[i] = 0;
      nav.driftY[i] = 0;
    }
  }
  if (!nav.line[i]) return false;
  // A monster held at range (an archer, a kiter) with a wall between it and its target has nothing to shoot at: it walks the field
  // too, at its own pace, until the line clears (a brain that stands still reports a velocity of zero).
  let sp = Math.sqrt(m.vx[i] * m.vx[i] + m.vy[i] * m.vy[i]);
  if (sp < 1) sp = m.speed[i];
  if (sp < 1) return false;
  let k = 0;
  const players = w.players;
  for (; k < players.length; k++) if (players[k] === t) break;
  const f = nav.field(w, k, t);
  if (!f) return false;
  let c = nav.cellOf(x, y);
  if (c < 0) return false;
  if (f.dist[c] < 0) c = reachableNear(nav, f, c);
  if (c < 0) return false;

  // Pinned for good? Count only monsters held against scenery (blocked line, barely moved).
  const sinceMove = stallCheck(w, nav, i, x, y);
  let look = NAV_LOOK;
  if (sinceMove >= STALL_NUDGE && !(fl & MFLAG.boss)) {
    if (sinceMove >= STALL_RELOCATE) {
      if (relocate(w, nav, i, f)) return false;
    } else if (w.tick % STALL_PERIOD === i % STALL_PERIOD) {
      nudge(w, nav, i, f, c);
    }
    look = NAV_LOOK + 3;
  }
  let q = c;
  for (let s = 0; s < look; s++) {
    const nx = f.nxt[q];
    if (nx < 0) break;
    q = nx;
  }
  const wx = nav.cx(q) - x;
  const wy = nav.cy(q) - y;
  const wl = Math.sqrt(wx * wx + wy * wy);
  if (wl < 1e-3) return false;
  m.vx[i] = (wx / wl) * sp;
  m.vy[i] = (wy / wl) * sp;
  nav.stats.followTicks++;
  return true;
}

/** Seconds the monster has stayed within STALL_MOVED of its anchor while held behind scenery. */
function stallCheck(w: World, nav: Nav, i: number, x: number, y: number): number {
  // Movement net of the belt drift: a monster carried along a rail by a conveyor has not made headway of its own.
  const dx = x - nav.anchorX[i] - nav.driftX[i];
  const dy = y - nav.anchorY[i] - nav.driftY[i];
  if (dx * dx + dy * dy >= STALL_MOVED * STALL_MOVED) {
    nav.anchorX[i] = x;
    nav.anchorY[i] = y;
    nav.anchorT[i] = w.time;
    nav.driftX[i] = 0;
    nav.driftY[i] = 0;
    return 0;
  }
  return w.time - nav.anchorT[i];
}

/** The reachable cell nearest to a blocked/unreachable one (a monster hugging a wall stands inside the clearance margin). */
function reachableNear(nav: Nav, f: Field, c: number): number {
  const n = nav.n;
  const ci = c % n;
  const cj = (c - ci) / n;
  let best = -1;
  let bd = 1e9;
  for (let r = 1; r <= 3; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const ii = ci + di;
        const jj = cj + dj;
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const k = jj * n + ii;
        const dd = f.dist[k];
        if (dd < 0) continue;
        const score = dd * 4 + r; // nearest to the goal along the field, then nearest to us
        if (score < bd) {
          bd = score;
          best = k;
        }
      }
    }
    if (best >= 0) return best;
  }
  return -1;
}

/** One step (1.5 cells) along the field, if the spot is free of props. */
function nudge(w: World, nav: Nav, i: number, f: Field, c: number): void {
  const m = w.monsters;
  let q = c;
  for (let s = 0; s < 2; s++) {
    const nx = f.nxt[q];
    if (nx < 0) break;
    q = nx;
  }
  if (q === c) return;
  const tx = nav.cx(q);
  const ty = nav.cy(q);
  const dx = tx - m.x[i];
  const dy = ty - m.y[i];
  const l = Math.sqrt(dx * dx + dy * dy) || 1;
  const step = Math.min(l, NAV_CELL * 1.5);
  const nx = m.x[i] + (dx / l) * step;
  const ny = m.y[i] + (dy / l) * step;
  if (resolveProps(w.propGrid, nx, ny, m.radius[i]).hit) return;
  m.x[i] = nx;
  m.y[i] = ny;
  nav.stats.nudged++;
}

/** Move a long-pinned monster to the nearest free lane point out of every player's view that connects to its target. */
function relocate(w: World, nav: Nav, i: number, f: Field): boolean {
  const m = w.monsters;
  const r = m.radius[i];
  const unseen2 = UNSEEN * UNSEEN;
  let best = -1;
  let bd = Infinity;
  const pts = nav.spawnPoints;
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    let seen = false;
    for (let q = 0; q < w.living.length && !seen; q++) {
      const ex = w.living[q].x - p.x;
      const ey = w.living[q].y - p.y;
      seen = ex * ex + ey * ey < unseen2;
    }
    if (seen) continue;
    const c = nav.cellOf(p.x, p.y);
    if (c < 0 || f.dist[c] < 0) continue;
    if (resolveProps(w.propGrid, p.x, p.y, r + 6).hit) continue;
    const dx = p.x - m.x[i];
    const dy = p.y - m.y[i];
    const d2 = dx * dx + dy * dy;
    if (d2 < bd) {
      bd = d2;
      best = k;
    }
  }
  if (best < 0) {
    nav.anchorT[i] = w.time - (STALL_RELOCATE - 2); // nowhere unseen right now: look again in 2 s
    return false;
  }
  const p = pts[best];
  m.x[i] = p.x;
  m.y[i] = p.y;
  m.prevX[i] = p.x;
  m.prevY[i] = p.y;
  m.vx[i] = 0;
  m.vy[i] = 0;
  m.kbX[i] = 0;
  m.kbY[i] = 0;
  nav.anchorX[i] = p.x;
  nav.anchorY[i] = p.y;
  nav.anchorT[i] = w.time;
  nav.driftX[i] = 0;
  nav.driftY[i] = 0;
  nav.line[i] = 0;
  nav.stats.relocated++;
  return true;
}

export type { Nav };
