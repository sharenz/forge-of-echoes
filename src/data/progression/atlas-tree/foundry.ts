import { inc, more, S, N, K, weight } from './dsl';
import type { AtlasNodeSpec } from './types';

/** Foundry: essences, ingredients, Stability, currency weights. */
export const FOUNDRY: readonly AtlasNodeSpec[] = [
  S('essenceSeeker', 'Essence Seeker', 1, 0, 'origin', { effects: [inc('essenceDropChance', 8)] }),
  S('ashwright', 'Ashwright', 2, 0, 'essenceSeeker', { effects: [inc('emberEssenceChance', 8)] }),
  S('rimewright', 'Rimewright', 3, 0, 'ashwright', { effects: [inc('rimeEssenceChance', 8)] }),
  N('soundFoundations', 'Sound Foundations', 4, 0, 'rimewright', { effects: [{ stat: 'armourStability', mode: 'flat', value: 1 }] }),
  S('sealMender', 'Seal-Mender', 5, 0, 'soundFoundations', { rules: [weight(['seal'], 'increased', 8)] }),
  N('deepSeams', 'Deep Seams', 6, 0, 'sealMender', { effects: [more('essenceDropChance', 40), more('monsterLife', 5)] }),
  S('scrapper', 'Scrapper', 7, 0, 'deepSeams', { rules: [weight(['scrap'], 'increased', 8)] }),
  N('steadyAnvil', 'Steady Anvil', 8, 0, 'scrapper', { effects: [{ stat: 'equipmentStability', mode: 'flat', value: 1 }, more('equipmentDropChance', -10)] }),
  // spur A
  S('solventSense', 'Solvent Sense', 5, -1.4, 'soundFoundations', { rules: [weight(['solvent', 'catalyst'], 'increased', 8)] }),
  S('bellows', 'Bellows', 6, -1.4, 'solventSense', { effects: [inc('essenceDropChance', 8)] }),
  N('ingredientHunter', 'Ingredient Hunter', 7, -1.4, 'bellows', { effects: [more('bossIngredientChance', 50)] }),
  S('crucibleAsh', 'Crucible Ash', 8, -1.4, 'ingredientHunter', { effects: [inc('essenceDropChance', 8)] }),
  // spur B
  S('flux', 'Flux', 5, 1.4, 'soundFoundations', { rules: [weight(['kindling'], 'increased', 8)] }),
  S('tongs', 'Tongs', 6, 1.4, 'flux', { rules: [weight(['reforge'], 'increased', 8)] }),
  N('cataloguersShelf', "Cataloguer's Shelf", 7, 1.4, 'tongs', {
    rules: [weight(['catalyst'], 'more', 25), weight(['fractureCore'], 'more', 15)], effects: [more('monsterDamage', 2)] }),
  S('slagSkimmer', 'Slag Skimmer', 8, 1.4, 'cataloguersShelf', { rules: [weight(['mapDust'], 'increased', 8)] }),
  // keystones
  K('singleMindedFurnace', 'Single-Minded Furnace', 9.5, -1, ['crucibleAsh', 'steadyAnvil'], {
    engine: 'device', rules: [{ id: 'essenceAttunement', more: 300, othersMore: -75, scrapMore: -30 }],
    units: { manual: true, reward: 12, danger: 6 },
    notes: ['Choose one Essence family at the Map Device: its weight is four times as high (x4 more), fixed for the expedition.',
      'All other Essences have 75% less weight; Scrap drops are 30% less.'] }),
  K('blankSlate', 'Blank Slate', 9.5, 1, ['slagSkimmer', 'steadyAnvil'], {
    excludes: ['kingslayersTithe'], rules: [{ id: 'equipmentNormalOnly' }],
    effects: [{ stat: 'equipmentStability', mode: 'flat', value: 2 }, more('equipmentDropChance', 45)],
    units: { manual: true, reward: 12, danger: 6 },
    notes: ['Item Rarity still improves currency, maps and flasks. No Magic or Rare equipment drops, and completion chest equipment is Normal too.'] }),
];
