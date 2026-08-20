import { ARENA_RULES } from "./config/arena";
import { MAP_MODIFIERS } from "./config/maps";
import { MONSTER_ARCHETYPES } from "./config/monsters";
import type { ScaledModifierDefinition, SkillDefinition } from "./config/schema";
import { ACTIVE_SKILLS, BASIC_ATTACK } from "./config/skills";
import type { ArenaStatKey, MapItem, PlayerProfile, StatModifier } from "./domain";
import { deriveStats } from "./profile";
import { resolveStat, type StatResolution } from "./stats";

export { ACTIVE_SKILLS, BASIC_ATTACK };

interface ArenaWaveBreakdown {
  monsterCount: StatResolution<ArenaStatKey>;
  monsterLife: StatResolution<ArenaStatKey>;
  monsterMoveSpeedMin: StatResolution<ArenaStatKey>;
  monsterMoveSpeedMax: StatResolution<ArenaStatKey>;
  monsterDamage: StatResolution<ArenaStatKey>;
  monsterArmor: StatResolution<ArenaStatKey>;
  monsterEvadeChance: StatResolution<ArenaStatKey>;
  itemQuantity: StatResolution<ArenaStatKey>;
  itemRarity: StatResolution<ArenaStatKey>;
  monsterRarity: StatResolution<ArenaStatKey>;
}

export interface ArenaWaveBalance {
  wave: number;
  monsterCount: number;
  monsterLife: number;
  monsterMoveSpeed: { min: number; max: number };
  monsterDamage: number;
  monsterArmor: number;
  monsterEvadeChance: number;
  itemQuantity: number;
  itemRarity: number;
  monsterRarity: number;
  arenaModifiers: readonly StatModifier<ArenaStatKey>[];
  breakdown: ArenaWaveBreakdown;
}

export interface ArenaBalance {
  waves: number;
  tier: number;
  monsterLevel: number;
  maxLife: number;
  maxFocus: number;
  moveSpeed: number;
  attackDamage: number;
  attackSpeed: number;
  skillCooldown: number;
  armor: number;
  evadeChance: number;
  focusRegen: number;
  focusRegenBreakdown: StatResolution<ArenaStatKey>;
  arenaModifiers: readonly StatModifier<ArenaStatKey>[];
  waveStats: readonly ArenaWaveBalance[];
}

export function monsterLevelForMapTier(tier: number): number {
  return Math.min(
    ARENA_RULES.monsterLevel.maximum,
    Math.max(ARENA_RULES.monsterLevel.minimum, Math.floor(tier) * ARENA_RULES.monsterLevel.levelsPerMapTier),
  );
}

export function shouldSpawnNextWave(currentWave: number, totalWaves: number, remainingEnemies: number, waveElapsedSeconds: number): boolean {
  if (currentWave >= totalWaves) return false;
  return remainingEnemies === 0 || waveElapsedSeconds >= ARENA_RULES.waveSpawnIntervalSeconds;
}

export function isArenaCleared(currentWave: number, totalWaves: number, remainingEnemies: number): boolean {
  return currentWave >= totalWaves && remainingEnemies === 0;
}

export function shouldActivateFinalWaveRage(currentWave: number, totalWaves: number, waveElapsedSeconds: number, alreadyActive: boolean): boolean {
  return !alreadyActive
    && currentWave === totalWaves
    && waveElapsedSeconds >= ARENA_RULES.finalWaveRageDelaySeconds;
}

/** Character damage is already fully resolved (flat → increased → more). */
export function calculateHitDamage(attackDamage: number, damageEffectiveness: number): number {
  if (!Number.isFinite(attackDamage) || attackDamage < 0) throw new Error("Attack damage must be a finite non-negative number");
  if (!Number.isFinite(damageEffectiveness) || damageEffectiveness < 0) throw new Error("Damage effectiveness must be a finite non-negative number");
  return attackDamage * damageEffectiveness;
}

export interface RolledHitDamage {
  amount: number;
  type: NonNullable<SkillDefinition["damage"]>["type"];
}

