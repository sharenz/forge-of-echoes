// Icon registry: id → generator. Icons are generated lazily and cached (they are only needed by the DOM UI).
// Includes the wave-5 debuff HUD icons ('icon/debuff/<PLAYER_DEBUFFS>', drawn in src/art/bestiary/icons.ts).
import type { PixelImage } from '../../contracts/art';
import { BESTIARY_ICONS } from '../bestiary/icons';
import { CURRENCY_ICONS } from './currency';
import { EQUIPMENT_ICONS, ICON_FOOTPRINT } from './equipment';
import { ICON } from './kit';
import { SKILL_ICONS } from './skills';
import { UI_ICONS } from './ui';

const GENERATORS: Record<string, () => PixelImage> = {
  ...EQUIPMENT_ICONS,
  ...CURRENCY_ICONS,
  ...SKILL_ICONS,
  ...UI_ICONS,
  ...BESTIARY_ICONS,
};

const cache = new Map<string, PixelImage>();

/** Every icon id this module can draw. */
export const ICON_IDS: readonly string[] = Object.keys(GENERATORS);

/** Pixels per inventory grid cell in the icon sources. */
export const ICON_CELL = ICON;

/**
 * Grid footprint of an icon in cells, [w, h]. Equipment bases and uniques take their item's inventory footprint
 * (a wand is [1, 3], a helmet [2, 2]); currencies, flasks, maps, skills, UI and debuff icons are [1, 1].
 */
export function iconFootprint(id: string): readonly [number, number] {
  return ICON_FOOTPRINT[id] ?? [1, 1];
}

/** Raw RGBA pixels of an icon (32 px per grid cell, see `iconFootprint`), or null for an unknown id. */
export function iconPixels(id: string): PixelImage | null {
  const hit = cache.get(id);
  if (hit) return hit;
  const gen = GENERATORS[id];
  if (!gen) return null;
  const img = gen();
  cache.set(id, img);
  return img;
}
