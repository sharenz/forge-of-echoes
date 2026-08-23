import { randomUUID } from "node:crypto";
import type { CharacterEquipmentSlot, EquipmentItem, PlayerProfile } from "../../app/game/domain";
import { chooseEquipmentSlot, equipmentSlotAccepts, findEquippedSlot } from "../../app/game/equipment";
import { applyBackpackCurrency } from "../../app/game/crafting";
import { merchantIsAvailable, type MerchantId } from "../../app/game/config/merchants";
import { loadFlaskIntoBelt, unloadFlaskFromBelt } from "../../app/game/flasks";
import { findContainerEntry, insertItem, mapContainerItems, moveItem, removeItem, transferItem } from "../../app/game/item-container";
import { purchaseMerchantOffer } from "../../app/game/merchant";
import { allocateAttributePoint, allocateSkillPoint } from "../../app/game/progression";
import { setSkillLoadoutSlot } from "../../app/game/skill-loadout";
import { activeStashTab, addStashTab, findStashEntry, renameStashTab, selectStashTab, updateStashContainer } from "../../app/game/stash";
import type { ProfileCommand } from "../../multiplayer/protocol";
import { CharacterNotFoundError, ProfileRevisionConflict } from "../persistence/errors";
import type { AuthoritativeProfile, PlayerRepository } from "../persistence/PlayerRepository";

export class ProfileCommandError extends Error {
  constructor(public readonly code: "not_found" | "invalid_command" | "revision_conflict", message: string) {
    super(message);
  }
}

export class ProfileCommandService {
  constructor(private readonly players: PlayerRepository) {}

  async execute(characterId: string, expectedRevision: number, command: ProfileCommand): Promise<AuthoritativeProfile> {
    const merchantEntitlements = command.type === "buy_merchant_offer"
      ? await this.players.listMerchantEntitlementsForCharacter(characterId)
      : [];
    try {
      return await this.players.mutateProfile(characterId, expectedRevision, (current) => {
        const next = this.apply(current, command, merchantEntitlements);
        if (next === current) throw new ProfileCommandError("invalid_command", "Command is not valid for the current profile state");
        return next;
      });
    } catch (error) {
      if (error instanceof CharacterNotFoundError) {
        throw new ProfileCommandError("not_found", "Character profile was not found");
      }
      if (error instanceof ProfileRevisionConflict) {
        throw new ProfileCommandError("revision_conflict", "Profile changed on another client");
      }
      throw error;
    }
  }

  private apply(profile: PlayerProfile, command: ProfileCommand, merchantEntitlements: readonly MerchantId[]): PlayerProfile {
    switch (command.type) {
      case "move_item": return this.move(profile, command);
      case "equip_item": return this.equip(profile, command.itemId, command.slot);
      case "allocate_attribute": return allocateAttributePoint(profile, command.attribute);
      case "allocate_skill": return allocateSkillPoint(profile, command.skill);
      case "set_skill_slot": return setSkillLoadoutSlot(profile, command.slot, command.skill);
      case "load_flask": return loadFlaskIntoBelt(profile, command.itemId, command.slot) ?? profile;
      case "unload_flask": return unloadFlaskFromBelt(profile, command.slot) ?? profile;
      case "select_stash_tab": return this.withStash(profile, selectStashTab(profile.stash, command.tabId));
      case "rename_stash_tab": return this.withStash(profile, renameStashTab(profile.stash, command.tabId, command.name));
      case "create_stash_tab": return this.withStash(profile, addStashTab(profile.stash));
      case "slot_map": return this.slotMap(profile, command.itemId);
      case "remove_map": return this.removeMap(profile);
      case "apply_currency": return this.applyCurrency(profile, command.currencyItemId, command.targetItemId);
      case "buy_merchant_offer": return this.buyMerchantOffer(profile, command.merchantId, command.offerId, merchantEntitlements, command.position);
    }
  }

  private withStash(profile: PlayerProfile, stash: PlayerProfile["stash"]): PlayerProfile {
    return stash === profile.stash ? profile : { ...profile, stash };
  }

  private slotMap(profile: PlayerProfile, itemId: string): PlayerProfile {
    const removed = removeItem(profile.inventory, itemId);
    if (!removed || removed.entry.item.kind !== "map") return profile;
    let inventory = removed.container;
    if (profile.mapDevice) {
      const returned = insertItem(inventory, profile.mapDevice, { x: removed.entry.x, y: removed.entry.y });
      if (returned.unplaced.length) return profile;
      inventory = returned.container;
    }
    return { ...profile, inventory, mapDevice: removed.entry.item };
  }

  private removeMap(profile: PlayerProfile): PlayerProfile {
    if (!profile.mapDevice) return profile;
    const inserted = insertItem(profile.inventory, profile.mapDevice);
    return inserted.unplaced.length ? profile : { ...profile, inventory: inserted.container, mapDevice: null };
  }

