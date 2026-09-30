// Rook's stall (GAME_SPEC §9): maps, flasks, basic currency, and gambling by item class.
// Forge Scrap is the coin. The Tier 1 maps are free so the player can never be map-locked.
import { MAP_BASE_IDS } from '../../contracts/content';
import type { GambleDef, MerchantStockDef } from './types';

export const MERCHANT_NAME = 'Rook';

/** Appraisal uses hundredths of Scrap, rounded up once at the end. */
export const EQUIPMENT_APPRAISAL = {
  base: 50, perBaseLevel: 1, perItemLevel: 1,
  worstAffix: 35, bestAffix: 100, uniqueMod: 70, uniqueFlag: 50, perScrap: 100,
} as const;

export const MERCHANT_STOCK: readonly MerchantStockDef[] = [
  ...MAP_BASE_IDS.map((baseId): MerchantStockDef => ({ id: `map-t1-${baseId}`, kind: 'map', baseId, tier: 1, price: [] })),
  ...MAP_BASE_IDS.map((baseId): MerchantStockDef => ({
    id: `map-t2-${baseId}`, kind: 'map', baseId, tier: 2, price: [{ currencyId: 'scrap', count: 4 }],
  })),
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
