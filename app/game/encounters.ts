import type { ArenaWaveBalance } from "./combat";
import {
  MAGIC_PACK_MODIFIERS,
  MONSTER_PACK_RULES,
  RARE_MONSTER_MODIFIERS,
  type MonsterPackModifierDefinition,
} from "./config/monster-packs";
import { MONSTER_ARCHETYPES, type MonsterArchetypeId } from "./config/monsters";
import type { ArenaStatKey, MonsterRarity, StatModifier } from "./domain";
import { resolveStat } from "./stats";

export type EncounterRandomSource = () => number;

export interface PackRarityChances {
  normal: number;
  magic: number;
  rare: number;
}

export interface MonsterPackPlan {
  rarity: MonsterRarity;
  archetypeIds: MonsterArchetypeId[];
  modifierIds: string[];
  rareLeaderIndex: number | null;
}

export interface ResolvedMonsterStats {
  maxLife: number;
  moveSpeed: { min: number; max: number };
  damage: number;
  armor: number;
  evadeChance: number;
  itemQuantity: number;
  itemRarity: number;
}

const PACK_MODIFIERS_BY_ID = Object.fromEntries(
  [...MAGIC_PACK_MODIFIERS, ...RARE_MONSTER_MODIFIERS].map((definition) => [definition.id, definition]),
) as Record<string, MonsterPackModifierDefinition>;

export function monsterPackModifierNames(ids: readonly string[]): string[] {
  return ids.flatMap((id) => PACK_MODIFIERS_BY_ID[id]?.name ?? []);
}

function weightedChoice<T>(values: readonly T[], weight: (value: T) => number, random: EncounterRandomSource): T {
  if (values.length === 0) throw new Error("Cannot choose from an empty encounter pool");
  const total = values.reduce((sum, value) => sum + Math.max(0, weight(value)), 0);
  if (total <= 0) return values[0];
  let cursor = random() * total;
  for (const value of values) {
    cursor -= Math.max(0, weight(value));
    if (cursor < 0) return value;
  }
  return values[values.length - 1];
}

function weightedSample<T>(values: readonly T[], count: number, weight: (value: T) => number, random: EncounterRandomSource): T[] {
  const remaining = [...values];
  const selected: T[] = [];
  while (selected.length < count && remaining.length > 0) {
    const value = weightedChoice(remaining, weight, random);
    selected.push(value);
    remaining.splice(remaining.indexOf(value), 1);
  }
  return selected;
}

export function packRarityChances(monsterRarity: number): PackRarityChances {
  const rarityMultiplier = Math.max(0, monsterRarity) / 100;
  const magic = Math.min(MONSTER_PACK_RULES.maximumMagicChance, MONSTER_PACK_RULES.baseMagicChance * rarityMultiplier);
  const rare = Math.min(MONSTER_PACK_RULES.maximumRareChance, MONSTER_PACK_RULES.baseRareChance * rarityMultiplier);
  return { normal: Math.max(0, 1 - magic - rare), magic, rare };
}

function rollPackRarity(monsterRarity: number, random: EncounterRandomSource): MonsterRarity {
  const chances = packRarityChances(monsterRarity);
  const roll = random();
  if (roll < chances.rare) return "rare";
  if (roll < chances.rare + chances.magic) return "magic";
  return "normal";
}

function availableArchetypes(wave: number, tier: number) {
  return Object.values(MONSTER_ARCHETYPES).filter((definition) => (
    wave >= (definition.minimumWave ?? 1) && tier >= (definition.minimumTier ?? 1)
  ));
}

function archetypeWeight(definition: (typeof MONSTER_ARCHETYPES)[MonsterArchetypeId], wave: number, tier: number): number {
  return Math.max(1, definition.spawnWeight + (definition.weightPerWave ?? 0) * (wave - 1) + (definition.weightPerTier ?? 0) * (tier - 1));
}

function rollTypeCount(availableCount: number, random: EncounterRandomSource): number {
  const roll = random() * MONSTER_PACK_RULES.typeCountWeights.reduce((sum, weight) => sum + weight, 0);
  let cursor = roll;
  for (let index = 0; index < MONSTER_PACK_RULES.typeCountWeights.length; index += 1) {
    cursor -= MONSTER_PACK_RULES.typeCountWeights[index];
    if (cursor < 0) return Math.min(index + 1, availableCount);
  }
  return Math.min(1, availableCount);
}

export function rollMonsterPack(
  memberCount: number,
  wave: number,
  tier: number,
  monsterRarity: number,
  random: EncounterRandomSource = Math.random,
): MonsterPackPlan {
  const available = availableArchetypes(wave, tier);
  const typeCount = rollTypeCount(available.length, random);
  const selectedTypes = weightedSample(available, typeCount, (definition) => archetypeWeight(definition, wave, tier), random);
  const archetypeIds: MonsterArchetypeId[] = [];
  for (let index = 0; index < memberCount; index += 1) {
    const definition = index < selectedTypes.length
      ? selectedTypes[index]
      : weightedChoice(selectedTypes, (candidate) => archetypeWeight(candidate, wave, tier), random);
    archetypeIds.push(definition.id as MonsterArchetypeId);
  }
  const rarity = rollPackRarity(monsterRarity, random);
  const modifierPool: readonly MonsterPackModifierDefinition[] = rarity === "magic" ? MAGIC_PACK_MODIFIERS : rarity === "rare" ? RARE_MONSTER_MODIFIERS : [];
  const modifierCount = rarity === "magic" ? MONSTER_PACK_RULES.magicModifierCount : rarity === "rare" ? MONSTER_PACK_RULES.rareModifierCount : 0;
  const modifierIds = weightedSample(modifierPool, modifierCount, (definition) => definition.weight, random).map((definition) => definition.id);

  return {
    rarity,
    archetypeIds,
    modifierIds,
    rareLeaderIndex: rarity === "rare" && memberCount > 0 ? Math.floor(random() * memberCount) : null,
  };
}

