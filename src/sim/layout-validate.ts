// The layout validator (docs/atlas-rework/D-territory.md 10.3): the seven checks every layout must pass before it can
// merge. Pure functions over a compiled layout (checks 1-6) plus a determinism check that builds real worlds (7).
// Used by the vitest suite (tests/layouts/*.test.ts, which blocks merge), `scripts/layout-lint.mjs`
// (`npm run layout:lint`, CLI output for PR review) and dev/layouts.html (shows the report).
//
//   1 bounds      every point inside 0.92 R; nothing solid inside the start clear; boss stage and anchors not in solids
//   2 reach       flood fill from the start: every lane, anchor, boss stage and zone reachable through corridors >= 24 u;
//                 every designed choke (wall gap) >= 96 u
//   3 space       no two landmarks overlap; solids <= 14% of the arena; a free 400 u disc near the boss stage and
//                 a free 300 u disc round the landing
//   4 charter     event anchors obey the Event Charter spacing (perch, echo, relay, fault, road)
//   5 cover       every Stalker perch has a solid cover prop on its line to the start, 140-380 u from the start
//   6 anchors     >= 4 perches, >= 2 of each kind the area claims as native, >= 1 of every other kind
//   7 determinism same seed -> same props; different seeds -> same landmarks/clusters/walls, different packs
//   9 flows       flow zones (conveyor belts, currents; D 10.5a): inside bounds and sane (speed < the player's, reversal timing,
//                 a random group never all one way); the landing and the boss stage stand on no flow; and for BOTH directions of
//                 every zone and during its reversal (scales 1, 0.5, 0.2) a body carried passively for 3 s ends within 3 s of
//                 ground off the belt (a belt never delivers anyone into a dead end he cannot leave against the flow)
//   8 pockets     no standing ground (a player of PLAYER_RADIUS, exact) that is cut off from the landing: a player who is
//                 knocked into a sealed pocket or a wedge could never leave it (flood fill on a 4 u grid); and every concave
//                 corner (a standing spot touching two or more solids) can be slid out of with the real movement code
//                 (src/sim/movement.ts resolvePlayerAt, the one the client predicts with)
//  11 hazards    burning ground on hazard decals (slag pools, lava cracks; roadmap 4): a non-empty footprint, a readable flare cycle
//                 (telegraph >= 1 s, every >= telegraph + active + 2 s), none on the start clearing and no always-burning one on the boss
//                 stage (a flaring crack may cross it: it warns before every flare)
//  10 seating     (E1, anchor-aware events) every anchor can seat its event: the event's footprint fits inside the rim
//                 (EVENT_ANCHOR_RIM) once the anchor slides at most ANCHOR_SEAT u towards the centre, and a slid anchor still
//                 stands clear of solids and reachable; relay anchors come as a triad (>= 3) or not at all
//
// Interpretation notes (one place to change them): "a 400 u disc" and "a 300 u disc" are read as DIAMETERS (free radius
// 200 around the boss stage, 150 round the landing; the default start clearing alone is 140 u), because a 400 u radius
// would not fit the 585 u Gatehouse; the flood fill runs on a 7 u grid (half the spec's 14 u) with a half-cell
// tolerance so that a corridor of exactly 24 u passes.
import type { AtlasAreaId } from '../contracts/atlas';
import type { RunConfig } from '../contracts/sim';
import { areaRadius, areaType, NATIVE_ANCHORS } from '../data/layouts/area';
import { ANCHOR_SEAT, EVENT_ANCHOR_RIM, seatAnchor } from '../data/progression/events/anchors';
import { RELAY_BRAZIERS } from '../data/progression/map-events';
import {
  compileLayout, distToPath, distToSegment, pathLength, type CompiledLayout, type CompiledProp, type XY,
} from '../data/layouts/compile';
import { overrideLayout } from '../data/layouts';
import { FLOW_PLAYER, FLOW_RAMP, FLOW_TELEGRAPH, buildFlowField, flowOut, flowVelocity } from '../data/layouts/flow';
import { hazardHits } from '../data/layouts/hazards';
import { EVENT_ANCHOR_KINDS, type AreaLayout, type EventAnchorKind } from '../data/layouts/schema';
import type { PropView } from '../contracts/sim';
import { PLAYER_RADIUS } from './constants';
import { resolvePlayerAt } from './movement';
import { createRunInternal, stepWorld } from './run';

export const LAYOUT_RULES = {
  /** Every point must lie inside this fraction of R. */
  maxRadiusFrac: 0.92,
  /** Narrowest corridor (2 x PLAYER_RADIUS + 10) and the narrowest designed choke (Stalker pounce 34 u disc), in u. */
  corridor: 2 * PLAYER_RADIUS + 10,
  choke: 96,
  /** Flood-fill grid step (u) and its tolerance (half a step). */
  gridStep: 7,
  maxSolidDensity: 0.14,
  bossFreeRadius: 200,
  bossFreeSearch: 100,
  landingFreeRadius: 150,
  landingFreeSearch: 60,
  perchMinStart: 320,
  echoMinRim: 200,
  echoMinStart: 250,
  relayMinApart: 300,
  faultLength: 260,
  faultMinStart: 300,
  roadMinR: 1.3,
  roadMaxR: 1.6,
  coverMinFromStart: 140,
  coverMaxFromStart: 380,
  minPerches: 4,
  minNative: 2,
  minOther: 1,
  /** Clearance from solids for the boss stage centre and for anchors, in u. */
  pocketStep: 4,
  /** A cut-off patch smaller than this (u^2) is ignored: nobody can be knocked into it. */
  pocketMinArea: 150,
  stageClear: 30,
  anchorClear: PLAYER_RADIUS + 4,
  /** Check 9: a flow zone's speed stays below this share of the player's 110 u/s (it can slow, never stop her). */
  flowMaxSpeed: 66,
  /** Check 9: a body carried passively for this long must be this close (in time) to ground off the belt. */
  flowCarrySeconds: 3,
  flowEscapeSeconds: 3,
  /** Check 9: direction scales tested (a reversal passes through every one of them) and the sampling grids (u). */
  flowScales: [1, 0.5, 0.2],
  flowCell: 6,
  flowStartStep: 18,
  /** Check 9: the player's base move speed (u/s). */
  flowPlayerSpeed: 110,
} as const;

