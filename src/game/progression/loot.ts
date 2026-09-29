// Loot & luck (GAME_SPEC §9, §11). Every roll uses the rng handed in (the sim's loot stream), so drops are
// deterministic for a run seed.
//
// Loot is INSTANCED: the server calls rollKillLoot / rollChestLoot once per player present, each with
// that player's CharacterSave as the looter (sharing the one loot rng in a fixed player order), and tags
// each item's DropSpec with that player as its owner. Nobody can take anyone else's drops.
//
// Per kill and looter: quantity Q% and rarity R% start from the looter's personal luck — the map-side
// luck of the RunSetup plus the looter's gear (lootLuck in ./luck) — and are multiplied by the monster's
// rarity (magic ×1.5 Q / ×2 R, rare ×4 Q / ×3 R; the lieutenant and boss roll like rares) and, in the
// Echo wave, by double quantity. Each category is then rolled independently:
//   chance = base × Q / 100 (maps additionally × map drop chance); a chance above 100% drops
//   floor(chance) items plus one more with the remainder.
// Equipment rarity weights with m = R / 100: normal 70 · magic 27·m · rare 3·m^1.3 · unique 0.2·m^1.5.
// A unique is picked among those wearable at the drop's item level (the unique's and its base's level
// requirement ≤ monster level); when none is, the drop becomes a rare.
// Summoned minions (and the training dummy) never drop anything.
import type { RunSetup } from '../../contracts/game';
import type { CharacterSave, CurrencyStack, EquipmentItem, FlaskStack, Item, MapItem, Rarity } from '../../contracts/items';
import type { CurrencyId, MapBaseId } from '../../contracts/content';
import { MAP_BASE_IDS, iconIdForBase, iconIdForCurrency, iconIdForFlask, iconIdForMap, iconIdForUnique } from '../../contracts/content';
import type { DropSpec, DropSprite, DropTone, KillLootContext } from '../../contracts/sim';
import type { Rng } from '../../contracts/rng';
import {
  BOSS_LOOT, CATEGORY_CHANCE, CATEGORY_ORDER, CHEST_LOOT, CHEST_MAP_QUALITY, CURRENCY_DROPS, DROPPED_MAP_QUALITY,
  ECHO_WAVE_QUANTITY_MORE, ELITE_LOOT_MULTIPLIER, EQUIPMENT_RARITY_WEIGHTS, FLASK_DROPS, LIEUTENANT_LOOT, MAP_BASES,
  MAP_DROP_TIER_OFFSETS, MAP_RARITY_WEIGHTS, MAX_MAP_TIER, MIN_MAP_TIER, MONSTER_LOOT_MULTIPLIERS,
} from '../../data/progression';
import type { CurrencyDropDef, LootCategory, RarityWeightDef } from '../../data/progression';
import { ARMOUR_CLASSES, findCurrency, findFlask, getBase } from '../../data/items';
import {
  currencyStack, flaskStack, generateEquipment, generateUnique, itemDisplayName, pickRandomBase, pickRandomUnique, randomUid,
} from '../items';
import type { Luck } from './luck';
import { lootLuck } from './luck';
import {
  clampTier, echoWaveIndex, mapBaseName, mapDropMultipliers, mapTitle, monsterName, monsterSentenceName, rollMapWithRarity,
} from './maps';
import { asciiLabel, rollCountTable } from './util';

// ---------------------------------------------------------------------------------------------
// Rarity weights
// ---------------------------------------------------------------------------------------------

export type DropRarity = Rarity;
const RARITY_ORDER: readonly Rarity[] = ['normal', 'magic', 'rare', 'unique'];

/** Weights of each rarity at rarity multiplier m (only rarities at or above `min`). */
export function rarityWeights<K extends Rarity>(
  table: Readonly<Record<K, RarityWeightDef>>, m: number, min: Rarity = 'normal',
): { rarity: K; weight: number }[] {
  const mm = Math.max(0, m);
  const minIndex = RARITY_ORDER.indexOf(min);
  return (Object.keys(table) as K[])
    .filter((r) => RARITY_ORDER.indexOf(r) >= minIndex)
    .map((rarity) => ({ rarity, weight: table[rarity].base * mm ** table[rarity].exponent }));
}

