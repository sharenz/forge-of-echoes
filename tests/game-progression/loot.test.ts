// Loot & luck (GAME_SPEC §9, §11), checked statistically against the spec rates. Loot is instanced: every
// roll is for one looter, with the map-side luck of the run plus that looter's gear.
import { describe, expect, it } from 'vitest';
import type { RunSetup } from '../../src/contracts/game';
import type { CharacterSave, EquipmentItem, Item, MapItem, RolledMapMod } from '../../src/contracts/items';
import type { CurrencyId } from '../../src/contracts/content';
import { createRng } from '../../src/core/rng';
import { lootLuckLines, rules } from '../../src/game';
import { getBase } from '../../src/data/items';
import { ARMOUR_CLASSES, UNIQUES } from '../../src/data/items';
import {
  BOSS_LOOT, CATEGORY_CHANCE, CHEST_LOOT, CURRENCY_DROPS, EQUIPMENT_RARITY_WEIGHTS, LIEUTENANT_LOOT,
} from '../../src/data/progression';
import {
  categoryChances, currencyWeightsFor, equipmentRarityOdds, killLuck, monsterLevelForTier, rollEquipmentRarity,
} from '../../src/game/progression';
import { bareCharacter, equip, kill, luckyAmulet, map, setupFor, unique } from './fixtures';

/** A run frozen before drop routing existed (brief D R1): its maps roll a theme as before, so tier offsets are exact. */
const withoutRouting = (setup: RunSetup): RunSetup => { const { routing: _routing, ...rest } = setup; return rest; };

const mod = (modId: string, value = 100): RolledMapMod => ({ modId, value });

const BASE_CURRENCY = CATEGORY_CHANCE.currency;
const BASE_EQUIPMENT = CATEGORY_CHANCE.equipment;
const BASE_FLASK = CATEGORY_CHANCE.flask;
const BASE_MAP = CATEGORY_CHANCE.map;
const RW = EQUIPMENT_RARITY_WEIGHTS;
const dropWeight = (id: CurrencyId) => CURRENCY_DROPS.find((d) => d.currencyId === id)!.weight;

/** Within `k` standard deviations of a binomial rate. */
function expectRate(count: number, n: number, p: number, k = 4) {
  const sigma = Math.sqrt((p * (1 - p)) / n);
  expect(Math.abs(count / n - p), `observed ${(count / n).toFixed(5)} vs ${p}`).toBeLessThan(k * sigma);
}

/** A looter with no gear at all (map-side luck only). */
const NAKED = bareCharacter();

function tallyKills(setup: RunSetup, n: number, ctx = kill(), seed = 1, looter: CharacterSave = NAKED) {
  const rng = createRng(seed);
  const t = { currency: 0, equipment: 0, flask: 0, map: 0, items: [] as Item[] };
  for (let i = 0; i < n; i++) {
    for (const item of rules.rollKillLoot(setup, ctx, rng, looter)) {
      t[item.kind] += 1;
      t.items.push(item);
    }
  }
  return t;
}

