import { CURRENCY_DEFINITIONS } from "./config/currencies";
import { ITEM_BASES } from "./config/item-bases";
import { MAP_BASES } from "./config/maps";
import type { InventoryItem } from "./domain";

const FALLBACK_ICON = "/item-icons/scrap.png";

export function inventoryItemIcon(item: InventoryItem): string {
  if (item.kind === "currency") return CURRENCY_DEFINITIONS[item.baseId].icon;
  if (item.kind === "map") return MAP_BASES.find((definition) => definition.id === item.baseId)?.icon ?? FALLBACK_ICON;
  return ITEM_BASES.find((definition) => definition.id === item.baseId)?.icon ?? FALLBACK_ICON;
}
