// Item generation: random equipment by rarity, uniques, explicit builds (starting kit), random bases,
// rare names. All randomness comes from the Rng passed in.
import type {
  AffixTag, CurrencyStack, EquipmentItem, FlaskStack, Rarity, RolledAffix, RolledScar,
} from '../../contracts/items';
import type { Rng } from '../../contracts/rng';
import type { BaseId, CurrencyId, FlaskId, ItemClass, UniqueId } from '../../contracts/content';
import { UNIQUE_IDS } from '../../contracts/content';
import {
  AFFIX_LIMITS, BASES, BENCH_BEST_TIER, BENCH_MAX_CRAFTED, FLASK_STACK, MAGIC_AFFIX_COUNTS, MAX_ITEM_LEVEL, MAX_SCARS, MIN_ITEM_LEVEL,
  RARE_AFFIX_COUNTS,
  RARE_NAME_FIRST, RARE_NAME_SECOND, UNIQUES, getAffix, getBase, getCurrency, getFlask, getScar, getUnique,
} from '../../data/items';
import type { AffixLimits, BaseDef } from '../../data/items';
import {
  affixAllowedOnBase, affixCandidates, affixState, rollCount, rollNewAffixes, rollValue, sortAffixes,
} from './affix-pool';
import { randomUid } from './ids';

export type CraftableRarity = Exclude<Rarity, 'unique'>;

export function clampItemLevel(itemLevel: number): number {
  if (!Number.isFinite(itemLevel)) return MIN_ITEM_LEVEL;
  return Math.max(MIN_ITEM_LEVEL, Math.min(MAX_ITEM_LEVEL, Math.floor(itemLevel)));
}

/** "Ember Bite": one word from each list, never the same word twice. */
export function rollRareName(rng: Rng): string {
  const first = rng.pick(RARE_NAME_FIRST);
  let second = rng.pick(RARE_NAME_SECOND);
  for (let i = 0; i < 8 && second === first; i++) second = rng.pick(RARE_NAME_SECOND);
  return `${first} ${second}`;
}

/** Stored affix id of a unique's i-th fixed mod. */
export function uniqueModId(uniqueId: UniqueId, index: number): string {
  return `unique:${uniqueId}:${index}`;
}

export interface GenerateOptions {
  /** Explicit uid; otherwise a random uid is drawn from `rng`. */
  uid?: string;
  /** Added to the base's max stability (map implicit "armour bases +2 stability"). */
  extraStability?: number;
  /** Extra affix weight multipliers by tag (map implicits). */
  tagWeights?: Partial<Record<AffixTag, number>>;
  /** Force the affix count (clamped to what the rarity allows). */
  affixCount?: number;
  /** First history line, e.g. "Dropped by a rare Ironhide Brute in Ashen Forge (T4)". */
  origin?: string;
  isNew?: boolean;
}

function limitsFor(rarity: CraftableRarity): AffixLimits {
  return AFFIX_LIMITS[rarity];
}

/**
 * Generate a random normal / magic / rare item of a base.
 * Magic: 1–2 affixes (≤1 prefix, ≤1 suffix). Rare: 3–6 affixes (≤3 prefixes, ≤3 suffixes) and a name.
 * Affixes respect class allow-lists, exclusive groups, item-level tier gates and material weights.
 */
