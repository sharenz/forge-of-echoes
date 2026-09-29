// Shared fixtures for the item & crafting suites.
import type {
  CharacterSave, CurrencyStack, EquipmentItem, FlaskStack, Item, MapItem,
} from '../../src/contracts/items';
import { BACKPACK_SIZE, BELT_SLOTS, STASH_TAB_SIZE } from '../../src/contracts/items';
import type { CurrencyId, FlaskId } from '../../src/contracts/content';
import { createRng } from '../../src/core/rng';
import { buildEquipment, placeItem } from '../../src/game/items';
import type { EquipmentSpec } from '../../src/game/items';

export function makeCharacter(overrides: Partial<CharacterSave> = {}): CharacterSave {
  return {
    id: 'c1',
    name: 'Tester',
    classId: 'sorceress',
    level: 30,
    xp: 0,
    unspentAttributePoints: 0,
    allocated: { str: 0, dex: 0, int: 0 },
    unspentSkillPoints: 0,
    skillRanks: { emberLance: 1, emberNova: 0, flameWave: 0, rimeShards: 0, arcChain: 0, riftStep: 0, cinderWard: 0 },
    loadout: ['emberLance', null, null, null, null, null],
    equipment: {},
    backpack: { w: BACKPACK_SIZE.w, h: BACKPACK_SIZE.h, entries: [] },
    stash: [{ name: 'Tab 1', grid: { w: STASH_TAB_SIZE.w, h: STASH_TAB_SIZE.h, entries: [] } }],
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

let uidCounter = 0;
export function uid(prefix = 't'): string {
  uidCounter += 1;
  return `${prefix}${uidCounter}`;
}

export function currency(currencyId: CurrencyId, count = 1, id = uid('c')): CurrencyStack {
  return { kind: 'currency', uid: id, currencyId, count };
}

export function flask(flaskId: FlaskId, count = 1, id = uid('f')): FlaskStack {
  return { kind: 'flask', uid: id, flaskId, count };
}

export function map(id = uid('m')): MapItem {
  return { kind: 'map', uid: id, baseId: 'ashenForge', tier: 1, rarity: 'normal', mods: [], quality: 0, corrupted: false };
}

export function equip(spec: Omit<EquipmentSpec, 'uid'> & { uid?: string }, seed = 7): EquipmentItem {
  return buildEquipment({ uid: spec.uid ?? uid('e'), ...spec }, createRng(seed));
}

/** Put items into the backpack at explicit positions. */
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
