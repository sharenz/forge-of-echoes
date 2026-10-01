// Map binding (brief D, slice T0): every map item is bound to ONE Atlas area. This module holds the pure rules for
// choosing that area: the load-time migration of maps saved before binding (bindLegacyMaps, D 2.6), the provisional
// binding a freshly normalised legacy map wears until the account's Atlas is known, and the theme-derived choice that
// loot and the merchant still use (drops keep rolling a theme; the area follows from it until slice R1 routes drops).
//
// Everything here is deterministic and consumes NO rng: choices inside a candidate set are `hashString(key) % n` over
// the set sorted by depth then id, so a load is idempotent and stable across restarts and servers.
import { ATLAS_TREE_VERSION, type AtlasAreaId, type AtlasProgress } from '../../contracts/atlas';
import type { CharacterSave, GridContainer, Item, MapItem } from '../../contracts/items';
import type { MapBaseId } from '../../contracts/content';
import { ATLAS_AREAS, ATLAS_START, atlasTierCeiling, findAtlasArea, type AtlasAreaDef } from '../../data/progression/atlas';
import { hashString } from '../../core/rng';

/** An area a map can be bound to: not sealed (keys open those) and not the Pit of Echoes (a Bounty passage opens it). */
export const isMapAddress = (area: AtlasAreaDef): boolean => !area.sealed && !area.requiresBounty;

