// Rook's wares board (GAME_SPEC §9), pure rules: deterministic per stock epoch, always a cheap plain map and the staples, the luck model's
// distribution, valid and bindable items, prices, the epoch (6 h rotation at 04:00 UTC, level-ups, rerolls) and buying by ware id.
import { describe, expect, it } from 'vitest';
import type { CharacterSave, MapItem, WaresState } from '../../src/contracts/items';
import { rules } from '../../src/game';
import { withItemLocks } from '../../src/game/online';
import { findBase } from '../../src/data/items';
import { MERCHANT_STOCK, WARES, WARE_QUALITIES } from '../../src/data/progression';
import { atlasTierCeiling, findAtlasArea } from '../../src/data/progression/atlas';
import { currencyOnHand } from '../../src/game/progression';
import { isMapAddress } from '../../src/game/progression/map-binding';
import {
  FEATURED_SLOT, WARE_SLOT_COUNT, boardQualities, epochId, generateWares, parseWareId, rerollCost, wareId, warePrice, waresRotation,
  waresRotationStart, waresStateAt,
} from '../../src/game/progression/wares';
import { bareCharacter, currency, expectErr, expectOk, withBackpack } from './fixtures';

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 1, 12, 0, 0);
const AREAS = ['cinderCrossing', 'emberRoad', 'boneApproach'];
const state = (over: Partial<WaresState> = {}): WaresState => ({ rotation: 100, level: 10, rerolls: 0, sold: [], tier: 2, areas: AREAS, ...over });
const rich = (scrap = 500, extra: Partial<CharacterSave> = {}): CharacterSave => withBackpack(bareCharacter({ level: 10, ...extra }), [[currency('scrap', scrap, 'scrap'), 0, 0]]);

describe('the stock epoch clock', () => {
  it('rotates at 04:00 UTC + n x 6 h', () => {
    const at = (h: number, m = 0) => Date.UTC(2026, 9, 1, h, m, 0);
    expect(waresRotation(at(3, 59))).toBe(waresRotation(at(0)) );
    expect(waresRotation(at(4, 0))).toBe(waresRotation(at(3, 59)) + 1);
    expect(waresRotation(at(9, 59))).toBe(waresRotation(at(4, 0)));
    expect(waresRotation(at(10, 0))).toBe(waresRotation(at(4, 0)) + 1);
    expect(waresRotation(at(16, 0))).toBe(waresRotation(at(10, 0)) + 1);
    expect(waresRotation(at(22, 0))).toBe(waresRotation(at(16, 0)) + 1);
    // 04:00 next day: the forge day turns over and the rotation moves once more (never twice).
    expect(waresRotation(Date.UTC(2026, 9, 2, 4, 0, 0))).toBe(waresRotation(at(22, 0)) + 1);
    const r = waresRotation(at(12));
    expect(waresRotationStart(r)).toBe(at(10));
    expect(waresRotationStart(r + 1)).toBe(at(16));
  });
});

describe('the board is a pure function of the epoch', () => {
  it('is identical for the same character and epoch, and changes with rotation, level, rerolls and character', () => {
    const a = generateWares('c1', state());
    expect(generateWares('c1', state())).toEqual(a);
    expect(a).toHaveLength(WARE_SLOT_COUNT);
    const sig = (id: string, s: WaresState) => JSON.stringify(generateWares(id, s).map((w) => w.item));
    const base = sig('c1', state());
    expect(sig('c1', state({ rotation: 101 }))).not.toBe(base);
    expect(sig('c1', state({ level: 11 }))).not.toBe(base);
    expect(sig('c1', state({ rerolls: 1 }))).not.toBe(base);
    expect(sig('c2', state())).not.toBe(base);
    // sold slots and bookkeeping never change the stock
    expect(sig('c1', state({ sold: [1, 5] }))).toBe(base);
  });

  it('has 4 maps then 8 items, Rook\'s pick first among the items, and ids that carry the epoch', () => {
    const board = generateWares('c1', state());
    expect(board.map((w) => w.kind)).toEqual(['map', 'map', 'map', 'map', ...Array(8).fill('item')]);
    expect(board.filter((w) => w.featured).map((w) => w.slot)).toEqual([FEATURED_SLOT]);
    expect(board[3].item.uid).toBe(wareId(epochId(state()), 3));
    expect(parseWareId(wareId('100.10.0', 7))).toEqual({ epoch: '100.10.0', slot: 7 });
    expect(parseWareId(wareId('-1.10.0', 7))).toEqual({ epoch: '-1.10.0', slot: 7 });
    for (const bad of ['ware:1.2:3', 'map:cinderCrossing:1:plain', 'ware:1.2.3:', 'ware:1.2.3:99999', 'ware:1.2.3:-1', 42, null]) expect(parseWareId(bad)).toBeNull();
  });
});

