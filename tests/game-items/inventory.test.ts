import { describe, expect, it } from 'vitest';
import type { CharacterSave, EquipmentItem, FlaskStack, Item } from '../../src/contracts/items';
import { MAX_STASH_TABS } from '../../src/contracts/items';
import {
  addStashTab, addToBackpack, autoPlace, beltItem, beltUid, canEquip, canPlace, clearNewFlags, createGrid, discardItem,
  findFreeSpot, findItem, itemSize, moveItem, placeItem, quickMove, renameStashTab,
} from '../../src/game/items';
import { currency, equip, expectErr, expectOk, flask, makeCharacter, map, withBackpack } from './fixtures';

const wand = (uid: string, extra: Partial<Parameters<typeof equip>[0]> = {}) =>
  equip({ baseId: 'ashwoodWand', itemLevel: 10, rarity: 'normal', uid, ...extra });
const ring = (uid: string) => equip({ baseId: 'emberRing', itemLevel: 10, rarity: 'normal', uid });
const coat = (uid: string) => equip({ baseId: 'rivetedCoat', itemLevel: 20, rarity: 'normal', uid });
const helm = (uid: string) => equip({ baseId: 'ritualCirclet', itemLevel: 5, rarity: 'normal', uid });

function at(ch: CharacterSave, uid: string) {
  return findItem(ch, uid)?.location ?? null;
}

function countOf(ch: CharacterSave, uid: string): number {
  const f = findItem(ch, uid);
  return f && (f.item.kind === 'currency' || f.item.kind === 'flask') ? f.item.count : 0;
}

describe('grid basics', () => {
  it('sizes items by class; currency, maps and flasks are 1×1', () => {
    expect(itemSize(wand('w'))).toEqual({ w: 1, h: 3 });
    expect(itemSize(coat('c'))).toEqual({ w: 2, h: 3 });
    expect(itemSize(equip({ baseId: 'chainBelt', itemLevel: 1, rarity: 'normal' }))).toEqual({ w: 2, h: 1 });
    expect(itemSize(ring('r'))).toEqual({ w: 1, h: 1 });
    expect(itemSize(currency('scrap', 5))).toEqual({ w: 1, h: 1 });
    expect(itemSize(map())).toEqual({ w: 1, h: 1 });
    expect(itemSize(flask('lifeFlask'))).toEqual({ w: 1, h: 1 });
  });

  it('checks bounds and overlap', () => {
    const g = placeItem(createGrid(12, 5), coat('c'), 0, 0)!;
    expect(canPlace(g, wand('w'), 1, 0)).toBe(false);
    expect(canPlace(g, wand('w'), 2, 0)).toBe(true);
    expect(canPlace(g, wand('w'), 11, 3)).toBe(false);
    expect(canPlace(g, wand('w'), -1, 0)).toBe(false);
    expect(canPlace(g, coat('c'), 0, 0, 'c')).toBe(true);
    expect(placeItem(g, wand('w'), 1, 1)).toBeNull();
  });

  it('finds free space column by column', () => {
    let g = createGrid(4, 3);
    g = placeItem(g, ring('a'), 0, 0)!;
    expect(findFreeSpot(g, 1, 1)).toEqual({ x: 0, y: 1 });
    expect(findFreeSpot(g, 2, 3)).toEqual({ x: 1, y: 0 });
    expect(findFreeSpot(g, 5, 1)).toBeNull();
  });

  it('auto-places with stacking up to the stack limit, atomically', () => {
    let g = createGrid(2, 1);
    g = autoPlace(g, currency('scrap', 35, 's1'))!;
    g = autoPlace(g, currency('scrap', 10, 's2'))!;
    expect(g.entries.map((e) => [e.item.uid, (e.item as { count: number }).count])).toEqual([['s1', 40], ['s2', 5]]);
    // Fracture cores stack to 20 only.
    let f = autoPlace(createGrid(3, 1), currency('fractureCore', 18, 'f1'))!;
    f = autoPlace(f, currency('fractureCore', 5, 'f2'))!;
    expect(f.entries.map((e) => (e.item as { count: number }).count)).toEqual([20, 3]);
    // Flasks stack to 20.
    const fl = autoPlace(autoPlace(createGrid(2, 1), flask('lifeFlask', 19, 'l1'))!, flask('lifeFlask', 3, 'l2'))!;
    expect(fl.entries.map((e) => (e.item as { count: number }).count)).toEqual([20, 2]);
    // No room for the remainder → nothing changes.
    const full = autoPlace(createGrid(1, 1), currency('scrap', 38, 'a'))!;
    expect(autoPlace(full, currency('scrap', 5, 'b'))).toBeNull();
    expect(autoPlace(full, currency('scrap', 2, 'b'))!.entries[0].item).toMatchObject({ count: 40 });
  });
});

