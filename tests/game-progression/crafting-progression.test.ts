import { describe, expect, it } from 'vitest';
import { ATLAS_AREA_IDS } from '../../src/contracts/atlas';
import { ITEM_CLASSES } from '../../src/contracts/content';
import { createRng } from '../../src/core/rng';
import { BASES } from '../../src/data/items';
import { CURRENCY_DROPS } from '../../src/data/progression';
import { rules } from '../../src/game';
import { baseWeights, generateEquipment } from '../../src/game/items';
import { monsterLevelForTier } from '../../src/game/progression';
import { normalizeItem } from '../../src/game/progression/save';
import { bareCharacter, expectOk, kill, map } from './fixtures';

const explored = { discovered: [...ATLAS_AREA_IDS], completed: [], clears: 0 };

describe('area ingredients', () => {
  it('drops each rune only at its assigned boss, at 25%, on Tier 3+', () => {
    for (const [area, rune] of [['glassSepulchre', 'prefixRune'], ['emberVault', 'suffixRune']] as const) {
      const ch = bareCharacter({ atlas: explored, mapDevice: map('ashenForge', 3) });
      const setup = expectOk(rules.openMap(ch, area)).setup;
      const rng = createRng(152);
      let count = 0;
      for (let i = 0; i < 2000; i++) {
        const drops = rules.rollKillLoot(setup, kill({ isBoss: true }), rng, ch);
        count += drops.filter(i => i.kind === 'currency' && i.currencyId === rune).length;
        expect(drops.some(i => i.kind === 'currency' && i.currencyId === (rune === 'prefixRune' ? 'suffixRune' : 'prefixRune'))).toBe(false);
      }
      expect(count / 2000).toBeGreaterThan(0.21);
      expect(count / 2000).toBeLessThan(0.29);
      const low = expectOk(rules.openMap({ ...ch, mapDevice: map('ashenForge', 2) }, area)).setup;
      for (let i = 0; i < 100; i++) {
        for (const drops of [
          rules.rollKillLoot(low, kill({ isBoss: true }), rng, ch),
          rules.rollKillLoot(setup, kill({ rarity: 'rare' }), rng, ch),
          rules.rollKillLoot(setup, kill({ isLieutenant: true }), rng, ch),
          rules.rollChestLoot(setup, rng, ch),
        ]) expect(drops.some(i => i.kind === 'currency' && ['prefixRune', 'suffixRune'].includes(i.currencyId))).toBe(false);
      }
    }
    expect(CURRENCY_DROPS.some(d => ['prefixRune', 'suffixRune'].includes(d.currencyId))).toBe(false);
  });
});

describe('advanced bases', () => {
  const advanced = Object.values(BASES).filter(b => b.levelRequirement >= 42);
  it('adds one crafting project for every class, unavailable at T7 and eligible at T8', () => {
    expect(advanced).toHaveLength(10);
    expect(advanced.map(b => b.itemClass).sort()).toEqual([...ITEM_CLASSES].sort());
    const t7 = baseWeights({ itemLevel: monsterLevelForTier(7) });
    const t8 = baseWeights({ itemLevel: monsterLevelForTier(8) });
    for (const base of advanced) {
      expect(t7.some(b => b.base.id === base.id), base.id).toBe(false);
      expect(t8.some(b => b.base.id === base.id), base.id).toBe(true);
      const item = generateEquipment(base.id, 46, 'rare', createRng(12));
      expect(normalizeItem(JSON.parse(JSON.stringify(item)), item.uid)).toEqual(item);
      expect(rules.describeItem(item).requirements).toBe(`Requires Level ${base.levelRequirement}`);
    }
  });

  it('actually awards every advanced class through Tier 8 map loot, without dropping them at Tier 7', () => {
    const found = new Set<string>();
    for (const tier of [7, 8]) {
      const ch = bareCharacter({ atlas: explored, mapDevice: map('ashenForge', tier), currencyStash: { scrap: 2 } });
      const setup = expectOk(rules.openMap(ch, 'crownFoundry')).setup;
      const rng = createRng(987);
      for (let i = 0; i < 1500; i++) for (const item of rules.rollChestLoot(setup, rng, ch)) {
        if (item.kind !== 'equipment' || !advanced.some(b => b.id === item.baseId)) continue;
        expect(tier).toBe(8);
        expect(item.itemLevel).toBe(46);
        found.add(item.baseId);
      }
    }
    expect([...found].sort()).toEqual(advanced.map(b => b.id).sort());
  });
});
