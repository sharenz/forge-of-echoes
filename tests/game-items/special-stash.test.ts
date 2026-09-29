// The special stash tabs (GAME_SPEC §12, end): the Crafting Stash (one slot per currency, synthetic uids
// "cstash:<id>") and the Map Stash — every move path, caps, splits, "Deposit all", crafting straight from a
// slot, trade locks, uid uniqueness, purity and determinism.
import { describe, expect, it } from 'vitest';
import type { CharacterSave, EquipmentItem, Item, MapItem } from '../../src/contracts/items';
import { CURRENCY_STASH_MAX, MAP_STASH_CAPACITY, currencyStashUid } from '../../src/contracts/items';
import { CURRENCY_IDS, EQUIPMENT_CURRENCY_IDS, MAP_CURRENCY_IDS } from '../../src/contracts/content';
import { LOCKED_CHANGE_ERROR, LOCKED_CURRENCY_ERROR, LOCKED_ITEM_ERROR, rules, withItemLocks, withServerEntropy } from '../../src/game';
import {
  CRAFTING_STASH_EQUIPMENT_SLOTS, CRAFTING_STASH_MAP_SLOTS, addToBackpack, allItems, beltUid, clearNewFlags, currencyStashItem,
  currencyStashTab, depositAllCurrency, describeCurrency, findItem, heldUids, moveItem, parseCurrencyStashUid, quickMove,
  specialStashTab, stowItem, tradeOfferError,
} from '../../src/game/items';
import { currency, equip, expectErr, expectOk, flask, makeCharacter, map, withBackpack } from './fixtures';

const S = (id: Parameters<typeof currencyStashUid>[0]) => currencyStashUid(id);

/** Total of a currency in backpack stacks. */
function carried(ch: CharacterSave, id: string): number {
  return ch.backpack.entries.reduce((s, e) => s + (e.item.kind === 'currency' && e.item.currencyId === id ? e.item.count : 0), 0);
}

function at(ch: CharacterSave, x: number, y: number): Item | undefined {
  return ch.backpack.entries.find((e) => e.x === x && e.y === y)?.item;
}

function expectUniqueUids(ch: CharacterSave): void {
  const list = allItems(ch).map((f) => f.item.uid);
  expect(new Set(list).size, `duplicate uids: ${list.join(', ')}`).toBe(list.length);
  for (const u of list) {
    expect(parseCurrencyStashUid(u)).toBeNull();
    const m = /^i([0-9a-z]+)$/.exec(u);
    if (m) expect(parseInt(m[1], 36), u).toBeLessThan(ch.nextUid);
  }
}

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    Object.freeze(v);
    for (const x of Object.values(v)) deepFreeze(x);
  }
  return v;
}

function rareRing(uid = 'ring'): EquipmentItem {
  return equip({ baseId: 'emberRing', itemLevel: 60, rarity: 'rare', uid, affixes: [{ affixId: 'life', tier: 5 }, { affixId: 'coldResistance', tier: 5 }, { affixId: 'focus', tier: 5 }] });
}

describe('slots and synthetic uids', () => {
  it.each([0, 'maps', 'currency', 'mapCurrency'] as const)('automatically files map and currency items with stash tab %s open', (stashTab) => {
    let ch = withBackpack(makeCharacter(), [[map('m'), 0, 0], [currency('scrap', 7, 'c'), 1, 0]]);
    ch = expectOk(quickMove(ch, 'm', {stashTab}));
    ch = expectOk(quickMove(ch, 'c', {stashTab}));
    expect(ch.mapStash.map((m) => m.uid)).toEqual(['m']);
    expect(ch.currencyStash.scrap).toBe(7);
    expect(ch.backpack.entries).toHaveLength(0);
    expect(ch.stash[0].grid.entries).toHaveLength(0);
  });

  it('addresses every currency by "cstash:<id>" and rejects anything else', () => {
    for (const id of CURRENCY_IDS) expect(parseCurrencyStashUid(S(id))).toBe(id);
    for (const bad of ['cstash:', 'cstash:gold', 'cstash:constructor', 'cstash:__proto__', 'scrap', 'belt:0', 7, null, undefined]) {
      expect(parseCurrencyStashUid(bad)).toBeNull();
    }
    expect(CRAFTING_STASH_EQUIPMENT_SLOTS).toEqual([...EQUIPMENT_CURRENCY_IDS]);
    expect(CRAFTING_STASH_MAP_SLOTS).toEqual([...MAP_CURRENCY_IDS]);
    expect(currencyStashTab('essenceRime')).toBe('currency');
    expect(currencyStashTab('voidNeedle')).toBe('mapCurrency');
    expect(['maps', 'currency', 'mapCurrency', 'Maps', 3, null].map(specialStashTab)).toEqual(['maps', 'currency', 'mapCurrency', null, null, null]);
  });

  it('finds a non-empty slot as a CurrencyStack view; an empty one finds nothing', () => {
    const ch = makeCharacter({ currencyStash: { scrap: 1234 } });
    expect(findItem(ch, S('scrap'))).toEqual({
      item: { kind: 'currency', uid: 'cstash:scrap', currencyId: 'scrap', count: 1234 },
      location: { kind: 'currencyStash' },
    });
    expect(findItem(ch, S('kindling'))).toBeNull();
    expect(rules.findItem(ch, S('scrap'))?.location).toEqual({ kind: 'currencyStash' });
    expect(currencyStashItem(ch, 'kindling')).toEqual({ kind: 'currency', uid: 'cstash:kindling', currencyId: 'kindling', count: 0 });
    // Tolerates a character built without the fields.
    const legacy = { ...makeCharacter() } as Partial<CharacterSave>;
    delete legacy.currencyStash;
    delete legacy.mapStash;
    expect(findItem(legacy as CharacterSave, S('scrap'))).toBeNull();
    expect(allItems(legacy as CharacterSave)).toEqual([]);
  });

  it('never discards (or drops) a whole slot, but discards a Map Stash map', () => {
    const ch = makeCharacter({ currencyStash: { scrap: 1234 }, mapStash: [map('a'), map('b')] });
    expect(expectErr(rules.discardItem(ch, S('scrap')))).toBe('Take currency out of the Crafting Stash first.');
    expect(expectErr(rules.discardItem(ch, S('seal')))).toBe('Your Crafting Stash holds no Binding Seal.');
    expect(expectOk(rules.discardItem(ch, 'a')).mapStash.map((m) => m.uid)).toEqual(['b']);
    // Neither can be offered in a trade (backpack items only).
    expect(tradeOfferError(ch, [S('scrap')])).toBe('Only items in your backpack can be traded.');
    expect(tradeOfferError(ch, ['b'])).toBe('Only items in your backpack can be traded.');
  });

  it('describes a slot with its count, the cap and how to withdraw', () => {
    const ch = makeCharacter({ currencyStash: { scrap: 1234, fractureCore: 3 } });
    const d = rules.describeItem(findItem(ch, S('scrap'))!.item, ch);
    expect(d.title).toBe('Forge Scrap');
    expect(d.headerLines).toEqual(['Crafting Stash 1,234 / 5,000']);
    expect(d.hint).toBe('Right-click to arm, then left-click an item in the hideout. Each use takes one from here. '
      + 'Drag or Ctrl+click to take a stack of up to 40; Shift+Ctrl+click takes one.');
    expect(rules.describeItem(currencyStashItem(ch, 'fractureCore')).hint).toMatch(/a stack of up to 20;/);
    const empty = describeCurrency(currencyStashItem(ch, 'mapDust'));
    expect(empty.headerLines).toEqual(['Crafting Stash 0 / 5,000']);
    expect(empty.hint).toBe('Empty. Any Map Dust you deposit is filed here.');
    // An ordinary stack is unchanged.
    expect(describeCurrency(currency('scrap', 12, 'x')).headerLines).toEqual(['Stack 12 / 40']);
  });
});

