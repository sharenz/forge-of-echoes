// Shared executor helpers: behaviour flags, aim, and the projectile modifiers (fan, pierce, radius) an emitter applies to the
// resolved numbers. Pure reads of the runtime def and the player: no RNG, no world writes.
import type { AugmentRuntime, SkillRuntimeDef } from '../../contracts/sim';
import { TAU } from '../math';
import type { PlayerState } from '../world';
import type { FlagRef, ProjectileBehaviour } from './types';

/** Fan of extra bolts of a single-bolt skill (mirrors the rules' EXTRA_PROJECTILE_FAN). */
const EXTRA_FAN_PER_PROJECTILE = 0.12;
const EXTRA_FAN_MAX = 0.6;

export function hasFlag(p: PlayerState, def: SkillRuntimeDef, ref: FlagRef | undefined): boolean {
  return !!ref && (def.flags.includes(ref.skill) || p.flags.has(ref.player));
}

/** The first augment primitive of a kind on the def (the rules emit at most one of each). */
export function augmentOf<P extends AugmentRuntime['p']>(def: SkillRuntimeDef, p: P): Extract<AugmentRuntime, { p: P }> | undefined {
  const list = def.augments;
  if (!list) return undefined;
  for (const a of list) if (a.p === p) return a as Extract<AugmentRuntime, { p: P }>;
  return undefined;
}

/** Aim angle from the player to the cursor (falls back to the facing direction). */
export function aimAngle(p: PlayerState, aimX: number, aimY: number): number {
  const dx = aimX - p.x;
  const dy = aimY - p.y;
  if (dx * dx + dy * dy > 1) return Math.atan2(dy, dx);
  switch (p.facing) {
    case 'north': return -Math.PI / 2;
    case 'east': return 0;
    case 'west': return Math.PI;
    default: return Math.PI / 2;
  }
}

/** Projectiles of one cast (at least 1). */
export function projectileCount(def: SkillRuntimeDef): number {
  return Math.max(1, Math.floor(def.projectiles));
}

/** Total fan angle of a projectile skill's cast. */
export function fanSpread(p: PlayerState, def: SkillRuntimeDef, b: ProjectileBehaviour, count: number): number {
  if (hasFlag(p, def, b.circle)) return TAU * (count - 1) / count;
  if (b.spread === 'extra') return count > 1 ? (def.spread > 0 ? def.spread : Math.min(EXTRA_FAN_MAX, EXTRA_FAN_PER_PROJECTILE * (count - 1))) : 0;
  return def.spread > 0 ? def.spread : b.spread;
}

/** Enemies a projectile passes through (-1 = all). */
export function projectilePierce(p: PlayerState, def: SkillRuntimeDef, b: ProjectileBehaviour): number {
  if (b.pierce === 'all' || hasFlag(p, def, b.pierceAll)) return -1;
  return Math.max(0, Math.floor(def.pierce));
}

export function projectileRadius(def: SkillRuntimeDef, b: ProjectileBehaviour): number {
  return 'fixed' in b.radius ? b.radius.fixed : def.radius > 0 ? def.radius : b.radius.fallback;
}
