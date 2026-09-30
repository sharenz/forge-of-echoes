import { useMemo, useState } from 'preact/hooks';
import type { DebugMerchantOptions } from '../../contracts/game';
import { DEBUG_MERCHANT_DEFAULTS, DEBUG_MERCHANT_NAME, debugMerchantOffers, type DebugMerchantCategory } from '../../game/progression/debug-merchant';
import { Button, PixelIcon } from '../components/common';
import { useLocal } from '../local';
import { itemIconId } from '../lib/items';
import { useStore, useUi } from '../store';
import { PanelShell } from './PanelShell';

const CATEGORIES: readonly DebugMerchantCategory[] = ['Scarabs', 'Supplies', 'Maps', 'Bases', 'Uniques', 'Flasks'];

export function DebugMerchantPanel() {
  const store = useStore(), local = useLocal();
  const inHideout = useUi(s => s.zone === 'hideout');
  const [category, setCategory] = useState<DebugMerchantCategory>('Scarabs');
  const [search, setSearch] = useState('');
  const [options, setOptions] = useState<DebugMerchantOptions>({ ...DEBUG_MERCHANT_DEFAULTS });
  const offers = useMemo(() => debugMerchantOffers(options).filter(o => o.category === category
    && o.label.toLowerCase().includes(search.toLowerCase().trim())), [options, category, search]);
  const number = (field: 'quantity' | 'itemLevel' | 'mapTier', label: string, max: number) => <label class="ui-type-caption">
    {label}<input class="ui-type-body" aria-label={label} type="number" min="1" max={max} value={options[field]}
      onInput={e => setOptions({ ...options, [field]: Number(e.currentTarget.value) })} />
  </label>;
  return <PanelShell panel="debugMerchant" title="Testing Merchant" class="fe-merchant fe-debug-merchant">
    <p class="fe-panel__note ui-type-secondary">{DEBUG_MERCHANT_NAME} · Everything is free for you and visitors.</p>
    {!inHideout ? <p class="fe-panel__note">Visit an enabled hideout to buy test supplies.</p> : <>
      <div class="fe-debug-merchant__controls">
        <label class="ui-type-caption">Category<select class="ui-type-body" aria-label="Testing category" value={category}
          onChange={e => { setCategory(e.currentTarget.value as DebugMerchantCategory); setSearch(''); }}>
          {CATEGORIES.map(c => <option value={c} key={c}>{c}</option>)}
        </select></label>
        {number('quantity', 'Quantity', 100)}
        {(category === 'Bases' || category === 'Uniques') && number('itemLevel', 'Item level', 99)}
        {category === 'Maps' && number('mapTier', 'Map tier', 15)}
        {(category === 'Bases' || category === 'Maps') && <label class="ui-type-caption">Rarity<select class="ui-type-body" aria-label="Testing rarity" value={options.rarity}
          onChange={e => setOptions({ ...options, rarity: e.currentTarget.value as DebugMerchantOptions['rarity'] })}>
          <option value="normal">Normal</option><option value="magic">Magic</option><option value="rare">Rare</option>
        </select></label>}
      </div>
      <input class="fe-debug-merchant__search ui-type-body" aria-label="Search testing stock" placeholder={`Search ${category.toLowerCase()}…`} value={search}
        onInput={e => setSearch(e.currentTarget.value)} />
      <div class="fe-merchant__scroll">
        <div class="fe-offers">
          {offers.map(o => <div class="fe-offer" key={o.id} data-debug-offer={o.id}
            onPointerEnter={e => local.showTooltip({ kind: 'preview', item: o.item,
              note: 'Free. Items go to your backpack; flasks refill your belt first. Equipment and map rolls are examples; purchases roll fresh values.' }, e.currentTarget)}
            onPointerLeave={() => local.hideTooltip()}>
            <span class="fe-offer__icon"><PixelIcon id={itemIconId(o.item)} width={32} height={32} /></span>
            <span class="fe-offer__label">{o.label}</span><span class="fe-price fe-price--free">Free</span>
            <Button size="small" onClick={() => store.actions.buyDebugOffer(o.id, options)}>Buy</Button>
          </div>)}
        </div>
        {!offers.length && <p class="fe-panel__note">No matches. Check your search and selected values.</p>}
      </div>
      <p class="fe-panel__note ui-type-caption">Buy 1–100 at a time. Purchases must fit in your backpack. Item requirements still apply.</p>
    </>}
  </PanelShell>;
}
