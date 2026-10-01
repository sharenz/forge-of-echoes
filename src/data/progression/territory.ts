// Territory layer constants (brief D sections 6 and 7). This file holds the daily surge today (slice G1); beacons and
// sigils (slice B1) append their own constants below. Every number of a rule lives here, never in the rules file.

// ---------------------------------------------------------------------------------------------
// Daily surge (D 7)
// ---------------------------------------------------------------------------------------------

/** Free surge charges per area per forge day, before the tree. */
export const SURGE_CHARGES = 3;
/** The forge day starts at this UTC hour (06:00 in central Europe, night in the Americas). */
export const SURGE_RESET_UTC_HOUR = 4;
export const SURGE_DAY_MS = 86_400_000;
/** What a spent charge adds to the expedition: "more" multipliers on the map-side luck. Quantity never applies to the map category (I1). */
export const SURGE_BONUS = { quantityMore: 30, rarityMore: 15 } as const;
/** A save can never hold more charges per area than this, whatever the tree says (defensive bound for normalisation). */
export const SURGE_MAX_CHARGES = 12;

/** Hourglass Sand: refills one area (D 7.4). Chances are per event, before personal rarity (capped at 100%). */
export const HOURGLASS_SAND = {
  /** Final-boss kill on a map of at least this tier. */
  bossMinTier: 3,
  bossChance: 0.05,
  /** Sealed areas' bosses roll this many times as often. */
  sealedBossMultiplier: 2,
  /** Completion chest, any tier. */
  chestChance: 0.03,
  /** Gold-grade event completion. */
  goldEventChance: 0.10,
  stack: 20,
} as const;

/** Grand Hourglass: refills every area (D 7.4). Final bosses of high tiers only. */
export const GRAND_HOURGLASS = { bossMinTier: 9, bossChance: 0.005, stack: 5 } as const;
