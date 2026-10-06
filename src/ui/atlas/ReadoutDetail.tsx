// The full map readout (properties, personal luck, encounter odds, where your maps come from, summary lines with breakdowns), the
// body of the area modal's "Full readout" section. Every number is the rules' own.
import { useState } from 'preact/hooks';
import { MAP_EVENT_KINDS } from '../../contracts/map-events';
import type { MapItem } from '../../contracts/items';
import type { AtlasAreaId } from '../../contracts/atlas';
import type { AtlasAreaDef } from '../../data/progression/atlas';
import { MAP_EVENT_NAMES, MAP_EVENT_SECOND_CHANCE } from '../../data/progression/map-events';
import { keystoneRewards } from '../../game/progression/keystones';
import { cx } from '../components/common';
import { formatLuck } from '../lib/format';
import { SourcesPanel } from './SourcesPanel';
import type { DeviceReadout } from './readout';

export function ReadoutDetail({ area, map, readout, gear, onFocus }: {
  area: AtlasAreaDef; map: MapItem; readout: DeviceReadout; gear: { q: number; r: number } | null; onFocus?: (id: AtlasAreaId) => void;
}) {
  const [openLine, setOpenLine] = useState<string | null>(null);
  const keystone = keystoneRewards(area.id, map.tier);
  return (
    <div class="fe-device__readout" data-full-readout>
      {readout.luck && (
        <div class="fe-device__luck">
          {([['Your item quantity', readout.luck.itemQuantity, readout.mapLuck?.q, gear?.q], ['Your item rarity', readout.luck.itemRarity, readout.mapLuck?.r, gear?.r]] as const).map(([label, total, m, g]) => (
            <div class="fe-device__luck-cell" key={label}>
              <span class="fe-device__luck-label">{label}</span>
              <span class="fe-device__luck-value">{formatLuck(total)}</span>
              {m !== undefined && <span class="fe-device__luck-src">map {formatLuck(m)}{g !== undefined && g !== null ? `, your gear ${formatLuck(g)}` : ''}</span>}
            </div>
          ))}
        </div>
      )}
      <p class="ui-type-caption">{area.encounters ? `Guaranteed encounters: ${area.encounters.map(e => MAP_EVENT_NAMES[e.kind]).join(' · ')}${map.bounty && !area.encounters.some(e => e.kind === 'hunted') ? ' · additional Bounty hunter' : ''}. Resolve them to complete the area.`
        : `Chance of a first encounter: ${MAP_EVENT_KINDS.filter(k => (readout.events[k] ?? 0) > 0).map(k => `${MAP_EVENT_NAMES[k]} ${Math.round(readout.events[k] * 1000) / 10}%`).join(' · ')}. Once one is drawn, a second follows ${Math.round(MAP_EVENT_SECOND_CHANCE * 100)}% of the time (Twin Omens allows a third). Which one, and when, is only discovered during the map.`}</p>
      <SourcesPanel readout={readout.routing} onFocus={onFocus} class="fe-device__sources" />
      <div class="fe-device__summary">
        {keystone && <p class="ui-type-caption">Exclusive unique chance: {Math.round((keystoneRewards(area.id, map.tier, readout.luck?.itemRarity ?? 100)?.chance ?? 0) * 1000) / 10}% {readout.luck ? 'per boss for you' : 'base per boss, multiplied by your item rarity when entry is available'}. Equal weight among eligible uniques; ordinary drops and boss guarantees also apply.</p>}
        {readout.summary.map((l) => {
          const isOpen = openLine === l.label;
          return (
            <div key={l.label} class={cx('fe-sheet__line', isOpen && 'fe-sheet__line--open')}>
              <button class="fe-sheet__row" aria-expanded={isOpen} disabled={!l.breakdown.length} onClick={() => setOpenLine(isOpen ? null : l.label)}>
                <span class="fe-sheet__chev" />
                <span class="fe-sheet__label">{l.label}</span>
                <span class="fe-sheet__dots" />
                <span class="fe-sheet__value">{l.value}</span>
              </button>
              {isOpen && <ul class="fe-sheet__breakdown">{l.breakdown.map((b, i) => <li key={i}>{b}</li>)}</ul>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
