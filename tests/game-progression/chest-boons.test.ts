// The Wayside Anvil's boons on the completion chest (rollChestLoot's `boons`): Tempered, Keen, Attuned, Recast; neutral when absent.
import { describe, expect, it } from 'vitest';
import type { ChestBoons } from '../../src/contracts/map-events';
import type { EquipmentItem, Item } from '../../src/contracts/items';
import { createRng } from '../../src/core/rng';
import { rules } from '../../src/game';
import { getBase } from '../../src/data/items';
import { bareCharacter, map, setupFor } from './fixtures';

const NONE: ChestBoons = { stability: 0, keen: false, recast: false, itemClass: null };
const setup = setupFor(map('ashenForge', 5));
// Uniques are fixed items: the boons (stability, implicits, class) shape the ordinary equipment only.
const gear = (items: Item[]) => items.filter((i): i is EquipmentItem => i.kind === 'equipment' && i.rarity !== 'unique');
const roll = (seed: number, boons?: ChestBoons) => rules.rollChestLoot(setup, createRng(seed), bareCharacter(), boons);

describe('chest boons (Wayside Anvil)', () => {
  it('are neutral when absent or all-neutral: the very same chest', () => {
    for (let seed = 1; seed <= 10; seed++) {
      expect(roll(seed, NONE)).toEqual(roll(seed));
      expect(roll(seed, undefined)).toEqual(roll(seed));
    }
  });

  it('are deterministic', () => {
    const b: ChestBoons = { stability: 1, keen: true, recast: true, itemClass: 'ring' };
    for (let seed = 1; seed <= 5; seed++) expect(roll(seed, b)).toEqual(roll(seed, b));
  });

  it('Tempered: +1 maximum Stability on every chest equipment, nothing else changes', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const plain = gear(roll(seed)), tempered = gear(roll(seed, { ...NONE, stability: 1 }));
      expect(tempered).toHaveLength(plain.length);
      tempered.forEach((it, k) => {
        expect(it.maxStability).toBe(plain[k].maxStability + 1);
        expect(it.stability).toBe(plain[k].stability + 1);
        expect(it.baseId).toBe(plain[k].baseId);
        expect(it.affixes).toEqual(plain[k].affixes);
      });
    }
  });

  it('Keen: every implicit is rolled at its best', () => {
    let checked = 0;
    for (let seed = 1; seed <= 20; seed++) for (const it of gear(roll(seed, { ...NONE, keen: true }))) {
      expect(it.implicitValues).toEqual(getBase(it.baseId).implicits.map((i) => i.max));
      checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('Attuned: the chest equipment is of the chosen class', () => {
    for (const cls of ['ring', 'boots', 'wand'] as const) {
      for (let seed = 1; seed <= 6; seed++) {
        for (const it of gear(roll(seed, { ...NONE, itemClass: cls }))) expect(getBase(it.baseId).itemClass).toBe(cls);
      }
    }
  });

  it('Attuned ignores a class that does not exist', () => {
    const plain = roll(3);
    expect(roll(3, { ...NONE, itemClass: 'notAClass' })).toEqual(plain);
  });

  it('Recast: rolling twice and keeping the better raises the chest equipment on average', () => {
    const score = (it: EquipmentItem) => ({ normal: 0, magic: 1, rare: 2, unique: 3 }[it.rarity] ?? 0) * 10 + it.affixes.length;
    let plain = 0, recast = 0, n = 0;
    for (let seed = 1; seed <= 300; seed++) {
      for (const it of gear(roll(seed))) { plain += score(it); n++; }
      for (const it of gear(roll(seed, { ...NONE, recast: true }))) recast += score(it);
    }
    expect(n).toBeGreaterThan(0);
    expect(recast).toBeGreaterThan(plain);
  });
});
