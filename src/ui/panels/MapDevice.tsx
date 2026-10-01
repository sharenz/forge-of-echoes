import { MAP_EVENT_KINDS } from '../../contracts/map-events';
// Map Device (own hideout only), now the Cartography Table (brief A): a full-screen Atlas chart with an inspector rail,
// the always-visible device dock (map slot with its home area, scarab sockets, price, Activate) and the Codex tab that hosts
// the Atlas tree. A map is bound to one area (brief D): slotting it points the chart at its home, there is no course to
// choose, and an empty slot leaves the chart browse-only. A key or a Bounty may redirect it through a passage. The table sits beside the inventory (which opens with it): maps and scarabs are dragged from the
// inventory into the dock's slots (Ctrl/Cmd-click quick-loads); stash items are moved into the inventory first. The
// panel keeps its id so hotkeys and drag targets keep working. In a party member's hideout it shows THEIR open portal instead (read-only).
import { mapEventOdds } from '../../game/progression/map-events';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { PortalInfo } from '../../contracts/net';
import { Button, Frame, cx } from '../components/common';
import { safe } from '../items/hooks';
import { useLocal } from '../local';
import { possessive } from '../lib/format';
import { useStore, useUi } from '../store';
import { PanelShell } from './PanelShell';
import { AtlasChart, type ChartExtras } from './Atlas';
import type { AtlasAreaId } from '../../contracts/atlas';
import { ATLAS_AREAS, ATLAS_START, findAtlasArea } from '../../data/progression/atlas';
import { newAtlas, pinError, pinSlotCount } from '../../game/progression/atlas';
import { pinMultiplierFor } from '../../data/progression/routing';
import { buildRouting, routingBiasFor, routingReadout } from '../../game/progression/map-routing';
import { DEFAULT_LENS, sourceEdges, stockByArea, type ChartLens } from '../atlas/lens';
import { passageOptions } from '../atlas/passage';
import { PassageSlot } from '../atlas/PassageSlot';
import { RechartPopover } from '../atlas/RechartPopover';
import { ITEM_CLASSES, type ItemClass } from '../../contracts/content';
import { BASES, CLASS_LABEL } from '../../data/items';
import { monsterLevelForTier } from '../../game/progression/maps';
import { MapTreeView } from './MapTree';
import { mapTreeFreePoints } from '../../game/progression/map-tree';
import { AtlasRail } from '../atlas/Rail';
import { surgeHold, useSurgeHold } from '../atlas/surge-view';
import { Dock, type DeviceReadout } from '../atlas/Dock';
import { chartedCount, nodeModel } from '../atlas/model';

/**
 * The table shares the screen with the inventory, so the inspector rail is a drawer on everything below a wide window
 * (and in short ones, the 1024x600 minimum); the dock reflows by the table's own width in CSS.
 */
