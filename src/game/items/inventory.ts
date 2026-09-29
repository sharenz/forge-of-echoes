// Inventory rules: grid placement & stacking, locating items, equip rules, drag moves with swap
// semantics, Ctrl-click quick moves, the flask belt, the map device, stash tabs and the special stash
// tabs (the Crafting Stash and the Map Stash; containers in ./special-stash).
//
// Every function is pure: it returns a new CharacterSave (untouched containers keep their identity,
// which lets the UI memoise) or a Result error with a player-facing reason.
import type {
  BeltSlot, CharacterSave, CurrencyStack, FlaskStack, GridContainer, GridEntry, Item, ItemLocation, MapItem, SpecialStashTab,
  StashTab,
} from '../../contracts/items';
import { BELT_SLOTS, CURRENCY_STASH_MAX, MAP_STASH_CAPACITY, MAX_STASH_TABS, STASH_TAB_SIZE } from '../../contracts/items';
import type { CurrencyId, EquipSlot } from '../../contracts/content';
import type { Result } from '../../contracts/game';
import {
  BELT_SLOT_CAPACITY, FLASK_STACK, STASH_TAB_NAME_MAX, findBase, findCurrency,
} from '../../data/items';
import { formatCount, joinWords } from './format';
import { adoptUid, beltUid, heldUids, isReservedUid, mintUid, parseBeltUid, parseCurrencyStashUid } from './ids';
import { equipmentLevelRequirement, itemDisplayName } from './modifiers';
import {
  currencyStashCount, currencyStashItem, currencyStashRoom, mapStashIndex, mapStashOf, specialStashTab, withCurrencyStashCount,
  withMapStash,
} from './special-stash';

export type GridRef = { kind: 'backpack' } | { kind: 'stash'; tab: number };

export interface FoundItem {
  item: Item;
  location: ItemLocation;
}

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(error: string): Result<T> => ({ ok: false, error });

export const SLOT_LABEL: Record<EquipSlot, string> = {
  mainHand: 'Main Hand',
  offHand: 'Off Hand',
  helmet: 'Helmet',
  chest: 'Body Armour',
  gloves: 'Gloves',
  boots: 'Boots',
  belt: 'Belt',
  amulet: 'Amulet',
  ring1: 'Left Ring',
  ring2: 'Right Ring',
};

// ---------------------------------------------------------------------------------------------
// Sizes & stacking
// ---------------------------------------------------------------------------------------------

/** Grid footprint: equipment by class; currency, maps and flasks are 1×1. */
export function itemSize(item: Item): { w: number; h: number } {
  if (item.kind === 'equipment') {
    const base = findBase(item.baseId);
    return base ? { w: base.size.w, h: base.size.h } : { w: 1, h: 1 };
  }
  return { w: 1, h: 1 };
}

export function isStackable(item: Item): item is CurrencyStack | FlaskStack {
  return item.kind === 'currency' || item.kind === 'flask';
}

/** Max stack in a grid cell (1 for equipment and maps). */
export function maxStackSize(item: Item): number {
  if (item.kind === 'currency') return findCurrency(item.currencyId)?.maxStack ?? 40;
  if (item.kind === 'flask') return FLASK_STACK;
  return 1;
}

/** Same currency / same flask type. */
export function canStack(a: Item, b: Item): boolean {
  if (a.kind === 'currency' && b.kind === 'currency') return a.currencyId === b.currencyId;
  if (a.kind === 'flask' && b.kind === 'flask') return a.flaskId === b.flaskId;
  return false;
}

function withCount<T extends CurrencyStack | FlaskStack>(item: T, count: number): T {
  return { ...item, count };
}

// ---------------------------------------------------------------------------------------------
// Grid operations (pure, container-level)
// ---------------------------------------------------------------------------------------------

export function createGrid(w: number, h: number): GridContainer {
  return { w, h, entries: [] };
}

export function inBounds(grid: GridContainer, x: number, y: number, w: number, h: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x + w <= grid.w && y + h <= grid.h;
}

/** Entries whose footprint intersects the rectangle (optionally ignoring one uid). */
export function overlappingEntries(
  grid: GridContainer, x: number, y: number, w: number, h: number, ignoreUid?: string,
): GridEntry[] {
  return grid.entries.filter((e) => {
    if (e.item.uid === ignoreUid) return false;
    const s = itemSize(e.item);
    return e.x < x + w && x < e.x + s.w && e.y < y + h && y < e.y + s.h;
  });
}

export function canPlace(grid: GridContainer, item: Item, x: number, y: number, ignoreUid?: string): boolean {
  const { w, h } = itemSize(item);
  return inBounds(grid, x, y, w, h) && overlappingEntries(grid, x, y, w, h, ignoreUid).length === 0;
}

/** Place without merging; null when out of bounds or blocked. */
export function placeItem(grid: GridContainer, item: Item, x: number, y: number): GridContainer | null {
  if (!canPlace(grid, item, x, y)) return null;
  return { ...grid, entries: [...grid.entries, { item, x, y }] };
}

/**
 * Index of the ONE entry an operation on `uid` means: the entry holding it at `at` when a position is
 * given (a found item's location), else the first entry holding it; -1 when there is none. Operations
 * never touch every entry with a uid: were two entries ever to share one, a craft or a discard must
 * still change exactly the item the player pointed at.
 */
function entryIndex(grid: GridContainer, uid: string, at?: { x: number; y: number }): number {
  if (at) {
    const exact = grid.entries.findIndex((e) => e.item.uid === uid && e.x === at.x && e.y === at.y);
    if (exact >= 0) return exact;
  }
  return grid.entries.findIndex((e) => e.item.uid === uid);
}

/** Remove the entry holding `uid` (the one at `at` when given). */
export function removeFromGrid(grid: GridContainer, uid: string, at?: { x: number; y: number }): GridContainer {
  const i = entryIndex(grid, uid, at);
  if (i < 0) return grid;
  return { ...grid, entries: grid.entries.filter((_, j) => j !== i) };
}

/** Replace the entry holding `item.uid` (the one at `at` when given), keeping its position. */
export function replaceInGrid(grid: GridContainer, item: Item, at?: { x: number; y: number }): GridContainer {
  const i = entryIndex(grid, item.uid, at);
  if (i < 0) return grid;
  const entries = grid.entries.slice();
  entries[i] = { ...entries[i], item };
  return { ...grid, entries };
}

