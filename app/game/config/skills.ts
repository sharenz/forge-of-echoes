import type { SkillDefinition } from "./schema";

export const BASIC_ATTACK = {
  id: "ember-lance",
  name: "Ember Lance",
  key: "Mouse",
  focusCost: 0,
  damageEffectiveness: 1,
  projectileScale: 1,
} as const satisfies SkillDefinition;

export const ACTIVE_SKILLS = {
  nova: { id: "nova", name: "Ember Nova", key: "Q", focusCost: 30, cooldown: 4, damageEffectiveness: 1.35, projectileScale: 1.35 },
  dash: { id: "dash", name: "Rift Step", key: "E", focusCost: 15, maxCharges: 3, recharge: 3 },
} as const satisfies Record<string, SkillDefinition>;
