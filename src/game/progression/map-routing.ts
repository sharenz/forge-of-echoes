// Chart-driven map-drop routing (brief D section 4, slice R1). Pure and deterministic: no module state, no clock, and the only
// rng use is the single weighted draw of the area pick (it replaces the old theme draw, so the loot stream stays aligned).
//
//   buildRouting(...)   at activation: the frozen per-expedition table (RunSetup.routing)
//   routeMapDrop(...)   per drop: tier offset -> area, filtered by tier ceilings, the looter's chart and pending reveals
//   advanceTarget(...)  the chest upgrade's destination (nearest deeper area)
//   routingReadout(...) "where your maps come from", as data for the Device and the chart (computed by the same functions)
//
// Hook points: `RoutingBias` is where slice P1 (pins) and slice S1 (area-bias scarabs, Deepward) change the table. They only
// fill `routingBiasFor`; nothing else in the sim reads pins or scarabs for routing.
import type { AtlasAreaId, AtlasProgress } from '../../contracts/atlas';
import type { MapRouting, RouteKind, RunSetup } from '../../contracts/game';
import type { ScarabId } from '../../contracts/content';
import type { Rng } from '../../contracts/rng';
import { ATLAS_AREAS, ATLAS_START, atlasTierCeiling, findAtlasArea, type AtlasAreaDef } from '../../data/progression/atlas';
import { MAX_MAP_TIER, MIN_MAP_TIER } from '../../data/progression/maps';
import {
  ROUTING_NO_ADVANCE_QUALITY, ROUTING_PIN, ROUTING_TIER_OFFSETS, ROUTING_WANDER_HOPS, ROUTING_WEIGHTS, pinMultiplierFor,
} from '../../data/progression/routing';
import { discoverAfterBoss, normalizePins } from './atlas';
import { isMapAddress } from './map-binding';
import { composeRoutingBias, scarabRoutingBias } from './scarab-routing';

export { ROUTING_NO_ADVANCE_QUALITY };

// ---------------------------------------------------------------------------------------------
// Hook: pins (P1) and scarabs (S1)
// ---------------------------------------------------------------------------------------------

/** Everything that may change the table. All fields default to neutral. */
export interface RoutingBias {
  /** Pinned areas (P1): discovered, non-sealed ones get `max(base, floor) x pinMultiplier` at any distance. */
  pins?: readonly AtlasAreaId[];
  /** Pin multiplier (default 3; 4 with Chart Keeper). */
  pinMultiplier?: number;
  /** Area-bias scarabs and tree nodes (S1): a multiplier on one candidate after pins; 1 = none. */
  weightMultiplier?: (area: AtlasAreaDef, kind: RouteKind) => number;
  /** Distant areas a scarab brings into the table (S1 Hearthbound): a discovered area with a base above 0 joins at `max(base, this)` at any distance. */
  reach?: (area: AtlasAreaDef) => number;
  /** Last word on the finished candidate weights (S1 Homing: an own-area share cap). May change weights in place; never adds or removes candidates. */
  finalize?: (candidates: MapRouting['candidates']) => void;
  /** Upward tier-roll weights after Deepward scarabs (S1); default `ROUTING_TIER_OFFSETS`. */
  tierOffsets?: readonly { offset: number; weight: number }[];
  /** Percentage points added to the chest upgrade chance by Deepward (S1). */
  chestUpgradeBonus?: number;
}

export const NEUTRAL_ROUTING_BIAS: RoutingBias = {};

/**
 * The bias of one expedition: the opener's atlas (pins, tree) and the consumed scarabs. R1 returns neutral. P1 reads
 * `atlas.pins` here; S1 reads the area-bias families of `scarabs`. Keep it pure.
 */
export function routingBiasFor(atlas: AtlasProgress | undefined, scarabs: readonly ScarabId[] = [], opts: { from?: AtlasAreaId } = {}): RoutingBias {
  // Scarabs compose after pins (composeRoutingBias keeps the first bias's pins and multiplies the second's multipliers on top).
  return composeRoutingBias(pinBias(atlas), scarabRoutingBias(scarabs, opts.from));
}

/**
 * The pin part of the bias (P1, D 5.1): the account's pinned areas (valid ones only: the chart may have changed since they
 * were set) and the multiplier (3, 4 with Chart Keeper).
 */
