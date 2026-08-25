import { MONSTER_PACK_RULES } from "./config/monster-packs";
import { MONSTER_ARCHETYPES, type MonsterArchetypeId } from "./config/monsters";
import { MAX_CHARACTER_LEVEL, XP_BY_LEVEL } from "./config/progression";
import { ACTIVE_SKILLS } from "./config/skills";
import type { SkillDefinition } from "./config/schema";
import { LAUNCH_SKILL_IDS, type ActiveSkillId, type AttributeKey, type CharacterProgress, type MonsterRarity, type PlayerProfile } from "./domain";

export const ATTRIBUTE_POINTS_PER_LEVEL = 5;

export interface ExperienceGrant {
  profile: PlayerProfile;
  levelsGained: number;
}

export interface CharacterExperienceGrant {
  character: CharacterProgress;
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
  const grant = grantCharacterProgressExperience(profile.character, amount);
  if (grant.character === profile.character) return { profile, levelsGained: 0 };
  return {
    levelsGained: grant.levelsGained,
    profile: { ...profile, character: grant.character },
  };
}

/** Applies an XP grant without requiring or mutating the rest of a profile. */
export function grantCharacterProgressExperience(character: CharacterProgress, amount: number): CharacterExperienceGrant {
  if (!Number.isFinite(amount) || amount <= 0 || character.level >= MAX_CHARACTER_LEVEL) {
    return { character, levelsGained: 0 };
  }
  let level = character.level;
  let xp = character.xp + Math.floor(amount);
  let levelsGained = 0;
  while (level < MAX_CHARACTER_LEVEL && xp >= XP_BY_LEVEL(level)) {
    xp -= XP_BY_LEVEL(level);
    level += 1;
    levelsGained += 1;
  }
  if (level === MAX_CHARACTER_LEVEL) xp = 0;
  return {
    levelsGained,
    character: {
      ...character,
      level,
      xp,
      unspentAttributePoints: character.unspentAttributePoints + levelsGained * ATTRIBUTE_POINTS_PER_LEVEL,
      unspentSkillPoints: character.unspentSkillPoints + levelsGained,
    },
  };
}

/**
 * Restores the full SkillLevels shape for profiles persisted before newer
 * skills existed: known keys clamp into their configured range, missing keys
 * default to 1 only for the original launch skills and stay locked at 0 for
 * skills introduced later.
 */
export function normalizeSkillLevels(value: unknown): Record<ActiveSkillId, number> {
  const stored = (value ?? {}) as Partial<Record<ActiveSkillId, unknown>>;
  const normalized = {} as Record<ActiveSkillId, number>;
  for (const [skillId, definition] of Object.entries(ACTIVE_SKILLS) as [ActiveSkillId, (typeof ACTIVE_SKILLS)[ActiveSkillId]][]) {
    const maximum = definition.progression.maxLevel;
    const raw = Number(stored[skillId]);
    if (!Number.isFinite(raw) || raw <= 0) {
      normalized[skillId] = (LAUNCH_SKILL_IDS as readonly string[]).includes(skillId) ? 1 : 0;
      continue;
    }
    normalized[skillId] = Math.min(maximum, Math.floor(raw));
  }
  return normalized;
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
  const definition = ACTIVE_SKILLS[skillId];
  const requirements = (definition.tree as SkillDefinition["tree"]).requires ?? [];
  const requirementsMet = requirements.every((requirement) => (
    profile.character.skillLevels[requirement.skill] >= requirement.level
  ));
  const maximum = definition.progression.maxLevel;
  if (!requirementsMet || profile.character.unspentSkillPoints <= 0 || profile.character.skillLevels[skillId] >= maximum) return profile;
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
