// Item uids stay unique per character when items arrive from OTHER characters (trades, public drops).
// Every character mints "i0", "i1", … from its own counter, so a received item can carry a uid this
// character already holds or will mint next. A shared uid used to make one craft rewrite two items and
// one discard delete two (a duplication exploit); these tests pin the fix (src/game/items/ids.ts).
import { describe, expect, it } from 'vitest';
import type { CharacterSave, EquipmentItem, Item } from '../../src/contracts/items';
import { rules } from '../../src/game';
import {
  addToBackpack, adoptUid, allItems, applyBenchRecipe, beltUid, discardItem, findItem, heldUids, mintUid, moveItem,
  removeFromGrid, removeItemAt, replaceInGrid, replaceItemAt, tradeItems,
} from '../../src/game/items';
import { currency, equip, expectErr, expectOk, flask, makeCharacter, map } from './fixtures';

/** Every uid the character holds, in order (duplicates kept, so a clash shows). */
function uids(ch: CharacterSave): string[] {
  return allItems(ch).map((f) => f.item.uid);
}

function expectUnique(ch: CharacterSave): void {
  const list = uids(ch);
  expect(new Set(list).size, `duplicate uids: ${list.join(', ')}`).toBe(list.length);
  // The counter is past every minted-looking uid the character holds.
  for (const u of list) {
    const m = /^i([0-9a-z]+)$/.exec(u);
    if (m) expect(parseInt(m[1], 36), u).toBeLessThan(ch.nextUid);
  }
}

/** A fresh character exactly like the server makes one (starting kit minted i0…). */
function fresh(name: string, seed: number): CharacterSave {
  return rules.createCharacter(name, seed);
}

/** The uid the character's counter will mint next. */
function nextMinted(ch: CharacterSave): string {
  return `i${ch.nextUid.toString(36)}`;
}

describe('minting', () => {
  it('skips uids the character already holds', () => {
    const ch = { ...makeCharacter({ nextUid: 5 }), mapDevice: map('i5'), equipment: { ring1: equip({ baseId: 'emberRing', itemLevel: 10, rarity: 'normal', uid: 'i6' }) } };
    const m = mintUid(ch);
    expect(m.uid).toBe('i7');
    expect(m.character.nextUid).toBe(8);
    expect(mintUid(makeCharacter({ nextUid: 5 })).uid).toBe('i5');
  });

  it('adoptUid moves the counter past a minted-looking uid at or beyond it, and ignores the rest', () => {
    const ch = makeCharacter({ nextUid: 14 });
    expect(adoptUid(ch, 'ie').nextUid).toBe(15);
    expect(adoptUid(ch, 'iz').nextUid).toBe(36);
    expect(adoptUid(ch, 'i3')).toBe(ch);
    for (const other of ['dabc', 'belt:0', 'offer:x', 'i', 'iABC', 'i-1', 'i12345678901']) expect(adoptUid(ch, other)).toBe(ch);
  });

  it('lists every held uid (belt charges have none)', () => {
    const ch = {
      ...makeCharacter(),
      backpack: { ...makeCharacter().backpack, entries: [{ item: currency('scrap', 1, 'a'), x: 0, y: 0 }] },
      belt: [{ flaskId: 'lifeFlask' as const, count: 3 }, null, null, null],
      mapDevice: map('m'),
    };
    expect([...heldUids(ch)].sort()).toEqual(['a', 'm']);
  });
});

