import { ATLAS_AREA_IDS, type AtlasProgress, type MapTreeNodeId } from '../../contracts/atlas';
import type { CharacterSave } from '../../contracts/items';
import type { Result } from '../../contracts/game';
import { MAP_TREE, MAP_TREE_POINT_CAP, MAP_TREE_REFUND_COST } from '../../data/progression/map-tree';
import { spendCurrency } from './merchant';
import { fail, ok } from './util';

/** First completion of each distinct area grants a point, including existing account completions. */
export function mapTreePoints(progress?: AtlasProgress): number {
  return Math.min(MAP_TREE_POINT_CAP, new Set(progress?.completed.filter(id => ATLAS_AREA_IDS.includes(id)) ?? []).size);
}

/** Stable parent-before-child order. Unknown, disconnected or over-budget selections are discarded. */
export function normalizeMapTree(raw: unknown, points = MAP_TREE_POINT_CAP): MapTreeNodeId[] {
  const input = new Set(Array.isArray(raw) ? raw : []);
  const kept: MapTreeNodeId[] = [];
  for (const node of MAP_TREE) if (kept.length < Math.max(0, Math.min(MAP_TREE_POINT_CAP, points)) && input.has(node.id)
    && (!node.parent || kept.includes(node.parent))) kept.push(node.id);
  return kept;
}

export function mapTreeChangeError(ch: CharacterSave, id: MapTreeNodeId, allocate: boolean): string | null {
  const node = MAP_TREE.find(n => n.id === id), selected = ch.atlas?.nodes ?? [];
  if (!node) return 'Choose a node in the map tree.';
  if (allocate) {
    if (selected.includes(id)) return 'That map node is already allocated.';
    if (selected.length >= mapTreePoints(ch.atlas)) return mapTreePoints(ch.atlas) >= MAP_TREE_POINT_CAP
      ? `All ${MAP_TREE_POINT_CAP} map points are allocated. Refund a node to choose another path.`
      : `Complete a new Atlas area to earn a map point (up to ${MAP_TREE_POINT_CAP}).`;
    if (node.parent && !selected.includes(node.parent)) return `Allocate ${MAP_TREE.find(n => n.id === node.parent)!.name} first.`;
  } else {
    if (!selected.includes(id)) return 'That map node is not allocated.';
    if (MAP_TREE.some(n => n.parent === id && selected.includes(n.id))) return 'Refund the next node on this path first.';
    if (!spendCurrency(ch, 'scrap', MAP_TREE_REFUND_COST)) return `Refunding a map point costs ${MAP_TREE_REFUND_COST} Forge Scrap.`;
  }
  return null;
}

/** Atomic pure update; the online rule wrapper excludes currency in trade offers. */
export function setMapTreeNode(ch: CharacterSave, id: MapTreeNodeId, allocate: boolean): Result<CharacterSave> {
  const error = mapTreeChangeError(ch, id, allocate);
  if (error) return fail(error);
  const next = allocate ? ch : spendCurrency(ch, 'scrap', MAP_TREE_REFUND_COST)!;
  const atlas = next.atlas!;
  const nodes = allocate ? [...(atlas.nodes ?? []), id] : atlas.nodes!.filter(n => n !== id);
  return ok({ ...next, atlas: { ...atlas, nodes: normalizeMapTree(nodes, mapTreePoints(atlas)) } });
}
