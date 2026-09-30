// The Stash drawer (brief 6.7): the Map Stash picker, maps in the pack, and the scarabs in the Crafting Stash, sliding
// over the left edge of the chart. Re-housed from the old Map Device panel, not rewritten.
import { SCARABS } from '../../data/scarabs';
import type { CurrencyId } from '../../contracts/content';
import { currencyStashUid } from '../../contracts/items';
import { PORTALS_PER_MAP } from '../../contracts/net';
import type { CharacterSave } from '../../contracts/items';
import { PixelIcon, cx } from '../components/common';
import { MapStashView } from '../panels/StashSpecial';
import { useStore } from '../store';

export function StashDrawer({ ch, open, onClose, hasMap }: { ch: CharacterSave; open: boolean; onClose: () => void; hasMap: boolean }) {
  const store = useStore();
  const packMaps = ch.backpack.entries.filter((e) => e.item.kind === 'map');
  const stashed = ch.mapStash?.length ?? 0;
  // The table covers the inventory, so scarabs lying in the backpack must be loadable from here too.
  const packStack = (id: string) => {
    for (const e of ch.backpack.entries) if (e.item.kind === 'currency' && e.item.currencyId === id) return e.item;
    return undefined;
  };
  const owned = (id: CurrencyId) => (ch.currencyStash[id] ?? 0) + (packStack(id)?.count ?? 0);
  const scarabsOwned = SCARABS.reduce((n, s) => n + owned(s.id), 0);
  return (
    <aside class={cx('fe-drawer', open && 'fe-drawer--open')} aria-label="Stash" aria-hidden={!open} data-drawer>
      <div class="fe-drawer__head">
        <h3 class="fe-drawer__title">Stash</h3>
        <button class="fe-btn fe-btn--icon fe-btn--ghost" aria-label="Close stash drawer" onClick={onClose}><span class="fe-x" /></button>
      </div>
      <div class="fe-drawer__scroll">
        {packMaps.length > 0 && (
          <section class="fe-drawer__sec" aria-label="Maps in your pack">
            <h4 class="fe-drawer__h ui-type-caption">In your pack</h4>
            <div class="fe-drawer__pack">
              {packMaps.map(({ item }) => item.kind === 'map' && (
                <button key={item.uid} data-uid={item.uid} class="fe-drawer__mapbtn ui-type-secondary" tabIndex={open ? 0 : -1} onClick={() => store.actions.moveItem(item.uid, { kind: 'mapDevice' })}>
                  <PixelIcon id={`icon/map/${item.baseId}`} width={28} height={28} />
                  <span>{store.rules.content.mapBases[item.baseId]?.name ?? item.baseId} · T{item.tier}</span>
                </button>
              ))}
            </div>
          </section>
        )}
        <section class="fe-drawer__sec fe-device__stash" aria-label="Map Stash">
          <h4 class="fe-drawer__h ui-type-caption">From your Map Stash <span class="fe-device__stash-hint">{stashed === 0 ? 'empty' : hasMap ? 'click a map to swap it in' : `click a map to load it · opens ${PORTALS_PER_MAP} portals`}</span></h4>
          <MapStashView mode="device" />
        </section>
        <details class="fe-device__scarab-picker fe-drawer__sec">
          <summary class="ui-type-secondary">Scarabs in stash and pack · {scarabsOwned}</summary>
          <div class="fe-device__scarab-list">{SCARABS.map((s) => {
            const count = owned(s.id);
            const fromStash = (ch.currencyStash[s.id] ?? 0) > 0;
            const pack = packStack(s.id);
            const index = Array.from({ length: 4 }, (_, i) => ch.mapScarabs?.[i] ?? null).findIndex((x) => !x);
            const duplicate = ch.mapScarabs?.some((i) => i && SCARABS.find((x) => x.id === i.currencyId)!.family === s.family);
            return <button key={s.id} class="fe-device__scarab-choice" disabled={!count || index < 0 || duplicate} title={s.description}
              onClick={() => store.actions.moveItem(fromStash || !pack ? currencyStashUid(s.id) : pack.uid, { kind: 'scarabSlot', index })}>
              <PixelIcon id={`icon/currency/${s.id}`} width={32} height={32} /><span class="ui-type-caption">{s.name}<br />T{s.tier} · {count} owned</span>
            </button>;
          })}</div>
        </details>
      </div>
    </aside>
  );
}
