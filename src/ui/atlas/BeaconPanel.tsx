// The beacon section of the area modal (brief D 6, slice B1). A cleared area is a beacon with one or two sigil slots; a sigil slotted there
// works on every map opened in an area within the beacon's reach (the Territory lens draws the ring). Inventory first: a sigil is dragged
// out of the inventory into a slot (Ctrl/Cmd-click quick-slots it as an extra); stashed sigils move to the inventory first. There is no
// picker. Every area also lists the sigils that reach it, so a player sees what a run here will get before opening it.
// Taking a sigil out (or dropping another onto a filled slot) is confirmed when it would be consumed: a used sigil cannot be recovered.
import { useEffect } from 'preact/hooks';
import type { AtlasAreaId, AtlasProgress, BeaconSlot } from '../../contracts/atlas';
import { iconIdForCurrency } from '../../contracts/content';
import { findAtlasArea, type AtlasAreaDef } from '../../data/progression/atlas';
import { findSigil, sigilEffectText } from '../../data/progression/territory';
import { beaconCoverage, beaconRadius, beaconSlotCount, beaconSlots, coveringSigils } from '../../game/progression/territory';
import { beaconDropError, beaconSlotId } from './area-modal';
import { PixelIcon, cx } from '../components/common';
import { useLocal } from '../local';
import { useSignal, useStore } from '../store';

/** "8 of 12 uses left". */
const usesText = (s: BeaconSlot): string => `${s.uses} of ${s.max} use${s.max === 1 ? '' : 's'} left`;

function BeaconSlotView({ area, index, slot }: { area: AtlasAreaDef; index: number; slot: BeaconSlot | null }) {
  const local = useLocal();
  const store = useStore();
  const drag = useSignal(local.drag);
  const id = beaconSlotId(index);
  const def = slot ? findSigil(slot.sigilId) : undefined;
  useEffect(() => {
    local.slots.set(id, {
      tag: slot ? 'Swap the sigil' : `Light the ${area.name} beacon`,
      accepts: (d) => beaconDropError(d.item, d.from),
      onDrop: (d) => {
        // replacing a used sigil consumes it: say so first
        if (slot && slot.uses < slot.max) {
          local.dialog.set({
            title: 'Replace the sigil',
            body: `${def?.name ?? 'The sigil'} in this slot has ${usesText(slot)}. Replacing it consumes it; its uses are lost.`,
            confirmLabel: 'Replace',
            onConfirm: () => store.actions.slotSigil(area.id, index, d.uid),
          });
          return;
        }
        store.actions.slotSigil(area.id, index, d.uid);
      },
    });
    return () => { local.slots.delete(id); };
  }, [local, store, area, index, slot, id, def]);
  const hovered = drag?.target?.slot === id ? (drag.target.valid ? 'ok' : 'bad') : null;
  const accepts = !!drag && drag.item.kind === 'currency' && !!findSigil(drag.item.currencyId);
  const takeOut = (): void => {
    if (!slot) return;
    store.actions.uiSound('click');
    if (slot.uses < slot.max) {
      local.dialog.set({
        title: 'Take out the sigil',
        body: `${def?.name ?? 'The sigil'} has ${usesText(slot)}. A used sigil cannot be recovered: taking it out consumes it.`,
        confirmLabel: 'Consume it',
        onConfirm: () => store.actions.unslotSigil(area.id, index),
      });
      return;
    }
    store.actions.unslotSigil(area.id, index);
  };
  return (
    <li class="fe-beacon__slotrow" data-beacon-slot={index} data-beacon-state={slot ? 'on' : 'off'}>
      <div class={cx('fe-device-slot fe-solid fe-beacon__socket', slot && 'fe-device-slot--filled', accepts && 'fe-slot--accepts', hovered && `fe-slot--${hovered}`)}
        data-drop="slot" data-slot={id} role="group" aria-label={slot ? `Beacon slot ${index + 1}: ${def?.name ?? 'sigil'}` : `Beacon slot ${index + 1}: empty, drag a sigil here`}
        title={slot ? undefined : 'Drag a sigil here from your inventory (or Ctrl/Cmd-click it)'}>
        {slot ? <PixelIcon id={iconIdForCurrency(slot.sigilId)} width={32} height={32} /> : <span class="fe-device-slot__hint ui-type-caption">Sigil</span>}
      </div>
      <div class="fe-beacon__slottext">
        {slot && def ? (
          <>
            <b class="ui-type-secondary">{def.name}</b>
            <span class="ui-type-caption fe-amodal__mute">{sigilEffectText(def)} · {usesText(slot)}</span>
          </>
        ) : <span class="ui-type-caption fe-amodal__mute">Empty: drag a sigil here from your inventory.</span>}
      </div>
      {slot && <button type="button" class="fe-act ui-type-caption" data-beacon-take={index} onClick={takeOut}>Take out</button>}
    </li>
  );
}

/** The modal's beacon section: this area's own beacon (when cleared) and the sigils of every beacon that reaches it. */
export function BeaconPanel({ area, atlas, onGoto }: { area: AtlasAreaDef; atlas: AtlasProgress; onGoto: (id: AtlasAreaId) => void }) {
  const store = useStore();
  const lit = atlas.completed.includes(area.id);
  const slots = lit ? beaconSlots(atlas, area.id) : [];
  const reach = beaconCoverage(area.id, atlas.nodes).slice(1).filter((id) => atlas.discovered.includes(id));
  const reaching = coveringSigils(atlas, area.id);
  return (
    <section class="fe-amodal__sec fe-beacon" aria-label="Beacon" data-beacon={area.id} data-beacon-lit={lit ? '1' : '0'}>
      <h4 class="fe-amodal__h ui-type-caption">Beacon</h4>
      {lit ? (
        <>
          <p class="ui-type-caption fe-amodal__mute" data-beacon-reach>
            Reaches {beaconRadius(area.id, atlas.nodes)} chart pixels: {reach.length ? reach.map((id) => findAtlasArea(id)?.name).join(', ') : 'no charted area yet'}, and {area.name} itself.
          </p>
          <ul class="fe-beacon__slots">
            {slots.map((s, i) => <BeaconSlotView key={i} area={area} index={i} slot={s} />)}
          </ul>
        </>
      ) : (
        <p class="ui-type-caption fe-amodal__mute" data-beacon-dark>
          Defeat {area.name}'s boss to light its beacon ({beaconSlotCount(area.id, atlas.nodes)} sigil slot{beaconSlotCount(area.id, atlas.nodes) === 1 ? '' : 's'}): a slotted sigil then works on every map opened within its reach.
        </p>
      )}
      <div class="fe-beacon__reaching" data-beacon-reaching={reaching.length}>
        <span class="ui-type-caption fe-amodal__h">Sigils reaching {area.name}</span>
        {reaching.length ? (
          <ul class="fe-beacon__list">
            {reaching.map((c) => (
              <li key={`${c.beacon}:${c.slot}`} class="ui-type-caption">
                <b>{c.def.name}</b> from{' '}
                <button type="button" class="fe-amodal__link" onClick={() => { store.actions.uiSound('click'); onGoto(c.beacon); }}>{findAtlasArea(c.beacon)?.name}</button>
                {' '}({c.uses} use{c.uses === 1 ? '' : 's'} left): {sigilEffectText(c.def)}
              </li>
            ))}
          </ul>
        ) : <span class="ui-type-caption fe-amodal__mute">None. Slot a sigil into a beacon whose reach includes this area.</span>}
      </div>
    </section>
  );
}
