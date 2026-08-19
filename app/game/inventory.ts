import { CURRENCY_DEFINITIONS } from "./config/currencies";
import type { CurrencyAmounts, CurrencyId, CurrencyItem, EquipmentItem, FlaskItem, InventoryItem, MapItem, PlayerProfile } from "./domain";
import { containerItems, countContainerCurrency, consumeContainerCurrency } from "./item-container";
import { createId } from "./random";
import { consumeStashCurrency, stashItems } from "./stash";

export const isEquipmentItem = (item: InventoryItem): item is EquipmentItem => item.kind === "equipment";
export const isMapItem = (item: InventoryItem): item is MapItem => item.kind === "map";
export const isCurrencyItem = (item: InventoryItem): item is CurrencyItem => item.kind === "currency";
export const isFlaskItem = (item: InventoryItem): item is FlaskItem => item.kind === "flask";

export function createCurrencyStack(currencyId: CurrencyId, stackSize: number): CurrencyItem {
  const maxStackSize = CURRENCY_DEFINITIONS[currencyId].maxStackSize;
  if (!Number.isInteger(stackSize) || stackSize < 1 || stackSize > maxStackSize) {
    throw new Error(`Invalid ${currencyId} stack size ${stackSize}; expected 1-${maxStackSize}`);
  }
  return { kind: "currency", id: createId("currency"), baseId: currencyId, stackSize };
}

export function addCurrencyToInventory(items: readonly InventoryItem[], currencyId: CurrencyId, amount: number): InventoryItem[] {
  if (!Number.isInteger(amount) || amount < 0) throw new Error("Currency amount must be a non-negative integer");
  if (amount === 0) return [...items];
  const maxStackSize = CURRENCY_DEFINITIONS[currencyId].maxStackSize;
  let remaining = amount;
  const result = items.map((item) => {
    if (!isCurrencyItem(item) || item.baseId !== currencyId || item.stackSize >= maxStackSize || remaining === 0) return item;
    const added = Math.min(maxStackSize - item.stackSize, remaining);
    remaining -= added;
    return { ...item, stackSize: item.stackSize + added };
  });
  while (remaining > 0) {
    const stackSize = Math.min(maxStackSize, remaining);
    result.push(createCurrencyStack(currencyId, stackSize));
    remaining -= stackSize;
  }
  return result;
}

export function addItemsToInventory(items: readonly InventoryItem[], added: readonly InventoryItem[], prependItems = false): InventoryItem[] {
  let result = [...items];
  const regularItems: InventoryItem[] = [];
  for (const item of added) {
    if (isCurrencyItem(item)) result = addCurrencyToInventory(result, item.baseId, item.stackSize);
    else regularItems.push(item);
  }
  return prependItems ? [...regularItems, ...result] : [...result, ...regularItems];
}

export function countCurrency(items: readonly InventoryItem[], currencyId: CurrencyId): number {
  return items.reduce((sum, item) => sum + (isCurrencyItem(item) && item.baseId === currencyId ? item.stackSize : 0), 0);
}

export function currencyAmounts(items: readonly InventoryItem[]): CurrencyAmounts {
  return (Object.keys(CURRENCY_DEFINITIONS) as CurrencyId[]).reduce((amounts, currencyId) => {
    amounts[currencyId] = countCurrency(items, currencyId);
    return amounts;
  }, {} as CurrencyAmounts);
}

export function consumeCurrency(items: readonly InventoryItem[], currencyId: CurrencyId, amount: number): InventoryItem[] | null {
  if (!Number.isInteger(amount) || amount < 1) throw new Error("Consumed currency must be a positive integer");
  if (countCurrency(items, currencyId) < amount) return null;
  let remaining = amount;
  const result: InventoryItem[] = [];
  for (const item of items) {
    if (!isCurrencyItem(item) || item.baseId !== currencyId || remaining === 0) {
      result.push(item);
      continue;
    }
    const consumed = Math.min(item.stackSize, remaining);
    remaining -= consumed;
    if (item.stackSize > consumed) result.push({ ...item, stackSize: item.stackSize - consumed });
  }
  return result;
}

export function profileCurrencyAmounts(profile: PlayerProfile): CurrencyAmounts {
  return currencyAmounts([...containerItems(profile.inventory), ...stashItems(profile.stash)]);
}

export function consumeProfileCurrency(profile: PlayerProfile, currencyId: CurrencyId, amount: number): PlayerProfile | null {
  const inventoryAmount = countContainerCurrency(profile.inventory, currencyId);
  const fromInventory = Math.min(inventoryAmount, amount);
  const inventory = fromInventory > 0 ? consumeContainerCurrency(profile.inventory, currencyId, fromInventory) : profile.inventory;
  const remainder = amount - fromInventory;
  const stash = remainder > 0 ? consumeStashCurrency(profile.stash, currencyId, remainder) : profile.stash;
  if (!inventory || !stash) return null;
  return { ...profile, inventory, stash };
}
