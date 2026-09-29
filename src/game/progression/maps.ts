// Map rules: effects of tier, quality, implicits and mods; monster scaling and waves for the sim;
// item quantity/rarity with breakdowns; map tooltips; and map currencies (GAME_SPEC §6–§7).
//
// Map mod model:
//   • Danger mods (Threat Glyph, Map Dust) pair a threat with a reward. Their count sets the rarity:
//     0 Normal · 1–2 Magic · 3–4 Rare (max 4).
//   • Reward-only mods (Reward Ink, max 1; Twin Ink adds a second) and corrupted mods are extra lines that do not
//     count toward rarity.
//   • A mod's `value` is its rolled magnitude in percent of the nominal numbers (tier-scaled roll).
import type { MapSummaryLine } from '../../contracts/game';
import type {
  ItemDescription, MapItem, ModifierMode, Rarity, RolledMapMod, StatModifier, TooltipLine,
} from '../../contracts/items';
import type { CurrencyId, MapBaseId, MonsterKind } from '../../contracts/content';
import { MAP_BASE_IDS, iconIdForMap } from '../../contracts/content';
import type { MonsterScaling, WaveConfig } from '../../contracts/sim';
import type { Rng } from '../../contracts/rng';
import { resolveStatBreakdown } from '../../core/modifiers';
import { hashString } from '../../core/rng';
import {
  BASE_MAGIC_PACK_CHANCE, BASE_RARE_PACK_CHANCE, CORRUPTED_MODS, DANGER_MODS, DEBUFFS, ECHO_MOD, HAZARD_AFFLICTION, MAP_AFFLICTIONS,
  MAP_BASES, MAP_DANGER_LIMITS, MAP_DUST_COUNTS, MAP_NAME_FIRST, MAP_NAME_SECOND, MAX_DANGER_MODS, MAX_MAP_TIER, MAX_REWARD_MODS,
  MIN_MAP_TIER, MOD_VALUE_ROLL, MONSTER_LEVEL, MONSTER_LEVEL_SCALING, MONSTER_NAMES, MONSTER_PLURALS, MONSTER_SENTENCE_NAMES, PARTY_SCALING, REWARD_MODS,
  PLAYER_RESISTANCE_SCALING, TIER_SCALING, VOID_NEEDLE_OUTCOMES, WAVES, findMapBase, getMapMod,
} from '../../data/progression';
import type { MapEffectDef, MapModDef, MapStat, VoidOutcomeId } from '../../data/progression';
import { findCurrency, ownEntry } from '../../data/items';
import { formatChance, formatDistribution, formatNumber, formatSigned, joinWords } from '../items';
import { MAX_PARTY_SIZE } from '../../contracts/net';
import { clamp, finite, oneDecimal, percent, resolveModes, rollCountTable, signedPercent, stableIndex } from './util';

// ---------------------------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------------------------

/** One effective map modifier with its source (for scaling and breakdowns). */
export interface MapModifier {
  stat: MapStat;
  mode: ModifierMode;
  value: number;
  source: string;
}

export function clampTier(tier: number): number {
  return clamp(Math.floor(Number.isFinite(tier) ? tier : MIN_MAP_TIER), MIN_MAP_TIER, MAX_MAP_TIER);
}

/** Monster level (= item level of every drop) = min(90, 6 × tier − 2). */
export function monsterLevelForTier(tier: number): number {
  return Math.min(MONSTER_LEVEL.cap, MONSTER_LEVEL.base + MONSTER_LEVEL.perTier * clampTier(tier));
}

export function resistancePenaltyForLevel(level: number): number {
  const s = PLAYER_RESISTANCE_SCALING;
  return Math.min(s.cap, Math.max(0, level - s.startLevel) * s.perLevel);
}

export function mapBaseName(baseId: MapBaseId | string): string {
  return findMapBase(baseId)?.name ?? 'Unknown Map';
}

/** A monster's display name ("The Hollow Warden", "Bone Thrall"). */
export function monsterName(kind: MonsterKind): string {
  return MONSTER_NAMES[kind] ?? 'a monster';
}

/** How a sentence names a monster: "the Cinder Matriarch", "The Hollow Warden", "Varkus, the Iron Champion". */
export function monsterSentenceName(kind: MonsterKind): string {
  return MONSTER_SENTENCE_NAMES[kind] ?? `the ${monsterName(kind)}`;
}

/** The lieutenant (wave 3) and boss (final wave) of a map base, by kind and name (GAME_SPEC §14). */
export function mapBosses(baseId: MapBaseId | string): {
  lieutenant: { kind: MonsterKind; name: string; sentence: string };
  boss: { kind: MonsterKind; name: string; sentence: string };
} {
  const base = findMapBase(baseId) ?? MAP_BASES.ashenForge;
  const entry = (kind: MonsterKind) => ({ kind, name: monsterName(kind), sentence: monsterSentenceName(kind) });
  return { lieutenant: entry(base.lieutenant), boss: entry(base.boss) };
}

/**
 * A map mod's name on a map of `baseId` (GAME_SPEC §7): a mod named after the map's boss follows the base ("The
 * Warden's Wrath" on a Rimed Ossuary, "Varkus's Wrath" on an Iron Coliseum); any other mod, or no base, keeps its
 * own name. Only the name changes: the id a saved map stores is the same on every base.
 */
export function mapModName(def: MapModDef, baseId?: MapBaseId | string): string {
  return (def.nameByBase ? ownEntry<string>(def.nameByBase, baseId) : undefined) ?? def.name;
}

/** Rolled mod value range at a tier (percent of the nominal magnitude). */
export function modValueRange(tier: number): { min: number; max: number } {
  const bonus = MOD_VALUE_ROLL.perTier * (clampTier(tier) - 1);
  return { min: MOD_VALUE_ROLL.min + bonus, max: MOD_VALUE_ROLL.max + bonus };
}

export function rollModValue(rng: Rng, tier: number): number {
  const r = modValueRange(tier);
  return rng.int(r.min, r.max);
}

/** Effective magnitude of an effect for a rolled mod value. */
export function effectMagnitude(effect: MapEffectDef, modValue: number): number {
  if (effect.fixed) return effect.value;
  return Math.round((effect.value * modValue) / 100);
}

const MOD_KIND_ORDER: Record<MapModDef['kind'], number> = { danger: 0, reward: 1, corrupted: 2, echo: 3 };
const MOD_ORDER = new Map<string, number>(
  [...DANGER_MODS, ...REWARD_MODS, ...CORRUPTED_MODS, ECHO_MOD].map((m, i) => [m.id, MOD_KIND_ORDER[m.kind] * 100 + i]),
);