/** First free position, scanning column by column (top to bottom, then left to right). */
export function findFreeSpot(grid: GridContainer, w: number, h: number): { x: number; y: number } | null {
  if (w > grid.w || h > grid.h) return null;
  const occ = new Uint8Array(grid.w * grid.h);
  for (const e of grid.entries) {
    const s = itemSize(e.item);
    for (let yy = e.y; yy < Math.min(grid.h, e.y + s.h); yy++) {
      for (let xx = e.x; xx < Math.min(grid.w, e.x + s.w); xx++) occ[yy * grid.w + xx] = 1;
    }
  }
  for (let x = 0; x + w <= grid.w; x++) {
    for (let y = 0; y + h <= grid.h; y++) {
      let free = true;
      for (let yy = y; free && yy < y + h; yy++) {
        for (let xx = x; xx < x + w; xx++) {
          if (occ[yy * grid.w + xx]) {
            free = false;
            break;
          }
        }
      }
      if (free) return { x, y };
    }
  }
  return null;
}

/**
 * Add an item anywhere in a grid: stackables top up existing stacks first (in scan order), the rest
 * goes to the first free spot. Atomic: returns null (grid unchanged) when it cannot all fit.
 */
export function autoPlace(grid: GridContainer, item: Item): GridContainer | null {
  const entries = grid.entries.slice();
  let remaining = isStackable(item) ? item.count : 1;
  if (isStackable(item)) {
    const max = maxStackSize(item);
    const targets = entries
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => canStack(e.item, item) && (e.item as CurrencyStack | FlaskStack).count < max)
      .sort((a, b) => a.e.x - b.e.x || a.e.y - b.e.y);
    for (const { e, i } of targets) {
      const stack = e.item as CurrencyStack | FlaskStack;
      const n = Math.min(max - stack.count, remaining);
      entries[i] = { ...e, item: withCount(stack, stack.count + n) };
      remaining -= n;
      if (remaining <= 0) return { ...grid, entries };
    }
  }
  const { w, h } = itemSize(item);
  const max = maxStackSize(item);
  let work: GridContainer = { ...grid, entries };
  let chunk = 0;
  while (remaining > 0) {
    const spot = findFreeSpot(work, w, h);
    if (!spot) return null;
    let placed: Item = item;
    if (isStackable(item)) {
      const n = Math.min(max, remaining);
      // Oversized stacks (never produced by the rules) split into derived uids.
      placed = { ...withCount(item, n), uid: chunk === 0 ? item.uid : `${item.uid}.${chunk}` };
      remaining -= n;
    } else remaining = 0;
    work = { ...work, entries: [...work.entries, { item: placed, x: spot.x, y: spot.y }] };
    chunk++;
  }
  return work;
}

// ---------------------------------------------------------------------------------------------
// Character containers
// ---------------------------------------------------------------------------------------------

export function gridOf(ch: CharacterSave, ref: GridRef): GridContainer | null {
  if (ref.kind === 'backpack') return ch.backpack;
  return ch.stash[ref.tab]?.grid ?? null;
}

export function withGrid(ch: CharacterSave, ref: GridRef, grid: GridContainer): CharacterSave {
  if (ref.kind === 'backpack') return { ...ch, backpack: grid };
  const stash = ch.stash.slice();
  stash[ref.tab] = { ...stash[ref.tab], grid };
  return { ...ch, stash };
}

function gridRefOf(loc: ItemLocation): GridRef | null {
  if (loc.kind === 'backpack') return { kind: 'backpack' };
  if (loc.kind === 'stash') return { kind: 'stash', tab: loc.tab };
  return null;
}

/** The grid cell of a backpack / stash location (undefined elsewhere). */
function gridPos(loc: ItemLocation): { x: number; y: number } | undefined {
  return loc.kind === 'backpack' || loc.kind === 'stash' ? { x: loc.x, y: loc.y } : undefined;
}

function sameGrid(a: GridRef, b: GridRef): boolean {
  return a.kind === b.kind && (a.kind === 'backpack' || (b.kind === 'stash' && a.tab === b.tab));
}

/** The belt as exactly BELT_SLOTS entries (a copy; tolerates short arrays from old saves). */
export function beltSlots(ch: CharacterSave): (BeltSlot | null)[] {
  const out: (BeltSlot | null)[] = [];
  for (let i = 0; i < BELT_SLOTS; i++) out.push(ch.belt[i] ?? null);
  return out;
}

/** The flask charges of a belt slot as a synthetic stack (uid "belt:<index>"); null if unassigned. */
export function beltItem(ch: CharacterSave, index: number): FlaskStack | null {
  const slot = ch.belt[index];
  if (!slot) return null;
  return { kind: 'flask', uid: beltUid(index), flaskId: slot.flaskId, count: slot.count };
}

/**
 * Locate an item by uid across backpack, stash tabs, equipment, belt slots, the map device, the Map Stash
 * and the Crafting Stash. Uids come from the network: anything that is not a string finds nothing (so
 * every command built on this fails with "That item no longer exists." instead of throwing).
 * A Crafting Stash slot ("cstash:<id>") is found as a CurrencyStack view with the slot's count at
 * { kind: 'currencyStash' } while it holds at least one (currencyStashItem builds the view of an empty one).
 */
export function findItem(ch: CharacterSave, uid: string): FoundItem | null {
  if (typeof uid !== 'string') return null;
  const beltIndex = parseBeltUid(uid);
  if (beltIndex !== null) {
    const item = beltItem(ch, beltIndex);
    return item ? { item, location: { kind: 'belt', index: beltIndex } } : null;
  }
  const slot = parseCurrencyStashUid(uid);
  if (slot !== null) {
    const item = currencyStashItem(ch, slot);
    return item.count > 0 ? { item, location: { kind: 'currencyStash' } } : null;
  }
  for (const e of ch.backpack.entries) {
    if (e.item.uid === uid) return { item: e.item, location: { kind: 'backpack', x: e.x, y: e.y } };
  }
  for (let tab = 0; tab < ch.stash.length; tab++) {
    for (const e of ch.stash[tab].grid.entries) {
      if (e.item.uid === uid) return { item: e.item, location: { kind: 'stash', tab, x: e.x, y: e.y } };
    }
  }
  for (const [slot, item] of Object.entries(ch.equipment) as [EquipSlot, Item | undefined][]) {
    if (item && item.uid === uid) return { item, location: { kind: 'equipment', slot } };
  }
  if (ch.mapDevice && ch.mapDevice.uid === uid) return { item: ch.mapDevice, location: { kind: 'mapDevice' } };
  for (const m of mapStashOf(ch)) if (m.uid === uid) return { item: m, location: { kind: 'mapStash' } };
  return null;
}

/**
 * Every real item the character owns, Map Stash included (belt charges and Crafting Stash slots
 * excluded — they have no uid of their own).
 */
