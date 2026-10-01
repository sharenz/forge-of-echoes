// Targeting tools that move or merge maps between Atlas areas (brief D 5.2 and 5.3): the pure rules of Re-chart and
// Recycle. The Crafting Bench (src/game/items/bench.ts) pays for and applies them; the UI reads the same functions for
// its previews (I3: every number shown is computed by the code that charges it).
import type { AtlasAreaId, AtlasProgress } from '../../contracts/atlas';
import type { MapItem } from '../../contracts/items';
import { RECHART, RECYCLE } from '../../data/items/bench';
import { ATLAS_AREAS, ATLAS_START, atlasTierCeiling, findAtlasArea, type AtlasAreaDef } from '../../data/progression/atlas';
import { MAX_MAP_TIER } from '../../data/progression/maps';
import { mapTreeNodes } from '../../data/progression/map-tree';
import { isMapAddress } from './map-binding';

/** Scrap Ledgerline-type tree nodes take off Re-chart and Recycle (`territoryFee` effects are negative); never below 1 in total. */
function ledgerDiscount(nodes: readonly string[] | undefined): number {
  return -mapTreeNodes(nodes ?? []).flatMap((n) => n.effects).filter((e) => e.stat === 'territoryFee' && e.value < 0).reduce((n, e) => n + e.value, 0);
}

/** Undirected chart neighbours of an area (an edge listed on either side counts). */
export function chartNeighbours(id: AtlasAreaId): AtlasAreaDef[] {
  const area = findAtlasArea(id);
  if (!area) return [];
  const ids = new Set<string>(area.neighbours);
  for (const a of ATLAS_AREAS) if (a.neighbours.includes(id)) ids.add(a.id);
  return ATLAS_AREAS.filter((a) => ids.has(a.id) && a.id !== id);
}

// ---------------------------------------------------------------------------------------------
// Re-chart
// ---------------------------------------------------------------------------------------------

/** Scrap price of the next Re-chart of `map`: `ceil(1 + tier / 2)`, 1.5x after one hop, 2x after two. */
export function rechartCost(map: Pick<MapItem, 'tier' | 'rechart'>, nodes?: readonly string[]): number {
  const base = Math.ceil(RECHART.base + RECHART.perTier * map.tier);
  const hops = Math.max(0, Math.floor(map.rechart ?? 0));
  return Math.max(1, Math.ceil(base * (1 + RECHART.escalation * hops)) - ledgerDiscount(nodes));
}

/** Areas a map may be Re-charted to: chart neighbours it can be opened in (discovered map addresses accepting its tier). */
export function rechartTargets(atlas: AtlasProgress | undefined, map: Pick<MapItem, 'areaId' | 'tier'>): AtlasAreaDef[] {
  const discovered = new Set<string>(atlas?.discovered ?? [ATLAS_START]);
  return chartNeighbours(map.areaId).filter((a) => isMapAddress(a) && discovered.has(a.id) && atlasTierCeiling(a) >= map.tier);
}

/** Why a map cannot be Re-charted at all (null = it can, if a target exists). */
export function rechartMapError(map: MapItem): string | null {
  if (map.corrupted) return 'Corrupted maps cannot be changed.';
  return null;
}

/** The same map in a neighbouring area: quality, mods, rarity, Bounty and the rest travel; the theme follows the area. */
export function rechartedMap(map: MapItem, target: AtlasAreaDef): MapItem {
  const { unbound: _unbound, migrated: _migrated, ...rest } = map;
  return { ...rest, areaId: target.id, baseId: target.baseId, rechart: Math.max(0, Math.floor(map.rechart ?? 0)) + 1 };
}

// ---------------------------------------------------------------------------------------------
// Recycle
// ---------------------------------------------------------------------------------------------

/** Why a map cannot be fed to Recycle (null = it can): corrupted, Bounty and Charted maps carry paid value. */
export function recycleInputError(map: MapItem): string | null {
  if (map.corrupted) return 'Corrupted maps cannot be recycled.';
  if (map.bounty) return 'A map with a Bounty commission cannot be recycled.';
  if (map.charted) return 'A Charted map cannot be recycled.';
  return null;
}

/** Scrap price of a Recycle at `tier`: the tier itself (Ledgerline -1, minimum 1). */
export function recycleCost(tier: number, nodes?: readonly string[]): number {
  return Math.max(1, Math.max(1, Math.floor(tier)) - ledgerDiscount(nodes));
}

/** Output quality: `min(20, floor(mean input quality) + 2)`. */
export function recycleQuality(inputs: readonly Pick<MapItem, 'quality'>[]): number {
  if (!inputs.length) return 0;
  const mean = inputs.reduce((n, m) => n + m.quality, 0) / inputs.length;
  return Math.min(RECYCLE.maxQuality, Math.floor(mean) + RECYCLE.qualityBonus);
}

/** Why these maps cannot be recycled together (null = they can). */
export function recycleInputsError(maps: readonly MapItem[]): string | null {
  if (maps.length !== RECYCLE.inputs) return `Recycling takes exactly ${RECYCLE.inputs} maps.`;
  if (new Set(maps.map((m) => m.uid)).size !== maps.length) return 'Choose three different maps.';
  for (const m of maps) { const e = recycleInputError(m); if (e) return e; }
  if (new Set(maps.map((m) => m.tier)).size !== 1) return 'All three maps must be the same tier.';
  return null;
}

/**
 * Areas a recycle of `maps` may produce a map for: discovered map addresses accepting the tier that are the area of one input
 * or a chart neighbour of one. Recycling never raises the tier, so the ceiling check is the only depth rule.
 */
export function recycleTargets(atlas: AtlasProgress | undefined, maps: readonly Pick<MapItem, 'areaId' | 'tier'>[]): AtlasAreaDef[] {
  if (!maps.length) return [];
  const tier = Math.max(...maps.map((m) => m.tier));
  const discovered = new Set<string>(atlas?.discovered ?? [ATLAS_START]);
  const near = new Set<string>();
  for (const m of maps) { near.add(m.areaId); for (const n of chartNeighbours(m.areaId)) near.add(n.id); }
  return ATLAS_AREAS.filter((a) => near.has(a.id) && isMapAddress(a) && discovered.has(a.id) && atlasTierCeiling(a) >= Math.min(tier, MAX_MAP_TIER));
}
