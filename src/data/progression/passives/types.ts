// Data types of the Orrery (docs/power-rework/passive-tree.md 8).
import type { DamageType } from '../../../contracts/content';
import type { ModifierMode, StatId } from '../../../contracts/items';
import type { PassiveKind, PassiveNodeId, PassiveRegion, PassiveSector } from '../../../contracts/passives';

/** One ordinary stat line of a node: it joins the player model as a labelled StatModifier ("Orrery: <name>"). */
export interface PassiveMod {
  stat: StatId;
  mode: ModifierMode;
  value: number;
}

/**
 * A structural rule (passive-tree.md 8 `rules`): behaviour the stat model cannot express (an ailment's strength, a conversion, a
 * conditional `more`, a cap change). Rules are data first: `PASSIVE_RULES[id].live` says whether the game reads one yet.
 */
export type PassiveRuleId =
  // ailments and exposure
  | 'igniteDuration' | 'igniteEffect' | 'shockEffect' | 'shockEffectPct' | 'shockDuration' | 'chillEffect' | 'chillEffectSet'
  | 'exposureEffect' | 'exposureDuration' | 'decayDuration' | 'decayEffect' | 'decayStacks' | 'witherStacks'
  // conditional damage
  | 'moreNearBurning' | 'damageVsBurning' | 'damageVsChilled' | 'moreVsChilled' | 'lessVsUnchilled' | 'nonCritLess' | 'otherSkillsLess'
  | 'critMultiplierTyped' | 'areaTyped'
  // triggers
  | 'igniteSpreadOnDeath' | 'fireKillBurst' | 'shatterNova' | 'decayedExplode' | 'lowLifeWard' | 'pulseEveryKills'
  | 'focusOnKillTyped' | 'focusOnKillShocked' | 'focusLeech' | 'lifeOnKillMore'
  // skills and augments
  | 'convert' | 'convertAll' | 'echoAll' | 'echoDamage' | 'augmentSlot' | 'focusCost' | 'zoneDuration' | 'pullEffect' | 'knockback'
  | 'blinkRecovery' | 'rangeLess' | 'penCap'
  // defence and recovery
  | 'damageTakenTyped' | 'burnOnYouDuration' | 'chilledDealLess' | 'regenPercent' | 'lifePerStr' | 'flaskChargePerKills' | 'flaskGuard'
  | 'focusFlaskLife' | 'flaskDuration' | 'noLifeFlasks' | 'armourBigHits' | 'armourFormula' | 'armourVsElements' | 'evadeChance'
  | 'evadeCap' | 'wardEffect' | 'damageFromFocus'
  // PT4 (appended): Grounding Rod's "from hits" and Unending Vigil's doubled regeneration below half life, split out of
  // damageTakenTyped / regenPercent so the sim can tell them apart.
  | 'damageTakenHits' | 'regenLowLife';

export interface PassiveRule {
  id: PassiveRuleId;
  value: number;
  /** The damage type the rule is about (typed rules, `convert` from). */
  type?: DamageType;
  /** `convert` / `convertAll` target. */
  to?: DamageType;
}

export interface PassiveRuleInfo {
  /** Whether the game reads this rule (PT4: every rule is live; false would mean shown and stored, not applied). */
  live: boolean;
  /** Which side of the ledger its value counts on (harness: the unmodelled share of a node). */
  side: 'offence' | 'defence' | 'utility';
  /** The rule is the price of its node (a keystone's "sentence that gets worse"), not its value. */
  penalty?: true;
}

/** Ledger audit in units (passive-tree.md 1.1): gross value of the node's text at the reference build, and the price it carries. */
export interface PassiveAudit {
  gross: number;
  price: number;
}

/** Engine needs (passive-tree.md 3): E0 existing stat, E1 new stat, E2 new rule or primitive. */
export type PassiveEngine = 'E0' | 'E1' | 'E2';

/** One rider of a mastery. */
export interface PassiveChoice {
  text: string;
  mods: PassiveMod[];
  rules: PassiveRule[];
  audit: PassiveAudit;
}

export interface PassiveNode {
  id: PassiveNodeId;
  name: string;
  /** Player-facing effect lines. */
  text: string[];
  kind: PassiveKind;
  region: PassiveRegion;
  /** Bridges and cross-hub notables: the two sectors they join. */
  sectors?: readonly [PassiveSector, PassiveSector];
  /** Orrery world px (ORRERY_SIZE x ORRERY_SIZE, Spark in the centre). */
  pos: { x: number; y: number };
  /** Undirected and reciprocal. */
  links: PassiveNodeId[];
  /** Passive points it costs (Spark: 0, it is never bought). */
  cost: 0 | 1 | 2;
  mods: PassiveMod[];
  rules: PassiveRule[];
  /** Masteries only: MASTERY_CHOICES riders. */
  choices?: PassiveChoice[];
  /** Hard exclusions (symmetric). */
  excludes: PassiveNodeId[];
  audit: PassiveAudit;
  engine: PassiveEngine;
}
