// The Atlas view model: everything the chart, tooltip, rail and dock need to know about a node, derived from the
// account's progress and the slotted map. Pure, so tests can cover every state of the brief's state table (5.2).
import type { AtlasAreaId } from '../../contracts/atlas';
import { ATLAS_AREAS, atlasTierCeiling, findAtlasArea, type AtlasAreaDef } from '../../data/progression/atlas';
import { CURRENCIES } from '../../data/items';
import { ATLAS_POS, CHART_H, CHART_W, crownPips, keyOfArea, materialOf, tierBand, tierRivets, type Material } from '../../art/atlas/geometry';

export interface ChartContext {
  discovered: ReadonlySet<string>;
  completed: ReadonlySet<string>;
  /** Tier of the map in the device (null when empty). */
  tier: number | null;
  /** Currency ids owned (stash, pack) - keys for sealed doors. */
  keys: ReadonlySet<string>;
  /** Newly revealed and not yet inspected. */
  fresh: ReadonlySet<string>;
  corrupted: boolean;
}

export type NodeKind = 'undiscovered' | 'available' | 'cleared' | 'sealedLocked' | 'sealedKeyed';
export interface NodeModel {
  id: AtlasAreaId;
  area: AtlasAreaDef;
  x: number;
  y: number;
  kind: NodeKind;
  known: boolean;
  completed: boolean;
  ceiling: number;
  material: Material;
  band: number;
  rivets: number;
  crowns: number;
  deadEnd: boolean;
  /** A map is slotted and its tier exceeds this area's ceiling. */
  tooShallow: boolean;
  /** A map is slotted and fits. */
  fits: boolean;
  /** The slotted map's tier equals this ceiling: the sweet spot. */
  atCeiling: boolean;
  isNew: boolean;
  keyId: string | undefined;
  /** Why "Set course" would be refused, or null. */
  blocker: string | null;
  /** One short status line for the tooltip. */
  status: string;
  label: string;
}

export function typeLabel(area: AtlasAreaDef): string {
  return area.sealed ? 'Sealed area' : ({ frontier: 'Frontier', forge: 'Forge', crypt: 'Crypt', arena: 'Arena', vault: 'Dead end', reliquary: 'Sealed area' } as const)[area.type];
}

export function nodeModel(area: AtlasAreaDef, ctx: ChartContext): NodeModel {
  const known = ctx.discovered.has(area.id);
  const completed = ctx.completed.has(area.id);
  const ceiling = atlasTierCeiling(area);
  const keyId = keyOfArea(area.id) ?? area.entranceKey;
  const hasKey = !!keyId && ctx.keys.has(keyId);
  const kind: NodeKind = !known ? 'undiscovered' : area.sealed ? (hasKey ? 'sealedKeyed' : 'sealedLocked') : completed ? 'cleared' : 'available';
  const tooShallow = known && ctx.tier !== null && ctx.tier > ceiling;
  const fits = known && ctx.tier !== null && ctx.tier <= ceiling;
  let blocker: string | null = null;
  if (!known) blocker = 'Defeat bosses to reveal this part of the Atlas.';
  else if (tooShallow) blocker = `Your Tier ${ctx.tier} map needs an area accepting T${ctx.tier}.`;
  const keyName = keyId && keyId in CURRENCIES ? CURRENCIES[keyId as keyof typeof CURRENCIES].name : 'a key';
  let status = completed ? 'Cleared' : ctx.fresh.has(area.id) ? 'New' : 'Available';
  if (area.sealed) status = hasKey ? `${keyName} in hand` : `Needs ${keyName}`;
  if (tooShallow) status = `Too shallow for T${ctx.tier}`;
  const p = ATLAS_POS[area.id];
  return {
    id: area.id, area, x: p.x, y: p.y, kind, known, completed, ceiling, material: materialOf(ceiling), band: tierBand(ceiling), rivets: tierRivets(ceiling),
    crowns: crownPips(area), deadEnd: !!area.deadEnd, tooShallow, fits, atCeiling: known && ctx.tier === ceiling, isNew: known && ctx.fresh.has(area.id),
    keyId, blocker, status, label: known ? area.name : 'Unexplored area',
  };
}

export function allNodeModels(ctx: ChartContext): NodeModel[] {
  return ATLAS_AREAS.map((a) => nodeModel(a, ctx));
}

/** Charted count for the header: discovered areas out of all. */
export const chartedCount = (discovered: ReadonlySet<string>): number => ATLAS_AREAS.filter((a) => discovered.has(a.id)).length;

/** Graph-order list of discovered nodes for Tab/arrow cycling: by depth, then by chart x. */
export function keyboardOrder(discovered: ReadonlySet<string>): AtlasAreaId[] {
  return ATLAS_AREAS.filter((a) => discovered.has(a.id)).sort((a, b) => a.depth - b.depth || ATLAS_POS[a.id].y - ATLAS_POS[b.id].y).map((a) => a.id);
}

/** The nearest discovered node from `from` in a screen direction, for arrow-key focus moves. */
export function nearestInDirection(from: AtlasAreaId, dir: 'left' | 'right' | 'up' | 'down', discovered: ReadonlySet<string>): AtlasAreaId | null {
  const o = ATLAS_POS[from];
  let best: AtlasAreaId | null = null;
  let bestScore = Infinity;
  for (const a of ATLAS_AREAS) {
    if (a.id === from || !discovered.has(a.id)) continue;
    const p = ATLAS_POS[a.id];
    const dx = p.x - o.x, dy = p.y - o.y;
    const along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy;
    const across = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 4) continue;
    const score = along + across * 1.6;
    if (score < bestScore) { bestScore = score; best = a.id; }
  }
  return best;
}

export { findAtlasArea };

/**
 * The smallest whole zoom at which the chart covers the whole viewport, so the view never floats in a void. At 1280x720
 * (a 934 x 514 viewport) that is 2x: the chart is larger than the window and pans; only a window bigger than the 3x chart
 * shows the darkened vellum continuing around it.
 */
export function fillZoom(viewW: number, viewH: number): 1 | 2 | 3 {
  for (const z of [1, 2, 3] as const) if (CHART_W * z >= viewW && CHART_H * z >= viewH) return z;
  return 3;
}