/** Normalised equipment rarity odds at m (for previews and tests). */
export function equipmentRarityOdds(m: number, min: Rarity = 'normal'): Record<Rarity, number> {
  const w = rarityWeights(EQUIPMENT_RARITY_WEIGHTS, m, min);
  const total = w.reduce((s, e) => s + e.weight, 0) || 1;
  const out: Record<Rarity, number> = { normal: 0, magic: 0, rare: 0, unique: 0 };
  for (const e of w) out[e.rarity] = e.weight / total;
  return out;
}

export function rollEquipmentRarity(rng: Rng, m: number, min: Rarity = 'normal'): Rarity {
  return rng.weighted(rarityWeights(EQUIPMENT_RARITY_WEIGHTS, m, min), (e) => e.weight)?.rarity ?? min;
}

function rollMapRarity(rng: Rng, m: number): Exclude<Rarity, 'unique'> {
  return rng.weighted(rarityWeights(MAP_RARITY_WEIGHTS, m), (e) => e.weight)?.rarity ?? 'normal';
}

/** floor(chance) guaranteed plus one more with the fractional remainder. */
function rollTimes(rng: Rng, chance: number): number {
  if (!(chance > 0)) return 0;
  const whole = Math.floor(chance);
  return whole + (rng.next() < chance - whole ? 1 : 0);
}

// ---------------------------------------------------------------------------------------------
// Per-run loot context (map-side, shared by every looter; cached per RunSetup object)
// ---------------------------------------------------------------------------------------------

interface LootContext {
  map: MapItem;
  tier: number;
  monsterLevel: number;
  mapChance: number;
  currency: readonly CurrencyDropDef[];
  armourStability: number;
  echoWave: number;
  place: string;
}

const CONTEXTS = new WeakMap<RunSetup, LootContext>();

const ESSENCES: ReadonlySet<CurrencyId> = new Set<CurrencyId>(['essenceEmber', 'essenceRime', 'essenceStorm', 'essenceVital', 'essenceSwift']);

/** Currency weights after map implicit and reward-mod multipliers (essences). */
export function currencyWeightsFor(map: MapItem): CurrencyDropDef[] {
  const m = mapDropMultipliers(map);
  return CURRENCY_DROPS.map((d) => {
    let weight = d.weight;
    if (ESSENCES.has(d.currencyId)) weight *= m.essence;
    if (d.currencyId === 'essenceEmber') weight *= m.emberEssence;
    if (d.currencyId === 'essenceRime') weight *= m.rimeEssence;
    return { ...d, weight };
  });
}

function lootContext(setup: RunSetup): LootContext {
  let ctx = CONTEXTS.get(setup);
  if (ctx) return ctx;
  const map = setup.map;
  const tier = clampTier(map.tier);
  const drops = mapDropMultipliers(map);
  ctx = {
    map,
    tier,
    monsterLevel: Math.max(1, Math.floor(setup.monsterLevel || 1)),
    mapChance: drops.map,
    currency: currencyWeightsFor(map),
    armourStability: drops.armourStability,
    echoWave: echoWaveIndex(map),
    place: `${mapBaseName(map.baseId)} (Tier ${tier})`,
  };
  CONTEXTS.set(setup, ctx);
  return ctx;
}

// ---------------------------------------------------------------------------------------------
// Item makers
// ---------------------------------------------------------------------------------------------