describe('depositing currency', () => {
  it('files a stack from the backpack or a stash tab into its slot, wherever it is dropped', () => {
    let ch = withBackpack(makeCharacter(), [[currency('scrap', 30, 'a'), 0, 0], [currency('kindling', 5, 'k'), 1, 0]]);
    ch = expectOk(moveItem(ch, 'a', { kind: 'currencyStash' }));
    expect(ch.currencyStash).toEqual({ scrap: 30 });
    expect(findItem(ch, 'a')).toBeNull();
    const tabbed = { ...ch, stash: [{ ...ch.stash[0], grid: { ...ch.stash[0].grid, entries: [{ item: currency('scrap', 12, 's'), x: 4, y: 4 }] } }] };
    const out = expectOk(rules.moveItem(tabbed, 's', { kind: 'currencyStash' }));
    expect(out.currencyStash).toEqual({ scrap: 42 });
    expect(out.stash[0].grid.entries).toEqual([]);
  });

  it('deposits part of a stack with a count and leaves the rest in place', () => {
    const ch = withBackpack(makeCharacter(), [[currency('scrap', 30, 'a'), 3, 2]]);
    const out = expectOk(moveItem(ch, 'a', { kind: 'currencyStash' }, 12));
    expect(out.currencyStash).toEqual({ scrap: 12 });
    expect(at(out, 3, 2)).toEqual({ kind: 'currency', uid: 'a', currencyId: 'scrap', count: 18 });
    expect(expectOk(moveItem(ch, 'a', { kind: 'currencyStash' }, 500)).currencyStash).toEqual({ scrap: 30 });
  });

  it('caps a slot at 5,000: the overflow stays, a full slot refuses', () => {
    const ch = withBackpack(makeCharacter({ currencyStash: { scrap: CURRENCY_STASH_MAX - 10 } }), [[currency('scrap', 40, 'a'), 5, 1]]);
    const out = expectOk(moveItem(ch, 'a', { kind: 'currencyStash' }));
    expect(out.currencyStash).toEqual({ scrap: CURRENCY_STASH_MAX });
    expect(at(out, 5, 1)).toMatchObject({ uid: 'a', count: 30 });
    expect(expectErr(moveItem(out, 'a', { kind: 'currencyStash' })))
      .toBe('Your Crafting Stash is full of Forge Scrap: a slot holds at most 5,000.');
    expect(expectErr(quickMove(out, 'a', { stashTab: 'currency' })))
      .toBe('Your Crafting Stash is full of Forge Scrap: a slot holds at most 5,000.');
  });

  it('only takes currency', () => {
    const ch = withBackpack(makeCharacter(), [[map('m'), 0, 0], [flask('lifeFlask', 3, 'f'), 1, 0], [rareRing('r'), 2, 0]]);
    for (const uid of ['m', 'f', 'r']) {
      expect(expectErr(moveItem(ch, uid, { kind: 'currencyStash' }))).toBe('Only currency can be stored in the Crafting Stash.');
      if (uid === 'm') {
        expect(expectOk(quickMove(ch, uid, { stashTab: 'currency' })).mapStash.map((m) => m.uid)).toEqual(['m']);
        continue;
      }
      expect(expectErr(quickMove(ch, uid, { stashTab: 'currency' }))).toBe('Only currency can be stored in the Crafting Stash.');
      expect(expectErr(quickMove(ch, uid, { stashTab: 'mapCurrency' }))).toBe('Only currency can be stored in the Crafting Stash.');
    }
    // Moving a slot onto the Crafting Stash is a no-op.
    const banked = makeCharacter({ currencyStash: { seal: 2 } });
    expect(expectOk(moveItem(banked, S('seal'), { kind: 'currencyStash' }))).toBe(banked);
  });

  it('Ctrl-click deposits into either Crafting Stash tab (every currency files into its own slot)', () => {
    const ch = withBackpack(makeCharacter(), [[currency('mapDust', 3, 'd'), 0, 0], [currency('essenceEmber', 2, 'e'), 1, 0]]);
    const a = expectOk(quickMove(ch, 'd', { stashTab: 'currency' }));
    const b = expectOk(quickMove(a, 'e', { stashTab: 'mapCurrency' }));
    expect(b.currencyStash).toEqual({ mapDust: 3, essenceEmber: 2 });
    expect(b.backpack.entries).toEqual([]);
    // With a count, only that many.
    const c = expectOk(rules.quickMove(ch, 'd', { stashTab: 'mapCurrency', count: 1 }));
    expect(c.currencyStash).toEqual({ mapDust: 1 });
    expect(at(c, 0, 0)).toMatchObject({ count: 2 });
  });
});

