// Definition types for item content (bases, affixes, uniques, scars, currencies, flasks).
// Runtime items (src/contracts/items.ts) store only ids + rolled numbers; everything else lives here.
import type {
  AffixKind, AffixTag, ModifierMode, StatId,
} from '../../contracts/items';
import type { BaseInfo, CurrencyInfo, FlaskInfo } from '../../contracts/game';
import type { BaseId, ItemClass, PlayerFlag, UniqueId } from '../../contracts/content';

/**
 * What a rolled number does. One line may feed several stats with the same value
 * ("+10 to all Attributes" → str, dex, int). `text` overrides the stat text table and
 * supports the placeholders documented in `src/data/items/stat-text.ts`.
 */
export interface ModLineDef {
  stats: readonly StatId[];
  mode: ModifierMode;
  text?: string;
}

export interface RangeDef {
  min: number;
  max: number;
}

/** A base implicit: always present, rolled once when the item is created. */
export interface ImplicitDef extends ModLineDef, RangeDef {}

/**
 * A base property that scales with item level: `floor(base + perItemLevel × itemLevel)`.
 * Flat and increased modifiers of the same stat on the same item are *local*: they fold into the
 * property value (PoE-style "Armour: 84"), and the item emits one flat modifier for the total.
 */
export interface BasePropertyDef {
  stat: StatId;
  label: string;
  base: number;
  perItemLevel: number;
}

/** Crafting material of a base: changes how crafting behaves on it. */
export interface MaterialDef {
  name: string;
  /** Affix weight multipliers by tag (multiplied together for every matching tag). */
  tagWeights?: Partial<Record<AffixTag, number>>;
  /** Scar risk applies when remaining stability ≤ this (default SCAR_THRESHOLD). */
  scarThreshold?: number;
}

export interface BaseDef extends BaseInfo {
  implicits: readonly ImplicitDef[];
  properties: readonly BasePropertyDef[];
  material?: MaterialDef;
  /** Relative weight for random base picks (loot, gambling). */
  dropWeight: number;
}

export interface AffixTierDef {
  /** 1 = best. */
  tier: number;
  /** Minimum item level for this tier to roll. */
  itemLevel: number;
  weight: number;
  min: number;
  max: number;
}

export interface AffixDef extends ModLineDef {
  id: string;
  /** "Blazing" (prefix) or "of Haste" (suffix); also used to build magic item names. */
  name: string;
  kind: AffixKind;
  /** Exclusive group: an item never holds two affixes of the same group. */
  group: string;
  tags: readonly AffixTag[];
  classes: readonly ItemClass[];
  /** Only rolls on bases that have this property (e.g. % Armour needs an Armour base). */
  requiresProperty?: StatId;
  /** Sorted by tier ascending (T1 first). */
  tiers: readonly AffixTierDef[];
}

export interface UniqueModDef extends ModLineDef, RangeDef {}

export interface UniqueFlagDef {
  flag: PlayerFlag;
  text: string;
}

export interface UniqueDef {
  id: UniqueId;
  name: string;
  baseId: BaseId;
  flavor: string;
  levelRequirement: number;
  /** Rolled stat lines; stored on the item as RolledAffix entries with id `unique:<uniqueId>:<index>`. */
  mods: readonly UniqueModDef[];
  flags: readonly UniqueFlagDef[];
  dropWeight: number;
}

export interface ScarDef extends ModLineDef, RangeDef {
  id: string;
  name: string;
  /** Rolled magnitudes are positive; the modifier value is `sign × value`. */
  sign: 1 | -1;
  weight: number;
  /** Omitted = every class. */
  classes?: readonly ItemClass[];
  requiresProperty?: StatId;
}

export type CurrencyDropTier = 'common' | 'uncommon' | 'rare';

export interface CurrencyDef extends CurrencyInfo {
  /** Essences: an affix qualifies when it has at least one of these tags. */
  essenceTags?: readonly AffixTag[];
  /** Essences: human noun for the tag family ("fire", "life, defence or resistance"). */
  essenceLabel?: string;
  /** Presentation hint for drops (beams/sounds scale with it). */
  dropTier: CurrencyDropTier;
}

export interface FlaskDef extends FlaskInfo {
  /** Total recovery = recoverBase + recoverPerLevel × character level (before flask effect). */
  recoverBase: number;
  recoverPerLevel: number;
  /** Seconds over which the amount is recovered. */
  duration: number;
}

export type { AffixKind };
