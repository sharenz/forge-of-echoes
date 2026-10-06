// Territory layer: beacons and sigils (brief D 6, slice B1). Pure rules; every number lives in data/progression/territory.ts.
//
//   beaconSlotCount / beaconRadius / beaconCoverage   which areas are beacons, how many slots, which areas they cover (chart pixels)
//   coveringSigils(atlas, areaId)                     the slotted sigils whose beacon covers an area (the chart, the modal, activation)
//   territoryFor(...)                                 at activation: the sigils that apply to this run with their stacking share
//   spendTerritoryUses / refundTerritoryUses          one use per applied sigil at activation; a server-loss refund gives it back
//   territoryModifiers / territoryEventChance / ...   what a frozen RunSetup.territory does (map modifiers, events, reveals, loot weights)
//   slotSigil / unslotSigil                           the hideout commands (inventory first: the sigil comes out of the backpack)
//   normalizeBeacons / normalizeRunTerritory          persistence (account Atlas, frozen expedition)
//
// The beacon ledger lives on the account's Atlas (`atlas.beacons`), so every character of an account shares it. A run freezes the
// sigils that applied into `RunSetup.territory` (I5): a restart, a party join or a later change to the beacons cannot change it.
import type { AtlasAreaId, AtlasProgress, BeaconSlot, MapTreeNodeId } from '../../contracts/atlas';
import type { CurrencyId, ItemClass, MapBaseId, SigilId, SigilKind, SigilStrength } from '../../contracts/content';
import type { CharacterSave, MapItem } from '../../contracts/items';
import type { MapSummaryLine, Result, RunSetup, RunTerritory } from '../../contracts/game';
import { ATLAS_AREAS, findAtlasArea, type AtlasAreaDef } from '../../data/progression/atlas';
import { ATLAS_POS } from '../../data/progression/atlas-chart';
import { atlasNodeAllocatable, mapTreeNodes } from '../../data/progression/map-tree';
import {
  BEACON_RADIUS, BEACON_SLOTS, SIGIL_MAX_USES, SIGIL_SECONDARY_SHARE, SIGIL_USES, SIGIL_VALUES, THEME_SIGIL_CLASS_WEIGHT, TIDE,
  findSigil, sigilEffectText, type SigilDef,
} from '../../data/progression/territory';
import type { MapStat } from '../../data/progression';
import { addToBackpack, currencyStack, findItem, mintUid, setStackCount } from '../items';
import type { MapModifier } from './maps';
import { fail, ok } from './util';

// ---------------------------------------------------------------------------------------------
// Tree
// ---------------------------------------------------------------------------------------------

function treeTotal(nodes: readonly MapTreeNodeId[] | undefined, stat: MapStat): number {
  let n = 0;
  for (const node of mapTreeNodes(nodes ?? []).filter(atlasNodeAllocatable)) for (const e of node.effects) if (e.stat === stat) n += e.value;
  return n;
}

// ---------------------------------------------------------------------------------------------
// Beacons: slots, radius, coverage
// ---------------------------------------------------------------------------------------------

const deadEndOf = (area: AtlasAreaDef): boolean => area.deadEnd === true;

/** Sigil slots of an area's beacon (D 6.1): 1 or 2; Lightkeeper gives every one-slot beacon a second slot. 0 for an unknown area. */
export function beaconSlotCount(areaId: unknown, nodes?: readonly MapTreeNodeId[]): number {
  const area = findAtlasArea(areaId);
  if (!area) return 0;
  const base = area.sealed ? BEACON_SLOTS.sealed
    : deadEndOf(area) ? BEACON_SLOTS.deadEnd
      : area.depth >= BEACON_SLOTS.deepFromDepth ? BEACON_SLOTS.deep : BEACON_SLOTS.shallow;
  const extra = base === 1 ? Math.max(0, Math.floor(treeTotal(nodes, 'beaconSlots'))) : 0;
  return Math.min(BEACON_SLOTS.max, base + extra);
}

