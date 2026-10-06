// Custom effects a roster can attach to a projectile or an area it spawns, beyond the core's generic
// behaviour of each kind (see rosters/index.ts). A leaf module: rosters register their effects at load
// time (`const TAR_SPLASH = registerProjectileEffect({ … })`) and pass the returned handle to
// setProjectileEffect / AreaOptions.effect. Handles are small integers (stored in typed arrays).
// Effects are shared by every instance on the server: keep no per-run state in their closures (read
// and write the world, the area, the projectile or memoryOf instead), and draw randomness only from
// w.worldRng.
import type { PlayerState, World, Area } from './world';

export interface ProjectileEffect {
  /**
   * A hostile projectile connected with player `p` (after its damage and debuff rider, before it is
   * removed). `slot` is still valid: read its position, velocity and `w.projectiles.src[slot]` (the
   * monster that fired it, NO_SOURCE when unknown).
   */
  onHit?(w: World, slot: number, p: PlayerState): void;
  /** A lob landed at (x, y) (after its splash). */
  onLand?(w: World, slot: number, x: number, y: number): void;
  /** A flat projectile ran out of range (or left the arena) without hitting anyone. */
  onExpire?(w: World, slot: number): void;
  /** Every tick before it moves (player skill projectiles: Frost Orb fires its shards from here). */
  onTick?(w: World, slot: number): void;
}

export interface AreaEffect {
  /** Every tick while the area lives (after the core moved / resized it). */
  onTick?(w: World, a: Area): void;
  /** A telegraph resolved (after the core's damage and debuffs). */
  onResolve?(w: World, a: Area): void;
}

const projectileEffects: ProjectileEffect[] = [];
const areaEffects: AreaEffect[] = [];

/** Register a projectile effect; returns its handle (≥ 1). At most 255. */
export function registerProjectileEffect(e: ProjectileEffect): number {
  if (projectileEffects.length >= 255) throw new Error('sim: too many projectile effects');
  projectileEffects.push(e);
  return projectileEffects.length;
}

/** Register an area effect; returns its handle (≥ 1). */
export function registerAreaEffect(e: AreaEffect): number {
  areaEffects.push(e);
  return areaEffects.length;
}

/** The effect behind a handle (0 / unknown → undefined). */
export function projectileEffect(handle: number): ProjectileEffect | undefined {
  return handle > 0 ? projectileEffects[handle - 1] : undefined;
}

export function areaEffect(handle: number): AreaEffect | undefined {
  return handle > 0 ? areaEffects[handle - 1] : undefined;
}
