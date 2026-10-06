// Ground art of flow zones that are not conveyor belts (LayoutFlow.look, D 10.5a): a frost current on ice and a turning sand ring.
// Like `drawBelt` (layout-art-chainworks-coliseum.ts) the pattern slides by the zone's own integrated velocity, so what the eye
// reads (direction, speed, the slow-down before a reversal) is exactly what the sim and prediction apply to bodies on it.
//
//   frost  a pale sheet of ice with drifting streaks in three staggered lanes and small arrow ticks; a reversal's telegraph
//          flickers the rim and the ticks (the same rule as a belt: slowing to a stop, then picking up the other way).
//   sand   a raked sand band with moving rake marks and gold marker ticks pointing the way it turns.
import type { RGB } from '../contracts/render';
import type { XY } from '../data/layouts/compile';
import type { FlowLook } from '../data/layouts/schema';
import type { FrameCtx } from './context';
import type { Pen } from './pen';
import type { BeltLook } from './layout-art-chainworks-coliseum';

type Vis = (x: number, y: number, r: number) => boolean;

interface CurrentPalette {
  bed: RGB;
  bedAlpha: number;
  rim: RGB;
  warn: RGB;
  streak: RGB;
  tick: RGB;
  /** Streak length and the period along the path (u). */
  dash: number;
  step: number;
  additive: boolean;
}

const PALETTES: Record<Exclude<FlowLook, 'belt'>, CurrentPalette> = {
  frost: {
    bed: [0.55, 0.72, 0.9], bedAlpha: 0.1, rim: [0.72, 0.86, 1], warn: [1, 0.86, 0.5], streak: [0.85, 0.94, 1], tick: [0.7, 0.88, 1],
    dash: 22, step: 46, additive: true,
  },
  sand: {
    bed: [0.5, 0.4, 0.26], bedAlpha: 0.22, rim: [0.62, 0.5, 0.32], warn: [0.95, 0.7, 0.28], streak: [0.82, 0.68, 0.45], tick: [0.88, 0.69, 0.29],
    dash: 14, step: 30, additive: false,
  },
};

/** Lanes across the zone (fractions of the half width) and each lane's phase offset along the path (u). */
const LANES: readonly (readonly [number, number])[] = [[-0.55, 0], [0, 0.5], [0.55, 0.25]];

function S(pen: Pen, color: RGB, alpha: number, thickness: number, additive: boolean): ReturnType<Pen['shape']> {
  const o = pen.shape(color, alpha);
  o.thickness = thickness;
  if (additive) {
    o.additive = true;
    o.emissive = 0.4;
  }
  return o;
}

/** A frost current or a sand ring along `path` (a polyline, a closed polygon for an annulus), `w` wide. */
export function drawCurrent(pen: Pen, f: FrameCtx, kind: Exclude<FlowLook, 'belt'>, path: readonly XY[], w: number, look: BeltLook, vis: Vis): void {
  const pal = PALETTES[kind];
  const r = pen.r;
  const v = f.view;
  const flick = look.warn && !look.calm ? (Math.floor(look.time * 7) % 2 === 0 ? 1 : 0.3) : 1;
  const rim = look.warn ? pal.warn : pal.rim;
  const live = 0.3 + 0.7 * look.speed;
  let run = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const base = run;
    run += len;
    if (len < 1 || !vis((a.x + b.x) / 2, (a.y + b.y) / 2, len / 2 + w)) continue;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const nx = -uy;
    const ny = ux;
    r.line(a.x, a.y, b.x, b.y, S(pen, pal.bed, pal.bedAlpha, w, false));
    for (const s of [-1, 1]) {
      const o = (w / 2) * s;
      r.line(a.x + nx * o, a.y + ny * o, b.x + nx * o, b.y + ny * o, S(pen, rim, (look.warn ? 0.5 : 0.32) * flick, 2, pal.additive));
    }
    // Streaks: dashes in three lanes, sliding by the integrated velocity (scroll), fading with the live speed.
    for (const [lane, off] of LANES) {
      const ph = ((((look.scroll + off * pal.step) % pal.step) + pal.step) % pal.step);
      const lx = nx * lane * (w / 2) * 0.8;
      const ly = ny * lane * (w / 2) * 0.8;
      const first = Math.ceil((base - ph) / pal.step);
      for (let n = first; ; n++) {
        const s0 = n * pal.step + ph - base;
        if (s0 > len) break;
        const s1 = Math.min(len, s0 + pal.dash);
        if (s1 <= 0) continue;
        const c0 = Math.max(0, s0);
        const cx = a.x + ux * c0 + lx;
        const cy = a.y + uy * c0 + ly;
        if (cx < v.x0 - 30 || cx > v.x1 + 30 || cy < v.y0 - 30 || cy > v.y1 + 30) continue;
        r.line(cx, cy, a.x + ux * s1 + lx, a.y + uy * s1 + ly, S(pen, pal.streak, 0.32 * live, kind === 'sand' ? 1.5 : 2, pal.additive));
      }
    }
    // Direction ticks on the centre line every 4 periods: a small arrowhead the way the zone runs (or last ran).
    const tickStep = pal.step * 4;
    const tph = ((((look.scroll + pal.step * 0.75) % tickStep) + tickStep) % tickStep);
    const half = w * 0.18;
    for (let n = Math.ceil((base - tph) / tickStep); ; n++) {
      const s0 = n * tickStep + tph - base;
      if (s0 > len) break;
      if (s0 < 0) continue;
      const cx = a.x + ux * s0;
      const cy = a.y + uy * s0;
      if (cx < v.x0 - 30 || cx > v.x1 + 30 || cy < v.y0 - 30 || cy > v.y1 + 30) continue;
      const tx = cx + ux * 6 * look.sign;
      const ty = cy + uy * 6 * look.sign;
      for (const sd of [-1, 1]) r.line(tx, ty, cx - ux * 2 * look.sign + nx * half * sd, cy - uy * 2 * look.sign + ny * half * sd, S(pen, pal.tick, 0.5 * live * flick, 2, pal.additive));
    }
  }
}
