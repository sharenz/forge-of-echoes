import { CURRENCY_DEFINITIONS } from "./config/currencies";
import type { CurrencyId, InventoryItem, ItemContainer } from "./domain";
import { findContainerEntry, mapContainerItems } from "./item-container";
import { addFireAffix, canCreateAffixForItem, removeRandomAffix, rerollAffixValues, restoreStability } from "./items";
import { addMapModifier, canAddMapModifier, rerollMap } from "./maps";

export function canApplyCraftingCurrency(currencyId: CurrencyId, target: InventoryItem): boolean {
  return craftingTargetError(currencyId, target) === null;
}

export function craftingTargetError(currencyId: CurrencyId, target: InventoryItem): string | null {
  const definition = CURRENCY_DEFINITIONS[currencyId];
  if (definition.craftingTarget !== target.kind) return `${definition.name} only modifies ${definition.craftingTarget} items.`;

  if (target.kind === "equipment") {
    if (target.rarity === "unique") return "Unique items cannot be modified by this currency.";
    if (currencyId === "scrap") {
      if (target.affixes.length === 0) return "This item has no explicit affix values to reroll.";
      if (target.stability <= 0) return "This item has no Stability remaining.";
      return null;
    }
    if (currencyId === "essence") {
      if (target.stability < 2) return "Ember Essence requires at least 2 Stability.";
      if (target.affixes.length >= 4) return "This item already has the maximum number of affixes.";
      if (!canCreateAffixForItem(target, "fire")) return "No eligible Fire affix remains for this item.";
      return null;
    }
    if (currencyId === "seal") return target.stability < target.maxStability ? null : "This item already has maximum Stability.";
    if (currencyId === "solvent") return target.affixes.length > 0 ? null : "This item has no explicit affix to remove.";
    return `${definition.name} cannot modify this equipment item.`;
  }

  if (target.kind === "map") {
    if (target.corrupted) return "Corrupted maps cannot be modified.";
    if (currencyId === "mapDust") return null;
    if (currencyId === "threatGlyph") return canAddMapModifier(target, "threat") ? null : "No eligible threat modifier remains for this map.";
    if (currencyId === "rewardInk") return canAddMapModifier(target, "reward") ? null : "No eligible reward modifier remains for this map.";
  }
  return `${definition.name} cannot modify this item.`;
}

function craftTarget(currencyId: CurrencyId, target: InventoryItem): InventoryItem {
  if (target.kind === "equipment") {
    if (currencyId === "scrap") return rerollAffixValues(target);
    if (currencyId === "essence") return addFireAffix(target);
    if (currencyId === "seal") return restoreStability(target);
    if (currencyId === "solvent") return removeRandomAffix(target);
  }
  if (target.kind === "map") {
    if (currencyId === "mapDust") return rerollMap(target);
    if (currencyId === "threatGlyph") return addMapModifier(target, "threat");
    if (currencyId === "rewardInk") return addMapModifier(target, "reward");
  }
  return target;
}

/**
 * Applies one concrete backpack currency stack to one concrete backpack item.
 * Returning null means the source/target pair was invalid or had no effect.
 */
export function applyBackpackCurrency(container: ItemContainer, currencyItemId: string, targetItemId: string): ItemContainer | null {
  if (currencyItemId === targetItemId) return null;
  const currency = findContainerEntry(container, currencyItemId)?.item;
  const target = findContainerEntry(container, targetItemId)?.item;
  if (!currency || currency.kind !== "currency" || !target || !canApplyCraftingCurrency(currency.baseId, target)) return null;

  const crafted = craftTarget(currency.baseId, target);
  if (crafted === target) return null;

  const withCraftedTarget = mapContainerItems(container, (item) => item.id === targetItemId ? crafted : item);
  return {
    ...withCraftedTarget,
    entries: withCraftedTarget.entries.flatMap((entry) => {
      if (entry.item.id !== currencyItemId || entry.item.kind !== "currency") return [entry];
      return entry.item.stackSize === 1
        ? []
        : [{ ...entry, item: { ...entry.item, stackSize: entry.item.stackSize - 1 } }];
    }),
  };
}