export interface LayoutIssue {
  check: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
  /** Authoring id the issue is about (or 'layout'). */
  id: string;
  message: string;
}

export interface LayoutReport {
  areaId: AtlasAreaId;
  R: number;
  issues: LayoutIssue[];
  stats: { props: number; solids: number; landmarks: number; solidDensity: number; anchors: number; reachableCells: number };
}

// --- geometry helpers -----------------------------------------------------------------------------------------------

/** Spatial hash of the solid props for fast clearance queries. */
export class SolidIndex {
  private readonly cell = 64;
  private readonly buckets = new Map<number, CompiledProp[]>();
  readonly solids: CompiledProp[];
  private maxR = 0;

  constructor(props: readonly CompiledProp[]) {
    this.solids = props.filter((p) => p.radius > 0);
    for (const p of this.solids) {
      this.maxR = Math.max(this.maxR, p.radius);
      const c0 = Math.floor((p.x - p.radius) / this.cell);
      const c1 = Math.floor((p.x + p.radius) / this.cell);
      const r0 = Math.floor((p.y - p.radius) / this.cell);
      const r1 = Math.floor((p.y + p.radius) / this.cell);
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.push(c, r, p);
    }
  }

  private key(c: number, r: number): number {
    return (c + 512) * 1024 + (r + 512);
  }

  private push(c: number, r: number, p: CompiledProp): void {
    const k = this.key(c, r);
    const b = this.buckets.get(k);
    if (b) b.push(p);
    else this.buckets.set(k, [p]);
  }

  /** Solids whose edge lies within `reach` of (x, y) (each once). */
  within(x: number, y: number, reach: number): CompiledProp[] {
    const out = new Set<CompiledProp>();
    const r = reach + this.maxR;
    const c0 = Math.floor((x - r) / this.cell);
    const c1 = Math.floor((x + r) / this.cell);
    const r0 = Math.floor((y - r) / this.cell);
    const r1 = Math.floor((y + r) / this.cell);
    for (let j = r0; j <= r1; j++) {
      for (let i = c0; i <= c1; i++) {
        const b = this.buckets.get(this.key(i, j));
        if (b) for (const p of b) if (Math.hypot(p.x - x, p.y - y) < p.radius + reach) out.add(p);
      }
    }
    return [...out];
  }

  /** Distance from (x, y) to the nearest solid's edge (negative inside), or `cap` when nothing is within `cap`. */
  clearance(x: number, y: number, cap: number): number {
    let best = cap;
    const reach = cap + this.maxR;
    const c0 = Math.floor((x - reach) / this.cell);
    const c1 = Math.floor((x + reach) / this.cell);
    const r0 = Math.floor((y - reach) / this.cell);
    const r1 = Math.floor((y + reach) / this.cell);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const b = this.buckets.get(this.key(c, r));
        if (!b) continue;
        for (const p of b) best = Math.min(best, Math.hypot(p.x - x, p.y - y) - p.radius);
      }
    }
    return best;
  }
}

export interface Reachability {
  step: number;
  /** Cells span [-n, n) on both axes. */
  n: number;
  /** 1 = walkable at corridor width, 2 = reachable from the start. */
  cells: Uint8Array;
  reachable: number;
  walkable: number;
}

/** The flood fill of check 2, exposed for the viewer's reachability heat. */
export function reachability(c: CompiledLayout, index: SolidIndex | null = null): Reachability {
  const idx = index ?? new SolidIndex(c.props);
  const step = LAYOUT_RULES.gridStep;
  const need = LAYOUT_RULES.corridor / 2 - step / 2;
  const n = Math.ceil(c.R / step) + 1;
  const size = n * 2;
  const cells = new Uint8Array(size * size);
  let walkable = 0;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = (i - n + 0.5) * step;
      const y = (j - n + 0.5) * step;
      if (Math.hypot(x, y) > c.R - PLAYER_RADIUS - 5) continue;
      if (idx.clearance(x, y, need + 1) < need) continue;
      cells[j * size + i] = 1;
      walkable++;
    }
  }
  const at = (x: number, y: number): number => {
    const i = Math.floor(x / step) + n;
    const j = Math.floor(y / step) + n;
    return i < 0 || j < 0 || i >= size || j >= size ? -1 : j * size + i;
  };
  let reachable = 0;
  // Start from the nearest walkable cell to the landing.
  let seed = at(c.start.x, c.start.y);
  if (seed >= 0 && cells[seed] !== 1) {
    seed = -1;
    for (let r = 1; r <= 8 && seed < 0; r++) {
      for (let dj = -r; dj <= r && seed < 0; dj++) {
        for (let di = -r; di <= r; di++) {
          const k = at(c.start.x + di * step, c.start.y + dj * step);
          if (k >= 0 && cells[k] === 1) {
            seed = k;
            break;
          }
        }
      }
    }
  }
  if (seed >= 0) {
    const queue = new Int32Array(size * size);
    let head = 0;
    let tail = 0;
    cells[seed] = 2;
    queue[tail++] = seed;
    while (head < tail) {
      const k = queue[head++];
      reachable++;
      const i = k % size;
      const j = (k - i) / size;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= size || nj >= size) continue;
          const nk = nj * size + ni;
          if (cells[nk] !== 1) continue;
          // No squeezing diagonally between two blocked cells.
          if (di && dj && (cells[j * size + ni] === 0 || cells[nj * size + i] === 0)) continue;
          cells[nk] = 2;
          queue[tail++] = nk;
        }
      }
    }
  }
  return { step, n, cells, reachable, walkable };
}

function reachableAt(r: Reachability, x: number, y: number, slack = 1): boolean {
  const size = r.n * 2;
  const ci = Math.floor(x / r.step) + r.n;
  const cj = Math.floor(y / r.step) + r.n;
  for (let dj = -slack; dj <= slack; dj++) {
    for (let di = -slack; di <= slack; di++) {
      const i = ci + di;
      const j = cj + dj;
      if (i >= 0 && j >= 0 && i < size && j < size && r.cells[j * size + i] === 2) return true;
    }
  }
  return false;
}

