import { MAP_EVENT_KINDS } from '../../contracts/map-events';
// Map Device (own hideout only), now the Cartography Table (brief A): a full-screen Atlas chart with an inspector rail,
// the always-visible device dock (course, map slot, scarab sockets, price, Activate), a Stash drawer that re-houses
// the Map Stash picker and the scarab list, and the Codex tab that hosts the Atlas tree. The panel keeps its id so
// hotkeys and drag targets keep working. In a party member's hideout it shows THEIR open portal instead (read-only).
import { mapEventOdds } from '../../game/progression/map-events';
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { PortalInfo } from '../../contracts/net';
import { Button, Frame, cx } from '../components/common';
import { safe } from '../items/hooks';
import { useLocal } from '../local';
import { possessive } from '../lib/format';
import { useStore, useUi } from '../store';
import { PanelShell } from './PanelShell';
import { AtlasChart } from './Atlas';
import type { AtlasAreaId } from '../../contracts/atlas';
import { ATLAS_AREAS, ATLAS_START, findAtlasArea } from '../../data/progression/atlas';
import { newAtlas } from '../../game/progression/atlas';
import { ITEM_CLASSES, type ItemClass } from '../../contracts/content';
import { BASES, CLASS_LABEL } from '../../data/items';
import { monsterLevelForTier } from '../../game/progression/maps';
import { MapTreeView } from './MapTree';
import { mapTreeFreePoints } from '../../game/progression/map-tree';
import { AtlasRail } from '../atlas/Rail';
import { Dock, type DeviceReadout } from '../atlas/Dock';
import { StashDrawer } from '../atlas/StashDrawer';
import { chartedCount, nodeModel } from '../atlas/model';

