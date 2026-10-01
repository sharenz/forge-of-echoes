// Atlas tree rules: points, allocation, respec. Pure functions over CharacterSave.atlas (account storage).
import { ATLAS_AREA_IDS, ATLAS_EVENT_KIND_IDS, ATLAS_TREE_VERSION, type AtlasProgress, type MapTreeNodeId } from '../../contracts/atlas';
import { MAP_BASE_IDS } from '../../contracts/content';
import type { CharacterSave } from '../../contracts/items';
import type { Result } from '../../contracts/game';
import { THEME_ROSTER } from '../../contracts/bestiary';
import {
  ATLAS_FREE_REFUNDS, ATLAS_ORIGIN_ID, ATLAS_RESPEC_SESSION_CAP, ENGINE_LABEL, MAP_TREE, atlasNodeAllocatable, atlasPointBreakdown,
  atlasRespecCost, findAtlasNode, isAtlasNodeId, isLegacyNodeId, legacyNodeId, LEGACY_PREFIX, type AtlasNode,
} from '../../data/progression/map-tree';
import { spendCurrency } from './merchant';
import { pinSlotCount } from '../../data/progression/routing';
import { fail, ok } from './util';

/** The six final bosses: killing each for the first time grants a point. */
export const ATLAS_BOSS_KINDS: readonly string[] = [...new Set(MAP_BASE_IDS.map(b => THEME_ROSTER[b].boss))];

/** Point sources of an account (areas, tiers, events, bosses, milestones); a pure function of its progress. */
export function mapTreeBreakdown(progress?: AtlasProgress) {
  return atlasPointBreakdown(progress, ATLAS_AREA_IDS.length, ATLAS_BOSS_KINDS, ATLAS_EVENT_KIND_IDS);
}

/** Total points earned so far (at most 60). */
export function mapTreePoints(progress?: AtlasProgress): number {
  return mapTreeBreakdown(progress).total;
}

export function mapTreeSpent(nodes: readonly MapTreeNodeId[] = []): number {
  return nodes.reduce((n, id) => n + (findAtlasNode(id)?.cost ?? 0), 0);
}

/** Earned minus spent. */
export function mapTreeFreePoints(progress?: AtlasProgress): number {
  return Math.max(0, mapTreePoints(progress) - mapTreeSpent(progress?.nodes));
}

function connected(selected: ReadonlySet<string>): boolean {
  const seen = new Set<string>([ATLAS_ORIGIN_ID]);
  const stack = [ATLAS_ORIGIN_ID];
  while (stack.length) {
    for (const link of findAtlasNode(stack.pop())?.links ?? []) if (selected.has(link) && !seen.has(link)) { seen.add(link); stack.push(link); }
  }
  return [...selected].every(id => seen.has(id));
}

/** Nodes an allocated set conflicts with (mutual exclusions). */
function exclusionOf(node: AtlasNode, selected: ReadonlySet<string>): AtlasNode | undefined {
  for (const id of selected) {
    const other = findAtlasNode(id);
    if (other && (node.excludes.includes(id) || other.excludes.includes(node.id))) return other;
  }
  return undefined;
}

/**
 * Stable canonical order (tree data order). Unknown, not-yet-live, disconnected, mutually exclusive or over-budget
 * selections are discarded. `points` is the budget; the origin is free and implicit.
 */
export function normalizeMapTree(raw: unknown, points = 60): MapTreeNodeId[] {
  const input = new Set((Array.isArray(raw) ? raw : []).filter(isAtlasNodeId));
  const kept = new Set<string>();
  let spent = 0;
  for (let changed = true; changed;) {
    changed = false;
    for (const node of MAP_TREE) {
      if (!input.has(node.id) || kept.has(node.id) || !atlasNodeAllocatable(node)) continue;
      if (spent + node.cost > points || exclusionOf(node, kept)) continue;
      if (!node.links.some(l => l === ATLAS_ORIGIN_ID || kept.has(l))) continue;
      kept.add(node.id); spent += node.cost; changed = true;
    }
  }
  return MAP_TREE.filter(n => kept.has(n.id)).map(n => n.id);
}

