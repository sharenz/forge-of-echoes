import type { ItemContainerId } from "../domain";

export interface ItemContainerDefinition {
  id: ItemContainerId;
  name: string;
  columns: number;
  rows: number;
}

export const ITEM_CONTAINER_DEFINITIONS: Record<ItemContainerId, ItemContainerDefinition> = {
  backpack: { id: "backpack", name: "Backpack", columns: 12, rows: 5 },
  stash: { id: "stash", name: "Stash", columns: 12, rows: 8 },
};
