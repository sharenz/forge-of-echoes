// Canvas-free raster toolkit. Everything here works on raw RGBA bytes so generation runs in Node and the browser.
import type { PixelImage } from '../contracts/art';
import type { Color } from './palette';

export const CLEAR: Color = 0;

export const cr = (c: Color): number => (c >>> 24) & 255;
export const cg = (c: Color): number => (c >>> 16) & 255;
export const cb = (c: Color): number => (c >>> 8) & 255;
export const ca = (c: Color): number => c & 255;

export function rgba(r: number, g: number, b: number, a = 255): Color {
  const q = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  return ((q(r) << 24) | (q(g) << 16) | (q(b) << 8) | q(a)) >>> 0;
}

/** Linear mix of two colours (including alpha). */
export function mix(a: Color, b: Color, t: number): Color {
  return rgba(
    cr(a) + (cr(b) - cr(a)) * t,
    cg(a) + (cg(b) - cg(a)) * t,
    cb(a) + (cb(b) - cb(a)) * t,
    ca(a) + (ca(b) - ca(a)) * t,
  );
}

/** Perceived brightness 0..1. */
export function luma(c: Color): number {
  return (cr(c) * 0.299 + cg(c) * 0.587 + cb(c) * 0.114) / 255;
}

export class Raster {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8ClampedArray;

  constructor(w: number, h: number, data?: Uint8ClampedArray) {
    this.w = w;
    this.h = h;
    this.data = data ?? new Uint8ClampedArray(w * h * 4);
  }

  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  get(x: number, y: number): Color {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return CLEAR;
    const i = (y * this.w + x) * 4;
    const d = this.data;
    return ((d[i] << 24) | (d[i + 1] << 16) | (d[i + 2] << 8) | d[i + 3]) >>> 0;
  }

  alpha(x: number, y: number): number {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.data[(y * this.w + x) * 4 + 3];
  }

  opaque(x: number, y: number): boolean {
    return this.alpha(x, y) > 0;
  }

  /** Replace a pixel. */
  set(x: number, y: number, c: Color): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    const d = this.data;
    d[i] = c >>> 24;
    d[i + 1] = (c >>> 16) & 255;
    d[i + 2] = (c >>> 8) & 255;
    d[i + 3] = c & 255;
  }

  /** Source-over composite a pixel; `k` scales the source alpha. */
  plot(x: number, y: number, c: Color, k = 1): void {
    const sa = (ca(c) / 255) * k;
    if (sa <= 0) return;
    if (sa >= 1) return this.set(x, y, c);
    x = Math.floor(x);
    y = Math.floor(y);
    if (!this.inside(x, y)) return;
    const i = (y * this.w + x) * 4;
    const d = this.data;
    const da = d[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    d[i] = (cr(c) * sa + d[i] * da * (1 - sa)) / oa;
    d[i + 1] = (cg(c) * sa + d[i + 1] * da * (1 - sa)) / oa;
    d[i + 2] = (cb(c) * sa + d[i + 2] * da * (1 - sa)) / oa;
    d[i + 3] = oa * 255;
  }

  /** Additive light: adds `k`·colour to the RGB of an existing opaque pixel (used for glows on solid art). */
  add(x: number, y: number, c: Color, k = 1): void {
    x = Math.floor(x);
    y = Math.floor(y);
    if (!this.inside(x, y)) return;
    const i = (y * this.w + x) * 4;
    const d = this.data;
    d[i] += cr(c) * k;
    d[i + 1] += cg(c) * k;
    d[i + 2] += cb(c) * k;
  }

  clear(x: number, y: number): void {
    this.set(x, y, CLEAR);
  }

  fill(c: Color): this {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.set(x, y, c);
    return this;
  }

  rect(x: number, y: number, w: number, h: number, c: Color): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.plot(x + i, y + j, c);
  }

  hline(x0: number, x1: number, y: number, c: Color): void {
    if (x1 < x0) [x0, x1] = [x1, x0];
    for (let x = x0; x <= x1; x++) this.plot(x, y, c);
  }

  vline(x: number, y0: number, y1: number, c: Color): void {
    if (y1 < y0) [y0, y1] = [y1, y0];
    for (let y = y0; y <= y1; y++) this.plot(x, y, c);
  }

  /** Bresenham line (inclusive ends). */
  line(x0: number, y0: number, x1: number, y1: number, c: Color): void {
    lineCells(x0, y0, x1, y1, (x, y) => this.plot(x, y, c));
  }

  /** Filled ellipse tested at pixel centres. */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: Color): void {
    forEllipse(cx, cy, rx, ry, (x, y) => this.plot(x, y, c));
  }

  polygon(pts: readonly (readonly [number, number])[], c: Color): void {
    forPolygon(pts, (x, y) => this.plot(x, y, c));
  }

  /** Draw `src` onto this raster at (dx, dy). */
  blit(src: Raster, dx: number, dy: number, opts: { flipX?: boolean; flipY?: boolean; k?: number; replace?: boolean } = {}): void {
    const k = opts.k ?? 1;
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const sx = opts.flipX ? src.w - 1 - x : x;
        const sy = opts.flipY ? src.h - 1 - y : y;
        const c = src.get(sx, sy);
        if (ca(c) === 0) continue;
        if (opts.replace) this.set(dx + x, dy + y, c);
        else this.plot(dx + x, dy + y, c, k);
      }
    }
  }

  clone(): Raster {
    return new Raster(this.w, this.h, new Uint8ClampedArray(this.data));
  }

  /** Map every opaque pixel through `fn`. */
  map(fn: (c: Color, x: number, y: number) => Color): this {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const c = this.get(x, y);
        if (ca(c) === 0) continue;
        this.set(x, y, fn(c, x, y));
      }
    }
    return this;
  }

  isEmpty(): boolean {
    for (let i = 3; i < this.data.length; i += 4) if (this.data[i] > 0) return false;
    return true;
  }

  /** Bounding box of opaque pixels, or null. */
  bounds(): { x0: number; y0: number; x1: number; y1: number } | null {
    let x0 = this.w;
    let y0 = this.h;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.data[(y * this.w + x) * 4 + 3] === 0) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    return x1 < 0 ? null : { x0, y0, x1, y1 };
  }

  toImage(): PixelImage {
    return { width: this.w, height: this.h, data: new Uint8ClampedArray(this.data) };
  }
}

export function lineCells(x0: number, y0: number, x1: number, y1: number, fn: (x: number, y: number) => void): void {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    fn(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

export function forEllipse(cx: number, cy: number, rx: number, ry: number, fn: (x: number, y: number) => void): void {
  if (rx <= 0 || ry <= 0) return;
  const x0 = Math.floor(cx - rx);
  const x1 = Math.ceil(cx + rx);
  const y0 = Math.floor(cy - ry);
  const y1 = Math.ceil(cy + ry);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy <= 1) fn(x, y);
    }
  }
}

/** Scanline polygon fill at pixel centres (even-odd). */
export function forPolygon(pts: readonly (readonly [number, number])[], fn: (x: number, y: number) => void): void {
  if (pts.length < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  const xs: number[] = [];
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    const sy = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if ((a[1] <= sy && b[1] > sy) || (b[1] <= sy && a[1] > sy)) {
        xs.push(a[0] + ((sy - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = Math.ceil(xs[i] - 0.5);
      const xb = Math.floor(xs[i + 1] - 0.5);
      for (let x = xa; x <= xb; x++) fn(x, y);
    }
  }
}
