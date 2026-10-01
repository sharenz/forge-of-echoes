// Rook the merchant (any hideout — visitors pay with their own currency): maps, supplies and class gambles, and he buys
// equipment. The panel opens beside the inventory and items move by drag and drop, like a Path of Exile vendor:
//   Buy / Gamble  drag a stock row onto your backpack (the drop cell picks the slot), or use its Buy button / Ctrl-click
//   Sell          drag equipment from the backpack into the offer window (see MerchantSell.tsx)
// Offers come from the shared rules (actions.merchantOffers); buying is a server command, so the server stays the judge.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { MerchantSell } from './MerchantSell';
import { MerchantMaps } from './MerchantMaps';
import { StockFilters, StockRow } from './MerchantStock';
import type { MerchantOffer } from '../../contracts/game';
import { iconIdForCurrency } from '../../contracts/content';
import { PixelIcon, cx } from '../components/common';
import { safe } from '../items/hooks';
import { useLocal } from '../local';
import { gamblePreview, unaffordableReason } from '../lib/merchant';
import { formatInt } from '../lib/format';
import { currencyHoldings } from '../lib/stash';
import { useSignal, useStore, useUi } from '../store';
import { PanelShell } from './PanelShell';

type Tab = 'buy' | 'maps' | 'gamble' | 'sell';

