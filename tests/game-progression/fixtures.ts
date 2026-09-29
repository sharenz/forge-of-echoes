// Shared fixtures for the progression suites.
import type { RunSetup } from '../../src/contracts/game';
import type {
  CharacterSave, CurrencyStack, EquipmentItem, Item, MapItem, RolledAffix, RolledMapMod,
} from '../../src/contracts/items';
import { BACKPACK_SIZE, BELT_SLOTS, STASH_TAB_SIZE } from '../../src/contracts/items';
import type { CurrencyId, MapBaseId } from '../../src/contracts/content';
import type { KillLootContext } from '../../src/contracts/sim';
import { createRng } from '../../src/core/rng';
import { buildEquipment, generateUnique, placeItem } from '../../src/game/items';
import type { EquipmentSpec } from '../../src/game/items';
import { createMapItem } from '../../src/game/progression';
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

export function map(
  baseId: MapBaseId = 'ashenForge', tier = 1, opts: { mods?: RolledMapMod[]; quality?: number; uid?: string } = {},
): MapItem {
  return createMapItem(baseId, tier, opts.uid ?? uid('m'), { mods: opts.mods, quality: opts.quality });
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
  return expectOk(rules.openMap(placed)).setup;
}

export function kill(overrides: Partial<KillLootContext> = {}): KillLootContext {
  return { kind: 'ashling', summoned: false, rarity: 'normal', isLieutenant: false, isBoss: false, wave: 1, x: 0, y: 0, ...overrides };
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