describe('withdrawing currency', () => {
  const banked = (count = 100, id: Parameters<typeof currencyStashUid>[0] = 'scrap') => makeCharacter({ nextUid: 50, currencyStash: { [id]: count } });

  it('drags a full stack (up to 40) into an empty cell as a new stack', () => {
    const out = expectOk(moveItem(banked(), S('scrap'), { kind: 'backpack', x: 4, y: 3 }));
    expect(at(out, 4, 3)).toEqual({ kind: 'currency', uid: 'i1e', currencyId: 'scrap', count: 40 });
    expect(out.currencyStash).toEqual({ scrap: 60 });
    expect(out.nextUid).toBe(51);
    expectUniqueUids(out);
    // A smaller slot gives what it has; Fracture Cores stack to 20.
    expect(at(expectOk(moveItem(banked(7), S('scrap'), { kind: 'backpack', x: 0, y: 0 })), 0, 0)).toMatchObject({ count: 7 });
    const cores = expectOk(moveItem(banked(50, 'fractureCore'), S('fractureCore'), { kind: 'backpack', x: 0, y: 0 }));
    expect(at(cores, 0, 0)).toMatchObject({ currencyId: 'fractureCore', count: 20 });
    expect(cores.currencyStash).toEqual({ fractureCore: 30 });
  });

  it('takes exactly `count` (at most a stack), and empties the slot at 0', () => {
    expect(at(expectOk(moveItem(banked(), S('scrap'), { kind: 'backpack', x: 0, y: 0 }, 1)), 0, 0)).toMatchObject({ count: 1 });
    const many = expectOk(moveItem(banked(), S('scrap'), { kind: 'backpack', x: 0, y: 0 }, 99));
    expect(at(many, 0, 0)).toMatchObject({ count: 40 });
    const last = expectOk(moveItem(banked(3), S('scrap'), { kind: 'backpack', x: 0, y: 0 }, 5));
    expect(at(last, 0, 0)).toMatchObject({ count: 3 });
    expect(last.currencyStash).toEqual({});
    expect(findItem(last, S('scrap'))).toBeNull();
    expect(expectErr(moveItem(last, S('scrap'), { kind: 'backpack', x: 1, y: 0 }))).toBe('Your Crafting Stash holds no Forge Scrap.');
    expect(expectErr(quickMove(last, S('scrap'), { stashTab: 'currency' }))).toBe('Your Crafting Stash holds no Forge Scrap.');
  });

  it('tops up a matching stack in the target cell; a full one or anything else sends it elsewhere in that grid', () => {
    const ch = withBackpack(banked(), [[currency('scrap', 35, 'mine'), 0, 0], [currency('scrap', 40, 'full'), 1, 0], [rareRing('r'), 2, 0]]);
    const topped = expectOk(moveItem(ch, S('scrap'), { kind: 'backpack', x: 0, y: 0 }));
    expect(at(topped, 0, 0)).toEqual({ kind: 'currency', uid: 'mine', currencyId: 'scrap', count: 40 });
    expect(topped.currencyStash).toEqual({ scrap: 95 });
    // Onto the full stack: a new stack elsewhere (topping up "mine" first), nothing displaced.
    const onFull = expectOk(moveItem(ch, S('scrap'), { kind: 'backpack', x: 1, y: 0 }));
    expect(at(onFull, 1, 0)).toMatchObject({ uid: 'full', count: 40 });
    expect(carried(onFull, 'scrap')).toBe(35 + 40 + 40);
    expect(onFull.currencyStash).toEqual({ scrap: 60 });
    const onRing = expectOk(moveItem(ch, S('scrap'), { kind: 'backpack', x: 2, y: 1 }));
    expect(findItem(onRing, 'r')?.location).toEqual({ kind: 'backpack', x: 2, y: 0 });
    expect(carried(onRing, 'scrap')).toBe(115);
  });

  it('withdraws into a stash tab cell, refuses bad cells and a full grid without changing anything', () => {
    const tab = expectOk(moveItem(banked(), S('scrap'), { kind: 'stash', tab: 0, x: 11, y: 7 }, 10));
    expect(tab.stash[0].grid.entries).toEqual([{ item: { kind: 'currency', uid: 'i1e', currencyId: 'scrap', count: 10 }, x: 11, y: 7 }]);
    expect(expectErr(moveItem(banked(), S('scrap'), { kind: 'backpack', x: 12, y: 0 }))).toBe('It does not fit there.');
    expect(expectErr(moveItem(banked(), S('scrap'), { kind: 'stash', tab: 5, x: 0, y: 0 }))).toBe('That stash tab does not exist.');
    let full = banked();
    for (let y = 0; y < 5; y++) for (let x = 0; x < 12; x++) full = withBackpack(full, [[map(`m${x}${y}`), x, y]]);
    expect(expectErr(moveItem(full, S('scrap'), { kind: 'backpack', x: 0, y: 0 }))).toBe('Your backpack is full.');
    expect(expectErr(quickMove(full, S('scrap'), { stashTab: 'currency' }))).toBe('Your backpack is full.');
  });

  it('refuses destinations that cannot hold currency', () => {
    const ch = banked();
    expect(expectErr(moveItem(ch, S('scrap'), { kind: 'equipment', slot: 'ring1' }))).toBe('Only equipment can be equipped.');
    expect(expectErr(moveItem(ch, S('scrap'), { kind: 'belt', index: 0 }))).toBe('Only flasks fit on the belt.');
    expect(expectErr(moveItem(ch, S('scrap'), { kind: 'mapDevice' }))).toBe('The Map Device only accepts maps.');
    expect(expectErr(moveItem(ch, S('scrap'), { kind: 'mapStash' }))).toBe('Only maps can be stored in the Map Stash.');
  });

  it('Ctrl-click takes a full stack to the backpack, topping up first; Shift+Ctrl-click (count 1) takes one', () => {
    const ch = withBackpack(banked(), [[currency('scrap', 35, 'mine'), 0, 0]]);
    const stack = expectOk(rules.quickMove(ch, S('scrap'), { stashTab: 'currency' }));
    expect(carried(stack, 'scrap')).toBe(75);
    expect(at(stack, 0, 0)).toMatchObject({ uid: 'mine', count: 40 });
    expect(stack.currencyStash).toEqual({ scrap: 60 });
    const one = expectOk(rules.quickMove(banked(), S('scrap'), { stashTab: 'currency', count: 1 }));
    expect(one.backpack.entries).toEqual([{ item: { kind: 'currency', uid: 'i1e', currencyId: 'scrap', count: 1 }, x: 0, y: 0 }]);
    expect(one.currencyStash).toEqual({ scrap: 99 });
    // Whatever tab the UI reports, a slot always withdraws to the backpack.
    expect(expectOk(quickMove(banked(), S('scrap'), { stashTab: null })).currencyStash).toEqual({ scrap: 60 });
    expect(expectOk(quickMove(banked(), S('scrap'), { stashTab: 0 })).currencyStash).toEqual({ scrap: 60 });
  });
});

