import { AUTHORITATIVE_SIMULATION_STEP_SECONDS } from "../../multiplayer/simulation";

export const MINIMUM_ACTION_RATE_PER_SECOND = 0.1;
export const MINIMUM_ACTION_TIME_SECONDS = AUTHORITATIVE_SIMULATION_STEP_SECONDS;
export const MINIMUM_CAST_TIME_SECONDS = MINIMUM_ACTION_TIME_SECONDS;

/** One attack animation cycle and one authoritative attack interval share this duration. */
export function resolveAttackTimeSeconds(attacksPerSecond: number): number {
  return Math.max(MINIMUM_ACTION_TIME_SECONDS, 1 / Math.max(MINIMUM_ACTION_RATE_PER_SECOND, attacksPerSecond));
}

/** Cast speed is a rate multiplier, so twice the speed halves the base cast time. */
export function resolveCastTimeSeconds(baseCastTime: number, castSpeedMultiplier: number): number {
  return Math.max(MINIMUM_CAST_TIME_SECONDS, baseCastTime / Math.max(MINIMUM_ACTION_RATE_PER_SECOND, castSpeedMultiplier));
}

export function resolveAnimationPlaybackRate(
  frameCount: number,
  frameRate: number,
  timing: { durationSeconds?: number; playbackRate?: number },
): number {
  if (timing.durationSeconds === undefined) return Math.max(0.1, timing.playbackRate ?? 1);
  const naturalDurationSeconds = frameCount / frameRate;
  return naturalDurationSeconds / Math.max(0.001, timing.durationSeconds);
}
