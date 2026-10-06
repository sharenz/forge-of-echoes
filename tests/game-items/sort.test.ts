// Backpack Sort (src/game/items/sort.ts): a pure re-layout that keeps every item, merges stacks, groups by kind and orders gear by slot and rarity.
import { describe, expect, it } from 'vitest';
import type { CharacterSave, Item } from '../../src/contracts/items';
import { rules } from '../../src/game';
import { autoPlace, createGrid } from '../../src/game/items';
import { compareForSort, sortBackpack } from '../../src/game/items/sort';

function withItems(items: Item[]): CharacterSave {
  const base = rules.createCharacter('Sorty', 5);
  let grid = createGrid(base.backpack.w, base.backpack.h);
  for (const item of items) {
    const next = autoPlace(grid, item);
    if (!next) throw new Error('no room in the fixture');
    grid = next;
  }
  return { ...base, backpack: grid };
}

const cur = (uid: string, currencyId: string, count: number): Item => ({ kind: 'currency', uid, currencyId, count } as Item);
const template = rules.createCharacter('M', 1).backpack.entries.find((e) => e.item.kind === 'map')!.item;
const map = (uid: string, tier: number, areaId = 'cinderCrossing'): Item => ({ ...template, uid, tier, areaId } as Item);

describe('sortBackpack', () => {
  it('keeps every item exactly once and merges stacks of the same currency', () => {
    const ch = withItems([cur('a', 'scrap', 3), cur('b', 'kindling', 2), cur('c', 'scrap', 4)]);
    const r = sortBackpack(ch);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const total = (c: CharacterSave, id: string) => c.backpack.entries.reduce((n, e) => n + (e.item.kind === 'currency' && e.item.currencyId === id ? e.item.count : 0), 0);
    expect(total(r.value, 'scrap')).toBe(7);
    expect(total(r.value, 'kindling')).toBe(2);
    expect(r.value.backpack.entries.length).toBeLessThanOrEqual(ch.backpack.entries.length);
  });

  it('puts currency before flasks before maps before gear, maps with the highest tier first', () => {
    const ch = rules.createCharacter('Sorty', 6);
    const all = [map('m1', 1), cur('c1', 'scrap', 5), map('m3', 3), ...ch.backpack.entries.map((e) => e.item).filter((i) => i.kind === 'flask' || i.kind === 'equipment')];
    const sorted = [...all].sort(compareForSort).map((i) => i.kind);
    const firstOf = (k: string) => sorted.indexOf(k as Item['kind']);
    expect(firstOf('currency')).toBe(0);
    if (firstOf('flask') >= 0) expect(firstOf('flask')).toBeGreaterThan(firstOf('currency'));
    expect(firstOf('map')).toBeGreaterThan(firstOf('currency'));
    if (firstOf('equipment') >= 0) expect(firstOf('equipment')).toBeGreaterThan(firstOf('map'));
    expect(compareForSort(map('m3', 3), map('m1', 1))).toBeLessThan(0);
  });

  it('is idempotent and leaves everything else about the character alone', () => {
    const ch = withItems([cur('a', 'scrap', 3), map('m1', 2), map('m2', 5), cur('b', 'kindling', 1)]);
    const once = sortBackpack(ch);
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const twice = sortBackpack(once.value);
    expect(twice.ok && twice.value.backpack).toEqual(once.value.backpack);
    expect({ ...once.value, backpack: ch.backpack }).toEqual(ch);
  });

  it('says so when there is nothing to sort', () => {
    const ch = withItems([cur('a', 'scrap', 3)]);
    expect(sortBackpack(ch)).toMatchObject({ ok: false });
  });
});
