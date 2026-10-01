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
// Equipment rarity weights with m = R / 100: normal 70 · magic 22·m · rare 1.6·m^1.3 · unique 0.2·m^1.5.
// A unique is picked among those wearable at the drop's item level (the unique's and its base's level
// requirement ≤ monster level); when none is, the drop becomes a rare.
// Summoned minions (and the training dummy) never drop anything.
import type { MapTreeNodeId } from '../../contracts/atlas';
import { atlasCurrencyWeight, atlasStat, resolveAtlasRules, treeContextOf, type AtlasRules, type TreeContext } from './atlas-rules';
import type { MapRouting, RunSetup } from '../../contracts/game';
import type { AtlasAreaId } from '../../contracts/atlas';
import { AREA_SCARAB_SHARE, SCARABS, SCARAB_DROP_CHANCE } from '../../data/scarabs';
import { GRAND_HOURGLASS, HOURGLASS_SAND } from '../../data/progression/territory';
import { hashString } from '../../core/rng';
import type { CharacterSave, CurrencyStack, EquipmentItem, FlaskStack, Item, MapItem, Rarity } from '../../contracts/items';
import type { CurrencyId, ItemClass, MapBaseId } from '../../contracts/content';
import { ITEM_CLASSES, MAP_BASE_IDS, iconIdForBase, iconIdForCurrency, iconIdForFlask, iconIdForMap, iconIdForUnique } from '../../contracts/content';
import type { DropSpec, DropSprite, DropTone, KillLootContext } from '../../contracts/sim';
import type { ChestBoons, EventRewardContext } from '../../contracts/map-events';
import type { Rng } from '../../contracts/rng';
import {
  BOSS_LOOT, CATEGORY_CHANCE, CATEGORY_ORDER, CHEST_LOOT, CHEST_MAP_QUALITY, CURRENCY_DROPS, DROPPED_MAP_QUALITY,
  ECHO_WAVE_QUANTITY_MORE, ELITE_LOOT_MULTIPLIER, EQUIPMENT_RARITY_WEIGHTS, FLASK_DROPS, LIEUTENANT_LOOT, MAP_BASES,
  MAP_RARITY_WEIGHTS, MAX_MAP_QUALITY, MAX_MAP_TIER, MIN_MAP_TIER, MONSTER_LOOT_MULTIPLIERS,
} from '../../data/progression';
import type { CurrencyDropDef, LootCategory, RarityWeightDef } from '../../data/progression';
import { ARMOUR_CLASSES, findCurrency, findFlask, getBase } from '../../data/items';
import {
  currencyStack, flaskStack, generateEquipment, generateUnique, itemDisplayName, pickRandomBase, pickRandomUnique, randomUid,
} from '../items';
import type { Luck } from './luck';
import { lootLuck, lootLuckWithoutSurge, surgeMultiplier } from './luck';
import {
  clampTier, echoWaveIndex, mapBaseName, mapDropMultipliers, mapTitle, monsterName, monsterSentenceName, rollMapWithRarity,
} from './maps';
import { areaForTheme } from './map-binding';
import { advanceFor, routeMapDrop } from './map-routing';
import { ROUTING_NO_ADVANCE_QUALITY, ROUTING_TIER_OFFSETS } from '../../data/progression/routing';
import { asciiLabel, rollCountTable } from './util';
import { flattenMapEvents } from './map-events';
import { RING_VOW_REWARD } from '../../data/progression/events/ring';
import { ATLAS_KEYS, ATLAS_GLOBAL_KEY_CHANCE, ATLAS_GLOBAL_KEY_MIN_TIER, findAtlasArea, KEYSTONE_UNIQUE_CHANCE, RELIQUARY_KEY_CHANCE, type AtlasAreaDef } from '../../data/progression/atlas';

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
  /** Atlas tree: resolved rules for this expedition and the multipliers read from them. */
  atlas: AtlasRules;
  equipmentStability: number;
  equipmentDrop: number;
  scarabDrop: number;
  bossLoot: number;
  chestLoot: number;
  chestCurrency: number;
  chestRareChance: number;
  chestUpgrade: number;
  chestQuality: number;
  droppedMapQuality: number;
  ingredientMore: number;
  bossUniqueMore: number;
  normalQuantity: number;
  rareQuantity: number;
  /** The surge's item-quantity multiplier (1 without surge): taken back out of the map category (I1). */
  surgeQuantity: number;
  /** Tree: multiplier on every Hourglass Sand chance (Trailmark). */
  sandMore: number;
  echoWave: number;
  place: string;
  area?: AtlasAreaDef;
  lootClass?: ItemClass;
  crownEncounter: boolean;
  /** The looter's charted areas (a per-looter view of the context): a dropped map is bound to an area they can open. */
  discovered?: ReadonlySet<string>;
  /** The expedition's frozen drop routing (brief D 4); absent on runs frozen before routing: maps then roll a theme as before. */
  routing?: MapRouting;
}

const CONTEXTS = new WeakMap<RunSetup, LootContext>();
const LOOTER_CONTEXTS = new WeakMap<LootContext, WeakMap<object, LootContext>>();

