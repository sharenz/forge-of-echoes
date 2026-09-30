// Item interaction hooks shared by grids, equipment slots, the belt, the map device, the crafting bench and the
// trade window.
import type { Item, ItemLocation } from '../../contracts/items';
import type { UiState, UiStore } from '../../contracts/ui';
import type { Local } from '../local';
import { useStore, useUi } from '../store';
import { useMemo } from 'preact/hooks';
import { craftPending, keepArmedAfterApply, type PendingCraft } from '../lib/crafting';
import { withdrawCount } from '../lib/stash';
import { visiblePanels } from '../lib/panels';
import { offerAddError, offerWith, offerWithout } from '../lib/trade';
import { findScarab } from '../../data/scarabs';

export type CraftMark = 'armed' | 'valid' | 'invalid' | null;

/** Crafting state of one item while a currency is armed. */
export function useCraftMark(uid: string): { mark: CraftMark; error: string | null } {
  const store = useStore();
  const ch = useUi((s) => s.character);
  const armed = useUi((s) => s.armed);
  return useMemo(() => {
    if (!armed || !ch) return { mark: null, error: null };
    if (armed.uid === uid) return { mark: 'armed', error: null };
    const error = safe(() => store.rules.craftingTargetError(ch, armed.uid, uid), 'This item cannot be crafted.');
    return { mark: error ? 'invalid' : 'valid', error };
  }, [store, ch, armed, uid]);
}

/** Run a rules call defensively: a rules exception must never take the UI down. */
export function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch (err) {
    console.error('[ui] rules call failed', err);
    return fallback;
  }
}

/** Why an item cannot be moved, crafted or dropped right now: it is offered in the open trade. */
export const LOCKED_REASON = 'Offered in the trade. Take it out of your offer first.';

/** The item is part of your offer in the open trade (it stays in your backpack, locked). */
export function isTradeLocked(s: UiState, uid: string): boolean {
  return !!s.trade && s.trade.yourItems.some((i) => i.uid === uid);
}

/** Items the crafting bench accepts: gear (bench recipes and currency) and maps (map currency). */
export function benchAccepts(item: Item, uid: string): boolean {
  return (item.kind === 'equipment' || item.kind === 'map') && !uid.startsWith('belt:') && !uid.startsWith('cstash:');
}

/** Add to or take out of your trade offer (Ctrl-click and drag share it). Returns false with a hint on refusal. */
export function toggleOffer(store: UiStore, local: Local, uid: string, from: ItemLocation | null, at?: { x: number; y: number }): boolean {
  const trade = store.get().trade;
  if (!trade) return false;
  if (trade.yourItems.some((i) => i.uid === uid)) {
    store.actions.tradeOffer(offerWithout(trade, uid));
    store.actions.uiSound('click');
    return true;
  }
  const err = offerAddError(trade, uid, from);
  if (err) {
    store.actions.uiSound('error');
    local.flashHint(err, at?.x, at?.y);
    return false;
  }
  store.actions.tradeOffer(offerWith(trade, uid));
  store.actions.uiSound('click');
  return true;
}

/** Put an item on the crafting bench (a UI selection: the item stays where it is). */
export function placeOnBench(store: UiStore, local: Local, uid: string, item: Item, at?: { x: number; y: number }): boolean {
  const s = store.get();
  let err: string | null = null;
  if (!benchAccepts(item, uid)) err = 'The bench works on gear and maps.';
  else if (isTradeLocked(s, uid)) err = LOCKED_REASON;
  if (err) {
    store.actions.uiSound('error');
    local.flashHint(err, at?.x, at?.y);
    return false;
  }
  if (s.benchItemUid !== uid) {
    store.actions.setBenchItem(uid);
    store.actions.uiSound('equip');
  }
  return true;
}

/** Select equipment for a later confirmed sale; never removes an item here. */
export function saleItemError(store: UiStore, uid: string): string | null {
  const s = store.get();
  if (s.zone !== 'hideout') return 'Visit Rook in a hideout to sell equipment.';
  if (isTradeLocked(s, uid)) return LOCKED_REASON;
  const item = s.character?.backpack.entries.find(e => e.item.uid === uid)?.item;
  if (!item) return 'Unequip the item and put it in your backpack first.';
  return store.rules.sellQuote(item) ? null : 'Rook only buys equipment.';
}

