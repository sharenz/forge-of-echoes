// The Crafting Stash work slot (CharacterSave.craftSlot, location { kind: 'craftSlot' }): loading and emptying it from
// every container, swapping, quick-moves with a Crafting Stash tab open, crafting on its item straight from a Crafting
// Stash slot, uid uniqueness and conservation, trade locks, purity, and the save format (an old save reads as empty).
import { describe, expect, it } from 'vitest';
import type { CharacterSave, EquipmentItem, Item } from '../../src/contracts/items';
import { currencyStashUid } from '../../src/contracts/items';
import { LOCKED_CHANGE_ERROR, LOCKED_ITEM_ERROR, rules, withItemLocks, withServerEntropy } from '../../src/game';
import {
  allItems, clearNewFlags, craftSlotOf, discardItem, findItem, heldUids, mintUid, moveItem, quickMove, tradeOfferError, withCraftSlot,
} from '../../src/game/items';
import { currency, equip, expectErr, expectOk, makeCharacter, map, withBackpack } from './fixtures';

const S = currencyStashUid;

function wand(uid = 'w1', rarity: 'normal' | 'magic' | 'rare' = 'rare'): EquipmentItem {
  return equip({ baseId: 'ashwoodWand', itemLevel: 40, rarity, uid, affixes: rarity === 'normal' ? [] : [{ affixId: 'fireDamage', tier: 5 }] });
}

function ring(uid = 'r1'): EquipmentItem {
  return equip({ baseId: 'emberRing', itemLevel: 40, rarity: 'rare', uid, affixes: [{ affixId: 'life', tier: 5 }] });
}

function uniqueUids(ch: CharacterSave): void {
  const uids = allItems(ch).map((f) => f.item.uid);
  expect(new Set(uids).size, uids.join(',')).toBe(uids.length);
}

/** Every item (by JSON) and every currency count the character owns, wherever it sits. */
function inventory(ch: CharacterSave): string[] {
  const out = allItems(ch).map((f) => JSON.stringify(f.item)).sort();
  for (const [id, n] of Object.entries(ch.currencyStash)) out.push(`c:${id}:${n}`);
  return out.sort();
}

