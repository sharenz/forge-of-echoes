import { STASH_RULES } from "./config/stash";
import type { CurrencyId, InventoryItem, ItemContainer, PlacedInventoryItem, StashState, StashTab } from "./domain";
import { containerItems, consumeContainerCurrency, countContainerCurrency, createItemContainer, insertItems, mapContainerItems, removeItem } from "./item-container";
import { createId } from "./random";

export interface StashInsertResult {
  stash: StashState;
  unplaced: InventoryItem[];
}

export interface StashRemoveResult {
  stash: StashState;
  tabId: string;
  entry: PlacedInventoryItem;
}

function cleanName(name: string, fallback: string): string {
  return name.trim().slice(0, STASH_RULES.maximumNameLength) || fallback;
}

export function createStash(): StashState {
  const tabs = STASH_RULES.defaultTabs.map<StashTab>((definition) => ({
    ...definition,
    container: createItemContainer("stash"),
  }));
  return { activeTabId: tabs[0].id, tabs };
}

export function activeStashTab(stash: StashState): StashTab {
  return stash.tabs.find((tab) => tab.id === stash.activeTabId) ?? stash.tabs[0];
}

export function stashItems(stash: StashState): InventoryItem[] {
  return stash.tabs.flatMap((tab) => containerItems(tab.container));
}

export function updateStashContainer(stash: StashState, tabId: string, container: ItemContainer): StashState {
  if (!stash.tabs.some((tab) => tab.id === tabId)) return stash;
  return { ...stash, tabs: stash.tabs.map((tab) => tab.id === tabId ? { ...tab, container } : tab) };
}

export function selectStashTab(stash: StashState, tabId: string): StashState {
  return stash.tabs.some((tab) => tab.id === tabId) ? { ...stash, activeTabId: tabId } : stash;
}

export function renameStashTab(stash: StashState, tabId: string, name: string): StashState {
  return {
    ...stash,
    tabs: stash.tabs.map((tab, index) => tab.id === tabId
      ? { ...tab, name: cleanName(name, `Tab ${index + 1}`) }
      : tab),
  };
}

export function addStashTab(stash: StashState): StashState {
  if (stash.tabs.length >= STASH_RULES.maximumTabs) return stash;
  const tab: StashTab = {
    id: createId("stash-tab"),
    name: `Tab ${stash.tabs.length + 1}`,
    container: createItemContainer("stash"),
  };
  return { activeTabId: tab.id, tabs: [...stash.tabs, tab] };
}

/** Inserts into the active tab first, then uses other tabs only for overflow. */
export function insertItemsIntoStash(stash: StashState, items: readonly InventoryItem[]): StashInsertResult {
  let next = stash;
  let unplaced = [...items];
  const orderedTabs = [activeStashTab(stash), ...stash.tabs.filter((tab) => tab.id !== stash.activeTabId)];
  for (const tab of orderedTabs) {
    if (unplaced.length === 0) break;
    const inserted = insertItems(tab.container, unplaced);
    next = updateStashContainer(next, tab.id, inserted.container);
    unplaced = inserted.unplaced;
  }
  return { stash: next, unplaced };
}

export function findStashEntry(stash: StashState, itemId: string): { tab: StashTab; entry: PlacedInventoryItem } | null {
  for (const tab of stash.tabs) {
    const entry = tab.container.entries.find((candidate) => candidate.item.id === itemId);
    if (entry) return { tab, entry };
  }
  return null;
}

export function removeStashItem(stash: StashState, itemId: string): StashRemoveResult | null {
  const found = findStashEntry(stash, itemId);
  if (!found) return null;
  const removed = removeItem(found.tab.container, itemId);
  if (!removed) return null;
  return { stash: updateStashContainer(stash, found.tab.id, removed.container), tabId: found.tab.id, entry: removed.entry };
}

export function mapStashItems(stash: StashState, transform: (item: InventoryItem) => InventoryItem): StashState {
  return {
    ...stash,
    tabs: stash.tabs.map((tab) => ({ ...tab, container: mapContainerItems(tab.container, transform) })),
  };
}

export function countStashCurrency(stash: StashState, currencyId: CurrencyId): number {
  return stash.tabs.reduce((sum, tab) => sum + countContainerCurrency(tab.container, currencyId), 0);
}

export function consumeStashCurrency(stash: StashState, currencyId: CurrencyId, amount: number): StashState | null {
  if (countStashCurrency(stash, currencyId) < amount) return null;
  let remaining = amount;
  let next = stash;
  for (const tab of stash.tabs) {
    if (remaining === 0) break;
    const available = countContainerCurrency(tab.container, currencyId);
    const consumed = Math.min(available, remaining);
    if (consumed === 0) continue;
    const container = consumeContainerCurrency(tab.container, currencyId, consumed);
    if (!container) return null;
    next = updateStashContainer(next, tab.id, container);
    remaining -= consumed;
  }
  return next;
}
