import type { SkillDefinition } from "./schema";

export const BASIC_ATTACK = {
  id: "ember-lance",
  name: "Ember Lance",
  key: "Mouse",
  focusCost: 0,
  damage: { type: "fire", effectiveness: 1, range: { minMultiplier: 0.8, maxMultiplier: 1.2 } },
  projectileScale: 1,
  presentation: { animation: "attack", vfx: "ember-lance", audio: "ember-lance" },
} as const satisfies SkillDefinition;

export const ACTIVE_SKILLS = {
  nova: { id: "nova", name: "Ember Nova", key: "Q", focusCost: 30, cooldown: 4, damage: { type: "fire", effectiveness: 1.35, range: { minMultiplier: 0.8, maxMultiplier: 1.2 } }, projectileScale: 1.35, presentation: { animation: "cast", vfx: "ember-nova", audio: "ember-nova" } },
  dash: { id: "dash", name: "Rift Step", key: "E", focusCost: 15, maxCharges: 3, recharge: 3, presentation: { animation: "dash", vfx: "rift-step", audio: "rift-step" } },
} as const satisfies Record<string, SkillDefinition>;