export function pinBias(atlas: AtlasProgress | undefined): RoutingBias {
  const pins = normalizePins(atlas?.pins, { discovered: atlas?.discovered ?? [ATLAS_START], nodes: atlas?.nodes });
  return pins.length ? { pins, pinMultiplier: pinMultiplierFor(atlas?.nodes) } : NEUTRAL_ROUTING_BIAS;
}

// ---------------------------------------------------------------------------------------------
// The chart graph
// ---------------------------------------------------------------------------------------------

/** Undirected adjacency over bindable areas (sealed areas and the Pit are passages, never routing nodes). */
const ADJACENT: ReadonlyMap<AtlasAreaId, readonly AtlasAreaId[]> = (() => {
  const addresses = ATLAS_AREAS.filter(isMapAddress);
  const ok = new Set(addresses.map((a) => a.id));
  const m = new Map<AtlasAreaId, Set<AtlasAreaId>>(addresses.map((a) => [a.id, new Set<AtlasAreaId>()]));
  for (const a of addresses) for (const n of a.neighbours) if (ok.has(n)) { m.get(a.id)!.add(n); m.get(n)!.add(a.id); }
  return new Map([...m].map(([k, v]) => [k, [...v].sort()]));
})();

/** Hop distance from `from` over `through` (areas the walk may step on), among bindable areas. */
function hops(from: AtlasAreaId, through: ReadonlySet<string>): Map<AtlasAreaId, number> {
  const dist = new Map<AtlasAreaId, number>([[from, 0]]);
  const queue: AtlasAreaId[] = [from];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i];
    for (const n of ADJACENT.get(at) ?? []) {
      if (dist.has(n) || !through.has(n)) continue;
      dist.set(n, dist.get(at)! + 1);
      queue.push(n);
    }
  }
  return dist;
}

const ceilingOf = (id: AtlasAreaId): number => { const a = findAtlasArea(id); return a ? atlasTierCeiling(a) : 0; };

// ---------------------------------------------------------------------------------------------
// Building the frozen table
// ---------------------------------------------------------------------------------------------

/** Areas the boss of `runArea` will reveal for this atlas, in `discoverAfterBoss`'s order (the table's pending list, D 4.3). */
export function pendingReveals(atlas: AtlasProgress, runArea: AtlasAreaId): AtlasAreaId[] {
  // revealRoll 1 = no fractional Surveyor extra and no rare door: those are decided by the receipt roll after the run.
  return discoverAfterBoss(atlas, runArea, false, { revealRoll: 1 }).revealed
    .filter((id) => id !== runArea && isMapAddress(findAtlasArea(id)!));
}

export interface BuildRoutingInput {
  /** The map's bound area: the table is centred on it (a passage run keeps this, not the sealed destination). */
  from: AtlasAreaId;
  /** The opener's atlas. Absent = only the start area is charted. */
  atlas?: AtlasProgress;
  /** The area actually run (decides the pending reveals); defaults to `from`. */
  runArea?: AtlasAreaId;
  bias?: RoutingBias;
  /** The map's tier (decides the chest advance target); absent = no advance target. */
  tier?: number;
}

