// One item drawn in a grid cell block or centred in a slot, with every inventory interaction wired:
// hover tooltip, drag & drop, Ctrl/⌘-click quick move, right-click arming, click-to-craft. It also shows
// three states owned by other panels: the stash search (grid items glow or dim), the trade lock (offered items
// stay in the backpack under a lock) and the crafting bench (the item currently on the bench).
import type { JSX } from 'preact';
import { useMemo, useRef } from 'preact/hooks';
import type { Item, ItemLocation } from '../../contracts/items';
import { PixelIcon, cx } from '../components/common';
import { useLocal } from '../local';
import { itemIconId, itemTone, stackCount } from '../lib/items';
import { useSignal, useStore, useUi } from '../store';
import { beginPointerDrag } from './dnd';
import { isTradeLocked, itemClick, itemContextMenu, quickMoveItem, safe, useCraftMark } from './hooks';
import { useSearch } from './search';

/** Pixel size of one inventory cell (the --cell custom property) at this element. */
export function readCellPx(el: Element): number {
  const v = parseFloat(getComputedStyle(el).getPropertyValue('--cell'));
  return Number.isFinite(v) && v > 0 ? v : 38;
}

interface ItemViewProps {
  item: Item;
  /** Usually item.uid; belt slots use the synthetic "belt:<i>". */
  uid: string;
  from: ItemLocation;
  mode: 'grid' | 'slot';
  x?: number;
  y?: number;
  /** Extra classes (e.g. belt empty state). */
  class?: string;
}

export function ItemView({ item, uid, from, mode, x = 0, y = 0, class: klass }: ItemViewProps) {
  const store = useStore();
  const local = useLocal();
  const ref = useRef<HTMLDivElement>(null);
  const sale = useSignal(local.merchantSale);
  const selling = !!sale?.uids.includes(uid);
  const size = useMemo(() => safe(() => store.rules.itemSize(item), { w: 1, h: 1 }), [store, item]);
  const { mark } = useCraftMark(uid);
  const tone = itemTone(item);
  const count = stackCount(item);
  const tier = item.kind === 'map' ? item.tier : null;
  const isNew = item.isNew === true;
  const empty = item.kind === 'flask' && item.count === 0;
  const locked = useUi((s) => isTradeLocked(s, uid));
  const benched = useUi((s) => s.benchItemUid === uid && s.openPanels.includes('craftingBench'));
  const search = useSearch();
  const inGrid = from.kind === 'backpack' || from.kind === 'stash';
  const found = search.active && inGrid ? search.matches.has(uid) : null;
  // an open panel (the Atlas area modal) can suggest what to drag: a subtle ring on the backpack items that fit it
  const fitting = useSignal(local.fits);
  const fits = from.kind === 'backpack' && !!fitting?.has(uid);

  const style: JSX.CSSProperties =
    mode === 'grid'
      ? {
          left: `calc(var(--cell) * ${x})`,
          top: `calc(var(--cell) * ${y})`,
          width: `calc(var(--cell) * ${size.w})`,
          height: `calc(var(--cell) * ${size.h})`,
        }
      : {};

  const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    const el = ref.current;
    if (!el) return;
    const cell = readCellPx(el);
    const r = el.getBoundingClientRect();
    const offsetX = mode === 'slot' ? (r.width - size.w * cell) / 2 : 0;
    const offsetY = mode === 'slot' ? (r.height - size.h * cell) / 2 : 0;
    beginPointerDrag(e as unknown as PointerEvent, store, local, { uid, item, from, size, el, cellPx: cell, offsetX, offsetY });
  };

  return (
    <div
      ref={ref}
      class={cx(
        'fe-item',
        `fe-item--${tone}`,
        mode === 'grid' ? 'fe-item--grid' : 'fe-item--slot',
        mark && `fe-item--craft-${mark}`,
        empty && 'fe-item--empty',
        found === true && 'fe-item--found',
        found === false && 'fe-item--dim',
        fits && 'fe-item--fits',
        locked && 'fe-item--locked',
        benched && 'fe-item--benched',
        selling && 'fe-item--selling',
        klass,
      )}
      style={style}
      data-uid={uid}
      data-tone={tone}
      data-kind={item.kind}
      // A map the open area modal suggests loads with a double-click, or with Enter / Space once focused (the keyboard path of the drag).
      tabIndex={fits ? 0 : undefined}
      role={fits ? 'button' : undefined}
      aria-label={fits ? 'Load into the Map Device (Enter)' : undefined}
      onDblClick={fits ? (e) => quickMoveItem(store, local, e as unknown as MouseEvent, uid, item, from) : undefined}
      onKeyDown={fits ? (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        quickMoveItem(store, local, { clientX: r.left, clientY: r.top, shiftKey: false } as MouseEvent, uid, item, from);
      } : undefined}
      onPointerDown={onPointerDown}
      onClick={(e) => itemClick(store, local, e as unknown as MouseEvent, uid, item, from)}
      onContextMenu={(e) => itemContextMenu(store, local, e as unknown as MouseEvent, uid, item, from)}
      onPointerEnter={(e) => {
        if (local.drag.get()) return;
        local.showTooltip({ kind: 'item', uid }, e.currentTarget);
      }}
      onPointerLeave={() => {
        const t = local.tooltip.get();
        if (t && t.spec.kind === 'item' && t.spec.uid === uid) local.hideTooltip();
      }}
    >
      <PixelIcon
        id={itemIconId(item)}
        class="fe-item__icon"
        width={`calc(var(--icon-cell) * ${size.w})`}
        height={`calc(var(--icon-cell) * ${size.h})`}
      />
      {count !== null && <span class="fe-item__count">{count}</span>}
      {tier !== null && <span class="fe-item__tier">T{tier}</span>}
      {selling && <span class="fe-item__sale">sell</span>}
      {isNew && !locked && !selling && <span class="fe-item__new">new</span>}
      {locked && <PixelIcon id="icon/ui/locked" class="fe-item__lock" width={16} height={16} />}
      {benched && !locked && <span class="fe-item__bench" title="On the crafting bench" />}
    </div>
  );
}
