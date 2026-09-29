// The Crafting Bench (GAME_SPEC §12): add a chosen affix at a fixed, modest tier for a fixed price.
//
//   recipe tier   the best tier the item level unlocks, never better than T4 (BENCH_BEST_TIER)
//   price         Forge Scrap by that tier's item-level requirement + one essence whose tags match the affix
//                 (Ember fire · Rime cold · Storm lightning · Vital life/defence/resistance · Swift speed);
//                 affixes no essence can add pay extra Scrap instead, luck affixes 2.5× that
//                 (BENCH_LUCK_PRICE_MULTIPLIER). Paid from BACKPACK stacks first, then the Crafting Stash
//                 (never from normal stash tabs).
//   craft         validate → roll the value inside the tier (character rng) → Normal becomes Magic →
//                 -1 Stability (never a scar roll; seals stay untouched: the bench changes no existing
//                 affix) → history "Bench: added Hale (T4)" → Finished at 0 → pay → store the rng state
//   limits        one bench-crafted affix per item (RolledAffix.crafted); the item's own rarity limits
//                 apply (a Magic item keeps ≤1 prefix and ≤1 suffix — the bench never makes it Rare)
//   clear         removes the crafted affix for free (no Stability back); 0 affixes left → Normal
//
// Other currencies treat a crafted affix like any other (Scrap rerolls it, Reforge replaces it, Solvent
// may remove it, Seal protects it) except that Fracture Core cannot fracture it and Tempering Catalyst
// cannot raise it above T4 (src/game/items/crafting.ts).
import type { BenchRecipe, BenchService, CraftOutcome, Result } from '../../contracts/game';
import type {
  AffixKind, CharacterSave, CurrencyStack, EquipmentItem, ItemLocation, MapItem, RolledAffix,
} from '../../contracts/items';
import type { CurrencyId } from '../../contracts/content';
import { EQUIPMENT_CURRENCY_IDS } from '../../contracts/content';
import { createRng } from '../../core/rng';
import {
  AFFIX_LIMITS, BENCH_BEST_TIER, BENCH_LUCK_PRICE_MULTIPLIER, BENCH_MAX_CRAFTED, BENCH_PRICE_BANDS, BENCH_RECIPES,
  BENCH_STABILITY_COST, CLASS_LABEL,
  STAT_LABEL, TAG_LABEL, findBase, findCurrency, getAffix,
} from '../../data/items';
import type { AffixDef, AffixLimits, AffixTierDef, BaseDef, BenchRecipeDef } from '../../data/items';
import { affixAllowedOnBase, affixState, rollValue, sortAffixes } from './affix-pool';
import { appendHistory } from './crafting';
import { capitalize, formatChance, formatLine, formatRangeLine, joinWords } from './format';
import { findItem, replaceItemAt, setStackCount } from './inventory';
import type { FoundItem } from './inventory';
import { currencyStashItem } from './special-stash';
import { historyCount, itemCraftCount, nextCraftCount } from './crafting-history';
import { BOUNTY_COMMISSION, MAP_MOD_REROLL, STABILITY_REPAIR } from '../../data/items/economy';
import { DANGER_MODS, getMapMod } from '../../data/progression';
import { inclusionChances, mapModName, modValueRange, rollModValue, sortMapMods } from '../progression/maps';

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(error: string): Result<T> => ({ ok: false, error });

export type BenchPrice = { currencyId: CurrencyId; count: number }[];

// ---------------------------------------------------------------------------------------------
// Recipes, tiers and prices (pure functions of the data)
// ---------------------------------------------------------------------------------------------

const RECIPE_MAP = new Map<string, BenchRecipeDef>(BENCH_RECIPES.map((r) => [r.id, r]));

/** A recipe by id. Ids arrive from the network: anything unknown (or not a string) finds nothing. */
export function findBenchRecipe(id: unknown): BenchRecipeDef | undefined {
  return typeof id === 'string' ? RECIPE_MAP.get(id) : undefined;
}

/**
 * The tier the bench grants for `def` at `itemLevel`: the best tier the item level unlocks, but never
 * better than BENCH_BEST_TIER. Null when even the worst tier needs a higher item level.
 */