describe('findItem & canEquip', () => {
  it('finds items in every container, including belt slots and the map device', () => {
    const m = map('m1');
    let ch = withBackpack(makeCharacter(), [[wand('w'), 0, 0]]);
    ch = {
      ...ch,
      stash: [{ name: 'Tab 1', grid: { w: 12, h: 8, entries: [{ item: ring('r'), x: 4, y: 2 }] } }],
      equipment: { helmet: helm('h') },
      belt: [{ flaskId: 'lifeFlask', count: 3 }, null, null, null],
      mapDevice: m,
    };
    expect(at(ch, 'w')).toEqual({ kind: 'backpack', x: 0, y: 0 });
    expect(at(ch, 'r')).toEqual({ kind: 'stash', tab: 0, x: 4, y: 2 });
    expect(at(ch, 'h')).toEqual({ kind: 'equipment', slot: 'helmet' });
    expect(at(ch, 'm1')).toEqual({ kind: 'mapDevice' });
    expect(findItem(ch, beltUid(0))).toEqual({
      item: { kind: 'flask', uid: 'belt:0', flaskId: 'lifeFlask', count: 3 }, location: { kind: 'belt', index: 0 },
    });
    expect(findItem(ch, beltUid(1))).toBeNull();
    expect(findItem(ch, 'nope')).toBeNull();
  });

  it('checks slot compatibility and level requirements', () => {
    const ch = makeCharacter({ level: 10 });
    expect(canEquip(ch, ring('r'), 'ring1').ok).toBe(true);
    expect(canEquip(ch, ring('r'), 'ring2').ok).toBe(true);
    expect(canEquip(ch, ring('r'), 'amulet')).toEqual({ ok: false, reason: 'Ember Ring can only be equipped in a Ring slot.' });
    expect(canEquip(ch, wand('w'), 'offHand')).toEqual({ ok: false, reason: 'Ashwood Wand can only be equipped in the Main Hand.' });
    expect(canEquip(ch, helm('h'), 'chest').reason).toBe('Ritual Circlet can only be equipped in the Helmet slot.');
    expect(canEquip(ch, coat('c'), 'chest')).toEqual({ ok: false, reason: 'Requires Level 12 (you are level 10).' });
    expect(canEquip(ch, currency('scrap'), 'mainHand')).toEqual({ ok: false, reason: 'Only equipment can be equipped.' });
  });
});

