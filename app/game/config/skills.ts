import type { SkillDefinition } from "./schema";

export const BASIC_ATTACK = {
  id: "ember-lance",
  name: "Ember Lance",
  key: "Space",
  focusCost: 0,
  damage: { type: "fire", effectiveness: 1, range: { minMultiplier: 0.8, maxMultiplier: 1.2 } },
  projectileScale: 1,
  projectileCount: 1,
  piercing: 0,
  presentation: { animation: "attack", vfx: "ember-lance", audio: "ember-lance" },
} as const satisfies SkillDefinition;

export const ACTIVE_SKILLS = {
  nova: {
    id: "nova", name: "Ember Nova", key: "Q", focusCost: 30, cooldown: 4,
    damage: { type: "fire", effectiveness: 1.35, range: { minMultiplier: 0.8, maxMultiplier: 1.2 } },
    projectileScale: 1.35,
    projectileCount: 18,
    piercing: 0,
    progression: { maxLevel: 20, damageEffectivenessPerLevel: 0.06, projectilesPerLevel: 1, piercingEveryLevels: 5 },
    presentation: { animation: "cast", vfx: "ember-nova", audio: "ember-nova" },
  },
  dash: {
    id: "dash", name: "Rift Step", key: "E", focusCost: 15, maxCharges: 3, recharge: 3,
    progression: { maxLevel: 20, rechargePerLevel: -0.08, chargeEveryLevels: 5 },
    presentation: { animation: "dash", vfx: "rift-step", audio: "rift-step" },
  },
  ward: {
    id: "ward", name: "Cinder Ward", key: "R", focusCost: 25, cooldown: 9,
    duration: 4,
    damageReduction: 45,
    presentation: { animation: "cast", vfx: "cinder-ward", audio: "cinder-ward" },
  },
  flameWave: {
    id: "flame-wave", name: "Flame Wave", key: "F", focusCost: 22, cooldown: 5.5,
    damage: { type: "fire", effectiveness: 1.65, range: { minMultiplier: 0.8, maxMultiplier: 1.2 } },
    projectileScale: 1.18,
    projectileCount: 7,
    piercing: 1,
    presentation: { animation: "cast", vfx: "flame-wave", audio: "flame-wave" },
  },
} as const satisfies Record<string, SkillDefinition>;
