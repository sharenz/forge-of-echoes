// Cold skill augments (docs/power-rework/skills.md 5.5, 5.6 and 6). Tiers T1 (rank 2), T2 (rank 5), T3 (rank 8, 2 points).
import type { SkillId } from '../../../contracts/content';
import type { AugmentDef } from '../types';

export const COLD_AUGMENTS: Partial<Record<SkillId, AugmentDef[]>> = {
  rimeShards: [
    {
      id: 'brittleShards', name: 'Brittle Shards', tier: 1, text: 'Hits expose Cold −12 pp for 4 seconds (half on bosses)',
      effects: [{ k: 'rt', rt: { p: 'expose', points: [0, 0, 12, 0, 0] } }],
    },
    {
      id: 'hoarfrostSpread', name: 'Hoarfrost Spread', tier: 1, text: '2 more shards in a 50% wider fan, each 15% less damage',
      effects: [{ k: 'count', add: 2 }, { k: 'scale', stat: 'spread', pct: 50 }, { k: 'more', pct: -15 }],
    },
    {
      id: 'splintering', name: 'Splintering', tier: 2,
      text: 'At the end of its flight (range or wall) a shard bursts into 3 splinters dealing 40% damage (range 90)', excludes: ['lodgedIce'],
      effects: [{ k: 'rt', rt: { p: 'split', on: 'end', count: 3, share: 0.4, range: 90, arc: 0, seek: 0 } }],
    },
    {
      id: 'lodgedIce', name: 'Lodged Ice', tier: 2,
      text: 'Shards stick in the first enemy hit; 3 lodged shards (or 1 second) detonate for 150% each in a radius of 40; at most 8 lodged',
      excludes: ['splintering'],
      effects: [{ k: 'rt', rt: { p: 'lodge', share: 1.5, radius: 40, fuse: 1, burst: 3, max: 8 } }],
    },
    {
      id: 'invertedHeat', name: 'Inverted Heat', tier: 3, text: '60% of Cold damage is converted to Fire; hits ignite instead of chilling',
      effects: [{ k: 'convert', to: 'fire', pct: 60, ailment: 'instead' }],
    },
    {
      id: 'glacialEcho', name: 'Glacial Echo', tier: 3, text: 'Repeats after 0.4 seconds at 60% damage, at no Focus cost', grantedBy: 'rimeEcho',
      effects: [{ k: 'echo', delay: 0.4, damage: 60 }],
    },
  ],
  glacialNova: [
    {
      id: 'wideChill', name: 'Wide Chill', tier: 1, text: '40% larger radius, 10% less damage',
      effects: [{ k: 'scale', stat: 'radius', pct: 40 }, { k: 'more', pct: -10 }],
    },
    {
      id: 'freezingCore', name: 'Freezing Core', tier: 2, text: 'Enemies within 40 units of you take 60% more damage from it',
      effects: [{ k: 'rt', rt: { p: 'core', radius: 40, more: 0.6 } }],
    },
    {
      id: 'shatter', name: 'Shatter', tier: 3, text: 'Chilled enemies it kills explode for 10% of their life as cold in a radius of 40',
      effects: [{ k: 'rt', rt: { p: 'onKill', of: 'life', share: 0.1, radius: 40, damageType: 'cold', needs: 'chilled', depth: 1 } }],
    },
  ],
  frostOrb: [
    {
      id: 'heavyChill', name: 'Heavy Chill', tier: 1, text: 'Shards always chill, and their chill slows by 40% instead of 30%',
      effects: [{ k: 'planned', primitive: 'ailment', note: 'chill effect' }],
    },
    {
      id: 'orbit', name: 'Orbit', tier: 1, text: 'The orb circles you at 60 units for 5 seconds', excludes: ['frozenHeart'],
      effects: [{ k: 'planned', primitive: 'summon', note: 'orbit' }],
    },
    {
      id: 'twinOrbs', name: 'Twin Orbs', tier: 2, text: 'Two orbs, each shard dealing 35% less damage',
      effects: [{ k: 'count', add: 1 }, { k: 'more', pct: -35 }],
    },
    {
      id: 'shatter', name: 'Shatter', tier: 2, text: 'When it expires the orb bursts for 4× effectiveness as cold in a radius of 70',
      excludes: ['frozenHeart'],
      effects: [{ k: 'blast', at: 'orbEnd', delay: 0, effectiveness: 4, radius: 70, damageType: 'cold', ailment: 0 }],
    },
    {
      id: 'frozenHeart', name: 'Frozen Heart', tier: 3,
      text: 'Hovers at the cursor (up to 300 units away) for 7 seconds and fires twice as fast, 20% less damage',
      excludes: ['orbit', 'shatter'],
      effects: [{ k: 'set', stat: 'duration', value: 7 }, { k: 'rt', rt: { p: 'hover', rate: 2 } }, { k: 'more', pct: -20 }],
    },
    {
      id: 'staticFrost', name: 'Static Frost', tier: 3,
      text: '40% of Cold damage is converted to Lightning; shards chain once (to an enemy within 90 units) and shock instead of chilling',
      effects: [{ k: 'convert', to: 'lightning', pct: 40, ailment: 'instead' }, { k: 'rt', rt: { p: 'fork', branches: 1, links: 1, share: 1, jump: 90 } }],
    },
  ],
  glacialSpikes: [
    {
      id: 'twinLines', name: 'Twin Lines', tier: 1, text: 'Two lines 15° either side of the cursor, each spike dealing 30% less damage',
      effects: [{ k: 'flag', flag: 'twinLines' }, { k: 'more', pct: -30 }],
    },
    {
      id: 'frostComb', name: 'Frost Comb', tier: 2, text: 'Spikes leave chilling ground for 3 seconds',
      effects: [{
        k: 'trail', area: 'frostGround', at: 'strike', radius: 0, duration: 3, interval: 0.5, effectiveness: 0, ailment: true, expose: 0, spacing: 0,
      }],
    },
    {
      id: 'shatteringRows', name: 'Shattering Rows', tier: 3, text: 'The last spike of a row explodes for 2× effectiveness in a radius of 40',
      effects: [{ k: 'blast', at: 'rowEnd', delay: 0, effectiveness: 2, radius: 40, ailment: 0 }],
    },
  ],
  // Roster batch 2 (SK3), skills.md 6
  rimeBulwark: [
    {
      id: 'thickIce', name: 'Thick Ice', tier: 1, text: 'The barrier absorbs 30% more',
      effects: [{ k: 'tune', key: 'barrierPct', add: 30 }],
    },
    {
      id: 'brittleRetort', name: 'Brittle Retort', tier: 2, text: 'When the barrier breaks, a nova of ice deals 2× effectiveness as cold damage and chills',
      effects: [{ k: 'tune', key: 'barrierRetort', add: 2 }],
    },
    {
      id: 'resolute', name: 'Resolute', tier: 3, text: 'The barrier regenerates 3% of its size per second while you stand still',
      effects: [{ k: 'tune', key: 'barrierRegen', add: 0.03 }],
    },
  ],
  // Roster batch 3 (SK4), skills.md 6
  blizzard: [
    {
      id: 'brittleCold', name: 'Brittle Cold', tier: 1, text: 'Chilled enemies in the storm take 20% more cold damage (35% in all)',
      effects: [{ k: 'flag', flag: 'brittleCold' }],
    },
    {
      id: 'wideStorm', name: 'Wide Storm', tier: 2, text: 'Radius +40%',
      effects: [{ k: 'scale', stat: 'radius', pct: 40 }],
    },
    {
      id: 'frozenGround', name: 'Frozen Ground', tier: 3, text: 'Enemies in the storm are slowed by 50%',
      effects: [{ k: 'tune', key: 'zoneSlow', add: 0.5 }],
    },
  ],
};