/** Canonical order: danger mods, reward mod, corrupted mods, echo. */
export function sortMapMods(mods: readonly RolledMapMod[]): RolledMapMod[] {
  return [...mods].sort((a, b) => (MOD_ORDER.get(a.modId) ?? 999) - (MOD_ORDER.get(b.modId) ?? 999));
}

function modsOfKind(map: MapItem, kind: MapModDef['kind']): RolledMapMod[] {
  return map.mods.filter((m) => getMapMod(m.modId)?.kind === kind);
}

export function dangerModCount(map: MapItem): number {
  return modsOfKind(map, 'danger').length;
}

export function rewardModCount(map: MapItem): number {
  return modsOfKind(map, 'reward').length;
}

/** Rarity set by the number of danger mods: 0 Normal · 1–2 Magic · 3+ Rare. */
export function rarityForDangerCount(n: number): Exclude<Rarity, 'unique'> {
  if (n <= 0) return 'normal';
  return n >= MAP_DANGER_LIMITS.rare.min ? 'rare' : 'magic';
}

export function hasEchoWave(map: MapItem): boolean {
  return map.mods.some((m) => m.modId === ECHO_MOD.id);
}

/** A map item (merchant stock, starting kit, drops). */
export function createMapItem(
  baseId: MapBaseId, tier: number, uid: string,
  opts: { rarity?: Exclude<Rarity, 'unique'>; mods?: RolledMapMod[]; quality?: number; isNew?: boolean } = {},
): MapItem {
  const mods = sortMapMods(opts.mods ?? []);
  const map: MapItem = {
    kind: 'map',
    uid,
    baseId,
    tier: clampTier(tier),
    rarity: 'normal',
    mods,
    quality: clamp(Math.floor(opts.quality ?? 0), 0, 20),
    corrupted: false,
    ...(opts.isNew ? { isNew: true } : {}),
  };
  map.rarity = opts.rarity ?? rarityForDangerCount(dangerModCount(map));
  return map;
}

/** Weighted draw of `count` distinct danger mods (excluding ids already present). */
export function rollDangerMods(rng: Rng, count: number, tier: number, exclude: readonly string[] = []): RolledMapMod[] {
  const out: RolledMapMod[] = [];
  const taken = new Set(exclude);
  for (let i = 0; i < count; i++) {
    const pick = rng.weighted(DANGER_MODS.filter((m) => !taken.has(m.id)), (m) => m.weight);
    if (!pick) break;
    taken.add(pick.id);
    out.push({ modId: pick.id, value: rollModValue(rng, tier) });
  }
  return out;
}

/** A random map of a rarity with the right number of danger mods. */
export function rollMapWithRarity(
  rng: Rng, baseId: MapBaseId, tier: number, rarity: Exclude<Rarity, 'unique'>, uid: string, quality: number, isNew: boolean,
): MapItem {
  const t = clampTier(tier);
  let mods: RolledMapMod[] = [];
  if (rarity !== 'normal') mods = rollDangerMods(rng, rollCountTable(rng, MAP_DUST_COUNTS[rarity]), t);
  return createMapItem(baseId, t, uid, { rarity, mods, quality, isNew });
}

/** Rare maps take a stable generated name from their uid ("Howling Crucible"). */
export function mapTitle(map: MapItem): string {
  const baseName = mapBaseName(map.baseId);
  if (map.rarity === 'rare') {
    const h = hashString(map.uid);
    return `${MAP_NAME_FIRST[stableIndex(h, MAP_NAME_FIRST.length)]} ${MAP_NAME_SECOND[stableIndex(h >>> 8, MAP_NAME_SECOND.length)]}`;
  }
  if (map.rarity === 'magic') {
    const first = modsOfKind(map, 'danger')[0];
    const def = first ? getMapMod(first.modId) : undefined;
    return def ? `${mapModName(def, map.baseId)} ${baseName}` : baseName;
  }
  return baseName;
}

// ---------------------------------------------------------------------------------------------
// Effect text
// ---------------------------------------------------------------------------------------------

type Templates = Partial<Record<ModifierMode, string>>;

/** Placeholders: {v} magnitude, {+v} signed, {inc} increased/reduced, {more} more/less, {x} "3" of "3 times", {s} plural. */
const MAP_STAT_TEXT: Record<MapStat, Templates> = {
  monsterCount: { increased: '{v}% {inc} number of Monsters', more: '{v}% {more} Monsters' },
  monsterLife: { increased: '{v}% {inc} Monster Life', more: '{v}% {more} Monster Life' },
  monsterDamage: { increased: '{v}% {inc} Monster Damage', more: '{v}% {more} Monster Damage' },
  monsterSpeed: { increased: '{v}% {inc} Monster Movement Speed' },
  packRarity: { increased: '{v}% {inc} chance of Magic and Rare packs' },
  monsterResist: { flat: 'Monsters have {+v}% to all Resistances' },
  monsterProjectiles: { flat: 'Monsters fire {v} additional Projectile{s}' },
  hazards: { flat: 'Volcanic eruptions burst around you and set you Burning' },
  playerFocusRegen: { increased: 'Players have {v}% {inc} Focus Regeneration' },
  playerResist: { flat: 'Players have {+v}% to all Resistances' },
  itemQuantity: { increased: '{v}% {inc} Quantity of Items found' },
  itemRarity: { increased: '{v}% {inc} Rarity of Items found' },
  mapDropChance: { increased: '{v}% {inc} chance to find Maps', more: 'Maps are {x} times as likely to drop' },
  essenceDropChance: { more: 'Essences are {x} times as likely to drop' },
  emberEssenceChance: { more: 'Ember Essences are {x} times as likely to drop' },
  rimeEssenceChance: { more: 'Rime Essences are {x} times as likely to drop' },
  armourStability: { flat: 'Armour bases drop with {+v} Stability' },
  echoWave: { flat: 'An Echo wave follows {boss}: a 7th wave with double loot' },
};

/**
 * Player-facing text of one map effect. `boss` names the map's boss where a line mentions it (the Echo
 * wave): "the Cinder Matriarch", "The Hollow Warden"; default "the boss".
 */
export function effectText(stat: MapStat, mode: ModifierMode, value: number, boss = 'the boss'): string {
  const template = MAP_STAT_TEXT[stat][mode] ?? `{+v} ${stat}`;
  return template.replace(/\{(\+v|v|inc|more|x|s|boss)\}/g, (_m, key: string) => {
    switch (key) {
      case 'boss': return boss;
      case '+v': return formatSigned(value);
      case 'v': return formatNumber(value);
      case 'inc': return value < 0 ? 'reduced' : 'increased';
      case 'more': return value < 0 ? 'less' : 'more';
      case 'x': return formatNumber(1 + value / 100);
      default: return Math.abs(value) === 1 ? '' : 's';
    }
  });
}

