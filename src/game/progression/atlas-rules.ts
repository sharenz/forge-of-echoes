// Resolution of the Atlas tree into one frozen rules object per expedition (brief B 7). Tree effects are ordinary
// MapModifiers with source "Atlas: <node>" so map readouts and luck breakdowns stay honest; the hard caps of
// brief B 6.1 are enforced here and nowhere else.
import type { AtlasAreaId } from '../../contracts/atlas';
import type { CurrencyId, MapBaseId } from '../../contracts/content';
import { findAtlasArea } from '../../data/progression/atlas';
import {
  ATLAS_CAPS, ATLAS_WAVE_DURATION_FLOOR, atlasNodeAllocatable, mapTreeNodes,
  type AtlasCondition, type AtlasNode, type AtlasRule,
} from '../../data/progression/map-tree';
import type { MapStat } from '../../data/progression';
import type { RunSetup } from '../../contracts/game';
import type { MapModifier } from './maps';
import { resolveModes } from './util';

/** What a condition can look at. */
export interface AtlasContext {
  tier: number;
  baseId: MapBaseId;
  corrupted: boolean;
  areaId?: AtlasAreaId;
  /** The expedition rolled at least one encounter. */
  event?: boolean;
}

/** The part of the context a caller outside maps.ts supplies (map tier, base and corruption come from the map). */
export interface TreeContext {
  areaId?: AtlasAreaId;
  event?: boolean;
  /** The expedition's frozen sigils (brief D 6): `mapModifiers` adds their modifiers after the tree's (never capped by the tree's caps). */
  territory?: readonly NonNullable<RunSetup['territory']>[number][];
}

export function treeContextOf(setup: Pick<RunSetup, 'atlasAreaId' | 'event' | 'territory'>): TreeContext {
  return { ...(setup.atlasAreaId ? { areaId: setup.atlasAreaId } : {}), event: !!setup.event, ...(setup.territory?.length ? { territory: setup.territory } : {}) };
}

export interface AtlasCurrencyWeight { currencies: readonly CurrencyId[]; mode: 'increased' | 'more'; value: number; source: string }

export interface AtlasRules {
  nodes: readonly AtlasNode[];
  /** Tree effects that apply to this map, capped, labelled "Atlas: <node>". */
  modifiers: readonly MapModifier[];
  /** Sources whose value was reduced by a hard cap ("(capped)" in tooltips). */
  capped: readonly string[];
  /** Final boss wave override (0 = the map's own). */
  bossWave: number;
  equipmentNormalOnly: boolean;
  currencyWeights: readonly AtlasCurrencyWeight[];
  /** Rules other engines interpret (encounter lenses, event slots, scarab sockets...), from allocated nodes whose engine is live. */
  extraRules: readonly { node: string; rule: AtlasRule }[];
}

const EMPTY: AtlasRules = Object.freeze({ nodes: [], modifiers: [], capped: [], bossWave: 0, equipmentNormalOnly: false, currencyWeights: [], extraRules: [] });

function holds(c: AtlasCondition | undefined, ctx: AtlasContext): boolean {
  if (!c) return true;
  if (c.base && c.base !== ctx.baseId) return false;
  if (c.area) {
    const area = findAtlasArea(ctx.areaId);
    const dead = !!area && (area.deadEnd === true || area.sealed === true);
    if ((c.area === 'deadEnd') !== dead) return false;
    if (!area) return false;
  }
  if (c.corrupted !== undefined && c.corrupted !== ctx.corrupted) return false;
  if (c.event && !ctx.event) return false;
  if (c.minTier && ctx.tier < c.minTier) return false;
  return true;
}

const INCREASED_CAPS: Readonly<Partial<Record<MapStat, number>>> = {
  itemQuantity: ATLAS_CAPS.itemQuantityIncreased,
  itemRarity: ATLAS_CAPS.itemRarityIncreased,
  packRarity: ATLAS_CAPS.packRarityIncreased,
  mapDropChance: ATLAS_CAPS.mapDropChanceIncreased,
  essenceDropChance: ATLAS_CAPS.essenceIncreased,
  emberEssenceChance: ATLAS_CAPS.essenceIncreased,
  rimeEssenceChance: ATLAS_CAPS.essenceIncreased,
};
const FLAT_CAPS: Readonly<Partial<Record<MapStat, number>>> = { eventChance: ATLAS_CAPS.eventChancePoints, chestUpgradeChance: ATLAS_CAPS.chestUpgradePoints };
const ESSENCE_STATS: ReadonlySet<MapStat> = new Set<MapStat>(['essenceDropChance', 'emberEssenceChance', 'rimeEssenceChance']);

const CACHE = new Map<string, AtlasRules>();