describe('per-kill drop rates (100k kills at 100% quantity and rarity)', () => {
  const setup = setupFor(map('ashenForge', 3));
  const N = 100_000;
  const t = tallyKills(setup, N);

  it('has neutral luck on a Normal Tier 3 Ashen Forge… except the tier rarity bonus', () => {
    expect(setup.itemQuantity).toBe(100);
    expect(setup.itemRarity).toBe(110);
  });

  it('drops each category at base × quantity', () => {
    expectRate(t.currency, N, BASE_CURRENCY);
    expectRate(t.equipment, N, BASE_EQUIPMENT);
    expectRate(t.flask, N, BASE_FLASK);
    expectRate(t.map, N, BASE_MAP);
  });

  it('rolls item level = monster level and marks drops as new', () => {
    const eq = t.items.filter((i): i is EquipmentItem => i.kind === 'equipment');
    expect(eq.every((e) => e.itemLevel === monsterLevelForTier(3) && e.isNew === true)).toBe(true);
    expect(eq.every((e) => e.history[0] === 'Dropped in Ember Road (Tier 3)')).toBe(true);
  });

  it('drops maps at the same tier 60%, one lower 25%, one higher 15% (a run without routing: no ceilings clamp them)', () => {
    const legacy = tallyKills(withoutRouting(setup), N, kill(), 2);
    const maps = legacy.items.filter((i): i is MapItem => i.kind === 'map');
    const same = maps.filter((m) => m.tier === 3).length;
    const lower = maps.filter((m) => m.tier === 2).length;
    const higher = maps.filter((m) => m.tier === 4).length;
    expect(same + lower + higher).toBe(maps.length);
    expectRate(same, maps.length, 0.6);
    expectRate(lower, maps.length, 0.25);
    expectRate(higher, maps.length, 0.15);
  });

  it('weights currency per the table, with Ember Essences 3× in the Ashen Forge', () => {
    const counts = new Map<CurrencyId, number>();
    for (const i of t.items) if (i.kind === 'currency') counts.set(i.currencyId, (counts.get(i.currencyId) ?? 0) + 1);
    const weights = currencyWeightsFor(setup.map);
    const total = weights.reduce((s, w) => s + w.weight, 0);
    for (const w of weights) expectRate(counts.get(w.currencyId) ?? 0, t.currency, w.weight / total, 5);
    expect(weights.find((w) => w.currencyId === 'essenceEmber')!.weight).toBeCloseTo(dropWeight('essenceEmber') * 3, 10);
    expect(weights.find((w) => w.currencyId === 'essenceRime')!.weight).toBeCloseTo(dropWeight('essenceRime'), 10);
  });
});

describe('equipment rarity weights', () => {
  it('normal · magic m · rare m^1.3 · unique m^1.5 (weights from EQUIPMENT_RARITY_WEIGHTS)', () => {
    const total1 = RW.normal.base + RW.magic.base + RW.rare.base + RW.unique.base;
    const odds = equipmentRarityOdds(1);
    expect(odds.normal).toBeCloseTo(RW.normal.base / total1, 10);
    expect(odds.magic).toBeCloseTo(RW.magic.base / total1, 10);
    expect(odds.rare).toBeCloseTo(RW.rare.base / total1, 10);
    expect(odds.unique).toBeCloseTo(RW.unique.base / total1, 10);
    const m = 2;
    const w = [RW.normal.base, RW.magic.base * m, RW.rare.base * m ** RW.rare.exponent, RW.unique.base * m ** RW.unique.exponent];
    const sum = w.reduce((a, b) => a + b, 0);
    expect(equipmentRarityOdds(m).rare).toBeCloseTo(w[2] / sum, 10);
  });

  it('rolls those odds', () => {
    for (const m of [1, 2.5]) {
      const rng = createRng(17);
      const n = 200_000;
      const c = { normal: 0, magic: 0, rare: 0, unique: 0 };
      for (let i = 0; i < n; i++) c[rollEquipmentRarity(rng, m)]++;
      const odds = equipmentRarityOdds(m);
      for (const r of ['normal', 'magic', 'rare', 'unique'] as const) expectRate(c[r], n, odds[r]);
    }
  });

  it('respects a minimum rarity', () => {
    const odds = equipmentRarityOdds(1, 'magic');
    expect(odds.normal).toBe(0);
    expect(odds.magic + odds.rare + odds.unique).toBeCloseTo(1, 10);
  });
});

