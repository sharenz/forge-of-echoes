// Utility skill behaviours (data for the executor): the timed self-buffs.
import type { SkillBehaviour } from '../types';

export const UTILITY_BEHAVIOURS = {
  phaseStride: { emitter: 'buff', buff: 'stride', duration: 3, cleanse: { skill: 'cleanse', player: 'strideCleanse' } },
  arcaneReprieve: { emitter: 'buff', buff: 'restore', duration: 3 },
  // Roster batch 2 (SK3)
  echoSigil: { emitter: 'buff', buff: 'echoSigil', duration: 12 },
} satisfies Record<string, SkillBehaviour>;
