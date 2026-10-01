// Crafting Stash work slot (src/ui/lib/workslot.ts): which modifier lines a craft added or changed, the recent-crafts
// log, the permanent currencies that ask first, where "Equip" puts the item, tile keyboard navigation, and the shared
// drag-and-drop / location helpers that know the new 'craftSlot' location.
import { describe, expect, it } from 'vitest';
import { CURRENCY_IDS } from '../../src/contracts/content';
import type { MapItem, TooltipLine } from '../../src/contracts/items';
import { currencyStashUid } from '../../src/contracts/items';
import { rules } from '../../src/game';
import { locationKey, sameLocation } from '../../src/ui/lib/items';
import {
  CONFIRM_CURRENCIES, WORK_LOG_LINES, craftLog, equipTarget, freshLineIndices, linesSignature, modLines, needsConfirm, removedLines, tileStep,
} from '../../src/ui/lib/workslot';
import { equip, makeCharacter } from '../game-items/fixtures';

const line = (text: string, extra: Partial<TooltipLine> = {}): TooltipLine => ({ text, kind: 'prefix', tier: 5, ...extra });

describe('freshLineIndices', () => {
  const a = line('+10 to maximum Life');
  const b = line('12% increased Fire Damage', { kind: 'suffix' });

  it('an unchanged list has nothing fresh', () => {
    expect(freshLineIndices([a, b], [a, b]).size).toBe(0);
    expect(freshLineIndices([], []).size).toBe(0);
  });

  it('marks a new affix', () => {
    const c = line('+5% Cold Resistance', { kind: 'suffix' });
    expect([...freshLineIndices([a, b], [a, b, c])]).toEqual([2]);
  });

  it('marks a rerolled value and a tier step, not its neighbours', () => {
    expect([...freshLineIndices([a, b], [line('+11 to maximum Life'), b])]).toEqual([0]);
    expect([...freshLineIndices([a, b], [a, line(b.text, { kind: 'suffix', tier: 4 })])]).toEqual([1]);
  });

  it('matches duplicates one to one', () => {
    expect([...freshLineIndices([a, a], [a, a, a])]).toEqual([2]);
    expect([...freshLineIndices([a, a, a], [a, a])]).toEqual([]);
  });

  it('a seal breaking is not a change, a fracture or a bench craft marker is', () => {
    expect(freshLineIndices([line('x', { sealed: true })], [line('x')]).size).toBe(0);
    expect([...freshLineIndices([line('x')], [line('x', { fractured: true })])]).toEqual([0]);
    expect([...freshLineIndices([line('x')], [line('x', { crafted: true })])]).toEqual([0]);
  });

  it('a full reroll marks every line; the order alone is not a change', () => {
    expect([...freshLineIndices([a, b], [line('other one'), line('other two')])]).toEqual([0, 1]);
    expect(freshLineIndices([a, b], [b, a]).size).toBe(0);
  });
});

describe('removedLines and linesSignature', () => {
  const a = line('+10 to maximum Life');
  const b = line('12% increased Fire Damage', { kind: 'suffix' });
  it('lists what a craft took away', () => {
    expect(removedLines([a, b], [a])).toEqual([b]);
    expect(removedLines([a, b], [b, a])).toEqual([]);
    expect(removedLines([a], [a, b])).toEqual([]);
  });
  it('the signature changes exactly when the modifier list does', () => {
    expect(linesSignature([a, b])).toBe(linesSignature([{ ...a }, { ...b }]));
    expect(linesSignature([a, b])).not.toBe(linesSignature([a]));
    expect(linesSignature([a])).not.toBe(linesSignature([line(a.text, { tier: 4 })]));
  });
  it('modLines is implicits, affixes, scars in that order', () => {
    const i = line('imp', { kind: 'implicit' });
    const s = line('scar', { kind: 'scar' });
    expect(modLines({ implicits: [i], affixes: [a], scars: [s] })).toEqual([i, a, s]);
  });
});

describe('craftLog', () => {
  it('shows the newest lines first and at most the limit', () => {
    const h = ['one', 'two', 'three', 'four', 'five', 'six'];
    expect(craftLog(h)).toEqual(['six', 'five', 'four', 'three'].slice(0, WORK_LOG_LINES));
    expect(craftLog(h, 2)).toEqual(['six', 'five']);
    expect(craftLog(['only'])).toEqual(['only']);
    expect(craftLog([])).toEqual([]);
    expect(craftLog(undefined)).toEqual([]);
  });
});