describe('monster rarity and luck multipliers', () => {
  const setup = setupFor(map('ashenForge', 1));

  it('magic monsters ×1.5 quantity, rare ×4, lieutenant and boss like rares', () => {
    expect(categoryChances(setup, kill()).currency).toBeCloseTo(BASE_CURRENCY, 12);
    expect(categoryChances(setup, kill({ rarity: 'magic' })).currency).toBeCloseTo(BASE_CURRENCY * 1.5, 12);
    expect(categoryChances(setup, kill({ rarity: 'rare' })).equipment).toBeCloseTo(BASE_EQUIPMENT * 4, 12);
    expect(categoryChances(setup, kill({ kind: 'cinderMatriarch', isBoss: true })).map).toBeCloseTo(BASE_MAP * 4, 12);
  });

  it('rare monsters drop at 4× the rate', () => {
    const n = 40_000;
    const t = tallyKills(setup, n, kill({ rarity: 'rare', kind: 'ironhideBrute' }), 7);
    expectRate(t.currency, n, BASE_CURRENCY * 4);
    expectRate(t.equipment, n, BASE_EQUIPMENT * 4);
    const eq = t.items.find((i): i is EquipmentItem => i.kind === 'equipment')!;
    expect(eq.history[0]).toBe('Dropped by a rare Ironhide Brute in Cinder Crossing (Tier 1)');
  });

  it('item quantity scales every category; quality and Cartographer\'s also raise map drops', () => {
    const lucky = setupFor(map('ashenForge', 1, { quality: 20, mods: [mod('bountiful')] }));
    expect(lucky.itemQuantity).toBe(145);
    const c = categoryChances(lucky, kill());
    expect(c.currency).toBeCloseTo(BASE_CURRENCY * 1.45, 12);
    expect(c.map).toBeCloseTo(BASE_MAP * 1.45 * 1.2, 12);
    const carto = setupFor(map('ashenForge', 1, { mods: [mod('cartographers')] }));
    expect(categoryChances(carto, kill()).map).toBeCloseTo(BASE_MAP * 3, 12);
  });

  it('chances above 100% drop several items', () => {
    const huge: RunSetup = { ...setupFor(map()), itemQuantity: 5000 };
    const rng = createRng(3);
    const items = rules.rollKillLoot(huge, kill({ rarity: 'rare' }), rng, NAKED);
    // A rare monster at 5000% quantity: chance = base × 50 × 4, a whole number of items when it divides evenly.
    const chance = BASE_CURRENCY * 50 * 4;
    const count = items.filter((i) => i.kind === 'currency').length;
    expect(count).toBeGreaterThanOrEqual(Math.floor(chance));
    expect(count).toBeLessThanOrEqual(Math.floor(chance) + 1);
  });

  it('the Echo wave doubles quantity', () => {
    const echo: MapItem = { ...map(), corrupted: true, mods: [{ modId: 'echo', value: 100, corrupted: true }] };
    const s = setupFor(echo);
    expect(categoryChances(s, kill({ wave: 6 })).currency).toBeCloseTo(BASE_CURRENCY, 12);
    expect(categoryChances(s, kill({ wave: 7 })).currency).toBeCloseTo(BASE_CURRENCY * 2, 12);
  });
});