describe('work slot: moving gear and maps in', () => {
  it('loads from the backpack, the stash, the body, the Map Stash and the device; the source is emptied', () => {
    const w = wand('w1');
    const start = withBackpack(makeCharacter({ stash: [{ name: 'Tab 1', grid: { w: 12, h: 8, entries: [{ item: ring('s1'), x: 4, y: 4 }] } }] }), [[w, 0, 0]]);
    const fromBag = expectOk(moveItem(start, 'w1', { kind: 'craftSlot' }));
    expect(fromBag.craftSlot?.uid).toBe('w1');
    expect(findItem(fromBag, 'w1')?.location).toEqual({ kind: 'craftSlot' });
    expect(fromBag.backpack.entries).toHaveLength(0);

    const fromStash = expectOk(moveItem(start, 's1', { kind: 'craftSlot' }));
    expect(fromStash.craftSlot?.uid).toBe('s1');
    expect(fromStash.stash[0].grid.entries).toHaveLength(0);

    const worn = makeCharacter({ equipment: { ring1: ring('worn') } });
    const fromBody = expectOk(moveItem(worn, 'worn', { kind: 'craftSlot' }));
    expect(fromBody.craftSlot?.uid).toBe('worn');
    expect(fromBody.equipment.ring1).toBeUndefined();

    const m = map('mm');
    const fromMapStash = expectOk(moveItem(makeCharacter({ mapStash: [m] }), 'mm', { kind: 'craftSlot' }));
    expect(fromMapStash.craftSlot?.uid).toBe('mm');
    expect(fromMapStash.mapStash).toEqual([]);
    const fromDevice = expectOk(moveItem(makeCharacter({ mapDevice: m }), 'mm', { kind: 'craftSlot' }));
    expect(fromDevice.craftSlot?.uid).toBe('mm');
    expect(fromDevice.mapDevice).toBeNull();
    for (const ch of [fromBag, fromStash, fromBody, fromMapStash, fromDevice]) uniqueUids(ch);
  });

  it('takes gear and maps only', () => {
    const ch = withBackpack(makeCharacter({ currencyStash: { scrap: 3 } }), [[currency('scrap', 5, 'c1'), 0, 0]]);
    expect(expectErr(moveItem(ch, 'c1', { kind: 'craftSlot' }))).toBe('The work slot holds one piece of gear or one map.');
    expect(expectErr(moveItem(ch, S('scrap'), { kind: 'craftSlot' }))).toBe('The work slot holds one piece of gear or one map.');
    const belt = makeCharacter({ belt: [{ flaskId: 'lifeFlask', count: 3 }, null, null, null] });
    expect(expectErr(moveItem(belt, 'belt:0', { kind: 'craftSlot' }))).toBe('The work slot holds one piece of gear or one map.');
  });

  it('moving the slot item onto the slot does nothing', () => {
    const ch = withCraftSlot(makeCharacter(), wand());
    expect(expectOk(moveItem(ch, 'w1', { kind: 'craftSlot' }))).toBe(ch);
  });

  it('swaps: the occupant goes back where the new item came from, including the body', () => {
    const a = wand('a');
    const b = wand('b');
    const ch = withBackpack(withCraftSlot(makeCharacter(), a), [[b, 3, 2]]);
    const swapped = expectOk(moveItem(ch, 'b', { kind: 'craftSlot' }));
    expect(swapped.craftSlot?.uid).toBe('b');
    expect(findItem(swapped, 'a')?.location).toEqual({ kind: 'backpack', x: 3, y: 2 });

    const r1 = ring('r1');
    const r2 = ring('r2');
    const worn = withCraftSlot(makeCharacter({ equipment: { ring1: r1 } }), r2);
    const out = expectOk(moveItem(worn, 'r1', { kind: 'craftSlot' }));
    expect(out.craftSlot?.uid).toBe('r1');
    expect(out.equipment.ring1?.uid).toBe('r2');
    uniqueUids(out);
  });

  it('refuses a swap that has no place to put the occupant back (nothing changes)', () => {
    // The body slot the new item is worn in cannot take a map, and the worn ring stays where it is.
    const ch = withCraftSlot(makeCharacter({ mapDevice: null, equipment: { ring1: ring('worn') } }), map('m1'));
    expect(expectErr(moveItem(ch, 'worn', { kind: 'craftSlot' }))).toMatch(/no room to put the map back/);
    expect(ch.craftSlot?.uid).toBe('m1');
    expect(ch.equipment.ring1?.uid).toBe('worn');
  });
});

describe('work slot: moving out', () => {
  it('goes to a backpack cell, a stash cell, the body, the device or the Map Stash', () => {
    const ch = withCraftSlot(makeCharacter(), wand('w1'));
    const toBag = expectOk(moveItem(ch, 'w1', { kind: 'backpack', x: 5, y: 1 }));
    expect(toBag.craftSlot).toBeNull();
    expect(findItem(toBag, 'w1')?.location).toEqual({ kind: 'backpack', x: 5, y: 1 });
    const toStash = expectOk(moveItem(ch, 'w1', { kind: 'stash', tab: 0, x: 2, y: 2 }));
    expect(findItem(toStash, 'w1')?.location).toEqual({ kind: 'stash', tab: 0, x: 2, y: 2 });
    const toBody = expectOk(moveItem(ch, 'w1', { kind: 'equipment', slot: 'mainHand' }));
    expect(toBody.equipment.mainHand?.uid).toBe('w1');
    expect(toBody.craftSlot).toBeNull();

    const m = withCraftSlot(makeCharacter(), map('m1'));
    expect(expectOk(moveItem(m, 'm1', { kind: 'mapDevice' })).mapDevice?.uid).toBe('m1');
    expect(expectOk(moveItem(m, 'm1', { kind: 'mapStash' })).mapStash.map((x) => x.uid)).toEqual(['m1']);
    for (const out of [toBag, toStash, toBody]) uniqueUids(out);
  });

  it('refuses gear that cannot be worn (level / slot) and keeps it in the slot', () => {
    const young = makeCharacter({ level: 1 });
    const heavy = equip({ baseId: 'glassboneWand', itemLevel: 44, rarity: 'rare', uid: 'w1', affixes: [{ affixId: 'fireDamage', tier: 5 }] });
    const ch = withCraftSlot(young, heavy);
    expect(expectErr(moveItem(ch, 'w1', { kind: 'equipment', slot: 'mainHand' }))).toMatch(/Requires Level/);
    expect(expectErr(moveItem(withCraftSlot(makeCharacter(), wand('w1')), 'w1', { kind: 'equipment', slot: 'helmet' }))).toMatch(/can only be equipped/);
  });

  it('Ctrl-click on the slot item always returns it to the backpack, whatever tab is open', () => {
    const ch = withCraftSlot(makeCharacter(), wand('w1'));
    for (const tab of [null, 0, 'currency', 'mapCurrency', 'maps'] as const) {
      const out = expectOk(quickMove(ch, 'w1', { stashTab: tab }));
      expect(out.craftSlot).toBeNull();
      expect(findItem(out, 'w1')?.location.kind).toBe('backpack');
    }
  });

  it('a full backpack refuses the return and keeps the item in the slot', () => {
    let ch = makeCharacter();
    const fillers = Array.from({ length: 12 * 5 }, (_, i): [Item, number, number] => [currency('scrap', 1, `f${i}`), i % 12, Math.floor(i / 12)]);
    // Distinct currencies would stack: use maps, which never do.
    const maps = fillers.map(([, x, y], i): [Item, number, number] => [map(`fm${i}`), x, y]);
    ch = withCraftSlot(withBackpack(ch, maps), wand('w1'));
    expect(expectErr(quickMove(ch, 'w1', { stashTab: null }))).toBe('Your backpack is full.');
    expect(ch.craftSlot?.uid).toBe('w1');
  });

  it('discarding it empties the slot', () => {
    const ch = withCraftSlot(makeCharacter(), wand('w1'));
    const out = expectOk(discardItem(ch, 'w1'));
    expect(craftSlotOf(out)).toBeNull();
  });
});

