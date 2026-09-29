// Special stash tabs (GAME_SPEC §12): the pure view models in src/ui/lib/stash.ts, the special item locations, and the
// stash search over the Map Stash and the Crafting Stash (with the shared rules describing the items).
import { describe, expect, it } from 'vitest';
import { CURRENCY_IDS, EQUIPMENT_CURRENCY_IDS, MAP_BASE_IDS, MAP_CURRENCY_IDS } from '../../src/contracts/content';
import { CURRENCY_STASH_MAX, currencyStashUid, type CharacterSave, type GridEntry, type MapItem } from '../../src/contracts/items';
import type { UiStore } from '../../src/contracts/ui';
import { rules } from '../../src/game';
import { computeSearch, stashMatchCount } from '../../src/ui/items/search';
import { locationKey, sameLocation } from '../../src/ui/lib/items';
import {
  CURRENCY_SHELVES,
  CURRENCY_SHORT,
  MAP_TIERS,
  SPECIAL_TABS,
  SPECIAL_TAB_INFO,
  depositPlan,
  compareMaps,
  currenciesOf,
  currencyHoldings,
  currencyTabOf,
  groupMapStash,
  isFullSlot,
  isSpecialTab,
  modCountText,
  normalTabIndex,
  parseCurrencyStashUid,
  pickMapTier,
  slotStack,
  stashCount,
  stashTotal,
  tierBand,
  withdrawCount,
} from '../../src/ui/lib/stash';

let n = 0;
function map(tier: number, baseId: MapItem['baseId'], rarity: MapItem['rarity'] = 'normal', mods = 0, extra: Partial<MapItem> = {}): MapItem {
  n += 1;
  return {
    kind: 'map',
    uid: `map-${n.toString().padStart(3, '0')}`,
    baseId,
    tier,
    rarity,
    mods: Array.from({ length: mods }, (_, i) => ({ modId: `m${i}`, value: 1 })),
    quality: 0,
    corrupted: false,
    ...extra,
  };
}

function character(patch: Partial<CharacterSave> = {}): CharacterSave {
  return { ...rules.createCharacter('Stasher', 3), ...patch };
}