export function generateEquipment(
  baseId: BaseId, itemLevel: number, rarity: CraftableRarity, rng: Rng, opts: GenerateOptions = {},
): EquipmentItem {
  const base = getBase(baseId);
  const ilvl = clampItemLevel(itemLevel);
  const uid = opts.uid ?? randomUid(rng);
  const implicitValues = base.implicits.map((imp) => rollValue(rng, imp.min, imp.max));
  let affixes: RolledAffix[] = [];
  if (rarity !== 'normal') {
    const limits = limitsFor(rarity);
    const maxCount = limits.prefix + limits.suffix;
    const rolled = opts.affixCount ?? rollCount(rng, rarity === 'magic' ? MAGIC_AFFIX_COUNTS : RARE_AFFIX_COUNTS);
    const count = Math.max(1, Math.min(maxCount, Math.floor(rolled)));
    const cands = affixCandidates(base, ilvl, { tagWeights: opts.tagWeights });
    affixes = sortAffixes(rollNewAffixes(rng, cands, [], limits, count));
  }
  const name = rarity === 'rare' ? rollRareName(rng) : null;
  const maxStability = Math.max(0, base.maxStability + Math.floor(opts.extraStability ?? 0));
  return {
    kind: 'equipment',
    uid,
    baseId,
    itemLevel: ilvl,
    rarity,
    name,
    implicitValues,
    affixes,
    scars: [],
    stability: maxStability,
    maxStability,
    history: opts.origin ? [opts.origin] : [],
    ...(opts.isNew ? { isNew: true } : {}),
  };
}

export interface UniqueOptions {
  uid?: string;
  /**
   * Item level (scales the base's Armour / Evasion / Added Spell Damage properties). Defaults to the
   * unique's level requirement; loot should pass the monster level so a late drop has late-game base
   * properties.
   */
  itemLevel?: number;
  origin?: string;
  isNew?: boolean;
}

/** Generate a unique with rolled implicit and mod values. Uniques have no stability (never craftable). */
export function generateUnique(uniqueId: UniqueId, rng: Rng, opts: UniqueOptions = {}): EquipmentItem {
  const def = getUnique(uniqueId);
  const base = getBase(def.baseId);
  const uid = opts.uid ?? randomUid(rng);
  const implicitValues = base.implicits.map((imp) => rollValue(rng, imp.min, imp.max));
  const affixes = def.mods.map((m, i) => ({ affixId: uniqueModId(uniqueId, i), tier: 1, value: rollValue(rng, m.min, m.max) }));
  return {
    kind: 'equipment',
    uid,
    baseId: def.baseId,
    itemLevel: clampItemLevel(opts.itemLevel ?? def.levelRequirement),
    rarity: 'unique',
    name: def.name,
    uniqueId,
    implicitValues,
    affixes,
    scars: [],
    stability: 0,
    maxStability: 0,
    history: opts.origin ? [opts.origin] : [],
    ...(opts.isNew ? { isNew: true } : {}),
  };
}

export interface EquipmentSpec {
  baseId: BaseId;
  itemLevel: number;
  rarity: CraftableRarity;
  /** Explicit affixes; missing values are rolled within the tier. */
  affixes?: readonly { affixId: string; tier: number; value?: number; sealed?: boolean; fractured?: boolean; crafted?: boolean }[];
  implicitValues?: readonly number[];
  /** Rare name; rolled when omitted for rare items. */
  name?: string;
  uid?: string;
  scars?: readonly RolledScar[];
  stability?: number;
  extraStability?: number;
  history?: readonly string[];
  isNew?: boolean;
  /**
   * Skip only the item-level gate on affix tiers, for deliberately scripted items (e.g. a reward that
   * should carry a tier its item level could not roll). Everything else is still enforced.
   */
  ignoreItemLevel?: boolean;
}

/**
 * Build a specific item (starting kit, merchant stock, tests). Validates everything a rolled item
 * obeys — affix ids, class and base-property allow-lists, tiers and their item-level gates, values,
 * prefix/suffix limits, exclusive groups, at most one seal and one fracture, magic/rare items having
 * affixes, implicit and scar values — and throws on programmer error rather than producing an item
 * the game could never create.
 */