/** Narrow or short windows (the 1024x600 minimum) turn the rail into a drawer and the dock into one slim row. */
function useCompact(): boolean {
  const query = '(max-width: 1179px), (max-height: 679px)';
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
              : 'Click the portal to enter. Activating a new map closes it once nobody is inside.'
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
  const [areaId, selectArea] = useState<AtlasAreaId>(ch?.atlas?.completed.at(-1) ?? ATLAS_START);
  const [inspected, inspect] = useState<AtlasAreaId>(areaId);
  const [tab, setTab] = useState<'chart' | 'codex'>('chart');
  const [stashOpen, setStashOpen] = useState(() => !!ch && !ch.mapDevice && (ch.mapStash?.length ?? 0) > 0);
  const [railOpen, setRailOpen] = useState(false);
  const [lootClass, chooseClass] = useState<ItemClass>('wand');
  const area = findAtlasArea(areaId)!;
  const viewArea = findAtlasArea(inspected)!;
  const map = ch?.mapDevice ?? null;
  const progress = ch?.atlas ?? newAtlas();

  const readout: DeviceReadout | null = useMemo(() => {
    if (!ch || !map) return null;
    const effective = { ...map, baseId: area.baseId };
    const desc = safe(() => store.rules.describeItem(effective, ch), null);
    // openMap is pure: preview the run setup to compute this player's personal luck exactly.
    const preview = safe(() => store.rules.openMap(ch, areaId, lootClass), null);
    const summary = preview?.ok ? preview.value.setup.summary : safe(() => store.rules.mapSummary(ch, effective), []);
    const luck = preview && preview.ok ? safe(() => store.rules.lootLuck(preview.value.setup, ch), null) : null;
    const mapLuck = preview && preview.ok ? { q: preview.value.setup.itemQuantity, r: preview.value.setup.itemRarity } : null;
    return { desc, summary, luck, mapLuck, events: mapEventOdds(effective, areaId, ch.atlas?.nodes), error: preview && !preview.ok ? preview.error : null } as unknown as DeviceReadout;
  }, [ch, map, store, areaId, lootClass]);

  // Odds for the area being inspected (not necessarily the course): the rail shows them beside the fights and drops.
  const railOdds = useMemo(() => (ch && map ? safe(() => mapEventOdds({ ...map, baseId: viewArea.baseId }, inspected, ch.atlas?.nodes), null) : null), [ch, map, inspected, viewArea]);
  const keys = useMemo(() => {
    const out = new Set<string>();
    if (!ch) return out;
    for (const [id, n] of Object.entries(ch.currencyStash)) if ((n ?? 0) > 0) out.add(id);
    for (const e of ch.backpack.entries) if (e.item.kind === 'currency') out.add(e.item.currencyId);
    return out;
  }, [ch]);

  const disabled = !own || zone !== 'hideout';
  // Esc closes the innermost layer first (readout popover in the dock, then the Stash drawer, then the compact
  // inspector) whatever holds focus, and only then the whole table. Capture phase, so it runs before the game's Esc.
  useEffect(() => {
    if (!ch || disabled) return;
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      if (stashOpen) { e.stopImmediatePropagation(); e.preventDefault(); setStashOpen(false); }
      else if (compact && railOpen) { e.stopImmediatePropagation(); e.preventDefault(); setRailOpen(false); }
    };
    window.addEventListener('keydown', onEsc, true);
    return () => window.removeEventListener('keydown', onEsc, true);
  }, [!!ch, disabled, stashOpen, railOpen, compact]);

  if (!ch) return null;
  const ownPortal = portal && zoneIsOwn ? portal : null;
  const hostPortal = portal && !zoneIsOwn && zone === 'hideout' ? portal : null;
  // Gear share of the personal luck: the character sheet's % increased from gear (DerivedStats).
  const gear = derived ? { q: 100 + derived.itemQuantity, r: 100 + derived.itemRarity } : null;

  const activate = (): void => {
    store.actions.uiSound('open');
    store.actions.activateMapDevice(areaId, area.chosenClass ? lootClass : undefined);
  };
  const confirmActivate = (): void => {
    const next = area.name;
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

  const ctx = { discovered: new Set<string>(progress.discovered), completed: new Set<string>(progress.completed), tier: map?.tier ?? null, keys, fresh: new Set<string>(), corrupted: !!map?.corrupted };
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
  const setCourse = (): void => { store.actions.uiSound('click'); selectArea(inspected); };
  const stashToggle = (): void => { store.actions.uiSound('click'); setStashOpen((v) => !v); };

  return (
    <Frame class={cx('fe-panel fe-solid fe-panel--left fe-device fe-device--table', compact && 'fe-device--compact')} role="region" aria-label="Atlas" data-panel="mapDevice" onKeyDown={onKeyDown as never}>
      <header class="fe-table__head">
        <div class="fe-table__tabs" role="tablist" aria-label="Cartography Table">
          <button role="tab" aria-selected={tab === 'chart'} class={cx('fe-table__tab ui-type-body', tab === 'chart' && 'fe-table__tab--on')} onClick={() => { store.actions.uiSound('click'); setTab('chart'); }}>Chart</button>
          <button role="tab" aria-selected={tab === 'codex'} class={cx('fe-table__tab ui-type-body', tab === 'codex' && 'fe-table__tab--on')} onClick={() => { store.actions.uiSound('click'); setTab('codex'); }}>
            Codex{unspent > 0 && <span class="fe-table__badge ui-type-caption">{unspent}</span>}
          </button>
          <button aria-expanded={stashOpen} class={cx('fe-table__tab ui-type-body', stashOpen && 'fe-table__tab--on')} onClick={stashToggle}>Stash</button>
        </div>
        <h2 class="fe-table__title">The Atlas</h2>
        <div class="fe-table__meta ui-type-secondary">
          <span>{chartedCount(ctx.discovered)} / {ATLAS_AREAS.length} areas charted</span>
          <span class="fe-table__points">Points {Math.max(0, unspent)}</span>
        </div>
        <button class="fe-btn fe-btn--icon fe-btn--ghost fe-head__close fe-table__close" aria-label="Close" title="Close (Esc)" onClick={close}><span class="fe-x" /></button>
      </header>
      <div class="fe-table__body">
        {tab === 'codex' && <div class="fe-codex"><MapTreeView onBack={() => setTab('chart')} areaId={areaId} /></div>}
        <AtlasChart
          tab={tab}
          progress={progress}
          inspected={inspected}
          courseId={areaId}
          tier={map?.tier ?? null}
          corrupted={!!map?.corrupted}
          keys={keys}
          drawerOpen={stashOpen}
          compactRail={compact}
          railOpen={railOpen}
          onInspect={(id) => { inspect(id); if (compact) setRailOpen(true); }}
          onSetCourse={(id) => { store.actions.uiSound('click'); selectArea(id); inspect(id); }}
          rail={() => (
            <AtlasRail
              area={viewArea} model={viewModel} tier={map?.tier ?? null} map={map} odds={railOdds} courseId={areaId}
              blocked={viewModel.blocker} onSetCourse={setCourse} onOpenStash={() => setStashOpen(true)}
              motion={!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches} compact={compact} onClose={() => setRailOpen(false)}
            />
          )}
        />
        <StashDrawer ch={ch} open={stashOpen} hasMap={!!map} onClose={() => setStashOpen(false)} />
      </div>
      {ownPortal && <PortalNote portal={ownPortal} own />}
      <Dock area={area} map={map} readout={readout} gear={gear} activate={confirmActivate} compact={compact} onOpenStash={() => setStashOpen(true)} stashOpen={stashOpen} onCourse={() => { inspect(areaId); if (compact) setRailOpen(true); }}>
        {area.chosenClass && (
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
