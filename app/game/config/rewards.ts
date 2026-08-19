import type { CurrencyId, Rarity } from "../domain";

export type CompletionRewardCurrency = Extract<CurrencyId, "scrap" | "essence" | "mapDust">;

interface CompletionMaterialReward {
  currency: CompletionRewardCurrency;
  minimum: number;
  maximum: number;
}

interface MapCompletionRewardDefinition {
  equipmentCount: number;
  minimumGuaranteedEquipmentRarity: Extract<Rarity, "magic" | "rare">;
  minimumItemLevel: number;
  itemLevelsPerMapTier: number;
  materials: readonly CompletionMaterialReward[];
  chest: {
    spawnDistance: number;
    interactionWidth: number;
    interactionHeight: number;
    lootScatterRadius: number;
  };
}

export const MAP_COMPLETION_REWARDS = {
  equipmentCount: 2,
  minimumGuaranteedEquipmentRarity: "magic",
  minimumItemLevel: 10,
  itemLevelsPerMapTier: 5,
  materials: [
    { currency: "scrap", minimum: 5, maximum: 9 },
    { currency: "essence", minimum: 2, maximum: 4 },
    { currency: "mapDust", minimum: 1, maximum: 2 },
  ],
  chest: {
    spawnDistance: 108,
    interactionWidth: 96,
    interactionHeight: 76,
    lootScatterRadius: 76,
  },
} as const satisfies MapCompletionRewardDefinition;
