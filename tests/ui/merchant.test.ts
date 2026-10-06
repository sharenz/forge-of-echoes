// Merchant drag-and-drop helpers: the purchase fit check agrees with the server's placement rule.
import { describe, expect, it } from 'vitest';
import type { MerchantBoard, MerchantOffer, MerchantWare, WareQuality } from '../../src/contracts/game';
import type { CurrencyStack, GridContainer, Item } from '../../src/contracts/items';
import { rules } from '../../src/game';
import { createGrid, placeItem } from '../../src/game/items';
import { addBoughtItem } from '../../src/game/progression/merchant';
import { bareCharacter, currency, expectOk } from '../game-progression/fixtures';
import {
  dropCell, gamblePreview, luckiest, newWaresText, rerollBlocked, revealFor, roomAnywhere, rotationMsLeft, stockFit, unaffordableReason, wareBlocked, packVendor, priceLine, vendorTabOf, VENDOR_COLS,
  VENDOR_MIN_ROWS, VENDOR_PRICED_MIN_ROWS, WARES_EXPLAINER, shelfEmptyText,
} from '../../src/ui/lib/merchant';

const flask = (count = 1): Item => ({ kind: 'flask', uid: 'f', flaskId: 'lifeFlask', count } as Item);
const map = (): Item => expectOk(rules.buyOffer(bareCharacter(), 'map:cinderCrossing:1:plain')).item;
const gridWith = (...entries: [Item, number, number][]): GridContainer => entries.reduce<GridContainer>((g, [item, x, y]) => placeItem(g, item, x, y)!, createGrid(12, 5));
const full = (): GridContainer => {
  let g = createGrid(12, 5);
  for (let y = 0; y < 5; y++) for (let x = 0; x < 12; x++) g = placeItem(g, currency('kindling', 1, `k${x}_${y}`), x, y)!;
  return g;
};

describe('stockFit', () => {
  const m = map();
  it('accepts a free footprint and refuses an occupied one with a clear reason', () => {
    const { w, h } = rules.itemSize(m);
    expect(stockFit(createGrid(12, 5), m, { x: 3, y: 1 })).toEqual({ ok: true, reason: null, merge: false });
    const blocked = gridWith([currency('kindling', 1, 'k'), 3 + w - 1, 1 + h - 1]);
    const fit = stockFit(blocked, m, { x: 3, y: 1 });
    expect(fit.ok).toBe(false);
    expect(fit.reason).toMatch(/No room there/);
  });

  it('reports a full backpack as "no room" wherever you drop', () => {
    const fit = stockFit(full(), m, { x: 0, y: 0 });
    expect(fit).toMatchObject({ ok: false, reason: 'Your backpack has no room for this.' });
  });

  it('lets a stack land on a same-kind stack with room, but not on a full or different one', () => {
    const k = (n: number, uid = 'k'): CurrencyStack => currency('kindling', n, uid);
    const bought = k(3, 'new');
    expect(stockFit(gridWith([k(5), 2, 2]), bought, { x: 2, y: 2 })).toMatchObject({ ok: true, merge: true });
    expect(stockFit(gridWith([k(5), 2, 2]), bought, { x: 4, y: 2 })).toMatchObject({ ok: true, merge: false });
    expect(stockFit(gridWith([currency('mapDust', 1, 'd'), 2, 2]), bought, { x: 2, y: 2 }).ok).toBe(false);
  });

  it('checks a whole bulk purchase, not just the first unit', () => {
    const nearlyFull = () => { let g = full(); for (const x of [0, 1]) g = { ...g, entries: g.entries.filter((e) => !(e.x === x && e.y === 0)) }; return g; };
    const wand = expectOk(rules.buyDebugOffer(bareCharacter(), 'base:ashwoodWand', { quantity: 1, itemLevel: 10, mapTier: 1, rarity: 'normal' })).character.backpack.entries[0].item;
    const { w, h } = rules.itemSize(wand);
    expect(roomAnywhere(nearlyFull(), currency('kindling', 1, 'x'), 1)).toBe(true);
    expect(roomAnywhere(createGrid(12, 5), wand, 100)).toBe(false);
    expect(roomAnywhere(createGrid(12, 5), wand, Math.floor(30 / (w * h)))).toBe(true);
  });

  it('agrees with the server: a fit at the cell is delivered to exactly that cell', () => {
    const ch = { ...bareCharacter(), backpack: createGrid(12, 5) };
    const item = flask(1);
    expect(stockFit(ch.backpack, item, { x: 4, y: 3 }).ok).toBe(true);
    const placed = expectOk(addBoughtItem(ch, item, dropCell({ x: 4, y: 3 })));
    expect(placed.backpack.entries.find((e) => e.item.kind === 'flask')).toMatchObject({ x: 4, y: 3 });
  });
});

