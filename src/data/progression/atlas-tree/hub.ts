import { flat, inc, more, tiered } from './dsl';
import type { AtlasNodeSpec } from './types';

/** Inner ring: effects scale with the tier of the opened map, so the tree tracks the ladder. */
export const HUB: readonly (Omit<AtlasNodeSpec, 'ring' | 'lane' | 'from'> & { angle: number })[] = [
  { id: 'risingStakes', name: 'Rising Stakes', kind: 'tier', angle: -60, effects: [tiered(inc('itemQuantity', 0.6))] },
  { id: 'deepeningWealth', name: 'Deepening Wealth', kind: 'tier', angle: 0, effects: [tiered(inc('itemRarity', 1))] },
  { id: 'higherGround', name: 'Higher Ground', kind: 'tier', angle: 60, effects: [tiered(inc('itemQuantity', 0.8)), tiered(more('monsterLife', 0.5))] },
  { id: 'longShadow', name: 'Long Shadow', kind: 'tier', angle: 120, effects: [tiered(inc('packRarity', 1.6)), tiered(more('monsterSpeed', 0.3))] },
  { id: 'laddersReward', name: "Ladder's Reward", kind: 'tier', angle: 180, effects: [tiered(flat('chestQuality', 0.34)), tiered(flat('chestUpgradeChance', 0.2))] },
];
