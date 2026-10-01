// Item locks (GAME_SPEC §12 Trading: "Items in an open trade stay in your backpack, but they are locked").
//
// The rules have no notion of an open trade, so a locked item is protected by MASKING: before an
// operation runs, every locked currency / flask stack is swapped for an inert stand-in of the same size
// (it cannot stack, cannot pay a price and is not currency, so nothing tops it up or spends it — Rook
// and the Crafting Bench simply pay from the other stacks); after the operation every locked item must
// still sit, unchanged, where it was, and the originals are put back. An operation that would have
// moved, merged into, swapped, crafted or consumed a locked item is refused instead. Pure.
//
// The GameRulesApi wrapper built on this is withItemLocks (src/game/online.ts).
import type { CharacterSave, Item, ItemLocation, MapItem } from '../../contracts/items';
import { findItem, isStackable, replaceItemAt } from './inventory';

interface MaskEntry {
  uid: string;
  location: ItemLocation;
  original: Item;
  /** What stands at `location` while the operation runs (the stand-in, or the original itself). */
  placed: Item;
}

export interface LockMask {
  readonly entries: readonly MaskEntry[];
}

/** A 1×1 item nothing can stack onto, pay with or count as currency. Never leaves the rules. */
function standIn(item: Item): MapItem {
  return { kind: 'map', uid: item.uid, areaId: 'cinderCrossing', baseId: 'ashenForge', tier: 1, rarity: 'normal', mods: [], quality: 0, corrupted: false };
}

/** Swap the character's locked stacks for stand-ins; returns the masked character and what to restore. */
export function maskLocked(ch: CharacterSave, locked: ReadonlySet<string>): { character: CharacterSave; mask: LockMask } {
  let next = ch;
  const entries: MaskEntry[] = [];
  for (const uid of locked) {
    if (typeof uid !== 'string') continue;
    const found = findItem(next, uid);
    // Gone already (nothing to protect), or belt charges / a Crafting Stash slot (never offerable: they
    // are not an item of their own).
    if (!found || found.location.kind === 'belt' || found.location.kind === 'currencyStash') continue;
    const inGrid = found.location.kind === 'backpack' || found.location.kind === 'stash';
    const placed = inGrid && isStackable(found.item) ? standIn(found.item) : found.item;
    if (placed !== found.item) next = replaceItemAt(next, found.location, placed);
    entries.push({ uid, location: found.location, original: found.item, placed });
  }
  return { character: next, mask: { entries } };
}

function sameLocation(a: ItemLocation, b: ItemLocation): boolean {
  switch (a.kind) {
    case 'backpack': return b.kind === 'backpack' && a.x === b.x && a.y === b.y;
    case 'stash': return b.kind === 'stash' && a.tab === b.tab && a.x === b.x && a.y === b.y;
    case 'equipment': return b.kind === 'equipment' && a.slot === b.slot;
    case 'belt': return b.kind === 'belt' && a.index === b.index;
    case 'mapDevice': return b.kind === 'mapDevice';
    case 'scarabSlot': return b.kind === 'scarabSlot' && a.index === b.index;
    case 'currencyStash': return b.kind === 'currencyStash';
    case 'mapStash': return b.kind === 'mapStash';
    case 'craftSlot': return b.kind === 'craftSlot';
  }
}

/** Structural equality of plain JSON values (items), independent of key order. */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => sameJson(v, b[i]));
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  const ka = Object.keys(ra).filter((k) => ra[k] !== undefined);
  const kb = Object.keys(rb).filter((k) => rb[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(rb, k) && sameJson(ra[k], rb[k]));
}

/**
 * Undo maskLocked on the result of an operation: null when any locked item was moved, changed or
 * removed by it (the operation must then be refused), otherwise the character with the originals back.
 */
export function unmaskLocked(ch: CharacterSave, mask: LockMask): CharacterSave | null {
  let next = ch;
  for (const e of mask.entries) {
    const found = findItem(next, e.uid);
    if (!found || !sameLocation(found.location, e.location) || !sameJson(found.item, e.placed)) return null;
    if (e.placed !== e.original) next = replaceItemAt(next, e.location, e.original);
  }
  return next;
}
