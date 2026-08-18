import { mapRewardBonus } from "./maps";
import { deriveStats } from "./profile";
import type { PlayerProfile, Rarity } from "./domain";

export type MapDrop =
  | { kind: "equipment"; rarity: Rarity }
  | { kind: "material"; material: "scrap" | "essence" | "mapDust"; amount: number };

export interface ArenaBalance {
  waves: number;
  tier: number;
  maxLife: number;
  maxFocus: number;
  moveSpeed: number;
  attackDamage: number;
  attackSpeed: number;
  focusRegen: number;
  enemyCountMultiplier: number;
  enemySpeedMultiplier: number;
  enemyHealthMultiplier: number;
  enemyDamageMultiplier: number;
  rewardBonus: number;
}

export interface ArenaSummary {
  wave: number;
  enemiesSlain: number;
  elapsedSeconds: number;
}

export function buildArenaBalance(profile: PlayerProfile): ArenaBalance {
  const stats = deriveStats(profile);
  const map = profile.openedMap;
  const modifiers = new Set(map?.modifiers ?? []);
  const tier = map?.tier ?? 1;

  return {
    waves: 6,
    tier,
    maxLife: Math.round(stats.maxLife),
    maxFocus: Math.round(stats.maxFocus),
    moveSpeed: stats.moveSpeed / 45,
    attackDamage: stats.attackDamage,
    attackSpeed: stats.attackSpeed,
    focusRegen: modifiers.has("exhausting") ? 5.6 : 8,
    enemyCountMultiplier: (modifiers.has("teeming") ? 1.3 : 1) * (modifiers.has("commanded") ? 1.08 : 1),
    enemySpeedMultiplier: modifiers.has("restless") ? 1.12 : 1,
    enemyHealthMultiplier: 1 + Math.max(0, tier - 1) * 0.08 + (modifiers.has("vampiric") ? 0.12 : 0),
    enemyDamageMultiplier: 1 + Math.max(0, tier - 1) * 0.07 + (modifiers.has("volcanic") ? 0.12 : 0),
    rewardBonus: map ? mapRewardBonus(map) : 0,
  };
}
