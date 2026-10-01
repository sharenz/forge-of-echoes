// What a layout is authored against: the area's real arena radius and its theme and type (event-anchor nativeness).
// Kept apart from the registry so the client bundle (presenter) does not need the progression tables.
import type { Theme } from '../../contracts/content';
import { findAtlasArea, type AtlasAreaType } from '../progression/atlas';
import { findMapBase } from '../progression';
import type { AtlasAreaId } from '../../contracts/atlas';
import type { EventAnchorKind } from './schema';

/** The arena radius a run of this area gets: the theme's base radius x the area's arenaScale (runs.ts buildRunConfig). */
export function areaRadius(areaId: AtlasAreaId): number {
  const area = findAtlasArea(areaId);
  const base = area ? findMapBase(area.baseId) : undefined;
  return (base?.arenaRadius ?? 900) * (area?.arenaScale ?? 1);
}

export function areaTheme(areaId: AtlasAreaId): Theme {
  const area = findAtlasArea(areaId);
  return (area ? findMapBase(area.baseId)?.theme : undefined) ?? 'ashenForge';
}

export function areaType(areaId: AtlasAreaId): AtlasAreaType {
  return findAtlasArea(areaId)?.type ?? 'frontier';
}

/**
 * The anchor kinds an area type claims as native (D 10.3 check 6 wants >= 2 of each): the event biases of C section 5
 * (forge: Fault/Relay/Anvil, crypt: Echoing/Host/Bellwatch, arena: Stalker/Ring, vault: Caravan/Pact, frontier: Orchard).
 * Stalker perches are required everywhere (>= 4), so arenas add only the Ring.
 */
export const NATIVE_ANCHORS: Record<AtlasAreaType, readonly EventAnchorKind[]> = {
  forge: ['fault', 'relay', 'anvil'],
  crypt: ['echo', 'host', 'bell'],
  reliquary: ['echo', 'host', 'bell'],
  arena: ['perch', 'ring'],
  vault: ['road', 'altar'],
  frontier: ['orchard'],
};