/** Danger effects are threats; a negative player-facing reward (never shipped) would also count. */
function isThreat(stat: MapStat): boolean {
  return stat.startsWith('monster') || stat === 'packRarity' || stat === 'hazards' || stat.startsWith('player');
}

/** Player-facing implicit text of a map base ("Ember Essences are 3 times as likely to drop. …"). */
export function mapBaseImplicitText(baseId: MapBaseId): string {
  const def = MAP_BASES[baseId];
  const parts = def.implicitEffects.map((e) => effectText(e.stat, e.mode, e.value));
  if (def.arenaNote) parts.push(def.arenaNote);
  return parts.map((p) => (p.endsWith('.') ? p : `${p}.`)).join(' ');
}

// ---------------------------------------------------------------------------------------------
// Modifiers, scaling, luck
// ---------------------------------------------------------------------------------------------

/** Every effect a map applies, labelled: tier, quality, base implicit and mods. */
export function mapModifiers(map: MapItem): MapModifier[] {
  const out: MapModifier[] = [];
  const tier = clampTier(map.tier);
  const tierSource = `Tier ${tier}`;
  if (tier > 1) out.push({ stat: 'itemRarity', mode: 'increased', value: TIER_SCALING.itemRarity * (tier - 1), source: tierSource });
  // Monster stats follow the monster level (Path of Exile style): compounding "more" per level above the
  // reference level, "less" below it.
  const levelGap = monsterLevelForTier(tier) - MONSTER_LEVEL_SCALING.referenceLevel;
  const levelSource = `Monster level ${monsterLevelForTier(tier)}`;
  out.push({ stat: 'monsterLife', mode: 'more', value: (MONSTER_LEVEL_SCALING.life ** levelGap - 1) * 100, source: levelSource });
  out.push({ stat: 'monsterDamage', mode: 'more', value: (MONSTER_LEVEL_SCALING.damage ** levelGap - 1) * 100, source: levelSource });
  const quality = clamp(Math.floor(map.quality || 0), 0, 20);
  if (quality > 0) {
    out.push({ stat: 'itemQuantity', mode: 'increased', value: quality, source: 'Quality' });
    out.push({ stat: 'mapDropChance', mode: 'increased', value: quality, source: 'Quality' });
  }
  const base = findMapBase(map.baseId);
  if (base) {
    for (const e of base.implicitEffects) out.push({ stat: e.stat, mode: e.mode, value: e.value, source: base.name });
  }
  for (const rolled of map.mods) {
    const def = getMapMod(rolled.modId);
    if (!def) continue;
    for (const e of [...def.danger, ...def.reward]) {
      out.push({ stat: e.stat, mode: e.mode, value: effectMagnitude(e, rolled.value), source: mapModName(def, map.baseId) });
    }
  }
  return out;
}

function ofStat(mods: readonly MapModifier[], stat: MapStat): MapModifier[] {
  return mods.filter((m) => m.stat === stat);
}

/** Resolve a map stat with the shared formula. */
export function mapStat(mods: readonly MapModifier[], stat: MapStat, base: number): number {
  return resolveModes(base, ofStat(mods, stat));
}

/** Monster scaling handed to the sim for this map. */
export function monsterScaling(map: MapItem): MonsterScaling {
  const mods = mapModifiers(map);
  const tier = clampTier(map.tier);
  const pack = mapStat(mods, 'packRarity', 1);
  return {
    level: monsterLevelForTier(tier),
    lifeMultiplier: mapStat(mods, 'monsterLife', 1),
    damageMultiplier: mapStat(mods, 'monsterDamage', 1),
    speedMultiplier: mapStat(mods, 'monsterSpeed', 1),
    countMultiplier: mapStat(mods, 'monsterCount', 1),
    magicPackChance: Math.min(1, BASE_MAGIC_PACK_CHANCE * pack),
    rarePackChance: Math.min(1, BASE_RARE_PACK_CHANCE * pack),
    resistBonus: mapStat(mods, 'monsterResist', 0) / 100,
    xpMultiplier: experienceMultiplier(tier),
    extraProjectiles: Math.max(0, Math.round(mapStat(mods, 'monsterProjectiles', 0))),
    hazards: mapStat(mods, 'hazards', 0) > 0,
  };
}

/** Experience from monsters compounds per tier above 1 (×1.28 per tier), so deeper maps keep pace with the XP curve. */
export function experienceMultiplier(tier: number): number {
  return TIER_SCALING.experience ** (clampTier(tier) - 1);
}

/** "1.6x", "31.7x": a multiplier with at most one decimal. */
function times(mult: number): string {
  return `${oneDecimal(mult)}x`;
}

/** Six waves, only a final boss on 6; an Echo corruption adds a seventh after the boss. */
export function waveConfig(map: MapItem): WaveConfig {
  return {
    count: WAVES.count + (hasEchoWave(map) ? 1 : 0),
    baseMonsters: WAVES.baseMonsters,
    monstersPerWave: WAVES.monstersPerWave,
    waveDuration: WAVES.waveDuration,
    tellDuration: WAVES.tellDuration,
    lieutenantWave: WAVES.lieutenantWave,
    bossWave: WAVES.bossWave,
  };
}

/** Index of the Echo wave (after the boss), or 0 when the map has none. */
export function echoWaveIndex(map: MapItem): number {
  return hasEchoWave(map) ? WAVES.count + 1 : 0;
}

/** Player penalties of a map (Exhausting, Hexed, corruption) as ordinary player StatModifiers. */
export function mapPlayerModifiers(map: MapItem, monsterLevel = monsterLevelForTier(map.tier)): StatModifier[] {
  const out: StatModifier[] = [];
  const penalty = resistancePenaltyForLevel(monsterLevel);
  if (penalty > 0) out.push({ stat: 'allRes', mode: 'flat', value: -penalty, source: `Monster level ${monsterLevel}`, label: 'Map level resistance penalty' });
  for (const m of mapModifiers(map)) {
    if (m.stat === 'playerFocusRegen') {
      out.push({ stat: 'focusRegen', mode: m.mode, value: m.value, source: `${m.source} (map)`, label: effectText(m.stat, m.mode, m.value) });
    } else if (m.stat === 'playerResist') {
      out.push({ stat: 'allRes', mode: m.mode, value: m.value, source: `${m.source} (map)`, label: effectText(m.stat, m.mode, m.value) });
    }
  }
  return out;
}

