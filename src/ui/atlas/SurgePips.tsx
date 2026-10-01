// Daily surge in the Atlas UI (brief D 7.6): brass pips per area (rail, Re-chart popover, pin chips), the dock chip with the Hold toggle and
// the countdown to the 04:00 UTC reset, and Hourglass Sand / Grand Hourglass refills. The rules and every number are game/progression/surge.ts;
// the item is used from the inventory by choosing the area (rail) or the whole chart (dock), never from a second stash.
import { useEffect } from 'preact/hooks';
import type { AtlasAreaId } from '../../contracts/atlas';
import { ATLAS_AREAS, findAtlasArea } from '../../data/progression/atlas';
import { SURGE_BONUS } from '../../data/progression/territory';
import { currencyOnHand } from '../../game/progression/merchant';
import { msUntilReset, resetCountdownText, surgeStatus } from '../../game/progression/surge';
import { cx } from '../components/common';
import { useStore, useUi } from '../store';
import { clearSurgeFeed, publishSurgeFeed, setSurgeHold, useServerNow, useSurgeHold, useSurgeStatus } from './surge-view';
import '../styles/surge.css';

/** The pips of one area: filled = a charge left. Text alternative for assistive tech; the pips themselves are decoration. */
export function SurgePips({ remaining, max, class: klass }: { remaining: number; max: number; class?: string }) {
  return (
    <span class={cx('fe-surge-pips', remaining <= 0 && 'fe-surge-pips--spent', klass)} role="img" aria-label={`${remaining} of ${max} surge charges left`}>
      {Array.from({ length: Math.max(0, max) }, (_, i) => <i key={i} class={cx('fe-surge-pip', i < remaining && 'fe-surge-pip--on')} />)}
    </span>
  );
}

/** Pips for an area by id (Re-chart popover rows, pin chips). */
export function AreaSurgePips({ areaId, class: klass }: { areaId: AtlasAreaId; class?: string }) {
  const s = useSurgeStatus(areaId);
  return <SurgePips remaining={s.remaining} max={s.max} {...(klass ? { class: klass } : {})} />;
}

const countText = (ms: number): string => resetCountdownText(ms);

/** The rail line: this area's pips, the reset countdown and, when the account holds Hourglass Sand, the refill. */
export function SurgeRail({ areaId }: { areaId: AtlasAreaId }) {
  const store = useStore();
  const ch = useUi((s) => s.character);
  const now = useServerNow();
  const area = findAtlasArea(areaId);
  if (!area || !ch) return null;
  const s = surgeStatus(ch.atlas, areaId, now);
  const sand = currencyOnHand(ch, 'hourglassSand');
  const canRefill = sand > 0 && s.spent > 0;
  return (
    <div class="fe-surge-rail" data-surge-rail={areaId}>
      <SurgePips remaining={s.remaining} max={s.max} />
      <span class="ui-type-caption fe-surge-rail__text">
        {s.remaining > 0 ? `Surge ${s.remaining}/${s.max} today` : `No surge left (refreshes in ${countText(msUntilReset(now))})`}
      </span>
      {canRefill && (
        <button type="button" class="fe-surge-btn ui-type-caption" data-surge-refill={areaId} title={`Use one Hourglass Sand (you hold ${sand}) to refill ${area.name}`}
          onClick={() => { store.actions.uiSound('click'); store.actions.refillSurge(areaId); }}>Refill surge</button>
      )}
    </div>
  );
}

/**
 * The dock chip: pips of the area the device opens, the Hold toggle (on = the next activation spends a charge for +30% quantity and
 * +15% rarity; off = it keeps the charge), the reset countdown and the Grand Hourglass. Also feeds the chart's per-node pips.
 */
export function SurgeChip({ areaId }: { areaId: AtlasAreaId | null }) {
  const store = useStore();
  const ch = useUi((s) => s.character);
  const now = useServerNow();
  const hold = useSurgeHold();
  const atlas = ch?.atlas;
  // The chart reads its pips from here, once per second of server time at most (the clock hook ticks every 30 s).
  useEffect(() => {
    publishSurgeFeed(atlas, ATLAS_AREAS.map((a) => a.id), now);
    return clearSurgeFeed;
  }, [atlas, Math.floor(now / 30_000)]);
  if (!ch) return null;
  const grand = currencyOnHand(ch, 'grandHourglass');
  const anySpent = ATLAS_AREAS.some((a) => surgeStatus(atlas, a.id, now).spent > 0);
  const s = areaId ? surgeStatus(atlas, areaId, now) : null;
  const countdown = countText(msUntilReset(now));
  return (
    <span class="fe-surge-chip" data-surge-chip>
      {s ? (
        <>
          <SurgePips remaining={s.remaining} max={s.max} />
          <button type="button" class={cx('fe-dock__act fe-surge-hold ui-type-caption', hold && s.remaining > 0 && 'fe-surge-hold--on')} aria-pressed={hold && s.remaining > 0} data-surge-hold
            disabled={s.remaining <= 0}
            title={s.remaining > 0
              ? `${hold ? 'Spends' : 'Keeps'} one surge charge when you activate: +${SURGE_BONUS.quantityMore}% item quantity (not on maps) and +${SURGE_BONUS.rarityMore}% rarity. Refreshes in ${countdown}.`
              : `No surge left today: this area runs at the normal rate. Refreshes in ${countdown}.`}
            onClick={() => { store.actions.uiSound('click'); setSurgeHold(!hold); }}>
            {s.remaining > 0 ? `Surge ${s.remaining}/${s.max}${hold ? '' : ' (held)'}` : 'No surge left'}
          </button>
        </>
      ) : <span class="ui-type-caption fe-surge-chip__idle">Surge</span>}
      <span class="ui-type-caption fe-surge-chip__reset" data-surge-reset>Surges refresh in {countdown}</span>
      {grand > 0 && anySpent && (
        <button type="button" class="fe-dock__act fe-surge-btn ui-type-caption" data-surge-refill-all title={`Use one Grand Hourglass (you hold ${grand}) to refill every area`}
          onClick={() => { store.actions.uiSound('click'); store.actions.refillSurge('all'); }}>Refill all</button>
      )}
    </span>
  );
}
