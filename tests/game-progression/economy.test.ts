import { describe, expect, it } from 'vitest';
import { ATLAS_AREA_IDS } from '../../src/contracts/atlas';
import type { EquipmentItem, MapItem } from '../../src/contracts/items';
import { createRng } from '../../src/core/rng';
import { MAX_HISTORY_LINES } from '../../src/data/items';
import { REWARD_MODS } from '../../src/data/progression';
import { rules, withItemLocks } from '../../src/game';
import { benchCurrency, craftEquipment, findItem, stabilityRepairCost } from '../../src/game/items';
import { itemCraftCount } from '../../src/game/items/crafting-history';
import { mapEventOdds, rollMapEvent } from '../../src/game/progression/map-events';
import { normalizeCharacter, normalizeItem } from '../../src/game/progression/save';
import { restoreRunSetup } from '../../src/game/progression/runs';
import { currency, equip, expectOk, makeCharacter, map, withBackpack } from '../game-items/fixtures';

const project = () => equip({ uid: 'project', baseId: 'ashwoodWand', itemLevel: 30, rarity: 'magic', stability: 2,
  affixes: [{ affixId: 'fireDamage', tier: 7, sealed: true }, { affixId: 'castSpeed', tier: 7, fractured: true }],
  scars: [{ scarId: 'frail', value: 7 }], history: ['Dropped in a map', 'Reforging Ember reforged it'] });
const funded = (item: EquipmentItem | MapItem) => withBackpack(makeCharacter({ currencyStash: { scrap: 1000 } }), [[item, 0, 0], [currency('scrap', 3, 'money'), 11, 0]]);
const target = (ch: ReturnType<typeof funded>) => findItem(ch, 'project')!.item as EquipmentItem;

it('repairs exactly one point, spends backpack then shared Scrap, preserves all rolls/protections/scars and revives Finished gear', () => {
  for (const stability of [0, 2, 7]) {
    const item = { ...project(), stability };
    const ch = funded(item), before = structuredClone(ch);
    const cost = stabilityRepairCost(item);
    const out = expectOk(rules.applyBenchRecipe(ch, item.uid, 'bench:repair')).character;
    const repaired = target(out);
    expect(repaired).toEqual({ ...item, stability: stability + 1, craftCount: itemCraftCount(item), repairCount: 1,
      history: [...item.history, `Repaired 1 Stability for ${cost} Forge Scrap`] });
    expect(findItem(out, 'money')).toBeNull();
    expect(out.currencyStash.scrap).toBe(1003 - cost);
    expect(out.rngState).toBe(ch.rngState);
    expect(ch).toEqual(before);
    expect(stabilityRepairCost(repaired)).toBeGreaterThan(cost);
    const restored = normalizeCharacter(JSON.parse(JSON.stringify(out)))!;
    expect(target(restored)).toEqual(repaired);
    expect(stabilityRepairCost(target(restored))).toBe(stabilityRepairCost(repaired));
  }
});

it('retains lifetime pricing after display history rolls over and increments the counter for every craft', () => {
  let item = { ...project(), stability: 8, craftCount: 250, repairCount: 15,
    history: Array.from({ length: MAX_HISTORY_LINES }, () => 'Forge Scrap rerolled 1 value') };
  item.affixes = item.affixes.map(a => ({ ...a, sealed: false, fractured: false }));
  const out = expectOk(craftEquipment(item, 'scrap', createRng(9))).item;
  expect(out.craftCount).toBe(251);
  expect(out.repairCount).toBe(15);
  expect(out.history).toHaveLength(MAX_HISTORY_LINES);
  expect(stabilityRepairCost(out)).toBe(stabilityRepairCost(item) + 3);
  const saved = normalizeItem(JSON.parse(JSON.stringify(out)), out.uid) as EquipmentItem;
  expect(saved.craftCount).toBe(251);
  expect(stabilityRepairCost(saved)).toBe(stabilityRepairCost(out));
  expect(stabilityRepairCost({ ...saved, repairCount: 16 })).toBeGreaterThan(stabilityRepairCost(saved) + 100);
});

it('rejects full Stability, uniques, insufficient funds and trade locks without changing any holdings', () => {
  for (const item of [{ ...project(), stability: 8 }, { ...project(), rarity: 'unique' as const }]) {
    const ch = funded(item);
    expect(rules.applyBenchRecipe(ch, item.uid, 'bench:repair').ok).toBe(false);
  }
  const ch = funded(project());
  const poor = { ...ch, currencyStash: {} };
  expect(rules.applyBenchRecipe(poor, 'project', 'bench:repair').ok).toBe(false);
  const locked = withItemLocks(rules, () => new Set(['project']));
  expect(locked.benchServices(ch, 'project')[0].available).toBe(false);
  expect(locked.applyBenchRecipe(ch, 'project', 'bench:repair').ok).toBe(false);
  const lockedMoney = withItemLocks(rules, () => new Set(['money']));
  const cost = stabilityRepairCost(project());
  const tight = { ...ch, currencyStash: { scrap: cost - 3 } };
  expect(lockedMoney.benchServices(tight, 'project')[0].available).toBe(false);
  expect(lockedMoney.applyBenchRecipe(tight, 'project', 'bench:repair').ok).toBe(false);
  expect(benchCurrency(tight, 'scrap')).toBe(cost);
});