describe('moveItem: grids', () => {
  it('moves into free space, rejects out-of-bounds, and treats the same spot as a no-op', () => {
    const ch = withBackpack(makeCharacter(), [[wand('w'), 0, 0]]);
    const moved = expectOk(moveItem(ch, 'w', { kind: 'backpack', x: 5, y: 1 }));
    expect(at(moved, 'w')).toEqual({ kind: 'backpack', x: 5, y: 1 });
    expect(expectErr(moveItem(ch, 'w', { kind: 'backpack', x: 0, y: 3 }))).toBe('It does not fit there.');
    expect(expectOk(moveItem(ch, 'w', { kind: 'backpack', x: 0, y: 0 }))).toBe(ch);
    // Shifting down by one overlaps only its own old footprint.
    expect(at(expectOk(moveItem(ch, 'w', { kind: 'backpack', x: 0, y: 1 })), 'w')).toEqual({ kind: 'backpack', x: 0, y: 1 });
    expect(expectErr(moveItem(ch, 'ghost', { kind: 'backpack', x: 0, y: 0 }))).toBe('That item no longer exists.');
  });

  it('moves between backpack and stash tabs', () => {
    const ch = withBackpack(makeCharacter(), [[wand('w'), 0, 0]]);
    const moved = expectOk(moveItem(ch, 'w', { kind: 'stash', tab: 0, x: 11, y: 5 }));
    expect(at(moved, 'w')).toEqual({ kind: 'stash', tab: 0, x: 11, y: 5 });
    expect(moved.backpack.entries).toHaveLength(0);
    expect(expectErr(moveItem(ch, 'w', { kind: 'stash', tab: 3, x: 0, y: 0 }))).toBe('That stash tab does not exist.');
  });

  it('merges stacks and leaves the remainder behind', () => {
    const ch = withBackpack(makeCharacter(), [[currency('scrap', 30, 'a'), 0, 0], [currency('scrap', 25, 'b'), 3, 0]]);
    const merged = expectOk(moveItem(ch, 'b', { kind: 'backpack', x: 0, y: 0 }));
    expect(countOf(merged, 'a')).toBe(40);
    expect(countOf(merged, 'b')).toBe(15);
    expect(at(merged, 'b')).toEqual({ kind: 'backpack', x: 3, y: 0 });
    const small = withBackpack(makeCharacter(), [[currency('scrap', 30, 'a'), 0, 0], [currency('scrap', 5, 'b'), 3, 0]]);
    const all = expectOk(moveItem(small, 'b', { kind: 'backpack', x: 0, y: 0 }));
    expect(countOf(all, 'a')).toBe(35);
    expect(findItem(all, 'b')).toBeNull();
  });

  it('swaps full stacks and different items with the single blocker', () => {
    const full = withBackpack(makeCharacter(), [[currency('scrap', 40, 'a'), 0, 0], [currency('scrap', 7, 'b'), 3, 0]]);
    const swappedStacks = expectOk(moveItem(full, 'b', { kind: 'backpack', x: 0, y: 0 }));
    expect(at(swappedStacks, 'b')).toEqual({ kind: 'backpack', x: 0, y: 0 });
    expect(at(swappedStacks, 'a')).toEqual({ kind: 'backpack', x: 3, y: 0 });

    const ch = withBackpack(makeCharacter(), [[wand('w'), 0, 0], [ring('r'), 5, 2]]);
    const swapped = expectOk(moveItem(ch, 'r', { kind: 'backpack', x: 0, y: 1 }));
    expect(at(swapped, 'r')).toEqual({ kind: 'backpack', x: 0, y: 1 });
    expect(at(swapped, 'w')).toEqual({ kind: 'backpack', x: 5, y: 2 });
  });

  it('falls back to any free spot when the displaced item cannot fit where the other came from', () => {
    // The ring sits on the bottom row; the 1×3 wand cannot go there, so it takes the first free column.
    const ch = withBackpack(makeCharacter(), [[wand('w'), 0, 0], [ring('r'), 5, 4]]);
    const out = expectOk(moveItem(ch, 'r', { kind: 'backpack', x: 0, y: 1 }));
    expect(at(out, 'r')).toEqual({ kind: 'backpack', x: 0, y: 1 });
    expect(at(out, 'w')).toEqual({ kind: 'backpack', x: 0, y: 2 });
  });

  it('refuses when two items are in the way', () => {
    const ch = withBackpack(makeCharacter(), [[ring('a'), 0, 0], [ring('b'), 0, 2], [coat('c'), 6, 0]]);
    expect(expectErr(moveItem(ch, 'c', { kind: 'backpack', x: 0, y: 0 }))).toBe('Something is in the way.');
  });
});

