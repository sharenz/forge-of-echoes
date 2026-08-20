import { EQUIPMENT_DROP_COLORS, LOOT_RULES } from "./config/loot";
import { FLASK_DEFINITIONS } from "./config/flasks";
import { MAP_TIER_RULES } from "./config/maps";
import type { CurrencyId, EquipmentItem, FlaskId, InventoryItem, Rarity } from "./domain";
import { generateEquipmentWithRandom } from "./items";
import { createMap } from "./maps";

export interface DropChances {
  equipment: number;
  map: number;
  material: number;
  flask: number;
}

/** A generated reward before the authoritative server assigns ownership and a world-drop id. */
export type GeneratedDrop =
  | { kind: "equipment"; item: EquipmentItem }
  | { kind: "currency"; currency: Extract<CurrencyId, "scrap" | "essence" | "mapDust">; amount: number }
  | { kind: "flask"; flask: FlaskId; amount: number }
  | { kind: "inventory"; item: InventoryItem };

export function dropChances(itemQuantity: number): DropChances {
  const multiplier = Math.max(0, itemQuantity) / 100;
  const equipment = Math.min(LOOT_RULES.maximumEquipmentDropChance, LOOT_RULES.baseEquipmentDropChance * multiplier);
  const map = Math.min(LOOT_RULES.maximumMapDropChance, LOOT_RULES.baseMapDropChance * multiplier);
  const material = Math.min(LOOT_RULES.maximumMaterialDropChance, LOOT_RULES.baseMaterialDropChance * multiplier);
  const flask = Math.min(LOOT_RULES.maximumFlaskDropChance, LOOT_RULES.baseFlaskDropChance * multiplier);
  const total = equipment + map + material + flask;
  const normalization = total > LOOT_RULES.maximumAnyDropChance ? LOOT_RULES.maximumAnyDropChance / total : 1;
  return { equipment: equipment * normalization, map: map * normalization, material: material * normalization, flask: flask * normalization };
}

/** Rolls only maps the current encounter is allowed to sustain: its own tier or lower. */
export function rollMapDropTier(currentMapTier: number, random: () => number = Math.random): number {
  const maximumTier = Math.min(MAP_TIER_RULES.maximum, Math.max(MAP_TIER_RULES.minimum, Math.floor(currentMapTier)));
  const weights = Array.from(
    { length: maximumTier },
    (_, distance) => MAP_TIER_RULES.monsterDropLowerTierWeightMultiplier ** distance,
  );
  let roll = Math.min(0.999999, Math.max(0, random())) * weights.reduce((sum, weight) => sum + weight, 0);
  for (let distance = 0; distance < weights.length; distance += 1) {
    roll -= weights[distance];
    if (roll < 0) return maximumTier - distance;
  }
  return MAP_TIER_RULES.minimum;
}

export interface MonsterDropContext {
  itemLevel: number;
  currentMapTier: number;
  itemQuantity: number;
  itemRarity: number;
}

/** One canonical monster-loot roll consumed by the authoritative map server. */
export function rollMonsterDrop(context: MonsterDropContext, random: () => number = Math.random): GeneratedDrop | null {
  const chances = dropChances(context.itemQuantity);
  const roll = random();
  if (roll < chances.equipment) {
    return {
      kind: "equipment",
      item: generateEquipmentWithRandom(context.itemLevel, rollEquipmentRarity(context.itemRarity, random), random),
    };
  }
  if (roll < chances.equipment + chances.map) {
    return { kind: "inventory", item: createMap(rollMapDropTier(context.currentMapTier, random), undefined, random) };
  }
  if (roll < chances.equipment + chances.map + chances.material) {
    const materialRoll = random() * Object.values(LOOT_RULES.materialWeights).reduce((sum, weight) => sum + weight, 0);
    const mapDustLimit = LOOT_RULES.materialWeights.mapDust;
    const essenceLimit = mapDustLimit + LOOT_RULES.materialWeights.essence;
    return {
      kind: "currency",
      currency: materialRoll < mapDustLimit ? "mapDust" : materialRoll < essenceLimit ? "essence" : "scrap",
      amount: 1,
    };
  }
  if (roll < chances.equipment + chances.map + chances.material + chances.flask) {
    return { kind: "flask", flask: rollFlaskDrop(random), amount: 1 };
  }
  return null;
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
