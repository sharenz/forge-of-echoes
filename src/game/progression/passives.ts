// The Orrery's rules (docs/power-rework/passive-tree.md): points, allocation, refunds, masteries, Boss Marks and the one resolver
// that turns an allocation into labelled StatModifiers under the tree's hard caps. Pure functions over CharacterSave.passives,
// .masteries and .bossMarks (per character; the Atlas tree is account storage and never shares a field, an id or a counter).
import type { Result, RunSetup } from '../../contracts/game';
import type { CharacterSave, StatId, StatModifier } from '../../contracts/items';
import type { PassiveNodeId, PassiveRefundPrice } from '../../contracts/passives';
import { MASTERY_CHOICES, ORRERY_SOURCE } from '../../contracts/passives';
import { THEME_ROSTER } from '../../contracts/bestiary';
import {
  BOSS_MARK_KINDS, ORRERY_CAPS, ORRERY_DAMAGE_STATS, PASSIVE_NODES, PASSIVE_POINTS, PASSIVE_RESPEC, PASSIVE_START_ID, findPassiveNode, isPassiveNodeId,
  nextPassivePointLevel, passiveNodeOrder, passivePointsEarned, passiveRefundBase,
  type PassiveMod, type PassiveNode, type PassiveRule,
} from '../../data/progression/passives';
import { findAtlasArea } from '../../data/progression/atlas';
import { spendCurrency } from './merchant';
import { fail, ok } from './util';

// ---------------------------------------------------------------------------------------------
// Points
// ---------------------------------------------------------------------------------------------

export interface PassivePoints {
  earned: number;
  spent: number;
  free: number;
  bossMarks: number;
  /** The next level that grants a point (null at the cap). */
  nextLevel: number | null;
}

export function passiveSpent(ids: readonly string[] = []): number {
  return ids.reduce((n, id) => n + (findPassiveNode(id)?.cost ?? 0), 0);
}

export function passivePoints(ch: Pick<CharacterSave, 'level' | 'passives' | 'bossMarks'>): PassivePoints {
  const bossMarks = ch.bossMarks?.length ?? 0;
  const earned = passivePointsEarned(ch.level, bossMarks);
  const spent = passiveSpent(ch.passives);
  return { earned, spent, free: Math.max(0, earned - spent), bossMarks, nextLevel: nextPassivePointLevel(ch.level) };
}

// ---------------------------------------------------------------------------------------------
// Graph questions
// ---------------------------------------------------------------------------------------------

/** Every node of `selected` is reachable from Spark through selected nodes. */
export function passiveConnected(selected: ReadonlySet<string>): boolean {
  const seen = new Set<string>([PASSIVE_START_ID]);
  const stack: string[] = [PASSIVE_START_ID];
  while (stack.length) {
    for (const l of findPassiveNode(stack.pop())?.links ?? []) if (selected.has(l) && !seen.has(l)) { seen.add(l); stack.push(l); }
  }
  for (const id of selected) if (!seen.has(id)) return false;
  return true;
}

/** An allocated node `node` would clash with (a hard exclusion in either direction). */
export function passiveExclusion(node: PassiveNode, selected: ReadonlySet<string>): PassiveNode | undefined {
  for (const id of selected) {
    const other = findPassiveNode(id);
    if (other && (node.excludes.includes(other.id) || other.excludes.includes(node.id))) return other;
  }
  return undefined;
}

/** Whether `node` touches Spark or an allocated node. */
export function passiveAdjacent(node: PassiveNode, selected: ReadonlySet<string>): boolean {
  return node.links.some((l) => l === PASSIVE_START_ID || selected.has(l));
}

/**
 * A stored allocation back to a valid one, in canonical order: unknown ids, Spark, nodes that do not connect to Spark, the later of
 * two exclusive nodes and anything beyond `points` are dropped (growing from Spark in canonical order).
 */