describe('moveItem: equipment', () => {
  it('equips, swaps with the equipped item and unequips', () => {
    const base = withBackpack(makeCharacter(), [[wand('new'), 3, 1]]);
    const ch: CharacterSave = { ...base, equipment: { mainHand: wand('old') } };
    const swapped = expectOk(moveItem(ch, 'new', { kind: 'equipment', slot: 'mainHand' }));
    expect(at(swapped, 'new')).toEqual({ kind: 'equipment', slot: 'mainHand' });
    expect(at(swapped, 'old')).toEqual({ kind: 'backpack', x: 3, y: 1 });

    const unequipped = expectOk(moveItem(swapped, 'new', { kind: 'backpack', x: 8, y: 0 }));
    expect(unequipped.equipment.mainHand).toBeUndefined();
    expect(at(unequipped, 'new')).toEqual({ kind: 'backpack', x: 8, y: 0 });

    // Dropping an equipped wand onto a backpack wand swaps them.
    const reverse = expectOk(moveItem(ch, 'old', { kind: 'backpack', x: 3, y: 1 }));
    expect(at(reverse, 'new')).toEqual({ kind: 'equipment', slot: 'mainHand' });
    expect(at(reverse, 'old')).toEqual({ kind: 'backpack', x: 3, y: 1 });
  });

  it('swaps rings between ring slots and enforces slot rules', () => {
    const ch: CharacterSave = { ...makeCharacter(), equipment: { ring1: ring('a'), ring2: ring('b') } };
    const swapped = expectOk(moveItem(ch, 'a', { kind: 'equipment', slot: 'ring2' }));
    expect(swapped.equipment.ring2!.uid).toBe('a');
    expect(swapped.equipment.ring1!.uid).toBe('b');
    expect(expectErr(moveItem(ch, 'a', { kind: 'equipment', slot: 'amulet' }))).toMatch(/Ring slot/);
    const low = withBackpack(makeCharacter({ level: 3 }), [[coat('c'), 0, 0]]);
    expect(expectErr(moveItem(low, 'c', { kind: 'equipment', slot: 'chest' }))).toBe('Requires Level 12 (you are level 3).');
  });

  it('refuses a swap when the displaced item cannot take the vacated place', () => {
    // Equipped wand dropped onto a backpack ring: the ring cannot go into the main hand.
    const ch: CharacterSave = { ...withBackpack(makeCharacter(), [[ring('r'), 0, 0]]), equipment: { mainHand: wand('w') } };
    expect(expectErr(moveItem(ch, 'w', { kind: 'backpack', x: 0, y: 0 }))).toBe('Those items cannot trade places.');
  });
});

