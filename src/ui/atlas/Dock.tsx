// The always-visible device dock (brief A, 6.7): course, map, scarabs, price/readout and Activate on one line, so
// choosing a destination never hides the map you are choosing it for. The full readout opens in a popover.
import { useEffect, useRef, useState } from 'preact/hooks';
import { MAP_EVENT_KINDS } from '../../contracts/map-events';
import type { MapItem } from '../../contracts/items';
import type { AtlasAreaDef } from '../../data/progression/atlas';
import { atlasTierCeiling } from '../../data/progression/atlas';
import { CURRENCIES } from '../../data/items';
import { MAP_EVENT_NAMES, MAP_EVENT_SECOND_CHANCE } from '../../data/progression/map-events';
import { PORTALS_PER_MAP } from '../../contracts/net';
import { keystoneRewards } from '../../game/progression/keystones';
import { territoryEntryFee } from '../../game/progression/atlas';
import { Button, cx } from '../components/common';
import { MapDeviceSlotView, ScarabSlotView } from '../items/Containers';
import { formatLuck } from '../lib/format';
import { useStore, useUi } from '../store';
import { useMotion } from './motion';
import { useActivation } from './activation';

export interface DeviceReadout {
  desc: { title: string; tone: string; headerLines: string[]; affixes: { text: string; negative?: boolean; kind?: string }[] } | null;
  summary: { label: string; value: string; breakdown: string[] }[];
  luck: { itemQuantity: number; itemRarity: number } | null;
  mapLuck: { q: number; r: number } | null;
  events: Record<string, number>;
  error: string | null;
}

