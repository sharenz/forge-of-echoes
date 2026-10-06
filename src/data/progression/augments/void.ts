// Void (and physical) skill augments (docs/power-rework/skills.md 5.11). Tiers T1 (rank 2), T2 (rank 5), T3 (rank 8, 2 points).
import type { SkillId } from '../../../contracts/content';
import type { AugmentDef } from '../types';

export const VOID_AUGMENTS: Partial<Record<SkillId, AugmentDef[]>> = {
  riftStep: [
    {
      id: 'afterimage', name: 'Afterimage', tier: 1, text: 'Leaves an afterimage for 1.5 seconds that explodes for 1.2× effectiveness as void in a radius of 50',
      effects: [{ k: 'blast', at: 'origin', delay: 1.5, effectiveness: 1.2, radius: 50, damageType: 'void', ailment: 0 }],
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
      effects: [{ k: 'add', stat: 'charges', value: 1 }, { k: 'rt', rt: { p: 'freeCast', nth: 3, window: 4 } }],
    },
    {
      id: 'staticArrival', name: 'Static Arrival', tier: 3, text: 'A lightning nova at the landing (2× effectiveness, radius 80) shocks; cooldown +0.5 seconds',
      effects: [
        { k: 'blast', at: 'landing', delay: 0, effectiveness: 2, radius: 80, damageType: 'lightning', ailment: 1 }, { k: 'add', stat: 'cooldown', value: 0.5 },
      ],
    },
    {
      id: 'phaseWeave', name: 'Phase Weave', tier: 3, text: 'After landing: 25% more movement speed for 2 seconds, no crowd slow, chill and root removed',
      effects: [{ k: 'rt', rt: { p: 'weave', seconds: 2, speed: 0.25 } }],
    },
  ],
  umbralBolt: [
    {
      id: 'witheringTouch', name: 'Withering Touch', tier: 1, text: 'Decay is 50% stronger',
      effects: [{ k: 'tune', key: 'decayPct', add: 50 }],
    },
    {
      id: 'hollowShell', name: 'Hollow Shell', tier: 1, text: 'Pierces every enemy; hits after the first deal 25% less damage',
      excludes: ['soulbindLodge', 'gravitySeed'], effects: [{ k: 'flag', flag: 'pierceAll' }, { k: 'rt', rt: { p: 'falloff', share: 0.75 } }],
    },
    {
      id: 'gravitySeed', name: 'Gravity Seed', tier: 2,
      text: 'Stops at its range or the first wall and collapses: pulls enemies within 60 units in, then bursts for 100%',
      excludes: ['hollowShell'], effects: [{ k: 'planned', primitive: 'pull' }],
    },
    {
      id: 'entropicSplit', name: 'Entropic Split', tier: 2, text: 'On hit splits into 2 bolts at ±25°, each dealing 60% damage',
      excludes: ['soulbindLodge'],
      effects: [{ k: 'rt', rt: { p: 'split', on: 'hit', count: 2, share: 0.6, range: 150, arc: (50 * Math.PI) / 180, seek: 0 } }],
    },
    {
      id: 'voidExposure', name: 'Void Exposure', tier: 3,
      text: 'Hits expose Void −20 pp and Fire, Cold and Lightning −8 pp for 4 seconds (half on bosses); 15% less damage',
      effects: [{ k: 'rt', rt: { p: 'expose', points: [0, 8, 8, 8, 20] } }, { k: 'more', pct: -15 }],
    },
    {
      id: 'soulbindLodge', name: 'Soulbind Lodge', tier: 3,
      text: 'The bolt lodges for 2 seconds and detonates on the timer or the death of its host for 300% in a radius of 70; at most 8 lodged',
      excludes: ['hollowShell', 'entropicSplit'], effects: [{ k: 'rt', rt: { p: 'lodge', share: 3, radius: 70, fuse: 2, burst: 0, max: 8 } }],
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
      effects: [{ k: 'rt', rt: { p: 'onKill', of: 'life', share: 0.12, radius: 40, damageType: 'physical', needs: 'any', depth: 3 } }],
    },
    {
      id: 'armourPiercing', name: 'Armour Piercing', tier: 2, text: 'Ignores the hit reduction of armoured enemies; +10 physical penetration',
      effects: [{ k: 'planned', primitive: 'cap', note: 'armour piercing' }],
    },
    {
      id: 'voidConvert', name: 'Void Convert', tier: 3,
      text: '50% of Physical damage is converted to Void; hits apply Decay (40% of the hit as Void over 4 seconds, up to 5 stacks)',
      effects: [{ k: 'convert', to: 'void', pct: 50, ailment: 'decay', decay: 0.4 }],
    },
    {
      id: 'pinning', name: 'Pinning', tier: 3,
      text: 'Hits pin the target for 2 seconds: it is chilled (30% slower) and takes 10% more damage',
      effects: [{ k: 'rt', rt: { p: 'mark', seconds: 2, taken: 0.1, shock: 0, chill: true, first: false } }],
    },
  ],
  // Roster batch 2 (SK3), skills.md 5.13 and 6
  gravityWell: [
    {
      id: 'heavyWell', name: 'Heavy Well', tier: 1, text: 'Lasts 40% longer; the pull is 20% weaker',
      effects: [{ k: 'scale', stat: 'duration', pct: 40 }, { k: 'tune', key: 'zonePullPct', add: -20 }],
    },
    {
      id: 'crushing', name: 'Crushing', tier: 2, text: 'Enemies inside take 20% more damage',
      effects: [{ k: 'tune', key: 'zoneTaken', add: 0.2 }],
    },
    {
      id: 'singularity', name: 'Singularity', tier: 3, text: 'Collapses at the end for 3× effectiveness as void damage in a radius of 90',
      effects: [{ k: 'tune', key: 'zoneCollapse', add: 3 }],
    },
  ],
  entropyHex: [
    {
      id: 'linger', name: 'Linger', tier: 1, text: 'Lasts 9 seconds instead of 6',
      effects: [{ k: 'add', stat: 'duration', value: 3 }],
    },
    {
      id: 'wideHex', name: 'Wide Hex', tier: 1, text: 'Radius ×1.5',
      effects: [{ k: 'scale', stat: 'radius', pct: 50 }],
    },
    {
      id: 'witherSpread', name: 'Wither Spread', tier: 2,
      text: 'When a Hexed enemy dies the Hex jumps to the nearest enemy within 120 units for its remaining duration',
      effects: [{ k: 'planned', primitive: 'onKill', note: 'hex jumps' }],
    },
    {
      id: 'sharedPain', name: 'Shared Pain', tier: 2, text: 'Hexed enemies share 20% of the damage they take with other Hexed enemies within 90 units',
      effects: [{ k: 'planned', primitive: 'mark', note: 'shared damage' }],
    },
    {
      id: 'absoluteExposure', name: 'Absolute Exposure', tier: 3, text: 'Exposure 25 points instead of 15 (bosses 12.5); cooldown +3 seconds',
      excludes: ['bleakMark'], effects: [{ k: 'tune', key: 'hexExposure', add: 10 }, { k: 'add', stat: 'cooldown', value: 3 }],
    },
    {
      id: 'bleakMark', name: 'Bleak Mark', tier: 3, text: 'Hexed enemies deal 25% less damage and move 20% slower',
      excludes: ['absoluteExposure'], effects: [{ k: 'tune', key: 'hexWeaken', add: 0.15 }, { k: 'tune', key: 'zoneSlow', add: 0.2 }],
    },
  ],
  witherField: [
    {
      id: 'hollowGround', name: 'Hollow Ground', tier: 1, text: 'Radius +40%',
      effects: [{ k: 'scale', stat: 'radius', pct: 40 }],
    },
    {
      id: 'rottingFields', name: 'Rotting Fields', tier: 2, text: 'Its ticks deal 40% more damage',
      effects: [{ k: 'more', pct: 40 }],
    },
    {
      id: 'lingeringWither', name: 'Lingering Wither', tier: 3, text: 'Withered lasts 3 seconds after an enemy leaves the field',
      effects: [{ k: 'tune', key: 'witherLinger', add: 2 }],
    },
  ],
  concussiveBlast: [
    {
      id: 'widenedArc', name: 'Widened Arc', tier: 1, text: 'A 160° cone; 20% less damage',
      effects: [{ k: 'set', stat: 'spread', value: (160 * Math.PI) / 180 }, { k: 'more', pct: -20 }],
    },
    {
      id: 'crushingForce', name: 'Crushing Force', tier: 2, text: 'Knockback ×2; an enemy driven into a wall takes 50% more from the impact',
      effects: [{ k: 'planned', primitive: 'knockback' }],
    },
    {
      id: 'shatter', name: 'Shatter', tier: 3,
      text: 'Kills explode for 10% of the dead enemy’s maximum life as physical damage in a radius of 40',
      effects: [{ k: 'rt', rt: { p: 'onKill', of: 'life', share: 0.1, radius: 40, damageType: 'physical', needs: 'any', depth: 1 } }],
    },
  ],
  // Roster batch 3 (SK4), skills.md 6
  eventHorizon: [
    {
      id: 'heavyCollapse', name: 'Heavy Collapse', tier: 1, text: 'Pulls 50% harder; the detonation deals 30% more damage',
      effects: [{ k: 'flag', flag: 'heavyCollapse' }, { k: 'more', pct: 30 }],
    },
    {
      id: 'echoCollapse', name: 'Echo Collapse', tier: 2, text: 'A second detonation follows 0.6 seconds later at 50% damage',
      effects: [{ k: 'flag', flag: 'echoCollapse' }],
    },
    {
      id: 'voidFeast', name: 'Void Feast', tier: 3, text: 'Each enemy that dies while it pulls refunds 3 Focus',
      effects: [{ k: 'flag', flag: 'voidFeast' }],
    },
  ],
};
