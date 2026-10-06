import { mapTreeBonuses } from '../../data/progression/map-tree';
import type { AtlasAreaId, MapTreeNodeId } from '../../contracts/atlas';
import type { MapItem } from '../../contracts/items';
import { MAP_EVENT_KINDS, type MapEventKind, type MapEventPlan } from '../../contracts/map-events';
import { createRng } from '../../core/rng';
import { findAtlasArea } from '../../data/progression/atlas';
import {
  AREA_EVENT_BONUS, MAP_EVENT_BASE_CHANCE, MAP_EVENT_MAX_CHANCE, MAP_EVENT_MAX_SLOTS, MAP_EVENT_MIN_TIER, MAP_EVENT_SECOND_CHANCE,
  MAP_EVENT_UNPOOLED, MAP_EVENT_WINDOW, MOD_EVENT_BONUS,
} from '../../data/progression/map-events';

/**
 * Lenses the Atlas tree, scarabs and map mods put on the event slate (all optional and neutral when absent). Stream B's
 * tree nodes fill this in; see docs/atlas-rework/tree-events-interface.md.
 */
export interface MapEventSlateModifiers {
  /** Added to the chance of at least one event (absolute, 0.05 = 5 percentage points). */
  chance?: number;
  /** Additional concurrent slots beyond the base two (Twin Omens: 1). The total never exceeds MAP_EVENT_MAX_SLOTS. */
  extraSlots?: number;
  /** Multiplies one kind's weight (an Omen scarab: 2). */
  kindWeight?: Partial<Record<MapEventKind, number>>;
  /**
   * Kinds forced as the first plan of the slate (Voidtouched Atlas: a corrupted map always rolls a Void Breach). Only kinds the
   * map's tier allows are forced, except an unpooled kind, which is forced at any tier.
   */
  forced?: readonly MapEventKind[];
  /**
   * Omen sigils (brief D 6.3): absolute chance added after the area odds and the tree, outside the tree's cap but never pushing the
   * chance past MAP_EVENT_MAX_CHANCE (a chance already above it, e.g. Shrine Field, is not raised further).
   */
  territoryChance?: number;
}

function treeChance(nodes: readonly MapTreeNodeId[]): number {
  return (mapTreeBonuses(nodes) as { eventChance?: number }).eventChance ?? 0;
}

/**
 * Public odds: the chance that a random map draws each kind as its FIRST event (they sum to the chance of at least one
 * event). The actual creation roll is server-only.
 */
export function mapEventOdds(map: MapItem, areaId?: AtlasAreaId, nodes: readonly MapTreeNodeId[] = [], slate: MapEventSlateModifiers = {}): Record<MapEventKind, number> {
  const odds = Object.fromEntries(MAP_EVENT_KINDS.map(k => [k, 0])) as Record<MapEventKind, number>;
  const area = findAtlasArea(areaId);
  if (area?.encounters) {
    for (const e of area.encounters) odds[e.kind] = 1;
    if (map.bounty) odds.hunted = 1;
    return odds;
  }
  if (map.bounty) return { ...odds, hunted: 1 };
  const eligible = MAP_EVENT_KINDS.filter(k => map.tier >= MAP_EVENT_MIN_TIER[k] && !MAP_EVENT_UNPOOLED.includes(k) && !(area?.noBoss && k === 'secondCrown'));
  const modBonuses = [...new Set(map.mods.map(m => m.modId))].map(id => MOD_EVENT_BONUS[id]);
  const bonuses = [area ? AREA_EVENT_BONUS[area.type] : undefined, ...modBonuses];
  for (const kind of eligible) odds[kind] = (MAP_EVENT_BASE_CHANCE / eligible.length
    + bonuses.reduce((sum, bonus) => sum + (bonus?.[kind] ?? 0), 0)) * (slate.kindWeight?.[kind] ?? 1);
  const total = Object.values(odds).reduce((sum, n) => sum + n, 0);
  const scale = area?.eventMultiplier ? Math.min(area.eventMultiplier, 1 / total) : Math.min(1, MAP_EVENT_MAX_CHANCE / total);
  const current = total * scale;
  let boosted = Math.min(1, current + treeChance(nodes) + (slate.chance ?? 0));
  if (slate.territoryChance && slate.territoryChance > 0) boosted = Math.max(boosted, Math.min(MAP_EVENT_MAX_CHANCE, boosted + slate.territoryChance));
  for (const kind of MAP_EVENT_KINDS) odds[kind] *= scale * (current > 0 ? boosted / current : 1);
  return odds;
}

/** Wave for a plan of `kind` in its window, avoiding the waves in `taken` when it can. */
function pickWave(rng: ReturnType<typeof createRng>, kind: MapEventKind, taken: readonly number[]): number | null {
  const [lo, hi] = MAP_EVENT_WINDOW[kind];
  const free: number[] = [];
  for (let w = lo; w <= hi; w++) if (!taken.includes(w)) free.push(w);
  return free.length === 0 ? null : free[rng.int(0, free.length - 1)];
}

