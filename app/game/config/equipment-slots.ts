import type { CharacterEquipmentSlot, EquipmentSlot } from "../domain";

export interface CharacterEquipmentSlotDefinition {
  id: CharacterEquipmentSlot;
  label: string;
  accepts: EquipmentSlot;
}

export const EQUIPMENT_TYPE_LABELS: Record<EquipmentSlot, string> = {
  helmet: "Helmet",
  mainHand: "Main Hand",
  offHand: "Off Hand",
  amulet: "Amulet",
  ring: "Ring",
  chest: "Chest",
  gloves: "Gloves",
  boots: "Boots",
  belt: "Belt",
};

export const CHARACTER_EQUIPMENT_SLOTS = [
  { id: "helmet", label: "Helmet", accepts: "helmet" },
  { id: "amulet", label: "Amulet", accepts: "amulet" },
  { id: "mainHand", label: "Main Hand", accepts: "mainHand" },
  { id: "offHand", label: "Off Hand", accepts: "offHand" },
  { id: "chest", label: "Chest", accepts: "chest" },
  { id: "gloves", label: "Gloves", accepts: "gloves" },
  { id: "ringLeft", label: "Ring I", accepts: "ring" },
  { id: "ringRight", label: "Ring II", accepts: "ring" },
  { id: "belt", label: "Belt", accepts: "belt" },
  { id: "boots", label: "Boots", accepts: "boots" },
] as const satisfies readonly CharacterEquipmentSlotDefinition[];

export const CHARACTER_EQUIPMENT_SLOT_BY_ID = Object.fromEntries(
  CHARACTER_EQUIPMENT_SLOTS.map((slot) => [slot.id, slot]),
) as Record<CharacterEquipmentSlot, CharacterEquipmentSlotDefinition>;
