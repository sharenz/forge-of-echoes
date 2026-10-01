// The numbers behind the area modal's readout and the chart's Sources lens, computed by the SAME functions the server runs
// (rules.openMap's pure preview, mapEventOdds, buildRouting + routingReadout): nothing here is a second implementation.
import type { CharacterSave, MapItem } from '../../contracts/items';
import type { UiStore } from '../../contracts/ui';
import type { AtlasAreaId } from '../../contracts/atlas';
import type { AtlasAreaDef } from '../../data/progression/atlas';
import { ATLAS_START } from '../../data/progression/atlas';
import { mapEventOdds } from '../../game/progression/map-events';
import { buildRouting, routingBiasFor, routingReadout, type RoutingReadout } from '../../game/progression/map-routing';
import { safe } from '../items/hooks';

export interface DeviceReadout {
  desc: { title: string; tone: string; headerLines: string[]; affixes: { text: string; negative?: boolean; kind?: string }[] } | null;
  summary: { label: string; value: string; breakdown: string[] }[];
  luck: { itemQuantity: number; itemRarity: number } | null;
  mapLuck: { q: number; r: number } | null;
  events: Record<string, number>;
  error: string | null;
  /** The frozen drop table of the map as it would be opened now (brief D 4): where its maps go, with shares. Null without a map. */
  routing: RoutingReadout | null;
}

/** "Where your maps come from" for a map that would run `runAreaId` (its own area, or a passage destination). */
export function routingFor(ch: CharacterSave, map: MapItem, runAreaId: AtlasAreaId): RoutingReadout | null {
  const discovered = new Set<string>(ch.atlas?.discovered ?? [ATLAS_START]);
  const frozen = safe(() => buildRouting({
    from: map.areaId, runArea: runAreaId, tier: map.tier,
    bias: routingBiasFor(ch.atlas, (ch.mapScarabs ?? []).flatMap((s) => (s ? [s.currencyId] : [])) as never, { from: map.areaId }),
    ...(ch.atlas ? { atlas: ch.atlas } : {}),
  }), undefined);
  return frozen ? safe(() => routingReadout(frozen, map.tier, discovered), null) : null;
}

export interface ReadoutOptions {
  lootClass: string;
  hold: boolean;
  clockOffset: number;
  passage: { key?: string; pit?: true } | null;
}

/** The full readout of `map` run in `runArea`, including the rules' own refusal (a missing fee, a tier above the ceiling). */
export function deviceReadout(store: UiStore, ch: CharacterSave, map: MapItem, runArea: AtlasAreaDef, o: ReadoutOptions): DeviceReadout {
  const effective = { ...map, areaId: runArea.id, baseId: runArea.baseId };
  const desc = safe(() => store.rules.describeItem(effective, ch), null);
  // openMap is pure: preview the run setup to compute this player's personal luck exactly.
  const preview = safe(() => store.rules.openMap(ch, { lootClass: o.lootClass as never, useSurge: o.hold, now: Date.now() + o.clockOffset, ...(o.passage?.key ? { passage: { kind: 'key' as const, currencyId: o.passage.key as never } } : o.passage?.pit ? { passage: { kind: 'bounty' as const } } : {}) }), null);
  const summary = preview?.ok ? preview.value.setup.summary : safe(() => store.rules.mapSummary(ch, effective), []);
  const luck = preview && preview.ok ? safe(() => store.rules.lootLuck(preview.value.setup, ch), null) : null;
  const mapLuck = preview && preview.ok ? { q: preview.value.setup.itemQuantity, r: preview.value.setup.itemRarity } : null;
  return { desc, summary, luck, mapLuck, routing: routingFor(ch, map, runArea.id), events: mapEventOdds(effective, runArea.id, ch.atlas?.nodes), error: preview && !preview.ok ? preview.error : null } as unknown as DeviceReadout;
}