export function normalizePassives(raw: unknown, points: number): PassiveNodeId[] {
  const input = new Set((Array.isArray(raw) ? raw : []).filter((id): id is PassiveNodeId => isPassiveNodeId(id) && id !== PASSIVE_START_ID));
  const kept = new Set<string>();
  let spent = 0;
  for (let changed = true; changed;) {
    changed = false;
    for (const node of PASSIVE_NODES) {
      if (!input.has(node.id) || kept.has(node.id)) continue;
      if (spent + node.cost > points || passiveExclusion(node, kept) || !passiveAdjacent(node, kept)) continue;
      kept.add(node.id);
      spent += node.cost;
      changed = true;
    }
  }
  return PASSIVE_NODES.filter((n) => kept.has(n.id)).map((n) => n.id);
}

/** Mastery choices of allocated masteries only, each 0 to MASTERY_CHOICES − 1. */
export function normalizeMasteries(raw: unknown, allocated: readonly string[]): Partial<Record<PassiveNodeId, number>> {
  const out: Partial<Record<PassiveNodeId, number>> = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const node = findPassiveNode(id);
    if (!node || node.kind !== 'mastery' || !allocated.includes(node.id)) continue;
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < MASTERY_CHOICES) out[node.id] = v;
  }
  return out;
}

/** Known final bosses, each once, in BOSS_MARK_KINDS order. */
export function normalizeBossMarks(raw: unknown): string[] {
  const have = new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []);
  return BOSS_MARK_KINDS.filter((b) => have.has(b));
}

// ---------------------------------------------------------------------------------------------
// Allocation, refunds, masteries
// ---------------------------------------------------------------------------------------------

const pointsWord = (n: number) => `${n} passive point${n === 1 ? '' : 's'}`;

export function passiveAllocateError(ch: CharacterSave, id: unknown): string | null {
  const node = findPassiveNode(id);
  if (!node) return 'Choose a node on the Orrery.';
  if (node.id === PASSIVE_START_ID) return 'Spark is always lit: it needs no point.';
  const selected = new Set<string>(ch.passives ?? []);
  if (selected.has(node.id)) return 'That node is already allocated.';
  const clash = passiveExclusion(node, selected);
  if (clash) return `${node.name} excludes ${clash.name}. Refund ${clash.name} first.`;
  if (!passiveAdjacent(node, selected)) return `Connect ${node.name} to your allocated path first.`;
  const { free, earned } = passivePoints(ch);
  if (node.cost > free) {
    return free === 0 && earned >= PASSIVE_POINTS.total
      ? 'Every passive point is allocated. Refund a node to choose another path.'
      : `${node.name} costs ${pointsWord(node.cost)}; you have ${free}. Gain levels and Boss Marks to earn more.`;
  }
  return null;
}

/** Spend points on one node (anywhere; it takes effect at once). Pure. */
export function allocatePassive(ch: CharacterSave, id: PassiveNodeId): Result<CharacterSave> {
  const error = passiveAllocateError(ch, id);
  if (error) return fail(error);
  const next = new Set<string>([...(ch.passives ?? []), id]);
  return ok({ ...ch, passives: PASSIVE_NODES.filter((n) => next.has(n.id)).map((n) => n.id) });
}

/** Scrap a refund or mastery change costs now: free for the character's first PASSIVE_RESPEC.freeRefunds, never above the session cap. */
function respecPrice(ch: CharacterSave, base: number): PassiveRefundPrice {
  const used = ch.passiveRefunds ?? 0;
  const freeLeft = Math.max(0, PASSIVE_RESPEC.freeRefunds - used);
  if (freeLeft > 0) return { scrap: 0, freeLeft };
  return { scrap: Math.max(0, Math.min(base, PASSIVE_RESPEC.sessionCap - (ch.passiveRespecSpent ?? 0))), freeLeft: 0 };
}

/** What refunding `id` costs right now (the price of its kind before the free refunds and the session cap). */
export function passiveRefundPrice(ch: CharacterSave, id: PassiveNodeId): PassiveRefundPrice {
  const node = findPassiveNode(id);
  return respecPrice(ch, node ? passiveRefundBase(node.kind) : 0);
}

