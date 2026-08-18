import { MONSTER_PACK_RULES } from "./config/monster-packs";
import { MONSTER_ARCHETYPES, type MonsterArchetypeId } from "./config/monsters";
import { MAX_CHARACTER_LEVEL, XP_BY_LEVEL } from "./config/progression";
import { ACTIVE_SKILLS } from "./config/skills";
import type { ActiveSkillId, AttributeKey, MonsterRarity, PlayerProfile } from "./domain";

export const ATTRIBUTE_POINTS_PER_LEVEL = 5;

export interface ExperienceGrant {
  profile: PlayerProfile;
  levelsGained: number;
}

export function monsterExperienceReward(archetypeId: MonsterArchetypeId, wave: number, tier: number, rarity: MonsterRarity): number {
  const definition = MONSTER_ARCHETYPES[archetypeId].experience;
  const base = definition.base
    + definition.perWave * Math.max(0, wave - 1)
    + definition.perTier * Math.max(0, tier - 1);
  return Math.max(1, Math.round(base * MONSTER_PACK_RULES.rarityExperienceMultiplier[rarity]));
}

export function grantCharacterExperience(profile: PlayerProfile, amount: number): ExperienceGrant {
  if (!Number.isFinite(amount) || amount <= 0 || profile.character.level >= MAX_CHARACTER_LEVEL) {
    return { profile, levelsGained: 0 };
  }
  let level = profile.character.level;
  let xp = profile.character.xp + Math.floor(amount);
  let levelsGained = 0;
  while (level < MAX_CHARACTER_LEVEL && xp >= XP_BY_LEVEL(level)) {
    xp -= XP_BY_LEVEL(level);
    level += 1;
    levelsGained += 1;
  }
  if (level === MAX_CHARACTER_LEVEL) xp = 0;
  return {
    levelsGained,
    profile: {
      ...profile,
      character: {
        ...profile.character,
        level,
        xp,
        unspentAttributePoints: profile.character.unspentAttributePoints + levelsGained * ATTRIBUTE_POINTS_PER_LEVEL,
        unspentSkillPoints: profile.character.unspentSkillPoints + levelsGained,
      },
    },
  };
}

export function allocateAttributePoint(profile: PlayerProfile, attribute: AttributeKey): PlayerProfile {
  if (profile.character.unspentAttributePoints <= 0) return profile;
  return {
    ...profile,
    character: {
      ...profile.character,
      unspentAttributePoints: profile.character.unspentAttributePoints - 1,
      allocatedAttributes: {
        ...profile.character.allocatedAttributes,
        [attribute]: profile.character.allocatedAttributes[attribute] + 1,
      },
    },
  };
}

export function allocateSkillPoint(profile: PlayerProfile, skillId: ActiveSkillId): PlayerProfile {
  const maximum = ACTIVE_SKILLS[skillId].progression.maxLevel;
  if (profile.character.unspentSkillPoints <= 0 || profile.character.skillLevels[skillId] >= maximum) return profile;
  return {
    ...profile,
    character: {
      ...profile.character,
      unspentSkillPoints: profile.character.unspentSkillPoints - 1,
      skillLevels: {
        ...profile.character.skillLevels,
        [skillId]: profile.character.skillLevels[skillId] + 1,
      },
    },
  };
}