export function allItems(ch: CharacterSave): FoundItem[] {
  const out: FoundItem[] = [];
  for (const e of ch.backpack.entries) out.push({ item: e.item, location: { kind: 'backpack', x: e.x, y: e.y } });
  ch.stash.forEach((tab, t) => {
    for (const e of tab.grid.entries) out.push({ item: e.item, location: { kind: 'stash', tab: t, x: e.x, y: e.y } });
  });
  for (const [slot, item] of Object.entries(ch.equipment) as [EquipSlot, Item | undefined][]) {
    if (item) out.push({ item, location: { kind: 'equipment', slot } });
  }
  if (ch.mapDevice) out.push({ item: ch.mapDevice, location: { kind: 'mapDevice' } });
  for (const m of mapStashOf(ch)) out.push({ item: m, location: { kind: 'mapStash' } });
  return out;
}

/**
 * Replace an item in place (same uid, same location). Used by crafting. A Crafting Stash slot takes the
 * stack's count (0 empties it); a Map Stash map keeps its place in the list.
 */
export function replaceItemAt(ch: CharacterSave, location: ItemLocation, item: Item): CharacterSave {
  const ref = gridRefOf(location);
  if (ref) {
    const grid = gridOf(ch, ref);
    return grid ? withGrid(ch, ref, replaceInGrid(grid, item, gridPos(location))) : ch;
  }
  if (location.kind === 'equipment' && item.kind === 'equipment') {
    return { ...ch, equipment: { ...ch.equipment, [location.slot]: item } };
  }
  if (location.kind === 'mapDevice' && item.kind === 'map') return { ...ch, mapDevice: item };
  if (location.kind === 'belt' && item.kind === 'flask') {
    const belt = beltSlots(ch);
    belt[location.index] = { flaskId: item.flaskId, count: item.count };
    return { ...ch, belt };
  }
  if (location.kind === 'currencyStash' && item.kind === 'currency') {
    return withCurrencyStashCount(ch, item.currencyId, item.count);
  }
  if (location.kind === 'mapStash' && item.kind === 'map') {
    const i = mapStashIndex(ch, item.uid);
    if (i < 0) return ch;
    const maps = mapStashOf(ch).slice();
    maps[i] = item;
    return withMapStash(ch, maps);
  }
  return ch;
}

/** Remove whatever sits at a location (belt slots are cleared entirely, a Crafting Stash slot emptied). */
export function removeItemAt(ch: CharacterSave, location: ItemLocation, uid: string): CharacterSave {
  const ref = gridRefOf(location);
  if (ref) {
    const grid = gridOf(ch, ref);
    return grid ? withGrid(ch, ref, removeFromGrid(grid, uid, gridPos(location))) : ch;
  }
  if (location.kind === 'equipment') {
    const equipment = { ...ch.equipment };
    delete equipment[location.slot];
    return { ...ch, equipment };
  }
  if (location.kind === 'belt') {
    const belt = beltSlots(ch);
    belt[location.index] = null;
    return { ...ch, belt };
  }
  if (location.kind === 'currencyStash') {
    const id = parseCurrencyStashUid(uid);
    return id ? withCurrencyStashCount(ch, id, 0) : ch;
  }
  if (location.kind === 'mapStash') {
    const i = mapStashIndex(ch, uid);
    return i < 0 ? ch : withMapStash(ch, mapStashOf(ch).filter((_, j) => j !== i));
  }
  if (location.kind === 'mapDevice') return ch.mapDevice ? { ...ch, mapDevice: null } : ch;
  return ch;
}

/** Set a stack's count in place, removing it at 0. */
export function setStackCount(ch: CharacterSave, found: FoundItem, count: number): CharacterSave {
  if (!isStackable(found.item)) return ch;
  if (count <= 0 && found.location.kind !== 'belt') return removeItemAt(ch, found.location, found.item.uid);
  return replaceItemAt(ch, found.location, withCount(found.item, Math.max(0, count)));
}

// ---------------------------------------------------------------------------------------------
// Equip rules
// ---------------------------------------------------------------------------------------------

function slotPhrase(slots: readonly EquipSlot[]): string {
  if (slots.includes('ring1') || slots.includes('ring2')) return 'a Ring slot';
  const s = slots[0];
  return s === 'mainHand' || s === 'offHand' ? `the ${SLOT_LABEL[s]}` : `the ${SLOT_LABEL[s]} slot`;
}

/** Slot compatibility (rings fit ring1 and ring2) and level requirement. */
export function canEquip(ch: CharacterSave, item: Item, slot: EquipSlot): { ok: boolean; reason?: string } {
  if (item.kind !== 'equipment') return { ok: false, reason: 'Only equipment can be equipped.' };
  const base = findBase(item.baseId);
  if (!base) return { ok: false, reason: 'This item can no longer be equipped.' };
  if (!base.slots.includes(slot)) {
    return { ok: false, reason: `${base.name} can only be equipped in ${slotPhrase(base.slots)}.` };
  }
  const req = equipmentLevelRequirement(item);
  if (ch.level < req) return { ok: false, reason: `Requires Level ${req} (you are level ${ch.level}).` };
  return { ok: true };
}

// ---------------------------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------------------------

/** Refusal for a malformed `count` (it arrives from the network). */
const INVALID_COUNT = 'Choose how many to move: a whole number of at least 1.';

/**
 * A move's optional `count` as sent over the network: undefined (or null) = the whole stack / the default
 * amount, a whole number ≥ 1 = that many (fractions are floored), anything else = null (invalid).
 */
function parseCount(count: unknown): number | undefined | null {
  if (count === undefined || count === null) return undefined;
  if (typeof count !== 'number' || !Number.isFinite(count)) return null;
  const n = Math.floor(count);
  return n >= 1 ? n : null;
}

function currencyName(id: CurrencyId): string {
  return findCurrency(id)?.name ?? 'that currency';
}

/** "Your backpack is full." / "This stash tab is full." */
function fullMessage(ref: GridRef): string {
  return ref.kind === 'backpack' ? 'Your backpack is full.' : 'This stash tab is full.';
}

/** Why an item uid finds nothing: an empty Crafting Stash slot says so, anything else no longer exists. */
function missingItemError(uid: string): string {
  const slot = parseCurrencyStashUid(uid);
  return slot ? `Your Crafting Stash holds no ${currencyName(slot)}.` : 'That item no longer exists.';
}

/** Take an item out of its location. Belt slots keep their flask assignment with 0 charges. */
function detach(ch: CharacterSave, found: FoundItem): CharacterSave {
  const loc = found.location;
  if (loc.kind === 'belt') {
    const belt = beltSlots(ch);
    const slot = belt[loc.index];
    belt[loc.index] = slot ? { flaskId: slot.flaskId, count: 0 } : null;
    return { ...ch, belt };
  }
  return removeItemAt(ch, loc, found.item.uid);
}

