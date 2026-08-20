import { MAP_TIER_RULES } from "./config/maps";
import { MAP_COMPLETION_REWARDS } from "./config/rewards";
import type { Rarity } from "./domain";
import { generateEquipmentWithRandom } from "./items";
import { rollEquipmentRarity, type GeneratedDrop } from "./loot";
import { createMap } from "./maps";

type EquipmentRarity = Extract<Rarity, "normal" | "magic" | "rare">;

const RARITY_RANK: Record<EquipmentRarity, number> = {
  normal: 0,
  magic: 1,
  rare: 2,
};

function atLeastRarity(rolled: EquipmentRarity, minimum: Extract<EquipmentRarity, "magic" | "rare">): EquipmentRarity {
  return RARITY_RANK[rolled] >= RARITY_RANK[minimum] ? rolled : minimum;
}

function randomInteger(minimum: number, maximum: number, random: () => number): number {
  return minimum + Math.floor(Math.min(0.999999, Math.max(0, random())) * (maximum - minimum + 1));
}

/** Builds the complete, deterministic reward bundle before the chest spills it into the world. */
export function createMapCompletionRewards(
  itemLevel: number,
  itemRarity: number,
  completedMapTier: number,
  random: () => number = Math.random,
): GeneratedDrop[] {
  const rewards: GeneratedDrop[] = [];
  for (let index = 0; index < MAP_COMPLETION_REWARDS.equipmentCount; index += 1) {
    const rolledRarity = rollEquipmentRarity(itemRarity, random);
    const rarity = index === 0
      ? atLeastRarity(rolledRarity, MAP_COMPLETION_REWARDS.minimumGuaranteedEquipmentRarity)
      : rolledRarity;
    rewards.push({ kind: "equipment", item: generateEquipmentWithRandom(itemLevel, rarity, random) });
  }
  for (const material of MAP_COMPLETION_REWARDS.materials) {
    rewards.push({
      kind: "currency",
      currency: material.currency,
      amount: randomInteger(material.minimum, material.maximum, random),
    });
  }
  const progressionTier = Math.min(
    MAP_TIER_RULES.maximum,
    Math.max(MAP_TIER_RULES.minimum, Math.floor(completedMapTier) + MAP_COMPLETION_REWARDS.progressionMapTierOffset),
  );
  rewards.push({ kind: "inventory", item: createMap(progressionTier, undefined, random) });
  return rewards;
}
