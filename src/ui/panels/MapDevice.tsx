// Map Device (own hideout only), the Cartography Table (brief A): a full-screen Atlas chart beside the inventory, plus the Codex tab that
// hosts the Atlas tree. The chart is for choosing: click an AREA and its modal opens (src/ui/atlas/AreaModal.tsx) with the map slot, the scarab
// sockets, the area's facts and "Open area". A map is bound to one area (brief D); a key or a Bounty opens a passage inside the modal of
// the sealed area / the Pit. What stays global on the chart window: the tabs, the lenses, the pin tray, the tier ruler, the key chips, zoom,
// a slim status line (the open expedition, the surge countdown and Refill all). The window sits beside the inventory (which opens with it):
// maps and scarabs are dragged from the inventory into the modal's slots (Ctrl/Cmd-click quick-loads). The panel keeps its id so hotkeys
// and drag targets keep working. In a party member's hideout it shows THEIR open portal instead (read-only).
import { mapEventOdds } from '../../game/progression/map-events';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { PortalInfo } from '../../contracts/net';
import { Button, Frame, cx } from '../components/common';
import { safe } from '../items/hooks';
import { useLocal } from '../local';
import { possessive } from '../lib/format';
import { useSignal, useStore, useUi } from '../store';
import { PanelShell } from './PanelShell';
import { AtlasChart, type ChartExtras } from './Atlas';
import type { AtlasAreaId } from '../../contracts/atlas';
import { ATLAS_AREAS, ATLAS_START, findAtlasArea } from '../../data/progression/atlas';
import { newAtlas, pinError, pinSlotCount } from '../../game/progression/atlas';
import { pinMultiplierFor } from '../../data/progression/routing';
import { DEFAULT_LENS, sourceEdges, stockByArea, type ChartLens } from '../atlas/lens';
import { MapTreeView } from './MapTree';
import { mapTreeFreePoints } from '../../game/progression/map-tree';
import { AreaModal } from '../atlas/AreaModal';
import { CoachStrip } from '../guide/CoachStrip';
import { areaModalSignal, mapFit } from '../atlas/area-modal';
import { routingFor } from '../atlas/readout';
import { SurgeBar } from '../atlas/SurgePips';
import { chartedCount, nodeModel } from '../atlas/model';

/**
 * The table shares the screen with the inventory. The area modal lays itself out by the table's own width (a container query); this
 * only says "a short window" (the 1024x600 minimum) so the modal can drop its sprite stage and tighten its rows.
 */
