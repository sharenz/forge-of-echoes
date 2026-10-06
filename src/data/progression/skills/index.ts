// The Sorceress skill roster (GAME_SPEC §4, docs/power-rework/skills.md). One file per element so the roster lanes do not
// collide; this index assembles SKILLS in SKILL_IDS order and checks the roster is complete.
import type { SkillId } from '../../../contracts/content';
import { SKILL_IDS } from '../../../contracts/content';
import type { SkillDef } from '../types';
import { COLD_SKILLS } from './cold';
import { FIRE_SKILLS } from './fire';
import { LIGHTNING_SKILLS } from './lightning';
import { UTILITY_SKILLS } from './utility';
import { VOID_SKILLS } from './void';

export {
  AUGMENT_RULES, DAMAGE_ROLL, EXTRA_PROJECTILE_FAN, MAX_SKILL_RANK, RESPEC, SKILL_POINTS, augmentAvailable, augmentInfo,
} from './define';

const ALL: Record<string, SkillDef> = { ...FIRE_SKILLS, ...COLD_SKILLS, ...LIGHTNING_SKILLS, ...VOID_SKILLS, ...UTILITY_SKILLS };

export const SKILLS: Record<SkillId, SkillDef> = Object.fromEntries(
  SKILL_IDS.map((id) => {
    const def = ALL[id];
    if (!def || def.id !== id) throw new Error(`skill data: ${id} is missing or misfiled`);
    return [id, def];
  }),
) as Record<SkillId, SkillDef>;
if (Object.keys(ALL).length !== SKILL_IDS.length) throw new Error('skill data: an element file declares a skill that is not in SKILL_IDS');
