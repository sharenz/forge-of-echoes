import { CHARACTER_EQUIPMENT_SLOTS, CHARACTER_EQUIPMENT_SLOT_BY_ID } from "./config/equipment-slots";
import type { CharacterEquipmentSlot, EquipmentItem, PlayerProfile } from "./domain";

export function equipmentSlotAccepts(slot: CharacterEquipmentSlot, item: EquipmentItem): boolean {
  return CHARACTER_EQUIPMENT_SLOT_BY_ID[slot].accepts === item.slot;
}

export function findEquippedSlot(equipped: PlayerProfile["equipped"], itemId: string): CharacterEquipmentSlot | null {
  return (Object.entries(equipped) as [CharacterEquipmentSlot, EquipmentItem | undefined][])
    .find(([, item]) => item?.id === itemId)?.[0] ?? null;
}

export function chooseEquipmentSlot(item: EquipmentItem, equipped: PlayerProfile["equipped"]): CharacterEquipmentSlot {
  const compatible = CHARACTER_EQUIPMENT_SLOTS.filter((slot) => slot.accepts === item.slot);
  const empty = compatible.find((slot) => !equipped[slot.id]);
  return (empty ?? compatible[0]).id;
}
