import type { Dir4 } from '../contracts/sim';
import { DAMAGE_TYPES, type DamageType } from '../contracts/content';

export const TAU = Math.PI * 2;
export const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function finiteOr(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

/**
 * First contact parameter t ∈ [0, 1] of a point moving A → B against a circle (C, r),
 * or -1 when it never touches. A point starting inside the circle contacts at t = 0.
 * This is the swept test that keeps fast projectiles from tunnelling through targets.
 */
export function sweepCircle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number): number {
  const fx = ax - cx;
  const fy = ay - cy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  const dx = bx - ax;
  const dy = by - ay;
  const a = dx * dx + dy * dy;
  if (a < 1e-12) return -1;
  const halfB = fx * dx + fy * dy;
  if (halfB >= 0) return -1; // moving away
  const disc = halfB * halfB - a * c;
  if (disc < 0) return -1;
  const t = (-halfB - Math.sqrt(disc)) / a;
  return t <= 1 ? t : -1;
}

/**
 * Four-way facing from a vector with hysteresis: the current axis is kept until the other one
 * clearly dominates, so diagonal movement does not flicker between sprites.
 */
export function dirFromVector(dx: number, dy: number, current: Dir4): Dir4 {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < 1e-6 && ay < 1e-6) return current;
  const bias = 1.2;
  const currentHorizontal = current === 'east' || current === 'west';
  const horizontal = currentHorizontal ? ax * bias >= ay : ax > ay * bias;
  if (horizontal) return dx >= 0 ? 'east' : 'west';
  return dy >= 0 ? 'south' : 'north';
}

export const DAMAGE_INDEX: Record<DamageType, number> = {
  physical: 0, fire: 1, cold: 2, lightning: 3, void: 4,
};

export function damageTypeAt(index: number): DamageType {
  return DAMAGE_TYPES[index] ?? 'physical';
}