function makeEquipment(ctx: LootContext, rng: Rng, rarity: Rarity, origin: string): EquipmentItem {
  if (rarity === 'unique') {
    // Only uniques wearable at the drop's item level; with none (below level 12) the roll becomes a rare.
    const id = pickRandomUnique(rng, { maxLevel: ctx.monsterLevel });
    if (id) return generateUnique(id, rng, { itemLevel: ctx.monsterLevel, origin, isNew: true });
    rarity = 'rare';
  }
  const baseId = pickRandomBase(rng, { itemLevel: ctx.monsterLevel }) ?? 'ashwoodWand';
  const extraStability = ARMOUR_CLASSES.includes(getBase(baseId).itemClass) ? ctx.armourStability : 0;
  return generateEquipment(baseId, ctx.monsterLevel, rarity as Exclude<Rarity, 'unique'>, rng, { extraStability, origin, isNew: true });
}

function makeCurrency(ctx: LootContext, rng: Rng): CurrencyStack {
  const def = rng.weighted(ctx.currency, (d) => d.weight) ?? ctx.currency[0];
  const count = def.stack ? rollCountTable(rng, def.stack) : 1;
  return currencyStack(def.currencyId, count, randomUid(rng), true);
}

function makeFlask(rng: Rng): FlaskStack {
  const def = rng.weighted(FLASK_DROPS, (d) => d.weight) ?? FLASK_DROPS[0];
  return flaskStack(def.flaskId, 1, randomUid(rng), true);
}

function pickMapBase(rng: Rng): MapBaseId {
  return rng.weighted(MAP_BASE_IDS, (id) => MAP_BASES[id].dropWeight) ?? MAP_BASE_IDS[0];
}

function makeMap(rng: Rng, tier: number, m: number, quality: number): MapItem {
  const baseId = pickMapBase(rng);
  const rarity = rollMapRarity(rng, m);
  return rollMapWithRarity(rng, baseId, clampTier(tier), rarity, randomUid(rng), quality, true);
}

function droppedMapQuality(rng: Rng): number {
  return rng.chance(DROPPED_MAP_QUALITY.chance) ? rng.int(DROPPED_MAP_QUALITY.min, DROPPED_MAP_QUALITY.max) : 0;
}

/** A random map drop: same tier 60% · one lower 25% · one higher 15% (within 1–15). */
function makeRandomMap(ctx: LootContext, rng: Rng, m: number): MapItem {
  const offset = rng.weighted(MAP_DROP_TIER_OFFSETS, (o) => o.weight)?.offset ?? 0;
  const tier = Math.max(MIN_MAP_TIER, Math.min(MAX_MAP_TIER, ctx.tier + offset));
  return makeMap(rng, tier, m, droppedMapQuality(rng));
}

function rollCategory(cat: LootCategory, ctx: LootContext, rng: Rng, m: number, origin: string): Item {
  switch (cat) {
    case 'currency': return makeCurrency(ctx, rng);
    case 'equipment': return makeEquipment(ctx, rng, rollEquipmentRarity(rng, m), origin);
    case 'flask': return makeFlask(rng);
    case 'map': return makeRandomMap(ctx, rng, m);
  }
}

// ---------------------------------------------------------------------------------------------
// Kill & chest loot
// ---------------------------------------------------------------------------------------------

function killOrigin(ctx: LootContext, kill: KillLootContext, echo: boolean): string {
  const where = echo ? `the Echo wave of ${ctx.place}` : ctx.place;
  if (kill.isBoss || kill.isLieutenant) return `Dropped by ${monsterSentenceName(kill.kind)} in ${where}`;
  if (kill.rarity === 'rare' || kill.rarity === 'magic') return `Dropped by a ${kill.rarity} ${monsterName(kill.kind)} in ${where}`;
  return `Dropped in ${where}`;
}

/** One looter's luck on one kill: personal luck × monster rarity (and the Echo wave's double quantity). */
export interface KillLuck {
  /** Final item quantity % for this kill. */
  quantity: number;
  /** Final item rarity % for this kill. */
  rarity: number;
  /** The kill was in the Echo wave. */
  echo: boolean;
  /** The looter's personal luck before the monster multipliers (used by the guaranteed drops). */
  personal: Luck;
}

