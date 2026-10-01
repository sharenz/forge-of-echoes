// "Where your maps come from" (brief D 3, 4): the frozen drop table of the slotted map as rows with weights and shares, its advance
// target and the pinned marks. Every number is `routingReadout`'s, the function the sim rolls with (I3); nothing is recomputed here.
// Two faces: the full list (Sources lens panel, readout popover) and a one-line summary for the dock.
import { useState } from 'preact/hooks';
import type { AtlasAreaId } from '../../contracts/atlas';
import type { RouteKind } from '../../contracts/game';
import type { RoutingReadout } from '../../game/progression/map-routing';
import { cx } from '../components/common';
import { formatShare, topSources } from './lens';

const KIND_LABEL: Record<RouteKind, string> = {
  own: 'This area', neighbour: 'Beside it', deadEnd: 'Dead end', wander: 'Further', pending: 'Next reveal', pinned: 'Pinned',
};

const weightText = (w: number): string => (Number.isInteger(w) ? String(w) : String(Math.round(w * 100) / 100));

export function SourcesPanel({ readout, onFocus, class: klass, limit }: { readout: RoutingReadout | null; onFocus?: (id: AtlasAreaId) => void; class?: string; /** Rows shown until "Show all" (small chart overlays). */ limit?: number }) {
  const [all, setAll] = useState(false);
  if (!readout) {
    return (
      <section class={cx('fe-sources', klass)} aria-label="Where your maps come from">
        <h4 class="fe-sources__h ui-type-caption">Where your maps come from</h4>
        <p class="ui-type-secondary fe-sources__empty">Slot a map: this table shows which areas its expedition drops maps for.</p>
      </section>
    );
  }
  return (
    <section class={cx('fe-sources', klass)} aria-label="Where your maps come from" data-sources>
      <h4 class="fe-sources__h ui-type-caption">Where your maps come from · {readout.fromName} T{readout.tier}</h4>
      <ul class="fe-sources__rows">
        {(limit && !all ? readout.rows.slice(0, limit) : readout.rows).map((r) => (
          <li key={r.areaId} class={cx('fe-sources__row', r.pinned && 'fe-sources__row--pinned', r.pending && 'fe-sources__row--pending', r.areaId === readout.from && 'fe-sources__row--own')}>
            <button type="button" class="fe-sources__btn" disabled={!onFocus} onClick={() => onFocus?.(r.areaId)} title={`Weight ${weightText(r.weight)}. Maps up to Tier ${r.ceiling}.`}>
              <span class="fe-sources__name ui-type-secondary">{r.pinned && <i class="fe-pinglyph" aria-label="Pinned" />}{r.name}</span>
              <span class="fe-sources__kind ui-type-caption">{KIND_LABEL[r.kind]}</span>
              <span class="fe-sources__bar" aria-hidden="true"><i style={{ width: `${Math.round(Math.min(1, r.pending ? r.bossShare : r.share) * 100)}%` }} /></span>
              <span class="fe-sources__share ui-type-secondary">{r.pending ? 'boss only' : formatShare(r.share)}</span>
            </button>
          </li>
        ))}
      </ul>
      {limit && readout.rows.length > limit && (
        <button type="button" class="fe-sources__more ui-type-caption" aria-expanded={all} onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${readout.rows.length}`}</button>
      )}
      {!limit && readout.advance && <p class="fe-sources__note ui-type-caption">A completion upgrade becomes Tier {Math.min(15, readout.tier + 1)} in {readout.advanceName}.</p>}
      {!limit && readout.rows.some((r) => r.pending) && <p class="fe-sources__note ui-type-caption">Defeating the boss can also drop maps of the next areas to be revealed.</p>}
    </section>
  );
}

/** The dock's one-liner: "Next drops: Shattered Forge 23% · Glass Sepulchre 23% · this area 16%". */
export function SourcesLine({ readout, onFocus }: { readout: RoutingReadout | null; onFocus?: (id: AtlasAreaId) => void }) {
  const top = topSources(readout, 3);
  if (!top.length) return null;
  return (
    <span class="fe-dock__sources ui-type-caption" data-sources-line>
      <span class="fe-dock__sources-label">Next drops</span>
      {top.map((t) => (
        <button key={t.areaId} type="button" class={cx('fe-dock__source', t.pinned && 'fe-dock__source--pinned')} onClick={() => onFocus?.(t.areaId)} title="Show on the chart">
          {t.pinned && <i class="fe-pinglyph" aria-hidden="true" />}{t.name} {formatShare(t.share)}
        </button>
      ))}
    </span>
  );
}
