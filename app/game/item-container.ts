import { ITEM_CONTAINER_DEFINITIONS } from "./config/containers";
import { CURRENCY_DEFINITIONS } from "./config/currencies";
import type { CurrencyId, CurrencyItem, InventoryItem, ItemContainer, ItemContainerId, PlacedInventoryItem } from "./domain";
import { createId } from "./random";

export interface ItemFootprint {
  width: number;
  height: number;
}

export interface InsertResult {
  container: ItemContainer;
  unplaced: InventoryItem[];
}

export interface RemoveResult {
  container: ItemContainer;
  entry: PlacedInventoryItem;
}

const EQUIPMENT_FOOTPRINTS = {
  weapon: { width: 2, height: 4 },
  chest: { width: 2, height: 3 },
  boots: { width: 2, height: 2 },
  ring: { width: 1, height: 1 },
} as const;

const isCurrencyItem = (item: InventoryItem): item is CurrencyItem => item.kind === "currency";

export function itemFootprint(item: InventoryItem): ItemFootprint {
  return item.kind === "equipment" ? EQUIPMENT_FOOTPRINTS[item.slot] : { width: 1, height: 1 };
}

export function containerItems(container: ItemContainer): InventoryItem[] {
  return container.entries.map((entry) => entry.item);
}

export function findContainerEntry(container: ItemContainer, itemId: string): PlacedInventoryItem | undefined {
  return container.entries.find((entry) => entry.item.id === itemId);
}

export function canPlaceItem(container: ItemContainer, item: InventoryItem, x: number, y: number, ignoredItemId?: string): boolean {
  const definition = ITEM_CONTAINER_DEFINITIONS[container.id];
  const size = itemFootprint(item);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x + size.width > definition.columns || y + size.height > definition.rows) return false;
  return container.entries.every((entry) => {
    if (entry.item.id === ignoredItemId) return true;
    const other = itemFootprint(entry.item);
    return x + size.width <= entry.x || entry.x + other.width <= x || y + size.height <= entry.y || entry.y + other.height <= y;
  });
}

export function findFirstFit(container: ItemContainer, item: InventoryItem, ignoredItemId?: string): { x: number; y: number } | null {
  const definition = ITEM_CONTAINER_DEFINITIONS[container.id];
  const size = itemFootprint(item);
  for (let y = 0; y <= definition.rows - size.height; y += 1) {
    for (let x = 0; x <= definition.columns - size.width; x += 1) {
      if (canPlaceItem(container, item, x, y, ignoredItemId)) return { x, y };
    }
  }
  return null;
}

export function createItemContainer(id: ItemContainerId, items: readonly InventoryItem[] = []): ItemContainer {
  return insertItems({ id, entries: [] }, items).container;
}

export function normalizeItemContainer(id: ItemContainerId, entries: readonly PlacedInventoryItem[]): ItemContainer {
  let container: ItemContainer = { id, entries: [] };
  for (const entry of entries) {
    if (canPlaceItem(container, entry.item, entry.x, entry.y)) {
      container = { ...container, entries: [...container.entries, { ...entry }] };
      continue;
    }
    const inserted = insertItem(container, entry.item);
    container = inserted.container;
  }
  return container;
}

function createCurrencyItem(baseId: CurrencyId, stackSize: number, preferredId?: string): CurrencyItem {
  return { kind: "currency", id: preferredId ?? createId("currency"), baseId, stackSize };
}