/** % increased item quantity / rarity from a character's gear (0 = none). */
export interface GearLuck {
  itemQuantity: number;
  itemRarity: number;
}

/**
 * Item quantity/rarity (100 = base) with full breakdowns: the map's own sources (tier, quality,
 * implicit, mods), then — when `gear` is given — one "Your gear" source. `mapLuck(map, null)` is the
 * map-side luck of RunSetup; a looter's personal luck is lootLuck() in ./luck.
 */
export function mapLuck(map: MapItem, gear: GearLuck | null) {
  const mods = mapModifiers(map);
  const toStat = (stat: 'itemQuantity' | 'itemRarity'): StatModifier[] => {
    const out: StatModifier[] = ofStat(mods, stat).map((m) => ({ stat, mode: m.mode, value: m.value, source: m.source }));
    const g = gear ? gear[stat] : 0;
    if (g) out.push({ stat, mode: 'increased', value: g, source: 'Your gear' });
    return out;
  };
  return {
    quantity: resolveStatBreakdown('itemQuantity', 100, toStat('itemQuantity')),
    rarity: resolveStatBreakdown('itemRarity', 100, toStat('itemRarity')),
  };
}

/** Drop-weight multipliers inside the loot tables (maps, essences). */
export function mapDropMultipliers(map: MapItem): { map: number; essence: number; emberEssence: number; rimeEssence: number; armourStability: number } {
  const mods = mapModifiers(map);
  return {
    map: mapStat(mods, 'mapDropChance', 1),
    essence: mapStat(mods, 'essenceDropChance', 1),
    emberEssence: mapStat(mods, 'emberEssenceChance', 1),
    rimeEssence: mapStat(mods, 'rimeEssenceChance', 1),
    armourStability: Math.round(mapStat(mods, 'armourStability', 0)),
  };
}

// ---------------------------------------------------------------------------------------------
// Summary (map device readout)
// ---------------------------------------------------------------------------------------------

/** One source line of a map readout: "+20% Teeming", "56.1% more from Tier 4", "+10% Monster Resistances". */
export function summarySourceLine(m: { mode: ModifierMode; value: number; source: string }, unit = '%'): string {
  return modifierLine(m, unit);
}

function modifierLine(m: { mode: ModifierMode; value: number; source: string }, unit = '%'): string {
  if (m.mode === 'more') {
    const v = Math.round(m.value * 10) / 10;
    return `${formatNumber(v)}% ${v < 0 ? 'less' : 'more'} from ${m.source}`;
  }
  if (m.mode === 'increased') return `${signedPercent(m.value)} ${m.source}`;
  return `${formatSigned(Math.round(m.value * 10) / 10)}${unit} ${m.source}`;
}

function multiplierValue(mult: number): string {
  return signedPercent((mult - 1) * 100);
}

function scalingLine(label: string, mods: readonly MapModifier[], stat: MapStat, always = false): MapSummaryLine | null {
  const list = ofStat(mods, stat);
  if (!list.length && !always) return null;
  const mult = resolveModes(1, list);
  return { label, value: multiplierValue(mult), breakdown: list.length ? list.map((m) => modifierLine(m)) : ['No modifiers'] };
}

/** Last breakdown line of the map-side luck lines: loot is instanced, gear luck is personal. */
const MAP_ONLY_NOTE = (stat: string) => `Map only: each player adds their own gear's ${stat} to their own drops`;

/** "Total 136% of the base rate". */
export function luckTotalLine(value: number): string {
  return `Total ${formatNumber(Math.round(value))}% of the base rate`;
}

function luckLine(label: string, bd: ReturnType<typeof mapLuck>['quantity'], note: string): MapSummaryLine {
  const lines = bd.sources.map((m) => modifierLine({ mode: m.mode, value: m.value, source: m.source }));
  if (!lines.length) lines.push('No bonuses: 100% is the base rate');
  lines.push(luckTotalLine(bd.value), note);
  return { label, value: signedPercent(bd.value - 100), breakdown: lines };
}

/**
 * Map device readout: monster level, the map's own luck, waves, every danger and reward with its
 * sources. Map-side only (it is RunSetup.summary, shared by the whole party): each player's gear luck
 * comes on top for their own instanced drops — see lootLuck() / lootLuckLines() in ./luck.
 */
