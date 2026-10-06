// Lightning skill behaviours (data for the executor).
import { ARC_JUMP_RANGE } from '../../constants';
import type { SkillBehaviour } from '../types';

export const LIGHTNING_BEHAVIOURS = {
  arcChain: { emitter: 'chain', jump: ARC_JUMP_RANGE, revisit: { skill: 'revisit', player: 'arcReturns' } },
} satisfies Record<string, SkillBehaviour>;
