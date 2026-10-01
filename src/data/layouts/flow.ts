// Flow zones (conveyor belts, currents): geometry, the per-run direction schedule and the one evaluator every consumer shares.
//
//   compileFlowZones(flows, R)          authored LayoutFlow[] -> world-unit geometry (seed-free, part of CompiledLayout)
//   buildFlowField(zones, area, seed)   + the run's flow seed -> a FlowField: initial directions and the reversal schedule
//   flowStep(field, time)               fix the field at a sim time (seconds = tick x SIM_DT): fills `field.scale[]`
//   flowVelocity(field, x, y, body)     the drift (u/s) a body of that class standing at (x, y) receives right now
//
// DETERMINISM CONTRACT. Everything here is a pure function of (layout, R, flow seed, time): integer hashing and mulberry32 for the
// seed-dependent parts, Math.sqrt (never hypot) for geometry, no allocation in the evaluators. The sim (monsters in ai.ts, players
// in player.ts), client prediction (net/prediction.ts: same `flowVelocity`, time = tick x SIM_DT) and the presenter all call exactly
// this code, so a predicted belt step lands where the server's does. The flow seed is NOT the run seed (the client never learns
// that one): the server draws it per map instance and ships it in ZoneInfo.flowSeed; without one the sim derives it from the seed.
//
// DIRECTION OVER TIME. A zone has an initial direction sign (`sense`, 1 / -1 / 'random' drawn from the flow seed) and, optionally,
// timed reversals (LayoutFlowReverse). One reversal starting at time e is, in order:
//   [e, e + telegraph)              the belt decelerates from the old direction to a standstill (ease), chevrons slow and flicker
//   [e + telegraph, + ramp)         it accelerates in the new direction up to full speed (ease)
// so the signed scale is continuous: velocity never jumps (prediction stays smooth) and a belt is readable before it turns.
import { createRng, hashString, hashU32 } from '../../core/rng';
import type { LayoutFlow, FlowBody } from './schema';
import { FLOW_STRENGTH_DEFAULT, resolvePt, type Pt } from './schema';

interface XY { x: number; y: number }

/** Edge fade (u): a body at the very rim receives nothing, a body this far in the full drift. */
export const FLOW_FEATHER = 8;
export const FLOW_TELEGRAPH = 2;
export const FLOW_RAMP = 1;
/** Seconds of schedule generated per zone (a run is far shorter; the last state simply holds after it). */
export const FLOW_HORIZON = 5400;

const FLOW_BODY_INDEX: Record<FlowBody, number> = { player: 0, monster: 1, heavy: 2, boss: 3, air: 4 };
export const FLOW_PLAYER = 0;
export const FLOW_MONSTER = 1;
export const FLOW_HEAVY = 2;
export const FLOW_BOSS = 3;
export const FLOW_AIR = 4;

export interface FlowSeg { ax: number; ay: number; ux: number; uy: number; len: number }

