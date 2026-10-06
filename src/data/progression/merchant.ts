// Rook's stall (GAME_SPEC §9): the wares board (luck-driven maps and items), the staples shelf (flasks, Kindling, Map Dust) and gambling
// by item class. Forge Scrap is the coin. The wares board always carries one cheap plain map so nobody is map-locked.
import type { CurrencyId } from '../../contracts/content';
import type { WareQuality } from '../../contracts/game';
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
  { id: 'flask-quickstep', kind: 'flask', flaskId: 'quickstep', count: 1, price: [{ currencyId: 'scrap', count: 3 }] },
  { id: 'flask-aegis', kind: 'flask', flaskId: 'aegis', count: 1, price: [{ currencyId: 'scrap', count: 3 }] },
  { id: 'flask-quicksilver', kind: 'flask', flaskId: 'quicksilverMind', count: 1, price: [{ currencyId: 'scrap', count: 3 }] },
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

// ---------------------------------------------------------------------------------------------
// Rook's wares board (GAME_SPEC §9): four maps and eight items per character, rolled from a seed (character id and stock epoch) and
// mostly junk. Nothing here is chosen by the player: no tier, quality or area pickers. Every number is tuning data.
// ---------------------------------------------------------------------------------------------
export const WARE_QUALITIES: readonly WareQuality[] = ['junk', 'okay', 'good', 'jackpot'];

export const WARES = {
  /** The wares rotate every `rotationHours` hours on the forge clock (04:00 UTC anchor, the same clock as the daily surge). */
  rotationHours: 6,
  /** Slots 0..mapSlots-1 are maps (slot 0 is the guaranteed plain map), then itemSlots items (the first is Rook's pick). */
  mapSlots: 4,
  itemSlots: 8,
  /** Percent chance per slot. One jackpot per ~8 boards: 1 - (1 - 0.011)^10 * (1 - 0.022) = 12.4%. */
  odds: { junk: 70, okay: 22, good: 6.9, jackpot: 1.1 } satisfies Record<WareQuality, number>,
  /** Rook's pick (the first item slot): the lucky tiers are doubled, junk gives way. */
  pickOdds: { junk: 62, okay: 22, good: 13.8, jackpot: 2.2 } satisfies Record<WareQuality, number>,
  /** "Ask for new wares": Scrap price doubles with every use in one rotation (3, 6, 12, 24, 48, then 48), back to the base at the next rotation. */
  reroll: { base: 3, max: 48 },
  /** Item level around the character level, by luck (jackpots may roll above the character). */
  itemLevelOffset: { junk: [-4, 0], okay: [-2, 1], good: [0, 3], jackpot: [3, 8] } satisfies Record<WareQuality, readonly [number, number]>,
  /** Wearable-unique level slack: a jackpot unique may need a little more level than the character has. */
  uniqueLevelSlack: 3,
  /** Maps: tier is the highest completed + 1 plus an offset (never below 1, never above the area's ceiling). */
  map: {
    tierOffset: { junk: [-2, 0], okay: [-1, 0], good: [0, 1], jackpot: [1, 3] } satisfies Record<WareQuality, readonly [number, number]>,
    /** Any map may be "occasionally higher": this chance of +1..+2 tiers on top. */
    higherChance: 0.08,
    /** Share of maps with quality 0; the rest roll inside the range. */
    zeroQuality: { junk: 0.8, okay: 0.15, good: 0, jackpot: 0 } satisfies Record<WareQuality, number>,
    quality: { junk: [1, 5], okay: [4, 10], good: [8, 15], jackpot: [14, 20] } satisfies Record<WareQuality, readonly [number, number]>,
    rarity: {
      junk: { normal: 90, magic: 10, rare: 0 },
      okay: { normal: 50, magic: 42, rare: 8 },
      good: { normal: 10, magic: 50, rare: 40 },
      jackpot: { normal: 0, magic: 10, rare: 90 },
    } satisfies Record<WareQuality, Record<'normal' | 'magic' | 'rare', number>>,
  },
  /** Prices in Scrap. Equipment: the appraisal (sellQuote) times the markup. Maps: tier base x quality x rarity. */
  price: {
    markup: 4,
    /** Uniques cost this much more on top (their appraisal counts only the mods). */
    uniqueMarkup: 3,
    mapBase: 1, mapPerTier: 3, mapQualityShare: 20,
    mapRarity: { normal: 1, magic: 1.8, rare: 3 } satisfies Record<'normal' | 'magic' | 'rare', number>,
    scarabByTier: [8, 20, 50, 120] as readonly number[],
    /** Per unit; a currency missing here costs `currencyDefault`. */
    currency: {
      kindling: 3, mapDust: 3, scarBalm: 5, solvent: 6, seal: 6, transmute: 8, threatGlyph: 8, essenceEmber: 8, essenceRime: 8,
      essenceStorm: 8, essenceVital: 8, essenceSwift: 8, rewardInk: 10, catalyst: 12, anneal: 12, hourglassSand: 12, prefixRune: 14,
      suffixRune: 14, reforge: 14, echoShard: 16, compass: 18, voidNeedle: 20, graft: 24, twinInk: 24, fractureCore: 28,
      crownFragment: 40, grandHourglass: 60,
    } satisfies Partial<Record<CurrencyId, number>>,
    currencyDefault: 10,
  },
} as const;

