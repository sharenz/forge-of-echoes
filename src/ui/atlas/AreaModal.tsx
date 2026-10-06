// The area modal (Atlas UX rework): click an area on the chart and this opens for THAT area, beside the player's inventory. In the centre the
// map slot (large) with the four scarab sockets around it (and a passage slot only for sealed areas and the Pit), under it the map's own
// readout; beside it the live readout, then everything the old inspector rail said about the area; at the bottom "Open area" with the
// reason it is disabled always written out. Items are dragged in from the inventory (Ctrl/Cmd-click quick-loads); the items that fit this
// area carry a quiet highlight in the inventory. A map is bound to its area: a map of another area is refused with "This map opens X" and a
// one-click "Go to X" that switches the modal and keeps the map in the slot. Nothing here is a second implementation of a rule: the numbers
// are the rules' own (readout.ts), the refusals are area-modal.ts's, and activation is the existing activateMapDevice command.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { AtlasAreaId } from '../../contracts/atlas';
import type { MapItem } from '../../contracts/items';
import type { ItemClass } from '../../contracts/content';
import { ITEM_CLASSES } from '../../contracts/content';
import { PORTALS_PER_MAP } from '../../contracts/net';
import { BASES, CLASS_LABEL, CURRENCIES } from '../../data/items';
import { MAP_EVENT_NAMES } from '../../data/progression/map-events';
import { MAP_EVENT_KINDS } from '../../contracts/map-events';
import { findAtlasArea, type AtlasAreaDef } from '../../data/progression/atlas';
import { findScarab } from '../../data/scarabs';
import { newAtlas, territoryEntryFee } from '../../game/progression/atlas';
import { mapEventOdds } from '../../game/progression/map-events';
import { monsterLevelForTier } from '../../game/progression/maps';
import { Button, cx } from '../components/common';
import { ItemView } from '../items/ItemView';
import { ScarabSlotView } from '../items/Containers';
import { safe } from '../items/hooks';
import { formatLuck } from '../lib/format';
import { useLocal } from '../local';
import { useSignal, useStore, useUi } from '../store';
import { setOpeningArea, useActivation } from './activation';
import { fittingUids, mapFit, openAreaBlock, passageNeed, planIsEmpty, readSetups, rememberSetup, currentSetup, setupPlan, whereToFind, type WhereToFind } from './area-modal';
import { AreaDetails, AreaFacts, AreaHero, type AreaPin } from './AreaInfo';
import type { NodeModel } from './model';
import { PassageSlot } from './PassageSlot';
import { passageOptions } from './passage';
import { deviceReadout } from './readout';
import { ReadoutDetail } from './ReadoutDetail';
import { RechartPopover } from './RechartPopover';
import { SourcesLine } from './SourcesPanel';
import { SurgeHold } from './SurgePips';
import { surgeHold, useSurgeHold } from './surge-view';