/** Coverage radius in chart pixels (D 6.2): by depth, sealed areas smaller, dead ends wider; Survey Stake adds its pixels. */
export function beaconRadius(areaId: unknown, nodes?: readonly MapTreeNodeId[]): number {
  const area = findAtlasArea(areaId);
  if (!area) return 0;
  const base = area.sealed ? BEACON_RADIUS.sealed
    : area.depth >= BEACON_RADIUS.deepFromDepth ? BEACON_RADIUS.deep
      : area.depth >= BEACON_RADIUS.middleFromDepth ? BEACON_RADIUS.middle : BEACON_RADIUS.shallow;
  return base + (deadEndOf(area) ? BEACON_RADIUS.deadEndBonus : 0) + Math.max(0, treeTotal(nodes, 'beaconRadius'));
}

/** Distance between two node centres on the chart (art pixels). */
export function chartDistance(a: AtlasAreaId, b: AtlasAreaId): number {
  const p = ATLAS_POS[a], q = ATLAS_POS[b];
  return Math.hypot(p.x - q.x, p.y - q.y);
}

/** Every area a beacon at `areaId` covers, the beacon's own area first, then the others in `ATLAS_AREAS` order. */
export function beaconCoverage(areaId: AtlasAreaId, nodes?: readonly MapTreeNodeId[]): AtlasAreaId[] {
  const r = beaconRadius(areaId, nodes);
  if (r <= 0) return [];
  return [areaId, ...ATLAS_AREAS.filter((a) => a.id !== areaId && chartDistance(areaId, a.id) <= r).map((a) => a.id)];
}

/** Whether a beacon at `beaconId` covers `areaId` (its own area always). */
export function covers(beaconId: AtlasAreaId, areaId: AtlasAreaId, nodes?: readonly MapTreeNodeId[]): boolean {
  return beaconId === areaId || chartDistance(beaconId, areaId) <= beaconRadius(beaconId, nodes);
}

/** The account's beacons: every completed area (D 6.1), in `ATLAS_AREAS` order. */
export function beaconAreas(atlas: Pick<AtlasProgress, 'completed'> | undefined): AtlasAreaId[] {
  const done = new Set(atlas?.completed ?? []);
  return ATLAS_AREAS.filter((a) => done.has(a.id)).map((a) => a.id);
}

/** A beacon's slots as stored, padded with nulls to its slot count. */
export function beaconSlots(atlas: Pick<AtlasProgress, 'beacons' | 'nodes'> | undefined, areaId: AtlasAreaId): (BeaconSlot | null)[] {
  const n = beaconSlotCount(areaId, atlas?.nodes);
  const stored = atlas?.beacons?.[areaId] ?? [];
  return Array.from({ length: n }, (_, i) => stored[i] ?? null);
}

/** Uses a freshly slotted sigil gets: 12 (Faint, Bright) or 10 (Blazing), plus Lamp Oil. */
export function sigilFullUses(strength: SigilStrength, nodes?: readonly MapTreeNodeId[]): number {
  return Math.min(SIGIL_MAX_USES, SIGIL_USES[strength] + Math.max(0, Math.floor(treeTotal(nodes, 'sigilUses'))));
}

/** One slotted sigil that covers an area. */
export interface CoveringSigil {
  beacon: AtlasAreaId;
  slot: number;
  def: SigilDef;
  uses: number;
}

/** The slotted sigils whose beacon covers `areaId` (completed beacons only), in beacon then slot order. */
export function coveringSigils(atlas: Pick<AtlasProgress, 'completed' | 'beacons' | 'nodes'> | undefined, areaId: AtlasAreaId): CoveringSigil[] {
  const out: CoveringSigil[] = [];
  if (!atlas?.beacons) return out;
  for (const beacon of beaconAreas(atlas)) {
    if (!covers(beacon, areaId, atlas.nodes)) continue;
    beaconSlots(atlas, beacon).forEach((s, slot) => {
      const def = s ? findSigil(s.sigilId) : undefined;
      if (s && def && s.uses > 0) out.push({ beacon, slot, def, uses: s.uses });
    });
  }
  return out;
}

