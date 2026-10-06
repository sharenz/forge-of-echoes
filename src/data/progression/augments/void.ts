// Void (and physical) skill augments (docs/power-rework/skills.md 5.11). Tiers T1 (rank 2), T2 (rank 5), T3 (rank 8, 2 points).
import type { SkillId } from '../../../contracts/content';
import type { AugmentDef } from '../types';

export const VOID_AUGMENTS: Partial<Record<SkillId, AugmentDef[]>> = {
  riftStep: [
    {
      id: 'afterimage', name: 'Afterimage', tier: 1, text: 'Leaves an afterimage for 1.5 seconds that explodes for 1.2× effectiveness as void in a radius of 50',
      effects: [{ k: 'planned', primitive: 'summon' }],
    },
    {
      id: 'longerStride', name: 'Longer Stride', tier: 1, text: '30% longer blinks and 0.3 seconds of invulnerability; costs 2 more Focus',
      effects: [{ k: 'scale', stat: 'distance', pct: 30 }, { k: 'invulnerable', seconds: 0.3 }, { k: 'add', stat: 'focusCost', value: 2 }],
    },
    {
      id: 'chillingLanding', name: 'Chilling Landing', tier: 2, text: 'Chills enemies within 100 units of the landing for 2 seconds', grantedBy: 'riftChill',
      effects: [{ k: 'flag', flag: 'chillLanding' }],
    },
    {
      id: 'riftEcho', name: 'Rift Echo', tier: 2, text: '1 more charge; a third blink within 4 seconds costs no Focus',
      effects: [{ k: 'add', stat: 'charges', value: 1 }, { k: 'planned', primitive: 'refund', note: 'free third blink' }],
    },
    {
      id: 'staticArrival', name: 'Static Arrival', tier: 3, text: 'A lightning nova at the landing (2× effectiveness, radius 80) shocks; cooldown +0.5 seconds',
      effects: [{ k: 'planned', primitive: 'shape', note: 'landing nova' }],
    },
    {
      id: 'phaseWeave', name: 'Phase Weave', tier: 3, text: 'After landing: 25% more movement speed for 2 seconds, no crowd slow, chill and root removed',
      effects: [{ k: 'planned', primitive: 'summon', note: 'landing buff' }],
    },
  ],
};
