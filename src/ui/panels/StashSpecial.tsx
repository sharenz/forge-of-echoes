// The special stash tabs (GAME_SPEC §12), shown after the normal tabs:
//   • Map Stash — T1–T15 tier tiles with counts; the expanded tier lists its maps sectioned by base (icon, rarity
//     coloured name, mod count, quality, corrupted marker, full tooltip). Drag or Ctrl-click a map to the backpack;
//     in the map device's picker (mode 'device') a click, Ctrl-click or drag puts it into the device.
//   • Crafting Stash — Equipment / Maps — one fixed, labelled slot per currency (count up to CURRENCY_STASH_MAX,
//     empty slots ghosted). Dropping a currency anywhere on the tab (or on its tab button) files it into its slot.
//     Drag / Ctrl-click a slot takes a stack, Shift+Ctrl-click one; right-click arms it for crafting (`cstash:<id>`),
//     exactly like a backpack stack.
// Both pages keep the normal grid's footprint (12 x 8 cells), so switching tabs never resizes the panel. The stash
// search lights up map rows and filled currency slots like grid items.
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef } from 'preact/hooks';
import { iconIdForCurrency, iconIdForMap, type CurrencyId } from '../../contracts/content';
import {
  CURRENCY_STASH_MAX,
  MAP_STASH_CAPACITY,
  currencyStashUid,
  type CharacterSave,
  type ItemDescription,
  type ItemLocation,
  type MapItem,
  type SpecialStashTab,
} from '../../contracts/items';
import type { UiStore } from '../../contracts/ui';
import { PixelIcon, cx } from '../components/common';
import { beginPointerDrag, pickerDropKind } from '../items/dnd';
import { ItemCard } from '../items/ItemTooltip';
import { clickSuppressed, itemClick, itemContextMenu, safe, useCraftMark } from '../items/hooks';
import { readCellPx } from '../items/ItemView';
import { useSearch, type SearchResult } from '../items/search';
import { formatInt } from '../lib/format';
import { itemTone } from '../lib/items';
import {
  CURRENCY_SHELVES,
  CURRENCY_SHORT,
  SPECIAL_TAB_INFO,
  currenciesOf,
  groupMapStash,
  isFullSlot,
  modCountText,
  pickMapTier,
  slotStack,
  stashCount,
  stashTotal,
  tierBand,
  type MapTierGroup,
} from '../lib/stash';
import { useLocal, type DragState } from '../local';
import { useSignal, useStore, useUi } from '../store';

const MAP_STASH: ItemLocation = { kind: 'mapStash' };
const CURRENCY_STASH: ItemLocation = { kind: 'currencyStash' };

/** Map names come from the rules' description; maps never change in place, so one description per object. */
const mapDescs = new WeakMap<MapItem, ItemDescription | null>();
function describeMap(store: UiStore, map: MapItem, ch: CharacterSave): ItemDescription | null {
  if (mapDescs.has(map)) return mapDescs.get(map) ?? null;
  const d = safe(() => store.rules.describeItem(map, ch), null);
  mapDescs.set(map, d);
  return d;
}

/** Drop feedback of a special-stash drop target (`data-drop-id` = id): lit while a fitting item is dragged, green /
 * red while it hovers this very element. */
function useDropState(
  dropKind: 'mapStash' | 'currencyStash' | 'mapDevice',
  id: string,
  accepts: (d: DragState) => boolean,
): { accepting: boolean; state: 'ok' | 'bad' | null } {
  const local = useLocal();
  const drag = useSignal(local.drag);
  const accepting = !!drag && drag.from.kind !== dropKind && accepts(drag);
  const t = drag?.target;
  // Hovering the page an item came from does nothing: no verdict.
  const state = t && !t.noop && t.key === `${dropKind}@${id}` ? (t.valid ? 'ok' : 'bad') : null;
  return { accepting, state };
}

// ---------------------------------------------------------------------------------------------------------------
// Tab buttons
// ---------------------------------------------------------------------------------------------------------------

