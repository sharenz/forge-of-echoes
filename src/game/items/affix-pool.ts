// Affix pools: which affixes can roll on an item, with what weight, and the exact odds of a roll.
//
// Rolling model (used by drops, Kindling, Reforge and Essences alike):
//   repeat N times: pick one eligible affix with probability ∝ its weight, then one of its tiers ∝ tier
//   weight, then a uniform integer value in the tier's range.
// An affix's weight = Σ(weights of tiers unlocked by item level) × material/tag multipliers. Eligible =
// allowed on the class (and base property), group not already present, and its kind (prefix/suffix)
// still has room under the rarity limits. Because this model is explicit, the previews can compute the
// exact same odds the roll uses.
import type { AffixKind, AffixTag, RolledAffix, StatId } from '../../contracts/items';
import type { Rng } from '../../contracts/rng';
import { createRng, hashString } from '../../core/rng';
import { AFFIXES, affixOrder, getAffix } from '../../data/items';
import type { AffixDef, AffixLimits, AffixTierDef, BaseDef, CountWeight } from '../../data/items';

export interface AffixCandidate {
  affix: AffixDef;
  /** Tiers unlocked at this item level (T1 first). */
  tiers: readonly AffixTierDef[];
  /** Total pick weight (Σ unlocked tier weights × multipliers). */
  weight: number;
}

export interface PoolOptions {
  /** Keep only affixes with at least one of these tags (essences). */
  tags?: readonly AffixTag[];
  /** Extra weight multipliers by tag on top of the base material (e.g. map implicits). */
  tagWeights?: Partial<Record<AffixTag, number>>;
}

export function baseHasProperty(base: BaseDef, stat: StatId): boolean {
  return base.properties.some((p) => p.stat === stat);
}

/** Class allow-list + required base property (e.g. % Armour only on Armour bases). */
export function affixAllowedOnBase(affix: AffixDef, base: BaseDef): boolean {
  if (!affix.classes.includes(base.itemClass)) return false;
  return !affix.requiresProperty || baseHasProperty(base, affix.requiresProperty);
}

/** Product of every matching tag multiplier from the given maps. */
export function tagMultiplier(affix: AffixDef, ...maps: (Partial<Record<AffixTag, number>> | undefined)[]): number {
  let m = 1;
  for (const map of maps) {
    if (!map) continue;
    for (const tag of affix.tags) {
      const w = map[tag];
      if (w !== undefined) m *= w;
    }
  }
  return m;
}

/** Every affix that can roll on this base at this item level, in canonical order. */
export function affixCandidates(base: BaseDef, itemLevel: number, opts: PoolOptions = {}): AffixCandidate[] {
  const out: AffixCandidate[] = [];
  for (const affix of AFFIXES) {
    if (!affixAllowedOnBase(affix, base)) continue;
    if (opts.tags && !affix.tags.some((t) => opts.tags!.includes(t))) continue;
    const tiers = affix.tiers.filter((t) => t.itemLevel <= itemLevel);
    if (!tiers.length) continue;
    const mult = tagMultiplier(affix, base.material?.tagWeights, opts.tagWeights);
    const weight = tiers.reduce((s, t) => s + t.weight, 0) * mult;
    if (weight > 0) out.push({ affix, tiers, weight });
  }
  return out;
}

export interface AffixState {
  prefix: number;
  suffix: number;
  groups: Set<string>;
}

/** Kind counts and occupied groups of an item's affixes (unknown ids — unique mods — are ignored). */
export function affixState(affixes: readonly RolledAffix[]): AffixState {
  const st: AffixState = { prefix: 0, suffix: 0, groups: new Set() };
  for (const a of affixes) {
    const def = getAffix(a.affixId);
    if (!def) continue;
    st[def.kind] += 1;
    st.groups.add(def.group);
  }
  return st;
}

export function hasRoom(kind: AffixKind, st: AffixState, limits: AffixLimits): boolean {
  return st[kind] < limits[kind];
}

/** Candidates that may be picked next given the current affixes and limits. */
export function eligibleCandidates(
  cands: readonly AffixCandidate[], st: AffixState, limits: AffixLimits,
): AffixCandidate[] {
  return cands.filter((c) => !st.groups.has(c.affix.group) && hasRoom(c.affix.kind, st, limits));
}

/** Uniform integer in [min, max] (tolerates reversed bounds). */
export function rollValue(rng: Rng, min: number, max: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return rng.int(lo, hi);
}

export function rollCount(rng: Rng, table: readonly CountWeight[]): number {
  return rng.weighted(table, (c) => c.weight)?.count ?? table[0].count;
}

/** Roll a tier (∝ weight among unlocked tiers) and a value for a chosen candidate. */
export function rollAffix(rng: Rng, cand: AffixCandidate): RolledAffix {
  const tier = rng.weighted(cand.tiers, (t) => t.weight) ?? cand.tiers[cand.tiers.length - 1];
  return { affixId: cand.affix.id, tier: tier.tier, value: rollValue(rng, tier.min, tier.max) };
}

