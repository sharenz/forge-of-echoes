// Cheap per-item display facts that don't need the rules' full description. Pure; tested.
import { iconIdForBase, iconIdForCurrency, iconIdForFlask, iconIdForMap, iconIdForUnique } from '../../contracts/content';
import type { Item, ItemLocation, ItemTone } from '../../contracts/items';

export function itemTone(item: Item): ItemTone {
  switch (item.kind) {
    case 'equipment':
      return item.rarity;
    case 'currency':
      return 'currency';
    case 'flask':
      return 'flask';
    case 'map':
      return item.rarity === 'normal' ? 'map' : item.rarity;
  }
}

export function itemIconId(item: Item): string {
  switch (item.kind) {
    case 'equipment':
      return item.uniqueId ? iconIdForUnique(item.uniqueId) : iconIdForBase(item.baseId);
    case 'currency':
      return iconIdForCurrency(item.currencyId);
    case 'flask':
      return iconIdForFlask(item.flaskId);
    case 'map':
      return iconIdForMap(item.baseId);
  }
}

/** Stack count shown in the corner (currency, flasks); null for single items. */
export function stackCount(item: Item): number | null {
  return item.kind === 'currency' || item.kind === 'flask' ? item.count : null;
}

export function sameLocation(a: ItemLocation, b: ItemLocation): boolean {
  switch (a.kind) {
    case 'backpack':
      return b.kind === 'backpack' && a.x === b.x && a.y === b.y;
    case 'stash':
      return b.kind === 'stash' && a.tab === b.tab && a.x === b.x && a.y === b.y;
    case 'equipment':
      return b.kind === 'equipment' && a.slot === b.slot;
    case 'belt':
      return b.kind === 'belt' && a.index === b.index;
    case 'mapDevice':
      return b.kind === 'mapDevice';
    case 'scarabSlot':
      return b.kind === 'scarabSlot' && a.index === b.index;
    case 'currencyStash':
      return b.kind === 'currencyStash';
    case 'mapStash':
      return b.kind === 'mapStash';
  }
}

export function locationKey(loc: ItemLocation): string {
  switch (loc.kind) {
    case 'backpack':
      return `backpack:${loc.x}:${loc.y}`;
    case 'stash':
      return `stash:${loc.tab}:${loc.x}:${loc.y}`;
    case 'equipment':
      return `equipment:${loc.slot}`;
    case 'belt':
      return `belt:${loc.index}`;
    case 'mapDevice':
      return 'mapDevice';
    case 'scarabSlot':
      return `scarabSlot:${loc.index}`;
    case 'currencyStash':
      return 'currencyStash';
    case 'mapStash':
      return 'mapStash';
  }
}