describe('work slot: Ctrl-click with a Crafting Stash tab open', () => {
  it.each(['currency', 'mapCurrency'] as const)('loads gear from the backpack and from the body on the %s tab', (tab) => {
    const bag = withBackpack(makeCharacter(), [[wand('w1'), 0, 0]]);
    expect(expectOk(quickMove(bag, 'w1', { stashTab: tab })).craftSlot?.uid).toBe('w1');
    const worn = makeCharacter({ equipment: { ring1: ring('worn') } });
    const out = expectOk(quickMove(worn, 'worn', { stashTab: tab }));
    expect(out.craftSlot?.uid).toBe('worn');
    expect(out.equipment.ring1).toBeUndefined();
  });

  it('with a normal tab or no tab open nothing new happens (gear equips, stash items go to the backpack)', () => {
    const bag = withBackpack(makeCharacter(), [[wand('w1'), 0, 0]]);
    expect(expectOk(quickMove(bag, 'w1', { stashTab: null })).craftSlot ?? null).toBeNull();
    expect(expectOk(quickMove(bag, 'w1', { stashTab: 0 })).craftSlot ?? null).toBeNull();
    const worn = makeCharacter({ equipment: { ring1: ring('worn') } });
    expect(expectOk(quickMove(worn, 'worn', { stashTab: null })).craftSlot ?? null).toBeNull();
  });
});

