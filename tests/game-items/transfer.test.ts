// Items changing hands (GAME_SPEC §12 Trading) and items handed back without loss (stowItem).
import { describe, expect, it } from 'vitest';
import type { CharacterSave, EquipmentItem, Item } from '../../src/contracts/items';
import { MAP_STASH_CAPACITY, MAX_STASH_TABS } from '../../src/contracts/items';
import { TRADE_MAX_ITEMS } from '../../src/contracts/net';
import { allItems, beltUid, findItem, stowItem, tradeItems, tradeOfferError } from '../../src/game/items';
import { currency, equip, expectErr, expectOk, flask, makeCharacter, map, withBackpack } from './fixtures';

const ring = (uid: string): EquipmentItem => equip({
  baseId: 'emberRing', itemLevel: 48, rarity: 'magic', uid,
  affixes: [{ affixId: 'life', tier: 4, crafted: true }, { affixId: 'castSpeed', tier: 5, sealed: true }],
});

function alice(): CharacterSave {
  return withBackpack(makeCharacter({ id: 'a', name: 'Alice', nextUid: 20 }), [
    [ring('i3'), 0, 0], [currency('scrap', 12, 'i4'), 2, 0], [map('i5'), 3, 0],
  ]);
}

function bob(): CharacterSave {
  return withBackpack(makeCharacter({ id: 'b', name: 'Bob', nextUid: 6 }), [
    [currency('scrap', 30, 'i3'), 0, 0], [flask('lifeFlask', 4, 'i4'), 1, 0],
  ]);
}

/** Everything the characters hold, uid-less and with stacks summed per type: what a trade must conserve. */
function goods(...chs: CharacterSave[]): string[] {
  const stacks = new Map<string, number>();
  const others: string[] = [];
  for (const f of chs.flatMap((ch) => allItems(ch))) {
    const item: Item = f.item;
    if (item.kind === 'currency' || item.kind === 'flask') {
      const key = item.kind === 'currency' ? item.currencyId : item.flaskId;
      stacks.set(key, (stacks.get(key) ?? 0) + item.count);
      continue;
    }
    const { uid: _u, isNew: _n, ...rest } = item;
    others.push(JSON.stringify(rest));
  }
  return [...others, ...[...stacks].map(([k, n]) => `${k} x${n}`)].sort();
}

describe('tradeOfferError', () => {
  it('accepts distinct backpack items up to the limit', () => {
    expect(tradeOfferError(alice(), [])).toBeNull();
    expect(tradeOfferError(alice(), ['i3', 'i4', 'i5'])).toBeNull();
  });

  it('rejects anything else with a reason', () => {
    const a = { ...alice(), equipment: { ring2: ring('worn') }, belt: [{ flaskId: 'lifeFlask' as const, count: 2 }, null, null, null] };
    const stashed = { ...a, stash: [{ name: 'Tab 1', grid: { w: 12, h: 8, entries: [{ item: map('st'), x: 0, y: 0 }] } }] };
    expect(tradeOfferError(a, 'i3')).toBe('That trade offer is not valid.');
    expect(tradeOfferError(a, [7])).toBe('That trade offer is not valid.');
    expect(tradeOfferError(a, ['i3', 'i3'])).toBe('Each item can only be offered once.');
    expect(tradeOfferError(a, ['gone'])).toBe('That item no longer exists.');
    expect(tradeOfferError(a, ['worn'])).toBe('Only items in your backpack can be traded.');
    expect(tradeOfferError(a, [beltUid(0)])).toBe('Only items in your backpack can be traded.');
    expect(tradeOfferError(stashed, ['st'])).toBe('Only items in your backpack can be traded.');
    const many = Array.from({ length: TRADE_MAX_ITEMS + 1 }, (_, i) => `u${i}`);
    expect(tradeOfferError(a, many)).toBe(`You can offer at most ${TRADE_MAX_ITEMS} items.`);
  });
});

