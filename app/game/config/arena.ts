import type { ArenaStatKey } from "../domain";
import type { ScaledModifierDefinition } from "./schema";

export const ARENA_RULES = {
  totalWaves: 6,
  waveSpawnIntervalSeconds: 30,
  baseFocusRegen: 8,
  baseMonsterCount: 28,
  monsterCountPerWave: 16,
  tierModifiers: [
    { stat: "monsterLife", mode: "increased", base: 0, perTier: 8 },
    { stat: "monsterDamage", mode: "increased", base: 0, perTier: 7 },
  ] satisfies readonly ScaledModifierDefinition<ArenaStatKey>[],
} as const;
