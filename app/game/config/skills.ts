import type { SkillDefinition } from "./schema";

export const SKILL_TREE_BRANCHES = [
  { id: "destruction", name: "Destruction", subtitle: "Shape fire into pack-clearing force", numeral: "I" },
  { id: "survival", name: "Survival", subtitle: "Endure the deadliest moments", numeral: "II" },
  { id: "mobility", name: "Mobility", subtitle: "Control distance and tempo", numeral: "III" },
] as const;

export const BASIC_ATTACK = {
  id: "ember-lance",
  name: "Ember Lance",
  key: "Space",
  focusCost: 0,
  damage: { type: "fire", effectiveness: 1, range: { minMultiplier: 0.8, maxMultiplier: 1.2 } },
  projectileScale: 1,
  projectileCount: 1,
  piercing: 0,
  tree: { branch: "core", role: "Innate attack", description: "A focused fire bolt woven into every Sorceress loadout.", accent: "#d98143" },
  presentation: { animation: "attack", vfx: "ember-lance", audio: "ember-lance" },
} as const satisfies SkillDefinition;

export const ACTIVE_SKILLS = {
  nova: {
    id: "nova", name: "Ember Nova", key: "Q", focusCost: 30, castTime: 0.75, cooldown: 4,
    damage: { type: "fire", effectiveness: 1.35, range: { minMultiplier: 0.8, maxMultiplier: 1.2 } },
    projectileScale: 1.35,
    projectileCount: 18,
    piercing: 0,
    tree: { branch: "destruction", role: "Area devastation", description: "Detonate an expanding crown of embers to erase dense monster packs.", accent: "#dc6c37" },
    progression: { maxLevel: 20, damageEffectivenessPerLevel: 0.06, projectilesPerLevel: 1, piercingEveryLevels: 5 },
    presentation: { animation: "cast", vfx: "ember-nova", audio: "ember-nova" },
  },
  dash: {
    id: "dash", name: "Rift Step", key: "E", focusCost: 15, maxCharges: 3, recharge: 3,
    tree: { branch: "mobility", role: "Mobility", description: "Tear through the rift to escape danger and reposition between packs.", accent: "#9371d0" },
    progression: { maxLevel: 20, rechargePerLevel: -0.08, chargeEveryLevels: 5 },
    presentation: { animation: "dash", vfx: "rift-step", audio: "rift-step" },
  },
  ward: {
    id: "ward", name: "Cinder Ward", key: "R", focusCost: 25, castTime: 0.65, cooldown: 9,
    duration: 4,
    damageReduction: 45,
    tree: { branch: "survival", role: "Defensive guard", description: "Wrap yourself in cinders that blunt incoming damage during lethal engagements.", accent: "#58a7a0" },
    progression: { maxLevel: 20, cooldownPerLevel: -0.15, durationPerLevel: 0.08, damageReductionPerLevel: 0.6 },
    presentation: { animation: "cast", vfx: "cinder-ward", audio: "cinder-ward" },
  },
  flameWave: {
    id: "flame-wave", name: "Flame Wave", key: "F", focusCost: 22, castTime: 0.7, cooldown: 5.5,
    damage: { type: "fire", effectiveness: 1.65, range: { minMultiplier: 0.8, maxMultiplier: 1.2 } },
    projectileScale: 1.18,
    projectileCount: 7,
    piercing: 1,
    tree: { branch: "destruction", role: "Focused clearing", description: "Project a searing fan through a chosen lane for controlled pack destruction.", accent: "#e49a3f" },
    progression: { maxLevel: 20, damageEffectivenessPerLevel: 0.05, projectilesEveryLevels: 5, piercingEveryLevels: 5 },
    presentation: { animation: "cast", vfx: "flame-wave", audio: "flame-wave" },
  },
} as const satisfies Record<string, SkillDefinition>;
