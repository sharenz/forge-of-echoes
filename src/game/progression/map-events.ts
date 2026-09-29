import type { AtlasAreaId } from '../../contracts/atlas';
import type { MapItem } from '../../contracts/items';
import type { MapEventPlan } from '../../contracts/map-events';
import { createRng } from '../../core/rng';
import { findAtlasArea } from '../../data/progression/atlas';
import { AREA_EVENT_BONUS, MAP_EVENT_BASE_CHANCE, MAP_EVENT_MAX_CHANCE, MOD_EVENT_BONUS } from '../../data/progression/map-events';

/** Public odds; the actual creation roll is server-only. */
export function mapEventOdds(map: MapItem, areaId?: AtlasAreaId): { hunted: number; echoRift: number } {
  if (map.bounty) return { hunted: 1, echoRift: 0 };
  const odds = { hunted: MAP_EVENT_BASE_CHANCE / 2, echoRift: MAP_EVENT_BASE_CHANCE / 2 };
  const area = findAtlasArea(areaId);
  const modBonuses = [...new Set(map.mods.map(m => m.modId))].map(id => MOD_EVENT_BONUS[id]);
  const bonuses = [area ? AREA_EVENT_BONUS[area.type] : undefined, ...modBonuses];
  for (const bonus of bonuses) {
    odds.hunted += bonus?.hunted ?? 0;
    odds.echoRift += bonus?.echoRift ?? 0;
  }
  const scale = Math.min(1, MAP_EVENT_MAX_CHANCE / (odds.hunted + odds.echoRift));
  return { hunted: odds.hunted * scale, echoRift: odds.echoRift * scale };
}

export function rollMapEvent(map: MapItem, seed: number, areaId?: AtlasAreaId): MapEventPlan | null {
  const odds = mapEventOdds(map, areaId);
  // Independent of combat, layout and loot rolls, fixed at map creation.
  const rng = createRng(seed).fork(0xe7e175);
  const roll = rng.next();
  if (roll >= odds.hunted + odds.echoRift) return null;
  return { kind: roll < odds.hunted ? 'hunted' : 'echoRift', wave: rng.chance(0.5) ? 2 : 4, angle: rng.range(0, Math.PI * 2) };
}

export function normalizeMapEvent(raw: unknown): MapEventPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Partial<MapEventPlan>;
  if ((v.kind !== 'hunted' && v.kind !== 'echoRift') || (v.wave !== 2 && v.wave !== 4)
      || typeof v.angle !== 'number' || !Number.isFinite(v.angle)) return null;
  return { kind: v.kind, wave: v.wave, angle: v.angle % (Math.PI * 2) };
}