/** Extra daily surge charges on `areaId` from covering Tide sigils (Bright and Blazing): the strongest counts, a second adds nothing. */
export function tideCharges(atlas: Pick<AtlasProgress, 'completed' | 'beacons' | 'nodes'> | undefined, areaId: AtlasAreaId): number {
  return coveringSigils(atlas, areaId).some((c) => c.def.kind === 'tide' && c.def.strength >= 2) ? TIDE.charges : 0;
}

// ---------------------------------------------------------------------------------------------
// Activation: which sigils apply, stacking, uses
// ---------------------------------------------------------------------------------------------

/** What a run looks like to the applicability check: the run area, the effective map and whether a surge charge was used. */
export interface TerritoryRunContext {
  area: AtlasAreaDef;
  map: Pick<MapItem, 'baseId' | 'tier' | 'bounty'>;
  /** The run spent (or kept) a surge charge: Tide works only then. */
  surge: boolean;
  /** The map can draw a random encounter (Omen has nothing to raise otherwise). Default true. */
  encounters?: boolean;
}

const deadOrSealed = (area: AtlasAreaDef): boolean => area.deadEnd === true || area.sealed === true;

/** Whether a sigil's effect does anything on this run (a sigil that does nothing spends no use, D 6.3). */
export function sigilApplies(def: SigilDef, run: TerritoryRunContext): boolean {
  switch (def.kind) {
    case 'omen': return run.encounters !== false && !run.area.encounters && !run.map.bounty;
    case 'hoard': return deadOrSealed(run.area);
    case 'fortune': return true;
    case 'ingredient': return !run.area.noBoss && (run.area.ingredientDrops ?? []).some((d) => run.map.tier >= d.minTier);
    case 'survey': return !run.area.sealed;
    case 'tide': return run.surge;
    default: return !!def.theme && def.theme.baseId === run.map.baseId;
  }
}

/**
 * The sigils that apply to a run in `run.area`, with their share (D 6.3 stacking): per kind the strongest at 100% (ties: beacon order,
 * then slot), every other one of that kind at 50%. Different kinds add. Frozen into `RunSetup.territory`.
 */
export function territoryFor(atlas: Pick<AtlasProgress, 'completed' | 'beacons' | 'nodes'> | undefined, run: TerritoryRunContext): RunTerritory[] {
  const applied = coveringSigils(atlas, run.area.id).filter((c) => sigilApplies(c.def, run));
  const ranked = applied.map((c, i) => ({ c, i })).sort((a, b) => b.c.def.strength - a.c.def.strength || a.i - b.i);
  const seen = new Set<SigilKind>();
  const share = new Map<number, number>();
  for (const { c, i } of ranked) {
    share.set(i, seen.has(c.def.kind) ? SIGIL_SECONDARY_SHARE : 1);
    seen.add(c.def.kind);
  }
  return applied.map((c, i) => ({ sigilId: c.def.id, fromAreaId: c.beacon, slot: c.slot, share: share.get(i)! }));
}

/** The surge levers of the covering Tide sigils at activation (before we know whether a charge is spent). */
export function tideSurge(atlas: Pick<AtlasProgress, 'completed' | 'beacons' | 'nodes'> | undefined, areaId: AtlasAreaId): { bonusMultiplier: number; keepChance: number } {
  const tides = coveringSigils(atlas, areaId).filter((c) => c.def.kind === 'tide').sort((a, b) => b.def.strength - a.def.strength);
  let bonus = 1, keep = 0;
  tides.forEach((c, i) => {
    const share = i === 0 ? 1 : SIGIL_SECONDARY_SHARE;
    if (c.def.strength === 1) bonus *= 1 + (TIDE.bonusMultiplier - 1) * share;
    if (c.def.strength === 3) keep = 1 - (1 - keep) * (1 - TIDE.keepChance * share);
  });
  return { bonusMultiplier: bonus, keepChance: keep };
}

export interface BeaconEmptied { areaId: AtlasAreaId; slot: number; sigilId: SigilId }

