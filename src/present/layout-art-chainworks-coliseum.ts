// Ground art of the Chainworks and Iron Coliseum layouts (D-territory.md 10.6 "hazard stripes, conveyor bands" and "sand rings"),
// kept out of layout-art.ts so the theme packs do not edit each other's code. layout-art.ts asks `themeRoad` / `themeGlyph`
// first and falls back to its generic look when they return false.
//
//   Chainworks   road decal >= 60 u wide: a conveyor belt (dark iron bed, rail edges, roller seams, chevrons drifting along the path);
//                road decal <= 24 u wide: a hazard stripe (diagonal gold and coal bars); anything else: the generic road.
//   Coliseum     glyph decal: a raked sand ring (soft concentric rakes and gold marker ticks), not the pulsing ember glyph;
//                road decal: the generic sand road plus raking lines along it.
import type { Theme } from '../contracts/content';
import type { RGB } from '../contracts/render';
import type { CompiledDecal } from '../data/layouts/compile';
import type { FrameCtx } from './context';
import type { Pen } from './pen';

const BED: RGB = [0.1, 0.09, 0.09];
const RAIL: RGB = [0.42, 0.3, 0.2];
const RAIL_HI: RGB = [0.62, 0.46, 0.26];
const SEAM: RGB = [0.04, 0.035, 0.04];
const CHEVRON: RGB = [0.78, 0.55, 0.22];
const HAZ_GOLD: RGB = [0.72, 0.52, 0.17];
const HAZ_COAL: RGB = [0.07, 0.06, 0.06];
const SAND_LIGHT: RGB = [0.82, 0.68, 0.45];
const SAND_DARK: RGB = [0.2, 0.15, 0.1];
const GOLD: RGB = [0.88, 0.69, 0.29];

const BELT_MIN_WIDTH = 60;
const STRIPE_MAX_WIDTH = 24;
const CHEVRON_STEP = 26;
const BELT_SPEED = 16; // u/s the chevrons drift along the path

type Vis = (x: number, y: number, r: number) => boolean;
interface Extras { thickness?: number; additive?: boolean; emissive?: number }

function S(pen: Pen, color: RGB, alpha: number, x: Extras = {}): ReturnType<Pen['shape']> {
  const o = pen.shape(color, alpha);
  if (x.thickness !== undefined) o.thickness = x.thickness;
  if (x.additive) o.additive = true;
  if (x.emissive !== undefined) o.emissive = x.emissive;
  return o;
}

/** A road decal in this theme: true when drawn here (the caller skips its generic road). */
export function themeRoad(theme: Theme, pen: Pen, f: FrameCtx, d: CompiledDecal, vis: Vis): boolean {
  if (theme === 'chainworks') {
    if (d.width >= BELT_MIN_WIDTH) {
      belt(pen, f, d, vis);
      return true;
    }
    if (d.width > 0 && d.width <= STRIPE_MAX_WIDTH) {
      stripes(pen, d, vis);
      return true;
    }
    return false;
  }
  return false;
}

/** A glyph decal in this theme: true when drawn here. */
export function themeGlyph(theme: Theme, pen: Pen, f: FrameCtx, d: CompiledDecal, vis: Vis): boolean {
  if (theme !== 'ironColiseum') return false;
  const rad = d.r > 0 ? d.r : 50;
  if (!vis(d.x, d.y, rad + 8)) return true;
  const r = pen.r;
  r.ring(d.x, d.y, rad, S(pen, SAND_DARK, 0.3, { thickness: 5 }));
  r.ring(d.x, d.y, rad - 2, S(pen, SAND_LIGHT, 0.28, { thickness: 1.5 }));
  r.ring(d.x, d.y, rad * 0.78, S(pen, SAND_LIGHT, 0.14, { thickness: 1 }));
  r.ring(d.x, d.y, rad * 0.56, S(pen, SAND_DARK, 0.2, { thickness: 3 }));
  const n = Math.max(8, Math.round(rad / 14));
  const pulse = 0.85 + 0.15 * Math.sin(f.time * 1.1 + d.x * 0.01);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    r.line(d.x + ca * (rad - 6), d.y + sa * (rad - 6), d.x + ca * (rad + 2), d.y + sa * (rad + 2), S(pen, GOLD, 0.34 * pulse, { thickness: 1.5 }));
  }
  return true;
}