describe('permanent currencies', () => {
  it('asks before Fracture Core, Anneal, Transmute and Void Needle only', () => {
    const asked = CURRENCY_IDS.filter(needsConfirm).sort();
    expect(asked).toEqual(['anneal', 'fractureCore', 'transmute', 'voidNeedle']);
    for (const id of asked) {
      const c = CONFIRM_CURRENCIES[id]!;
      expect(c.title.length).toBeGreaterThan(3);
      expect(c.body.length).toBeGreaterThan(30);
      expect(c.confirm.length).toBeGreaterThan(2);
    }
    for (const id of ['scrap', 'kindling', 'reforge', 'essenceEmber', 'catalyst', 'solvent', 'seal', 'mapDust', 'threatGlyph'] as const) {
      expect(needsConfirm(id)).toBe(false);
    }
    expect(needsConfirm('constructor' as never)).toBe(false);
  });
});

describe('equipTarget', () => {
  const slotsOf = (baseId: string) => rules.content.bases[baseId as keyof typeof rules.content.bases]?.slots;
  it('prefers a free compatible slot, else the first', () => {
    const ring = equip({ baseId: 'emberRing', itemLevel: 40, rarity: 'rare', uid: 'r', affixes: [{ affixId: 'life', tier: 5 }] });
    const other = equip({ baseId: 'emberRing', itemLevel: 40, rarity: 'rare', uid: 'o', affixes: [{ affixId: 'life', tier: 5 }] });
    expect(equipTarget(makeCharacter(), ring, slotsOf)).toBe('ring1');
    expect(equipTarget(makeCharacter({ equipment: { ring1: other } }), ring, slotsOf)).toBe('ring2');
    expect(equipTarget(makeCharacter({ equipment: { ring1: other, ring2: other } }), ring, slotsOf)).toBe('ring1');
  });
  it('is null for a map or an unknown base', () => {
    const map: MapItem = { kind: 'map', uid: 'm', areaId: 'cinderCrossing', baseId: 'ashenForge', tier: 1, rarity: 'normal', mods: [], quality: 0, corrupted: false };
    expect(equipTarget(makeCharacter(), map, slotsOf)).toBeNull();
    const wand = equip({ baseId: 'ashwoodWand', itemLevel: 30, rarity: 'normal', uid: 'w', affixes: [] });
    expect(equipTarget(makeCharacter(), wand, () => undefined)).toBeNull();
  });
});

describe('tileStep', () => {
  it('moves by one and by a row, and stays on the edges', () => {
    expect(tileStep('ArrowRight', 0, 10, 3)).toBe(1);
    expect(tileStep('ArrowRight', 9, 10, 3)).toBe(9);
    expect(tileStep('ArrowLeft', 0, 10, 3)).toBe(0);
    expect(tileStep('ArrowLeft', 4, 10, 3)).toBe(3);
    expect(tileStep('ArrowDown', 1, 10, 3)).toBe(4);
    expect(tileStep('ArrowDown', 8, 10, 3)).toBe(8);
    expect(tileStep('ArrowUp', 4, 10, 3)).toBe(1);
    expect(tileStep('ArrowUp', 1, 10, 3)).toBe(1);
    expect(tileStep('Home', 7, 10, 3)).toBe(0);
    expect(tileStep('End', 2, 10, 3)).toBe(9);
  });
  it('ignores other keys (they stay with the game) and an empty grid', () => {
    for (const k of ['Enter', ' ', 'w', 'e', 'Escape', 'Tab', 'a']) expect(tileStep(k, 0, 10, 3)).toBeNull();
    expect(tileStep('ArrowRight', 0, 0, 3)).toBeNull();
  });
});

describe('the work slot as an item location', () => {
  it('has its own key and only equals itself', () => {
    expect(locationKey({ kind: 'craftSlot' })).toBe('craftSlot');
    expect(sameLocation({ kind: 'craftSlot' }, { kind: 'craftSlot' })).toBe(true);
    expect(sameLocation({ kind: 'craftSlot' }, { kind: 'currencyStash' })).toBe(false);
    expect(sameLocation({ kind: 'mapStash' }, { kind: 'craftSlot' })).toBe(false);
  });
  it('a slot uid can be told from the work slot (they never collide)', () => {
    expect(currencyStashUid('scrap')).toBe('cstash:scrap');
  });
});
