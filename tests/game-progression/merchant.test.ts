// Rook's stall: offers, prices, affordability, buying and gambling.
import { describe, expect, it } from 'vitest';
import type { CharacterSave, EquipmentItem, MapItem } from '../../src/contracts/items';
import { rules } from '../../src/game';
import { getBase } from '../../src/data/items';
import { currencyOnHand, gambleOdds } from '../../src/game/progression';
import { bareCharacter, currency, expectErr, expectOk, luckyAmulet, withBackpack } from './fixtures';

/** Rook sells maps of cleared areas (and the starting area): these two rows are the ones the tests buy. */
const T1 = 'map:cinderCrossing:1:plain';
const T2 = 'map:emberRoad:2:plain';
const CLEARED = { discovered: ['cinderCrossing', 'emberRoad'], completed: ['cinderCrossing', 'emberRoad'], clears: 2 } as CharacterSave['atlas'];

function rich(scrap = 40, extra: Partial<CharacterSave> = {}): CharacterSave {
  return withBackpack(bareCharacter({ atlas: CLEARED, ...extra }), [[currency('scrap', scrap, 'scrap'), 0, 0]]);
}

describe('offers', () => {
  it('lists flasks, basic currency and gambles (maps are generated per cleared area, see Rook\'s maps)', () => {
    const offers = rules.merchantOffers(rich());
    const ids = offers.map((o) => o.id);
    expect(ids).toEqual(expect.arrayContaining(['flask-life', 'flask-focus', 'currency-kindling', 'currency-mapDust', 'gamble-wand', 'gamble-ring']));
    expect(offers.some((o) => o.kind === 'map')).toBe(false);
    expect(offers.find((o) => o.id === 'flask-life')!.price).toEqual([{ currencyId: 'scrap', count: 1 }]);
    expect(offers.find((o) => o.id === 'currency-kindling')!.price).toEqual([{ currencyId: 'scrap', count: 3 }]);
    const gamble = offers.find((o) => o.id === 'gamble-wand')!;
    expect(gamble).toMatchObject({ kind: 'gamble', item: null, gambleClass: 'wand', price: [{ currencyId: 'scrap', count: 6 }] });
    // Level 1: no wand unique is wearable yet (The Patient Spark needs level 12), so none is on offer.
    expect(gamble.description).toContain('Magic 25% · Rare 6% · Normal 69%');
    const at12 = rules.merchantOffers(rich(40, { level: 12 })).find((o) => o.id === 'gamble-wand')!;
    expect(at12.description).toContain('Magic 25% · Rare 6% · Unique 0.5% · Normal 68.5%');
  });

  it('only offers gambles for classes with a base at the player\'s level', () => {
    const low = rules.merchantOffers(rich()).map((o) => o.id);
    expect(low).not.toContain('gamble-sceptre');
    expect(low).not.toContain('gamble-focus');
    const high = rules.merchantOffers(rich(40, { level: 20 })).map((o) => o.id);
    expect(high).toContain('gamble-sceptre');
    expect(high).toContain('gamble-focus');
  });

  it('marks what the player cannot afford', () => {
    const offers = rules.merchantOffers(rich(2));
    expect(rules.rookMapOffers(rich(2), 'cinderCrossing').find((o) => o.id === T1)!.affordable).toBe(true);
    expect(offers.find((o) => o.id === 'flask-life')!.affordable).toBe(true);
    expect(rules.rookMapOffers(rich(2), 'emberRoad').find((o) => o.id === T2)!.affordable).toBe(false);
  });

  it('counts scrap across the backpack and the stash', () => {
    let ch = rich(3);
    ch = { ...ch, stash: [{ ...ch.stash[0], grid: { ...ch.stash[0].grid, entries: [{ item: currency('scrap', 5, 'stashed'), x: 0, y: 0 }] } }] };
    expect(currencyOnHand(ch, 'scrap')).toBe(8);
    const out = expectOk(rules.buyOffer(ch, 'gamble-ring'));
    expect(currencyOnHand(out.character, 'scrap')).toBe(2);
    expect(rules.findItem(out.character, 'scrap')).toBeNull(); // the backpack stack is spent first
  });
});

