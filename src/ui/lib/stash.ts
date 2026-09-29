// Special stash tabs (GAME_SPEC §12): the Map Stash and the two Crafting Stash tabs. Display tables and pure view
// models over CharacterSave.mapStash / currencyStash; covered by tests/ui/stash.test.ts.
//
//   • A Crafting Stash slot is addressed by the synthetic uid `cstash:<currencyId>` (currencyStashUid), like belt:<i>.
//     The rules resolve it (findItem, moveItem with a count, quickMove, craftingTargetError, applyCurrency).
//   • The Map Stash files maps by tier (T1–T15) and, inside a tier, by map base.
import {
  EQUIPMENT_CURRENCY_IDS,
  MAP_BASE_IDS,
  MAP_CURRENCY_IDS,
  iconIdForCurrency,
  iconIdForMap,
  type CurrencyId,
  type MapBaseId,
} from '../../contracts/content';
import {
  CURRENCY_STASH_MAX,
  currencyStashUid,
  type CharacterSave,
  type CurrencyStack,
  type MapItem,
  type SpecialStashTab,
} from '../../contracts/items';

export const SPECIAL_TABS: readonly SpecialStashTab[] = ['maps', 'currency', 'mapCurrency'];

export interface SpecialTabInfo {
  /** Panel-facing name ("Crafting Stash"). */
  title: string;
  /** Second line ("Equipment currency"). */
  subtitle: string;
  iconId: string;
}

export const SPECIAL_TAB_INFO: Readonly<Record<SpecialStashTab, SpecialTabInfo>> = {
  maps: { title: 'Map Stash', subtitle: 'Maps by tier', iconId: iconIdForMap('rimedOssuary') },
  currency: { title: 'Crafting Stash', subtitle: 'Equipment currency', iconId: iconIdForCurrency('reforge') },
  mapCurrency: { title: 'Crafting Stash', subtitle: 'Map currency', iconId: iconIdForCurrency('mapDust') },
};

export function isSpecialTab(tab: number | SpecialStashTab): tab is SpecialStashTab {
  return typeof tab === 'string';
}

/** The normal tab to show for `tab` (clamped), or null while a special tab is active. */
export function normalTabIndex(tab: number | SpecialStashTab, tabCount: number): number | null {
  if (isSpecialTab(tab)) return null;
  return Math.min(Math.max(0, Math.floor(tab)), Math.max(0, tabCount - 1));
}

// ---------------------------------------------------------------------------------------------------------------
// Crafting Stash
// ---------------------------------------------------------------------------------------------------------------

/** One labelled row of Crafting Stash slots. */
export interface CurrencyShelf {
  title: string;
  ids: readonly CurrencyId[];
}

/** The fixed layout of the two Crafting Stash tabs (every currency has exactly one slot). */
export const CURRENCY_SHELVES: Readonly<Record<'currency' | 'mapCurrency', readonly CurrencyShelf[]>> = {
  currency: [
    { title: 'Shaping', ids: ['kindling', 'scrap', 'reforge', 'prefixRune', 'suffixRune'] },
    { title: 'Essences', ids: ['essenceEmber', 'essenceRime', 'essenceStorm', 'essenceVital', 'essenceSwift'] },
    { title: 'Refining & binding', ids: ['catalyst', 'solvent', 'seal', 'fractureCore'] },
    { title: 'Recovery & transformation', ids: ['scarBalm', 'anneal', 'graft', 'transmute'] },
    { title: 'Encounter ingredients', ids: ['echoShard', 'crownFragment'] },
  ],
  mapCurrency: [
    { title: 'Map crafting', ids: ['mapDust', 'threatGlyph', 'rewardInk', 'voidNeedle'] },
    { title: 'Advanced map crafting', ids: ['compass', 'twinInk', 'voidSplinter'] },
    { title: 'Atlas keys', ids: ['reliquaryKey'] },
  ],
};

