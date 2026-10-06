// Random-build bots for the Orrery (docs/power-rework/passive-tree.md 8.2). A bot grows a connected allocation from Spark by uniform
// random choice among the allocatable frontier (linked, not excluded, affordable) until its points run out, picks a random rider for
// each mastery, and is valued by an analytic power index:
//
//   index = offence × defence, both in ledger units (1u = +1%) at a reference build of the monster level:
//     offence  the best of the five damage types: (1 + B + Σinc_t) / (1 + B) × Πmore_t × cast speed × crit × penetration × area,
//              B the reference build's Σincreased at that level (ML28 2.0, ML60 4.0, ML88 5.0), so +4% of a type is about 1u at ML60;
//     defence  1 + Σ(ledger units of the defence lines) / 100 × the tree's `more` life and the damage-taken product;
//   plus the UNMODELLED share of nodes whose effect is a structural rule (PASSIVE_RULES, not live in PT0): the node's audit gross
//   minus what its stat lines are worth, on the side the rule belongs to; a keystone's unmodelled price counts against it.
//
// Everything goes through resolvePassives, so the caps of passive-tree.md 1.3 apply exactly as they do in the game.
import { createRng } from '../../src/core/rng';
import type { Rng } from '../../src/contracts/rng';
import type { StatId, StatModifier } from '../../src/contracts/items';
import { MASTERY_CHOICES } from '../../src/contracts/passives';
import {
  LEDGER_RATES, PASSIVE_NODES, PASSIVE_RULES, PASSIVE_START_ID, findPassiveNode, ledgerUnits, passiveNodeOrder, passivePointsEarned,
  type PassiveMod, type PassiveNode,
} from '../../src/data/progression/passives';
import { passiveAdjacent, passiveExclusion, resolvePassives } from '../../src/game/progression/passives';

export interface Build {
  ids: readonly string[];
  masteries: Record<string, number>;
}

/** The reference build's Σincreased damage (fraction) at a monster level (power-curve.md 5.2: about 400% at ML60). */
export function referenceIncreased(ml: number): number {
  if (ml <= 28) return 2;
  if (ml <= 60) return 2 + ((ml - 28) / 32) * 2;
  return 4 + Math.min(1, (ml - 60) / 28);
}

/**
 * Cheapest paths (in points) from the allocated set to every node, never through a node that clashes with the allocation. Returns
 * each reachable node's path cost and its predecessor (the allocated set and Spark cost 0).
 */
export function cheapestPaths(chosen: ReadonlySet<string>): { cost: Map<string, number>; prev: Map<string, string> } {
  const cost = new Map<string, number>([[PASSIVE_START_ID, 0]]);
  for (const id of chosen) cost.set(id, 0);
  const prev = new Map<string, string>();
  const blocked = new Set<string>();
  for (const id of chosen) for (const x of findPassiveNode(id)!.excludes) blocked.add(x);
  const open = [...cost.keys()];
  // Costs are small integers: a bucketed Dijkstra.
  const buckets: string[][] = [open];
  for (let c = 0; c < buckets.length; c++) {
    for (const id of buckets[c] ?? []) {
      if (cost.get(id) !== c) continue;
      for (const l of findPassiveNode(id)!.links) {
        const n = findPassiveNode(l)!;
        if (chosen.has(n.id) || n.id === PASSIVE_START_ID || blocked.has(n.id)) continue;
        const next = c + n.cost;
        if (next < (cost.get(n.id) ?? Infinity)) {
          cost.set(n.id, next);
          prev.set(n.id, id);
          (buckets[next] ??= []).push(n.id);
        }
      }
    }
  }
  return { cost, prev };
}

/** The nodes on the cheapest path to `target` that are not allocated yet, nearest first. */
function pathTo(target: string, paths: ReturnType<typeof cheapestPaths>, chosen: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (let id: string | undefined = target; id && !chosen.has(id) && id !== PASSIVE_START_ID; id = paths.prev.get(id)) out.unshift(id);
  return out;
}

/** The cheapest allocation order that reaches `target` from what is allocated (nearest first). */
export function pathToNode(target: string, chosen: ReadonlySet<string> = new Set()): string[] {
  return pathTo(target, cheapestPaths(chosen), chosen);
}

/** Whether a path can be taken whole (no node on it clashes with an earlier one of the same path). */
function pathClean(path: readonly string[], chosen: ReadonlySet<string>): boolean {
  const set = new Set(chosen);
  for (const id of path) {
    const n = findPassiveNode(id)!;
    if (passiveExclusion(n, set)) return false;
    set.add(id);
  }
  return true;
}

