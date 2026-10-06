// Lightning skill augments (docs/power-rework/skills.md 5.7). Tiers T1 (rank 2), T2 (rank 5), T3 (rank 8, 2 points).
import type { SkillId } from '../../../contracts/content';
import type { AugmentDef } from '../types';

export const LIGHTNING_AUGMENTS: Partial<Record<SkillId, AugmentDef[]>> = {
  arcChain: [
    {
      id: 'forkingArc', name: 'Forking Arc', tier: 1, text: 'At the last link the bolt forks into 2 branches of 3 links at 50% damage',
      excludes: ['longReach', 'overcharge'], effects: [{ k: 'rt', rt: { p: 'fork', branches: 2, links: 3, share: 0.5, jump: 0 } }],
    },
    {
      id: 'longReach', name: 'Long Reach', tier: 1, text: '50% longer jumps and 2 more chains, 10% less damage', excludes: ['forkingArc'],
      effects: [{ k: 'scale', stat: 'radius', pct: 50 }, { k: 'chain', add: 2 }, { k: 'more', pct: -10 }],
    },
    {
      id: 'conductiveMark', name: 'Conductive Mark', tier: 2, text: 'The first target is marked for 3 seconds: it takes 15% more damage and +30% shock chance',
      effects: [{ k: 'rt', rt: { p: 'mark', seconds: 3, taken: 0.15, shock: 0.3, chill: false, first: true } }],
    },
    {
      id: 'overcharge', name: 'Overcharge', tier: 2, text: 'Each jump deals 12% more than the last, starting 20% lower', excludes: ['forkingArc'],
      effects: [{ k: 'rt', rt: { p: 'ramp', start: -0.2, step: 0.12 } }],
    },
    {
      id: 'stormReturn', name: 'Storm Return', tier: 3, text: 'The final link returns to the first target for a second hit at 80%',
      effects: [{ k: 'rt', rt: { p: 'return', share: 0.8 } }],
    },
    {
      id: 'staticDischarge', name: 'Static Discharge', tier: 3,
      text: 'Enemies killed while Shocked explode for 150% of the hit as lightning in a radius of 60 (at most 3 deep)',
      effects: [{ k: 'rt', rt: { p: 'onKill', of: 'hit', share: 1.5, radius: 60, damageType: 'lightning', needs: 'shocked', depth: 3 } }],
    },
  ],
  spark: [
    {
      id: 'moreSparks', name: 'More Sparks', tier: 1, text: '3 more sparks, each dealing 20% less damage',
      effects: [{ k: 'count', add: 3 }, { k: 'more', pct: -20 }],
    },
    {
      id: 'ricochetStorm', name: 'Ricochet Storm', tier: 2, text: 'Sparks rebound off walls 2 more times',
      effects: [{ k: 'tune', key: 'bounces', add: 2 }],
    },
    {
      id: 'charged', name: 'Charged', tier: 3, text: 'Sparks always shock, 15% less damage',
      effects: [{ k: 'alwaysAilment' }, { k: 'more', pct: -15 }],
    },
  ],
  stormCall: [
    {
      id: 'wideSkies', name: 'Wide Skies', tier: 1, text: 'Strikes 40% wider, 10% less damage',
      effects: [{ k: 'scale', stat: 'radius', pct: 40 }, { k: 'more', pct: -10 }],
    },
    {
      id: 'stormCell', name: 'Storm Cell', tier: 1, text: '3 more strikes; cast time +0.2 seconds',
      effects: [{ k: 'count', add: 3 }, { k: 'add', stat: 'castTime', value: 0.2 }],
    },
    {
      id: 'tetheredStrikes', name: 'Tethered Strikes', tier: 2, text: 'Strikes land evenly along a line from you to the cursor instead of around it',
      excludes: ['thunderMark'], effects: [{ k: 'flag', flag: 'tethered' }],
    },
    {
      id: 'thunderMark', name: 'Thunder Mark', tier: 2, text: 'Each strike leaves a static field for 3 seconds (0.4× effectiveness per 0.5 seconds, shocks)',
      excludes: ['tetheredStrikes'],
      effects: [{
        k: 'trail', area: 'staticField', at: 'strike', radius: 0, duration: 3, interval: 0.5, effectiveness: 0.4, ailment: true, expose: 0, spacing: 0,
      }],
    },
    {
      id: 'eyeOfTheStorm', name: 'Eye of the Storm', tier: 3,
      text: '1 second after the last strike a final strike lands at the cursor for 3× effectiveness in a radius of 60',
      effects: [{ k: 'blast', at: 'final', delay: 1, effectiveness: 3, radius: 60, ailment: 0 }],
    },
    {
      id: 'conduction', name: 'Conduction', tier: 3, text: 'Each strike chains to 1 enemy within 90 units at 60%; 20% less damage',
      effects: [{ k: 'rt', rt: { p: 'fork', branches: 1, links: 1, share: 0.6, jump: 90 } }, { k: 'more', pct: -20 }],
    },
  ],
  // Roster batch 2 (SK3), skills.md 6
  staticAegis: [
    {
      id: 'thornedStorm', name: 'Thorned Storm', tier: 1, text: 'Retaliation deals 60% more damage',
      effects: [{ k: 'more', pct: 60 }],
    },
    {
      id: 'grounded', name: 'Grounded', tier: 2, text: '+15% lightning resistance while it lasts',
      effects: [{ k: 'tune', key: 'aegisResist', add: 0.15 }],
    },
    {
      id: 'conductionField', name: 'Conduction Field', tier: 3, text: 'Enemies within its radius also take its shock hit every 0.5 seconds',
      effects: [{ k: 'tune', key: 'aegisPulse', add: 0.5 }],
    },
  ],
  voltaicPulse: [
    {
      id: 'widePulse', name: 'Wide Pulse', tier: 1, text: 'Radius +40%',
      effects: [{ k: 'scale', stat: 'radius', pct: 40 }],
    },
    {
      id: 'twiceStruck', name: 'Twice Struck', tier: 2, text: 'A second ring follows after 0.3 seconds at 60% damage',
      effects: [{ k: 'echo', delay: 0.3, damage: 60 }],
    },
    {
      id: 'overload', name: 'Overload', tier: 3, text: 'Its shocks last 2 seconds longer and are 10 points stronger',
      effects: [{ k: 'planned', primitive: 'ailment', note: 'shock duration and strength' }],
    },
  ],
  staticLash: [
    {
      id: 'arcLash', name: 'Arc Lash', tier: 1, text: 'Also lashes the second-nearest enemy for 60%',
      effects: [{ k: 'flag', flag: 'arcLash' }],
    },
    {
      id: 'rapidLash', name: 'Rapid Lash', tier: 2, text: 'Cast time 20% shorter; 10% less damage',
      effects: [{ k: 'scale', stat: 'castTime', pct: -20 }, { k: 'more', pct: -10 }],
    },
    {
      id: 'tetheredChain', name: 'Tethered Chain', tier: 3, text: 'Chains to 1 more enemy for 50%',
      effects: [{ k: 'chain', add: 1 }],
    },
  ],
};
