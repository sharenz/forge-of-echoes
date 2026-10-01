// Rook's Sell tab: the offer window. Drag equipment out of the inventory (shown beside this panel) into the window to
// put it up for sale; every item shows Rook's appraisal breakdown and the footer the running total. Drag an item back
// out (or click its ×) to keep it. Nothing leaves the backpack until you confirm: then one atomic server command
// removes exactly the offered items and pays the displayed total, or changes nothing. Equipped gear is protected (it
// cannot be offered until you unequip it), and Ctrl/⌘-clicking backpack gear toggles it in the window as an extra.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { EquipmentItem } from '../../contracts/items';
import { Button, PixelIcon, cx } from '../components/common';
import { beginPointerDrag } from '../items/dnd';
import { isTradeLocked, safe, saleItemError } from '../items/hooks';
import { readCellPx } from '../items/ItemView';
import { itemIconId, itemTone } from '../lib/items';
import { useLocal } from '../local';
import { useSignal, useStore, useUi } from '../store';

/** "Base · Ashwood Wand: 1.25 Scrap" → the label and the amount, for a two-column breakdown. */
export function splitAppraisalLine(line: string): { label: string; amount: string } {
  const i = line.lastIndexOf(': ');
  return i < 0 ? { label: line, amount: '' } : { label: line.slice(0, i), amount: line.slice(i + 2) };
}

function OfferRow({ item, expanded, onToggle, busy }: { item: EquipmentItem; expanded: boolean; onToggle(): void; busy: boolean }) {
  const store = useStore(), local = useLocal();
  const ch = useUi((s) => s.character);
  const iconRef = useRef<HTMLSpanElement>(null);
  const quote = store.rules.sellQuote(item);
  if (!ch || !quote) return null;
  const name = store.rules.describeItem(item, ch).title;
  const locked = isTradeLocked(store.get(), item.uid);
  const entry = ch.backpack.entries.find((e) => e.item.uid === item.uid);

  const onPointerDown = (e: PointerEvent): void => {
    if (busy || !entry || (e.target as HTMLElement).closest('button')) return;
    const el = iconRef.current;
    if (!el) return;
    const size = safe(() => store.rules.itemSize(item), { w: 1, h: 1 });
    beginPointerDrag(e, store, local, {
      uid: item.uid, item, from: { kind: 'backpack', x: entry.x, y: entry.y }, size, el, cellPx: readCellPx(el), offsetX: 0, offsetY: 0,
      grab: { x: Math.floor((size.w - 1) / 2), y: Math.floor((size.h - 1) / 2) }, fromSale: true,
    });
  };
  const remove = (): void => {
    if (busy) return;
    const sale = local.merchantSale.get();
    if (sale) local.merchantSale.set({ ...sale, uids: sale.uids.filter((id) => id !== item.uid) });
    local.hideTooltip();
    store.actions.uiSound('click');
  };

  return (
    <div class={cx('fe-sell__item', 'fe-sell__item--selected', expanded && 'fe-sell__item--open')} data-sell-uid={item.uid}
      onPointerDown={onPointerDown as never}
      onPointerEnter={(e) => { if (!local.drag.get()) local.showTooltip({ kind: 'item', uid: item.uid }, e.currentTarget); }}
      onPointerLeave={() => local.hideTooltip()}>
      <div class="fe-sell__head">
        <span class={cx('fe-offer__icon', `fe-item--${itemTone(item)}`)} ref={iconRef}><PixelIcon id={itemIconId(item)} width={32} height={32} /></span>
        <span class="fe-sell__who">
          <span class="fe-sell__name" style={{ color: `var(--tone-${itemTone(item)})` }}>{name}</span>
          <span class="fe-sell__meta ui-type-caption">{locked ? 'Offered in trade' : `Item level ${item.itemLevel} · ${item.affixes.length} modifier${item.affixes.length === 1 ? '' : 's'}`}</span>
        </span>
        <button class="fe-sell__price ui-type-body" type="button" aria-expanded={expanded} aria-label={`Appraisal for ${name}: ${quote.scrap} Scrap`}
          title="Show Rook’s appraisal" onClick={onToggle}>
          <PixelIcon id="icon/currency/scrap" width={20} height={20} />{quote.scrap}
        </button>
        <button class="fe-sell__remove ui-type-body" type="button" aria-label={`Take ${name} out of the sale`} disabled={busy} title="Keep it" onClick={remove}>×</button>
      </div>
      {expanded && (
        <ul class="fe-sell__lines ui-type-caption" aria-label="Rook’s appraisal">
          {quote.lines.map((line, i) => {
            const { label, amount } = splitAppraisalLine(line);
            const total = i === quote.lines.length - 1;
            return <li key={i} class={cx(total && 'fe-sell__line--total')}><span>{label}</span>{amount && <b>{amount}</b>}</li>;
          })}
        </ul>
      )}
    </div>
  );
}

