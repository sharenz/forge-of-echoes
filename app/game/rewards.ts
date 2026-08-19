import type { MapDrop } from "./combat";
import { MAP_COMPLETION_REWARDS } from "./config/rewards";
import type { Rarity } from "./domain";
import { generateEquipmentWithRandom } from "./items";
import { rollEquipmentRarity } from "./loot";

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
  random: () => number = Math.random,
): MapDrop[] {
  const rewards: MapDrop[] = [];
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
  return rewards;
}
