// Power rework slice P2, rules side: Umbral Essence sources, utility flask drops and staples, the kill charge, and old saves.
import { describe, expect, it } from 'vitest';
import type { EquipmentItem } from '../../src/contracts/items';
import { createRng } from '../../src/core/rng';
import { rules } from '../../src/game';
import { AFFIX_VERSION, BELT_SLOT_CAPACITY, getAffix } from '../../src/data/items';
import { CURRENCY_DROPS, FLASK_DROPS, MERCHANT_STOCK, UMBRAL_ESSENCE } from '../../src/data/progression';
import {
  FLASK_KILLS_PER_CHARGE, FLASK_KILLS_PER_CHARGE_MIN, killCharge, killsPerCharge, refillBelt,
} from '../../src/game/progression/flasks';
import { bareCharacter, equip, eventCtx, expectOk, kill, map, setupFor } from './fixtures';

const umbral = (items: readonly { kind: string; currencyId?: string }[]) => items.filter((i) => i.kind === 'currency' && i.currencyId === 'umbralEssence').length;

describe('Umbral Essence sources', () => {
  it('is not in the ordinary currency table (it never moves the existing drop streams)', () => {
    expect(CURRENCY_DROPS.some((d) => d.currencyId === 'umbralEssence')).toBe(false);
  });

  it('is paid by Void Breach: never at Bronze, sometimes at Silver, always at Gold', () => {
    const setup = setupFor(map('ashenForge', 8));
    let silver = 0;
    for (let seed = 0; seed < 600; seed++) {
      expect(umbral(rules.rollEventReward(setup, eventCtx('voidBreach', 1), createRng(seed), bareCharacter()))).toBe(0);
      expect(umbral(rules.rollEventReward(setup, eventCtx('voidBreach', 0), createRng(seed), bareCharacter()))).toBe(0);
      silver += umbral(rules.rollEventReward(setup, eventCtx('voidBreach', 2), createRng(seed), bareCharacter()));
      expect(umbral(rules.rollEventReward(setup, eventCtx('voidBreach', 3), createRng(seed), bareCharacter()))).toBe(UMBRAL_ESSENCE.breachGoldCount);
    }
    expect(silver / 600).toBeGreaterThan(UMBRAL_ESSENCE.breachSilverChance - 0.07);
    expect(silver / 600).toBeLessThan(UMBRAL_ESSENCE.breachSilverChance + 0.07);
  });

  it('does not change the rest of a Void Breach payout (own rng stream)', () => {
    const setup = setupFor(map('ashenForge', 8));
    for (let seed = 0; seed < 50; seed++) {
      const strip = (items: readonly { kind: string; currencyId?: string }[]) => JSON.stringify(items.filter((i) => !(i.kind === 'currency' && i.currencyId === 'umbralEssence')).map((i) => ({ ...i, uid: 0 })));
      const gold = rules.rollEventReward(setup, eventCtx('voidBreach', 3), createRng(seed), bareCharacter());
      const again = rules.rollEventReward(setup, eventCtx('voidBreach', 3), createRng(seed), bareCharacter());
      expect(strip(gold)).toBe(strip(again));
    }
  });

  it('drops from final bosses on Tier 8 and above only', () => {
    const low = setupFor(map('ashenForge', UMBRAL_ESSENCE.bossMinTier - 1));
    const high = setupFor(map('ashenForge', UMBRAL_ESSENCE.bossMinTier));
    const boss = kill({ kind: 'cinderMatriarch', isBoss: true, wave: 6 });
    const looter = bareCharacter();
    let got = 0;
    const N = 600;
    for (let seed = 0; seed < N; seed++) {
      expect(umbral(rules.rollKillLoot(low, boss, createRng(seed), looter))).toBe(0);
      got += umbral(rules.rollKillLoot(high, boss, createRng(seed), looter));
      // A normal monster never drops it.
      expect(umbral(rules.rollKillLoot(high, kill(), createRng(seed), looter))).toBe(0);
    }
    expect(got / N).toBeGreaterThan(0.1);
    // 30% times the looter's personal rarity (a Tier 8 map is above 100%): well under certain.
    expect(got / N).toBeLessThan(0.6);
  });
});

describe('flasks as drops and staples', () => {
  it('drop the three utility flasks beside the two recovery flasks', () => {
    expect(FLASK_DROPS.map((d) => d.flaskId)).toEqual(['lifeFlask', 'focusFlask', 'quickstep', 'aegis', 'quicksilverMind']);
    expect(FLASK_DROPS.slice(0, 2).map((d) => d.weight)).toEqual([60, 40]);
    const seen = new Set<string>();
    const setup = setupFor(map('ashenForge', 3));
    for (let seed = 0; seed < 3000 && seen.size < 5; seed++) {
      for (const i of rules.rollKillLoot(setup, kill({ rarity: 'rare' }), createRng(seed), bareCharacter())) if (i.kind === 'flask') seen.add(i.flaskId);
    }
    expect([...seen].sort()).toEqual(['aegis', 'focusFlask', 'lifeFlask', 'quickstep', 'quicksilverMind'].sort());
  });

  it('are sold by Rook as 3 Scrap staples', () => {
    for (const [id, flaskId] of [['flask-quickstep', 'quickstep'], ['flask-aegis', 'aegis'], ['flask-quicksilver', 'quicksilverMind']] as const) {
      const row = MERCHANT_STOCK.find((s) => s.id === id)!;
      expect(row).toMatchObject({ kind: 'flask', flaskId, price: [{ currencyId: 'scrap', count: 3 }] });
    }
    expect(MERCHANT_STOCK.find((s) => s.id === 'flask-life')!.price).toEqual([{ currencyId: 'scrap', count: 1 }]);
  });
});

