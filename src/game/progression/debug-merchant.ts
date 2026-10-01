import { BASE_IDS, CURRENCY_IDS, FLASK_IDS, MAP_BASE_IDS, UNIQUE_IDS, SCARAB_IDS } from '../../contracts/content';
import type { CharacterSave, Item } from '../../contracts/items';
import type { DebugMerchantOptions, Result } from '../../contracts/game';
import type { Rng } from '../../contracts/rng';
import { createRng, hashString } from '../../core/rng';
import { getBase, getCurrency, getFlask, getUnique } from '../../data/items';
import { currencyStack, flaskStack, generateEquipment, generateUnique, mintUid } from '../items';
import { addBoughtItem, type BackpackCell } from './merchant';
import { mapBaseName, rollMapWithRarity } from './maps';
import { areaForTheme } from './map-binding';
import { fail, ok } from './util';

export const DEBUG_MERCHANT_NAME = 'Mira the Provisioner';
export const DEBUG_MERCHANT_DEFAULTS: DebugMerchantOptions = { quantity: 1, itemLevel: 88, mapTier: 1, rarity: 'normal' };
export type DebugMerchantCategory = 'Scarabs' | 'Supplies' | 'Maps' | 'Bases' | 'Uniques' | 'Flasks';
interface Stock {
  id: string;
  label: string;
  category: DebugMerchantCategory;
  maxStack: number;
  make(options: DebugMerchantOptions, rng: Rng, uid: string, count: number): Item;
}
const STOCK: readonly Stock[] = [
  ...CURRENCY_IDS.map(id => ({ id: `currency:${id}`, label: getCurrency(id).name, category: (SCARAB_IDS as readonly string[]).includes(id) ? 'Scarabs' as const : 'Supplies' as const, maxStack: getCurrency(id).maxStack,
    make: (_o: DebugMerchantOptions, _r: Rng, uid: string, count: number) => currencyStack(id, count, uid, true) })),
  ...MAP_BASE_IDS.map(id => ({ id: `map:${id}`, label: mapBaseName(id), category: 'Maps' as const, maxStack: 1,
    make: (o: DebugMerchantOptions, r: Rng, uid: string) => rollMapWithRarity(r, areaForTheme(id, o.mapTier, `debug:${id}`), o.mapTier, o.rarity, uid, 0, true) })),
  ...BASE_IDS.map(id => ({ id: `base:${id}`, label: getBase(id).name, category: 'Bases' as const, maxStack: 1,
    make: (o: DebugMerchantOptions, r: Rng, uid: string) => generateEquipment(id, o.itemLevel, o.rarity, r, { uid, isNew: true, origin: DEBUG_MERCHANT_NAME }) })),
  ...UNIQUE_IDS.map(id => ({ id: `unique:${id}`, label: getUnique(id).name, category: 'Uniques' as const, maxStack: 1,
    make: (o: DebugMerchantOptions, r: Rng, uid: string) => generateUnique(id, r, { uid, itemLevel: o.itemLevel, isNew: true, origin: DEBUG_MERCHANT_NAME }) })),
  ...FLASK_IDS.map(id => ({ id: `flask:${id}`, label: getFlask(id).name, category: 'Flasks' as const, maxStack: 20,
    make: (_o: DebugMerchantOptions, _r: Rng, uid: string, count: number) => flaskStack(id, count, uid, true) })),
];

export function validDebugMerchantOptions(o: DebugMerchantOptions): boolean {
  return !!o && Number.isInteger(o.quantity) && o.quantity >= 1 && o.quantity <= 100
    && Number.isInteger(o.itemLevel) && o.itemLevel >= 1 && o.itemLevel <= 99
    && Number.isInteger(o.mapTier) && o.mapTier >= 1 && o.mapTier <= 15
    && ['normal', 'magic', 'rare'].includes(o.rarity);
}

/** Catalogue previews are deterministic examples; purchases roll fresh items on the server. */
export function debugMerchantOffers(options: DebugMerchantOptions) {
  if (!validDebugMerchantOptions(options)) return [];
  return STOCK.map(s => ({ id: s.id, label: s.label, category: s.category,
    item: s.make(options, createRng(hashString(s.id)), `offer:${s.id}`, Math.min(options.quantity, s.maxStack)) }));
}

/** All-or-nothing delivery to the buyer. Authorization belongs to the host hideout on the server. */
export function buyDebugOffer(ch: CharacterSave, id: string, options: DebugMerchantOptions, at?: BackpackCell): Result<{ character: CharacterSave; message: string }> {
  if (!validDebugMerchantOptions(options)) return fail('Choose a quantity from 1–100, item level 1–99 and map tier 1–15.');
  const stock = STOCK.find(s => s.id === id);
  if (!stock) return fail('This testing merchant offer does not exist.');
  const rng = createRng(ch.rngState);
  let next = ch;
  for (let left = options.quantity; left > 0;) {
    const count = Math.min(left, stock.maxStack);
    const minted = mintUid(next);
    // The first delivery honours the drop cell; the rest of a bulk purchase fills the backpack first-fit.
    const added = addBoughtItem(minted.character, stock.make(options, rng, minted.uid, count), next === ch ? at : undefined);
    if (!added.ok) return fail('Your backpack cannot hold the whole purchase. Nothing was added.');
    next = added.value;
    left -= count;
  }
  return ok({ character: { ...next, rngState: rng.state() }, message: `Received ${options.quantity} × ${stock.label}.` });
}