  private move(profile: PlayerProfile, command: Extract<ProfileCommand, { type: "move_item" }>): PlayerProfile {
    const destinationTab = command.stashTabId
      ? profile.stash.tabs.find((tab) => tab.id === command.stashTabId)
      : activeStashTab(profile.stash);
    if (command.destination === "stash" && !destinationTab) return profile;
    const inventoryEntry = findContainerEntry(profile.inventory, command.itemId);
    const stashEntry = findStashEntry(profile.stash, command.itemId);
    const equippedItem = Object.values(profile.equipped).find((item) => item?.id === command.itemId);
    if (equippedItem) {
      const slot = findEquippedSlot(profile.equipped, equippedItem.id);
      if (!slot) return profile;
      const target = command.destination === "backpack" ? profile.inventory : destinationTab!.container;
      const inserted = insertItem(target, equippedItem, { x: command.x, y: command.y });
      if (inserted.unplaced.length) return profile;
      return command.destination === "backpack"
        ? { ...profile, inventory: inserted.container, equipped: { ...profile.equipped, [slot]: undefined } }
        : { ...profile, stash: updateStashContainer(profile.stash, destinationTab!.id, inserted.container), equipped: { ...profile.equipped, [slot]: undefined } };
    }
    if (inventoryEntry && command.destination === "backpack") {
      const moved = moveItem(profile.inventory, command.itemId, command.x, command.y);
      return moved ? { ...profile, inventory: moved } : profile;
    }
    if (stashEntry && command.destination === "stash" && stashEntry.tab.id === destinationTab!.id) {
      const moved = moveItem(stashEntry.tab.container, command.itemId, command.x, command.y);
      return moved ? { ...profile, stash: updateStashContainer(profile.stash, stashEntry.tab.id, moved) } : profile;
    }
    if (inventoryEntry && command.destination === "stash") {
      const moved = transferItem(profile.inventory, destinationTab!.container, command.itemId, command.x, command.y);
      return moved ? { ...profile, inventory: moved.source, stash: updateStashContainer(profile.stash, destinationTab!.id, moved.target) } : profile;
    }
    if (stashEntry && command.destination === "backpack") {
      const moved = transferItem(stashEntry.tab.container, profile.inventory, command.itemId, command.x, command.y);
      return moved ? { ...profile, inventory: moved.target, stash: updateStashContainer(profile.stash, stashEntry.tab.id, moved.source) } : profile;
    }
    return profile;
  }

  private equip(profile: PlayerProfile, itemId: string, requestedSlot: CharacterEquipmentSlot): PlayerProfile {
    const inventoryEntry = findContainerEntry(profile.inventory, itemId);
    const stashEntry = findStashEntry(profile.stash, itemId);
    const item = inventoryEntry?.item ?? stashEntry?.entry.item;
    if (!item || item.kind !== "equipment" || !equipmentSlotAccepts(requestedSlot, item)) return profile;
    const targetSlot = requestedSlot ?? chooseEquipmentSlot(item, profile.equipped);
    const previous = profile.equipped[targetSlot];
    if (inventoryEntry) {
      const removed = removeItem(profile.inventory, item.id);
      if (!removed) return profile;
      let inventory = removed.container;
      if (previous) {
        const inserted = insertItem(inventory, previous, { x: inventoryEntry.x, y: inventoryEntry.y });
        if (inserted.unplaced.length) return profile;
        inventory = inserted.container;
      }
      return { ...profile, inventory, equipped: { ...profile.equipped, [targetSlot]: item as EquipmentItem } };
    }
    if (!stashEntry) return profile;
    const source = removeItem(stashEntry.tab.container, item.id);
    if (!source) return profile;
    let stashContainer = source.container;
    if (previous) {
      const inserted = insertItem(stashContainer, previous, { x: stashEntry.entry.x, y: stashEntry.entry.y });
      if (inserted.unplaced.length) return profile;
      stashContainer = inserted.container;
    }
    return {
      ...profile,
      stash: updateStashContainer(profile.stash, stashEntry.tab.id, stashContainer),
      equipped: { ...profile.equipped, [targetSlot]: item as EquipmentItem },
    };
  }

  private applyCurrency(profile: PlayerProfile, currencyItemId: string, targetItemId: string): PlayerProfile {
    const inventory = applyBackpackCurrency(profile.inventory, currencyItemId, targetItemId);
    return inventory ? { ...profile, inventory } : profile;
  }

  private buyMerchantOffer(
    profile: PlayerProfile,
    merchantId: MerchantId,
    offerId: string,
    merchantEntitlements: readonly MerchantId[],
    position?: { x: number; y: number },
  ): PlayerProfile {
    if (!merchantIsAvailable(merchantId, merchantEntitlements)) return profile;
    const purchase = purchaseMerchantOffer(profile, merchantId, offerId, position);
    if (!purchase) return profile;
    const securedId = randomUUID();
    return {
      ...purchase.profile,
      inventory: mapContainerItems(purchase.profile.inventory, (item) => item.id === purchase.item.id ? { ...item, id: securedId } : item),
    };
  }
}
