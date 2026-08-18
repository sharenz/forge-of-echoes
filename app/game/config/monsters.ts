import type { MonsterDefinition } from "./schema";

export const MONSTER_ARCHETYPES = {
  ashling: {
    id: "ashling",
    name: "Ashling",
    baseLife: 1,
    lifePerWave: 0.28,
    speed: { min: 39, max: 58, perWave: 1.2 },
    contactDamage: 5,
    contactDamagePerWave: 0.8,
    aggroRange: 720,
  },
} as const satisfies Record<string, MonsterDefinition>;
