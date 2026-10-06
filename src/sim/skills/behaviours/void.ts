// Void (and physical) skill behaviours (data for the executor).
import type { SkillBehaviour } from '../types';

export const VOID_BEHAVIOURS = {
  riftStep: {
    emitter: 'dash', distance: 100,
    cleanse: { skill: 'cleanse', player: 'riftCleanse' }, chillLanding: { skill: 'chillLanding', player: 'riftChill' },
  },
} satisfies Record<string, SkillBehaviour>;