describe('buying', () => {
  it('gives a free Tier 1 map', () => {
    const ch = rich(0);
    const out = expectOk(rules.buyOffer({ ...ch, backpack: { ...ch.backpack, entries: [] } }, T1));
    expect(out.item).toMatchObject({ kind: 'map', areaId: 'cinderCrossing', tier: 1, rarity: 'normal', quality: 0, isNew: true });
    expect(out.item.uid).toMatch(/^i/);
    expect(rules.findItem(out.character, out.item.uid)?.location.kind).toBe('backpack');
  });

  it('charges the price', () => {
    const out = expectOk(rules.buyOffer(rich(10), T2));
    expect(currencyOnHand(out.character, 'scrap')).toBe(6);
    expect((out.item as MapItem).tier).toBe(2);
  });

  it('refills matching belt slots with bought flasks', () => {
    const ch = rich(10, { belt: [{ flaskId: 'lifeFlask', count: 2 }, null, null, null] });
    const out = expectOk(rules.buyOffer(ch, 'flask-life'));
    expect(out.character.belt[0]).toEqual({ flaskId: 'lifeFlask', count: 3 });
    expect(currencyOnHand(out.character, 'scrap')).toBe(9);
  });

  it('refuses what the player cannot afford and charges nothing', () => {
    const ch = rich(2);
    expect(expectErr(rules.buyOffer(ch, 'gamble-wand'))).toBe('You need 6 Forge Scrap (you have 2).');
    expect(expectErr(rules.buyOffer(ch, 'nonsense'))).toBe('Rook does not sell that.');
  });

  it('charges nothing when the backpack is full', () => {
    let ch = rich(10);
    for (let x = 0; x < 12; x++) for (let y = 0; y < 5; y++) {
      if (x === 0 && y === 0) continue;
      ch = withBackpack(ch, [[currency('solvent', 1, `s${x}-${y}`), x, y]]);
    }
    expect(expectErr(rules.buyOffer(ch, T2))).toBe('Your backpack is full.');
    expect(expectErr(rules.buyOffer(ch, 'gamble-ring'))).toBe('Your backpack is full.');
  });

  it('pays before placing: the spent stack can free the cell the purchase needs', () => {
    // A full backpack whose only Scrap is a single coin at (0,0): spending it opens that cell.
    let ch = rich(1);
    for (let x = 0; x < 12; x++) for (let y = 0; y < 5; y++) {
      if (x === 0 && y === 0) continue;
      ch = withBackpack(ch, [[currency('solvent', 1, `s${x}-${y}`), x, y]]);
    }
    const bought = expectOk(rules.buyOffer(ch, 'flask-life'));
    expect(currencyOnHand(bought.character, 'scrap')).toBe(0);
    const at00 = bought.character.backpack.entries.find((e) => e.x === 0 && e.y === 0)!;
    expect(at00.item).toMatchObject({ kind: 'flask', flaskId: 'lifeFlask', count: 1 });
    // With a coin to spare the cell stays taken: nothing is paid and the input is untouched.
    const two = { ...ch, backpack: { ...ch.backpack, entries: ch.backpack.entries.map((e) => (e.item.uid === 'scrap' ? { ...e, item: { ...e.item, count: 2 } } : e)) } };
    const before = JSON.stringify(two);
    expect(expectErr(rules.buyOffer(two, 'flask-life'))).toBe('Your backpack is full.');
    expect(JSON.stringify(two)).toBe(before);
  });
});

