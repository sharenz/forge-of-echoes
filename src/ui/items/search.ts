// Stash search state shared by the stash panel (tab counts) and every item it can light up: grid items, Map Stash rows
// and Crafting Stash slots (glow / dim). The query text lives in Local (local.search); it applies while the stash is
// the visible left panel. Matching runs once per (character, query) for all items and is memoised, so each view only
// looks its uid up.
import { CURRENCY_IDS, type CurrencyId } from '../../contracts/content';
import type { CharacterSave, Item, SpecialStashTab } from '../../contracts/items';
import type { UiStore } from '../../contracts/ui';
import { useLocal } from '../local';
import { isSearchActive, matchesSearch, parseSearchQuery, searchDoc, type SearchDoc } from '../lib/search';
import { visiblePanels } from '../lib/panels';
import { currencyTabOf, slotStack, stashCount } from '../lib/stash';
import { useSignal, useStore, useUi } from '../store';
import { safe } from './hooks';

export interface SearchResult {
  /** A non-empty query is applied (the stash is open). */
  active: boolean;
  /** Uids of matching backpack and stash items, Map Stash maps and Crafting Stash slots (`cstash:<id>`). */
  matches: ReadonlySet<string>;
  /** Matches per stash tab (same order as character.stash). */
  tabCounts: number[];
  /** Matches per special tab (maps; filled Crafting Stash slots). */
  special: Readonly<Record<SpecialStashTab, number>>;
  backpackCount: number;
}

const NO_SPECIAL: Readonly<Record<SpecialStashTab, number>> = { maps: 0, currency: 0, mapCurrency: 0 };
const INACTIVE: SearchResult = { active: false, matches: new Set(), tabCounts: [], special: NO_SPECIAL, backpackCount: 0 };

/** Items never change in place (the rules return new objects), so a description-derived doc is cached per object. */
const docs = new WeakMap<Item, SearchDoc>();
/** A Crafting Stash slot's doc depends only on its currency (the count is not searchable). */
const slotDocs = new WeakMap<UiStore, Map<CurrencyId, SearchDoc | null>>();

function docFor(store: UiStore, item: Item, ch: CharacterSave): SearchDoc | null {
  const hit = docs.get(item);
  if (hit) return hit;
  const desc = safe(() => store.rules.describeItem(item, ch), null);
  if (!desc) return null;
  const doc = searchDoc(item, desc);
  docs.set(item, doc);
  return doc;
}

function slotDoc(store: UiStore, id: CurrencyId, ch: CharacterSave): SearchDoc | null {
  let cache = slotDocs.get(store);
  if (!cache) slotDocs.set(store, (cache = new Map()));
  if (cache.has(id)) return cache.get(id) ?? null;
  const item = slotStack(id, 1);
  const desc = safe(() => store.rules.describeItem(item, ch), null);
  const doc = desc ? searchDoc(item, desc) : null;
  cache.set(id, doc);
  return doc;
}

let memo: { store: UiStore; ch: CharacterSave; query: string; result: SearchResult } | null = null;

/** Match `query` against the backpack, every stash tab and the special tabs (memoised on the last character + query). */
export function computeSearch(store: UiStore, ch: CharacterSave | null, query: string): SearchResult {
  if (!ch) return INACTIVE;
  if (memo && memo.store === store && memo.ch === ch && memo.query === query) return memo.result;
  const q = parseSearchQuery(query);
  let result = INACTIVE;
  if (isSearchActive(q)) {
    const matches = new Set<string>();
    const test = (item: Item): boolean => {
      const doc = docFor(store, item, ch);
      const ok = !!doc && matchesSearch(q, doc);
      if (ok) matches.add(item.uid);
      return ok;
    };
    let backpackCount = 0;
    for (const e of ch.backpack.entries) if (test(e.item)) backpackCount += 1;
    const tabCounts = ch.stash.map((t) => t.grid.entries.reduce((n, e) => n + (test(e.item) ? 1 : 0), 0));
    const special = { maps: 0, currency: 0, mapCurrency: 0 };
    for (const m of ch.mapStash ?? []) if (test(m)) special.maps += 1;
    // Only filled slots are items; an empty (ghosted) slot never lights up.
    for (const id of CURRENCY_IDS) {
      if (stashCount(ch, id) <= 0) continue;
      const doc = slotDoc(store, id, ch);
      if (doc && matchesSearch(q, doc)) {
        matches.add(slotStack(id, 0).uid);
        special[currencyTabOf(id)] += 1;
      }
    }
    result = { active: true, matches, tabCounts, special, backpackCount };
  }
  memo = { store, ch, query, result };
  return result;
}

/** Total matches over every tab (normal and special), without the backpack. */
export function stashMatchCount(r: SearchResult): number {
  return r.tabCounts.reduce((a, b) => a + b, 0) + r.special.maps + r.special.currency + r.special.mapCurrency;
}

/** The applied search (inactive unless the stash is the visible left panel and the query has a term). */
export function useSearch(): SearchResult {
  const store = useStore();
  const local = useLocal();
  const query = useSignal(local.search);
  const stashOpen = useUi((s) => visiblePanels(s.openPanels).left === 'stash');
  const ch = useUi((s) => s.character);
  return stashOpen ? computeSearch(store, ch, query) : INACTIVE;
}