/** The frozen routing table (D 4.2 and 4.3) or undefined when `from` is not a routable area. */
export function buildRouting(input: BuildRoutingInput): MapRouting | undefined {
  const origin = findAtlasArea(input.from);
  if (!origin || !isMapAddress(origin)) return undefined;
  const bias = input.bias ?? NEUTRAL_ROUTING_BIAS;
  const atlas = input.atlas;
  const discovered = new Set<string>(atlas?.discovered ?? [ATLAS_START]);
  const pending = atlas ? pendingReveals(atlas, input.runArea ?? input.from) : [];
  const dist = hops(origin.id, discovered);
  const pins = new Set<string>(bias.pins ?? []);
  const pinMultiplier = bias.pinMultiplier ?? ROUTING_PIN.multiplier;
  const candidates: MapRouting['candidates'] = [];
  for (const area of ATLAS_AREAS) {
    if (!isMapAddress(area)) continue;
    let kind: RouteKind | undefined;
    let weight = 0;
    const d = dist.get(area.id);
    if (area.id === origin.id) { kind = 'own'; weight = ROUTING_WEIGHTS.own; }
    else if (discovered.has(area.id) && d === 1) { kind = area.deadEnd ? 'deadEnd' : 'neighbour'; weight = area.deadEnd ? ROUTING_WEIGHTS.deadEndNeighbour : ROUTING_WEIGHTS.neighbour; }
    else if (discovered.has(area.id) && d === ROUTING_WANDER_HOPS) { kind = 'wander'; weight = ROUTING_WEIGHTS.wander; }
    else if (!discovered.has(area.id) && pending.includes(area.id)) { kind = 'pending'; weight = ROUTING_WEIGHTS.pending; }
    const pinned = pins.has(area.id) && (discovered.has(area.id) || area.id === origin.id);
    // Hearthbound (S1): a charted area the scarab names joins at any distance with a base of at least its floor.
    const reach = discovered.has(area.id) ? bias.reach?.(area) ?? 0 : 0;
    if (reach > 0) { if (!kind) { kind = 'wander'; weight = reach; } else weight = Math.max(weight, reach); }
    if (!kind && !pinned) continue;
    if (pinned) { weight = Math.max(weight, ROUTING_PIN.floor) * pinMultiplier; kind ??= 'pinned'; }
    weight *= bias.weightMultiplier?.(area, kind!) ?? 1;
    if (!(weight > 0) || !Number.isFinite(weight)) continue;
    candidates.push({
      areaId: area.id, weight: Math.round(weight * 1e6) / 1e6, kind: kind!,
      ...(pinned ? { pinned: true as const } : {}), ...(kind === 'pending' ? { pending: true as const } : {}),
    });
  }
  if (!candidates.length) return undefined;
  bias.finalize?.(candidates);
  // Pending areas come last, in the order the boss reveals them (the order is part of the contract, D 4.3).
  candidates.sort((a, b) => (a.pending ? 1 : 0) - (b.pending ? 1 : 0) || (a.pending ? pending.indexOf(a.areaId) - pending.indexOf(b.areaId) : 0));
  const routing: MapRouting = {
    from: origin.id, candidates,
    tierOffsets: (bias.tierOffsets ?? ROUTING_TIER_OFFSETS).map((o) => ({ offset: o.offset, weight: o.weight })),
    chestUpgradeBonus: bias.chestUpgradeBonus ?? 0,
  };
  const advance = advanceTarget(origin.id, new Set<string>([...discovered, ...pending]), input.tier ?? 0, new Set(candidates.filter((c) => c.pinned).map((c) => c.areaId)));
  return advance ? { ...routing, advance } : routing;
}

// ---------------------------------------------------------------------------------------------
// Advance target
// ---------------------------------------------------------------------------------------------

/**
 * The completion chest's upgrade destination (D 4.4): the nearest area (BFS over `reach`, own area at distance 0) whose
 * ceiling accepts `tier + 1`; ties go to pinned areas, then the lower id. Undefined when no charted area is deeper.
 */
export function advanceTarget(from: AtlasAreaId, reach: ReadonlySet<string>, tier: number, pins: ReadonlySet<string> = new Set()): AtlasAreaId | undefined {
  const want = Math.min(MAX_MAP_TIER, tier + 1);
  if (tier >= MAX_MAP_TIER) return undefined;
  const through = new Set<string>([...reach, from]);
  const dist = hops(from, through);
  let best: { id: AtlasAreaId; d: number } | undefined;
  for (const [id, d] of dist) {
    if (ceilingOf(id) < want) continue;
    if (!best || d < best.d || (d === best.d && (pins.has(id) && !pins.has(best.id) || (pins.has(id) === pins.has(best.id) && id < best.id)))) best = { id, d };
  }
  return best?.id;
}

// ---------------------------------------------------------------------------------------------
// Picking
// ---------------------------------------------------------------------------------------------

export interface RouteQuery {
  /** The run's map tier. */
  tier: number;
  /** Tier offset rolled for this drop (-1, 0, +1; only +1 is an "upward" roll). */
  offset: number;
  /** Boss-kill and chest drops may name the pending (fogged, about to be revealed) areas. */
  pending: boolean;
  /** The looter's charted areas. Absent (simulations, no atlas): the table stands as frozen. */
  discovered?: ReadonlySet<string>;
}

export interface RoutedDrop { areaId: AtlasAreaId; tier: number }

/** The candidates a looter may receive for a query (their chart decides openability; pending only when allowed). */
function eligible(routing: MapRouting, q: RouteQuery): MapRouting['candidates'] {
  return routing.candidates.filter((c) => {
    if (c.pending && !q.pending) return false;
    if (!q.discovered) return true;
    return q.discovered.has(c.areaId) || (q.pending && (c.pending === true || c.areaId === routing.from));
  });
}

