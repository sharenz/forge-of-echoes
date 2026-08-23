/** Shared simulation constants used by the authoritative server and its renderer. */
export const MULTIPLAYER_COMBAT = {
  world: { width: 3_840, height: 3_840, margin: 48 },
  player: {
    pickupRange: 54,
    dashDistance: 105,
  },
  projectile: {
    speed: 520,
    collisionRadius: 25,
    basicRange: 700,
    novaRange: 340,
    flameWaveRange: 360,
    // Supports the maximum configured level-20 Nova cadence plus simultaneous
    // basic and Flame Wave attacks. This remains bounded well below the global
    // 4,096-projectile room capacity.
    maximumActivePerPlayer: 512,
    // Rendering is deliberately lower than simulation capacity. When full,
    // the client recycles the oldest visual so every new cast remains visible.
    maximumRenderedPerClient: 160,
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