describe('guarantees: nobody is map-locked, nobody is stranded', () => {
  it('every board has one plain Normal quality-0 map at the current tier of an open area, and the price is 1+ Scrap', () => {
    for (let r = 0; r < 300; r++) {
      for (const tier of [0, 1, 4, 9]) {
        const s = state({ rotation: r, tier });
        const m = generateWares('c1', s)[0];
        const map = m.item as MapItem;
        expect(m.guaranteed).toBe(true);
        expect(map).toMatchObject({ kind: 'map', rarity: 'normal', quality: 0, mods: [] });
        expect(AREAS).toContain(map.areaId);
        expect(map.tier).toBe(Math.min(atlasTierCeiling(findAtlasArea(map.areaId)!), Math.max(1, tier)));
        expect(m.price).toBeGreaterThanOrEqual(1);
      }
    }
    // Tier 1 of the starting area costs a single Scrap.
    const cheap = generateWares('c1', state({ areas: ['cinderCrossing'], tier: 0 }))[0];
    expect(cheap.price).toBe(1);
  });

  it('the staples shelf (flasks, Kindling, Map Dust) is always on offer next to the board', () => {
    const ids = rules.merchantOffers(rich()).map((o) => o.id);
    for (const def of MERCHANT_STOCK) expect(ids).toContain(def.id);
  });

  it('a brand-new character (no atlas, no completions) gets a board of the starting area', () => {
    const fresh = bareCharacter({ atlas: undefined });
    const { board } = rules.waresBoard(fresh, NOW);
    expect(board.wares).toHaveLength(WARE_SLOT_COUNT);
    for (const w of board.wares.filter((x) => x.kind === 'map')) expect((w.item as MapItem).areaId).toBe('cinderCrossing');
  });
});

describe('the luck model', () => {
  const N = 10_000;
  it('luck tiers over 10000 epochs match the odds (items and maps alike), and Rook\'s pick has the doubled odds', () => {
    const plain = { junk: 0, okay: 0, good: 0, jackpot: 0 }, pick = { ...plain };
    let plainN = 0;
    let boardsWithJackpot = 0;
    for (let r = 0; r < N; r++) {
      const q = boardQualities('c1', state({ rotation: r }));
      expect(q[0]).toBe('junk');
      q.forEach((tier, slot) => {
        if (slot === 0) return;
        if (slot === FEATURED_SLOT) pick[tier]++;
        else { plain[tier]++; plainN++; }
      });
      if (q.includes('jackpot')) boardsWithJackpot++;
    }
    for (const tier of WARE_QUALITIES) {
      const p = WARES.odds[tier] / 100;
      const sd = Math.sqrt((p * (1 - p)) / plainN);
      expect(Math.abs(plain[tier] / plainN - p)).toBeLessThan(5 * sd + 1e-4);
      const f = WARES.pickOdds[tier] / 100;
      expect(Math.abs(pick[tier] / N - f)).toBeLessThan(5 * Math.sqrt((f * (1 - f)) / N) + 1e-4);
    }
    // Roughly one board in eight carries a jackpot.
    expect(boardsWithJackpot / N).toBeGreaterThan(0.1);
    expect(boardsWithJackpot / N).toBeLessThan(0.15);
    // Usually only junk: the median board has at most two lucky slots, and a typical one has none above "okay".
    expect(WARES.odds.junk).toBeGreaterThanOrEqual(70);
  });

  it('the luck tiers reported by the generator are the ones the stock is rolled from', () => {
    for (let r = 0; r < 60; r++) {
      const s = state({ rotation: r });
      expect(generateWares('c1', s).map((w) => w.quality)).toEqual(boardQualities('c1', s));
    }
  });

  it('good and jackpot items are worth real Scrap, junk costs little', () => {
    const price = { junk: [] as number[], okay: [] as number[], good: [] as number[], jackpot: [] as number[] };
    for (let r = 0; r < 800; r++) for (const w of generateWares('c1', state({ rotation: r, level: 30 }))) if (w.kind === 'item') price[w.quality].push(w.price);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
    expect(mean(price.junk)).toBeLessThan(mean(price.okay));
    expect(mean(price.okay)).toBeLessThan(mean(price.good));
    expect(mean(price.good)).toBeLessThan(mean(price.jackpot));
    expect(mean(price.jackpot)).toBeGreaterThan(15);
  });
});

