// Merchant drag-and-drop helpers (Rook's stall and the Testing Merchant). Pure; covered by tests/ui/merchant.test.ts.
// Buying works like Path of Exile's vendor: drag a stock row onto the backpack grid. The drop cell picks where the
// purchase lands (the server honours it when the whole footprint is free there, otherwise it places first-fit), so the
// preview here has to agree with that rule: a free footprint at the cell, or a stack of the same kind with room.
import type { BaseId, ItemClass } from '../../contracts/content';
import type { MerchantBoard, MerchantOffer, MerchantWare } from '../../contracts/game';
import type { EquipmentItem, GridContainer, Item } from '../../contracts/items';
import type { CurrencyId } from '../../contracts/content';
import { autoPlace, canPlace, canStack, itemSize, maxStackSize, overlappingEntries } from '../../game/items';
import { resetCountdownText } from '../../game/progression/surge';
import { findScarab } from '../../data/scarabs';
import { findSigil } from '../../data/progression/territory';
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

// ---------------------------------------------------------------------------------------------
// Rook's wares board (panels/MerchantWares.tsx). The board comes from the server; these helpers only read it.
// ---------------------------------------------------------------------------------------------

/** Why a ware cannot be bought right now (null when it can): sold, or the Scrap it needs against what the player has. */
export function wareBlocked(ware: MerchantWare, scrapOnHand: number): string | null {
  if (ware.sold) return 'Sold.';
  const need = ware.price.reduce((n, p) => n + p.count, 0);
  return scrapOnHand >= need ? null : `Can't afford: needs ${need} Forge Scrap (you have ${scrapOnHand}).`;
}

/** The luckiest unsold ware of a board: 'jackpot', 'good' or null (nothing lucky). Guaranteed and junk wares never count. */
export function luckiest(board: MerchantBoard): 'jackpot' | 'good' | null {
  let best: 'jackpot' | 'good' | null = null;
  for (const w of board.wares) {
    if (w.sold) continue;
    if (w.quality === 'jackpot') return 'jackpot';
    if (w.quality === 'good') best = 'good';
  }
  return best;
}

/**
 * The "lucky find" flourish: only at the first view of an epoch (`seen` is the epoch the player looked at last), and only when a good or a jackpot
 * ware is on the board. Null = no flourish.
 */
export function revealFor(seen: string | null, board: MerchantBoard): 'jackpot' | 'good' | null {
  return seen === board.epoch ? null : luckiest(board);
}

/** Milliseconds until the rotation ends, from the board as it arrived (`receivedAt`, `now`: the same monotonic clock). */
export function rotationMsLeft(board: Pick<MerchantBoard, 'nextRotationAt' | 'serverNow'>, receivedAt: number, now: number): number {
  return Math.max(0, board.nextRotationAt - board.serverNow - Math.max(0, now - receivedAt));
}

/** "New wares in 2 h 14 m". */
export function newWaresText(ms: number): string {
  return `New wares in ${resetCountdownText(ms)}`;
}

/** Tooltip footer for a ware: "Price: 12 Scrap" (a Scrap price reads "Scrap", not "Forge Scrap"), red when you cannot pay. */
export function priceLine(
  price: readonly { currencyId: CurrencyId; count: number }[], name: (id: CurrencyId) => string, canPay: boolean,
): { text: string; poor: boolean } {
  const parts = price.map((p) => `${p.count} ${p.currencyId === 'scrap' ? 'Scrap' : name(p.currencyId)}`);
  return { text: parts.length ? `Price: ${parts.join(', ')}` : 'Price: free', poor: !canPay };
}

// ---------------------------------------------------------------------------------------------
// The vendor grid: Rook's stock laid out like an inventory (items/VendorGrid.tsx)
// ---------------------------------------------------------------------------------------------

export type VendorTab = 'gear' | 'maps' | 'supplies';
export const VENDOR_TABS: readonly { id: VendorTab; label: string }[] = [
  { id: 'gear', label: 'Gear' }, { id: 'maps', label: 'Maps' }, { id: 'supplies', label: 'Supplies' },
];
/** Columns of the vendor grid: the same width as the stash and the backpack. */
export const VENDOR_COLS = 12;
/** The vendor grid is never shorter than the stash grid. */
export const VENDOR_MIN_ROWS = 8;

/** Which vendor tab shelves an item, decided by its class alone: equipment, maps, scarabs and sigils, then everything else (flasks, Kindling, Map Dust, currency). */
export function vendorTabOf(item: Item): VendorTab {
  if (item.kind === 'equipment') return 'gear';
  if (item.kind === 'map' || (item.kind === 'currency' && (!!findScarab(item.currencyId) || !!findSigil(item.currencyId)))) return 'maps';
  return 'supplies';
}

export interface VendorSlot { key: string; w: number; h: number }
export interface VendorPlacement { key: string; x: number; y: number }

/**
 * Lay slots out on a `cols`-wide grid in the order given, each at the first free spot (row by row, left to right).
 * Pure and deterministic: the same slots always land on the same cells, so a stock keeps its layout for the whole epoch
 * (a sold item leaves a gap, the others never move). The grid grows downwards as needed; a slot wider than the grid is skipped.
 */
export function packVendor(slots: readonly VendorSlot[], cols = VENDOR_COLS, minRows = VENDOR_MIN_ROWS): { placements: VendorPlacement[]; rows: number } {
  const used: boolean[][] = [];
  const free = (x: number, y: number, w: number, h: number): boolean => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (used[yy]?.[xx]) return false;
    return true;
  };
  const placements: VendorPlacement[] = [];
  let rows = minRows;
  for (const s of slots) {
    const w = Math.max(1, Math.floor(s.w)), h = Math.max(1, Math.floor(s.h));
    if (w > cols) continue;
    search: for (let y = 0; ; y++) {
      for (let x = 0; x + w <= cols; x++) {
        if (!free(x, y, w, h)) continue;
        for (let yy = y; yy < y + h; yy++) { used[yy] ??= []; for (let xx = x; xx < x + w; xx++) used[yy][xx] = true; }
        placements.push({ key: s.key, x, y });
        rows = Math.max(rows, y + h);
        break search;
      }
    }
  }
  return { placements, rows };
}

/** Why "Ask for new wares" is unavailable (null when it is allowed). */
export function rerollBlocked(board: Pick<MerchantBoard, 'rerollCost'>, scrapOnHand: number): string | null {
  return scrapOnHand >= board.rerollCost ? null : `Can't afford: needs ${board.rerollCost} Forge Scrap (you have ${scrapOnHand}).`;
}
