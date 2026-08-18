import type { CSSProperties } from "react";
import type { InventoryItem } from "../game/domain";
import { inventoryItemIcon } from "../game/item-visuals";

interface ItemIconProps {
  item: InventoryItem;
  className?: string;
}

export function ItemIcon({ item, className = "" }: ItemIconProps) {
  return (
    <span
      aria-hidden="true"
      className={`item-icon ${className}`.trim()}
      style={{ "--item-icon": `url("${inventoryItemIcon(item)}")` } as CSSProperties}
    />
  );
}