function belt(pen: Pen, f: FrameCtx, d: CompiledDecal, vis: Vis): void {
  const r = pen.r;
  const v = f.view;
  const w = d.width;
  let run = 0; // distance along the whole path, so chevrons stay continuous across vertices
  for (let i = 1; i < d.path.length; i++) {
    const a = d.path[i - 1];
    const b = d.path[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const base = run;
    run += len;
    if (len < 1 || !vis((a.x + b.x) / 2, (a.y + b.y) / 2, len / 2 + w)) continue;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const nx = -uy;
    const ny = ux;
    r.line(a.x, a.y, b.x, b.y, S(pen, BED, 0.5, { thickness: w }));
    for (const s of [-1, 1]) {
      const o = (w / 2) * s;
      r.line(a.x + nx * o, a.y + ny * o, b.x + nx * o, b.y + ny * o, S(pen, RAIL, 0.62, { thickness: 3 }));
      r.line(a.x + nx * (o - 2 * s), a.y + ny * (o - 2 * s), b.x + nx * (o - 2 * s), b.y + ny * (o - 2 * s), S(pen, RAIL_HI, 0.22, { thickness: 1 }));
    }
    // Roller seams and drifting chevrons, only where the view is.
    const drift = (f.time * BELT_SPEED) % CHEVRON_STEP;
    const half = w * 0.36;
    for (let s = 0; s < len; s += CHEVRON_STEP / 2) {
      const cx = a.x + ux * s;
      const cy = a.y + uy * s;
      if (cx < v.x0 - 30 || cx > v.x1 + 30 || cy < v.y0 - 30 || cy > v.y1 + 30) continue;
      r.line(cx + nx * (w / 2 - 3), cy + ny * (w / 2 - 3), cx - nx * (w / 2 - 3), cy - ny * (w / 2 - 3), S(pen, SEAM, 0.18, { thickness: 1 }));
    }
    for (let s = -((base % CHEVRON_STEP) + CHEVRON_STEP); s < len + CHEVRON_STEP; s += CHEVRON_STEP) {
      const t = s + drift;
      if (t < 0 || t > len) continue;
      const cx = a.x + ux * t;
      const cy = a.y + uy * t;
      if (cx < v.x0 - 30 || cx > v.x1 + 30 || cy < v.y0 - 30 || cy > v.y1 + 30) continue;
      const tipX = cx + ux * 7;
      const tipY = cy + uy * 7;
      for (const sd of [-1, 1]) {
        r.line(tipX, tipY, cx + nx * half * sd, cy + ny * half * sd, S(pen, CHEVRON, 0.4, { thickness: 2.5 }));
      }
    }
  }
}

function stripes(pen: Pen, d: CompiledDecal, vis: Vis): void {
  const r = pen.r;
  const w = Math.max(8, d.width);
  for (let i = 1; i < d.path.length; i++) {
    const a = d.path[i - 1];
    const b = d.path[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1 || !vis((a.x + b.x) / 2, (a.y + b.y) / 2, len / 2 + w)) continue;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const nx = -uy;
    const ny = ux;
    r.line(a.x, a.y, b.x, b.y, S(pen, HAZ_COAL, 0.55, { thickness: w }));
    const step = w * 1.1;
    for (let s = 0; s < len; s += step) {
      const cx = a.x + ux * s;
      const cy = a.y + uy * s;
      if (!vis(cx, cy, w * 2)) continue;
      r.line(cx - nx * (w / 2) , cy - ny * (w / 2), cx + nx * (w / 2) + ux * w * 0.6, cy + ny * (w / 2) + uy * w * 0.6, S(pen, HAZ_GOLD, 0.6, { thickness: w * 0.3 }));
    }
  }
}