export function buildEquipment(spec: EquipmentSpec, rng: Rng): EquipmentItem {
  const base = getBase(spec.baseId);
  const ilvl = clampItemLevel(spec.itemLevel);
  const fail = (msg: string): never => {
    throw new Error(`buildEquipment(${spec.baseId}): ${msg}`);
  };
  const affixes: RolledAffix[] = (spec.affixes ?? []).map((a) => {
    const def = getAffix(a.affixId);
    if (!def) return fail(`unknown affix "${a.affixId}"`);
    if (!affixAllowedOnBase(def, base)) return fail(`${a.affixId} cannot roll on ${base.name}`);
    const tier = def.tiers.find((t) => t.tier === a.tier);
    if (!tier) return fail(`${a.affixId} has no tier ${a.tier}`);
    if (!spec.ignoreItemLevel && tier.itemLevel > ilvl) {
      fail(`${a.affixId} T${a.tier} needs item level ${tier.itemLevel} (pass ignoreItemLevel for scripted items)`);
    }
    if (a.value !== undefined && (a.value < tier.min || a.value > tier.max)) {
      fail(`${a.affixId} T${a.tier} value ${a.value} is outside ${tier.min}-${tier.max}`);
    }
    if (a.sealed && a.fractured) fail(`${a.affixId} cannot be both sealed and fractured`);
    if (a.crafted && a.fractured) fail(`${a.affixId}: a crafted affix cannot be fractured`);
    if (a.crafted && a.tier < BENCH_BEST_TIER) fail(`${a.affixId}: the bench never crafts better than T${BENCH_BEST_TIER}`);
    const value = a.value ?? rollValue(rng, tier.min, tier.max);
    return {
      affixId: a.affixId, tier: a.tier, value,
      ...(a.sealed ? { sealed: true } : {}),
      ...(a.fractured ? { fractured: true } : {}),
      ...(a.crafted ? { crafted: true } : {}),
    };
  });
  const st = affixState(affixes);
  const limits = limitsFor(spec.rarity);
  if (st.prefix > limits.prefix || st.suffix > limits.suffix) fail(`too many affixes for a ${spec.rarity} item`);
  if (st.groups.size !== affixes.length) fail('duplicate affix group');
  if (spec.rarity !== 'normal' && affixes.length === 0) fail(`a ${spec.rarity} item needs at least one affix`);
  if (affixes.filter((a) => a.sealed).length > 1) fail('only one affix can be sealed');
  if (affixes.filter((a) => a.fractured).length > 1) fail('only one affix can be fractured');
  if (affixes.filter((a) => a.crafted).length > BENCH_MAX_CRAFTED) fail(`at most ${BENCH_MAX_CRAFTED} crafted affix per item`);

  if (spec.implicitValues) {
    if (spec.implicitValues.length !== base.implicits.length) fail(`expected ${base.implicits.length} implicit values`);
    spec.implicitValues.forEach((v, i) => {
      const imp = base.implicits[i];
      if (v < Math.min(imp.min, imp.max) || v > Math.max(imp.min, imp.max)) {
        fail(`implicit ${i} value ${v} is outside ${imp.min}-${imp.max}`);
      }
    });
  }
  const scars = spec.scars ?? [];
  if (scars.length > MAX_SCARS) fail(`at most ${MAX_SCARS} scars`);
  if (new Set(scars.map((s) => s.scarId)).size !== scars.length) fail('duplicate scar');
  for (const s of scars) {
    const def = getScar(s.scarId);
    if (!def) fail(`unknown scar "${s.scarId}"`);
    else if (s.value < def.min || s.value > def.max) fail(`scar ${s.scarId} value ${s.value} is outside ${def.min}-${def.max}`);
  }

  const implicitValues = spec.implicitValues
    ? [...spec.implicitValues]
    : base.implicits.map((imp) => rollValue(rng, imp.min, imp.max));
  const maxStability = Math.max(0, base.maxStability + Math.floor(spec.extraStability ?? 0));
  const name = spec.rarity === 'rare' ? (spec.name ?? rollRareName(rng)) : null;
  return {
    kind: 'equipment',
    uid: spec.uid ?? randomUid(rng),
    baseId: spec.baseId,
    itemLevel: ilvl,
    rarity: spec.rarity,
    name,
    implicitValues,
    affixes: sortAffixes(affixes),
    scars: scars.map((s) => ({ ...s })),
    stability: Math.max(0, Math.min(maxStability, spec.stability ?? maxStability)),
    maxStability,
    history: spec.history ? [...spec.history] : [],
    ...(spec.isNew ? { isNew: true } : {}),
  };
}

