// Fog reveal mask (brief A, 5.4): discs round every discovered node and capsules along open roads, at quarter
// resolution, upsampled with noise so the edge is ragged, then rimmed with a three-pixel ember burn line. Pure and
// deterministic; the renderer turns the result into canvases. Undiscovered nodes contribute nothing, so nothing leaks.
import { valueNoise, chamfer } from '../../art/shade';
import { CHART_H, CHART_W } from '../../art/atlas/geometry';

const LOW = 4;
const LW = CHART_W / LOW;
const LH = CHART_H / LOW;

export interface Disc { x: number; y: number; r: number }
export interface RevealInput { discs: readonly Disc[]; trail: readonly Disc[] }
export interface Reveal {
  /** 255 where the known ground shows. */
  alpha: Uint8Array;
  /** 0 none, 1 outer ember, 2 flame, 3 hot white: the burn line inside the edge. */
  rim: Uint8Array;
}

let NOISE: Float32Array | null = null;
function noise(): Float32Array {
  if (NOISE) return NOISE;
  NOISE = new Float32Array(CHART_W * CHART_H);
  for (let y = 0; y < CHART_H; y++) for (let x = 0; x < CHART_W; x++) {
    NOISE[y * CHART_W + x] = valueNoise(x, y, 11, 801) * 0.55 + valueNoise(x, y, 4.2, 802) * 0.3 + valueNoise(x, y, 26, 803) * 0.15;
  }
  return NOISE;
}

export const NODE_REVEAL_R = 84;
export const SEALED_REVEAL_R = 50;
export const ROAD_REVEAL_R = 28;

export function computeReveal(input: RevealInput): Reveal {
  const field = new Float32Array(LW * LH);
  const splat = (d: Disc): void => {
    if (d.r <= 0.5) return;
    const x0 = Math.max(0, Math.floor((d.x - d.r) / LOW)), x1 = Math.min(LW - 1, Math.ceil((d.x + d.r) / LOW));
    const y0 = Math.max(0, Math.floor((d.y - d.r) / LOW)), y1 = Math.min(LH - 1, Math.ceil((d.y + d.r) / LOW));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const dist = Math.hypot((x + 0.5) * LOW - d.x, (y + 0.5) * LOW - d.y);
      const v = 1 - dist / d.r;
      if (v > field[y * LW + x]) field[y * LW + x] = v;
    }
  };
  input.discs.forEach(splat);
  input.trail.forEach(splat);
  const n = noise();
  const alpha = new Uint8Array(CHART_W * CHART_H);
  for (let y = 0; y < CHART_H; y++) {
    const fy = Math.min(LH - 1.001, Math.max(0, (y + 0.5) / LOW - 0.5));
    const iy = Math.floor(fy), ty = fy - iy;
    for (let x = 0; x < CHART_W; x++) {
      const fx = Math.min(LW - 1.001, Math.max(0, (x + 0.5) / LOW - 0.5));
      const ix = Math.floor(fx), tx = fx - ix;
      const a = field[iy * LW + ix], b = field[iy * LW + ix + 1], c = field[(iy + 1) * LW + ix], d = field[(iy + 1) * LW + ix + 1];
      const f = a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
      if (f <= 0) continue;
      const v = f + (n[y * CHART_W + x] - 0.5) * 0.34;
      if (v > 0.14) alpha[y * CHART_W + x] = 255;
    }
  }
  // the burn line: distance from every revealed pixel to the nearest unrevealed one
  const inside = new Uint8Array(CHART_W * CHART_H);
  for (let i = 0; i < inside.length; i++) inside[i] = alpha[i] ? 1 : 0;
  const dist = chamfer(inside, CHART_W, CHART_H);
  const rim = new Uint8Array(CHART_W * CHART_H);
  for (let i = 0; i < rim.length; i++) {
    if (!inside[i]) continue;
    const d = dist[i];
    rim[i] = d <= 1.2 ? 3 : d <= 2.2 ? 2 : d <= 3.4 ? 1 : 0;
  }
  return { alpha, rim };
}
