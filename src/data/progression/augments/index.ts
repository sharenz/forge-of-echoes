// Augment trees per skill (docs/power-rework/skills.md 4 to 6), split by element like the skills.
import type { SkillId } from '../../../contracts/content';
import type { AugmentDef } from '../types';
import { COLD_AUGMENTS } from './cold';
import { FIRE_AUGMENTS } from './fire';
import { LIGHTNING_AUGMENTS } from './lightning';
import { UTILITY_AUGMENTS } from './utility';
import { VOID_AUGMENTS } from './void';

export const AUGMENTS: Partial<Record<SkillId, readonly AugmentDef[]>> = {
  ...FIRE_AUGMENTS, ...COLD_AUGMENTS, ...LIGHTNING_AUGMENTS, ...VOID_AUGMENTS, ...UTILITY_AUGMENTS,
};
