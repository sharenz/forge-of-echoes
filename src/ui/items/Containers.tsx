// Item containers: grids (backpack, stash tabs), paperdoll slots, flask belt slots and the map device slot.
import type { JSX } from 'preact';
import { useMemo } from 'preact/hooks';
import type { EquipSlot } from '../../contracts/content';
import { iconIdForBase, type BaseId } from '../../contracts/content';
import type { GridContainer } from '../../contracts/items';
import { Keycap, PixelIcon, cx } from '../components/common';
import { useLocal } from '../local';
import { PAPERDOLL, SLOT_LABELS } from '../lib/content';
import { useSignal, useStore, useUi } from '../store';
import { ItemView } from './ItemView';
import { safe } from './hooks';
import { findScarab } from '../../data/scarabs';

const cells = (n: number): string => `calc(var(--cell) * ${n})`;

export function ItemGrid({ grid, kind, tab = 0 }: { grid: GridContainer; kind: 'backpack' | 'stash'; tab?: number }) {
  const local = useLocal();
  const drag = useSignal(local.drag);
  const t = drag?.target;
  const previewHere =
    t && t.grid && t.origin && !t.world && (t.grid.kind === 'backpack' ? kind === 'backpack' : kind === 'stash' && t.grid.tab === tab);

  return (
    <div
      class="fe-grid fe-solid"
      data-drop={kind}
      data-w={grid.w}
      data-h={grid.h}
      data-tab={kind === 'stash' ? tab : undefined}
      style={{ width: cells(grid.w), height: cells(grid.h) }}
    >
      {grid.entries.map((e) => (
        <ItemView
          key={e.item.uid}
          item={e.item}
          uid={e.item.uid}
          from={kind === 'backpack' ? { kind: 'backpack', x: e.x, y: e.y } : { kind: 'stash', tab, x: e.x, y: e.y }}
          mode="grid"
          x={e.x}
          y={e.y}
          class={drag?.uid === e.item.uid ? 'fe-item--lifted' : undefined}
        />
      ))}
      {previewHere && drag && (
        <div
          class={cx('fe-grid__preview', t!.valid || t!.noop ? 'fe-grid__preview--ok' : 'fe-grid__preview--bad')}
          style={{ left: cells(t!.origin!.x), top: cells(t!.origin!.y), width: cells(drag.size.w), height: cells(drag.size.h) }}
        />
      )}
    </div>
  );
}

/** Representative base per slot, drawn as a dark silhouette when the slot is empty. */
const SLOT_SILHOUETTE: Record<EquipSlot, BaseId> = {
  mainHand: 'ashwoodWand',
  offHand: 'runedTome',
  helmet: 'ritualCirclet',
  chest: 'ashenRobe',
  gloves: 'silkWraps',
  boots: 'pathfinderBoots',
  belt: 'chainBelt',
  amulet: 'cinderPendant',
  ring1: 'emberRing',
  ring2: 'emberRing',
};

export function EquipSlotView({ slot }: { slot: EquipSlot }) {
  const store = useStore();
  const local = useLocal();
  const ch = useUi((s) => s.character);
  const drag = useSignal(local.drag);
  const item = ch?.equipment[slot] ?? null;
  const pos = PAPERDOLL[slot];
  const hovered = drag?.target?.loc?.kind === 'equipment' && drag.target.loc.slot === slot;
  const accepts = useMemo(() => {
    if (!drag || !ch || drag.item.kind !== 'equipment') return false;
    return safe(() => store.rules.canEquip(ch, drag.item, slot).ok, false);
  }, [drag?.uid, ch, slot, store]);
  const silhouetteBase = SLOT_SILHOUETTE[slot];
  const silSize = store.rules.content.bases[silhouetteBase]?.size ?? { w: 1, h: 1 };

  const style: JSX.CSSProperties = { left: cells(pos.x), top: cells(pos.y), width: cells(pos.w), height: cells(pos.h) };
  return (
    <div
      class={cx(
        'fe-slot fe-solid',
        accepts && 'fe-slot--accepts',
        hovered && (drag!.target!.valid || drag!.target!.noop ? 'fe-slot--ok' : 'fe-slot--bad'),
      )}
      style={style}
      data-drop="equip"
      data-slot={slot}
      title={item ? undefined : SLOT_LABELS[slot]}
    >
      {item ? (
        <ItemView
          item={item}
          uid={item.uid}
          from={{ kind: 'equipment', slot }}
          mode="slot"
          class={drag?.uid === item.uid ? 'fe-item--lifted' : undefined}
        />
      ) : (
        <PixelIcon
          id={iconIdForBase(silhouetteBase)}
          class="fe-slot__ghost"
          width={`calc(var(--icon-cell) * ${silSize.w})`}
          height={`calc(var(--icon-cell) * ${silSize.h})`}
        />
      )}
    </div>
  );
}