describe('the stock is valid', () => {
  it('maps are bound to open, bindable areas within tier limits; items exist and scale with the character level; prices are whole Scrap >= 1', () => {
    const seen = { magic: 0, rare: 0, normal: 0, unique: 0, scarab: 0, currency: 0, quality: 0 };
    for (let r = 0; r < 400; r++) {
      const level = 1 + (r % 40);
      const s = state({ rotation: r, level, tier: r % 7, areas: r % 3 === 0 ? ['cinderCrossing'] : AREAS });
      for (const w of generateWares('char-x', s)) {
        expect(Number.isInteger(w.price) && w.price >= 1).toBe(true);
        expect(w.item.uid).toBe(wareId(epochId(s), w.slot));
        const it = w.item;
        if (it.kind === 'map') {
          const area = findAtlasArea(it.areaId)!;
          expect(s.areas).toContain(it.areaId);
          expect(isMapAddress(area)).toBe(true);
          expect(it.tier).toBeGreaterThanOrEqual(1);
          expect(it.tier).toBeLessThanOrEqual(atlasTierCeiling(area));
          expect(it.quality).toBeGreaterThanOrEqual(0);
          expect(it.quality).toBeLessThanOrEqual(20);
          expect(it.baseId).toBe(area.baseId);
          seen[it.rarity]++;
          if (it.quality > 0) seen.quality++;
        } else if (it.kind === 'equipment') {
          expect(findBase(it.baseId)).toBeTruthy();
          expect(it.itemLevel).toBeGreaterThanOrEqual(Math.max(1, level - 4));
          expect(it.itemLevel).toBeLessThanOrEqual(level + 8);
          seen[it.rarity === 'unique' ? 'unique' : 'normal']++;
        } else if (it.kind === 'currency') {
          expect(it.count).toBeGreaterThanOrEqual(1);
          seen[/Scarab/.test(it.currencyId) ? 'scarab' : 'currency']++;
        }
        // The price is the price of the item as dealt.
        expect(warePrice(it)).toBe(w.price);
      }
    }
    expect(seen.unique).toBeGreaterThan(0);
    expect(seen.scarab).toBeGreaterThan(0);
    expect(seen.currency).toBeGreaterThan(0);
    expect(seen.quality).toBeGreaterThan(0);
    expect(seen.magic + seen.rare).toBeGreaterThan(0);
    expect(seen.normal).toBeGreaterThan(seen.magic + seen.rare);
  });

  it('uniques on the board are wearable with a little slack at most', () => {
    for (let r = 0; r < 600; r++) {
      const s = state({ rotation: r, level: 20 });
      for (const w of generateWares('c1', s)) if (w.item.kind === 'equipment' && w.item.uniqueId) expect(w.quality === 'good' || w.quality === 'jackpot').toBe(true);
    }
  });
});

