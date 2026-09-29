// FROZEN CONTRACT — deterministic random number generator interface.
// Game rules and the simulation must never call Math.random() or Date.now();
// all randomness flows through an Rng created from a seed (see src/core/rng.ts).

export interface Rng {
  /** Uniform float in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** True with probability p. */
  chance(p: number): boolean;
  /** Uniform element of a non-empty array. */
  pick<T>(items: readonly T[]): T;
  /** Weighted element; weight <= 0 is never picked. Returns undefined if all weights are 0. */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T | undefined;
  /** Fisher–Yates shuffled copy. */
  shuffle<T>(items: readonly T[]): T[];
  /** Serializable internal state (u32). createRng(state) resumes the exact sequence. */
  state(): number;
  /** Derive an independent stream (e.g. separate combat and loot streams). */
  fork(salt: number): Rng;
}
