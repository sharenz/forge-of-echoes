// Rook's stall (GAME_SPEC §9): maps, flasks, basic currency, and gambling by item class.
// Forge Scrap is the coin. The Tier 1 maps are free so the player can never be map-locked.
import type { GambleDef, MerchantStockDef } from './types';

export const MERCHANT_NAME = 'Rook';

/** Appraisal uses hundredths of Scrap, rounded up once at the end. */
export const EQUIPMENT_APPRAISAL = {
  base: 50, perBaseLevel: 1, perItemLevel: 1,
  worstAffix: 35, bestAffix: 100, uniqueMod: 70, uniqueFlag: 50, perScrap: 100,
} as const;

/**
 * Rook's maps (brief D 5.4): Normal Tier 1 and 2 maps of areas the account has cleared (and the starting area, so nobody is ever
 * map-locked), in three quality grades. They are generated, not listed: the offer id is `map:<areaId>:<tier>:<grade>`.
 */
export const ROOK_MAP_OFFER_PREFIX = 'map:';
export const ROOK_MAP_TIERS: readonly number[] = [1, 2];
export const ROOK_MAP_GRADES = [
  { id: 'plain', label: 'Plain', quality: 0, price: { 1: 0, 2: 4 } },
  { id: 'fine', label: 'Fine', quality: 6, price: { 1: 2, 2: 7 } },
  { id: 'pristine', label: 'Pristine', quality: 12, price: { 1: 6, 2: 12 } },
] as const satisfies readonly { id: string; label: string; quality: number; price: Record<number, number> }[];
export type RookMapGradeId = (typeof ROOK_MAP_GRADES)[number]['id'];

export const MERCHANT_STOCK: readonly MerchantStockDef[] = [
  { id: 'flask-life', kind: 'flask', flaskId: 'lifeFlask', count: 1, price: [{ currencyId: 'scrap', count: 1 }] },
  { id: 'flask-focus', kind: 'flask', flaskId: 'focusFlask', count: 1, price: [{ currencyId: 'scrap', count: 1 }] },
  { id: 'currency-kindling', kind: 'currency', currencyId: 'kindling', count: 1, price: [{ currencyId: 'scrap', count: 3 }] },
  { id: 'currency-mapDust', kind: 'currency', currencyId: 'mapDust', count: 1, price: [{ currencyId: 'scrap', count: 3 }] },
];

/** 6 Scrap buys a random item of the chosen class at the player's level. Chances scale with gear rarity. */
export const GAMBLE: GambleDef = {
  price: [{ currencyId: 'scrap', count: 6 }],
  chances: { magic: 25, rare: 6, unique: 0.5 },
  classes: ['wand', 'sceptre', 'focus', 'helmet', 'chest', 'gloves', 'boots', 'belt', 'amulet', 'ring'],
};

export const GAMBLE_OFFER_PREFIX = 'gamble-';