/** Put a displaced item into a (just vacated) location; grids fall back to any free spot. */
function reattach(ch: CharacterSave, loc: ItemLocation, item: Item): CharacterSave | null {
  const ref = gridRefOf(loc);
  if (ref && (loc.kind === 'backpack' || loc.kind === 'stash')) {
    const grid = gridOf(ch, ref);
    if (!grid) return null;
    const exact = placeItem(grid, item, loc.x, loc.y);
    if (exact) return withGrid(ch, ref, exact);
    const { w, h } = itemSize(item);
    const spot = findFreeSpot(grid, w, h);
    const placed = spot ? placeItem(grid, item, spot.x, spot.y) : null;
    return placed ? withGrid(ch, ref, placed) : null;
  }
  if (loc.kind === 'equipment') {
    if (item.kind !== 'equipment' || !canEquip(ch, item, loc.slot).ok) return null;
    return { ...ch, equipment: { ...ch.equipment, [loc.slot]: item } };
  }
  if (loc.kind === 'belt') {
    if (item.kind !== 'flask' || item.count > BELT_SLOT_CAPACITY) return null;
    const belt = beltSlots(ch);
    belt[loc.index] = { flaskId: item.flaskId, count: item.count };
    return { ...ch, belt };
  }
  if (loc.kind === 'mapDevice') return item.kind === 'map' ? { ...ch, mapDevice: item } : null;
  if (loc.kind === 'mapStash') {
    const maps = mapStashOf(ch);
    return item.kind === 'map' && maps.length < MAP_STASH_CAPACITY ? withMapStash(ch, [...maps, item]) : null;
  }
  if (loc.kind === 'currencyStash') {
    if (item.kind !== 'currency' || currencyStashRoom(ch, item.currencyId) < item.count) return null;
    return withCurrencyStashCount(ch, item.currencyId, currencyStashCount(ch, item.currencyId) + item.count);
  }
  return null;
}

/** Give belt charges leaving the belt a real uid. */
function materialize(ch: CharacterSave, found: FoundItem): { ch: CharacterSave; item: Item } {
  if (found.location.kind !== 'belt' || found.item.kind !== 'flask') return { ch, item: found.item };
  const minted = mintUid(ch);
  return { ch: minted.character, item: { ...found.item, uid: minted.uid } };
}

function validStashTab(ch: CharacterSave, tab: unknown): tab is number {
  return typeof tab === 'number' && Number.isInteger(tab) && tab >= 0 && tab < ch.stash.length;
}

/**
 * Split `n` (less than the whole stack) off a grid or belt stack onto a grid cell: into an empty cell as
 * a new stack (fresh uid), or merged into a matching stack there as far as it has room. The rest stays.
 */
function splitToGrid(
  ch: CharacterSave, found: FoundItem & { item: CurrencyStack | FlaskStack }, ref: GridRef, x: number, y: number, n: number,
): Result<CharacterSave> {
  const grid = gridOf(ch, ref)!;
  const blockers = overlappingEntries(grid, x, y, 1, 1);
  if (blockers.length === 0) {
    const minted = mintUid(ch);
    const part = { ...stripNew(found.item), uid: minted.uid, count: n };
    const reduced = setStackCount(minted.character, found, found.item.count - n);
    return ok(withGrid(reduced, ref, placeItem(gridOf(reduced, ref)!, part, x, y)!));
  }
  const blocker = blockers[0];
  if (blockers.length === 1 && canStack(blocker.item, found.item)) {
    const stack = blocker.item as CurrencyStack | FlaskStack;
    const room = maxStackSize(stack) - stack.count;
    if (room <= 0) return fail('That stack is full.');
    const m = Math.min(room, n);
    const reduced = setStackCount(ch, found, found.item.count - m);
    return ok(withGrid(reduced, ref, replaceInGrid(gridOf(reduced, ref)!, withCount(stack, stack.count + m), blocker)));
  }
  return fail('Something is in the way.');
}

/**
 * How much of a stack (at most one full stack) a grid can take without displacing anything: the room left
 * on its matching stacks, plus a full stack when a cell is free.
 */
function stackRoomIn(grid: GridContainer, stack: CurrencyStack): number {
  const max = maxStackSize(stack);
  let room = 0;
  for (const e of grid.entries) {
    if (canStack(e.item, stack)) room += Math.max(0, max - (e.item as CurrencyStack).count);
  }
  return findFreeSpot(grid, 1, 1) ? room + max : room;
}

/**
 * Withdraw from a Crafting Stash slot: min(count ?? a full stack, the stack size, what the slot holds) as a
 * new stack (fresh uid) or topped onto a matching stack. With a cell: into that cell when it is free, onto a
 * matching stack there as far as it has room, otherwise anywhere in that grid (a withdrawal never displaces
 * anything). Without one: anywhere in the backpack, topping up matching stacks first. When the grid has no
 * free cell, as much as its matching stacks can still take (a full backpack with a 30 / 40 stack takes 10);
 * only a grid with no room at all refuses.
 */
function withdrawCurrency(
  ch: CharacterSave, id: CurrencyId, count: number | undefined, dest: { ref: GridRef; x: number; y: number } | null,
): Result<CharacterSave> {
  const have = currencyStashCount(ch, id);
  if (have <= 0) return fail(`Your Crafting Stash holds no ${currencyName(id)}.`);
  const max = findCurrency(id)?.maxStack ?? 1;
  const n = Math.min(count ?? max, max, have);
  const ref: GridRef = dest?.ref ?? { kind: 'backpack' };
  const grid = gridOf(ch, ref);
  if (!grid) return fail('That stash tab does not exist.');
  const take = (c: CharacterSave, g: GridContainer, taken: number) =>
    ok(withCurrencyStashCount(withGrid(c, ref, g), id, have - taken));
  const minted = mintUid(ch);
  const stack: CurrencyStack = { kind: 'currency', uid: minted.uid, currencyId: id, count: n };
  if (dest) {
    if (!inBounds(grid, dest.x, dest.y, 1, 1)) return fail('It does not fit there.');
    const blockers = overlappingEntries(grid, dest.x, dest.y, 1, 1);
    if (!blockers.length) return take(minted.character, placeItem(grid, stack, dest.x, dest.y)!, n);
    const blocker = blockers[0];
    if (canStack(blocker.item, stack)) {
      const onCell = blocker.item as CurrencyStack;
      const room = maxStackSize(onCell) - onCell.count;
      if (room > 0) {
        const m = Math.min(room, n);
        return take(ch, replaceInGrid(grid, withCount(onCell, onCell.count + m), blocker), m);
      }
    }
  }
  const fits = Math.min(n, stackRoomIn(grid, stack));
  if (fits <= 0) return fail(fullMessage(ref));
  const placed = autoPlace(grid, fits === n ? stack : withCount(stack, fits));
  if (!placed) return fail(fullMessage(ref));
  // Only a withdrawal that opened a new stack used the minted uid.
  const opened = placed.entries.some((e) => e.item.uid === minted.uid);
  return take(opened ? minted.character : ch, placed, fits);
}