/** Spend one use of every applied sigil (D 6.3); a slot at 0 uses empties. Returns the new Atlas and the slots that emptied (the banner). */
export function spendTerritoryUses(atlas: AtlasProgress, entries: readonly RunTerritory[]): { atlas: AtlasProgress; emptied: BeaconEmptied[] } {
  if (!entries.length || !atlas.beacons) return { atlas, emptied: [] };
  const beacons = { ...atlas.beacons };
  const emptied: BeaconEmptied[] = [];
  for (const e of entries) {
    const slots = [...(beacons[e.fromAreaId] ?? [])];
    const s = slots[e.slot];
    if (!s || s.sigilId !== e.sigilId || s.uses <= 0) continue;
    if (s.uses <= 1) { slots[e.slot] = null; emptied.push({ areaId: e.fromAreaId, slot: e.slot, sigilId: e.sigilId }); }
    else slots[e.slot] = { ...s, uses: s.uses - 1 };
    beacons[e.fromAreaId] = slots;
  }
  return { atlas: { ...atlas, beacons: compactBeacons(beacons) }, emptied };
}

/**
 * Give back the uses an unrestorable expedition spent (D 2.2: only a server failure refunds). Exact for a slot still holding the same sigil;
 * a slot the run emptied gets the sigil back with one use (it cannot be taken out "unused"); a slot that now holds another sigil is left alone.
 */
export function refundTerritoryUses(atlas: AtlasProgress | undefined, entries: readonly RunTerritory[] | undefined): AtlasProgress | undefined {
  if (!atlas || !entries?.length) return atlas;
  const beacons = { ...(atlas.beacons ?? {}) };
  let changed = false;
  for (const e of entries) {
    const def = findSigil(e.sigilId);
    if (!def || !atlas.completed.includes(e.fromAreaId) || e.slot >= beaconSlotCount(e.fromAreaId, atlas.nodes)) continue;
    const slots = beaconSlots({ ...atlas, beacons }, e.fromAreaId);
    const s = slots[e.slot];
    if (s && s.sigilId === e.sigilId) slots[e.slot] = { ...s, uses: Math.min(SIGIL_MAX_USES, s.uses + 1) };
    else if (!s) slots[e.slot] = { sigilId: e.sigilId, uses: 1, max: sigilFullUses(def.strength, atlas.nodes) };
    else continue;
    beacons[e.fromAreaId] = slots;
    changed = true;
  }
  return changed ? { ...atlas, beacons: compactBeacons(beacons) } : atlas;
}

/** Drop beacons whose slots are all empty (an Atlas without sigils carries no `beacons` noise). */
function compactBeacons(beacons: NonNullable<AtlasProgress['beacons']>): AtlasProgress['beacons'] {
  const out: NonNullable<AtlasProgress['beacons']> = {};
  for (const [id, slots] of Object.entries(beacons) as [AtlasAreaId, (BeaconSlot | null)[]][]) {
    if (!slots?.some(Boolean)) continue;
    let end = slots.length;
    while (end > 0 && !slots[end - 1]) end--;
    out[id] = slots.slice(0, end).map((s) => s ?? null);
  }
  return out;
}

const withBeacons = (atlas: AtlasProgress, beacons: NonNullable<AtlasProgress['beacons']>): AtlasProgress => {
  const compact = compactBeacons(beacons);
  const { beacons: _drop, ...rest } = atlas;
  return compact && Object.keys(compact).length ? { ...rest, beacons: compact } : rest;
};

// ---------------------------------------------------------------------------------------------
// What a frozen RunSetup.territory does
// ---------------------------------------------------------------------------------------------

interface ResolvedEntry { entry: RunTerritory; def: SigilDef; source: string }

function resolved(territory: readonly RunTerritory[] | undefined): ResolvedEntry[] {
  const out: ResolvedEntry[] = [];
  for (const entry of territory ?? []) {
    const def = findSigil(entry.sigilId);
    if (!def) continue;
    out.push({ entry, def, source: `Territory: ${def.name} (${findAtlasArea(entry.fromAreaId)?.name ?? 'a beacon'})` });
  }
  return out;
}