/** What changing the rider of an allocated mastery costs right now (the first choice is free and is not a change). */
export function masteryChangePrice(ch: CharacterSave, id: PassiveNodeId): PassiveRefundPrice {
  if (ch.masteries?.[id] === undefined) return { scrap: 0, freeLeft: Math.max(0, PASSIVE_RESPEC.freeRefunds - (ch.passiveRefunds ?? 0)) };
  return respecPrice(ch, PASSIVE_RESPEC.masteryChange);
}

export function passiveRefundError(ch: CharacterSave, id: unknown): string | null {
  const node = findPassiveNode(id);
  if (!node) return 'Choose a node on the Orrery.';
  if (node.id === PASSIVE_START_ID) return 'Spark cannot be refunded.';
  const selected = new Set<string>(ch.passives ?? []);
  if (!selected.has(node.id)) return 'That node is not allocated.';
  selected.delete(node.id);
  if (!passiveConnected(selected)) return 'Refund the nodes beyond this one first.';
  const { scrap } = passiveRefundPrice(ch, node.id);
  if (scrap > 0 && !spendCurrency(ch, 'scrap', scrap)) return `Refunding ${node.name} costs ${scrap} Forge Scrap.`;
  return null;
}

/** Bookkeeping of one paid (or free) refund or mastery change. */
function charged(ch: CharacterSave, scrap: number): CharacterSave | null {
  const paid = scrap > 0 ? spendCurrency(ch, 'scrap', scrap) : ch;
  if (!paid) return null;
  return { ...paid, passiveRefunds: (ch.passiveRefunds ?? 0) + 1, passiveRespecSpent: (ch.passiveRespecSpent ?? 0) + scrap };
}

/** Refund one leaf node; its point comes back and the Scrap is paid in the same value (atomic). Pure. */
export function refundPassive(ch: CharacterSave, id: PassiveNodeId): Result<CharacterSave> {
  const error = passiveRefundError(ch, id);
  if (error) return fail(error);
  const next = charged(ch, passiveRefundPrice(ch, id).scrap);
  if (!next) return fail('Not enough Forge Scrap.');
  const passives = (ch.passives ?? []).filter((n) => n !== id);
  const { [id]: _dropped, ...masteries } = ch.masteries ?? {};
  return ok({ ...next, passives, masteries });
}

export function masteryChoiceError(ch: CharacterSave, id: unknown, choice: unknown): string | null {
  const node = findPassiveNode(id);
  if (!node || node.kind !== 'mastery') return 'Choose a mastery on the Orrery.';
  if (!(ch.passives ?? []).includes(node.id)) return `Allocate ${node.name} first.`;
  if (typeof choice !== 'number' || !Number.isInteger(choice) || choice < 0 || choice >= MASTERY_CHOICES) return 'Choose one of the three riders.';
  if (ch.masteries?.[node.id] === choice) return 'That rider is already chosen.';
  const { scrap } = masteryChangePrice(ch, node.id);
  if (scrap > 0 && !spendCurrency(ch, 'scrap', scrap)) return `Changing ${node.name} costs ${scrap} Forge Scrap.`;
  return null;
}

/** Choose (free) or change (a refund: free while free refunds last, then Scrap) the rider of an allocated mastery. Pure. */
export function chooseMastery(ch: CharacterSave, id: PassiveNodeId, choice: number): Result<CharacterSave> {
  const error = masteryChoiceError(ch, id, choice);
  if (error) return fail(error);
  const change = ch.masteries?.[id] !== undefined;
  const next = change ? charged(ch, masteryChangePrice(ch, id).scrap) : ch;
  if (!next) return fail('Not enough Forge Scrap.');
  return ok({ ...next, masteries: { ...(ch.masteries ?? {}), [id]: choice } });
}