/** Rolls around the character sheet's average damage without changing its expected value. */
export function rollHitDamage(
  attackDamage: number,
  definition: NonNullable<SkillDefinition["damage"]>,
  random: () => number = Math.random,
): RolledHitDamage {
  const { minMultiplier, maxMultiplier } = definition.range;
  if (!Number.isFinite(minMultiplier) || !Number.isFinite(maxMultiplier) || minMultiplier < 0 || maxMultiplier < minMultiplier) {
    throw new Error("Damage range must contain finite, ordered, non-negative multipliers");
  }
  if (Math.abs((minMultiplier + maxMultiplier) / 2 - 1) > 0.000001) {
    throw new Error("Damage range midpoint must be 1 so character-sheet damage remains the average");
  }
  const roll = Math.min(1, Math.max(0, random()));
  const rangeMultiplier = minMultiplier + (maxMultiplier - minMultiplier) * roll;
  return {
    amount: calculateHitDamage(attackDamage, definition.effectiveness) * rangeMultiplier,
    type: definition.type,
  };
}

function arenaModifier(
  definition: ScaledModifierDefinition<ArenaStatKey>,
  tier: number,
  wave: number,
  source: string,
  label: string,
): StatModifier<ArenaStatKey> {
  return {
    stat: definition.stat,
    mode: definition.mode,
    value: definition.base
      + (definition.perTier ?? 0) * Math.max(0, tier - 1)
      + (definition.perWave ?? 0) * wave,
    source,
    label,
  };
}

function flatArenaModifier(stat: ArenaStatKey, value: number, source: string, label: string): StatModifier<ArenaStatKey> {
  return { stat, mode: "flat", value, source, label };
}

function resolveArenaStat(
  stat: ArenaStatKey,
  baseContributions: readonly StatModifier<ArenaStatKey>[],
  arenaModifiers: readonly StatModifier<ArenaStatKey>[],
): StatResolution<ArenaStatKey> {
  return resolveStat(0, [
    ...baseContributions.filter((modifier) => modifier.stat === stat),
    ...arenaModifiers.filter((modifier) => modifier.stat === stat),
  ]);
}

function buildWaveBalance(wave: number, tier: number, arenaModifiers: readonly StatModifier<ArenaStatKey>[]): ArenaWaveBalance {
  const monster = MONSTER_ARCHETYPES.ashling;
  const waveModifiers = ARENA_RULES.waveModifiers.map((modifier, index) => arenaModifier(
    modifier,
    tier,
    wave,
    `wave:${wave}:scaling:${index}`,
    `${modifier.perWave ?? 0}% per wave`,
  ));
  const resolvedArenaModifiers = [...arenaModifiers, ...waveModifiers];
  const monsterCount = resolveArenaStat("monsterCount", [
    flatArenaModifier("monsterCount", ARENA_RULES.baseMonsterCount, "arena:base-monster-count", "Base monsters per wave"),
    flatArenaModifier("monsterCount", ARENA_RULES.monsterCountPerWave * wave, `wave:${wave}:monster-count`, `+${ARENA_RULES.monsterCountPerWave} monsters per wave`),
  ], resolvedArenaModifiers);
  const monsterLife = resolveArenaStat("monsterLife", [
    flatArenaModifier("monsterLife", monster.baseLife, `monster:${monster.id}:base-life`, `${monster.name} base Life`),
    flatArenaModifier("monsterLife", monster.lifePerWave * wave, `monster:${monster.id}:wave-life`, `+${monster.lifePerWave} Life per wave`),
  ], resolvedArenaModifiers);
  const speedPerWave = flatArenaModifier("monsterMoveSpeed", monster.speed.perWave * wave, `monster:${monster.id}:wave-speed`, `+${monster.speed.perWave} movement speed per wave`);
  const monsterMoveSpeedMin = resolveArenaStat("monsterMoveSpeed", [
    flatArenaModifier("monsterMoveSpeed", monster.speed.min, `monster:${monster.id}:base-speed-min`, `${monster.name} minimum base movement speed`),
    speedPerWave,
  ], resolvedArenaModifiers);
  const monsterMoveSpeedMax = resolveArenaStat("monsterMoveSpeed", [
    flatArenaModifier("monsterMoveSpeed", monster.speed.max, `monster:${monster.id}:base-speed-max`, `${monster.name} maximum base movement speed`),
    speedPerWave,
  ], resolvedArenaModifiers);
  const monsterDamage = resolveArenaStat("monsterDamage", [
    flatArenaModifier("monsterDamage", monster.contactDamage, `monster:${monster.id}:base-damage`, `${monster.name} base damage`),
    flatArenaModifier("monsterDamage", monster.contactDamagePerWave * wave, `monster:${monster.id}:wave-damage`, `+${monster.contactDamagePerWave} damage per wave`),
  ], resolvedArenaModifiers);
  const monsterArmor = resolveArenaStat("monsterArmor", [
    flatArenaModifier("monsterArmor", monster.armor, `monster:${monster.id}:base-armor`, `${monster.name} base armor`),
  ], resolvedArenaModifiers);
  const monsterEvadeChance = resolveArenaStat("monsterEvadeChance", [
    flatArenaModifier("monsterEvadeChance", monster.evadeChance, `monster:${monster.id}:base-evade`, `${monster.name} base evade chance`),
  ], resolvedArenaModifiers);
  const itemQuantity = resolveArenaStat("itemQuantity", [
    flatArenaModifier("itemQuantity", ARENA_RULES.baseItemQuantity, "arena:base-item-quantity", "Base item quantity"),
  ], resolvedArenaModifiers);
  const itemRarity = resolveArenaStat("itemRarity", [
    flatArenaModifier("itemRarity", ARENA_RULES.baseItemRarity, "arena:base-item-rarity", "Base item rarity"),
  ], resolvedArenaModifiers);
  const monsterRarity = resolveArenaStat("monsterRarity", [
    flatArenaModifier("monsterRarity", ARENA_RULES.baseMonsterRarity, "arena:base-monster-rarity", "Base monster rarity"),
  ], resolvedArenaModifiers);

  return {
    wave,
    monsterCount: Math.round(monsterCount.value),
    monsterLife: monsterLife.value,
    monsterMoveSpeed: { min: monsterMoveSpeedMin.value, max: monsterMoveSpeedMax.value },
    monsterDamage: monsterDamage.value,
    monsterArmor: monsterArmor.value,
    monsterEvadeChance: monsterEvadeChance.value,
    itemQuantity: itemQuantity.value,
    itemRarity: itemRarity.value,
    monsterRarity: monsterRarity.value,
    arenaModifiers: resolvedArenaModifiers,
    breakdown: {
      monsterCount, monsterLife, monsterMoveSpeedMin, monsterMoveSpeedMax, monsterDamage,
      monsterArmor, monsterEvadeChance, itemQuantity, itemRarity, monsterRarity,
    },
  };
}

