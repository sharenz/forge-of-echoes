// Lightning skill augments (docs/power-rework/skills.md 5.7). Tiers T1 (rank 2), T2 (rank 5), T3 (rank 8, 2 points).
import type { SkillId } from '../../../contracts/content';
import type { AugmentDef } from '../types';

export const LIGHTNING_AUGMENTS: Partial<Record<SkillId, AugmentDef[]>> = {
  arcChain: [
    {
      id: 'forkingArc', name: 'Forking Arc', tier: 1, text: 'At the last link the bolt forks into 2 branches of 3 links at 50% damage',
      excludes: ['longReach', 'overcharge'], effects: [{ k: 'planned', primitive: 'fork' }],
    },
    {
      id: 'longReach', name: 'Long Reach', tier: 1, text: '50% longer jumps and 2 more chains, 10% less damage', excludes: ['forkingArc'],
      effects: [{ k: 'scale', stat: 'radius', pct: 50 }, { k: 'chain', add: 2 }, { k: 'more', pct: -10 }],
    },
    {
      id: 'conductiveMark', name: 'Conductive Mark', tier: 2, text: 'The first target is marked for 3 seconds: it takes 15% more damage and +30% shock chance',
      effects: [{ k: 'planned', primitive: 'mark' }],
    },
    {
      id: 'overcharge', name: 'Overcharge', tier: 2, text: 'Each jump deals 12% more than the last, starting 20% lower', excludes: ['forkingArc'],
      effects: [{ k: 'planned', primitive: 'mark', note: 'ramping jumps' }],
    },
    {
      id: 'stormReturn', name: 'Storm Return', tier: 3, text: 'The final link returns to the first target for a second hit at 80%',
      effects: [{ k: 'planned', primitive: 'return' }],
    },
    {
      id: 'staticDischarge', name: 'Static Discharge', tier: 3, text: 'Enemies killed while Shocked explode for 150% of the hit as lightning in a radius of 60',
      effects: [{ k: 'planned', primitive: 'onKill' }],
    },
  ],
};
