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