describe('affordability and gamble previews', () => {
  const offer = (over: Partial<MerchantOffer> = {}): MerchantOffer => ({
    id: 'gamble-wand', kind: 'gamble', label: 'Gamble: Wand', description: '', item: null, gambleClass: 'wand',
    price: [{ currencyId: 'scrap', count: 6 }], affordable: false, ...over,
  });
  const names = () => 'Forge Scrap';

  it('names the missing price and what you hold', () => {
    expect(unaffordableReason(offer(), names, () => 2)).toBe("Can't afford: needs 6 Forge Scrap (you have 2).");
    expect(unaffordableReason(offer({ affordable: true }), names, () => 99)).toBeNull();
  });

  it('reserves room for the largest base of the gambled class', () => {
    const bases = rules.content.bases;
    const p = gamblePreview(offer({ gambleClass: 'chest', id: 'gamble-chest' }), bases, 30)!;
    const largest = Math.max(...Object.values(bases).filter((b) => b.itemClass === 'chest').map((b) => b.size.w * b.size.h));
    const size = rules.itemSize(p);
    expect(size.w * size.h).toBe(largest);
    expect(p.uid).toBe('offer:gamble-chest');
    expect(gamblePreview(offer({ gambleClass: undefined }), bases, 30)).toBeNull();
  });
});

describe('vendor tabs', () => {
  it('shelves items by class: gear, maps and scarabs, then supplies', () => {
    expect(vendorTabOf(map())).toBe('maps');
    expect(vendorTabOf(flask())).toBe('supplies');
    expect(vendorTabOf(currency('kindling', 2, 'k'))).toBe('supplies');
    expect(vendorTabOf(currency('mapDust', 1, 'd'))).toBe('supplies');
    expect(vendorTabOf(currency('transmute', 1, 't'))).toBe('supplies');
    expect(vendorTabOf({ kind: 'equipment', uid: 'e', baseId: 'ashwoodWand', itemLevel: 1, rarity: 'normal', name: null, implicitValues: [], affixes: [], scars: [], stability: 0, maxStability: 0, history: [] } as Item)).toBe('gear');
  });
});

describe('packVendor', () => {
  it('places slots first-fit in order, row by row, at their own sizes', () => {
    const { placements } = packVendor([{ key: 'a', w: 2, h: 3 }, { key: 'b', w: 1, h: 1 }, { key: 'c', w: 2, h: 2 }, { key: 'd', w: 11, h: 1 }]);
    expect(placements).toEqual([{ key: 'a', x: 0, y: 0 }, { key: 'b', x: 2, y: 0 }, { key: 'c', x: 3, y: 0 }, { key: 'd', x: 0, y: 3 }]);
  });
  it('is deterministic and keeps earlier slots where they are when later ones change', () => {
    const slots = [{ key: 'a', w: 2, h: 2 }, { key: 'b', w: 2, h: 4 }, { key: 'c', w: 1, h: 1 }];
    expect(packVendor(slots)).toEqual(packVendor(slots));
    expect(packVendor(slots.slice(0, 2)).placements).toEqual(packVendor(slots).placements.slice(0, 2));
  });
  it('wraps to the next row, fills gaps and grows past the minimum height', () => {
    const wide = packVendor([{ key: 'a', w: 8, h: 1 }, { key: 'b', w: 8, h: 1 }, { key: 'c', w: 4, h: 1 }]);
    expect(wide.placements.map((p) => [p.x, p.y])).toEqual([[0, 0], [0, 1], [8, 0]]);
    const tall = packVendor(Array.from({ length: 4 }, (_, i) => ({ key: `t${i}`, w: VENDOR_COLS, h: 3 })));
    expect(tall.rows).toBe(12);
    expect(packVendor([]).rows).toBe(8);
  });
  it('never overlaps and skips what is wider than the grid', () => {
    const slots = Array.from({ length: 20 }, (_, i) => ({ key: `s${i}`, w: 1 + (i % 3), h: 1 + (i % 4) }));
    const { placements } = packVendor([...slots, { key: 'huge', w: 13, h: 1 }]);
    expect(placements.find((p) => p.key === 'huge')).toBeUndefined();
    const taken = new Set<string>();
    for (const p of placements) {
      const s = slots.find((x) => x.key === p.key)!;
      expect(p.x + s.w).toBeLessThanOrEqual(VENDOR_COLS);
      for (let y = p.y; y < p.y + s.h; y++) for (let x = p.x; x < p.x + s.w; x++) { expect(taken.has(`${x},${y}`)).toBe(false); taken.add(`${x},${y}`); }
    }
  });
});

describe('tooltip price line', () => {
  const name = (id: string): string => (id === 'scrap' ? 'Forge Scrap' : id);
  it('reads "Price: N Scrap" and turns red when it cannot be paid', () => {
    expect(priceLine([{ currencyId: 'scrap', count: 12 }], name, true)).toEqual({ text: 'Price: 12 Scrap', poor: false });
    expect(priceLine([{ currencyId: 'scrap', count: 12 }], name, false)).toEqual({ text: 'Price: 12 Scrap', poor: true });
    expect(priceLine([], name, true).text).toBe('Price: free');
  });
});