/** A special tab: an icon tab in its own material, and a drop target that files the item without opening the tab. */
export function SpecialTabButton({ tab, on, hits }: { tab: SpecialStashTab; on: boolean; hits: number | null }) {
  const store = useStore();
  const local = useLocal();
  const ch = useUi((s) => s.character);
  const info = SPECIAL_TAB_INFO[tab];
  const dropKind = tab === 'maps' ? 'mapStash' : 'currencyStash';
  const { accepting, state } = useDropState(dropKind, `tab-${tab}`, (d) => (tab === 'maps' ? d.item.kind === 'map' : d.item.kind === 'currency'));

  const tip = (el: Element): void => {
    if (!ch) return;
    const lines: string[] = [];
    if (tab === 'maps') {
      const n = ch.mapStash?.length ?? 0;
      lines.push(`${formatInt(n)} of ${formatInt(MAP_STASH_CAPACITY)} maps`);
      lines.push('Drop a map here, or Ctrl-click one while this tab is open: it files itself by tier.');
    } else {
      const ids = currenciesOf(tab);
      const filled = ids.filter((id) => stashCount(ch, id) > 0).length;
      lines.push(`${formatInt(stashTotal(ch, tab))} currency in ${filled} of ${ids.length} slots`);
      lines.push(`Drop any currency here: it files into its own slot (up to ${formatInt(CURRENCY_STASH_MAX)}).`);
    }
    if (hits !== null) lines.unshift(`${hits} ${hits === 1 ? 'match' : 'matches'}`);
    local.showTooltip({ kind: 'text', title: tab === 'maps' ? info.title : `${info.title}: ${info.subtitle}`, lines }, el, 'above');
  };

  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      aria-label={tab === 'maps' ? info.title : `${info.title}, ${info.subtitle}`}
      class={cx(
        'fe-tab fe-stab',
        `fe-stab--${tab}`,
        on && 'fe-tab--on fe-stab--on',
        hits === 0 && 'fe-tab--nohits',
        accepting && 'fe-stab--accepts',
        state && `fe-stab--${state}`,
      )}
      data-drop={dropKind}
      data-drop-id={`tab-${tab}`}
      onClick={() => {
        store.actions.uiSound('click');
        store.actions.setStashTab(tab);
      }}
      onPointerEnter={(e) => tip(e.currentTarget)}
      onPointerLeave={() => local.hideTooltip()}
    >
      <PixelIcon id={info.iconId} class="fe-stab__icon" width={32} height={32} />
      {hits !== null && <span class={cx('fe-tab__hits fe-stab__hits', hits > 0 && 'fe-tab__hits--on')}>{hits}</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Map Stash
// ---------------------------------------------------------------------------------------------------------------

function TierTile({
  group,
  on,
  hits,
  searching,
  onPick,
}: {
  group: MapTierGroup;
  on: boolean;
  hits: number;
  searching: boolean;
  onPick: () => void;
}) {
  const store = useStore();
  const local = useLocal();
  const empty = group.count === 0;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      aria-disabled={empty}
      aria-label={`Tier ${group.tier}: ${group.count} ${group.count === 1 ? 'map' : 'maps'}`}
      class={cx(
        'fe-tier',
        `fe-tier--${tierBand(group.tier)}`,
        on && 'fe-tier--on',
        empty && 'fe-tier--empty',
        searching && hits === 0 && 'fe-tier--nohits',
      )}
      // An empty tier has nothing to show (its tooltip says so): the open tier stays.
      onClick={() => !empty && onPick()}
      onPointerEnter={(e) => {
        const bases = group.sections.map((s) => `${s.maps.length} × ${store.rules.content.mapBases[s.baseId]?.name ?? s.baseId}`);
        local.showTooltip(
          {
            kind: 'text',
            title: `Tier ${group.tier} maps`,
            lines: empty ? ['None stored yet'] : [...bases, ...(searching ? [`${hits} ${hits === 1 ? 'match' : 'matches'}`] : [])],
          },
          e.currentTarget,
          'above',
        );
      }}
      onPointerLeave={() => local.hideTooltip()}
    >
      <span class="fe-tier__t">
        <small>T</small>
        {group.tier}
      </span>
      <span class="fe-tier__n">{empty ? '–' : group.count}</span>
      {searching && hits > 0 && <span class="fe-tier__hits">{hits}</span>}
    </button>
  );
}

function MapRow({ map, mode, found }: { map: MapItem; mode: 'stash' | 'device'; found: boolean | null }) {
  const store = useStore();
  const local = useLocal();
  const ch = useUi((s) => s.character);
  const drag = useSignal(local.drag);
  const ref = useRef<HTMLDivElement>(null);
  const { mark } = useCraftMark(map.uid);
  const desc = ch ? describeMap(store, map, ch) : null;
  const tone = itemTone(map);
  const lifted = drag?.uid === map.uid;

  const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    const el = ref.current;
    if (!el) return;
    const size = safe(() => store.rules.itemSize(map), { w: 1, h: 1 });
    beginPointerDrag(e as unknown as PointerEvent, store, local, {
      uid: map.uid,
      item: map,
      from: MAP_STASH,
      size,
      el,
      cellPx: readCellPx(el),
      offsetX: 0,
      offsetY: 0,
    });
  };

  const onClick = (e: JSX.TargetedMouseEvent<HTMLDivElement>): void => {
    // The click that ends a drag (even one dropped back on this row) is not a click.
    if (clickSuppressed()) return;
    const s = store.get();
    // The device's picker: a plain click loads the map (Ctrl-click does too, through the shared quick move).
    if (mode === 'device' && !s.armed && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      local.hideTooltip();
      if (store.actions.moveItem(map.uid, { kind: 'mapDevice' })) store.actions.uiSound('equip');
      else store.actions.uiSound('error');
      return;
    }
    itemClick(store, local, e as unknown as MouseEvent, map.uid, map, MAP_STASH);
  };

  return (
    <div
      ref={ref}
      class={cx(
        'fe-maprow',
        `fe-maprow--${tone}`,
        map.corrupted && 'fe-maprow--corrupted',
        mark && `fe-maprow--craft-${mark}`,
        found === true && 'fe-maprow--found',
        found === false && 'fe-maprow--dim',
        lifted && 'fe-maprow--lifted',
        map.isNew && 'fe-maprow--new',
      )}
      data-uid={map.uid}
      data-kind="map"
      data-tone={tone}
      onPointerDown={onPointerDown}
      onClick={onClick}
      onContextMenu={(e) => itemContextMenu(store, local, e as unknown as MouseEvent, map.uid, map, MAP_STASH)}
      onPointerEnter={(e) => {
        if (local.drag.get()) return;
        local.showTooltip({ kind: 'item', uid: map.uid }, e.currentTarget);
      }}
      onPointerLeave={() => {
        const t = local.tooltip.get();
        if (t && t.spec.kind === 'item' && t.spec.uid === map.uid) local.hideTooltip();
      }}
    >
      <span class="fe-maprow__icon">
        <PixelIcon id={iconIdForMap(map.baseId)} width={32} height={32} />
      </span>
      <span class="fe-maprow__name">{desc?.title ?? 'Map'}</span>
      {map.isNew && <span class="fe-maprow__new">new</span>}
      <span class={cx('fe-maprow__mods', map.mods.length === 0 && 'fe-maprow__mods--none')}>{modCountText(map.mods.length)}</span>
      <span class="fe-maprow__q">{map.quality > 0 ? `+${map.quality}%` : ''}</span>
      <span class="fe-maprow__corrupt">{map.corrupted && <i class="fe-corrupt-mark" aria-label="Corrupted" title="Corrupted" />}</span>
    </div>
  );
}