/** The run's loot context seen by one looter (their Atlas decides which area a dropped map is bound to). */
function lootContextFor(setup: RunSetup, looter: CharacterSave | null): LootContext {
  const base = lootContext(setup);
  const atlas = looter?.atlas;
  if (!atlas) return base;
  let views = LOOTER_CONTEXTS.get(base);
  if (!views) LOOTER_CONTEXTS.set(base, views = new WeakMap());
  let view = views.get(atlas);
  if (!view) views.set(atlas, view = { ...base, discovered: new Set<string>(atlas.discovered) });
  return view;
}

/**
 * Which scarab a scarab roll yields: the five area-bias families together take AREA_SCARAB_SHARE of the rolls (equal split, the tier
 * weights of every family are the same), the wave families the rest; a group with nothing eligible at this level yields to the other.
 */
export function pickScarab(rng: Rng, monsterLevel: number) {
  const eligible = SCARABS.filter(s => s.minMonsterLevel <= monsterLevel);
  const area = eligible.filter(s => s.kind === 'area'), wave = eligible.filter(s => s.kind === 'wave');
  const pool = area.length && wave.length ? (rng.chance(AREA_SCARAB_SHARE) ? area : wave) : eligible;
  return rng.weighted(pool, s => s.weight);
}

/** One Hourglass roll on an independent stream (it never moves the ordinary loot stream): `salt` names the source. */
function hourglassRoll(rng: Rng, salt: number, chance: number): boolean {
  return chance > 0 && rng.fork(salt).chance(Math.min(1, chance));
}

const ESSENCES: ReadonlySet<CurrencyId> = new Set<CurrencyId>(['essenceEmber', 'essenceRime', 'essenceStorm', 'essenceVital', 'essenceSwift']);