/** What an item slot can hold, by luck. `weight`s are relative inside one luck tier. */
export type WareItemEntry =
  | { kind: 'equipment'; weight: number; rarity: 'normal' | 'magic' | 'rare' }
  | { kind: 'unique'; weight: number }
  | { kind: 'currency'; weight: number; pool: readonly { id: CurrencyId; count: readonly [number, number] }[] }
  | { kind: 'scarab'; weight: number; maxTier: number };

export const WARE_ITEM_TABLE: Record<WareQuality, readonly WareItemEntry[]> = {
  junk: [
    { kind: 'equipment', weight: 52, rarity: 'normal' },
    { kind: 'equipment', weight: 14, rarity: 'magic' },
    { kind: 'currency', weight: 28, pool: [{ id: 'kindling', count: [1, 2] }, { id: 'mapDust', count: [1, 2] }, { id: 'scarBalm', count: [1, 1] }, { id: 'solvent', count: [1, 1] }] },
    { kind: 'scarab', weight: 6, maxTier: 1 },
  ],
  okay: [
    { kind: 'equipment', weight: 40, rarity: 'magic' },
    { kind: 'equipment', weight: 18, rarity: 'rare' },
    { kind: 'currency', weight: 26, pool: [
      { id: 'essenceEmber', count: [1, 1] }, { id: 'essenceRime', count: [1, 1] }, { id: 'essenceStorm', count: [1, 1] }, { id: 'essenceVital', count: [1, 1] },
      { id: 'essenceSwift', count: [1, 1] }, { id: 'seal', count: [1, 2] }, { id: 'transmute', count: [1, 1] }, { id: 'threatGlyph', count: [1, 2] },
    ] },
    { kind: 'scarab', weight: 16, maxTier: 2 },
  ],
  good: [
    { kind: 'equipment', weight: 52, rarity: 'rare' },
    { kind: 'currency', weight: 22, pool: [
      { id: 'catalyst', count: [1, 2] }, { id: 'prefixRune', count: [1, 1] }, { id: 'suffixRune', count: [1, 1] }, { id: 'reforge', count: [1, 2] },
      { id: 'anneal', count: [1, 1] }, { id: 'rewardInk', count: [1, 1] }, { id: 'hourglassSand', count: [1, 1] },
    ] },
    { kind: 'scarab', weight: 16, maxTier: 3 },
    { kind: 'unique', weight: 10 },
  ],
  jackpot: [
    { kind: 'unique', weight: 40 },
    { kind: 'equipment', weight: 28, rarity: 'rare' },
    { kind: 'currency', weight: 16, pool: [
      { id: 'fractureCore', count: [1, 1] }, { id: 'graft', count: [1, 1] }, { id: 'echoShard', count: [1, 2] }, { id: 'crownFragment', count: [1, 1] },
      { id: 'voidNeedle', count: [1, 1] }, { id: 'twinInk', count: [1, 1] }, { id: 'compass', count: [1, 1] }, { id: 'grandHourglass', count: [1, 1] },
    ] },
    { kind: 'scarab', weight: 16, maxTier: 4 },
  ],
};

/** First history line of an item bought from the wares board. */
export const WARE_ORIGIN = `Bought from ${MERCHANT_NAME}'s wares`;
