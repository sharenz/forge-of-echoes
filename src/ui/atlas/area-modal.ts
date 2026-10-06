// The area modal's pure logic (UX rework of the Atlas interaction): clicking an area on the chart opens a modal for THAT area, with the
// map slot, the scarab sockets and an "Open area" button. This file decides what the modal may accept and why it refuses:
//   mapFit            does a map belong in this area's slot (its own area, a sealed area's key passage, the Pit's Bounty passage)
//   openAreaBlock     the one sentence under the Open area button when it is disabled (always words, never a silent grey button)
//   setupPlan         "Repeat last setup": which scarabs and key of the last run here are still in the inventory
//   fittingUids       the inventory items that fit this area (the subtle highlight: it shows what to drag, it is not a picker)
//   whereToFind       the empty state: which neighbours drop maps of this area, Rook, the bench
// Plus the tiny modal bus (which area is open) shared with the Ctrl/Cmd-click quick load. No DOM here, so tests cover every refusal.
import type { AtlasAreaId, AtlasProgress } from '../../contracts/atlas';
import type { CharacterSave, Item, ItemLocation, MapItem } from '../../contracts/items';
import { ATLAS_AREAS, ATLAS_KEYS, atlasTierCeiling, findAtlasArea, type AtlasAreaDef } from '../../data/progression/atlas';
import { findScarab } from '../../data/scarabs';
import { findSigil } from '../../data/progression/territory';
import { beaconSlots } from '../../game/progression/territory';
import { CURRENCIES } from '../../data/items';
import { SCARAB_SLOTS } from '../../contracts/items';
import { buildRouting, routingBiasFor, routingReadout } from '../../game/progression/map-routing';
import { isMapAddress } from '../../game/progression/map-binding';
import { signal } from '../store';

/** The area whose modal is open (null = the chart alone). Module-level so it survives the panel being hidden behind Rook's stall. */
export const areaModalSignal = signal<AtlasAreaId | null>(null);

/** The currency id of the key that opens a sealed area, if any. */
export const keyForArea = (area: AtlasAreaDef): string | null => ATLAS_KEYS.find((k) => k.areaId === area.id)?.currencyId ?? null;
export const isPitArea = (area: AtlasAreaDef): boolean => !!area.requiresBounty;
/** Sealed areas and the Pit run through a passage: a key, or a Bounty map. */
export const needsPassage = (area: AtlasAreaDef): boolean => keyForArea(area) !== null || isPitArea(area);

export type MapFit = { ok: true; via: 'home' | 'key' | 'pit' } | { ok: false; reason: string; goto: AtlasAreaId | null };

/**
 * Whether `map` may sit in the slot of `area`'s modal. A map is bound to ONE area and opens only there, except through a passage:
 * any map up to a sealed area's ceiling runs there with its key, and a Bounty map bound beside the Pit runs the Pit. Everything else
 * is refused with the sentence the red drop hint shows; `goto` is the area the map belongs to, for the "Go to ..." button.
 */
export function mapFit(map: Pick<MapItem, 'areaId' | 'tier' | 'bounty'>, area: AtlasAreaDef): MapFit {
  const ceiling = atlasTierCeiling(area);
  const home = findAtlasArea(map.areaId);
  if (keyForArea(area)) {
    return map.tier <= ceiling ? { ok: true, via: 'key' } : { ok: false, reason: `${area.name} accepts maps up to Tier ${ceiling}; this one is Tier ${map.tier}.`, goto: null };
  }
  if (isPitArea(area)) {
    if (!map.bounty || !area.neighbours.includes(map.areaId)) {
      const door = area.neighbours.map((n) => findAtlasArea(n)?.name).filter(Boolean).join(' or ');
      return { ok: false, reason: `${area.name} opens only with a Bounty map of ${door}.`, goto: home && map.areaId !== area.id ? home.id : null };
    }
    return map.tier <= ceiling ? { ok: true, via: 'pit' } : { ok: false, reason: `${area.name} accepts maps up to Tier ${ceiling}; this one is Tier ${map.tier}.`, goto: null };
  }
  if (map.areaId !== area.id) return { ok: false, reason: `This map opens ${home?.name ?? 'another area'}.`, goto: home?.id ?? null };
  if (map.tier > ceiling) return { ok: false, reason: `Tier ${map.tier} is above ${area.name}'s ceiling of Tier ${ceiling}.`, goto: null };
  return { ok: true, via: 'home' };
}

/** What the area's own passage needs, as the passage slot shows it. */
export interface PassageNeed { kind: 'key' | 'pit'; keyId: string | null; label: string }
export function passageNeed(area: AtlasAreaDef): PassageNeed | null {
  const key = keyForArea(area);
  if (key) return { kind: 'key', keyId: key, label: CURRENCIES[key as keyof typeof CURRENCIES]?.name ?? 'key' };
  if (isPitArea(area)) return { kind: 'pit', keyId: null, label: 'Bounty passage' };
  return null;
}