/**
 * One ordinary routing roll (D 4.1). An upward roll considers only areas whose ceiling accepts the higher tier (none -> the
 * roll becomes level); a level or downward roll considers every candidate and clamps the tier to the pick's ceiling.
 * Draws exactly one weighted pick from `rng` (none when nothing is eligible: the caller falls back). The chosen area is
 * always a map address, so the result can be opened by anyone who has charted it.
 */
export function routeMapDrop(routing: MapRouting, q: RouteQuery, rng: Rng): RoutedDrop | null {
  let list = eligible(routing, q);
  let tier = Math.max(MIN_MAP_TIER, Math.min(MAX_MAP_TIER, Math.floor(q.tier) + q.offset));
  if (q.offset > 0) {
    const up = list.filter((c) => ceilingOf(c.areaId) >= tier);
    if (up.length) list = up; else tier = Math.max(MIN_MAP_TIER, Math.min(MAX_MAP_TIER, Math.floor(q.tier)));
  }
  const pick = rng.weighted(list, (c) => c.weight);
  if (!pick) return null;
  return { areaId: pick.areaId, tier: Math.min(tier, ceilingOf(pick.areaId)) };
}

/**
 * The chest's advance target for one looter at the run tier: the frozen one when no chart is given, else a walk over the
 * looter's own chart (plus the pending reveals, which exist once the boss is dead).
 */
export function advanceFor(routing: MapRouting, tier: number, discovered?: ReadonlySet<string>): AtlasAreaId | undefined {
  if (!discovered) return routing.advance;
  const pins = new Set(routing.candidates.filter((c) => c.pinned).map((c) => c.areaId));
  const reach = new Set<string>(discovered);
  for (const c of routing.candidates) if (c.pending) reach.add(c.areaId);
  return advanceTarget(routing.from, reach, tier, pins);
}

// ---------------------------------------------------------------------------------------------
// Readout ("where your maps come from")
// ---------------------------------------------------------------------------------------------

export interface RoutingReadoutRow {
  areaId: AtlasAreaId;
  name: string;
  kind: RouteKind;
  pinned: boolean;
  /** Final table weight. */
  weight: number;
  /** Ceiling of the area: the highest tier a map of it can have. */
  ceiling: number;
  /** Share of an ordinary kill's map drops (pending areas never appear there). */
  share: number;
  /** Share of a boss-kill or chest drop (pending areas included). */
  bossShare: number;
  /** Share of an upward (+1 tier) roll: only areas accepting it. */
  upwardShare: number;
  /** Pending: revealed by this run's boss. */
  pending: boolean;
}

export interface RoutingReadout {
  from: AtlasAreaId;
  fromName: string;
  tier: number;
  rows: RoutingReadoutRow[];
  /** Ordinary shares grouped: own area, neighbours (incl. dead ends), the wander tail, pins away from the neighbourhood. */
  groups: { own: number; neighbours: number; wander: number; pinned: number };
  advance?: AtlasAreaId;
  advanceName?: string;
  /** One readable sentence per group, ready for the Device and the tooltip. */
  lines: string[];
}

const pct = (x: number): string => `${Math.round(x * 100)}%`;

