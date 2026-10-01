import { THEME_ROSTER } from '../../contracts/bestiary';
import { MAX_TERRITORY_FEE } from '../../data/items/economy';
import { ATLAS_EVENT_KIND_IDS, ATLAS_TREE_VERSION, type AtlasAreaId, type AtlasEventKindId, type AtlasProgress } from '../../contracts/atlas';
import { ATLAS_AREAS, ATLAS_REVEALS_PER_BOSS, ATLAS_START, atlasTierCeiling, findAtlasArea } from '../../data/progression/atlas';
import { ATLAS_POINT_TIERS, mapTreeNodes } from '../../data/progression/map-tree';
import { ATLAS_BOSS_KINDS, mapTreePoints, normalizeMapTree } from './map-tree';
import { normalizeSurge } from './surge';
import { isMapAddress } from './map-binding';
import { pinSlotCount } from '../../data/progression/routing';
import type { CharacterSave } from '../../contracts/items';
import type { Result } from '../../contracts/game';

export { pinSlotCount };

export function newAtlas(): AtlasProgress {
  return { discovered: [ATLAS_START], completed: [], clears: 0, treeVersion: ATLAS_TREE_VERSION };
}

/** Known, unique IDs; the starting area is always usable and completed areas remain visible. Pins are clamped to what the tree allows. */
export function normalizeAtlas(raw: unknown): AtlasProgress {
  const atlas = normalizeAtlasCore(raw);
  const pins = normalizePins((raw as { pins?: unknown } | null)?.pins, atlas);
  return pins.length ? { ...atlas, pins } : atlas;
}

function normalizeAtlasCore(raw: unknown): AtlasProgress {
  if (!raw || typeof raw !== 'object') return newAtlas();
  const value = raw as Record<string, unknown>;
  const ids = (list: unknown): AtlasAreaId[] => Array.isArray(list)
    ? [...new Set(list.filter((id): id is AtlasAreaId => !!findAtlasArea(id)))] : [];
  const completed = ids(value.completed);
  const discovered = [...new Set([ATLAS_START, ...ids(value.discovered), ...completed])];
  const clears = typeof value.clears === 'number' && Number.isFinite(value.clears) ? Math.max(0, Math.floor(value.clears)) : 0;
  const ints = (list: unknown, valid: (n: number) => boolean) => Array.isArray(list)
    ? [...new Set(list.filter((n): n is number => Number.isInteger(n) && valid(n)))].sort((a, b) => a - b) : [];
  const strs = (list: unknown, valid: readonly string[]) => Array.isArray(list)
    ? valid.filter(v => list.includes(v)) : [];
  const tiersCleared = ints(value.tiersCleared, t => ATLAS_POINT_TIERS.includes(t));
  const eventsSeen = strs(value.eventsSeen, ATLAS_EVENT_KIND_IDS) as AtlasEventKindId[];
  const bossesSeen = strs(value.bossesSeen, ATLAS_BOSS_KINDS);
  const count = (v: unknown, max: number) => typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v))) : 0;
  const base: AtlasProgress = { discovered, completed, clears: Math.max(completed.length, clears), treeVersion: ATLAS_TREE_VERSION };
  if (tiersCleared.length) base.tiersCleared = tiersCleared;
  if (eventsSeen.length) base.eventsSeen = eventsSeen;
  if (bossesSeen.length) base.bossesSeen = bossesSeen;
  const refunds = count(value.refunds, 1e6), respecSpent = count(value.respecSpent, 1e6);
  if (refunds) base.refunds = refunds;
  if (respecSpent) base.respecSpent = respecSpent;
  // Codex redraw (tree edition 1 -> 2): the old 15-node allocation is dropped and refunded free, once. Points are a
  // pure function of progress, so nobody loses any: the account simply re-spends them in the new tree.
  const legacy = value.treeVersion !== ATLAS_TREE_VERSION;
  if (legacy) {
    if (Array.isArray(value.nodes) && value.nodes.length) base.redrawn = true;
    return withSurge(Array.isArray(value.nodes) ? { ...base, nodes: [] } : base, value.surge);
  }
  if (value.redrawn === true) base.redrawn = true;
  return withSurge(Array.isArray(value.nodes) ? { ...base, nodes: normalizeMapTree(value.nodes, mapTreePoints(base)) } : base, value.surge);
}

/** The daily surge ledger (brief D 7.1) rides along, clamped to the charges the allocated tree grants. */
function withSurge(atlas: AtlasProgress, raw: unknown): AtlasProgress {
  const surge = normalizeSurge(raw, atlas.nodes);
  return surge ? { ...atlas, surge } : atlas;
}

/**
 * Point credits are idempotent set insertions (a restart or repeated receipt cannot double one).
 */
