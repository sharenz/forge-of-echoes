// Tunable item & crafting constants (GAME_SPEC §5–§6). Rules code reads these; it never hard-codes them.
import type { Rarity } from '../../contracts/items';
import type { ItemClass } from '../../contracts/content';

export interface AffixLimits {
  prefix: number;
  suffix: number;
}

/** Maximum prefixes / suffixes per rarity. Uniques carry fixed mods instead. */
export const AFFIX_LIMITS: Record<Exclude<Rarity, 'unique'>, AffixLimits> = {
  normal: { prefix: 0, suffix: 0 },
  magic: { prefix: 1, suffix: 1 },
  rare: { prefix: 3, suffix: 3 },
};

export interface CountWeight {
  count: number;
  weight: number;
}

/** Affix count when an item becomes magic (drops and Kindling Shard). */
export const MAGIC_AFFIX_COUNTS: readonly CountWeight[] = [
  { count: 1, weight: 50 },
  { count: 2, weight: 50 },
];

/** Total affix count when an item becomes rare (drops and Reforging Ember). */
export const RARE_AFFIX_COUNTS: readonly CountWeight[] = [
  { count: 3, weight: 25 },
  { count: 4, weight: 40 },
  { count: 5, weight: 25 },
  { count: 6, weight: 10 },
];

/** Scar risk applies when stability after paying is ≤ this (materials may raise it). */
export const SCAR_THRESHOLD = 2;
/** Chance to gain a scar when the risk applies. */
export const SCAR_CHANCE = 0.35;
export const MAX_SCARS = 2;

/** Items keep at most this many history lines (oldest dropped first). */
export const MAX_HISTORY_LINES = 40;

export const CURRENCY_STACK = 40;
export const RARE_CURRENCY_STACK = 20;
/** Flasks stack to 20 in grids and 5 per belt slot. */
export const FLASK_STACK = 20;
export const BELT_SLOT_CAPACITY = 5;

export const STASH_TAB_NAME_MAX = 24;

export const MIN_ITEM_LEVEL = 1;
export const MAX_ITEM_LEVEL = 100;

/** Classes that count as armour (map implicits such as "armour bases +2 stability" key off this). */
export const ARMOUR_CLASSES: readonly ItemClass[] = ['helmet', 'chest', 'gloves', 'boots'];
export const WEAPON_CLASSES: readonly ItemClass[] = ['wand', 'sceptre'];
export const JEWELLERY_CLASSES: readonly ItemClass[] = ['amulet', 'ring'];
