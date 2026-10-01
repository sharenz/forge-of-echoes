// "Sort" for the backpack (docs/onboarding-ux.md F-36): currency first, then flasks, maps (highest tier first, by area), then gear by slot, best
// rarity and item level first. Pure: it only re-lays the backpack's own items; nothing is added, removed or changed. Stacks merge on the way.
// Tall gear can pack differently, so a layout that does not fit is retried biggest-first, and refused (nothing moves) if it still does not.
import type { CharacterSave, EquipmentItem, Item } from '../../contracts/items';
import type { Result } from '../../contracts/game';
import { CURRENCY_IDS, EQUIP_SLOTS } from '../../contracts/content';
import { findBase } from '../../data/items';
import { autoPlace, createGrid, itemSize } from './inventory';

const RARITY_RANK: Record<EquipmentItem['rarity'], number> = { unique: 0, rare: 1, magic: 2, normal: 3 };

function groupOf(item: Item): number {
  return item.kind === 'currency' ? 0 : item.kind === 'flask' ? 1 : item.kind === 'map' ? 2 : 3;
}

function slotRank(item: EquipmentItem): number {
  const slot = findBase(item.baseId)?.slots[0];
  const i = slot ? EQUIP_SLOTS.indexOf(slot) : -1;
  return i < 0 ? EQUIP_SLOTS.length : i;
}

/** The comparison the sort uses (stable: equal items keep their relative order through the uid tiebreak). */
export function compareForSort(a: Item, b: Item): number {
  const ga = groupOf(a);
  const gb = groupOf(b);
  if (ga !== gb) return ga - gb;
  if (a.kind === 'currency' && b.kind === 'currency') return CURRENCY_IDS.indexOf(a.currencyId) - CURRENCY_IDS.indexOf(b.currencyId) || a.uid.localeCompare(b.uid);
  if (a.kind === 'flask' && b.kind === 'flask') return a.flaskId.localeCompare(b.flaskId) || a.uid.localeCompare(b.uid);
  if (a.kind === 'map' && b.kind === 'map') return b.tier - a.tier || a.areaId.localeCompare(b.areaId) || a.uid.localeCompare(b.uid);
  if (a.kind === 'equipment' && b.kind === 'equipment') {
    return slotRank(a) - slotRank(b) || RARITY_RANK[a.rarity] - RARITY_RANK[b.rarity] || b.itemLevel - a.itemLevel || a.baseId.localeCompare(b.baseId) || a.uid.localeCompare(b.uid);
  }
  return 0;
}

function layout(ch: CharacterSave, items: readonly Item[]): CharacterSave['backpack'] | null {
  let grid = createGrid(ch.backpack.w, ch.backpack.h);
  for (const item of items) {
    const next = autoPlace(grid, item);
    if (!next) return null;
    grid = next;
  }
  return grid;
}

/** The character with a sorted backpack, or an error when there is nothing to sort or it cannot be laid out. */
export function sortBackpack(ch: CharacterSave): Result<CharacterSave> {
  const items = ch.backpack.entries.map((e) => e.item);
  if (items.length < 2) return { ok: false, error: 'There is nothing to sort.' };
  const sorted = [...items].sort(compareForSort);
  const grid = layout(ch, sorted) ?? layout(ch, [...sorted].sort((a, b) => {
    const sa = itemSize(a);
    const sb = itemSize(b);
    return sb.w * sb.h - sa.w * sa.h || compareForSort(a, b);
  }));
  if (!grid) return { ok: false, error: 'The backpack could not be re-arranged without losing room.' };
  return { ok: true, value: { ...ch, backpack: grid } };
}