/** How many events the map may draw at most: two, or three with Twin Omens; sealed presets ignore it. */
export function mapEventSlots(slate: MapEventSlateModifiers = {}): number {
  return Math.min(MAP_EVENT_MAX_SLOTS, 2 + Math.max(0, Math.floor(slate.extraSlots ?? 0)));
}

export function rollMapEvent(map: MapItem, seed: number, areaId?: AtlasAreaId, nodes: readonly MapTreeNodeId[] = [], slate: MapEventSlateModifiers = {}): MapEventPlan | null {
  const odds = mapEventOdds(map, areaId, nodes, slate);
  // Independent of combat, layout and loot rolls, fixed at map creation.
  const rng = createRng(seed).fork(0xe7e175);
  const area = findAtlasArea(areaId);
  if (area?.encounters) {
    const sequence = [...area.encounters];
    if (map.bounty && !sequence.some(e => e.kind === 'hunted')) sequence.unshift({ kind: 'hunted', wave: 2 });
    let next: MapEventPlan | undefined;
    for (let i = sequence.length - 1; i >= 0; i--) next = { ...sequence[i], required: true,
      angle: rng.range(0, Math.PI * 2), variant: rng.int(0, 255), ...(next ? { next } : {}) };
    return next!;
  }
  const draw = (weights: Record<MapEventKind, number>, taken: readonly number[]): MapEventPlan | null => {
    const total = MAP_EVENT_KINDS.reduce((s, k) => s + weights[k], 0);
    if (total <= 0) return null;
    let roll = rng.next() * total;
    for (const kind of MAP_EVENT_KINDS) {
      if (roll < weights[kind]) {
        const wave = pickWave(rng, kind, taken);
        return wave === null ? null : { kind, wave, angle: rng.range(0, Math.PI * 2), variant: rng.int(0, 255) };
      }
      roll -= weights[kind];
    }
    return null;
  };
  // The first draw keeps the public odds exactly: at least one event with the displayed chance.
  let roll = rng.next();
  let first: MapEventPlan | null = null;
  const forced = (slate.forced ?? []).find(k => MAP_EVENT_UNPOOLED.includes(k) || map.tier >= MAP_EVENT_MIN_TIER[k]);
  if (forced) {
    const wave = pickWave(rng, forced, []);
    if (wave !== null) first = { kind: forced, wave, angle: rng.range(0, Math.PI * 2), variant: rng.int(0, 255) };
    roll = 2;
  }
  for (const kind of MAP_EVENT_KINDS) {
    if (roll < odds[kind]) {
      const wave = pickWave(rng, kind, []);
      if (wave !== null) first = { kind, wave, angle: rng.range(0, Math.PI * 2), variant: rng.int(0, 255) };
      break;
    }
    roll -= odds[kind];
  }
  if (!first || map.bounty) return first;
  // More slots: each extra slot is a fresh draw from the other kinds, in another wave.
  const slots = mapEventSlots(slate);
  const plans: MapEventPlan[] = [first];
  for (let slot = 1; slot < slots; slot++) {
    if (!rng.chance(slot === 1 ? MAP_EVENT_SECOND_CHANCE : MAP_EVENT_SECOND_CHANCE / 2)) break;
    const weights = { ...odds };
    for (const p of plans) weights[p.kind] = 0;
    const plan = draw(weights, plans.map(p => p.wave));
    if (!plan) break;
    plans.push(plan);
  }
  for (let i = plans.length - 2; i >= 0; i--) plans[i] = { ...plans[i], also: plans[i + 1] };
  return plans[0];
}

/** Every plan of a slate and its sequence, flattened (a plan, its `next` chain and its concurrent `also` plans). */
export function flattenMapEvents(plan: MapEventPlan | null | undefined): MapEventPlan[] {
  const out: MapEventPlan[] = [];
  const visit = (p: MapEventPlan | undefined) => {
    for (; p; p = p.next) { out.push(p); visit(p.also); }
  };
  visit(plan ?? undefined);
  return out;
}

export function normalizeMapEvent(raw: unknown, depth = 0): MapEventPlan | null {
  if (depth >= 4) return null;
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Partial<MapEventPlan>;
  if (!v.kind || !(MAP_EVENT_KINDS as readonly string[]).includes(v.kind) || typeof v.wave !== 'number'
      || typeof v.angle !== 'number' || !Number.isFinite(v.angle)) return null;
  // Older saves may hold any regular wave (2..5) for a random plan; the boss-time event always sits on wave 6.
  const inWindow = v.kind === 'secondCrown' ? v.wave === 6 : v.wave >= 2 && v.wave <= 5;
  if (!Number.isInteger(v.wave) || !inWindow) return null;
  const next = normalizeMapEvent(v.next, depth + 1);
  const also = normalizeMapEvent(v.also, depth + 1);
  const variant = typeof v.variant === 'number' && Number.isInteger(v.variant) && v.variant >= 0 && v.variant <= 255 ? v.variant : undefined;
  return { kind: v.kind, wave: v.wave, angle: v.angle % (Math.PI * 2),
    ...(variant !== undefined ? { variant } : {}),
    ...(v.required === true ? { required: true } : {}), ...(next ? { next } : {}), ...(also ? { also } : {}) };
}
