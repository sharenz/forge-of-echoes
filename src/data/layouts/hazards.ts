// Layout hazards: burning ground that IS the art (roadmap 4, "make the art keep its promises"). A decal authored with a `hazard`
// (a glowing slag pool, a lava crack) hurts a player standing on it; the presenter draws the same compiled shapes and the same
// flare schedule, so what glows is exactly what burns.
//
//   compileHazards(decals, compiled)  authored decals -> world-unit hazard shapes (seed-free, part of CompiledLayout)
//   hazardState(h, t)                 0 dormant / 1 telegraph (about to flare) / 2 burning, and the fraction through that state
//   hazardHits(h, x, y, pad)          is a body of radius `pad` at (x, y) on the hazard's burning footprint?
//
// DETERMINISM. Pure functions of (layout, R, sim time): a flaring crack's phase comes from a hash of its decal id, never the
// run seed, so the client (presenter, the bot in tests) derives the schedule from the area alone and no wire field exists.
// Damage is applied by the sim only (src/sim/layout-hazards.ts): nothing here moves anybody, so prediction is unaffected.
import type { LayoutDecal } from './schema';

interface XY { x: number; y: number }

/** Default width (u) of a burning crack's footprint (the crack is drawn about 6 u wide; it flares out to this). */
export const HAZARD_CRACK_WIDTH = 26;
/** Default flare schedule of a lava crack (seconds): one flare every `every`, `telegraph` of warning glow, then `active` burning. */
export const HAZARD_CRACK_CYCLE = { every: 8, telegraph: 1.5, active: 2.5 } as const;

export interface CompiledHazard {
  id: string;
  kind: 'burn';
  shape: 'disc' | 'band';
  /** disc */
  x: number;
  y: number;
  r: number;
  /** band: the polyline and its half width. */
  path: XY[];
  half: number;
  /** Flare schedule (null = always burning) and this hazard's phase offset into it (s). */
  cycle: { every: number; telegraph: number; active: number } | null;
  offset: number;
  /** Bounding box (inclusive). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function hash01(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/** The hazards of a layout: one per decal that carries `hazard` (pools are discs, cracks bands along their path). */
export function compileHazards(
  authored: readonly LayoutDecal[], compiled: readonly { id: string; x: number; y: number; r: number; path: XY[] }[],
): CompiledHazard[] {
  const out: CompiledHazard[] = [];
  authored.forEach((d, k) => {
    const hz = d.hazard;
    if (!hz) return;
    const c = compiled[k];
    const band = d.kind === 'crack' || d.kind === 'road';
    const cycle = hz.cycle === undefined ? (band ? { ...HAZARD_CRACK_CYCLE } : null) : hz.cycle ? { ...hz.cycle } : null;
    const h: CompiledHazard = {
      id: d.id, kind: hz.kind, shape: band ? 'band' : 'disc', x: c.x, y: c.y, r: c.r, path: band ? c.path.map((p) => ({ ...p })) : [],
      half: band ? (hz.width ?? HAZARD_CRACK_WIDTH) / 2 : 0, cycle, offset: cycle ? hash01(`hazard:${d.id}`) * cycle.every : 0,
      x0: 0, y0: 0, x1: 0, y1: 0,
    };
    if (band) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of h.path) {
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      }
      h.x0 = x0 - h.half; h.y0 = y0 - h.half; h.x1 = x1 + h.half; h.y1 = y1 + h.half;
    } else {
      h.r = hz.width !== undefined ? hz.width / 2 : c.r;
      h.x0 = h.x - h.r; h.y0 = h.y - h.r; h.x1 = h.x + h.r; h.y1 = h.y + h.r;
    }
    out.push(h);
  });
  return out;
}

/** Scratch result of hazardState (no allocation in the sim). */
export const hazardOut = { state: 0 as 0 | 1 | 2, u: 0 };

/**
 * The hazard's state at sim time `t` (seconds), written to `hazardOut`: 2 burning, 1 telegraph (it will burn in (1 - u) x telegraph
 * seconds), 0 dormant. `u` is the fraction through the current state. An always-burning hazard is 2 with u = 0.
 */
export function hazardState(h: CompiledHazard, t: number): typeof hazardOut {
  const c = h.cycle;
  if (!c) {
    hazardOut.state = 2;
    hazardOut.u = 0;
    return hazardOut;
  }
  const p = (((t + h.offset) % c.every) + c.every) % c.every;
  const dormant = c.every - c.telegraph - c.active;
  if (p < dormant) {
    hazardOut.state = 0;
    hazardOut.u = p / dormant;
  } else if (p < dormant + c.telegraph) {
    hazardOut.state = 1;
    hazardOut.u = (p - dormant) / c.telegraph;
  } else {
    hazardOut.state = 2;
    hazardOut.u = (p - dormant - c.telegraph) / c.active;
  }
  return hazardOut;
}

/** Is a body of radius `pad` at (x, y) touching the hazard's footprint (regardless of its state)? */
export function hazardHits(h: CompiledHazard, x: number, y: number, pad: number): boolean {
  if (x < h.x0 - pad || x > h.x1 + pad || y < h.y0 - pad || y > h.y1 + pad) return false;
  if (h.shape === 'disc') {
    const dx = x - h.x;
    const dy = y - h.y;
    const r = h.r + pad;
    return dx * dx + dy * dy <= r * r;
  }
  const lim = h.half + pad;
  const lim2 = lim * lim;
  const path = h.path;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const l2 = ex * ex + ey * ey;
    let u = l2 > 0 ? ((x - a.x) * ex + (y - a.y) * ey) / l2 : 0;
    u = u < 0 ? 0 : u > 1 ? 1 : u;
    const dx = x - (a.x + ex * u);
    const dy = y - (a.y + ey * u);
    if (dx * dx + dy * dy <= lim2) return true;
  }
  return false;
}
