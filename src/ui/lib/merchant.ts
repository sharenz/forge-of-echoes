// Merchant drag-and-drop helpers (Rook's stall and the Testing Merchant). Pure; covered by tests/ui/merchant.test.ts.
// Buying works like Path of Exile's vendor: drag a stock row onto the backpack grid. The drop cell picks where the
// purchase lands (the server honours it when the whole footprint is free there, otherwise it places first-fit), so the
// preview here has to agree with that rule: a free footprint at the cell, or a stack of the same kind with room.
import type { BaseId, ItemClass } from '../../contracts/content';
import type { MerchantOffer } from '../../contracts/game';
import type { EquipmentItem, GridContainer, Item } from '../../contracts/items';
import type { CurrencyId } from '../../contracts/content';
import { autoPlace, canPlace, canStack, itemSize, maxStackSize, overlappingEntries } from '../../game/items';
import type { Cell, Size } from './grid';

export interface StockFit {
  ok: boolean;
  /** Why the purchase cannot go there (null when it fits). */
  reason: string | null;
  /** The drop cell holds a stack the purchase tops up instead of taking a free cell. */
  merge: boolean;
}

/**
 * Room anywhere in the grid for a whole purchase of `total` units of `item`, stacking where possible (the server's
 * first-fit, all or nothing). Stackables arrive in stack-sized chunks; equipment and maps one per unit.
 */
export function roomAnywhere(grid: GridContainer, item: Item, total = 1): boolean {
  const stack = item.kind === 'currency' || item.kind === 'flask';
  const max = maxStackSize(item);
  let g: GridContainer | null = grid;
  let left = Math.max(1, total);
  while (left > 0 && g) {
    const n = stack ? Math.min(left, max) : 1;
    g = autoPlace(g, stack ? { ...item, count: n } : item);
    left -= n;
  }
  return !!g;
}

/**
 * Can `item` (`total` units for a bulk purchase) be bought onto `origin`? A free footprint there is a fit; otherwise
 * a single same-kind stack with room merges; anything else is "no room there", or "backpack full" when it fits nowhere.
 */
export function stockFit(grid: GridContainer, item: Item, origin: Cell, total = 1): StockFit {
  if (!roomAnywhere(grid, item, total)) return { ok: false, reason: 'Your backpack has no room for this.', merge: false };
  if (canPlace(grid, item, origin.x, origin.y)) return { ok: true, reason: null, merge: false };
  const size = itemSize(item);
  const under = overlappingEntries(grid, origin.x, origin.y, size.w, size.h);
  if (under.length === 1 && canStack(under[0].item, item)) {
    const held = under[0].item;
    const room = held.kind === 'currency' || held.kind === 'flask' ? maxStackSize(held) - held.count : 0;
    const add = item.kind === 'currency' || item.kind === 'flask' ? item.count : 1;
    if (room >= add) return { ok: true, reason: null, merge: true };
  }
  return { ok: false, reason: 'No room there. Drop it on free cells.', merge: false };
}

/** Why a Rook offer cannot be bought right now (null when it can): the missing price, in the server's words. */
export function unaffordableReason(offer: MerchantOffer, currencyName: (id: CurrencyId) => string, onHand: (id: CurrencyId) => number): string | null {
  if (offer.affordable) return null;
  const short = offer.price.find((p) => onHand(p.currencyId) < p.count) ?? offer.price[0];
  if (!short) return 'You cannot afford this.';
  return `Can't afford: needs ${short.count} ${currencyName(short.currencyId)} (you have ${onHand(short.currencyId)}).`;
}

/**
 * The placeholder a gamble drags: a plain item of the class' largest base, so the ghost and the drop preview
 * reserve room for the worst roll (the real item may be smaller and is placed first-fit if the cell cannot hold it).
 */
export function gamblePreview(
  offer: MerchantOffer, bases: Readonly<Record<string, { id: BaseId; itemClass: ItemClass; size: Size }>>, level: number,
): EquipmentItem | null {
  const cls = offer.gambleClass;
  if (!cls) return null;
  const pool = Object.values(bases).filter((b) => b.itemClass === cls);
  if (!pool.length) return null;
  const big = pool.reduce((a, b) => (b.size.w * b.size.h > a.size.w * a.size.h ? b : a));
  return {
    kind: 'equipment', uid: `offer:${offer.id}`, baseId: big.id, itemLevel: level, rarity: 'normal', name: null,
    implicitValues: [], affixes: [], scars: [], stability: 0, maxStability: 0, history: [],
  };
}

/** The drop cell the server receives: the footprint's top-left. */
export function dropCell(origin: Cell | undefined): { x: number; y: number } | undefined {
  return origin ? { x: origin.x, y: origin.y } : undefined;
}