describe('moveItem: belt', () => {
  const lifeCh = (count: number, belt: CharacterSave['belt'] = [null, null, null, null]) =>
    ({ ...withBackpack(makeCharacter(), [[flask('lifeFlask', count, 'lf'), 2, 2]]), belt });

  it('loads up to 5 charges into a belt slot and leaves the rest in the grid', () => {
    const out = expectOk(moveItem(lifeCh(8), 'lf', { kind: 'belt', index: 1 }));
    expect(out.belt[1]).toEqual({ flaskId: 'lifeFlask', count: 5 });
    expect(countOf(out, 'lf')).toBe(3);
    const small = expectOk(moveItem(lifeCh(2, [{ flaskId: 'lifeFlask', count: 2 }, null, null, null]), 'lf', { kind: 'belt', index: 0 }));
    expect(small.belt[0]).toEqual({ flaskId: 'lifeFlask', count: 4 });
    expect(findItem(small, 'lf')).toBeNull();
    expect(expectErr(moveItem(lifeCh(2, [{ flaskId: 'lifeFlask', count: 5 }, null, null, null]), 'lf', { kind: 'belt', index: 0 })))
      .toBe('That belt slot is full.');
    expect(expectErr(moveItem(lifeCh(2), 'lf', { kind: 'belt', index: 4 }))).toBe('That belt slot does not exist.');
  });

  it('only accepts flasks', () => {
    const ch = withBackpack(makeCharacter(), [[currency('scrap', 3, 's'), 0, 0]]);
    expect(expectErr(moveItem(ch, 's', { kind: 'belt', index: 0 }))).toBe('Only flasks fit on the belt.');
  });

  it('unloads charges into the grid and keeps the slot assignment', () => {
    const ch = { ...makeCharacter(), belt: [{ flaskId: 'focusFlask' as const, count: 3 }, null, null, null] };
    const out = expectOk(moveItem(ch, beltUid(0), { kind: 'backpack', x: 4, y: 4 }));
    expect(out.belt[0]).toEqual({ flaskId: 'focusFlask', count: 0 });
    const placed = out.backpack.entries[0];
    expect(placed).toMatchObject({ x: 4, y: 4, item: { kind: 'flask', flaskId: 'focusFlask', count: 3 } });
    expect(placed.item.uid).toBe('i1');
    expect(out.nextUid).toBe(2);
    expect(expectErr(moveItem(out, beltUid(0), { kind: 'backpack', x: 0, y: 0 }))).toBe('That belt slot is empty.');
    // Refill the assigned-but-empty slot with a different flask type.
    const withLife = withBackpack(out, [[flask('lifeFlask', 2, 'lf'), 0, 0]]);
    const reassigned = expectOk(moveItem(withLife, 'lf', { kind: 'belt', index: 0 }));
    expect(reassigned.belt[0]).toEqual({ flaskId: 'lifeFlask', count: 2 });
  });

  it('merges belt charges into a matching grid stack', () => {
    const ch = { ...lifeCh(18), belt: [{ flaskId: 'lifeFlask' as const, count: 4 }, null, null, null] };
    const out = expectOk(moveItem(ch, beltUid(0), { kind: 'backpack', x: 2, y: 2 }));
    expect(countOf(out, 'lf')).toBe(20);
    expect(out.belt[0]).toEqual({ flaskId: 'lifeFlask', count: 2 });
  });

  it('moves and merges between belt slots', () => {
    const ch = { ...makeCharacter(), belt: [{ flaskId: 'lifeFlask' as const, count: 3 }, { flaskId: 'focusFlask' as const, count: 2 }, { flaskId: 'lifeFlask' as const, count: 4 }, null] };
    const swapped = expectOk(moveItem(ch, beltUid(0), { kind: 'belt', index: 1 }));
    expect(swapped.belt.slice(0, 2)).toEqual([{ flaskId: 'focusFlask', count: 2 }, { flaskId: 'lifeFlask', count: 3 }]);
    const merged = expectOk(moveItem(ch, beltUid(0), { kind: 'belt', index: 2 }));
    expect(merged.belt[2]).toEqual({ flaskId: 'lifeFlask', count: 5 });
    expect(merged.belt[0]).toEqual({ flaskId: 'lifeFlask', count: 2 });
    const toEmpty = expectOk(moveItem(ch, beltUid(1), { kind: 'belt', index: 3 }));
    expect(toEmpty.belt[1]).toBeNull();
    expect(toEmpty.belt[3]).toEqual({ flaskId: 'focusFlask', count: 2 });
  });

  it('swaps a different loaded flask out to the grid', () => {
    const ch = lifeCh(4, [{ flaskId: 'focusFlask', count: 3 }, null, null, null]);
    const out = expectOk(moveItem(ch, 'lf', { kind: 'belt', index: 0 }));
    expect(out.belt[0]).toEqual({ flaskId: 'lifeFlask', count: 4 });
    const focus = out.backpack.entries.find((e) => e.item.kind === 'flask' && e.item.flaskId === 'focusFlask')!;
    expect(focus).toMatchObject({ x: 2, y: 2, item: { count: 3 } });
  });
});

describe('moveItem: map device', () => {
  it('accepts only maps and swaps the current map out', () => {
    const ch = withBackpack(makeCharacter(), [[map('m1'), 0, 0], [map('m2'), 1, 0], [ring('r'), 2, 0]]);
    const one = expectOk(moveItem(ch, 'm1', { kind: 'mapDevice' }));
    expect(one.mapDevice!.uid).toBe('m1');
    expect(expectErr(moveItem(one, 'r', { kind: 'mapDevice' }))).toBe('The Map Device only accepts maps.');
    const two = expectOk(moveItem(one, 'm2', { kind: 'mapDevice' }));
    expect(two.mapDevice!.uid).toBe('m2');
    expect(at(two, 'm1')).toEqual({ kind: 'backpack', x: 1, y: 0 });
    const back = expectOk(moveItem(two, 'm2', { kind: 'backpack', x: 7, y: 4 }));
    expect(back.mapDevice).toBeNull();
    expect(at(back, 'm2')).toEqual({ kind: 'backpack', x: 7, y: 4 });
  });
});