function samplePath(path: readonly XY[], every: number): XY[] {
  const out: XY[] = [];
  for (let i = 0; i < path.length; i++) {
    out.push(path[i]);
    if (i === 0) continue;
    const a = path[i - 1];
    const b = path[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    for (let s = every; s < len; s += every) out.push({ x: a.x + ((b.x - a.x) * s) / len, y: a.y + ((b.y - a.y) * s) / len });
  }
  return out;
}

// --- checks ---------------------------------------------------------------------------------------------------------

export function validateLayout(layout: AreaLayout, opts: { R?: number } = {}): LayoutReport {
  const R = opts.R ?? areaRadius(layout.areaId);
  const c = compileLayout(layout, R);
  const issues: LayoutIssue[] = [];
  const add = (check: LayoutIssue['check'], id: string, message: string): void => {
    issues.push({ check, id, message });
  };
  const idx = new SolidIndex(c.props);
  const lim = R * LAYOUT_RULES.maxRadiusFrac;
  const rules = LAYOUT_RULES;

  // --- 1: bounds, start clearing, stage and anchors outside solids
  const inside = (id: string, what: string, x: number, y: number): void => {
    if (Math.hypot(x, y) > lim + 1e-6) add(1, id, `${what} at (${Math.round(x)}, ${Math.round(y)}) is outside ${rules.maxRadiusFrac} R (${Math.round(lim)} u)`);
  };
  const seen = new Set<string>();
  const uniqueId = (kind: string, id: string): void => {
    const k = `${kind}:${id}`;
    if (seen.has(k)) add(1, id, `duplicate ${kind} id "${id}"`);
    seen.add(k);
  };
  for (const l of layout.landmarks) uniqueId('landmark', l.id);
  for (const k of layout.clusters) uniqueId('cluster', k.id);
  for (const k of layout.walls) uniqueId('wall', k.id);
  for (const k of layout.lanes) uniqueId('lane', k.id);
  for (const k of layout.zones) uniqueId('zone', k.id);
  for (const k of layout.anchors) uniqueId('anchor', k.id);
  inside('start', 'start', c.start.x, c.start.y);
  for (const p of c.props) {
    if (p.source !== 'scatter') inside(p.owner, `${p.kind} (${p.source})`, p.x, p.y);
  }
  for (const l of c.landmarks) if (!l.prop) inside(l.id, `landmark ${l.kind}`, l.x, l.y);
  for (const d of c.decals) {
    if (d.path.length === 0 && d.r === 0 && d.x === 0 && d.y === 0 && d.kind !== 'light') add(1, d.id, `decal ${d.id} has neither an \`at\` nor a \`path\``);
    for (const p of d.path) inside(d.id, `decal ${d.kind}`, p.x, p.y);
    if (d.path.length === 0) inside(d.id, `decal ${d.kind}`, d.x, d.y);
  }
  for (const l of c.lanes) {
    if (l.path.length < 2) add(1, l.id, `lane ${l.id} needs at least two points`);
    for (const p of l.path) inside(l.id, 'lane point', p.x, p.y);
  }
  for (const z of c.zones) inside(z.id, 'zone centre', z.x, z.y);
  inside('bossStage', 'boss stage', c.bossStage.x, c.bossStage.y);
  if (c.bossStage.second) inside('bossStage', 'second boss stage', c.bossStage.second.x, c.bossStage.second.y);
  for (const a of c.anchors) {
    inside(a.id, `anchor ${a.fits}`, a.x, a.y);
    for (const p of a.path) inside(a.id, `anchor ${a.fits} path`, p.x, p.y);
  }
  for (const s of c.rareSpots) inside('rareSpots', 'rare spot', s.x, s.y);
  if (c.light) for (const p of c.light.pools) inside('light', 'light pool', p.x, p.y);
  for (const p of idx.solids) {
    if (Math.hypot(p.x - c.start.x, p.y - c.start.y) - p.radius < c.start.clear) {
      add(1, p.owner, `${p.kind} at (${Math.round(p.x)}, ${Math.round(p.y)}) intrudes into the start clearing (${c.start.clear} u)`);
    }
  }
  const notInSolid = (id: string, what: string, x: number, y: number, clear: number): void => {
    if (idx.clearance(x, y, clear + 1) < clear) add(1, id, `${what} at (${Math.round(x)}, ${Math.round(y)}) is inside or within ${clear} u of a solid prop`);
  };
  notInSolid('bossStage', 'boss stage', c.bossStage.x, c.bossStage.y, rules.stageClear);
  if (c.bossStage.second) notInSolid('bossStage', 'second boss stage', c.bossStage.second.x, c.bossStage.second.y, rules.stageClear);
  for (const a of c.anchors) notInSolid(a.id, `anchor ${a.fits}`, a.x, a.y, rules.anchorClear);

  // --- 2: reachability and chokes
  const reach = reachability(c, idx);
  const target = (id: string, what: string, x: number, y: number): void => {
    if (!reachableAt(reach, x, y)) add(2, id, `${what} at (${Math.round(x)}, ${Math.round(y)}) is not reachable from the start through corridors >= ${rules.corridor} u`);
  };
  for (const l of c.lanes) for (const p of samplePath(l.path, 50)) target(l.id, 'lane', p.x, p.y);
  for (const a of c.anchors) {
    target(a.id, `anchor ${a.fits}`, a.x, a.y);
    for (const p of a.path) target(a.id, `anchor ${a.fits} path`, p.x, p.y);
  }
  target('bossStage', 'boss stage', c.bossStage.x, c.bossStage.y);
  if (c.bossStage.second) target('bossStage', 'second boss stage', c.bossStage.second.x, c.bossStage.second.y);
  for (const z of c.zones) {
    // A zone needs some reachable ground inside it (sampled on a 28 u lattice over its bounding box).
    let ok = false;
    for (let y = z.y - z.r; y <= z.y + z.r && !ok; y += 28) {
      for (let x = z.x - z.r; x <= z.x + z.r && !ok; x += 28) {
        if (Math.hypot(x - z.x, y - z.y) <= z.r && reachableAt(reach, x, y, 0) && inZoneLoose(z, x, y)) ok = true;
      }
    }
    if (!ok) add(2, z.id, `zone ${z.id} contains no reachable ground`);
  }
  for (const w of layout.walls) {
    for (const g of w.gaps ?? []) {
      if (g.width < rules.choke) add(2, w.id, `wall ${w.id}: gap at ${g.at} is ${g.width} u wide, designed chokes need >= ${rules.choke} u`);
    }
  }

  // --- 3: landmark overlap, density, free discs
  for (let i = 0; i < c.landmarks.length; i++) {
    for (let j = i + 1; j < c.landmarks.length; j++) {
      const a = c.landmarks[i];
      const b = c.landmarks[j];
      if (Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r) add(3, a.id, `landmarks ${a.id} and ${b.id} overlap`);
    }
  }
  // Solid area fraction by raster over the arena disc.
  let solidCells = 0;
  let arenaCells = 0;
  const cs = 6;
  for (let y = -R + cs / 2; y < R; y += cs) {
    for (let x = -R + cs / 2; x < R; x += cs) {
      if (Math.hypot(x, y) > R) continue;
      arenaCells++;
      if (idx.clearance(x, y, 0.5) < 0) solidCells++;
    }
  }
  const density = arenaCells > 0 ? solidCells / arenaCells : 0;
  if (density > rules.maxSolidDensity) add(3, 'layout', `solid props cover ${(density * 100).toFixed(1)}% of the arena, the limit is ${rules.maxSolidDensity * 100}%`);
  const freeDisc = (cx: number, cy: number, radius: number, search: number): boolean => {
    for (let oy = -search; oy <= search; oy += 20) {
      for (let ox = -search; ox <= search; ox += 20) {
        if (Math.hypot(ox, oy) > search) continue;
        if (idx.clearance(cx + ox, cy + oy, radius + 1) >= radius) return true;
      }
    }
    return false;
  };
  if (!freeDisc(c.bossStage.x, c.bossStage.y, rules.bossFreeRadius, rules.bossFreeSearch)) {
    add(3, 'bossStage', `no solid-free ${rules.bossFreeRadius * 2} u disc within ${rules.bossFreeSearch} u of the boss stage (phase attacks need room)`);
  }
  if (c.bossStage.second && !freeDisc(c.bossStage.second.x, c.bossStage.second.y, rules.bossFreeRadius, rules.bossFreeSearch)) {
    add(3, 'bossStage', `no solid-free ${rules.bossFreeRadius * 2} u disc near the second boss stage`);
  }
  if (!freeDisc(c.start.x, c.start.y, rules.landingFreeRadius, rules.landingFreeSearch)) {
    add(3, 'start', `no solid-free ${rules.landingFreeRadius * 2} u disc round the landing`);
  }

  // --- 4: Event Charter spacing
  const dStart = (x: number, y: number): number => Math.hypot(x - c.start.x, y - c.start.y);
  const relays: typeof c.anchors = [];
  for (const a of c.anchors) {
    if (a.fits === 'perch' && dStart(a.x, a.y) < rules.perchMinStart) add(4, a.id, `perch ${a.id} is ${Math.round(dStart(a.x, a.y))} u from the start, needs >= ${rules.perchMinStart}`);
    if (a.fits === 'echo') {
      if (R - Math.hypot(a.x, a.y) < rules.echoMinRim) add(4, a.id, `echo ${a.id} is ${Math.round(R - Math.hypot(a.x, a.y))} u from the rim, needs >= ${rules.echoMinRim}`);
      if (dStart(a.x, a.y) < rules.echoMinStart) add(4, a.id, `echo ${a.id} is ${Math.round(dStart(a.x, a.y))} u from the start, needs >= ${rules.echoMinStart}`);
    }
    if (a.fits === 'relay') relays.push(a);
    if (a.fits === 'fault') {
      if (a.path.length < 2) add(4, a.id, `fault ${a.id} needs a 2-point \`path\` (the line)`);
      else {
        if (pathLength(a.path) < rules.faultLength) add(4, a.id, `fault ${a.id} line is ${Math.round(pathLength(a.path))} u, needs >= ${rules.faultLength}`);
        if (distToPath(c.start.x, c.start.y, a.path) < rules.faultMinStart) add(4, a.id, `fault ${a.id} passes within ${rules.faultMinStart} u of the start`);
      }
    }
    if (a.fits === 'road') {
      const len = pathLength(a.path);
      if (a.path.length < 2) add(4, a.id, `road ${a.id} needs a \`path\``);
      else if (len < rules.roadMinR * R - 1 || len > rules.roadMaxR * R + 1) {
        add(4, a.id, `road ${a.id} is ${(len / R).toFixed(2)} R long, needs ${rules.roadMinR} to ${rules.roadMaxR} R`);
      }
    }
  }
  for (let i = 0; i < relays.length; i++) {
    for (let j = i + 1; j < relays.length; j++) {
      if (Math.hypot(relays[i].x - relays[j].x, relays[i].y - relays[j].y) < rules.relayMinApart) {
        add(4, relays[i].id, `relays ${relays[i].id} and ${relays[j].id} are closer than ${rules.relayMinApart} u`);
      }
    }
  }

  // --- 5: Stalker cover from every perch
  for (const a of c.anchors) {
    if (a.fits !== 'perch') continue;
    let covered = false;
    for (const p of idx.solids) {
      const dp = dStart(p.x, p.y);
      if (dp < rules.coverMinFromStart || dp > rules.coverMaxFromStart) continue;
      if (distToSegment(p.x, p.y, a.x, a.y, c.start.x, c.start.y) <= p.radius) {
        covered = true;
        break;
      }
    }
    if (!covered) add(5, a.id, `perch ${a.id} has no solid cover prop on its line to the start (${rules.coverMinFromStart} to ${rules.coverMaxFromStart} u from the start)`);
  }

  // --- 6: anchor inventory
  const count = (k: EventAnchorKind): number => c.anchors.filter((a) => a.fits === k).length;
  const native = new Set<EventAnchorKind>(NATIVE_ANCHORS[areaType(layout.areaId)]);
  for (const k of EVENT_ANCHOR_KINDS) {
    const need = k === 'perch' ? Math.max(rules.minPerches, native.has(k) ? rules.minNative : 0) : native.has(k) ? rules.minNative : rules.minOther;
    if (count(k) < need) add(6, k, `${count(k)} ${k} anchor(s), needs >= ${need}${native.has(k) ? ' (native to this area type)' : ''}`);
  }

  // --- 8: pockets a player cannot leave
  for (const pk of findPockets(c, idx)) {
    add(8, pk.owner, `a cut-off pocket of ${Math.round(pk.area)} u^2 around (${Math.round(pk.x)}, ${Math.round(pk.y)}) is standing ground a player cannot leave (nearest solid: ${pk.owner})`);
  }
  for (const tr of findCornerTraps(c, idx)) {
    add(8, tr.owner, `a player standing at (${Math.round(tr.x)}, ${Math.round(tr.y)}) cannot slide out of the concave corner there in any of 16 headings (nearest solid: ${tr.owner})`);
  }

  // --- 9: flow zones
  if (c.flows.length > 0) checkFlows(layout, c, idx, lim, add);

  // --- 10: every anchor can seat its event (E1)
  for (const a of c.anchors) {
    const s = seatAnchor(a.fits, a.x, a.y, R);
    if (!s) {
      add(10, a.id, `${a.fits} ${a.id}: the event's footprint needs its centre >= ${EVENT_ANCHOR_RIM[a.fits]} u inside the rim; the anchor is ${Math.round(Math.hypot(a.x, a.y) - (R - EVENT_ANCHOR_RIM[a.fits]))} u over (seating slides at most ${ANCHOR_SEAT} u)`);
      continue;
    }
    if (s.moved > 0) {
      if (idx.clearance(s.x, s.y, rules.anchorClear + 1) < rules.anchorClear) add(10, a.id, `${a.fits} ${a.id} seats at (${Math.round(s.x)}, ${Math.round(s.y)}), inside or within ${rules.anchorClear} u of a solid prop`);
      else if (!reachableAt(reach, s.x, s.y)) add(10, a.id, `${a.fits} ${a.id} seats at (${Math.round(s.x)}, ${Math.round(s.y)}), which is not reachable from the start`);
    }
  }
  // --- 11: burning ground (roadmap 4)
  for (const h of c.hazards) {
    if (h.cycle) {
      const cy = h.cycle;
      if (!(cy.telegraph >= 1)) add(11, h.id, `hazard ${h.id}: the flare telegraph (${cy.telegraph} s) must be >= 1 s so it can be read`);
      if (!(cy.active > 0) || !(cy.every >= cy.telegraph + cy.active + 2)) add(11, h.id, `hazard ${h.id}: a flare cycle needs active > 0 and every >= telegraph + active + 2 s`);
    }
    if (h.shape === 'disc' ? !(h.r > 0) : h.path.length < 2 || !(h.half > 0)) add(11, h.id, `hazard ${h.id}: an empty footprint (a pool needs r, a crack a path)`);
    const pad = PLAYER_RADIUS;
    const near = (x: number, y: number, r: number): boolean => {
      for (let a = 0; a < 360; a += 15) {
        const t = (a * Math.PI) / 180;
        for (const f of [0, 0.5, 1]) if (hazardHits(h, x + Math.cos(t) * r * f, y + Math.sin(t) * r * f, pad)) return true;
      }
      return false;
    };
    if (near(c.start.x, c.start.y, c.start.clear)) add(11, h.id, `hazard ${h.id} reaches the start clearing: the landing must be safe ground`);
    // A flaring crack may cross the boss arena (it warns before every flare); ground that always burns may not.
    if (!h.cycle && near(c.bossStage.x, c.bossStage.y, Math.min(c.bossStage.r, rules.bossFreeRadius))) add(11, h.id, `always-burning hazard ${h.id} lies on the boss stage`);
  }

  const relayCount = count('relay');
  if (relayCount > 0 && relayCount < RELAY_BRAZIERS) add(10, 'relay', `${relayCount} relay anchor(s): the Ember Relay needs a triad of ${RELAY_BRAZIERS} (fewer are never used)`);

  return {
    areaId: layout.areaId, R, issues,
    stats: {
      props: c.props.length, solids: idx.solids.length, landmarks: c.landmarks.length, solidDensity: density, anchors: c.anchors.length,
      reachableCells: reach.reachable,
    },
  };
}

// --- 9: flow zones ----------------------------------------------------------------------------------------------------

/** A binary min-heap of (key, value) pairs for the escape-time Dijkstra of check 9. */
class MinHeap {
  private readonly keys: number[] = [];
  private readonly vals: number[] = [];
  get size(): number { return this.keys.length; }
  push(key: number, val: number): void {
    let i = this.keys.length;
    this.keys.push(key);
    this.vals.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      [this.keys[p], this.keys[i]] = [this.keys[i], this.keys[p]];
      [this.vals[p], this.vals[i]] = [this.vals[i], this.vals[p]];
      i = p;
    }
  }
  pop(): { key: number; val: number } {
    const top = { key: this.keys[0], val: this.vals[0] };
    const lk = this.keys.pop()!;
    const lv = this.vals.pop()!;
    const n = this.keys.length;
    if (n > 0) {
      this.keys[0] = lk;
      this.vals[0] = lv;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < n && this.keys[l] < this.keys[m]) m = l;
        if (r < n && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        [this.keys[m], this.keys[i]] = [this.keys[i], this.keys[m]];
        [this.vals[m], this.vals[i]] = [this.vals[i], this.vals[m]];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Check 9 (D 10.5a). Structure first (bounds, sane numbers, reversal timing, a random group of two or more never runs one way for any
 * of 32 sample flow seeds), then the landing and boss stage off every flow, then for each zone, each direction and each scale a
 * reversal passes through: (a) bodies standing on the belt on an 18 u lattice are carried passively for 3 s through the real
 * movement code (`resolvePlayerAt` + the shared `flowVelocity`), then (b) the end point must be within 3 s of ground OFF this zone,
 * measured by a Dijkstra over the standing grid where a step in direction d from a cell with drift F runs at the speed s that solves
 * |s d - F| = 110 (walking against the belt at net speed, with the belt at best): so a belt that carries a body into a dead-end pocket
 * he cannot get out of against the flow in 3 s fails. Other zones are not counted (they are checked as zones of their own).
 */
function checkFlows(
  layout: AreaLayout, c: CompiledLayout, idx: SolidIndex, lim: number, add: (check: LayoutIssue['check'], id: string, message: string) => void,
): void {
  const rules = LAYOUT_RULES;
  const flows = layout.flows ?? [];
  const seen = new Set<string>();
  flows.forEach((f, k) => {
    const z = c.flows[k];
    if (seen.has(f.id)) add(9, f.id, `duplicate flow id "${f.id}"`);
    seen.add(f.id);
    if (!(f.speed > 0) || f.speed > rules.flowMaxSpeed) add(9, f.id, `flow ${f.id}: speed ${f.speed} u/s must be in (0, ${rules.flowMaxSpeed}] so a belt can slow the player but never stop her (110 u/s)`);
    if (f.shape === 'band') {
      if (!f.path || f.path.length < 2) add(9, f.id, `flow ${f.id}: a band needs a path of at least two points`);
      if (!(z.width >= 2 * rules.corridor / 2)) add(9, f.id, `flow ${f.id}: band width ${z.width} u is narrower than a corridor (${rules.corridor} u)`);
      for (const p of z.path) if (Math.sqrt(p.x * p.x + p.y * p.y) + z.width / 2 > lim + 1e-6) add(9, f.id, `flow ${f.id}: band point (${Math.round(p.x)}, ${Math.round(p.y)}) with its half width leaves ${rules.maxRadiusFrac} R`);
    } else {
      if (!(z.r1 > z.r0 && z.r0 >= 0)) add(9, f.id, `flow ${f.id}: an annulus needs 0 <= r0 < r1`);
      if (Math.sqrt(z.cx * z.cx + z.cy * z.cy) + z.r1 > lim + 1e-6) add(9, f.id, `flow ${f.id}: annulus (centre ${Math.round(z.cx)}, ${Math.round(z.cy)}, r1 ${Math.round(z.r1)}) leaves ${rules.maxRadiusFrac} R`);
    }
    const rv = f.reverse;
    if (rv) {
      const tele = rv.telegraph ?? FLOW_TELEGRAPH;
      const ramp = rv.ramp ?? FLOW_RAMP;
      if (!(tele >= 0.5) || !(ramp >= 0.5)) add(9, f.id, `flow ${f.id}: telegraph and ramp must be >= 0.5 s (the warning must be readable)`);
      if (!(rv.every[0] <= rv.every[1]) || rv.every[0] < tele + ramp + 4) add(9, f.id, `flow ${f.id}: reversals every ${rv.every[0]} to ${rv.every[1]} s need min >= telegraph + ramp + 4 = ${tele + ramp + 4} s`);
    }
  });
  // Random groups always carry both directions.
  const groups = new Map<string, number[]>();
  c.flows.forEach((z, k) => { if (z.sense === 'random') groups.set(z.group, [...(groups.get(z.group) ?? []), k]); });
  for (const [g, members] of groups) {
    if (members.length < 2) continue;
    for (let seed = 0; seed < 32; seed++) {
      const field = buildFlowField(c.flows, layout.areaId, seed * 2654435761);
      const dirs = new Set(members.map((k) => field.zones[k].sign0));
      if (dirs.size < 2) {
        add(9, g, `flow group ${g}: flow seed ${seed * 2654435761 >>> 0} runs every belt the same way (a group must always have both directions)`);
        break;
      }
    }
  }
  // The landing and the boss stage stand on no flow.
  const probe = buildFlowField(c.flows, layout.areaId, 0);
  probe.scale.fill(1);
  const flowAt = (x: number, y: number): boolean => flowVelocity(probe, x, y, FLOW_PLAYER);
  for (let dy = -c.start.clear; dy <= c.start.clear; dy += 10) {
    for (let dx = -c.start.clear; dx <= c.start.clear; dx += 10) {
      if (dx * dx + dy * dy <= c.start.clear * c.start.clear && flowAt(c.start.x + dx, c.start.y + dy)) {
        add(9, 'start', `a flow zone reaches the start clearing at (${Math.round(c.start.x + dx)}, ${Math.round(c.start.y + dy)}): the landing must stand still`);
        dy = Infinity;
        break;
      }
    }
  }
  if (flowAt(c.bossStage.x, c.bossStage.y)) add(9, 'bossStage', 'the boss stage centre stands on a flow zone');
  if (c.bossStage.second && flowAt(c.bossStage.second.x, c.bossStage.second.y)) add(9, 'bossStage', 'the second boss stage stands on a flow zone');

  // Dead ends: per zone, direction and scale.
  const near = (x: number, y: number, reach: number): PropView[] => idx.within(x, y, reach) as unknown as PropView[];
  const cell = rules.flowCell;
  const V = rules.flowPlayerSpeed;
  const dirs: [number, number, number][] = [];
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (i || j) dirs.push([i, j, Math.sqrt(i * i + j * j)]);
  for (let zi = 0; zi < c.flows.length; zi++) {
    const z = c.flows[zi];
    const field = buildFlowField(c.flows, layout.areaId, 0);
    const margin = 70;
    const x0 = Math.floor((z.x0 - margin) / cell) * cell;
    const y0 = Math.floor((z.y0 - margin) / cell) * cell;
    const nx = Math.ceil((z.x1 + margin - x0) / cell) + 1;
    const ny = Math.ceil((z.y1 + margin - y0) / cell) + 1;
    const stand = new Uint8Array(nx * ny);
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const x = x0 + (i + 0.5) * cell;
        const y = y0 + (j + 0.5) * cell;
        if (Math.sqrt(x * x + y * y) > c.R - PLAYER_RADIUS) continue;
        if (idx.clearance(x, y, PLAYER_RADIUS + 1) >= PLAYER_RADIUS) stand[j * nx + i] = 1;
      }
    }
    for (const sigma of [1, -1]) {
      for (const mag of rules.flowScales) {
        field.scale.fill(0);
        field.scale[zi] = sigma * mag;
        const drift = (x: number, y: number): boolean => flowVelocity(field, x, y, FLOW_PLAYER);
        // Escape time from every cell to ground off the zone (multi-source Dijkstra over the reversed graph).
        const dist = new Float64Array(nx * ny).fill(Infinity);
        const fx = new Float64Array(nx * ny);
        const fy = new Float64Array(nx * ny);
        const heap = new MinHeap();
        for (let j = 0; j < ny; j++) {
          for (let i = 0; i < nx; i++) {
            const k = j * nx + i;
            if (!stand[k]) continue;
            if (drift(x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell)) {
              fx[k] = flowOut.vx;
              fy[k] = flowOut.vy;
            } else {
              dist[k] = 0;
              heap.push(0, k);
            }
          }
        }
        while (heap.size > 0) {
          const { key, val: b } = heap.pop();
          if (key > dist[b]) continue;
          const bi = b % nx;
          const bj = (b - bi) / nx;
          for (const [di, dj, len] of dirs) {
            const ai = bi - di;
            const aj = bj - dj;
            if (ai < 0 || aj < 0 || ai >= nx || aj >= ny) continue;
            const a = aj * nx + ai;
            if (!stand[a] || dist[a] === 0) continue;
            if (di && dj && (!stand[bj * nx + ai] || !stand[aj * nx + bi])) continue;
            // From a toward b the direction is (di, dj); the best ground speed along it against the drift at a.
            const ux = di / len;
            const uy = dj / len;
            const df = ux * fx[a] + uy * fy[a];
            const sp = df + Math.sqrt(Math.max(0, df * df - (fx[a] * fx[a] + fy[a] * fy[a]) + V * V));
            const t = key + (len * cell) / Math.max(1, sp);
            if (t < dist[a]) {
              dist[a] = t;
              heap.push(t, a);
            }
          }
        }
        // Carry bodies passively and look the end points up.
        let worst = 0;
        let worstAt: { x: number; y: number; px: number; py: number } | null = null;
        const dt = 1 / 20;
        for (let y = z.y0; y <= z.y1; y += rules.flowStartStep) {
          for (let x = z.x0; x <= z.x1; x += rules.flowStartStep) {
            if (!drift(x, y) || idx.clearance(x, y, PLAYER_RADIUS + 1) < PLAYER_RADIUS) continue;
            let px = x;
            let py = y;
            for (let t = 0; t < rules.flowCarrySeconds; t += dt) {
              if (!drift(px, py)) break;
              const o = resolvePlayerAt(px + flowOut.vx * dt, py + flowOut.vy * dt, c.R, near(px, py, 60));
              px = o.x;
              py = o.y;
            }
            const ci = Math.floor((px - x0) / cell);
            const cj = Math.floor((py - y0) / cell);
            let best = Infinity;
            for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
              const ii = ci + di;
              const jj = cj + dj;
              if (ii >= 0 && jj >= 0 && ii < nx && jj < ny) best = Math.min(best, dist[jj * nx + ii]);
            }
            if (best > worst) {
              worst = best;
              worstAt = { x, y, px, py };
            }
          }
        }
        if (worst > rules.flowEscapeSeconds && worstAt) {
          const where = Number.isFinite(worst) ? `${worst.toFixed(1)} s` : 'no way';
          add(9, z.id, `flow ${z.id} (${sigma > 0 ? 'as authored' : 'reversed'}, scale ${mag}): a body standing at (${Math.round(worstAt.x)}, ${Math.round(worstAt.y)}) is carried to (${Math.round(worstAt.px)}, ${Math.round(worstAt.py)}), ${where} from ground off the belt against the flow (limit ${rules.flowEscapeSeconds} s)`);
        }
      }
    }
  }
}