/** The table as data. Shares use the same candidate rules as `routeMapDrop` (no extra assumptions). */
export function routingReadout(routing: MapRouting, tier: number, discovered?: ReadonlySet<string>): RoutingReadout {
  const t = Math.max(MIN_MAP_TIER, Math.min(MAX_MAP_TIER, Math.floor(tier)));
  const sharesOf = (q: Omit<RouteQuery, 'tier' | 'offset'> & { offset: number }): Map<string, number> => {
    let list = eligible(routing, { tier: t, ...q });
    if (q.offset > 0) {
      const up = list.filter((c) => ceilingOf(c.areaId) >= Math.min(MAX_MAP_TIER, t + q.offset));
      if (up.length) list = up;
    }
    const total = list.reduce((s, c) => s + c.weight, 0) || 1;
    return new Map(list.map((c) => [c.areaId, c.weight / total]));
  };
  const kill = sharesOf({ offset: 0, pending: false, ...(discovered ? { discovered } : {}) });
  const boss = sharesOf({ offset: 0, pending: true, ...(discovered ? { discovered } : {}) });
  const up = sharesOf({ offset: 1, pending: false, ...(discovered ? { discovered } : {}) });
  const rows = routing.candidates.map((c): RoutingReadoutRow => ({
    areaId: c.areaId, name: findAtlasArea(c.areaId)?.name ?? c.areaId, kind: c.kind ?? 'neighbour', pinned: c.pinned === true,
    weight: c.weight, ceiling: ceilingOf(c.areaId), share: kill.get(c.areaId) ?? 0, bossShare: boss.get(c.areaId) ?? 0,
    upwardShare: up.get(c.areaId) ?? 0, pending: c.pending === true,
  })).sort((a, b) => b.share - a.share || b.bossShare - a.bossShare || (a.areaId < b.areaId ? -1 : 1));
  const sum = (f: (r: RoutingReadoutRow) => boolean): number => rows.filter(f).reduce((s, r) => s + r.share, 0);
  const groups = {
    own: sum((r) => r.kind === 'own'),
    neighbours: sum((r) => r.kind === 'neighbour' || r.kind === 'deadEnd'),
    wander: sum((r) => r.kind === 'wander'),
    pinned: sum((r) => r.kind === 'pinned'),
  };
  const advance = advanceFor(routing, t, discovered);
  const from = findAtlasArea(routing.from);
  const lines = [
    `${pct(groups.own)} of dropped maps are ${from?.name ?? 'this area'} itself.`,
    `${pct(groups.neighbours)} are for the areas next to it.`,
    ...(groups.wander + groups.pinned > 0 ? [`${pct(groups.wander + groups.pinned)} wander further along the chart${groups.pinned > 0 ? ' or follow your pins' : ''}.`] : []),
    ...(rows.some((r) => r.pending) ? [`Defeating the boss can also drop maps of ${rows.filter((r) => r.pending).map((r) => r.name).join(' and ')}, the next areas to be revealed.`] : []),
    ...(advance ? [`A completion map upgrade becomes a Tier ${Math.min(MAX_MAP_TIER, t + 1)} map of ${findAtlasArea(advance)?.name ?? advance}.`] : []),
  ];
  return {
    from: routing.from, fromName: from?.name ?? routing.from, tier: t, rows, groups,
    ...(advance ? { advance, advanceName: findAtlasArea(advance)?.name ?? advance } : {}), lines,
  };
}

/** Freeze `routing` into a setup. The readout is data (`routingReadout(setup.routing, setup.map.tier)`), not a summary line: the Device renders it. */
export function attachRouting(setup: RunSetup, routing: MapRouting | undefined): void {
  if (routing) setup.routing = routing;
}

// ---------------------------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------------------------

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A persisted table back to a valid one (unknown areas, bad numbers and sealed addresses dropped); undefined when nothing is left. */
export function normalizeRouting(raw: unknown): MapRouting | undefined {
  if (!isRecord(raw)) return undefined;
  const from = findAtlasArea(raw.from);
  if (!from || !isMapAddress(from) || !Array.isArray(raw.candidates)) return undefined;
  const kinds: readonly RouteKind[] = ['own', 'neighbour', 'deadEnd', 'wander', 'pending', 'pinned'];
  const seen = new Set<string>();
  const candidates: MapRouting['candidates'] = [];
  for (const c of raw.candidates) {
    if (!isRecord(c)) continue;
    const area = findAtlasArea(c.areaId);
    if (!area || !isMapAddress(area) || seen.has(area.id)) continue;
    const weight = typeof c.weight === 'number' && Number.isFinite(c.weight) ? c.weight : 0;
    if (!(weight > 0) || weight > 1000) continue;
    seen.add(area.id);
    const kind = kinds.find((k) => k === c.kind);
    candidates.push({ areaId: area.id, weight, ...(kind ? { kind } : {}), ...(c.pinned === true ? { pinned: true as const } : {}), ...(c.pending === true ? { pending: true as const } : {}) });
  }
  if (!candidates.length) return undefined;
  const offsets = Array.isArray(raw.tierOffsets)
    ? raw.tierOffsets.filter((o): o is { offset: number; weight: number } => isRecord(o) && Number.isInteger(o.offset) && Math.abs(o.offset as number) <= 1
      && typeof o.weight === 'number' && Number.isFinite(o.weight) && o.weight >= 0).map((o) => ({ offset: o.offset, weight: o.weight }))
    : [];
  const bonus = typeof raw.chestUpgradeBonus === 'number' && Number.isFinite(raw.chestUpgradeBonus) ? Math.max(0, Math.min(100, raw.chestUpgradeBonus)) : 0;
  const advance = findAtlasArea(raw.advance);
  return {
    from: from.id, candidates,
    ...(advance && isMapAddress(advance) ? { advance: advance.id } : {}),
    tierOffsets: offsets.length ? offsets : ROUTING_TIER_OFFSETS.map((o) => ({ ...o })),
    chestUpgradeBonus: bonus,
  };
}