/** The big map slot. A panel-owned drop slot: a map of this area (or a map a passage can carry here) loads, anything else is refused with its reason. */
function AreaMapSlot({ area, map, mismatch, onRefused }: { area: AtlasAreaDef; map: MapItem | null; mismatch: boolean; onRefused: (uid: string, goto: AtlasAreaId, reason: string) => void }) {
  const local = useLocal();
  const store = useStore();
  const drag = useSignal(local.drag);
  useEffect(() => {
    local.slots.set('mapDevice', {
      tag: 'Load into the map slot',
      accepts: (d) => {
        if (d.item.kind !== 'map') return 'Only a map goes in this slot.';
        const fit = mapFit(d.item, area);
        if (!fit.ok) return fit.reason;
        const ch = store.get().character;
        if (!ch || d.from.kind === 'mapDevice') return null;
        const res = safe(() => store.rules.moveItem(ch, d.uid, { kind: 'mapDevice' }), { ok: false as const, error: 'That map cannot go there.' });
        return res.ok ? null : res.error;
      },
      onDrop: (d) => { if (d.from.kind !== 'mapDevice') store.actions.moveItem(d.uid, { kind: 'mapDevice' }); },
      onRefused: (d) => {
        if (d.item.kind !== 'map') return;
        const fit = mapFit(d.item, area);
        if (!fit.ok && fit.goto) onRefused(d.uid, fit.goto, fit.reason);
      },
    });
    return () => { local.slots.delete('mapDevice'); };
  }, [local, store, area, onRefused]);
  const hovered = drag?.target?.slot === 'mapDevice' ? (drag.target.valid ? 'ok' : 'bad') : null;
  const accepts = drag?.item.kind === 'map' && mapFit(drag.item, area).ok;
  return (
    <div class={cx('fe-device-slot fe-solid fe-amodal__mapslot', accepts && 'fe-slot--accepts', hovered && `fe-slot--${hovered}`, map && 'fe-device-slot--filled', mismatch && 'fe-device-slot--mismatch')}
      data-drop="slot" data-slot="mapDevice" role="group" aria-label="Map slot"
      title={map ? undefined : 'Map slot: drag a map here from your inventory (or Ctrl/Cmd-click it)'}>
      {map
        ? <ItemView item={map} uid={map.uid} from={{ kind: 'mapDevice' }} mode="slot" class={drag?.uid === map.uid ? 'fe-item--lifted' : undefined} />
        : <span class="fe-device-slot__hint ui-type-caption">Drop<br />map</span>}
    </div>
  );
}

const firstSentence = (text: string): string => text.split(/(?<=\.)\s/)[0] ?? text;

