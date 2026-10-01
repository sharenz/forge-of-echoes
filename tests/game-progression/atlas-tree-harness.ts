// Bot archetype harness for the Atlas tree (brief B section 10). A "kill-stream bot" plays the real map rules: it opens
// a map with the archetype's frozen tree through rules.openMap, then feeds the map's own wave budget, pack rarity and
// monster scaling through the real loot rules (rollKillLoot / rollChestLoot) with common random numbers, valuing every drop
// in Scrap by Rook's appraisal (sellQuote) and a fixed currency table. Clear time comes from a wave-queue model
// (waves arrive on clear or on the timer, the boss wave holds) calibrated so the empty tree clears in a fixed time.
// It is a model of the economy, not the sim: the heavy sim playthroughs (playthrough.ts) confirm survival separately.
import type { AtlasAreaId } from '../../src/contracts/atlas';
import type { CharacterSave, Item, MapItem } from '../../src/contracts/items';
import type { CurrencyId } from '../../src/contracts/content';
import type { RunSetup } from '../../src/contracts/game';
import type { KillLootContext } from '../../src/contracts/sim';
import { createRng } from '../../src/core/rng';
import { getBase } from '../../src/data/items';
import { BASE_MAGIC_PACK_CHANCE, BASE_RARE_PACK_CHANCE, WAVES } from '../../src/data/progression';
import { atlasNodeAllocatable, findAtlasNode, ATLAS_ORIGIN_ID, MAP_TREE } from '../../src/data/progression/map-tree';
import { rules } from '../../src/game';
import { sellQuote } from '../../src/game/progression/merchant';
import { THEME_ROSTER } from '../../src/contracts/bestiary';
import { normalizeMapTree } from '../../src/game/progression/map-tree';
import { attachSurge, surgeBonusFor } from '../../src/game/progression/surge';
import { fullProgress, pathTo } from './atlas-tree-helpers';
import { bareCharacter, expectOk, map, openAt } from './fixtures';

/** Scrap value of one currency (a fixed, roughly market-shaped table; the same for every archetype). */
export const CURRENCY_VALUE: Partial<Record<CurrencyId, number>> = {
  scrap: 1, kindling: 3, mapDust: 5, solvent: 6, reforge: 12, threatGlyph: 10, essenceEmber: 12, essenceRime: 12, essenceStorm: 12,
  essenceVital: 12, essenceSwift: 12, seal: 14, rewardInk: 30, catalyst: 20, voidNeedle: 50, fractureCore: 120, prefixRune: 25,
  suffixRune: 25, scarBalm: 20, anneal: 30, graft: 40, transmute: 15, echoShard: 35, crownFragment: 150, twinInk: 60, voidSplinter: 40,
  compass: 25, reliquaryKey: 40, gildedKey: 40, blackKey: 40, huntingKey: 40, riftKey: 40,
  hasteScarab1: 30, hasteScarab2: 60, hasteScarab3: 120, hasteScarab4: 240, invasionScarab1: 30, invasionScarab2: 60, invasionScarab3: 120, invasionScarab4: 240,
  // Area-bias scarabs are priced like the wave scarabs by tier. Sand is worth what three boosted runs add (set by the surge harness); the Grand Hourglass a whole day's charges.
  ...Object.fromEntries(['homing', 'wayfarer', 'deepward', 'quarry', 'hearthbound'].flatMap(f => [30, 60, 120, 240].map((v, i) => [`${f}Scarab${i + 1}`, v]))),
  hourglassSand: 60, grandHourglass: 1500,
};

/** Scrap a crafter pays per spare maximum Stability point on a drop (Anneal costs 30 and gives one point back). */
export const STABILITY_VALUE = 1.5;

export function valueOf(item: Item): number {
  switch (item.kind) {
    case 'currency': return (CURRENCY_VALUE[item.currencyId] ?? 8) * item.count;
    case 'flask': return 2 * item.count;
    case 'map': return 8 + item.tier * 3 + (item.rarity === 'rare' ? 12 : item.rarity === 'magic' ? 4 : 0) + item.quality * 0.5;
    case 'equipment': {
      // Rook's appraisal, plus what a crafter pays for spare Stability on a clean base.
      const stab = Math.max(0, item.maxStability - getBase(item.baseId).maxStability);
      return (sellQuote(item)?.scrap ?? 1) + stab * STABILITY_VALUE;
    }
  }
}

