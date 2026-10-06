// Cold skill augments (docs/power-rework/skills.md 5.5). Tiers T1 (rank 2), T2 (rank 5), T3 (rank 8, 2 points).
import type { SkillId } from '../../../contracts/content';
import type { AugmentDef } from '../types';

export const COLD_AUGMENTS: Partial<Record<SkillId, AugmentDef[]>> = {
  rimeShards: [
    {
      id: 'brittleShards', name: 'Brittle Shards', tier: 1, text: 'Hits expose Cold −12 pp for 4 seconds (half on bosses)',
      effects: [{ k: 'planned', primitive: 'expose' }],
    },
    {
      id: 'hoarfrostSpread', name: 'Hoarfrost Spread', tier: 1, text: '2 more shards in a 50% wider fan, each 15% less damage',
      effects: [{ k: 'count', add: 2 }, { k: 'scale', stat: 'spread', pct: 50 }, { k: 'more', pct: -15 }],
    },
    {
      id: 'splintering', name: 'Splintering', tier: 2,
      text: 'At the end of its flight (range or wall) a shard bursts into 3 splinters dealing 40% damage (range 90)', excludes: ['lodgedIce'],
      effects: [{ k: 'planned', primitive: 'split' }],
    },
    {
      id: 'lodgedIce', name: 'Lodged Ice', tier: 2,
      text: 'Shards stick in the first enemy hit; 3 lodged shards (or 1 second) detonate for 150% each in a radius of 40', excludes: ['splintering'],
      effects: [{ k: 'planned', primitive: 'lodge' }],
    },
    {
      id: 'invertedHeat', name: 'Inverted Heat', tier: 3, text: '60% of Cold damage is converted to Fire; hits ignite instead of chilling',
      effects: [{ k: 'planned', primitive: 'convert' }],
    },
    {
      id: 'glacialEcho', name: 'Glacial Echo', tier: 3, text: 'Repeats after 0.4 seconds at 60% damage, at no Focus cost', grantedBy: 'rimeEcho',
      effects: [{ k: 'echo', delay: 0.4, damage: 60 }],
    },
  ],
};