describe('tradeItems', () => {
  it('swaps both offers atomically, conserving every item and keeping crafted / sealed marks', () => {
    const a = alice();
    const b = bob();
    const out = expectOk(tradeItems(a, ['i3', 'i5'], b, ['i3']));
    expect(goods(out.a, out.b)).toEqual(goods(a, b));
    // Alice got Bob's 30 Scrap (merged into her 12: one stack of 40, one of 2 — nothing lost).
    const scrap = out.a.backpack.entries.filter((e) => e.item.kind === 'currency').reduce((n, e) => n + (e.item as { count: number }).count, 0);
    expect(scrap).toBe(42);
    // Bob got the ring; its uid "i3" was taken on Bob (his Scrap), but that stack left in the same trade.
    const got = out.b.backpack.entries.find((e) => e.item.kind === 'equipment')!.item as EquipmentItem;
    expect(got.affixes).toEqual(ring('x').affixes);
    expect(got.isNew).toBe(true);
    expect(findItem(out.b, 'i5')?.item.kind).toBe('map');
    // Alice's "i3" is now the rest of Bob's Scrap (the ring that held it left in the same trade).
    expect(findItem(out.a, 'i3')?.item).toMatchObject({ kind: 'currency', currencyId: 'scrap', count: 2 });
    // Nothing of the inputs changed.
    expect(a).toEqual(alice());
    expect(b).toEqual(bob());
  });

  it('re-mints a received uid the receiver already holds and moves its counter past free ones', () => {
    const a = alice();
    const b = bob();
    const out = expectOk(tradeItems(a, ['i5'], b, ['i4'])); // Bob holds no i5; Alice still holds i4 (her Scrap)
    expect(findItem(out.b, 'i5')?.item.kind).toBe('map');
    expect(out.b.nextUid).toBe(6); // i5 < Bob's counter (6): unchanged
    const flaskOnAlice = out.a.backpack.entries.find((e) => e.item.kind === 'flask')!.item;
    expect(flaskOnAlice.uid).not.toBe('i4');
    expect(new Set(allItems(out.a).map((f) => f.item.uid)).size).toBe(allItems(out.a).length);
  });

  it('fails without changing anything when an offer is no longer valid or a backpack has no room', () => {
    const a = alice();
    const b = bob();
    expect(expectErr(tradeItems(a, ['nope'], b, []))).toBe('Alice\'s offer changed: That item no longer exists.');
    expect(expectErr(tradeItems(a, [], b, ['i3', 'i3']))).toBe('Bob\'s offer changed: Each item can only be offered once.');
    // Fill Bob's backpack to the brim: the ring (2 cells) cannot arrive, the 1-cell map could.
    let full = b;
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 12; x++) {
        if (full.backpack.entries.some((e) => e.x === x && e.y === y)) continue;
        full = withBackpack(full, [[map(`f${x}-${y}`), x, y]]);
      }
    }
    expect(expectErr(tradeItems(a, ['i3'], full, []))).toMatch(/^Bob's backpack has no room for .+\. Nothing was traded\.$/);
    // Giving frees room first: Bob's map for Alice's map fits.
    const swapped = expectOk(tradeItems(a, ['i5'], full, ['f5-4']));
    expect(findItem(swapped.b, 'i5')?.location).toEqual({ kind: 'backpack', x: 5, y: 4 });
  });

  it('places the largest received items first and refuses a trade with oneself', () => {
    // Bob has exactly one free 1x1 cell and one free 1x3 column: a wand (1x3) and a map both fit only if
    // the wand goes first.
    let b = withBackpack(makeCharacter({ id: 'b', name: 'Bob' }), []);
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 12; x++) {
        const freeWand = x === 0 && y < 3;
        const freeCell = x === 11 && y === 4;
        if (!freeWand && !freeCell) b = withBackpack(b, [[map(`f${x}-${y}`), x, y]]);
      }
    }
    const wand = equip({ baseId: 'ashwoodWand', itemLevel: 5, rarity: 'normal', uid: 'wand' });
    const a = withBackpack(makeCharacter({ id: 'a', name: 'Alice' }), [[map('small'), 5, 0], [wand, 0, 0]]);
    const out = expectOk(tradeItems(a, ['small', 'wand'], b, []));
    expect(findItem(out.b, 'wand')?.location).toEqual({ kind: 'backpack', x: 0, y: 0 });
    expect(findItem(out.b, 'small')?.location).toEqual({ kind: 'backpack', x: 11, y: 4 });
    expect(expectErr(tradeItems(a, ['small'], a, []))).toBe('You cannot trade with yourself.');
  });

  it('puts flasks into the backpack, not the belt', () => {
    const a = { ...alice(), belt: [{ flaskId: 'lifeFlask' as const, count: 1 }, null, null, null] };
    const out = expectOk(tradeItems(a, [], bob(), ['i4']));
    expect(out.a.belt[0]).toEqual({ flaskId: 'lifeFlask', count: 1 });
    expect(out.a.backpack.entries.some((e) => e.item.kind === 'flask' && (e.item as { count: number }).count === 4)).toBe(true);
  });
});