export function buildMapSummary(map: MapItem): MapSummaryLine[] {
  const mods = mapModifiers(map);
  const tier = clampTier(map.tier);
  const level = monsterLevelForTier(tier);
  const luck = mapLuck(map, null);
  const out: MapSummaryLine[] = [];

  out.push({
    label: 'Monster Level',
    value: String(level),
    breakdown: [
      `Tier ${tier}: 6 per tier minus 2 (at most ${MONSTER_LEVEL.cap})`,
      `Items drop at item level ${level}`,
    ],
  });
  out.push(luckLine('Map Item Quantity', luck.quantity, MAP_ONLY_NOTE('Item Quantity')));
  out.push(luckLine('Map Item Rarity', luck.rarity, MAP_ONLY_NOTE('Item Rarity')));

  const waves = waveConfig(map);
  const bosses = mapBosses(map.baseId);
  const waveLines = [
    `Each wave lasts up to ${WAVES.waveDuration} seconds; unfinished waves stack`,
    `Monsters: ${rosterText(map.baseId)}`,
    ...(waves.lieutenantWave > 0 ? [`Wave ${waves.lieutenantWave}: ${bosses.lieutenant.sentence}`] : []),
    `Wave ${waves.bossWave}: ${bosses.boss.sentence}`,
  ];
  if (hasEchoWave(map)) waveLines.push(`Wave ${echoWaveIndex(map)}: the Echo wave, double loot`);
  out.push({ label: 'Waves', value: String(waves.count), breakdown: waveLines });
  out.push({
    label: 'Experience',
    value: times(experienceMultiplier(tier)),
    breakdown: [
      tier > 1
        ? `${TIER_SCALING.experience}x per tier above 1 (Tier ${tier}: ${times(experienceMultiplier(tier))})`
        : `Tier 1 is the base rate; each tier above it multiplies experience by ${TIER_SCALING.experience}`,
      'Magic monsters give 2x the experience, rare monsters 6x',
    ],
  });
  out.push({ label: 'Boss', value: bosses.boss.name, breakdown: [`Wave ${waves.bossWave}: killing ${bosses.boss.sentence} clears the map`] });
  const afflictions = afflictionLine(map.baseId, ofStat(mods, 'hazards').length > 0);
  if (afflictions) out.push(afflictions);

  const push = (line: MapSummaryLine | null) => { if (line) out.push(line); };
  push(scalingLine('Monster Life', mods, 'monsterLife', true));
  push(scalingLine('Monster Damage', mods, 'monsterDamage', true));
  push(scalingLine('Monster Count', mods, 'monsterCount'));
  push(scalingLine('Monster Speed', mods, 'monsterSpeed'));

  const pack = ofStat(mods, 'packRarity');
  const packMult = resolveModes(1, pack);
  out.push({
    label: 'Magic / Rare Packs',
    value: `${formatChance(Math.min(1, BASE_MAGIC_PACK_CHANCE * packMult))} / ${formatChance(Math.min(1, BASE_RARE_PACK_CHANCE * packMult))}`,
    breakdown: [
      `Base ${percent(BASE_MAGIC_PACK_CHANCE)} magic, ${percent(BASE_RARE_PACK_CHANCE)} rare per pack`,
      ...pack.map((m) => modifierLine(m)),
    ],
  });

  const resist = ofStat(mods, 'monsterResist');
  if (resist.length) {
    out.push({ label: 'Monster Resistances', value: signedPercent(resolveModes(0, resist)), breakdown: resist.map((m) => modifierLine(m)) });
  }
  const proj = ofStat(mods, 'monsterProjectiles');
  if (proj.length) {
    out.push({ label: 'Monster Projectiles', value: formatSigned(resolveModes(0, proj)), breakdown: proj.map((m) => modifierLine(m, '')) });
  }
  const hazards = ofStat(mods, 'hazards');
  if (hazards.length) {
    const burn = DEBUFFS[HAZARD_AFFLICTION.debuff];
    out.push({
      label: 'Hazards',
      value: 'Eruptions',
      breakdown: hazards.map((m) => `Telegraphed fire eruptions that set you ${burn.name}; ${burn.counterplay} (${m.source})`),
    });
  }
  const regen = ofStat(mods, 'playerFocusRegen');
  if (regen.length) {
    out.push({ label: 'Your Focus Regeneration', value: signedPercent(resolveModes(100, regen) - 100), breakdown: regen.map((m) => modifierLine(m)) });
  }
  const res = ofStat(mods, 'playerResist');
  const resistancePenalty = resistancePenaltyForLevel(monsterLevelForTier(map.tier));
  if (resistancePenalty > 0) res.push({ stat: 'playerResist', mode: 'flat', value: -resistancePenalty, source: `Monster level ${monsterLevelForTier(map.tier)}` });
  if (res.length) {
    out.push({ label: 'Your Resistances', value: signedPercent(resolveModes(0, res)), breakdown: res.map((m) => modifierLine(m)) });
  }
  const drops = mapDropMultipliers(map);
  const dropLine = (label: string, mult: number, stat: MapStat) => {
    const list = ofStat(mods, stat);
    if (!list.length) return;
    out.push({
      label,
      value: times(mult),
      breakdown: list.map((m) => (m.mode === 'more' ? `${formatNumber(1 + m.value / 100)} times as likely from ${m.source}` : modifierLine(m))),
    });
  };
  dropLine('Map Drops', drops.map, 'mapDropChance');
  dropLine('Essence Drops', drops.essence, 'essenceDropChance');
  dropLine('Ember Essence Drops', drops.emberEssence, 'emberEssenceChance');
  dropLine('Rime Essence Drops', drops.rimeEssence, 'rimeEssenceChance');
  if (drops.armourStability > 0) {
    out.push({ label: 'Armour Stability', value: formatSigned(drops.armourStability), breakdown: [`Armour bases drop with extra Stability (${mapBaseName(map.baseId)})`] });
  }
  out.push(partySummaryLine());
  return out;
}

