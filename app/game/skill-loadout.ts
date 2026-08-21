import type { PlayerProfile, SkillBarSkillId, SkillLoadout } from "./domain";

export const SKILL_BAR_SLOTS = [
  { index: 0, key: "Space", keyboardKey: "SPACE" },
  { index: 1, key: "Q", keyboardKey: "Q" },
  { index: 2, key: "E", keyboardKey: "E" },
  { index: 3, key: "R", keyboardKey: "R" },
  { index: 4, key: "F", keyboardKey: "F" },
] as const;

export const DEFAULT_SKILL_LOADOUT: SkillLoadout = ["basic", "nova", "dash", "ward", "flameWave"];

const SKILL_IDS = new Set<SkillBarSkillId>(["basic", "nova", "dash", "ward", "flameWave"]);

export function normalizeSkillLoadout(value: unknown): SkillLoadout {
  if (!Array.isArray(value) || value.length !== SKILL_BAR_SLOTS.length) return [...DEFAULT_SKILL_LOADOUT];
  return value.map((skill) => skill === null || SKILL_IDS.has(skill as SkillBarSkillId) ? skill : null) as SkillLoadout;
}

export function setSkillLoadoutSlot(
  profile: PlayerProfile,
  slot: number,
  skill: SkillBarSkillId | null,
): PlayerProfile {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SKILL_BAR_SLOTS.length) return profile;
  if (skill !== null && skill !== "basic" && profile.character.skillLevels[skill] < 1) return profile;
  if (profile.character.skillLoadout[slot] === skill) return profile;
  const skillLoadout = [...profile.character.skillLoadout] as SkillLoadout;
  skillLoadout[slot] = skill;
  return { ...profile, character: { ...profile.character, skillLoadout } };
}

export function isSkillEquipped(loadout: SkillLoadout, skill: SkillBarSkillId): boolean {
  return skill === "basic" || loadout.includes(skill);
}