export interface BlockInput {
  area: AtlasAreaDef;
  map: MapItem | null;
  /** The passage state: a key passage chosen (sealed), or the Pit's Bounty passage taken. */
  passageChosen: boolean;
  /** The server rules' own preview error (a missing fee, a tier above the ceiling...). */
  previewError: string | null;
}

/** Why "Open area" is disabled, in words (null = ready). Ordered the way a player fixes things: map, then passage, then the rules. */
export function openAreaBlock({ area, map, passageChosen, previewError }: BlockInput): string | null {
  if (!map) return `Load a map for ${area.name}: drag one from your inventory into the map slot.`;
  const fit = mapFit(map, area);
  if (!fit.ok) return fit.reason;
  const need = passageNeed(area);
  if (need && !passageChosen) {
    return need.kind === 'key' ? `The key is missing: drag the ${need.label} from your inventory into the passage slot.` : `The Pit needs a Bounty map: load one bound to ${area.neighbours.map((n) => findAtlasArea(n)?.name).join(' or ')}.`;
  }
  return previewError;
}

// ---------------------------------------------------------------------------------------------
// Remembered setup (per area, per viewer)
// ---------------------------------------------------------------------------------------------

export interface AreaSetup { scarabs: string[]; key?: string }
const SETUP_KEY = 'foe.atlas.setup.v1';

export function readSetups(): Record<string, AreaSetup> {
  try {
    const raw = JSON.parse(localStorage.getItem(SETUP_KEY) ?? '{}');
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, AreaSetup> = {};
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
      const s = v as Partial<AreaSetup> | null;
      if (s && Array.isArray(s.scarabs) && s.scarabs.every((x) => typeof x === 'string')) out[id] = { scarabs: s.scarabs.filter((x) => !!findScarab(x)), ...(typeof s.key === 'string' ? { key: s.key } : {}) };
    }
    return out;
  } catch { return {}; }
}

export function rememberSetup(areaId: string, setup: AreaSetup): void {
  try {
    const all = readSetups();
    all[areaId] = setup;
    localStorage.setItem(SETUP_KEY, JSON.stringify(all));
  } catch { /* per-viewer convenience only */ }
}

/** The setup being run now: the socketed scarab ids and the passage key. */
export function currentSetup(ch: Pick<CharacterSave, 'mapScarabs'>, key: string | undefined): AreaSetup {
  return { scarabs: (ch.mapScarabs ?? []).flatMap((s) => (s ? [s.currencyId] : [])), ...(key ? { key } : {}) };
}

export interface SetupPlan {
  /** Backpack stacks to socket and the socket each goes to. */
  moves: { uid: string; index: number; currencyId: string }[];
  /** The remembered key, when it is in the backpack and the passage does not hold it yet. */
  key: string | null;
  /** Remembered items no longer in the inventory (names). */
  missing: string[];
  /** Remembered items in all (names), for the button's tooltip. */
  wanted: string[];
}

/** What "Repeat last setup" would do now: only items that are in the inventory are used, nothing is bought or pulled from the stash. */
export function setupPlan(saved: AreaSetup | undefined, ch: Pick<CharacterSave, 'backpack' | 'mapScarabs'>, chosenKey: string | undefined): SetupPlan {
  const plan: SetupPlan = { moves: [], key: null, missing: [], wanted: [] };
  if (!saved) return plan;
  const sockets = Array.from({ length: SCARAB_SLOTS }, (_, i) => ch.mapScarabs?.[i] ?? null);
  const taken = new Set(sockets.flatMap((s) => (s ? [s.currencyId] : [])));
  const usedFamilies = new Set(sockets.flatMap((s) => (s ? [findScarab(s.currencyId)?.family] : [])));
  for (const id of saved.scarabs) {
    const def = findScarab(id);
    if (!def) continue;
    plan.wanted.push(def.name);
    if (taken.has(def.id)) continue;
    const stack = ch.backpack.entries.find((e) => e.item.kind === 'currency' && e.item.currencyId === id && e.item.count > 0)?.item;
    const free = sockets.findIndex((s, i) => !s && !plan.moves.some((m) => m.index === i));
    if (!stack || free < 0 || usedFamilies.has(def.family)) { plan.missing.push(def.name); continue; }
    usedFamilies.add(def.family);
    plan.moves.push({ uid: stack.uid, index: free, currencyId: id });
  }
  if (saved.key) {
    const name = CURRENCIES[saved.key as keyof typeof CURRENCIES]?.name ?? saved.key;
    plan.wanted.push(name);
    if (chosenKey !== saved.key) {
      if (ch.backpack.entries.some((e) => e.item.kind === 'currency' && e.item.currencyId === saved.key && e.item.count > 0)) plan.key = saved.key;
      else plan.missing.push(name);
    }
  }
  return plan;
}

export const planIsEmpty = (p: SetupPlan): boolean => p.moves.length === 0 && p.key === null;

// ---------------------------------------------------------------------------------------------
// The inventory highlight
// ---------------------------------------------------------------------------------------------