export function selectForSale(store: UiStore, local: Local, uid: string, toggle = true, at?: { x: number; y: number }): void {
  const sale = local.merchantSale.get();
  const error = sale?.busy ? 'The sale is being saved.' : saleItemError(store, uid);
  if (error) { local.flashHint(error, at?.x, at?.y); store.actions.uiSound('error'); return; }
  const uids = sale?.uids ?? [];
  local.merchantSale.set({ busy: false, uids: uids.includes(uid) ? (toggle ? uids.filter(id => id !== uid) : uids) : [...uids, uid] });
  local.hideTooltip();
  store.actions.uiSound('click');
}

/**
 * Ctrl/⌘-click, by the visible left panel: the trade window adds / removes backpack items to / from your offer,
 * the crafting bench takes gear and maps onto the bench, an open map device takes maps (also from the Map Stash
 * picker in its panel); everything else uses the rules' quick move (equipped gear still unequips while you trade;
 * a Crafting Stash slot gives a stack, Shift+Ctrl exactly one). Ctrl/⌘+Shift-click on gear or a map in the stash
 * or the Map Stash puts it on the crafting bench and opens the bench (the stash and the bench share the left side).
 */
export function quickMoveItem(store: UiStore, local: Local, e: MouseEvent, uid: string, item: Item, from: ItemLocation): void {
  const s = store.get();
  const left = visiblePanels(s.openPanels).left;
  const at = { x: e.clientX, y: e.clientY };
  if (left === 'merchant') { selectForSale(store, local, uid, true, at); return; }
  if (left === 'trade' && s.trade && from.kind === 'backpack') {
    toggleOffer(store, local, uid, from, at);
    return;
  }
  if (isTradeLocked(s, uid)) {
    store.actions.uiSound('error');
    local.flashHint(LOCKED_REASON, at.x, at.y);
    return;
  }
  if (left === 'craftingBench' && benchAccepts(item, uid)) {
    placeOnBench(store, local, uid, item, at);
    return;
  }
  if (left === 'stash' && e.shiftKey && (from.kind === 'stash' || from.kind === 'mapStash') && benchAccepts(item, uid)) {
    if (!s.craftingAllowed) {
      store.actions.uiSound('error');
      local.flashHint('Crafting only works in a hideout.', at.x, at.y);
      return;
    }
    if (placeOnBench(store, local, uid, item, at)) {
      store.actions.uiSound('open');
      store.actions.openPanel('craftingBench');
    }
    return;
  }
  if (item.kind === 'map' && from.kind !== 'mapDevice' && s.isOwnHideout && s.openPanels.includes('mapDevice')) {
    if (store.actions.moveItem(uid, { kind: 'mapDevice' })) store.actions.uiSound('click');
    return;
  }
  if (item.kind === 'currency' && findScarab(item.currencyId) && from.kind !== 'scarabSlot' && s.isOwnHideout && left === 'mapDevice') {
    const index = Array.from({ length: 4 }, (_, i) => s.character?.mapScarabs?.[i] ?? null).findIndex(i => !i);
    if (index < 0) { local.flashHint('All four scarab sockets are filled.', at.x, at.y); return; }
    if (store.actions.moveItem(uid, { kind: 'scarabSlot', index })) store.actions.uiSound('click');
    return;
  }
  // A Crafting Stash slot gives a stack; with Shift exactly one.
  const count = from.kind === 'currencyStash' ? withdrawCount(e.shiftKey) : undefined;
  if (count === undefined) store.actions.quickMove(uid);
  else store.actions.quickMove(uid, count);
  store.actions.uiSound('click');
}

let suppressClickUntil = 0;
/** Called by the drag controller so the click that ends a drag is not treated as an item click. */
export function suppressNextClick(): void {
  suppressClickUntil = performance.now() + 80;
}

/** The click that is arriving ends a drag (see suppressNextClick): it must not act as a click. */
export function clickSuppressed(): boolean {
  return performance.now() < suppressClickUntil;
}

let pendingCraft: PendingCraft | null = null;

/** A craft on `target` is still waiting for the server (double-click guard shared by every craft entry point). */
export function craftInFlight(store: UiStore, target: string): boolean {
  const ch = store.get().character;
  return craftPending(pendingCraft, target, ch, performance.now());
}

/** Remember a craft sent on `target` (see craftInFlight). */
export function noteCraftSent(store: UiStore, target: string): void {
  pendingCraft = { target, character: store.get().character, at: performance.now() };
}

/**
 * Apply one currency stack to a target in one click (the crafting bench palette): the same arm → apply → disarm
 * sequence as right-click then left-click. Seal / Catalyst / Fracture Core open the affix choice and stay armed
 * until it is answered.
 */
