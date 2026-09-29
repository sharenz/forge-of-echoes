import type { EquipmentItem } from '../../contracts/items';
import { CURRENCIES } from '../../data/items/currencies';

const MAX_COUNT = 1_000_000;
export const historyCount = (raw: unknown): number => typeof raw === 'number' && Number.isFinite(raw)
  ? Math.max(0, Math.min(MAX_COUNT, Math.floor(raw))) : 0;

/** Old items infer a lower bound from their surviving craft lines and spent Stability. New counts never expire
 * when the display history rolls over, and travel with the item through stash, trade and save reloads. */
export function itemCraftCount(item: EquipmentItem): number {
  const names = Object.values(CURRENCIES).map(c => `${c.name} `);
  const logged = item.history.filter(line => line.startsWith('Bench: ') || names.some(name => line.startsWith(name))).length;
  const spent = Math.ceil(Math.max(0, item.maxStability - item.stability) / 3);
  return Math.max(historyCount(item.craftCount), logged, spent);
}

export const nextCraftCount = (item: EquipmentItem): number => historyCount(itemCraftCount(item) + 1);
