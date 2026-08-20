import { MAP_BASES, MAP_BASES_BY_ID, MAP_MODIFIERS, MAP_RARITY_LIMITS, MAP_TIER_RULES, type MapBaseId } from "./config/maps";
import { ARENA_RULES } from "./config/arena";
import type { ArenaStatKey, MapItem, MapModifierId, Rarity, StatModifier } from "./domain";
import { choose, createId, shuffle } from "./random";
import { formatModifier, resolveStat } from "./stats";

export function createMap(tier = 1, baseId?: MapBaseId, random: () => number = Math.random): MapItem {
  const base = baseId
    ? MAP_BASES_BY_ID[baseId]
    : MAP_BASES[Math.floor(Math.min(0.999999, Math.max(0, random())) * MAP_BASES.length)];
  return {
    kind: "map",
    id: createId("map"),
    baseId: base.id,
    baseName: base.name,
    tier: Math.min(MAP_TIER_RULES.maximum, Math.max(MAP_TIER_RULES.minimum, Math.floor(tier))),
    rarity: "normal",
    quality: 0,
    corrupted: false,
    implicit: base.implicit,
    modifiers: [],
  };
}

function rarityForCount(count: number): Rarity {
  if (count === 0) return "normal";
  if (count <= 2) return "magic";
  return "rare";
}

export function addMapModifier(map: MapItem, kind: "threat" | "reward"): MapItem {
  if (map.corrupted || map.modifiers.length >= MAP_RARITY_LIMITS.rare) return map;
  const available = (Object.keys(MAP_MODIFIERS) as MapModifierId[]).filter(
    (id) => MAP_MODIFIERS[id].kind === kind && !map.modifiers.includes(id),
  );
  if (available.length === 0) return map;
  const modifiers = [...map.modifiers, choose(available)];
  return { ...map, modifiers, rarity: rarityForCount(modifiers.length) };
}

export function rerollMap(map: MapItem): MapItem {
  if (map.corrupted) return map;
  const targetCount = map.modifiers.length === 0 ? 2 : map.modifiers.length;
  const modifiers = shuffle(Object.keys(MAP_MODIFIERS) as MapModifierId[]).slice(0, targetCount);
  return { ...map, modifiers, rarity: rarityForCount(modifiers.length) };
}

export function mapDanger(map: MapItem): number {
  return map.modifiers.reduce((sum, id) => sum + MAP_MODIFIERS[id].danger, map.tier * 3);
}

/** Mechanical map copy is rendered from the exact modifier records the arena consumes. */
export function mapModifierDescription(id: MapModifierId, tier = 1): string {
  return MAP_MODIFIERS[id].modifiers.map((modifier) => formatModifier({
    stat: modifier.stat,
    mode: modifier.mode,
    value: modifier.base + (modifier.perTier ?? 0) * Math.max(0, tier - 1),
  })).join(" · ");
}

export function mapModifierRewardDescription(id: MapModifierId): string {
  return MAP_MODIFIERS[id].rewardModifiers.map((modifier) => formatModifier({
    stat: modifier.stat,
    mode: modifier.mode,
    value: modifier.base,
  })).join(" · ");
}

export interface MapStatSummary {
  itemQuantity: number;
  itemRarity: number;
  monsterCount: number;
  monsterRarity: number;
}

/** Relative map-device values. 100 is the unmodified baseline for each axis. */
export function mapStatSummary(map: MapItem): MapStatSummary {
  const baseStats: ArenaStatKey[] = ["itemQuantity", "itemRarity", "monsterCount", "monsterRarity"];
  const modifiers: StatModifier<ArenaStatKey>[] = map.modifiers.flatMap((id) => [
    ...MAP_MODIFIERS[id].modifiers,
    ...MAP_MODIFIERS[id].rewardModifiers,
  ]).map((modifier, index) => ({
    stat: modifier.stat,
    mode: modifier.mode,
    value: modifier.base + (modifier.perTier ?? 0) * Math.max(0, map.tier - 1),
    source: `map-summary:${index}`,
  }));
  modifiers.push(...ARENA_RULES.tierModifiers.map((modifier, index) => ({
    stat: modifier.stat,
    mode: modifier.mode,
    value: modifier.base + (modifier.perTier ?? 0) * Math.max(0, map.tier - 1),
    source: `map-summary:tier:${index}`,
  })));
  modifiers.push({ stat: "itemQuantity", mode: "increased", value: map.quality * 1.2, source: "map:quality" });
  const resolved = Object.fromEntries(baseStats.map((stat) => [
    stat,
    resolveStat(100, modifiers.filter((modifier) => modifier.stat === stat)).value,
  ])) as Record<(typeof baseStats)[number], number>;
  return {
    itemQuantity: Math.round(resolved.itemQuantity - 100),
    itemRarity: Math.round(resolved.itemRarity - 100),
    monsterCount: Math.round(resolved.monsterCount - 100),
    monsterRarity: Math.round(resolved.monsterRarity - 100),
  };
}