export interface Cell { valuePerMap: number; seconds: number; valuePerHour: number; pressure: number; kills: number; setup: RunSetup }

export const REFERENCE_KILL_SECONDS = 40;

/** The bot's model of the map's danger to the player: what gets stronger and denser, weighted. */
function pressureOf(setup: RunSetup): number {
  const cfg = rules.buildRunConfig(setup, {} as never);
  const m = cfg.monsters;
  return m.countMultiplier * m.damageMultiplier * m.speedMultiplier ** 0.5 * (1 + (m.rarePackChance - BASE_RARE_PACK_CHANCE) * 4) * (1 + m.resistBonus);
}

/** Clear time by the wave-queue model. `speed` is life units the reference player kills per second. */
export function clearSeconds(waves: { count: number; waveDuration: number; bossWave: number; tellDuration: number }, life: number[], boss: number, speed: number): number {
  let t = 0;
  let backlog = 0;
  for (let w = 1; w <= waves.count; w++) {
    backlog += life[w - 1] + (w === waves.bossWave ? boss : 0);
    const clearTime = backlog / speed;
    const step = w === waves.bossWave || w === waves.count ? clearTime : Math.min(clearTime, waves.waveDuration - waves.tellDuration);
    t += step + (w < waves.count ? waves.tellDuration : 0);
    backlog = Math.max(0, backlog - speed * step);
  }
  return t + backlog / speed;
}

/** One map of `nodes` at `tier` in `area`, played with a fixed seed. */
/** The map a player crafts for this tree: a rare map with three danger mods (corrupted with a corrupted mod when asked). */
export function standardMap(tier: number, corrupted = false): MapItem {
  const m = map('ashenForge', tier);
  const mods = [{ modId: 'teeming', value: 100 }, { modId: 'commanded', value: 100 }, { modId: 'fortified', value: 100 }, ...(corrupted ? [{ modId: 'seethingHorde', value: 100 }] : [])];
  return { ...m, rarity: 'rare', mods, corrupted, quality: 10 };
}

export function playMap(nodes: readonly string[], tier: number, area: AtlasAreaId, seed: number, corrupted = false, speedOverride?: number, surge = false): Cell & { units: number } {
  const ch: CharacterSave = bareCharacter({ atlas: fullProgress([...nodes]), currencyStash: { scrap: 1000, gildedKey: 5, blackKey: 5, huntingKey: 5, riftKey: 5, reliquaryKey: 5 }, mapDevice: standardMap(tier, corrupted), rngState: seed * 7919 + tier });
  const setup = expectOk(openAt(rules, ch, area, 'wand')).setup;
  // The daily surge (brief D 7): the same freezing openMap does with `useSurge`, so a boosted cell uses the real loot rules.
  if (surge) attachSurge(setup, { areaId: area, ...surgeBonusFor(), day: 0 });
  const cfg = rules.buildRunConfig(setup, {} as never);
  const s = cfg.monsters;
  const rng = createRng(seed * 104729 + tier * 31);
  const boss = THEME_ROSTER[setup.map.baseId].boss;
  let value = 0, kills = 0;
  const lifeByWave: number[] = [];
  const looter = ch;
  const kill = (rarity: KillLootContext['rarity'], wave: number, extra: Partial<KillLootContext> = {}) => {
    const ctx: KillLootContext = { kind: 'ashling', summoned: false, rarity, isLieutenant: false, isBoss: false, wave, x: 0, y: 0, ...extra };
    for (const item of rules.rollKillLoot(setup, ctx, rng.fork(0x1000 + kills), looter)) value += valueOf(item);
    kills++;
  };
  for (let w = 1; w <= cfg.waves.count; w++) {
    const budget = Math.round((WAVES.baseMonsters + WAVES.monstersPerWave * (w - 1)) * s.countMultiplier);
    const packMembers = Math.round(budget * 0.6);
    let life = budget - packMembers; // stream: normal monsters
    for (let n = 0; n < budget - packMembers; n++) kill('normal', w);
    for (let left = packMembers; left > 0;) {
      const size = Math.min(left, 4 + Math.floor(rng.next() * 5));
      const leader = rng.next() < s.rarePackChance ? 'rare' : rng.next() < s.magicPackChance ? 'magic' : 'normal';
      kill(leader, w); life += leader === 'rare' ? 3 : leader === 'magic' ? 1.5 : 1;
      for (let n = 1; n < size; n++) kill('normal', w);
      life += size - 1;
      left -= size;
    }
    lifeByWave.push(life * s.lifeMultiplier);
  }
  const bossLife = 40 * s.lifeMultiplier * (cfg.bossLifeMultiplier ?? 1);
  for (const item of rules.rollKillLoot(setup, { kind: boss, summoned: false, rarity: 'rare', isLieutenant: false, isBoss: true, wave: cfg.waves.bossWave, x: 0, y: 0 }, rng.fork(1), looter)) value += valueOf(item);
  for (const item of rules.rollChestLoot(setup, rng.fork(2), looter)) value += valueOf(item);
  const units = lifeByWave.reduce((a, b) => a + b, 0) + bossLife;
  const speed = speedOverride ?? units / (cfg.waves.count * REFERENCE_KILL_SECONDS);
  const seconds = clearSeconds({ count: cfg.waves.count, waveDuration: cfg.waves.waveDuration, bossWave: cfg.waves.bossWave, tellDuration: cfg.waves.tellDuration }, lifeByWave, bossLife, speed);
  return { valuePerMap: value, seconds, valuePerHour: value / seconds * 3600, pressure: pressureOf(setup), kills, setup, units };
}

