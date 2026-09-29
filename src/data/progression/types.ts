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

/** How player modifiers apply to a skill (which runtime fields they touch). */
export type SkillShape = 'projectile' | 'nova' | 'chain' | 'dash' | 'ward';

export interface SkillDef extends SkillInfo {
  shape: SkillShape;
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
  | 'armourStability' | 'echoWave';

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
  | { id: string; kind: 'map'; baseId: MapBaseId; tier: number; price: readonly PriceDef[] }
  | { id: string; kind: 'flask'; flaskId: FlaskId; count: number; price: readonly PriceDef[] }
  | { id: string; kind: 'currency'; currencyId: CurrencyId; count: number; price: readonly PriceDef[] };

export interface GambleDef {
  price: readonly PriceDef[];
  /** Base chances in percent before the gear rarity multiplier; the remainder is Normal. */
  chances: { magic: number; rare: number; unique: number };
  classes: readonly ItemClass[];
}
