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
  /** Seconds after which one projectile may hit the same monster again (Spark); absent = never. */
  rehit?: number;
  /** Knockback multiplier of its hits (Kinetic Lance); absent = 1. */
  knock?: number;
}

/** An instant burst of damage around the caster that passes cover and shields (Glacial Nova). */
export interface BlastBehaviour {
  emitter: 'blast';
  /** Radius when the runtime def's radius is 0. */
  radius: number;
  /** Knockback of its hits (outward). */
  knock: number;
}

/**
 * A shell lobbed at the cursor (Cinder Mortar): it flies `flight` seconds over everything, bursts in the def's radius where it
 * lands, then leaves the def's `ground` primitive (burning ground).
 */
export interface LobBehaviour {
  emitter: 'lob';
  kind: ProjectileKind;
  flight: number;
  /** Farthest landing point when the runtime def's range is 0. */
  range: number;
  /** Blast radius when the runtime def's radius is 0. */
  radius: number;
}

/** Slow orbs that touch nothing and fire shards at the nearest enemy while they live (Frost Orb). */
export interface OrbBehaviour {
  emitter: 'orb';
  kind: ProjectileKind;
  speed: number;
  /** Seconds it lives when the runtime def's duration is 0. */
  duration: number;
  /** How far it looks for a target when the runtime def's radius is 0. */
  seek: number;
  /** Fan between several orbs (radians, total). */
  spread: number;
  shard: { kind: ProjectileKind; interval: number; speed: number; range: number; radius: number };
}

/** Telegraphed strikes around the cursor, or along a line with `tethered` (Storm Call): ground damage, past cover and shields. */
export interface StrikesBehaviour {
  emitter: 'strikes';
  /** Telegraph seconds before each strike falls. */
  telegraph: number;
  /** Scatter radius around the cursor when the runtime def's range is 0. */
  scatter: number;
  radius: number;
  /** The cursor is clamped to this distance from the caster. */
  reach: number;
  tethered?: FlagRef;
}

/** A row of spikes erupting one after another along a line toward the cursor (Glacial Spikes); `twin` doubles the row. */
export interface SpikesBehaviour {
  emitter: 'spikes';
  length: number;
  radius: number;
  /** The first spike erupts after `lead`, each next one `step` later. */
  lead: number;
  step: number;
  twin?: FlagRef;
  /** Angle of each twin line from the aim (radians). */
  twinAngle: number;
}

/** A movement buff (Phase Stride): the def's `stride` primitive for its duration. */
export interface StrideBehaviour {
  emitter: 'buff';
  buff: 'stride';
  duration: number;
  /** Casting it removes chill and root (Cleansing Stride). */
  cleanse?: FlagRef;
}

/** Focus (and life) restored over the def's duration, removing chill and Withered (Arcane Reprieve). */
export interface RestoreBehaviour {
  emitter: 'buff';
  buff: 'restore';
  duration: number;
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

export type SkillBehaviour =
  | ProjectileBehaviour | BurstBehaviour | ChainBehaviour | DashBehaviour | WardBehaviour
  | BlastBehaviour | LobBehaviour | OrbBehaviour | StrikesBehaviour | SpikesBehaviour | StrideBehaviour | RestoreBehaviour;
