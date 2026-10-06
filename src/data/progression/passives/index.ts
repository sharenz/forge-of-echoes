// The Orrery (docs/power-rework/passive-tree.md): the 252 nodes built from the table in nodes.ts with the coordinates of layout.ts,
// the point sources, prices, caps and the ledger. Pure data; the rules live in src/game/progression/passives.ts.
import type { ModifierMode, StatId } from '../../../contracts/items';
import { MAP_BASE_IDS } from '../../../contracts/content';
import { THEME_ROSTER } from '../../../contracts/bestiary';
import type { PassiveKind, PassiveNodeId, PassiveRegion, PassiveSector } from '../../../contracts/passives';
import { MASTERY_CHOICES, PASSIVE_SECTORS } from '../../../contracts/passives';
import { BRIDGES, BRIDGE_ROW, CROSS_HUB, FAMILIES, HUB_KEYSTONES, NAMED, SECTORS, type NamedDef } from './nodes';
import { SPARK_POS, bridgePos, cellPos, crossPos, gatePos, hubKeystonePathPos, ringSmallPos } from './layout';
import type { PassiveMod, PassiveNode, PassiveRuleId, PassiveRuleInfo } from './types';

export * from './types';
export { ORRERY_SIZE, ORRERY_CENTER } from './layout';

// ---------------------------------------------------------------------------------------------
// Points (4), prices (1 and 5), caps (1.3)
// ---------------------------------------------------------------------------------------------

/** Passive point sources (passive-tree.md 4): one per level 2 to 50, one per even level 52 to 80, one per Boss Mark. */
export const PASSIVE_POINTS = {
  /** Every level from 2 up to this one gives a point. */
  everyLevelTo: 50,
  /** Then every second level from here up to `lastLevel`. */
  everySecondFrom: 52,
  lastLevel: 80,
  /** The six final bosses' first kill by this character. */
  bossMarks: 6,
  /** Levels 2 to 50 (49) + 52 to 80 (15) + 6 Boss Marks. */
  total: 70,
} as const;

/** Points a character has earned: a pure function of its level and Boss Marks. */
export function passivePointsEarned(level: number, bossMarks: number): number {
  const l = Math.max(1, Math.floor(Number.isFinite(level) ? level : 1));
  const early = Math.max(0, Math.min(l, PASSIVE_POINTS.everyLevelTo) - 1);
  const late = l >= PASSIVE_POINTS.everySecondFrom
    ? Math.floor((Math.min(l, PASSIVE_POINTS.lastLevel) - PASSIVE_POINTS.everySecondFrom) / 2) + 1
    : 0;
  const marks = Math.max(0, Math.min(PASSIVE_POINTS.bossMarks, Math.floor(Number.isFinite(bossMarks) ? bossMarks : 0)));
  return early + late + marks;
}

/** The next level that grants a point (null at the level cap). */
export function nextPassivePointLevel(level: number): number | null {
  const l = Math.max(1, Math.floor(level));
  if (l < PASSIVE_POINTS.everyLevelTo) return l + 1;
  if (l < PASSIVE_POINTS.everySecondFrom) return PASSIVE_POINTS.everySecondFrom;
  if (l >= PASSIVE_POINTS.lastLevel) return null;
  return l + (l % 2 === 0 ? 2 : 1);
}

/** The six final bosses (monster kinds) whose first kill by a character is one Boss Mark. */
export const BOSS_MARK_KINDS: readonly string[] = [...new Set(MAP_BASE_IDS.map((b) => THEME_ROSTER[b].boss))];

/** Refund prices in Forge Scrap (passive-tree.md 5); the first `freeRefunds` refunds or mastery changes of a character are free. */
export const PASSIVE_RESPEC = {
  small: 5,
  notable: 15,
  mastery: 10,
  keystone: 40,
  /** Changing a mastery's chosen rider. */
  masteryChange: 10,
  freeRefunds: 10,
  /** At most this much Scrap per respec session (reset when a map is opened). */
  sessionCap: 250,
} as const;

/** Scrap a refund of this node kind costs before the free refunds and the session cap. */
export function passiveRefundBase(kind: PassiveKind): number {
  if (kind === 'small') return PASSIVE_RESPEC.small;
  if (kind === 'mastery') return PASSIVE_RESPEC.mastery;
  if (kind === 'keystone') return PASSIVE_RESPEC.keystone;
  return PASSIVE_RESPEC.notable;
}