describe('withdrawing into a grid with no free cell', () => {
  /** A backpack full of maps except for the given cells. */
  function fullBackpack(ch: CharacterSave, keep: [Item, number, number][]): CharacterSave {
    const taken = new Set(keep.map(([, x, y]) => `${x},${y}`));
    const fill: [Item, number, number][] = [];
    for (let y = 0; y < 5; y++) for (let x = 0; x < 12; x++) if (!taken.has(`${x},${y}`)) fill.push([map(`f${x}${y}`), x, y]);
    return withBackpack(ch, [...keep, ...fill]);
  }
  const banked = (count = 500) => makeCharacter({ nextUid: 50, currencyStash: { scrap: count } });

  it('Ctrl-click tops up a partial stack as far as it has room instead of refusing', () => {
    const ch = fullBackpack(banked(), [[currency('scrap', 30, 'mine'), 11, 4]]);
    const out = expectOk(rules.quickMove(ch, S('scrap'), { stashTab: 'currency' }));
    expect(at(out, 11, 4)).toEqual(currency('scrap', 40, 'mine'));
    expect(out.currencyStash).toEqual({ scrap: 490 });
    // Nothing new was opened, so no uid was minted.
    expect(out.nextUid).toBe(50);
    expectUniqueUids(out);
    // Several partial stacks share what fits; a small slot gives what it has.
    const two = fullBackpack(banked(), [[currency('scrap', 30, 'a'), 0, 0], [currency('scrap', 35, 'b'), 1, 0]]);
    const shared = expectOk(quickMove(two, S('scrap'), { stashTab: 'currency' }));
    expect([at(shared, 0, 0), at(shared, 1, 0)]).toEqual([currency('scrap', 40, 'a'), currency('scrap', 40, 'b')]);
    expect(shared.currencyStash).toEqual({ scrap: 485 });
    const small = expectOk(quickMove(fullBackpack(banked(4), [[currency('scrap', 30, 'mine'), 0, 0]]), S('scrap'), { stashTab: 'currency' }));
    expect(at(small, 0, 0)).toMatchObject({ count: 34 });
    expect(small.currencyStash).toEqual({});
  });

  it('a drag onto a blocked cell also takes what the matching stacks can hold; only no room at all refuses', () => {
    const ch = fullBackpack(banked(), [[currency('scrap', 30, 'mine'), 11, 4]]);
    const dropped = expectOk(moveItem(ch, S('scrap'), { kind: 'backpack', x: 0, y: 0 }));
    expect(at(dropped, 0, 0)?.uid).toBe('f00');
    expect(at(dropped, 11, 4)).toMatchObject({ uid: 'mine', count: 40 });
    expect(dropped.currencyStash).toEqual({ scrap: 490 });
    const full = fullBackpack(banked(), [[currency('scrap', 40, 'mine'), 11, 4]]);
    expect(expectErr(quickMove(full, S('scrap'), { stashTab: 'currency' }))).toBe('Your backpack is full.');
    expect(expectErr(moveItem(full, S('scrap'), { kind: 'backpack', x: 0, y: 0 }))).toBe('Your backpack is full.');
    // Another currency's partial stack is no room for Forge Scrap.
    const other = fullBackpack(banked(), [[currency('kindling', 3, 'k'), 11, 4]]);
    expect(expectErr(quickMove(other, S('scrap'), { stashTab: 'currency' }))).toBe('Your backpack is full.');
  });
});

