// Merchant drag-and-drop helpers: the purchase fit check agrees with the server's placement rule.
import { describe, expect, it } from 'vitest';
import type { MerchantOffer } from '../../src/contracts/game';
import type { CurrencyStack, GridContainer, Item } from '../../src/contracts/items';
import { rules } from '../../src/game';
import { createGrid, placeItem } from '../../src/game/items';
import { addBoughtItem } from '../../src/game/progression/merchant';
import { bareCharacter, currency, expectOk } from '../game-progression/fixtures';
import { dropCell, gamblePreview, roomAnywhere, stockFit, unaffordableReason } from '../../src/ui/lib/merchant';
import { splitAppraisalLine } from '../../src/ui/panels/MerchantSell';

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

describe('appraisal lines', () => {
  it('splits a line into label and amount for the two-column breakdown', () => {
    expect(splitAppraisalLine('Base · Ashwood Wand: 0.51 Scrap')).toEqual({ label: 'Base · Ashwood Wand', amount: '0.51 Scrap' });
    expect(splitAppraisalLine('Total: 2.75 Scrap → 3 Forge Scrap (rounded up)')).toEqual({ label: 'Total', amount: '2.75 Scrap → 3 Forge Scrap (rounded up)' });
    expect(splitAppraisalLine('No amount')).toEqual({ label: 'No amount', amount: '' });
  });
});
