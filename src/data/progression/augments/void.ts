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
  umbralBolt: [
    {
      id: 'witheringTouch', name: 'Withering Touch', tier: 1, text: 'Decay is 50% stronger',
      effects: [{ k: 'tune', key: 'decayPct', add: 50 }],
    },
    {
      id: 'hollowShell', name: 'Hollow Shell', tier: 1, text: 'Pierces every enemy; hits after the first deal 25% less damage',
      excludes: ['soulbindLodge', 'gravitySeed'], effects: [{ k: 'planned', primitive: 'rehit', note: 'pierce falloff' }],
    },
    {
      id: 'gravitySeed', name: 'Gravity Seed', tier: 2,
      text: 'Stops at its range or the first wall and collapses: pulls enemies within 60 units in, then bursts for 100%',
      excludes: ['hollowShell'], effects: [{ k: 'planned', primitive: 'pull' }],
    },
    {
      id: 'entropicSplit', name: 'Entropic Split', tier: 2, text: 'On hit splits into 2 bolts at ±25°, each dealing 60% damage',
      excludes: ['soulbindLodge'], effects: [{ k: 'planned', primitive: 'split' }],
    },
    {
      id: 'voidExposure', name: 'Void Exposure', tier: 3, text: 'Hits expose Void −20 pp and every element −8 pp for 4 seconds; 15% less damage',
      effects: [{ k: 'planned', primitive: 'expose' }],
    },
    {
      id: 'soulbindLodge', name: 'Soulbind Lodge', tier: 3,
      text: 'The bolt lodges for 2 seconds and detonates on the timer or the death of its host for 300% in a radius of 70',
      excludes: ['hollowShell', 'entropicSplit'], effects: [{ k: 'planned', primitive: 'lodge' }],
    },
  ],
  kineticLance: [
    {
      id: 'ricochet', name: 'Ricochet', tier: 1, text: 'Rebounds off walls up to twice; 20% less damage',
      effects: [{ k: 'tune', key: 'bounces', add: 2 }, { k: 'more', pct: -20 }],
    },
    {
      id: 'heavyImpact', name: 'Heavy Impact', tier: 1, text: 'Knockback ×3; an enemy pushed into a prop or wall takes 40% of the hit',
      effects: [{ k: 'planned', primitive: 'knockback' }],
    },
    {
      id: 'shatterRounds', name: 'Shatter Rounds', tier: 2,
      text: 'Kills explode for 12% of the dead enemy’s maximum life as physical damage in a radius of 40 (at most 3 deep)',
      effects: [{ k: 'planned', primitive: 'onKill' }],
    },
    {
      id: 'armourPiercing', name: 'Armour Piercing', tier: 2, text: 'Ignores the hit reduction of armoured enemies; +10 physical penetration',
      effects: [{ k: 'planned', primitive: 'cap', note: 'armour piercing' }],
    },
    {
      id: 'voidConvert', name: 'Void Convert', tier: 3, text: '50% of Physical damage is converted to Void; hits apply Decay',
      effects: [{ k: 'planned', primitive: 'convert' }],
    },
    {
      id: 'pinning', name: 'Pinning', tier: 3, text: 'Hits slow by 25% for 2 seconds and make the target take 10% more damage',
      effects: [{ k: 'planned', primitive: 'mark' }],
    },
  ],
};