/**
 * Withdraw a map from the Map Stash into a grid: into the given cell when it is free, otherwise anywhere
 * in that grid (never displacing anything); without a cell, anywhere in the backpack.
 */
function withdrawMap(ch: CharacterSave, map: MapItem, dest: { ref: GridRef; x: number; y: number } | null): Result<CharacterSave> {
  const i = mapStashIndex(ch, map.uid);
  if (i < 0) return fail('That item no longer exists.');
  const ref: GridRef = dest?.ref ?? { kind: 'backpack' };
  const rest = withMapStash(ch, mapStashOf(ch).filter((_, j) => j !== i));
  const grid = gridOf(rest, ref);
  if (!grid) return fail('That stash tab does not exist.');
  if (dest) {
    if (!inBounds(grid, dest.x, dest.y, 1, 1)) return fail('It does not fit there.');
    const exact = placeItem(grid, map, dest.x, dest.y);
    if (exact) return ok(withGrid(rest, ref, exact));
  }
  const placed = autoPlace(grid, map);
  return placed ? ok(withGrid(rest, ref, placed)) : fail(fullMessage(ref));
}

/**
 * File currency into its Crafting Stash slot, wherever it comes from (a backpack or stash tab stack):
 * `count` of it (default the whole stack), as far as the slot has room — the rest stays where it was.
 * A full slot refuses with the reason.
 */
function moveToCurrencyStash(ch: CharacterSave, found: FoundItem, count: number | undefined): Result<CharacterSave> {
  if (found.item.kind !== 'currency') return fail('Only currency can be stored in the Crafting Stash.');
  if (found.location.kind === 'currencyStash') return ok(ch);
  const stack = found.item;
  const id = stack.currencyId;
  const room = currencyStashRoom(ch, id);
  if (room <= 0) {
    return fail(`Your Crafting Stash is full of ${currencyName(id)}: a slot holds at most ${formatCount(CURRENCY_STASH_MAX)}.`);
  }
  const n = Math.min(count ?? stack.count, stack.count, room);
  const have = currencyStashCount(ch, id);
  return ok(withCurrencyStashCount(setStackCount(ch, found, stack.count - n), id, have + n));
}

/** File a map (from the backpack, a stash tab or the Map Device) into the Map Stash. */
function moveToMapStash(ch: CharacterSave, found: FoundItem): Result<CharacterSave> {
  if (found.item.kind !== 'map') return fail('Only maps can be stored in the Map Stash.');
  if (found.location.kind === 'mapStash') return ok(ch);
  if (mapStashOf(ch).length >= MAP_STASH_CAPACITY) {
    return fail(`Your Map Stash is full: it holds at most ${formatCount(MAP_STASH_CAPACITY)} maps.`);
  }
  const detached = detach(ch, found);
  return ok(withMapStash(detached, [...mapStashOf(detached), found.item]));
}

function moveToGrid(
  ch: CharacterSave, found: FoundItem, ref: GridRef, x: number, y: number, count?: number,
): Result<CharacterSave> {
  const target = gridOf(ch, ref);
  if (!target) return fail('That stash tab does not exist.');
  const src = found.location;
  if (src.kind === 'currencyStash' && found.item.kind === 'currency') {
    return withdrawCurrency(ch, found.item.currencyId, count, { ref, x, y });
  }
  if (src.kind === 'mapStash' && found.item.kind === 'map') return withdrawMap(ch, found.item, { ref, x, y });
  const { w, h } = itemSize(found.item);
  if (!inBounds(target, x, y, w, h)) return fail('It does not fit there.');
  const srcRef = gridRefOf(src);
  if (srcRef && sameGrid(srcRef, ref) && 'x' in src && src.x === x && src.y === y) return ok(ch);
  if (src.kind === 'belt' && found.item.kind === 'flask' && found.item.count === 0) return fail('That belt slot is empty.');
  if (count !== undefined && isStackable(found.item) && count < found.item.count) {
    return splitToGrid(ch, found as FoundItem & { item: CurrencyStack | FlaskStack }, ref, x, y, count);
  }

  const detached = detach(ch, found);
  const { ch: c1, item: moving } = materialize(detached, found);
  const grid = gridOf(c1, ref)!;
  const blockers = overlappingEntries(grid, x, y, w, h);
  if (blockers.length === 0) return ok(withGrid(c1, ref, placeItem(grid, moving, x, y)!));
  if (blockers.length > 1) return fail('Something is in the way.');

  const blocker = blockers[0];
  if (isStackable(moving) && canStack(moving, blocker.item)) {
    const stack = blocker.item as CurrencyStack | FlaskStack;
    const space = maxStackSize(stack) - stack.count;
    if (space > 0) {
      const n = Math.min(space, moving.count);
      let next = withGrid(c1, ref, replaceInGrid(grid, withCount(stack, stack.count + n), blocker));
      const rest = moving.count - n;
      if (rest > 0) {
        // The unmerged remainder stays where it came from.
        if (src.kind === 'belt' && found.item.kind === 'flask') {
          const belt = beltSlots(next);
          belt[src.index] = { flaskId: found.item.flaskId, count: rest };
          next = { ...next, belt };
        } else {
          const back = reattach(next, src, withCount(found.item as CurrencyStack | FlaskStack, rest));
          if (!back) return fail('Something is in the way.');
          next = back;
        }
      }
      return ok(next);
    }
  }

  // Swap with the single blocking item: it goes back to where the moved item came from.
  const placed = placeItem(removeFromGrid(grid, blocker.item.uid, blocker), moving, x, y)!;
  const swapped = reattach(withGrid(c1, ref, placed), src, blocker.item);
  if (!swapped) return fail(src.kind === 'equipment' || src.kind === 'belt' || src.kind === 'mapDevice'
    ? 'Those items cannot trade places.'
    : 'There is no room to swap those items.');
  return ok(swapped);
}

function moveToEquipment(ch: CharacterSave, found: FoundItem, slot: EquipSlot): Result<CharacterSave> {
  const check = canEquip(ch, found.item, slot);
  if (!check.ok) return fail(check.reason ?? 'That cannot be equipped there.');
  const src = found.location;
  if (src.kind === 'equipment' && src.slot === slot) return ok(ch);
  const occupant = ch.equipment[slot];
  const c1 = detach(ch, found);
  const c2: CharacterSave = { ...c1, equipment: { ...c1.equipment, [slot]: found.item } };
  if (!occupant) return ok(c2);
  const c3 = reattach(c2, src, occupant);
  if (!c3) return fail(`There is no room for ${itemDisplayName(occupant)}.`);
  return ok(c3);
}

