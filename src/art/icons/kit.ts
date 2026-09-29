// Shared icon helpers. Icons are drawn at 32 px per inventory cell on a transparent background: 1x1 icons are
// 32x32, equipment bases take their grid footprint (a 1x3 wand is 32x96, a 2x2 helmet 64x64), so every icon in
// the grid has the same pixel density. Items are key-lit from the top-left (Sculpt shading) and get a warm rim
// light on their upper-right silhouette edge plus a 1px ink outline, so they read on any dark UI slot.
import type { PixelImage } from '../../contracts/art';
import { Frame } from '../frame';
import { C, type Color, type Ramp } from '../palette';
import { ca, lineCells, mix } from '../raster';
import { Sculpt, type PrimStyle } from '../shade';

export const ICON = 32;

/** A blank icon canvas of `cw` x `ch` inventory cells (32 px each). */
export const newIcon = (cw = 1, ch = 1): Frame => new Frame(ICON * cw, ICON * ch);

export const px = (f: Frame, x: number, y: number, c: Color): void => f.c.set(Math.round(x), Math.round(y), c);
export const onBody = (f: Frame, x: number, y: number, c: Color): void => {
  if (f.c.opaque(Math.round(x), Math.round(y))) px(f, x, y, c);
};
export const line = (f: Frame, x0: number, y0: number, x1: number, y1: number, c: Color): void => lineCells(x0, y0, x1, y1, (x, y) => px(f, x, y, c));

/** A line drawn only over pixels that are already part of the item. */
export const lineOn = (f: Frame, x0: number, y0: number, x1: number, y1: number, c: Color): void => lineCells(x0, y0, x1, y1, (x, y) => onBody(f, x, y, c));

/** A two-pixel-wide line (the second pixel below or right of the first, depending on the slope). */
export function line2(f: Frame, x0: number, y0: number, x1: number, y1: number, c: Color, c2: Color = c): void {
  const steep = Math.abs(y1 - y0) > Math.abs(x1 - x0);
  lineCells(x0, y0, x1, y1, (x, y) => {
    px(f, x, y, c);
    if (steep) px(f, x + 1, y, c2);
    else px(f, x, y + 1, c2);
  });
}

/** Rim light + outline, returning the finished image. */
export function finishIcon(f: Frame, rim: Color = C.flame, strength = 0.38): PixelImage {
  const r = f.c;
  const lit: [number, number, Color][] = [];
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const c = r.get(x, y);
      if (ca(c) < 200) continue;
      const open = !r.opaque(x + 1, y) || !r.opaque(x + 1, y - 1) || !r.opaque(x, y - 1);
      if (open && !r.opaque(x + 1, y - 1)) lit.push([x, y, (mix(c, rim, strength) & 0xffffff00) | ca(c)]);
    }
  }
  for (const [x, y, c] of lit) r.set(x, y, c);
  f.outline({ selective: false, color: C.ink });
  return r.toImage();
}

/** A faceted gem: rounded body, bright facet top-left, dark facet bottom-right, one sparkle. */
export function gem(f: Frame, cx: number, cy: number, rx: number, ry: number, ramp: Ramp): void {
  const s = new Sculpt();
  s.ell(cx, cy, rx, ry, { ramp, bias: 0.3, round: 0.8, dither: 0.06 });
  s.render(f.c, f.e);
  const n = ramp.length;
  px(f, cx - rx * 0.4, cy - ry * 0.4, ramp[n - 1]);
  if (rx >= 2) {
    px(f, cx - rx * 0.4 + 1, cy - ry * 0.4, ramp[n - 2]);
    px(f, cx + rx * 0.35, cy + ry * 0.35, ramp[1]);
  }
  px(f, cx - rx * 0.4, cy - ry * 0.4, C.white);
}

/** A ring seen in 3/4: an elliptical band (lit on the top-left) with a setting on top. */
export function ringBand(f: Frame, cx: number, cy: number, rx: number, ry: number, thick: number, ramp: Ramp): void {
  const n = ramp.length;
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      const o = Math.hypot(dx / rx, dy / ry);
      const i = Math.hypot(dx / (rx - thick), dy / (ry - thick * 0.75));
      if (o > 1 || i < 1) continue;
      const a = Math.atan2(dy, dx);
      // outer face lit top-left, inner face (far side, seen through the ring) darker
      const back = dy < 0;
      let v = 0.55 - Math.cos(a) * 0.25 - Math.sin(a) * 0.35;
      if (back) v -= 0.25;
      const edge = o > 0.86 ? 0.1 : 0;
      v += edge;
      px(f, x, y, ramp[Math.max(0, Math.min(n - 1, Math.round(v * (n - 1))))]);
    }
  }
}

/** A glass vessel: round-bottomed flask with a neck and cork, filled with `liquid`. */
export function flaskShape(f: Frame, cx: number, cy: number, r: number, liquid: Ramp, level = 0.6): void {
  const s = new Sculpt();
  const glass: PrimStyle = { ramp: [C.ink, C.coal, C.char, C.iron, C.stoneLight, C.bone], bias: 0.1, round: 0.8 };
  s.poly([[cx - r * 0.35, cy - r * 0.6], [cx + r * 0.35, cy - r * 0.6], [cx + r * 0.35, cy - r * 1.6], [cx - r * 0.35, cy - r * 1.6]], { ...glass, cyl: 1 }, 1);
  s.ell(cx, cy, r, r, glass);
  s.render(f.c, f.e);
  // liquid with a meniscus line and a lit left side
  const top = cy + r - level * 2 * r;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d > r - 1.2 || y + 0.5 < top) continue;
      const u = (x + 0.5 - cx) / r;
      const v = (y + 0.5 - top) / (cy + r - top);
      let k = 2.6 - u * 1.2 - v * 1.1;
      if (Math.abs(y + 0.5 - top) < 0.8) k = liquid.length - 1.2;
      px(f, x, y, liquid[Math.max(0, Math.min(liquid.length - 1, Math.round(k)))]);
    }
  }
  // glass highlights and the cork
  line(f, cx - r * 0.6, cy - r * 0.35, cx - r * 0.35, cy - r * 0.6, C.white);
  px(f, cx - r * 0.7, cy, C.bone);
  const ny = Math.round(cy - r * 1.6);
  for (let x = Math.round(cx - r * 0.35); x <= Math.round(cx + r * 0.35); x++) {
    px(f, x, ny - 1, x < cx ? C.woodLight : C.wood);
    px(f, x, ny - 2, x < cx ? C.wood : C.woodDark);
  }
  for (let x = Math.round(cx - r * 0.45); x <= Math.round(cx + r * 0.45); x++) px(f, x, ny, C.metalLight);
}

/** Sparkle cross used to mark magic in several icons. */
export function sparkle(f: Frame, x: number, y: number, c: Color = C.white, arm = 1): void {
  px(f, x, y, c);
  for (let i = 1; i <= arm; i++) {
    const k: Color = i === arm ? mix(c, C.flame, 0.3) : c;
    px(f, x + i, y, k);
    px(f, x - i, y, k);
    px(f, x, y + i, k);
    px(f, x, y - i, k);
  }
}
