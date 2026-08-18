import { mapRewardBonus } from "./maps";
import { deriveStats } from "./profile";
import type { CurrencyId, PlayerProfile, Rarity } from "./domain";
import { ARENA_RULES } from "./config/arena";
import { ACTIVE_SKILLS, BASIC_ATTACK } from "./config/skills";

export type MapDrop =
  | { kind: "equipment"; rarity: Rarity }
  | { kind: "currency"; currency: Extract<CurrencyId, "scrap" | "essence" | "mapDust">; amount: number };

export { ACTIVE_SKILLS, BASIC_ATTACK };

export interface ArenaBalance {
  waves: number;
  tier: number;
  maxLife: number;
  maxFocus: number;
  moveSpeed: number;
  attackDamage: number;
  attackSpeed: number;
  armor: number;
  evadeChance: number;
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

export function shouldSpawnNextWave(currentWave: number, totalWaves: number, remainingEnemies: number, waveElapsedSeconds: number): boolean {
  if (currentWave >= totalWaves) return false;
  return remainingEnemies === 0 || waveElapsedSeconds >= ARENA_RULES.waveSpawnIntervalSeconds;
}

/** Character damage is already fully resolved (flat → increased → more). */
export function calculateHitDamage(attackDamage: number, damageEffectiveness: number): number {
  if (!Number.isFinite(attackDamage) || attackDamage < 0) throw new Error("Attack damage must be a finite non-negative number");
  if (!Number.isFinite(damageEffectiveness) || damageEffectiveness < 0) throw new Error("Damage effectiveness must be a finite non-negative number");
  return attackDamage * damageEffectiveness;
}

export function buildArenaBalance(profile: PlayerProfile): ArenaBalance {
  const stats = deriveStats(profile);
  const map = profile.openedMap;
  const modifiers = new Set(map?.modifiers ?? []);
  const tier = map?.tier ?? 1;

  return {
    waves: ARENA_RULES.totalWaves,
    tier,
    maxLife: Math.round(stats.maxLife),
    maxFocus: Math.round(stats.maxFocus),
    moveSpeed: stats.moveSpeed / 45,
    attackDamage: stats.attackDamage,
    attackSpeed: stats.attackSpeed,
    armor: stats.armor,
    evadeChance: stats.evadeChance,
    focusRegen: modifiers.has("exhausting") ? 5.6 : 8,
    enemyCountMultiplier: (modifiers.has("teeming") ? 1.3 : 1) * (modifiers.has("commanded") ? 1.08 : 1),
    enemySpeedMultiplier: modifiers.has("restless") ? 1.12 : 1,
    enemyHealthMultiplier: 1 + Math.max(0, tier - 1) * 0.08 + (modifiers.has("vampiric") ? 0.12 : 0),
    enemyDamageMultiplier: 1 + Math.max(0, tier - 1) * 0.07 + (modifiers.has("volcanic") ? 0.12 : 0),
    rewardBonus: map ? mapRewardBonus(map) : 0,
  };
}
