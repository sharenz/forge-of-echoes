import type { ArenaStatKey, MonsterRarity } from "../domain";
import type { ScaledModifierDefinition } from "./schema";

export interface MonsterPackModifierDefinition {
  id: string;
  name: string;
  rarity: Exclude<MonsterRarity, "normal">;
  weight: number;
  modifiers: readonly ScaledModifierDefinition<ArenaStatKey>[];
}

export const MONSTER_PACK_RULES = {
  baseMagicChance: 0.08,
  baseRareChance: 0.02,
  maximumMagicChance: 0.48,
  maximumRareChance: 0.16,
  magicModifierCount: 1,
  rareModifierCount: 2,
  typeCountWeights: [62, 30, 8],
  magicTint: 0x7799ff,
  rareTint: 0xffc34f,
  rarityRewardModifiers: {
    normal: [],
    magic: [
      { stat: "itemQuantity", mode: "more", base: 35 },
      { stat: "itemRarity", mode: "more", base: 100 },
    ],
    rare: [
      { stat: "itemQuantity", mode: "more", base: 200 },
      { stat: "itemRarity", mode: "more", base: 300 },
    ],
  } satisfies Record<MonsterRarity, readonly ScaledModifierDefinition<ArenaStatKey>[]>,
} as const;

export const MAGIC_PACK_MODIFIERS = [
  { id: "quickened", name: "Quickened", rarity: "magic", weight: 28, modifiers: [{ stat: "monsterMoveSpeed", mode: "increased", base: 28 }] },
  { id: "stout", name: "Stout", rarity: "magic", weight: 28, modifiers: [{ stat: "monsterLife", mode: "increased", base: 45 }] },
  { id: "armored", name: "Armored", rarity: "magic", weight: 22, modifiers: [{ stat: "monsterArmor", mode: "flat", base: 32 }] },
  { id: "deadly", name: "Deadly", rarity: "magic", weight: 22, modifiers: [{ stat: "monsterDamage", mode: "increased", base: 32 }] },
] as const satisfies readonly MonsterPackModifierDefinition[];

export const RARE_MONSTER_MODIFIERS = [
  { id: "juggernaut", name: "Juggernaut", rarity: "rare", weight: 26, modifiers: [{ stat: "monsterLife", mode: "more", base: 120 }, { stat: "monsterArmor", mode: "flat", base: 65 }] },
  { id: "executioner", name: "Executioner", rarity: "rare", weight: 24, modifiers: [{ stat: "monsterDamage", mode: "more", base: 70 }] },
  { id: "phantom", name: "Phantom", rarity: "rare", weight: 22, modifiers: [{ stat: "monsterMoveSpeed", mode: "more", base: 35 }, { stat: "monsterEvadeChance", mode: "flat", base: 18 }] },
  { id: "colossal", name: "Colossal", rarity: "rare", weight: 28, modifiers: [{ stat: "monsterLife", mode: "more", base: 80 }, { stat: "monsterDamage", mode: "more", base: 35 }] },
] as const satisfies readonly MonsterPackModifierDefinition[];