export function creditTierClear(progress: AtlasProgress, tier: number): AtlasProgress {
  if (!ATLAS_POINT_TIERS.includes(tier) || progress.tiersCleared?.includes(tier)) return progress;
  return { ...progress, tiersCleared: [...(progress.tiersCleared ?? []), tier].sort((a, b) => a - b) };
}
export function creditBossKill(progress: AtlasProgress, boss: string): AtlasProgress {
  if (!ATLAS_BOSS_KINDS.includes(boss) || progress.bossesSeen?.includes(boss)) return progress;
  return { ...progress, bossesSeen: [...(progress.bossesSeen ?? []), boss] };
}
/** First completion of an encounter kind (called by the Event Director integration). */
export function creditEventCompletion(progress: AtlasProgress, kind: string): AtlasProgress {
  if (!(ATLAS_EVENT_KIND_IDS as readonly string[]).includes(kind) || progress.eventsSeen?.includes(kind as AtlasEventKindId)) return progress;
  return { ...progress, eventsSeen: [...(progress.eventsSeen ?? []), kind as AtlasEventKindId] };
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
export function discoverAfterBoss(progress: AtlasProgress, areaId: AtlasAreaId, revealRareDoor: boolean, credit: AtlasCredit = {}): {
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
  // Master Surveyor / Dead-End Devotee: the account's tree changes how many neighbours a boss reveals.
  const chance = mapTreeNodes(progress.nodes).flatMap(n => n.effects).filter(e => e.stat === 'revealChance').reduce((n, e) => n + e.value, 0) / 100;
  const whole = Math.floor(chance);
  const reveals = Math.max(0, ATLAS_REVEALS_PER_BOSS + whole + ((credit.revealRoll ?? 1) < chance - whole ? 1 : 0));
  for (const id of area.neighbours.filter((id) => !discovered.has(id) && !findAtlasArea(id)?.sealed).slice(0, reveals)) reveal(id);
  if (!area.sealed && revealRareDoor) {
    const door = ATLAS_AREAS.find((a) => a.sealed && !discovered.has(a.id));
    if (door) reveal(door.id);
  }
  let next: AtlasProgress = { ...progress, discovered: [...discovered], completed: [...new Set([...progress.completed, areaId])], clears: progress.clears + 1 };
  if (credit.tier !== undefined) next = creditTierClear(next, credit.tier);
  if (credit.boss) next = creditBossKill(next, credit.boss);
  return { progress: next, revealed };
}

/** What else a credited clear earns besides the area: the map tier cleared and the final boss killed (both first-time points). */
export interface AtlasCredit { tier?: number; boss?: string; /** 0..1 roll for the fractional extra reveal. */ revealRoll?: number }


/** Atlas territory upkeep: early maps stay free. Legacy non-Atlas rule calls have no territory fee. */
export function territoryEntryFee(tier: number, areaId?: AtlasAreaId, nodes: readonly string[] = []): number {
  if (!areaId || !findAtlasArea(areaId)) return 0;
  const discount = mapTreeNodes(nodes).flatMap(n => n.effects).filter(e => e.stat === 'territoryFee').reduce((n, e) => n + e.value, 0);
  return Math.max(0, Math.min(MAX_TERRITORY_FEE, Math.floor((tier - 1) / 3)) + discount);
}

/** Only a recorded, valid payment may be refunded. Never infer a fee for an old run. */
export function paidTerritoryFee(raw: unknown): number {
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 && raw <= MAX_TERRITORY_FEE ? raw : 0;
}

/** The extra credits of one boss-clear receipt: the map tier and the area's final boss (none on boss-less areas), plus the reveal roll. */
export function atlasCreditFor(areaId: AtlasAreaId, tier: number, revealRoll: number): AtlasCredit {
  const area = findAtlasArea(areaId);
  return { revealRoll, ...(tier > 0 ? { tier } : {}), ...(area && !area.noBoss ? { boss: THEME_ROSTER[area.baseId].boss } : {}) };
}


// ---------------------------------------------------------------------------------------------
// Pins (brief D 5.1)
// ---------------------------------------------------------------------------------------------

/** An area that can wear a pin: discovered, not sealed, not the Pit (those are passages, never drop addresses). */
export function pinnable(atlas: Pick<AtlasProgress, 'discovered'>, areaId: unknown): AtlasAreaId | null {
  const area = findAtlasArea(areaId);
  return area && isMapAddress(area) && atlas.discovered.includes(area.id) ? area.id : null;
}

/** A persisted pin list back to a valid one: known, discovered, unique, non-passage, at most the slot count (the tail is dropped). */
export function normalizePins(raw: unknown, atlas: Pick<AtlasProgress, 'discovered' | 'nodes'>): AtlasAreaId[] {
  if (!Array.isArray(raw)) return [];
  const out: AtlasAreaId[] = [];
  for (const id of raw) {
    const ok = pinnable(atlas, id);
    if (ok && !out.includes(ok)) out.push(ok);
  }
  return out.slice(0, pinSlotCount(atlas.nodes));
}

/** Why `areaId` cannot be pinned (null = it can). */
export function pinError(atlas: AtlasProgress, areaId: unknown): string | null {
  const area = findAtlasArea(areaId);
  if (!area) return 'Choose an area on the Atlas.';
  if (!atlas.discovered.includes(area.id)) return 'Defeat bosses to reveal this part of the Atlas before pinning it.';
  if (!isMapAddress(area)) return `${area.name} is opened with a key or a Bounty: maps are never dropped for it, so it cannot be pinned.`;
  if ((atlas.pins ?? []).includes(area.id)) return null;
  const slots = pinSlotCount(atlas.nodes);
  if ((atlas.pins ?? []).length >= slots) return `All ${slots} pins are in use. Unpin an area first.`;
  return null;
}

/** Pin or unpin an area (free and instant; an unpin of an area that is not pinned is a no-op). Pure. */
export function setPin(ch: CharacterSave, areaId: AtlasAreaId, pinned: boolean): Result<CharacterSave> {
  const atlas = ch.atlas ?? newAtlas();
  const pins = atlas.pins ?? [];
  if (!pinned) {
    if (!pins.includes(areaId)) return { ok: true, value: ch };
    const left = pins.filter((p) => p !== areaId);
    const { pins: _drop, ...rest } = atlas;
    return { ok: true, value: { ...ch, atlas: left.length ? { ...rest, pins: left } : rest } };
  }
  if (pins.includes(areaId)) return { ok: true, value: ch };
  const error = pinError(atlas, areaId);
  if (error) return { ok: false, error };
  return { ok: true, value: { ...ch, atlas: { ...atlas, pins: [...pins, areaId] } } };
}