describe("Rook's wares board helpers", () => {
  const ware = (slot: number, quality: WareQuality, over: Partial<MerchantWare> = {}): MerchantWare => ({
    id: `ware:1.1.0:${slot}`, slot, kind: slot < 4 ? 'map' : 'item', item: flask(), quality, featured: slot === 4, guaranteed: slot === 0,
    price: [{ currencyId: 'scrap', count: 5 }], sold: false, ...over,
  });
  const board = (wares: MerchantWare[], over: Partial<MerchantBoard> = {}): MerchantBoard => ({
    epoch: '1.1.0', rotation: 1, level: 1, rerolls: 0, wares, nextRotationAt: 10_000_000, serverNow: 4_000_000, rerollCost: 3, ...over,
  });

  it('says why a ware cannot be bought: sold, or the Scrap it still needs', () => {
    expect(wareBlocked(ware(5, 'junk'), 5)).toBeNull();
    expect(wareBlocked(ware(5, 'junk'), 4)).toBe("Can't afford: needs 5 Forge Scrap (you have 4).");
    expect(wareBlocked(ware(5, 'junk', { sold: true }), 99)).toBe('Sold.');
  });

  it('finds the luckiest unsold ware and plays the reveal once per epoch only', () => {
    const quiet = board([ware(0, 'junk'), ware(5, 'okay')]);
    expect(luckiest(quiet)).toBeNull();
    const good = board([ware(0, 'junk'), ware(5, 'good')]);
    expect(luckiest(good)).toBe('good');
    const jackpot = board([ware(5, 'good'), ware(6, 'jackpot')]);
    expect(luckiest(jackpot)).toBe('jackpot');
    expect(luckiest(board([ware(6, 'jackpot', { sold: true }), ware(5, 'good')]))).toBe('good');
    expect(revealFor(null, jackpot)).toBe('jackpot');
    expect(revealFor('0.1.0', good)).toBe('good');
    expect(revealFor(jackpot.epoch, jackpot)).toBeNull();
    expect(revealFor(null, quiet)).toBeNull();
  });

  it('counts the rotation down from the server time the board was built at', () => {
    const b = board([]);
    expect(rotationMsLeft(b, 1000, 1000)).toBe(6_000_000);
    expect(rotationMsLeft(b, 1000, 61_000)).toBe(5_940_000);
    expect(rotationMsLeft(b, 1000, 1e12)).toBe(0);
    expect(newWaresText(2 * 3_600_000 + 14 * 60_000)).toBe('New wares in 2 h 14 m');
    expect(newWaresText(42 * 60_000)).toBe('New wares in 42 m');
    expect(newWaresText(0)).toBe('New wares in under a minute');
  });

  it('words the reroll refusal', () => {
    expect(rerollBlocked({ rerollCost: 6 }, 6)).toBeNull();
    expect(rerollBlocked({ rerollCost: 6 }, 2)).toBe("Can't afford: needs 6 Forge Scrap (you have 2).");
  });
});

describe("Rook's prices and empty shelves (F-17)", () => {
  const twoHours = 2 * 3600_000;
  it('says nothing while something on the shelf is for sale', () => {
    expect(shelfEmptyText('gear', { total: 3, unsold: 1 }, twoHours)).toBeNull();
    expect(shelfEmptyText('supplies', { total: 4, unsold: 4 }, twoHours)).toBeNull();
  });
  it('has its own empty state per tab, with when the board changes', () => {
    const gear = shelfEmptyText('gear', { total: 0, unsold: 0 }, twoHours)!;
    const maps = shelfEmptyText('maps', { total: 0, unsold: 0 }, twoHours)!;
    const supplies = shelfEmptyText('supplies', { total: 0, unsold: 0 }, twoHours)!;
    expect(gear).toMatch(/^No gear/);
    expect(maps).toMatch(/^No maps or scarabs/);
    expect(supplies).toMatch(/supplies/);
    expect(new Set([gear, maps, supplies]).size).toBe(3);
    expect(gear).toContain(newWaresText(twoHours));
    expect(gear).toMatch(/ask for new wares/);
  });
  it('says "sold out" once everything on a shelf is bought', () => {
    expect(shelfEmptyText('maps', { total: 4, unsold: 0 }, twoHours)).toMatch(/^Sold out\. New wares in/);
  });
  it('explains the prices in one short line, and the priced grid stays about as tall as the stash', () => {
    expect(WARES_EXPLAINER).toMatch(/Forge Scrap/);
    expect(WARES_EXPLAINER.length).toBeLessThanOrEqual(80);
    expect(VENDOR_PRICED_MIN_ROWS).toBeLessThan(VENDOR_MIN_ROWS);
    // 5 rows of (36 px cell + 20 px price line) against 8 plain rows of 36 px
    expect(Math.abs(VENDOR_PRICED_MIN_ROWS * (36 + 20) - VENDOR_MIN_ROWS * 36)).toBeLessThanOrEqual(36);
  });
});