const craftedMap = (): MapItem => ({ ...map('project'), tier: 5, rarity: 'magic', quality: 13,
  mods: [{ modId: 'teeming', value: 95 }, { modId: 'restless', value: 110 }, { modId: REWARD_MODS[0].id, value: 123 }] });

describe('map Scrap services', () => {
  it('replaces only the chosen danger/reward pair with a different family and keeps everything else', () => {
    const source = { ...craftedMap(), bounty: true };
    for (let seed = 1; seed < 150; seed++) {
      const ch = { ...funded(source), rngState: seed };
      const result = expectOk(rules.applyBenchRecipe(ch, source.uid, 'bench:map:teeming')).character;
      const item = findItem(result, source.uid)!.item as MapItem;
      expect(item.mods).toHaveLength(source.mods.length);
      expect(item.mods.some(m => m.modId === 'teeming')).toBe(false);
      expect(new Set(item.mods.map(m => m.modId)).size).toBe(item.mods.length);
      for (const kept of source.mods.slice(1)) expect(item.mods).toContainEqual(kept);
      expect({ ...item, mods: [] }).toEqual({ ...source, mods: [] });
      expect(benchCurrency(result, 'scrap')).toBe(1003 - 8);
      expect(result.rngState).not.toBe(seed);
      expect(normalizeItem(item, item.uid)).toEqual(item);
    }
  });

  it('commissions a tradeable Bounty item, persists it, and guarantees only The Hunted across seeds and restarts', () => {
    const source = craftedMap();
    const ch = funded(source);
    const result = expectOk(rules.applyBenchRecipe(ch, source.uid, 'bench:bounty')).character;
    const bounty = findItem(result, source.uid)!.item as MapItem;
    expect(bounty).toEqual({ ...source, bounty: true });
    expect(benchCurrency(result, 'scrap')).toBe(1003 - 18);
    expect(rules.describeItem(bounty).headerLines).toContain('Bounty: The Hunted guaranteed');
    expect(mapEventOdds(bounty, 'glassSepulchre')).toEqual({ hunted: 1, echoRift: 0 });
    for (let seed = 0; seed < 100; seed++) {
      expect(rollMapEvent(bounty, seed, 'glassSepulchre')?.kind).toBe('hunted');
    }
    const entered = expectOk(rules.openMap({ ...result, mapDevice: bounty,
      atlas: { discovered: [...ATLAS_AREA_IDS], completed: [], clears: 0 } }, 'glassSepulchre'));
    expect(entered.setup.event?.kind).toBe('hunted');
    const restored = restoreRunSetup(JSON.stringify(entered.setup), entered.setup.seed)!;
    expect(restored.event).toEqual(entered.setup.event);
    expect(restored.sourceMap?.bounty).toBe(true);
    expect(rules.applyBenchRecipe(result, source.uid, 'bench:bounty').ok).toBe(false);
  });

  it('refuses corrupted maps, unknown mod targets and trading offered maps or funding stacks', () => {
    const ch = funded(craftedMap());
    for (const id of ['bench:bounty', 'bench:map:teeming']) {
      const corrupt = funded({ ...craftedMap(), corrupted: true });
      expect(rules.applyBenchRecipe(corrupt, 'project', id).ok).toBe(false);
      expect(withItemLocks(rules, () => new Set(['project'])).applyBenchRecipe(ch, 'project', id).ok).toBe(false);
    }
    expect(rules.applyBenchRecipe(ch, 'project', 'bench:map:missing').ok).toBe(false);
    expect(rules.applyBenchRecipe(ch, 'project', `bench:map:${REWARD_MODS[0].id}`).ok).toBe(false);
  });
});

it('charges only the map owner for Atlas territory, keeps T1–3 free, and preserves recorded fees without inventing legacy refunds', () => {
  const atlas = { discovered: [...ATLAS_AREA_IDS], completed: [], clears: 0 };
  for (const [tier, fee] of [[1, 0], [3, 0], [4, 1], [6, 1], [7, 2], [9, 2]]) {
    const ch = makeCharacter({ atlas, mapDevice: { ...map(), tier }, currencyStash: { scrap: 5 } });
    const opened = expectOk(rules.openMap(ch, 'crownFoundry'));
    expect(opened.character.currencyStash.scrap).toBe(5 - fee);
    expect(opened.setup.entranceScrap ?? 0).toBe(fee);
    expect(restoreRunSetup(opened.setup, opened.setup.seed)?.entranceScrap ?? 0).toBe(fee);
    const { entranceScrap: _fee, ...legacy } = opened.setup;
    expect(restoreRunSetup(legacy, legacy.seed)?.entranceScrap).toBeUndefined();
    expect(ch.currencyStash.scrap).toBe(5);
  }
  const poor = makeCharacter({ atlas, mapDevice: { ...map(), tier: 7 } });
  const before = structuredClone(poor);
  expect(rules.openMap(poor, 'crownFoundry').ok).toBe(false);
  expect(poor).toEqual(before);
});
