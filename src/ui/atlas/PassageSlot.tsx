// The dock's passage slot (brief D 2.5 and 3): a real drop target. Drag a key from the inventory into it and the slotted map opens the
// key's sealed area instead of its own (the key is spent WITH the map at activation, so it stays in the inventory until then and the
// slot only records the choice). A Bounty map bound beside the Pit offers "Open the Pit" on its own: click the slot to take it.
// Empty by default; click a filled slot, or its x, to clear. The refusals come from passage.ts (the rules' own conditions).
import { useEffect } from 'preact/hooks';
import { iconIdForCurrency } from '../../contracts/content';
import type { MapItem } from '../../contracts/items';
import type { AtlasProgress } from '../../contracts/atlas';
import { PixelIcon, cx } from '../components/common';
import { useLocal } from '../local';
import { useSignal, useStore } from '../store';
import { passageRefusal, type PassageOption } from './passage';

export function PassageSlot({ options, chosen, onChoose, map, atlas, held }: {
  options: readonly PassageOption[];
  chosen: PassageOption | null;
  onChoose: (id: string | null) => void;
  map: MapItem | null;
  atlas: Pick<AtlasProgress, 'discovered'>;
  /** Currency ids held in the inventory. */
  held: ReadonlySet<string>;
}) {
  const local = useLocal();
  const store = useStore();
  const drag = useSignal(local.drag);
  // the slot's drop handler lives while the dock does
  useEffect(() => {
    local.slots.set('passage', {
      tag: 'Use as the passage',
      accepts: (d) => (d.item.kind === 'currency' ? passageRefusal(map, atlas, held, d.item.currencyId) : 'Only a key can open a passage.'),
      onDrop: (d) => { if (d.item.kind === 'currency') onChoose(`key:${d.item.currencyId}`); },
    });
    return () => { local.slots.delete('passage'); };
  }, [local, map, atlas, held, onChoose]);
  const pit = options.find((o) => o.pit) ?? null;
  const hovered = drag?.target?.slot === 'passage' ? (drag.target.valid ? 'ok' : 'bad') : null;
  const accepts = drag?.item.kind === 'currency' && passageRefusal(map, atlas, held, drag.item.currencyId) === null;
  const title = chosen ? `${chosen.label}. Click to clear.`
    : pit ? 'The Bounty on this map can open the Pit of Echoes: click to take that passage.'
      : 'Passage: drag a key here from your inventory to open its sealed area with this map.';
  const click = (): void => {
    store.actions.uiSound('click');
    if (chosen) onChoose(null);
    else if (pit) onChoose(pit.id);
  };
  return (
    <div class="fe-passage" data-passage>
      <div role="button" tabIndex={0} aria-label={chosen ? `Passage: ${chosen.label}. Clear it.` : pit ? 'Passage: open the Pit of Echoes' : 'Passage slot: drag a key here'}
        data-drop="slot" data-slot="passage" title={title} onClick={click}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); click(); } }}
        class={cx('fe-device-slot fe-solid fe-passage__socket', chosen && 'fe-device-slot--filled', !chosen && pit && 'fe-passage__socket--offer', accepts && 'fe-slot--accepts', hovered && `fe-slot--${hovered}`)}>
        {chosen
          ? (chosen.key ? <PixelIcon id={iconIdForCurrency(chosen.key)} width={32} height={32} /> : <i class="fe-passage__pit" aria-hidden="true" />)
          : pit ? <i class="fe-passage__pit fe-passage__pit--offer" aria-hidden="true" /> : <span class="fe-device-slot__hint">Pass-<br />age</span>}
      </div>
      {chosen && <span class="ui-type-caption fe-passage__x" aria-hidden="true">×</span>}
    </div>
  );
}
