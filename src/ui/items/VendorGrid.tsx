// A vendor's window: the same grid, item boxes, icons, rarity frames and hover card as the inventory and stash, filled with
// Rook's stock (or, on the Sell tab, with what you put up for sale). Nothing special: items sit at their natural sizes on cells
// chosen by lib/merchant.ts packVendor. Buying works like a Path of Exile vendor: drag an item onto your backpack (the drop cell
// picks the slot; the grid shows green or red), or Ctrl/Cmd-click / right-click it to buy into the first free spot.
import { useMemo, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import type { Item } from '../../contracts/items';
import { PixelIcon, cx } from '../components/common';
import { itemIconId, itemTone, stackCount } from '../lib/items';
import { VENDOR_COLS, packVendor, roomAnywhere } from '../lib/merchant';
import { useLocal, type TooltipSpec } from '../local';
import { useSignal, useStore } from '../store';
import { beginPointerDrag } from './dnd';
import { clickSuppressed, safe } from './hooks';
import { readCellPx } from './ItemView';

const cells = (n: number): string => `calc(var(--cell) * ${n})`;

export interface VendorEntry {
  /** Stable key: the ware id, the staple's offer id or the item's uid in a sale. */
  key: string;
  item: Item;
  /** Sold / gone: keeps its cells (so the layout never shifts) but draws nothing. */
  hidden?: boolean;
  /** Shown as data-ware / data-offer / data-sell-uid for tests. */
  attr: 'data-ware' | 'data-offer' | 'data-sell-uid';
  /** The board slot (data-ware-slot), for tests. */
  slot?: number;
  /** A very subtle cue for a lucky find. */
  luck?: 'good' | 'jackpot';
  /** The small price number shown over the item on hover only. */
  priceTag?: string;
  /** Poor: the price cannot be paid (the number turns red). */
  poor?: boolean;
  tooltip: TooltipSpec;
  /** Purchase drag (a stock entry), or the sale drag (an item offered to Rook). */
  stock?: { blocked: string | null; tag: string; buy(at?: { x: number; y: number }): void };
  /** A sale entry: the item stays in the backpack; dragging it out of the window takes it out of the sale. */
  sale?: { from: { x: number; y: number }; remove(): void };
}

function VendorItem({ entry, x, y }: { entry: VendorEntry; x: number; y: number }) {
  const store = useStore();
  const local = useLocal();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useSignal(local.drag);
  const { item } = entry;
  const size = useMemo(() => safe(() => store.rules.itemSize(item), { w: 1, h: 1 }), [store, item]);
  const tone = itemTone(item);
  const count = stackCount(item);
  const tier = item.kind === 'map' ? item.tier : null;

  const act = (e: MouseEvent): void => {
    local.hideTooltip();
    if (entry.sale) { entry.sale.remove(); store.actions.uiSound('click'); return; }
    const stock = entry.stock;
    if (!stock) return;
    if (stock.blocked) { store.actions.uiSound('error'); local.flashHint(stock.blocked, e.clientX, e.clientY); return; }
    const ch = store.get().character;
    if (ch && !roomAnywhere(ch.backpack, item)) {
      store.actions.uiSound('error');
      local.flashHint('Your backpack has no room for this.', e.clientX, e.clientY);
      return;
    }
    stock.buy();
  };

  const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    const el = ref.current;
    if (!el) return;
    const cell = readCellPx(el);
    if (entry.sale) {
      beginPointerDrag(e as unknown as PointerEvent, store, local, {
        uid: item.uid, item, from: { kind: 'backpack', x: entry.sale.from.x, y: entry.sale.from.y }, size, el, cellPx: cell, offsetX: 0, offsetY: 0, fromSale: true,
      });
    } else if (entry.stock) {
      beginPointerDrag(e as unknown as PointerEvent, store, local, {
        uid: item.uid, item, from: { kind: 'backpack', x: -1, y: -1 }, size, el, cellPx: cell, offsetX: 0, offsetY: 0,
        stock: { blocked: entry.stock.blocked, total: 1, tag: entry.stock.tag, buy: (at) => entry.stock!.buy(at) },
      });
    }
  };

  return (
    <div
      ref={ref}
      class={cx(
        'fe-item', `fe-item--${tone}`, 'fe-item--grid', 'fe-item--vendor', entry.poor && 'fe-item--poor',
        entry.luck && `fe-item--${entry.luck}`, drag?.uid === item.uid && 'fe-item--lifted',
      )}
      style={{ left: cells(x), top: cells(y), width: cells(size.w), height: cells(size.h) }}
      data-uid={item.uid}
      data-tone={tone}
      data-kind={item.kind}
      data-quality={entry.luck}
      data-ware-slot={entry.slot}
      {...{ [entry.attr]: entry.key }}
      onPointerDown={onPointerDown}
      onClick={(e) => { if (clickSuppressed()) return; if (e.ctrlKey || e.metaKey) { e.preventDefault(); act(e as unknown as MouseEvent); } }}
      onContextMenu={(e) => { e.preventDefault(); act(e as unknown as MouseEvent); }}
      onPointerEnter={(e) => { if (!local.drag.get()) local.showTooltip(entry.tooltip, e.currentTarget); }}
      onPointerLeave={() => local.hideTooltip()}
    >
      <PixelIcon id={itemIconId(item)} class="fe-item__icon" width={`calc(var(--icon-cell) * ${size.w})`} height={`calc(var(--icon-cell) * ${size.h})`} />
      {count !== null && count > 1 && <span class="fe-item__count">{count}</span>}
      {tier !== null && <span class="fe-item__tier">T{tier}</span>}
      {entry.priceTag && <span class="fe-item__price ui-type-caption">{entry.priceTag}</span>}
    </div>
  );
}

/** Items on a plain grid. `state` colours the frame while a drag hovers (the sale window); `dropKind` marks it as a drop target. */
export function VendorGrid({ entries, rows: minRows, state, dropKind, label, testId }: {
  entries: VendorEntry[];
  rows?: number;
  state?: 'ready' | 'valid' | 'invalid' | null;
  dropKind?: 'sale';
  label: string;
  testId?: string;
}) {
  const store = useStore();
  const sizes = entries.map((e) => ({ key: e.key, ...safe(() => store.rules.itemSize(e.item), { w: 1, h: 1 }) }));
  const { placements, rows } = packVendor(sizes, VENDOR_COLS, minRows);
  const at = new Map(placements.map((p) => [p.key, p]));
  return (
    <div
      class={cx('fe-grid fe-solid fe-vendorgrid', state && `fe-vendorgrid--${state}`)}
      style={{ width: cells(VENDOR_COLS), height: cells(rows) }}
      data-drop={dropKind}
      data-testid={testId}
      role="group"
      aria-label={label}
    >
      {entries.map((e) => {
        const p = at.get(e.key);
        return p && !e.hidden ? <VendorItem key={e.key} entry={e} x={p.x} y={p.y} /> : null;
      })}
    </div>
  );
}
