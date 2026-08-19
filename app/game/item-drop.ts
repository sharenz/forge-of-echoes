import type { CharacterEquipmentSlot, InventoryItem, PlayerProfile } from "./domain";
import { findEquippedSlot } from "./equipment";
import { removeItem } from "./item-container";
import { removeStashItem } from "./stash";

export interface TakenProfileItem {
  item: InventoryItem;
  profile: PlayerProfile;
  source: "backpack" | "stash" | "equipment";
}

/**
 * Produces a profile with one exact item removed. The caller may safely discard
 * this result if the world cannot create a ground drop, preventing item loss.
 */
export function takeProfileItem(profile: PlayerProfile, itemId: string): TakenProfileItem | null {
  const backpack = removeItem(profile.inventory, itemId);
  if (backpack) {
    return {
      item: backpack.entry.item,
      profile: { ...profile, inventory: backpack.container },
      source: "backpack",
    };
  }

  const stash = removeStashItem(profile.stash, itemId);
  if (stash) {
    return {
      item: stash.entry.item,
      profile: { ...profile, stash: stash.stash },
      source: "stash",
    };
  }

  const slot = findEquippedSlot(profile.equipped, itemId);
  if (!slot) return null;
  const item = profile.equipped[slot];
  if (!item) return null;
  const equipped: Partial<Record<CharacterEquipmentSlot, typeof item>> = { ...profile.equipped };
  delete equipped[slot];
  return {
    item,
    profile: { ...profile, equipped },
    source: "equipment",
  };
}
