// Utility skill augments (docs/power-rework/skills.md 6). Tiers T1 (rank 2), T2 (rank 5), T3 (rank 8, 2 points).
import type { SkillId } from '../../../contracts/content';
import type { AugmentDef } from '../types';

export const UTILITY_AUGMENTS: Partial<Record<SkillId, AugmentDef[]>> = {
  phaseStride: [
    {
      id: 'longStride', name: 'Long Stride', tier: 1, text: 'Lasts 2 seconds longer',
      effects: [{ k: 'add', stat: 'duration', value: 2 }],
    },
    {
      id: 'slipstream', name: 'Slipstream', tier: 2, text: '+15% chance to evade hits while it lasts',
      effects: [{ k: 'tune', key: 'strideEvasion', add: 0.15 }],
    },
    {
      id: 'cleansingStride', name: 'Cleansing Stride', tier: 3, text: 'Casting it removes chill and root',
      effects: [{ k: 'flag', flag: 'cleanse' }],
    },
  ],
  arcaneReprieve: [
    {
      id: 'deepWell', name: 'Deep Well', tier: 1, text: 'Restores 45% of maximum Focus instead of 30%; cooldown +8 seconds',
      effects: [{ k: 'tune', key: 'restoreFocus', add: 0.15 }, { k: 'add', stat: 'cooldown', value: 8 }],
    },
    {
      id: 'secondWind', name: 'Second Wind', tier: 2, text: 'Also restores 15% of maximum life over its duration',
      effects: [{ k: 'tune', key: 'restoreLife', add: 0.15 }],
    },
    {
      id: 'chargedReprieve', name: 'Charged Reprieve', tier: 3, text: 'Your next 3 skill casts cost 25% less Focus',
      effects: [{ k: 'planned', primitive: 'refund', note: 'cheaper casts' }],
    },
  ],
  // Roster batch 2 (SK3), skills.md 6
  echoSigil: [
    {
      id: 'tripleEcho', name: 'Triple Echo', tier: 1, text: '4 casts echo instead of 3; echoes deal 10% less (63% of the hit)',
      effects: [{ k: 'tune', key: 'echoCasts', add: 1 }, { k: 'tune', key: 'echoDamage', add: -0.07 }],
    },
    {
      id: 'quickEcho', name: 'Quick Echo', tier: 2, text: 'Echoes follow after 0.25 seconds instead of 0.4',
      effects: [{ k: 'tune', key: 'echoDelay', add: -0.15 }],
    },
    {
      id: 'costless', name: 'Costless', tier: 3, text: 'Each echoed skill refunds 25% of its Focus cost',
      effects: [{ k: 'tune', key: 'echoRefund', add: 0.25 }],
    },
  ],
};