/** Resolve `ids` for a map context. Unknown ids are ignored; the result is frozen and cached. */
export function resolveAtlasRules(ids: readonly string[] | undefined, ctx: AtlasContext): AtlasRules {
  if (!ids?.length) return EMPTY;
  const key = `${ids.join(',')}|${ctx.tier}|${ctx.baseId}|${ctx.corrupted ? 1 : 0}|${ctx.areaId ?? ''}|${ctx.event ? 1 : 0}`;
  const hit = CACHE.get(key);
  if (hit) return hit;
  const nodes = mapTreeNodes(ids).filter(atlasNodeAllocatable);
  const extraRules: { node: string; rule: AtlasRule }[] = [];
  const modifiers: MapModifier[] = [];
  const capped = new Set<string>();
  const incTotal = new Map<MapStat, number>();
  const flatTotal = new Map<MapStat, number>();
  const essenceMore = new Set<MapStat>();
  let lifeProduct = 1;
  const weights: AtlasCurrencyWeight[] = [];
  let bossWave = 0;
  let normal = false;
  for (const node of nodes) {
    const source = `Atlas: ${node.name}`;
    for (const e of node.effects) {
      if (!holds(e.when, ctx)) continue;
      let value = e.perTier ? e.value * ctx.tier : e.value;
      const label = () => { capped.add(node.name); return `${source} (capped)`; };
      let src = source;
      if (e.mode === 'increased' && value > 0 && INCREASED_CAPS[e.stat] !== undefined) {
        const room = INCREASED_CAPS[e.stat]! - (incTotal.get(e.stat) ?? 0);
        if (value > room) { value = Math.max(0, room); src = label(); }
        incTotal.set(e.stat, (incTotal.get(e.stat) ?? 0) + value);
      } else if (e.mode === 'flat' && value > 0 && FLAT_CAPS[e.stat] !== undefined) {
        const room = FLAT_CAPS[e.stat]! - (flatTotal.get(e.stat) ?? 0);
        if (value > room) { value = Math.max(0, room); src = label(); }
        flatTotal.set(e.stat, (flatTotal.get(e.stat) ?? 0) + value);
      } else if (e.mode === 'more' && ESSENCE_STATS.has(e.stat) && value > 0) {
        if (essenceMore.size >= ATLAS_CAPS.essenceMoreSources && !essenceMore.has(e.stat)) { capped.add(node.name); continue; }
        essenceMore.add(e.stat);
      } else if (e.stat === 'monsterLife' && e.mode === 'more' && value > 0) {
        const room = ATLAS_CAPS.monsterLifeMoreMultiplier / lifeProduct;
        if (1 + value / 100 > room) { value = Math.max(0, (room - 1) * 100); src = label(); }
        lifeProduct *= 1 + value / 100;
      }
      if (value === 0 && src !== source) continue;
      modifiers.push({ stat: e.stat, mode: e.mode, value, source: src });
    }
    for (const r of node.rules) {
      if (r.id === 'bossWave') bossWave = bossWave ? Math.min(bossWave, r.wave) : r.wave;
      else if (r.id === 'equipmentNormalOnly') normal = true;
      else if (r.id === 'currencyWeight') { if (holds(r.when, ctx)) weights.push({ currencies: r.currencies, mode: r.mode, value: r.value, source }); }
      else extraRules.push({ node: node.id, rule: r });
    }
  }
  const out: AtlasRules = Object.freeze({ nodes, modifiers, capped: [...capped], bossWave, equipmentNormalOnly: normal, currencyWeights: weights, extraRules });
  if (CACHE.size > 512) CACHE.clear();
  CACHE.set(key, out);
  return out;
}

/** Resolve a stat of the tree's modifiers alone. */
export function atlasStat(rules: AtlasRules, stat: MapStat, base: number): number {
  return resolveModes(base, rules.modifiers.filter(m => m.stat === stat));
}

/** Wave duration after tree and scarab multipliers, never below the 25 s floor. */
export function flooredWaveDuration(seconds: number): number {
  return Math.max(ATLAS_WAVE_DURATION_FLOOR, seconds);
}

/** Multiplier of one currency's drop weight from the tree (1 = unchanged). */
export function atlasCurrencyWeight(rules: AtlasRules, currencyId: CurrencyId): number {
  let inc = 0, more = 1;
  for (const w of rules.currencyWeights) {
    if (!w.currencies.includes(currencyId)) continue;
    if (w.mode === 'increased') inc += w.value; else more *= 1 + w.value / 100;
  }
  return (1 + inc / 100) * more;
}

/** Every node the account could hold is allocatable only when its engine is live. */
export { atlasNodeAllocatable };
