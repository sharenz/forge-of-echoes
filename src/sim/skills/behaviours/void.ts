// Void (and physical) skill behaviours (data for the executor).
import { SKILL_TIMING } from '../../../data/progression/skill-timing';
import type { SkillBehaviour } from '../types';

export const VOID_BEHAVIOURS = {
  riftStep: {
    emitter: 'dash', distance: 100,
    cleanse: { skill: 'cleanse', player: 'riftCleanse' }, chillLanding: { skill: 'chillLanding', player: 'riftChill' },
  },
  // Decay rides the def's `decay` primitive; the bolt is slow and heavy.
  umbralBolt: { emitter: 'projectile', kind: 'umbralBolt', speed: 200, range: 300, radius: { fallback: 7 }, spread: 'extra', pierce: 'def' },
  // Physical; knocks back twice as far (Ricochet arrives as a `bounce` primitive).
  kineticLance: {
    emitter: 'projectile', kind: 'kineticLance', speed: 520, range: 360, radius: { fallback: 4 }, spread: 'extra', pierce: 'def',
    knock: SKILL_TIMING.kineticKnockback,
  },
} satisfies Record<string, SkillBehaviour>;