describe('the character epoch', () => {
  it('starts fresh at the first look, keeps its snapshot while nothing changes, and renews with the rotation or a level-up', () => {
    const ch = rich(50);
    const first = rules.waresBoard(ch, NOW);
    expect(first.character.wares).toMatchObject({ level: 10, rerolls: 0, sold: [], rotation: waresRotation(NOW) });
    const again = rules.waresBoard(first.character, NOW + HOUR);
    expect(again.character).toBe(first.character);
    expect(again.board.epoch).toBe(first.board.epoch);
    expect(again.board.wares.map((w) => w.item)).toEqual(first.board.wares.map((w) => w.item));
    const later = rules.waresBoard(first.character, waresRotationStart(waresRotation(NOW) + 1));
    expect(later.board.epoch).not.toBe(first.board.epoch);
    expect(later.board.rotation).toBe(first.board.rotation + 1);
    const levelled = rules.waresBoard({ ...first.character, level: 11 }, NOW);
    expect(levelled.board.epoch).not.toBe(first.board.epoch);
    expect(levelled.board.level).toBe(11);
    expect(first.board.nextRotationAt).toBe(waresRotationStart(waresRotation(NOW) + 1));
    expect(first.board.serverNow).toBe(NOW);
  });

  it('freezes the inputs: discovering an area or finishing a tier mid-rotation does not move the stock', () => {
    const ch = rich(50, { atlas: { ...bareCharacter().atlas!, discovered: ['cinderCrossing'], completed: [] } });
    const first = rules.waresBoard(ch, NOW);
    const moved = rules.waresBoard({ ...first.character, atlas: { ...ch.atlas!, discovered: ['cinderCrossing', 'emberRoad', 'boneApproach'] }, stats: { ...ch.stats, highestTierCompleted: 6 } }, NOW);
    expect(moved.board.wares.map((w) => w.item)).toEqual(first.board.wares.map((w) => w.item));
  });

  it('never goes back to an old rotation when the clock steps back', () => {
    const first = rules.waresBoard(rich(), NOW);
    const back = waresStateAt(first.character, NOW - 30 * HOUR);
    expect(back).toBe(first.character.wares);
  });
});

describe('buying a ware', () => {
  const view = (ch: CharacterSave, now = NOW) => rules.waresBoard(ch, now);

  it('pays the Scrap, delivers the very item shown with a real uid, marks the slot sold and never sells it twice', () => {
    const ch = view(rich(100)).character;
    const { board } = view(ch);
    const ware = board.wares[5];
    const out = expectOk(rules.buyWare(ch, ware.id, NOW));
    expect(out.item).toMatchObject({ ...ware.item, uid: expect.not.stringContaining('ware:'), isNew: true });
    expect(currencyOnHand(out.character, 'scrap')).toBe(100 - ware.price[0].count);
    expect(out.character.wares!.sold).toEqual([5]);
    expect(rules.findItem(out.character, out.item.uid)).toBeTruthy();
    expect(expectErr(rules.buyWare(out.character, ware.id, NOW))).toMatch(/already sold/);
    expect(view(out.character).board.wares[5].sold).toBe(true);
    expect(view(out.character).board.wares[6].sold).toBe(false);
  });

  it('a purchase from a stale view (rotation, level-up or reroll) is refused and nothing is paid', () => {
    const ch = view(rich(100)).character;
    const id = view(ch).board.wares[0].id;
    expect(expectErr(rules.buyWare(ch, id, waresRotationStart(waresRotation(NOW) + 1)))).toMatch(/new wares/);
    expect(expectErr(rules.buyWare({ ...ch, level: 11 }, id, NOW))).toMatch(/new wares/);
    const rerolled = expectOk(rules.rerollWares(ch, NOW)).character;
    expect(expectErr(rules.buyWare(rerolled, id, NOW))).toMatch(/new wares/);
    for (const bad of ['', 'nonsense', 'ware:9.9.9:1', 'map:cinderCrossing:1:plain', 'ware:1.2.3:99']) expect(rules.buyWare(ch, bad, NOW).ok).toBe(false);
  });

  it('refuses without enough Scrap or room, changing nothing', () => {
    const ch = view(rich(0, {})).character;
    const ware = view(ch).board.wares[0];
    expect(expectErr(rules.buyWare(ch, ware.id, NOW))).toMatch(/You need 1 Forge Scrap \(you have 0\)/);
    const full = view(rich(100)).character;
    const stuffed = { ...full, backpack: { ...full.backpack, entries: full.backpack.entries.slice(0, 1).map((e) => ({ ...e, x: 0, y: 0 })) } };
    // one row of backpack too small for nothing: a 12x5 grid with a single scrap stack has room, so shrink it instead
    const tiny = { ...stuffed, backpack: { ...stuffed.backpack, w: 1, h: 1 } };
    const r = rules.buyWare(tiny, view(tiny).board.wares[0].id, NOW);
    expect(r.ok).toBe(false);
  });

  it('never pays with Scrap held in a trade offer', () => {
    const ch = view(rich(3, {})).character;
    const scrapUid = ch.backpack.entries.find((e) => e.item.kind === 'currency')!.item.uid;
    const locked = withItemLocks(rules, () => new Set([scrapUid]));
    const id = view(ch).board.wares[0].id;
    expect(expectErr(locked.buyWare(ch, id, NOW))).toMatch(/You need/);
    expect(expectOk(withItemLocks(rules, () => new Set()).buyWare(ch, id, NOW)).item.kind).toBe('map');
  });

  it('honours the drop cell like the other purchases', () => {
    const ch = view(rich(100)).character;
    const map = view(ch).board.wares[0];
    const out = expectOk(rules.buyWare(ch, map.id, NOW, { x: 7, y: 3 }));
    expect(out.character.backpack.entries.find((e) => e.item.uid === out.item.uid)).toMatchObject({ x: 7, y: 3 });
  });
});