/** Slot labels (the full name is in the slot's tooltip). */
export const CURRENCY_SHORT: Readonly<Record<CurrencyId, string>> = {
  kindling: 'Kindling',
  scrap: 'Scrap',
  reforge: 'Reforge',
  prefixRune: 'Prefix',
  suffixRune: 'Suffix',
  scarBalm: 'Scar Balm',
  anneal: 'Anneal',
  graft: 'Graft',
  transmute: 'Transmute',
  echoShard: 'Echo Shard',
  crownFragment: 'Crown Shard',
  compass: 'Compass',
  twinInk: 'Twin Ink',
  voidSplinter: 'Void Splinter',
  essenceEmber: 'Ember',
  essenceRime: 'Rime',
  essenceStorm: 'Storm',
  essenceVital: 'Vital',
  essenceSwift: 'Swift',
  catalyst: 'Catalyst',
  solvent: 'Solvent',
  seal: 'Seal',
  fractureCore: 'Fracture',
  mapDust: 'Map Dust',
  threatGlyph: 'Threat Glyph',
  rewardInk: 'Reward Ink',
  voidNeedle: 'Void Needle',
  reliquaryKey: 'Reliquary Key',
};

/** The Crafting Stash tab that shows a currency. */
export function currencyTabOf(id: CurrencyId): 'currency' | 'mapCurrency' {
  return (MAP_CURRENCY_IDS as readonly string[]).includes(id) ? 'mapCurrency' : 'currency';
}

/** Currencies a Crafting Stash tab holds, in layout order. */
export function currenciesOf(tab: 'currency' | 'mapCurrency'): readonly CurrencyId[] {
  return tab === 'currency' ? EQUIPMENT_CURRENCY_IDS : MAP_CURRENCY_IDS;
}