function useCompact(): boolean {
  const query = '(max-height: 679px), (max-width: 1179px)';
  const [compact, setCompact] = useState(() => { try { return window.matchMedia(query).matches; } catch { return false; } });
  useEffect(() => {
    let mq: MediaQueryList;
    try { mq = window.matchMedia(query); } catch { return; }
    const on = (): void => setCompact(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return compact;
}

function PortalNote({ portal, own }: { portal: PortalInfo; own: boolean }) {
  const spent = portal.remaining === 0;
  return (
    <div class={cx('fe-device__portal', spent && 'fe-device__portal--spent')}>
      <span class="fe-device__portal-dot" />
      <span>
        <b class="fe-device__portal-map">
          {portal.mapName} T{portal.tier}
        </b>
        {' · '}
        {portal.remaining}/{portal.total} portals left{portal.cleared ? ', cleared' : ''}.{' '}
        <span class="fe-muted">
          {own
            ? spent || portal.cleared
              ? 'Activating a new map replaces it.'
              : 'Click the portal to enter. A new map closes it once nobody is inside.'
            : spent
              ? 'No portals are left in it.'
              : 'Click the portal to enter; each entry uses one.'}
        </span>
      </span>
    </div>
  );
}

/**
 * The chart window's slim status line (the old dock's only global duties): the open expedition with its portals and the way to it, then the
 * surge countdown and "Refill all". Everything about opening an area lives in the area modal.
 */
function TableStatus({ portal, onEnter }: { portal: PortalInfo | null; onEnter: () => void }) {
  const live = !!portal && portal.remaining > 0 && !portal.cleared;
  return (
    <div class="fe-table__status" data-table-status role="group" aria-label="Expedition status">
      <span class={cx('fe-table__expedition ui-type-secondary', !live && 'fe-table__expedition--idle')} data-expedition>
        <span class={cx('fe-device__portal-dot', !live && 'fe-device__portal-dot--idle')} aria-hidden="true" />
        {portal
          ? <><b>{portal.mapName} T{portal.tier}</b><span>{portal.cleared ? ' · cleared' : ` · ${portal.remaining}/${portal.total} portals left`}</span></>
          : <span>No expedition open · click an area to open one</span>}
      </span>
      {live && <button type="button" class="fe-act ui-type-caption fe-table__enter" data-enter-portal onClick={onEnter} title="Close the Atlas, then click the glowing portal in your hideout">Enter the portal</button>}
      <span class="fe-table__statusfill" />
      <SurgeBar />
    </div>
  );
}

export function MapDevicePanel() {
  const store = useStore();
  const local = useLocal();
  const ch = useUi((s) => s.character);
  const derived = useUi((s) => s.derived);
  const own = useUi((s) => s.isOwnHideout);
  const zone = useUi((s) => s.zone);
  const owner = useUi((s) => s.hud?.zoneOwnerName ?? '');
  const portal = useUi((s) => s.hud?.portal ?? null);
  const zoneIsOwn = useUi((s) => s.hud?.zoneIsOwn ?? true);
  const compact = useCompact();
  const map = ch?.mapDevice ?? null;
  const modalId = useSignal(areaModalSignal);
  const [inspected, inspect] = useState<AtlasAreaId>(modalId ?? map?.areaId ?? ch?.atlas?.completed.at(-1) ?? ATLAS_START);
  const [tab, setTab] = useState<'chart' | 'codex'>('chart');
  const [lens, setLens] = useState<ChartLens>(DEFAULT_LENS);
  const [focusReq, setFocusReq] = useState<{ id: AtlasAreaId; n: number } | null>(null);
  const progress = ch?.atlas ?? newAtlas();
  const modalArea = modalId ? findAtlasArea(modalId) ?? null : null;
  const viewArea = findAtlasArea(inspected)!;
  // The modal belongs to the table: hiding the panel (Rook's stall opened from the modal) keeps it, closing the panel drops it.
  useEffect(() => () => { if (!store.get().openPanels.includes('mapDevice')) areaModalSignal.set(null); }, [store]);
  // An area that is not charted (or a stale id) cannot have a modal.
  useEffect(() => { if (modalId && !progress.discovered.includes(modalId)) areaModalSignal.set(null); }, [modalId, progress.discovered]);
  useEffect(() => { if (modalId) inspect(modalId); }, [modalId]);

  const keys = useMemo(() => {
    const out = new Set<string>();
    if (!ch) return out;
    for (const [id, n] of Object.entries(ch.currencyStash)) if ((n ?? 0) > 0) out.add(id);
    for (const e of ch.backpack.entries) if (e.item.kind === 'currency') out.add(e.item.currencyId);
    return out;
  }, [ch]);
  // The Sources lens draws the drop table of the loaded map (the table of its own area: a passage run keeps the map's table).
  const sourcesReadout = useMemo(() => (ch && map ? routingFor(ch, map, map.areaId) : null), [ch, map]);

  const disabled = !own || zone !== 'hideout';
  if (!ch) return null;
  const ownPortal = portal && zoneIsOwn ? portal : null;
  const hostPortal = portal && !zoneIsOwn && zone === 'hideout' ? portal : null;
  // Gear share of the personal luck: the character sheet's % increased from gear (DerivedStats).
  const gear = derived ? { q: 100 + derived.itemQuantity, r: 100 + derived.itemRarity } : null;

  if (disabled) {
    return (
      <PanelShell panel="mapDevice" title="Map Device" class="fe-device">
        <div class="fe-device__locked">
          <div class={cx('fe-device__circle', hostPortal && hostPortal.remaining > 0 ? 'fe-device__circle--charged' : 'fe-device__circle--cold')}>
            <span class="fe-device__socket" aria-hidden="true" />
          </div>
          {hostPortal && <PortalNote portal={hostPortal} own={false} />}
          <p class="fe-device__locked-text">
            {zone === 'hideout'
              ? `This is ${possessive(owner)} device. Only its owner can open maps here${hostPortal ? '' : '; no portal is open right now'}.`
              : 'The map device can only be used in your own hideout.'}
          </p>
          {zone === 'hideout' && (
            <Button onClick={() => { store.actions.goHome(); store.actions.closePanel('mapDevice'); }}>Go to your hideout</Button>
          )}
        </div>
      </PanelShell>
    );
  }

  // where the loaded map would open (the chart's pennant): the modal's area when the map fits it, else its own area
  const courseId: AtlasAreaId | null = map ? (modalArea && mapFit(map, modalArea).ok ? modalArea.id : map.areaId) : null;
  const ctx = { discovered: new Set<string>(progress.discovered), completed: new Set<string>(progress.completed), tier: map?.tier ?? null, keys, fresh: new Set<string>(), corrupted: !!map?.corrupted, home: courseId };
  const unspent = mapTreeFreePoints(ch.atlas); // earned minus the cost of every allocated node (keystones cost 2)
  // Before the first clear the chart is just the chart, the map slot and Open area: lenses, pins, the tier ruler and the surge strip appear with the first win.
  const intro = progress.completed.length === 0 && (progress.clears ?? 0) === 0;
  const close = (): void => { store.actions.uiSound('close'); store.actions.closePanel('mapDevice'); };
  const onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement;
    // Keyboard use of the table: the game normally swallows Enter/Space on buttons, so let them through here
    if ((e.key === 'Enter' || e.key === ' ') && target.closest?.('button, summary, [role="tab"]')) { e.stopPropagation(); return; }
  };
  /** Bring the chart to an area without opening it: the pin tray and the Sources lens use it. */
  const focusArea = (id: AtlasAreaId): void => {
    store.actions.uiSound('click');
    inspect(id);
    setFocusReq((f) => ({ id, n: (f?.n ?? 0) + 1 }));
  };
  /** Open an area's modal (a click on the chart, "Go to ..." inside another modal). */
  const openArea = (id: AtlasAreaId): void => {
    if (!progress.discovered.includes(id)) return;
    inspect(id);
    areaModalSignal.set(id);
    setFocusReq((f) => ({ id, n: (f?.n ?? 0) + 1 }));
  };
  const closeModal = (): void => areaModalSignal.set(null);
  const pins = progress.pins ?? [];
  const pinSlots = pinSlotCount(progress.nodes);
  const pinMultiplier = pinMultiplierFor(progress.nodes);
  const pinBlocked = (id: AtlasAreaId): string | null => (pins.includes(id) ? null : pinError(progress, id));
  const stock = stockByArea(ch);
  const extras: ChartExtras = {
    lens, onLens: setLens, pins, pinSlots, pinMultiplier, pinBlocked, onPin: (id, pinned) => store.actions.pinArea(id, pinned),
    stock, sources: sourcesReadout, edges: sourceEdges(sourcesReadout), focus: focusReq, onFocus: focusArea,
  };
  // the modal's status line is about the AREA (cleared, available, needs a key); what the loaded map does is said inside the modal
  const modalModel = modalArea ? nodeModel(modalArea, { ...ctx, home: null }) : null;

  return (
    <Frame class={cx('fe-panel fe-solid fe-panel--left fe-device fe-device--table', compact && 'fe-device--compact', intro && 'fe-device--intro')} data-atlas-intro={intro ? '1' : '0'} role="region" aria-label="Atlas" data-panel="mapDevice" onKeyDown={onKeyDown as never}>
      <header class="fe-table__head">
        <div class="fe-table__tabs" role="tablist" aria-label="Atlas tabs">
          <button role="tab" aria-selected={tab === 'chart'} class={cx('fe-table__tab ui-type-body', tab === 'chart' && 'fe-table__tab--on')} onClick={() => { store.actions.uiSound('click'); setTab('chart'); }}>Chart</button>
          <button role="tab" aria-selected={tab === 'codex'} class={cx('fe-table__tab ui-type-body', tab === 'codex' && 'fe-table__tab--on')} onClick={() => { store.actions.uiSound('click'); closeModal(); setTab('codex'); }}>
            Codex{unspent > 0 && <span class="fe-table__badge ui-type-caption">{unspent}</span>}
          </button>
        </div>
        <h2 class="fe-table__title">The Atlas</h2>
        <div class="fe-table__meta ui-type-secondary">
          <span>{chartedCount(ctx.discovered)} / {ATLAS_AREAS.length} areas charted</span>
          <span class="fe-table__points">Points {Math.max(0, unspent)}</span>
        </div>
        <button class="fe-btn fe-btn--icon fe-btn--ghost fe-head__close fe-table__close" aria-label="Close" title="Close (Esc)" onClick={close}><span class="fe-x" /></button>
      </header>
      <CoachStrip panel="mapDevice" />
      <div class="fe-table__body">
        {tab === 'codex' && <div class="fe-codex"><MapTreeView onBack={() => setTab('chart')} areaId={courseId ?? undefined} /></div>}
        <AtlasChart
          tab={tab}
          progress={progress}
          inspected={inspected}
          courseId={courseId}
          tier={map?.tier ?? null}
          corrupted={!!map?.corrupted}
          keys={keys}
          modalOpen={!!modalArea}
          extras={extras}
          onInspect={openArea}
        />
        {tab === 'chart' && modalArea && modalModel && (
          <AreaModal
            area={modalArea} model={modalModel} compact={compact} gear={gear}
            pin={{ pinned: pins.includes(modalArea.id), used: pins.length, slots: pinSlots, multiplier: pinMultiplier, blocked: pinBlocked(modalArea.id),
              onToggle: () => store.actions.pinArea(modalArea.id, !pins.includes(modalArea.id)) }}
            onClose={closeModal} onGoto={openArea}
          />
        )}
      </div>
      <TableStatus portal={ownPortal} onEnter={() => { store.actions.closePanel('mapDevice'); local.flashHint('Click the glowing portal in your hideout to enter.'); }} />
    </Frame>
  );
}
