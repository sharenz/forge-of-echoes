import { inc, more, S, N, K } from './dsl';
import type { AtlasNodeSpec } from './types';

/** Bounty: monster rarity, packs and rare monsters. */
export const BOUNTY: readonly AtlasNodeSpec[] = [
  S('markedPrey', 'Marked Prey', 1, 0, 'origin', { effects: [inc('packRarity', 8)] }),
  S('thickHerds', 'Thick Herds', 2, 0, 'markedPrey', { effects: [inc('monsterCount', 3), inc('itemQuantity', 4)] }),
  S('ironHides', 'Iron Hides', 3, 0, 'thickHerds', { effects: [inc('monsterLife', 3), inc('itemQuantity', 3)] }),
  N('rareBlood', 'Rare Blood', 4, 0, 'ironHides', { effects: [more('rareQuantity', 30), more('rarePackChance', 15)] }),
  S('scentTrail', 'Scent Trail', 5, 0, 'rareBlood', { effects: [inc('rareQuantity', 8)] }),
  N('fatPacks', 'Fat Packs', 6, 0, 'scentTrail', { effects: [more('magicPackChance', 40), inc('monsterCount', 6)] }),
  S('stragglersCull', "Stragglers' Cull", 7, 0, 'fatPacks', { engine: 'sim', rules: [{ id: 'stragglerBounty', quantityMore: 6 }],
    units: { reward: 1, danger: 0 }, notes: ['Monsters that left their pack are worth 6% more quantity.'] }),
  N('elderBlood', 'Elder Blood', 8, 0, 'stragglersCull', { effects: [inc('itemRarity', 14), more('rarePackChance', 8)] }),
  // spur A
  S('huntersMark', "Hunter's Mark", 5, -1.4, 'rareBlood', { effects: [inc('packRarity', 8)] }),
  S('bloodTrail', 'Blood Trail', 6, -1.4, 'huntersMark', { effects: [inc('itemQuantity', 3), inc('monsterSpeed', 1.5)] }),
  N('wardedHunts', 'Warded Hunts', 7, -1.4, 'bloodTrail', { engine: 'sim', rules: [{ id: 'wardedRares', proofMultiplier: 2, extraEquipmentRoll: 1 }],
    units: { reward: 5, danger: 1.5 },
    notes: ['Rare monsters are twice as likely to roll an elemental-proof mod (tier gating unchanged); each proofed rare grants one extra equipment roll on death.'] }),
  S('skinner', 'Skinner', 8, -1.4, 'wardedHunts', { effects: [inc('rareQuantity', 8)] }),
  // spur B
  S('packLeaders', 'Pack Leaders', 5, 1.4, 'rareBlood', { effects: [inc('packRarity', 8)] }),
  S('bonePile', 'Bone Pile', 6, 1.4, 'packLeaders', { effects: [inc('itemQuantity', 3)] }),
  S('cullersLedger', "Culler's Ledger", 7, 1.4, 'bonePile', { effects: [inc('itemQuantity', 3)] }),
  // keystones
  K('rareOrNothing', 'Rare or Nothing', 9.5, -1, ['skinner', 'elderBlood'], {
    effects: [more('magicPackChance', -100), more('rarePackChance', 120), more('rareQuantity', 60)],
    units: { manual: true, reward: 13, danger: 6 },
    notes: ['Magic packs no longer spawn, so about half of the horde\'s loot is gone: rare packs must carry it.'] }),
  K('emptyHalls', 'Empty Halls', 9.5, 1, ['cullersLedger', 'elderBlood'], {
    excludes: ['overrunDoctrine'],
    effects: [inc('monsterCount', -50), more('itemQuantity', 80), more('monsterLife', 60), more('monsterDamage', 35)],
    units: { manual: true, reward: 12, danger: 6 },
    notes: ['Half the monsters, each tougher, hitting harder and worth far more: total loot barely changes, so this is a style, not a pump.'] }),
];