export interface Pocket { x: number; y: number; area: number; owner: string }

/**
 * Check 8's flood fill: the cells where a player body (PLAYER_RADIUS, no tolerance) fits, 4 u apart, 8-connected without squeezing
 * between two blocked cells diagonally. Every patch of standing ground not connected to the landing and at least `pocketMinArea`
 * large is a pocket: a player pushed or knocked into it (movement resolves the body out of props, so it stays in the patch) cannot
 * walk out. Patches are returned with their centroid and the id of the nearest solid.
 */
export function findPockets(c: CompiledLayout, idx: SolidIndex): Pocket[] {
  const step = LAYOUT_RULES.pocketStep;
  const n = Math.ceil(c.R / step) + 1;
  const size = n * 2;
  const stand = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = (i - n + 0.5) * step;
      const y = (j - n + 0.5) * step;
      if (Math.hypot(x, y) > c.R - PLAYER_RADIUS) continue;
      if (idx.clearance(x, y, PLAYER_RADIUS + 1) >= PLAYER_RADIUS) stand[j * size + i] = 1;
    }
  }
  const comp = new Int32Array(size * size).fill(-1);
  const queue = new Int32Array(size * size);
  const out: { id: number; x: number; y: number; cells: number }[] = [];
  const fill = (from: number, id: number): { cells: number; sx: number; sy: number } => {
    let head = 0;
    let tail = 0;
    let sx = 0;
    let sy = 0;
    comp[from] = id;
    queue[tail++] = from;
    while (head < tail) {
      const k = queue[head++];
      const i = k % size;
      const j = (k - i) / size;
      sx += i;
      sy += j;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= size || nj >= size) continue;
          const nk = nj * size + ni;
          if (!stand[nk] || comp[nk] >= 0) continue;
          if (di && dj && (!stand[j * size + ni] || !stand[nj * size + i])) continue;
          comp[nk] = id;
          queue[tail++] = nk;
        }
      }
    }
    return { cells: tail, sx, sy };
  };
  // The landing's component first (nearest standing cell), id 0.
  let seed = -1;
  let seedD = Infinity;
  for (let k = 0; k < stand.length; k++) {
    if (!stand[k]) continue;
    const i = k % size;
    const j = (k - i) / size;
    const d = Math.hypot((i - n + 0.5) * step - c.start.x, (j - n + 0.5) * step - c.start.y);
    if (d < seedD) {
      seedD = d;
      seed = k;
    }
  }
  if (seed >= 0) fill(seed, 0);
  let id = 1;
  for (let k = 0; k < stand.length; k++) {
    if (!stand[k] || comp[k] >= 0) continue;
    const f = fill(k, id++);
    out.push({ id, x: (f.sx / f.cells - n + 0.5) * step, y: (f.sy / f.cells - n + 0.5) * step, cells: f.cells });
  }
  const pockets: Pocket[] = [];
  for (const o of out) {
    const area = o.cells * step * step;
    if (area < LAYOUT_RULES.pocketMinArea) continue;
    let owner = 'rim';
    let best = Infinity;
    for (const p of idx.solids) {
      const d = Math.hypot(p.x - o.x, p.y - o.y) - p.radius;
      if (d < best) {
        best = d;
        owner = p.owner;
      }
    }
    pockets.push({ x: o.x, y: o.y, area, owner });
  }
  return pockets;
}