/** A new respec session (a map was opened): the session's Scrap cap starts over. */
export function resetPassiveSession(ch: CharacterSave): CharacterSave {
  return ch.passiveRespecSpent ? { ...ch, passiveRespecSpent: 0 } : ch;
}

// ---------------------------------------------------------------------------------------------
// Boss Marks (4)
// ---------------------------------------------------------------------------------------------

/** The final boss whose defeat closes this expedition (null on a boss-less area). */
export function bossMarkKindFor(setup: Pick<RunSetup, 'atlasAreaId' | 'map'>): string | null {
  const area = findAtlasArea(setup.atlasAreaId);
  if (area?.noBoss) return null;
  const theme = area?.baseId ?? setup.map.baseId;
  const boss = (THEME_ROSTER as Record<string, { boss: string } | undefined>)[theme]?.boss;
  return boss && BOSS_MARK_KINDS.includes(boss) ? boss : null;
}

/**
 * Migration (build-plan.md 5): a character from before the Orrery has no `bossMarks`; it is credited once with the distinct final
 * bosses of its account's Atlas first-kill set. A character that has the field (new or already migrated) is returned unchanged.
 */
export function seedBossMarks(ch: CharacterSave): CharacterSave {
  if (ch.bossMarks !== undefined) return ch;
  return { ...ch, bossMarks: normalizeBossMarks(ch.atlas?.bossesSeen) };
}

// ---------------------------------------------------------------------------------------------
// The resolver (1.3, 8)
// ---------------------------------------------------------------------------------------------

export interface PassiveCapLine {
  id: keyof typeof ORRERY_CAPS | `penetration:${string}` | `resistance:${string}`;
  label: string;
  /** What the allocated nodes add up to before the cap (a product for `moreDamage` / `damageTakenFloor`). */
  total: number;
  cap: number;
  capped: boolean;
}

export interface ResolvedRule extends PassiveRule {
  source: string;
}

export interface ResolvedPassives {
  /** Allocated nodes in canonical order, Spark first when anything is allocated. */
  nodes: PassiveNode[];
  /** Every stat line after the caps, labelled "Orrery: <node>" (smalls: "Orrery: small nodes"). */
  mods: StatModifier[];
  /** Structural rules (PASSIVE_RULES tells which are live). */
  rules: ResolvedRule[];
  caps: PassiveCapLine[];
}

interface Entry { stat: StatId; mode: StatModifier['mode']; value: number; source: string; small: boolean }

const SMALL_SOURCE = `${ORRERY_SOURCE}: small nodes`;
const RESIST_STATS: readonly StatId[] = ['fireRes', 'coldRes', 'lightningRes', 'voidRes'];
const PEN_STATS: readonly StatId[] = ['firePen', 'coldPen', 'lightningPen', 'voidPen', 'physicalPen', 'elementalPen'];

const round4 = (v: number) => Math.round(v * 1e4) / 1e4;
const floor4 = (v: number) => Math.floor(v * 1e4 + 1e-7) / 1e4;
const ceil4 = (v: number) => Math.ceil(v * 1e4 - 1e-7) / 1e4;

/** Scale the positive values of the matching entries so their sum is at most `cap`. */
function capSum(entries: Entry[], match: (e: Entry) => boolean, cap: number, id: PassiveCapLine['id'], label: string, out: PassiveCapLine[]): void {
  const hit = entries.filter((e) => match(e) && e.value > 0);
  const total = hit.reduce((s, e) => s + e.value, 0);
  if (!hit.length) return;
  const capped = total > cap + 1e-9;
  if (capped) for (const e of hit) e.value = floor4((e.value * cap) / total);
  out.push({ id, label, total: round4(total), cap, capped });
}

