// Ground art of the Chainworks and Iron Coliseum layouts (D-territory.md 10.6 "hazard stripes, conveyor bands" and "sand rings"),
// kept out of layout-art.ts so the theme packs do not edit each other's code. layout-art.ts asks `themeRoad` / `themeGlyph`
// first and falls back to its generic look when they return false.
//
//   Chainworks   road decal >= 60 u wide: STATIC deck plating (iron bed, rail edges, rivet seams: an apron or a gold road, it carries
//                nobody, so it never shows chevrons); road decal <= 24 u wide: a hazard stripe (diagonal gold and coal bars);
//                anything else: the generic road. Conveyor belts are NOT decals any more: they are layout flow zones (`flows`,
//                D 10.5a), drawn by `drawBelt` below from the same data the sim moves bodies with (chevrons scroll at the live
//                belt velocity, slow and flicker through a reversal's telegraph, then flip).
//   Coliseum     glyph decal: a raked sand ring (soft concentric rakes and gold marker ticks), not the pulsing ember glyph;
//                road decal: the generic sand road plus raking lines along it.
import type { Theme } from '../contracts/content';
import type { RGB } from '../contracts/render';
import type { CompiledDecal, XY } from '../data/layouts/compile';
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
      plating(pen, d, vis);
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

/** Static deck plating (an apron or a gold road): the belt's bed and rails without any motion. */
function plating(pen: Pen, d: CompiledDecal, vis: Vis): void {
  const r = pen.r;
  const w = d.width;
  for (let i = 1; i < d.path.length; i++) {
    const a = d.path[i - 1];
    const b = d.path[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1 || !vis((a.x + b.x) / 2, (a.y + b.y) / 2, len / 2 + w)) continue;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    const nx = -uy;
    const ny = ux;
    r.line(a.x, a.y, b.x, b.y, S(pen, BED, 0.4, { thickness: w }));
    for (const s of [-1, 1]) {
      const o = (w / 2) * s;
      r.line(a.x + nx * o, a.y + ny * o, b.x + nx * o, b.y + ny * o, S(pen, RAIL, 0.4, { thickness: 2 }));
    }
    for (let s = 14; s < len; s += 28) {
      const cx = a.x + ux * s;
      const cy = a.y + uy * s;
      if (!vis(cx, cy, w)) continue;
      r.line(cx + nx * (w / 2 - 3), cy + ny * (w / 2 - 3), cx - nx * (w / 2 - 3), cy - ny * (w / 2 - 3), S(pen, SEAM, 0.16, { thickness: 1 }));
    }
  }
}

/** What a belt looks like right now (from the flow field's live state; see LayoutArt.flows). */
export interface BeltLook {
  /** Chevron direction along the path: +1 as authored, -1 reversed (the direction the belt last ran until it has turned). */
  sign: number;
  /** Distance (u) the pattern has travelled along the path (signed): scroll = integral of the live belt velocity. */
  scroll: number;
  /** Live speed as a share of full speed (0 at the standstill of a reversal). */
  speed: number;
  /** In a reversal's telegraph (the belt is slowing to a stop): rails and chevrons flicker. */
  warn: boolean;
  /** Presentation clock (s) for the flicker. */
  time: number;
  /** prefers-reduced-motion: no scrolling, no flicker (the warning is a steady amber rail). */
  calm: boolean;
  /** Tint for themes without their own belt look (a current, a river): default is the Chainworks iron-and-amber. */
  tint?: RGB;
}

/**
 * A conveyor belt along `path` (a polyline, a closed polygon for an annulus), `w` wide: dark bed, rails, roller seams and chevrons.
 * The chevrons are periodic along the path and slide by `look.scroll`, so their direction and speed are the belt's own.
 */
export function drawBelt(pen: Pen, f: FrameCtx, path: readonly XY[], w: number, look: BeltLook, vis: Vis): void {
  const r = pen.r;
  const v = f.view;
  const ph = (((look.scroll % CHEVRON_STEP) + CHEVRON_STEP) % CHEVRON_STEP);
  const seamPh = (((look.scroll % (CHEVRON_STEP / 2)) + CHEVRON_STEP / 2) % (CHEVRON_STEP / 2));
  const flick = look.warn && !look.calm ? (Math.floor(look.time * 7) % 2 === 0 ? 1 : 0.25) : 1;
  const rail = look.warn ? HAZ_GOLD : look.tint ?? RAIL;
  const chev = look.tint ?? CHEVRON;
  const alpha = 0.42 * (0.3 + 0.7 * look.speed) * flick;
  let run = 0; // distance along the whole path, so chevrons stay continuous across vertices
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
    r.line(a.x, a.y, b.x, b.y, S(pen, BED, 0.5, { thickness: w }));
    for (const s of [-1, 1]) {
      const o = (w / 2) * s;
      r.line(a.x + nx * o, a.y + ny * o, b.x + nx * o, b.y + ny * o, S(pen, rail, look.warn ? 0.45 + 0.2 * flick : 0.62, { thickness: 3 }));
      r.line(a.x + nx * (o - 2 * s), a.y + ny * (o - 2 * s), b.x + nx * (o - 2 * s), b.y + ny * (o - 2 * s), S(pen, RAIL_HI, 0.22, { thickness: 1 }));
    }
    // Roller seams ride the belt too (half a chevron period), only where the view is.
    const half = w * 0.36;
    const seamFirst = Math.ceil((base - seamPh) / (CHEVRON_STEP / 2));
    for (let n = seamFirst; ; n++) {
      const arc = n * (CHEVRON_STEP / 2) + seamPh - base;
      if (arc > len) break;
      if (arc < 0) continue;
      const cx = a.x + ux * arc;
      const cy = a.y + uy * arc;
      if (cx < v.x0 - 30 || cx > v.x1 + 30 || cy < v.y0 - 30 || cy > v.y1 + 30) continue;
      r.line(cx + nx * (w / 2 - 3), cy + ny * (w / 2 - 3), cx - nx * (w / 2 - 3), cy - ny * (w / 2 - 3), S(pen, SEAM, 0.18, { thickness: 1 }));
    }
    const first = Math.ceil((base - ph) / CHEVRON_STEP);
    for (let n = first; ; n++) {
      const arc = n * CHEVRON_STEP + ph - base;
      if (arc > len) break;
      if (arc < 0) continue;
      const cx = a.x + ux * arc;
      const cy = a.y + uy * arc;
      if (cx < v.x0 - 30 || cx > v.x1 + 30 || cy < v.y0 - 30 || cy > v.y1 + 30) continue;
      const tipX = cx + ux * 7 * look.sign;
      const tipY = cy + uy * 7 * look.sign;
      for (const sd of [-1, 1]) {
        r.line(tipX, tipY, cx + nx * half * sd, cy + ny * half * sd, S(pen, chev, alpha, { thickness: 2.5 }));
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