describe('the Map Stash', () => {
  const T3 = (uid: string): MapItem => ({ ...map(uid), tier: 3, baseId: 'rimedOssuary' });

  it('files maps from the backpack, a stash tab and the Map Device, in deposit order', () => {
    let ch = withBackpack(makeCharacter(), [[map('a'), 0, 0]]);
    ch = { ...ch, mapDevice: T3('dev'), stash: [{ ...ch.stash[0], grid: { ...ch.stash[0].grid, entries: [{ item: map('s'), x: 2, y: 2 }] } }] };
    ch = expectOk(moveItem(ch, 'a', { kind: 'mapStash' }));
    ch = expectOk(rules.moveItem(ch, 's', { kind: 'mapStash' }));
    ch = expectOk(moveItem(ch, 'dev', { kind: 'mapStash' }));
    expect(ch.mapStash.map((m) => m.uid)).toEqual(['a', 's', 'dev']);
    expect(ch.backpack.entries).toEqual([]);
    expect(ch.stash[0].grid.entries).toEqual([]);
    expect(ch.mapDevice).toBeNull();
    expect(findItem(ch, 'dev')).toEqual({ item: T3('dev'), location: { kind: 'mapStash' } });
    expect(expectOk(moveItem(ch, 'dev', { kind: 'mapStash' }))).toBe(ch);
  });

  it('Ctrl-click with the Map Stash open files maps and currency into their dedicated storage', () => {
    const ch = withBackpack(makeCharacter(), [[map('a'), 0, 0], [currency('scrap', 3, 'c'), 1, 0]]);
    expect(expectOk(quickMove(ch, 'a', { stashTab: 'maps' })).mapStash.map((m) => m.uid)).toEqual(['a']);
    expect(expectOk(quickMove(ch, 'c', { stashTab: 'maps' })).currencyStash.scrap).toBe(3);
    expect(expectErr(moveItem(ch, 'c', { kind: 'mapStash' }))).toBe('Only maps can be stored in the Map Stash.');
  });

  it('holds at most 400 maps', () => {
    const maps = Array.from({ length: MAP_STASH_CAPACITY }, (_, i) => map(`ms${i}`));
    const ch = withBackpack(makeCharacter({ mapStash: maps }), [[map('a'), 0, 0]]);
    expect(expectErr(moveItem(ch, 'a', { kind: 'mapStash' }))).toBe('Your Map Stash is full: it holds at most 400 maps.');
    expect(expectErr(quickMove(ch, 'a', { stashTab: 'maps' }))).toBe('Your Map Stash is full: it holds at most 400 maps.');
  });

  it('withdraws to a free cell, else anywhere in that grid, never displacing anything', () => {
    const ch = withBackpack(makeCharacter({ mapStash: [map('a'), T3('b')] }), [[rareRing('r'), 0, 0]]);
    const free = expectOk(moveItem(ch, 'b', { kind: 'backpack', x: 5, y: 4 }));
    expect(findItem(free, 'b')?.location).toEqual({ kind: 'backpack', x: 5, y: 4 });
    expect(free.mapStash.map((m) => m.uid)).toEqual(['a']);
    const blocked = expectOk(moveItem(ch, 'b', { kind: 'backpack', x: 0, y: 0 }));
    expect(findItem(blocked, 'r')?.location).toEqual({ kind: 'backpack', x: 0, y: 0 });
    expect(findItem(blocked, 'b')?.location).toEqual({ kind: 'backpack', x: 0, y: 1 });
    const tab = expectOk(moveItem(ch, 'a', { kind: 'stash', tab: 0, x: 3, y: 3 }));
    expect(findItem(tab, 'a')?.location).toEqual({ kind: 'stash', tab: 0, x: 3, y: 3 });
    expect(expectErr(moveItem(ch, 'a', { kind: 'backpack', x: -1, y: 0 }))).toBe('It does not fit there.');
    expect(expectErr(moveItem(ch, 'a', { kind: 'equipment', slot: 'amulet' }))).toBe('Only equipment can be equipped.');
    expect(expectErr(moveItem(ch, 'a', { kind: 'currencyStash' }))).toBe('Only currency can be stored in the Crafting Stash.');
  });

  it('withdraws into the Map Device, filing the map it replaces', () => {
    const ch = makeCharacter({ mapStash: [map('a'), T3('b')] });
    const loaded = expectOk(moveItem(ch, 'b', { kind: 'mapDevice' }));
    expect(loaded.mapDevice?.uid).toBe('b');
    expect(loaded.mapStash.map((m) => m.uid)).toEqual(['a']);
    const swapped = expectOk(moveItem(loaded, 'a', { kind: 'mapDevice' }));
    expect(swapped.mapDevice?.uid).toBe('a');
    expect(swapped.mapStash.map((m) => m.uid)).toEqual(['b']);
    // Even with a full Map Stash (one map leaves as the other arrives).
    const fullStash = makeCharacter({ mapDevice: map('dev'), mapStash: Array.from({ length: MAP_STASH_CAPACITY }, (_, i) => map(`ms${i}`)) });
    const out = expectOk(moveItem(fullStash, 'ms7', { kind: 'mapDevice' }));
    expect(out.mapDevice?.uid).toBe('ms7');
    expect(out.mapStash).toHaveLength(MAP_STASH_CAPACITY);
    expect(out.mapStash[MAP_STASH_CAPACITY - 1].uid).toBe('dev');
  });

  it('Ctrl-click on the Map Device files its map into the open Map Stash (else the backpack)', () => {
    const ch = makeCharacter({ mapDevice: T3('dev'), mapStash: [map('a')] });
    const filed = expectOk(rules.quickMove(ch, 'dev', { stashTab: 'maps' }));
    expect(filed.mapDevice).toBeNull();
    expect(filed.mapStash.map((m) => m.uid)).toEqual(['a', 'dev']);
    expect(filed.backpack.entries).toEqual([]);
    for (const stashTab of [null, 0, 'currency'] as const) {
      const out = expectOk(quickMove(ch, 'dev', { stashTab }));
      expect(findItem(out, 'dev')?.location).toEqual({ kind: 'backpack', x: 0, y: 0 });
      expect(out.mapStash.map((m) => m.uid)).toEqual(['a']);
    }
    const fullStash = makeCharacter({ mapDevice: map('dev'), mapStash: Array.from({ length: MAP_STASH_CAPACITY }, (_, i) => map(`ms${i}`)) });
    expect(expectErr(quickMove(fullStash, 'dev', { stashTab: 'maps' }))).toBe('Your Map Stash is full: it holds at most 400 maps.');
  });

  it('Ctrl-click sends a Map Stash map to the backpack', () => {
    const ch = makeCharacter({ mapStash: [map('a'), T3('b')] });
    const out = expectOk(rules.quickMove(ch, 'b', { stashTab: 'maps' }));
    expect(findItem(out, 'b')?.location).toEqual({ kind: 'backpack', x: 0, y: 0 });
    let full = ch;
    for (let y = 0; y < 5; y++) for (let x = 0; x < 12; x++) full = withBackpack(full, [[currency('scrap', 40, `c${x}${y}`), x, y]]);
    expect(expectErr(quickMove(full, 'b', { stashTab: 'maps' }))).toBe('Your backpack is full.');
  });

  it('describes a Map Stash map with its withdraw hint, and clearNewFlags clears its badge', () => {
    const ch = makeCharacter({ mapStash: [{ ...map('a'), isNew: true }] });
    expect(rules.describeItem(ch.mapStash[0], ch).hint).toBe('Drag it to the Map Device or your backpack; Ctrl+click takes it to your backpack.');
    expect(clearNewFlags(ch).mapStash[0].isNew).toBeUndefined();
    expect(rules.clearNewFlags(ch).mapStash).toEqual([map('a')]);
  });

  it('lists its maps among the held items and never mints their uids again', () => {
    const ch = makeCharacter({ nextUid: 1, mapStash: [map('i1'), map('i2')] });
    expect([...heldUids(ch)].sort()).toEqual(['i1', 'i2']);
    const bought = expectOk(rules.buyOffer(ch, 'map-t1-ashenForge'));
    expect(bought.item.uid).toBe('i3');
    expectUniqueUids(bought.character);
    // An incoming item with a slot uid never keeps it.
    const got = expectOk(addToBackpack(ch, { kind: 'currency', uid: 'cstash:scrap', currencyId: 'scrap', count: 2 }));
    expect(got.backpack.entries[0].item.uid).toBe('i3');
  });
});