export function BeltSlotView({ index }: { index: number }) {
  const store = useStore();
  const local = useLocal();
  const ch = useUi((s) => s.character);
  const drag = useSignal(local.drag);
  const uid = `belt:${index}`;
  const found = useMemo(() => (ch ? safe(() => store.rules.findItem(ch, uid), null) : null), [ch, uid, store]);
  const hovered = drag?.target?.loc?.kind === 'belt' && drag.target.loc.index === index;
  const accepts = drag?.item.kind === 'flask';
  return (
    <div
      class={cx(
        'fe-slot fe-slot--belt fe-solid',
        accepts && 'fe-slot--accepts',
        hovered && (drag!.target!.valid || drag!.target!.noop ? 'fe-slot--ok' : 'fe-slot--bad'),
      )}
      data-drop="belt"
      data-index={index}
    >
      {found ? (
        <ItemView
          item={found.item}
          uid={uid}
          from={{ kind: 'belt', index }}
          mode="slot"
          class={drag?.uid === uid ? 'fe-item--lifted' : undefined}
        />
      ) : (
        <span class="fe-slot__empty-flask" />
      )}
      <span class="fe-slot__key">
        <Keycap>{index + 1}</Keycap>
      </span>
    </div>
  );
}

export function MapDeviceSlotView({ disabled }: { disabled: boolean }) {
  const local = useLocal();
  const map = useUi((s) => s.character?.mapDevice ?? null);
  const drag = useSignal(local.drag);
  const hovered = drag?.target?.loc?.kind === 'mapDevice';
  const accepts = drag?.item.kind === 'map' && !disabled;
  return (
    <div
      class={cx(
        'fe-device-slot fe-solid',
        accepts && 'fe-slot--accepts',
        hovered && (drag!.target!.valid || drag!.target!.noop ? 'fe-slot--ok' : 'fe-slot--bad'),
        map && 'fe-device-slot--filled',
      )}
      data-drop={disabled ? undefined : 'mapDevice'}
    >
      {map ? (
        <ItemView
          item={map}
          uid={map.uid}
          from={{ kind: 'mapDevice' }}
          mode="slot"
          class={drag?.uid === map.uid ? 'fe-item--lifted' : undefined}
        />
      ) : (
        <span class="fe-device-slot__hint">Place a map</span>
      )}
    </div>
  );
}

export function ScarabSlotView({ index }: { index: number }) {
  const local = useLocal();
  const store = useStore();
  const item = useUi(s => s.character?.mapScarabs?.[index] ?? null);
  const drag = useSignal(local.drag);
  const hovered = drag?.target?.loc?.kind === 'scarabSlot' && drag.target.loc.index === index;
  const accepts = drag?.item.kind === 'currency' && !!findScarab(drag.item.currencyId);
  return <div class="fe-scarab-socket">
    <div class={cx('fe-device-slot fe-solid', accepts && 'fe-slot--accepts', hovered && (drag!.target!.valid || drag!.target!.noop ? 'fe-slot--ok' : 'fe-slot--bad'), item && 'fe-device-slot--filled')}
      data-drop="scarabSlot" data-index={index} aria-label={`Scarab socket ${index + 1}`}>
      {item ? <ItemView item={item} uid={item.uid} from={{ kind: 'scarabSlot', index }} mode="slot" class={drag?.uid === item.uid ? 'fe-item--lifted' : undefined} />
        : <span class="fe-device-slot__hint">Scarab<br />{index + 1}</span>}
    </div>
    {item && <button class="ui-type-caption fe-scarab-remove" aria-label={`Remove scarab ${index + 1}`} onClick={() => store.actions.quickMove(item.uid)}><span class="fe-scarab-remove__word">Remove</span><span class="fe-scarab-remove__x" aria-hidden="true">×</span></button>}
  </div>;
}
