import type { AttributeKey, CharacterClassId, DerivedStatKey, ModifierMode } from "../domain";

interface ContributionRuleBase {
  stat: DerivedStatKey;
  mode: ModifierMode;
  source: string;
  label: string;
  /** Omit for a universal rule; set this to create class-specific base curves. */
  classes?: readonly CharacterClassId[];
}

export interface ConstantStatContribution extends ContributionRuleBase {
  kind: "constant";
  value: number;
}

export interface PerLevelStatContribution extends ContributionRuleBase {
  kind: "perLevel";
  valuePerUnit: number;
  levelsPerUnit?: number;
  wholeUnits?: boolean;
}

export interface PerAttributeStatContribution extends ContributionRuleBase {
  kind: "perAttribute";
  attribute: AttributeKey;
  valuePerUnit: number;
  attributePointsPerUnit?: number;
  wholeUnits?: boolean;
}

export type StatContributionRule =
  | ConstantStatContribution
  | PerLevelStatContribution
  | PerAttributeStatContribution;

/** Used only when no weapon is equipped or an obsolete save references an unknown base. */
export const UNARMED_ATTACKS_PER_SECOND = 1.2;
/** Prevents zero/negative cooldowns from destabilizing input and simulation loops. */
export const MINIMUM_SKILL_COOLDOWN_MULTIPLIER = 0.01;

/**
 * Character-derived stats are content rules, not formulas hidden in the engine.
 * Per-level rules count levels after level one; constants are the level-one base.
 */
export const DERIVED_STAT_RULES = [
  { kind: "constant", stat: "maxLife", mode: "flat", value: 89, source: "character:base-life", label: "Base Life" },
  { kind: "perLevel", stat: "maxLife", mode: "flat", valuePerUnit: 7, source: "level:max-life", label: "+7 Life per level" },
  { kind: "perAttribute", stat: "maxLife", mode: "flat", attribute: "strength", valuePerUnit: 2, source: "attribute:strength:max-life", label: "+2 Life per Strength" },

  { kind: "constant", stat: "maxFocus", mode: "flat", value: 53.5, source: "character:base-focus", label: "Base Focus" },
  { kind: "perLevel", stat: "maxFocus", mode: "flat", valuePerUnit: 1.5, source: "level:max-focus", label: "+1.5 Focus per level" },
  { kind: "perAttribute", stat: "maxFocus", mode: "flat", attribute: "intelligence", valuePerUnit: 1.65, source: "attribute:intelligence:max-focus", label: "+1.65 Focus per Intelligence" },

  { kind: "constant", stat: "moveSpeed", mode: "flat", value: 250, source: "character:base-move-speed", label: "Base movement speed" },
  { kind: "perAttribute", stat: "moveSpeed", mode: "flat", attribute: "dexterity", valuePerUnit: 0.22, source: "attribute:dexterity:move-speed", label: "+0.22 movement speed per Dexterity" },

  { kind: "constant", stat: "attackDamage", mode: "flat", value: 10.15, source: "character:base-attack-damage", label: "Base attack damage" },
  { kind: "perLevel", stat: "attackDamage", mode: "flat", valuePerUnit: 1.15, source: "level:attack-damage", label: "+1.15 attack damage per level" },
  { kind: "perAttribute", stat: "attackDamage", mode: "flat", attribute: "strength", valuePerUnit: 0.12, source: "attribute:strength:attack-damage", label: "+0.12 attack damage per Strength" },
  { kind: "perAttribute", stat: "attackDamage", mode: "flat", attribute: "dexterity", valuePerUnit: 0.1, source: "attribute:dexterity:attack-damage", label: "+0.1 attack damage per Dexterity" },
  { kind: "perAttribute", stat: "attackDamage", mode: "flat", attribute: "intelligence", valuePerUnit: 0.08, source: "attribute:intelligence:attack-damage", label: "+0.08 attack damage per Intelligence" },

  { kind: "perAttribute", stat: "attackSpeed", mode: "increased", attribute: "dexterity", valuePerUnit: 0.25, source: "attribute:dexterity:attack-speed", label: "0.25% increased attack speed per Dexterity" },

  { kind: "constant", stat: "focusRegen", mode: "flat", value: 8, source: "character:base-focus-regen", label: "Base Focus recovery rate" },

  { kind: "constant", stat: "skillCooldown", mode: "flat", value: 1, source: "character:base-skill-cooldown", label: "Base skill cooldown duration" },

  { kind: "constant", stat: "armor", mode: "flat", value: 7.25, source: "character:base-armor", label: "Base armor" },
  { kind: "perLevel", stat: "armor", mode: "flat", valuePerUnit: 1.25, source: "level:armor", label: "+1.25 armor per level" },
  { kind: "perAttribute", stat: "armor", mode: "flat", attribute: "strength", valuePerUnit: 0.52, source: "attribute:strength:armor", label: "+0.52 armor per Strength" },

  { kind: "constant", stat: "evadeChance", mode: "flat", value: 2.1, source: "character:base-evade", label: "Base evade chance" },
  { kind: "perLevel", stat: "evadeChance", mode: "flat", valuePerUnit: 0.1, source: "level:evade", label: "+0.1% evade chance per level" },
  { kind: "perAttribute", stat: "evadeChance", mode: "flat", attribute: "dexterity", valuePerUnit: 0.16, source: "attribute:dexterity:evade", label: "+0.16% evade chance per Dexterity" },
] as const satisfies readonly StatContributionRule[];
