import type { SkillDefinition } from "./schema";

export const ACTIVE_SKILLS = {
  nova: { id: "nova", name: "Ember Nova", key: "Q", focusCost: 30, cooldown: 4 },
  dash: { id: "dash", name: "Rift Step", key: "E", focusCost: 15, maxCharges: 3, recharge: 3 },
} as const satisfies Record<string, SkillDefinition>;