/** How many of a currency the Crafting Stash holds (old saves have no stash yet). */
export function stashCount(ch: CharacterSave, id: CurrencyId): number {
  const n = ch.currencyStash?.[id] ?? 0;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** Everything a Crafting Stash tab holds. */
export function stashTotal(ch: CharacterSave, tab: 'currency' | 'mapCurrency'): number {
  let n = 0;
  for (const id of currenciesOf(tab)) n += stashCount(ch, id);
  return n;
}

export function isFullSlot(count: number): boolean {
  return count >= CURRENCY_STASH_MAX;
}

/** The currency a `cstash:<id>` uid addresses, or null for any other uid. */
export function parseCurrencyStashUid(uid: string): CurrencyId | null {
  if (!uid.startsWith('cstash:')) return null;
  const id = uid.slice('cstash:'.length);
  return ([...EQUIPMENT_CURRENCY_IDS, ...MAP_CURRENCY_IDS] as readonly string[]).includes(id) ? (id as CurrencyId) : null;
}

/** The slot as a currency stack (drag source, tooltip and search document of a Crafting Stash slot). */
export function slotStack(id: CurrencyId, count: number): CurrencyStack {
  return { kind: 'currency', uid: currencyStashUid(id), currencyId: id, count };
}

/** Ctrl-click takes a stack; Shift+Ctrl-click exactly one (GAME_SPEC §12). */
export function withdrawCount(shiftKey: boolean): number | undefined {
  return shiftKey ? 1 : undefined;
}

/**
 * Currency you can spend, by where it lies (the merchant pays from all three; the crafting bench from the backpack
 * and the Crafting Stash; see src/game).
 */
export function currencyHoldings(ch: CharacterSave, id: CurrencyId): { backpack: number; stash: number; crafting: number } {
  let backpack = 0;
  let stash = 0;
  for (const e of ch.backpack.entries) if (e.item.kind === 'currency' && e.item.currencyId === id) backpack += e.item.count;
  for (const t of ch.stash) for (const e of t.grid.entries) if (e.item.kind === 'currency' && e.item.currencyId === id) stash += e.item.count;
  return { backpack, stash, crafting: stashCount(ch, id) };
}

export interface DepositPlan {
  /** Backpack stacks "Deposit all" moves at least part of (slots fill up to CURRENCY_STASH_MAX, the rest stays). */
  stacks: number;
  /** Currencies left in the backpack because their slot is full, in backpack order. */
  full: CurrencyId[];
}

/** What "Deposit all" would do: the stacks it can move, and the currencies whose slots have no room left. */
export function depositPlan(ch: CharacterSave, locked: ReadonlySet<string> = new Set()): DepositPlan {
  const room = new Map<CurrencyId, number>();
  const full: CurrencyId[] = [];
  let stacks = 0;
  for (const e of ch.backpack.entries) {
    const it = e.item;
    if (it.kind !== 'currency' || locked.has(it.uid) || !(it.count > 0)) continue;
    const id = it.currencyId;
    const left = room.get(id) ?? Math.max(0, CURRENCY_STASH_MAX - stashCount(ch, id));
    if (left > 0) {
      stacks += 1;
      room.set(id, Math.max(0, left - it.count));
    } else {
      room.set(id, 0);
      if (!full.includes(id)) full.push(id);
    }
  }
  return { stacks, full };
}

// ---------------------------------------------------------------------------------------------------------------
// Map Stash
// ---------------------------------------------------------------------------------------------------------------

export const MAP_TIERS = 15;

export interface MapBaseSection {
  baseId: MapBaseId;
  maps: MapItem[];
}

export interface MapTierGroup {
  tier: number;
  count: number;
  /** Non-empty base sections, in MAP_BASE_IDS order. */
  sections: MapBaseSection[];
}

const RARITY_ORDER: Readonly<Record<MapItem['rarity'], number>> = { rare: 0, magic: 1, normal: 2 };

/** Order inside a base section: rare → magic → normal, then more mods, then quality; uncorrupted first on ties. */
export function compareMaps(a: MapItem, b: MapItem): number {
  return (
    RARITY_ORDER[a.rarity] - RARITY_ORDER[b.rarity] ||
    b.mods.length - a.mods.length ||
    b.quality - a.quality ||
    Number(a.corrupted) - Number(b.corrupted) ||
    (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0)
  );
}

/** Clamp a map's tier into T1–T15. */
export function mapTier(m: MapItem): number {
  return Math.min(MAP_TIERS, Math.max(1, Math.round(m.tier)));
}

/** The Map Stash grouped by tier (always MAP_TIERS entries, T1 first) and by base inside each tier. */
export function groupMapStash(maps: readonly MapItem[]): MapTierGroup[] {
  const byTier: Map<MapBaseId, MapItem[]>[] = Array.from({ length: MAP_TIERS }, () => new Map());
  for (const m of maps) {
    const bucket = byTier[mapTier(m) - 1];
    const list = bucket.get(m.baseId);
    if (list) list.push(m);
    else bucket.set(m.baseId, [m]);
  }
  return byTier.map((bucket, i) => {
    const known = MAP_BASE_IDS.filter((b) => bucket.has(b));
    const extra = [...bucket.keys()].filter((b) => !(MAP_BASE_IDS as readonly string[]).includes(b));
    const sections = [...known, ...extra].map((baseId) => ({ baseId, maps: [...bucket.get(baseId)!].sort(compareMaps) }));
    return { tier: i + 1, count: sections.reduce((n, s) => n + s.maps.length, 0), sections };
  });
}

/**
 * The tier to expand (null when the stash is empty): the chosen one while it holds maps. A chosen tier that ran
 * empty (its last map went into the device) gives way to the nearest tier that still holds maps, the higher one on
 * a tie; with nothing chosen, the highest tier that holds maps.
 */
export function pickMapTier(groups: readonly MapTierGroup[], chosen: number | null): number | null {
  const has = (t: number): boolean => t >= 1 && t <= groups.length && groups[t - 1].count > 0;
  if (chosen !== null && Number.isInteger(chosen) && chosen >= 1 && chosen <= groups.length) {
    if (has(chosen)) return chosen;
    for (let d = 1; d < groups.length; d++) {
      if (has(chosen + d)) return chosen + d;
      if (has(chosen - d)) return chosen - d;
    }
    return null;
  }
  for (let i = groups.length - 1; i >= 0; i--) if (groups[i].count > 0) return groups[i].tier;
  return null;
}

/** Tier bands for colour: white T1–5, yellow T6–10, red T11–15 (the familiar map-tier reading). */
export function tierBand(tier: number): 'low' | 'mid' | 'high' {
  return tier <= 5 ? 'low' : tier <= 10 ? 'mid' : 'high';
}

/** "4 mods", "1 mod", "no mods". */
export function modCountText(n: number): string {
  return n === 0 ? 'no mods' : n === 1 ? '1 mod' : `${n} mods`;
}