/** Add up to `count` new affixes by sequential weighted picks. Returns only the new affixes. */
export function rollNewAffixes(
  rng: Rng,
  cands: readonly AffixCandidate[],
  existing: readonly RolledAffix[],
  limits: AffixLimits,
  count: number,
): RolledAffix[] {
  const st = affixState(existing);
  const added: RolledAffix[] = [];
  for (let i = 0; i < count; i++) {
    const pool = eligibleCandidates(cands, st, limits);
    const cand = rng.weighted(pool, (c) => c.weight);
    if (!cand) break;
    added.push(rollAffix(rng, cand));
    st[cand.affix.kind] += 1;
    st.groups.add(cand.affix.group);
  }
  return added;
}

/** Canonical order: prefixes first, then suffixes, each in affix-table order (stable). */
export function sortAffixes(affixes: readonly RolledAffix[]): RolledAffix[] {
  const kindRank = (a: RolledAffix) => (getAffix(a.affixId)?.kind === 'suffix' ? 1 : 0);
  return affixes
    .map((a, i) => ({ a, i }))
    .sort((x, y) => kindRank(x.a) - kindRank(y.a) || affixOrder(x.a.affixId) - affixOrder(y.a.affixId) || x.i - y.i)
    .map((x) => x.a);
}

// ---------------------------------------------------------------------------------------------
// Exact inclusion odds
// ---------------------------------------------------------------------------------------------
//
// P(an affix is on the item) after rolling `count` new affixes with the sequential model above.
//
// Exact without enumerating subsets: an exclusive group whose open members share a kind acts as one
// entity whose weight is the sum of its members (once any member is picked the group closes, and which
// member it was is ∝ its weight). Entities of the same kind and weight are exchangeable, so the process
// only has to track *how many* entities of each (kind, weight) class were picked. That state space is
// tiny (a few weight classes per kind, at most 3 picks each), so the answer is exact and costs well
// under a millisecond however many affixes the data grows to.
// A group that mixes prefixes and suffixes breaks the entity trick. The shipped data has none; such a
// pool falls back to a fixed-seed sampled estimate, flagged with `exact: false`.

export interface CountChance {
  /** Number of new picks attempted. */
  count: number;
  chance: number;
}

export interface InclusionOdds {
  /** Affix id → probability that the affix is on the item afterwards. */
  odds: Map<string, number>;
  /** False when the odds are a deterministic sampled estimate instead of exact values. */
  exact: boolean;
}

const ODDS_CACHE_LIMIT = 64;
const ESTIMATE_SAMPLES = 20000;
const oddsCache = new Map<string, InclusionOdds>();

/** One open exclusive group: its members share a kind; picking any member closes it. */
interface Entity {
  kind: AffixKind;
  weight: number;
  members: AffixCandidate[];
}

/** Entities per open group, or null when a group mixes prefixes and suffixes. */
function groupEntities(pool: readonly AffixCandidate[]): Entity[] | null {
  const byGroup = new Map<string, Entity>();
  for (const c of pool) {
    const e = byGroup.get(c.affix.group);
    if (!e) {
      byGroup.set(c.affix.group, { kind: c.affix.kind, weight: c.weight, members: [c] });
    } else {
      if (e.kind !== c.affix.kind) return null;
      e.weight += c.weight;
      e.members.push(c);
    }
  }
  return [...byGroup.values()];
}

function normalisedCounts(counts: readonly CountChance[]): { count: number; chance: number }[] {
  const total = counts.reduce((s, c) => s + Math.max(0, c.chance), 0) || 1;
  return counts.map((c) => ({ count: Math.max(0, Math.floor(c.count)), chance: Math.max(0, c.chance) / total }));
}