/** Scrap this refund costs: free for the first ATLAS_FREE_REFUNDS ever, then by class, never above the session cap. */
export function refundCost(progress: AtlasProgress | undefined, node: AtlasNode): number {
  if ((progress?.refunds ?? 0) < ATLAS_FREE_REFUNDS) return 0;
  return Math.max(0, Math.min(atlasRespecCost(node), ATLAS_RESPEC_SESSION_CAP - (progress?.respecSpent ?? 0)));
}

export function mapTreeChangeError(ch: CharacterSave, id: MapTreeNodeId, allocate: boolean): string | null {
  const node = isAtlasNodeId(id) ? findAtlasNode(id) : undefined;
  const selected = new Set(ch.atlas?.nodes ?? []);
  if (!node) return 'Choose a node in the Atlas tree.';
  if (allocate) {
    if (selected.has(id)) return 'That node is already allocated.';
    if (!atlasNodeAllocatable(node)) return `${node.name} cannot be allocated yet: ${ENGINE_LABEL[node.engine].toLowerCase()}.`;
    const clash = exclusionOf(node, selected);
    if (clash) return `${node.name} excludes ${clash.name}. Refund ${clash.name} first.`;
    if (!node.links.some(l => l === ATLAS_ORIGIN_ID || selected.has(l))) return `Connect ${node.name} to your allocated path first.`;
    const free = mapTreeFreePoints(ch.atlas);
    if (node.cost > free) return free === 0 && mapTreePoints(ch.atlas) >= 60
      ? 'All 60 Atlas points are allocated. Refund a node to choose another path.'
      : `${node.name} costs ${node.cost} Atlas point${node.cost === 1 ? '' : 's'}; you have ${free}. Clear new areas, tiers, encounters and bosses to earn more.`;
  } else {
    if (!selected.has(id)) return 'That node is not allocated.';
    selected.delete(id);
    if (!connected(selected)) return 'Refund the nodes beyond this one first.';
    const cost = refundCost(ch.atlas, node);
    if (cost > 0 && !spendCurrency(ch, 'scrap', cost)) return `Refunding ${node.name} costs ${cost} Forge Scrap.`;
  }
  return null;
}

/** Atomic pure update; the online rule wrapper excludes currency in trade offers. */
export function setMapTreeNode(ch: CharacterSave, id: MapTreeNodeId, allocate: boolean): Result<CharacterSave> {
  const error = mapTreeChangeError(ch, id, allocate);
  if (error) return fail(error);
  const node = findAtlasNode(id)!;
  const cost = allocate ? 0 : refundCost(ch.atlas, node);
  const next = cost > 0 ? spendCurrency(ch, 'scrap', cost)! : ch;
  const atlas = next.atlas!;
  const nodes = allocate ? [...(atlas.nodes ?? []), id] : atlas.nodes!.filter(n => n !== id);
  const kept = normalizeMapTree(nodes, mapTreePoints(atlas));
  // A respec that takes a pin-slot node away drops the pins beyond the new slot count (the last pinned goes first).
  const pins = atlas.pins?.slice(0, pinSlotCount(kept));
  const { pins: _pins, ...rest } = atlas;
  return ok({
    ...next,
    atlas: {
      ...rest, nodes: kept, ...(pins?.length ? { pins } : {}),
      ...(allocate ? {} : { refunds: (atlas.refunds ?? 0) + 1, respecSpent: (atlas.respecSpent ?? 0) + cost }),
    },
  });
}

/**
 * The frozen tree of a restored expedition. Runs persisted by the current tree carry `mapTreeV`; older runs (no
 * marker) hold the pre-Codex ids, which keep their old numbers through `legacy:` ids so a deploy never rebalances
 * an open map. Already-prefixed legacy ids stay valid.
 */
export function restoreExpeditionTree(raw: unknown, version: unknown): MapTreeNodeId[] {
  const ids = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : [];
  if (version === ATLAS_TREE_VERSION) return [...normalizeMapTree(ids, 60), ...ids.filter(id => id.startsWith(LEGACY_PREFIX) && isLegacyNodeId(id.slice(LEGACY_PREFIX.length)))];
  const out = ids.map(id => id.startsWith(LEGACY_PREFIX) ? id : legacyNodeId(id)).filter(id => isLegacyNodeId(id.slice(LEGACY_PREFIX.length)));
  return [...new Set(out)];
}