export interface Measured { valuePerHour: number; seconds: number; pressure: number; valuePerMap: number }

/** Mean over seeds. Time is measured at a speed calibrated on the empty tree of the same area and tier. */
export function measure(nodes: readonly string[], tier: number, area: AtlasAreaId, seeds: readonly number[], corrupted = false, surge = false): Measured {
  const baseline = playMap([], tier, area, seeds[0], corrupted);
  const speed = baseline.units / (6 * REFERENCE_KILL_SECONDS);
  let value = 0, seconds = 0, pressure = 0;
  for (const seed of seeds) {
    const cell = playMap(nodes, tier, area, seed, corrupted, speed, surge);
    value += cell.valuePerMap; seconds += cell.seconds; pressure += cell.pressure;
  }
  const n = seeds.length;
  return { valuePerMap: value / n, seconds: seconds / n, pressure: pressure / n, valuePerHour: value / seconds * 3600 };
}

// ---------------------------------------------------------------------------------------------
// Archetypes (brief B 6.4), restricted to nodes whose engine is live; each keeps its identity.
// ---------------------------------------------------------------------------------------------

export interface Archetype {
  id: string;
  name: string;
  /** Targets in priority order; paths are bought while the 60 points last. */
  targets: readonly string[];
  /** Preference for filler: node groups, best first. */
  fill: readonly string[];
  /** The Atlas area kind it farms. */
  area: 'through' | 'deadEnd';
  /** Identity needs an engine that is not live yet (events; the fifth danger mod): exempt from the value floor. */
  partial?: boolean;
  /** Farms corrupted maps. */
  corrupted?: boolean;
}