/**
 * The map modifiers of the run's sigils (Fortune, Hoard, Ingredient), labelled `Territory: <sigil> (<beacon>)` so readouts and luck
 * breakdowns name them. Hoard and the theme sigils re-check their condition (a restored run's area or theme never changes, but be exact).
 */
export function territoryModifiers(territory: readonly RunTerritory[] | undefined, ctx: { areaId?: AtlasAreaId; baseId: MapBaseId }): MapModifier[] {
  const out: MapModifier[] = [];
  const area = findAtlasArea(ctx.areaId);
  for (const { entry, def, source } of resolved(territory)) {
    const s = def.strength;
    switch (def.kind) {
      case 'fortune': out.push({ stat: 'itemRarity', mode: 'increased', value: SIGIL_VALUES.fortune[s] * entry.share, source }); break;
      case 'hoard': if (area && deadOrSealed(area)) out.push({ stat: 'itemQuantity', mode: 'increased', value: SIGIL_VALUES.hoard[s] * entry.share, source }); break;
      case 'ingredient': out.push({ stat: 'bossIngredientChance', mode: 'more', value: SIGIL_VALUES.ingredient[s] * entry.share, source }); break;
      default: break;
    }
  }
  return out;
}

/** Omen: absolute encounter chance added after the area odds (0.04 = 4 percentage points). Not part of the tree's cap. */
export function territoryEventChance(territory: readonly RunTerritory[] | undefined): number {
  return resolved(territory).filter((r) => r.def.kind === 'omen').reduce((n, r) => n + SIGIL_VALUES.omen[r.def.strength] * r.entry.share, 0) / 100;
}

/** Survey: the extra-reveal chance (0..1) added to Master Surveyor's fraction for this run's boss kill. */
export function territoryRevealChance(territory: readonly RunTerritory[] | undefined): number {
  return resolved(territory).filter((r) => r.def.kind === 'survey').reduce((n, r) => n + SIGIL_VALUES.survey[r.def.strength] * r.entry.share, 0) / 100;
}

/** Theme sigils: the multiplier on one currency's drop weight on a map of `baseId` (1 = unchanged). */
export function territoryCurrencyWeight(territory: readonly RunTerritory[] | undefined, currencyId: CurrencyId, baseId: MapBaseId): number {
  let m = 1;
  for (const { entry, def } of resolved(territory)) {
    if (def.theme && def.theme.baseId === baseId && def.theme.currencyId === currencyId) m *= 1 + SIGIL_VALUES.theme[def.strength] * entry.share / 100;
  }
  return m;
}

/** Theme sigils: the area's favoured item classes each gain +1 weight (x share) on a map of the theme. Undefined = the area's own weights. */
export function territoryClassWeights(territory: readonly RunTerritory[] | undefined, area: AtlasAreaDef | undefined, baseId: MapBaseId): Partial<Record<ItemClass, number>> | undefined {
  const own = area?.classWeights;
  if (!own) return own;
  const add = resolved(territory).filter((r) => r.def.theme?.baseId === baseId).reduce((n, r) => n + THEME_SIGIL_CLASS_WEIGHT * r.entry.share, 0);
  if (add <= 0) return own;
  return Object.fromEntries(Object.entries(own).map(([k, w]) => [k, (w ?? 1) + add])) as Partial<Record<ItemClass, number>>;
}

/** Readout lines (`Territory: <sigil> (<beacon>)`): one per applied sigil. */
export function territoryLines(territory: readonly RunTerritory[] | undefined): string[] {
  return resolved(territory).map(({ entry, def, source }) => `${source}: ${sigilEffectText(def, entry.share)}${entry.share < 1 ? ' (a second sigil of its kind works at half strength)' : ''}`);
}