/** Every bindable area, shallowest first (depth, then id): the canonical order the hash indexes into. */
const ADDRESSES: readonly AtlasAreaDef[] = ATLAS_AREAS.filter(isMapAddress)
  .sort((a, b) => a.depth - b.depth || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

export const mapAddresses = (): readonly AtlasAreaDef[] => ADDRESSES;

const accepts = (area: AtlasAreaDef, tier: number): boolean => tier <= atlasTierCeiling(area);

function pickByKey<T>(list: readonly T[], key: string): T {
  return list[hashString(key) % list.length];
}

/** The candidates with the smallest tier ceiling (they are already depth-sorted): "the shallowest area that fits". */
function shallowest(list: readonly AtlasAreaDef[]): AtlasAreaDef[] {
  const min = Math.min(...list.map(atlasTierCeiling));
  return list.filter((a) => atlasTierCeiling(a) === min);
}

export interface MapBinding {
  areaId: AtlasAreaId;
  baseId: MapBaseId;
  /** The map had to leave its theme (no same-theme area of the account fits it). */
  migrated?: 'theme' | 'fog';
  /** The shallowest-fit last resort: this area joins the account's `discovered` (the map itself is the chart fragment). */
  reveal?: AtlasAreaId;
}

/**
 * Legacy binding, D 2.6. `discovered` is the account's charted set.
 *  1. discovered, same-theme areas accepting the tier;
 *  2. else discovered areas of any theme accepting it (smallest ceiling first, then shallowest depth): theme follows the area;
 *  3. else the shallowest area that accepts the tier, which is revealed (a map above everything the account has charted).
 */
export function bindLegacyChoice(baseId: MapBaseId, tier: number, uid: string, discovered: ReadonlySet<string>): MapBinding {
  const fits = ADDRESSES.filter((a) => accepts(a, tier));
  const charted = fits.filter((a) => discovered.has(a.id));
  const same = charted.filter((a) => a.baseId === baseId);
  if (same.length) { const a = pickByKey(same, uid); return { areaId: a.id, baseId: a.baseId }; }
  if (charted.length) { const a = pickByKey(shallowest(charted), uid); return { areaId: a.id, baseId: a.baseId, migrated: 'theme' }; }
  const group = shallowest(fits);
  const preferred = group.filter((a) => a.baseId === baseId);
  const a = pickByKey(preferred.length ? preferred : group, uid);
  return { areaId: a.id, baseId: a.baseId, migrated: 'fog', reveal: a.id };
}

/** A binding that needs no atlas (a map being normalised before its account is known): every area counts as charted. */
export function provisionalBinding(baseId: MapBaseId, tier: number, uid: string): MapBinding {
  const fits = ADDRESSES.filter((a) => accepts(a, tier));
  const same = fits.filter((a) => a.baseId === baseId);
  const a = same.length ? pickByKey(same, uid) : pickByKey(shallowest(fits), uid);
  return { areaId: a.id, baseId: a.baseId };
}

/**
 * The area of a map whose theme was rolled (loot drops, Rook's stock): same-theme areas the viewer has discovered that
 * accept the tier, else any discovered area accepting it (a map must be openable), else the shallowest fit next to the
 * chart (neighbours of a discovered area or of `near`, the area being run), else the shallowest fit anywhere.
 * `discovered` undefined = no atlas known (simulations): every area counts.
 */
export function areaForTheme(baseId: MapBaseId, tier: number, key: string, discovered?: ReadonlySet<string>, near?: AtlasAreaId): AtlasAreaId {
  const fits = ADDRESSES.filter((a) => accepts(a, tier));
  const known = discovered ? fits.filter((a) => discovered.has(a.id)) : fits;
  const same = known.filter((a) => a.baseId === baseId);
  if (same.length) return pickByKey(same, key).id;
  if (known.length) return pickByKey(known, key).id;
  const seen = new Set<string>([...(discovered ?? []), ...(near ? [near] : [])]);
  const adjacent = fits.filter((a) => a.neighbours.some((n) => seen.has(n)));
  return pickByKey(shallowest(adjacent.length ? adjacent : fits), key).id;
}

/** Rook's rule: only a discovered same-theme area accepting the tier (null = nothing to sell for that theme yet). */
export function discoveredAreaForTheme(baseId: MapBaseId, tier: number, key: string, discovered: ReadonlySet<string>): AtlasAreaId | null {
  const same = ADDRESSES.filter((a) => a.baseId === baseId && accepts(a, tier) && discovered.has(a.id));
  return same.length ? pickByKey(same, key).id : null;
}

/** Normalise the binding fields of a saved map. A valid, accepting, bindable `areaId` stands; anything else is a legacy map. */
export function savedBinding(rawArea: unknown, rawBase: MapBaseId | null, tier: number, uid: string, rawUnbound: boolean): (MapBinding & { unbound?: true }) | null {
  const area = findAtlasArea(rawArea);
  if (area && isMapAddress(area) && accepts(area, tier)) {
    return rawUnbound ? { areaId: area.id, baseId: area.baseId, unbound: true } : { areaId: area.id, baseId: area.baseId };
  }
  if (!rawBase) return null;
  return { ...provisionalBinding(rawBase, tier, uid), unbound: true };
}

/** A bound copy of a map: `areaId`, the area's theme, and the one-time migration note; the load-only flag is dropped. */
function bound(map: MapItem, b: MapBinding): MapItem {
  const { unbound: _u, ...rest } = map;
  return { ...rest, areaId: b.areaId, baseId: b.baseId, ...(b.migrated ? { migrated: b.migrated } : {}) };
}

// ---------------------------------------------------------------------------------------------
// bindLegacyMaps
// ---------------------------------------------------------------------------------------------

/** The character's maps that still wear a provisional binding. */
export function hasUnboundMaps(ch: CharacterSave): boolean {
  const isUnbound = (i: Item | null | undefined): boolean => !!i && i.kind === 'map' && i.unbound === true;
  const grid = (g: GridContainer): boolean => g.entries.some((e) => isUnbound(e.item));
  return grid(ch.backpack) || ch.stash.some((t) => grid(t.grid)) || isUnbound(ch.mapDevice) || (ch.mapStash ?? []).some(isUnbound) || isUnbound(ch.craftSlot);
}

/**
 * Bind every legacy map the character holds (backpack, stash tabs, the map device, the Map Stash and the Crafting Stash
 * work slot) against the account's Atlas. Pure, deterministic, idempotent, no rng; returns `ch` itself when nothing was
 * unbound. The last-resort reveal (D 2.6 step 3) is added to `atlas.discovered`; choices all use the discovery as it was
 * on entry, so the result does not depend on container order.
 */
export function bindLegacyMaps(ch: CharacterSave): CharacterSave {
  if (!hasUnboundMaps(ch)) return ch;
  const atlas: AtlasProgress = ch.atlas ?? { discovered: [ATLAS_START], completed: [], clears: 0, treeVersion: ATLAS_TREE_VERSION };
  const discovered = new Set<string>(atlas.discovered);
  const reveals = new Set<AtlasAreaId>();
  const rebind = (m: MapItem): MapItem => {
    if (!m.unbound) return m;
    const b = bindLegacyChoice(m.baseId, m.tier, m.uid, discovered);
    if (b.reveal) reveals.add(b.reveal);
    return bound(m, b);
  };
  const item = <T extends Item>(i: T): T => (i.kind === 'map' && i.unbound ? (rebind(i) as unknown as T) : i);
  const grid = (g: GridContainer): GridContainer => (g.entries.some((e) => e.item.kind === 'map' && e.item.unbound)
    ? { ...g, entries: g.entries.map((e) => (e.item.kind === 'map' && e.item.unbound ? { ...e, item: rebind(e.item) } : e)) } : g);
  const next: CharacterSave = {
    ...ch,
    backpack: grid(ch.backpack),
    stash: ch.stash.map((t) => { const g = grid(t.grid); return g === t.grid ? t : { ...t, grid: g }; }),
    mapDevice: ch.mapDevice ? rebind(ch.mapDevice) : ch.mapDevice,
    mapStash: (ch.mapStash ?? []).map(rebind),
    ...(ch.craftSlot ? { craftSlot: item(ch.craftSlot) } : {}),
  };
  if (reveals.size) next.atlas = { ...atlas, discovered: [...new Set([...atlas.discovered, ...reveals])] as AtlasAreaId[] };
  return next;
}

/** Bind one map against an atlas (the server-side guard of openMap). Returns the map and any area it reveals. */
export function bindMapOnce(map: MapItem, atlas: AtlasProgress): { map: MapItem; reveal?: AtlasAreaId } {
  if (!map.unbound) return { map };
  const b = bindLegacyChoice(map.baseId, map.tier, map.uid, new Set<string>(atlas.discovered));
  return { map: bound(map, b), ...(b.reveal ? { reveal: b.reveal } : {}) };
}
