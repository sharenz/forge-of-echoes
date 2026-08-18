import type { CharacterClassId } from "../domain";
import type { ItemBaseDefinition } from "./schema";

export const ITEM_BASES = [
  {
    id: "hunter-spear", name: "Hunter Spear", slot: "mainHand", requiredLevel: 1,
    implicit: "8% increased attack speed",
    baseStats: [{ stat: "attackDamage", mode: "flat", base: 7, perItemLevel: 0.42 }],
    implicitModifiers: [{ stat: "attackSpeed", mode: "increased", base: 8 }],
    weapon: { attacksPerSecond: 1.45 },
  },
  {
    id: "ashwood-wand", name: "Ashwood Wand", slot: "mainHand", requiredLevel: 1,
    implicit: "10% increased attack damage",
    baseStats: [{ stat: "attackDamage", mode: "flat", base: 6, perItemLevel: 0.38 }],
    implicitModifiers: [{ stat: "attackDamage", mode: "increased", base: 10 }],
    weapon: { attacksPerSecond: 1.25 },
  },
  {
    id: "iron-cleaver", name: "Iron Cleaver", slot: "mainHand", requiredLevel: 1,
    implicit: "+4 attack damage",
    baseStats: [{ stat: "attackDamage", mode: "flat", base: 9, perItemLevel: 0.48 }],
    implicitModifiers: [{ stat: "attackDamage", mode: "flat", base: 4 }],
    weapon: { attacksPerSecond: 1.1 },
  },
  {
    id: "riveted-coat", name: "Riveted Coat", slot: "chest", requiredLevel: 1,
    implicit: "12% increased armor",
    baseStats: [{ stat: "armor", mode: "flat", base: 15, perItemLevel: 1.25 }],
    implicitModifiers: [{ stat: "armor", mode: "increased", base: 12 }],
  },
  {
    id: "ember-ring", name: "Ember Ring", slot: "ring", requiredLevel: 1,
    implicit: "+8 maximum Focus",
    baseStats: [],
    implicitModifiers: [{ stat: "maxFocus", mode: "flat", base: 8 }],
  },
  {
    id: "pathfinder-boots", name: "Pathfinder Boots", slot: "boots", requiredLevel: 1,
    implicit: "5% increased movement speed",
    baseStats: [{ stat: "armor", mode: "flat", base: 4, perItemLevel: 0.42 }],
    implicitModifiers: [{ stat: "moveSpeed", mode: "increased", base: 5 }],
  },
  {
    id: "iron-visor", name: "Iron Visor", slot: "helmet", requiredLevel: 1,
    implicit: "+10 maximum Life",
    baseStats: [{ stat: "armor", mode: "flat", base: 9, perItemLevel: 0.82 }],
    implicitModifiers: [{ stat: "maxLife", mode: "flat", base: 10 }],
  },
  {
    id: "ashen-buckler", name: "Ashen Buckler", slot: "offHand", requiredLevel: 1,
    implicit: "8% increased armor",
    baseStats: [{ stat: "armor", mode: "flat", base: 12, perItemLevel: 1.05 }],
    implicitModifiers: [{ stat: "armor", mode: "increased", base: 8 }],
  },
  {
    id: "cinder-pendant", name: "Cinder Pendant", slot: "amulet", requiredLevel: 1,
    implicit: "+12 maximum Focus",
    baseStats: [],
    implicitModifiers: [{ stat: "maxFocus", mode: "flat", base: 12 }],
  },
  {
    id: "grasping-gloves", name: "Grasping Gloves", slot: "gloves", requiredLevel: 1,
    implicit: "6% increased attack speed",
    baseStats: [{ stat: "armor", mode: "flat", base: 6, perItemLevel: 0.58 }],
    implicitModifiers: [{ stat: "attackSpeed", mode: "increased", base: 6 }],
  },
  {
    id: "chain-belt", name: "Chain Belt", slot: "belt", requiredLevel: 1,
    implicit: "+16 maximum Life",
    baseStats: [{ stat: "armor", mode: "flat", base: 5, perItemLevel: 0.45 }],
    implicitModifiers: [{ stat: "maxLife", mode: "flat", base: 16 }],
  },
] as const satisfies readonly ItemBaseDefinition[];

export type ItemBaseId = (typeof ITEM_BASES)[number]["id"];

export const ITEM_BASES_BY_ID = Object.fromEntries(ITEM_BASES.map((base) => [base.id, base])) as unknown as Record<ItemBaseId, ItemBaseDefinition>;

export const STARTER_BASES: Record<CharacterClassId, ItemBaseId> = {
  amazon: "hunter-spear",
  barbarian: "iron-cleaver",
  sorceress: "ashwood-wand",
};
