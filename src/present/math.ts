// Small pure helpers shared by the presentation code (no allocation in any of them).

export const TAU = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const easeOutCubic = (t: number): number => 1 - (1 - t) * (1 - t) * (1 - t);
export const easeInCubic = (t: number): number => t * t * t;
export const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/** Frame-rate independent exponential approach factor for a rate in 1/s. */
export const approach = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

/** Deterministic 2D integer hash → u32. */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Deterministic 2D hash → [0, 1). */
export const hash01 = (x: number, y: number, seed = 0): number => hash2(x, y, seed) / 4294967296;

/** 1D integer hash → [0, 1) (per-entity phase offsets). */
export function hash1(n: number): number {
  let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise on an integer lattice with cell size `cell` → [0, 1). */
export function valueNoise(x: number, y: number, cell: number, seed: number): number {
  const fx = x / cell;
  const fy = y / cell;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = smoothstep(fx - ix);
  const ty = smoothstep(fy - iy);
  const a = hash01(ix, iy, seed);
  const b = hash01(ix + 1, iy, seed);
  const c = hash01(ix, iy + 1, seed);
  const d = hash01(ix + 1, iy + 1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/**
 * The world position at which the renderer draws a pivot at `v` (sprites snap to whole virtual pixels).
 * Mirrors render's snapToPixel so the follow camera can be derived from it (see src/render/index.ts).
 */
export function snapToPixel(v: number, zoom = 1): number {
  const z = zoom > 0 ? zoom : 1;
  return Math.round(v * z) / z;
}