/**
 * Grow one random connected allocation of `points` from Spark, "uniform random growth with reachability" (passive-tree.md 8.2): pick
 * a uniformly random node the remaining points can reach, allocate the cheapest path to it, repeat until nothing is affordable.
 */
export function randomBuild(rng: Rng, points = passivePointsEarned(80, 6)): Build {
  const chosen = new Set<string>();
  let left = points;
  for (;;) {
    const paths = cheapestPaths(chosen);
    const targets: string[] = [];
    for (const [id, c] of paths.cost) if (c > 0 && c <= left) targets.push(id);
    if (!targets.length) break;
    targets.sort((a, b) => passiveNodeOrder(a) - passiveNodeOrder(b));
    const target = findPassiveNode(rng.pick(targets))!;
    const path = pathTo(target.id, paths, chosen);
    if (!pathClean(path, chosen)) continue;
    for (const id of path) { chosen.add(id); left -= findPassiveNode(id)!.cost; }
  }
  const masteries: Record<string, number> = {};
  for (const id of chosen) if (findPassiveNode(id)?.kind === 'mastery') masteries[id] = rng.int(0, MASTERY_CHOICES - 1);
  return { ids: PASSIVE_NODES.filter((n) => chosen.has(n.id)).map((n) => n.id), masteries };
}

/** Grow by uniform choice among the allocatable frontier (the naive reading of 8.2; kept to document its hub bias). */
export function frontierBuild(rng: Rng, points = passivePointsEarned(80, 6)): Build {
  const chosen = new Set<string>();
  let left = points;
  for (;;) {
    const frontier = PASSIVE_NODES.filter((n) => n.id !== PASSIVE_START_ID && !chosen.has(n.id) && n.cost <= left
      && passiveAdjacent(n, chosen) && !passiveExclusion(n, chosen));
    if (!frontier.length) break;
    const pick = rng.pick(frontier);
    chosen.add(pick.id);
    left -= pick.cost;
  }
  return { ids: PASSIVE_NODES.filter((n) => chosen.has(n.id)).map((n) => n.id), masteries: {} };
}

const DEFENCE_STATS: ReadonlySet<StatId> = new Set<StatId>([
  'maxLife', 'lifeRegen', 'armor', 'evasion', 'fireRes', 'coldRes', 'lightningRes', 'voidRes', 'allRes', 'maxResistance',
  'flaskEffect', 'str', 'dex', 'lifeOnKill', 'damageTaken',
]);

function unitsOf(m: Pick<StatModifier, 'stat' | 'mode' | 'value'>): number {
  return (LEDGER_RATES[m.stat]?.[m.mode] ?? 0) * m.value;
}

type Sides = { offence: number; defence: number; utility: number };

/**
 * What a node's (or rider's) rules are worth beyond its stat lines, per side: the audit gross minus the value of its positive lines
 * goes to its value rules, the audit price minus its negative lines to its penalty rules (PASSIVE_RULES `penalty`).
 */
function unmodelled(gross: number, price: number, mods: readonly PassiveMod[], rules: PassiveNode['rules']): Sides {
  const out: Sides = { offence: 0, defence: 0, utility: 0 };
  if (!rules.length) return out;
  const plus = ledgerUnits(mods.filter((m) => m.value > 0)) ?? 0;
  const minus = ledgerUnits(mods.filter((m) => m.value < 0)) ?? 0;
  const values = rules.filter((r) => !PASSIVE_RULES[r.id].penalty).map((r) => PASSIVE_RULES[r.id].side);
  const penalties = rules.filter((r) => PASSIVE_RULES[r.id].penalty).map((r) => PASSIVE_RULES[r.id].side);
  const value = values.length ? Math.max(0, gross - plus) : 0;
  const cost = Math.max(0, price - minus);
  for (const side of values) out[side] += value / values.length;
  const payers = penalties.length ? penalties : [values[0] ?? 'offence'];
  for (const side of payers) out[side] -= cost / payers.length;
  return out;
}

const UTILITY_STATS: ReadonlySet<StatId> = new Set<StatId>(['moveSpeed', 'pickupRadius', 'maxFocus', 'focusRegen', 'focusOnKill', 'int']);