/** Per-tier search hits (only the matching maps of each tier). */
function tierHits(groups: readonly MapTierGroup[], search: SearchResult): number[] {
  if (!search.active) return groups.map(() => 0);
  return groups.map((g) => g.sections.reduce((n, s) => n + s.maps.reduce((k, m) => k + (search.matches.has(m.uid) ? 1 : 0), 0), 0));
}

export function MapStashView({ mode }: { mode: 'stash' | 'device' }) {
  const store = useStore();
  const local = useLocal();
  const maps = useUi((s) => s.character?.mapStash ?? EMPTY_MAPS);
  const chosen = useSignal(local.mapTier);
  const query = useSignal(local.search);
  const drag = useSignal(local.drag);
  const search = useSearch();
  const searching = mode === 'stash' && search.active;
  const groups = useMemo(() => groupMapStash(maps), [maps]);
  const hits = useMemo(() => tierHits(groups, search), [groups, search]);
  const tier = pickMapTier(groups, chosen);
  const group = tier ? groups[tier - 1] : null;
  // The device's picker loads a map dropped on it (from the backpack or the stash); only the device's own map goes
  // back into the Map Stash there (items/dnd.ts pickerDropKind decides the drop; this mirrors it for the glow).
  const pageDrop = mode === 'device' && drag ? pickerDropKind(drag) : 'mapStash';
  const { accepting, state } = useDropState(pageDrop, `page-${mode}`, (d) => d.item.kind === 'map');
  const names = store.rules.content.mapBases;

  // A new query opens the highest tier with matches when the open one has none. Keyed on the query alone: a tier
  // the player picks while searching stays picked.
  useEffect(() => {
    if (!searching || (tier !== null && hits[tier - 1] > 0)) return;
    for (let t = hits.length; t >= 1; t--) {
      if (hits[t - 1] > 0) {
        local.mapTier.set(t);
        return;
      }
    }
  }, [query, searching]);

  return (
    <div
      class={cx('fe-mstash fe-solid', `fe-mstash--${mode}`, accepting && 'fe-mstash--accepts', state && `fe-mstash--${state}`)}
      data-drop={mode === 'device' ? 'mapPicker' : 'mapStash'}
      data-drop-id={`page-${mode}`}
    >
      <div class="fe-mstash__tiers" role="tablist" aria-label="Map tiers">
        {groups.map((g) => (
          <TierTile
            key={g.tier}
            group={g}
            on={g.tier === tier}
            hits={hits[g.tier - 1]}
            searching={searching}
            onPick={() => {
              store.actions.uiSound('click');
              local.mapTier.set(g.tier);
            }}
          />
        ))}
        <div class="fe-mstash__cap" title={`${maps.length} of ${MAP_STASH_CAPACITY} maps`}>
          <span class="fe-mstash__cap-n">
            {formatInt(maps.length)}
            <small>/{formatInt(MAP_STASH_CAPACITY)}</small>
          </span>
          <span class="fe-mstash__cap-bar">
            <i style={{ width: `${Math.min(100, (maps.length / MAP_STASH_CAPACITY) * 100).toFixed(1)}%` }} />
          </span>
        </div>
      </div>
      <div class="fe-mstash__list">
        {maps.length === 0 ? (
          <div class="fe-mstash__empty">
            <PixelIcon id={iconIdForMap('ashenForge')} class="fe-mstash__empty-icon" width={48} height={48} />
            <div class="fe-mstash__empty-title">The Map Stash is empty</div>
            <div class="fe-mstash__empty-text">
              {mode === 'stash'
                ? 'Drop maps on this tab, or Ctrl-click them in your backpack while it is open. They file themselves by tier.'
                : 'Maps you file in the Map Stash show up here, ready to load into the device.'}
            </div>
          </div>
        ) : !group || group.count === 0 ? (
          <div class="fe-mstash__empty fe-mstash__empty--tier">
            <div class="fe-mstash__empty-title">No Tier {tier ?? ''} maps stored</div>
          </div>
        ) : (
          group.sections.map((sec) => (
            <section key={sec.baseId} class="fe-mstash__section">
              <div class="fe-mstash__base">
                <span class="fe-mstash__base-name">{names[sec.baseId]?.name ?? sec.baseId}</span>
                <span class="fe-mstash__base-n">{sec.maps.length}</span>
              </div>
              {sec.maps.map((m) => (
                <MapRow key={m.uid} map={m} mode={mode} found={searching ? search.matches.has(m.uid) : null} />
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}

const EMPTY_MAPS: MapItem[] = [];

// ---------------------------------------------------------------------------------------------------------------
// Crafting Stash
// ---------------------------------------------------------------------------------------------------------------

/** The slot's tooltip: the currency card with the stash count and what each click does. Reads the store live. */
function SlotTooltip({ store, id }: { store: UiStore; id: CurrencyId }) {
  const s = store.get();
  const ch = s.character;
  if (!ch) return null;
  const count = stashCount(ch, id);
  const desc = safe(() => store.rules.describeItem(slotStack(id, Math.max(1, count)), ch), null);
  if (!desc) return null;
  const stack = store.rules.content.currencies[id]?.maxStack ?? 0;
  const hints =
    count > 0
      ? [
          `Drag or Ctrl-click: take a stack${stack > 0 ? ` (up to ${stack})` : ''}`,
          'Shift+Ctrl-click: take one',
          s.craftingAllowed ? 'Right-click: craft with it straight from the stash' : 'Crafting only works in a hideout',
        ]
      : [`Drop ${desc.title} anywhere on this tab to file it here`];
  const card: ItemDescription = {
    ...desc,
    headerLines: [`${formatInt(count)} / ${formatInt(CURRENCY_STASH_MAX)} in the Crafting Stash`],
    hint: undefined,
  };
  return (
    <div class="fe-tt-row">
      <ItemCard
        desc={card}
        alt={false}
        footer={
          <div class="fe-tt__hint fe-cslot-tip">
            {hints.map((h) => (
              <div key={h}>{h}</div>
            ))}
          </div>
        }
      />
    </div>
  );
}

function CurrencySlot({ id, count, wide, search }: { id: CurrencyId; count: number; wide: boolean; search: SearchResult }) {
  const store = useStore();
  const local = useLocal();
  const drag = useSignal(local.drag);
  const ref = useRef<HTMLDivElement>(null);
  const uid = currencyStashUid(id);
  const item = useMemo(() => slotStack(id, count), [id, count]);
  const { mark } = useCraftMark(uid);
  const info = store.rules.content.currencies[id];
  const empty = count <= 0;
  const full = isFullSlot(count);
  const found = search.active ? search.matches.has(uid) : null;
  // A currency on its way in: its slot lights up wherever it is dropped on the tab.
  const incoming = !!drag && drag.from.kind !== 'currencyStash' && drag.item.kind === 'currency' && drag.item.currencyId === id;
  const lifted = drag?.uid === uid;

  const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>): void => {
    const el = ref.current;
    if (!el || empty) return;
    beginPointerDrag(e as unknown as PointerEvent, store, local, {
      uid,
      item,
      from: CURRENCY_STASH,
      size: { w: 1, h: 1 },
      el,
      cellPx: readCellPx(el),
      offsetX: 0,
      offsetY: 0,
    });
  };

  const nothingHere = (e: MouseEvent): void => {
    store.actions.uiSound('error');
    local.flashHint(`No ${info?.name ?? 'currency'} in the stash.`, e.clientX, e.clientY);
  };

  return (
    <div
      ref={ref}
      class={cx(
        'fe-cslot',
        wide && 'fe-cslot--wide',
        empty && 'fe-cslot--empty',
        full && 'fe-cslot--full',
        mark && `fe-cslot--craft-${mark}`,
        found === true && 'fe-cslot--found',
        found === false && 'fe-cslot--dim',
        incoming && 'fe-cslot--incoming',
        lifted && 'fe-cslot--lifted',
      )}
      data-uid={uid}
      data-currency={id}
      onPointerDown={onPointerDown}
      onClick={(e) => {
        const ev = e as unknown as MouseEvent;
        if (empty && (ev.ctrlKey || ev.metaKey) && !store.get().armed) return nothingHere(ev);
        itemClick(store, local, ev, uid, item, CURRENCY_STASH);
      }}
      onContextMenu={(e) => {
        const ev = e as unknown as MouseEvent;
        if (empty && !store.get().armed) {
          ev.preventDefault();
          nothingHere(ev);
          return;
        }
        itemContextMenu(store, local, ev, uid, item, CURRENCY_STASH);
      }}
      onPointerEnter={(e) => {
        if (local.drag.get()) return;
        local.showTooltip({ kind: 'custom', render: () => <SlotTooltip store={store} id={id} /> }, e.currentTarget, 'side');
      }}
      onPointerLeave={() => local.hideTooltip()}
    >
      <span class="fe-cslot__well">
        <PixelIcon id={iconIdForCurrency(id)} class="fe-cslot__icon" width="var(--cslot-icon)" height="var(--cslot-icon)" />
        {!empty && <span class="fe-cslot__count">{formatInt(count)}</span>}
      </span>
      {wide ? (
        <span class="fe-cslot__text">
          <span class="fe-cslot__name">{info?.name ?? CURRENCY_SHORT[id]}</span>
          <span class="fe-cslot__desc">{info?.description}</span>
        </span>
      ) : (
        <span class="fe-cslot__label">{CURRENCY_SHORT[id]}</span>
      )}
    </div>
  );
}

export function CurrencyStashView({ tab }: { tab: 'currency' | 'mapCurrency' }) {
  const ch = useUi((s) => s.character);
  const search = useSearch();
  const { accepting, state } = useDropState('currencyStash', `page-${tab}`, (d) => d.item.kind === 'currency');
  if (!ch) return null;
  const wide = tab === 'mapCurrency';
  return (
    <div
      class={cx('fe-cstash fe-solid', `fe-cstash--${tab}`, accepting && 'fe-cstash--accepts', state && `fe-cstash--${state}`)}
      data-drop="currencyStash"
      data-drop-id={`page-${tab}`}
    >
      {CURRENCY_SHELVES[tab].map((shelf) => (
        <section key={shelf.title} class="fe-cstash__shelf">
          <div class="fe-cstash__kicker">{shelf.title}</div>
          <div class="fe-cstash__row">
            {shelf.ids.map((id) => (
              <CurrencySlot key={id} id={id} count={stashCount(ch, id)} wide={wide} search={search} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