/** Hard caps of what the tree alone can give (passive-tree.md 1.3), enforced by resolvePassives. */
export const ORRERY_CAPS = {
  /** Σ increased damage of every damage stat (spell, the five types, elemental, projectile, area, over time). */
  increasedDamage: 220,
  /** Product of the tree's `more` damage. */
  moreDamage: 2.0,
  castSpeed: 30,
  /** Perfect Tempo's own cast speed comes on top of `castSpeed`. */
  castSpeedPerfectTempo: 35,
  critChance: 180,
  critMultiplier: 80,
  /** Per damage type. */
  penetration: 20,
  area: 40,
  extraProjectiles: 1,
  moveSpeed: 25,
  maxLife: 80,
  armor: 100,
  evasion: 100,
  /** Per element, all-resistance included. */
  resistance: 25,
  maxResistance: 11,
  maxFocus: 120,
  focusRegen: 60,
  flaskEffect: 50,
  /** The tree's `damageTaken` product never goes below this. */
  damageTakenFloor: 0.75,
  augmentSlots: 1,
} as const;

/** The damage stats whose `increased` and `more` count against the damage caps. */
export const ORRERY_DAMAGE_STATS: readonly StatId[] = [
  'spellDamage', 'fireDamage', 'coldDamage', 'lightningDamage', 'voidDamage', 'physicalDamage', 'elementalDamage',
  'projectileDamage', 'areaDamage', 'damageOverTime',
];

// ---------------------------------------------------------------------------------------------
// Ledger (1.1): units per point of a stat at the reference build
// ---------------------------------------------------------------------------------------------

const typed = 1 / 4;
/** Units of one point of a stat line (1u = +1% damage-equivalent or +1% effective health at the reference build). */
export const LEDGER_RATES: Partial<Record<StatId, Partial<Record<ModifierMode, number>>>> = {
  fireDamage: { increased: typed, more: 1 }, coldDamage: { increased: typed, more: 1 }, lightningDamage: { increased: typed, more: 1 },
  voidDamage: { increased: typed, more: 1 }, physicalDamage: { increased: typed, more: 1 }, elementalDamage: { increased: typed, more: 1 },
  spellDamage: { increased: 1 / 3, more: 1 },
  projectileDamage: { increased: 1 / 12, more: 1 }, areaDamage: { increased: 1 / 12, more: 1 }, damageOverTime: { increased: 1 / 12, more: 1 },
  // "+1% cast speed is about 0.8u (the Focus tax is built in)": the reading the table's own notables use (Quickened Pulse 8% = 6u).
  castSpeed: { increased: 0.8 },
  critChance: { increased: 1 / 6 }, critMultiplier: { flat: 1 / 4 },
  firePen: { flat: 1 / 2.2 }, coldPen: { flat: 1 / 2.2 }, lightningPen: { flat: 1 / 2.2 }, voidPen: { flat: 1 / 2.2 }, physicalPen: { flat: 1 / 2.2 },
  area: { increased: 1 / 7, more: 1 / 7 },
  // Life counts half (+2% maximum life = 1u), `more` and `less` life too: Glass Orrery's 40% less life is its 20u price.
  maxLife: { increased: 1 / 2, flat: 1 / 25, more: 1 / 2 },
  // Armour and evasion are halves of one avoidance layer: losing one entirely (100% less) is about 12u, the keystones' price.
  armor: { increased: 1 / 4, more: 1 / 8 }, evasion: { increased: 1 / 4, more: 1 / 8 },
  fireRes: { flat: 1 / 2.5 }, coldRes: { flat: 1 / 2.5 }, lightningRes: { flat: 1 / 2.5 }, voidRes: { flat: 1 / 2.5 }, allRes: { flat: 1 / 1.5 },
  maxResistance: { flat: 1 },
  flaskEffect: { increased: 1 / 6 },
  maxFocus: { flat: 1 / 10 }, focusRegen: { increased: 1 / 8, more: 1 / 8 },
  damageTaken: { more: -1 },
  moveSpeed: { increased: 1 / 2 }, pickupRadius: { increased: 1 / 16 },
  str: { flat: 1 / 5 }, dex: { flat: 1 / 5 }, int: { flat: 1 / 5 },
  igniteChance: { flat: 1 / 10 }, chillChance: { flat: 1 / 10 }, shockChance: { flat: 1 / 10 },
  lifeRegen: { flat: 1 }, lifeOnKill: { flat: 1 / 2 }, focusOnKill: { flat: 1 },
  cooldownRecovery: { increased: 1 / 2, more: 1 / 2 }, projectileSpeed: { increased: 1 / 15 },
  extraProjectiles: { flat: 4 }, pierce: { flat: 2 }, extraChains: { flat: 5 },
};

