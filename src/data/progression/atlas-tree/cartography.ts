import { flat, inc, more, S, N, K } from './dsl';
import type { AtlasNodeSpec } from './types';

/** Cartography: maps, chests, scarabs, fees, Atlas discovery. */
export const CARTOGRAPHY: readonly AtlasNodeSpec[] = [
  S('waypoint', 'Waypoint', 1, 0, 'origin', { effects: [inc('mapDropChance', 8)] }),
  S('milestone', 'Milestone', 2, 0, 'waypoint', { effects: [inc('mapDropChance', 8)] }),
  S('cairn', 'Cairn', 3, 0, 'milestone', { effects: [flat('droppedMapQuality', 2)] }),
  N('chartKeeper', 'Chart Keeper', 4, 0, 'cairn', { effects: [inc('mapDropChance', 22), flat('chestQuality', 3)] }),
  S('lamplighter', 'Lamplighter', 5, 0, 'chartKeeper', { effects: [inc('scarabDropChance', 12)] }),
  N('farHorizon', 'Far Horizon', 6, 0, 'lamplighter', { effects: [flat('chestUpgradeChance', 10)],
    notes: ['Tier 15 stays capped and Compass keeps working.'] }),
  S('ledgerline', 'Ledgerline', 7, 0, 'farHorizon', { effects: [flat('territoryFee', -1)] }),
  N('masterSurveyor', 'Master Surveyor', 8, 0, 'ledgerline', { effects: [flat('revealChance', 35)] }),
  // spur A
  S('signpost', 'Signpost', 5, -1.4, 'chartKeeper', { effects: [flat('chestQuality', 2.5)] }),
  S('trailmark', 'Trailmark', 6, -1.4, 'signpost', { effects: [inc('mapDropChance', 8)] }),
  N('lanternBearer', 'Lantern-Bearer', 7, -1.4, 'trailmark', { engine: 'device', rules: [{ id: 'scarabKeepChance', chance: 20 }],
    units: { reward: 4, danger: 0.5 }, notes: ['Each loaded scarab has a 20% chance not to be consumed when you open the map (rolled from the map seed).'] }),
  S('surveyStake', 'Survey Stake', 8, -1.4, 'lanternBearer', { effects: [inc('scarabDropChance', 12)] }),
  // spur B
  S('charterInk', 'Charter Ink', 5, 1.4, 'chartKeeper', { effects: [flat('chestQuality', 2.5)] }),
  S('lampOil', 'Lamp Oil', 6, 1.4, 'charterInk', { effects: [inc('scarabDropChance', 12)] }),
  N('fifthSocket', 'Fifth Socket', 7, 1.4, 'lampOil', { engine: 'device', rules: [{ id: 'scarabSockets', extra: 1 }],
    units: { reward: 5, danger: 1 }, notes: ['The Map Device has a fifth scarab socket. Scarab families still allow one scarab each.'] }),
  S('cartographersPen', "Cartographer's Pen", 8, 1.4, 'fifthSocket', { effects: [inc('mapDropChance', 8)] }),
  // keystones
  K('wageredCharts', 'Wagered Charts', 9.5, -1.1, ['surveyStake', 'masterSurveyor'], {
    engine: 'items', excludes: ['deadEndDevotee'],
    rules: [{ id: 'chestMapWager', danger: 3, quality: 0, bound: true, minTier: 4 }],
    units: { manual: true, reward: 12, danger: 5.5 },
    notes: ['From Tier 4, completion chests always upgrade your map by one tier (Tier 15 stays capped).',
      'The chest map arrives as a Rare with 3 danger mods and 0 quality, and is account-bound.',
      'Maps dropped by monsters can no longer roll higher than your tier.'] }),
  K('twinnedSockets', 'Twinned Sockets', 9.5, 0, 'masterSurveyor', {
    engine: 'device', rules: [{ id: 'scarabSameFamily', secondStrength: 0.5, lifePerScarab: 6 }],
    units: { manual: true, reward: 10, danger: 5 },
    notes: ['You may load two scarabs of the same family; the second works at 50% strength.',
      'Monsters have 6% more Life per loaded scarab. Wave duration never drops below 25 seconds.'] }),
  K('deadEndDevotee', 'Dead-End Devotee', 9.5, 1.1, ['cartographersPen', 'masterSurveyor'], {
    excludes: ['wageredCharts'],
    effects: [more('itemQuantity', 24, { area: 'deadEnd' }), more('bossIngredientChance', 30, { area: 'deadEnd' }),
      more('itemQuantity', -25, { area: 'throughRoute' }), flat('revealChance', -100)],
    units: { manual: true, reward: 11, danger: 5.5 },
    notes: ['Bosses reveal one neighbour instead of two (a slower Atlas).'] }),
];
