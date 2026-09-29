// Item content tables + id lookups. Pure data; no rules live here.
import type { BaseId, CurrencyId, FlaskId, UniqueId } from '../../contracts/content';
import { MAP_CURRENCY_IDS } from '../../contracts/content';
import { AFFIXES } from './affixes';
import { BASES } from './bases';
import { CURRENCIES } from './currencies';
import { FLASKS } from './flasks';
import { SCARS } from './scars';
import { UNIQUES } from './uniques';
import type { AffixDef, BaseDef, CurrencyDef, FlaskDef, ScarDef, UniqueDef } from './types';

export * from './types';
export * from './rules';
export { AFFIXES, AFFIX_VERSION, TIER_LADDERS } from './affixes';
export { BASES, CLASS_SIZE, CLASS_SLOTS } from './bases';
export {
  BENCH_BEST_TIER, BENCH_LUCK_PRICE_MULTIPLIER, BENCH_MAX_CRAFTED, BENCH_PRICE_BANDS, BENCH_RECIPES, BENCH_RECIPE_PREFIX,
  BENCH_STABILITY_COST,
} from './bench';
export type { BenchPriceBand, BenchRecipeDef } from './bench';
export { CURRENCIES, CURRENCY_FAMILY_LABEL } from './currencies';
export { FLASKS } from './flasks';
export { RARE_NAME_FIRST, RARE_NAME_SECOND } from './names';
export { SCARS } from './scars';
export { STAT_LABEL, STAT_TEXT, TAG_LABEL, CLASS_LABEL } from './stat-text';
export { UNIQUES } from './uniques';

/**
 * `table[id]` for an OWN key only. Ids arrive from the network (commands), so a lookup must never
 * resolve "constructor", "__proto__" or "toString" through Object.prototype.
 */
export function ownEntry<T>(table: Readonly<Record<string, T>>, id: unknown): T | undefined {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(table, id) ? table[id] : undefined;
}

const AFFIX_MAP = new Map<string, AffixDef>(AFFIXES.map((a) => [a.id, a]));
const AFFIX_ORDER = new Map<string, number>(AFFIXES.map((a, i) => [a.id, i]));
const SCAR_MAP = new Map<string, ScarDef>(SCARS.map((s) => [s.id, s]));
const MAP_CURRENCIES = new Set<string>(MAP_CURRENCY_IDS);

export function getBase(id: BaseId): BaseDef {
  const b = ownEntry<BaseDef>(BASES, id);
  if (!b) throw new Error(`Unknown base "${id}"`);
  return b;
}

export function findBase(id: string): BaseDef | undefined {
  return ownEntry<BaseDef>(BASES, id);
}

export function getAffix(id: string): AffixDef | undefined {
  return AFFIX_MAP.get(id);
}

/** Canonical display position of an affix (prefixes first, then suffixes, in table order). */
export function affixOrder(id: string): number {
  return AFFIX_ORDER.get(id) ?? Number.MAX_SAFE_INTEGER;
}

export function getScar(id: string): ScarDef | undefined {
  return SCAR_MAP.get(id);
}

export function getUnique(id: UniqueId): UniqueDef {
  const u = ownEntry<UniqueDef>(UNIQUES, id);
  if (!u) throw new Error(`Unknown unique "${id}"`);
  return u;
}

export function findUnique(id: string): UniqueDef | undefined {
  return ownEntry<UniqueDef>(UNIQUES, id);
}

export function getCurrency(id: CurrencyId): CurrencyDef {
  const c = ownEntry<CurrencyDef>(CURRENCIES, id);
  if (!c) throw new Error(`Unknown currency "${id}"`);
  return c;
}

export function findCurrency(id: string): CurrencyDef | undefined {
  return ownEntry<CurrencyDef>(CURRENCIES, id);
}

export function getFlask(id: FlaskId): FlaskDef {
  const f = ownEntry<FlaskDef>(FLASKS, id);
  if (!f) throw new Error(`Unknown flask "${id}"`);
  return f;
}

export function findFlask(id: string): FlaskDef | undefined {
  return ownEntry<FlaskDef>(FLASKS, id);
}

export function isMapCurrency(id: CurrencyId): boolean {
  return MAP_CURRENCIES.has(id);
}