export function insertItem(container: ItemContainer, item: InventoryItem, preferred?: { x: number; y: number }): InsertResult {
  if (!isCurrencyItem(item)) {
    const position = preferred && canPlaceItem(container, item, preferred.x, preferred.y) ? preferred : preferred ? null : findFirstFit(container, item);
    if (!position) return { container, unplaced: [item] };
    return { container: { ...container, entries: [...container.entries, { item, ...position }] }, unplaced: [] };
  }

  const maxStackSize = CURRENCY_DEFINITIONS[item.baseId].maxStackSize;
  let remaining = item.stackSize;
  let next = container;
  // Stacking changes quantities only; it never changes another item's position.
  next = {
    ...next,
    entries: next.entries.map((entry) => {
      if (!isCurrencyItem(entry.item) || entry.item.baseId !== item.baseId || entry.item.stackSize >= maxStackSize || remaining === 0) return entry;
      const added = Math.min(maxStackSize - entry.item.stackSize, remaining);
      remaining -= added;
      return { ...entry, item: { ...entry.item, stackSize: entry.item.stackSize + added } };
    }),
  };
  let isFirstStack = true;
  while (remaining > 0) {
    const stackSize = Math.min(maxStackSize, remaining);
    const stack = createCurrencyItem(item.baseId, stackSize, isFirstStack ? item.id : undefined);
    const exact = isFirstStack ? preferred : undefined;
    const position = exact && canPlaceItem(next, stack, exact.x, exact.y) ? exact : exact ? null : findFirstFit(next, stack);
    if (!position) return { container: next, unplaced: [createCurrencyItem(item.baseId, remaining, isFirstStack ? item.id : undefined)] };
    next = { ...next, entries: [...next.entries, { item: stack, ...position }] };
    remaining -= stackSize;
    isFirstStack = false;
  }
  return { container: next, unplaced: [] };
}

export function insertItems(container: ItemContainer, items: readonly InventoryItem[]): InsertResult {
  let next = container;
  const unplaced: InventoryItem[] = [];
  for (const item of items) {
    const result = insertItem(next, item);
    next = result.container;
    unplaced.push(...result.unplaced);
  }
  return { container: next, unplaced };
}

export function removeItem(container: ItemContainer, itemId: string): RemoveResult | null {
  const entry = findContainerEntry(container, itemId);
  if (!entry) return null;
  return { entry, container: { ...container, entries: container.entries.filter((candidate) => candidate.item.id !== itemId) } };
}

export function moveItem(container: ItemContainer, itemId: string, x: number, y: number): ItemContainer | null {
  const entry = findContainerEntry(container, itemId);
  if (!entry || !canPlaceItem(container, entry.item, x, y, itemId)) return null;
  return { ...container, entries: container.entries.map((candidate) => candidate.item.id === itemId ? { ...candidate, x, y } : candidate) };
}

export function transferItem(source: ItemContainer, target: ItemContainer, itemId: string, x: number, y: number): { source: ItemContainer; target: ItemContainer } | null {
  const removed = removeItem(source, itemId);
  if (!removed || !canPlaceItem(target, removed.entry.item, x, y)) return null;
  return {
    source: removed.container,
    target: { ...target, entries: [...target.entries, { item: removed.entry.item, x, y }] },
  };
}

export function mapContainerItems(container: ItemContainer, transform: (item: InventoryItem) => InventoryItem): ItemContainer {
  return { ...container, entries: container.entries.map((entry) => ({ ...entry, item: transform(entry.item) })) };
}

export function countContainerCurrency(container: ItemContainer, currencyId: CurrencyId): number {
  return container.entries.reduce((sum, entry) => sum + (isCurrencyItem(entry.item) && entry.item.baseId === currencyId ? entry.item.stackSize : 0), 0);
}

export function consumeContainerCurrency(container: ItemContainer, currencyId: CurrencyId, amount: number): ItemContainer | null {
  if (!Number.isInteger(amount) || amount < 1) throw new Error("Consumed currency must be a positive integer");
  if (countContainerCurrency(container, currencyId) < amount) return null;
  let remaining = amount;
  const entries: PlacedInventoryItem[] = [];
  for (const entry of container.entries) {
    if (!isCurrencyItem(entry.item) || entry.item.baseId !== currencyId || remaining === 0) {
      entries.push(entry);
      continue;
    }
    const consumed = Math.min(entry.item.stackSize, remaining);
    remaining -= consumed;
    if (entry.item.stackSize > consumed) entries.push({ ...entry, item: { ...entry.item, stackSize: entry.item.stackSize - consumed } });
  }
  return { ...container, entries };
}
