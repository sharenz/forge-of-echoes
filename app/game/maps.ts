import { MAP_BASES, MAP_MODIFIERS, MAP_RARITY_LIMITS } from "./config/maps";
import type { MapItem, MapModifierId, Rarity } from "./domain";
import { choose, createId, shuffle } from "./random";

export function createMap(tier = 1): MapItem {
  const base = choose(MAP_BASES);
  return {
    kind: "map",
    id: createId("map"),
    baseId: base.id,
    baseName: base.name,
    tier,
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

export function mapRewardBonus(map: MapItem): number {
  const affixBonus = map.modifiers.reduce((sum, id) => sum + MAP_MODIFIERS[id].reward, 0);
  return Math.round(affixBonus + map.quality * 1.2);
}

export function mapDanger(map: MapItem): number {
  return map.modifiers.reduce((sum, id) => sum + MAP_MODIFIERS[id].danger, map.tier * 3);
}
