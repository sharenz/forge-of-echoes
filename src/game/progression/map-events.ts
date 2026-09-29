import type { AtlasAreaId } from '../../contracts/atlas';
import type { MapItem } from '../../contracts/items';
import { MAP_EVENT_KINDS, type MapEventKind, type MapEventPlan } from '../../contracts/map-events';
import { createRng } from '../../core/rng';
import { findAtlasArea } from '../../data/progression/atlas';
import { AREA_EVENT_BONUS, MAP_EVENT_BASE_CHANCE, MAP_EVENT_MAX_CHANCE, MAP_EVENT_MIN_TIER, MOD_EVENT_BONUS } from '../../data/progression/map-events';

/** Public odds; the actual creation roll is server-only. */
export function mapEventOdds(map: MapItem, areaId?: AtlasAreaId): Record<MapEventKind, number> {
  const odds = Object.fromEntries(MAP_EVENT_KINDS.map(k => [k, 0])) as Record<MapEventKind, number>;
  if (map.bounty) return { ...odds, hunted: 1 };
  const eligible = MAP_EVENT_KINDS.filter(k => map.tier >= MAP_EVENT_MIN_TIER[k]);
  const area = findAtlasArea(areaId);
  const modBonuses = [...new Set(map.mods.map(m => m.modId))].map(id => MOD_EVENT_BONUS[id]);
  const bonuses = [area ? AREA_EVENT_BONUS[area.type] : undefined, ...modBonuses];
  for (const kind of eligible) odds[kind] = MAP_EVENT_BASE_CHANCE / eligible.length
    + bonuses.reduce((sum, bonus) => sum + (bonus?.[kind] ?? 0), 0);
  const total = Object.values(odds).reduce((sum, n) => sum + n, 0);
  const scale = Math.min(1, MAP_EVENT_MAX_CHANCE / total);
  for (const kind of MAP_EVENT_KINDS) odds[kind] *= scale;
  return odds;
}

export function rollMapEvent(map: MapItem, seed: number, areaId?: AtlasAreaId): MapEventPlan | null {
  const odds = mapEventOdds(map, areaId);
  // Independent of combat, layout and loot rolls, fixed at map creation.
  const rng = createRng(seed).fork(0xe7e175);
  let roll = rng.next();
  for (const kind of MAP_EVENT_KINDS) {
    if (roll < odds[kind]) return { kind, wave: kind === 'secondCrown' ? 6 : rng.chance(0.5) ? 2 : 4, angle: rng.range(0, Math.PI * 2) };
    roll -= odds[kind];
  }
  return null;
}

export function normalizeMapEvent(raw: unknown): MapEventPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Partial<MapEventPlan>;
  if (!v.kind || !(MAP_EVENT_KINDS as readonly string[]).includes(v.kind)
      || (v.kind === 'secondCrown' ? v.wave !== 6 : v.wave !== 2 && v.wave !== 4)
      || typeof v.angle !== 'number' || !Number.isFinite(v.angle)) return null;
  return { kind: v.kind, wave: v.wave!, angle: v.angle % (Math.PI * 2) };
}
