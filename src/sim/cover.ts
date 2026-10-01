// Cover: do tall props stand between two points? One scan, shared by projectile flight (projectiles.ts), the shooters' "is there
// anything to shoot at" gate (behaviour.ts shotClear) and the aim lines (clipped where they hit a wall).
//
// Tall solids come from the static PropGrid (each prop sits in every cell it can touch plus MAX_MONSTER_RADIUS of padding), sampled
// every <= 2 x SAMPLE units along the segment, so a long line costs a handful of list scans and a one-tick projectile step a single
// one. No allocation. A prop that already CONTAINS the segment's start never blocks (a shooter standing in or against a wall,
// a muzzle inside a prop's footprint: the shot leaves it and cannot re-enter it along a straight line).
import type { PropGrid } from './grid';
import type { World } from './world';

/** Maximum distance from a sample point to the segment points it answers for (must stay within the grid's padding). */
const SAMPLE = 24;

/**
 * Parameter t (0..1 along a -> b) where a point of radius `pad` first touches a tall prop, or -1 when the way is clear.
 */
export function coverHit(grid: PropGrid, ax: number, ay: number, bx: number, by: number, pad: number): number {
  if (grid.tallCount === 0) return -1;
  const dx = bx - ax;
  const dy = by - ay;
  const a = dx * dx + dy * dy;
  if (a < 1e-12) return -1;
  const steps = Math.max(1, Math.ceil(Math.sqrt(a) / (SAMPLE * 2)));
  let best = -1;
  for (let s = 0; s < steps; s++) {
    const f = (s + 0.5) / steps;
    const list = grid.near(ax + dx * f, ay + dy * f);
    for (let k = 0; k < list.length; k++) {
      const p = list[k];
      if (!p.tall) continue;
      const fx = ax - p.x;
      const fy = ay - p.y;
      const rr = p.radius + pad;
      const c = fx * fx + fy * fy - rr * rr;
      if (c <= 0) continue; // the start is inside it: the shot is leaving
      const halfB = fx * dx + fy * dy;
      if (halfB >= 0) continue; // moving away
      const disc = halfB * halfB - a * c;
      if (disc < 0) continue;
      const t = (-halfB - Math.sqrt(disc)) / a;
      if (t <= 1 && (best < 0 || t < best)) best = t;
    }
  }
  return best;
}

/** True when a tall prop stands between (ax, ay) and (bx, by) for a shot of radius `pad`. */
export function coverBlocked(w: World, ax: number, ay: number, bx: number, by: number, pad: number): boolean {
  return coverHit(w.propGrid, ax, ay, bx, by, pad) >= 0;
}

/** How far (u) a shot from (x, y) along `angle` flies clear before tall cover, capped at `length` (an aim line's visible length). */
export function coverClip(w: World, x: number, y: number, angle: number, length: number, pad: number): number {
  const t = coverHit(w.propGrid, x, y, x + Math.cos(angle) * length, y + Math.sin(angle) * length, pad);
  return t < 0 ? length : Math.max(1, length * t);
}

/** Whether (x, y) lies inside a tall prop's footprint (a muzzle that must fall back to the shooter's centre). */
export function insideCover(grid: PropGrid, x: number, y: number): boolean {
  if (grid.tallCount === 0) return false;
  const list = grid.near(x, y);
  for (let k = 0; k < list.length; k++) {
    const p = list[k];
    if (!p.tall) continue;
    const dx = x - p.x;
    const dy = y - p.y;
    if (dx * dx + dy * dy < p.radius * p.radius) return true;
  }
  return false;
}