/** Gross ledger units of a list of stat lines (absolute values: a price counts as value too). Null when a stat has no rate. */
export function ledgerUnits(mods: readonly PassiveMod[]): number | null {
  let u = 0;
  for (const m of mods) {
    const rate = LEDGER_RATES[m.stat]?.[m.mode];
    if (rate === undefined) return null;
    u += Math.abs(m.value * rate);
  }
  return u;
}

// ---------------------------------------------------------------------------------------------
// Rules: which structural rules the game reads yet
// ---------------------------------------------------------------------------------------------

const off = (penalty = false): PassiveRuleInfo => ({ live: true, side: 'offence', ...(penalty ? { penalty: true as const } : {}) });
const def = (penalty = false): PassiveRuleInfo => ({ live: true, side: 'defence', ...(penalty ? { penalty: true as const } : {}) });
const util = (penalty = false): PassiveRuleInfo => ({ live: true, side: 'utility', ...(penalty ? { penalty: true as const } : {}) });

/**
 * Every rule id. PT0 stored, showed and audited them; PT4 made them live: the rules resolve them into PlayerCombatStats.passives
 * and the skill numbers (src/game/progression/passive-rules.ts, passive-runtime.ts) and the sim applies them (src/sim/passives.ts).
 */
export const PASSIVE_RULES: Record<PassiveRuleId, PassiveRuleInfo> = {
  igniteDuration: off(), igniteEffect: off(), shockEffect: off(), shockEffectPct: off(), shockDuration: off(), chillEffect: def(),
  chillEffectSet: def(), exposureEffect: off(), exposureDuration: off(), decayDuration: off(), decayEffect: off(), decayStacks: off(),
  witherStacks: off(), moreNearBurning: off(), damageVsBurning: off(), damageVsChilled: off(), moreVsChilled: off(), lessVsUnchilled: off(true),
  nonCritLess: off(true), otherSkillsLess: off(true), critMultiplierTyped: off(), areaTyped: off(), igniteSpreadOnDeath: off(), fireKillBurst: off(),
  shatterNova: off(), decayedExplode: off(), lowLifeWard: def(), pulseEveryKills: def(), focusOnKillTyped: util(), focusOnKillShocked: util(),
  focusLeech: util(), lifeOnKillMore: def(), convert: off(), convertAll: off(true), echoAll: off(), echoDamage: off(), augmentSlot: off(),
  focusCost: util(true), zoneDuration: off(), pullEffect: off(), knockback: def(), blinkRecovery: util(), rangeLess: off(true), penCap: off(),
  damageTakenTyped: def(), burnOnYouDuration: def(), chilledDealLess: def(), regenPercent: def(), lifePerStr: def(),
  flaskChargePerKills: def(), flaskGuard: def(), focusFlaskLife: def(), flaskDuration: def(), noLifeFlasks: def(true), armourBigHits: def(),
  armourFormula: def(), armourVsElements: def(), evadeChance: def(), evadeCap: def(), wardEffect: def(), damageFromFocus: def(),
  damageTakenHits: def(), regenLowLife: def(),
};

/** Whether the game applies a passive rule (the Orrery stops showing "Not active yet" for it). */
export function isPassiveRuleLive(id: string): boolean {
  return (PASSIVE_RULES as Record<string, PassiveRuleInfo | undefined>)[id]?.live === true;
}

/** Whether every structural rule of a node (and of its mastery riders) is live. */
export function isPassiveNodeLive(node: Pick<PassiveNode, 'rules' | 'choices'>): boolean {
  return node.rules.every((r) => isPassiveRuleLive(r.id)) && (node.choices ?? []).every((c) => c.rules.every((r) => isPassiveRuleLive(r.id)));
}

