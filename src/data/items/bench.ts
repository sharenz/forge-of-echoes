// The Crafting Bench (GAME_SPEC §12): deterministic "scaffolding". Each recipe adds one chosen affix at a
// fixed, modest tier for a fixed price. The rules (src/game/items/bench.ts) pick the tier and price from
// the tables below; nothing here is random.
//
//   • Tier: the best tier the item level unlocks, but never better than BENCH_BEST_TIER (tier numbers:
//     1 = best). An ilvl 20 ring gets T7 Hale (18–21 life); from ilvl 48 the 10-tier ladder stops at T4.
//   • Price: Forge Scrap by the granted tier's item-level requirement (a tier's power follows the item
//     level that unlocks it, whatever the length of its ladder), plus one essence whose tags match the
//     affix. Affixes no essence can add (critical, luck, focus, caster, utility) cost extra Scrap instead,
//     and luck affixes (item rarity / quantity) a multiple of that: an essence is worth roughly 20 Scrap,
//     and cheap bench luck on six slots would undercut the luck economy (GAME_SPEC §9).
//   • 1 Stability, no scar roll, at most one bench-crafted affix per item; removing it is free.
export interface BenchRecipeDef {
  /** Stable id sent by the client (`benchCraft.recipeId`). */
  id: string;
  /** An id from AFFIXES (tests/game-items/bench.test.ts checks every recipe resolves). */
  affixId: string;
}

/** The best (lowest-numbered) tier the bench ever grants. */
export const BENCH_BEST_TIER = 4;
/** Stability every bench craft costs. It never rolls a scar. */
export const BENCH_STABILITY_COST = 1;
/** Bench-crafted affixes an item may hold at once. */
export const BENCH_MAX_CRAFTED = 1;
/** Prefix of every recipe id. */
export const BENCH_RECIPE_PREFIX = 'bench:';

export interface BenchPriceBand {
  /** The granted tier's item-level requirement is at least this. */
  minItemLevel: number;
  /** Forge Scrap when the affix also takes a matching essence. */
  scrap: number;
  /** Forge Scrap when no essence matches the affix (it replaces the essence). */
  scrapWithoutEssence: number;
}

/**
 * Scrap price by the item level that unlocks the granted tier, cheapest first. The bench tiers unlock at
 * the shared price bands below; a 10-tier affix reaches the bench ceiling at ilvl 48.
 */
export const BENCH_PRICE_BANDS: readonly BenchPriceBand[] = [
  { minItemLevel: 1, scrap: 2, scrapWithoutEssence: 4 },
  { minItemLevel: 6, scrap: 3, scrapWithoutEssence: 6 },
  { minItemLevel: 14, scrap: 5, scrapWithoutEssence: 9 },
  { minItemLevel: 24, scrap: 7, scrapWithoutEssence: 12 },
  { minItemLevel: 36, scrap: 9, scrapWithoutEssence: 15 },
];

/**
 * Luck-tagged recipes (Fortunate, of Plenty) cost `scrapWithoutEssence` × this, rounded up: on par with
 * an essence recipe of the same band (an essence drops about 1/17 as often as a Scrap stack), e.g.
 * T4 Fortunate (14–16% rarity, ilvl 44) costs 38 Scrap instead of 15.
 */
export const BENCH_LUCK_PRICE_MULTIPLIER = 2.5;

function recipe(affixId: string): BenchRecipeDef {
  return { id: `${BENCH_RECIPE_PREFIX}${affixId}`, affixId };
}

/**
 * Every recipe, in bench display order (prefixes, then suffixes). One per affix family; the only affix
 * left out is "of Splintering" (a single T1 tier, which the bench never grants). Which recipes an item
 * sees follows the affix's own class allow-list and base-property requirement.
 */
export const BENCH_RECIPES: readonly BenchRecipeDef[] = [
  // --- prefixes ---------------------------------------------------------------------------------
  recipe('life'),
  recipe('focus'),
  recipe('addedSpellDamage'),
  recipe('spellDamage'),
  recipe('fireDamage'),
  recipe('coldDamage'),
  recipe('lightningDamage'),
  recipe('elementalDamage'),
  recipe('armourFlat'),
  recipe('evasionFlat'),
  recipe('armourPercent'),
  recipe('evasionPercent'),
  recipe('itemRarity'),
  recipe('lifeOnKill'),
  recipe('focusOnKill'),
  // --- suffixes ---------------------------------------------------------------------------------
  recipe('castSpeed'),
  recipe('critChance'),
  recipe('critMultiplier'),
  recipe('fireResistance'),
  recipe('coldResistance'),
  recipe('lightningResistance'),
  recipe('voidResistance'),
  recipe('allResistances'),
  recipe('moveSpeed'),
  recipe('focusRegen'),
  recipe('lifeRegen'),
  recipe('strength'),
  recipe('dexterity'),
  recipe('intelligence'),
  recipe('projectileSpeed'),
  recipe('area'),
  recipe('cooldownRecovery'),
  recipe('pickupRadius'),
  recipe('itemQuantity'),
  recipe('flaskEffect'),
  recipe('igniteChance'),
  recipe('chillChance'),
  recipe('shockChance'),
];

// ---------------------------------------------------------------------------------------------
// Map services (brief D 5.2 and 5.3): Re-chart and Recycle. Both are Forge Scrap sinks at the bench.
// ---------------------------------------------------------------------------------------------

/** Prefix of a Re-chart service id: `bench:rechart:<areaId>` (one service per legal target area). */
export const RECHART_SERVICE_PREFIX = 'bench:rechart:';

/**
 * Re-chart price: `ceil(base + perTier * tier) * (1 + escalation * hops so far)` Scrap. T1 2, T5 4, T9 6, T15 9; a map already
 * moved once pays 1.5x, twice 2x. Ledgerline (tree) takes 1 off, never below 1.
 */
export const RECHART = { base: 1, perTier: 0.5, escalation: 0.5 } as const;

/**
 * Recycle: `inputs` maps of one tier become one Normal map of a chosen area; the output's quality is
 * `min(maxQuality, floor(mean input quality) + qualityBonus)`. The price is the tier in Scrap (Ledgerline -1, minimum 1).
 */
export const RECYCLE = { inputs: 3, qualityBonus: 2, maxQuality: 20 } as const;
