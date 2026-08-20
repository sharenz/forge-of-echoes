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

export function profileCurrencyAmounts(profile: PlayerProfile): CurrencyAmounts {
  const items = [...containerItems(profile.inventory), ...stashItems(profile.stash)];
  return (Object.keys(CURRENCY_DEFINITIONS) as CurrencyId[]).reduce((amounts, currencyId) => {
    amounts[currencyId] = items.reduce((total, item) => (
      isCurrencyItem(item) && item.baseId === currencyId ? total + item.stackSize : total
    ), 0);
    return amounts;
  }, {} as CurrencyAmounts);
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