/** Load flasks into a belt slot; from a grid stack at most `limit` charges (default: as many as fit). */
function moveToBelt(ch: CharacterSave, found: FoundItem, index: number, limit?: number): Result<CharacterSave> {
  if (!Number.isInteger(index) || index < 0 || index >= BELT_SLOTS) return fail('That belt slot does not exist.');
  if (found.item.kind !== 'flask') return fail('Only flasks fit on the belt.');
  const flask = found.item;
  const src = found.location;
  const slot = beltSlots(ch)[index];

  if (src.kind === 'belt') {
    if (src.index === index) return ok(ch);
    const belt = beltSlots(ch);
    if (slot && slot.flaskId === flask.flaskId) {
      const n = Math.min(BELT_SLOT_CAPACITY - slot.count, flask.count);
      if (n <= 0) return fail(flask.count === 0 ? 'That belt slot is empty.' : 'That belt slot is full.');
      belt[index] = { flaskId: slot.flaskId, count: slot.count + n };
      belt[src.index] = { flaskId: flask.flaskId, count: flask.count - n };
    } else {
      belt[index] = { flaskId: flask.flaskId, count: flask.count };
      belt[src.index] = slot;
    }
    return ok({ ...ch, belt });
  }

  // From a grid stack.
  const available = Math.min(flask.count, limit ?? flask.count);
  const matching = slot && (slot.flaskId === flask.flaskId || slot.count === 0);
  if (!slot || matching) {
    const current = slot && slot.flaskId === flask.flaskId ? slot.count : 0;
    const n = Math.min(BELT_SLOT_CAPACITY - current, available);
    if (n <= 0) return fail('That belt slot is full.');
    const belt = beltSlots(ch);
    belt[index] = { flaskId: flask.flaskId, count: current + n };
    return ok(setStackCount({ ...ch, belt }, found, flask.count - n));
  }

  // Different flask with charges: load the new one, send the old charges back to the grid.
  const n = Math.min(BELT_SLOT_CAPACITY, available);
  const belt = beltSlots(ch);
  belt[index] = { flaskId: flask.flaskId, count: n };
  const c1 = setStackCount({ ...ch, belt }, found, flask.count - n);
  const minted = mintUid(c1);
  const old: FlaskStack = { kind: 'flask', uid: minted.uid, flaskId: slot.flaskId, count: slot.count };
  const ref = gridRefOf(src)!;
  let c2: CharacterSave | null = null;
  if (flask.count - n <= 0) c2 = reattach(minted.character, src, old);
  if (!c2) {
    const grid = autoPlace(gridOf(minted.character, ref)!, old);
    c2 = grid ? withGrid(minted.character, ref, grid) : null;
  }
  return c2 ? ok(c2) : fail('There is no room for the flasks being replaced.');
}

function moveToMapDevice(ch: CharacterSave, found: FoundItem): Result<CharacterSave> {
  if (found.item.kind !== 'map') return fail('The Map Device only accepts maps.');
  if (found.location.kind === 'mapDevice') return ok(ch);
  const occupant = ch.mapDevice;
  const c1 = detach(ch, found);
  const c2: CharacterSave = { ...c1, mapDevice: found.item };
  if (!occupant) return ok(c2);
  // The map it replaces goes back where the new one came from (a map from the Map Stash swaps into it).
  const c3 = reattach(c2, found.location, occupant);
  return c3 ? ok(c3) : fail('There is no room for the map in the device.');
}

/**
 * Move an item to a location: grid ↔ grid (merging stacks, or swapping with a single blocking item
 * that fits back where the moved item came from), equip / unequip / swap, belt load / unload
 * (≤ 5 charges per slot; unloading keeps the slot's flask assignment), the map device (maps only), and
 * the special stash tabs:
 *   → { kind: 'currencyStash' }  files a currency stack into its slot (up to CURRENCY_STASH_MAX; what does
 *                                not fit stays where it was; a full slot refuses)
 *   → { kind: 'mapStash' }       files a map (up to MAP_STASH_CAPACITY) from a grid or the map device
 *   "cstash:<id>" → a grid cell  withdraws min(count ?? a full stack, stack size, held) (see withdrawCurrency)
 *   a Map Stash map → a grid cell / the map device (swapping the device's map into the Map Stash)
 * `count` (optional, a whole number ≥ 1) splits a grid or belt stack onto a grid cell (an empty cell or a
 * matching stack), limits a deposit or the charges loaded into the belt, and sets how many a Crafting Stash
 * withdrawal takes. Items that are not stacks ignore it.
 */
export function moveItem(ch: CharacterSave, uid: string, to: ItemLocation, count?: number): Result<CharacterSave> {
  const n = parseCount(count);
  if (n === null) return fail(INVALID_COUNT);
  const found = findItem(ch, uid);
  if (!found) return fail(missingItemError(uid));
  if (!isLocation(to)) return fail('Invalid destination.');
  switch (to.kind) {
    case 'backpack':
      return moveToGrid(ch, found, { kind: 'backpack' }, to.x, to.y, n);
    case 'stash':
      if (!validStashTab(ch, to.tab)) return fail('That stash tab does not exist.');
      return moveToGrid(ch, found, { kind: 'stash', tab: to.tab }, to.x, to.y, n);
    case 'equipment':
      return moveToEquipment(ch, found, to.slot);
    case 'belt':
      return moveToBelt(ch, found, to.index, n);
    case 'mapDevice':
      return moveToMapDevice(ch, found);
    case 'currencyStash':
      return moveToCurrencyStash(ch, found, n);
    case 'mapStash':
      return moveToMapStash(ch, found);
    default:
      return fail('Invalid destination.');
  }
}

const LOCATION_KINDS: ReadonlySet<string> = new Set<ItemLocation['kind']>([
  'backpack', 'stash', 'equipment', 'belt', 'mapDevice', 'currencyStash', 'mapStash',
]);

/**
 * Shape check of a destination that arrived over the network. Numbers are checked downstream (bounds,
 * tab and belt indices); this only guarantees the fields exist with the right types.
 */
function isLocation(to: unknown): to is ItemLocation {
  if (!to || typeof to !== 'object') return false;
  const loc = to as Record<string, unknown>;
  if (typeof loc.kind !== 'string' || !LOCATION_KINDS.has(loc.kind)) return false;
  const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  switch (loc.kind) {
    case 'backpack': return num(loc.x) && num(loc.y);
    case 'stash': return num(loc.tab) && num(loc.x) && num(loc.y);
    case 'equipment': return typeof loc.slot === 'string';
    case 'belt': return num(loc.index);
    default: return true;
  }
}

/**
 * Move an item into any free space of a grid (stacking), removing it from its source. With `count` below
 * a stack's size only that many move (as a new stack with a fresh uid, or topping up matching stacks).
 */
