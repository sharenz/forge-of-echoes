// Atlas tree ("the Codex") data model. Nodes never touch character stats: every effect is a map stat
// (resolved by the shared map modifier resolver) or a typed run rule.
import type { CurrencyId, MapBaseId } from '../../../contracts/content';
import type { ModifierMode } from '../../../contracts/items';
import type { MapEffectDef } from '../types';

export const ATLAS_BRANCHES = ['cartography', 'foundry', 'bounty', 'fortune', 'echoes', 'peril'] as const;
export type AtlasBranch = (typeof ATLAS_BRANCHES)[number];
export type AtlasNodeGroup = AtlasBranch | 'hub' | 'belt' | 'bridge' | 'origin';
export type AtlasNodeKind = 'origin' | 'small' | 'notable' | 'keystone' | 'tier' | 'theme' | 'event';

/**
 * Which part of the engine makes a node work. Only 'live' nodes can be allocated; the others are fully
 * specified data waiting for their engine (see docs/atlas-rework/tree-events-interface.md).
 */
export type AtlasEngine = 'live' | 'events' | 'sim' | 'device' | 'items';

/** Extra applicability of one effect. */
export interface AtlasCondition {
  /** Only on maps of this base (theme seals). */
  base?: MapBaseId;
  /** Atlas area shape: dead ends and sealed sites, or through-route areas. */
  area?: 'deadEnd' | 'throughRoute';
  /** The opened map is corrupted / not corrupted. */
  corrupted?: boolean;
  /** The expedition rolled at least one encounter. */
  event?: boolean;
  /** Only from this map tier (inclusive). */
  minTier?: number;
}

/** A map effect (shared resolver shape) with optional per-tier scaling and condition. */
export interface AtlasEffect extends MapEffectDef {
  /** value is per map tier: the resolved value is value x tier. */
  perTier?: boolean;
  when?: AtlasCondition;
  /** Effect belongs to the wave-4-to-6 or other window in text only; the value already accounts for it. */
  note?: string;
}

/** Structural rules that are not a single stat. */
export type AtlasRule =
  | { id: 'bossWave'; wave: number }
  | { id: 'equipmentNormalOnly' }
  | { id: 'currencyWeight'; currencies: readonly CurrencyId[]; mode: Exclude<ModifierMode, 'flat'>; value: number; when?: AtlasCondition }
  // Rules below need another engine part (node.engine says which): typed here, resolved to data only.
  | { id: 'scarabSockets'; extra: number }
  | { id: 'scarabSameFamily'; secondStrength: number; lifePerScarab: number }
  | { id: 'scarabKeepChance'; chance: number }
  | { id: 'essenceAttunement'; more: number; othersMore: number; scrapMore: number }
  | { id: 'chestMapWager'; danger: number; quality: number; bound: boolean; minTier: number }
  | { id: 'wardedRares'; proofMultiplier: number; extraEquipmentRoll: number }
  | { id: 'stragglerBounty'; quantityMore: number }
  | { id: 'eventLens'; event: string; effect: string; danger: string }
  | { id: 'eventSlots'; extra: number; rewardMore: number; backlash: boolean }
  | { id: 'eventsAlways'; rewardMore: number; mandatory: boolean; timeoutSeconds: number }
  | { id: 'voidBreach'; strength: number; uncorruptedQuantity: number }
  | { id: 'eventSmall'; effect: 'ingredientChance' | 'timers' | 'gradeEase'; value: number };

export interface AtlasUnits { reward: number; danger: number }
/** manual: the units replace the effect-derived ones (structural keystones whose stats are offsets of each other). */
export interface AtlasNodeUnits extends AtlasUnits { manual?: boolean }

/** Authoring shape: compact, laid out by ring/lane and linked by `from`. */
export interface AtlasNodeSpec {
  id: string;
  name: string;
  kind: Exclude<AtlasNodeKind, 'origin'>;
  ring: number;
  lane: number;
  from: string | readonly string[];
  effects?: readonly AtlasEffect[];
  rules?: readonly AtlasRule[];
  /** Ledger units for what effects cannot express (rules, restrictions). */
  units?: AtlasNodeUnits;
  /** Extra player-facing sentences (downsides that are not stats). */
  notes?: readonly string[];
  engine?: AtlasEngine;
  excludes?: readonly string[];
  base?: MapBaseId;
  flavor?: string;
}

export interface AtlasNode {
  id: string;
  name: string;
  kind: AtlasNodeKind;
  group: AtlasNodeGroup;
  /** Codex world-art coordinates (512 x 512). */
  pos: { x: number; y: number };
  /** Undirected graph edges (reciprocal). */
  links: readonly string[];
  cost: 1 | 2;
  effects: readonly AtlasEffect[];
  rules: readonly AtlasRule[];
  units?: AtlasNodeUnits;
  notes: readonly string[];
  /** Player-facing lines: one per effect / rule, then notes. */
  lines: readonly string[];
  /** All lines joined. */
  text: string;
  engine: AtlasEngine;
  excludes: readonly string[];
  base?: MapBaseId;
  flavor?: string;
}