export function AreaModal({ area, model, pin, compact, gear, onClose, onGoto }: {
  area: AtlasAreaDef;
  model: NodeModel;
  pin: AreaPin;
  compact: boolean;
  gear: { q: number; r: number } | null;
  onClose: () => void;
  /** Switch the modal to another area (the chart eases to it). */
  onGoto: (id: AtlasAreaId) => void;
}) {
  const store = useStore();
  const local = useLocal();
  const ch = useUi((s) => s.character);
  const clockOffset = useUi((s) => s.serverClockOffset);
  const portal = useUi((s) => (s.hud?.zoneIsOwn ?? true ? s.hud?.portal ?? null : null));
  const hold = useSurgeHold();
  const root = useRef<HTMLDivElement>(null);
  const headingId = 'fe-amodal-title';
  const reasonId = 'fe-amodal-reason';
  const [lootClass, chooseClass] = useState<ItemClass>('wand');
  const [keyChosen, setKeyChosen] = useState(false);
  const [wrong, setWrong] = useState<{ uid: string; goto: AtlasAreaId; reason: string } | null>(null);
  const [rechartOpen, setRechartOpen] = useState(false);
  const [fullReadout, setFullReadout] = useState(false);
  const [setupTick, setSetupTick] = useState(0);
  void setupTick;
  const map = ch?.mapDevice ?? null;
  const progress = ch?.atlas ?? newAtlas();
  const need = passageNeed(area);
  const keyId = need?.keyId ?? null;

  // a new area starts clean: no chosen key, no stale refusal, no open popover
  useEffect(() => {
    setKeyChosen(false); setWrong(null); setRechartOpen(false); setFullReadout(false);
    // "Go to ..." removes the button that held focus: keep the keys (Esc, Enter) inside the dialog
    const el = root.current;
    if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [area.id]);
  useEffect(() => { setWrong(null); }, [map?.uid]);

  const held = useMemo(() => {
    const out = new Set<string>();
    for (const e of ch?.backpack.entries ?? []) if (e.item.kind === 'currency') out.add(e.item.currencyId);
    return out;
  }, [ch]);
  const keyHeld = !!keyId && held.has(keyId);
  // a key that left the inventory is no longer chosen
  useEffect(() => { if (keyChosen && !keyHeld) setKeyChosen(false); }, [keyChosen, keyHeld]);

  const passages = useMemo(() => passageOptions(map, progress, held), [map, progress, held]);
  const passage = need ? (need.kind === 'key' ? (keyChosen ? passages.find((p) => p.key === keyId) ?? null : null) : passages.find((p) => p.pit) ?? null) : null;
  const fit = map ? mapFit(map, area) : null;
  const mismatch = !!map && !!fit && !fit.ok;
  const runArea: AtlasAreaDef | null = map && fit?.ok ? (need ? (passage ? findAtlasArea(passage.area) ?? null : null) : area) : null;

  const readout = useMemo(() => (ch && map && runArea ? deviceReadout(store, ch, map, runArea, { lootClass, hold, clockOffset, passage: passage ? (passage.key ? { key: passage.key } : { pit: true as const }) : null }) : null),
    [ch, map, store, runArea?.id, lootClass, hold, passage?.id, clockOffset]);
  // the map's own description while no readout exists yet (a sealed area still waiting for its key)
  const desc = useMemo(() => readout?.desc ?? (ch && map ? safe(() => store.rules.describeItem({ ...map, areaId: map.areaId } as MapItem, ch), null) : null), [readout, ch, map, store]) as ReturnType<typeof deviceReadout>['desc'];
  const odds = useMemo(() => (map && runArea && ch ? safe(() => mapEventOdds({ ...map, areaId: runArea.id, baseId: runArea.baseId }, runArea.id, ch.atlas?.nodes), null) : null), [map, runArea?.id, ch]);

  const block = openAreaBlock({ area, map, passageChosen: !need || !!passage, previewError: readout?.error ?? null });
  const ready = block === null;

  // the inventory highlight: what fits this area (a highlight, never a list)
  useEffect(() => {
    if (!ch) return;
    local.fits.set(fittingUids(ch, area));
    return () => local.fits.set(null);
  }, [local, ch, area]);
  useEffect(() => () => local.fits.set(null), [local]);

  // ---- activation ------------------------------------------------------------------------------------------
  const { pulse } = useActivation();
  const seenPulse = useRef(pulse);
  useEffect(() => {
    if (pulse === seenPulse.current) return;
    seenPulse.current = pulse;
    onClose();
  }, [pulse]);
  const activate = (): void => {
    if (!ch || !runArea) return;
    store.actions.uiSound('open');
    rememberSetup(area.id, currentSetup(ch, passage?.key));
    setOpeningArea(area.id);
    store.actions.activateMapDevice({
      ...(runArea.chosenClass ? { lootClass } : {}),
      ...(passage?.key ? { passageKey: passage.key } : {}),
      ...(passage?.pit ? { pit: true as const } : {}),
      useSurge: surgeHold(),
    });
  };
  const replacing = portal && portal.remaining > 0 && !portal.cleared ? portal : null;
  const confirmActivate = (): void => {
    if (!ready) return;
    if (replacing) {
      local.dialog.set({
        title: 'Open a new area',
        body: `Open ${runArea?.name ?? area.name}? Your ${replacing.mapName} portal (${replacing.remaining} left) closes once nobody is inside.`,
        confirmLabel: 'Open area',
        onConfirm: activate,
      });
      return;
    }
    activate();
  };

  // ---- keyboard, focus ---------------------------------------------------------------------------------------
  // Esc closes the modal first (capture phase, before the game's own Esc): a re-chart popover or a confirmation dialog on top of it takes the key first.
  useLayoutEffect(() => {
    const onEsc = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || rechartOpen || local.dialog.get()) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      store.actions.uiSound('close');
      onClose();
    };
    window.addEventListener('keydown', onEsc, true);
    return () => window.removeEventListener('keydown', onEsc, true);
  }, [rechartOpen, onClose, local, store]);
  // Focus lands on the dialog; it goes back to the area's node on close when the chart was driven by keyboard.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const viaKeyboard = !!opener?.matches?.('[data-area]:focus-visible');
    root.current?.focus({ preventScroll: true });
    return () => { if (viaKeyboard && opener?.isConnected) opener.focus({ preventScroll: true }); };
  }, []);
  const onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement;
    if (e.key === 'Tab') {
      // aria-modal: Tab cycles inside the dialog
      const items = [...(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select, [tabindex="0"], summary') ?? [])].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0]!, last = items[items.length - 1]!;
      if (e.shiftKey && (target === first || target === root.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && target === last) { e.preventDefault(); first.focus(); }
      e.stopPropagation();
      return;
    }
    const onControl = !!target.closest?.('button, summary, select, input, [role="button"]');
    if (e.key === 'Enter' && !onControl) { e.stopPropagation(); e.preventDefault(); if (ready) confirmActivate(); return; }
    if ((e.key === 'e' || e.key === 'E') && !e.ctrlKey && !e.metaKey && !e.altKey && !(target instanceof HTMLSelectElement)) {
      e.stopPropagation();
      if (ready) { e.preventDefault(); confirmActivate(); }
    }
  };

  // ---- remembered setup --------------------------------------------------------------------------------------
  const plan = ch ? setupPlan(readSetups()[area.id], ch, keyChosen ? keyId ?? undefined : undefined) : null;
  const repeat = (): void => {
    if (!plan || planIsEmpty(plan)) return;
    store.actions.uiSound('click');
    for (const m of plan.moves) store.actions.moveItem(m.uid, { kind: 'scarabSlot', index: m.index });
    if (plan.key) setKeyChosen(true);
    setSetupTick((n) => n + 1);
  };

  // ---- the empty state ---------------------------------------------------------------------------------------
  const heldMaps = useMemo(() => (ch ? ch.backpack.entries.filter((e) => e.item.kind === 'map' && mapFit(e.item, area).ok).length : 0), [ch, area]);
  const stashed = (ch?.mapStash ?? []).filter((m) => mapFit(m, area).ok).length;
  const find: WhereToFind | null = useMemo(() => (ch && !map ? whereToFind(area, ch.atlas, ch) : null), [ch, map, area]);

  if (!ch) return null;
  const gotoName = (id: AtlasAreaId | null): string => (id ? findAtlasArea(id)?.name ?? 'that area' : 'that area');
  const noticeGoto = wrong?.goto ?? (mismatch && fit && !fit.ok ? fit.goto : null);
  const noticeText = wrong?.reason ?? (mismatch && fit && !fit.ok ? fit.reason : null);
  const goToNotice = (): void => {
    if (!noticeGoto) return;
    store.actions.uiSound('click');
    // the dragged map goes into the device first, then the modal follows it: it stays in the slot of its own area
    if (wrong && map?.uid !== wrong.uid) store.actions.moveItem(wrong.uid, { kind: 'mapDevice' });
    setWrong(null);
    onGoto(noticeGoto);
  };
  const takeOut = (): void => { if (map) { store.actions.uiSound('click'); store.actions.quickMove(map.uid); } };
  const fee = map && runArea ? territoryEntryFee(map.tier, runArea.id) : null;
  const scarabs = (ch.mapScarabs ?? []).flatMap((s) => { const def = s ? findScarab(s.currencyId) : undefined; return def ? [def] : []; });
  const dangers = desc?.affixes.filter((a) => a.negative) ?? [];
  const sum = (label: string): string | null => readout?.summary.find((l) => l.label === label)?.value ?? null;
  const activeEvents = readout ? MAP_EVENT_KINDS.filter((k) => (readout.events[k] ?? 0) > 0) : [];
  const mapState = !map ? 'empty' : mismatch ? 'mismatch' : 'ok';

  return (
    <div class="fe-amodal__scrim" data-area-scrim onPointerDown={(e) => { if (e.target === e.currentTarget) { store.actions.uiSound('close'); onClose(); } }}>
      <div ref={root} class={cx('fe-amodal fe-solid', compact && 'fe-amodal--compact')} role="dialog" aria-modal="true" aria-labelledby={headingId} aria-describedby={reasonId} tabIndex={-1}
        data-area-modal={area.id} data-map-state={mapState} onKeyDown={onKeyDown as never}>
        <AreaHero area={area} model={model} pin={pin} headingId={headingId} onClose={() => { store.actions.uiSound('close'); onClose(); }} />
        <div class="fe-amodal__scroll fe-scrollfade">
          <AreaFacts area={area} model={model} />
          <div class="fe-amodal__main">
            <section class="fe-amodal__device" aria-label="Map device">
              <div class={cx('fe-amodal__ring', need && 'fe-amodal__ring--passage')} data-ring>
                <div class={cx('fe-device__circle fe-amodal__circle', map && !mismatch && 'fe-device__circle--charged')}>
                  <AreaMapSlot area={area} map={map} mismatch={mismatch} onRefused={(uid, goto, reason) => { setWrong({ uid, goto, reason }); }} />
                </div>
                {[0, 1, 2, 3].map((i) => <div key={i} class={cx('fe-amodal__sock', `fe-amodal__sock--${i}`)}><ScarabSlotView index={i} /></div>)}
                {need && (
                  <div class="fe-amodal__passage">
                    <PassageSlot need={need} areaName={area.name} chosen={need.kind === 'key' ? keyChosen && keyHeld : !!passage} held={keyHeld} onChoose={setKeyChosen} />
                    <span class="ui-type-caption fe-amodal__slotlabel">Passage</span>
                  </div>
                )}
              </div>

              {plan && !planIsEmpty(plan) && (
                <button type="button" class="fe-amodal__repeat ui-type-secondary" data-repeat-setup onClick={repeat}
                  title={`Repeat your last setup here: ${plan.wanted.join(', ')}${plan.missing.length ? `. Not in your inventory: ${plan.missing.join(', ')}` : ''}`}>
                  <span class="fe-amodal__repeatglyph" aria-hidden="true">↻</span>
                  <span>Repeat last setup</span>
                  <span class="ui-type-caption fe-amodal__repeatnote">{plan.moves.length > 0 ? `${plan.moves.length} scarab${plan.moves.length === 1 ? '' : 's'}` : ''}{plan.moves.length > 0 && plan.key ? ' + ' : ''}{plan.key ? CURRENCIES[plan.key as keyof typeof CURRENCIES]?.name ?? 'key' : ''}{plan.missing.length ? ` · ${plan.missing.length} missing` : ''}</span>
                </button>
              )}

              {noticeText && (
                <div class="fe-amodal__notice fe-amodal__notice--bad" role="alert" data-wrong-area>
                  <span class="ui-type-secondary">{noticeText}</span>
                  <span class="fe-amodal__noticeacts">
                    {noticeGoto && <Button size="small" variant="ember" data-goto-area={noticeGoto} onClick={goToNotice}>Go to {gotoName(noticeGoto)}</Button>}
                    {wrong ? <Button size="small" onClick={() => setWrong(null)}>Dismiss</Button> : map && <Button size="small" onClick={takeOut}>Take it out</Button>}
                  </span>
                </div>
              )}

              {map && desc && !mismatch && (
                <div class="fe-amodal__mapcard" data-map-card>
                  <b class={cx('fe-amodal__mapname ui-type-body', `fe-tone-${desc.tone}`)}>{desc.title}</b>
                  <div class="fe-amodal__maptier ui-type-secondary">{desc.headerLines.join(' · ')}</div>
                  {desc.affixes.length > 0 && (
                    <ul class="fe-device__mods fe-amodal__mods">
                      {desc.affixes.map((l, i) => <li key={i} class={cx(l.negative ? 'fe-device__mod--danger' : 'fe-device__mod--reward', l.kind === 'corrupted' && 'fe-device__mod--corrupt')}>{l.text}</li>)}
                    </ul>
                  )}
                  <span class="fe-amodal__mapacts">
                    <button type="button" class="fe-act ui-type-caption" data-rechart-open disabled={!!map.corrupted}
                      title={map.corrupted ? 'Corrupted maps cannot be changed.' : 'Move this map to a neighbouring area for Forge Scrap'} onClick={() => { store.actions.uiSound('click'); setRechartOpen((o) => !o); }}>Re-chart</button>
                    <button type="button" class="fe-act ui-type-caption" data-take-map aria-label="Take the map out of the slot" onClick={takeOut}>Take out</button>
                  </span>
                </div>
              )}

              {readout && runArea && map && !mismatch && (
                <div class="fe-amodal__mini ui-type-caption" data-mini-readout>
                  {readout.luck && <span class="fe-amodal__minichip" title="Your personal item quantity for this expedition">Quantity {formatLuck(readout.luck.itemQuantity)}</span>}
                  {readout.luck && <span class="fe-amodal__minichip" title="Your personal item rarity for this expedition">Rarity {formatLuck(readout.luck.itemRarity)}</span>}
                  <span class={cx('fe-amodal__minichip', dangers.length > 0 && 'fe-amodal__minichip--bad')}>Danger {dangers.length}</span>
                  {scarabs.length > 0 && <span class="fe-amodal__minichip">{scarabs.length} scarab{scarabs.length === 1 ? '' : 's'}</span>}
                </div>
              )}

              {!map && (
                <div class="fe-amodal__empty" data-empty-state={heldMaps > 0 ? 'held' : 'none'}>
                  {heldMaps > 0 ? (
                    <>
                      <strong class="ui-type-body">Drag a map into the slot</strong>
                      <span class="ui-type-secondary">You hold {heldMaps} map{heldMaps === 1 ? '' : 's'} for {area.name}: the highlighted ones in your inventory. Double-click or Ctrl/Cmd-click loads one too.</span>
                      <Button size="small" data-load-map onClick={() => { const e = ch.backpack.entries.find((x) => x.item.kind === 'map' && mapFit(x.item, area).ok); if (e) { store.actions.uiSound('click'); store.actions.moveItem(e.item.uid, { kind: 'mapDevice' }); } }}>Load a map</Button>
                    </>
                  ) : (
                    <>
                      <strong class="ui-type-body">{need ? `No map to run ${area.name} with` : 'No map for this area'}</strong>
                      <span class="ui-type-secondary">{need
                        ? (need.kind === 'key' ? `Any map up to Tier ${model.ceiling} runs here, with the ${need.label} in the passage slot.` : `Load a Bounty map of ${area.neighbours.map((n) => findAtlasArea(n)?.name).join(' or ')}.`)
                        : `You hold no map bound to ${area.name}.`}</span>
                      <span class="ui-type-caption fe-amodal__narrowhint">Where to find one is listed below.</span>
                      {stashed > 0 && <span class="ui-type-secondary fe-amodal__stashnote" data-stash-note>{stashed} in your Map Stash: move {stashed === 1 ? 'it' : 'one'} to your inventory, then drag it in.</span>}
                    </>
                  )}
                </div>
              )}

              {map && runArea?.chosenClass && (
                <label class="fe-device__class ui-type-secondary fe-amodal__class">Hunter rewards
                  <select aria-label="Hunter reward class" value={lootClass} onChange={(e) => chooseClass(e.currentTarget.value as ItemClass)}>
                    {ITEM_CLASSES.map((id) => <option key={id} value={id} disabled={!Object.values(BASES).some((b) => b.itemClass === id && b.levelRequirement <= monsterLevelForTier(map.tier))}>{CLASS_LABEL[id]}</option>)}
                  </select>
                </label>
              )}

              <SurgeHold areaId={area.id} />
            </section>

            <section class="fe-amodal__side" aria-label="About this area">
              {readout && runArea && map ? (
                <div class="fe-amodal__live" data-live-readout>
                  <h4 class="fe-amodal__h ui-type-caption">This expedition</h4>
                  <dl class="fe-amodal__stats">
                    {readout.luck && <><dt class="ui-type-secondary">Item quantity</dt><dd class="ui-type-body" title="Your personal item quantity for this expedition">{formatLuck(readout.luck.itemQuantity)}</dd>
                      <dt class="ui-type-secondary">Item rarity</dt><dd class="ui-type-body" title="Your personal item rarity for this expedition">{formatLuck(readout.luck.itemRarity)}</dd></>}
                    <dt class="ui-type-secondary">Monsters</dt><dd class="ui-type-body">{[sum('Monster Level') ? `Level ${sum('Monster Level')}` : null, sum('Waves') ? `${sum('Waves')} waves` : null].filter(Boolean).join(' · ') || '-'}</dd>
                    <dt class="ui-type-secondary">Danger</dt><dd class={cx('ui-type-body', dangers.length > 0 && 'fe-amodal__bad')}>{dangers.length > 0 ? `${dangers.length} mod${dangers.length === 1 ? '' : 's'}` : 'None'}</dd>
                    <dt class="ui-type-secondary">Encounters</dt>
                    <dd class="ui-type-secondary">{runArea.encounters ? runArea.encounters.map((e) => MAP_EVENT_NAMES[e.kind]).join(' · ') : activeEvents.length ? activeEvents.map((k) => `${MAP_EVENT_NAMES[k]} ${Math.round(readout.events[k]! * 1000) / 10}%`).join(' · ') : 'None at this tier'}</dd>
                    <dt class="ui-type-secondary">Scarabs</dt>
                    <dd class="ui-type-secondary">{scarabs.length ? scarabs.map((s) => <span key={s.id} class="fe-amodal__scarab" title={s.description}><b>{s.name}</b>: {firstSentence(s.description)}</span>) : 'None socketed'}</dd>
                  </dl>
                  <div class="fe-amodal__drops"><SourcesLine readout={readout.routing} onFocus={onGoto} /></div>
                  <button type="button" class="fe-amodal__more ui-type-caption" aria-expanded={fullReadout} data-full-readout-toggle onClick={() => { store.actions.uiSound('click'); setFullReadout(!fullReadout); }}>{fullReadout ? 'Hide full readout' : 'Full readout'}</button>
                  {fullReadout && <ReadoutDetail area={runArea} map={map} readout={readout} gear={gear} onFocus={onGoto} />}
                </div>
              ) : map && !mismatch && need && !passage ? (
                <div class="fe-amodal__live fe-amodal__live--wait" data-live-readout="wait">
                  <h4 class="fe-amodal__h ui-type-caption">This expedition</h4>
                  <p class="ui-type-secondary fe-amodal__mute">{need.kind === 'key' ? `Place the ${need.label} in the passage slot to see what this run holds.` : `The Pit needs a Bounty map of ${area.neighbours.map((n) => findAtlasArea(n)?.name).join(' or ')}.`}</p>
                </div>
              ) : null}
              {find && heldMaps === 0 && <WhereTo find={find} area={area} onGoto={onGoto} />}
              <MapsHeld area={area} pin={pin} />
              <AreaDetails area={area} tier={map?.tier ?? null} map={runArea?.id === area.id ? map : null} odds={runArea?.id === area.id ? odds : null} />
            </section>
          </div>
        </div>
        <footer class="fe-amodal__foot">
          <div class="fe-amodal__footinfo">
            <p id={reasonId} class={cx('fe-amodal__reason ui-type-secondary', ready ? 'fe-amodal__reason--ok' : 'fe-amodal__reason--bad')} role="status" aria-live="polite" data-open-reason={ready ? 'ready' : 'blocked'}>
              {ready ? `Ready: ${area.name} opens with your map.` : block}
            </p>
            {replacing && <p class="ui-type-caption fe-amodal__portalnote" data-replace-note>Replaces your {replacing.mapName} portal ({replacing.remaining} left); it closes once nobody is inside.</p>}
            <p class="ui-type-caption fe-amodal__cost" data-open-cost>{map && runArea ? `Fee ${fee} Scrap${runArea.entranceKey ? ` · ${CURRENCIES[runArea.entranceKey].name}` : ''} · ${PORTALS_PER_MAP} portals` : 'Opening costs the map, its scarabs and a small Scrap fee.'}</p>
          </div>
          <Button variant="ember" size="large" class="fe-amodal__open" data-open-area disabled={!ready} aria-describedby={reasonId} onClick={confirmActivate}>Open area</Button>
        </footer>
        {rechartOpen && map && <RechartPopover class="fe-amodal__rechart" map={map} onClose={() => setRechartOpen(false)} onDone={(id) => { setRechartOpen(false); onGoto(id); }} />}
      </div>
    </div>
  );
}

function MapsHeld({ area, pin }: { area: AtlasAreaDef; pin: AreaPin }) {
  const ch = useUi((s) => s.character);
  const count = useMemo(() => {
    let n = 0;
    if (!ch) return 0;
    for (const e of ch.backpack.entries) if (e.item.kind === 'map' && e.item.areaId === area.id) n++;
    for (const t of ch.stash) for (const e of t.grid.entries) if (e.item.kind === 'map' && e.item.areaId === area.id) n++;
    n += (ch.mapStash ?? []).filter((m) => m.areaId === area.id).length;
    return n;
  }, [ch, area.id]);
  return (
    <section class="fe-amodal__sec" aria-label="Your maps">
      <h4 class="fe-amodal__h ui-type-caption">Your maps</h4>
      <p class="ui-type-secondary fe-amodal__mute" data-rail-held>{count ? `You hold ${count} map${count === 1 ? '' : 's'} of this area.` : 'You hold no maps of this area.'}</p>
      {!area.sealed && <p class="ui-type-caption fe-amodal__mute">{pin.blocked && !pin.pinned ? pin.blocked : `${pin.used}/${pin.slots} pins · a pinned area's maps drop x${pin.multiplier} as often`}</p>}
    </section>
  );
}

/** The empty state's "where to find maps for it": who drops them, Rook, the bench. Every link opens the panel in question. */
function WhereTo({ find, area, onGoto }: { find: WhereToFind; area: AtlasAreaDef; onGoto: (id: AtlasAreaId) => void }) {
  const store = useStore();
  const keyDef = find.passage?.keyId ? keyInfo(find.passage.keyId) : null;
  const open = (panel: 'merchant' | 'craftingBench' | 'stash'): void => { store.actions.uiSound('click'); store.actions.openPanel(panel); };
  return (
    <section class="fe-amodal__sec fe-amodal__where" aria-label="Where to find maps" data-where-to-find>
      <h4 class="fe-amodal__h ui-type-caption">{find.passage ? 'How to get here' : 'Where to find maps for it'}</h4>
      <ul class="fe-amodal__wherelist">
        {find.passage?.kind === 'key' && <li class="ui-type-secondary">{keyDef ?? `Open it with the ${find.passage.label}.`}</li>}
        {find.sources.length > 0 && (
          <li class="ui-type-secondary">
            Expeditions that drop {area.name} maps:{' '}
            {find.sources.map((s, i) => <span key={s.areaId}>{i > 0 ? ', ' : ''}<button type="button" class="fe-amodal__link" data-where-area={s.areaId} onClick={() => { store.actions.uiSound('click'); onGoto(s.areaId); }}>{s.name}</button> <span class="fe-amodal__mute">{Math.round(s.share * 100)}%</span></span>)}.
          </li>
        )}
        {find.rook && (
          <li class="ui-type-secondary">Rook's stall may have a map for {area.name}, cheap ones included. <button type="button" class="fe-amodal__link" data-open-rook onClick={() => open('merchant')}>Open Rook's stall</button></li>
        )}
        {find.inStash > 0 && <li class="ui-type-secondary">{find.inStash} waiting in your stash. <button type="button" class="fe-amodal__link" data-open-stash onClick={() => open('stash')}>Open the stash</button></li>}
        {!find.passage && (
          <li class="ui-type-secondary">
            At the Crafting Bench you can re-chart a neighbour's map here for Scrap{find.rechartable > 0 ? ` (you hold ${find.rechartable} that could move)` : ''}, or recycle three maps of one tier into a fresh one.{' '}
            <button type="button" class="fe-amodal__link" data-open-bench onClick={() => open('craftingBench')}>Open the bench</button>
          </li>
        )}
      </ul>
    </section>
  );
}

function keyInfo(keyId: string): string | null {
  const c = CURRENCIES[keyId as keyof typeof CURRENCIES];
  return c ? `Open it with a ${c.name}. ${c.description}` : null;
}
