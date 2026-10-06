// Fire skill augments (docs/power-rework/skills.md 5.1 to 5.3 and 5.12). Tiers T1 (rank 2), T2 (rank 5), T3 (rank 8, 2 points).
// An augment whose effects include a `planned` primitive is listed but cannot be picked until its executor ships (SK5/SK6).
import type { SkillId } from '../../../contracts/content';
import type { AugmentDef } from '../types';

const DEG = Math.PI / 180;

export const FIRE_AUGMENTS: Partial<Record<SkillId, AugmentDef[]>> = {
  emberLance: [
    {
      id: 'piercingFlame', name: 'Piercing Flame', tier: 1, text: 'Pierces 2 enemies', excludes: ['lodgeEmber'],
      effects: [{ k: 'pierce', add: 2 }],
    },
    {
      id: 'twinStrand', name: 'Twin Strand', tier: 1, text: 'Fires 2 bolts 12° apart, each dealing 25% less damage', excludes: ['rapidSpark'],
      effects: [{ k: 'count', add: 1 }, { k: 'set', stat: 'spread', value: 12 * DEG }, { k: 'more', pct: -25 }],
    },
    {
      id: 'rapidSpark', name: 'Rapid Spark', tier: 1, text: '18% shorter cast time, 8% less damage', excludes: ['twinStrand'],
      effects: [{ k: 'scale', stat: 'castTime', pct: -18 }, { k: 'more', pct: -8 }],
    },
    {
      id: 'lodgeEmber', name: 'Lodge Ember', tier: 2,
      text: 'The bolt lodges in the first enemy hit and detonates after 1.2 seconds or on its death for 240% of the hit as fire in a radius of 46; at most 8 lodged',
      excludes: ['piercingFlame'], effects: [{ k: 'rt', rt: { p: 'lodge', share: 2.4, radius: 46, fuse: 1.2, burst: 0, max: 8 } }],
    },
    {
      id: 'cinderFragments', name: 'Cinder Fragments', tier: 2,
      text: 'Kills release 3 fragments dealing 55% damage that seek the nearest enemy within 140',
      effects: [{ k: 'rt', rt: { p: 'split', on: 'kill', count: 3, share: 0.55, range: 140, arc: 0, seek: 140 } }],
    },
    {
      id: 'frostfireCore', name: 'Frostfire Core', tier: 3, text: '50% of Fire damage is converted to Cold; hits always chill',
      excludes: ['searingBrand'], effects: [{ k: 'convert', to: 'cold', pct: 50, ailment: 'always' }],
    },
    {
      id: 'searingBrand', name: 'Searing Brand', tier: 3,
      text: 'Hits expose Fire −15 pp for 4 seconds (half on bosses) and have +25% ignite chance; 12% less damage',
      excludes: ['frostfireCore'],
      effects: [{ k: 'rt', rt: { p: 'expose', points: [0, 15, 0, 0, 0] } }, { k: 'ailmentChance', add: 25 }, { k: 'more', pct: -12 }],
    },
  ],
  emberNova: [
    {
      id: 'widerRing', name: 'Wider Ring', tier: 1, text: '30% more range and 4 more flames, 8% less damage', excludes: ['emberFan'],
      effects: [{ k: 'scale', stat: 'range', pct: 30 }, { k: 'count', add: 4 }, { k: 'more', pct: -8 }],
    },
    {
      id: 'spiralArms', name: 'Spiral Arms', tier: 1, text: 'Two rotating arms over 0.5 seconds with 30% more flames, each 15% less damage',
      excludes: ['emberFan'], effects: [{ k: 'rt', rt: { p: 'spiral', seconds: 0.5 } }, { k: 'count', mult: 1.3 }, { k: 'more', pct: -15 }],
    },
    {
      id: 'echoingRing', name: 'Echoing Ring', tier: 2, text: 'Repeats after 0.4 seconds at 70% damage, at no Focus cost', grantedBy: 'novaEcho',
      effects: [{ k: 'echo', delay: 0.4, damage: 70 }],
    },
    {
      id: 'kilnRing', name: 'Kiln Ring', tier: 2,
      text: 'Flames leave burning ground (radius 16) for 2 seconds where they end, burning for 0.35× effectiveness every 0.5 seconds',
      effects: [{
        k: 'trail', area: 'fireTrail', at: 'end', radius: 16, duration: 2, interval: 0.5, effectiveness: 0.35, ailment: false, expose: 0, spacing: 0,
      }],
    },
    {
      id: 'emberFan', name: 'Ember Fan', tier: 2, text: 'Concentrates into a 120° cone toward the cursor: 60% more damage and 30% more range',
      excludes: ['widerRing', 'spiralArms'],
      effects: [{ k: 'shape', shape: 'fan', arc: 120 * DEG }, { k: 'more', pct: 60 }, { k: 'scale', stat: 'range', pct: 30 }],
    },
    {
      id: 'tripleRing', name: 'Triple Ring', tier: 3,
      text: 'Three concentric waves of 8 flames, 0.15 seconds apart, reaching a third, two thirds and all of its range, without pierce; cooldown +1 second',
      effects: [{ k: 'rt', rt: { p: 'rings', count: 3, flames: 8, gap: 0.15 } }, { k: 'add', stat: 'cooldown', value: 1 }],
    },
    {
      id: 'heartfire', name: 'Heartfire', tier: 3,
      text: 'Hitting 6 or more enemies refunds 40% of the Focus and 1 second of cooldown; costs 25% more Focus',
      effects: [{ k: 'rt', rt: { p: 'refund', hits: 6, focus: 0.4, cooldown: 1 } }, { k: 'scale', stat: 'focusCost', pct: 25 }],
    },
  ],
  flameWave: [
    {
      id: 'burningWake', name: 'Burning Wake', tier: 1,
      text: 'Waves leave a fire trail (radius 14) for 2 seconds, burning for 0.35× effectiveness every 0.5 seconds',
      effects: [{
        k: 'trail', area: 'fireTrail', at: 'path', radius: 14, duration: 2, interval: 0.5, effectiveness: 0.35, ailment: false, expose: 0, spacing: 28,
      }],
    },
    {
      id: 'wideFront', name: 'Wide Front', tier: 1, text: '2 more waves in a 40% wider fan, each 20% less damage', excludes: ['ringOfWaves'],
      effects: [{ k: 'count', add: 2 }, { k: 'scale', stat: 'spread', pct: 40 }, { k: 'more', pct: -20 }],
    },
    {
      id: 'tideReturns', name: 'Tide Returns', tier: 2, text: 'At their maximum range the waves return, hitting again at 60%',
      effects: [{ k: 'rt', rt: { p: 'return', share: 0.6 } }],
    },
    {
      id: 'ringOfWaves', name: 'Ring of Waves', tier: 2, text: 'Twice as many waves in a full circle, each 30% less damage', excludes: ['wideFront'],
      grantedBy: 'flameRing', effects: [{ k: 'shape', shape: 'circle' }, { k: 'count', mult: 2 }, { k: 'more', pct: -30 }],
    },
    {
      id: 'overheat', name: 'Overheat', tier: 3, text: 'Hits always ignite and ignites deal 50% more damage; cooldown +1 second',
      effects: [{ k: 'alwaysAilment' }, { k: 'add', stat: 'cooldown', value: 1 }, { k: 'rt', rt: { p: 'ignite', more: 0.5 } }],
    },
    {
      id: 'slowTide', name: 'Slow Tide', tier: 3,
      text: '40% slower and 60% wider waves with 35% more damage that hit each enemy every 0.3 seconds, up to 3 times',
      effects: [
        { k: 'scale', stat: 'projectileSpeed', pct: -40 }, { k: 'scale', stat: 'radius', pct: 60 }, { k: 'more', pct: 35 },
        { k: 'rt', rt: { p: 'rehit', interval: 0.3, max: 3 } },
      ],
    },
  ],
  cinderWard: [
    {
      id: 'bankedEmbers', name: 'Banked Embers', tier: 1, text: 'Ember pulses reach 80 units (area of effect scales it)',
      effects: [{ k: 'set', stat: 'radius', value: 80 }],
    },
    {
      id: 'frozenHearth', name: 'Frozen Hearth', tier: 1, text: 'The ward deals Cold damage and always chills', excludes: ['vigil'], grantedBy: 'coldWard',
      effects: [{ k: 'flag', flag: 'cold' }],
    },
    {
      id: 'vigil', name: 'Vigil', tier: 1, text: 'Deals no damage; restores 2 Focus per nearby enemy per pulse, up to 6',
      excludes: ['frozenHearth', 'pyreBurst'], grantedBy: 'wardFocus', effects: [{ k: 'flag', flag: 'restoreFocus' }],
    },
    {
      id: 'resoluteFlame', name: 'Resolute Flame', tier: 2, text: 'A physical hit restores 0.5 seconds of duration, up to the original', grantedBy: 'wardRenew',
      effects: [{ k: 'flag', flag: 'renew' }],
    },
    {
      id: 'pyreBurst', name: 'Pyre Burst', tier: 3, text: 'When the ward ends it bursts for 5× effectiveness as fire in a radius of 90',
      excludes: ['vigil'],
      effects: [{ k: 'blast', at: 'wardEnd', delay: 0, effectiveness: 5, radius: 90, damageType: 'fire', ailment: 0 }],
    },
    {
      id: 'hardenedEmber', name: 'Hardened Ember', tier: 3, text: 'Damage reduction cap +10 points (60% to 70%); cooldown +3 seconds',
      // The rules raise the resolved cap; the sim's ward (and the hit pipeline) honour it through the `wardCap` primitive.
      effects: [
        { k: 'add', stat: 'damageReductionCap', value: 0.1 }, { k: 'add', stat: 'cooldown', value: 3 }, { k: 'rt', rt: { p: 'wardCap', cap: 0.7 } },
      ],
    },
  ],
  cinderMortar: [
    {
      id: 'clusterShell', name: 'Cluster Shell', tier: 1,
      text: 'Splits into 3 bomblets landing within 40 units, each dealing 45% damage in 60% of the radius',
      effects: [{ k: 'rt', rt: { p: 'split', on: 'land', count: 3, share: 0.45, range: 40, arc: 0, seek: 0.6 } }],
    },
    {
      id: 'napalm', name: 'Napalm', tier: 1,
      text: 'Burning ground 50% wider, lasting 2 seconds longer and burning for 0.1× effectiveness more per tick',
      effects: [{ k: 'tune', key: 'groundRadiusPct', add: 50 }, { k: 'add', stat: 'duration', value: 2 }, { k: 'tune', key: 'groundEffectiveness', add: 0.1 }],
    },
    {
      id: 'delayedFuse', name: 'Delayed Fuse', tier: 2, text: 'The shell lies for 1.2 seconds, then explodes for 60% more damage in a 20% larger radius',
      excludes: ['skipShot'], effects: [{ k: 'rt', rt: { p: 'fuse', delay: 1.2, more: 0.6, radiusPct: 20 } }],
    },
    {
      id: 'skipShot', name: 'Skip Shot', tier: 2, text: 'Bounces twice more toward the cursor, 60 units apart, each blast dealing 70% damage',
      excludes: ['delayedFuse'], effects: [{ k: 'rt', rt: { p: 'skip', count: 2, gap: 60, share: 0.7 } }],
    },
    {
      id: 'magmaCore', name: 'Magma Core', tier: 3, text: 'Leaves a molten pool (radius 40) for 4 seconds that slows by 30% and exposes Fire −10 pp',
      effects: [{
        k: 'trail', area: 'fireTrail', at: 'land', radius: 40, duration: 4, interval: 0.5, effectiveness: 0, ailment: true, expose: 10, spacing: 0,
      }],
    },
    {
      id: 'rainOfShells', name: 'Rain of Shells', tier: 3,
      text: '3 shells land at random points within 70 units of the cursor, each 25% less damage; cooldown +1.5 seconds',
      effects: [{ k: 'rt', rt: { p: 'scatter', count: 3, radius: 70 } }, { k: 'more', pct: -25 }, { k: 'add', stat: 'cooldown', value: 1.5 }],
    },
  ],
  // Roster batch 2 (SK3), skills.md 6
  immolationSigil: [
    {
      id: 'twinSigils', name: 'Twin Sigils', tier: 1, text: 'Two sigils 80 units apart at the cursor, each 35% less damage',
      effects: [{ k: 'count', add: 1 }, { k: 'more', pct: -35 }],
    },
    {
      id: 'lingeringPillar', name: 'Lingering Pillar', tier: 2, text: 'The pillar burns on for 3 seconds, 0.5× effectiveness every 0.5 seconds',
      effects: [{ k: 'add', stat: 'duration', value: 3 }],
    },
    {
      id: 'brandSigil', name: 'Brand Sigil', tier: 3, text: 'The pillar exposes fire by 15 points for 4 seconds',
      effects: [{ k: 'flag', flag: 'brand' }],
    },
  ],
};
