// The special stash tabs (GAME_SPEC §12, end): the Crafting Stash and the Map Stash. Every character has
// both, next to the normal tabs; they do not count towards MAX_STASH_TABS.
//
//   Crafting Stash  CharacterSave.currencyStash: one fixed slot per currency (count, at most
//                   CURRENCY_STASH_MAX). Empty slots have no key. The UI shows it as two tabs, equipment
//                   currencies ('currency') and map currencies ('mapCurrency'), in the order of
//                   EQUIPMENT_CURRENCY_IDS / MAP_CURRENCY_IDS. A slot is addressed by the synthetic uid
//                   "cstash:<currencyId>" (currencyStashUid); findItem returns a CurrencyStack view of it
//                   at location { kind: 'currencyStash' }, so describeItem, crafting (applyCurrency with the
//                   slot uid as the currency) and the moves all work on it.
//   Work slot       CharacterSave.craftSlot: the one piece of gear or map being crafted on (location
//                   { kind: 'craftSlot' }); the item keeps its own uid, so every crafting rule reaches it through
//                   findItem / replaceItemAt like any other container.
//   Map Stash       CharacterSave.mapStash: up to MAP_STASH_CAPACITY maps in deposit order, each keeping
//                   its own uid; location { kind: 'mapStash' }. The UI groups them by tier and base.
//
// This file only reads and writes the two containers; the moves (deposit, withdraw, split, deposit all)
// are in ./inventory. Pure; tolerant of characters built without the fields (treated as empty).
import type { CurrencyId } from '../../contracts/content';
import { EQUIPMENT_CURRENCY_IDS, MAP_CURRENCY_IDS } from '../../contracts/content';
import type { CharacterSave, CraftSlotItem, CurrencyStack, MapItem, SpecialStashTab } from '../../contracts/items';
import { CURRENCY_STASH_MAX, currencyStashUid } from '../../contracts/items';
import { isMapCurrency } from '../../data/items';

/** Slot order of the Crafting Stash tab for equipment currencies (GAME_SPEC §12). */
export const CRAFTING_STASH_EQUIPMENT_SLOTS: readonly CurrencyId[] = EQUIPMENT_CURRENCY_IDS;
/** Slot order of the Crafting Stash tab for map currencies. */
export const CRAFTING_STASH_MAP_SLOTS: readonly CurrencyId[] = MAP_CURRENCY_IDS;

const SPECIAL_TABS: ReadonlySet<string> = new Set<SpecialStashTab>(['maps', 'currency', 'mapCurrency']);

/** The special tab a value names, or null (values arrive from the network). */
export function specialStashTab(value: unknown): SpecialStashTab | null {
  return typeof value === 'string' && SPECIAL_TABS.has(value) ? (value as SpecialStashTab) : null;
}

/** Which Crafting Stash tab shows a currency's slot. */
export function currencyStashTab(id: CurrencyId): 'currency' | 'mapCurrency' {
  return isMapCurrency(id) ? 'mapCurrency' : 'currency';
}

/** A slot count as stored (a whole number in 0..CURRENCY_STASH_MAX; anything else reads as 0). */
function slotCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(CURRENCY_STASH_MAX, Math.floor(value)));
}

/** How many of a currency the Crafting Stash holds. */
export function currencyStashCount(ch: CharacterSave, id: CurrencyId): number {
  const stash = ch.currencyStash;
  if (!stash || typeof stash !== 'object' || !Object.prototype.hasOwnProperty.call(stash, id)) return 0;
  return slotCount(stash[id]);
}

/** How many more of a currency its slot can take. */
export function currencyStashRoom(ch: CharacterSave, id: CurrencyId): number {
  return CURRENCY_STASH_MAX - currencyStashCount(ch, id);
}

/**
 * The CurrencyStack view of a Crafting Stash slot (uid "cstash:<id>"), for tooltips and crafting. The
 * count may be 0 (an empty slot: describeItem still explains it); findItem only finds non-empty slots.
 */
export function currencyStashItem(ch: CharacterSave, id: CurrencyId): CurrencyStack {
  return { kind: 'currency', uid: currencyStashUid(id), currencyId: id, count: currencyStashCount(ch, id) };
}

/** The character with a slot set to `count` (clamped to 0..CURRENCY_STASH_MAX; 0 removes the key). */
export function withCurrencyStashCount(ch: CharacterSave, id: CurrencyId, count: number): CharacterSave {
  const next: Partial<Record<CurrencyId, number>> = { ...(ch.currencyStash && typeof ch.currencyStash === 'object' ? ch.currencyStash : {}) };
  const n = slotCount(count);
  if (n > 0) next[id] = n;
  else delete next[id];
  return { ...ch, currencyStash: next };
}

/** The Map Stash (empty for a character built without one). */
export function mapStashOf(ch: CharacterSave): readonly MapItem[] {
  return Array.isArray(ch.mapStash) ? ch.mapStash : [];
}

/** Index of the map with `uid` in the Map Stash, or -1. */
export function mapStashIndex(ch: CharacterSave, uid: string): number {
  return mapStashOf(ch).findIndex((m) => m.uid === uid);
}

export function withMapStash(ch: CharacterSave, maps: MapItem[]): CharacterSave {
  return { ...ch, mapStash: maps };
}

/** The item in the Crafting Stash work slot (null when empty or for a character built without the field). */
export function craftSlotOf(ch: CharacterSave): CraftSlotItem | null {
  const item = ch.craftSlot;
  return item && typeof item === 'object' && (item.kind === 'equipment' || item.kind === 'map') ? item : null;
}

export function withCraftSlot(ch: CharacterSave, item: CraftSlotItem | null): CharacterSave {
  return { ...ch, craftSlot: item };
}
