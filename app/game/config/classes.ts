import type { CharacterClassId } from "../domain";
import type { CharacterClassDefinition } from "./schema";

export const CHARACTER_CLASSES: Record<CharacterClassId, CharacterClassDefinition> = {
  amazon: {
    id: "amazon",
    name: "Amazon",
    title: "Spear of the Wild",
    fantasy: "Mobile ranged precision, piercing attacks, and relentless momentum.",
    weapon: "Hunter Spear",
    startingAttributes: { strength: 18, dexterity: 32, intelligence: 14 },
    attributesPerLevel: { strength: 0.7, dexterity: 1.2, intelligence: 0.5 },
    baseStats: { evadeChance: 6, moveSpeed: 12 },
    accent: "#d2a65f",
  },
  barbarian: {
    id: "barbarian",
    name: "Barbarian",
    title: "Breaker of Chains",
    fantasy: "Massive life, close-range force, and armor that rewards staying in the fight.",
    weapon: "Iron Cleaver",
    startingAttributes: { strength: 34, dexterity: 15, intelligence: 10 },
    attributesPerLevel: { strength: 1.4, dexterity: 0.5, intelligence: 0.3 },
    baseStats: { maxLife: 28, armor: 18, moveSpeed: -10 },
    accent: "#c46542",
  },
  sorceress: {
    id: "sorceress",
    name: "Sorceress",
    title: "Keeper of Embers",
    fantasy: "Explosive spell patterns, Focus mastery, and dangerous elemental reach.",
    weapon: "Ashwood Wand",
    startingAttributes: { strength: 10, dexterity: 17, intelligence: 36 },
    attributesPerLevel: { strength: 0.3, dexterity: 0.6, intelligence: 1.5 },
    baseStats: { maxFocus: 35, attackDamage: 4, evadeChance: 2 },
    accent: "#e98a46",
  },
};
