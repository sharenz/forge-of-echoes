// Colour helpers (pure). Colours travel to the GPU as packed RGBA8 words; WebGL platforms are little-endian, so
// byte 0 (red) is the low byte of the u32.
import type { RGB } from '../contracts/render';

function byte(v: number): number {
  // NaN-safe clamp to 0..255 with rounding.
  return v > 0 ? (v < 1 ? (v * 255 + 0.5) | 0 : 255) : 0;
}

/** Pack four 0..1 floats into a little-endian RGBA8 u32. */
export function packRGBA(r: number, g: number, b: number, a: number): number {
  return (byte(r) | (byte(g) << 8) | (byte(b) << 16) | (byte(a) << 24)) >>> 0;
}

export function packRGB(c: RGB | undefined, a: number, fallback: number): number {
  return c ? packRGBA(c[0], c[1], c[2], a) : fallback;
}

/** Unpack a little-endian RGBA8 u32 into 0..1 floats. */
export function unpackRGBA(v: number): [number, number, number, number] {
  return [(v & 255) / 255, ((v >>> 8) & 255) / 255, ((v >>> 16) & 255) / 255, ((v >>> 24) & 255) / 255];
}

/** "#rrggbb" → RGB 0..1. */
export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/(.)/g, '$1$1') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Smooth quadratic light falloff used by the light shader: (1 - d²/r²)², 0 outside the radius. */
export function lightFalloff(distance: number, radius: number): number {
  if (radius <= 0) return 0;
  const t = (distance * distance) / (radius * radius);
  if (t >= 1) return 0;
  const f = 1 - t;
  return f * f;
}

/**
 * Flicker phase (0..1) of a light from its world position. Continuous, so a moving light (a burning monster, a fire
 * projectile) drifts smoothly through phase instead of popping; the light shader uses whole multiples of 2π·seed,
 * so the wrap from 1 back to 0 is seamless. Static lights a few dozen units apart still flicker out of step.
 */
export function lightSeed(x: number, y: number): number {
  const s = x * 0.0123 + y * 0.0171;
  return s - Math.floor(s);
}

export const WHITE_RGBA = packRGBA(1, 1, 1, 1);
