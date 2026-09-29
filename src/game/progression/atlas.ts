import { MAX_TERRITORY_FEE } from '../../data/items/economy';
import type { AtlasAreaId, AtlasProgress } from '../../contracts/atlas';
import { ATLAS_AREAS, ATLAS_REVEALS_PER_BOSS, ATLAS_START, atlasTierCeiling, findAtlasArea } from '../../data/progression/atlas';

export function newAtlas(): AtlasProgress {
  return { discovered: [ATLAS_START], completed: [], clears: 0 };
}

/** Known, unique IDs; the starting area is always usable and completed areas remain visible. */
export function normalizeAtlas(raw: unknown): AtlasProgress {
  if (!raw || typeof raw !== 'object') return newAtlas();
  const value = raw as Record<string, unknown>;
  const ids = (list: unknown): AtlasAreaId[] => Array.isArray(list)
    ? [...new Set(list.filter((id): id is AtlasAreaId => !!findAtlasArea(id)))] : [];
  const completed = ids(value.completed);
  const discovered = [...new Set([ATLAS_START, ...ids(value.discovered), ...completed])];
  const clears = typeof value.clears === 'number' && Number.isFinite(value.clears) ? Math.max(0, Math.floor(value.clears)) : 0;
  return { discovered, completed, clears: Math.max(completed.length, clears) };
}

/** Access depends on discovery and the inserted item's tier. The server checks/consumes a sealed-area key. */
export function atlasAccessError(progress: AtlasProgress, areaId: unknown, tier: number): string | null {
  const area = findAtlasArea(areaId);
  if (!area) return 'Choose an area on the Atlas.';
  if (!progress.discovered.includes(area.id)) return 'Defeat bosses to reveal this part of the Atlas.';
  const ceiling = atlasTierCeiling(area);
  if (!Number.isInteger(tier) || tier < 1 || tier > ceiling) return `${area.name} accepts maps up to Tier ${ceiling}. Choose a deeper area.`;
  return null;
}

/**
 * Credit one boss defeat. The caller deduplicates accounts/runs and supplies the server's rare-door roll.
 * Visiting a party member's destination reveals that destination to this account as well as its neighbours.
 * A sealed area never reveals a shortcut or opens a tier gate.
 */
export function discoverAfterBoss(progress: AtlasProgress, areaId: AtlasAreaId, revealRareDoor: boolean): {
  progress: AtlasProgress; revealed: AtlasAreaId[];
} {
  const area = findAtlasArea(areaId);
  if (!area) return { progress, revealed: [] };
  const discovered = new Set(progress.discovered);
  const revealed: AtlasAreaId[] = [];
  const reveal = (id: AtlasAreaId) => {
    if (!discovered.has(id)) { discovered.add(id); revealed.push(id); }
  };
  reveal(areaId);
  for (const id of area.neighbours.filter((id) => !discovered.has(id) && !findAtlasArea(id)?.sealed).slice(0, ATLAS_REVEALS_PER_BOSS)) reveal(id);
  if (!area.sealed && revealRareDoor) {
    const door = ATLAS_AREAS.find((a) => a.sealed && !discovered.has(a.id));
    if (door) reveal(door.id);
  }
  return {
    progress: { discovered: [...discovered], completed: [...new Set([...progress.completed, areaId])], clears: progress.clears + 1 },
    revealed,
  };
}


/** Atlas territory upkeep: early maps stay free. Legacy non-Atlas rule calls have no territory fee. */
export function territoryEntryFee(tier: number, areaId?: AtlasAreaId): number {
  return areaId && findAtlasArea(areaId) ? Math.max(0, Math.min(MAX_TERRITORY_FEE, Math.floor((tier - 1) / 3))) : 0;
}

/** Only a recorded, valid payment may be refunded. Never infer a fee for an old run. */
export function paidTerritoryFee(raw: unknown): number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 && raw <= MAX_TERRITORY_FEE ? raw : 0;
}
