// Shared helpers for the bestiary FX modules (fx.ts, fxProjectiles.ts, fxDebuffs.ts, fxAreas.ts).
//
// Same raster conventions as src/art/fx.ts: soft edges are straight-alpha coverage, glowing pixels write the emissive
// layer with the same colour, and solid objects (hooks, spikes, links) are Sculpt-shaded with the top-left light and
// finished with the selective ink outline used by monsters and props.
import type { SpriteDef } from '../../contracts/art';
import { Frame, toSprite } from '../frame';
import type { Color } from '../palette';
import { lineCells } from '../raster';

export const TAU = Math.PI * 2;

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smooth = (t: number): number => {
  const u = clamp01(t);
  return u * u * (3 - 2 * u);
};

/** Pick a ramp entry by a continuous 0..1 value (clamped). */
export function pick(ramp: readonly Color[], v: number): Color {
  const i = Math.round(clamp01(v) * (ramp.length - 1));
  return ramp[i];
}

/** A SpriteDef with an explicit anchor. */
export function sprite(id: string, frames: Frame[], anchorX: number, anchorY: number, fps: number, loop: boolean): SpriteDef {
  return toSprite(id, frames, { anchorX, anchorY, fps, loop });
}

/** A centre-anchored SpriteDef (projectiles, most FX). */
export function centred(id: string, frames: Frame[], fps: number, loop: boolean): SpriteDef {
  return sprite(id, frames, Math.floor(frames[0].w / 2), Math.floor(frames[0].h / 2), fps, loop);
}

/** Radial soft disc: alpha(d) in 0..1 for d = distance / radius (optionally elliptical with `sy` = y radius factor). */
export function disc(f: Frame, cx: number, cy: number, r: number, col: Color, alpha: (d: number, x: number, y: number) => number, glow = 0, sy = 1): void {
  const x0 = Math.max(0, Math.floor(cx - r - 1));
  const x1 = Math.min(f.w - 1, Math.ceil(cx + r + 1));
  const y0 = Math.max(0, Math.floor(cy - r * sy - 1));
  const y1 = Math.min(f.h - 1, Math.ceil(cy + r * sy + 1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x + 0.5 - cx, (y + 0.5 - cy) / sy) / r;
      if (d > 1) continue;
      const a = alpha(d, x, y);
      if (a <= 0.02) continue;
      if (glow > 0) f.glowSoft(x, y, col, Math.min(1, a), glow);
      else f.c.plot(x, y, col, Math.min(1, a));
    }
  }
}

/** A 1 px line; `each(t, x, y)` paints every cell (t = 0 at the start, 1 at the end). */
export function walk(x0: number, y0: number, x1: number, y1: number, each: (t: number, x: number, y: number) => void): void {
  const ax = Math.round(x0);
  const ay = Math.round(y0);
  const bx = Math.round(x1);
  const by = Math.round(y1);
  const n = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1);
  lineCells(ax, ay, bx, by, (x, y) => each(Math.max(Math.abs(x - ax), Math.abs(y - ay)) / n, x, y));
}

/** Walk a polyline, calling `each` with the global parameter t (0..1 along the whole path). */
export function walkPath(pts: readonly (readonly [number, number])[], each: (t: number, x: number, y: number) => void): void {
  const n = pts.length - 1;
  for (let i = 0; i < n; i++) {
    walk(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], (t, x, y) => each((i + t) / n, x, y));
  }
}

/** Glowing pixel only where nothing brighter was painted yet (keeps white cores when strokes overlap). */
export function glowMax(f: Frame, x: number, y: number, col: Color, strength: number): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (!f.c.inside(xi, yi)) return;
  if ((f.e.get(xi, yi) & 255) > strength) return;
  f.glow(xi, yi, col, strength);
}

/** Integer-rounded pixel set on the colour layer only (clears any glow under it). */
export function put(f: Frame, x: number, y: number, c: Color): void {
  const xi = Math.round(x);
  const yi = Math.round(y);
  f.c.set(xi, yi, c);
  f.e.set(xi, yi, 0);
}

/** Composite a soft colour pixel (no glow). */
export function soft(f: Frame, x: number, y: number, c: Color, k: number): void {
  if (k <= 0) return;
  f.c.plot(Math.round(x), Math.round(y), c, Math.min(1, k));
}
