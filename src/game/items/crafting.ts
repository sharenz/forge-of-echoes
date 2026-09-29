import { advancedCraftError, advancedCraftOp, advancedCraftPreview, graftTargetError, isAdvancedEquipmentCurrency, preservesSeals } from './advanced-crafting';
import { nextCraftCount } from './crafting-history';
// The Workbench: every equipment currency with exact GAME_SPEC §6 semantics.
//
// Pipeline for one craft:
//   validate (player-facing reason, nothing consumed on failure or on a craft that would do nothing)
//   → perform the operation with the character rng
//   → pay stability → break seals (every operation except sealing itself)
//   → scar roll (cost > 0 and stability after paying ≤ threshold: 35%, max 2 scars)
//   → history line(s) → Finished at 0 stability → consume one currency → store the rng state.
//
// Bench-crafted affixes (RolledAffix.crafted, src/game/items/bench.ts) are ordinary affixes here — Scrap
// rerolls them, Reforge replaces them, Solvent may remove them, Seal protects them — with two exceptions:
// Fracture Core cannot fracture one, and Tempering Catalyst cannot raise one above T4 (BENCH_BEST_TIER).
import type {
  AffixKind, CharacterSave, CurrencyStack, EquipmentItem, ItemLocation, RolledAffix, RolledScar,
} from '../../contracts/items';
import type { CurrencyId, EQUIPMENT_CURRENCY_IDS } from '../../contracts/content';
import type { CraftOutcome, Result } from '../../contracts/game';
import type { Rng } from '../../contracts/rng';
import { createRng } from '../../core/rng';
import {
  AFFIXES, AFFIX_LIMITS, BENCH_BEST_TIER, CLASS_LABEL, MAGIC_AFFIX_COUNTS, MAX_HISTORY_LINES, MAX_SCARS, RARE_AFFIX_COUNTS,
  SCARS, SCAR_CHANCE, SCAR_THRESHOLD, findBase, findCurrency, getAffix, isMapCurrency,
} from '../../data/items';
import type { AffixDef, AffixLimits, AffixTierDef, BaseDef, CurrencyDef, ScarDef } from '../../data/items';
import {
  affixAllowedOnBase, affixCandidates, affixState, baseHasProperty, eligibleCandidates, inclusionOdds, rollCount,
  rollNewAffixes, rollValue, singlePickOdds, sortAffixes,
} from './affix-pool';
import type { AffixCandidate, CountChance } from './affix-pool';
import {
  capitalize, formatChance, formatDistribution, formatLine, formatSpan, joinDots, joinWords,
} from './format';
import { rollRareName } from './generate';
import { findItem, replaceItemAt, setStackCount } from './inventory';
import type { FoundItem } from './inventory';

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(error: string): Result<T> => ({ ok: false, error });

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

function tierOf(def: AffixDef, tier: number): AffixTierDef | undefined {
  return def.tiers.find((t) => t.tier === tier);
}

/** "Blazing (T4)". */
function affixLabel(a: RolledAffix): string {
  const def = getAffix(a.affixId);
  return def ? `${def.name} (T${a.tier})` : 'an unknown affix';
}

/** Preview label that also marks a bench-crafted affix: "Hale (T4, crafted)". */
function previewLabel(a: RolledAffix): string {
  const def = getAffix(a.affixId);
  if (!def) return 'an unknown affix';
  return a.crafted ? `${def.name} (T${a.tier}, crafted)` : `${def.name} (T${a.tier})`;
}

function affixName(a: RolledAffix): string {
  return getAffix(a.affixId)?.name ?? 'an unknown affix';
}

function isProtected(a: RolledAffix): boolean {
  return !!a.sealed || !!a.fractured;
}

function withoutSeal(a: RolledAffix): RolledAffix {
  if (!a.sealed) return a;
  const { sealed: _s, ...rest } = a;
  return rest;
}

function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a';
}

function scarThreshold(base: BaseDef): number {
  return base.material?.scarThreshold ?? SCAR_THRESHOLD;
}

function eligibleScars(base: BaseDef, current: readonly RolledScar[]): ScarDef[] {
  const owned = new Set(current.map((s) => s.scarId));
  return SCARS.filter((s) => !owned.has(s.id)
    && (!s.classes || s.classes.includes(base.itemClass))
    && (!s.requiresProperty || baseHasProperty(base, s.requiresProperty)));
}

/** Chance that this craft adds a scar (0 when no risk applies). */
export function scarChanceFor(item: EquipmentItem, base: BaseDef, cost: number): number {
  if (cost <= 0) return 0;
  const after = item.stability - cost;
  if (after > scarThreshold(base)) return 0;
  if (item.scars.length >= MAX_SCARS) return 0;
  return eligibleScars(base, item.scars).length ? SCAR_CHANCE : 0;
}

