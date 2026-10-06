// Damage-pipeline knobs of the power rework (docs/power-rework/power-curve.md sections 3, 4 and 11).
// Pure data: the sim (src/sim/combat.ts) and the rules (src/game/progression) both read these, so the
// tooltip, the sheet and the hit can never disagree about a cap.

/** Penetration per damage type, percentage points of monster resistance ignored (all sources summed). */
export const PEN_CAP = 40;

/**
 * Exposure: a timed, per-type resistance debuff on a monster. Does not stack (the strongest applies),
 * refreshes, can push resistance below zero but never below `floor`. Bosses and lieutenants take
 * `bossFactor` of it. All values in percentage points.
 */
export const EXPOSURE = { max: 25, floor: -25, duration: 4, bossFactor: 0.5 } as const;

/** Damage over time (ignite and friends) sees this share of the monster's resistance (1 = the full hit resistance). */
export const DOT_RESIST_FACTOR = 0.5;

/** Ceiling of the multiplicative pool (passives + augments + uniques); gear stays additive. */
export const MORE_CAP = 3.5;

/** The anti-degeneracy caps of power-curve.md section 11 that the rules resolve. */
export const STAT_CAPS = {
  /** Increased cast speed, percent. */
  castSpeed: 150,
  /** Increased cooldown recovery, percent. */
  cooldownRecovery: 100,
  /** Critical strike chance (fraction) and multiplier (percent). */
  critChance: 1,
  critMultiplier: 500,
  /** Increased area, percent (radius x1.41). */
  area: 100,
  /** Additional projectiles and pierce. */
  extraProjectiles: 6,
  pierce: 8,
  /** Total chains of one skill (its own plus Additional Chains). */
  chains: 12,
  /** Player resistance cap, percentage points: the class cap plus Maximum Resistances, never above the hard ceiling. */
  maxResistHard: 85,
  /** The `damageTaken` product from passives and ward never goes below this (reserved for the passive tree). */
  damageTakenFloor: 0.6,
} as const;