describe('quickMove', () => {
  it('moves backpack ↔ open stash tab with stacking', () => {
    const base = withBackpack(makeCharacter(), [[currency('scrap', 10, 's'), 0, 0]]);
    const ch: CharacterSave = { ...base, stash: [{ name: 'Tab 1', grid: { w: 12, h: 8, entries: [{ item: currency('scrap', 35, 'st'), x: 0, y: 0 }] } }] };
    const out = expectOk(quickMove(ch, 's', { stashTab: 0 }));
    expect(countOf(out, 'st')).toBe(40);
    expect(countOf(out, 's')).toBe(5);
    expect(at(out, 's')).toEqual({ kind: 'stash', tab: 0, x: 0, y: 1 });
    const back = expectOk(quickMove(out, 'st', { stashTab: 0 }));
    expect(at(back, 'st')).toEqual({ kind: 'backpack', x: 0, y: 0 });
  });

  it('equips into the best slot and unequips to the backpack', () => {
    const ch: CharacterSave = { ...withBackpack(makeCharacter(), [[ring('new'), 4, 4]]), equipment: { ring1: ring('old') } };
    const out = expectOk(quickMove(ch, 'new', { stashTab: null }));
    expect(out.equipment.ring2!.uid).toBe('new');
    expect(out.equipment.ring1!.uid).toBe('old');
    const off = expectOk(quickMove(out, 'old', { stashTab: null }));
    expect(off.equipment.ring1).toBeUndefined();
    expect(at(off, 'old')).toEqual({ kind: 'backpack', x: 0, y: 0 });
    // With both ring slots full, the first one is swapped.
    const both: CharacterSave = { ...withBackpack(makeCharacter(), [[ring('x'), 6, 2]]), equipment: { ring1: ring('a'), ring2: ring('b') } };
    const swapped = expectOk(quickMove(both, 'x', { stashTab: null }));
    expect(swapped.equipment.ring1!.uid).toBe('x');
    expect(at(swapped, 'a')).toEqual({ kind: 'backpack', x: 6, y: 2 });
  });

  it('loads flasks into the belt, maps into the device, and unloads both', () => {
    const ch: CharacterSave = {
      ...withBackpack(makeCharacter(), [[flask('lifeFlask', 7, 'lf'), 0, 0], [map('m'), 1, 0], [currency('scrap', 2, 's'), 2, 0]]),
      belt: [{ flaskId: 'lifeFlask', count: 4 }, { flaskId: 'focusFlask', count: 5 }, null, null],
    };
    const loaded = expectOk(quickMove(ch, 'lf', { stashTab: null }));
    expect(loaded.belt[0]).toEqual({ flaskId: 'lifeFlask', count: 5 });
    expect(countOf(loaded, 'lf')).toBe(6);
    const again = expectOk(quickMove(loaded, 'lf', { stashTab: null }));
    expect(again.belt[2]).toEqual({ flaskId: 'lifeFlask', count: 5 });
    expect(countOf(again, 'lf')).toBe(1);

    const device = expectOk(quickMove(ch, 'm', { stashTab: null }));
    expect(device.mapDevice!.uid).toBe('m');
    const unloaded = expectOk(quickMove(device, 'm', { stashTab: null }));
    expect(unloaded.mapDevice).toBeNull();

    const unbelt = expectOk(quickMove(ch, beltUid(1), { stashTab: null }));
    expect(unbelt.belt[1]).toEqual({ flaskId: 'focusFlask', count: 0 });
    expect(unbelt.backpack.entries.some((e) => e.item.kind === 'flask' && e.item.flaskId === 'focusFlask' && e.item.count === 5)).toBe(true);

    expect(expectErr(quickMove(ch, 's', { stashTab: null }))).toBe('Open the stash to quick-move this item.');
  });

  it('reports a full backpack', () => {
    let grid = createGrid(12, 5);
    for (let x = 0; x < 12; x++) for (let y = 0; y < 5; y++) grid = placeItem(grid, map(`m${x}-${y}`), x, y)!;
    const ch: CharacterSave = { ...makeCharacter(), backpack: grid, equipment: { helmet: helm('h') } };
    expect(expectErr(quickMove(ch, 'h', { stashTab: null }))).toBe('Your backpack is full.');
  });
});