describe('count: splitting stacks', () => {
  const ch = () => withBackpack(makeCharacter({ nextUid: 9 }), [
    [currency('scrap', 30, 'a'), 0, 0], [currency('scrap', 38, 'b'), 1, 0], [currency('kindling', 4, 'k'), 2, 0],
    [flask('lifeFlask', 6, 'f'), 3, 0],
  ]);

  it('splits onto an empty cell as a new stack', () => {
    const out = expectOk(rules.moveItem(ch(), 'a', { kind: 'backpack', x: 5, y: 2 }, 12));
    expect(at(out, 0, 0)).toEqual({ kind: 'currency', uid: 'a', currencyId: 'scrap', count: 18 });
    expect(at(out, 5, 2)).toEqual({ kind: 'currency', uid: 'i9', currencyId: 'scrap', count: 12 });
    expectUniqueUids(out);
    const tab = expectOk(moveItem(ch(), 'f', { kind: 'stash', tab: 0, x: 0, y: 0 }, 2));
    expect(tab.stash[0].grid.entries[0].item).toEqual({ kind: 'flask', uid: 'i9', flaskId: 'lifeFlask', count: 2 });
    expect(at(tab, 3, 0)).toMatchObject({ count: 4 });
  });

  it('merges a split into a matching stack as far as it has room', () => {
    const out = expectOk(moveItem(ch(), 'a', { kind: 'backpack', x: 1, y: 0 }, 5));
    expect(at(out, 1, 0)).toMatchObject({ uid: 'b', count: 40 });
    expect(at(out, 0, 0)).toMatchObject({ uid: 'a', count: 28 });
    expect(expectErr(moveItem(out, 'a', { kind: 'backpack', x: 1, y: 0 }, 1))).toBe('That stack is full.');
    // Room for 2 of 3: the third stays behind.
    const partial = expectOk(moveItem(ch(), 'a', { kind: 'backpack', x: 1, y: 0 }, 3));
    expect(at(partial, 1, 0)).toMatchObject({ uid: 'b', count: 40 });
    expect(at(partial, 0, 0)).toMatchObject({ uid: 'a', count: 28 });
    expect(expectErr(moveItem(ch(), 'a', { kind: 'backpack', x: 2, y: 0 }, 3))).toBe('Something is in the way.');
  });

  it('treats a count of the whole stack (or more) as a normal move, and the same cell as a no-op', () => {
    const whole = expectOk(moveItem(ch(), 'k', { kind: 'backpack', x: 7, y: 1 }, 4));
    expect(at(whole, 7, 1)).toMatchObject({ uid: 'k', count: 4 });
    expect(expectOk(moveItem(ch(), 'k', { kind: 'backpack', x: 7, y: 1 }, 400))).toEqual(whole);
    const same = ch();
    expect(expectOk(moveItem(same, 'a', { kind: 'backpack', x: 0, y: 0 }, 3))).toBe(same);
    // Items that are not stacks ignore it.
    const ringCh = withBackpack(makeCharacter(), [[rareRing('r'), 0, 0]]);
    expect(findItem(expectOk(moveItem(ringCh, 'r', { kind: 'backpack', x: 4, y: 0 }, 1)), 'r')?.location)
      .toEqual({ kind: 'backpack', x: 4, y: 0 });
  });

  it('quick-moves part of a currency stack into dedicated storage from a normal tab', () => {
    const out = expectOk(quickMove(ch(), 'a', { stashTab: 0, count: 10 }));
    expect(out.stash[0].grid.entries).toEqual([]);
    expect(out.currencyStash.scrap).toBe(10);
    expect(at(out, 0, 0)).toMatchObject({ count: 20 });
    const back = expectOk(quickMove(out, S('scrap'), { stashTab: 0, count: 4 }));
    expect(back.currencyStash.scrap).toBe(6);
    expect(carried(back, 'scrap')).toBe(30 - 10 + 4 + 38);
  });

  it('unloads part of a belt slot and loads at most `count` charges', () => {
    const belted = { ...ch(), belt: [{ flaskId: 'lifeFlask' as const, count: 5 }, null, null, null] };
    const out = expectOk(moveItem(belted, beltUid(0), { kind: 'backpack', x: 9, y: 4 }, 2));
    expect(out.belt[0]).toEqual({ flaskId: 'lifeFlask', count: 3 });
    expect(at(out, 9, 4)).toEqual({ kind: 'flask', uid: 'i9', flaskId: 'lifeFlask', count: 2 });
    const loaded = expectOk(moveItem(ch(), 'f', { kind: 'belt', index: 1 }, 2));
    expect(loaded.belt[1]).toEqual({ flaskId: 'lifeFlask', count: 2 });
    expect(at(loaded, 3, 0)).toMatchObject({ count: 4 });
  });

  it('rejects a malformed count without changing anything', () => {
    for (const bad of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, '3', {}, true]) {
      expect(expectErr(moveItem(ch(), 'a', { kind: 'backpack', x: 5, y: 2 }, bad as unknown as number)))
        .toBe('Choose how many to move: a whole number of at least 1.');
      expect(expectErr(quickMove(ch(), 'a', { stashTab: 0, count: bad as unknown as number })))
        .toBe('Choose how many to move: a whole number of at least 1.');
    }
    // Fractions floor; null means "the default".
    expect(at(expectOk(moveItem(ch(), 'a', { kind: 'backpack', x: 5, y: 2 }, 2.7)), 5, 2)).toMatchObject({ count: 2 });
    expect(at(expectOk(moveItem(ch(), 'a', { kind: 'backpack', x: 5, y: 2 }, null as unknown as number)), 5, 2)).toMatchObject({ count: 30 });
  });
});

describe('Deposit all', () => {
  it('files every currency stack in the backpack and leaves everything else', () => {
    const ch = withBackpack(makeCharacter({ currencyStash: { scrap: 5 } }), [
      [currency('scrap', 40, 'a'), 0, 0], [currency('scrap', 3, 'b'), 4, 4], [currency('voidNeedle', 2, 'v'), 1, 0],
      [map('m'), 2, 0], [flask('focusFlask', 2, 'f'), 3, 0], [rareRing('r'), 5, 0],
    ]);
    const out = expectOk(rules.depositAllCurrency(ch));
    expect(out.currencyStash).toEqual({ scrap: 48, voidNeedle: 2 });
    expect(out.backpack.entries.map((e) => e.item.uid).sort()).toEqual(['f', 'm', 'r']);
    expect(depositAllCurrency(ch)).toEqual({ ok: true, value: out });
  });

  it('fills a nearly full slot from the leftmost stacks and keeps the rest', () => {
    const ch = withBackpack(makeCharacter({ currencyStash: { scrap: CURRENCY_STASH_MAX - 50 } }), [
      [currency('scrap', 40, 'right'), 6, 0], [currency('scrap', 40, 'left'), 0, 3], [currency('kindling', 4, 'k'), 3, 3],
    ]);
    const out = expectOk(depositAllCurrency(ch));
    expect(out.currencyStash).toEqual({ scrap: CURRENCY_STASH_MAX, kindling: 4 });
    expect(out.backpack.entries).toEqual([{ item: { kind: 'currency', uid: 'right', currencyId: 'scrap', count: 30 }, x: 6, y: 0 }]);
  });

  it('refuses when there is nothing to deposit or every slot is full', () => {
    expect(expectErr(depositAllCurrency(withBackpack(makeCharacter(), [[map('m'), 0, 0]])))).toBe('There is no currency in your backpack.');
    const full = withBackpack(makeCharacter({ currencyStash: { scrap: CURRENCY_STASH_MAX, seal: CURRENCY_STASH_MAX } }), [
      [currency('scrap', 1, 'a'), 0, 0], [currency('seal', 1, 's'), 1, 0],
    ]);
    expect(expectErr(depositAllCurrency(full))).toBe('Your Crafting Stash is full of Forge Scrap and Binding Seal: a slot holds at most 5,000.');
  });
});