export function buildArenaBalance(profile: PlayerProfile, map?: MapItem): ArenaBalance {
  const stats = deriveStats(profile);
  const tier = map?.tier ?? 1;
  const mapModifiers = (map?.modifiers ?? []).flatMap((id) => {
    const definition = MAP_MODIFIERS[id];
    return [...definition.modifiers, ...definition.rewardModifiers].map((modifier, index) => arenaModifier(
      modifier, tier, 0, `map:${id}:${index}`, `${definition.name} map modifier`,
    ));
  });
  const tierModifiers = ARENA_RULES.tierModifiers.map((modifier, index) => arenaModifier(
    modifier, tier, 0, `map-tier:${tier}:${index}`, `${modifier.perTier ?? 0}% per map tier above Tier 1`,
  ));
  const qualityModifier = arenaModifier(
    { stat: "itemQuantity", mode: "increased", base: map?.quality ? map.quality * 1.2 : 0 },
    tier,
    0,
    "map:quality",
    "Map quality",
  );
  const arenaModifiers = [...tierModifiers, ...mapModifiers, qualityModifier];
  const focusRegenBreakdown = resolveArenaFocusRegen(stats.focusRegen, arenaModifiers);

  return {
    waves: ARENA_RULES.totalWaves,
    tier,
    monsterLevel: monsterLevelForMapTier(tier),
    maxLife: Math.round(stats.maxLife),
    maxFocus: Math.round(stats.maxFocus),
    moveSpeed: stats.moveSpeed / 45,
    attackDamage: stats.attackDamage,
    attackSpeed: stats.attackSpeed,
    skillCooldown: stats.skillCooldown,
    armor: stats.armor,
    evadeChance: stats.evadeChance,
    focusRegen: focusRegenBreakdown.value,
    focusRegenBreakdown,
    arenaModifiers,
    waveStats: Array.from({ length: ARENA_RULES.totalWaves }, (_, index) => buildWaveBalance(index + 1, tier, arenaModifiers)),
  };
}

export function resolveArenaFocusRegen(
  characterFocusRegen: number,
  arenaModifiers: readonly StatModifier<ArenaStatKey>[],
): StatResolution<ArenaStatKey> {
  return resolveArenaStat("focusRegen", [
    flatArenaModifier("focusRegen", characterFocusRegen, "character:resolved-focus-regen", "Character Focus recovery rate"),
  ], arenaModifiers);
}