// ---------------------------------------------------------------------------------------------
// The build: table → nodes
// ---------------------------------------------------------------------------------------------

/** Display names of the regions (small nodes carry their region's name). */
export const REGION_NAMES: Record<PassiveRegion, string> = {
  hub: 'Hub', fire: 'Cinder Arc', lightning: 'Storm Arc', cold: 'Rime Arc', void: 'Hollow Arc', arcana: 'Spellwork', vitality: 'Heartwood',
  bulwark: 'Plate and Veil',
};

function buildTree(): PassiveNode[] {
  const nodes: PassiveNode[] = [];
  const byId = new Map<string, PassiveNode>();
  const keyIds = new Map<string, PassiveNodeId>();
  const smallCount = new Map<PassiveRegion, number>();
  const familyStep = new Map<PassiveRegion, number>();

  const add = (n: Omit<PassiveNode, 'links' | 'excludes'>): PassiveNode => {
    if (byId.has(n.id)) throw new Error(`passive id ${n.id} twice`);
    const node: PassiveNode = { ...n, links: [], excludes: [] };
    nodes.push(node);
    byId.set(node.id, node);
    return node;
  };
  const link = (a: PassiveNode, b: PassiveNode) => {
    if (!a.links.includes(b.id)) a.links.push(b.id);
    if (!b.links.includes(a.id)) b.links.push(a.id);
  };
  const costOf = (kind: PassiveKind): 0 | 1 | 2 => (kind === 'start' ? 0 : kind === 'keystone' ? 2 : 1);
  const named = (region: 'hub' | 'bridge' | PassiveSector, key: string, pos: { x: number; y: number }, nodeRegion: PassiveRegion, sectors?: readonly [PassiveSector, PassiveSector]): PassiveNode => {
    const d: NamedDef | undefined = NAMED[region].find((n) => n.key === key);
    if (!d) throw new Error(`no named passive ${region}.${key}`);
    if (d.choices && d.choices.length !== MASTERY_CHOICES) throw new Error(`${d.name}: ${MASTERY_CHOICES} choices`);
    const node = add({
      id: `pas.${region}.${key}`, name: d.name, text: d.text, kind: d.kind, region: nodeRegion, ...(sectors ? { sectors } : {}), pos,
      cost: costOf(d.kind), mods: d.mods, rules: d.rules ?? [], ...(d.choices ? { choices: d.choices } : {}),
      audit: { gross: d.gross, price: d.price ?? 0 }, engine: d.engine,
    });
    if (key !== 'gate' && key !== 'mastery') {
      if (keyIds.has(key)) throw new Error(`passive key ${key} is not unique`);
      keyIds.set(key, node.id);
    }
    return node;
  };
  const small = (region: PassiveRegion, pos: { x: number; y: number }, rhythm: boolean): PassiveNode => {
    const families = FAMILIES[region];
    const n = (smallCount.get(region) ?? 0) + 1;
    smallCount.set(region, n);
    let family = families[0];
    if (!rhythm) {
      const j = familyStep.get(region) ?? 0;
      familyStep.set(region, j + 1);
      family = families[(1 + j) % families.length];
    }
    return add({
      id: `pas.${region}.s${n}`, name: REGION_NAMES[region], text: [family.text], kind: 'small', region, pos, cost: 1, mods: family.mods, rules: [],
      audit: { gross: Math.round((ledgerUnits(family.mods) ?? 1) * 100) / 100, price: 0 }, engine: 'E0',
    });
  };

  // The hub: Spark, the seven gates, the ring, the cross-hub notables and the two hub keystones.
  const spark = named('hub', 'spark', { ...SPARK_POS }, 'hub');
  const gates = PASSIVE_SECTORS.map((s) => {
    const gate = named(s, 'gate', gatePos(s), s);
    link(spark, gate);
    return gate;
  });
  const ring = PASSIVE_SECTORS.map((_, k) => {
    const node = small('hub', ringSmallPos(k), false);
    link(gates[k], node);
    link(node, gates[(k + 1) % gates.length]);
    return node;
  });
  for (const c of CROSS_HUB) {
    const node = named('hub', c.key, crossPos(c.at), 'hub', c.between);
    link(node, ring[c.ring[0]]);
    link(node, ring[c.ring[1]]);
  }
  for (const k of HUB_KEYSTONES) {
    const a = small('hub', hubKeystonePathPos(k.at, 0), false);
    const b = small('hub', hubKeystonePathPos(k.at, 1), false);
    const key = named('hub', k.key, hubKeystonePathPos(k.at, 2), 'hub');
    link(spark, a); link(a, b); link(b, key);
  }

  // The sectors: spine from the gate to the rim, then the spurs beside it.
  const cells = new Map<string, PassiveNode>();
  const cellKey = (s: PassiveSector, row: number, col: number) => `${s}:${row}:${col}`;
  const place = (s: PassiveSector, row: number, col: number, item: string): PassiveNode => {
    const pos = cellPos(s, row, col);
    const node = item === 's' ? small(s, pos, col === 0 && row < 3) : named(s, item, pos, s);
    if (cells.has(cellKey(s, row, col))) throw new Error(`passive cell ${s} ${row},${col} twice`);
    cells.set(cellKey(s, row, col), node);
    return node;
  };
  PASSIVE_SECTORS.forEach((s, k) => {
    const spec = SECTORS[s];
    let prev = gates[k];
    spec.spine.forEach((item, row) => {
      const node = place(s, row, 0, item);
      link(prev, node);
      prev = node;
    });
    for (const spur of spec.spurs) {
      const inner = spur.col - Math.sign(spur.col);
      let prevSpur = cells.get(cellKey(s, spur.from, inner));
      if (!prevSpur) throw new Error(`passive spur ${s} ${spur.from},${spur.col} has nothing to attach to`);
      spur.items.forEach((item, i) => {
        const node = place(s, spur.from + i, spur.col, item);
        link(prevSpur!, node);
        prevSpur = node;
      });
    }
  });

  // Bridges between adjacent sectors.
  for (const b of BRIDGES) {
    const [first, second] = b.between;
    const node = named('bridge', b.key, bridgePos(first, BRIDGE_ROW), first, b.between);
    const a = cells.get(cellKey(first, BRIDGE_ROW, 2));
    const c = cells.get(cellKey(second, BRIDGE_ROW, -2));
    if (!a || !c) throw new Error(`bridge ${b.key} has nothing to attach to`);
    link(a, node);
    link(node, c);
  }

  // Exclusions, made symmetric.
  for (const region of Object.keys(NAMED) as (keyof typeof NAMED)[]) {
    for (const d of NAMED[region]) {
      for (const other of d.excludes ?? []) {
        const a = byId.get(keyIds.get(d.key) ?? '');
        const b = byId.get(keyIds.get(other) ?? '');
        if (!a || !b) throw new Error(`passive exclusion ${d.key} / ${other}`);
        if (!a.excludes.includes(b.id)) a.excludes.push(b.id);
        if (!b.excludes.includes(a.id)) b.excludes.push(a.id);
      }
    }
  }
  return nodes;
}

/** Every passive node, Spark first (stable canonical order: allocations are stored in this order). */
export const PASSIVE_NODES: readonly PassiveNode[] = buildTree();
export const PASSIVE_NODE_IDS: readonly PassiveNodeId[] = PASSIVE_NODES.map((n) => n.id);
/** The start node: always lit once anything is allocated, never bought or refunded. */
export const PASSIVE_START_ID: PassiveNodeId = 'pas.hub.spark';

const NODE_MAP = new Map<string, PassiveNode>(PASSIVE_NODES.map((n) => [n.id, n]));
const NODE_ORDER = new Map<string, number>(PASSIVE_NODES.map((n, i) => [n.id, i]));

export function findPassiveNode(id: unknown): PassiveNode | undefined {
  return typeof id === 'string' ? NODE_MAP.get(id) : undefined;
}

export function isPassiveNodeId(id: unknown): id is PassiveNodeId {
  return typeof id === 'string' && NODE_MAP.has(id);
}

/** Position of a node in the canonical order (unknown ids last). */
export function passiveNodeOrder(id: string): number {
  return NODE_ORDER.get(id) ?? Number.MAX_SAFE_INTEGER;
}