describe('gambling', () => {
  it('rolls a random item of the chosen class at the player\'s level', () => {
    let ch = rich(40, { level: 25 });
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const out = expectOk(rules.buyOffer(ch, 'gamble-boots'));
      const item = out.item as EquipmentItem;
      expect(getBase(item.baseId).itemClass).toBe('boots');
      expect(item.itemLevel).toBe(25);
      expect(item.history[0]).toBe("Gambled at Rook's stall");
      expect(out.character.rngState).not.toBe(ch.rngState);
      seen.add(item.uid);
      ch = out.character;
    }
    expect(seen.size).toBe(6);
    expect(currencyOnHand(ch, 'scrap')).toBe(4);
  });

  it('scales the odds with gear rarity and only offers uniques where they exist', () => {
    expect(gambleOdds('wand', 1)).toEqual({ normal: 1 - 0.25 - 0.06 - 0.005, magic: 0.25, rare: 0.06, unique: 0.005 });
    expect(gambleOdds('helmet', 1).unique).toBe(0);
    const doubled = gambleOdds('ring', 2);
    expect(doubled.magic).toBeCloseTo(0.5, 10);
    expect(doubled.rare).toBeCloseTo(0.12, 10);
    expect(doubled.unique).toBeCloseTo(0.01, 10);
    const extreme = gambleOdds('ring', 10);
    expect(extreme.magic + extreme.rare + extreme.unique).toBeCloseTo(1, 10);
    expect(extreme.normal).toBe(0);
  });

  it('only offers a unique the player can already wear', () => {
    // The Patient Spark (wand) needs level 10, Ruinheart Band (ring) level 24.
    expect(gambleOdds('wand', 1, 9).unique).toBe(0);
    expect(gambleOdds('wand', 1, 10).unique).toBeCloseTo(0.005, 10);
    expect(gambleOdds('ring', 1, 23).unique).toBe(0);
    expect(gambleOdds('ring', 1, 24).unique).toBeCloseTo(0.005, 10);
    // Huge gear rarity saturates the odds (unique = 0.5 / 31.5 ≈ 1.6% of gambles), yet a level 23 ring
    // gamble never yields the level 24 unique.
    const lucky = (level: number) => rich(40, { level, equipment: { amulet: luckyAmulet(3000) } });
    const rarities = (level: number) => Array.from({ length: 800 }, (_, i) =>
      (expectOk(rules.buyOffer({ ...lucky(level), rngState: 77 + i * 104729 }, 'gamble-ring')).item as EquipmentItem));
    expect(rarities(23).some((e) => e.rarity === 'unique')).toBe(false);
    const at24 = rarities(24).filter((e) => e.rarity === 'unique');
    expect(at24.length).toBeGreaterThan(0);
    expect(at24.every((e) => e.uniqueId === 'ruinheartBand')).toBe(true);
  });

  it('produces the advertised rarity mix', () => {
    let magic = 0;
    let rare = 0;
    const n = 1500;
    const ch = rich(40, { level: 30 });
    for (let i = 0; i < n; i++) {
      const out = expectOk(rules.buyOffer({ ...ch, rngState: 1000 + i * 7919 }, 'gamble-helmet'));
      const r = (out.item as EquipmentItem).rarity;
      if (r === 'magic') magic++;
      if (r === 'rare') rare++;
    }
    expect(magic / n).toBeGreaterThan(0.2);
    expect(magic / n).toBeLessThan(0.3);
    expect(rare / n).toBeGreaterThan(0.035);
    expect(rare / n).toBeLessThan(0.085);
  });
});

describe('placing a purchase where it was dropped', () => {
  const empty = (): CharacterSave => ({ ...rich(40), backpack: { ...rich(40).backpack, entries: [] } });

  it('puts a purchase on the drop cell when its whole footprint is free there', () => {
    const out = expectOk(rules.buyOffer(empty(), T1, { x: 7, y: 3 }));
    expect(rules.findItem(out.character, out.item.uid)?.location).toMatchObject({ kind: 'backpack', x: 7, y: 3 });
  });

  it('falls back to first-fit when the cell is taken, out of range or malformed, and never loses the purchase', () => {
    const ch = withBackpack(empty(), [[currency('kindling', 1, 'blocker'), 7, 3]]);
    for (const at of [{ x: 7, y: 3 }, { x: 99, y: 0 }, { x: -1, y: 2 }, { x: 1.5, y: 2 }]) {
      const out = expectOk(rules.buyOffer(ch, T1, at as { x: number; y: number }));
      expect(rules.findItem(out.character, out.item.uid)?.location).toMatchObject({ kind: 'backpack', x: 0, y: 0 });
    }
  });

  it('pays once and keeps the price rules when dropped: an unaffordable offer still fails', () => {
    expect(expectErr(rules.buyOffer(empty(), 'gamble-wand', { x: 0, y: 0 })).length).toBeGreaterThan(0);
    const poor = withBackpack(empty(), [[currency('scrap', 2, 'scrap'), 0, 0]]);
    expect(expectErr(rules.buyOffer(poor, 'gamble-wand', { x: 5, y: 2 }))).toBe('You need 6 Forge Scrap (you have 2).');
    const out = expectOk(rules.buyOffer(rich(10), T2, { x: 9, y: 4 }));
    expect(currencyOnHand(out.character, 'scrap')).toBe(6);
    expect(rules.findItem(out.character, out.item.uid)?.location).toMatchObject({ x: 9, y: 4 });
  });
});