/** "Bone Thralls, Rimeshades, Frost Weavers, Glacial Wisps and Ossuary Golems". */
function rosterText(baseId: MapBaseId): string {
  const base = findMapBase(baseId);
  const names = (base?.family ?? []).map((k) => MONSTER_PLURALS[k] ?? monsterName(k));
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * The debuffs this map can inflict (GAME_SPEC §13), each with its sources and counterplay: its roster's
 * (MAP_AFFLICTIONS), plus Burning from the Volcanic mod's eruptions when the map has hazards.
 */
function afflictionLine(baseId: MapBaseId, hazards: boolean): MapSummaryLine | null {
  const roster = Object.prototype.hasOwnProperty.call(MAP_AFFLICTIONS, baseId) ? MAP_AFFLICTIONS[baseId] : [];
  const list = roster.map((a) => ({ debuff: a.debuff, sources: [...a.sources] }));
  if (hazards) {
    const burning = list.find((a) => a.debuff === HAZARD_AFFLICTION.debuff);
    if (burning) burning.sources.push(HAZARD_AFFLICTION.source);
    else list.push({ debuff: HAZARD_AFFLICTION.debuff, sources: [HAZARD_AFFLICTION.source] });
  }
  if (!list.length) return null;
  return {
    label: 'Afflictions',
    value: list.map((a) => DEBUFFS[a.debuff].name).join(', '),
    breakdown: [
      ...list.map((a) => {
        const d = DEBUFFS[a.debuff];
        return `${d.name} (from ${joinWords(a.sources)}): ${d.effect}. Counter: ${d.counterplay}`;
      }),
      'Cinder Ward halves every debuff duration while it is active',
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Party scaling (explained here, applied by the sim)
// ---------------------------------------------------------------------------------------------

/** Party scaling multipliers for `players` living players in a map (1–4; the sim's reading of n). */
export function partyScaling(players: number): { players: number; monsterLife: number; waveBudget: number; packRarity: number } {
  const n = clamp(Math.floor(finite(players, 1)), 1, MAX_PARTY_SIZE);
  const extra = n - 1;
  return {
    players: n,
    monsterLife: 1 + (PARTY_SCALING.monsterLife / 100) * extra,
    waveBudget: 1 + (PARTY_SCALING.waveBudget / 100) * extra,
    packRarity: 1 + (PARTY_SCALING.packRarity / 100) * extra,
  };
}

/** A party multiplier with up to two decimals ("1.75x", "2.5x"): one decimal would misstate 1.75. */
function partyTimes(mult: number): string {
  return `${String(Math.round(mult * 100) / 100)}x`;
}

/** The static readout line: what each extra player adds, and what a full party faces. */
function partySummaryLine(): MapSummaryLine {
  const full = partyScaling(MAX_PARTY_SIZE);
  return {
    label: 'Party Scaling',
    value: 'per extra player',
    breakdown: [
      `+${PARTY_SCALING.monsterLife}% monster life`,
      `+${PARTY_SCALING.waveBudget}% monsters per wave`,
      `+${PARTY_SCALING.packRarity}% magic and rare pack chance`,
      `Counts the living players in the map (a party of ${MAX_PARTY_SIZE}: ${partyTimes(full.monsterLife)} life, `
        + `${partyTimes(full.waveBudget)} monsters, ${partyTimes(full.packRarity)} elite packs)`,
      'Loot is never split: every player rolls their own drops',
    ],
  };
}

/**
 * Party scaling right now, for the HUD / map tooltip: one line per effect for `players` living players
 * ("Monster Life 2.5x" with "+50% per player beyond the first: party of 4"). Solo = all 1x.
 */
export function partyScalingLines(players: number): MapSummaryLine[] {
  const s = partyScaling(players);
  const who = s.players === 1 ? 'you are alone: no party scaling' : `party of ${s.players}`;
  const per = (pct: number) => `+${pct}% per living player beyond the first (${who})`;
  return [
    { label: 'Monster Life', value: partyTimes(s.monsterLife), breakdown: [per(PARTY_SCALING.monsterLife), 'Set when a monster spawns'] },
    { label: 'Monsters per Wave', value: partyTimes(s.waveBudget), breakdown: [per(PARTY_SCALING.waveBudget), 'Set when a wave starts'] },
    { label: 'Magic / Rare Packs', value: partyTimes(s.packRarity), breakdown: [per(PARTY_SCALING.packRarity)] },
  ];
}

// ---------------------------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------------------------

function modLines(rolled: RolledMapMod, tier: number, boss: string, baseId: MapBaseId | string): TooltipLine[] {
  const def = getMapMod(rolled.modId);
  if (!def) return [];
  const range = modValueRange(tier);
  const lines: TooltipLine[] = [];
  const kind: TooltipLine['kind'] = def.kind === 'corrupted' || def.kind === 'echo' ? 'corrupted' : 'mapMod';
  const tags = [def.kind === 'danger' ? 'Danger' : def.kind === 'reward' ? 'Reward' : 'Corrupted'];
  const push = (e: MapEffectDef) => {
    const v = effectMagnitude(e, rolled.value);
    const line: TooltipLine = { text: effectText(e.stat, e.mode, v, boss), kind, affixName: mapModName(def, baseId), tags };
    if (!e.fixed && def.kind !== 'echo') {
      const lo = effectMagnitude(e, range.min);
      const hi = effectMagnitude(e, range.max);
      if (lo !== hi) line.range = `(${formatNumber(Math.abs(lo))}–${formatNumber(Math.abs(hi))})`;
    }
    if (isThreat(e.stat)) line.negative = true;
    lines.push(line);
  };
  def.danger.forEach(push);
  def.reward.forEach(push);
  return lines;
}

export interface MapDescribeOptions {
  /** Map sits in the map device. */
  inDevice?: boolean;
  /** Map sits in the Map Stash. */
  inMapStash?: boolean;
}

/** Tooltip for a map. Tone follows rarity (Normal maps use the silver map tone). */
export function describeMap(map: MapItem, opts: MapDescribeOptions = {}): ItemDescription {
  const base = findMapBase(map.baseId);
  const tier = clampTier(map.tier);
  const level = monsterLevelForTier(tier);
  const luck = mapLuck(map, null);
  const title = mapTitle(map);
  const properties: { label: string; value: string }[] = [
    { label: 'Monster Level', value: String(level) },
    // Map-side luck only: each player's gear luck adds to their own drops (named so nobody reads it as theirs).
    { label: 'Map Item Quantity', value: signedPercent(luck.quantity.value - 100) },
    { label: 'Map Item Rarity', value: signedPercent(luck.rarity.value - 100) },
    { label: 'Waves', value: String(waveConfig(map).count) },
    { label: 'Boss', value: mapBosses(map.baseId).boss.name },
    { label: 'Experience', value: times(experienceMultiplier(tier)) },
  ];
  if (map.quality > 0) properties.push({ label: 'Quality', value: `+${map.quality}%` });

  const implicits: TooltipLine[] = base
    ? [
      ...base.implicitEffects.map((e): TooltipLine => ({ text: effectText(e.stat, e.mode, e.value), kind: 'implicit', ...(isThreat(e.stat) ? { negative: true } : {}) })),
      ...(base.arenaNote ? [{ text: base.arenaNote, kind: 'implicit' as const }] : []),
    ]
    : [];
  const levelPenalty = resistancePenaltyForLevel(level);
  if (levelPenalty > 0) implicits.push({
    text: `Players have -${formatNumber(levelPenalty)}% to all Resistances from monster level ${level}`,
    kind: 'implicit', negative: true,
  });
  const affixes = map.mods.flatMap((m) => modLines(m, tier, mapBosses(map.baseId).boss.sentence, map.baseId));

  const headerLines = [`Tier ${tier} Map`];
  if (map.bounty) headerLines.push('Bounty: The Hunted guaranteed');
  if (map.charted) headerLines.push(`Charted: completion chest guarantees a Tier ${Math.min(MAX_MAP_TIER, map.tier + 1)} map`);
  if (map.twinInked) headerLines.push('Twin Ink: two reward-mod slots');
  if (map.corrupted) headerLines.push('Corrupted');
  let hint = opts.inDevice
    ? 'Activate the Map Device to open a portal.'
    : opts.inMapStash
      ? 'Drag it to the Map Device or your backpack; Ctrl+click takes it to your backpack.'
      : 'Place it in the Map Device in your hideout, then activate the device.';
  if (map.corrupted) hint += ' Corrupted: map currency no longer works on it.';

  const desc: ItemDescription = {
    title,
    subtitle: map.rarity === 'rare' ? (base?.name ?? null) : null,
    tone: map.rarity === 'normal' ? 'map' : map.rarity,
    iconId: iconIdForMap(base ? base.id : MAP_BASE_IDS[0]),
    classLabel: 'Map',
    size: { w: 1, h: 1 },
    headerLines,
    properties,
    implicits,
    affixes,
    scars: [],
    hint,
  };
  if (base) desc.description = base.description;
  if (map.corrupted) desc.corrupted = true;
  return desc;
}

// ---------------------------------------------------------------------------------------------
// Map crafting
// ---------------------------------------------------------------------------------------------

export type MapCurrencyId = 'mapDust' | 'threatGlyph' | 'rewardInk' | 'voidNeedle' | 'compass' | 'twinInk' | 'voidSplinter';

export function isMapCurrencyId(id: CurrencyId): id is MapCurrencyId {
  return id === 'mapDust' || id === 'threatGlyph' || id === 'rewardInk' || id === 'voidNeedle'
    || id === 'compass' || id === 'twinInk' || id === 'voidSplinter';
}

function currencyName(id: CurrencyId): string {
  return findCurrency(id)?.name ?? 'That currency';
}

function eligibleDanger(map: MapItem): MapModDef[] {
  const present = new Set(map.mods.map((m) => m.modId));
  return DANGER_MODS.filter((m) => !present.has(m.id));
}

/** Void Needle outcomes possible on this map, with weights. */
export function voidOutcomes(map: MapItem): { id: VoidOutcomeId; label: string; weight: number }[] {
  return VOID_NEEDLE_OUTCOMES.filter((o) => o.id !== 'tierUp' || clampTier(map.tier) < MAX_MAP_TIER);
}

/** Player-facing reason why a map currency cannot be applied to this map, or null. */
export function mapCraftError(map: MapItem, currencyId: CurrencyId): string | null {
  if (currencyId === 'reliquaryKey') return 'Select the Sealed Reliquary in the Map Device to use this key.';
  const name = currencyName(currencyId);
  if (!isMapCurrencyId(currencyId)) return `${name} cannot be applied to maps.`;
  if (currencyId === 'voidSplinter') return map.corrupted ? null : 'This map is not corrupted.';
  if (map.corrupted) return 'Use a Void Splinter to remove corruption before modifying this map.';
  switch (currencyId) {
    case 'compass': return map.charted ? 'This map is already charted.' : map.tier >= MAX_MAP_TIER ? 'Tier 15 is already the highest map tier.' : null;
    case 'twinInk': return !map.twinInked && rewardModCount(map) === 1 ? null : 'Twin Ink needs exactly one reward-only mod and can be used once per map.';
    case 'mapDust':
      return null;
    case 'threatGlyph':
      if (dangerModCount(map) >= MAX_DANGER_MODS) return `This map already has ${MAX_DANGER_MODS} danger mods, the most it can hold.`;
      if (!eligibleDanger(map).length) return 'No danger mod is left to add.';
      return null;
    case 'rewardInk': {
      if (rewardModCount(map) >= MAX_REWARD_MODS) {
        const def = getMapMod(modsOfKind(map, 'reward')[0]?.modId ?? '');
        const current = def ? mapModName(def, map.baseId) : 'a reward mod';
        return `This map already carries ${current}. Reward Ink adds at most one reward mod.`;
      }
      return null;
    }
    case 'voidNeedle':
      return null;
  }
}

/**
 * Exact inclusion odds of weighted draws without replacement: chance that each mod ends up among
 * `count` draws. Enumerates every draw order (≤ 10 × 9 × 8 × 7 paths), so it is exact.
 */
export function inclusionChances(pool: readonly MapModDef[], count: number): Map<string, number> {
  const out = new Map<string, number>(pool.map((m) => [m.id, 0]));
  const walk = (left: readonly MapModDef[], k: number, p: number, picked: readonly string[]) => {
    if (k === 0 || !left.length) {
      for (const id of picked) out.set(id, (out.get(id) ?? 0) + p);
      return;
    }
    const total = left.reduce((s, m) => s + m.weight, 0);
    for (const m of left) {
      if (m.weight <= 0) continue;
      walk(left.filter((x) => x !== m), k - 1, (p * m.weight) / total, [...picked, m.id]);
    }
  };
  walk(pool, count, 1, []);
  return out;
}

function pickOddsLine(prefix: string, pool: readonly MapModDef[], baseId: MapBaseId | string): string {
  const parts = formatDistribution(pool.map((m) => ({ label: mapModName(m, baseId), chance: m.weight })));
  return `${prefix}: ${parts.join(' · ')}`;
}

function countOddsText(table: readonly { count: number; weight: number }[]): string {
  const parts = formatDistribution(table.map((c) => ({ label: `${c.count} mod${c.count === 1 ? '' : 's'}`, chance: c.weight })));
  return parts.join(' · ');
}

function inclusionLine(pool: readonly MapModDef[], counts: readonly { count: number; weight: number }[], baseId: MapBaseId | string): string {
  const total = counts.reduce((s, c) => s + c.weight, 0);
  const acc = new Map<string, number>();
  for (const c of counts) {
    const odds = inclusionChances(pool, c.count);
    for (const [id, p] of odds) acc.set(id, (acc.get(id) ?? 0) + (p * c.weight) / total);
  }
  const parts = pool
    .map((m) => ({ name: mapModName(m, baseId), p: acc.get(m.id) ?? 0 }))
    .sort((a, b) => b.p - a.p)
    .map((e) => `${e.name} ${formatChance(e.p)}`);
  return `Chance for each mod: ${parts.join(' · ')}`;
}

/** Exact odds / effects for the currency tooltip on this map; a single reason line when impossible. */
export function mapCraftPreview(map: MapItem, currencyId: CurrencyId): string[] {
  const error = mapCraftError(map, currencyId);
  if (error) return [error];
  const lines: string[] = [];
  const danger = dangerModCount(map);
  switch (currencyId as MapCurrencyId) {
    case 'compass':
      lines.push(`The completion chest's progression map will be Tier ${Math.min(MAX_MAP_TIER, map.tier + 1)} (100% chance, instead of 25%).`, 'Mods, quality and the extra-map roll are unchanged.'); break;
    case 'twinInk': {
      const pool = REWARD_MODS.filter(m => !map.mods.some(r => r.modId === m.id));
      lines.push(pickOddsLine('Adds a second reward-only mod', pool, map.baseId), 'Preserves the first reward and all danger mods. Twin Ink can be used once per map.'); break;
    }
    case 'voidSplinter': {
      const removed = map.mods.filter(m => m.corrupted || ['corrupted', 'echo'].includes(getMapMod(m.modId)?.kind ?? ''));
      lines.push(`Removes corruption and ${removed.length ? names(removed, map.baseId) : 'no modifiers'}.`, `Quality falls from ${map.quality} to 0. Tier ${map.tier}, ordinary mods and paid commissions remain. The map can be crafted again.`); break;
    }
    case 'mapDust': {
      if (danger === 0) {
        lines.push(`Awakens a Magic map with ${countOddsText(MAP_DUST_COUNTS.magic)}.`);
        lines.push(inclusionLine(DANGER_MODS, MAP_DUST_COUNTS.magic, map.baseId));
      } else {
        const band = map.rarity === 'rare' ? 'rare' : 'magic';
        lines.push(`Rerolls all ${danger} danger mod${danger === 1 ? '' : 's'}: ${countOddsText(MAP_DUST_COUNTS[band])}. The map stays ${band === 'rare' ? 'Rare' : 'Magic'}.`);
        lines.push(inclusionLine(DANGER_MODS, MAP_DUST_COUNTS[band], map.baseId));
      }
      const rewards = modsOfKind(map, 'reward');
      if (rewards.length) lines.push(`Reward mods are kept: ${names(rewards, map.baseId)}.`);
      break;
    }
    case 'threatGlyph': {
      const pool = eligibleDanger(map);
      lines.push(pickOddsLine(`Adds one of ${pool.length} danger mods`, pool, map.baseId));
      if (rarityForDangerCount(danger + 1) !== map.rarity) {
        lines.push(`The map becomes ${rarityForDangerCount(danger + 1) === 'rare' ? 'Rare' : 'Magic'}.`);
      }
      lines.push(`Danger mods: ${danger} of ${MAX_DANGER_MODS}.`);
      break;
    }
    case 'rewardInk':
      lines.push(pickOddsLine(`Inscribes one of ${REWARD_MODS.length} reward mods`, REWARD_MODS, map.baseId));
      lines.push('Reward mods add no danger and do not change the map’s rarity.');
      break;
    case 'voidNeedle': {
      const outcomes = voidOutcomes(map);
      lines.push(`Corrupts the map: ${formatDistribution(outcomes.map((o) => ({ label: o.label, chance: o.weight }))).join(' · ')}`);
      lines.push(pickOddsLine('Corrupted mods', CORRUPTED_MODS, map.baseId));
      lines.push('Further crafting requires a Void Splinter, which removes corruption, its modifiers and all quality.');
      break;
    }
  }
  return lines;
}

export interface MapCraftResult {
  map: MapItem;
  message: string;
  kind: 'success' | 'corrupted';
}

function names(mods: readonly RolledMapMod[], baseId: MapBaseId | string): string {
  const list = mods.map((m) => {
    const def = getMapMod(m.modId);
    return def ? mapModName(def, baseId) : 'a mod';
  });
  if (list.length <= 1) return list.join('');
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

function withMods(map: MapItem, mods: RolledMapMod[]): MapItem {
  const sorted = sortMapMods(mods);
  const next = { ...map, mods: sorted };
  return { ...next, rarity: rarityForDangerCount(dangerModCount(next)) };
}

/** Apply a map currency with an rng. Validate with mapCraftError first (this throws on misuse). */
export function craftMap(map: MapItem, currencyId: CurrencyId, rng: Rng): MapCraftResult {
  const error = mapCraftError(map, currencyId);
  if (error) throw new Error(error);
  const tier = clampTier(map.tier);
  const keep = map.mods.filter((m) => getMapMod(m.modId)?.kind !== 'danger');
  switch (currencyId as MapCurrencyId) {
    case 'compass': return { map: { ...map, charted: true }, message: 'Compass charted the map: the completion chest guarantees a higher-tier map', kind: 'success' };
    case 'twinInk': {
      const pool = REWARD_MODS.filter(m => !map.mods.some(r => r.modId === m.id));
      const pick = rng.weighted(pool, m => m.weight)!;
      return { map: { ...withMods(map, [...map.mods, { modId: pick.id, value: rollModValue(rng, tier) }]), twinInked: true },
        message: `Twin Ink added ${mapModName(pick, map.baseId)} as a second reward mod`, kind: 'success' };
    }
    case 'voidSplinter': return {
      map: withMods({ ...map, corrupted: false, quality: 0 }, map.mods.filter(m => !m.corrupted && !['corrupted', 'echo'].includes(getMapMod(m.modId)?.kind ?? ''))),
      message: 'Void Splinter removed corruption, corruption-marked mods and all quality', kind: 'success',
    };
    case 'mapDust': {
      const band = dangerModCount(map) === 0 ? 'magic' : map.rarity === 'rare' ? 'rare' : 'magic';
      const count = rollCountTable(rng, MAP_DUST_COUNTS[band]);
      const rolled = rollDangerMods(rng, count, tier);
      const next = withMods(map, [...keep, ...rolled]);
      const verb = dangerModCount(map) === 0 ? 'awakened' : 'rerolled the danger mods into';
      return { map: next, message: `Map Dust ${verb} ${names(rolled, map.baseId)}`, kind: 'success' };
    }
    case 'threatGlyph': {
      const pick = rng.weighted(eligibleDanger(map), (m) => m.weight)!;
      const added: RolledMapMod = { modId: pick.id, value: rollModValue(rng, tier) };
      const next = withMods(map, [...map.mods, added]);
      let message = `Threat Glyph added ${mapModName(pick, map.baseId)}`;
      if (next.rarity !== map.rarity) message += ` · the map is now ${next.rarity === 'rare' ? 'Rare' : 'Magic'}`;
      return { map: next, message, kind: 'success' };
    }
    case 'rewardInk': {
      const pick = rng.weighted(REWARD_MODS, (m) => m.weight)!;
      const next = withMods(map, [...map.mods, { modId: pick.id, value: rollModValue(rng, tier) }]);
      return { map: next, message: `Reward Ink inscribed ${mapModName(pick, map.baseId)}`, kind: 'success' };
    }
    case 'voidNeedle': {
      const outcome = rng.weighted(voidOutcomes(map), (o) => o.weight)!.id;
      let next: MapItem = map;
      let message: string;
      switch (outcome) {
        case 'corruptedMod': {
          const pick = rng.weighted(CORRUPTED_MODS, (m) => m.weight)!;
          next = withMods(map, [...map.mods, { modId: pick.id, value: rollModValue(rng, tier), corrupted: true }]);
          message = `Void Needle corrupted the map with ${mapModName(pick, map.baseId)}`;
          break;
        }
        case 'tierUp':
          next = { ...map, tier: tier + 1 };
          message = `Void Needle corrupted the map: Tier ${tier} became Tier ${tier + 1}`;
          break;
        case 'rareFour': {
          const rolled = rollDangerMods(rng, MAX_DANGER_MODS, tier).map((m) => ({ ...m, corrupted: true }));
          next = withMods(map, [...keep, ...rolled]);
          message = `Void Needle corrupted the map into a Rare with ${names(rolled, map.baseId)}`;
          break;
        }
        case 'echoWave':
          next = withMods(map, [...map.mods, { modId: ECHO_MOD.id, value: 100, corrupted: true }]);
          message = `Void Needle corrupted the map: an Echo wave will follow ${mapBosses(map.baseId).boss.sentence}`;
          break;
        default:
          message = 'Void Needle corrupted the map. Nothing else changed';
      }
      return { map: { ...next, corrupted: true }, message, kind: 'corrupted' };
    }
  }
  throw new Error(`${currencyName(currencyId)} cannot be applied to maps.`);
}