export function MerchantPanel() {
  const store = useStore();
  const local = useLocal();
  const sale = useSignal(local.merchantSale);
  const [stockTab, setStockTab] = useState<'buy' | 'maps' | 'gamble'>('buy');
  const [search, setSearch] = useState('');
  const [affordOnly, setAffordOnly] = useState(false);
  const tab: Tab = sale ? 'sell' : stockTab;
  useEffect(() => () => {
    local.merchantSale.set(null);
    if (local.dialog.get()?.title === 'Sell equipment') local.dialog.set(null);
  }, [local]);
  const ch = useUi((s) => s.character);
  const inHideout = useUi((s) => s.zone === 'hideout');
  const offers = useMemo(() => (ch && inHideout ? safe(() => store.actions.merchantOffers(), []) : []), [ch, inHideout, store]);
  // Rook takes Forge Scrap from the backpack, the stash tabs and the Crafting Stash alike.
  const scrap = useMemo(() => (ch ? currencyHoldings(ch, 'scrap') : { backpack: 0, stash: 0, crafting: 0 }), [ch]);
  if (!ch) return null;

  const currencies = store.rules.content.currencies;
  const currencyName = (id: MerchantOffer['price'][number]['currencyId']): string => currencies[id]?.name ?? id;
  const onHand = (id: MerchantOffer['price'][number]['currencyId']): number => {
    const h = currencyHoldings(ch, id);
    return h.backpack + h.stash + h.crafting;
  };
  const priceText = (o: MerchantOffer): string => (o.price.length === 0 ? 'free' : o.price.map((p) => `${p.count} ${currencyName(p.currencyId)}`).join(', '));

  const switchTab = (next: Tab): void => {
    if (sale?.busy) return;
    local.hideTooltip();
    if (next === 'sell') { if (!sale) local.merchantSale.set({ uids: [], busy: false }); return; }
    local.merchantSale.set(null);
    setStockTab(next);
    setSearch('');
  };

  const price = (o: MerchantOffer) =>
    o.price.length === 0 ? (
      <span class="fe-price fe-price--free">Free</span>
    ) : (
      o.price.map((p) => (
        <span class="fe-price" key={p.currencyId}>
          <PixelIcon id={iconIdForCurrency(p.currencyId)} width={20} height={20} />
          {p.count}
        </span>
      ))
    );

  const q = search.toLowerCase().trim();
  const match = (o: MerchantOffer): boolean => (!q || o.label.toLowerCase().includes(q)) && (!affordOnly || o.affordable);
  const supplies = offers.filter((o) => (o.kind === 'flask' || o.kind === 'currency') && match(o));
  const gambles = offers.filter((o) => o.kind === 'gamble' && match(o));

  const row = (o: MerchantOffer) => {
    const gamble = o.kind === 'gamble';
    const item = o.item ?? gamblePreview(o, store.rules.content.bases, ch.level);
    if (!item) return null;
    const blocked = unaffordableReason(o, currencyName, onHand);
    const note = o.price.length === 0 ? 'Rook gives this away for free.' : `Price: ${priceText(o)}.`;
    const verb = gamble ? 'Gamble' : 'Buy';
    return (
      <StockRow
        key={o.id}
        id={o.id}
        label={gamble ? o.label.replace(/^Gamble:\s*/, '') : o.label}
        sub={gamble ? `Random, item level ${ch.level}` : undefined}
        item={item}
        price={price(o)}
        blocked={blocked}
        tag={o.price.length === 0 ? 'Take it (free)' : `${verb} for ${priceText(o)}`}
        buyLabel={verb}
        tooltip={o.item ? { kind: 'preview', item: o.item, note } : { kind: 'text', title: o.label, lines: [o.description] }}
        onBuy={(at) => store.actions.buyOffer(o.id, at)}
      />
    );
  };

  const group = (title: string, list: MerchantOffer[]) =>
    list.length > 0 && (
      <section class="fe-merchant__group" key={title}>
        <div class="fe-section-title">{title}</div>
        <div class="fe-offers">{list.map(row)}</div>
      </section>
    );


  return (
    <PanelShell
      panel="merchant"
      title="Rook's Stall"
      class="fe-merchant fe-rook"
      aside={
        <span
          class="fe-wallet"
          title={`Forge Scrap you can spend: ${formatInt(scrap.backpack)} in your backpack, ${formatInt(scrap.stash)} in stash tabs, ${formatInt(scrap.crafting)} in the Crafting Stash`}
        >
          <PixelIcon id={iconIdForCurrency('scrap')} width={20} height={20} />
          {formatInt(scrap.backpack + scrap.stash + scrap.crafting)}
        </span>
      }
    >
      <div class="fe-rook__tabs" role="tablist" aria-label="Rook's services">
        {(['buy', 'maps', 'gamble', 'sell'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} disabled={sale?.busy} onClick={() => switchTab(t)}>
            {t === 'buy' ? 'Buy' : t === 'maps' ? 'Maps' : t === 'gamble' ? 'Gamble' : 'Sell'}
          </button>
        ))}
      </div>
      {!inHideout ? (
        <p class="fe-panel__note">Rook only trades in a hideout.</p>
      ) : tab === 'sell' ? (
        <MerchantSell />
      ) : tab === 'maps' ? (
        <div class={cx('fe-merchant__scroll', 'fe-stocklist')}><MerchantMaps />
          <p class="fe-panel__note ui-type-caption">Drag the row onto your backpack to buy it, or use its Buy button.</p></div>
      ) : (
        <>
          <StockFilters
            search={search}
            onSearch={setSearch}
            label="Search Rook's stock"
            placeholder={tab === 'buy' ? 'Search supplies…' : 'Search item classes…'}
            afford={{ on: affordOnly, toggle: () => setAffordOnly(!affordOnly) }}
          />
          <div class={cx('fe-merchant__scroll', 'fe-stocklist')} data-testid="rook-stock">
            {tab === 'buy' ? (
              <>
                {group('Supplies', supplies)}
                {supplies.length === 0 && <p class="fe-panel__note">Nothing matches. Clear the search or the filters.</p>}
              </>
            ) : (
              <>
                {group('Gamble', gambles)}
                {gambles.length === 0 && <p class="fe-panel__note">No item class matches.</p>}
              </>
            )}
          </div>
          <p class="fe-panel__note ui-type-caption">
            {tab === 'buy'
              ? 'Drag a stock row onto your backpack to buy it, or use its Buy button.'
              : 'Drag a class onto your backpack: it rolls a random item at your level and needs room for the largest of that class. Hover for the odds.'}
          </p>
        </>
      )}
    </PanelShell>
  );
}
