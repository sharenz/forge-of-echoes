// Rook's Sell tab: the vendor's window, a plain grid like his shelves. Drag equipment out of the inventory (shown beside this panel)
// into it to put it up for sale; the line under it shows what Rook pays. Hover an item for his appraisal. Drag an item back out
// (or Ctrl/Cmd-click or right-click it) to keep it. Nothing leaves the backpack until you press Accept and confirm: then one atomic
// server command removes exactly the offered items and pays the displayed total, or changes nothing. Equipped gear and items in a
// trade offer are protected (refused with a reason), and Ctrl/Cmd-clicking backpack gear toggles it in the window as an extra.
import { useEffect } from 'preact/hooks';
import { Button } from '../components/common';
import { isTradeLocked, saleItemError } from '../items/hooks';
import { VendorGrid, type VendorEntry } from '../items/VendorGrid';
import { useLocal } from '../local';
import { useSignal, useStore, useUi } from '../store';

export function MerchantSell() {
  const store = useStore(), local = useLocal();
  const ch = useUi(s => s.character);
  const trade = useUi(s => s.trade);
  const online = useUi(s => s.connection === 'online');
  const sale = useSignal(local.merchantSale);
  const drag = useSignal(local.drag);
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

  const entries: VendorEntry[] = items.map(item => {
    const quote = store.rules.sellQuote(item);
    const at = ch.backpack.entries.find(e => e.item.uid === item.uid);
    return {
      key: item.uid, attr: 'data-sell-uid', item,
      priceTag: String(quote?.scrap ?? 0),
      tooltip: { kind: 'preview', item, compare: false, appraisal: quote?.lines, price: { text: `Rook pays: ${quote?.scrap ?? 0} Scrap`, poor: false } },
      sale: {
        from: { x: at?.x ?? 0, y: at?.y ?? 0 },
        remove: () => { const cur = local.merchantSale.get(); if (cur && !cur.busy) local.merchantSale.set({ ...cur, uids: cur.uids.filter(id => id !== item.uid) }); },
      },
    };
  });

  return <>
    <div class="fe-vendor__hint ui-type-caption">Drag gear from your inventory into this window. Nothing is sold until you accept.</div>
    <div class="fe-vendor__scroll">
      <VendorGrid entries={entries} dropKind="sale" state={dropState} label="Items offered for sale" testId="rook-sell-grid" />
    </div>
    <div class="fe-sell__footer">
      <div class="fe-sell__total ui-type-body" data-testid="rook-sell-total"><span>{items.length ? `${items.length} offered` : 'Nothing offered'}</span><strong>Rook pays {total} Scrap</strong></div>
      <div class="fe-sell__actions">
        <Button disabled={sale.busy || !sale.uids.length} onClick={() => local.merchantSale.set({ uids: [], busy: false })}>Clear</Button>
        <Button variant="ember" disabled={sale.busy || !items.length || !online} onClick={confirm} data-testid="rook-sell-accept">{sale.busy ? 'Selling…' : 'Accept'}</Button>
      </div>
    </div>
  </>;
}