export function MerchantSell() {
  const store = useStore(), local = useLocal();
  const ch = useUi(s => s.character);
  const trade = useUi(s => s.trade);
  const online = useUi(s => s.connection === 'online');
  const sale = useSignal(local.merchantSale);
  const drag = useSignal(local.drag);
  const [open, setOpen] = useState<string | null>(null);
  const items = (sale?.uids ?? []).flatMap(uid => {
    const item = ch?.backpack.entries.find(e => e.item.uid === uid)?.item;
    return item?.kind === 'equipment' && !isTradeLocked(store.get(), uid) ? [item] : [];
  });
  const total = items.reduce((sum, i) => sum + (store.rules.sellQuote(i)?.scrap ?? 0), 0);

  // Moving, equipping or offering a selected item retires it from the pending sale.
  useEffect(() => {
    const current = local.merchantSale.get();
    if (!current || current.busy) return;
    const uids = current.uids.filter(uid => !saleItemError(store, uid));
    if (uids.length !== current.uids.length) local.merchantSale.set({ ...current, uids });
  }, [ch, trade, local, store]);
  // The item you just offered opens its appraisal.
  const last = items[items.length - 1]?.uid ?? null;
  const count = items.length;
  useEffect(() => { setOpen(count ? last : null); }, [last, count]);
  if (!ch || !sale) return null;

  const dropState = drag?.target?.sale ? (drag.target.valid ? 'valid' : 'invalid') : drag && !drag.stock && !drag.fromSale && drag.item.kind === 'equipment' ? 'ready' : null;

  const confirm = (): void => {
    if (sale.busy || !items.length) return;
    const uids = items.map(i => i.uid);
    const names = items.slice(0, 3).map(i => store.rules.describeItem(i, ch).title).join(', ') + (items.length > 3 ? ` and ${items.length - 3} more` : '');
    const uniques = items.filter(i => i.rarity === 'unique').length;
    local.hideTooltip();
    local.dialog.set({
      title: 'Sell equipment', confirmLabel: `Sell for ${total} Scrap`, danger: true,
      body: `${names}. ${uniques ? `Includes ${uniques} unique item${uniques === 1 ? '' : 's'}. ` : ''}Sell ${uids.length} item${uids.length === 1 ? '' : 's'} for ${total} Forge Scrap? Sold items are permanently removed.`,
      onConfirm: () => {
        const pending = { uids, busy: true };
        local.merchantSale.set(pending);
        void store.actions.sellItems(uids, total).then(ok => {
          if (local.merchantSale.get() === pending) local.merchantSale.set({ uids: ok ? [] : uids, busy: false });
        });
      },
    });
  };

  return <>
    <p class="fe-sell__intro ui-type-caption">Drag gear from your backpack into the window. Nothing is sold until you confirm.</p>
    <div class={cx('fe-sell__window', dropState && `fe-sell__window--${dropState}`)} data-drop="sale" aria-label="Items offered for sale">
      {items.length === 0 ? (
        <div class="fe-sell__empty ui-type-secondary">
          <span class="fe-sell__empty-mark" aria-hidden="true" />
          <span>Drop equipment here</span>
          <span class="fe-sell__empty-sub ui-type-caption">Worn gear stays protected. Ctrl-click also works.</span>
        </div>
      ) : items.map(item => (
        <OfferRow key={item.uid} item={item} busy={sale.busy} expanded={open === item.uid} onToggle={() => setOpen(open === item.uid ? null : item.uid)} />
      ))}
    </div>
    <div class="fe-sell__footer">
      <div class="fe-sell__total ui-type-body"><span>{items.length} offered</span><strong>{total} Forge Scrap</strong></div>
      <div class="fe-sell__actions">
        <Button disabled={sale.busy || !sale.uids.length} onClick={() => local.merchantSale.set({ uids: [], busy: false })}>Clear</Button>
        <Button variant="ember" disabled={sale.busy || !items.length || !online} onClick={confirm}>{sale.busy ? 'Selling…' : `Sell ${items.length || ''} item${items.length === 1 ? '' : 's'}`}</Button>
      </div>
    </div>
  </>;
}