/** Seed-free geometry of one flow zone in world units. */
export interface CompiledFlow {
  id: string;
  shape: 'band' | 'annulus';
  speed: number;
  sense: 1 | -1 | 'random';
  group: string;
  /** Strength per body class, indexed by FLOW_PLAYER .. FLOW_AIR. */
  strength: readonly number[];
  reverse: { mode: 'pingpong' | 'random'; every: [number, number]; telegraph: number; ramp: number } | null;
  feather: number;
  /** band */
  path: XY[];
  width: number;
  segs: FlowSeg[];
  /** annulus */
  cx: number;
  cy: number;
  r0: number;
  r1: number;
  /** Bounding box (inclusive): the cheap reject of every query. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function mapPath(path: readonly Pt[] | undefined, R: number): XY[] {
  return (path ?? []).map((p) => resolvePt(p, R));
}

export function compileFlowZones(flows: readonly LayoutFlow[] | undefined, R: number): CompiledFlow[] {
  const out: CompiledFlow[] = [];
  for (const f of flows ?? []) {
    const strength = [0, 0, 0, 0, 0];
    for (const k of Object.keys(FLOW_BODY_INDEX) as FlowBody[]) strength[FLOW_BODY_INDEX[k]] = f.strength?.[k] ?? FLOW_STRENGTH_DEFAULT[k];
    const rv = f.reverse
      ? { mode: f.reverse.mode, every: [f.reverse.every[0], f.reverse.every[1]] as [number, number], telegraph: f.reverse.telegraph ?? FLOW_TELEGRAPH, ramp: f.reverse.ramp ?? FLOW_RAMP }
      : null;
    const z: CompiledFlow = {
      id: f.id, shape: f.shape, speed: f.speed, sense: f.sense, group: f.group ?? `~${f.id}`, strength, reverse: rv,
      feather: f.feather ?? FLOW_FEATHER, path: [], width: 0, segs: [], cx: 0, cy: 0, r0: 0, r1: 0, x0: 0, y0: 0, x1: 0, y1: 0,
    };
    if (f.shape === 'annulus') {
      const at = f.at ? resolvePt(f.at, R) : { x: 0, y: 0 };
      z.cx = at.x;
      z.cy = at.y;
      z.r0 = f.r0 ?? 0;
      z.r1 = f.r1 ?? 0;
      z.x0 = at.x - z.r1;
      z.x1 = at.x + z.r1;
      z.y0 = at.y - z.r1;
      z.y1 = at.y + z.r1;
    } else {
      z.path = mapPath(f.path, R);
      z.width = f.width ?? 0;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 1; i < z.path.length; i++) {
        const a = z.path[i - 1];
        const b = z.path[i];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len < 1e-6) continue;
        z.segs.push({ ax: a.x, ay: a.y, ux: dx / len, uy: dy / len, len });
        x0 = Math.min(x0, a.x, b.x);
        x1 = Math.max(x1, a.x, b.x);
        y0 = Math.min(y0, a.y, b.y);
        y1 = Math.max(y1, a.y, b.y);
      }
      const h = z.width / 2;
      z.x0 = x0 - h;
      z.x1 = x1 + h;
      z.y0 = y0 - h;
      z.y1 = y1 + h;
    }
    out.push(z);
  }
  return out;
}

/** One zone with its run-dependent state: the initial sign and the reversal events (sorted start times, the sign after each). */
export interface FlowZone extends CompiledFlow {
  sign0: number;
  evT: Float64Array;
  evSign: Int8Array;
}

export interface FlowField {
  readonly zones: FlowZone[];
  /** Current direction scale (-1..1) per zone at `time` (see flowStep). */
  readonly scale: Float64Array;
  time: number;
  /** True when at least one zone exists (the hot-path guard). */
  readonly any: boolean;
}

const ease = (u: number): number => u * u * (3 - 2 * u);

/** Direction scale of a zone at `t` seconds: sign0 before its first reversal, then the telegraph / ramp pattern, then the new sign. */
export function flowScaleAt(z: FlowZone, t: number): number {
  const n = z.evT.length;
  if (n === 0 || t < z.evT[0]) return z.sign0;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (z.evT[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  const rv = z.reverse!;
  const prev = lo === 0 ? z.sign0 : z.evSign[lo - 1];
  const next = z.evSign[lo];
  const d = t - z.evT[lo];
  if (d < rv.telegraph) return prev * (1 - ease(d / rv.telegraph));
  if (d < rv.telegraph + rv.ramp) return next * ease((d - rv.telegraph) / rv.ramp);
  return next;
}

/** Phase of a zone at `t`: 0 steady, 1 telegraph (slowing to a stop), 2 ramp (picking up); `since` = seconds into the reversal. */
export function flowPhaseAt(z: FlowZone, t: number): { phase: 0 | 1 | 2; since: number; sign: number } {
  const n = z.evT.length;
  if (n === 0 || t < z.evT[0]) return { phase: 0, since: 0, sign: z.sign0 };
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (z.evT[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  const rv = z.reverse!;
  const prev = lo === 0 ? z.sign0 : z.evSign[lo - 1];
  const next = z.evSign[lo];
  const d = t - z.evT[lo];
  if (d < rv.telegraph) return { phase: 1, since: d, sign: prev };
  if (d < rv.telegraph + rv.ramp) return { phase: 2, since: d, sign: next };
  return { phase: 0, since: d, sign: next };
}

/**
 * Build the run's FlowField: initial signs and reversal schedules from `flowSeed` (one stream per zone, one per group; the area id
 * salts them so two areas never share belts). Zones sharing a `group` draw together; a group of two or more random zones always
 * contains both directions. Reversals are staggered across the zones of a group so they never all flip at once.
 */
export function buildFlowField(zones: readonly CompiledFlow[], areaId: string, flowSeed: number): FlowField {
  const seed = flowSeed >>> 0;
  // Initial signs: fixed senses as authored; random ones drawn per group in authored order.
  const signs = new Array<number>(zones.length).fill(1);
  const groups = new Map<string, number[]>();
  zones.forEach((z, k) => {
    if (z.sense === 'random') {
      const g = groups.get(z.group);
      if (g) g.push(k);
      else groups.set(z.group, [k]);
    } else signs[k] = z.sense;
  });
  for (const [g, members] of groups) {
    const rng = createRng(hashU32((seed ^ hashString(`flow:${areaId}:group:${g}`)) >>> 0));
    for (const k of members) signs[k] = rng.next() < 0.5 ? 1 : -1;
    if (members.length >= 2 && members.every((k) => signs[k] === signs[members[0]])) {
      const k = members[Math.min(members.length - 1, Math.floor(rng.next() * members.length))];
      signs[k] = -signs[k];
    }
  }
  // Stagger slots: position of each zone within its group (random or not) in authored order.
  const slot = new Array<number>(zones.length).fill(0);
  const size = new Map<string, number>();
  zones.forEach((z, k) => {
    const n = size.get(z.group) ?? 0;
    slot[k] = n;
    size.set(z.group, n + 1);
  });
  const out: FlowZone[] = zones.map((z, k) => {
    const evT: number[] = [];
    const evS: number[] = [];
    const rv = z.reverse;
    if (rv) {
      const rng = createRng(hashU32((seed ^ hashString(`flow:${areaId}:zone:${z.id}`)) >>> 0));
      const [lo, hi] = rv.every;
      const n = size.get(z.group) ?? 1;
      let t = lo * 0.5 + (hi - lo * 0.5) * ((slot[k] + rng.next()) / n);
      let cur = signs[k];
      while (t < FLOW_HORIZON) {
        const next = rv.mode === 'pingpong' ? -cur : rng.next() < 0.5 ? 1 : -1;
        if (next !== cur) {
          evT.push(t);
          evS.push(next);
          cur = next;
        }
        t += lo + rng.next() * (hi - lo);
      }
    }
    return Object.assign({}, z, { sign0: signs[k], evT: Float64Array.from(evT), evSign: Int8Array.from(evS) });
  });
  const scale = new Float64Array(out.length);
  for (let k = 0; k < out.length; k++) scale[k] = out[k].sign0;
  return { zones: out, scale, time: Number.NaN, any: out.length > 0 };
}

/** Fix the field at `time` seconds (idempotent for a repeated time). Call once per tick before any flowVelocity. */
export function flowStep(field: FlowField, time: number): void {
  if (field.time === time) return;
  field.time = time;
  const zs = field.zones;
  for (let k = 0; k < zs.length; k++) field.scale[k] = zs[k].reverse ? flowScaleAt(zs[k], time) : zs[k].sign0;
}

/** Scratch result of flowVelocity (no allocation in the sim). */
export const flowOut = { vx: 0, vy: 0 };

/**
 * The drift (u/s) of a body of class `body` (FLOW_PLAYER .. FLOW_AIR) standing at (x, y) at the field's current time, written to
 * `flowOut`; returns true when it is non-zero. Where zones overlap the strongest (largest magnitude) wins.
 */
export function flowVelocity(field: FlowField, x: number, y: number, body: number): boolean {
  flowOut.vx = 0;
  flowOut.vy = 0;
  const zs = field.zones;
  let best = 0;
  for (let k = 0; k < zs.length; k++) {
    const z = zs[k];
    if (x < z.x0 || x > z.x1 || y < z.y0 || y > z.y1) continue;
    const str = z.strength[body];
    const sc = field.scale[k];
    if (!(str > 0) || sc === 0) continue;
    let dx = 0;
    let dy = 0;
    let edge = 0;
    if (z.shape === 'annulus') {
      const ox = x - z.cx;
      const oy = y - z.cy;
      const d = Math.sqrt(ox * ox + oy * oy);
      if (d < z.r0 || d > z.r1 || d < 1e-6) continue;
      edge = Math.min(d - z.r0, z.r1 - d);
      dx = -oy / d;
      dy = ox / d;
    } else {
      const h = z.width / 2;
      let bestPerp = Infinity;
      let endFade = Infinity;
      const segs = z.segs;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        const rx = x - s.ax;
        const ry = y - s.ay;
        const along = rx * s.ux + ry * s.uy;
        if (along < 0 || along > s.len) continue;
        const perp = Math.abs(rx * -s.uy + ry * s.ux);
        if (perp <= h && perp < bestPerp) {
          bestPerp = perp;
          dx = s.ux;
          dy = s.uy;
          // The two free ends of the belt fade out like its sides (a hard flat end would turn a rounding error in a body's
          // position into a whole tick of drift: a prediction error of a full step).
          endFade = Math.min(i === 0 ? along : Infinity, i === segs.length - 1 ? s.len - along : Infinity);
        }
      }
      if (bestPerp === Infinity) continue;
      edge = Math.min(h - bestPerp, endFade);
    }
    const f = z.feather > 0 ? (edge >= z.feather ? 1 : edge / z.feather) : 1;
    const m = z.speed * str * sc * f;
    const am = m < 0 ? -m : m;
    if (am > best) {
      best = am;
      flowOut.vx = dx * m;
      flowOut.vy = dy * m;
    }
  }
  return best > 0;
}

/** Unit drift direction and zone speed at a point for presenters/validators ignoring strength and schedule: the authored direction. */
export function flowAuthoredDir(z: CompiledFlow, x: number, y: number): XY | null {
  if (z.shape === 'annulus') {
    const ox = x - z.cx;
    const oy = y - z.cy;
    const d = Math.sqrt(ox * ox + oy * oy);
    if (d < z.r0 || d > z.r1 || d < 1e-6) return null;
    return { x: -oy / d, y: ox / d };
  }
  const h = z.width / 2;
  let bestPerp = Infinity;
  let out: XY | null = null;
  for (const s of z.segs) {
    const rx = x - s.ax;
    const ry = y - s.ay;
    const along = rx * s.ux + ry * s.uy;
    if (along < 0 || along > s.len) continue;
    const perp = Math.abs(rx * -s.uy + ry * s.ux);
    if (perp <= h && perp < bestPerp) {
      bestPerp = perp;
      out = { x: s.ux, y: s.uy };
    }
  }
  return out;
}