export function applyCurrencyOnce(store: UiStore, local: Local, e: MouseEvent, currencyUid: string, targetUid: string): void {
  const s = store.get();
  const ch = s.character;
  if (!ch) return;
  if (!s.craftingAllowed) {
    store.actions.uiSound('error');
    local.flashHint('Crafting only works in a hideout.', e.clientX, e.clientY);
    return;
  }
  if (isTradeLocked(s, targetUid) || isTradeLocked(s, currencyUid)) {
    store.actions.uiSound('error');
    local.flashHint(LOCKED_REASON, e.clientX, e.clientY);
    return;
  }
  if (craftInFlight(store, targetUid)) return;
  const err = safe(() => store.rules.craftingTargetError(ch, currencyUid, targetUid), 'This item cannot be crafted.');
  if (err) {
    store.actions.uiSound('error');
    local.flashHint(err, e.clientX, e.clientY);
    return;
  }
  const found = safe(() => store.rules.findItem(ch, currencyUid), null);
  if (!found || found.item.kind !== 'currency') return;
  const needsChoice = !!store.rules.content.currencies[found.item.currencyId]?.needsAffixChoice;
  store.actions.armCurrency(currencyUid);
  if (store.get().armed?.uid !== currencyUid) return;
  // The affix popover needs the space; otherwise the (live) tooltip stays up and shows the result at once.
  if (needsChoice) local.hideTooltip();
  else noteCraftSent(store, targetUid);
  store.actions.applyArmed(targetUid);
  if (!needsChoice) store.actions.disarm();
}

/**
 * Left-click on an item: apply the armed currency once (Shift keeps it armed), or quick-move with Ctrl/⌘.
 * Crafts are irreversible, so a second click on the same item waits until the server has answered the first.
 */
export function itemClick(store: UiStore, local: Local, e: MouseEvent, uid: string, item: Item, from: ItemLocation): void {
  if (clickSuppressed()) return;
  const s = store.get();
  const ch = s.character;
  if (!ch) return;
  if (s.armed) {
    e.preventDefault();
    const armed = s.armed;
    if (armed.uid === uid) {
      store.actions.disarm();
      return;
    }
    if (craftInFlight(store, uid)) return;
    if (isTradeLocked(s, uid)) {
      store.actions.uiSound('error');
      local.flashHint(LOCKED_REASON, e.clientX, e.clientY);
      return;
    }
    const err = safe(() => store.rules.craftingTargetError(ch, armed.uid, uid), 'This item cannot be crafted.');
    if (err) {
      store.actions.uiSound('error');
      local.flashHint(err, e.clientX, e.clientY);
      return;
    }
    const needsChoice = !!store.rules.content.currencies[armed.currencyId]?.needsAffixChoice;
    // Keep the tooltip up so the result of the craft shows at once; the affix popover needs the space.
    if (needsChoice) local.hideTooltip();
    else noteCraftSent(store, uid);
    store.actions.applyArmed(uid);
    if (!keepArmedAfterApply(e.shiftKey, needsChoice)) store.actions.disarm();
    return;
  }
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    local.hideTooltip();
    quickMoveItem(store, local, e, uid, item, from);
  }
}

/** Right-click: arm a currency (hideout only); with a currency armed, right-click cancels. */
export function itemContextMenu(store: UiStore, local: Local, e: MouseEvent, uid: string, item: Item, from: ItemLocation): void {
  e.preventDefault();
  // macOS turns Ctrl+left-click into a context menu event (button 0) and sends no click: treat it as Ctrl-click.
  if (e.ctrlKey && e.button === 0) {
    itemClick(store, local, e, uid, item, from);
    return;
  }
  const s = store.get();
  if (s.armed) {
    store.actions.disarm();
    return;
  }
  if (item.kind !== 'currency') return;
  if (findScarab(item.currencyId)) {
    if (s.isOwnHideout && s.openPanels.includes('mapDevice')) quickMoveItem(store, local, e, uid, item, from);
    else local.flashHint('Open your Map Device to socket this scarab.', e.clientX, e.clientY);
    return;
  }
  if (isTradeLocked(s, uid)) {
    store.actions.uiSound('error');
    local.flashHint(LOCKED_REASON, e.clientX, e.clientY);
    return;
  }
  if (!s.craftingAllowed) {
    store.actions.uiSound('error');
    local.flashHint('Crafting only works in a hideout.', e.clientX, e.clientY);
    return;
  }
  local.hideTooltip();
  store.actions.armCurrency(uid);
}