function killLuckFrom(ctx: LootContext, personal: Luck, kill: KillLootContext): KillLuck {
  const mult = kill.isBoss || kill.isLieutenant ? ELITE_LOOT_MULTIPLIER : (MONSTER_LOOT_MULTIPLIERS[kill.rarity] ?? MONSTER_LOOT_MULTIPLIERS.normal);
  const echo = ctx.echoWave > 0 && kill.wave >= ctx.echoWave;
  const quantity = personal.itemQuantity * mult.quantity * (echo ? 1 + ECHO_WAVE_QUANTITY_MORE / 100 : 1);
  return { quantity, rarity: personal.itemRarity * mult.rarity, echo, personal };
}

function chancesFrom(ctx: LootContext, luck: KillLuck): Record<LootCategory, number> {
  const out = {} as Record<LootCategory, number>;
  for (const cat of CATEGORY_ORDER) out[cat] = CATEGORY_CHANCE[cat] * (luck.quantity / 100) * (cat === 'map' ? ctx.mapChance : 1);
  return out;
}

/**
 * Final quantity/rarity (%) of `looter`'s roll on a kill, after monster rarity and the Echo wave.
 * `looter` null = map-side luck only (no gear).
 */
export function killLuck(setup: RunSetup, kill: KillLootContext, looter: CharacterSave | null = null): KillLuck {
  return killLuckFrom(lootContext(setup), lootLuck(setup, looter), kill);
}

/** Chance per kill of each category for `looter` (may exceed 1: then several drop). */
export function categoryChances(setup: RunSetup, kill: KillLootContext, looter: CharacterSave | null = null): Record<LootCategory, number> {
  const ctx = lootContext(setup);
  return chancesFrom(ctx, killLuckFrom(ctx, lootLuck(setup, looter), kill));
}

/** A kill that never drops anything: summoned minions (defensive — the sim never asks) and the training dummy. */
function dropsNothing(kill: KillLootContext): boolean {
  return kill.summoned === true || kill.kind === 'trainingDummy';
}

/**
 * Everything a monster drops for ONE looter (instanced loot): the ordinary per-category rolls with the
 * looter's personal luck, then the lieutenant's / boss's guarantees. `looter` null = map-side luck only.
 */
export function rollKillLoot(setup: RunSetup, kill: KillLootContext, rng: Rng, looter: CharacterSave | null): Item[] {
  if (dropsNothing(kill)) return [];
  const ctx = lootContext(setup);
  const luck = killLuckFrom(ctx, lootLuck(setup, looter), kill);
  const chances = chancesFrom(ctx, luck);
  const origin = killOrigin(ctx, kill, luck.echo);
  const m = luck.rarity / 100;
  const out: Item[] = [];
  for (const cat of CATEGORY_ORDER) {
    const n = rollTimes(rng, chances[cat]);
    for (let i = 0; i < n; i++) out.push(rollCategory(cat, ctx, rng, m, origin));
  }

  // Guarantees use the looter's personal rarity (the elite multiplier already boosts the ordinary roll above).
  const mapM = luck.personal.itemRarity / 100;
  if (kill.isLieutenant) {
    out.push(makeEquipment(ctx, rng, rollEquipmentRarity(rng, mapM, 'magic'), origin));
    const min: Rarity = rng.chance(LIEUTENANT_LOOT.rareChance) ? 'rare' : 'magic';
    out.push(makeEquipment(ctx, rng, rollEquipmentRarity(rng, mapM, min), origin));
    for (let i = 0; i < LIEUTENANT_LOOT.currency; i++) out.push(makeCurrency(ctx, rng));
    if (rng.chance(LIEUTENANT_LOOT.mapChance)) out.push(makeRandomMap(ctx, rng, mapM));
  }
  if (kill.isBoss) {
    out.push(makeEquipment(ctx, rng, 'rare', origin));
    for (let i = 0; i < BOSS_LOOT.extraEquipment; i++) out.push(makeEquipment(ctx, rng, rollEquipmentRarity(rng, mapM, 'magic'), origin));
    for (let i = 0; i < BOSS_LOOT.currency; i++) out.push(makeCurrency(ctx, rng));
    if (rng.chance(Math.min(1, BOSS_LOOT.uniqueChance * mapM))) out.push(makeEquipment(ctx, rng, 'unique', origin));
  }
  return out;
}

