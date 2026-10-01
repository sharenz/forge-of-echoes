// Read-only item content for ContentInfo (the second rules module adds skills and map bases).
import type { BaseInfo, CurrencyInfo, FlaskInfo, UniqueInfo } from '../../contracts/game';
import type { BaseId, CurrencyId, FlaskId, UniqueId } from '../../contracts/content';
import { BASE_IDS, CURRENCY_IDS, FLASK_IDS, UNIQUE_IDS } from '../../contracts/content';
import { BASES, CURRENCIES, FLASKS, UNIQUES } from '../../data/items';

function record<K extends string, V>(ids: readonly K[], make: (id: K) => V): Record<K, V> {
  const out = {} as Record<K, V>;
  for (const id of ids) out[id] = make(id);
  return out;
}

/** BaseInfo for every base (plain objects, no rules-internal fields). */
export const BASE_INFO: Record<BaseId, BaseInfo> = record(BASE_IDS, (id) => {
  const b = BASES[id];
  return {
    id: b.id,
    name: b.name,
    itemClass: b.itemClass,
    slots: [...b.slots],
    size: { ...b.size },
    levelRequirement: b.levelRequirement,
    maxStability: b.maxStability,
    materialNote: b.materialNote,
  };
});

/** CurrencyInfo for all 16 currencies (equipment and map). */
export const CURRENCY_INFO: Record<CurrencyId, CurrencyInfo> = record(CURRENCY_IDS, (id) => {
  const c = CURRENCIES[id];
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    family: c.family,
    stabilityCost: c.stabilityCost,
    maxStack: c.maxStack,
    needsAffixChoice: c.needsAffixChoice,
  };
});

export const FLASK_INFO: Record<FlaskId, FlaskInfo> = record(FLASK_IDS, (id) => {
  const f = FLASKS[id];
  return { id: f.id, name: f.name, description: f.description, resource: f.resource };
});

export const UNIQUE_INFO: Record<UniqueId, UniqueInfo> = record(UNIQUE_IDS, (id) => {
  const u = UNIQUES[id];
  return { id: u.id, name: u.name, baseId: u.baseId, flavor: u.flavor };
});