function flatModifier(stat: ArenaStatKey, value: number, source: string, label: string): StatModifier<ArenaStatKey> {
  return { stat, mode: "flat", value, source, label };
}

function configuredModifiers(
  definitions: readonly { stat: ArenaStatKey; mode: StatModifier<ArenaStatKey>["mode"]; base: number }[],
  source: string,
  label: string,
): StatModifier<ArenaStatKey>[] {
  return definitions.map((definition, index) => ({
    stat: definition.stat,
    mode: definition.mode,
    value: definition.base,
    source: `${source}:${index}`,
    label,
  }));
}

function resolveMonsterStat(
  stat: ArenaStatKey,
  baseModifiers: readonly StatModifier<ArenaStatKey>[],
  wave: ArenaWaveBalance,
  extraModifiers: readonly StatModifier<ArenaStatKey>[],
): number {
  return resolveStat(0, [
    ...baseModifiers.filter((modifier) => modifier.stat === stat),
    ...wave.arenaModifiers.filter((modifier) => modifier.stat === stat),
    ...extraModifiers.filter((modifier) => modifier.stat === stat),
  ]).value;
}

export function resolveMonsterStats(
  archetypeId: MonsterArchetypeId,
  wave: ArenaWaveBalance,
  rarity: MonsterRarity,
  packModifierIds: readonly string[],
): ResolvedMonsterStats {
  const archetype = MONSTER_ARCHETYPES[archetypeId];
  const bases = [
    flatModifier("monsterLife", archetype.baseLife, `monster:${archetypeId}:life`, `${archetype.name} base Life`),
    flatModifier("monsterLife", archetype.lifePerWave * wave.wave, `monster:${archetypeId}:wave-life`, `${archetype.name} Life per wave`),
    flatModifier("monsterMoveSpeed", archetype.speed.min, `monster:${archetypeId}:speed-min`, `${archetype.name} minimum speed`),
    flatModifier("monsterDamage", archetype.contactDamage, `monster:${archetypeId}:damage`, `${archetype.name} base damage`),
    flatModifier("monsterDamage", archetype.contactDamagePerWave * wave.wave, `monster:${archetypeId}:wave-damage`, `${archetype.name} damage per wave`),
    flatModifier("monsterArmor", archetype.armor, `monster:${archetypeId}:armor`, `${archetype.name} base armor`),
    flatModifier("monsterEvadeChance", archetype.evadeChance, `monster:${archetypeId}:evade`, `${archetype.name} base evade chance`),
    flatModifier("itemQuantity", 100, "arena:base-item-quantity", "Base item quantity"),
    flatModifier("itemRarity", 100, "arena:base-item-rarity", "Base item rarity"),
  ];
  const maximumSpeedBases = bases.map((modifier) => modifier.source === `monster:${archetypeId}:speed-min`
    ? { ...modifier, value: archetype.speed.max, source: `monster:${archetypeId}:speed-max`, label: `${archetype.name} maximum speed` }
    : modifier);
  bases.push(flatModifier("monsterMoveSpeed", archetype.speed.perWave * wave.wave, `monster:${archetypeId}:wave-speed`, `${archetype.name} speed per wave`));
  maximumSpeedBases.push(flatModifier("monsterMoveSpeed", archetype.speed.perWave * wave.wave, `monster:${archetypeId}:wave-speed`, `${archetype.name} speed per wave`));
  const affixModifiers = packModifierIds.flatMap((id) => {
    const definition = PACK_MODIFIERS_BY_ID[id];
    return definition ? configuredModifiers(definition.modifiers, `monster-pack:${id}`, definition.name) : [];
  });
  const rewardModifiers = configuredModifiers(MONSTER_PACK_RULES.rarityRewardModifiers[rarity], `monster-rarity:${rarity}`, `${rarity} monster rewards`);
  const extras = [...affixModifiers, ...rewardModifiers];

  return {
    maxLife: resolveMonsterStat("monsterLife", bases, wave, extras),
    moveSpeed: {
      min: resolveMonsterStat("monsterMoveSpeed", bases, wave, extras),
      max: resolveMonsterStat("monsterMoveSpeed", maximumSpeedBases, wave, extras),
    },
    damage: resolveMonsterStat("monsterDamage", bases, wave, extras),
    armor: Math.max(0, resolveMonsterStat("monsterArmor", bases, wave, extras)),
    evadeChance: Math.min(75, Math.max(0, resolveMonsterStat("monsterEvadeChance", bases, wave, extras))),
    itemQuantity: resolveMonsterStat("itemQuantity", bases, wave, extras),
    itemRarity: resolveMonsterStat("itemRarity", bases, wave, extras),
  };
}
