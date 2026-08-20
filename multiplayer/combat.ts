/** Shared simulation constants used by the authoritative server and its renderer. */
export const MULTIPLAYER_COMBAT = {
  world: { width: 3_840, height: 3_840, margin: 48 },
  player: {
    pickupRange: 54,
  },
  projectile: {
    speed: 520,
    collisionRadius: 25,
    basicRange: 700,
    novaRange: 340,
    flameWaveRange: 360,
  },
  monster: {
    contactRange: 34,
    contactCooldownMilliseconds: 900,
  },
} as const;

/**
 * Accepts commands that arrive up to one simulation tick before the replicated
 * room clock reaches their deadline, while anchoring the next deadline to the
 * previous cadence. This removes false rate-limit rejections without allowing
 * a client to accumulate extra attacks over time.
 */
export function advanceCooldownDeadline(
  nowMilliseconds: number,
  currentDeadlineMilliseconds: number,
  cooldownMilliseconds: number,
  earlyToleranceMilliseconds: number,
): number | null {
  if (nowMilliseconds + earlyToleranceMilliseconds < currentDeadlineMilliseconds) return null;
  return Math.max(nowMilliseconds, currentDeadlineMilliseconds) + cooldownMilliseconds;
}
