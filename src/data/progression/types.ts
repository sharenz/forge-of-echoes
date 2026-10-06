// Definition types for progression content: classes, skills, map bases/mods, loot tables, merchant.
// Runtime state (CharacterSave, MapItem…) stores only ids + rolled numbers; everything else lives here.
import type { SkillInfo, MapBaseInfo } from '../../contracts/game';
import type { ModifierMode, StatId } from '../../contracts/items';
import type {
  Attribute, CurrencyId, DamageType, FlaskId, ItemClass, MapBaseId, MonsterKind, PlayerFlag,
} from '../../contracts/content';

// ---------------------------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------------------------

export interface AttributeGrowthDef {
  /** Value at level 1. */
  base: number;
  /** Automatic growth per level above 1 (the total is floored). */
  perLevel: number;
}

/** "+value <mode> <stat> per level above 1" — an ordinary modifier with source "Level N". */
export interface PerLevelRuleDef {
  stat: StatId;
  mode: ModifierMode;
  value: number;
}

/** "+value <mode> <stat> per `per` points of <attr>" — an ordinary modifier with the attribute as source. */
export interface PerAttributeRuleDef {
  attribute: Attribute;
  stat: StatId;
  mode: ModifierMode;
  /** Points of the attribute per step (1 = every point). */
  per: number;
  value: number;
}

export interface ClassDef {
  id: 'sorceress';
  name: string;
  attributes: Record<Attribute, AttributeGrowthDef>;
  attributePointsPerLevel: number;
  skillPointsPerLevel: number;
  /** Base value of every stat before modifiers (stats not listed use their neutral base). */
  baseStats: Partial<Record<StatId, number>>;
  perLevel: readonly PerLevelRuleDef[];
  perAttribute: readonly PerAttributeRuleDef[];
  /** Focus regeneration: flat per second plus a percentage of maximum Focus per second. */
  focusRegen: { flat: number; percentOfMaxFocus: number };
  /** Every skill hit starts from `base + perLevel × (level − 1)` (plus added spell damage). */
  spellPower: { base: number; perLevel: number };
  /**
   * Evade chance = rating / (rating + evasionPerMonsterLevel × monster level), capped: the same rating avoids
   * fewer hits from higher-level monsters (Path of Exile's accuracy vs evasion). Outside a map the sheet uses
   * the reference monster level.
   */
  evasionPerMonsterLevel: number;
  evasionCap: number;
  resistCap: number;
}

// ---------------------------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------------------------

/**
 * A number that depends on skill rank:
 *   number                                  constant
 *   { lerp: [r1, rMax], round? }            linear from rank 1 to max rank
 *   { base, steps: [ranks…] }               +1 at each listed rank
 *   { base, every, after, cap? }            base + floor(max(0, rank − after) / every), capped
 */
export type RankValue =
  | number
  | { lerp: readonly [number, number]; round?: 'floor' | 'round' }
  | { base: number; steps: readonly number[] }
  | { base: number; every: number; after: number; cap?: number };

/**
 * How player modifiers apply to a skill (which runtime fields they touch) and how its tooltip reads. `area` (ground strikes,
 * zones, bursts around the caster) and `buff` (non-damaging self buffs) are used by roster skills whose behaviour ships later.
 */
export type SkillShape = 'projectile' | 'nova' | 'chain' | 'dash' | 'ward' | 'area' | 'buff';

/** The sim emitter a skill's behaviour starts from (docs/power-rework/skills.md 4.2). */
export type SkillEmitter = 'projectile' | 'burst' | 'strike' | 'zone' | 'chain' | 'dash' | 'buff';

/** Runtime fields an augment can change before player modifiers apply (base numbers of the skill at its rank). */
export type AugmentStat =
  | 'castTime' | 'cooldown' | 'range' | 'radius' | 'spread' | 'focusCost' | 'distance' | 'duration' | 'damageReductionCap' | 'charges';

/** Primitives of the behaviour grammar that have no executor yet (SK5/SK6): an augment using one is listed but not pickable. */
export type PlannedPrimitive =
  | 'split' | 'fork' | 'lodge' | 'delay' | 'convert' | 'trail' | 'bounce' | 'return' | 'expose' | 'mark' | 'ailment' | 'onKill'
  | 'shape' | 'rehit' | 'refund' | 'summon' | 'cap';

/**
 * One effect of an augment, in the behaviour grammar of docs/power-rework/skills.md 4.2. The rules fold the stat-like ones
 * (`more`, `scale`, `add`, `set`, `count`, `pierce`, `chain`) into the runtime numbers; `echo`, `shape`, `invulnerable` and
 * `flag` reach the sim executor (SkillRuntimeDef.augments / flags).
 */
