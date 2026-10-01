// Progression content tables + lookups: class, skills, maps, loot, merchant, save constants.
// Pure data; the rules live in src/game/progression.
import type { MapBaseId, SkillId } from '../../contracts/content';
import { ownEntry } from '../items';
import { MAP_BASES, CORRUPTED_MODS, DANGER_MODS, ECHO_MOD, REWARD_MODS } from './maps';
import { SKILLS } from './skills';
import type { MapBaseDef, MapModDef, SkillDef } from './types';

export * from './types';
export { SORCERESS, LEVEL_CAP, XP_BASE, XP_EXPONENT } from './classes';
export { DAMAGE_ROLL, EXTRA_PROJECTILE_FAN, MAX_SKILL_RANK, SKILLS } from './skills';
export * from './maps';
export * from './loot';
export * from './routing';
export * from './bestiary';
export * from './merchant';
export * from './save';

/** Every map mod (danger, reward, corrupted, echo) by id. */
const MAP_MOD_MAP = new Map<string, MapModDef>(
  [...DANGER_MODS, ...REWARD_MODS, ...CORRUPTED_MODS, ECHO_MOD].map((m) => [m.id, m]),
);

export function getMapMod(id: string): MapModDef | undefined {
  return MAP_MOD_MAP.get(id);
}

export function findMapBase(id: string): MapBaseDef | undefined {
  return ownEntry<MapBaseDef>(MAP_BASES, id);
}

export function getMapBase(id: MapBaseId): MapBaseDef {
  const b = ownEntry<MapBaseDef>(MAP_BASES, id);
  if (!b) throw new Error(`Unknown map base "${id}"`);
  return b;
}

export function findSkill(id: string): SkillDef | undefined {
  return ownEntry<SkillDef>(SKILLS, id);
}

export function getSkill(id: SkillId): SkillDef {
  const s = ownEntry<SkillDef>(SKILLS, id);
  if (!s) throw new Error(`Unknown skill "${id}"`);
  return s;
}