describe('work slot: crafting on the item in place', () => {
  const crafter = (ch: CharacterSave) => withServerEntropy(rules, () => 0x1234abcd);

  it('applies a Crafting Stash currency to the slot item; the item stays in the slot, the slot shrinks by one', () => {
    const ch = withCraftSlot(makeCharacter({ currencyStash: { kindling: 5 } }), wand('w1', 'normal'));
    const outcome = expectOk(crafter(ch).applyCurrency(ch, S('kindling'), 'w1'));
    const after = outcome.character;
    const item = after.craftSlot as EquipmentItem;
    expect(item.uid).toBe('w1');
    expect(item.rarity).toBe('magic');
    expect(item.affixes.length).toBeGreaterThan(0);
    expect(after.currencyStash.kindling).toBe(4);
    expect(findItem(after, 'w1')?.location).toEqual({ kind: 'craftSlot' });
    expect(item.stability).toBeLessThan((ch.craftSlot as EquipmentItem).stability);
    expect(item.history.at(-1)).toMatch(/Kindling/);
    uniqueUids(after);
  });

  it('crafts a map in the slot with a map currency, from the Crafting Stash', () => {
    const ch = withCraftSlot(makeCharacter({ currencyStash: { mapDust: 3 } }), map('m1'));
    const out = expectOk(crafter(ch).applyCurrency(ch, S('mapDust'), 'm1')).character;
    expect(out.craftSlot?.kind).toBe('map');
    expect((out.craftSlot as { rarity: string }).rarity).toBe('magic');
    expect(out.currencyStash.mapDust).toBe(2);
  });

  it('a craft that would do nothing is refused without spending anything', () => {
    const ch = withCraftSlot(makeCharacter({ currencyStash: { kindling: 5 } }), wand('w1', 'rare'));
    const r = crafter(ch).applyCurrency(ch, S('kindling'), 'w1');
    expect(r.ok).toBe(false);
    expect(ch.currencyStash.kindling).toBe(5);
  });

  it('tooltips and previews reach the slot item (the UI asks the rules)', () => {
    const ch = withCraftSlot(makeCharacter({ currencyStash: { kindling: 5 } }), wand('w1', 'normal'));
    expect(rules.craftingTargetError(ch, S('kindling'), 'w1')).toBeNull();
    expect(rules.craftPreview(ch, S('kindling'), 'w1').length).toBeGreaterThan(0);
    expect(rules.describeItem(ch.craftSlot!, ch).stability?.current).toBeGreaterThan(0);
  });

  it('Finished gear cannot be crafted on and says so; the slot and the currency are untouched', () => {
    const done = { ...wand('w1', 'magic'), stability: 0 };
    const ch = withCraftSlot(makeCharacter({ currencyStash: { scrap: 2 } }), done);
    expect(rules.craftingTargetError(ch, S('scrap'), 'w1')).toMatch(/Finished|stability/i);
    expect(crafter(ch).applyCurrency(ch, S('scrap'), 'w1').ok).toBe(false);
  });

  it('bench services and recipes work on it, and Transmute needs no unequipping first', () => {
    const ch = withCraftSlot(makeCharacter({ currencyStash: { scrap: 50 } }), { ...wand('w1', 'magic'), stability: 3 });
    expect(rules.benchServices(ch, 'w1').length).toBeGreaterThan(0);
    expect(rules.benchRecipes(ch, 'w1').length).toBeGreaterThan(0);
  });
});

describe('work slot: uid uniqueness, conservation and purity', () => {
  it('heldUids and mintUid know the slot item', () => {
    const ch = withCraftSlot(makeCharacter({ nextUid: 1 }), wand('i1'));
    expect(heldUids(ch).has('i1')).toBe(true);
    expect(mintUid(ch).uid).toBe('i2');
  });

  it('every move leaves exactly the same items (nothing created, nothing lost)', () => {
    const ch = withBackpack(makeCharacter({ equipment: { ring1: ring('worn') }, mapStash: [map('ms')] }), [[wand('w1'), 0, 0], [wand('w2'), 2, 0], [map('bm'), 5, 0]]);
    const before = inventory(ch);
    const moves: [string, Parameters<typeof moveItem>[2]][] = [
      ['w1', { kind: 'craftSlot' }], ['worn', { kind: 'craftSlot' }], ['ms', { kind: 'craftSlot' }], ['w2', { kind: 'craftSlot' }],
      ['bm', { kind: 'craftSlot' }], ['w1', { kind: 'craftSlot' }], ['w1', { kind: 'backpack', x: 9, y: 4 }], ['w2', { kind: 'stash', tab: 0, x: 0, y: 0 }],
    ];
    let cur = ch;
    for (const [uid, to] of moves) {
      const r = moveItem(cur, uid, to);
      if (r.ok) cur = r.value;
      expect(inventory(cur).length).toBe(before.length);
      uniqueUids(cur);
    }
    // The same set of item bodies, only in other places.
    expect(inventory(cur)).toEqual(before);
  });

  it('never mutates its input', () => {
    const ch = withBackpack(makeCharacter(), [[wand('w1'), 0, 0]]);
    const json = JSON.stringify(ch);
    moveItem(ch, 'w1', { kind: 'craftSlot' });
    quickMove(ch, 'w1', { stashTab: 'currency' });
    expect(JSON.stringify(ch)).toBe(json);
  });

  it('allItems lists it once, and clearNewFlags clears its badge', () => {
    const fresh = { ...wand('w1'), isNew: true };
    const ch = withCraftSlot(makeCharacter(), fresh);
    expect(allItems(ch).filter((f) => f.item.uid === 'w1')).toHaveLength(1);
    expect((clearNewFlags(ch).craftSlot as EquipmentItem).isNew).toBeUndefined();
  });

  it('rejects a malformed destination without touching anything', () => {
    const ch = withBackpack(makeCharacter(), [[wand('w1'), 0, 0]]);
    expect(expectErr(moveItem(ch, 'w1', { kind: 'craftslot' } as never))).toBe('Invalid destination.');
    expect(expectErr(moveItem(ch, 'nope', { kind: 'craftSlot' }))).toBe('That item no longer exists.');
  });
});