describe('items received from another character', () => {
  it('keep a free uid and move the counter past it', () => {
    const giver = fresh('Giver', 1);
    const taker = fresh('Taker', 2);
    // Both fresh characters minted the same kit uids; the giver's first purchase is the taker's next mint.
    const bought = expectOk(rules.buyOffer(giver, 'map:cinderCrossing:1:plain'));
    expect(bought.item.uid).toBe(nextMinted(taker));
    const got = expectOk(addToBackpack(taker, bought.item));
    expect(findItem(got, bought.item.uid)?.item).toMatchObject({ kind: 'map' });
    expect(got.nextUid).toBe(taker.nextUid + 1);
    expectUnique(got);
  });

  it('are re-minted when the uid is already taken', () => {
    const giver = fresh('Giver', 1);
    const taker = fresh('Taker', 2);
    // A kit map: "i…", and the taker holds an item with the very same uid.
    const kitMap = giver.backpack.entries.find((e) => e.item.kind === 'map')!.item;
    const theirs = findItem(taker, kitMap.uid)!.item;
    const got = expectOk(addToBackpack(taker, kitMap));
    expectUnique(got);
    expect(uids(got)).toHaveLength(uids(taker).length + 1);
    expect(findItem(got, kitMap.uid)!.item).toEqual(theirs);
    const arrived = got.backpack.entries.find((e) => !findItem(taker, e.item.uid))!.item;
    expect(arrived).toEqual({ ...kitMap, uid: nextMinted(taker) });
  });

  it('(a) unloading the belt after adopting the next uid does not duplicate it, and a discard removes one item', () => {
    const taker = fresh('Taker', 2);
    const ring = equip({ baseId: 'emberRing', itemLevel: 20, rarity: 'normal', uid: nextMinted(taker) });
    let ch = expectOk(addToBackpack(taker, ring));
    ch = expectOk(moveItem(ch, beltUid(0), { kind: 'backpack', x: 11, y: 4 }));
    expectUnique(ch);
    const before = uids(ch).length;
    ch = expectOk(discardItem(ch, ring.uid));
    expect(uids(ch).length).toBe(before - 1);
    expect(ch.backpack.entries.some((e) => e.item.kind === 'flask' && e.x === 11 && e.y === 4)).toBe(true);
  });

  it('(b) a bench craft on the adopted ring changes the ring only', () => {
    const taker = fresh('Taker', 2);
    const ring = equip({ baseId: 'emberRing', itemLevel: 20, rarity: 'normal', uid: nextMinted(taker) });
    let ch = expectOk(addToBackpack(taker, ring));
    ch = expectOk(moveItem(ch, beltUid(0), { kind: 'backpack', x: 11, y: 4 }));
    ch = expectOk(addToBackpack(ch, currency('essenceVital', 1, 'd-vital')));
    const flasksBefore = ch.backpack.entries.filter((e) => e.item.kind === 'flask').map((e) => e.item);
    const out = expectOk(applyBenchRecipe(ch, ring.uid, 'bench:life')).character;
    expectUnique(out);
    expect(out.backpack.entries.filter((e) => e.item.kind === 'flask').map((e) => e.item)).toEqual(flasksBefore);
    expect(out.backpack.entries.filter((e) => e.item.kind === 'equipment' && e.item.baseId === 'emberRing')).toHaveLength(1);
    expect((findItem(out, ring.uid)!.item as EquipmentItem).affixes[0]).toMatchObject({ affixId: 'life', crafted: true });
  });

  it('(c) buying after adopting two consecutive uids mints a third, fresh one', () => {
    const giver = fresh('Giver', 1);
    const taker = fresh('Taker', 2);
    const a = expectOk(rules.buyOffer(giver, 'map:cinderCrossing:1:plain'));
    const b = expectOk(rules.buyOffer(a.character, 'map:cinderCrossing:1:plain'));
    let ch = expectOk(addToBackpack(taker, a.item));
    ch = expectOk(addToBackpack(ch, b.item));
    const bought = expectOk(rules.buyOffer(ch, 'map:cinderCrossing:1:plain'));
    expect([a.item.uid, b.item.uid]).not.toContain(bought.item.uid);
    expectUnique(bought.character);
  });

  it('stay unique through trades both ways, public drops and every minting path (randomised)', () => {
    let a = fresh('Alpha', 11);
    let b = fresh('Beta', 12);
    // Currency to buy, bench and gamble with.
    a = expectOk(addToBackpack(a, currency('scrap', 40, 'd-scrap-a')));
    b = expectOk(addToBackpack(b, currency('scrap', 40, 'd-scrap-b')));
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed % n;
    };
    const backpackUids = (ch: CharacterSave) => ch.backpack.entries.map((e) => e.item.uid);
    const total = (ch: CharacterSave) => uids(ch).length;
    for (let step = 0; step < 300; step++) {
      const aTurn = rand(2) === 0;
      let me = aTurn ? a : b;
      let other = aTurn ? b : a;
      switch (rand(6)) {
        case 0: { // trade one item each way
          const mine = backpackUids(me);
          const theirs = backpackUids(other);
          if (!mine.length || !theirs.length) break;
          const give = [mine[rand(mine.length)]];
          const get = [theirs[rand(theirs.length)]];
          const before = total(me) + total(other);
          const r = tradeItems(me, give, other, get);
          if (r.ok) {
            me = r.value.a;
            other = r.value.b;
            // Stacks may merge on arrival; nothing is ever created.
            expect(total(me) + total(other)).toBeLessThanOrEqual(before);
          }
          break;
        }
        case 1: { // public drop: me throws an item on the floor, other picks it up
          const mine = backpackUids(me);
          if (!mine.length) break;
          const uid = mine[rand(mine.length)];
          const item = findItem(me, uid)!.item;
          const picked = addToBackpack(other, item);
          if (picked.ok) {
            me = expectOk(discardItem(me, uid));
            other = picked.value;
          }
          break;
        }
        case 2: { // unload a belt slot into the backpack
          const slot = rand(4);
          const r = moveItem(me, beltUid(slot), { kind: 'backpack', x: rand(12), y: rand(5) });
          if (r.ok) me = r.value;
          break;
        }
        case 3: { // buy from Rook
          const offers = ['map:cinderCrossing:1:plain', 'gamble-ring', 'gamble-wand', 'flask-life'];
          const r = rules.buyOffer(me, offers[rand(offers.length)]);
          if (r.ok) me = r.value.character;
          break;
        }
        case 4: { // load a backpack flask into the belt (a swap sends the old charges back with a new uid)
          const f = me.backpack.entries.find((e) => e.item.kind === 'flask');
          if (f) {
            const r = moveItem(me, f.item.uid, { kind: 'belt', index: rand(4) });
            if (r.ok) me = r.value;
          }
          break;
        }
        default: { // discard something
          const mine = backpackUids(me);
          if (mine.length > 20) me = expectOk(discardItem(me, mine[rand(mine.length)]));
        }
      }
      if (aTurn) {
        a = me;
        b = other;
      } else {
        b = me;
        a = other;
      }
      expectUnique(a);
      expectUnique(b);
    }
  });
});