export function benchTier(def: AffixDef, itemLevel: number): AffixTierDef | null {
  // def.tiers is T1 first, so the first match is the best allowed tier.
  return def.tiers.find((t) => t.tier >= BENCH_BEST_TIER && t.itemLevel <= itemLevel) ?? null;
}

/** The first tier the bench can grant for `def` (its worst tier, T4 or worse), or null when it has none. */
function benchFloor(def: AffixDef): AffixTierDef | null {
  for (let i = def.tiers.length - 1; i >= 0; i--) if (def.tiers[i].tier >= BENCH_BEST_TIER) return def.tiers[i];
  return null;
}

const ESSENCE_IDS: readonly CurrencyId[] = EQUIPMENT_CURRENCY_IDS.filter((id) => !!findCurrency(id)?.essenceTags?.length);

/**
 * The essence a recipe for `def` costs: the first of the affix's tags (in its own order) that an essence
 * can add — fire → Ember, cold → Rime, lightning → Storm, life / defence / resistance → Vital, speed →
 * Swift. So Fire Resistance takes an Ember Essence and Void Resistance a Vital one. Null when no essence
 * matches (critical, luck, focus, caster and utility affixes).
 */
export function benchEssence(def: AffixDef): CurrencyId | null {
  for (const tag of def.tags) {
    const id = ESSENCE_IDS.find((e) => findCurrency(e)?.essenceTags?.includes(tag));
    if (id) return id;
  }
  return null;
}

/**
 * Price of granting `tier` of `def`: Scrap by the tier's item-level requirement, plus the essence; or
 * the band's Scrap-only price when no essence matches, times BENCH_LUCK_PRICE_MULTIPLIER for luck.
 */
export function benchCost(def: AffixDef, tier: AffixTierDef): BenchPrice {
  let band = BENCH_PRICE_BANDS[0];
  for (const b of BENCH_PRICE_BANDS) if (tier.itemLevel >= b.minItemLevel) band = b;
  const essence = benchEssence(def);
  if (essence) return [{ currencyId: 'scrap', count: band.scrap }, { currencyId: essence, count: 1 }];
  const luck = def.tags.includes('luck') ? BENCH_LUCK_PRICE_MULTIPLIER : 1;
  return [{ currencyId: 'scrap', count: Math.ceil(band.scrapWithoutEssence * luck) }];
}

// ---------------------------------------------------------------------------------------------
// Currency in the backpack
// ---------------------------------------------------------------------------------------------

/** Backpack stacks of a currency, smallest first (so paying tidies up small stacks), then by position. */
function backpackStacks(ch: CharacterSave, id: CurrencyId): (FoundItem & { item: CurrencyStack })[] {
  return ch.backpack.entries
    .filter((e) => e.item.kind === 'currency' && e.item.currencyId === id && e.item.count > 0)
    .map((e) => ({ item: e.item as CurrencyStack, location: { kind: 'backpack' as const, x: e.x, y: e.y } }))
    .sort((a, b) => a.item.count - b.item.count || a.location.x - b.location.x || a.location.y - b.location.y);
}

/** How many of a currency the character carries in the backpack. */
export function backpackCurrency(ch: CharacterSave, id: CurrencyId): number {
  return backpackStacks(ch, id).reduce((s, f) => s + f.item.count, 0);
}

/** What the bench can pay with: backpack stacks (smallest first), then the currency's Crafting Stash slot. */
function payableStacks(ch: CharacterSave, id: CurrencyId): (FoundItem & { item: CurrencyStack })[] {
  const stacks = backpackStacks(ch, id);
  const slot = currencyStashItem(ch, id);
  if (slot.count > 0) stacks.push({ item: slot, location: { kind: 'currencyStash' } });
  return stacks;
}

/** How many of a currency the bench can spend: the backpack plus the Crafting Stash. */
export function benchCurrency(ch: CharacterSave, id: CurrencyId): number {
  return payableStacks(ch, id).reduce((s, f) => s + f.item.count, 0);
}

