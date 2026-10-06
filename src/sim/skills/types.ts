// What the skill executor needs to know about one skill: which emitter it runs and that emitter's settings. The numbers come
// pre-resolved in SkillRuntimeDef (rules: game/progression/skills.ts); a behaviour only fills in the shape of the effect and the
// fallbacks for fields a runtime def leaves at 0 (sim fixtures and hand-built defs). Behaviours live per element in ./behaviours.
import type { ProjectileKind } from '../../contracts/sim';

/** A behaviour flag: present when the runtime def lists `skill` (augment or unique, resolved by the rules) or the player has `player`. */
export interface FlagRef {
  skill: string;
  player: string;
}

/** Straight projectiles in a fan (Ember Lance, Flame Wave, Rime Shards). */
export interface ProjectileBehaviour {
  emitter: 'projectile';
  /** Projectile kind (its PROJ index is looked up at release: behaviours load before sim/projectiles.ts finishes). */
  kind: ProjectileKind;
  speed: number;
  range: number;
  /** Hit radius: `fallback` when the runtime def's radius is 0, or always `fixed`. */
  radius: { fallback: number } | { fixed: number };
  /**
   * Fan when the runtime def's spread is 0: a number, or 'extra' (a single-bolt skill fans extra bolts 0.12 rad apart, at most 0.6:
   * EXTRA_PROJECTILE_FAN of the rules).
   */
  spread: number | 'extra';
  /** 'all' pierces everything; otherwise the def's pierce, or everything while `pierceAll` is set. */
  pierce: 'all' | 'def';
  pierceAll?: FlagRef;
  /** Projectiles spread in a full circle. */
  circle?: FlagRef;
  /** Repeats after a delay (item-granted; picked echoes arrive as an `echo` augment). */
  echo?: FlagRef;
}

/** A ring bursting outward from the caster (Ember Nova); a `fan` concentrates it toward the aim. */
export interface BurstBehaviour {
  emitter: 'burst';
  kind: ProjectileKind;
  speed: number;
  range: number;
  radius: number;
  fan?: FlagRef;
  echo?: FlagRef;
}

/** Lightning to the enemy nearest the cursor, then jumps (Arc Chain). */
export interface ChainBehaviour {
  emitter: 'chain';
  /** Jump range when the runtime def's radius is 0. */
  jump: number;
  /** Earlier targets may be struck again (never twice in a row). */
  revisit?: FlagRef;
}

/** A blink toward the cursor (Rift Step). */
export interface DashBehaviour {
  emitter: 'dash';
  distance: number;
  cleanse?: FlagRef;
  chillLanding?: FlagRef;
}

/** A timed buff on the caster (Cinder Ward). */
export interface WardBehaviour {
  emitter: 'buff';
  buff: 'ward';
  duration: number;
  restoreFocus?: FlagRef;
  renew?: FlagRef;
}

export type SkillBehaviour = ProjectileBehaviour | BurstBehaviour | ChainBehaviour | DashBehaviour | WardBehaviour;
