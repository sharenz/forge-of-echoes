// A frame is a colour raster plus an emissive raster of the same size; helpers turn frame lists into SpriteDefs.
import type { PixelImage, SpriteDef } from '../contracts/art';
import type { Color } from './palette';
import { Raster, ca, mix } from './raster';
import { outline, type OutlineOpts } from './shade';

export class Frame {
  readonly c: Raster;
  readonly e: Raster;

  constructor(w: number, h: number) {
    this.c = new Raster(w, h);
    this.e = new Raster(w, h);
  }

  get w(): number {
    return this.c.w;
  }
  get h(): number {
    return this.c.h;
  }

  /** Paint a glowing pixel: visible colour and emissive glow of the same colour. */
  glow(x: number, y: number, col: Color, strength = 255): void {
    this.c.set(x, y, col);
    this.e.set(x, y, (col & 0xffffff00) | Math.max(0, Math.min(255, Math.round(strength))));
  }

  /** Composite a glowing pixel with coverage `k` (soft FX edges). */
  glowSoft(x: number, y: number, col: Color, k: number, strength = 255): void {
    if (k <= 0) return;
    this.c.plot(x, y, col, k);
    this.e.plot(x, y, (col & 0xffffff00) | Math.max(0, Math.min(255, Math.round(strength))), k);
  }

  /** Emissive only (makes an existing pixel glow without changing its colour). */
  emit(x: number, y: number, col: Color, strength = 255): void {
    this.e.set(x, y, (col & 0xffffff00) | Math.max(0, Math.min(255, Math.round(strength))));
  }

  /** Remove a pixel from both layers. */
  erase(x: number, y: number): void {
    this.c.set(x, y, 0);
    this.e.set(x, y, 0);
  }

  outline(opts?: OutlineOpts): this {
    outline(this.c, opts);
    return this;
  }

  /** Emissive pixels must be visible pixels: drop glow where there is no colour. */
  clampEmissive(): this {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (!this.c.opaque(x, y) && this.e.opaque(x, y)) this.e.set(x, y, 0);
    return this;
  }

  /** Copy another frame onto this one (both layers). */
  draw(src: Frame, dx: number, dy: number, flipX = false): void {
    this.c.blit(src.c, dx, dy, { flipX });
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const sx = flipX ? src.w - 1 - x : x;
        const sc = src.c.get(sx, y);
        if (ca(sc) === 255) this.e.set(dx + x, dy + y, src.e.get(sx, y)); // opaque cover hides glow below
        else if (src.e.opaque(sx, y)) this.e.plot(dx + x, dy + y, src.e.get(sx, y));
      }
    }
  }

  clone(): Frame {
    const f = new Frame(this.w, this.h);
    f.c.blit(this.c, 0, 0, { replace: true });
    f.e.blit(this.e, 0, 0, { replace: true });
    return f;
  }

  /** Tint visible colour towards `col` by `t` (keeps alpha). */
  tint(col: Color, t: number): this {
    this.c.map((c) => (mix(c, col, t) & 0xffffff00) | ca(c));
    return this;
  }
}

export interface SpriteSpec {
  anchorX: number;
  anchorY: number;
  fps: number;
  loop: boolean;
}

/** Build a SpriteDef; the emissive array is only included when at least one frame glows. */
export function toSprite(id: string, frames: Frame[], spec: SpriteSpec): SpriteDef {
  if (frames.length === 0) throw new Error(`sprite ${id} has no frames`);
  const w = frames[0].w;
  const h = frames[0].h;
  for (const f of frames) if (f.w !== w || f.h !== h) throw new Error(`sprite ${id}: inconsistent frame size`);
  const colour: PixelImage[] = frames.map((f) => f.c.toImage());
  const glowing = frames.some((f) => !f.e.isEmpty());
  const def: SpriteDef = {
    id,
    width: w,
    height: h,
    frames: colour,
    anchorX: spec.anchorX,
    anchorY: spec.anchorY,
    fps: spec.fps,
    loop: spec.loop,
  };
  if (glowing) def.emissive = frames.map((f) => f.clampEmissive().e.toImage());
  return def;
}

// ---------------------------------------------------------------------------
// Pixel transforms
// ---------------------------------------------------------------------------

/**
 * Pixel-art-safe rotation (RotSprite): upscale 8x with Scale2x three times, rotate with nearest sampling,
 * sample back down. Keeps 1px lines and outlines coherent far better than naive rotation.
 */
export function rotSprite(src: Raster, angle: number, cx = src.w / 2, cy = src.h / 2): Raster {
  let big = src;
  for (let i = 0; i < 3; i++) big = scale2x(big);
  const out = new Raster(src.w, src.h);
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  for (let y = 0; y < out.h; y++) {
    for (let x = 0; x < out.w; x++) {
      const px = x + 0.5 - cx;
      const py = y + 0.5 - cy;
      const sx = px * cos - py * sin + cx;
      const sy = px * sin + py * cos + cy;
      const bx = Math.floor(sx * 8);
      const by = Math.floor(sy * 8);
      const c = big.get(bx, by);
      if (ca(c) > 0) out.set(x, y, c);
    }
  }
  return out;
}

export function rotFrame(src: Frame, angle: number, cx?: number, cy?: number): Frame {
  const f = new Frame(src.w, src.h);
  const rc = rotSprite(src.c, angle, cx, cy);
  const re = rotSprite(src.e, angle, cx, cy);
  f.c.blit(rc, 0, 0, { replace: true });
  f.e.blit(re, 0, 0, { replace: true });
  return f;
}

/** EPX / Scale2x. */
export function scale2x(src: Raster): Raster {
  const out = new Raster(src.w * 2, src.h * 2);
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const P = src.get(x, y);
      const A = src.get(x, y - 1);
      const B = src.get(x + 1, y);
      const Cc = src.get(x - 1, y);
      const D = src.get(x, y + 1);
      let e0 = P;
      let e1 = P;
      let e2 = P;
      let e3 = P;
      if (A !== D && Cc !== B) {
        if (Cc === A) e0 = A;
        if (A === B) e1 = B;
        if (Cc === D) e2 = Cc;
        if (D === B) e3 = D;
      }
      out.set(x * 2, y * 2, e0);
      out.set(x * 2 + 1, y * 2, e1);
      out.set(x * 2, y * 2 + 1, e2);
      out.set(x * 2 + 1, y * 2 + 1, e3);
    }
  }
  return out;
}