function exactInclusion(
  entities: readonly Entity[], st: AffixState, limits: AffixLimits, counts: readonly CountChance[],
): Map<string, number> {
  const norm = normalisedCounts(counts);
  const maxK = norm.reduce((m, c) => Math.max(m, c.count), 0);
  const room: Record<AffixKind, number> = {
    prefix: Math.max(0, limits.prefix - st.prefix),
    suffix: Math.max(0, limits.suffix - st.suffix),
  };

  // Weight classes of exchangeable entities.
  const classes: { kind: AffixKind; weight: number; size: number }[] = [];
  const classOf = entities.map((e) => {
    let i = classes.findIndex((k) => k.kind === e.kind && k.weight === e.weight);
    if (i < 0) {
      i = classes.length;
      classes.push({ kind: e.kind, weight: e.weight, size: 0 });
    }
    classes[i].size += 1;
    return i;
  });
  const n = classes.length;

  // State = picks per class, packed as a mixed-radix integer (digit i ≤ min(size, room, maxK)).
  const digitBase: number[] = [];
  const place: number[] = [];
  let mult = 1;
  for (const k of classes) {
    const b = Math.min(k.size, room[k.kind], maxK) + 1;
    digitBase.push(b);
    place.push(mult);
    mult *= b;
  }

  // expected[t][i] = expected number of class-i entities picked within the first t picks.
  const expected: Float64Array[] = [new Float64Array(n)];
  const picked = new Int32Array(n);
  let layer = new Map<number, number>([[0, 1]]);
  for (let t = 0; t < maxK; t++) {
    const acc = Float64Array.from(expected[t]);
    const next = new Map<number, number>();
    const last = t === maxK - 1;
    for (const [key, p] of layer) {
      let prefixes = 0;
      let suffixes = 0;
      for (let i = 0; i < n; i++) {
        picked[i] = Math.floor(key / place[i]) % digitBase[i];
        if (classes[i].kind === 'prefix') prefixes += picked[i];
        else suffixes += picked[i];
      }
      const open: Record<AffixKind, boolean> = { prefix: prefixes < room.prefix, suffix: suffixes < room.suffix };
      let total = 0;
      for (let i = 0; i < n; i++) {
        if (open[classes[i].kind] && picked[i] < classes[i].size) total += (classes[i].size - picked[i]) * classes[i].weight;
      }
      if (total <= 0) {
        // Nothing left to roll: the state is final; carry it forward unchanged.
        if (!last) next.set(key, (next.get(key) ?? 0) + p);
        continue;
      }
      for (let i = 0; i < n; i++) {
        if (!open[classes[i].kind] || picked[i] >= classes[i].size) continue;
        const q = (p * (classes[i].size - picked[i]) * classes[i].weight) / total;
        acc[i] += q;
        if (!last) next.set(key + place[i], (next.get(key + place[i]) ?? 0) + q);
      }
    }
    expected.push(acc);
    layer = next;
  }

  const out = new Map<string, number>();
  entities.forEach((e, idx) => {
    const ci = classOf[idx];
    let picks = 0;
    for (const c of norm) picks += c.chance * expected[Math.min(c.count, maxK)][ci];
    // Exchangeable entities share the class's expected picks equally; members split by weight.
    const pEntity = picks / classes[ci].size;
    for (const m of e.members) out.set(m.affix.id, pEntity * (m.weight / e.weight));
  });
  return out;
}

/** Deterministic Monte Carlo estimate (only for pools the exact method cannot model). */
function sampledInclusion(
  pool: readonly AffixCandidate[], st: AffixState, limits: AffixLimits, counts: readonly CountChance[], seed: number,
): Map<string, number> {
  const rng = createRng(seed);
  const norm = normalisedCounts(counts);
  const hits = new Map<string, number>(pool.map((c) => [c.affix.id, 0]));
  for (let s = 0; s < ESTIMATE_SAMPLES; s++) {
    const k = rng.weighted(norm, (c) => c.chance)?.count ?? 0;
    const local: AffixState = { prefix: st.prefix, suffix: st.suffix, groups: new Set(st.groups) };
    for (let i = 0; i < k; i++) {
      const cand = rng.weighted(eligibleCandidates(pool, local, limits), (c) => c.weight);
      if (!cand) break;
      hits.set(cand.affix.id, (hits.get(cand.affix.id) ?? 0) + 1);
      local[cand.affix.kind] += 1;
      local.groups.add(cand.affix.group);
    }
  }
  const out = new Map<string, number>();
  for (const [id, h] of hits) out.set(id, h / ESTIMATE_SAMPLES);
  return out;
}

/**
 * Probability that each candidate ends up on the item after rolling `count` new affixes (count drawn
 * from `counts`) on top of `existing`, following the sequential weighted model. Exact for every pool
 * the data can produce; see the section comment for the one sampled fallback. Results are cached.
 */
export function inclusionOdds(
  cands: readonly AffixCandidate[],
  existing: readonly RolledAffix[],
  limits: AffixLimits,
  counts: readonly CountChance[],
): InclusionOdds {
  const st = affixState(existing);
  const pool = cands.filter((c) => !st.groups.has(c.affix.group));
  const key = [
    pool.map((c) => `${c.affix.id}:${c.affix.kind}:${c.affix.group}:${c.weight}`).join(','),
    st.prefix, st.suffix, limits.prefix, limits.suffix,
    counts.map((c) => `${c.count}:${c.chance}`).join(','),
  ].join('|');
  const cached = oddsCache.get(key);
  if (cached) {
    // Refresh recency so the cache evicts least-recently-used entries.
    oddsCache.delete(key);
    oddsCache.set(key, cached);
    return cached;
  }

  const entities = groupEntities(pool);
  const result: InclusionOdds = entities
    ? { odds: exactInclusion(entities, st, limits, counts), exact: true }
    : { odds: sampledInclusion(pool, st, limits, counts, hashString(key)), exact: false };
  if (oddsCache.size >= ODDS_CACHE_LIMIT) oddsCache.delete(oddsCache.keys().next().value as string);
  oddsCache.set(key, result);
  return result;
}

/** Probability of each candidate being the single pick (essences). Sums to 1. */
export function singlePickOdds(pool: readonly AffixCandidate[]): { cand: AffixCandidate; chance: number }[] {
  const total = pool.reduce((s, c) => s + c.weight, 0);
  if (total <= 0) return [];
  return pool.map((cand) => ({ cand, chance: cand.weight / total }));
}