/** Scale `more` factors in log space so their product stays on the right side of `bound`. */
function capProduct(entries: Entry[], match: (e: Entry) => boolean, bound: number, upper: boolean, id: PassiveCapLine['id'], label: string, out: PassiveCapLine[]): void {
  const hit = entries.filter((e) => match(e) && (upper ? e.value > 0 : e.value < 0));
  if (!hit.length) return;
  const product = hit.reduce((p, e) => p * (1 + e.value / 100), 1);
  const capped = upper ? product > bound + 1e-9 : product < bound - 1e-9;
  if (capped) {
    const k = Math.log(bound) / Math.log(product);
    // Rounded towards zero, so the product never crosses the bound.
    for (const e of hit) e.value = (upper ? floor4 : ceil4)(((1 + e.value / 100) ** k - 1) * 100);
  }
  out.push({ id, label, total: round4(product), cap: bound, capped });
}

/** Resolve an allocation: the stat lines of every node and chosen mastery rider, under the tree's caps (passive-tree.md 1.3). */
export function resolvePassives(ids: readonly string[] = [], masteries: Partial<Record<string, number>> = {}): ResolvedPassives {
  const set = new Set(ids.filter((id) => id !== PASSIVE_START_ID));
  const nodes = set.size ? PASSIVE_NODES.filter((n) => n.id === PASSIVE_START_ID || set.has(n.id)) : [];
  const entries: Entry[] = [];
  const rules: ResolvedRule[] = [];
  const push = (mods: readonly PassiveMod[], ruleList: readonly PassiveRule[], source: string, small: boolean) => {
    for (const m of mods) entries.push({ stat: m.stat, mode: m.mode, value: m.value, source, small });
    for (const r of ruleList) rules.push({ ...r, source });
  };
  for (const n of nodes) {
    const source = `${ORRERY_SOURCE}: ${n.name}`;
    push(n.mods, n.rules, n.kind === 'small' ? SMALL_SOURCE : source, n.kind === 'small');
    const pick = n.choices ? masteries[n.id] : undefined;
    if (n.choices && pick !== undefined && n.choices[pick]) push(n.choices[pick].mods, n.choices[pick].rules, source, false);
  }

  const caps: PassiveCapLine[] = [];
  const is = (stat: StatId, mode: StatModifier['mode']) => (e: Entry) => e.stat === stat && e.mode === mode;
  capSum(entries, (e) => e.mode === 'increased' && ORRERY_DAMAGE_STATS.includes(e.stat), ORRERY_CAPS.increasedDamage, 'increasedDamage', 'Increased damage', caps);
  capProduct(entries, (e) => e.mode === 'more' && ORRERY_DAMAGE_STATS.includes(e.stat), ORRERY_CAPS.moreDamage, true, 'moreDamage', 'More damage', caps);
  const tempo = set.has('pas.hub.perfectTempo') ? ORRERY_CAPS.castSpeedPerfectTempo : 0;
  capSum(entries, is('castSpeed', 'increased'), ORRERY_CAPS.castSpeed + tempo, 'castSpeed', 'Increased cast speed', caps);
  capSum(entries, is('critChance', 'increased'), ORRERY_CAPS.critChance, 'critChance', 'Increased critical strike chance', caps);
  capSum(entries, is('critMultiplier', 'flat'), ORRERY_CAPS.critMultiplier, 'critMultiplier', 'Critical strike multiplier', caps);
  for (const stat of PEN_STATS) capSum(entries, is(stat, 'flat'), ORRERY_CAPS.penetration, `penetration:${stat}`, `${stat.replace('Pen', '')} penetration`, caps);
  capSum(entries, is('area', 'increased'), ORRERY_CAPS.area, 'area', 'Increased area', caps);
  capSum(entries, is('extraProjectiles', 'flat'), ORRERY_CAPS.extraProjectiles, 'extraProjectiles', 'Extra projectiles', caps);
  capSum(entries, is('moveSpeed', 'increased'), ORRERY_CAPS.moveSpeed, 'moveSpeed', 'Movement speed', caps);
  capSum(entries, is('maxLife', 'increased'), ORRERY_CAPS.maxLife, 'maxLife', 'Increased maximum life', caps);
  capSum(entries, is('armor', 'increased'), ORRERY_CAPS.armor, 'armor', 'Increased armour', caps);
  capSum(entries, is('evasion', 'increased'), ORRERY_CAPS.evasion, 'evasion', 'Increased evasion rating', caps);
  capSum(entries, is('allRes', 'flat'), ORRERY_CAPS.resistance, 'resistance:allRes', 'All resistances', caps);
  const allRes = entries.filter(is('allRes', 'flat')).reduce((s, e) => s + e.value, 0);
  for (const stat of RESIST_STATS) {
    capSum(entries, is(stat, 'flat'), Math.max(0, ORRERY_CAPS.resistance - allRes), `resistance:${stat}`, `${stat.replace('Res', '')} resistance`, caps);
  }
  capSum(entries, is('maxResistance', 'flat'), ORRERY_CAPS.maxResistance, 'maxResistance', 'Maximum resistances', caps);
  capSum(entries, is('maxFocus', 'flat'), ORRERY_CAPS.maxFocus, 'maxFocus', 'Maximum Focus', caps);
  capSum(entries, is('focusRegen', 'increased'), ORRERY_CAPS.focusRegen, 'focusRegen', 'Focus regeneration', caps);
  capSum(entries, is('flaskEffect', 'increased'), ORRERY_CAPS.flaskEffect, 'flaskEffect', 'Flask effect', caps);
  capProduct(entries, is('damageTaken', 'more'), ORRERY_CAPS.damageTakenFloor, false, 'damageTakenFloor', 'Damage taken', caps);
  const slots = rules.filter((r) => r.id === 'augmentSlot');
  const slotTotal = slots.reduce((s, r) => s + r.value, 0);
  if (slots.length) {
    caps.push({ id: 'augmentSlots', label: 'Augment slots', total: slotTotal, cap: ORRERY_CAPS.augmentSlots, capped: slotTotal > ORRERY_CAPS.augmentSlots });
    if (slotTotal > ORRERY_CAPS.augmentSlots) for (const r of slots) r.value = (r.value * ORRERY_CAPS.augmentSlots) / slotTotal;
  }

  // Smalls of one stat line merge into one source; named nodes keep their own ("Orrery: Kindle").
  const mods: StatModifier[] = [];
  const merged = new Map<string, StatModifier>();
  for (const e of entries) {
    if (e.value === 0) continue;
    if (!e.small) { mods.push({ stat: e.stat, mode: e.mode, value: e.value, source: e.source }); continue; }
    const key = `${e.stat}:${e.mode}`;
    const have = merged.get(key);
    if (have) have.value = round4(have.value + e.value);
    else {
      const m: StatModifier = { stat: e.stat, mode: e.mode, value: e.value, source: SMALL_SOURCE };
      merged.set(key, m);
      mods.push(m);
    }
  }
  return { nodes, mods, rules, caps };
}

const MODS_CACHE = new WeakMap<readonly string[], { masteries: CharacterSave['masteries']; mods: StatModifier[] }>();
const EMPTY: StatModifier[] = [];

/** The Orrery's stat lines for the player model (memoised per allocation array; [] when nothing is allocated). */
export function passiveModifiers(ch: Pick<CharacterSave, 'passives' | 'masteries'>): StatModifier[] {
  const ids = ch.passives;
  if (!ids || ids.length === 0) return EMPTY;
  const hit = MODS_CACHE.get(ids);
  if (hit && hit.masteries === ch.masteries) return hit.mods;
  const mods = resolvePassives(ids, ch.masteries ?? {}).mods;
  MODS_CACHE.set(ids, { masteries: ch.masteries, mods });
  return mods;
}

/** Sort ids into canonical order (allocation lists are stored this way). */
export function sortPassiveIds(ids: Iterable<string>): PassiveNodeId[] {
  return [...new Set(ids)].filter(isPassiveNodeId).sort((a, b) => passiveNodeOrder(a) - passiveNodeOrder(b));
}
