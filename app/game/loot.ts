import { LOOT_RULES } from "./config/loot";
import type { Rarity } from "./domain";

export interface DropChances {
  equipment: number;
  material: number;
}

export function dropChances(itemQuantity: number): DropChances {
  const multiplier = Math.max(0, itemQuantity) / 100;
  return {
    equipment: Math.min(LOOT_RULES.maximumEquipmentDropChance, LOOT_RULES.baseEquipmentDropChance * multiplier),
    material: Math.min(LOOT_RULES.maximumMaterialDropChance, LOOT_RULES.baseMaterialDropChance * multiplier),
  };
}

export function rollEquipmentRarity(itemRarity: number, random: () => number = Math.random): Extract<Rarity, "normal" | "magic" | "rare"> {
  const multiplier = Math.max(0, itemRarity) / 100;
  const normalWeight = LOOT_RULES.equipmentRarityWeights.normal;
  const magicWeight = LOOT_RULES.equipmentRarityWeights.magic * multiplier;
  const rareWeight = LOOT_RULES.equipmentRarityWeights.rare * multiplier * multiplier;
  const total = normalWeight + magicWeight + rareWeight;
  const roll = random() * total;
  if (roll < rareWeight) return "rare";
  if (roll < rareWeight + magicWeight) return "magic";
  return "normal";
}
