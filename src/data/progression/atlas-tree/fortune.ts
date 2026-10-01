import { flat, inc, more, S, N, K } from './dsl';
import type { AtlasNodeSpec } from './types';

/** Fortune: quantity, rarity, boss and chest loot. */
export const FORTUNE: readonly AtlasNodeSpec[] = [
  S('scavenger', 'Scavenger', 1, 0, 'origin', { effects: [inc('itemQuantity', 3)] }),
  S('discerningEye', 'Discerning Eye', 2, 0, 'scavenger', { effects: [inc('itemRarity', 4)] }),
  S('gemEyed', 'Gem-Eyed', 3, 0, 'discerningEye', { effects: [inc('itemQuantity', 3)] }),
  N('crownedChallenge', 'Crowned Challenge', 4, 0, 'gemEyed', { effects: [more('bossLife', 25), more('bossUnique', 50)],
    notes: ['World-unique and exclusive-unique chances are capped at 100%.'] }),
  S('gilder', 'Gilder', 5, 0, 'crownedChallenge', { effects: [inc('itemRarity', 4)] }),
  N('kingmakersCache', "Kingmaker's Cache", 6, 0, 'gilder', { effects: [flat('chestRareChance', 30)], notes: ['Otherwise chest equipment is Magic, as now.'] }),
  S('coinSense', 'Coin Sense', 7, 0, 'kingmakersCache', { effects: [inc('itemQuantity', 3)] }),
  N('gildedInstinct', 'Gilded Instinct', 8, 0, 'coinSense', { effects: [inc('itemRarity', 12), inc('itemQuantity', 6), more('monsterDamage', 5)] }),
  // spur A
  S('glint', 'Glint', 5, -1.4, 'crownedChallenge', { effects: [inc('itemRarity', 4)] }),
  S('assay', 'Assay', 6, -1.4, 'glint', { effects: [flat('chestQuality', 2.5)] }),
  N('deepPockets', 'Deep Pockets', 7, -1.4, 'assay', { effects: [flat('chestCurrency', 1)] }),
  S('windfall', 'Windfall', 8, -1.4, 'deepPockets', { effects: [inc('itemQuantity', 3)] }),
  // spur B
  S('tarnishedCrown', 'Tarnished Crown', 5, 1.4, 'crownedChallenge', { effects: [inc('itemRarity', 4)] }),
  S('guildmark', 'Guildmark', 6, 1.4, 'tarnishedCrown', { effects: [inc('itemQuantity', 3)] }),
  N('lodestone', 'Lodestone', 7, 1.4, 'guildmark', { effects: [inc('itemQuantity', 12), inc('monsterLife', 6)] }),
  // keystones
  K('kingslayersTithe', "Kingslayer's Tithe", 9.5, -1, ['windfall', 'gildedInstinct'], {
    excludes: ['blankSlate'],
    effects: [more('bossLoot', 100), more('chestLoot', 100), more('bossUnique', 100), more('bossLife', 40), more('normalQuantity', -15)],
    units: { manual: true, reward: 14, danger: 7 },
    notes: ['Boss and chest loot are doubled (currency amounts and guaranteed equipment). Loot is still instanced per player.'] }),
  K('earlyCrown', 'Early Crown', 9.5, 1, ['lodestone', 'gildedInstinct'], {
    rules: [{ id: 'bossWave', wave: 3 }], effects: [more('monsterCount', 12)],
    units: { manual: true, reward: 11, danger: 5 },
    notes: ['The final boss holds the waves only until it is defeated; the waves are 12% larger.'] }),
];
