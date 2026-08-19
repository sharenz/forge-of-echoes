import { CHARACTER_EQUIPMENT_SLOTS } from "./config/equipment-slots";
import type { CharacterEquipmentSlot, CharacterStats, EquipmentItem, PlayerProfile } from "./domain";
import { findEquippedSlot } from "./equipment";
import { calculateCharacterStats } from "./stats";

export type ComparableCharacterStat = keyof CharacterStats;

export interface EquipmentStatDelta {
  stat: ComparableCharacterStat;
  current: number;
  candidate: number;
  delta: number;
}

export interface EquipmentComparison {
  slot: CharacterEquipmentSlot;
  slotLabel: string;
  equippedItem?: EquipmentItem;
  statDeltas: EquipmentStatDelta[];
}

const COMPARABLE_STATS = Object.freeze([
  "strength",
  "dexterity",
  "intelligence",
  "maxLife",
  "maxFocus",
  "attackDamage",
  "attackSpeed",
  "armor",
  "evadeChance",
  "moveSpeed",
] satisfies readonly ComparableCharacterStat[]);

const FLOAT_TOLERANCE = 0.0001;

/**
 * Resolves the outcome of equipping an item through the same stat engine used
 * by combat and the character sheet. This deliberately avoids comparing raw
 * affix text, which would be incorrect for increased/more modifiers and
 * attribute-derived stats.
 */
export function compareEquipmentToCurrent(profile: PlayerProfile, candidate: EquipmentItem): EquipmentComparison[] {
  if (findEquippedSlot(profile.equipped, candidate.id)) return [];

  const currentStats = calculateCharacterStats(profile).stats;
  return CHARACTER_EQUIPMENT_SLOTS
    .filter((slot) => slot.accepts === candidate.slot)
    .map((slot) => {
      const equippedItem = profile.equipped[slot.id];
      const candidateStats = calculateCharacterStats({
        ...profile,
        equipped: { ...profile.equipped, [slot.id]: candidate },
      }).stats;
      const statDeltas = COMPARABLE_STATS.flatMap((stat) => {
        const delta = candidateStats[stat] - currentStats[stat];
        return Math.abs(delta) <= FLOAT_TOLERANCE
          ? []
          : [{ stat, current: currentStats[stat], candidate: candidateStats[stat], delta }];
      });

      return {
        slot: slot.id,
        slotLabel: slot.label,
        equippedItem,
        statDeltas,
      };
    });
}