export type AugmentEffect =
  /** Hits deal `pct`% more (negative: less). Counts in the global `more` pool (MORE_CAP). */
  | { k: 'more'; pct: number }
  /** The base number changes by `pct`% (cast time −18%, range +30%). */
  | { k: 'scale'; stat: AugmentStat; pct: number }
  /** The base number gains `value` (cooldown +1 s, Focus +2). */
  | { k: 'add'; stat: AugmentStat; value: number }
  /** The base number becomes `value` (Twin Strand's 12° fan, Banked Embers' r80). */
  | { k: 'set'; stat: AugmentStat; value: number }
  /** More projectiles/strikes: `add` more, or `mult` times as many. */
  | { k: 'count'; add?: number; mult?: number }
  | { k: 'pierce'; add: number }
  | { k: 'chain'; add: number }
  /** Repeat the cast after `delay` s at `damage`% of the hit, no Focus. */
  | { k: 'echo'; delay: number; damage: number }
  /** A ring becomes a fan of `arc` radians toward the aim, or projectiles spread in a full circle. */
  | { k: 'shape'; shape: 'fan' | 'circle'; arc?: number }
  /** Invulnerability after a blink, seconds. */
  | { k: 'invulnerable'; seconds: number }
  /** Hits always inflict the skill's ailment. */
  | { k: 'alwaysAilment' }
  /** A skill behaviour flag the executor already knows (the same flags uniques grant: 'chillLanding', 'cold', 'restoreFocus', 'renew'). */
  | { k: 'flag'; flag: string }
  /** A primitive whose executor ships later; `note` says what it will do. */
  | { k: 'planned'; primitive: PlannedPrimitive; note?: string };

export interface AugmentDef {
  /** Unique within its skill (stored in CharacterSave.augments). */
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  /** Player-facing effect text (docs/power-rework/skills.md 5 and 6). */
  text: string;
  /** Augments of the same skill it cannot be taken with (symmetric: tests check both sides). */
  excludes?: readonly string[];
  effects: readonly AugmentEffect[];
  /** A unique whose flag already grants this behaviour (no slot needed; the better value applies). */
  grantedBy?: PlayerFlag;
}

export interface SkillDef extends SkillInfo {
  shape: SkillShape;
  emitter: SkillEmitter;
  /** The augment tree (data; SkillInfo.augments is its player-facing summary). */
  augmentDefs: readonly AugmentDef[];
  /** Damage type used by the sim (non-damaging skills still carry one). */
  runtimeDamageType: DamageType;
  focusCost: number;
  /** Base cast time in seconds (0 = instant). Divided by cast speed. */
  castTime: number;
  /** Base cooldown in seconds (0 = none; per charge when charges > 1). Divided by cooldown recovery. */
  cooldown: RankValue;
  charges: RankValue;
  /** Multiplies spell power. 0 = the skill deals no damage. */
  effectiveness: RankValue;
  /** Base critical strike chance in percent. */
  critChance: number;
  /** Base ignite / chill / shock chance in percent (by damage type). */
  ailmentChance: number;
  projectiles: RankValue;
  pierce: RankValue;
  /** Projectiles pierce every enemy (Flame Wave). */
  pierceAll?: boolean;
  projectileSpeed: number;
  range: number;
  spread: number;
  radius: number;
  duration: RankValue;
  chains: RankValue;
  distance: RankValue;
  damageReduction: RankValue;
  damageReductionCap?: number;
  /** Seconds between damage pulses for skills that deal damage over time (Cinder Ward embers). */
  pulseInterval?: number;
  /** Player flags (uniques) that grant a skill-specific behaviour flag. */
  flagsFrom?: readonly { playerFlag: PlayerFlag; skillFlag: string; text: string }[];
  /** Area of effect scales this runtime field (radius multiplier = sqrt(1 + area%)). */
  areaScales?: 'range' | 'radius';
  /** Noun for the projectiles in skill text ("flame", "shard"). */
  projectileNoun?: string;
}

// ---------------------------------------------------------------------------------------------
// Maps
// ---------------------------------------------------------------------------------------------

/**
 * Stats a map can change. Monster stats resolve with the same formula as player stats
 * (base + Σflat) × (1 + Σincreased/100) × Π(1 + more/100).
 */