describe('addToBackpack, discard, stash tabs, new flags', () => {
  it('stacks new items, re-mints clashing uids and fails atomically when full', () => {
    let ch = withBackpack(makeCharacter(), [[currency('scrap', 39, 'a'), 0, 0]]);
    ch = expectOk(addToBackpack(ch, currency('scrap', 3, 'b')));
    expect(countOf(ch, 'a')).toBe(40);
    expect(countOf(ch, 'b')).toBe(2);
    const dup = expectOk(addToBackpack(ch, ring('a')));
    expect(dup.backpack.entries.filter((e) => e.item.uid === 'a')).toHaveLength(1);
    expect(dup.backpack.entries.some((e) => e.item.uid === 'i1')).toBe(true);
    let grid = createGrid(12, 5);
    for (let x = 0; x < 12; x++) for (let y = 0; y < 5; y++) grid = placeItem(grid, map(`m${x}-${y}`), x, y)!;
    const full = { ...makeCharacter(), backpack: grid };
    expect(expectErr(addToBackpack(full, wand('w')))).toBe('Your backpack is full.');
  });

  it('refills matching belt slots first by default (pickups), unless told not to', () => {
    const ch = { ...makeCharacter(), belt: [{ flaskId: 'lifeFlask' as const, count: 4 }, null, { flaskId: 'lifeFlask' as const, count: 5 }, null] };
    const one = expectOk(addToBackpack(ch, flask('lifeFlask', 1, 'p1')));
    expect(one.belt[0]).toEqual({ flaskId: 'lifeFlask', count: 5 });
    expect(one.backpack.entries).toHaveLength(0);
    const two = expectOk(addToBackpack(one, flask('lifeFlask', 2, 'p2')));
    expect(countOf(two, 'p2')).toBe(2);
    const plain = expectOk(addToBackpack(ch, flask('lifeFlask', 1, 'p3'), { refillBelt: false }));
    expect(plain.belt[0]).toEqual({ flaskId: 'lifeFlask', count: 4 });
    expect(countOf(plain, 'p3')).toBe(1);
  });

  it('refills an emptied (0-charge) belt slot and splits a pickup between belt and backpack', () => {
    const ch = { ...makeCharacter(), belt: [{ flaskId: 'focusFlask' as const, count: 0 }, { flaskId: 'lifeFlask' as const, count: 0 }, null, null] };
    const next = expectOk(addToBackpack(ch, flask('lifeFlask', 7, 'p')));
    expect(next.belt[0]).toEqual({ flaskId: 'focusFlask', count: 0 });
    expect(next.belt[1]).toEqual({ flaskId: 'lifeFlask', count: 5 });
    expect(countOf(next, 'p')).toBe(2);
    // Atomic: when the remainder has no room, the belt is not topped up either.
    let grid = createGrid(12, 5);
    for (let x = 0; x < 12; x++) for (let y = 0; y < 5; y++) grid = placeItem(grid, map(`m${x}-${y}`), x, y)!;
    expect(expectErr(addToBackpack({ ...ch, backpack: grid }, flask('lifeFlask', 7, 'q')))).toBe('Your backpack is full.');
  });

  it('discards from anywhere', () => {
    const ch: CharacterSave = {
      ...withBackpack(makeCharacter(), [[ring('r'), 0, 0]]),
      equipment: { helmet: helm('h') },
      belt: [{ flaskId: 'lifeFlask', count: 2 }, null, null, null],
      mapDevice: map('m'),
    };
    expect(findItem(expectOk(discardItem(ch, 'r')), 'r')).toBeNull();
    expect(expectOk(discardItem(ch, 'h')).equipment.helmet).toBeUndefined();
    expect(expectOk(discardItem(ch, beltUid(0))).belt[0]).toBeNull();
    expect(expectOk(discardItem(ch, 'm')).mapDevice).toBeNull();
    expect(expectErr(discardItem(ch, 'zzz'))).toBe('That item no longer exists.');
  });

  it('adds up to 8 stash tabs and validates names', () => {
    let ch = makeCharacter();
    for (let i = 1; i < MAX_STASH_TABS; i++) ch = expectOk(addStashTab(ch));
    expect(ch.stash).toHaveLength(8);
    expect(ch.stash[7].name).toBe('Tab 8');
    expect(ch.stash[7].grid).toEqual({ w: 12, h: 8, entries: [] });
    expect(expectErr(addStashTab(ch))).toBe('The stash holds at most 8 tabs.');
    const renamed = expectOk(renameStashTab(ch, 2, '  Ember   Wands  '));
    expect(renamed.stash[2].name).toBe('Ember Wands');
    expect(expectErr(renameStashTab(ch, 2, '   '))).toBe('A stash tab needs a name.');
    expect(expectErr(renameStashTab(ch, 2, 'x'.repeat(25)))).toBe('Stash tab names can be at most 24 characters.');
    expect(expectOk(renameStashTab(ch, 2, 'x'.repeat(24))).stash[2].name).toHaveLength(24);
    expect(expectErr(renameStashTab(ch, 9, 'a'))).toBe('That stash tab does not exist.');
  });

  it('clears every new badge', () => {
    const fresh = <T extends Item>(item: T): T => ({ ...item, isNew: true });
    const ch: CharacterSave = {
      ...withBackpack(makeCharacter(), [[fresh(ring('r')), 0, 0]]),
      stash: [{ name: 'Tab 1', grid: { w: 12, h: 8, entries: [{ item: fresh(currency('scrap', 2, 's')), x: 0, y: 0 }] } }],
      equipment: { helmet: fresh(helm('h')) as EquipmentItem },
      mapDevice: fresh(map('m')),
    };
    const out = clearNewFlags(ch);
    expect(out.backpack.entries[0].item.isNew).toBeUndefined();
    expect(out.stash[0].grid.entries[0].item.isNew).toBeUndefined();
    expect(out.equipment.helmet!.isNew).toBeUndefined();
    expect(out.mapDevice!.isNew).toBeUndefined();
    expect(ch.backpack.entries[0].item.isNew).toBe(true);
  });
});

