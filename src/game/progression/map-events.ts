import type { AtlasAreaId } from '../../contracts/atlas';
import type { MapItem } from '../../contracts/items';
import { MAP_EVENT_KINDS, type MapEventKind, type MapEventPlan } from '../../contracts/map-events';
import { createRng } from '../../core/rng';
import { findAtlasArea } from '../../data/progression/atlas';
import { AREA_EVENT_BONUS, MAP_EVENT_BASE_CHANCE, MAP_EVENT_MAX_CHANCE, MAP_EVENT_MIN_TIER, MOD_EVENT_BONUS } from '../../data/progression/map-events';

/** Public odds; the actual creation roll is server-only. */
export function mapEventOdds(map: MapItem, areaId?: AtlasAreaId): Record<MapEventKind, number> {
  const odds = Object.fromEntries(MAP_EVENT_KINDS.map(k => [k, 0])) as Record<MapEventKind, number>;
  const area = findAtlasArea(areaId);
  if (area?.encounters) {
    for (const e of area.encounters) odds[e.kind] = 1;
    if (map.bounty) odds.hunted = 1;
    return odds;
  }
  if (map.bounty) return { ...odds, hunted: 1 };
  const eligible = MAP_EVENT_KINDS.filter(k => map.tier >= MAP_EVENT_MIN_TIER[k] && !(area?.noBoss && k === 'secondCrown'));
  const modBonuses = [...new Set(map.mods.map(m => m.modId))].map(id => MOD_EVENT_BONUS[id]);
  const bonuses = [area ? AREA_EVENT_BONUS[area.type] : undefined, ...modBonuses];
  for (const kind of eligible) odds[kind] = MAP_EVENT_BASE_CHANCE / eligible.length
    + bonuses.reduce((sum, bonus) => sum + (bonus?.[kind] ?? 0), 0);
  const total = Object.values(odds).reduce((sum, n) => sum + n, 0);
  const scale = area?.eventMultiplier ? Math.min(area.eventMultiplier, 1 / total) : Math.min(1, MAP_EVENT_MAX_CHANCE / total);
  for (const kind of MAP_EVENT_KINDS) odds[kind] *= scale;
  return odds;
}

export function rollMapEvent(map: MapItem, seed: number, areaId?: AtlasAreaId): MapEventPlan | null {
  const odds = mapEventOdds(map, areaId);
  // Independent of combat, layout and loot rolls, fixed at map creation.
  const rng = createRng(seed).fork(0xe7e175);
  const area = findAtlasArea(areaId);
  if (area?.encounters) {
    const sequence = [...area.encounters];
    if (map.bounty && !sequence.some(e => e.kind === 'hunted')) sequence.unshift({ kind: 'hunted', wave: 2 });
    let next: MapEventPlan | undefined;
    for (let i = sequence.length - 1; i >= 0; i--) next = { ...sequence[i], required: true,
      angle: rng.range(0, Math.PI * 2), ...(next ? { next } : {}) };
    return next!;
  }
  let roll = rng.next();
  for (const kind of MAP_EVENT_KINDS) {
    if (roll < odds[kind]) return { kind, wave: kind === 'secondCrown' ? 6 : rng.chance(0.5) ? 2 : 4, angle: rng.range(0, Math.PI * 2) };
    roll -= odds[kind];
  }
  return null;
}

export function normalizeMapEvent(raw: unknown, depth = 0): MapEventPlan | null {
  if (depth >= 4) return null;
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Partial<MapEventPlan>;
  if (!v.kind || !(MAP_EVENT_KINDS as readonly string[]).includes(v.kind)
      || (v.kind === 'secondCrown' ? v.wave !== 6 : v.wave !== 2 && v.wave !== 4 && !(v.required === true && v.wave === 3))
      || typeof v.angle !== 'number' || !Number.isFinite(v.angle)) return null;
  const next = normalizeMapEvent(v.next, depth + 1);
  return { kind: v.kind, wave: v.wave!, angle: v.angle % (Math.PI * 2),
    ...(v.required === true ? { required: true } : {}), ...(next ? { next } : {}) };
}