/** Affix limits and resulting rarity when an essence adds one affix. */
function essenceTarget(item: EquipmentItem): { limits: AffixLimits; rarity: EquipmentItem['rarity'] } {
  if (item.rarity === 'normal') return { limits: AFFIX_LIMITS.magic, rarity: 'magic' };
  if (item.rarity === 'magic') {
    return item.affixes.length >= 2
      ? { limits: AFFIX_LIMITS.rare, rarity: 'rare' }
      : { limits: AFFIX_LIMITS.magic, rarity: 'magic' };
  }
  return { limits: AFFIX_LIMITS.rare, rarity: 'rare' };
}

function essencePool(item: EquipmentItem, base: BaseDef, def: CurrencyDef): AffixCandidate[] {
  return affixCandidates(base, item.itemLevel, { tags: def.essenceTags ?? [] });
}

function rerollable(a: RolledAffix): boolean {
  if (isProtected(a)) return false;
  const def = getAffix(a.affixId);
  const tier = def ? tierOf(def, a.tier) : undefined;
  return !!tier && tier.min !== tier.max;
}

function kindCounts(item: EquipmentItem): Record<AffixKind, number> {
  const st = affixState(item.affixes);
  return { prefix: st.prefix, suffix: st.suffix };
}

function runePlan(item: EquipmentItem, base: BaseDef, currencyId: CurrencyId) {
  const kind: AffixKind = currencyId === 'prefixRune' ? 'prefix' : 'suffix';
  const kept = item.affixes.filter(a => isProtected(a) || getAffix(a.affixId)?.kind !== kind);
  const pool = affixCandidates(base, item.itemLevel).filter(c => c.affix.kind === kind);
  const limits = item.rarity === 'magic' ? AFFIX_LIMITS.magic : AFFIX_LIMITS.rare;
  return { kind, kept, pool, limits, count: item.affixes.length - kept.length };
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

export type EquipmentCurrencyId = (typeof EQUIPMENT_CURRENCY_IDS)[number];

/** Why this currency cannot target this specific affix (seal, catalyst, fracture); null if it can. */
export function affixTargetError(item: EquipmentItem, currencyId: CurrencyId, affixIndex: number): string | null {
  // Check the type before indexing: the index comes off the network and may be any value.
  if (!Number.isInteger(affixIndex)) return 'Choose an affix on the item.';
  const a = item.affixes[affixIndex];
  if (!a) return 'Choose an affix on the item.';
  const def = getAffix(a.affixId);
  if (!def) return 'That affix can no longer be crafted.';
  switch (currencyId) {
    case 'graft': return graftTargetError(item, affixIndex);
    case 'catalyst': {
      if (a.fractured) return `${def.name} is fractured and immune to crafting.`;
      if (a.sealed) return `${def.name} is sealed and protected from this craft.`;
      const next = tierOf(def, a.tier - 1);
      if (!next) return `${def.name} is already at its best tier.`;
      if (a.crafted && next.tier < BENCH_BEST_TIER) {
        return `${def.name} is bench-crafted: crafted affixes cannot be raised above T${BENCH_BEST_TIER}.`;
      }
      if (next.itemLevel > item.itemLevel) {
        return `T${next.tier} ${def.name} needs item level ${next.itemLevel} (this item is ${item.itemLevel}).`;
      }
      return null;
    }
    case 'seal': {
      if (a.fractured) return `${def.name} is fractured, which is already permanent.`;
      if (a.sealed) return `${def.name} is already sealed.`;
      if (item.affixes.some((x) => x.sealed)) return 'Only one affix can be sealed at a time.';
      return null;
    }
    case 'fractureCore': {
      if (item.affixes.some((x) => x.fractured)) return 'This item already has a fractured affix.';
      if (a.crafted) return `${def.name} is bench-crafted: crafted affixes cannot be fractured.`;
      return null;
    }
    default:
      return 'This currency does not target a single affix.';
  }
}

/**
 * Why `currencyId` cannot be applied to `item`; null when it can. For affix-choice currencies without
 * an index, null means at least one affix is a valid target.
 */
export function equipmentCraftError(item: EquipmentItem, currencyId: CurrencyId, affixIndex?: number): string | null {
  const def = findCurrency(currencyId);
  if (!def) return 'Unknown currency.';
  if (isMapCurrency(currencyId)) return `${def.name} can only be applied to maps.`;
  const base = findBase(item.baseId);
  if (!base) return 'This item can no longer be crafted.';
  if (currencyId === 'crownFragment') return advancedCraftError(item, currencyId);
  if (item.rarity === 'unique') return 'Only a Crown Fragment can refine Unique items.';
  if (item.stability <= 0 && !preservesSeals(currencyId)) return 'This item is Finished. Repair Stability at the bench to continue.';
  if (item.stability < def.stabilityCost) {
    return `${def.name} needs ${def.stabilityCost} Stability; this item has ${item.stability} left.`;
  }
  if (isAdvancedEquipmentCurrency(currencyId)) return advancedCraftError(item, currencyId, affixIndex);
  const count = item.affixes.length;

  switch (currencyId) {
    case 'kindling': {
      if (item.rarity !== 'normal') return 'Kindling Shard only works on Normal items.';
      if (!affixCandidates(base, item.itemLevel).length) return 'No affix can roll on this item.';
      return null;
    }
    case 'scrap': {
      if (!count) return 'Forge Scrap needs an item with affixes to reroll.';
      if (!item.affixes.some(rerollable)) {
        return 'No affix value can change: sealed, fractured and fixed-value affixes are unaffected.';
      }
      return null;
    }
    case 'reforge': {
      const kept = item.affixes.filter(isProtected);
      if (kept.length === count && count > 0) {
        const room = eligibleCandidates(affixCandidates(base, item.itemLevel), affixState(kept), AFFIX_LIMITS.rare);
        if (!room.length || count >= 6) return 'Nothing to reforge: every affix is protected and there is no room for more.';
      }
      return null;
    }
    case 'prefixRune':
    case 'suffixRune': {
      const { kind, kept, pool, limits, count } = runePlan(item, base, currencyId);
      if (!count) return `No unsealed, unfractured ${kind} to reforge.`;
      const candidates = eligibleCandidates(pool, affixState(kept), limits);
      if (new Set(candidates.map(c => c.affix.group)).size < count) return `Not enough ${kind} families can roll at this item level.`;
      return null;
    }
    case 'essenceEmber':
    case 'essenceRime':
    case 'essenceStorm':
    case 'essenceVital':
    case 'essenceSwift': {
      const label = def.essenceLabel ?? 'matching';
      const pool = essencePool(item, base, def);
      if (!pool.length) {
        const anyLevel = AFFIXES.some((a) => affixAllowedOnBase(a, base) && a.tags.some((t) => def.essenceTags?.includes(t)));
        return anyLevel
          ? `No ${label} affix can roll at item level ${item.itemLevel}.`
          : `No ${label} affix can roll on ${article(CLASS_LABEL[base.itemClass])} ${CLASS_LABEL[base.itemClass]}.`;
      }
      const { limits } = essenceTarget(item);
      const st = affixState(item.affixes);
      if (eligibleCandidates(pool, st, limits).length) return null;
      const notPresent = pool.filter((c) => !st.groups.has(c.affix.group));
      if (!notPresent.length) return `Every ${label} affix this item can roll is already on it.`;
      const kinds = [...new Set(notPresent.map((c) => c.affix.kind))];
      const c = kindCounts(item);
      const what = kinds.length === 1 ? `${kinds[0]}es` : 'prefixes or suffixes';
      return `No room for another ${label} affix: ${what} are full (${c.prefix}/${limits.prefix} prefixes, ${c.suffix}/${limits.suffix} suffixes).`;
    }
    case 'catalyst':
    case 'seal':
    case 'fractureCore': {
      if (!count) return `${def.name} needs an item with affixes.`;
      if (affixIndex !== undefined) return affixTargetError(item, currencyId, affixIndex);
      if (item.affixes.some((_, i) => affixTargetError(item, currencyId, i) === null)) return null;
      if (currencyId === 'catalyst') return 'No affix on this item can be upgraded further.';
      if (currencyId === 'fractureCore') {
        return item.affixes.some((a) => a.fractured)
          ? 'This item already has a fractured affix.'
          : 'Crafted affixes cannot be fractured, and this item has no other affix.';
      }
      if (item.affixes.some((a) => a.sealed)) return 'An affix is already sealed. Only one seal at a time.';
      return 'Fractured affixes are already permanent and cannot be sealed.';
    }
    case 'solvent': {
      if (!count) return 'Forge Solvent needs an item with affixes.';
      if (!item.affixes.some((a) => !isProtected(a))) return 'No affix can be removed: sealed and fractured affixes are protected.';
      return null;
    }
    default:
      return `${def.name} cannot be applied to equipment.`;
  }
}

interface Resolved {
  currency: FoundItem & { item: CurrencyStack };
  target: FoundItem & { item: EquipmentItem };
  def: CurrencyDef;
}

function resolve(ch: CharacterSave, currencyUid: string, targetUid: string): Resolved | string {
  const currency = findItem(ch, currencyUid);
  if (!currency || currency.item.kind !== 'currency' || currency.item.count <= 0) return 'That currency is no longer available.';
  const def = findCurrency(currency.item.currencyId);
  if (!def) return 'Unknown currency.';
  if (currencyUid === targetUid) return `Choose an item to apply ${def.name} to.`;
  const target = findItem(ch, targetUid);
  if (!target) return 'That item no longer exists.';
  if (isMapCurrency(currency.item.currencyId)) {
    return target.item.kind === 'map' ? `${def.name} is applied by the map rules.` : `${def.name} can only be applied to maps.`;
  }
  if (target.item.kind !== 'equipment') return `${def.name} can only be applied to equipment.`;
  if (def.id === 'transmute' && target.location.kind === 'equipment') return 'Unequip this item before changing its base with Transmute.';
  return {
    currency: currency as Resolved['currency'],
    target: target as Resolved['target'],
    def,
  };
}

/** Player-facing reason why the currency cannot be applied to the target, or null. */
export function craftingTargetError(ch: CharacterSave, currencyUid: string, targetUid: string): string | null {
  const r = resolve(ch, currencyUid, targetUid);
  if (typeof r === 'string') return r;
  return equipmentCraftError(r.target.item, r.def.id);
}

// ---------------------------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------------------------

interface OpResult {
  item: EquipmentItem;
  /** History line, past tense: "Ember Essence added Blazing (T4)". */
  line: string;
  /** Index of the affix the operation itself targeted (its own seal is not reported as "held"). */
  targetIndex?: number;
}

function performOp(item: EquipmentItem, base: BaseDef, def: CurrencyDef, rng: Rng, affixIndex?: number): OpResult {
  if (isAdvancedEquipmentCurrency(def.id)) return advancedCraftOp(item, def.id, rng, affixIndex);
  switch (def.id) {
    case 'prefixRune':
    case 'suffixRune': {
      const { kind, kept, pool, limits, count } = runePlan(item, base, def.id);
      const added = rollNewAffixes(rng, pool, kept, limits, count);
      return { item: { ...item, affixes: sortAffixes([...kept, ...added]) },
        line: `${def.name} reforged ${count} ${kind}${count === 1 ? '' : 'es'}, preserving the other side` };
    }
    case 'kindling': {
      const count = rollCount(rng, MAGIC_AFFIX_COUNTS);
      const added = rollNewAffixes(rng, affixCandidates(base, item.itemLevel), [], AFFIX_LIMITS.magic, count);
      return {
        item: { ...item, rarity: 'magic', name: null, affixes: sortAffixes(added) },
        line: `${def.name} awakened ${joinWords(added.map(affixLabel))}`,
      };
    }
    case 'scrap': {
      let n = 0;
      const affixes = item.affixes.map((a) => {
        if (!rerollable(a)) return a;
        const tier = tierOf(getAffix(a.affixId)!, a.tier)!;
        n++;
        return { ...a, value: rollValue(rng, tier.min, tier.max) };
      });
      return { item: { ...item, affixes }, line: `${def.name} rerolled ${n} value${n === 1 ? '' : 's'}` };
    }
    case 'reforge': {
      const kept = item.affixes.filter(isProtected);
      const target = rollCount(rng, RARE_AFFIX_COUNTS);
      const added = rollNewAffixes(
        rng, affixCandidates(base, item.itemLevel), kept, AFFIX_LIMITS.rare, Math.max(0, target - kept.length),
      );
      const affixes = sortAffixes([...kept, ...added]);
      const name = rollRareName(rng);
      return {
        item: { ...item, rarity: 'rare', name, affixes },
        line: `${def.name} reforged it into ${name}, a Rare with ${affixes.length} affixes`,
      };
    }
    case 'essenceEmber':
    case 'essenceRime':
    case 'essenceStorm':
    case 'essenceVital':
    case 'essenceSwift': {
      const { limits, rarity } = essenceTarget(item);
      const [added] = rollNewAffixes(rng, essencePool(item, base, def), item.affixes, limits, 1);
      const becameRare = rarity === 'rare' && item.rarity !== 'rare';
      return {
        item: {
          ...item,
          rarity,
          name: becameRare ? rollRareName(rng) : item.name,
          affixes: sortAffixes([...item.affixes, added]),
        },
        line: `${def.name} added ${affixLabel(added)}`,
      };
    }
    case 'catalyst': {
      const i = affixIndex!;
      const a = item.affixes[i];
      const adef = getAffix(a.affixId)!;
      const next = tierOf(adef, a.tier - 1)!;
      const affixes = item.affixes.slice();
      affixes[i] = { ...a, tier: next.tier, value: rollValue(rng, next.min, next.max) };
      return { item: { ...item, affixes }, line: `${def.name} raised ${adef.name} to T${next.tier}`, targetIndex: i };
    }
    case 'solvent': {
      const removable = item.affixes.filter((a) => !isProtected(a));
      const worst = Math.max(...removable.map((a) => a.tier));
      const victim = rng.pick(removable.filter((a) => a.tier === worst));
      const affixes = item.affixes.filter((a) => a !== victim);
      const becomesNormal = affixes.length === 0;
      return {
        item: {
          ...item,
          affixes,
          ...(becomesNormal ? { rarity: 'normal' as const, name: null } : {}),
        },
        line: `${def.name} removed ${affixLabel(victim)}${becomesNormal ? '; the item is Normal again' : ''}`,
      };
    }
    case 'seal': {
      const i = affixIndex!;
      const affixes = item.affixes.slice();
      affixes[i] = { ...affixes[i], sealed: true };
      return { item: { ...item, affixes }, line: `${def.name} sealed ${affixName(affixes[i])}`, targetIndex: i };
    }
    case 'fractureCore': {
      const i = affixIndex!;
      const affixes = item.affixes.slice();
      affixes[i] = { ...withoutSeal(affixes[i]), fractured: true };
      return { item: { ...item, affixes }, line: `${def.name} fractured ${affixLabel(affixes[i])}`, targetIndex: i };
    }
    default:
      throw new Error(`performOp: ${def.id} is not an equipment currency`);
  }
}

/** Append history lines, keeping the newest MAX_HISTORY_LINES. */
export function appendHistory(history: readonly string[], lines: readonly string[]): string[] {
  const out = [...history, ...lines];
  return out.length > MAX_HISTORY_LINES ? out.slice(out.length - MAX_HISTORY_LINES) : out;
}

export interface EquipmentCraftResult {
  item: EquipmentItem;
  message: string;
  kind: CraftOutcome['kind'];
}

/**
 * Apply an equipment currency to an item with an rng (no inventory bookkeeping). Validates first;
 * the rng is only advanced on success.
 */
export function craftEquipment(
  item: EquipmentItem, currencyId: CurrencyId, rng: Rng, affixIndex?: number,
): Result<EquipmentCraftResult> {
  const def = findCurrency(currencyId);
  const base = findBase(item.baseId);
  if (!def || !base) return fail('That craft is not possible.');
  if (def.needsAffixChoice && affixIndex === undefined) return fail(`Choose an affix for ${def.name}.`);
  const error = equipmentCraftError(item, currencyId, affixIndex);
  if (error) return fail(error);

  const op = performOp(item, base, def, rng, affixIndex);
  let next: EquipmentItem = { ...op.item, stability: Math.max(0, op.item.stability - def.stabilityCost) };

  // Seals protect for exactly one operation, then break (sealing itself is not that operation).
  let line = op.line;
  if (currencyId !== 'seal' && !preservesSeals(currencyId)) {
    const held = item.affixes
      .map((a, i) => ({ a, i }))
      .filter(({ a, i }) => a.sealed && i !== op.targetIndex)
      .map(({ a }) => affixName(a));
    if (held.length) line += ` (${joinWords(held)} sealed)`;
    next = { ...next, affixes: next.affixes.map(withoutSeal) };
  }

  const lines = [line];
  let scarText: string | null = null;
  const chance = scarChanceFor(item, base, def.stabilityCost);
  if (chance > 0 && rng.chance(chance)) {
    // Transmute can change the item's defence properties. Its new scar must fit the resulting base.
    const scar = rng.weighted(eligibleScars(findBase(next.baseId)!, next.scars), (s) => s.weight);
    if (scar) {
      const value = rollValue(rng, scar.min, scar.max);
      next = { ...next, scars: [...next.scars, { scarId: scar.id, value }] };
      scarText = `${scar.name} (${formatLine(scar, scar.sign * value)})`;
      lines.push(`Scarred: ${scarText}`);
    }
  }
  const finished = next.rarity !== 'unique' && next.stability <= 0;
  if (finished) lines.push('Finished at 0 Stability');
  next = { ...next, craftCount: nextCraftCount(item), history: appendHistory(item.history, lines) };

  let message = line;
  if (scarText) message += ` · Scarred: ${scarText}`;
  if (finished) message += ' · Finished';
  return ok({ item: next, message, kind: scarText ? 'scar' : finished ? 'finished' : 'success' });
}

/**
 * Apply an equipment currency from the character's inventory to an item it owns (backpack, stash or
 * equipped). Consumes one currency, advances rngState, counts the craft in stats.itemsCrafted.
 * Map currencies are rejected here; the map rules handle them.
 */
export function applyEquipmentCurrency(
  ch: CharacterSave, currencyUid: string, targetUid: string, affixIndex?: number,
): Result<CraftOutcome> {
  const r = resolve(ch, currencyUid, targetUid);
  if (typeof r === 'string') return fail(r);
  const rng = createRng(ch.rngState >>> 0);
  const res = craftEquipment(r.target.item, r.def.id, rng, affixIndex);
  if (!res.ok) return res;

  let next = replaceItemAt(ch, r.target.location as ItemLocation, res.value.item);
  const currency = findItem(next, currencyUid)!;
  next = setStackCount(next, currency, (currency.item as CurrencyStack).count - 1);
  next = {
    ...next,
    rngState: rng.state(),
    stats: { ...next.stats, itemsCrafted: (next.stats?.itemsCrafted ?? 0) + 1 },
  };
  return ok({ character: next, message: res.value.message, kind: res.value.kind, targetUid });
}

// ---------------------------------------------------------------------------------------------
// Preview (exact odds)
// ---------------------------------------------------------------------------------------------

export interface OddsEntry {
  label: string;
  chance: number;
}

export interface CraftPreviewData {
  lines: string[];
  /** Mutually exclusive outcomes of the craft (sum to 1), when it picks one of several results. */
  outcomes: OddsEntry[];
  /** Chance each affix is on the item afterwards (Kindling / Reforge), sorted by chance. */
  inclusion: OddsEntry[];
  /** False only when `inclusion` is a sampled estimate (never with the shipped data). */
  inclusionExact: boolean;
  stabilityCost: number;
  stabilityAfter: number;
  scarChance: number;
}

const PREVIEW_TOP = 8;
/** Kindling / Reforge tier-odds lines name at most this many affixes per line. */
const TIER_NAMES_TOP = 3;

/** Compact reason for the catalyst's per-affix preview line; null when the affix can be upgraded. */
function catalystShortReason(item: EquipmentItem, index: number): string | null {
  const a = item.affixes[index];
  const d = getAffix(a.affixId);
  if (!d) return 'cannot be crafted';
  if (a.fractured) return 'fractured';
  if (a.sealed) return 'sealed';
  const next = tierOf(d, a.tier - 1);
  if (!next) return 'already the best tier';
  if (a.crafted && next.tier < BENCH_BEST_TIER) return `crafted affixes stop at T${BENCH_BEST_TIER}`;
  if (next.itemLevel > item.itemLevel) return `T${next.tier} needs item level ${next.itemLevel}`;
  return null;
}

/** "Chance for each affix: Blazing 38% · … · and 8 others at 9% or less". */
function inclusionLine(entries: readonly (OddsEntry & { id: string })[], exact: boolean): string {
  const shown = entries.slice(0, PREVIEW_TOP).map((e) => `${e.label} ${formatChance(e.chance)}`);
  const rest = entries.length - PREVIEW_TOP;
  if (rest > 0) {
    shown.push(`and ${rest} other${rest === 1 ? '' : 's'} at ${formatChance(entries[PREVIEW_TOP].chance)} or less`);
  }
  return `${exact ? 'Chance' : 'Estimated chance'} for each affix: ${joinDots(shown)}`;
}

function inclusionEntries(odds: Map<string, number>): (OddsEntry & { id: string })[] {
  return [...odds.entries()]
    .filter(([, p]) => p > 0)
    .map(([id, p]) => ({ id, label: getAffix(id)?.name ?? id, chance: p }))
    .sort((a, b) => b.chance - a.chance);
}

/** Tier split of one affix at this item level, worst tier first: "T8 43% · T7 34% · T6 23%". */
function tierSplit(cand: AffixCandidate): string {
  const worstFirst = [...cand.tiers].reverse().map((t) => ({ label: `T${t.tier}`, chance: t.weight }));
  return joinDots(formatDistribution(worstFirst));
}

/**
 * Exact tier odds of the affixes a craft can add, one line per distinct split (affixes on the same
 * tier ladder share a line). `nameLimit` shortens long name lists ("Hale, Lucid, Arcane and 4 more").
 */
function tierOddsLines(cands: readonly AffixCandidate[], itemLevel: number, nameLimit = Infinity): string[] {
  if (!cands.length) return [];
  if (cands.every((c) => c.tiers.length === 1)) {
    return [`At item level ${itemLevel} only the lowest tier of each affix can roll.`];
  }
  const groups = new Map<string, string[]>();
  for (const c of cands) {
    const split = tierSplit(c);
    const names = groups.get(split);
    if (names) names.push(c.affix.name);
    else groups.set(split, [c.affix.name]);
  }
  if (groups.size === 1) return [`Tier odds: ${[...groups.keys()][0]}`];
  const lines = ['Tier odds by affix:'];
  for (const [split, names] of groups) {
    const shown = names.length > nameLimit
      ? `${names.slice(0, nameLimit).join(', ')} and ${names.length - nameLimit} more`
      : joinWords(names);
    lines.push(`${shown}: ${split}`);
  }
  return lines;
}

/** Candidates in the order the inclusion line lists them (most likely first). */
function byInclusion(cands: readonly AffixCandidate[], entries: readonly { id: string }[]): AffixCandidate[] {
  const rank = new Map(entries.map((e, i) => [e.id, i]));
  return cands
    .filter((c) => rank.has(c.affix.id))
    .sort((a, b) => rank.get(a.affix.id)! - rank.get(b.affix.id)!);
}

/** Inclusion line + tier-odds lines for crafts that roll several new affixes (Kindling, Reforge). */
function multiRollDetails(
  base: BaseDef, item: EquipmentItem, kept: readonly RolledAffix[], limits: AffixLimits, counts: readonly CountChance[],
): { inclusion: OddsEntry[]; exact: boolean; lines: string[] } {
  const cands = affixCandidates(base, item.itemLevel);
  const odds = inclusionOdds(cands, kept, limits, counts);
  const entries = inclusionEntries(odds.odds);
  const lines = entries.length ? [inclusionLine(entries, odds.exact)] : [];
  lines.push(...tierOddsLines(byInclusion(cands, entries), item.itemLevel, TIER_NAMES_TOP));
  return { inclusion: entries.map(({ label, chance }) => ({ label, chance })), exact: odds.exact, lines };
}

function countChances(table: readonly { count: number; weight: number }[], offset = 0): CountChance[] {
  const total = table.reduce((s, c) => s + c.weight, 0);
  return table.map((c) => ({ count: Math.max(0, c.count - offset), chance: c.weight / total }));
}

/** Exact preview of applying `currencyId` to `item`. Assumes equipmentCraftError(...) is null. */
export function equipmentCraftPreview(item: EquipmentItem, currencyId: CurrencyId): CraftPreviewData {
  const def = findCurrency(currencyId)!;
  const base = findBase(item.baseId)!;
  const lines: string[] = [];
  let outcomes: OddsEntry[] = [];
  let inclusion: OddsEntry[] = [];
  let inclusionExact = true;

  if (isAdvancedEquipmentCurrency(currencyId)) {
    const preview = advancedCraftPreview(item, currencyId);
    lines.push(...preview.lines); outcomes = preview.outcomes;
  }
  switch (currencyId) {
    case 'prefixRune':
    case 'suffixRune': {
      const { kind, kept, pool, limits, count } = runePlan(item, base, currencyId);
      const odds = inclusionOdds(pool, kept, limits, [{ count, chance: 1 }]);
      const entries = inclusionEntries(odds.odds);
      inclusion = entries.map(({ label, chance }) => ({ label, chance }));
      inclusionExact = odds.exact;
      lines.push(`Reforges ${count} ${kind}${count === 1 ? '' : 'es'}; the affix count and rarity stay the same.`);
      if (kept.length) lines.push(`Preserves ${joinWords(kept.map(previewLabel))}. Seals break after this craft.`);
      if (entries.length) lines.push(inclusionLine(entries, odds.exact));
      lines.push(...tierOddsLines(byInclusion(pool, entries), item.itemLevel, TIER_NAMES_TOP));
      break;
    }
    case 'kindling': {
      const counts = countChances(MAGIC_AFFIX_COUNTS);
      outcomes = counts.map((c) => ({ label: `${c.count} affix${c.count === 1 ? '' : 'es'}`, chance: c.chance }));
      lines.push(`Makes this item Magic: ${joinDots(formatDistribution(outcomes))}`);
      const details = multiRollDetails(base, item, [], AFFIX_LIMITS.magic, counts);
      ({ inclusion, exact: inclusionExact } = details);
      lines.push(...details.lines);
      break;
    }
    case 'scrap': {
      const changing = item.affixes.filter(rerollable);
      const parts = changing.map((a) => {
        const d = getAffix(a.affixId)!;
        const t = tierOf(d, a.tier)!;
        return `${d.name}${a.crafted ? ' (crafted)' : ''} ${formatSpan(t.min, t.max)}`;
      });
      const one = changing.length === 1;
      lines.push(`Rerolls ${changing.length} value${one ? ' within its tier' : 's within their tiers'}: ${joinDots(parts)}`);
      const fixed = item.affixes.filter((a) => !rerollable(a)).map((a) => {
        const tag = a.fractured ? 'fractured' : a.sealed ? 'sealed' : 'fixed value';
        return `${affixName(a)} (${tag})`;
      });
      if (fixed.length) lines.push(`Unchanged: ${joinDots(fixed)}`);
      break;
    }
    case 'reforge': {
      const kept = item.affixes.filter(isProtected);
      const byTotal = new Map<number, number>();
      for (const c of countChances(RARE_AFFIX_COUNTS)) {
        const total = Math.max(c.count, kept.length);
        byTotal.set(total, (byTotal.get(total) ?? 0) + c.chance);
      }
      outcomes = [...byTotal.entries()].map(([n, p]) => ({ label: `${n} affixes`, chance: p }));
      lines.push(`Reforges this item into a Rare: ${joinDots(formatDistribution(outcomes))}`);
      if (kept.length) {
        lines.push(`Keeps ${joinWords(kept.map((a) => `${affixName(a)} (${a.fractured ? 'fractured' : a.crafted ? 'sealed, crafted' : 'sealed'})`))}`);
      }
      const lostCraft = item.affixes.find((a) => a.crafted && !isProtected(a));
      if (lostCraft) lines.push(`The crafted affix ${affixLabel(lostCraft)} is reforged away like the others.`);
      const details = multiRollDetails(base, item, kept, AFFIX_LIMITS.rare, countChances(RARE_AFFIX_COUNTS, kept.length));
      ({ inclusion, exact: inclusionExact } = details);
      lines.push(...details.lines);
      break;
    }
    case 'essenceEmber':
    case 'essenceRime':
    case 'essenceStorm':
    case 'essenceVital':
    case 'essenceSwift': {
      const { limits, rarity } = essenceTarget(item);
      const pool = eligibleCandidates(essencePool(item, base, def), affixState(item.affixes), limits);
      outcomes = singlePickOdds(pool).map((o) => ({ label: o.cand.affix.name, chance: o.chance }));
      const label = def.essenceLabel ?? 'matching';
      lines.push(pool.length === 1
        ? `Adds the only ${label} affix that can roll here: ${pool[0].affix.name}.`
        : `Adds one of ${pool.length} ${label} affixes: ${joinDots(formatDistribution(outcomes))}`);
      lines.push(...tierOddsLines(pool, item.itemLevel));
      if (rarity !== item.rarity) lines.push(`The item becomes ${capitalize(rarity)}.`);
      break;
    }
    case 'catalyst': {
      lines.push('Choose an affix to upgrade by one tier:');
      item.affixes.forEach((a, i) => {
        const d = getAffix(a.affixId);
        if (!d) return;
        const reason = catalystShortReason(item, i);
        const name = a.crafted ? `${d.name} (crafted)` : d.name;
        if (reason) {
          lines.push(`${name} T${a.tier}: ${reason}`);
        } else {
          const t = tierOf(d, a.tier - 1)!;
          lines.push(`${name} T${a.tier}: upgrades to T${t.tier} (${formatSpan(t.min, t.max)})`);
        }
      });
      break;
    }
    case 'solvent': {
      const removable = item.affixes.filter((a) => !isProtected(a));
      const worst = Math.max(...removable.map((a) => a.tier));
      const ties = removable.filter((a) => a.tier === worst);
      outcomes = ties.map((a) => ({ label: previewLabel(a), chance: 1 / ties.length }));
      lines.push(ties.length === 1
        ? `Removes the lowest-tier affix: ${previewLabel(ties[0])}.`
        : `Removes one of ${ties.length} lowest-tier affixes: ${joinDots(formatDistribution(outcomes))}`);
      if (item.affixes.length === 1) lines.push('The item becomes Normal.');
      break;
    }
    case 'seal': {
      lines.push('Choose an affix to seal: it is protected from the next crafting operation, then the seal breaks.');
      const can = item.affixes
        .filter((_, i) => !affixTargetError(item, currencyId, i))
        .map((a) => (a.crafted ? `${affixName(a)} (crafted)` : affixName(a)));
      if (can.length) lines.push(`Can be sealed: ${joinDots(can)}`);
      break;
    }
    case 'fractureCore': {
      lines.push('Choose an affix to fracture: it becomes permanent and immune to all crafting.');
      lines.push('Only one affix per item can be fractured.');
      const crafted = item.affixes.find((a) => a.crafted);
      if (crafted) lines.push(`The crafted affix ${affixLabel(crafted)} cannot be fractured.`);
      break;
    }
    default:
      break;
  }

  const cost = def.stabilityCost;
  const after = currencyId === 'anneal' ? item.maxStability - 1 : Math.max(0, item.stability - cost);
  lines.push(cost === 0 ? 'Costs no Stability.' : `Costs ${cost} Stability, leaving ${after}.`);
  const scarChance = scarChanceFor(item, base, cost);
  if (scarChance > 0) {
    lines.push(`Scar risk ${formatChance(scarChance)}: Stability drops to ${after} (scars can form at ${scarThreshold(base)} or less).`);
  } else if (cost > 0 && after <= scarThreshold(base) && item.scars.length >= MAX_SCARS) {
    lines.push(`No scar risk: the item already has ${MAX_SCARS} scars.`);
  } else if (cost > 0) {
    lines.push('No scar risk.');
  }
  if (cost > 0 && after === 0) lines.push('Stability reaches 0: the item will be Finished.');
  if (currencyId !== 'seal' && !preservesSeals(currencyId)) {
    const sealed = item.affixes.filter((a) => a.sealed).map(affixName);
    if (sealed.length && currencyId !== 'fractureCore') {
      lines.push(`The seal protects ${joinWords(sealed)} from this craft, then breaks.`);
    } else if (sealed.length) {
      lines.push(`The seal on ${joinWords(sealed)} breaks after this craft.`);
    }
  }
  return { lines, outcomes, inclusion, inclusionExact, stabilityCost: cost, stabilityAfter: after, scarChance };
}

/** Preview lines for the tooltip; a single reason line when the craft is not possible. */
export function craftPreview(ch: CharacterSave, currencyUid: string, targetUid: string): string[] {
  const r = resolve(ch, currencyUid, targetUid);
  if (typeof r === 'string') return [r];
  const error = equipmentCraftError(r.target.item, r.def.id);
  if (error) return [error];
  return equipmentCraftPreview(r.target.item, r.def.id).lines;
}

/** Affix lines of an item annotated with whether an affix-choice currency can target them. */
export function affixChoices(item: EquipmentItem, currencyId: CurrencyId): { index: number; error: string | null }[] {
  return item.affixes.map((_, index) => ({ index, error: affixTargetError(item, currencyId, index) }));
}

export type { AffixCandidate };
