// Stock rows shared by Rook's stall and the Testing Merchant. A row is a drag source: drag it onto the backpack grid to
// buy it (the drop cell picks the slot, the ghost and the grid preview show whether it fits and can be paid); the Buy
// button and Ctrl/⌘-click on the row are the extras. Nothing here buys by itself: `onBuy` is the panel's server call.
import type { ComponentChildren } from 'preact';
import { useRef } from 'preact/hooks';
import type { Item } from '../../contracts/items';
import { PixelIcon, cx } from '../components/common';
import { beginPointerDrag } from '../items/dnd';
import { clickSuppressed, safe } from '../items/hooks';
import { readCellPx } from '../items/ItemView';
import { useLocal, type TooltipSpec } from '../local';
import { itemIconId, itemTone } from '../lib/items';
import { useStore } from '../store';

export interface StockRowProps {
  /** Shown on the row as data-offer (and data-debug-offer for the testing merchant). */
  id: string;
  debug?: boolean;
  label: string;
  /** Small second line (item level, stack size, what the gamble is). */
  sub?: string;
  /** What the row delivers: drives the icon, the drag ghost and the drop footprint. */
  item: Item;
  price: ComponentChildren;
  /** Why it cannot be bought right now (null when it can). Dragging still works and shows it in red. */
  blocked: string | null;
  /** Units delivered (bulk purchases reserve room for all of them). */
  total?: number;
  /** Ghost label on a valid drop ("Buy for 6 Forge Scrap"). */
  tag: string;
  buyLabel: string;
  tooltip: TooltipSpec;
  /** Runs the purchase; `at` is the backpack cell the row was dropped on. */
  onBuy(at?: { x: number; y: number }): void;
}

export function StockRow(p: StockRowProps) {
  const store = useStore();
  const local = useLocal();
  const iconRef = useRef<HTMLSpanElement>(null);
  const tone = itemTone(p.item);

  const onPointerDown = (e: PointerEvent): void => {
    if ((e.target as HTMLElement).closest('button')) return;
    const el = iconRef.current;
    if (!el) return;
    const size = safe(() => store.rules.itemSize(p.item), { w: 1, h: 1 });
    beginPointerDrag(e, store, local, {
      uid: p.item.uid, item: p.item, from: { kind: 'backpack', x: -1, y: -1 }, size, el, cellPx: readCellPx(el), offsetX: 0, offsetY: 0,
      grab: { x: Math.floor((size.w - 1) / 2), y: Math.floor((size.h - 1) / 2) },
      stock: { blocked: p.blocked, total: p.total ?? 1, tag: p.tag, buy: (at) => p.onBuy(at) },
    });
  };

  return (
    <div
      class={cx('fe-offer', 'fe-stock', p.blocked && 'fe-offer--poor')}
      data-offer={p.id}
      data-debug-offer={p.debug ? p.id : undefined}
      onPointerDown={onPointerDown as never}
      onClick={(e) => {
        if (clickSuppressed() || !(e.ctrlKey || e.metaKey) || (e.target as HTMLElement).closest('button')) return;
        e.preventDefault();
        local.hideTooltip();
        if (p.blocked) { store.actions.uiSound('error'); local.flashHint(p.blocked, e.clientX, e.clientY); return; }
        p.onBuy();
      }}
      onPointerEnter={(e) => { if (!local.drag.get()) local.showTooltip(p.tooltip, e.currentTarget); }}
      onPointerLeave={() => local.hideTooltip()}
    >
      <span class={cx('fe-offer__icon', `fe-item--${tone}`)} ref={iconRef}>
        <PixelIcon id={itemIconId(p.item)} width={32} height={32} class="fe-offer__img" />
      </span>
      <span class="fe-offer__text">
        <span class="fe-offer__label">{p.label}</span>
        {p.sub && <span class="fe-offer__sub ui-type-caption">{p.sub}</span>}
      </span>
      <span class="fe-offer__price">{p.price}</span>
      <button
        type="button"
        class={cx('fe-btn fe-btn--small', p.blocked && 'fe-btn--ghost')}
        disabled={!!p.blocked}
        title={p.blocked ?? 'Or drag the row onto your backpack'}
        onClick={() => { store.actions.uiSound('click'); local.hideTooltip(); p.onBuy(); }}
      >
        {p.buyLabel}
      </button>
    </div>
  );
}

/** Search box plus filter chips shared by the stock lists. */
export function StockFilters({ search, onSearch, label, placeholder, chips, afford }: {
  search: string;
  onSearch(v: string): void;
  label: string;
  placeholder: string;
  chips?: { id: string; label: string; active: boolean; onPick(): void }[];
  afford?: { on: boolean; toggle(): void };
}) {
  return (
    <div class="fe-stockfilters">
      <div class="fe-stockfilters__row">
        <input
          class="fe-stockfilters__search ui-type-secondary" type="search" aria-label={label} placeholder={placeholder}
          value={search} onInput={(e) => onSearch(e.currentTarget.value)}
        />
        {afford && <button type="button" class="fe-stockchip ui-type-caption" aria-pressed={afford.on} onClick={afford.toggle} title="Hide what you cannot pay for">Can afford</button>}
      </div>
      {chips && (
        <div class="fe-stockfilters__chips" role="group" aria-label="Filters">
          {chips.map((c) => (
            <button key={c.id} type="button" class="fe-stockchip ui-type-caption" aria-pressed={c.active} onClick={c.onPick}>{c.label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