/** Freeze `territory` into a run setup and add its readout line (openMap and restoreRunSetup, so both show the same). */
export function attachTerritory(setup: RunSetup, territory: readonly RunTerritory[]): void {
  if (!territory.length) return;
  setup.territory = territory.map((t) => ({ ...t }));
  const line: MapSummaryLine = {
    label: 'Territory',
    value: `${territory.length} sigil${territory.length === 1 ? '' : 's'}`,
    breakdown: [...territoryLines(territory), 'Each sigil that works on this expedition spends one use from its beacon slot when the map opens.'],
  };
  setup.summary.push(line);
}

/** A persisted `RunSetup.territory` back to a valid one (junk dropped, shares clamped); undefined when nothing valid is recorded. */
export function normalizeRunTerritory(raw: unknown): RunTerritory[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: RunTerritory[] = [];
  for (const v of raw.slice(0, 2 * ATLAS_AREAS.length)) {
    if (typeof v !== 'object' || v === null) continue;
    const r = v as Record<string, unknown>;
    const def = findSigil(r.sigilId);
    const area = findAtlasArea(r.fromAreaId);
    if (!def || !area || typeof r.slot !== 'number' || !Number.isInteger(r.slot) || r.slot < 0 || r.slot >= BEACON_SLOTS.max) continue;
    const share = r.share === SIGIL_SECONDARY_SHARE ? SIGIL_SECONDARY_SHARE : 1;
    out.push({ sigilId: def.id, fromAreaId: area.id, slot: r.slot, share });
  }
  return out.length ? out : undefined;
}

// ---------------------------------------------------------------------------------------------
// Persistence of the account's beacons
// ---------------------------------------------------------------------------------------------

/** A persisted `atlas.beacons` back to a valid one: completed areas only, known sigils, slot counts and uses clamped. */
export function normalizeBeacons(raw: unknown, atlas: Pick<AtlasProgress, 'completed' | 'nodes'>): AtlasProgress['beacons'] | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const done = new Set(atlas.completed);
  const out: NonNullable<AtlasProgress['beacons']> = {};
  for (const [id, list] of Object.entries(raw as Record<string, unknown>)) {
    const area = findAtlasArea(id);
    if (!area || !done.has(area.id) || !Array.isArray(list)) continue;
    const n = beaconSlotCount(area.id, atlas.nodes);
    const slots: (BeaconSlot | null)[] = [];
    for (let i = 0; i < n; i++) {
      const v = list[i] as Record<string, unknown> | null | undefined;
      const def = v && typeof v === 'object' ? findSigil(v.sigilId) : undefined;
      const uses = def && typeof v!.uses === 'number' && Number.isFinite(v!.uses) ? Math.min(SIGIL_MAX_USES, Math.floor(v!.uses)) : 0;
      if (!def || uses < 1) { slots.push(null); continue; }
      const max = typeof v!.max === 'number' && Number.isFinite(v!.max) ? Math.max(uses, Math.min(SIGIL_MAX_USES, Math.floor(v!.max))) : SIGIL_MAX_USES;
      slots.push({ sigilId: def.id, uses, max });
    }
    if (slots.some(Boolean)) out[area.id] = slots;
  }
  const compact = compactBeacons(out);
  return compact && Object.keys(compact).length ? compact : undefined;
}

// ---------------------------------------------------------------------------------------------
// Hideout commands
// ---------------------------------------------------------------------------------------------

/** Why `areaId` slot `slot` cannot take a sigil (null = it can), without looking at the item. */
export function beaconSlotError(atlas: AtlasProgress | undefined, areaId: unknown, slot: unknown): string | null {
  const area = findAtlasArea(areaId);
  if (!area) return 'Choose an area on the Atlas.';
  if (!atlas?.completed.includes(area.id)) return `Clear ${area.name} first: only areas whose boss you have defeated are beacons.`;
  const n = beaconSlotCount(area.id, atlas.nodes);
  if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot >= n) return `${area.name} has ${n} sigil slot${n === 1 ? '' : 's'}.`;
  return null;
}

