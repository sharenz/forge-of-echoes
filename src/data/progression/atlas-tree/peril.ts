import { flat, inc, more, S, N, K } from './dsl';
import type { AtlasNodeSpec } from './types';

/** Peril: danger multipliers, corruption, tempo. */
export const PERIL: readonly AtlasNodeSpec[] = [
  S('hardAir', 'Hard Air', 1, 0, 'origin', { effects: [inc('monsterLife', 3), inc('itemQuantity', 4)] }),
  S('stingingDust', 'Stinging Dust', 2, 0, 'hardAir', { effects: [inc('monsterDamage', 1.7), inc('itemRarity', 5)] }),
  S('restlessAir', 'Restless Air', 3, 0, 'stingingDust', { effects: [inc('monsterSpeed', 2), inc('itemQuantity', 4)] }),
  N('hexSculptor', 'Hex Sculptor', 4, 0, 'restlessAir', { effects: [inc('dangerModStrength', 12), inc('itemRarity', 8)], units: { reward: 3, danger: 1 } }),
  S('thinVeil', 'Thin Veil', 5, 0, 'hexSculptor', { effects: [flat('playerResist', -4), inc('itemRarity', 6)] }),
  N('riptide', 'Riptide', 6, 0, 'thinVeil', { effects: [inc('monsterSpeed', 4), inc('monsterCount', 6), inc('itemQuantity', 15)],
    notes: ['The whole map runs faster and denser (the wave-4-to-6 version awaits the sim).'] }),
  S('coldHearth', 'Cold Hearth', 7, 0, 'riptide', { effects: [inc('playerFocusRegen', -4), inc('itemQuantity', 4)] }),
  N('voidTithe', 'Void Tithe', 8, 0, 'coldHearth', { effects: [inc('corruptedModStrength', 12), inc('itemQuantity', 6, { corrupted: true })], units: { reward: 3.2, danger: 0.8 } }),
  // spur A
  S('gritStorm', 'Grit Storm', 5, -1.4, 'hexSculptor', { effects: [inc('monsterCount', 3), inc('itemQuantity', 4)] }),
  S('sourWind', 'Sour Wind', 6, -1.4, 'gritStorm', { effects: [flat('monsterResist', 2.5), inc('itemRarity', 5)] }),
  S('heavyFootfall', 'Heavy Footfall', 7, -1.4, 'sourWind', { effects: [inc('monsterLife', 3), inc('itemQuantity', 4)] }),
  // spur B
  S('emberRain', 'Ember Rain', 5, 1.4, 'hexSculptor', { effects: [inc('monsterDamage', 1.7), inc('itemQuantity', 4)] }),
  S('chokingAsh', 'Choking Ash', 6, 1.4, 'emberRain', { effects: [inc('monsterSpeed', 2), inc('itemRarity', 5)] }),
  // keystones
  K('thrillOfTheHex', 'Thrill of the Hex', 9.5, -1.3, ['heavyFootfall', 'voidTithe'], {
    effects: [inc('dangerModStrength', 40), inc('itemQuantity', 12), inc('itemRarity', 12)], units: { manual: true, reward: 12, danger: 6 },
    notes: ['Danger mods on your map are 40% stronger on both sides: more ways to die, more to earn. (The fifth danger mod awaits the crafting bench.)'] }),
  K('voidtouchedAtlas', 'Voidtouched Atlas', 9.5, 0, 'voidTithe', {
    engine: 'events', rules: [{ id: 'voidBreach', strength: 50, uncorruptedQuantity: -10 }],
    effects: [inc('corruptedModStrength', 50), inc('itemQuantity', -10, { corrupted: false })],
    units: { manual: true, reward: 13, danger: 6 },
    notes: ['The Void Needle outcome "Only corruption" becomes "Corrupted mod". Corrupted maps always roll a Void Breach event.'] }),
  K('overrunDoctrine', 'Overrun Doctrine', 9.5, 1.3, ['chokingAsh', 'voidTithe'], {
    excludes: ['emptyHalls'],
    effects: [more('waveDuration', -30), inc('itemQuantity', 30), inc('monsterSpeed', 6)],
    units: { reward: 0, danger: 4 },
    notes: ['Waves stack on you 30% sooner; the wave duration never drops below 25 seconds, whatever Haste or scarabs add.'] }),
];