/**
 * Backpack items worth dragging into this area's modal: maps that fit it (and are not above the ceiling), scarabs that still have a
 * free socket and whose family is not socketed, the key of a sealed area, and sigils when the area is a beacon with a free slot.
 * A highlight only: nothing is listed or picked here.
 */
export function fittingUids(ch: Pick<CharacterSave, 'backpack' | 'mapScarabs' | 'mapDevice'> & { atlas?: AtlasProgress }, area: AtlasAreaDef): Set<string> {
  const out = new Set<string>();
  const sockets = Array.from({ length: SCARAB_SLOTS }, (_, i) => ch.mapScarabs?.[i] ?? null);
  const free = sockets.some((s) => !s);
  const families = new Set(sockets.flatMap((s) => (s ? [findScarab(s.currencyId)?.family] : [])));
  const key = keyForArea(area);
  const beaconFree = !!ch.atlas?.completed.includes(area.id) && beaconSlots(ch.atlas, area.id).some((s) => !s);
  for (const { item } of ch.backpack.entries as { item: Item }[]) {
    if (item.kind === 'map') { if (mapFit(item, area).ok) out.add(item.uid); }
    else if (item.kind === 'currency') {
      const def = findScarab(item.currencyId);
      if (def && free && !families.has(def.family)) out.add(item.uid);
      else if (key && item.currencyId === key) out.add(item.uid);
      else if (beaconFree && findSigil(item.currencyId)) out.add(item.uid);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// The empty state: where to find maps for this area
// ---------------------------------------------------------------------------------------------

export interface FindSource { areaId: AtlasAreaId; name: string; share: number }
export interface WhereToFind {
  /** Charted areas whose expeditions drop maps of this area, strongest first. */
  sources: FindSource[];
  /** Rook's stall is worth a look (ordinary map areas only: a passage area has no map of its own). */
  rook: boolean;
  /** This area is reached by a passage: no ordinary map is bound to it. */
  passage: PassageNeed | null;
  /** Maps of this area in the Map Stash (move them into the inventory first). */
  inStash: number;
  /** Maps of other areas the player holds that could be re-charted here (neighbours only). */
  rechartable: number;
}

/** "Where to find maps for it": the Sources data read backwards (which areas drop this one) plus Rook, the Map Stash and the bench. */
export function whereToFind(area: AtlasAreaDef, atlas: AtlasProgress | undefined, ch: Pick<CharacterSave, 'backpack' | 'stash' | 'mapStash' | 'mapDevice' | 'mapScarabs' | 'equipment' | 'craftSlot'> | null): WhereToFind {
  const discovered = new Set<string>(atlas?.discovered ?? []);
  const ceiling = atlasTierCeiling(area);
  const sources: FindSource[] = [];
  if (isMapAddress(area)) {
    for (const n of ATLAS_AREAS) {
      if (n.id === area.id || !discovered.has(n.id) || !isMapAddress(n)) continue;
      const tier = Math.max(1, Math.min(ceiling, atlasTierCeiling(n)));
      const routing = buildRouting({ from: n.id, tier, bias: routingBiasFor(atlas, [], { from: n.id }), ...(atlas ? { atlas } : {}) });
      const row = routing ? routingReadout(routing, tier, discovered).rows.find((r) => r.areaId === area.id) : null;
      if (row && row.share > 0 && row.kind !== 'own') sources.push({ areaId: n.id, name: n.name, share: row.share });
    }
    sources.sort((a, b) => b.share - a.share || (a.name < b.name ? -1 : 1));
  }
  const inStash = (ch?.mapStash ?? []).filter((m) => m.areaId === area.id).length;
  let rechartable = 0;
  if (ch) {
    const held: MapItem[] = [];
    for (const e of ch.backpack.entries) if (e.item.kind === 'map') held.push(e.item);
    rechartable = held.filter((m) => m.areaId !== area.id && area.neighbours.includes(m.areaId) && m.tier <= ceiling).length;
  }
  return { sources: sources.slice(0, 4), rook: isMapAddress(area), passage: passageNeed(area), inStash, rechartable };
}

/** The first empty slot of a beacon (the Ctrl/Cmd-click quick-slot target), or -1 when the area is no beacon or every slot is filled. */
export function freeBeaconSlot(atlas: AtlasProgress | undefined, areaId: AtlasAreaId): number {
  if (!atlas?.completed.includes(areaId)) return -1;
  return beaconSlots(atlas, areaId).findIndex((s) => !s);
}

/** The drop slot id of beacon slot `i` (data-slot, Local.slots). */
export const beaconSlotId = (i: number): string => `beacon:${i}`;

/** Why a dragged item cannot go into a beacon slot (null = it fits): a sigil from the backpack. The server enforces the same rule. */
export function beaconDropError(item: Item, from: ItemLocation): string | null {
  if (item.kind !== 'currency' || !findSigil(item.currencyId)) return 'Only a sigil fits a beacon slot.';
  if (from.kind !== 'backpack') return 'Move the sigil into your inventory first, then drag it into the beacon slot.';
  return null;
}