describe('stowItem', () => {
  it('puts a map into an empty Map Device first', () => {
    const out = expectOk(stowItem(makeCharacter(), map('back')));
    expect(out).toMatchObject({ where: 'mapDevice', tab: null, text: 'your Map Device' });
    expect(out.character.mapDevice?.uid).toBe('back');
  });

  it('falls back to the backpack, the Map Stash, then the stash, then a new Recovered tab', () => {
    const occupied: CharacterSave = { ...makeCharacter(), mapDevice: map('in-device') };
    const bag = expectOk(stowItem(occupied, map('back')));
    expect(bag).toMatchObject({ where: 'backpack', text: 'your backpack' });
    expect(findItem(bag.character, 'back')?.location.kind).toBe('backpack');

    let full = occupied;
    for (let y = 0; y < 5; y++) for (let x = 0; x < 12; x++) full = withBackpack(full, [[map(`b${x}-${y}`), x, y]]);
    const filed = expectOk(stowItem(full, map('back')));
    expect(filed).toMatchObject({ where: 'mapStash', tab: null, text: 'your Map Stash' });
    expect(findItem(filed.character, 'back')?.location).toEqual({ kind: 'mapStash' });

    full = { ...full, mapStash: Array.from({ length: MAP_STASH_CAPACITY }, (_, i) => map(`ms${i}`)) };
    const stash = expectOk(stowItem(full, map('back')));
    expect(stash).toMatchObject({ where: 'stash', tab: 0, text: 'your stash (tab "Tab 1")' });
    expect(findItem(stash.character, 'back')?.location).toMatchObject({ kind: 'stash', tab: 0 });

    const fullTab = { name: 'Tab 1', grid: { w: 1, h: 1, entries: [{ item: map('s0'), x: 0, y: 0 }] } };
    const recovered = expectOk(stowItem({ ...full, stash: [fullTab] }, map('back')));
    expect(recovered).toMatchObject({ where: 'stash', tab: 1, text: 'your stash (tab "Recovered")' });
    expect(recovered.character.stash[1].name).toBe('Recovered');

    const allFull = { ...full, stash: Array.from({ length: MAX_STASH_TABS }, () => fullTab) };
    expect(expectErr(stowItem(allFull, map('back')))).toBe('There is no room for Tier 1 Map: your backpack and stash are full.');
  });

  it('keeps uids unique on the way back', () => {
    const ch = withBackpack(makeCharacter({ nextUid: 3 }), [[currency('scrap', 1, 'i2'), 0, 0]]);
    const out = expectOk(stowItem({ ...ch, mapDevice: map('dev') }, map('i2')));
    expect(out.character.backpack.entries.map((e) => e.item.uid).sort()).toEqual(['i2', 'i3']);
  });
});