describe('special tabs', () => {
  it('lists the three special tabs with a name and an icon each', () => {
    expect(SPECIAL_TABS).toEqual(['maps', 'currency', 'mapCurrency']);
    for (const t of SPECIAL_TABS) {
      expect(SPECIAL_TAB_INFO[t].title.length).toBeGreaterThan(0);
      expect(SPECIAL_TAB_INFO[t].iconId).toMatch(/^icon\//);
    }
  });

  it('tells special tabs from normal tab indices and clamps normal ones', () => {
    expect(isSpecialTab('maps')).toBe(true);
    expect(isSpecialTab(2)).toBe(false);
    expect(normalTabIndex('currency', 3)).toBeNull();
    expect(normalTabIndex(1, 3)).toBe(1);
    expect(normalTabIndex(9, 3)).toBe(2);
    expect(normalTabIndex(-4, 3)).toBe(0);
  });

  it('knows the special item locations', () => {
    expect(sameLocation({ kind: 'currencyStash' }, { kind: 'currencyStash' })).toBe(true);
    expect(sameLocation({ kind: 'mapStash' }, { kind: 'currencyStash' })).toBe(false);
    expect(sameLocation({ kind: 'mapStash' }, { kind: 'mapStash' })).toBe(true);
    expect(locationKey({ kind: 'currencyStash' })).toBe('currencyStash');
    expect(locationKey({ kind: 'mapStash' })).toBe('mapStash');
  });
});

describe('Crafting Stash layout', () => {
  it('gives every currency exactly one labelled slot, on the right tab', () => {
    const equipment = CURRENCY_SHELVES.currency.flatMap((s) => s.ids);
    const maps = CURRENCY_SHELVES.mapCurrency.flatMap((s) => s.ids);
    expect([...equipment].sort()).toEqual([...EQUIPMENT_CURRENCY_IDS].sort());
    expect([...maps].sort()).toEqual([...MAP_CURRENCY_IDS].sort());
    for (const id of CURRENCY_IDS) expect(CURRENCY_SHORT[id].length).toBeGreaterThan(0);
    for (const id of EQUIPMENT_CURRENCY_IDS) expect(currencyTabOf(id)).toBe('currency');
    for (const id of MAP_CURRENCY_IDS) expect(currencyTabOf(id)).toBe('mapCurrency');
    expect(currenciesOf('mapCurrency')).toEqual(MAP_CURRENCY_IDS);
  });

  it('addresses slots by cstash:<id> and nothing else', () => {
    for (const id of CURRENCY_IDS) expect(parseCurrencyStashUid(currencyStashUid(id))).toBe(id);
    expect(parseCurrencyStashUid('cstash:nope')).toBeNull();
    expect(parseCurrencyStashUid('belt:0')).toBeNull();
    expect(parseCurrencyStashUid('m12')).toBeNull();
    expect(slotStack('seal', 7)).toEqual({ kind: 'currency', uid: 'cstash:seal', currencyId: 'seal', count: 7 });
  });

  it('reads slot counts defensively (old saves, junk values)', () => {
    const ch = character({ currencyStash: { scrap: 5000, seal: -3, catalyst: 2.7, kindling: Number.NaN } });
    expect(stashCount(ch, 'scrap')).toBe(5000);
    expect(isFullSlot(stashCount(ch, 'scrap'))).toBe(true);
    expect(stashCount(ch, 'seal')).toBe(0);
    expect(stashCount(ch, 'catalyst')).toBe(2);
    expect(stashCount(ch, 'kindling')).toBe(0);
    expect(stashCount(ch, 'mapDust')).toBe(0);
    const old = { ...character(), currencyStash: undefined } as unknown as CharacterSave;
    expect(stashCount(old, 'scrap')).toBe(0);
    expect(stashTotal(ch, 'currency')).toBe(5002);
    expect(stashTotal(ch, 'mapCurrency')).toBe(0);
  });

  it('withdraws a stack with Ctrl and one with Shift+Ctrl', () => {
    expect(withdrawCount(false)).toBeUndefined();
    expect(withdrawCount(true)).toBe(1);
  });

  it('counts what can be spent where', () => {
    const base = character();
    const ch = character({ currencyStash: { scrap: 120 } });
    const bp = currencyHoldings(base, 'scrap').backpack;
    expect(currencyHoldings(ch, 'scrap')).toEqual({ backpack: bp, stash: 0, crafting: 120 });
  });

  it('plans Deposit all like the rules run it: only stacks whose slot has room count, full slots are named', () => {
    const base = character();
    const stack = (uid: string, currencyId: 'scrap' | 'seal' | 'kindling', count: number, x: number): GridEntry => ({
      x,
      y: 0,
      item: { kind: 'currency', uid, currencyId, count },
    });
    const ch = character({
      currencyStash: { scrap: CURRENCY_STASH_MAX, seal: CURRENCY_STASH_MAX - 10 },
      backpack: {
        ...base.backpack,
        entries: [stack('a', 'scrap', 30, 0), stack('b', 'seal', 8, 1), stack('c', 'seal', 8, 2), stack('d', 'seal', 8, 3), stack('e', 'kindling', 5, 4)],
      },
    });
    // Seal has room for 10: the first stack moves whole, the second in part, the third stays.
    expect(depositPlan(ch)).toEqual({ stacks: 3, full: ['scrap', 'seal'] });
    expect(depositPlan(ch, new Set(['e']))).toEqual({ stacks: 2, full: ['scrap', 'seal'] });
    const res = rules.depositAllCurrency(ch);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(stashCount(res.value, 'seal')).toBe(CURRENCY_STASH_MAX);
    expect(stashCount(res.value, 'kindling')).toBe(5);
    const left = res.value.backpack.entries.flatMap((e) => (e.item.kind === 'currency' ? [e.item.currencyId] : []));
    expect(new Set(left)).toEqual(new Set(['scrap', 'seal']));

    // Every slot full: nothing to move, although the backpack holds currency.
    const stuck = character({ currencyStash: { scrap: CURRENCY_STASH_MAX }, backpack: { ...base.backpack, entries: [stack('a', 'scrap', 30, 0)] } });
    expect(depositPlan(stuck)).toEqual({ stacks: 0, full: ['scrap'] });
    expect(depositPlan(character({ backpack: { ...base.backpack, entries: [] } }))).toEqual({ stacks: 0, full: [] });
  });
});

describe('Map Stash grouping', () => {
  const maps = [
    map(3, 'rimedOssuary', 'normal'),
    map(3, 'ashenForge', 'magic', 2),
    map(3, 'ashenForge', 'rare', 4),
    map(3, 'ashenForge', 'rare', 5),
    map(7, 'ironColiseum', 'rare', 3, { corrupted: true }),
    map(15, 'ashenForge'),
    map(22, 'ashenForge'), // out of range: files under T15
  ];
  const groups = groupMapStash(maps);

  it('always has T1–T15, each with its count', () => {
    expect(groups).toHaveLength(MAP_TIERS);
    expect(groups.map((g) => g.tier)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(groups[2].count).toBe(4);
    expect(groups[6].count).toBe(1);
    expect(groups[14].count).toBe(2);
    expect(groups[0].count).toBe(0);
    expect(groups[0].sections).toEqual([]);
  });

  it('sections a tier by base in content order, best maps first', () => {
    const t3 = groups[2];
    expect(t3.sections.map((s) => s.baseId)).toEqual(MAP_BASE_IDS.filter((id) => id === 'ashenForge' || id === 'rimedOssuary'));
    const forge = t3.sections[0].maps;
    expect(forge.map((m) => [m.rarity, m.mods.length])).toEqual([
      ['rare', 5],
      ['rare', 4],
      ['magic', 2],
    ]);
    expect(compareMaps(forge[0], forge[1])).toBeLessThan(0);
  });

  it('expands the chosen tier, else the highest tier holding maps', () => {
    expect(pickMapTier(groups, 7)).toBe(7);
    expect(pickMapTier(groups, 15)).toBe(15);
    expect(pickMapTier(groups, null)).toBe(15);
    expect(pickMapTier(groups, 99)).toBe(15);
    expect(pickMapTier(groupMapStash([]), null)).toBeNull();
    expect(pickMapTier(groupMapStash([]), 4)).toBeNull();
  });

  it('moves off a chosen tier that ran empty to the nearest tier with maps (the higher on a tie)', () => {
    // Maps in T3, T7 and T15.
    expect(pickMapTier(groups, 1)).toBe(3);
    expect(pickMapTier(groups, 4)).toBe(3);
    expect(pickMapTier(groups, 5)).toBe(7); // T3 and T7 are both 2 away
    expect(pickMapTier(groups, 6)).toBe(7);
    expect(pickMapTier(groups, 12)).toBe(15);
  });

  it('bands tiers and words mod counts', () => {
    expect([1, 5, 6, 10, 11, 15].map(tierBand)).toEqual(['low', 'low', 'mid', 'mid', 'high', 'high']);
    expect(modCountText(0)).toBe('no mods');
    expect(modCountText(1)).toBe('1 mod');
    expect(modCountText(4)).toBe('4 mods');
  });
});

describe('stash search over the special tabs', () => {
  const store = { rules } as unknown as UiStore;

  it('lights up filled Crafting Stash slots and counts them per tab, never empty slots', () => {
    const ch = character({ currencyStash: { kindling: 12, essenceEmber: 3, mapDust: 9 } });
    const r = computeSearch(store, ch, 'kindling');
    expect(r.active).toBe(true);
    expect(r.matches.has('cstash:kindling')).toBe(true);
    expect(r.special.currency).toBe(1);
    expect(r.special.mapCurrency).toBe(0);
    const dust = computeSearch(store, ch, '"map dust"');
    expect(dust.matches.has('cstash:mapDust')).toBe(true);
    expect(dust.special.mapCurrency).toBe(1);
    // Seal has no stash slot filled: it is not an item there.
    const seal = computeSearch(store, ch, 'seal');
    expect(seal.matches.has('cstash:seal')).toBe(false);
  });

  it('matches Map Stash maps like grid items and adds them to the total', () => {
    const maps = [map(4, 'rimedOssuary', 'rare', 2), map(9, 'ironColiseum', 'normal'), map(4, 'ashenForge', 'magic', 1)];
    const ch = character({ mapStash: maps });
    const r = computeSearch(store, ch, 'rare');
    expect(r.matches.has(maps[0].uid)).toBe(true);
    expect(r.matches.has(maps[1].uid)).toBe(false);
    expect(r.special.maps).toBe(1);
    expect(stashMatchCount(r)).toBe(r.tabCounts.reduce((a, b) => a + b, 0) + 1);
    const tier = computeSearch(store, ch, '"tier 4"');
    expect(tier.special.maps).toBe(2);
    expect(computeSearch(store, ch, '').active).toBe(false);
  });
});
