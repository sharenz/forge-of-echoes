// Shared fixtures for the progression suites.
import type { RunSetup } from '../../src/contracts/game';
import type {
  CharacterSave, CurrencyStack, EquipmentItem, Item, MapItem, RolledAffix, RolledMapMod,
} from '../../src/contracts/items';
import { BACKPACK_SIZE, BELT_SLOTS, STASH_TAB_SIZE } from '../../src/contracts/items';
import type { CurrencyId, MapBaseId } from '../../src/contracts/content';
import type { AtlasAreaId } from '../../src/contracts/atlas';
import { ATLAS_AREA_IDS } from '../../src/contracts/atlas';
import { ATLAS_KEYS, atlasTierCeiling, findAtlasArea } from '../../src/data/progression/atlas';
import type { OpenMapOptions } from '../../src/contracts/game';
import type { EventRewardContext, MapEventGrade, MapEventKind } from '../../src/contracts/map-events';
import type { KillLootContext } from '../../src/contracts/sim';
import { createRng } from '../../src/core/rng';
import { buildEquipment, generateUnique, placeItem } from '../../src/game/items';
import type { EquipmentSpec } from '../../src/game/items';
import { createMapItem, mapAddresses } from '../../src/game/progression';
import { rules } from '../../src/game';

/** A bare character (no gear, no items) at a level. */
export function bareCharacter(overrides: Partial<CharacterSave> = {}): CharacterSave {
  return {
    id: 'c1',
    name: 'Tester',
    classId: 'sorceress',
    level: 1,
    xp: 0,
    unspentAttributePoints: 0,
    allocated: { str: 0, dex: 0, int: 0 },
    unspentSkillPoints: 0,
    skillRanks: { emberLance: 1, emberNova: 0, flameWave: 0, rimeShards: 0, arcChain: 0, riftStep: 0, cinderWard: 0 },
    loadout: ['emberLance', null, null, null, null, null],
    equipment: {},
    backpack: { w: BACKPACK_SIZE.w, h: BACKPACK_SIZE.h, entries: [] },
    stash: [{ name: 'Tab 1', grid: { w: STASH_TAB_SIZE.w, h: STASH_TAB_SIZE.h, entries: [] } }],
    currencyStash: {},
    mapStash: [],
    // Most suites open maps of any theme and tier: every area counts as charted unless a test says otherwise.
    atlas: exploredAtlas(),
    belt: Array.from({ length: BELT_SLOTS }, () => null),
    mapDevice: null,
    rngState: 12345,
    nextUid: 1,
    stats: {
      mapsCompleted: 0, mapsFailed: 0, highestTierCompleted: 0, kills: 0, deaths: 0,
      raresFound: 0, uniquesFound: 0, itemsCrafted: 0, playSeconds: 0,
    },
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

let counter = 0;
export function uid(prefix = 't'): string {
  counter += 1;
  return `${prefix}${counter}`;
}

export function equip(spec: Omit<EquipmentSpec, 'uid'> & { uid?: string }, seed = 7): EquipmentItem {
  return buildEquipment({ uid: spec.uid ?? uid('e'), ...spec }, createRng(seed));
}

export function unique(id: Parameters<typeof generateUnique>[0], itemLevel = 40): EquipmentItem {
  return generateUnique(id, createRng(3), { uid: uid('u'), itemLevel });
}

export function currency(currencyId: CurrencyId, count = 1, id = uid('c')): CurrencyStack {
  return { kind: 'currency', uid: id, currencyId, count };
}

/** The shallowest bindable area of a theme that accepts `tier` (a fixture's stand-in for "a map of this theme"). */
export function areaOfTheme(baseId: MapBaseId, tier: number): AtlasAreaId {
  const fit = mapAddresses().filter((a) => a.baseId === baseId && tier <= atlasTierCeiling(a));
  return (fit[0] ?? mapAddresses().find((a) => tier <= atlasTierCeiling(a))!).id;
}

/** createMapItem for tests that think in themes: bound to the shallowest area of the theme that accepts the tier. */
export const themeMap = (baseId: MapBaseId, tier: number, id: string, opts: Parameters<typeof createMapItem>[3] = {}): MapItem =>
  createMapItem(areaOfTheme(baseId, tier), tier, id, opts);

/** A map bound to an area (`AtlasAreaId`) or, for brevity, to the shallowest area of a theme (`MapBaseId`) that accepts the tier. */
export function map(
  where: MapBaseId | AtlasAreaId = 'ashenForge', tier = 1, opts: { mods?: RolledMapMod[]; quality?: number; uid?: string } = {},
): MapItem {
  const areaId = (ATLAS_AREA_IDS as readonly string[]).includes(where) ? where as AtlasAreaId : areaOfTheme(where as MapBaseId, tier);
  return createMapItem(areaId, tier, opts.uid ?? uid('m'), { mods: opts.mods, quality: opts.quality });
}

/** An Atlas with every area charted (tests that open maps anywhere). */
export const exploredAtlas = () => ({ discovered: [...ATLAS_AREA_IDS], completed: [], clears: 0 });

/**
 * openMap with the device map re-bound to `areaId`, which is what the old area argument chose: a sealed area through its key
 * (the key must be on the character), the Pit of Echoes through a Bounty passage from Iron March.
 */
export function openAt(
  api: Pick<typeof rules, 'openMap'>, ch: CharacterSave, areaId: AtlasAreaId, lootClass?: OpenMapOptions['lootClass'],
) {
  const area = findAtlasArea(areaId)!;
  const device = ch.mapDevice!;
  const key = ATLAS_KEYS.find((k) => k.areaId === areaId);
  const home = key ? findAtlasArea(device.areaId)! : area.requiresBounty ? findAtlasArea('ironMarch')! : area;
  const bound = key || area.requiresBounty ? { ...device, areaId: home.id, baseId: home.baseId } : { ...device, areaId: area.id, baseId: area.baseId };
  const passage: OpenMapOptions['passage'] = key ? { kind: 'key', currencyId: key.currencyId } : area.requiresBounty ? { kind: 'bounty' } : undefined;
  return api.openMap({ ...ch, mapDevice: bound }, { ...(lootClass ? { lootClass } : {}), ...(passage ? { passage } : {}) });
}

export function withBackpack(ch: CharacterSave, placements: [Item, number, number][]): CharacterSave {
  let grid = ch.backpack;
  for (const [item, x, y] of placements) {
    const next = placeItem(grid, item, x, y);
    if (!next) throw new Error(`fixture: cannot place ${item.uid} at ${x},${y}`);
    grid = next;
  }
  return { ...ch, backpack: grid };
}

export function expectOk<T>(r: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error}`);
  return r.value;
}

export function expectErr<T>(r: { ok: true; value: T } | { ok: false; error: string }): string {
  if (r.ok) throw new Error('expected an error, got ok');
  return r.error;
}

/** The RunSetup of a map opened by `ch` (map-side luck only; the character sets the seed). */
export function setupFor(m: MapItem, ch: CharacterSave = bareCharacter()): RunSetup {
  const placed = expectOk(rules.moveItem(withBackpack(ch, [[m, 0, 0]]), m.uid, { kind: 'mapDevice' }));
  // Every map has an area now, so the territory fee applies at every tier: pay it from the stash.
  return expectOk(rules.openMap({ ...placed, currencyStash: { ...placed.currencyStash, scrap: Math.max(placed.currencyStash.scrap ?? 0, 99) } })).setup;
}

export function kill(overrides: Partial<KillLootContext> = {}): KillLootContext {
  return { kind: 'ashling', summoned: false, rarity: 'normal', isLieutenant: false, isBoss: false, wave: 1, x: 0, y: 0, ...overrides };
}

/** The payout context of one map event (Event Director v2): Bronze by default. */
export function eventCtx(kind: MapEventKind, grade: MapEventGrade = 1, o: Partial<EventRewardContext> = {}): EventRewardContext {
  return { kind, grade, choice: 0, tally: 0, x: 0, y: 0, wave: 2, ingredientBonus: 0, multiplier: 1, ...o };
}

/** A magic amulet with item rarity and/or item quantity (the two luck affixes). */
export function luckyAmulet(rarity = 0, quantity = 0, id = uid('am')): EquipmentItem {
  const affixes: RolledAffix[] = [];
  if (rarity) affixes.push({ affixId: 'itemRarity', tier: 3, value: rarity });
  if (quantity) affixes.push({ affixId: 'itemQuantity', tier: 3, value: quantity });
  return {
    kind: 'equipment', uid: id, baseId: 'cinderPendant', itemLevel: 40, rarity: 'magic', name: null,
    implicitValues: [12], affixes, scars: [], stability: 7, maxStability: 7, history: [],
  };
}
