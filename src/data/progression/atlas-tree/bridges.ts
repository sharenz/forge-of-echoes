import { flat, inc, weight } from './dsl';
import type { AtlasBranch, AtlasEffect, AtlasRule } from './types';

export interface Bridge { between: [AtlasBranch, AtlasBranch]; nodes: { id: string; name: string; ring: number; effects?: AtlasEffect[]; rules?: AtlasRule[] }[] }

/** Bridge clusters: a two-branch build is cheap, a three-branch build is a real sacrifice. */
export const BRIDGES: readonly Bridge[] = [
  { between: ['cartography', 'fortune'], nodes: [
    { id: 'gildedLedger', name: 'Gilded Ledger', ring: 3, effects: [inc('mapDropChance', 4), inc('itemRarity', 2.5)] },
    { id: 'rareMaps', name: 'Rare Maps', ring: 4, effects: [inc('mapDropChance', 4), inc('itemQuantity', 2)] },
    { id: 'coinedCharts', name: 'Coined Charts', ring: 5, effects: [flat('chestQuality', 1.5), inc('itemQuantity', 2)] } ] },
  { between: ['fortune', 'echoes'], nodes: [
    { id: 'omenGold', name: 'Omen Gold', ring: 3, effects: [inc('itemQuantity', 2), flat('eventChance', 1)] },
    { id: 'fatedSpoils', name: 'Fated Spoils', ring: 4, effects: [inc('itemRarity', 3), flat('eventChance', 1)] },
    { id: 'luckySigns', name: 'Lucky Signs', ring: 5, effects: [inc('itemQuantity', 2), inc('itemRarity', 2)] } ] },
  { between: ['echoes', 'peril'], nodes: [
    { id: 'dreadOmen', name: 'Dread Omen', ring: 3, effects: [flat('eventChance', 2), inc('monsterSpeed', 1)] },
    { id: 'voidWhisper', name: 'Void Whisper', ring: 4, effects: [flat('eventChance', 1), inc('itemQuantity', 2), inc('monsterLife', 1.5)] },
    { id: 'fadingStars', name: 'Fading Stars', ring: 5, effects: [flat('eventChance', 1), inc('itemRarity', 3), inc('monsterDamage', 1)] } ] },
  { between: ['peril', 'bounty'], nodes: [
    { id: 'bloodScent', name: 'Blood Scent', ring: 3, effects: [inc('packRarity', 8), inc('itemQuantity', 2), inc('monsterCount', 2)] },
    { id: 'savageHunt', name: 'Savage Hunt', ring: 4, effects: [inc('rareQuantity', 6), inc('monsterDamage', 1.7), inc('itemRarity', 2)] },
    { id: 'packMaster', name: 'Pack Master', ring: 5, effects: [inc('packRarity', 6), inc('monsterLife', 2), inc('itemQuantity', 2.5)] } ] },
  { between: ['bounty', 'foundry'], nodes: [
    { id: 'boneMeal', name: 'Bone Meal', ring: 3, effects: [inc('packRarity', 4), inc('essenceDropChance', 4)] },
    { id: 'slaughterhouse', name: 'Slaughterhouse', ring: 4, effects: [inc('rareQuantity', 6)], rules: [weight(['scrap'], 'increased', 4)] },
    { id: 'oreVein', name: 'Ore Vein', ring: 5, effects: [inc('essenceDropChance', 4), inc('itemQuantity', 2)] } ] },
  { between: ['foundry', 'cartography'], nodes: [
    { id: 'smelterMaps', name: 'Smelter Maps', ring: 3, effects: [inc('essenceDropChance', 4), inc('mapDropChance', 4)] },
    { id: 'crucibleCharts', name: 'Crucible Charts', ring: 4, effects: [inc('mapDropChance', 4)], rules: [weight(['scrap'], 'increased', 4)] },
    { id: 'anvilRoad', name: 'Anvil Road', ring: 5, effects: [inc('scarabDropChance', 6), inc('essenceDropChance', 4)] } ] },
];