export type MapStat =
  | 'monsterCount' | 'monsterLife' | 'monsterDamage' | 'monsterSpeed' | 'packRarity' | 'monsterResist'
  | 'monsterProjectiles' | 'hazards'
  | 'playerFocusRegen' | 'playerResist'
  | 'itemQuantity' | 'itemRarity'
  | 'mapDropChance' | 'essenceDropChance' | 'emberEssenceChance' | 'rimeEssenceChance'
  | 'armourStability' | 'echoWave'
  // Atlas tree only (data/progression/map-tree.ts): never rolled on a map mod.
  | 'magicPackChance' | 'rarePackChance' | 'eventChance' | 'chestUpgradeChance' | 'chestQuality' | 'droppedMapQuality'
  | 'scarabDropChance' | 'rareQuantity' | 'normalQuantity' | 'equipmentStability' | 'equipmentDropChance' | 'bossIngredientChance'
  | 'bossLife' | 'bossUnique' | 'bossLoot' | 'chestLoot' | 'chestRareChance' | 'chestCurrency'
  | 'waveDuration' | 'territoryFee' | 'revealChance' | 'dangerModStrength' | 'corruptedModStrength'
  // Daily surge (brief D 7.5; read by game/progression/surge.ts and loot.ts, never resolved on a map)
  | 'surgeCharges' | 'surgeKeep' | 'sandChance'
  // Beacons and sigils (brief D 6, 9; read by game/progression/territory.ts, never resolved on a map)
  | 'beaconSlots' | 'beaconRadius' | 'sigilUses';

export interface MapEffectDef {
  stat: MapStat;
  mode: ModifierMode;
  /** Nominal magnitude (at a mod roll of 100). */
  value: number;
  /** Fixed magnitude: does not scale with the mod's rolled value. */
  fixed?: boolean;
}

export type MapModKind = 'danger' | 'reward' | 'corrupted' | 'echo';

export interface MapModDef {
  id: string;
  name: string;
  /**
   * The name on a map of that base, for a mod named after the map's boss ("Varkus's Wrath" on an Iron Coliseum);
   * `name` everywhere else. Only the name follows the base: the id — what a saved map stores — is the same on every
   * base (the map rules' mapModName picks the name).
   */
  nameByBase?: Readonly<Partial<Record<MapBaseId, string>>>;
  kind: MapModKind;
  /** What the map asks of you. */
  danger: readonly MapEffectDef[];
  /** What it pays. */
  reward: readonly MapEffectDef[];
  /** Relative weight when a craft picks a mod of this kind. */
  weight: number;
}

/** A map base. Its player-facing implicit text is generated from `implicitEffects` by the map rules. */
export interface MapBaseDef extends Omit<MapBaseInfo, 'implicit'> {
  arenaRadius: number;
  /** The theme's roster (contracts/bestiary.ts THEME_ROSTER): wave families, the wave-3 lieutenant, the boss. */
  family: readonly MonsterKind[];
  lieutenant: MonsterKind;
  boss: MonsterKind;
  /** Extra implicit line that is not an effect (e.g. "Small arena"). */
  arenaNote?: string;
  implicitEffects: readonly MapEffectDef[];
  dropWeight: number;
}

// ---------------------------------------------------------------------------------------------
// Loot
// ---------------------------------------------------------------------------------------------

export type LootCategory = 'currency' | 'equipment' | 'flask' | 'map';

export interface RarityWeightDef {
  /** weight = base × m^exponent, m = item rarity / 100. */
  base: number;
  exponent: number;
}

export interface CurrencyDropDef {
  currencyId: CurrencyId;
  weight: number;
  /** Stack size weights (count → weight). Omitted = always 1. */
  stack?: readonly { count: number; weight: number }[];
}

export interface FlaskDropDef {
  flaskId: FlaskId;
  weight: number;
}

export interface MonsterLootMultiplier {
  quantity: number;
  rarity: number;
}

// ---------------------------------------------------------------------------------------------
// Merchant
// ---------------------------------------------------------------------------------------------

export interface PriceDef {
  currencyId: CurrencyId;
  count: number;
}

export type MerchantStockDef =
  | { id: string; kind: 'flask'; flaskId: FlaskId; count: number; price: readonly PriceDef[] }
  | { id: string; kind: 'currency'; currencyId: CurrencyId; count: number; price: readonly PriceDef[] };

export interface GambleDef {
  price: readonly PriceDef[];
  /** Base chances in percent before the gear rarity multiplier; the remainder is Normal. */
  chances: { magic: number; rare: number; unique: number };
  classes: readonly ItemClass[];
}