function transferToGrid(
  ch: CharacterSave, found: FoundItem, ref: GridRef, fullMsg: string, count?: number,
): Result<CharacterSave> {
  if (found.location.kind === 'belt' && found.item.kind === 'flask' && found.item.count === 0) {
    return fail('That belt slot is empty.');
  }
  if (count !== undefined && isStackable(found.item) && count < found.item.count) {
    const minted = mintUid(ch);
    const part = { ...stripNew(found.item), uid: minted.uid, count };
    const reduced = setStackCount(minted.character, found, found.item.count - count);
    const grid = autoPlace(gridOf(reduced, ref)!, part);
    return grid ? ok(withGrid(reduced, ref, grid)) : fail(fullMsg);
  }
  const detached = detach(ch, found);
  const { ch: c1, item } = materialize(detached, found);
  const grid = autoPlace(gridOf(c1, ref)!, item);
  return grid ? ok(withGrid(c1, ref, grid)) : fail(fullMsg);
}

/** Best slot for Ctrl-click equip: an empty compatible slot, else the first compatible one. */
function bestEquipSlot(ch: CharacterSave, slots: readonly EquipSlot[]): EquipSlot {
  return slots.find((s) => !ch.equipment[s]) ?? slots[0];
}

/** Load flask charges into the belt: matching slots first, else the first free slot. */
function loadIntoBelt(ch: CharacterSave, found: FoundItem & { item: FlaskStack }): Result<CharacterSave> {
  const flask = found.item;
  const belt = beltSlots(ch);
  let left = flask.count;
  for (let i = 0; i < BELT_SLOTS && left > 0; i++) {
    const s = belt[i];
    if (s && s.flaskId === flask.flaskId && s.count < BELT_SLOT_CAPACITY) {
      const n = Math.min(BELT_SLOT_CAPACITY - s.count, left);
      belt[i] = { flaskId: s.flaskId, count: s.count + n };
      left -= n;
    }
  }
  if (left === flask.count) {
    const free = belt.findIndex((s) => !s || s.count === 0);
    if (free < 0) return fail('Your belt has no room for this flask.');
    const n = Math.min(BELT_SLOT_CAPACITY, left);
    belt[free] = { flaskId: flask.flaskId, count: n };
    left -= n;
  }
  return ok(setStackCount({ ...ch, belt }, found, left));
}

/** Quick-move context: the open stash tab (a normal tab index, a special tab, or none) and an amount. */
export interface QuickMoveContext {
  stashTab: number | SpecialStashTab | null;
  count?: number;
}

/**
 * Ctrl-click.
 *   Backpack item, with the open stash tab:
 *     any stash tab      → maps/currency file into their dedicated tabs; other items use the selected normal tab
 *     'currency' | 'mapCurrency' → a currency stack files into its Crafting Stash slot (either Crafting
 *                          Stash tab takes every currency); anything else is refused
 *     'maps'             → a map files into the Map Stash; anything else is refused
 *     none               → equipment equips into the best slot, flasks load into the belt, maps go into
 *                          the map device
 *   Stash tab item, equipped item, belt charges → the backpack.
 *   The device's map → the Map Stash while it is open ('maps'), otherwise the backpack.
 *   Crafting Stash slot ("cstash:<id>") → the backpack: a full stack (up to the stack size) or `count`
 *     (Shift+Ctrl-click sends 1), topping up matching stacks first.
 *   Map Stash map → the backpack (to reach the open Map Device, the UI moves it with moveItem).
 * `count` below a stack's size moves only that many (a split) wherever a stack moves.
 */
export function quickMove(ch: CharacterSave, uid: string, ctx: QuickMoveContext): Result<CharacterSave> {
  const context: Partial<Record<keyof QuickMoveContext, unknown>> = ctx && typeof ctx === 'object' ? ctx : {};
  const count = parseCount(context.count);
  if (count === null) return fail(INVALID_COUNT);
  const found = findItem(ch, uid);
  if (!found) return fail(missingItemError(uid));
  const tab = context.stashTab ?? null;
  const special = specialStashTab(tab);
  const backpack: GridRef = { kind: 'backpack' };
  switch (found.location.kind) {
    case 'currencyStash':
      return found.item.kind === 'currency' ? withdrawCurrency(ch, found.item.currencyId, count, null) : fail(missingItemError(uid));
    case 'mapStash':
      return found.item.kind === 'map' ? withdrawMap(ch, found.item, null) : fail(missingItemError(uid));
    case 'backpack': {
      if (tab !== null) {
        if (!special && !validStashTab(ch, tab)) return fail('That stash tab does not exist.');
        if (found.item.kind === 'map') return moveToMapStash(ch, found);
        if (found.item.kind === 'currency') return moveToCurrencyStash(ch, found, count);
      }
      if (special === 'maps') return moveToMapStash(ch, found);
      if (special) return moveToCurrencyStash(ch, found, count);
      if (tab !== null) {
        if (!validStashTab(ch, tab)) return fail('That stash tab does not exist.');
        return transferToGrid(ch, found, { kind: 'stash', tab }, 'This stash tab is full.', count);
      }
      const item = found.item;
      if (item.kind === 'equipment') {
        const base = findBase(item.baseId);
        if (!base) return fail('This item can no longer be equipped.');
        return moveToEquipment(ch, found, bestEquipSlot(ch, base.slots));
      }
      if (item.kind === 'flask') return loadIntoBelt(ch, { item, location: found.location });
      if (item.kind === 'map') return moveToMapDevice(ch, found);
      return fail('Open the stash to quick-move this item.');
    }
    case 'mapDevice':
      if (special === 'maps') return moveToMapStash(ch, found);
      return transferToGrid(ch, found, backpack, 'Your backpack is full.', count);
    case 'stash':
    case 'equipment':
    case 'belt':
      return transferToGrid(ch, found, backpack, 'Your backpack is full.', count);
  }
}

/**
 * "Deposit all": every currency stack in the backpack files into its Crafting Stash slot, leftmost
 * stacks first. What a full slot cannot take stays in the backpack. Fails (changing nothing) when the
 * backpack holds no currency, or when every slot it would go to is full.
 */