/** Currency weights after map implicit and reward-mod multipliers (essences). */
export function currencyWeightsFor(map: MapItem, nodes: readonly MapTreeNodeId[] = [], tree: TreeContext = {}): CurrencyDropDef[] {
  const m = mapDropMultipliers(map, nodes, tree);
  const atlas = resolveAtlasRules(nodes, { tier: clampTier(map.tier), baseId: map.baseId, corrupted: map.corrupted, ...tree });
  return CURRENCY_DROPS.map((d) => {
    let weight = d.weight * atlasCurrencyWeight(atlas, d.currencyId);
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
  const tree = treeContextOf(setup);
  const drops = mapDropMultipliers(map, setup.mapTree, tree);
  const atlas = resolveAtlasRules(setup.mapTree, { tier, baseId: map.baseId, corrupted: map.corrupted, ...tree });
  const area = findAtlasArea(setup.atlasAreaId);
  let crownEncounter = false;
  crownEncounter = flattenMapEvents(setup.event).some(e => e.kind === 'secondCrown');
  ctx = {
    map,
    tier,
    monsterLevel: Math.max(1, Math.floor(setup.monsterLevel || 1)),
    mapChance: drops.map,
    currency: currencyWeightsFor(map, setup.mapTree, tree).map((d) => ({ ...d, weight: d.weight * (area?.currencyWeights?.[d.currencyId] ?? 1) })),
    armourStability: drops.armourStability,
    atlas,
    equipmentStability: Math.round(atlasStat(atlas, 'equipmentStability', 0)),
    equipmentDrop: Math.max(0, atlasStat(atlas, 'equipmentDropChance', 1)),
    scarabDrop: Math.max(0, atlasStat(atlas, 'scarabDropChance', 1)),
    bossLoot: Math.max(0, atlasStat(atlas, 'bossLoot', 1)),
    chestLoot: Math.max(0, atlasStat(atlas, 'chestLoot', 1)),
    chestCurrency: Math.max(0, Math.round(atlasStat(atlas, 'chestCurrency', 0))),
    chestRareChance: Math.min(1, Math.max(0, atlasStat(atlas, 'chestRareChance', 0) / 100)),
    chestUpgrade: Math.max(0, atlasStat(atlas, 'chestUpgradeChance', 0) / 100),
    chestQuality: Math.max(0, atlasStat(atlas, 'chestQuality', 0)),
    droppedMapQuality: Math.max(0, atlasStat(atlas, 'droppedMapQuality', 0)),
    ingredientMore: Math.max(0, atlasStat(atlas, 'bossIngredientChance', 1)),
    bossUniqueMore: Math.max(0, atlasStat(atlas, 'bossUnique', 1)),
    normalQuantity: Math.max(0, atlasStat(atlas, 'normalQuantity', 1)),
    rareQuantity: Math.max(0, atlasStat(atlas, 'rareQuantity', 1)),
    surgeQuantity: surgeMultiplier(setup.surge?.quantityMore),
    sandMore: Math.max(0, atlasStat(atlas, 'sandChance', 1)),
    echoWave: echoWaveIndex(map),
    place: `${area?.name ?? mapBaseName(map.baseId)} (Tier ${tier})`,
    area,
    lootClass: setup.lootClass,
    crownEncounter,
    ...(setup.routing ? { routing: setup.routing } : {}),
  };
  CONTEXTS.set(setup, ctx);
  return ctx;
}

// ---------------------------------------------------------------------------------------------
// Item makers
// ---------------------------------------------------------------------------------------------

function makeEquipment(ctx: LootContext, rng: Rng, rarity: Rarity, origin: string, itemClass?: ItemClass): EquipmentItem {
  if (rarity === 'unique') {
    // Only uniques wearable at the drop's item level; with none (below level 12) the roll becomes a rare.
    const id = pickRandomUnique(rng, { maxLevel: ctx.monsterLevel });
    if (id) return generateUnique(id, rng, { itemLevel: ctx.monsterLevel, origin, isNew: true });
    rarity = 'rare';
  }
  const baseId = pickRandomBase(rng, { itemLevel: ctx.monsterLevel, classWeights: ctx.area?.classWeights,
    ...(itemClass ? { classes: [itemClass] } : {}) }) ?? 'ashwoodWand';
  // Blank Slate: every non-unique drop is Normal (its Item Rarity effect is gone with the magic and rare rolls).
  if (ctx.atlas.equipmentNormalOnly) rarity = 'normal';
  const extraStability = (ARMOUR_CLASSES.includes(getBase(baseId).itemClass) ? ctx.armourStability : 0) + ctx.equipmentStability;
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

/** How one map drop is addressed: the tier offset (-1, 0, +1) and, for the chest upgrade, a forced destination. */
interface MapDropRoll {
  offset?: number;
  /** The chest upgrade's advance target: the area is not drawn (one draw is still consumed, so the stream stays aligned). */
  area?: AtlasAreaId;
  /** Boss-kill and chest drops may name the pending (about to be revealed) areas (D 4.3). */
  pending?: boolean;
}

/**
 * THE map drop entry point (brief D 4). Exactly one rng draw picks the addressee. With a frozen routing table that is a weighted
 * pick over the run's own area, its charted neighbours, the wander tail, pins and (boss/chest only) the pending reveals; the tier
 * is the run's plus the offset, clamped to the pick's ceiling (an upward roll only names areas that accept it). Without routing
 * (a run frozen before it, or a table that holds nothing the looter has charted) the theme is rolled as in T0 and the area follows
 * from it. Quality, rarity and mods are rolled as before.
 */
function makeMap(ctx: LootContext, rng: Rng, m: number, quality: number, roll: MapDropRoll = {}): MapItem {
  const offset = roll.offset ?? 0;
  let areaId: AtlasAreaId | undefined;
  let t = clampTier(ctx.tier + offset);
  if (roll.area) {
    rng.next();
    areaId = roll.area;
  } else if (ctx.routing) {
    const drop = routeMapDrop(ctx.routing, { tier: ctx.tier, offset, pending: roll.pending === true, ...(ctx.discovered ? { discovered: ctx.discovered } : {}) }, rng);
    if (drop) { areaId = drop.areaId; t = drop.tier; }
  }
  const baseId = areaId ? undefined : pickMapBase(rng);
  const rarity = rollMapRarity(rng, m);
  const uid = randomUid(rng);
  return rollMapWithRarity(rng, areaId ?? areaForTheme(baseId!, t, uid, ctx.discovered, ctx.area?.id), t, rarity, uid, quality, true);
}

function droppedMapQuality(rng: Rng, bonus = 0): number {
  return Math.min(MAX_MAP_QUALITY, (rng.chance(DROPPED_MAP_QUALITY.chance) ? rng.int(DROPPED_MAP_QUALITY.min, DROPPED_MAP_QUALITY.max) : 0) + bonus);
}

/** A random map drop: same tier 60% · one lower 25% · one higher 15% (within 1–15); `pending` = boss-kill drop. */
function makeRandomMap(ctx: LootContext, rng: Rng, m: number, pending = false): MapItem {
  const offset = rng.weighted(ctx.routing?.tierOffsets ?? ROUTING_TIER_OFFSETS, (o) => o.weight)?.offset ?? 0;
  return makeMap(ctx, rng, m, droppedMapQuality(rng, ctx.droppedMapQuality), { offset, pending });
}

function rollCategory(cat: LootCategory, ctx: LootContext, rng: Rng, m: number, origin: string, pending = false): Item {
  switch (cat) {
    case 'currency': return makeCurrency(ctx, rng);
    case 'equipment': return makeEquipment(ctx, rng, rollEquipmentRarity(rng, m), origin);
    case 'flask': return makeFlask(rng);
    case 'map': return makeRandomMap(ctx, rng, m, pending);
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

/** `personal` includes the surge (ordinary rolls); `base` is the same luck without it (guarantees, rewards: the KillLuck's `personal`). */
function killLuckFrom(ctx: LootContext, personal: Luck, kill: KillLootContext, base: Luck = personal): KillLuck {
  const elite = kill.isBoss || kill.isLieutenant;
  const mult = elite ? ELITE_LOOT_MULTIPLIER : (MONSTER_LOOT_MULTIPLIERS[kill.rarity] ?? MONSTER_LOOT_MULTIPLIERS.normal);
  const echo = ctx.echoWave > 0 && kill.wave >= ctx.echoWave;
  // Atlas tree: Rare Blood / Rare or Nothing pay rare monsters, Kingslayer's Tithe taxes the ordinary ones.
  const treeMore = elite ? 1 : kill.rarity === 'rare' ? ctx.rareQuantity : kill.rarity === 'normal' ? ctx.normalQuantity : 1;
  // Map events: a Pact Altar wave and Stasis Host statues add percent quantity / rarity to this one kill.
  const eventQuantity = 1 + Math.max(0, kill.quantityMore ?? 0) / 100;
  const eventRarity = 1 + Math.max(0, kill.rarityMore ?? 0) / 100;
  const quantity = personal.itemQuantity * mult.quantity * treeMore * (echo ? 1 + ECHO_WAVE_QUANTITY_MORE / 100 : 1) * eventQuantity;
  return { quantity, rarity: personal.itemRarity * mult.rarity * eventRarity, echo, personal: base };
}

function chancesFrom(ctx: LootContext, luck: KillLuck): Record<LootCategory, number> {
  const out = {} as Record<LootCategory, number>;
  // Surge quantity applies to every category except maps, so the daily clock never changes map volume (brief D I1).
  for (const cat of CATEGORY_ORDER) out[cat] = CATEGORY_CHANCE[cat] * (luck.quantity / (cat === 'map' ? ctx.surgeQuantity : 1) / 100)
    * (cat === 'map' ? ctx.mapChance : cat === 'currency' ? ctx.area?.currencyMultiplier ?? 1 : cat === 'equipment' ? ctx.equipmentDrop : 1);
  return out;
}

/**
 * Final quantity/rarity (%) of `looter`'s roll on a kill, after monster rarity and the Echo wave.
 * `looter` null = map-side luck only (no gear).
 */
export function killLuck(setup: RunSetup, kill: KillLootContext, looter: CharacterSave | null = null): KillLuck {
  return killLuckFrom(lootContext(setup), lootLuck(setup, looter), kill, lootLuckWithoutSurge(setup, looter));
}

/** Chance per kill of each category for `looter` (may exceed 1: then several drop). */
export function categoryChances(setup: RunSetup, kill: KillLootContext, looter: CharacterSave | null = null): Record<LootCategory, number> {
  const ctx = lootContext(setup);
  return chancesFrom(ctx, killLuckFrom(ctx, lootLuck(setup, looter), kill, lootLuckWithoutSurge(setup, looter)));
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
  const ctx = lootContextFor(setup, looter);
  const luck = killLuckFrom(ctx, lootLuck(setup, looter), kill, lootLuckWithoutSurge(setup, looter));
  const chances = chancesFrom(ctx, luck);
  const origin = killOrigin(ctx, kill, luck.echo);
  const m = luck.rarity / 100;
  const out: Item[] = [];
  for (const cat of CATEGORY_ORDER) {
    const n = rollTimes(rng, chances[cat]);
    for (let i = 0; i < n; i++) out.push(rollCategory(cat, ctx, rng, m, origin, kill.isBoss === true));
  }
  // An independent per-kill stream keeps ordinary currency/equipment rolls unchanged.
  // The main stream has advanced through the category rolls, even on a kill with no ordinary drops.
  const scarabRng = rng.fork(0x53434152);
  if (scarabRng.chance(Math.min(1, SCARAB_DROP_CHANCE * luck.quantity / 100 * ctx.scarabDrop))) {
    const scarab = pickScarab(scarabRng, setup.monsterLevel);
    if (scarab) out.push(currencyStack(scarab.id, 1, randomUid(scarabRng), true));
  }

  // Guarantees use the looter's personal rarity (the elite multiplier already boosts the ordinary roll above).
  const mapM = luck.personal.itemRarity / 100;
  if (kill.isLieutenant) {
    // Every guaranteed item is at least magic; the last one is at least rare with rareChance.
    for (let i = 0; i < LIEUTENANT_LOOT.equipment; i++) {
      const min: Rarity = i === LIEUTENANT_LOOT.equipment - 1 && rng.chance(LIEUTENANT_LOOT.rareChance) ? 'rare' : 'magic';
      out.push(makeEquipment(ctx, rng, rollEquipmentRarity(rng, mapM, min), origin));
    }
    for (let i = 0; i < LIEUTENANT_LOOT.currency; i++) out.push(makeCurrency(ctx, rng));
    if (rng.chance(LIEUTENANT_LOOT.mapChance)) out.push(makeRandomMap(ctx, rng, mapM));
  }
  if (kill.isBoss) {
    out.push(makeEquipment(ctx, rng, 'rare', origin));
    for (let i = 0; i < Math.round(BOSS_LOOT.extraEquipment * ctx.bossLoot); i++) out.push(makeEquipment(ctx, rng, rollEquipmentRarity(rng, mapM, 'magic'), origin));
    for (let i = 0; i < Math.round(BOSS_LOOT.currency * (ctx.area?.currencyMultiplier ?? 1) * ctx.bossLoot); i++) out.push(makeCurrency(ctx, rng));
    if (rng.chance(Math.min(1, BOSS_LOOT.uniqueChance * mapM * ctx.bossUniqueMore))) out.push(makeEquipment(ctx, rng, 'unique', origin));
    if (ctx.area?.uniquePool === kill.kind && rng.chance(Math.min(1, KEYSTONE_UNIQUE_CHANCE * mapM * ctx.bossUniqueMore))) {
      const id = pickRandomUnique(rng, { bossSource: kill.kind, maxLevel: ctx.monsterLevel });
      if (id) out.push(generateUnique(id, rng, { itemLevel: ctx.monsterLevel, origin: `Keystone reward from ${monsterName(kill.kind)} in ${ctx.place}`, isNew: true }));
    }
    // Rival Crowns: the rival boss rolls its own theme's exclusive unique (a pool the area never drops otherwise).
    if (kill.rival !== undefined && rng.chance(Math.min(1, KEYSTONE_UNIQUE_CHANCE * kill.rival * mapM * ctx.bossUniqueMore))) {
      const id = pickRandomUnique(rng, { bossSource: kill.kind, maxLevel: ctx.monsterLevel });
      if (id) out.push(generateUnique(id, rng, { itemLevel: ctx.monsterLevel, origin: `Rival reward from ${monsterName(kill.kind)} in ${ctx.place}`, isNew: true }));
    }
    if (ctx.area?.id === 'sealedReliquary' && (!ctx.crownEncounter || kill.eventReward === 'secondCrown')) out.push(makeEquipment(ctx, rng, 'unique', origin));
    // Surge refills (brief D 7.4): independent streams, personal rarity (without the surge) scales the chance, the tree scales Sand.
    if (kill.rival === undefined) {
      const sealed = ctx.area?.sealed ? HOURGLASS_SAND.sealedBossMultiplier : 1;
      if (ctx.tier >= HOURGLASS_SAND.bossMinTier && hourglassRoll(rng, 0x53414e44, HOURGLASS_SAND.bossChance * sealed * mapM * ctx.sandMore)) {
        out.push(currencyStack('hourglassSand', 1, randomUid(rng), true));
      }
      if (ctx.tier >= GRAND_HOURGLASS.bossMinTier && hourglassRoll(rng, 0x4752414e, GRAND_HOURGLASS.bossChance * mapM)) {
        out.push(currencyStack('grandHourglass', 1, randomUid(rng), true));
      }
    }
    for (const drop of ctx.area?.ingredientDrops ?? []) {
      if (ctx.tier >= drop.minTier && rng.chance(Math.min(1, drop.chance * ctx.ingredientMore))) out.push(currencyStack(drop.currencyId, 1, randomUid(rng), true));
    }
    if (ctx.area && !ctx.area.sealed) {
      const chance = ctx.area.id === 'emberVault' ? RELIQUARY_KEY_CHANCE.vault
        : ctx.tier < RELIQUARY_KEY_CHANCE.elsewhereMinTier ? 0
        : ctx.area.type === 'crypt' ? RELIQUARY_KEY_CHANCE.crypt : RELIQUARY_KEY_CHANCE.elsewhere;
      if (chance > 0 && rng.chance(chance)) out.push(currencyStack('reliquaryKey', 1, randomUid(rng), true));
      for (const key of ATLAS_KEYS) {
        if (key.currencyId === 'reliquaryKey') continue;
        const keyChance = ctx.area.type === key.type && ctx.tier >= key.minTier ? key.chance
          : ctx.tier >= ATLAS_GLOBAL_KEY_MIN_TIER ? ATLAS_GLOBAL_KEY_CHANCE : 0;
        if (keyChance > 0 && rng.chance(keyChance)) out.push(currencyStack(key.currencyId, 1, randomUid(rng), true));
      }
    }
  }
  return out;
}

/**
 * What one map event pays ONE looter (Event Director v2). Bronze is the classic payout of the encounter; Silver and Gold add
 * to it. `ctx.choice` is the Caravan lock (0 coffer, 1 reliquary, 2 cartographer's tube, 3 all-locks bonus).
 * Grade 0 is a small consolation (never a punishment). Called once per living player, in a fixed order.
 */
export function rollEventReward(setup: RunSetup, ctx: EventRewardContext, rng: Rng, looter: CharacterSave | null): Item[] {
  const lc = lootContextFor(setup, looter);
  const m = lootLuckWithoutSurge(setup, looter).itemRarity / 100;
  const out: Item[] = [];
  const grade = ctx.grade;
  const place = lc.place;
  const rare = (origin: string, cls?: ItemClass) => out.push(makeEquipment(lc, rng, 'rare', origin, cls));
  const cur = (id: CurrencyId, n = 1) => out.push(currencyStack(id, n, randomUid(rng), true));
  const bonus = Math.min(1, Math.max(0, ctx.multiplier - 1));
  switch (ctx.kind) {
    case 'hunted': {
      if (grade < 1) break;
      const cls = lc.area?.chosenClass ? lc.lootClass : undefined;
      rare(`Reward from The Stalker in ${place}`, cls);
      if (grade >= 2) out.push(makeCurrency(lc, rng));
      if (grade >= 3) {
        rare(`Gold trophy of The Stalker in ${place}`, cls);
        if (rng.chance(0.25 + ctx.ingredientBonus)) cur('compass');
        if (lc.tier >= 5 && rng.chance(0.05)) out.push(makeEquipment(lc, rng, 'unique', `Gold trophy of The Stalker in ${place}`));
      }
      break;
    }
    case 'echoRift': {
      cur('mapDust');
      if (grade < 1) break;
      cur('reforge');
      if (lc.tier >= 3 && rng.chance(0.5 + ctx.ingredientBonus)) cur('echoShard');
      if (lc.area?.id === 'riftNexus') cur(rng.pick(['echoShard', 'twinInk', 'voidSplinter'] as const));
      if (grade >= 2) cur('echoShard');
      if (grade >= 3) {
        cur('echoShard');
        rare(`Gold trophy of The Echoing in ${place}`);
      }
      break;
    }
    case 'blackout': {
      if (grade < 1) { cur('scrap', rng.int(2, 3)); break; }
      cur('seal');
      cur('scrap', rng.int(4, 6));
      if (grade >= 2 && rng.chance(0.1 + ctx.ingredientBonus)) cur('suffixRune');
      if (grade >= 3 && rng.chance(0.15 + ctx.ingredientBonus)) cur('fractureCore');
      break;
    }
    case 'vaultbreakers': {
      if (ctx.choice === 0) {
        for (let n = 0; n < 3 * (lc.area?.currencyMultiplier ?? 1); n++) out.push(makeCurrency(lc, rng));
        if ((lc.tier >= 3 || lc.area?.id === 'gildedVault') && rng.chance(0.2 + ctx.ingredientBonus)) cur('twinInk');
      } else if (ctx.choice === 1) {
        out.push(makeEquipment(lc, rng, rollEquipmentRarity(rng, m, 'magic'), `Reliquary chest of the Laden Caravan in ${place}`));
      } else if (ctx.choice === 2) {
        out.push(makeMap(lc, rng, m, rng.int(CHEST_MAP_QUALITY.min, CHEST_MAP_QUALITY.max), { offset: 1 }));
      } else {
        if (rng.chance(0.5 + ctx.ingredientBonus)) cur('twinInk');
        cur('compass');
      }
      if (ctx.choice < 3 && rng.chance(bonus)) out.push(makeCurrency(lc, rng));
      break;
    }
    case 'secondCrown': {
      const fragment = lc.tier >= 5 || lc.area?.id === 'sealedReliquary';
      if (grade < 1) break;
      if (fragment) cur('crownFragment');
      if (grade >= 2 && fragment) cur('crownFragment');
      if (grade >= 3) out.push(makeEquipment(lc, rng, 'unique', `Gold trophy of Rival Crowns in ${place}`));
      break;
    }
    case 'wound': {
      const splinter = lc.tier >= 3 || lc.area?.id === 'blackPit';
      if (grade < 1) { if (splinter && rng.chance(0.25)) cur('voidSplinter'); }
      else {
        if (splinter) cur('voidSplinter');
        if (grade >= 2) cur(rng.pick(['solvent', 'catalyst'] as const));
        if (grade >= 3) {
          if (splinter) cur('voidSplinter');
          rare(`Gold trophy of The Fault in ${place}`);
        }
      }
      if (lc.area?.id === 'blackPit' && grade >= 1) cur('twinInk');
      break;
    }
    // Wave 2 of events: each case is owned by its event (docs/atlas-rework/C-map-events.md 7, GAME_SPEC map events).
    case 'pactAltar': {
      // Ember Tax: a consolation at the choice (choice 10). The final payout follows the bold pacts kept (Bronze 1, Silver 2, Gold 2 without a death).
      if (ctx.choice === 10) { cur('scrap', 5); break; }
      if (grade < 1) break;
      cur('scrap', rng.int(3, 5));
      if (grade >= 2) out.push(makeCurrency(lc, rng));
      if (grade >= 3) cur('seal');
      break;
    }
    case 'orchard': {
      // A harvest pays at the bloom: choice = kind * 4 + stage (kind 0 Essence, 1 Seal, 2 Metal); choice 0 is the final grade payout.
      if (ctx.choice === 0) {
        if (grade < 1) break;
        cur('scrap', rng.int(1, 2));
        if (grade >= 2) out.push(makeCurrency(lc, rng));
        if (grade >= 3) cur('voidSplinter');
        break;
      }
      const kind = Math.floor(ctx.choice / 4), stage = ctx.choice % 4;
      if (stage <= 0) break;
      const base = String(lc.map.baseId);
      const essence: CurrencyId = base === 'rimedOssuary' || base === 'choralCrypt' ? 'essenceRime'
        : base === 'ironColiseum' || base === 'chainworks' ? 'essenceStorm' : 'essenceEmber';
      if (stage === 1) cur('scrap', rng.int(2, 3));
      else if (kind === 0) cur(essence, stage === 3 ? 2 : 1);
      else if (kind === 1) { cur('seal', stage === 3 ? 2 : 1); if (stage === 3 && rng.chance(0.4 + ctx.ingredientBonus)) cur('suffixRune'); }
      else { cur(rng.pick(['solvent', 'catalyst'] as const), stage === 3 ? 2 : 1); if (stage === 3 && rng.chance(0.4 + ctx.ingredientBonus)) cur('catalyst'); }
      break;
    }
    case 'ring': {
      // Champion's Ring: a rare armour base; the vow taken multiplies it (choice 0 Bare Hands x1.5, 1 Iron Pride x1.3, 2 Crowd's
      // Favour x1.3, 3 = left the ring: no multiplier) as extra rolls; Fracture Core chance; Gold adds a unique-eligible roll.
      if (grade < 1) break;
      const armour = () => rng.pick(['helmet', 'chest', 'gloves', 'boots'] as const);
      rare(`Champion's reward in ${place}`, armour());
      const more = Math.max(0, (RING_VOW_REWARD[ctx.choice] ?? 1) - 1);
      if (rng.chance(more)) rare(`Champion's vow reward in ${place}`, armour());
      if (more > 0) out.push(makeCurrency(lc, rng));
      if (rng.chance((grade >= 2 ? 0.2 : 0.1) + ctx.ingredientBonus)) cur('fractureCore');
      if (grade >= 2) out.push(makeCurrency(lc, rng));
      if (grade >= 3 && rng.chance(0.05)) out.push(makeEquipment(lc, rng, 'unique', `Gold trophy of the Champion's Ring in ${place}`));
      break;
    }
    case 'host': {
      // Stasis Host: the statues dropped their own loot; this is the prism and the pace. choice 1 = the prism was shattered (pays double).
      if (grade < 1) break;
      const shattered = ctx.choice === 1;
      cur('scrap', rng.int(3, 5));
      out.push(makeCurrency(lc, rng));
      if (shattered) {
        out.push(makeEquipment(lc, rng, 'rare', `Shattered prism of the Stasis Host in ${place}`, rng.pick(['ring', 'amulet'] as const)));
        if (rng.chance(0.35 + ctx.ingredientBonus)) cur(rng.pick(['prefixRune', 'suffixRune'] as const));
      }
      if (grade >= 2) { cur(rng.pick(['solvent', 'catalyst'] as const)); if (shattered) out.push(makeCurrency(lc, rng)); }
      if (grade >= 3) {
        rare(`Gold trophy of the Stasis Host in ${place}`);
        if (rng.chance(0.25 + ctx.ingredientBonus)) cur('voidSplinter');
      }
      break;
    }
    case 'anvil': {
      // The boon (chosen on the stones) is the reward and rides on the completion chest; the event itself pays a little on top:
      // Scrap for Bronze, a weighted currency roll for Silver and Gold.
      if (grade < 1) break;
      cur('scrap', rng.int(3, 5));
      if (grade >= 2) out.push(makeCurrency(lc, rng));
      if (grade >= 3) out.push(makeCurrency(lc, rng));
      break;
    }
    case 'bellwatch': {
      // choice 0..3: one currency roll per fallen Cantor (paid the moment it falls); choice 4: the final payout by grade.
      if (grade < 1) break;
      if (ctx.choice < 4) { out.push(makeCurrency(lc, rng)); break; }
      if (grade >= 2 && rng.chance(0.35 + ctx.ingredientBonus)) cur('prefixRune');
      if (grade >= 3) {
        if (rng.chance(0.6 + ctx.ingredientBonus)) cur('prefixRune');
        rare(`Gold trophy of the Bellwatch in ${place}`, rng.pick(['amulet', 'ring'] as const));
      }
      break;
    }
    case 'voidBreach': {
      // `ctx.choice` carries the Voidtouched Atlas strength (percent): it raises the extra-roll chances.
      const strength = 1 + Math.max(0, ctx.choice) / 100;
      if (grade < 1) { if (rng.chance(Math.min(1, 0.25 * strength))) cur('voidSplinter'); break; }
      cur('voidSplinter');
      cur('scrap', rng.int(3, 5));
      if (grade >= 2) {
        if (rng.chance(Math.min(1, (0.4 + ctx.ingredientBonus) * strength))) cur('twinInk');
        out.push(makeCurrency(lc, rng));
      }
      if (grade >= 3) {
        cur('voidSplinter');
        rare(`Gold trophy of the Void Breach in ${place}`);
        if (rng.chance(Math.min(1, (0.15 + ctx.ingredientBonus) * strength))) cur('fractureCore');
      }
      break;
    }
  }
  if (grade >= 1 && ctx.kind !== 'vaultbreakers' && rng.chance(bonus)) out.push(makeCurrency(lc, rng));
  // Gold-grade completions can pay Hourglass Sand (brief D 7.4, independent stream; Twin Omens may still trim it with the rest).
  if (grade >= 3 && hourglassRoll(rng, 0x474f4c44, HOURGLASS_SAND.goldEventChance * lc.sandMore)) cur('hourglassSand');
  // Twin Omens: every event pays less (each extra item has a chance to be lost; the first is always kept).
  if (ctx.multiplier < 1) return out.filter((_, k) => k === 0 || rng.chance(Math.max(0, ctx.multiplier)));
  return out;
}

const RARITY_RANK: Record<string, number> = { normal: 0, magic: 1, rare: 2, unique: 3 };

/** How good a rolled item is (Recast keeps the better of two): rarity, affix count, affix tiers, then implicit strength. */
function itemScore(item: EquipmentItem): number {
  let s = (RARITY_RANK[item.rarity] ?? 0) * 10000 + item.affixes.length * 1000;
  for (const a of item.affixes) s += Math.max(0, 6 - a.tier) * 40;
  const implicits = getBase(item.baseId).implicits;
  implicits.forEach((imp, k) => { s += imp.max > imp.min ? ((item.implicitValues[k] - imp.min) / (imp.max - imp.min)) * 30 : 0; });
  return s;
}

/**
 * One completion-chest equipment with the Wayside Anvil's boons: Tempered adds a maximum Stability, Keen rolls every implicit at
 * its best, Attuned picks the class (ignored when no base of it exists at the item level), Recast rolls twice and keeps the better.
 */
function chestEquipment(ctx: LootContext, rng: Rng, rarity: Rarity, origin: string, boons?: ChestBoons): EquipmentItem {
  if (!boons) return makeEquipment(ctx, rng, rarity, origin);
  const c = boons.stability > 0 ? { ...ctx, equipmentStability: ctx.equipmentStability + Math.floor(boons.stability) } : ctx;
  let itemClass = boons.itemClass && (ITEM_CLASSES as readonly string[]).includes(boons.itemClass) ? (boons.itemClass as ItemClass) : undefined;
  if (itemClass && !pickRandomBase(rng.fork(0x61747475), { itemLevel: ctx.monsterLevel, classes: [itemClass] })) itemClass = undefined;
  const make = (): EquipmentItem => {
    const item = makeEquipment(c, rng, rarity, origin, itemClass);
    if (boons.keen && item.rarity !== 'unique') item.implicitValues = getBase(item.baseId).implicits.map((imp) => imp.max);
    return item;
  };
  if (!boons.recast) return make();
  const a = make(), b = make();
  return itemScore(b) > itemScore(a) ? b : a;
}

/**
 * The completion chest for ONE looter: equipment of at least magic rarity, currency, a flask and
 * a map at the current tier (25% chance of +1), rolled with the looter's personal rarity.
 */
export function rollChestLoot(setup: RunSetup, rng: Rng, looter: CharacterSave | null, boons?: ChestBoons): Item[] {
  const ctx = lootContextFor(setup, looter);
  const m = lootLuckWithoutSurge(setup, looter).itemRarity / 100;
  const origin = `Found in the reward chest of ${ctx.place}`;
  const out: Item[] = [];
  for (let i = 0; i < Math.round(CHEST_LOOT.equipment * ctx.chestLoot); i++) {
    // Kingmaker's Cache: each chest item is Rare with its own chance; otherwise the ordinary last-item rule.
    const cache = ctx.chestRareChance > 0 && rng.chance(ctx.chestRareChance);
    const min = cache || (i === Math.round(CHEST_LOOT.equipment * ctx.chestLoot) - 1 && rng.chance(CHEST_LOOT.lastRareChance)) ? 'rare' : 'magic';
    out.push(chestEquipment(ctx, rng, rollEquipmentRarity(rng, m, min), origin, boons));
  }
  const currency = Math.round((rng.int(CHEST_LOOT.currency.min, CHEST_LOOT.currency.max) * (ctx.area?.currencyMultiplier ?? 1) + ctx.chestCurrency) * ctx.chestLoot);
  for (let i = 0; i < currency; i++) out.push(makeCurrency(ctx, rng));
  for (let i = 0; i < CHEST_LOOT.flasks; i++) out.push(makeFlask(rng));
  // The guaranteed map: upgrade roll as before (Compass forces it, Deepward adds points). An upgrade is a map of the chest's advance
  // target (the nearest charted area that accepts the next tier); with none it is not upgraded and the map is 3 quality better.
  const upgrade = setup.map.charted || rng.chance(CHEST_LOOT.mapTierUpgradeChance + ctx.chestUpgrade + (ctx.routing?.chestUpgradeBonus ?? 0) / 100);
  let quality = Math.min(MAX_MAP_QUALITY, rng.int(CHEST_MAP_QUALITY.min, CHEST_MAP_QUALITY.max) + Math.round(ctx.chestQuality));
  if (!ctx.routing) out.push(makeMap(ctx, rng, m, quality, { offset: upgrade ? 1 : 0 }));
  else {
    const advance = upgrade && ctx.tier < MAX_MAP_TIER ? advanceFor(ctx.routing, ctx.tier, ctx.discovered) : undefined;
    if (upgrade && ctx.tier < MAX_MAP_TIER && !advance) quality = Math.min(MAX_MAP_QUALITY, quality + ROUTING_NO_ADVANCE_QUALITY);
    out.push(makeMap(ctx, rng, m, quality, advance ? { offset: 1, area: advance, pending: true } : { pending: true }));
  }
  if (rng.chance(CHEST_LOOT.extraMapChance)) out.push(makeRandomMap(ctx, rng, m, true));
  if (hourglassRoll(rng, 0x43485354, HOURGLASS_SAND.chestChance * ctx.sandMore)) out.push(currencyStack('hourglassSand', 1, randomUid(rng), true));
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
    ...(item.kind === 'currency' && SCARABS.some(s => s.id === item.currencyId) ? { scatterSeed: hashString(item.uid) } : {}),
    label: dropLabel(item),
    tone: dropTone(item),
    sprite: item.kind as DropSprite,
    iconId: dropIcon(item),
  };
}