export const ARCHETYPES: readonly Archetype[] = [
  { id: 'rareHunter', name: 'Rare Hunter', targets: ['rareBlood', 'elderBlood', 'rareOrNothing', 'kingmakersCache'], fill: ['bounty', 'fortune'], area: 'through' },
  { id: 'speedRunner', name: 'Speed Runner', targets: ['overrunDoctrine', 'riptide', 'waypoint'], fill: ['peril', 'cartography'], area: 'through' },
  { id: 'essenceSniper', name: 'Essence Sniper', targets: ['deepSeams', 'emberwrightsDue', 'ingredientHunter'], fill: ['foundry', 'belt'], area: 'through' },
  { id: 'blankSlateCrafter', name: 'Blank-Slate Crafter', targets: ['blankSlate', 'steadyAnvil', 'soundFoundations', 'cataloguersShelf'], fill: ['foundry', 'bridge'], area: 'through' },
  { id: 'bossButcher', name: 'Boss Butcher', targets: ['kingslayersTithe', 'crownedChallenge', 'earlyCrown'], fill: ['fortune', 'cartography', 'bridge'], area: 'through' },
  { id: 'echoChaser', name: 'Echo Chaser (live subset)', targets: ['whisper', 'veilwalker', 'faintSignal'], fill: ['echoes', 'bridge'], area: 'through', partial: true },
  { id: 'juicedModder', name: 'Juiced Modder', targets: ['thrillOfTheHex', 'hexSculptor', 'stingingDust'], fill: ['peril', 'fortune'], area: 'through', partial: true },
  { id: 'ladderClimber', name: 'Ladder Climber', targets: ['farHorizon', 'laddersReward', 'chartKeeper', 'deepPockets'], fill: ['cartography', 'hub'], area: 'through' },
  { id: 'vaultFarmer', name: 'Vault Farmer', targets: ['deadEndDevotee', 'ingredientHunter', 'ledgerline'], fill: ['cartography', 'foundry'], area: 'deadEnd' },
  { id: 'corrupter', name: 'Corrupter (live subset)', targets: ['voidTithe', 'hexSculptor', 'hardAir'], fill: ['peril', 'fortune'], area: 'through', partial: true, corrupted: true },
  { id: 'balancedGeneralist', name: 'Balanced Generalist', targets: ['chartKeeper', 'gildedInstinct', 'deepSeams', 'rareBlood', 'lodestone', 'ingredientHunter'], fill: ['fortune', 'cartography', 'bounty'], area: 'through' },
  { id: 'emptyHallsDuelist', name: 'Empty Halls Duelist', targets: ['emptyHalls', 'rareBlood', 'kingmakersCache'], fill: ['bounty', 'fortune'], area: 'through' },
];

/** Areas by kind for a tier: through-route (Heart of the Forge, tier 15) and the best dead end that accepts the tier. */
export function areaFor(kind: Archetype['area'], tier: number): AtlasAreaId {
  if (kind === 'through') return 'heartOfForge';
  return tier <= 3 ? 'emberVault' : tier <= 5 ? 'hollowOssuary' : 'shrineField';
}

/** Buy the archetype's target paths in order while the budget lasts, then fill with adjacent live nodes by group preference. */
export function buildFor(a: Archetype, budget = 60): string[] {
  const chosen: string[] = [];
  const spent = () => chosen.reduce((n, id) => n + findAtlasNode(id)!.cost, 0);
  const excluded = (id: string) => chosen.some(c => findAtlasNode(c)!.excludes.includes(id) || findAtlasNode(id)!.excludes.includes(c));
  for (const target of a.targets) {
    let path: string[];
    try { path = pathTo(...chosen, target); } catch { continue; }
    const add = path.filter(id => !chosen.includes(id));
    if (add.some(excluded)) continue;
    const cost = add.reduce((n, id) => n + findAtlasNode(id)!.cost, 0);
    if (spent() + cost <= budget) chosen.push(...add);
  }
  for (let guard = 0; guard < 200 && spent() < budget; guard++) {
    const open = MAP_TREE.filter(n => !chosen.includes(n.id) && atlasNodeAllocatable(n) && !excluded(n.id) && n.cost + spent() <= budget && n.kind !== 'keystone'
      && n.links.some(l => l === ATLAS_ORIGIN_ID || chosen.includes(l)));
    if (!open.length) break;
    open.sort((x, y) => (a.fill.indexOf(x.group) + 99) % 99 - (a.fill.indexOf(y.group) + 99) % 99 || x.id.localeCompare(y.id));
    chosen.push(open[0].id);
  }
  return normalizeMapTree(chosen, budget);
}

/** A random legal build (seeded): grows from the origin through adjacent live nodes until the budget is spent. */
export function randomBuild(seed: number, budget = 60): string[] {
  const rng = createRng(seed * 2654435761);
  const chosen: string[] = [];
  const spent = () => chosen.reduce((n, id) => n + findAtlasNode(id)!.cost, 0);
  const excluded = (id: string) => chosen.some(c => findAtlasNode(c)!.excludes.includes(id) || findAtlasNode(id)!.excludes.includes(c));
  for (let guard = 0; guard < 400; guard++) {
    const open = MAP_TREE.filter(n => !chosen.includes(n.id) && atlasNodeAllocatable(n) && !excluded(n.id) && spent() + n.cost <= budget
      && n.links.some(l => l === ATLAS_ORIGIN_ID || chosen.includes(l)));
    if (!open.length) break;
    chosen.push(open[Math.floor(rng.next() * open.length)].id);
  }
  return normalizeMapTree(chosen, budget);
}
