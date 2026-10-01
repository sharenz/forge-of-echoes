// The Atlas view model: everything the chart, tooltip, rail and dock need to know about a node, derived from the
// account's progress and the slotted map. Pure, so tests can cover every state of the brief's state table (5.2).
import type { AtlasAreaId } from '../../contracts/atlas';
import { ATLAS_AREAS, atlasTierCeiling, findAtlasArea, type AtlasAreaDef } from '../../data/progression/atlas';
import { CURRENCIES } from '../../data/items';
import type { StockEntry } from './lens';
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
  /** The area the slotted map opens (its bound home, or its passage destination); null with an empty device (browse-only). */
  home?: AtlasAreaId | null;
  /** Pinned areas (brief D 5.1). */
  pins?: ReadonlySet<string>;
  /** Maps held per area (the Stock lens). */
  stock?: ReadonlyMap<string, StockEntry>;
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
  /** This is where the slotted map opens (the chart's course). */
  home: boolean;
  /** This is the slotted map's area and its tier exceeds the ceiling (only an invalid binding can do that). */
  tooShallow: boolean;
  /** This is the slotted map's area and the map fits. */
  fits: boolean;
  /** The slotted map's tier equals its area's ceiling: the sweet spot. */
  atCeiling: boolean;
  isNew: boolean;
  /** The account pinned this area: its maps drop three times as often. */
  pinned: boolean;
  /** Maps of this area held in the backpack, stash or Map Stash. */
  stock: StockEntry | null;
  keyId: string | undefined;
  /** Why the area cannot be opened, or null. */
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
  const home = known && ctx.home === area.id;
  const tooShallow = home && ctx.tier !== null && ctx.tier > ceiling;
  const fits = home && ctx.tier !== null && ctx.tier <= ceiling;
  let blocker: string | null = null;
  if (!known) blocker = 'Defeat bosses to reveal this part of the Atlas.';
  else if (tooShallow) blocker = `Your Tier ${ctx.tier} map is above this area's ceiling of Tier ${ceiling}.`;
  const keyName = keyId && keyId in CURRENCIES ? CURRENCIES[keyId as keyof typeof CURRENCIES].name : 'a key';
  let status = completed ? 'Cleared' : ctx.fresh.has(area.id) ? 'New' : 'Available';
  if (area.sealed) status = hasKey ? `${keyName} in hand` : `Needs ${keyName}`;
  if (home && !tooShallow) status = 'Your map opens here';
  if (tooShallow) status = `Too shallow for T${ctx.tier}`;
  const p = ATLAS_POS[area.id];
  return {
    id: area.id, area, x: p.x, y: p.y, kind, known, completed, ceiling, home, material: materialOf(ceiling), band: tierBand(ceiling), rivets: tierRivets(ceiling),
    crowns: crownPips(area), deadEnd: !!area.deadEnd, tooShallow, fits, atCeiling: home && ctx.tier === ceiling, isNew: known && ctx.fresh.has(area.id),
    pinned: known && !!ctx.pins?.has(area.id), stock: ctx.stock?.get(area.id) ?? null,
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
 * (the table now shares the screen with the inventory: about a 768 x 480 viewport at 1280x720 and 560 x 440 at 1024x600)
 * that is 2x: the chart is larger than the window and pans; only a window bigger than the 3x chart shows the darkened
 * vellum continuing around it.
 */
export function fillZoom(viewW: number, viewH: number): 1 | 2 | 3 {
  for (const z of [1, 2, 3] as const) if (CHART_W * z >= viewW && CHART_H * z >= viewH) return z;
  return 3;
}
