// Pointer-driven drag & drop for items. The item follows the cursor keeping the grabbed cell under it; the
// hovered grid shows a green/red footprint and slots light up. The special stash tabs are position-free targets
// (data-drop="currencyStash" / "mapStash", on the tab buttons and on their pages): a currency or map dropped there
// files itself; the map device's picker (data-drop="mapPicker") loads a map dropped on it into the device. A Crafting Stash slot drags out as a stack (`cstash:<id>`; the rules take up to a full stack). Validity comes from the SAME pure rule the
// server runs (rules.moveItem), so the preview never lies. Two targets are not item locations: the crafting
// bench slot (places the item on the bench; it stays where it is) and your side of the trade window (adds it
// to your offer). Dropping over the world puts the item on the floor at your feet (actions.dropItem): a
// public drop anyone nearby can pick up. Only a release over the world itself counts: releasing outside the
// window, or over any UI surface that is not a drop target, cancels the drag and the item stays where it was.
import type { Item, ItemLocation } from '../../contracts/items';
import type { UiStore } from '../../contracts/ui';
import type { DragState, DropTarget, Local } from '../local';
import { cellAt, grabCell, placementOrigin, type Size } from '../lib/grid';
import { locationKey, sameLocation } from '../lib/items';
import { disturbsOffer, offerAddError } from '../lib/trade';
import { LOCKED_REASON, benchAccepts, isTradeLocked, placeOnBench, safe, suppressNextClick, toggleOffer } from './hooks';

const DRAG_THRESHOLD = 5;

export interface DragSource {
  uid: string;
  item: Item;
  from: ItemLocation;
  size: Size;
  /** The element the item is drawn in (its box defines the grab cell). */
  el: HTMLElement;
  /** Cell size in px of the source (slots draw items centred in a larger box). */
  cellPx: number;
  /** Offset of the item footprint inside `el` (centred items in slots). */
  offsetX: number;
  offsetY: number;
}

/** Arm a potential drag on pointerdown; it becomes a drag after a few pixels of movement. */
export function beginPointerDrag(e: PointerEvent, store: UiStore, local: Local, src: DragSource): void {
  if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
  if (store.get().armed || local.drag.get()) return;
  const startX = e.clientX;
  const startY = e.clientY;
  let started = false;

  const move = (ev: PointerEvent): void => {
    local.pointer.x = ev.clientX;
    local.pointer.y = ev.clientY;
    if (!started) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
      // An item in your trade offer stays put until you take it back out of the offer.
      if (isTradeLocked(store.get(), src.uid)) {
        stop();
        store.actions.uiSound('error');
        local.flashHint(LOCKED_REASON, ev.clientX, ev.clientY);
        return;
      }
      started = true;
      const r = src.el.getBoundingClientRect();
      const grab = grabCell(startX - r.left - src.offsetX, startY - r.top - src.offsetY, src.cellPx, src.size);
      local.hideTooltip();
      local.drag.set({ uid: src.uid, item: src.item, from: src.from, size: src.size, grab, cellPx: src.cellPx, target: null });
      store.actions.uiSound('hover');
    }
    const d = local.drag.get();
    if (!d) return;
    const target = resolveTarget(ev.clientX, ev.clientY, d, store);
    if ((target?.key ?? null) !== (d.target?.key ?? null)) local.drag.set({ ...d, target });
  };

  const stop = (): void => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('blur', cancelBlur);
  };
  const end = (ev: PointerEvent): void => {
    stop();
    if (!started) return;
    suppressNextClick();
    const d = local.drag.get();
    local.drag.set(null);
    if (!d) return;
    const target = resolveTarget(ev.clientX, ev.clientY, d, store);
    drop(d, target, store, local, ev);
  };
  const cancel = (): void => {
    stop();
    local.drag.set(null);
  };
  const cancelBlur = (): void => cancel();

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('blur', cancelBlur);
}

function drop(d: DragState, target: DropTarget | null, store: UiStore, local: Local, ev: PointerEvent): void {
  if (!target) return;
  const at = { x: ev.clientX, y: ev.clientY };
  if (target.world) {
    if (!target.valid) {
      store.actions.uiSound('error');
      if (target.reason) local.flashHint(target.reason, ev.clientX, ev.clientY);
      return;
    }
    store.actions.dropItem(d.uid);
    store.actions.uiSound('click');
    return;
  }
  if (target.bench) {
    placeOnBench(store, local, d.uid, d.item, at);
    return;
  }
  if (target.offer) {
    if (target.noop) return;
    toggleOffer(store, local, d.uid, d.from, at);
    return;
  }
  if (target.noop || !target.loc) return;
  if (!target.valid) {
    store.actions.uiSound('error');
    if (target.reason) local.flashHint(target.reason, ev.clientX, ev.clientY);
    return;
  }
  const ok = store.actions.moveItem(d.uid, target.loc);
  store.actions.uiSound(target.loc.kind === 'equipment' ? 'equip' : 'click');
  if (!ok) store.actions.uiSound('error');
}

