// Lightning skill behaviours (data for the executor).
import { ARC_JUMP_RANGE } from '../../constants';
import { SKILL_TIMING } from '../../../data/progression/skill-timing';
import type { SkillBehaviour } from '../types';

export const LIGHTNING_BEHAVIOURS = {
  arcChain: { emitter: 'chain', jump: ARC_JUMP_RANGE, revisit: { skill: 'revisit', player: 'arcReturns' } },
  spark: {
    emitter: 'projectile', kind: 'spark', speed: 150, range: 300, radius: { fallback: 5 }, spread: 0.8, pierce: 'all',
    rehit: SKILL_TIMING.sparkRehit,
  },
  stormCall: {
    emitter: 'strikes', telegraph: SKILL_TIMING.stormTelegraph, scatter: 70, radius: 28, reach: 360,
    tethered: { skill: 'tethered', player: 'tethered' },
  },
} satisfies Record<string, SkillBehaviour>;