export interface BasePickOptions {
  /** Restrict to these item classes (gambling by class). */
  classes?: readonly ItemClass[];
  /** Exclude bases whose level requirement exceeds this item level. */
  itemLevel?: number;
  /** Weight multipliers per base (map implicits, e.g. "more jewellery bases"). */
  weights?: Partial<Record<BaseId, number>>;
  /** Weight multipliers per class. */
  classWeights?: Partial<Record<ItemClass, number>>;
}

/** Bases a random pick may return, with their effective weights. */
export function baseWeights(opts: BasePickOptions = {}): { base: BaseDef; weight: number }[] {
  const out: { base: BaseDef; weight: number }[] = [];
  for (const base of Object.values(BASES)) {
    if (opts.classes && !opts.classes.includes(base.itemClass)) continue;
    if (opts.itemLevel !== undefined && base.levelRequirement > Math.max(1, opts.itemLevel)) continue;
    const w = base.dropWeight * (opts.weights?.[base.id] ?? 1) * (opts.classWeights?.[base.itemClass] ?? 1);
    if (w > 0) out.push({ base, weight: w });
  }
  return out;
}

/** Weighted random base, or null when the filters exclude everything. */
export function pickRandomBase(rng: Rng, opts: BasePickOptions = {}): BaseId | null {
  return rng.weighted(baseWeights(opts), (b) => b.weight)?.base.id ?? null;
}

export interface UniqueFilter {
  baseId?: BaseId;
  classes?: readonly ItemClass[];
  /**
   * Only uniques wearable at this level: the unique's own level requirement and its base's both ≤ it.
   * Drops pass the item level (monster level), the gamble the character's level (GAME_SPEC §5, §9),
   * so a Tier 1 boss never hands out a ring nobody can wear for 20 levels.
   */
  maxLevel?: number;
}

/** A unique's effective level requirement (its own, never below its base's). */
export function uniqueLevelRequirement(id: UniqueId): number {
  const u = UNIQUES[id];
  return Math.max(u.levelRequirement, getBase(u.baseId).levelRequirement);
}

/** Unique ids matching the filter (base, classes, wearable level). */
export function uniqueIdsFor(filter: UniqueFilter = {}): UniqueId[] {
  return UNIQUE_IDS.filter((id) => {
    const u = UNIQUES[id];
    if (filter.baseId && u.baseId !== filter.baseId) return false;
    if (filter.classes && !filter.classes.includes(getBase(u.baseId).itemClass)) return false;
    if (filter.maxLevel !== undefined && !(uniqueLevelRequirement(id) <= filter.maxLevel)) return false;
    return true;
  });
}

/** Weighted random unique matching the filter, or null if none match (callers fall back to a rare). */
export function pickRandomUnique(rng: Rng, filter: Omit<UniqueFilter, 'baseId'> = {}): UniqueId | null {
  const ids = uniqueIdsFor(filter);
  return rng.weighted(ids, (id) => UNIQUES[id].dropWeight) ?? null;
}

/** A currency stack (count clamped to 1…maxStack). */
export function currencyStack(currencyId: CurrencyId, count: number, uid: string, isNew = false): CurrencyStack {
  const max = getCurrency(currencyId).maxStack;
  return {
    kind: 'currency', uid, currencyId, count: Math.max(1, Math.min(max, Math.floor(count))),
    ...(isNew ? { isNew: true } : {}),
  };
}

/** A flask stack (count clamped to 1…FLASK_STACK). */
export function flaskStack(flaskId: FlaskId, count: number, uid: string, isNew = false): FlaskStack {
  getFlask(flaskId);
  return {
    kind: 'flask', uid, flaskId, count: Math.max(1, Math.min(FLASK_STACK, Math.floor(count))),
    ...(isNew ? { isNew: true } : {}),
  };
}