describe('purity', () => {
  it('never mutates the input character', () => {
    const ch: CharacterSave = {
      ...withBackpack(makeCharacter(), [[wand('w'), 0, 0], [currency('scrap', 30, 'a'), 3, 0], [currency('scrap', 20, 'b'), 4, 0], [flask('lifeFlask', 9, 'lf'), 5, 0]]),
      equipment: { mainHand: wand('eq') },
      belt: [{ flaskId: 'focusFlask', count: 2 }, null, null, null],
    };
    const snapshot = JSON.stringify(ch);
    moveItem(ch, 'w', { kind: 'equipment', slot: 'mainHand' });
    moveItem(ch, 'b', { kind: 'backpack', x: 3, y: 0 });
    moveItem(ch, 'lf', { kind: 'belt', index: 0 });
    moveItem(ch, beltUid(0), { kind: 'backpack', x: 9, y: 4 });
    quickMove(ch, 'a', { stashTab: 0 });
    quickMove(ch, 'eq', { stashTab: null });
    addToBackpack(ch, flask('lifeFlask', 3, 'x'), { refillBelt: true });
    discardItem(ch, 'w');
    addStashTab(ch);
    renameStashTab(ch, 0, 'Loot');
    clearNewFlags(ch);
    expect(JSON.stringify(ch)).toBe(snapshot);
    expect(beltItem(ch, 0)).toEqual({ kind: 'flask', uid: 'belt:0', flaskId: 'focusFlask', count: 2 } satisfies FlaskStack);
  });
});
