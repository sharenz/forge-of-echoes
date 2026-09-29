// Sprite metadata lookups cached once (the renderer's spriteInfo allocates; the draw loops must not).
import type { SpriteDef } from '../contracts/art';
import type { Renderer } from '../contracts/render';

export interface SpriteMeta {
  frames: number;
  fps: number;
  loop: boolean;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
}

const MISSING: SpriteMeta = { frames: 1, fps: 0, loop: false, width: 16, height: 16, anchorX: 8, anchorY: 16 };

export class SpriteTable {
  private readonly meta = new Map<string, SpriteMeta>();
  private readonly r: Renderer;

  constructor(r: Renderer) {
    this.r = r;
  }

  get(id: string): SpriteMeta {
    let m = this.meta.get(id);
    if (!m) {
      const info = this.r.spriteInfo(id);
      m = info
        ? { frames: info.frames, fps: info.fps, loop: info.loop, width: info.width, height: info.height, anchorX: info.anchorX, anchorY: info.anchorY }
        : MISSING;
      this.meta.set(id, m);
    }
    return m;
  }

  has(id: string): boolean {
    return this.r.hasSprite(id);
  }

  /** Frame for a time-driven animation (loop wraps, one-shots clamp). */
  frameAt(m: SpriteMeta, t: number): number {
    const f = Math.floor(t * (m.fps || 8));
    if (m.loop) return ((f % m.frames) + m.frames) % m.frames;
    return f < 0 ? 0 : f >= m.frames ? m.frames - 1 : f;
  }
}

/**
 * Wand-tip offsets per sorceress sprite frame, measured from the art itself: the emissive-weighted centroid of
 * the hottest emissive pixels (the wand's ember tip) relative to the sprite anchor. Frames without a clear tip
 * (e.g. death) fall back to a hand-height offset.
 */
export class WandTips {
  private readonly tips = new Map<string, Float32Array>();

  constructor(sprites: readonly SpriteDef[]) {
    for (const s of sprites) {
      if (!s.id.startsWith('sorceress/') || !s.emissive) continue;
      const out = new Float32Array(s.frames.length * 2);
      for (let f = 0; f < s.frames.length; f++) {
        const em = s.emissive[f];
        let sx = 0;
        let sy = 0;
        let sw = 0;
        let best = 0;
        if (em) {
          // Threshold at 70% of the brightest emissive alpha in the frame: only the tip, not glints on the robe.
          for (let i = 3; i < em.data.length; i += 4) if (em.data[i] > best) best = em.data[i];
          const cut = best * 0.7;
          for (let y = 0; y < em.height; y++) {
            for (let x = 0; x < em.width; x++) {
              const a = em.data[(y * em.width + x) * 4 + 3];
              if (a < cut || a === 0) continue;
              sx += x * a;
              sy += y * a;
              sw += a;
            }
          }
        }
        if (sw > 0) {
          out[f * 2] = sx / sw + 0.5 - s.anchorX;
          out[f * 2 + 1] = sy / sw + 0.5 - s.anchorY;
        } else {
          out[f * 2] = 4;
          out[f * 2 + 1] = -12;
        }
      }
      this.tips.set(s.id, out);
    }
  }

  /** Tip offset (dx, dy) from the anchor for `id` frame `frame` (flip mirrors x). Writes into `out`. */
  tip(id: string, frame: number, flip: boolean, out: { x: number; y: number }): { x: number; y: number } {
    const t = this.tips.get(id);
    if (!t || t.length === 0) {
      out.x = flip ? -4 : 4;
      out.y = -12;
      return out;
    }
    const n = t.length / 2;
    const f = Math.max(0, Math.min(n - 1, frame | 0));
    out.x = flip ? -t[f * 2] : t[f * 2];
    out.y = t[f * 2 + 1];
    return out;
  }
}

/** Half-size of the window (pixels) in which hot emissive pixels count as one cluster. */
const HOT_WINDOW = 3;

/**
 * Emissive hotspots measured from the art: for a sprite frame, the centre of its densest cluster of hot emissive
 * pixels (≥ 60% of the frame's brightest emissive alpha) relative to the anchor — the Warden's lantern, Varkus's
 * forge-hot shield boss, the Chainmaster's red-hot hooks. Lights hang there and follow the animation (the lantern
 * swings). Computed lazily per sprite id and cached; a sprite without emissive pixels answers null.
 */
export class Hotspots {
  private readonly defs = new Map<string, SpriteDef>();
  private readonly spots = new Map<string, Float32Array | null>();

  constructor(sprites: readonly SpriteDef[]) {
    for (const s of sprites) this.defs.set(s.id, s);
  }

  /** Offset (dx, dy) of the hotspot of `id` frame `frame` from the anchor (flip mirrors x) into `out`, or null. */
  at(id: string, frame: number, flip: boolean, out: { x: number; y: number }): { x: number; y: number } | null {
    let t = this.spots.get(id);
    if (t === undefined) {
      t = this.measure(id);
      this.spots.set(id, t);
    }
    if (!t) return null;
    const n = t.length / 3;
    const f = Math.max(0, Math.min(n - 1, frame | 0));
    if (t[f * 3 + 2] === 0) return null;
    out.x = flip ? -t[f * 3] : t[f * 3];
    out.y = t[f * 3 + 1];
    return out;
  }

  private measure(id: string): Float32Array | null {
    const s = this.defs.get(id);
    if (!s || !s.emissive) return null;
    const out = new Float32Array(s.frames.length * 3);
    let any = false;
    for (let f = 0; f < s.frames.length; f++) {
      const c = hotspot(s.emissive[f]?.data, s.width, s.height);
      if (!c) continue;
      out[f * 3] = c.x + 0.5 - s.anchorX;
      out[f * 3 + 1] = c.y + 0.5 - s.anchorY;
      out[f * 3 + 2] = 1;
      any = true;
    }
    return any ? out : null;
  }
}

/** Centre of the densest cluster of hot pixels in an emissive mask (straight RGBA), or null. Exported for tests. */
export function hotspot(data: Uint8ClampedArray | undefined, w: number, h: number): { x: number; y: number } | null {
  if (!data) return null;
  let best = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > best) best = data[i];
  if (best === 0) return null;
  const cut = best * 0.6;
  const hot = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : data[(y * w + x) * 4 + 3] >= cut ? data[(y * w + x) * 4 + 3] : 0);
  let bx = -1;
  let by = -1;
  let bestSum = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!hot(x, y)) continue;
      let sum = 0;
      for (let dy = -HOT_WINDOW; dy <= HOT_WINDOW; dy++) for (let dx = -HOT_WINDOW; dx <= HOT_WINDOW; dx++) sum += hot(x + dx, y + dy);
      if (sum > bestSum) {
        bestSum = sum;
        bx = x;
        by = y;
      }
    }
  }
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (let dy = -HOT_WINDOW; dy <= HOT_WINDOW; dy++) {
    for (let dx = -HOT_WINDOW; dx <= HOT_WINDOW; dx++) {
      const a = hot(bx + dx, by + dy);
      sx += (bx + dx) * a;
      sy += (by + dy) * a;
      sw += a;
    }
  }
  return sw > 0 ? { x: sx / sw, y: sy / sw } : null;
}
