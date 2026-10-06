// Chart lenses (brief D 3 and 11): what the chart overlays on its nodes besides the node's own state.
//   Stock      a count badge per node of the maps you hold (backpack, stash, Map Stash, work slot), tinted by their tier mix
//   Sources    "where your maps come from": the slotted map's frozen drop table drawn as arrows with shares from its home area
//   Territory  beacons and sigils (brief D 6): a ring per beacon (its chart radius), its slots, and the areas a beacon's sigils cover
// Pure and shared by the chart, the rail and the tests; the numbers of Sources are `routingReadout`'s, the very ones the sim rolls.
import type { AtlasAreaId, AtlasProgress, BeaconSlot } from '../../contracts/atlas';
import { beaconAreas, beaconCoverage, beaconRadius, beaconSlots, coveringSigils } from '../../game/progression/territory';
import { findSigil } from '../../data/progression/territory';
import type { CharacterSave, MapItem } from '../../contracts/items';
import { allItems } from '../../game/items';
import type { RoutingReadout, RoutingReadoutRow } from '../../game/progression/map-routing';

export type ChartLens = 'stock' | 'sources' | 'territory';

export interface LensDef { id: ChartLens; label: string; hint: string; /** False until its slice ships: the toggle stays hidden. */ available: boolean }

export const LENSES: readonly LensDef[] = [
  { id: 'stock', label: 'Stock', hint: 'Maps you hold, per area', available: true },
  { id: 'sources', label: 'Sources', hint: 'Where the slotted map\'s drops go', available: true },
  { id: 'territory', label: 'Territory', hint: 'Beacons, their reach and the sigils they hold', available: true },
];

export const DEFAULT_LENS: ChartLens = 'stock';

export interface StockEntry {
  areaId: AtlasAreaId;
  count: number;
  /** Tiers held, ascending (one entry per map). */
  tiers: number[];
  lowest: number;
  highest: number;
}

/** Maps by area across every place they can wait for the device (the map IN the device is the course, not stock). */
export function stockByArea(ch: Pick<CharacterSave, 'backpack' | 'stash' | 'equipment' | 'mapDevice' | 'mapScarabs' | 'mapStash' | 'craftSlot'> | null): Map<AtlasAreaId, StockEntry> {
  const out = new Map<AtlasAreaId, StockEntry>();
  if (!ch) return out;
  for (const f of allItems(ch as CharacterSave)) {
    if (f.item.kind !== 'map' || f.location.kind === 'mapDevice') continue;
    const m: MapItem = f.item;
    const e = out.get(m.areaId) ?? { areaId: m.areaId, count: 0, tiers: [], lowest: m.tier, highest: m.tier };
    e.count += 1;
    e.tiers.push(m.tier);
    e.lowest = Math.min(e.lowest, m.tier);
    e.highest = Math.max(e.highest, m.tier);
    out.set(m.areaId, e);
  }
  for (const e of out.values()) e.tiers.sort((a, b) => a - b);
  return out;
}

/** Tint of a stock badge by its deepest tier: the Map Stash's own bands (white T1-5, yellow T6-10, red T11-15). */
export function stockBand(highest: number): 'low' | 'mid' | 'high' {
  return highest <= 5 ? 'low' : highest <= 10 ? 'mid' : 'high';
}

/** One arrow of the Sources lens: the slotted map's home to one candidate, with its share of ordinary drops. */
export interface SourceEdge {
  to: AtlasAreaId;
  /** 0..1 share of an ordinary kill's map drops (0 for pending areas, which only boss and chest drops can name). */
  share: number;
  bossShare: number;
  kind: RoutingReadoutRow['kind'];
  pinned: boolean;
  pending: boolean;
  label: string;
}

const pctText = (x: number): string => `${x >= 0.995 ? 100 : x < 0.01 ? '<1' : Math.round(x * 100)}%`;
export const formatShare = pctText;

/** Arrows for the chart: every row that actually receives drops (or is pending), the area itself excluded. Strongest first. */
export function sourceEdges(readout: RoutingReadout | null): SourceEdge[] {
  if (!readout) return [];
  return readout.rows
    .filter((r) => r.areaId !== readout.from && (r.share > 0 || r.pending))
    .map((r): SourceEdge => ({ to: r.areaId, share: r.share, bossShare: r.bossShare, kind: r.kind, pinned: r.pinned, pending: r.pending,
      label: r.pending ? 'next' : formatShare(r.share) }))
    .sort((a, b) => b.share - a.share || (a.to < b.to ? -1 : 1));
}

/** The compact "Next drops" line of the dock: the top rows (the area itself included) as `Name 23%`. */
export function topSources(readout: RoutingReadout | null, n = 4): { areaId: AtlasAreaId; name: string; share: number; pinned: boolean; own: boolean }[] {
  if (!readout) return [];
  return readout.rows.filter((r) => r.share > 0).slice(0, n)
    .map((r) => ({ areaId: r.areaId, name: r.areaId === readout.from ? 'this area' : r.name, share: r.share, pinned: r.pinned, own: r.areaId === readout.from }));
}

/** One beacon on the Territory lens: where it reaches and what it holds. */
export interface BeaconView {
  areaId: AtlasAreaId;
  /** Coverage radius in chart pixels (the ring). */
  radius: number;
  slots: (BeaconSlot | null)[];
  /** Areas within reach, the beacon itself first. */
  coverage: AtlasAreaId[];
}

/** What the Territory lens draws: every beacon, and per area the sigils that reach it (with the beacon they sit in). */
export interface TerritoryView {
  beacons: BeaconView[];
  coveredBy: ReadonlyMap<AtlasAreaId, { beacon: AtlasAreaId; name: string }[]>;
}

export function territoryView(atlas: Pick<AtlasProgress, 'completed' | 'beacons' | 'nodes'> | undefined): TerritoryView {
  const beacons = beaconAreas(atlas).map((areaId): BeaconView => ({
    areaId, radius: beaconRadius(areaId, atlas?.nodes), slots: beaconSlots(atlas, areaId), coverage: beaconCoverage(areaId, atlas?.nodes),
  }));
  const coveredBy = new Map<AtlasAreaId, { beacon: AtlasAreaId; name: string }[]>();
  const areas = new Set(beacons.flatMap((b) => b.coverage));
  for (const id of areas) {
    const list = coveringSigils(atlas, id).map((c) => ({ beacon: c.beacon, name: findSigil(c.def.id)!.name }));
    if (list.length) coveredBy.set(id, list);
  }
  return { beacons, coveredBy };
}