describe('asking for new wares', () => {
  it('doubles its price within a rotation (3, 6, 12, 24, 48, capped), resets with the rotation and clears the sold slots', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(rerollCost)).toEqual([3, 6, 12, 24, 48, 48, 48]);
    let ch = rules.waresBoard(rich(1000), NOW).character;
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      const board = rules.waresBoard(ch, NOW).board;
      expect(board.rerollCost).toBe(rerollCost(i));
      seen.push(board.epoch);
      const before = currencyOnHand(ch, 'scrap');
      ch = expectOk(rules.rerollWares(ch, NOW, { epoch: board.epoch, cost: board.rerollCost })).character;
      expect(currencyOnHand(ch, 'scrap')).toBe(before - rerollCost(i));
    }
    expect(new Set(seen).size).toBe(6);
    expect(ch.wares!.rerolls).toBe(6);
    const next = rules.waresBoard(ch, waresRotationStart(waresRotation(NOW) + 1));
    expect(next.board.rerollCost).toBe(3);
    expect(next.board.rerolls).toBe(0);
  });

  it('fresh wares come with the salt, sold slots clear, and a level-up keeps the price', () => {
    let ch = rules.waresBoard(rich(1000), NOW).character;
    const bought = expectOk(rules.buyWare(ch, rules.waresBoard(ch, NOW).board.wares[2].id, NOW)).character;
    expect(bought.wares!.sold).toEqual([2]);
    const rerolled = expectOk(rules.rerollWares(bought, NOW)).character;
    expect(rerolled.wares!.sold).toEqual([]);
    expect(rerolled.wares!.rerolls).toBe(1);
    ch = { ...rerolled, level: 11 };
    const after = rules.waresBoard(ch, NOW);
    expect(after.board.rerolls).toBe(1);
    expect(after.board.rerollCost).toBe(6);
    expect(after.character.wares!.sold).toEqual([]);
  });

  it('refuses a stale click (epoch or price changed) and a poor purse, charging nothing', () => {
    const ch = rules.waresBoard(rich(1000), NOW).character;
    const board = rules.waresBoard(ch, NOW).board;
    expect(expectErr(rules.rerollWares(ch, NOW, { epoch: 'x.y.z', cost: 3 }))).toMatch(/new wares/);
    expect(expectErr(rules.rerollWares(ch, NOW, { epoch: board.epoch, cost: 6 }))).toMatch(/new wares/);
    const poor = rules.waresBoard(rich(2), NOW).character;
    expect(expectErr(rules.rerollWares(poor, NOW))).toBe('You need 3 Forge Scrap (you have 2).');
  });
});