const TYPES = ['fire', 'cold', 'lightning', 'void', 'physical'] as const;
const TYPE_STAT: Record<(typeof TYPES)[number], StatId> = { fire: 'fireDamage', cold: 'coldDamage', lightning: 'lightningDamage', void: 'voidDamage', physical: 'physicalDamage' };
const PEN_STAT: Record<(typeof TYPES)[number], StatId> = { fire: 'firePen', cold: 'coldPen', lightning: 'lightningPen', void: 'voidPen', physical: 'physicalPen' };

export interface PowerIndex { offence: number; defence: number; utility: number; index: number }

export function powerIndex(build: Build, ml = 60): PowerIndex {
  const r = resolvePassives(build.ids, build.masteries);
  const sum = (stat: StatId, mode: StatModifier['mode']) => r.mods.filter((m) => m.stat === stat && m.mode === mode).reduce((s, m) => s + m.value, 0);
  const prod = (stat: StatId) => r.mods.filter((m) => m.stat === stat && m.mode === 'more').reduce((p, m) => p * (1 + m.value / 100), 1);
  const B = referenceIncreased(ml);
  const cast = 1 + ((LEDGER_RATES.castSpeed?.increased ?? 1) * sum('castSpeed', 'increased')) / 100;
  const cooldown = (1 + sum('cooldownRecovery', 'increased') / 200) * prod('cooldownRecovery') ** 0.5;
  const crit = 1 + sum('critChance', 'increased') / 600 + sum('critMultiplier', 'flat') / 400;
  const area = (1 + sum('area', 'increased') / 700) * prod('area') ** (1 / 7);
  // A build plays one damage type, either as hits (projectile and area scaling count half each) or as damage over time (full).
  const hitInc = (sum('projectileDamage', 'increased') + sum('areaDamage', 'increased')) / 2;
  const hitMore = Math.sqrt(prod('projectileDamage') * prod('areaDamage'));
  let best = 0;
  for (const t of TYPES) {
    const elemental = t === 'fire' || t === 'cold' || t === 'lightning' ? sum('elementalDamage', 'increased') : 0;
    const typeInc = sum('spellDamage', 'increased') + sum(TYPE_STAT[t], 'increased') + elemental;
    const typeMore = prod('spellDamage') * prod(TYPE_STAT[t]);
    const pen = 1 + sum(PEN_STAT[t], 'flat') / 220;
    const hit = ((1 + B + (typeInc + hitInc) / 100) / (1 + B)) * typeMore * hitMore * cast * crit * area;
    const dot = ((1 + B + (typeInc + sum('damageOverTime', 'increased')) / 100) / (1 + B)) * typeMore * prod('damageOverTime') * cast;
    best = Math.max(best, Math.max(hit, dot) * pen * cooldown);
  }
  // Defence: effective health against the reference build's own layers, so stacking one layer has diminishing returns like
  // stacking increased damage (life ~ +100% from gear and Strength, armour and evasion ~ +300%, each element's resistance separate).
  const life = ((2 + sum('maxLife', 'increased') / 100) / 2) * (1 + (sum('maxLife', 'flat') / 25) / 100) * prod('maxLife') ** 0.5;
  // Armour and evasion are two halves of one layer: losing one ("your evasion rating is zero") is its ledger price, not a wall.
  const plateMore = r.mods.filter((m) => (m.stat === 'armor' || m.stat === 'evasion') && m.mode === 'more').reduce((s, m) => s + unitsOf(m), 0);
  const plate = ((4 + (sum('armor', 'increased') + sum('evasion', 'increased')) / 200) / 4) * Math.max(0.2, 1 + plateMore / 100);
  const allRes = sum('allRes', 'flat');
  const resUnits = (['fireRes', 'coldRes', 'lightningRes', 'voidRes'] as StatId[])
    .reduce((s, stat) => s + (sum(stat, 'flat') + allRes) / 2.5, 0) / 4;
  const resist = 1 + (resUnits + sum('maxResistance', 'flat')) / 100;
  let defUnits = 0;
  for (const m of r.mods) {
    if (!DEFENCE_STATS.has(m.stat) || ['maxLife', 'armor', 'evasion', 'fireRes', 'coldRes', 'lightningRes', 'voidRes', 'allRes', 'maxResistance'].includes(m.stat)) continue;
    defUnits += unitsOf(m);
  }
  let utilUnits = 0;
  for (const m of r.mods) if (UTILITY_STATS.has(m.stat)) utilUnits += unitsOf(m);
  let offU = 0;
  const addSides = (u: Sides) => { offU += u.offence; defUnits += u.defence; utilUnits += u.utility; };
  for (const n of r.nodes) {
    addSides(unmodelled(n.audit.gross, n.audit.price, n.mods, n.rules));
    const pick = n.choices ? build.masteries[n.id] : undefined;
    if (n.choices && pick !== undefined) {
      const c = n.choices[pick];
      addSides(unmodelled(c.audit.gross, c.audit.price, c.mods, c.rules));
    }
  }
  const offence = best * Math.max(0.2, 1 + offU / 100);
  const defence = life * plate * resist * Math.max(0.2, 1 + defUnits / 100);
  const utility = Math.max(0.2, 1 + utilUnits / 100);
  return { offence, defence, utility, index: offence * defence * utility };
}

