import { useEffect } from 'preact/hooks';
import { Button, PixelIcon, cx } from '../components/common';
import { isTradeLocked, saleItemError, selectForSale } from '../items/hooks';
import { itemIconId, itemTone } from '../lib/items';
import { useLocal } from '../local';
import { useSignal, useStore, useUi } from '../store';

export function MerchantSell() {
  const store = useStore(), local = useLocal();
  const ch = useUi(s => s.character);
  const trade = useUi(s => s.trade);
  const online = useUi(s => s.connection === 'online');
  const sale = useSignal(local.merchantSale);
  const drag = useSignal(local.drag);
  const items = ch?.backpack.entries.map(e => e.item).filter(i => i.kind === 'equipment') ?? [];
  const selected = items.filter(i => sale?.uids.includes(i.uid) && !isTradeLocked(store.get(), i.uid));
  const total = selected.reduce((sum, i) => sum + (store.rules.sellQuote(i)?.scrap ?? 0), 0);

  // Moving, equipping or offering a selected item retires it from the pending sale.
  useEffect(() => {
    const current = local.merchantSale.get();
    if (!current || current.busy) return;
    const uids = current.uids.filter(uid => !saleItemError(store, uid));
    if (uids.length !== current.uids.length) local.merchantSale.set({ ...current, uids });
  }, [ch, trade, local, store]);
  if (!ch || !sale) return null;

  const confirm = (): void => {
    if (sale.busy || !selected.length) return;
    const uids = selected.map(i => i.uid);
    const names = selected.slice(0, 3).map(i => store.rules.describeItem(i, ch).title).join(', ') + (selected.length > 3 ? ` and ${selected.length - 3} more` : '');
    const uniques = selected.filter(i => i.rarity === 'unique').length;
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
    <p class="fe-sell__intro ui-type-secondary">Select backpack equipment below, Ctrl-click it, or drag it here. Items stay yours until you confirm.</p>
    <div class={cx('fe-sell__stock', drag?.target?.sale && (drag.target.valid ? 'fe-sell__stock--valid' : 'fe-sell__stock--invalid'))} data-drop="sale">
      {items.length === 0 && <p class="fe-panel__note">No equipment to sell. Put unequipped gear in your backpack.</p>}
      {items.map(item => {
        const quote = store.rules.sellQuote(item)!;
        const locked = isTradeLocked(store.get(), item.uid);
        const picked = selected.some(i => i.uid === item.uid);
        const name = store.rules.describeItem(item, ch).title;
        return <div class={cx('fe-sell__item', picked && 'fe-sell__item--selected')} key={item.uid} data-sell-uid={item.uid}>
          <button class="fe-sell__choose" type="button" aria-pressed={picked} aria-label={`${picked ? 'Remove' : 'Select'} ${name}`} disabled={sale.busy || locked}
            onClick={() => selectForSale(store, local, item.uid)}
            onPointerEnter={e => local.showTooltip({ kind: 'item', uid: item.uid }, e.currentTarget)} onPointerLeave={() => local.hideTooltip()}>
            <PixelIcon id={itemIconId(item)} width={32} height={32} />
            <span><span class="fe-sell__name" style={{ color: `var(--tone-${itemTone(item)})` }}>{name}</span>
              <span class="fe-sell__meta ui-type-caption">{locked ? 'Offered in trade' : `Item level ${item.itemLevel} · ${item.affixes.length} modifiers`}</span></span>
            <span aria-hidden="true">{picked ? '✓' : '+'}</span>
          </button>
          <button class="fe-sell__price ui-type-body" type="button" aria-label={`Appraisal for ${name}: ${quote.scrap} Scrap`}
            onPointerEnter={e => local.showTooltip({ kind: 'text', title: 'Rook’s appraisal', lines: quote.lines }, e.currentTarget)}
            onPointerLeave={() => local.hideTooltip()}
            onFocus={e => local.showTooltip({ kind: 'text', title: 'Rook’s appraisal', lines: quote.lines }, e.currentTarget)} onBlur={() => local.hideTooltip()}>
            <PixelIcon id="icon/currency/scrap" width={20} height={20} />{quote.scrap}
          </button>
        </div>;
      })}
    </div>
    <div class="fe-sell__footer">
      <div class="fe-sell__total ui-type-body"><span>{selected.length} selected</span><strong>{total} Forge Scrap</strong></div>
      <p class="fe-panel__note">Hover a price for its appraisal. Scrap goes to your Crafting Stash; overflow goes to your backpack.</p>
      <div class="fe-sell__actions">
        <Button disabled={sale.busy || !sale.uids.length} onClick={() => local.merchantSale.set({ uids: [], busy: false })}>Clear</Button>
        <Button variant="ember" disabled={sale.busy || !selected.length || !online} onClick={confirm}>{sale.busy ? 'Selling…' : `Sell ${selected.length || ''} item${selected.length === 1 ? '' : 's'}`}</Button>
      </div>
    </div>
  </>;
}
