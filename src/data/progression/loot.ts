// Loot & luck tables (GAME_SPEC §8–§9). Per kill, each category is rolled independently with
// chance = base × quantity / 100. The rarity of an equipment drop is weighted by m = rarity / 100.
import type { MonsterRarity } from '../../contracts/sim';
import type {
  CurrencyDropDef, FlaskDropDef, LootCategory, MonsterLootMultiplier, RarityWeightDef,
} from './types';

/** Base chance per kill (fraction) of each category at 100% item quantity. */
export const CATEGORY_CHANCE: Record<LootCategory, number> = {
  currency: 0.015,
  equipment: 0.009,
  flask: 0.01,
  map: 0.005,
};

/** Roll order of the categories (fixed so a seed always produces the same drops). */
export const CATEGORY_ORDER: readonly LootCategory[] = ['currency', 'equipment', 'flask', 'map'];

export const CURRENCY_DROPS: readonly CurrencyDropDef[] = [
  { currencyId: 'scrap', weight: 40, stack: [{ count: 1, weight: 75 }, { count: 2, weight: 20 }, { count: 3, weight: 5 }] },
  { currencyId: 'kindling', weight: 12 },
  { currencyId: 'mapDust', weight: 6 },
  { currencyId: 'solvent', weight: 2.5 },
  { currencyId: 'reforge', weight: 1.5 },
  { currencyId: 'threatGlyph', weight: 1.5 },
  { currencyId: 'essenceEmber', weight: 0.8 },
  { currencyId: 'essenceRime', weight: 0.8 },
  { currencyId: 'essenceStorm', weight: 0.8 },
  { currencyId: 'essenceVital', weight: 0.8 },
  { currencyId: 'essenceSwift', weight: 0.8 },
  { currencyId: 'seal', weight: 1.2 },
  { currencyId: 'rewardInk', weight: 0.6 },
  { currencyId: 'catalyst', weight: 0.5 },
  { currencyId: 'voidNeedle', weight: 0.2 },
  { currencyId: 'fractureCore', weight: 0.08 },
];

export const FLASK_DROPS: readonly FlaskDropDef[] = [
  { flaskId: 'lifeFlask', weight: 60 },
  { flaskId: 'focusFlask', weight: 40 },
  // Utility flasks (power rework): rarer than the two recovery flasks.
  { flaskId: 'quickstep', weight: 12 },
  { flaskId: 'aegis', weight: 10 },
  { flaskId: 'quicksilverMind', weight: 10 },
];

/**
 * Umbral Essence (void / physical damage and penetration) is not in the ordinary currency table: it comes from the Void Breach event
 * (Silver and Gold seals) and from the final boss of Tier `bossMinTier`+ maps. Each is rolled on its own rng stream, so it never moves
 * any other drop. `bossChance` scales with personal item rarity like the other boss extras.
 */
export const UMBRAL_ESSENCE = {
  bossMinTier: 8,
  bossChance: 0.3,
  /** Void Breach: Silver (grade 2) chance and Gold (grade 3) chance, both multiplied by the Voidtouched Atlas strength. */
  breachSilverChance: 0.3,
  breachGoldCount: 1,
} as const;

/** Equipment rarity weights (m = rarity / 100): normal 70 · magic 22·m · rare 1.6·m^1.3 · unique 0.2·m^1.5. */
export const EQUIPMENT_RARITY_WEIGHTS = {
  normal: { base: 70, exponent: 0 },
  magic: { base: 22, exponent: 1 },
  rare: { base: 1.6, exponent: 1.3 },
  unique: { base: 0.2, exponent: 1.5 },
} as const satisfies Record<string, RarityWeightDef>;

/** Dropped maps mirror equipment rarity (without uniques). */
export const MAP_RARITY_WEIGHTS = {
  normal: EQUIPMENT_RARITY_WEIGHTS.normal,
  magic: EQUIPMENT_RARITY_WEIGHTS.magic,
  rare: EQUIPMENT_RARITY_WEIGHTS.rare,
} as const satisfies Record<string, RarityWeightDef>;

/** Tier of a random map drop relative to the current map: same 60% · one lower 25% · one higher 15%. */
export const MAP_DROP_TIER_OFFSETS: readonly { offset: number; weight: number }[] = [
  { offset: 0, weight: 60 },
  { offset: -1, weight: 25 },
  { offset: 1, weight: 15 },
];

/** Magic and rare monsters: quantity and rarity multipliers (GAME_SPEC §8). */
export const MONSTER_LOOT_MULTIPLIERS: Record<MonsterRarity, MonsterLootMultiplier> = {
  normal: { quantity: 1, rarity: 1 },
  magic: { quantity: 1.5, rarity: 2 },
  rare: { quantity: 4, rarity: 3 },
};
/** The lieutenant and the boss roll their ordinary loot like rare monsters (on top of their guarantees). */
export const ELITE_LOOT_MULTIPLIER: MonsterLootMultiplier = MONSTER_LOOT_MULTIPLIERS.rare;

/** Guaranteed drops (GAME_SPEC §9). */
export const LIEUTENANT_LOOT = {
  equipment: 1,
  /** The last guaranteed item is at least rare with this chance; every item is at least magic. */
  rareChance: 0.3,
  currency: 2,
  mapChance: 0.5,
} as const;

export const BOSS_LOOT = {
  /** One guaranteed rare plus this many items of at least magic rarity. */
  extraEquipment: 1,
  currency: 3,
  /** Unique chance = uniqueChance × m (capped at 100%). */
  uniqueChance: 0.08,
} as const;

export const CHEST_LOOT = {
  // The removed wave-3 encounter's guarantees now arrive with successful completion.
  equipment: 2,
  lastRareChance: 0.3,
  currency: { min: 4, max: 5 },
  extraMapChance: 0.5,
  flasks: 1,
  /** One map at the current tier, with this chance of +1 tier (capped at the top tier). */
  mapTierUpgradeChance: 0.25,
} as const;
