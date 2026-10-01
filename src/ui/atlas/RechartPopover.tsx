// Re-chart (brief D 5.2): move a map to a neighbouring area of the same tier, keeping its quality, mods and commissions, for Forge Scrap.
// One popover, three doors: the dock's map chip, the Crafting Bench and the work slot. It lists the legal neighbours (name, theme, the
// ceiling it accepts, what you hold of it, the price) from the SAME bench service list the server charges from (rules.benchServices), and
// confirming sends actions.rechartMap(uid, area): server-authoritative and atomic (the Scrap leaves with the move, never one without the other).
import { useLayoutEffect, useMemo } from 'preact/hooks';
import type { AtlasAreaId } from '../../contracts/atlas';
import type { BenchService } from '../../contracts/game';
import type { MapItem } from '../../contracts/items';
import { RECHART_SERVICE_PREFIX, THEME_LABELS } from './rechart-data';
import { atlasTierCeiling, findAtlasArea } from '../../data/progression/atlas';
import { MAP_BASES } from '../../data/progression/maps';
import { benchCurrency } from '../../game/items';
import { mapBaseImplicitText } from '../../game/progression/maps';
import { emblemUrl } from '../../art/atlas/sprites';
import { Button, PixelIcon, cx } from '../components/common';
import { iconIdForCurrency } from '../../contracts/content';
import { safe } from '../items/hooks';
import { useStore, useUi } from '../store';
import { stockByArea } from './lens';
import { AreaSurgePips } from './SurgePips';

export function rechartServices(services: readonly BenchService[]): BenchService[] {
  return services.filter((s) => s.id.startsWith(RECHART_SERVICE_PREFIX));
}

export function RechartPopover({ map, onClose, class: klass }: { map: MapItem; onClose: () => void; class?: string }) {
  const store = useStore();
  const ch = useUi((s) => s.character);
  const inHideout = useUi((s) => s.zone === 'hideout');
  const services = useMemo(() => (ch ? rechartServices(safe(() => store.rules.benchServices(ch, map.uid), [])) : []), [ch, map.uid, store]);
  const stock = useMemo(() => stockByArea(ch), [ch]);
  const scrap = ch ? benchCurrency(ch, 'scrap') : 0;
  const from = findAtlasArea(map.areaId);
  // Esc closes the popover first (capture phase, before the table's own Esc). Registered in a layout effect so there is no window
  // between the popover appearing and Esc belonging to it.
  useLayoutEffect(() => {
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onEsc, true);
    return () => window.removeEventListener('keydown', onEsc, true);
  }, [onClose]);
  const choose = (s: BenchService): void => {
    const areaId = s.id.slice(RECHART_SERVICE_PREFIX.length) as AtlasAreaId;
    store.actions.uiSound('click');
    store.actions.rechartMap(map.uid, areaId);
    onClose();
  };
  return (
    <div class={cx('fe-rechart fe-solid', klass)} role="dialog" aria-label="Re-chart map" data-rechart>
      <header class="fe-rechart__head">
        <div>
          <h4 class="fe-rechart__title ui-type-body">Re-chart</h4>
          <p class="ui-type-secondary fe-rechart__sub">Move this Tier {map.tier} map from {from?.name ?? 'its area'} to a neighbour. Quality, mods and commissions travel with it.</p>
        </div>
        <button type="button" class="fe-btn fe-btn--icon fe-btn--ghost fe-rechart__close" aria-label="Close" onClick={onClose}><span class="fe-x" /></button>
      </header>
      {!inHideout && <p class="fe-rechart__note ui-type-secondary">Re-charting is a bench service: do it in a hideout.</p>}
      <ul class="fe-rechart__list">
        {services.map((s) => {
          const areaId = s.id.slice(RECHART_SERVICE_PREFIX.length);
          const area = findAtlasArea(areaId);
          if (!area) return <li key={s.id} class="fe-rechart__none ui-type-secondary">{s.reason ?? 'No neighbour accepts this map yet.'}</li>;
          const held = stock.get(area.id)?.count ?? 0;
          const cost = s.cost[0]?.count ?? 0;
          return (
            <li key={s.id} class={cx('fe-rechart__row', !s.available && 'fe-rechart__row--off')} data-rechart-area={area.id}>
              <img class="fe-px" src={emblemUrl(area.baseId, 24)} alt="" width={24} height={24} />
              <span class="fe-rechart__what">
                <strong class="ui-type-secondary">{area.name}</strong>
                <span class="ui-type-caption">{THEME_LABELS[area.baseId] ?? MAP_BASES[area.baseId].name} · accepts up to Tier {atlasTierCeiling(area)} · you hold {held}</span>
                <span class="ui-type-caption fe-rechart__implicit">{mapBaseImplicitText(area.baseId)}</span>
                <span class="fe-rechart__pips" data-surge-pips={area.id}><AreaSurgePips areaId={area.id} /></span>
                {!s.available && s.reason && <span class="ui-type-caption fe-rechart__why">{s.reason}</span>}
              </span>
              <span class={cx('fe-price', scrap < cost && 'fe-price--short')} title={`${cost} Forge Scrap (you carry ${scrap})`}>
                <PixelIcon id={iconIdForCurrency('scrap')} width={20} height={20} />{cost}
              </span>
              <Button size="small" disabled={!s.available || !inHideout} onClick={() => choose(s)}>Re-chart</Button>
            </li>
          );
        })}
        {services.length === 0 && <li class="fe-rechart__none ui-type-secondary">No neighbouring area is charted for this map yet.</li>}
      </ul>
      {(map.rechart ?? 0) > 0 && <p class="ui-type-caption fe-rechart__note">Re-charted {map.rechart} time{map.rechart === 1 ? '' : 's'}: each further hop costs 50% more.</p>}
    </div>
  );
}
