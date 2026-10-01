import type { CurrencyId, MapBaseId } from '../../../contracts/content';
import type { AtlasCondition, AtlasEffect, AtlasNodeSpec } from './types';
import type { MapStat } from '../types';

export const inc = (stat: MapStat, value: number, when?: AtlasCondition): AtlasEffect => ({ stat, mode: 'increased', value, ...(when ? { when } : {}) });
export const more = (stat: MapStat, value: number, when?: AtlasCondition): AtlasEffect => ({ stat, mode: 'more', value, ...(when ? { when } : {}) });
export const flat = (stat: MapStat, value: number, when?: AtlasCondition): AtlasEffect => ({ stat, mode: 'flat', value, ...(when ? { when } : {}) });
/** Value is per map tier of the opened map. */
export const tiered = (e: AtlasEffect): AtlasEffect => ({ ...e, perTier: true });
export const onBase = (base: MapBaseId): AtlasCondition => ({ base });
export const weight = (currencies: readonly CurrencyId[], mode: 'increased' | 'more', value: number, base?: MapBaseId) =>
  ({ id: 'currencyWeight', currencies, mode, value, ...(base ? { when: { base } } : {}) } as const);

type Extra = Partial<Omit<AtlasNodeSpec, 'id' | 'name' | 'kind' | 'ring' | 'lane' | 'from'>>;
const make = (kind: AtlasNodeSpec['kind']) => (id: string, name: string, ring: number, lane: number, from: string | readonly string[], extra: Extra = {}): AtlasNodeSpec =>
  ({ id, name, kind, ring, lane, from, ...extra });
export const S = make('small');
export const N = make('notable');
export const K = make('keystone');
export const EV = make('event');