/**
 * Why the world refuses a dragged item (dropItem takes backpack, equipment, belt, stash and Map Stash items; a
 * Crafting Stash slot is refused by the rules with the same words).
 */
const MAP_DEVICE_FLOOR_REASON = 'Take the map out of the device first.';

/**
 * Where a drop on the map device's picker (data-drop="mapPicker", the Map Stash inside the device panel) goes: a map
 * from the backpack or the stash loads into the device; the device's own map goes back into the Map Stash, and a
 * picker row dropped on the picker stays where it is.
 */
export function pickerDropKind(d: { item: Item; from: ItemLocation }): 'mapDevice' | 'mapStash' {
  return d.item.kind === 'map' && d.from.kind !== 'mapDevice' && d.from.kind !== 'mapStash' ? 'mapDevice' : 'mapStash';
}
const CURRENCY_STASH_FLOOR_REASON = 'Take currency out of the Crafting Stash first.';

/** Work out what is under the pointer and whether the dragged item may go there. */
export function resolveTarget(x: number, y: number, d: DragState, store: UiStore): DropTarget | null {
  // Off the window (a release outside the browser) is never a drop: the item stays where it is.
  if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) return null;
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const dropEl = el.closest<HTMLElement>('[data-drop]');
  if (!dropEl) {
    if (el.closest('.fe-solid')) return null;
    const reason =
      d.from.kind === 'mapDevice' ? MAP_DEVICE_FLOOR_REASON : d.from.kind === 'currencyStash' ? CURRENCY_STASH_FLOOR_REASON : null;
    return { key: 'world', loc: null, valid: !reason, reason, noop: false, world: true };
  }
  const kind = dropEl.dataset.drop;
  const s = store.get();
  if (kind === 'bench') {
    const valid = benchAccepts(d.item, d.uid) && !isTradeLocked(s, d.uid);
    const reason = valid ? null : benchAccepts(d.item, d.uid) ? LOCKED_REASON : 'The bench works on gear and maps.';
    return { key: 'bench', loc: null, valid, reason, noop: s.benchItemUid === d.uid, bench: true };
  }
  if (kind === 'offer') {
    if (!s.trade) return null;
    const already = s.trade.yourItems.some((i) => i.uid === d.uid);
    const reason = offerAddError(s.trade, d.uid, d.from);
    return { key: 'offer', loc: null, valid: !reason, reason, noop: already, offer: true };
  }
  let loc: ItemLocation | null = null;
  let grid: DropTarget['grid'];
  let origin: DropTarget['origin'];
  if (kind === 'backpack' || kind === 'stash') {
    const gw = Number(dropEl.dataset.w);
    const gh = Number(dropEl.dataset.h);
    const cell = cellAt(x, y, dropEl.getBoundingClientRect(), { w: gw, h: gh });
    if (!cell) return null;
    origin = placementOrigin(cell, d.grab, d.size, { w: gw, h: gh });
    if (kind === 'backpack') {
      loc = { kind: 'backpack', x: origin.x, y: origin.y };
      grid = { kind: 'backpack' };
    } else {
      const tab = Number(dropEl.dataset.tab);
      loc = { kind: 'stash', tab, x: origin.x, y: origin.y };
      grid = { kind: 'stash', tab };
    }
  } else if (kind === 'equip') {
    loc = { kind: 'equipment', slot: dropEl.dataset.slot as never };
  } else if (kind === 'belt') {
    loc = { kind: 'belt', index: Number(dropEl.dataset.index) };
  } else if (kind === 'mapDevice') {
    loc = { kind: 'mapDevice' };
  } else if (kind === 'currencyStash') {
    // Either Crafting Stash tab (its button or its page): a currency always files into its own slot.
    loc = { kind: 'currencyStash' };
  } else if (kind === 'mapStash') {
    loc = { kind: 'mapStash' };
  } else if (kind === 'mapPicker') {
    loc = { kind: pickerDropKind(d) };
  }
  if (!loc) return null;
  // Several elements can stand for one location (a special tab's button and its page): the key tells them apart.
  const key = dropEl.dataset.dropId ? `${locationKey(loc)}@${dropEl.dataset.dropId}` : locationKey(loc);
  if (sameLocation(loc, d.from)) return { key, loc, valid: true, reason: null, noop: true, grid, origin };
  const ch = s.character;
  if (!ch) return null;
  const res = safe(() => store.rules.moveItem(ch, d.uid, loc!), { ok: false as const, error: 'That does not fit there.' });
  // A move may swap an offered item out of the way or merge a stack into it: offered items stay exactly as offered.
  if (res.ok && s.trade && disturbsOffer(s.trade.yourItems, ch, res.value)) {
    return { key, loc, valid: false, reason: LOCKED_REASON, noop: false, grid, origin };
  }
  return { key, loc, valid: res.ok, reason: res.ok ? null : res.error, noop: false, grid, origin };
}
