// DOM-only helpers, used lazily by icon()/portrait(). Nothing here runs during generation (so Node works).
import type { PixelImage } from '../contracts/art';

let canvas: HTMLCanvasElement | null = null;

/**
 * PNG data URL of `img`, upscaled with an integer nearest-neighbour factor so the result stays crisp. The factor is
 * `size / unit` rounded (at least 1): pass `unit` = the source width for "make it `size` px wide", or the icon grid
 * cell (32) for "make one cell `size` px".
 */
export function toDataUrl(img: PixelImage, size: number, unit = img.width): string {
  if (typeof document === 'undefined') return '';
  canvas ??= document.createElement('canvas');
  const scale = Math.max(1, Math.round(size / unit));
  const w = img.width * scale;
  const h = img.height * scale;
  canvas.width = w;
  canvas.height = h;
  // A CPU-backed canvas: with a GPU-accelerated one every toDataURL is a synchronous GPU read-back ("GPU stall due
  // to ReadPixels"), which made the first opening of an icon-heavy panel (the stash) hitch for over a second.
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return '';
  const out = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const sy = (y / scale) | 0;
    for (let x = 0; x < w; x++) {
      const si = (sy * img.width + ((x / scale) | 0)) * 4;
      const di = (y * w + x) * 4;
      out.data[di] = img.data[si];
      out.data[di + 1] = img.data[si + 1];
      out.data[di + 2] = img.data[si + 2];
      out.data[di + 3] = img.data[si + 3];
    }
  }
  ctx.putImageData(out, 0, 0);
  return canvas.toDataURL('image/png');
}
