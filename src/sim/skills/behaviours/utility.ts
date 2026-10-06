// Utility skill behaviours (data for the executor): the timed self-buffs.
import type { SkillBehaviour } from '../types';

export const UTILITY_BEHAVIOURS = {
  phaseStride: { emitter: 'buff', buff: 'stride', duration: 3, cleanse: { skill: 'cleanse', player: 'strideCleanse' } },
  arcaneReprieve: { emitter: 'buff', buff: 'restore', duration: 3 },
} satisfies Record<string, SkillBehaviour>;
