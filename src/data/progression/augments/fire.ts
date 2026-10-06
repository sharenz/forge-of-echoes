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
      excludes: ['piercingFlame'], effects: [{ k: 'planned', primitive: 'lodge' }],
    },
    {
      id: 'cinderFragments', name: 'Cinder Fragments', tier: 2,
      text: 'Kills release 3 fragments dealing 55% damage that seek the nearest enemy within 140',
      effects: [{ k: 'planned', primitive: 'split' }],
    },
    {
      id: 'frostfireCore', name: 'Frostfire Core', tier: 3, text: '50% of Fire damage is converted to Cold; hits always chill',
      excludes: ['searingBrand'], effects: [{ k: 'planned', primitive: 'convert' }],
    },
    {
      id: 'searingBrand', name: 'Searing Brand', tier: 3,
      text: 'Hits expose Fire −15 pp for 4 seconds (half on bosses) and have +25% ignite chance; 12% less damage',
      excludes: ['frostfireCore'], effects: [{ k: 'planned', primitive: 'expose' }],
    },
  ],
  emberNova: [
    {
      id: 'widerRing', name: 'Wider Ring', tier: 1, text: '30% more range and 4 more flames, 8% less damage', excludes: ['emberFan'],
      effects: [{ k: 'scale', stat: 'range', pct: 30 }, { k: 'count', add: 4 }, { k: 'more', pct: -8 }],
    },
    {
      id: 'spiralArms', name: 'Spiral Arms', tier: 1, text: 'Two rotating arms over 0.5 seconds with 30% more flames, each 15% less damage',
      excludes: ['emberFan'], effects: [{ k: 'planned', primitive: 'shape', note: 'spiral' }],
    },
    {
      id: 'echoingRing', name: 'Echoing Ring', tier: 2, text: 'Repeats after 0.4 seconds at 70% damage, at no Focus cost', grantedBy: 'novaEcho',
      effects: [{ k: 'echo', delay: 0.4, damage: 70 }],
    },
    {
      id: 'kilnRing', name: 'Kiln Ring', tier: 2, text: 'Flames leave burning ground (radius 16) for 2 seconds where they end',
      effects: [{ k: 'planned', primitive: 'trail' }],
    },
    {
      id: 'emberFan', name: 'Ember Fan', tier: 2, text: 'Concentrates into a 120° cone toward the cursor: 60% more damage and 30% more range',
      excludes: ['widerRing', 'spiralArms'],
      effects: [{ k: 'shape', shape: 'fan', arc: 120 * DEG }, { k: 'more', pct: 60 }, { k: 'scale', stat: 'range', pct: 30 }],
    },
    {
      id: 'tripleRing', name: 'Triple Ring', tier: 3, text: 'Three concentric waves of 8 flames, 0.15 seconds apart, without pierce; cooldown +1 second',
      effects: [{ k: 'planned', primitive: 'shape', note: 'rings' }],
    },
    {
      id: 'heartfire', name: 'Heartfire', tier: 3,
      text: 'Hitting 6 or more enemies refunds 40% of the Focus and 1 second of cooldown; costs 25% more Focus',
      effects: [{ k: 'planned', primitive: 'refund' }],
    },
  ],
  flameWave: [
    {
      id: 'burningWake', name: 'Burning Wake', tier: 1, text: 'Waves leave a fire trail (radius 14) for 2 seconds',
      effects: [{ k: 'planned', primitive: 'trail' }],
    },
    {
      id: 'wideFront', name: 'Wide Front', tier: 1, text: '2 more waves in a 40% wider fan, each 20% less damage', excludes: ['ringOfWaves'],
      effects: [{ k: 'count', add: 2 }, { k: 'scale', stat: 'spread', pct: 40 }, { k: 'more', pct: -20 }],
    },
    {
      id: 'tideReturns', name: 'Tide Returns', tier: 2, text: 'At their maximum range the waves return, hitting again at 60%',
      effects: [{ k: 'planned', primitive: 'return' }],
    },
    {
      id: 'ringOfWaves', name: 'Ring of Waves', tier: 2, text: 'Twice as many waves in a full circle, each 30% less damage', excludes: ['wideFront'],
      grantedBy: 'flameRing', effects: [{ k: 'shape', shape: 'circle' }, { k: 'count', mult: 2 }, { k: 'more', pct: -30 }],
    },
    {
      id: 'overheat', name: 'Overheat', tier: 3, text: 'Hits always ignite and ignites deal 50% more damage; cooldown +1 second',
      effects: [{ k: 'alwaysAilment' }, { k: 'add', stat: 'cooldown', value: 1 }, { k: 'planned', primitive: 'ailment', note: 'ignite effect' }],
    },
    {
      id: 'slowTide', name: 'Slow Tide', tier: 3,
      text: '40% slower and 60% wider waves with 35% more damage that hit each enemy every 0.3 seconds, up to 3 times',
      effects: [{ k: 'planned', primitive: 'rehit' }],
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
      excludes: ['vigil'], effects: [{ k: 'planned', primitive: 'onKill', note: 'on expiry' }],
    },
    {
      id: 'hardenedEmber', name: 'Hardened Ember', tier: 3, text: 'Damage reduction cap +10 points (60% to 70%); cooldown +3 seconds',
      // The sim and the hit pipeline cap ward reduction at 60% (sim/constants WARD_REDUCTION_CAP); the raised cap ships with them.
      effects: [{ k: 'add', stat: 'damageReductionCap', value: 0.1 }, { k: 'add', stat: 'cooldown', value: 3 }, { k: 'planned', primitive: 'cap' }],
    },
  ],
  cinderMortar: [
    {
      id: 'clusterShell', name: 'Cluster Shell', tier: 1, text: 'Splits into 3 bomblets landing within 40 units, each dealing 45% damage',
      effects: [{ k: 'planned', primitive: 'split' }],
    },
    {
      id: 'napalm', name: 'Napalm', tier: 1,
      text: 'Burning ground 50% wider, lasting 2 seconds longer and burning for 0.1× effectiveness more per tick',
      effects: [{ k: 'tune', key: 'groundRadiusPct', add: 50 }, { k: 'add', stat: 'duration', value: 2 }, { k: 'tune', key: 'groundEffectiveness', add: 0.1 }],
    },
    {
      id: 'delayedFuse', name: 'Delayed Fuse', tier: 2, text: 'The shell lies for 1.2 seconds, then explodes for 60% more damage in a 20% larger radius',
      excludes: ['skipShot'], effects: [{ k: 'planned', primitive: 'delay' }],
    },
    {
      id: 'skipShot', name: 'Skip Shot', tier: 2, text: 'Bounces twice more toward the cursor, 60 units apart, each blast dealing 70% damage',
      excludes: ['delayedFuse'], effects: [{ k: 'planned', primitive: 'bounce' }],
    },
    {
      id: 'magmaCore', name: 'Magma Core', tier: 3, text: 'Leaves a molten pool (radius 40) for 4 seconds that slows by 30% and exposes Fire −10 pp',
      effects: [{ k: 'planned', primitive: 'expose' }],
    },
    {
      id: 'rainOfShells', name: 'Rain of Shells', tier: 3,
      text: '3 shells land at random points within 70 units of the cursor, each 25% less damage; cooldown +1.5 seconds',
      effects: [{ k: 'planned', primitive: 'shape', note: 'scatter' }],
    },
  ],
};
