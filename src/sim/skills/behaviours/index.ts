// Every skill the sim can execute, by id. A skill without an entry (a roster skill whose behaviour has not shipped) does nothing
// when released; the rules never let one be learned (SkillDef.available), so only a hand-built runtime def can reach that.
import type { SkillId } from '../../../contracts/content';
import type { SkillBehaviour } from '../types';
import { COLD_BEHAVIOURS } from './cold';
import { FIRE_BEHAVIOURS } from './fire';
import { LIGHTNING_BEHAVIOURS } from './lightning';
import { VOID_BEHAVIOURS } from './void';

export const SKILL_BEHAVIOURS: Readonly<Partial<Record<SkillId, SkillBehaviour>>> = {
  ...FIRE_BEHAVIOURS, ...COLD_BEHAVIOURS, ...LIGHTNING_BEHAVIOURS, ...VOID_BEHAVIOURS,
};