describe('crafting straight from a slot', () => {
  it('previews and applies an equipment currency from a slot exactly like from a stack, taking one from the slot', () => {
    const ring = equip({ baseId: 'emberRing', itemLevel: 60, rarity: 'normal', uid: 'ring' });
    const fromSlot = withBackpack(makeCharacter({ currencyStash: { kindling: 2 } }), [[ring, 0, 0]]);
    const fromStack = withBackpack(makeCharacter(), [[ring, 0, 0], [currency('kindling', 2, 'k'), 5, 0]]);
    expect(rules.craftingTargetError(fromSlot, S('kindling'), 'ring')).toBeNull();
    expect(rules.craftPreview(fromSlot, S('kindling'), 'ring')).toEqual(rules.craftPreview(fromStack, 'k', 'ring'));
    const a = expectOk(rules.applyCurrency(fromSlot, S('kindling'), 'ring'));
    const b = expectOk(rules.applyCurrency(fromStack, 'k', 'ring'));
    expect(a.message).toBe(b.message);
    expect(findItem(a.character, 'ring')?.item).toEqual(findItem(b.character, 'ring')?.item);
    expect(a.character.currencyStash).toEqual({ kindling: 1 });
    expect(a.character.stats.itemsCrafted).toBe(1);
    // The last one empties the slot; then it is gone.
    const solvent = withBackpack(makeCharacter({ currencyStash: { solvent: 1 } }), [[rareRing('r'), 0, 0]]);
    const last = expectOk(rules.applyCurrency(solvent, S('solvent'), 'r'));
    expect(last.character.currencyStash).toEqual({});
    expect(rules.craftingTargetError(last.character, S('solvent'), 'r')).toBe('That currency is no longer available.');
    expect(expectErr(rules.applyCurrency(last.character, S('solvent'), 'r'))).toBe('That currency is no longer available.');
  });

  it('applies affix-choice currencies and works on equipped items and stash tabs', () => {
    const worn = makeCharacter({ currencyStash: { seal: 3 }, equipment: { ring1: rareRing('r') } });
    const sealed = expectOk(rules.applyCurrency(worn, S('seal'), 'r', 1));
    expect(sealed.character.equipment.ring1!.affixes[1].sealed).toBe(true);
    expect(sealed.character.currencyStash).toEqual({ seal: 2 });
    expect(rules.craftingTargetError(worn, S('seal'), S('seal'))).toBe('Choose an item to apply Binding Seal to.');
  });

  it('applies map currency from a slot to maps in the backpack and in the Map Stash', () => {
    const ch = withBackpack(makeCharacter({ currencyStash: { mapDust: 5, voidNeedle: 1 }, mapStash: [map('kept')] }), [[map('bag'), 0, 0]]);
    expect(rules.craftingTargetError(ch, S('mapDust'), 'kept')).toBeNull();
    expect(rules.craftPreview(ch, S('mapDust'), 'kept')[0]).toMatch(/^Awakens a Magic map/);
    const inStash = expectOk(rules.applyCurrency(ch, S('mapDust'), 'kept'));
    expect(inStash.character.mapStash[0]).toMatchObject({ uid: 'kept', rarity: 'magic' });
    expect(inStash.character.currencyStash).toEqual({ mapDust: 4, voidNeedle: 1 });
    const inBag = expectOk(rules.applyCurrency(inStash.character, S('voidNeedle'), 'bag'));
    expect(findItem(inBag.character, 'bag')?.item).toMatchObject({ corrupted: true });
    expect(inBag.character.currencyStash).toEqual({ mapDust: 4 });
    expect(rules.craftingTargetError(ch, S('mapDust'), 'nothing')).toBe('That item no longer exists.');
    expect(rules.craftingTargetError(ch, S('kindling'), 'bag')).toBe('That currency is no longer available.');
  });

  it('draws fresh server entropy for slot crafts too', () => {
    const ring = equip({ baseId: 'emberRing', itemLevel: 60, rarity: 'normal', uid: 'ring' });
    const ch = withBackpack(makeCharacter({ currencyStash: { kindling: 3 } }), [[ring, 0, 0]]);
    const server = withServerEntropy(rules, () => 77);
    const a = expectOk(server.applyCurrency(ch, S('kindling'), 'ring'));
    expect(a.character.currencyStash).toEqual({ kindling: 2 });
    expect(a.character.rngState).not.toBe(expectOk(rules.applyCurrency(ch, S('kindling'), 'ring')).character.rngState);
  });
});

describe('Rook and refunds use the special tabs', () => {
  it('Rook takes payment from the Crafting Stash after the backpack', () => {
    const ch = withBackpack(makeCharacter({ currencyStash: { scrap: 10 } }), [[currency('scrap', 2, 'a'), 0, 0]]);
    const offer = rules.merchantOffers(ch).find((o) => o.id === 'map-t2-ashenForge')!;
    expect(offer.affordable).toBe(true);
    const out = expectOk(rules.buyOffer(ch, 'map-t2-ashenForge'));
    expect(carried(out.character, 'scrap')).toBe(0);
    expect(out.character.currencyStash).toEqual({ scrap: 8 });
  });

  it('stows refunded currency in the Crafting Stash when the backpack is full', () => {
    let full = makeCharacter({ currencyStash: { scrap: 7 } });
    for (let y = 0; y < 5; y++) for (let x = 0; x < 12; x++) full = withBackpack(full, [[map(`m${x}${y}`), x, y]]);
    const out = expectOk(stowItem(full, currency('scrap', 3, 'refund')));
    expect(out).toMatchObject({ where: 'currencyStash', tab: null, text: 'your Crafting Stash' });
    expect(out.character.currencyStash).toEqual({ scrap: 10 });
  });
});

describe('trade locks', () => {
  const lockedRules = (uids: string[]) => withItemLocks(rules, () => new Set(uids));

  it('leaves locked stacks in the backpack on "Deposit all" and refuses moving locked items into the special tabs', () => {
    const ch = withBackpack(makeCharacter(), [[currency('scrap', 10, 'locked'), 0, 0], [currency('scrap', 5, 'free'), 1, 0], [map('m'), 2, 0]]);
    const r = lockedRules(['locked', 'm']);
    const out = expectOk(r.depositAllCurrency(ch));
    expect(out.currencyStash).toEqual({ scrap: 5 });
    expect(findItem(out, 'locked')?.item).toEqual(currency('scrap', 10, 'locked'));
    expect(expectErr(r.moveItem(ch, 'locked', { kind: 'currencyStash' }))).toBe(LOCKED_ITEM_ERROR);
    expect(expectErr(r.quickMove(ch, 'm', { stashTab: 'maps' }))).toBe(LOCKED_ITEM_ERROR);
    // A withdrawal never merges into a locked stack (it is masked while the rules run).
    const banked = { ...ch, currencyStash: { scrap: 50 } };
    const w = expectOk(r.moveItem(banked, S('scrap'), { kind: 'backpack', x: 0, y: 0 }));
    expect(findItem(w, 'locked')?.item).toEqual(currency('scrap', 10, 'locked'));
    expect(carried(w, 'scrap')).toBe(10 + 5 + 40);
    // Splitting a locked stack is refused.
    expect(expectErr(r.moveItem(ch, 'locked', { kind: 'backpack', x: 6, y: 0 }, 2))).toBe(LOCKED_ITEM_ERROR);
    expect(LOCKED_CHANGE_ERROR).toMatch(/trade offer/);
  });

  it('"Deposit all" says the currency is in the trade offer when every stack is', () => {
    const ch = withBackpack(makeCharacter(), [[currency('scrap', 10, 'a'), 0, 0], [currency('kindling', 5, 'b'), 1, 0], [map('m'), 2, 0]]);
    expect(expectErr(lockedRules(['a', 'b']).depositAllCurrency(ch))).toBe(LOCKED_CURRENCY_ERROR);
    expect(LOCKED_CURRENCY_ERROR).toBe('Your currency is in your trade offer. Take it out of the offer or cancel the trade first.');
    // Nothing locked but no currency, or unlocked currency whose slots are full: the plain refusals stand.
    const none = withBackpack(makeCharacter(), [[map('m'), 0, 0]]);
    expect(expectErr(lockedRules(['m']).depositAllCurrency(none))).toBe('There is no currency in your backpack.');
    const full = { ...ch, currencyStash: { kindling: CURRENCY_STASH_MAX } };
    expect(expectErr(lockedRules(['a']).depositAllCurrency(full))).toBe('Your Crafting Stash is full of Kindling Shard: a slot holds at most 5,000.');
  });
});

