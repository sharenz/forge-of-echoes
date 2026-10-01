// Chart-driven map-drop routing (brief D section 4): every constant of the drop table. The rules live in
// src/game/progression/map-routing.ts; nothing there hard-codes a number. First-pass values are tuned by the harness
// (tests/game-progression/routing-harness.ts, brief D 4.5 and 12): change them here and re-run it.
import { MAP_DROP_TIER_OFFSETS } from './loot';
import { mapTreeNodes } from './map-tree';

/** Base weight of each candidate class in the frozen per-expedition table (D 4.2). */
export const ROUTING_WEIGHTS = {
  /** The run's own area ("clearing an area drops maps of itself, at a lower chance"). */
  own: 1.0,
  /** A discovered neighbour (graph edge of the run's area). */
  neighbour: 1.5,
  /** A discovered dead-end neighbour: a detour is rarer than a route. */
  deadEndNeighbour: 1.0,
  /** A discovered area exactly two hops away: keeps far pins and theme scarabs meaningful and nothing stranded. */
  wander: 0.15,
  /** The next reveal of this run's boss (D 4.3); boss-kill and chest drops only. */
  pending: 1.5,
} as const;

/** Graph distance of the wander tail (areas at exactly this many hops). */
export const ROUTING_WANDER_HOPS = 2;

/** Pins (slice P1 fills the list): a pinned discovered area gets `max(base, floor) x multiplier`, at any distance. */
export const ROUTING_PIN = {
  floor: 0.5,
  multiplier: 3,
  /** Chart Keeper (tree) raises the multiplier to this. */
  chartKeeperMultiplier: 4,
} as const;

/** Pin slots: three for everyone, more through the tree (at most five). */
export const ATLAS_PIN_SLOTS_BASE = 3;
export const ATLAS_PIN_SLOTS_MAX = 5;

/** Pin slots of an account: 3, plus one per `pinSlots` node of the tree (that stat ships with the tree re-roles), at most 5. */
export function pinSlotCount(nodes: readonly string[] | undefined): number {
  const extra = mapTreeNodes(nodes ?? []).flatMap((n) => n.effects).filter((e) => String(e.stat) === 'pinSlots').reduce((n, e) => n + e.value, 0);
  return Math.min(ATLAS_PIN_SLOTS_MAX, ATLAS_PIN_SLOTS_BASE + Math.max(0, Math.floor(extra)));
}

/** Chart Keeper (tree) raises the pin multiplier. */
export const pinMultiplierFor = (nodes: readonly string[] | undefined): number =>
  (nodes ?? []).includes('chartKeeper') ? ROUTING_PIN.chartKeeperMultiplier : ROUTING_PIN.multiplier;

/** Tier of a dropped map relative to the run's: the ladder is unchanged, routing only moves the addressee (D 4.1, I1). */
export const ROUTING_TIER_OFFSETS: readonly { offset: number; weight: number }[] = MAP_DROP_TIER_OFFSETS;

/** Quality points a chest map gains instead of the tier upgrade when no deeper area can take it (D 4.4). */
export const ROUTING_NO_ADVANCE_QUALITY = 3;