export function ReadoutDetail({ area, map, readout, gear }: {
  area: AtlasAreaDef; map: MapItem; readout: DeviceReadout; gear: { q: number; r: number } | null;
}) {
  const [openLine, setOpenLine] = useState<string | null>(null);
  const keystone = keystoneRewards(area.id, map.tier);
  return (
    <div class="fe-device__readout">
      {readout.desc && <>
        <div class={cx('fe-device__mapname', `fe-tone-${readout.desc.tone}`)}>{readout.desc.title}</div>
        <div class="fe-device__maptier">{readout.desc.headerLines.join(' · ')}</div>
        {readout.desc.affixes.length > 0 && (
          <ul class="fe-device__mods">
            {readout.desc.affixes.map((l, i) => (
              <li key={i} class={cx(l.negative ? 'fe-device__mod--danger' : 'fe-device__mod--reward', l.kind === 'corrupted' && 'fe-device__mod--corrupt')}>{l.text}</li>
            ))}
          </ul>
        )}
      </>}
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

export function Dock({ area, map, readout, gear, activate, compact, onOpenStash, stashOpen, onCourse, children }: {
  area: AtlasAreaDef;
  map: MapItem | null;
  readout: DeviceReadout | null;
  gear: { q: number; r: number } | null;
  activate: () => void;
  compact: boolean;
  onOpenStash: () => void;
  stashOpen: boolean;
  /** Clicking the course chip brings the chart back to the destination. */
  onCourse: () => void;
  /** The Hunter reward class picker, when the area needs it. */
  children?: preact.ComponentChildren;
}) {
  const store = useStore();
  const [details, setDetails] = useState(false);
  // Activation feedback: a sigil ring closes over the map slot and each scarab that was socketed gives one spark
  const { pulse } = useActivation();
  const { calm } = useMotion();
  const scarabs = useUi((s) => s.character?.mapScarabs);
  const filledNow = [0, 1, 2, 3].map((i) => !!scarabs?.[i]);
  const lastFilled = useRef<{ sockets: boolean[]; at: number }>({ sockets: [false, false, false, false], at: 0 });
  const seenPulse = useRef(pulse);
  const [fx, setFx] = useState<{ id: number; sockets: boolean[] } | null>(null);
  useEffect(() => {
    if (pulse === seenPulse.current) return;
    seenPulse.current = pulse;
    const recent = Date.now() - lastFilled.current.at < 4000;
    setFx({ id: pulse, sockets: recent ? lastFilled.current.sockets : [false, false, false, false] });
    const t = setTimeout(() => setFx(null), calm ? 600 : 1000);
    return () => clearTimeout(t);
  }, [pulse]);
  useEffect(() => { if (filledNow.some(Boolean)) lastFilled.current = { sockets: filledNow, at: Date.now() }; });
  useEffect(() => {
    if (!details) return;
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      setDetails(false);
    };
    window.addEventListener('keydown', onEsc, true);
    return () => window.removeEventListener('keydown', onEsc, true);
  }, [details]);
  const dangers = readout?.desc?.affixes.filter((a) => a.negative).length ?? 0;
  const ready = !!map && !readout?.error;
  return (
    <div class={cx('fe-dock', compact && 'fe-dock--compact', calm && 'fe-dock--calm')} role="group" aria-label="Map device">
      <button class="fe-device__destination fe-dock__course" onClick={() => { store.actions.uiSound('click'); onCourse(); }} aria-label={`Course: ${area.name}`}>
        <span class="ui-type-caption fe-dock__kicker">1 · Course</span>
        <strong class="ui-type-body">{area.name}</strong>
        <span class="ui-type-caption">Up to Tier {atlasTierCeiling(area)}</span>
      </button>
      <div class="fe-dock__step fe-dock__step--map">
        <span class="ui-type-caption fe-dock__kicker">2 · Map</span>
        <div class={cx('fe-device__circle fe-dock__circle', map && 'fe-device__circle--charged', fx && 'fe-dock__circle--sigil')}>
          <MapDeviceSlotView disabled={false} />
          {fx && <span key={fx.id} class="fe-dock__sigil" aria-hidden="true" />}
        </div>
      </div>
      <div class="fe-dock__step fe-dock__step--scarabs">
        <span class="ui-type-caption fe-dock__kicker">3 · Scarabs</span>
        <div class="fe-dock__sockets">{[0, 1, 2, 3].map((i) => (
          <div class="fe-dock__sockwrap" key={i}>
            <ScarabSlotView index={i} />
            {fx?.sockets[i] && <span key={fx.id} class="fe-dock__spark" aria-hidden="true" />}
          </div>
        ))}</div>
      </div>
      <div class="fe-dock__step fe-dock__step--readout">
        <span class="ui-type-caption fe-dock__kicker">4 · Price</span>
        {map && readout?.desc ? (
          <div class="fe-dock__read">
            <b class={cx('fe-dock__mapname ui-type-secondary', `fe-tone-${readout.desc.tone}`)}>{readout.desc.title}</b>
            <span class="fe-dock__chips">
              {readout.luck && <span class="fe-dock__chip ui-type-caption" title="Your personal item quantity for this expedition">Qty {formatLuck(readout.luck.itemQuantity)}</span>}
              {readout.luck && <span class="fe-dock__chip ui-type-caption" title="Your personal item rarity for this expedition">Rarity {formatLuck(readout.luck.itemRarity)}</span>}
              <span class={cx('fe-dock__chip ui-type-caption', dangers > 0 && 'fe-dock__chip--danger')}>Danger {dangers}</span>
              <button class="fe-dock__more ui-type-caption" aria-expanded={details} aria-label="Full map readout" onClick={() => { store.actions.uiSound('click'); setDetails(!details); }}>(?)</button>
            </span>
          </div>
        ) : (
          <div class="fe-dock__read">
            <span class="ui-type-secondary fe-dock__hint">Load a map to light the way.</span>
            <button class="fe-dock__more fe-dock__more--text ui-type-secondary" onClick={onOpenStash}>{stashOpen ? 'Stash open' : 'Open Stash…'}</button>
          </div>
        )}
        {children}
      </div>
      <div class="fe-dock__go">
        {readout?.error && <span class="fe-atlas__error fe-dock__error ui-type-caption" role="status">{readout.error}</span>}
        <Button variant="ember" size="large" class="fe-device__activate fe-dock__activate" disabled={!ready} onClick={activate}>Activate</Button>
        <span class="fe-device__cost ui-type-caption fe-dock__cost">
          {map ? `Fee ${territoryEntryFee(map.tier, area.id)} Scrap${area.entranceKey ? ` · ${CURRENCIES[area.entranceKey].name}` : ''} · ${PORTALS_PER_MAP} portals` : 'Place a map to activate'}
        </span>
      </div>
      {details && map && readout && (
        <div class="fe-dock__pop fe-solid" role="dialog" aria-label="Map readout">
          <button class="fe-dock__pop-close fe-btn fe-btn--icon fe-btn--ghost" aria-label="Close readout" onClick={() => setDetails(false)}><span class="fe-x" /></button>
          <ReadoutDetail area={area} map={map} readout={readout} gear={gear} />
        </div>
      )}
    </div>
  );
}