export interface CornerTrap { x: number; y: number; owner: string }

/**
 * Check 8b: the movement code itself. Concave corners are the standing spots (clearance >= PLAYER_RADIUS) that touch two or more
 * solids (edges within PLAYER_RADIUS + 4); one per 12 u square is tried. From each, the player walks 70 ticks (2.5 u each, about
 * 150 u/s) in each of 16 headings through `resolvePlayerAt` (shared with the client's prediction); it escapes when some heading
 * carries it at least 40 u from where it stood without ending inside a solid. A corner no heading leaves is a trap.
 */
export function findCornerTraps(c: CompiledLayout, idx: SolidIndex): CornerTrap[] {
  const traps: CornerTrap[] = [];
  const solids = idx.solids;
  const tried = new Set<number>();
  const step = 3;
  const touch = PLAYER_RADIUS + 4;
  const near = (x: number, y: number, reach: number): PropView[] => idx.within(x, y, reach) as unknown as PropView[];
  for (const a of solids) {
    // Candidate spots live next to this solid: only its neighbourhood needs scanning.
    const reach = a.radius + touch + 2;
    for (let y = a.y - reach; y <= a.y + reach; y += step) {
      for (let x = a.x - reach; x <= a.x + reach; x += step) {
        if (Math.hypot(x, y) > c.R - PLAYER_RADIUS - 2) continue;
        const key = (Math.floor(x / 12) + 4096) * 8192 + Math.floor(y / 12) + 4096;
        if (tried.has(key)) continue;
        const local = near(x, y, touch + 1);
        if (local.length < 2) continue;
        let touching = 0;
        let clear = Infinity;
        for (const p of local) {
          const e = Math.hypot(p.x - x, p.y - y) - p.radius;
          clear = Math.min(clear, e);
          if (e < touch) touching++;
        }
        if (touching < 2 || clear < PLAYER_RADIUS) continue;
        tried.add(key);
        const around = near(x, y, 200);
        let escaped = false;
        for (let h = 0; h < 16 && !escaped; h++) {
          const ang = (h / 16) * Math.PI * 2;
          const vx = Math.cos(ang) * 2.5;
          const vy = Math.sin(ang) * 2.5;
          let px = x;
          let py = y;
          for (let t = 0; t < 70; t++) {
            const o = resolvePlayerAt(px + vx, py + vy, c.R, around);
            px = o.x;
            py = o.y;
          }
          if (Math.hypot(px - x, py - y) >= 40 && idx.clearance(px, py, 1) >= 0) escaped = true;
        }
        if (!escaped) traps.push({ x, y, owner: a.owner });
      }
    }
  }
  return traps;
}