function currencyName(id: CurrencyId, count: number): string {
  const name = findCurrency(id)?.name ?? id;
  return `${count} ${name}`;
}

/** Why the backpack and Crafting Stash cannot pay `price` ("… 5 Forge Scrap (you have 3) …"); null when they can. */
function affordError(ch: CharacterSave, price: BenchPrice): string | null {
  const missing = price
    .map((p) => ({ p, have: benchCurrency(ch, p.currencyId) }))
    .filter(({ p, have }) => have < p.count)
    .map(({ p, have }) => `${currencyName(p.currencyId, p.count)} (you have ${have})`);
  return missing.length ? `Not enough currency in your backpack or Crafting Stash: needs ${joinWords(missing)}.` : null;
}

/** Take `price` out of backpack stacks, then the Crafting Stash. Assumes affordError(ch, price) is null. */
function payPrice(ch: CharacterSave, price: BenchPrice): CharacterSave {
  let next = ch;
  for (const p of price) {
    let left = p.count;
    while (left > 0) {
      const stack = payableStacks(next, p.currencyId)[0];
      if (!stack) break;
      const take = Math.min(left, stack.item.count);
      next = setStackCount(next, stack, stack.item.count - take);
      left -= take;
    }
  }
  return next;
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

/** Index of the item's bench-crafted affix, or -1. */
export function craftedAffixIndex(item: EquipmentItem): number {
  return item.affixes.findIndex((a) => a.crafted === true);
}

function tierLabel(a: RolledAffix): string {
  const def = getAffix(a.affixId);
  return def ? `${def.name} (T${a.tier})` : 'an unknown affix';
}

/** An affix name inside a sentence: quoted, so suffix names read right ("already has “of Haste” (T3)"). */
function quoted(name: string): string {
  return `\u201c${name}\u201d`;
}

/** tierLabel for reasons: “Hale” (T4). */
function quotedTierLabel(a: RolledAffix): string {
  const def = getAffix(a.affixId);
  return def ? `${quoted(def.name)} (T${a.tier})` : 'an unknown affix';
}

/** Affix limits for a bench craft: the item's own rarity (a Normal item becomes Magic). */
function benchLimits(item: EquipmentItem): AffixLimits {
  return item.rarity === 'rare' ? AFFIX_LIMITS.rare : AFFIX_LIMITS.magic;
}

/** Why no recipe at all can be used on this item right now (unique, finished, crafted affix); else null. */
export function benchItemError(item: EquipmentItem): string | null {
  if (item.rarity === 'unique') return 'Unique items cannot be crafted.';
  if (item.stability <= 0) return 'This item is Finished. Repair Stability at the bench to continue.';
  if (item.stability < BENCH_STABILITY_COST) {
    return `The Crafting Bench needs ${BENCH_STABILITY_COST} Stability; this item has ${item.stability} left.`;
  }
  const crafted = item.affixes.filter((a) => a.crafted);
  if (crafted.length >= BENCH_MAX_CRAFTED) {
    return `This item already has a crafted affix, ${joinWords(crafted.map(quotedTierLabel))}. Clear it to craft another.`;
  }
  return null;
}

/** Why `def` cannot be bench-crafted onto `item` (ignoring the price); null when it can. */
export function benchAffixError(item: EquipmentItem, base: BaseDef, def: AffixDef): string | null {
  const itemError = benchItemError(item);
  if (itemError) return itemError;
  if (!affixAllowedOnBase(def, base)) {
    if (def.classes.includes(base.itemClass) && def.requiresProperty) {
      return `${quoted(def.name)} only fits bases with ${STAT_LABEL[def.requiresProperty]}.`;
    }
    const cls = CLASS_LABEL[base.itemClass];
    return `${quoted(def.name)} cannot be crafted on ${/^[aeiou]/i.test(cls) ? 'an' : 'a'} ${cls}.`;
  }
  if (!benchTier(def, item.itemLevel)) {
    const first = benchFloor(def);
    return first
      ? `${quoted(def.name)} needs item level ${first.itemLevel} (this item is ${item.itemLevel}).`
      : `The Crafting Bench cannot craft ${quoted(def.name)}.`;
  }
  const clash = item.affixes.find((a) => getAffix(a.affixId)?.group === def.group);
  if (clash) {
    return clash.affixId === def.id
      ? `This item already has ${quotedTierLabel(clash)}.`
      : `This item already has ${quotedTierLabel(clash)}, which excludes ${quoted(def.name)}.`;
  }
  const limits = benchLimits(item);
  const st = affixState(item.affixes);
  const kind: AffixKind = def.kind;
  if (st[kind] >= limits[kind]) {
    const rarity = item.rarity === 'normal' ? 'magic' : item.rarity;
    return `No room for another ${kind}: ${st[kind]}/${limits[kind]} ${kind}es on this ${capitalize(rarity)} item.`;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Recipe list
// ---------------------------------------------------------------------------------------------

interface BenchTarget {
  item: EquipmentItem;
  location: ItemLocation;
  base: BaseDef;
}

function resolveTarget(ch: CharacterSave, targetUid: string): BenchTarget | string {
  const found = findItem(ch, targetUid);
  if (!found) return 'That item no longer exists.';
  if (found.item.kind !== 'equipment') return 'The Crafting Bench only works on equipment.';
  const base = findBase(found.item.baseId);
  if (!base) return 'This item can no longer be crafted.';
  return { item: found.item, location: found.location, base };
}

function describeRecipe(ch: CharacterSave, t: BenchTarget, recipe: BenchRecipeDef, def: AffixDef): BenchRecipe {
  // Below the first bench tier's item level (never with the shipped ladders) show that tier; the reason says why.
  const tier = benchTier(def, t.item.itemLevel) ?? benchFloor(def)!;
  const cost = benchCost(def, tier);
  const reason = benchAffixError(t.item, t.base, def) ?? affordError(ch, cost);
  const out: BenchRecipe = {
    id: recipe.id,
    affixId: def.id,
    kind: def.kind,
    label: formatRangeLine(def, tier.min, tier.max),
    tier: tier.tier,
    tags: def.tags.map((tag) => TAG_LABEL[tag]),
    cost: cost.map((c) => ({ ...c })),
    stabilityCost: BENCH_STABILITY_COST,
    available: reason === null,
  };
  if (reason !== null) out.reason = reason;
  return out;
}

/**
 * Every recipe that fits the target (the affix's class allow-list and base property), prefixes first,
 * with its tier, range label, price and availability. Empty for anything that is not equipment.
 */
export function benchRecipes(ch: CharacterSave, targetUid: string): BenchRecipe[] {
  const t = resolveTarget(ch, targetUid);
  if (typeof t === 'string') return [];
  const out: BenchRecipe[] = [];
  for (const recipe of BENCH_RECIPES) {
    const def = getAffix(recipe.affixId);
    if (!def || !affixAllowedOnBase(def, t.base) || !benchFloor(def)) continue;
    out.push(describeRecipe(ch, t, recipe, def));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Crafting and clearing
// ---------------------------------------------------------------------------------------------

/**
 * Apply a bench recipe: pays from the backpack (then the Crafting Stash), adds the affix (crafted: true,
 * value rolled inside the bench tier with the character rng), costs 1 Stability without a scar roll,
 * Normal → Magic, and appends "Bench: added <affix> (T<n>)" to the item's history. Nothing changes on failure.
 */
export function applyBenchRecipe(ch: CharacterSave, targetUid: string, recipeId: string): Result<CraftOutcome> {
  if (typeof recipeId === 'string' && (recipeId === 'bench:repair' || recipeId === 'bench:bounty' || recipeId.startsWith('bench:map:'))) {
    return applyBenchService(ch, targetUid, recipeId);
  }
  const recipe = findBenchRecipe(recipeId);
  if (!recipe) return fail('The Crafting Bench has no such recipe.');
  const def = getAffix(recipe.affixId);
  if (!def) return fail('The Crafting Bench has no such recipe.');
  const t = resolveTarget(ch, targetUid);
  if (typeof t === 'string') return fail(t);
  const error = benchAffixError(t.item, t.base, def);
  if (error) return fail(error);
  const tier = benchTier(def, t.item.itemLevel)!;
  const cost = benchCost(def, tier);
  const priceError = affordError(ch, cost);
  if (priceError) return fail(priceError);

  const rng = createRng(ch.rngState >>> 0);
  const value = rollValue(rng, tier.min, tier.max);
  const added: RolledAffix = { affixId: def.id, tier: tier.tier, value, crafted: true };
  const becomesMagic = t.item.rarity === 'normal';
  const stability = Math.max(0, t.item.stability - BENCH_STABILITY_COST);
  const line = `Bench: added ${def.name} (T${tier.tier})`;
  const lines = [line];
  const finished = stability <= 0;
  if (finished) lines.push('Finished at 0 Stability');
  const item: EquipmentItem = {
    ...t.item,
    rarity: becomesMagic ? 'magic' : t.item.rarity,
    name: becomesMagic ? null : t.item.name,
    affixes: sortAffixes([...t.item.affixes, added]),
    stability,
    craftCount: nextCraftCount(t.item),
    history: appendHistory(t.item.history, lines),
  };

  let next = payPrice(replaceItemAt(ch, t.location, item), cost);
  next = {
    ...next,
    rngState: rng.state(),
    stats: { ...next.stats, itemsCrafted: (next.stats?.itemsCrafted ?? 0) + 1 },
  };
  let message = `${line}: ${formatLine(def, value)}`;
  if (finished) message += ' · Finished';
  return ok({ character: next, message, kind: finished ? 'finished' : 'success', targetUid });
}

/**
 * Remove the item's bench-crafted affix for free (the Stability it cost stays spent). An item left with
 * no affixes becomes Normal, like Forge Solvent. Works on Finished items too: it only takes power away.
 */
export function clearCraftedAffix(ch: CharacterSave, targetUid: string): Result<CraftOutcome> {
  const t = resolveTarget(ch, targetUid);
  if (typeof t === 'string') return fail(t);
  if (t.item.rarity === 'unique') return fail('Unique items cannot be crafted.');
  const index = craftedAffixIndex(t.item);
  if (index < 0) return fail('This item has no crafted affix to clear.');
  const removed = t.item.affixes[index];
  const affixes = t.item.affixes.filter((_, i) => i !== index);
  const becomesNormal = affixes.length === 0;
  const line = `Bench: cleared ${tierLabel(removed)}${becomesNormal ? '; the item is Normal again' : ''}`;
  const item: EquipmentItem = {
    ...t.item,
    affixes,
    ...(becomesNormal ? { rarity: 'normal' as const, name: null } : {}),
    craftCount: nextCraftCount(t.item),
    history: appendHistory(t.item.history, [line]),
  };
  return ok({ character: replaceItemAt(ch, t.location, item), message: line, kind: 'success', targetUid });
}


/** Authoritative price; online commands must quote this amount before payment. */
export function stabilityRepairCost(item: EquipmentItem): number {
  return STABILITY_REPAIR.base + STABILITY_REPAIR.perCraft * itemCraftCount(item)
    + STABILITY_REPAIR.perRepairSquared * historyCount(item.repairCount) ** 2;
}

const replacementMods = (map: MapItem) => DANGER_MODS.filter(def => !map.mods.some(m => m.modId === def.id));

export function benchServices(ch: CharacterSave, targetUid: string): BenchService[] {
  const item = findItem(ch, targetUid)?.item;
  if (!item) return [];
  const service = (id: string, label: string, scrap: number, lines: string[], error: string | null): BenchService => {
    const cost: BenchPrice = [{ currencyId: 'scrap', count: scrap }];
    const reason = error ?? affordError(ch, cost);
    return { id, label, lines, cost, available: reason === null, ...(reason ? { reason } : {}) };
  };
  if (item.kind === 'equipment') return [service('bench:repair', 'Repair 1 Stability', stabilityRepairCost(item), [
    'Restores one Stability, including on Finished gear. Existing scars, rolls, seals and fractures stay unchanged.',
    `${itemCraftCount(item)} lifetime crafts; ${historyCount(item.repairCount)} previous repairs. Each repair and craft increases future repair costs.`,
    `Price: ${STABILITY_REPAIR.base} + ${STABILITY_REPAIR.perCraft} per craft + ${STABILITY_REPAIR.perRepairSquared} times previous repairs squared.`,
  ], item.rarity === 'unique' ? 'Unique items cannot be repaired.'
    : item.stability >= item.maxStability ? 'This item already has full Stability.' : null)];
  if (item.kind !== 'map') return [];
  const locked = item.corrupted ? 'Corrupted maps cannot be changed.' : null;
  const services: BenchService[] = [service('bench:bounty', 'Commission Bounty',
    BOUNTY_COMMISSION.base + BOUNTY_COMMISSION.perTier * item.tier, [
      'Turns this into a Bounty map: The Hunted is guaranteed in wave 2 or 4, replacing the random encounter roll.',
      'Defeat its rare pursuer for a guaranteed Rare item per living player. The commission travels with this map and can be traded.',
    ], locked ?? (item.bounty ? 'This map already has a Bounty commission.' : null))];
  const pool = replacementMods(item);
  const odds = inclusionChances(pool, 1);
  const range = modValueRange(item.tier);
  for (const mod of item.mods) {
    const def = getMapMod(mod.modId);
    if (def?.kind !== 'danger') continue;
    services.push(service(`bench:map:${mod.modId}`, `Reroll ${mapModName(def, item.baseId)}`,
      MAP_MOD_REROLL.base + MAP_MOD_REROLL.perTier * item.tier, [
        'Replaces this danger/reward pair with a different one. Keeps every other mod, rarity, tier, quality and any Bounty commission.',
        `New mod: ${pool.map(d => `${mapModName(d, item.baseId)} ${formatChance(odds.get(d.id) ?? 0)}`).join(' · ')}.`,
        `Magnitude: ${range.min}-${range.max}% of the new mod's base values; every integer is equally likely.`,
      ], locked ?? (pool.length ? null : 'No other danger mod can be rolled.')));
  }
  return services;
}

function applyBenchService(ch: CharacterSave, targetUid: string, serviceId: string): Result<CraftOutcome> {
  const found = findItem(ch, targetUid);
  const service = benchServices(ch, targetUid).find(s => s.id === serviceId);
  if (!found || !service) return fail('That bench service does not fit this item.');
  if (!service.available) return fail(service.reason!);
  let item = found.item;
  let message: string;
  let rngState = ch.rngState;
  if (item.kind === 'equipment' && serviceId === 'bench:repair') {
    const price = service.cost[0].count;
    message = `Repaired 1 Stability for ${price} Forge Scrap`;
    item = { ...item, stability: item.stability + 1, craftCount: itemCraftCount(item),
      repairCount: historyCount(historyCount(item.repairCount) + 1), history: appendHistory(item.history, [message]) };
  } else if (item.kind === 'map' && serviceId === 'bench:bounty') {
    item = { ...item, bounty: true };
    message = 'Bounty commissioned: The Hunted is guaranteed in this map';
  } else if (item.kind === 'map') {
    const id = serviceId.slice('bench:map:'.length);
    const rng = createRng(ch.rngState >>> 0);
    const replacement = rng.weighted(replacementMods(item), def => def.weight)!;
    const tier = item.tier;
    item = { ...item, mods: sortMapMods(item.mods.map(m => m.modId === id
      ? { modId: replacement.id, value: rollModValue(rng, tier) } : m)) };
    rngState = rng.state();
    message = `Rerolled ${mapModName(getMapMod(id)!, item.baseId)} into ${mapModName(replacement, item.baseId)}`;
  } else return fail('That bench service does not fit this item.');
  const paid = payPrice(replaceItemAt(ch, found.location, item), service.cost);
  const character = { ...paid, rngState, stats: { ...paid.stats, itemsCrafted: paid.stats.itemsCrafted + 1 } };
  return ok({ character, message, kind: 'success', targetUid });
}
