export const LOOT_RULES = {
  baseEquipmentDropChance: 0.0055,
  baseMapDropChance: 0.0035,
  baseMaterialDropChance: 0.016,
  baseFlaskDropChance: 0.011,
  maximumEquipmentDropChance: 0.42,
  maximumMapDropChance: 0.3,
  maximumMaterialDropChance: 0.72,
  maximumFlaskDropChance: 0.26,
  maximumAnyDropChance: 0.92,
  equipmentRarityWeights: {
    normal: 50,
    magic: 48.75,
    rare: 1.25,
  },
  materialWeights: {
    mapDust: 12,
    essence: 22,
    scrap: 66,
  },
} as const;

export const EQUIPMENT_DROP_COLORS = {
  normal: "#f2eee6",
  magic: "#749cff",
  rare: "#ffe06a",
  unique: "#dc7b3f",
} as const;