function inZoneLoose(z: CompiledLayout['zones'][number], x: number, y: number): boolean {
  if (z.shape === 'disc') return true;
  const dx = x - z.x;
  const dy = y - z.y;
  if (dx === 0 && dy === 0) return true;
  const bearing = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  const span = ((((z.a1 - z.a0) % 360) + 360) % 360) || 360;
  return (((bearing - z.a0) % 360) + 360) % 360 <= span;
}

// --- 7: determinism ---------------------------------------------------------------------------------------------------

export interface DeterminismOptions {
  /** Builds the sim config of a map for `areaId` with `seed` (tests pass their fixture's makeConfig). */
  makeConfig: (areaId: AtlasAreaId, seed: number, R: number) => RunConfig;
  /** Adds a player to a fresh run so its director runs. */
  addPlayer: (run: ReturnType<typeof createRunInternal>['run']) => void;
  seeds?: [number, number];
}

/** Check 7: builds the layout's worlds and compares them. Returns issues (empty = deterministic as specified). */
export function checkDeterminism(layout: AreaLayout, o: DeterminismOptions): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const add = (message: string): void => {
    issues.push({ check: 7, id: 'layout', message });
  };
  const [sa, sb] = o.seeds ?? [1337, 424242];
  const R = areaRadius(layout.areaId);
  const restore = overrideLayout(layout);
  try {
    const build = (seed: number) => {
      const r = createRunInternal(o.makeConfig(layout.areaId, seed, R));
      o.addPlayer(r.run);
      return r;
    };
    const props = (w: ReturnType<typeof build>['world']) => w.props.map((p) => `${p.kind}:${p.x.toFixed(3)}:${p.y.toFixed(3)}:${p.radius}:${p.variant}`);
    const compiled = compileLayout(layout, R);
    const fixed = compiled.props.length;
    const a1 = build(sa);
    const a2 = build(sa);
    const b1 = build(sb);
    if (props(a1.world).join('|') !== props(a2.world).join('|')) add('the same seed built two different sets of props');
    if (a1.run.digest() !== a2.run.digest()) add('the same seed built two different worlds (digest differs)');
    if (props(a1.world).slice(0, fixed).join('|') !== props(b1.world).slice(0, fixed).join('|')) {
      add('different seeds changed the landmarks, clusters or walls (they must be identical in every run)');
    }
    // Packs and the cosmetic debris differ by seed: step both worlds into the first wave and compare monster positions.
    const ticks = 60 * 14;
    for (const r of [a1, b1]) for (let t = 0; t < ticks; t++) stepWorld(r.world);
    const sig = (w: ReturnType<typeof build>['world']): string => {
      const m = w.monsters;
      const out: string[] = [];
      for (let i = 0; i < m.hwm; i++) if (m.alive[i]) out.push(`${m.kind[i]}:${m.x[i].toFixed(2)}:${m.y[i].toFixed(2)}`);
      return out.join('|');
    };
    if (sig(a1.world) === sig(b1.world)) add('different seeds produced identical packs (placement must vary by seed)');
    if (compiled.scatter.density > 0 && props(a1.world).slice(fixed).join('|') === props(b1.world).slice(fixed).join('|')) {
      add('different seeds produced identical debris (scatter must vary by seed)');
    }
  } finally {
    restore();
  }
  return issues;
}

/** One-line report for CLI output. */
export function formatIssues(report: LayoutReport, extra: readonly LayoutIssue[] = []): string[] {
  return [...report.issues, ...extra].map((i) => `  [check ${i.check}] ${i.id}: ${i.message}`);
}
