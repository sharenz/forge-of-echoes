import type { AtlasAreaId } from '../../contracts/atlas';
import { atlasTierCeiling, findAtlasArea, KEYSTONE_UNIQUE_CHANCE } from '../../data/progression/atlas';
import { UNIQUES } from '../../data/items';
import { uniqueIdsFor, uniqueLevelRequirement } from '../items';
import { monsterLevelForTier, monsterName } from './maps';

/** Public source/eligibility information; quantity and monster-rarity multipliers do not affect this roll. */
export function keystoneRewards(areaId: AtlasAreaId, tier: number | null, personalRarity = 100) {
  const area = findAtlasArea(areaId), boss = area?.uniquePool;
  if (!area || !boss) return null;
  const pool = uniqueIdsFor({ bossSource: boss }).map(id => ({
    id, name: UNIQUES[id].name, minTier: Math.ceil((uniqueLevelRequirement(id) + 2) / 6),
    eligible: tier !== null && uniqueLevelRequirement(id) <= monsterLevelForTier(tier),
  })).filter(i => i.minTier <= atlasTierCeiling(area));
  return { boss: monsterName(boss), pool,
    chance: pool.some(i => i.eligible) ? Math.min(1, KEYSTONE_UNIQUE_CHANCE * Math.max(0, personalRarity) / 100) : 0 };
}