describe('purity and determinism', () => {
  it('never mutates its input and gives the same result for the same input', () => {
    const make = () => withBackpack(makeCharacter({ currencyStash: { scrap: 90, mapDust: 2 }, mapStash: [map('a'), map('b')] }), [
      [currency('scrap', 30, 'c'), 0, 0], [map('bag'), 1, 0], [equip({ baseId: 'emberRing', itemLevel: 60, rarity: 'normal', uid: 'ring' }), 2, 0],
    ]);
    const frozen = deepFreeze(make());
    const ops: ((ch: CharacterSave) => unknown)[] = [
      (ch) => moveItem(ch, 'c', { kind: 'currencyStash' }, 5),
      (ch) => moveItem(ch, S('scrap'), { kind: 'backpack', x: 6, y: 3 }),
      (ch) => moveItem(ch, 'a', { kind: 'mapDevice' }),
      (ch) => moveItem(ch, 'bag', { kind: 'mapStash' }),
      (ch) => moveItem(ch, 'c', { kind: 'backpack', x: 9, y: 1 }, 4),
      (ch) => quickMove(ch, S('scrap'), { stashTab: 'currency', count: 1 }),
      (ch) => quickMove(ch, 'b', { stashTab: 'maps' }),
      (ch) => depositAllCurrency(ch),
      (ch) => rules.applyCurrency(ch, S('mapDust'), 'a'),
      (ch) => rules.applyCurrency(ch, S('scrap'), 'ring'),
      (ch) => clearNewFlags(ch),
    ];
    for (const op of ops) {
      const first = op(frozen);
      expect(first).toEqual(op(make()));
      expect(frozen).toEqual(make());
    }
  });

  it('keeps uids unique through a long mixed session', () => {
    let ch = rules.createCharacter('Sella', 4);
    expect(ch.currencyStash).toEqual({});
    expect(ch.mapStash).toEqual([]);
    ch = expectOk(rules.depositAllCurrency(ch));
    const mapUids = ch.backpack.entries.filter((e) => e.item.kind === 'map').map((e) => e.item.uid);
    for (const uid of mapUids) ch = expectOk(rules.quickMove(ch, uid, { stashTab: 'maps' }));
    for (let i = 0; i < 3; i++) ch = expectOk(rules.quickMove(ch, S('scrap'), { stashTab: 'currency', count: 1 }));
    ch = expectOk(rules.moveItem(ch, mapUids[0], { kind: 'mapDevice' }));
    ch = expectOk(rules.moveItem(ch, mapUids[1], { kind: 'mapDevice' }));
    ch = expectOk(rules.buyOffer(ch, 'map-t1-rimedOssuary')).character;
    expect(ch.mapStash.map((m) => m.uid)).toEqual([mapUids[2], mapUids[0]]);
    expect(ch.currencyStash.scrap).toBe(10 - 3);
    expectUniqueUids(ch);
    const again = rules.parseSave(rules.serializeSave({ ...rules.newSave(), characters: [ch] })).characters[0];
    expect(again).toEqual(ch);
  });
});

describe('player-facing text', () => {
  it('uses only glyphs the UI fonts cover', () => {
    const COVERED: readonly [number, number][] = [
      [0x20, 0x7e], [0xa0, 0xff], [0x131, 0x131], [0x152, 0x153], [0x2bb, 0x2bc], [0x2c6, 0x2c6], [0x2da, 0x2da],
      [0x2dc, 0x2dc], [0x2000, 0x206f], [0x20ac, 0x20ac], [0x2122, 0x2122], [0x2191, 0x2191], [0x2193, 0x2193],
      [0x2212, 0x2212], [0x2215, 0x2215],
    ];
    const texts: string[] = [];
    const ch = makeCharacter({ currencyStash: { scrap: CURRENCY_STASH_MAX }, mapStash: Array.from({ length: MAP_STASH_CAPACITY }, (_, i) => map(`m${i}`)) });
    for (const id of CURRENCY_IDS) {
      const d = rules.describeItem(currencyStashItem(ch, id), ch);
      texts.push(...d.headerLines, d.hint ?? '');
    }
    const bag = withBackpack(ch, [[currency('scrap', 3, 'c'), 0, 0], [map('x'), 1, 0], [rareRing('r'), 2, 0]]);
    const results = [
      moveItem(bag, 'c', { kind: 'currencyStash' }), moveItem(bag, 'x', { kind: 'mapStash' }), moveItem(bag, 'r', { kind: 'currencyStash' }),
      moveItem(bag, 'c', { kind: 'backpack', x: 0, y: 1 }, 0), depositAllCurrency(bag), depositAllCurrency(makeCharacter()),
      moveItem(makeCharacter(), S('kindling'), { kind: 'backpack', x: 0, y: 0 }), rules.describeItem(ch.mapStash[0], ch).hint,
    ];
    for (const r of results) {
      if (typeof r === 'string') texts.push(r);
      else if (r && !r.ok) texts.push(r.error);
    }
    expect(texts.length).toBeGreaterThan(30);
    const bad = texts.flatMap((t) => [...t].filter((c) => !COVERED.some(([a, b]) => c.codePointAt(0)! >= a && c.codePointAt(0)! <= b)));
    expect(bad).toEqual([]);
  });
});
