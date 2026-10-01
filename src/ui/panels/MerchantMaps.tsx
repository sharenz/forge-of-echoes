// Rook's Maps tab (brief D 5.4): Normal Tier 1 and 2 maps of the areas you have cleared, in three quality grades, priced by tier and
// quality. Pick an area (chips), a tier and a grade: ONE stock row appears (the generic list would flood with 30 rows) and is bought
// like every other Rook row: drag it onto your backpack (the drop cell picks the slot) or press its Buy button. The offers come from the
// shared rules (rules.rookMapOffers); the server re-derives the same offer from the id when you buy.
import { useMemo, useState } from 'preact/hooks';
import type { AtlasAreaId } from '../../contracts/atlas';
import type { MerchantOffer } from '../../contracts/game';
import { iconIdForCurrency } from '../../contracts/content';
import { ROOK_MAP_GRADES } from '../../data/progression';
import { atlasTierCeiling, findAtlasArea } from '../../data/progression/atlas';
import { emblemUrl } from '../../art/atlas/sprites';
import { PixelIcon, cx } from '../components/common';
import { safe } from '../items/hooks';
import { stockByArea } from '../atlas/lens';
import { unaffordableReason } from '../lib/merchant';
import { currencyHoldings } from '../lib/stash';
import { useStore, useUi } from '../store';
import { StockRow } from './MerchantStock';

export function MerchantMaps() {
  const store = useStore();
  const ch = useUi((s) => s.character);
  const deviceArea = useUi((s) => s.character?.mapDevice?.areaId ?? null);
  const areas = useMemo(() => (ch ? safe(() => store.rules.rookMapAreas(ch), [] as AtlasAreaId[]) : []), [ch, store]);
  const [pickedArea, setArea] = useState<AtlasAreaId | null>(null);
  const [pickedTier, setTier] = useState(1);
  const [gradeId, setGrade] = useState<string>('plain');
  const stock = useMemo(() => stockByArea(ch), [ch]);
  if (!ch) return null;
  const area = pickedArea && areas.includes(pickedArea) ? pickedArea : (deviceArea && areas.includes(deviceArea) ? deviceArea : areas.at(-1) ?? null);
  const def = area ? findAtlasArea(area) : null;
  const offers: MerchantOffer[] = area ? safe(() => store.rules.rookMapOffers(ch, area), []) : [];
  const tiers = [...new Set(offers.map((o) => Number((o.id.split(':')[2]))))].sort();
  const tier = tiers.includes(pickedTier) ? pickedTier : tiers[0] ?? 1;
  const offer = offers.find((o) => o.id.split(':')[2] === String(tier) && o.id.split(':')[3] === gradeId) ?? null;
  const currencies = store.rules.content.currencies;
  const currencyName = (id: MerchantOffer['price'][number]['currencyId']): string => currencies[id]?.name ?? id;
  const onHand = (id: MerchantOffer['price'][number]['currencyId']): number => { const h = currencyHoldings(ch, id); return h.backpack + h.stash + h.crafting; };
  const priceText = (o: MerchantOffer): string => (o.price.length === 0 ? 'free' : o.price.map((p) => `${p.count} ${currencyName(p.currencyId)}`).join(', '));
  const price = (o: MerchantOffer) => o.price.length === 0
    ? <span class="fe-price fe-price--free">Free</span>
    : o.price.map((p) => <span class="fe-price" key={p.currencyId}><PixelIcon id={iconIdForCurrency(p.currencyId)} width={20} height={20} />{p.count}</span>);
  const grade = ROOK_MAP_GRADES.find((g) => g.id === gradeId) ?? ROOK_MAP_GRADES[0];
  return (
    <div class="fe-rookmaps" data-testid="rook-maps">
      <p class="fe-panel__note ui-type-caption fe-rookmaps__intro">Maps of the areas you have cleared. Plain, Fine and Pristine maps differ only in quality; deeper maps are earned at the boss.</p>
      <div class="fe-rookmaps__areas" role="group" aria-label="Area">
        {areas.map((id) => {
          const a = findAtlasArea(id)!;
          const held = stock.get(id)?.count ?? 0;
          return (
            <button key={id} type="button" class="fe-stockchip fe-rookmaps__area ui-type-caption" aria-pressed={area === id} data-rook-area={id} onClick={() => { store.actions.uiSound('click'); setArea(id); }}>
              <img class="fe-px" src={emblemUrl(a.baseId, 24)} alt="" width={18} height={18} />{a.name}{held > 0 && <span class="fe-rookmaps__held"> · {held}</span>}
            </button>
          );
        })}
      </div>
      {def && offers.length > 0 ? (
        <>
          <div class="fe-rookmaps__pick">
            <div class="fe-rookmaps__group" role="group" aria-label="Tier">
              <span class="ui-type-caption fe-rookmaps__label">Tier</span>
              {tiers.map((t) => <button key={t} type="button" class="fe-stockchip ui-type-caption" aria-pressed={tier === t} data-rook-tier={t} onClick={() => { store.actions.uiSound('click'); setTier(t); }}>Tier {t}</button>)}
            </div>
            <div class="fe-rookmaps__group" role="group" aria-label="Quality">
              <span class="ui-type-caption fe-rookmaps__label">Quality</span>
              {ROOK_MAP_GRADES.map((g) => <button key={g.id} type="button" class="fe-stockchip ui-type-caption" aria-pressed={gradeId === g.id} data-rook-grade={g.id}
                onClick={() => { store.actions.uiSound('click'); setGrade(g.id); }}>{g.label}{g.quality > 0 ? ` +${g.quality}%` : ''}</button>)}
            </div>
          </div>
          {offer?.item && (
            <div class="fe-offers fe-rookmaps__offer">
              <StockRow
                key={offer.id}
                id={offer.id}
                label={offer.label}
                sub={`${def.name} accepts up to Tier ${atlasTierCeiling(def)}`}
                item={offer.item}
                price={price(offer)}
                blocked={unaffordableReason(offer, currencyName, onHand)}
                tag={offer.price.length === 0 ? 'Take it (free)' : `Buy for ${priceText(offer)}`}
                buyLabel="Buy"
                tooltip={{ kind: 'preview', item: offer.item, note: offer.price.length === 0 ? 'Rook gives this away for free.' : `Price: ${priceText(offer)}.` }}
                onBuy={(at) => store.actions.buyOffer(offer.id, at)}
              />
            </div>
          )}
          <table class="fe-rookmaps__table ui-type-caption" aria-label="Prices">
            <thead><tr><th /> {tiers.map((t) => <th key={t}>Tier {t}</th>)}</tr></thead>
            <tbody>
              {ROOK_MAP_GRADES.map((g) => <tr key={g.id} class={cx(g.id === grade.id && 'fe-rookmaps__row--on')}><th>{g.label}</th>{tiers.map((t) => <td key={t}>{g.price[t as 1 | 2] === 0 ? 'free' : `${g.price[t as 1 | 2]} Scrap`}</td>)}</tr>)}
            </tbody>
          </table>
        </>
      ) : <p class="fe-panel__note">Clear an area's boss and Rook will sell its maps.</p>}
    </div>
  );
}