/** Why the item `uid` cannot be slotted (null = it can): a sigil, in the backpack (stash items go to the inventory first). */
export function sigilItemError(ch: CharacterSave, uid: string): string | null {
  const found = findItem(ch, uid);
  if (!found) return 'That item is gone.';
  if (found.item.kind !== 'currency' || !findSigil(found.item.currencyId)) return 'Only a sigil fits a beacon slot.';
  if (found.location.kind !== 'backpack') return 'Move the sigil into your inventory first, then drag it into the beacon slot.';
  return null;
}

/** Give a sigil back to the backpack (a never-used one); null when there is no room. */
function returnSigil(ch: CharacterSave, sigilId: SigilId): CharacterSave | null {
  const minted = mintUid(ch);
  const r = addToBackpack(minted.character, currencyStack(sigilId, 1, minted.uid));
  return r.ok ? r.value : null;
}

/**
 * Slot one sigil from the backpack stack `uid` into a beacon slot (D 6.3). A filled slot is swapped: the old sigil is consumed unless it
 * was never used (then it returns to the backpack). Atomic: nothing changes on a refusal.
 */
export function slotSigil(ch: CharacterSave, areaId: AtlasAreaId, slot: number, uid: string): Result<{ character: CharacterSave; message: string }> {
  const atlas = ch.atlas;
  const where = beaconSlotError(atlas, areaId, slot);
  if (where) return fail(where);
  const bad = sigilItemError(ch, uid);
  if (bad) return fail(bad);
  const found = findItem(ch, uid)!;
  const def = findSigil(found.item.kind === 'currency' ? found.item.currencyId : null)!;
  const area = findAtlasArea(areaId)!;
  let next = setStackCount(ch, found, (found.item as { count: number }).count - 1);
  const slots = beaconSlots(atlas, area.id);
  const old = slots[slot];
  let note = '';
  if (old) {
    const oldDef = findSigil(old.sigilId);
    if (old.uses >= old.max) {
      const back = returnSigil(next, old.sigilId);
      if (!back) return fail('Your inventory has no room for the sigil in that slot. Make room first.');
      next = back;
      note = ` ${oldDef?.name ?? 'The old sigil'} was unused and went back to your inventory.`;
    } else note = ` ${oldDef?.name ?? 'The old sigil'} (${old.uses} use${old.uses === 1 ? '' : 's'} left) was consumed.`;
  }
  const max = sigilFullUses(def.strength, atlas!.nodes);
  slots[slot] = { sigilId: def.id, uses: max, max };
  const beacons = { ...(atlas!.beacons ?? {}), [area.id]: slots };
  return ok({ character: { ...next, atlas: withBeacons(next.atlas ?? atlas!, beacons) }, message: `${def.name} lights the ${area.name} beacon: ${max} uses.${note}` });
}

/** Take a sigil out of a beacon slot: an unused one returns to the backpack; a used one is consumed (D 6.3: its uses cannot be recovered). */
export function unslotSigil(ch: CharacterSave, areaId: AtlasAreaId, slot: number): Result<{ character: CharacterSave; message: string }> {
  const atlas = ch.atlas;
  const where = beaconSlotError(atlas, areaId, slot);
  if (where) return fail(where);
  const area = findAtlasArea(areaId)!;
  const slots = beaconSlots(atlas, area.id);
  const old = slots[slot];
  if (!old) return fail('That beacon slot is empty.');
  const def = findSigil(old.sigilId);
  let next = ch;
  let message: string;
  if (old.uses >= old.max) {
    const back = returnSigil(ch, old.sigilId);
    if (!back) return fail('Your inventory has no room for the sigil. Make room first.');
    next = back;
    message = `${def?.name ?? 'The sigil'} was unused and went back to your inventory.`;
  } else message = `${def?.name ?? 'The sigil'} was consumed (${old.uses} use${old.uses === 1 ? '' : 's'} left are lost).`;
  slots[slot] = null;
  const beacons = { ...(atlas!.beacons ?? {}), [area.id]: slots };
  return ok({ character: { ...next, atlas: withBeacons(next.atlas ?? atlas!, beacons) }, message });
}
