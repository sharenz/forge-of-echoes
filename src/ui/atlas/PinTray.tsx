// The pin tray (brief D 5.1): the account's pins as chips in the chart's corner, empty slots as dashed placeholders. A chip focuses
// its area on the chart; its x unpins. Pins are free, instant and account-wide: a pinned area's maps drop three times as often
// (four with Chart Keeper), frozen into each expedition at activation.
import type { AtlasAreaId } from '../../contracts/atlas';
import { findAtlasArea, atlasTierCeiling } from '../../data/progression/atlas';
import { emblemUrl } from '../../art/atlas/sprites';
import { cx } from '../components/common';
import { AreaSurgePips } from './SurgePips';

export function PinTray({ pins, slots, multiplier, onFocus, onUnpin }: {
  pins: readonly AtlasAreaId[];
  slots: number;
  /** x3, or x4 with Chart Keeper. */
  multiplier: number;
  onFocus: (id: AtlasAreaId) => void;
  onUnpin: (id: AtlasAreaId) => void;
}) {
  const empty = Math.max(0, slots - pins.length);
  return (
    <div class="fe-pintray" role="group" aria-label={`Pinned areas, ${pins.length} of ${slots}`} data-pintray>
      <span class="fe-pintray__label ui-type-caption" title={`Pinned areas drop their maps x${multiplier} as often. Free to change, any time.`}>
        <i class="fe-pinglyph" aria-hidden="true" /><span class="fe-pintray__word">Pins </span>{pins.length}/{slots}
      </span>
      {pins.map((id) => {
        const area = findAtlasArea(id);
        if (!area) return null;
        return (
          <span key={id} class="fe-pinchip" data-pin={id}>
            <button type="button" class="fe-pinchip__main ui-type-caption" onClick={() => onFocus(id)} title={`Show ${area.name} on the chart`}>
              <img class="fe-px" src={emblemUrl(area.baseId, 24)} alt="" width={20} height={20} />
              <span class="fe-pinchip__name">{area.name}</span>
              <span class="fe-pinchip__tier">T{atlasTierCeiling(area)}</span>
              <AreaSurgePips areaId={id} />
            </button>
            <button type="button" class="fe-pinchip__x ui-type-caption" aria-label={`Unpin ${area.name}`} title={`Unpin ${area.name}`} onClick={() => onUnpin(id)}><span class="fe-x" /></button>
          </span>
        );
      })}
      {Array.from({ length: empty }, (_, i) => (
        <span key={`e${i}`} class={cx('fe-pinchip fe-pinchip--empty ui-type-caption')} title="An open pin slot: select an area and press Pin" aria-label="Open pin slot">+</span>
      ))}
    </div>
  );
}