export function depositAllCurrency(ch: CharacterSave): Result<CharacterSave> {
  const entries = ch.backpack.entries;
  const order = entries
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.item.kind === 'currency' && e.item.count > 0)
    .sort((a, b) => a.e.x - b.e.x || a.e.y - b.e.y);
  if (!order.length) return fail('There is no currency in your backpack.');
  const held = new Map<CurrencyId, number>();
  const kept = new Map<number, number>();
  const full: string[] = [];
  let moved = 0;
  for (const { e, i } of order) {
    const stack = e.item as CurrencyStack;
    const id = stack.currencyId;
    const have = held.get(id) ?? currencyStashCount(ch, id);
    const n = Math.min(stack.count, CURRENCY_STASH_MAX - have);
    if (n <= 0) {
      const name = currencyName(id);
      if (!full.includes(name)) full.push(name);
      continue;
    }
    held.set(id, have + n);
    kept.set(i, stack.count - n);
    moved += n;
  }
  if (moved === 0) {
    return fail(`Your Crafting Stash is full of ${joinWords(full)}: a slot holds at most ${formatCount(CURRENCY_STASH_MAX)}.`);
  }
  const nextEntries: GridEntry[] = [];
  entries.forEach((e, i) => {
    const left = kept.get(i);
    if (left === undefined) nextEntries.push(e);
    else if (left > 0) nextEntries.push({ ...e, item: withCount(e.item as CurrencyStack, left) });
  });
  let next: CharacterSave = { ...ch, backpack: { ...ch.backpack, entries: nextEntries } };
  for (const [id, count] of held) next = withCurrencyStashCount(next, id, count);
  return ok(next);
}

export interface AddOptions {
  /**
   * Top up belt slots assigned to the same flask (including emptied ones) before the backpack.
   * Default true: pickups refill matching belt slots first (CONCEPTS §10). Pass false to keep the
   * belt untouched.
   */
  refillBelt?: boolean;
}

/**
 * The uid an incoming item keeps on this character: its own when it is free here (a minted-looking
 * one also moves nextUid past it, see adoptUid), otherwise a freshly minted one. Items come from other
 * characters (trades, public drops), whose "i…" counters overlap this one's.
 */
export function claimIncomingUid(ch: CharacterSave, item: Item): { ch: CharacterSave; item: Item } {
  const uid = item.uid;
  // Synthetic uids (belt slots, Crafting Stash slots, merchant previews) and malformed ones never become
  // an item's uid.
  if (!isReservedUid(uid) && !heldUids(ch).has(uid)) return { ch: adoptUid(ch, uid), item };
  const minted = mintUid(ch);
  return { ch: minted.character, item: { ...item, uid: minted.uid } };
}

/**
 * Place a new item into the backpack, stacking where possible. Flasks refill matching belt slots
 * first unless `refillBelt: false`. Atomic: fails (changing nothing) when it cannot all fit.
 * Uids stay unique: a uid the character already holds is re-minted, and a free minted-looking one
 * from another character moves nextUid past it (src/game/items/ids.ts).
 */
export function addToBackpack(ch: CharacterSave, item: Item, opts: AddOptions = {}): Result<CharacterSave> {
  const claimed = claimIncomingUid(ch, item);
  let c = claimed.ch;
  let incoming = claimed.item;
  if ((opts.refillBelt ?? true) && incoming.kind === 'flask') {
    const belt = beltSlots(c);
    let left = incoming.count;
    for (let i = 0; i < belt.length && left > 0; i++) {
      const s = belt[i];
      if (s && s.flaskId === incoming.flaskId && s.count < BELT_SLOT_CAPACITY) {
        const n = Math.min(BELT_SLOT_CAPACITY - s.count, left);
        belt[i] = { flaskId: s.flaskId, count: s.count + n };
        left -= n;
      }
    }
    c = { ...c, belt };
    if (left <= 0) return ok(c);
    incoming = { ...incoming, count: left };
  }
  const grid = autoPlace(c.backpack, incoming);
  return grid ? ok({ ...c, backpack: grid }) : fail('Your backpack is full.');
}

/**
 * Destroy an item (a belt uid clears that slot's assignment and charges; a Map Stash map goes too). A
 * Crafting Stash slot is never discarded (or dropped on the floor) as a whole: take a stack out first.
 */
export function discardItem(ch: CharacterSave, uid: string): Result<CharacterSave> {
  const found = findItem(ch, uid);
  if (!found) return fail(missingItemError(uid));
  if (found.location.kind === 'currencyStash') return fail('Take currency out of the Crafting Stash first.');
  return ok(removeItemAt(ch, found.location, uid));
}

// ---------------------------------------------------------------------------------------------
// Stash tabs
// ---------------------------------------------------------------------------------------------

export function createStashTab(name: string): StashTab {
  return { name, grid: createGrid(STASH_TAB_SIZE.w, STASH_TAB_SIZE.h) };
}

export function addStashTab(ch: CharacterSave): Result<CharacterSave> {
  if (ch.stash.length >= MAX_STASH_TABS) return fail(`The stash holds at most ${MAX_STASH_TABS} tabs.`);
  const names = new Set(ch.stash.map((t) => t.name));
  let n = ch.stash.length + 1;
  while (names.has(`Tab ${n}`)) n++;
  return ok({ ...ch, stash: [...ch.stash, createStashTab(`Tab ${n}`)] });
}

export function renameStashTab(ch: CharacterSave, tab: number, name: string): Result<CharacterSave> {
  if (!validStashTab(ch, tab)) return fail('That stash tab does not exist.');
  if (typeof name !== 'string') return fail('A stash tab needs a name.');
  const clean = name.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  if (!clean) return fail('A stash tab needs a name.');
  if (clean.length > STASH_TAB_NAME_MAX) return fail(`Stash tab names can be at most ${STASH_TAB_NAME_MAX} characters.`);
  const stash = ch.stash.slice();
  stash[tab] = { ...stash[tab], name: clean };
  return ok({ ...ch, stash });
}

// ---------------------------------------------------------------------------------------------
// "New" badges
// ---------------------------------------------------------------------------------------------

function stripNew<T extends Item>(item: T): T {
  if (!item.isNew) return item;
  const { isNew: _drop, ...rest } = item;
  return rest as T;
}

function clearGrid(grid: GridContainer): GridContainer {
  if (!grid.entries.some((e) => e.item.isNew)) return grid;
  return { ...grid, entries: grid.entries.map((e) => (e.item.isNew ? { ...e, item: stripNew(e.item) } : e)) };
}

/** Remove every "new" badge (backpack, stash, equipment, map device, Map Stash). */
export function clearNewFlags(ch: CharacterSave): CharacterSave {
  const equipment: CharacterSave['equipment'] = {};
  for (const [slot, item] of Object.entries(ch.equipment) as [EquipSlot, CharacterSave['equipment'][EquipSlot]][]) {
    if (item) equipment[slot] = stripNew(item);
  }
  const maps = mapStashOf(ch);
  return {
    ...ch,
    backpack: clearGrid(ch.backpack),
    stash: ch.stash.map((t) => {
      const grid = clearGrid(t.grid);
      return grid === t.grid ? t : { ...t, grid };
    }),
    equipment,
    mapDevice: ch.mapDevice ? stripNew(ch.mapDevice) : null,
    mapStash: maps.some((m) => m.isNew) ? maps.map(stripNew) : Array.isArray(ch.mapStash) ? ch.mapStash : [],
  };
}

export type { BeltSlot };
