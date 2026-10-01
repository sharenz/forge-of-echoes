// The area modal's passage slot (brief D 2.5): it exists only for the areas that run through a passage. A sealed area takes ITS key: drag it
// from the inventory into the slot (the key is spent WITH the map at activation, so it stays in the inventory until then and the slot only
// records the choice). The Pit of Echoes takes no key: a Bounty map bound to Iron March (or the Pit's other door) opens it, so the slot is
// a lit indicator there. Click a filled slot, or its Clear button, to take the key back out. Refusals say why in words.
import { useEffect } from 'preact/hooks';
import { iconIdForCurrency } from '../../contracts/content';
import { PixelIcon, cx } from '../components/common';
import { useLocal } from '../local';
import { useSignal, useStore } from '../store';
import type { PassageNeed } from './area-modal';

export function PassageSlot({ need, areaName, chosen, held, onChoose }: {
  need: PassageNeed;
  areaName: string;
  /** The key is socketed (sealed areas) or a Bounty map is slotted (the Pit). */
  chosen: boolean;
  /** The key is in the inventory (sealed areas). */
  held: boolean;
  onChoose: (on: boolean) => void;
}) {
  const local = useLocal();
  const store = useStore();
  const drag = useSignal(local.drag);
  const isKey = need.kind === 'key';
  // the slot's drop handler lives while the modal does
  useEffect(() => {
    local.slots.set('passage', {
      tag: `Use ${need.label}`,
      accepts: (d) => {
        if (!isKey) return `${areaName} opens with a Bounty map, not a key: load the map.`;
        if (d.item.kind !== 'currency') return `Only the ${need.label} fits here.`;
        if (d.item.currencyId !== need.keyId) return `That key does not open ${areaName}. It needs the ${need.label}.`;
        return null;
      },
      onDrop: () => onChoose(true),
    });
    return () => { local.slots.delete('passage'); };
  }, [local, need, areaName, isKey, onChoose]);
  const hovered = drag?.target?.slot === 'passage' ? (drag.target.valid ? 'ok' : 'bad') : null;
  const accepts = isKey && drag?.item.kind === 'currency' && drag.item.currencyId === need.keyId;
  const label = isKey
    ? chosen ? `Passage: ${need.label}. Clear it.` : `Passage slot: drag the ${need.label} here`
    : chosen ? 'Passage: the Bounty map opens the Pit' : 'Passage: the Pit opens with a Bounty map';
  const click = (): void => { if (isKey && chosen) { store.actions.uiSound('click'); onChoose(false); } };
  return (
    <div class="fe-passage" data-passage>
      <div role={isKey ? 'button' : 'img'} tabIndex={isKey && chosen ? 0 : -1} aria-label={label}
        data-drop={isKey ? 'slot' : undefined} data-slot={isKey ? 'passage' : undefined} data-passage-state={chosen ? 'on' : 'off'}
        title={isKey ? (chosen ? `${need.label} chosen. Click to clear.` : held ? `Drag the ${need.label} here from your inventory.` : `You hold no ${need.label}.`) : label}
        onClick={click}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); click(); } }}
        class={cx('fe-device-slot fe-solid fe-passage__socket', chosen && 'fe-device-slot--filled', !isKey && 'fe-passage__socket--pit', accepts && 'fe-slot--accepts', hovered && `fe-slot--${hovered}`)}>
        {isKey
          ? (chosen && need.keyId ? <PixelIcon id={iconIdForCurrency(need.keyId as never)} width={32} height={32} /> : <span class="fe-device-slot__hint">Key</span>)
          : <i class={cx('fe-passage__pit', !chosen && 'fe-passage__pit--idle')} aria-hidden="true" />}
      </div>
      {isKey && chosen && <button type="button" class="ui-type-caption fe-scarab-remove fe-passage__clear" aria-label={`Clear the ${need.label}`} onClick={click}><span aria-hidden="true">×</span></button>}
    </div>
  );
}
