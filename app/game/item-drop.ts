import type { CharacterEquipmentSlot, InventoryItem, PlayerProfile } from "./domain";
import { findEquippedSlot } from "./equipment";
import { storePickedUpFlask } from "./flasks";
import { insertItem, removeItem } from "./item-container";
import { removeStashItem } from "./stash";

export interface TakenProfileItem {
  item: InventoryItem;
  profile: PlayerProfile;
  source: "backpack" | "stash" | "equipment";
}

/**
 * Applies an authoritative world pickup to a persisted profile. Flasks first
 * refill matching configured belt slots (including depleted zero stacks),
 * while all other items go directly to the backpack.
 */
export function storePickedUpItem(profile: PlayerProfile, item: InventoryItem): PlayerProfile | null {
  if (item.kind === "flask") return storePickedUpFlask(profile, item)?.profile ?? null;
  const inserted = insertItem(profile.inventory, item);
  if (inserted.unplaced.length > 0) return null;
  return { ...profile, inventory: inserted.container };
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
