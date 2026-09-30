// Rook the merchant (any hideout — visitors pay with their own currency): maps, supplies and class gambles. Offers come from the shared rules
// (actions.merchantOffers); buying is a server command.
import { useEffect, useMemo } from 'preact/hooks';
import { MerchantSell } from './MerchantSell';
import type { MerchantOffer } from '../../contracts/game';
import { iconIdForBase, iconIdForCurrency } from '../../contracts/content';
import { Button, PixelIcon, cx } from '../components/common';
import { safe } from '../items/hooks';
import { useLocal } from '../local';
import { itemIconId } from '../lib/items';
import { formatInt } from '../lib/format';
import { useSignal, useStore, useUi } from '../store';
import { currencyHoldings } from '../lib/stash';
import { PanelShell } from './PanelShell';

const GROUPS: { kind: MerchantOffer['kind'][]; title: string }[] = [
  { kind: ['map'], title: 'Maps' },
  { kind: ['flask', 'currency'], title: 'Supplies' },
  { kind: ['gamble'], title: 'Gamble' },
];

export function MerchantPanel() {
  const store = useStore();
  const local = useLocal();
  const sale = useSignal(local.merchantSale);
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

  const gambleIcon = (o: MerchantOffer): string => {
    const base = Object.values(store.rules.content.bases).find((b) => b.itemClass === o.gambleClass);
    return base ? iconIdForBase(base.id) : iconIdForCurrency('scrap');
  };

  // The item card already describes the item: its footer only needs the price.
  const priceNote = (o: MerchantOffer): string =>
    o.price.length === 0
      ? 'Rook gives this away for free.'
      : `Price: ${o.price.map((p) => `${p.count} ${store.rules.content.currencies[p.currencyId]?.name ?? p.currencyId}`).join(', ')}.`;

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
        <button role="tab" aria-selected={!sale} disabled={sale?.busy} onClick={() => local.merchantSale.set(null)}>Buy</button>
        <button role="tab" aria-selected={!!sale} disabled={sale?.busy} onClick={() => { if (!sale) local.merchantSale.set({ uids: [], busy: false }); }}>Sell</button>
      </div>
      {!inHideout ? (
        <p class="fe-panel__note">Rook only trades in a hideout.</p>
      ) : sale ? <MerchantSell /> : (
        <div class="fe-merchant__scroll">
          {GROUPS.map((g) => {
            const list = offers.filter((o) => g.kind.includes(o.kind));
            if (!list.length) return null;
            return (
              <section key={g.title} class="fe-merchant__group">
                <div class="fe-section-title">{g.title}</div>
                <div class={cx('fe-offers', g.kind[0] === 'gamble' && 'fe-offers--gamble')}>
                  {list.map((o) => (
                    <div
                      key={o.id}
                      class={cx('fe-offer', !o.affordable && 'fe-offer--poor')}
                      onPointerEnter={(e) =>
                        o.item
                          ? local.showTooltip({ kind: 'preview', item: o.item, note: priceNote(o) }, e.currentTarget)
                          : local.showTooltip({ kind: 'text', title: o.label, lines: [o.description] }, e.currentTarget)
                      }
                      onPointerLeave={() => local.hideTooltip()}
                    >
                      <span class="fe-offer__icon">
                        <PixelIcon id={o.item ? itemIconId(o.item) : gambleIcon(o)} width={32} height={32} class="fe-offer__img" />
                      </span>
                      <span class="fe-offer__label">{o.kind === 'gamble' ? o.label.replace(/^Gamble:\s*/, '') : o.label}</span>
                      <span class="fe-offer__price">{price(o)}</span>
                      <Button
                        size="small"
                        variant={o.affordable ? 'default' : 'ghost'}
                        disabled={!o.affordable}
                        onClick={() => store.actions.buyOffer(o.id)}
                      >
                        {o.kind === 'gamble' ? 'Gamble' : 'Buy'}
                      </Button>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
          <p class="fe-panel__note ui-type-caption">Gambles roll a random item of that class at your level. Hover an offer for its odds.</p>
        </div>
      )}
    </PanelShell>
  );
}
