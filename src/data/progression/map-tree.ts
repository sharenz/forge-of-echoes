import type { MapTreeNodeId } from '../../contracts/atlas';
import type { MapEffectDef } from './types';

export const MAP_TREE_POINT_CAP = 10;
export const MAP_TREE_REFUND_COST = 5;
export const MAP_TREE_BRANCHES = ['Cartography', 'Crafting', 'Hunting', 'Fortune', 'Encounters'] as const;
export interface MapTreeNode {
  id: MapTreeNodeId;
  name: string;
  branch: typeof MAP_TREE_BRANCHES[number];
  parent?: MapTreeNodeId;
  text: string;
  effects?: readonly MapEffectDef[];
  eventChance?: number;
  chestUpgradeChance?: number;
  bossUniqueMore?: number;
  bossLifeMore?: number;
}
export const MAP_TREE: readonly MapTreeNode[] = [
  { id: 'trailblazer', name: 'Trailblazer', branch: 'Cartography', text: '20% increased ordinary map drop chance.', effects: [{ stat: 'mapDropChance', mode: 'increased', value: 20 }] },
  { id: 'chartKeeper', name: 'Chart Keeper', branch: 'Cartography', parent: 'trailblazer', text: '30% increased ordinary map drop chance.', effects: [{ stat: 'mapDropChance', mode: 'increased', value: 30 }] },
  { id: 'farHorizon', name: 'Far Horizon', branch: 'Cartography', parent: 'chartKeeper', text: 'Completion chests have a 40% chance to drop a map one tier higher, up from 25%. Tier 15 stays capped.', chestUpgradeChance: 0.15 },
  { id: 'essenceSeeker', name: 'Essence Seeker', branch: 'Crafting', text: '25% increased Essence weight in ordinary currency drops. Does not add currency drops.', effects: [{ stat: 'essenceDropChance', mode: 'increased', value: 25 }] },
  { id: 'soundFoundations', name: 'Sound Foundations', branch: 'Crafting', parent: 'essenceSeeker', text: 'Non-unique armour bases drop with +1 maximum Stability.', effects: [{ stat: 'armourStability', mode: 'flat', value: 1 }] },
  { id: 'deepSeams', name: 'Deep Seams', branch: 'Crafting', parent: 'soundFoundations', text: '50% more Essence weight in ordinary currency drops. Monsters have 10% more Life.', effects: [{ stat: 'essenceDropChance', mode: 'more', value: 50 }, { stat: 'monsterLife', mode: 'more', value: 10 }] },
  { id: 'markedPrey', name: 'Marked Prey', branch: 'Hunting', text: '20% increased magic and rare pack chance.', effects: [{ stat: 'packRarity', mode: 'increased', value: 20 }] },
  { id: 'crowdedGrounds', name: 'Crowded Grounds', branch: 'Hunting', parent: 'markedPrey', text: '10% increased monster count and 5% increased Item Quantity.', effects: [{ stat: 'monsterCount', mode: 'increased', value: 10 }, { stat: 'itemQuantity', mode: 'increased', value: 5 }] },
  { id: 'apexHunt', name: 'Apex Hunt', branch: 'Hunting', parent: 'crowdedGrounds', text: '40% increased magic and rare pack chance and 15% increased Item Rarity. Monsters deal 5% more damage.', effects: [{ stat: 'packRarity', mode: 'increased', value: 40 }, { stat: 'itemRarity', mode: 'increased', value: 15 }, { stat: 'monsterDamage', mode: 'more', value: 5 }] },
  { id: 'scavenger', name: 'Scavenger', branch: 'Fortune', text: '5% increased Item Quantity.', effects: [{ stat: 'itemQuantity', mode: 'increased', value: 5 }] },
  { id: 'discerningEye', name: 'Discerning Eye', branch: 'Fortune', parent: 'scavenger', text: '15% increased Item Rarity.', effects: [{ stat: 'itemRarity', mode: 'increased', value: 15 }] },
  { id: 'crownedChallenge', name: 'Crowned Challenge', branch: 'Fortune', parent: 'discerningEye', text: 'Final bosses have 25% more Life. Their separate world-unique and exclusive-unique chances are 50% higher, capped at 100%.', bossUniqueMore: 50, bossLifeMore: 25 },
  { id: 'strangeSigns', name: 'Strange Signs', branch: 'Encounters', text: '+5 percentage points to random encounter chance, preserving the relative event odds.', eventChance: 0.05 },
  { id: 'echoCompass', name: 'Echo Compass', branch: 'Encounters', parent: 'strangeSigns', text: '+5 percentage points to random encounter chance. Bounties and fixed encounter chains stay guaranteed.', eventChance: 0.05 },
  { id: 'beyondTheVeil', name: 'Beyond the Veil', branch: 'Encounters', parent: 'echoCompass', text: '+10 percentage points to random encounter chance and 5% increased Item Quantity. Monsters have 10% more Life.', eventChance: 0.10, effects: [{ stat: 'itemQuantity', mode: 'increased', value: 5 }, { stat: 'monsterLife', mode: 'more', value: 10 }] },
];

export function mapTreeNodes(ids: readonly MapTreeNodeId[] = []): readonly MapTreeNode[] {
  const selected = new Set(ids);
  return MAP_TREE.filter(n => selected.has(n.id));
}

export function mapTreeBonuses(ids: readonly MapTreeNodeId[] = []) {
  const nodes = mapTreeNodes(ids);
  return {
    eventChance: nodes.reduce((n, d) => n + (d.eventChance ?? 0), 0),
    chestUpgradeChance: nodes.reduce((n, d) => n + (d.chestUpgradeChance ?? 0), 0),
    bossUniqueMultiplier: nodes.reduce((n, d) => n * (1 + (d.bossUniqueMore ?? 0) / 100), 1),
    bossLifeMultiplier: nodes.reduce((n, d) => n * (1 + (d.bossLifeMore ?? 0) / 100), 1),
  };
}