describe('guaranteed drops', () => {
  const setup = setupFor(map('ashenForge', 4));

  it('lieutenant: guaranteed equipment of at least magic (the last at least rare 30%), guaranteed currency, a map half the time', () => {
    const rng = createRng(11);
    const n = 3000;
    let rareish = 0;
    let maps = 0;
    for (let i = 0; i < n; i++) {
      const items = rules.rollKillLoot(setup, kill({ kind: 'ashboundHerald', isLieutenant: true, wave: 3 }), rng, NAKED);
      // The guarantees come after the ordinary roll: take the tail.
      const eq = items.filter((x): x is EquipmentItem => x.kind === 'equipment');
      expect(eq.length).toBeGreaterThanOrEqual(LIEUTENANT_LOOT.equipment);
      const guaranteed = eq.slice(-LIEUTENANT_LOOT.equipment);
      expect(guaranteed.every((e) => e.rarity !== 'normal')).toBe(true);
      const last = guaranteed[guaranteed.length - 1];
      if (last.rarity === 'rare' || last.rarity === 'unique') rareish++;
      expect(items.filter((x) => x.kind === 'currency').length).toBeGreaterThanOrEqual(LIEUTENANT_LOOT.currency);
      if (items.some((x) => x.kind === 'map')) maps++;
    }
    // ≥ rare on the last guaranteed item: 30% guaranteed + 70% × (rare+unique share of the ≥ magic roll).
    const odds = equipmentRarityOdds(setup.itemRarity / 100, 'magic');
    expectRate(rareish, n, 0.3 + 0.7 * (odds.rare + odds.unique));
    const ordinaryMap = 1 - (1 - categoryChances(setup, kill({ isLieutenant: true })).map);
    expectRate(maps, n, 1 - 0.5 * (1 - ordinaryMap), 5);
  });

  it('boss: a guaranteed rare, more of at least magic, guaranteed currency, unique chance × m', () => {
    const rng = createRng(12);
    const n = 3000;
    let uniques = 0;
    for (let i = 0; i < n; i++) {
      const items = rules.rollKillLoot(setup, kill({ kind: 'cinderMatriarch', isBoss: true, wave: 6 }), rng, NAKED);
      const eq = items.filter((x): x is EquipmentItem => x.kind === 'equipment');
      expect(eq.some((e) => e.rarity === 'rare')).toBe(true);
      expect(eq.filter((e) => e.rarity !== 'normal').length).toBeGreaterThanOrEqual(1 + BOSS_LOOT.extraEquipment);
      expect(items.filter((x) => x.kind === 'currency').length).toBeGreaterThanOrEqual(BOSS_LOOT.currency);
      if (eq.at(-1)!.rarity === 'unique' && eq.length >= 2 + BOSS_LOOT.extraEquipment) uniques++;
      expect(eq[0].history[0]).toMatch(/Cinder Matriarch|Dropped/);
    }
    expect(uniques / n).toBeGreaterThan(BOSS_LOOT.uniqueChance * 1.15 * 0.7);
    expect(uniques / n).toBeLessThan(BOSS_LOOT.uniqueChance * 1.15 * 1.3 + 0.01);
  });

  it('completion chest: equipment ≥ magic, currency, a flask and a same-tier map with 25% chance of +1', () => {
    const rng = createRng(13);
    const currencyCounts = new Set<number>();
    let upgrades = 0, bonusMaps = 0;
    for (let i = 0; i < 500; i++) {
      const items = rules.rollChestLoot(withoutRouting(setup), rng, NAKED);
      const eq = items.filter((x): x is EquipmentItem => x.kind === 'equipment');
      expect(eq).toHaveLength(CHEST_LOOT.equipment);
      expect(eq.every((e) => e.rarity !== 'normal')).toBe(true);
      // Hourglass Sand (3% of chests, brief D 7.4) is a separate roll, not one of the chest's currency rolls.
      const cur = items.filter((x) => x.kind === 'currency' && x.currencyId !== 'hourglassSand').length;
      expect(cur).toBeGreaterThanOrEqual(CHEST_LOOT.currency.min);
      expect(cur).toBeLessThanOrEqual(CHEST_LOOT.currency.max);
      currencyCounts.add(cur);
      expect(items.filter((x) => x.kind === 'flask')).toHaveLength(1);
      const maps = items.filter((x): x is MapItem => x.kind === 'map');
      expect(maps.length).toBeGreaterThanOrEqual(1);
      expect(maps.length).toBeLessThanOrEqual(2);
      expect([4, 5]).toContain(maps[0].tier);
      if (maps[0].tier === 5) upgrades++;
      if (maps.length === 2) bonusMaps++;
      expect(maps[0].quality).toBeGreaterThan(0);
    }
    expect([...currencyCounts].sort()).toEqual(
      Array.from({ length: CHEST_LOOT.currency.max - CHEST_LOOT.currency.min + 1 }, (_, i) => CHEST_LOOT.currency.min + i),
    );
    expectRate(upgrades, 500, 0.25);
    expectRate(bonusMaps, 500, CHEST_LOOT.extraMapChance);
    const top = withoutRouting(setupFor(map('ashenForge', 15)));
    expect(rules.rollChestLoot(top, createRng(1), NAKED).find((x) => x.kind === 'map')!.tier).toBe(15);
  });

  it('Iron Coliseum armour bases drop with +2 stability', () => {
    const coliseum = setupFor(map('ironColiseum', 6));
    const rng = createRng(21);
    let checked = 0;
    for (let i = 0; i < 200 && checked < 20; i++) {
      for (const item of rules.rollChestLoot(coliseum, rng, NAKED)) {
        if (item.kind !== 'equipment' || item.rarity === 'unique') continue;
        const base = getBase(item.baseId);
        const extra = ARMOUR_CLASSES.includes(base.itemClass) ? 2 : 0;
        expect(item.maxStability).toBe(base.maxStability + extra);
        expect(item.stability).toBe(item.maxStability);
        if (extra) checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('determinism and drop specs', () => {
  it('the same seed gives the same loot', () => {
    const setup = setupFor(map('rimedOssuary', 7, { mods: [mod('commanded')] }));
    const a = rules.rollChestLoot(setup, createRng(99), NAKED);
    const b = rules.rollChestLoot(setupFor(map('rimedOssuary', 7, { mods: [mod('commanded')] })), createRng(99), NAKED);
    expect(b).toEqual(a);
  });

  it('describes ground drops with their owner, ASCII labels, tones, sprites and icons', () => {
    const setup = setupFor(map('ashenForge', 5));
    const rng = createRng(4);
    const items: Item[] = [];
    for (let i = 0; i < 40; i++) items.push(...rules.rollChestLoot(setup, rng, NAKED));
    for (const item of items) {
      const spec = rules.dropSpec(item, 7, 3);
      expect(spec.token).toBe(7);
      expect(spec.owner).toBe(3);
      expect(spec.label).toMatch(/^[\x20-\x7e]+$/);
      expect(spec.sprite).toBe(item.kind);
      expect(spec.tone).toBe(item.kind === 'equipment' ? item.rarity : item.kind);
      expect(spec.iconId).toMatch(/^icon\/(base|unique|currency|flask|map)\//);
      // GAME_SPEC §12: equipment is clicked; currency, flasks and maps are walked over.
      expect(spec.autoPickup).toBe(item.kind !== 'equipment');
    }
    expect(items.some((i) => i.kind === 'equipment') && items.some((i) => i.kind !== 'equipment')).toBe(true);
    expect(rules.dropSpec({ kind: 'currency', uid: 'x', currencyId: 'scrap', count: 3 }, 1, 1).label).toBe('Forge Scrap x3');
    expect(rules.dropSpec({ kind: 'currency', uid: 'x', currencyId: 'voidNeedle', count: 1 }, 1, 4)).toEqual({
      token: 1, owner: 4, autoPickup: true, label: 'Void Needle', tone: 'currency', sprite: 'currency', iconId: 'icon/currency/voidNeedle',
    });
    expect(rules.dropSpec(map('ironColiseum', 4), 2, 1).label).toBe("Champion's Approach map (T4)");
    expect(rules.dropSpec({ kind: 'flask', uid: 'f', flaskId: 'lifeFlask', count: 1 }, 3, 2).tone).toBe('flask');
  });

  it('marks loot walk-over or click-only, and anything a player drops as click-only and public', () => {
    const kinds: Item[] = [
      equip({ baseId: 'emberRing', itemLevel: 28, rarity: 'magic', affixes: [{ affixId: 'life', tier: 6 }] }),
      unique('cinderwalkers'),
      { kind: 'currency', uid: 'c', currencyId: 'scrap', count: 2 },
      { kind: 'flask', uid: 'f', flaskId: 'focusFlask', count: 1 },
      map('rimedOssuary', 3),
    ];
    const loot = kinds.map((i) => rules.dropSpec(i, 1, 2).autoPickup);
    expect(loot).toEqual([false, false, true, true, true]);
    // Explicitly not player-dropped is the same as omitting it.
    expect(kinds.map((i) => rules.dropSpec(i, 1, 2, false).autoPickup)).toEqual(loot);
    // A public drop (owner 0) is click-only even when the caller forgets the flag.
    expect(kinds.map((i) => rules.dropSpec(i, 1, 0).autoPickup)).toEqual([false, false, false, false, false]);
    for (const i of kinds) {
      const spec = rules.dropSpec(i, 9, 0, true);
      expect(spec).toMatchObject({ token: 9, owner: 0, autoPickup: false });
      // Everything else describes the item exactly like loot.
      expect({ ...spec, owner: 2, token: 1, autoPickup: rules.dropSpec(i, 1, 2).autoPickup }).toEqual(rules.dropSpec(i, 1, 2));
    }
  });
});

describe('personal luck (lootLuck): map-side luck plus the looter\'s gear', () => {
  const lucky = bareCharacter({ equipment: { amulet: luckyAmulet(20, 10) } });

  it('keeps gear out of the run setup and adds it per looter', () => {
    const m = map('ashenForge', 3, { quality: 10, mods: [mod('teeming')] });
    const setup = setupFor(m, lucky);
    // Map-side: quality 10 + Teeming 20 quantity, Tier 3 +10% rarity — the amulet is not in it.
    expect(setup.itemQuantity).toBe(130);
    expect(setup.itemRarity).toBe(110);
    expect(rules.lootLuck(setup, lucky)).toEqual({ itemQuantity: 140, itemRarity: 130 });
    expect(rules.lootLuck(setup, NAKED)).toEqual({ itemQuantity: 130, itemRarity: 110 });
    // The same map opened by a character without luck gear has the very same map-side luck.
    expect(setupFor(m, NAKED)).toMatchObject({ itemQuantity: 130, itemRarity: 110 });
  });

  it('builds on the setup\'s own map-side numbers', () => {
    const setup: RunSetup = { ...setupFor(map()), itemQuantity: 5000, itemRarity: 250 };
    expect(rules.lootLuck(setup, lucky)).toEqual({ itemQuantity: 5010, itemRarity: 270 });
  });

  it('explains itself: lootLuckLines lists map and gear sources and totals to lootLuck', () => {
    const setup = setupFor(map('ashenForge', 3, { quality: 10, mods: [mod('teeming')] }));
    const [q, r] = lootLuckLines(setup, lucky);
    expect(q.label).toBe('Item Quantity in this Map');
    expect(q.value).toBe('+40%');
    expect(q.breakdown.slice(0, 2)).toEqual(['+10% Quality', '+20% Teeming']);
    expect(q.breakdown[2]).toMatch(/^\+10% .*Cinder Pendant.*\(of Plenty T3\)$/);
    expect(q.breakdown).toContain('Total 140% of the base rate');
    expect(r).toMatchObject({ label: 'Item Rarity in this Map', value: '+30%' });
    expect(r.breakdown[0]).toBe('+10% Tier 3');
    expect(lootLuckLines(setup, NAKED)[0].value).toBe('+30%');
  });

  it('scales every roll of that looter: categories, monster rarity and the guarantees', () => {
    const setup = setupFor(map('ashenForge', 1));
    expect(categoryChances(setup, kill(), lucky).currency).toBeCloseTo(BASE_CURRENCY * 1.1, 12);
    expect(categoryChances(setup, kill(), NAKED).currency).toBeCloseTo(BASE_CURRENCY, 12);
    expect(killLuck(setup, kill({ rarity: 'magic' }), lucky)).toMatchObject({ quantity: 110 * 1.5, rarity: 120 * 2 });
    expect(killLuck(setup, kill({ rarity: 'magic' }), lucky).personal).toEqual({ itemQuantity: 110, itemRarity: 120 });
  });

  it('two looters on the same kills get their own drop rates', () => {
    const setup = setupFor(map('ashenForge', 2));
    const hoarder = bareCharacter({ equipment: { amulet: luckyAmulet(300, 100) } });
    const n = 60_000;
    const plain = tallyKills(setup, n, kill(), 5, NAKED);
    const rich = tallyKills(setup, n, kill(), 5, hoarder);
    expectRate(plain.equipment, n, BASE_EQUIPMENT);
    expectRate(rich.equipment, n, BASE_EQUIPMENT * 2);
    expectRate(rich.currency, n, BASE_CURRENCY * 2);
    const rares = (t: typeof plain) => {
      const eq = t.items.filter((i): i is EquipmentItem => i.kind === 'equipment');
      return { n: eq.length, rare: eq.filter((e) => e.rarity === 'rare' || e.rarity === 'unique').length };
    };
    // Tier 2 = 105% rarity for the plain looter, 405% for the hoarder.
    const oddsPlain = equipmentRarityOdds(1.05);
    const oddsRich = equipmentRarityOdds(4.05);
    const a = rares(plain);
    const b = rares(rich);
    expectRate(a.rare, a.n, oddsPlain.rare + oddsPlain.unique);
    expectRate(b.rare, b.n, oddsRich.rare + oddsRich.unique);
    expect(b.rare / b.n).toBeGreaterThan((a.rare / a.n) * 3);
  });

  it('the boss unique chance follows the looter\'s personal rarity', () => {
    const setup = setupFor(map('ashenForge', 4));
    const seeker = bareCharacter({ equipment: { amulet: luckyAmulet(100) } });
    const rng = createRng(31);
    const n = 3000;
    let uniques = 0;
    for (let i = 0; i < n; i++) {
      const eq = rules.rollKillLoot(setup, kill({ kind: 'cinderMatriarch', isBoss: true, wave: 6 }), rng, seeker)
        .filter((x): x is EquipmentItem => x.kind === 'equipment');
      if (eq.at(-1)!.rarity === 'unique' && eq.length >= 2 + BOSS_LOOT.extraEquipment) uniques++;
    }
    // m = (115 + 100) / 100
    expect(uniques / n).toBeGreaterThan(BOSS_LOOT.uniqueChance * 2.15 * 0.8);
    expect(uniques / n).toBeLessThan(BOSS_LOOT.uniqueChance * 2.15 * 1.2 + 0.01);
  });
});

describe('instanced loot', () => {
  const setup = setupFor(map('rimedOssuary', 5));
  const alice = bareCharacter({ id: 'alice', name: 'Alice' });
  const bob = bareCharacter({ id: 'bob', name: 'Bob', equipment: { amulet: luckyAmulet(30, 15) } });

  /** The server's chest hook: one loot rng, players in join order, each tagged with their owner id. */
  function chestFor(seed: number) {
    const rng = createRng(seed);
    const out = new Map<number, Item[]>();
    for (const [id, ch] of [[1, alice], [2, bob]] as const) out.set(id, rules.rollChestLoot(setup, rng, ch));
    return out;
  }

  it('gives every player present their own chest', () => {
    const chest = chestFor(8);
    for (const items of chest.values()) {
      expect(items.filter((x) => x.kind === 'equipment')).toHaveLength(CHEST_LOOT.equipment);
      const maps = items.filter((x): x is MapItem => x.kind === 'map');
      expect(maps.length).toBeGreaterThanOrEqual(1);
      expect(maps.length).toBeLessThanOrEqual(2);
      expect([5, 6]).toContain(maps[0].tier);
    }
    const uids = [...chest.values()].flat().map((i) => i.uid);
    expect(new Set(uids).size).toBe(uids.length);
    expect(chest.get(1)).not.toEqual(chest.get(2));
    // Deterministic per seed and player order.
    expect(chestFor(8)).toEqual(chest);
  });

  it('tags each player\'s drops with that player as the owner', () => {
    const rng = createRng(12);
    let token = 0;
    const specs = ([[1, alice], [2, bob]] as const).flatMap(([id, ch]) =>
      rules.rollKillLoot(setup, kill({ kind: 'ashboundHerald', isLieutenant: true, wave: 3 }), rng, ch)
        .map((item) => rules.dropSpec(item, ++token, id)));
    const guaranteed = LIEUTENANT_LOOT.equipment + LIEUTENANT_LOOT.currency;
    expect(specs.filter((s) => s.owner === 1).length).toBeGreaterThanOrEqual(guaranteed);
    expect(specs.filter((s) => s.owner === 2).length).toBeGreaterThanOrEqual(guaranteed);
    expect(new Set(specs.map((s) => s.token)).size).toBe(specs.length);
  });

  it('never drops loot for summoned minions or the training dummy (and draws nothing from the rng)', () => {
    const rng = createRng(4);
    const before = rng.state();
    expect(rules.rollKillLoot(setup, kill({ summoned: true }), rng, bob)).toEqual([]);
    expect(rules.rollKillLoot(setup, kill({ summoned: true, rarity: 'rare', kind: 'emberSkitter' }), rng, bob)).toEqual([]);
    expect(rules.rollKillLoot(setup, kill({ kind: 'trainingDummy' }), rng, bob)).toEqual([]);
    expect(rng.state()).toBe(before);
    // A regular kill does draw.
    rules.rollKillLoot(setup, kill(), rng, bob);
    expect(rng.state()).not.toBe(before);
  });
});

describe('uniques drop only where they can be worn (item level ≥ the unique\'s level requirement)', () => {
  /** Every unique id rolled by `kills` boss kills at a luck high enough that the boss's 8%×m roll always hits. */
  function bossUniques(setup: RunSetup, kills = 150, seed = 3): Set<string> {
    const lucky: RunSetup = { ...setup, itemRarity: 2000 };
    const rng = createRng(seed);
    const out = new Set<string>();
    for (let i = 0; i < kills; i++) {
      for (const item of rules.rollKillLoot(lucky, kill({ kind: 'cinderMatriarch', isBoss: true, wave: 6 }), rng, NAKED)) {
        if (item.kind === 'equipment' && item.rarity === 'unique') out.add(item.uniqueId!);
      }
    }
    return out;
  }

  /** World-pool uniques wearable at a tier's item level (= its monster level). */
  const wearableAt = (tier: number) => Object.entries(UNIQUES)
    .filter(([, u]) => !u.bossSource && u.levelRequirement <= monsterLevelForTier(tier))
    .map(([id]) => id).sort();

  it('a tier only rolls the uniques whose level requirement its item level meets', () => {
    for (const tier of [1, 2, 3, 4, 5, 6]) {
      const rolled = [...bossUniques(setupFor(map('ashenForge', tier)))].sort();
      expect(rolled, `Tier ${tier} (item level ${monsterLevelForTier(tier)})`).toEqual(wearableAt(tier));
    }
  });

  it('the lowest tiers have no unique to roll and the top tiers have all four', () => {
    expect(wearableAt(1)).toEqual([]);
    expect(wearableAt(15)).toEqual(wearableAt(6));
    expect(wearableAt(6)).toHaveLength(4);
  });

  it('below every unique\'s level the unique roll becomes a rare (never nothing)', () => {
    const low: RunSetup = { ...setupFor(map('ashenForge', 1)), monsterLevel: 9, itemRarity: 2000 };
    const rng = createRng(9);
    for (let i = 0; i < 100; i++) {
      const eq = rules.rollKillLoot(low, kill({ kind: 'cinderMatriarch', isBoss: true, wave: 6 }), rng, NAKED)
        .filter((x): x is EquipmentItem => x.kind === 'equipment');
      expect(eq.length).toBeGreaterThanOrEqual(2 + BOSS_LOOT.extraEquipment); // the guaranteed rare, the extras and the unique slot
      expect(eq.some((e) => e.rarity === 'unique')).toBe(false);
    }
  });
});
