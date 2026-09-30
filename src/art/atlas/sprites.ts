// DOM helpers over the sprite bundle: boss portraits and family strips for the inspector (brief 9.2 spriteUrl).
import type { PixelImage, SpriteDef } from '../../contracts/art';
import { toDataUrl } from '../dom';

const cache = new Map<string, string>();

/** PNG data URL of one sprite frame at an integer scale (nearest-neighbour). '' outside a browser or for an unknown id. */
export function spriteUrl(sprites: readonly SpriteDef[], id: string, frame = 0, scale = 1): string {
  const key = `${id}#${frame}@${scale}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const def = sprites.find((s) => s.id === id);
  const img: PixelImage | undefined = def?.frames[frame % (def?.frames.length ?? 1)];
  const url = def && img ? toDataUrl(img, img.width * scale) : '';
  cache.set(key, url);
  return url;
}

export function spriteInfo(sprites: readonly SpriteDef[], id: string): { width: number; height: number; frames: number; fps: number } | null {
  const d = sprites.find((s) => s.id === id);
  return d ? { width: d.width, height: d.height, frames: d.frames.length, fps: d.fps } : null;
}

// ---- emblem and plate icons for DOM chips ---------------------------------------------------------------------
import type { MapBaseId } from '../../contracts/content';
import { emblem } from './emblems';
import { nodeFrame } from './plates';
import type { Material } from './geometry';

const emblemCache = new Map<string, string>();
/** The theme emblem as a data URL, `size` px wide (integer multiple of 24). */
export function emblemUrl(theme: MapBaseId, size = 48): string {
  const key = `${theme}@${size}`;
  let url = emblemCache.get(key);
  if (url === undefined) { url = toDataUrl(emblem(theme).c.toImage(), size); emblemCache.set(key, url); }
  return url;
}
/** A node plate (frame + emblem) as a data URL, `size` px wide (integer multiple of 42). */
export function plateUrl(material: Material, rivets: number, theme: MapBaseId, size = 42): string {
  const key = `plate|${material}|${rivets}|${theme}|${size}`;
  let url = emblemCache.get(key);
  if (url === undefined) { url = toDataUrl(nodeFrame(material, rivets, theme).c.toImage(), size); emblemCache.set(key, url); }
  return url;
}