describe('grid operations touch exactly one entry', () => {
  // Saves are healed on load (parseSave re-mints duplicates), but no operation may ever act on two
  // entries at once, whatever state a character is in.
  const dup = (): CharacterSave => {
    const ch = makeCharacter();
    return {
      ...ch,
      backpack: { ...ch.backpack, entries: [
        { item: flask('lifeFlask', 7, 'x'), x: 0, y: 0 },
        { item: currency('scrap', 3, 'x'), x: 5, y: 0 },
      ] },
    };
  };

  it('removeItemAt / replaceItemAt act on the entry at the location', () => {
    const ch = dup();
    const removed = removeItemAt(ch, { kind: 'backpack', x: 5, y: 0 }, 'x');
    expect(removed.backpack.entries.map((e) => e.item.kind)).toEqual(['flask']);
    const replaced = replaceItemAt(ch, { kind: 'backpack', x: 5, y: 0 }, currency('scrap', 9, 'x'));
    expect(replaced.backpack.entries.map((e) => (e.item as Item & { count: number }).count)).toEqual([7, 9]);
  });

  it('removeFromGrid / replaceInGrid without a position change only the first match', () => {
    const grid = dup().backpack;
    expect(removeFromGrid(grid, 'x').entries).toHaveLength(1);
    expect(replaceInGrid(grid, currency('scrap', 1, 'x')).entries.map((e) => e.item.kind)).toEqual(['currency', 'currency']);
    expect(removeFromGrid(grid, 'missing')).toBe(grid);
  });

  it('a discard of a doubled uid removes one item, not both', () => {
    const out = expectOk(discardItem(dup(), 'x'));
    expect(out.backpack.entries).toHaveLength(1);
  });

  it('never loses or copies an item when the target of a craft shares a uid', () => {
    expect(expectErr(applyBenchRecipe(dup(), 'x', 'bench:life'))).toBe('The Crafting Bench only works on equipment.');
  });
});
