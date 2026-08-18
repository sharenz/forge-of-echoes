import type { ArenaStatKey } from "../domain";
import type { ScaledModifierDefinition } from "./schema";

export const ARENA_RULES = {
  totalWaves: 6,
  waveSpawnIntervalSeconds: 30,
  baseFocusRegen: 8,
  baseItemQuantity: 100,
  baseItemRarity: 100,
  baseMonsterCount: 28,
  baseMonsterRarity: 100,
  monsterCountPerWave: 16,
  returnPortal: {
    spawnOffset: 130,
    triggerRadius: 58,
  },
  tierModifiers: [
    { stat: "monsterLife", mode: "increased", base: 0, perTier: 8 },
    { stat: "monsterDamage", mode: "increased", base: 0, perTier: 7 },
    { stat: "monsterRarity", mode: "increased", base: 0, perTier: 7 },
    { stat: "itemRarity", mode: "increased", base: 0, perTier: 4 },
  ] satisfies readonly ScaledModifierDefinition<ArenaStatKey>[],
  waveModifiers: [
    { stat: "monsterRarity", mode: "increased", base: 0, perWave: 4 },
    { stat: "itemQuantity", mode: "increased", base: 0, perWave: 2 },
    { stat: "itemRarity", mode: "increased", base: 0, perWave: 3 },
  ] satisfies readonly ScaledModifierDefinition<ArenaStatKey>[],
} as const;