function useCompact(): boolean {
  const query = '(max-width: 1499px), (max-height: 679px)';
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
  const home = map ? findAtlasArea(map.areaId) ?? null : null;
  const [passageId, setPassageId] = useState<string | null>(null);
  const [inspected, inspect] = useState<AtlasAreaId>(home?.id ?? ch?.atlas?.completed.at(-1) ?? ATLAS_START);
  const [tab, setTab] = useState<'chart' | 'codex'>('chart');
  const [railOpen, setRailOpen] = useState(false);
  const [lens, setLens] = useState<ChartLens>(DEFAULT_LENS);
  const [focusReq, setFocusReq] = useState<{ id: AtlasAreaId; n: number } | null>(null);
  const [rechartOpen, setRechartOpen] = useState(false);
  // Daily surge: the dock's Hold toggle decides whether the preview and the activation spend a charge; the server's clock decides the day.
  const holdSurge = useSurgeHold();
  const clockOffset = useUi((s) => s.serverClockOffset);
  const [lootClass, chooseClass] = useState<ItemClass>('wand');
  const progress = ch?.atlas ?? newAtlas();
  const keyOptions = useMemo(() => {
    const held = new Set<string>();
    for (const e of ch?.backpack.entries ?? []) if (e.item.kind === 'currency') held.add(e.item.currencyId);
    return held;
  }, [ch]);
  // Passages (brief D 2.5): a key held in the inventory offers its sealed area, a Bounty map bound to the Pit's entrance offers the Pit.
  // Both are choices made in the dock's passage slot; with none chosen the map opens its own area.
  const passages = useMemo(() => passageOptions(map, progress, keyOptions), [map, keyOptions, progress]);
  const passage = passages.find((p) => p.id === passageId) ?? null;
  // The area that will be run: the passage destination, else the map's own area.
  const runArea = map ? findAtlasArea(passage?.area ?? map.areaId) ?? null : null;
  const viewArea = findAtlasArea(inspected)!;
  // Slotting, removing or swapping a map points the chart at where it lives (and drops a passage that no longer applies).
  useEffect(() => { if (runArea) inspect(runArea.id); }, [map?.uid, runArea?.id]);
  useEffect(() => { if (passageId && !passage) setPassageId(null); }, [passageId, passage]);
  useEffect(() => { setPassageId(null); }, [map?.uid]);
  useEffect(() => { setRechartOpen(false); }, [map?.uid, map?.areaId]);

  const readout: DeviceReadout | null = useMemo(() => {
    if (!ch || !map || !runArea) return null;
    const effective = { ...map, areaId: runArea.id, baseId: runArea.baseId };
    const desc = safe(() => store.rules.describeItem(effective, ch), null);
    // openMap is pure: preview the run setup to compute this player's personal luck exactly.
    const preview = safe(() => store.rules.openMap(ch, { lootClass, useSurge: holdSurge, now: Date.now() + clockOffset, ...(passage ? { passage: passage.key ? { kind: 'key' as const, currencyId: passage.key } : { kind: 'bounty' as const } } : {}) }), null);
    const summary = preview?.ok ? preview.value.setup.summary : safe(() => store.rules.mapSummary(ch, effective), []);
    const luck = preview && preview.ok ? safe(() => store.rules.lootLuck(preview.value.setup, ch), null) : null;
    const mapLuck = preview && preview.ok ? { q: preview.value.setup.itemQuantity, r: preview.value.setup.itemRarity } : null;
    // "Where your maps come from": the frozen table of the preview, or (when the preview is refused, e.g. a missing fee) the same call
    // openMap makes, so the table can always be read before activating.
    const discovered = new Set<string>(ch.atlas?.discovered ?? [ATLAS_START]);
    const frozen = preview?.ok ? preview.value.setup.routing
      : safe(() => buildRouting({ from: map.areaId, runArea: runArea.id, tier: map.tier, bias: routingBiasFor(ch.atlas, (ch.mapScarabs ?? []).flatMap((s) => (s ? [s.currencyId] : [])) as never, { from: map.areaId }), ...(ch.atlas ? { atlas: ch.atlas } : {}) }), undefined);
    const routing = frozen ? safe(() => routingReadout(frozen, map.tier, discovered), null) : null;
    return { desc, summary, luck, mapLuck, routing, events: mapEventOdds(effective, runArea.id, ch.atlas?.nodes), error: preview && !preview.ok ? preview.error : null } as unknown as DeviceReadout;
  }, [ch, map, store, runArea?.id, lootClass, passage?.id, holdSurge]);

  // Odds for the area being inspected when it is the one the map opens; otherwise the rail explains where they show.
  const railOdds = useMemo(() => (ch && map && runArea && inspected === runArea.id ? safe(() => mapEventOdds({ ...map, areaId: runArea.id, baseId: runArea.baseId }, inspected, ch.atlas?.nodes), null) : null), [ch, map, inspected, runArea?.id]);
  const keys = useMemo(() => {
    const out = new Set<string>();
    if (!ch) return out;
    for (const [id, n] of Object.entries(ch.currencyStash)) if ((n ?? 0) > 0) out.add(id);
    for (const e of ch.backpack.entries) if (e.item.kind === 'currency') out.add(e.item.currencyId);
    return out;
  }, [ch]);

  const disabled = !own || zone !== 'hideout';
  // Esc closes the innermost layer first (readout popover in the dock, then the compact inspector) whatever holds
  // focus, and only then the whole table. Capture phase, so it runs before the game's Esc.
  useEffect(() => {
    if (!ch || disabled) return;
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (compact && railOpen) { e.stopImmediatePropagation(); e.preventDefault(); setRailOpen(false); }
    };
    window.addEventListener('keydown', onEsc, true);
    return () => window.removeEventListener('keydown', onEsc, true);
  }, [!!ch, disabled, railOpen, compact]);

  if (!ch) return null;
  const ownPortal = portal && zoneIsOwn ? portal : null;
  const hostPortal = portal && !zoneIsOwn && zone === 'hideout' ? portal : null;
  // Gear share of the personal luck: the character sheet's % increased from gear (DerivedStats).
  const gear = derived ? { q: 100 + derived.itemQuantity, r: 100 + derived.itemRarity } : null;

  const activate = (): void => {
    store.actions.uiSound('open');
    store.actions.activateMapDevice({
      ...(runArea?.chosenClass ? { lootClass } : {}),
      ...(passage?.key ? { passageKey: passage.key } : {}),
      ...(passage?.pit ? { pit: true as const } : {}),
      useSurge: surgeHold(),
    });
  };
  const confirmActivate = (): void => {
    const next = runArea?.name ?? 'this map';
    if (ownPortal && ownPortal.remaining > 0 && !ownPortal.cleared) {
      local.dialog.set({
        title: 'Open a new map',
        body: `Open ${next}? Your ${ownPortal.mapName} portal (${ownPortal.remaining} left) closes once nobody is inside.`,
        confirmLabel: 'Activate',
        onConfirm: activate,
      });
      return;
    }
    activate();
  };

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

  const ctx = { discovered: new Set<string>(progress.discovered), completed: new Set<string>(progress.completed), tier: map?.tier ?? null, keys, fresh: new Set<string>(), corrupted: !!map?.corrupted, home: runArea?.id ?? null };
  const viewModel = nodeModel(viewArea, ctx);
  const unspent = mapTreeFreePoints(ch.atlas); // earned minus the cost of every allocated node (keystones cost 2)
  const close = (): void => { store.actions.uiSound('close'); store.actions.closePanel('mapDevice'); };
  const ready = !!map && !readout?.error;
  const onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement;
    // Keyboard use of the table: the game normally swallows Enter/Space on buttons, so let them through here, and
    // E lights the device when it is ready (brief 6.4)
    if ((e.key === 'Enter' || e.key === ' ') && target.closest?.('button, summary, [role="tab"]')) { e.stopPropagation(); return; }
    if ((e.key === 'e' || e.key === 'E') && !e.ctrlKey && !e.metaKey && !e.altKey && !(target instanceof HTMLInputElement || target instanceof HTMLSelectElement)) {
      e.stopPropagation();
      if (ready) { e.preventDefault(); confirmActivate(); }
      return;
    }
  };
  /** Bring the chart (and the rail) to an area: the pin tray, the Sources rows and "Show home" all use it. */
  const focusArea = (id: AtlasAreaId): void => {
    store.actions.uiSound('click');
    inspect(id);
    setFocusReq((f) => ({ id, n: (f?.n ?? 0) + 1 }));
    if (compact) setRailOpen(true);
  };
  const showHome = (): void => {
    if (!runArea) return;
    store.actions.uiSound('click');
    inspect(runArea.id);
    setFocusReq((f) => ({ id: runArea.id, n: (f?.n ?? 0) + 1 }));
    if (compact) setRailOpen(false);
  };
  const pins = progress.pins ?? [];
  const pinSlots = pinSlotCount(progress.nodes);
  const pinMultiplier = pinMultiplierFor(progress.nodes);
  const pinBlocked = (id: AtlasAreaId): string | null => (pins.includes(id) ? null : pinError(progress, id));
  const stock = stockByArea(ch);
  const sourcesReadout = readout?.routing ?? null;
  const extras: ChartExtras = {
    lens, onLens: setLens, pins, pinSlots, pinMultiplier, pinBlocked, onPin: (id, pinned) => store.actions.pinArea(id, pinned),
    stock, sources: sourcesReadout, edges: sourceEdges(sourcesReadout), focus: focusReq, onFocus: focusArea,
  };

  return (
    <Frame class={cx('fe-panel fe-solid fe-panel--left fe-device fe-device--table', compact && 'fe-device--compact')} role="region" aria-label="Atlas" data-panel="mapDevice" onKeyDown={onKeyDown as never}>
      <header class="fe-table__head">
        <div class="fe-table__tabs" role="tablist" aria-label="Cartography Table">
          <button role="tab" aria-selected={tab === 'chart'} class={cx('fe-table__tab ui-type-body', tab === 'chart' && 'fe-table__tab--on')} onClick={() => { store.actions.uiSound('click'); setTab('chart'); }}>Chart</button>
          <button role="tab" aria-selected={tab === 'codex'} class={cx('fe-table__tab ui-type-body', tab === 'codex' && 'fe-table__tab--on')} onClick={() => { store.actions.uiSound('click'); setTab('codex'); }}>
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
      <div class="fe-table__body">
        {tab === 'codex' && <div class="fe-codex"><MapTreeView onBack={() => setTab('chart')} areaId={runArea?.id} /></div>}
        <AtlasChart
          tab={tab}
          progress={progress}
          inspected={inspected}
          courseId={runArea?.id ?? null}
          tier={map?.tier ?? null}
          corrupted={!!map?.corrupted}
          keys={keys}
          compactRail={compact}
          railOpen={railOpen}
          extras={extras}
          onInspect={(id) => { inspect(id); if (compact) setRailOpen(true); }}
          rail={() => (
            <AtlasRail
              area={viewArea} model={viewModel} tier={map?.tier ?? null} map={runArea && viewArea.id === runArea.id ? map : null} odds={railOdds}
              homeName={runArea?.name ?? null} blocked={viewModel.blocker} onGoHome={showHome}
              motion={!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches} compact={compact} onClose={() => setRailOpen(false)}
              pin={{ pinned: pins.includes(viewArea.id), used: pins.length, slots: pinSlots, multiplier: pinMultiplier, blocked: pinBlocked(viewArea.id),
                onToggle: () => store.actions.pinArea(viewArea.id, !pins.includes(viewArea.id)) }}
              held={stock.get(viewArea.id)?.count ?? 0}
              sources={runArea && viewArea.id === runArea.id ? sourcesReadout : null}
              onFocus={focusArea}
            />
          )}
        />
      </div>
      {ownPortal && <PortalNote portal={ownPortal} own />}
      <Dock area={runArea} home={home} map={map} readout={readout} gear={gear} activate={confirmActivate} compact={compact} stashedMaps={ch.mapStash?.length ?? 0}
        onCourse={() => { if (runArea) inspect(runArea.id); if (compact) setRailOpen(true); }} onFocus={focusArea}
        passage={<PassageSlot options={passages} chosen={passage} onChoose={setPassageId} map={map} atlas={progress} held={keyOptions} />}
        onRechart={() => setRechartOpen((o) => !o)}
        rechartPop={rechartOpen && map ? <RechartPopover class="fe-dock__rechart" map={map} onClose={() => setRechartOpen(false)} /> : null}>
        {runArea?.chosenClass && (
          <label class="fe-device__class ui-type-secondary fe-dock__class">Hunter rewards
            <select aria-label="Hunter reward class" value={lootClass} onChange={(e) => chooseClass(e.currentTarget.value as ItemClass)}>
              {ITEM_CLASSES.map((id) => <option key={id} value={id} disabled={!!map && !Object.values(BASES).some((b) => b.itemClass === id && b.levelRequirement <= monsterLevelForTier(map.tier))}>{CLASS_LABEL[id]}</option>)}
            </select>
          </label>
        )}
      </Dock>
    </Frame>
  );
}
