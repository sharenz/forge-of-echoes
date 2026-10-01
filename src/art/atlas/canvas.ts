// Browser-only bridges from the Raster/Frame toolkit to 2D canvases. The Atlas draws with plain 2D canvases (no
// engine library); the emissive layer of a frame is composited with `lighter` to get the in-game glow feel.
import type { Frame } from '../frame';
import type { Raster } from '../raster';

export type Surface = HTMLCanvasElement;

export function newCanvas(w: number, h: number): Surface {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function ctx2d(c: Surface): CanvasRenderingContext2D {
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

export function rasterToCanvas(r: Raster): Surface {
  const c = newCanvas(r.w, r.h);
  const ctx = ctx2d(c);
  const id = ctx.createImageData(r.w, r.h);
  id.data.set(r.data);
  ctx.putImageData(id, 0, 0);
  return c;
}

export interface FrameSurface { color: Surface; glow: Surface | null; w: number; h: number }
export function frameToSurface(f: Frame): FrameSurface {
  return { color: rasterToCanvas(f.c), glow: f.e.isEmpty() ? null : rasterToCanvas(f.e), w: f.w, h: f.h };
}

/** Draw a frame surface: colour first, then its glow layer added on top at `glowK` strength. */
export function drawFrameSurface(ctx: CanvasRenderingContext2D, s: FrameSurface, x: number, y: number, glowK = 1, alpha = 1): void {
  const a = ctx.globalAlpha;
  ctx.globalAlpha = a * alpha;
  ctx.drawImage(s.color, Math.round(x), Math.round(y));
  if (s.glow && glowK > 0) {
    const op = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = a * alpha * Math.min(1, glowK);
    ctx.drawImage(s.glow, Math.round(x), Math.round(y));
    ctx.globalCompositeOperation = op;
  }
  ctx.globalAlpha = a;
}