describe('flask kill charge (power-curve 10.3)', () => {
  const withBelt = (counts: (number | null)[]) => bareCharacter({
    belt: counts.map((c, k) => (c === null ? null : { flaskId: k % 2 ? 'focusFlask' : 'lifeFlask', count: c })) as never,
  });

  it('gives each assigned belt slot a charge every 40th kill, and never beyond capacity', () => {
    expect(FLASK_KILLS_PER_CHARGE).toBe(40);
    let ch = withBelt([1, 4, null, BELT_SLOT_CAPACITY]);
    expect(killsPerCharge(ch)).toBe(40);
    for (const k of [1, 39, 41, 79]) expect(killCharge(ch, k), `kill ${k}`).toBeNull();
    const r = killCharge(ch, 40)!;
    expect(r.charges).toBe(2);
    expect(r.character.belt.map((s) => s?.count ?? null)).toEqual([2, 5, null, 5]);
    ch = r.character;
    expect(killCharge(ch, 80)!.charges).toBe(1);
    expect(killCharge(ch, 80)!.character.belt.map((s) => s?.count ?? null)).toEqual([3, 5, null, 5]);
    expect(killCharge(withBelt([5, 5, 5, 5]), 40)).toBeNull();
    expect(killCharge(withBelt([null, null, null, null]), 40)).toBeNull();
    expect(killCharge(ch, 0)).toBeNull();
    expect(killCharge(ch, 40.5)).toBeNull();
  });

  it('is shortened by the belt affix "of Reserves" (a charge 15 kills sooner at T1: every 25 kills), never below 10', () => {
    const belt = (value: number): EquipmentItem => {
      const b = equip({ baseId: 'chainBelt', itemLevel: 80, rarity: 'magic', uid: 'b', affixes: [{ affixId: 'flaskChargeOnKill', tier: 1, value: 15 }] });
      return { ...b, affixes: [{ ...b.affixes[0], value }] }; // an out-of-range roll still clamps at the floor
    };
    expect(getAffix('flaskChargeOnKill')!.tiers[0]).toMatchObject({ min: 15, max: 15, itemLevel: 78 });
    const ch = { ...withBelt([0, 0, 0, 0]), equipment: { belt: belt(15) } };
    expect(killsPerCharge(ch)).toBe(25);
    expect(killCharge(ch, 25)!.charges).toBe(4);
    expect(killCharge(ch, 40)).toBeNull();
    expect(killsPerCharge({ ...ch, equipment: { belt: belt(99) } })).toBe(FLASK_KILLS_PER_CHARGE_MIN);
  });

  it('keeps the hideout refill working', () => {
    expect(refillBelt(withBelt([0, 1, null, 5]))!.charges).toBe(5 + 4);
  });
});

describe('old saves keep loading (AFFIX_VERSION stays 2)', () => {
  it('round-trips a character with items rolled before the rework, without migrating any affix', () => {
    expect(AFFIX_VERSION).toBe(2);
    let ch = rules.createCharacter('Vessa', 9);
    const kindling = ch.backpack.entries.find((e) => e.item.kind === 'currency' && e.item.currencyId === 'kindling')!.item;
    ch = expectOk(rules.applyCurrency(ch, kindling.uid, ch.equipment.chest!.uid)).character;
    // An item exactly as an older build stored it: version 2, old affix ids, no flaskCharge/pen anywhere.
    const old = equip({ baseId: 'ashwoodWand', itemLevel: 60, rarity: 'rare', name: 'Old Brand', uid: 'old1',
      affixes: [{ affixId: 'fireDamage', tier: 6, value: 25 }, { affixId: 'castSpeed', tier: 4, value: 12 }, { affixId: 'critChance', tier: 3, value: 42 }] });
    expect(old.affixVersion).toBe(2);
    ch = { ...ch, equipment: { ...ch.equipment, mainHand: old } };
    const save = rules.parseSave(rules.serializeSave({ ...rules.parseSave(null), characters: [ch], lastCharacterId: ch.id }));
    const back = save.characters[0].equipment.mainHand!;
    expect(back.affixes.map((a) => [a.affixId, a.tier, a.value])).toEqual(old.affixes.map((a) => [a.affixId, a.tier, a.value]));
    expect(back.affixVersion).toBe(2);
    expect(save.characters[0].equipment.chest!.affixes).toEqual(ch.equipment.chest!.affixes);
    expect(save.characters[0].belt.map((s) => s?.flaskId)).toEqual(ch.belt.map((s) => s?.flaskId));
  });

  it('loads a belt holding a new utility flask and drops an unknown flask id back to a Life flask', () => {
    let ch = rules.createCharacter('Vessa', 9);
    ch = { ...ch, belt: [{ flaskId: 'quickstep', count: 3 }, { flaskId: 'aegis', count: 2 }, { flaskId: 'quicksilverMind', count: 5 }, null] };
    const back = rules.parseSave(rules.serializeSave({ ...rules.parseSave(null), characters: [ch], lastCharacterId: ch.id })).characters[0];
    expect(back.belt.map((s) => s && [s.flaskId, s.count])).toEqual([['quickstep', 3], ['aegis', 2], ['quicksilverMind', 5], null]);
  });
});