/**
 * The completion chest for ONE looter (every player present gets their own): 2 equipment (at least
 * magic), 3–6 currency, 1 flask and a map one tier higher, rolled with the looter's personal rarity.
 */
export function rollChestLoot(setup: RunSetup, rng: Rng, looter: CharacterSave | null): Item[] {
  const ctx = lootContext(setup);
  const m = lootLuck(setup, looter).itemRarity / 100;
  const origin = `Found in the reward chest of ${ctx.place}`;
  const out: Item[] = [];
  for (let i = 0; i < CHEST_LOOT.equipment; i++) out.push(makeEquipment(ctx, rng, rollEquipmentRarity(rng, m, 'magic'), origin));
  const currency = rng.int(CHEST_LOOT.currency.min, CHEST_LOOT.currency.max);
  for (let i = 0; i < currency; i++) out.push(makeCurrency(ctx, rng));
  for (let i = 0; i < CHEST_LOOT.flasks; i++) out.push(makeFlask(rng));
  const tier = Math.min(MAX_MAP_TIER, ctx.tier + CHEST_LOOT.mapTierBonus);
  out.push(makeMap(rng, tier, m, rng.int(CHEST_MAP_QUALITY.min, CHEST_MAP_QUALITY.max)));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Ground drops
// ---------------------------------------------------------------------------------------------

/** Short label for a drop plate or toast ("Forge Scrap x3", "Howling Crucible (T4)"). ASCII only. */
export function dropLabel(item: Item): string {
  switch (item.kind) {
    case 'equipment':
      return asciiLabel(itemDisplayName(item));
    case 'currency': {
      const name = findCurrency(item.currencyId)?.name ?? 'Currency';
      return asciiLabel(item.count > 1 ? `${name} x${item.count}` : name);
    }
    case 'flask': {
      const name = findFlask(item.flaskId)?.name ?? 'Flask';
      return asciiLabel(item.count > 1 ? `${name} x${item.count}` : name);
    }
    case 'map':
      return asciiLabel(`${mapTitle(item)} (T${item.tier})`);
  }
}

function dropTone(item: Item): DropTone {
  if (item.kind === 'equipment') return item.rarity;
  return item.kind;
}

function dropIcon(item: Item): string {
  switch (item.kind) {
    case 'equipment': return item.uniqueId ? iconIdForUnique(item.uniqueId) : iconIdForBase(item.baseId);
    case 'currency': return iconIdForCurrency(item.currencyId);
    case 'flask': return iconIdForFlask(item.flaskId);
    case 'map': return iconIdForMap(item.baseId);
  }
}

/**
 * What the sim needs to show a ground drop: `token` (the server's handle for the item) and `owner` (the
 * sim player id who alone sees and picks it up; 0 = public) are assigned by the caller. The iconId also
 * tells the presenter which currency it is (e.g. "icon/currency/voidNeedle" earns a beam).
 *
 * autoPickup (GAME_SPEC §12): currency, flasks and maps are collected by walking over them; equipment is
 * picked up by clicking. A public drop (owner 0) — and anything `playerDropped` (an item a player threw
 * on the floor) — is never auto-collected, not even by the player who dropped it: anyone may click it,
 * nobody sweeps it up by walking past. So dropSpec(item, token, 0) is click-only even without the flag.
 */
export function dropSpec(item: Item, token: number, owner: number, playerDropped = false): DropSpec {
  return {
    token,
    owner,
    autoPickup: !playerDropped && owner !== 0 && item.kind !== 'equipment',
    label: dropLabel(item),
    tone: dropTone(item),
    sprite: item.kind as DropSprite,
    iconId: dropIcon(item),
  };
}