/** A deterministic population of random builds. */
export function randomPopulation(n: number, seed = 0x0ae1): Build[] {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => randomBuild(rng));
}

/** The best rider of a mastery for the index (ties: the first). */
function bestRider(node: PassiveNode, ids: readonly string[], masteries: Record<string, number>, ml: number): number {
  let best = 0;
  let bestValue = -Infinity;
  for (let c = 0; c < MASTERY_CHOICES; c++) {
    const v = powerIndex({ ids, masteries: { ...masteries, [node.id]: c } }, ml).index;
    if (v > bestValue) { bestValue = v; best = c; }
  }
  return best;
}

/**
 * A greedy "best archetype" stand-in (the archetype presets are B1's): repeatedly allocate the cheapest path to the node whose path
 * gains the most index per point, with the best mastery riders, until the points run out.
 */
export function greedyBuild(ml = 60, points = passivePointsEarned(80, 6)): Build {
  let ids: string[] = [];
  let masteries: Record<string, number> = {};
  let left = points;
  for (;;) {
    const chosen = new Set(ids);
    const paths = cheapestPaths(chosen);
    const base = powerIndex({ ids, masteries }, ml).index;
    let bestGain = -Infinity;
    let bestPath: string[] = [];
    let bestMasteries = masteries;
    for (const n of PASSIVE_NODES) {
      const cost = paths.cost.get(n.id);
      if (chosen.has(n.id) || n.id === PASSIVE_START_ID || cost === undefined || cost === 0 || cost > left) continue;
      const path = pathTo(n.id, paths, chosen);
      if (!pathClean(path, chosen)) continue;
      const next = [...ids, ...path];
      let m = masteries;
      for (const id of path) {
        const node = findPassiveNode(id)!;
        if (node.kind === 'mastery') m = { ...m, [id]: bestRider(node, next, m, ml) };
      }
      const gain = (powerIndex({ ids: next, masteries: m }, ml).index - base) / cost;
      if (gain > bestGain) { bestGain = gain; bestPath = path; bestMasteries = m; }
    }
    if (!bestPath.length) break;
    ids = [...ids, ...bestPath];
    masteries = bestMasteries;
    left -= bestPath.reduce((s, id) => s + findPassiveNode(id)!.cost, 0);
  }
  return { ids: PASSIVE_NODES.filter((n) => ids.includes(n.id)).map((n) => n.id), masteries };
}

export function percentile(sorted: readonly number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

export interface BotReport {
  ml: number;
  builds: number;
  p5: number;
  p50: number;
  p95: number;
  spread: number;
  best: number;
  medianOfBest: number;
  /** Share of the top-5% builds holding each node, and of all builds. */
  topShare: Map<string, number>;
  allShare: Map<string, number>;
}

/** `topFraction`: the share of builds counted as "the top" (5% in the design; a small population needs more for a stable sample). */
export function botReport(population: readonly Build[], ml: number, best = greedyBuild(ml), topFraction = 0.05): BotReport {
  const scored = population.map((b) => ({ b, v: powerIndex(b, ml).index })).sort((x, y) => x.v - y.v);
  const values = scored.map((s) => s.v);
  const top = scored.slice(Math.floor(scored.length * (1 - topFraction)));
  const share = (list: readonly { b: Build }[]) => {
    const m = new Map<string, number>();
    for (const { b } of list) for (const id of b.ids) m.set(id, (m.get(id) ?? 0) + 1 / list.length);
    return m;
  };
  const bestValue = Math.max(powerIndex(best, ml).index, values[values.length - 1]);
  return {
    ml, builds: population.length, p5: percentile(values, 0.05), p50: percentile(values, 0.5), p95: percentile(values, 0.95),
    spread: percentile(values, 0.95) / percentile(values, 0.05), best: bestValue, medianOfBest: percentile(values, 0.5) / bestValue,
    topShare: share(top), allShare: share(scored),
  };
}
