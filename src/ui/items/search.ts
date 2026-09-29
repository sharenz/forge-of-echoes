// Stash search state shared by the stash panel (tab counts) and every grid item (glow / dim). The query text lives
// in Local (local.search); it applies while the stash is the visible left panel. Matching runs once per
// (character, query) for all items and is memoised, so each ItemView only looks its uid up.
import type { CharacterSave, Item } from '../../contracts/items';
import type { UiStore } from '../../contracts/ui';
import { useLocal } from '../local';
import { isSearchActive, matchesSearch, parseSearchQuery, searchDoc, type SearchDoc } from '../lib/search';
import { visiblePanels } from '../lib/panels';
import { useSignal, useStore, useUi } from '../store';
import { safe } from './hooks';

export interface SearchResult {
  /** A non-empty query is applied (the stash is open). */
  active: boolean;
  /** Uids of matching backpack and stash items. */
  matches: ReadonlySet<string>;
  /** Matches per stash tab (same order as character.stash). */
  tabCounts: number[];
  backpackCount: number;
}

const INACTIVE: SearchResult = { active: false, matches: new Set(), tabCounts: [], backpackCount: 0 };

/** Items never change in place (the rules return new objects), so a description-derived doc is cached per object. */
const docs = new WeakMap<Item, SearchDoc>();

function docFor(store: UiStore, item: Item, ch: CharacterSave): SearchDoc | null {
  const hit = docs.get(item);
  if (hit) return hit;
  const desc = safe(() => store.rules.describeItem(item, ch), null);
  if (!desc) return null;
  const doc = searchDoc(item, desc);
  docs.set(item, doc);
  return doc;
}

let memo: { store: UiStore; ch: CharacterSave; query: string; result: SearchResult } | null = null;

/** Match `query` against the backpack and every stash tab (memoised on the last character + query). */
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
    result = { active: true, matches, tabCounts, backpackCount };
  }
  memo = { store, ch, query, result };
  return result;
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