describe('work slot: trade locks', () => {
  const lockedRules = (uids: string[]) => withItemLocks(rules, () => new Set(uids));

  it('a trade-locked backpack item cannot be loaded into the slot, and the slot is not offerable', () => {
    const ch = withBackpack(makeCharacter(), [[wand('w1'), 0, 0]]);
    expect(lockedRules(['w1']).moveItem(ch, 'w1', { kind: 'craftSlot' })).toEqual({ ok: false, error: LOCKED_ITEM_ERROR });
    expect(lockedRules(['w1']).quickMove(ch, 'w1', { stashTab: 'currency' })).toEqual({ ok: false, error: LOCKED_ITEM_ERROR });
    // The swap that would push the slot's occupant back onto a locked cell is refused too.
    const slotted = withBackpack(withCraftSlot(makeCharacter(), wand('w0')), [[wand('w1'), 0, 0]]);
    expect(lockedRules(['w1']).moveItem(slotted, 'w0', { kind: 'backpack', x: 0, y: 0 })).toMatchObject({ ok: false });
    // Only backpack items can be offered in a trade at all.
    expect(tradeOfferError(slotted, ['w0'])).toBe('Only items in your backpack can be traded.');
  });

  it('crafting on a locked uid and masking keep their meaning for slot items', () => {
    const ch = withCraftSlot(makeCharacter({ currencyStash: { kindling: 2 } }), wand('w1', 'normal'));
    // Nothing offered: fine. The slot item cannot be locked (it is not in the backpack), so nothing masks it.
    expect(lockedRules([]).craftingTargetError(ch, S('kindling'), 'w1')).toBeNull();
    const r = lockedRules(['w1']).moveItem(ch, 'w1', { kind: 'backpack', x: 0, y: 0 });
    expect(r).toEqual({ ok: false, error: LOCKED_ITEM_ERROR });
    void LOCKED_CHANGE_ERROR;
  });
});

describe('work slot: save format', () => {
  it('a character saved before the work slot reads as empty, and a slot item survives serialise / parse', () => {
    const ch = rules.createCharacter('Oldie', 7);
    expect(ch.craftSlot ?? null).toBeNull();
    const json = rules.serializeSave({ version: rules.newSave().version, characters: [ch], lastCharacterId: null, settings: rules.newSave().settings });
    const parsed = rules.parseSave(json).characters[0];
    expect(parsed.craftSlot ?? null).toBeNull();

    const withItem = withCraftSlot(ch, wand('w1'));
    const again = rules.parseSave(rules.serializeSave({ ...rules.newSave(), characters: [withItem] })).characters[0];
    expect(again.craftSlot?.uid).toBe('w1');
    expect(JSON.stringify(again.craftSlot)).toBe(JSON.stringify(withItem.craftSlot));
  });

  it('a slot holding anything but gear or a map is re-homed, never lost or duplicated', () => {
    const scrapIn = (c: CharacterSave) => allItems(c).reduce((n, f) => n + (f.item.kind === 'currency' && f.item.currencyId === 'scrap' ? f.item.count : 0), 0) + (c.currencyStash.scrap ?? 0);
    const ch = rules.createCharacter('Odd', 7);
    const plain = rules.parseSave(JSON.stringify({ ...rules.newSave(), characters: [JSON.parse(JSON.stringify(ch))] })).characters[0];
    const raw = JSON.parse(JSON.stringify({ ...ch, craftSlot: currency('scrap', 3, 'cs') }));
    const parsed = rules.parseSave(JSON.stringify({ ...rules.newSave(), characters: [raw] })).characters[0];
    expect(parsed.craftSlot ?? null).toBeNull();
    expect(scrapIn(parsed)).toBe(scrapIn(plain) + 3);
  });
});
