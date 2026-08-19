import { EQUIPMENT_DROP_COLORS, LOOT_RULES } from "./config/loot";
import { FLASK_DEFINITIONS } from "./config/flasks";
import type { EquipmentItem, FlaskId, Rarity } from "./domain";

export interface DropChances {
  equipment: number;
  material: number;
  flask: number;
}

export function dropChances(itemQuantity: number): DropChances {
  const multiplier = Math.max(0, itemQuantity) / 100;
  const equipment = Math.min(LOOT_RULES.maximumEquipmentDropChance, LOOT_RULES.baseEquipmentDropChance * multiplier);
  const material = Math.min(LOOT_RULES.maximumMaterialDropChance, LOOT_RULES.baseMaterialDropChance * multiplier);
  const flask = Math.min(LOOT_RULES.maximumFlaskDropChance, LOOT_RULES.baseFlaskDropChance * multiplier);
  const total = equipment + material + flask;
  const normalization = total > LOOT_RULES.maximumAnyDropChance ? LOOT_RULES.maximumAnyDropChance / total : 1;
  return { equipment: equipment * normalization, material: material * normalization, flask: flask * normalization };
}

export function rollFlaskDrop(random: () => number = Math.random): FlaskId {
  const definitions = Object.values(FLASK_DEFINITIONS);
  const totalWeight = definitions.reduce((sum, definition) => sum + definition.dropWeight, 0);
  let roll = random() * totalWeight;
  for (const definition of definitions) {
    roll -= definition.dropWeight;
    if (roll < 0) return definition.id;
  }
  return definitions[definitions.length - 1].id;
}

export function equipmentDropPresentation(item: Pick<EquipmentItem, "baseName" | "rarity">): { label: string; color: string } {
  return {
    label: item.baseName.toUpperCase(),
    color: EQUIPMENT_DROP_COLORS[item.rarity],
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
