// The analytic band model of docs/power-rework/power-curve.md section 5 as code: the SPECIFICATION the real rules
// (character-harness.ts -> rules.playerRuntime) and the sim (tests/sim/character-bands.test.ts) are compared against.
//
//   build(ml, band)          the sheet of one band at a monster level (power-curve 5.2): damage budget, life, defences
//   killTimes(ml, band)      trash / pack of six / rare / boss time to kill (7.1, 6.3)
//   incoming(ml, band)       post-mitigation hit sizes versus life (7.2)
//   clearSeconds(ml, band)   the clear-time model of 9.3 (walk + kills + tells + boss + loot)
//   killRate(ml, band)       what the Atlas harness takes as `speed` (9.2: speed is character power)
//
// Two kinds of numbers live here:
//   - BUDGET: the gear / tree / more budget of each band per monster level, pinned from the tables of 5.2 (they are
//     the design; the harness measures the real rules against them) and interpolated log-linearly between the eight
//     monster levels of the tables;
//   - everything derived (spell power, effectiveness, cast time, monster life and damage, level gap, wave growth)
//     is read from the data modules, so the model follows P0/P1 without edits.
import { SORCERESS, SKILLS, LEVEL_CAP, monsterDamageScale, monsterLifeScale } from '../../src/data/progression';
import { spellPowerAt } from '../../src/game/progression/model';
import { WAVE_LIFE_GROWTH } from '../../src/sim/constants';

export type Band = 'fair' | 'good' | 'endgame';
export const BANDS: readonly Band[] = ['fair', 'good', 'endgame'];
/** The eight monster levels of the tables of power-curve 5.2. */
export const BAND_MLS = [4, 10, 16, 22, 28, 40, 60, 88] as const;
export type BandMl = (typeof BAND_MLS)[number];

/** The level the tables use: `clamp(ML - 2, 3, 80)`. 80 is the design cap of the rework, whatever LEVEL_CAP is today. */
export const BAND_LEVEL_CAP = 80;
export const levelFor = (ml: number): number => Math.max(3, Math.min(BAND_LEVEL_CAP, Math.round(ml) - 2));

// ---------------------------------------------------------------------------------------------
// Band definitions (5.2 "Three bands")
// ---------------------------------------------------------------------------------------------

export interface BandParams {
  /** Tier of the gear: the expected value of a random roll, the best available tier minus one, the best available tier. */
  gearTier: 'expected' | 'best-1' | 'best';
  /** Passive allocation efficiency (the tree's offence share is credited at this rate). */
  efficiency: number;
  /** The `more` pool (tree + augments + uniques); the cap is x3.5. */
  more: number;
  /** Targets hit per cast (area, projectiles, chain). */
  targets: number;
  /** Boss uptime (kiting, dodging). */
  uptime: number;
  /** Move speed bonus (fraction). */
  moveSpeed: number;
  /** Damage-taken multiplier from the tree and ward uptime. */
  damageTaken: number;
  /** Affix counts of the damage budget. */
  damageAffixes: { added: number; spell: number; element: number; prismatic: number; cast: number; crit: number; mult: number };
  /** Affix counts of the life and defence budget. */
  defenceAffixes: { life: number; res: number; flat: number; pct: number };
}

export const BAND_PARAMS: Record<Band, BandParams> = {
  fair: {
    gearTier: 'expected', efficiency: 0.6, more: 1.0, targets: 1.5, uptime: 0.3, moveSpeed: 0.1, damageTaken: 1.0,
    damageAffixes: { added: 2, spell: 1, element: 1, prismatic: 0, cast: 1, crit: 1, mult: 0 },
    defenceAffixes: { life: 3, res: 2, flat: 1, pct: 0 },
  },
  good: {
    gearTier: 'best-1', efficiency: 0.9, more: 1.5, targets: 4, uptime: 0.5, moveSpeed: 0.25, damageTaken: 0.82,
    damageAffixes: { added: 4, spell: 2, element: 3, prismatic: 0, cast: 2, crit: 2, mult: 1 },
    defenceAffixes: { life: 6, res: 5, flat: 3, pct: 2 },
  },
  endgame: {
    gearTier: 'best', efficiency: 1.0, more: 2.4, targets: 8, uptime: 0.65, moveSpeed: 0.4, damageTaken: 0.65,
    damageAffixes: { added: 5, spell: 3, element: 4, prismatic: 1, cast: 3, crit: 3, mult: 2 },
    defenceAffixes: { life: 8, res: 7, flat: 4, pct: 4 },
  },
};

/** The main skill's rank as a fraction of its rank range: 2 / 5 / 8 / 10 of 10 by monster level 4 / 10 / 16 / 22+. */
const RANK_FRACTION: Record<number, number> = { 4: 1 / 9, 10: 4 / 9, 16: 7 / 9, 22: 1 };
export function rankFractionFor(ml: number): number {
  const knots = Object.keys(RANK_FRACTION).map(Number).sort((a, b) => a - b);
  if (ml <= knots[0]) return RANK_FRACTION[knots[0]];
  if (ml >= knots[knots.length - 1]) return 1;
  for (let i = 1; i < knots.length; i++) {
    if (ml <= knots[i]) {
      const t = (ml - knots[i - 1]) / (knots[i] - knots[i - 1]);
      return RANK_FRACTION[knots[i - 1]] + (RANK_FRACTION[knots[i]] - RANK_FRACTION[knots[i - 1]]) * t;
    }
  }
  return 1;
}

// ---------------------------------------------------------------------------------------------
// The budget tables (5.2): per band and ML [added, increased %, cast x, crit x, life, armour, evade %, effective resist %]
// ---------------------------------------------------------------------------------------------

type Budget = readonly [added: number, inc: number, cast: number, crit: number, life: number, armour: number, evade: number, res: number];

const BUDGET: Record<Band, Record<BandMl, Budget>> = {
  fair: {
    4: [4.2, 29, 1.04, 1.03, 144, 153, 56, 12],
    10: [6.0, 40, 1.05, 1.03, 201, 172, 38, 13],
    16: [7.3, 52, 1.06, 1.04, 272, 191, 31, 11],
    22: [8.7, 63, 1.06, 1.04, 344, 211, 27, 8],
    28: [10.0, 75, 1.07, 1.04, 420, 231, 25, 6],
    40: [11.7, 98, 1.07, 1.04, 578, 271, 23, 0],
    60: [14.2, 129, 1.08, 1.04, 859, 337, 21, -9],
    88: [16.2, 151, 1.09, 1.04, 1175, 417, 19, -23],
  },
  good: {
    4: [13.6, 78, 1.08, 1.12, 182, 216, 64, 26],
    10: [13.6, 88, 1.09, 1.12, 240, 236, 45, 26],
    16: [19.6, 119, 1.13, 1.13, 342, 306, 41, 28],
    22: [23.6, 147, 1.14, 1.14, 449, 366, 39, 28],
    28: [29.6, 179, 1.17, 1.15, 566, 463, 39, 29],
    40: [37.6, 231, 1.22, 1.16, 812, 623, 39, 28],
    60: [59.6, 324, 1.32, 1.19, 1297, 1015, 41, 28],
    88: [82.7, 415, 1.42, 1.24, 1854, 1571, 43, 26],
  },
  endgame: {
    4: [15.1, 106, 1.12, 1.2, 199, 275, 70, 46],
    10: [22.6, 146, 1.19, 1.23, 296, 386, 57, 53],
    16: [27.6, 181, 1.23, 1.24, 410, 517, 54, 53],
    22: [35.1, 224, 1.24, 1.27, 540, 636, 52, 56],
    28: [45.1, 270, 1.29, 1.29, 690, 858, 53, 60],
    40: [57.6, 342, 1.37, 1.32, 1000, 1186, 53, 61],
    60: [84.6, 469, 1.51, 1.41, 1606, 2040, 57, 66],
    88: [112.7, 599, 1.68, 1.52, 2296, 3269, 60, 69],
  },
};

/** The printed tables of 5.2 (every column), pinned for the model's own self-check. `hit` and `dps` are the doc's rounded numbers. */
export const DOC_TABLE: Record<Band, Record<BandMl, { sp: number; hit: number; castsPerSecond: number; dps: number }>> = {
  fair: {
    4: { sp: 14.2, hit: 28, castsPerSecond: 2.48, dps: 70 }, 10: { sp: 22.2, hit: 64, castsPerSecond: 2.5, dps: 161 },
    16: { sp: 31.8, hit: 123, castsPerSecond: 2.52, dps: 311 }, 22: { sp: 41.4, hit: 195, castsPerSecond: 2.52, dps: 491 },
    28: { sp: 51.0, hit: 254, castsPerSecond: 2.54, dps: 645 }, 40: { sp: 70.2, hit: 386, castsPerSecond: 2.56, dps: 988 },
    60: { sp: 102.2, hit: 637, castsPerSecond: 2.58, dps: 1645 }, 88: { sp: 137.4, hit: 922, castsPerSecond: 2.59, dps: 2390 },
  },
  good: {
    4: { sp: 14.2, hit: 95, castsPerSecond: 2.58, dps: 245 }, 10: { sp: 22.2, hit: 179, castsPerSecond: 2.59, dps: 463 },
    16: { sp: 31.8, hit: 382, castsPerSecond: 2.7, dps: 1033 }, 22: { sp: 41.4, hit: 631, castsPerSecond: 2.72, dps: 1714 },
    28: { sp: 51.0, hit: 890, castsPerSecond: 2.78, dps: 2475 }, 40: { sp: 70.2, hit: 1430, castsPerSecond: 2.89, dps: 4137 },
    60: { sp: 102.2, hit: 2827, castsPerSecond: 3.13, dps: 8860 }, 88: { sp: 137.4, hit: 4827, castsPerSecond: 3.38, dps: 16305 },
  },
  endgame: {
    4: { sp: 14.2, hit: 200, castsPerSecond: 2.67, dps: 533 }, 10: { sp: 22.2, hit: 513, castsPerSecond: 2.83, dps: 1454 },
    16: { sp: 31.8, hit: 1003, castsPerSecond: 2.92, dps: 2932 }, 22: { sp: 41.4, hit: 1739, castsPerSecond: 2.94, dps: 5115 },
    28: { sp: 51.0, hit: 2527, castsPerSecond: 3.07, dps: 7754 }, 40: { sp: 70.2, hit: 4119, castsPerSecond: 3.26, dps: 13426 },
    60: { sp: 102.2, hit: 8271, castsPerSecond: 3.61, dps: 29826 }, 88: { sp: 137.4, hit: 14659, castsPerSecond: 4.0, dps: 58619 },
  },
};

// ---------------------------------------------------------------------------------------------
// build(ml, band)
// ---------------------------------------------------------------------------------------------

export interface BandRow {
  band: Band;
  ml: number;
  level: number;
  /** Spell power of the level (class constants). */
  spellPower: number;
  /** All flat added spell damage (weapon base + affixes). */
  added: number;
  /** Sum of all additive increased damage in percent (gear, intelligence, tree). */
  increasedPct: number;
  more: number;
  /** Cast speed factor (1 + total cast speed). */
  castX: number;
  /** Expected crit factor 1 + chance x (multiplier - 1). */
  critX: number;
  effectiveness: number;
  /** Average hit of the main skill including the crit factor. */
  hit: number;
  castsPerSecond: number;
  /** Single-target, Focus-free DPS of the Lance-class basic attack before penetration or exposure. */
  dps: number;
  life: number;
  armour: number;
  evadePct: number;
  effectiveResistPct: number;
  params: BandParams;
}

/** Skill the tables are built on: the Lance-class basic attack. */
const LANCE = SKILLS.emberLance;

/** Effectiveness of the main skill at a fraction of its rank range (the rank endpoints come from the skill data). */
export function effectivenessAt(fraction: number): number {
  const e = LANCE.effectiveness;
  if (typeof e === 'number') return e;
  if ('lerp' in e) return e.lerp[0] + (e.lerp[1] - e.lerp[0]) * fraction;
  throw new Error('character-model: emberLance effectiveness must be a number or a lerp');
}

/** Spell power at the table level of a monster level (class constants). */
export const spellPowerFor = (ml: number): number => spellPowerAt(SORCERESS, levelFor(ml));

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpLog = (a: number, b: number, t: number) => (a > 0 && b > 0 ? Math.exp(lerp(Math.log(a), Math.log(b), t)) : lerp(a, b, t));

function budgetAt(ml: number, band: Band): Budget {
  const rows = BUDGET[band];
  if (ml <= BAND_MLS[0]) return rows[BAND_MLS[0]];
  if (ml >= BAND_MLS[BAND_MLS.length - 1]) return rows[BAND_MLS[BAND_MLS.length - 1]];
  for (let i = 1; i < BAND_MLS.length; i++) {
    if (ml <= BAND_MLS[i]) {
      const lo = rows[BAND_MLS[i - 1]], hi = rows[BAND_MLS[i]];
      const t = (ml - BAND_MLS[i - 1]) / (BAND_MLS[i] - BAND_MLS[i - 1]);
      return lo.map((v, k) => (k === 7 ? lerp(v, hi[k], t) : lerpLog(v, hi[k], t))) as unknown as Budget;
    }
  }
  return rows[88];
}

/** The sheet of a band at a monster level (exact at the eight table levels, log-linear in between). */
export function build(ml: number, band: Band): BandRow {
  const p = BAND_PARAMS[band];
  const [added, inc, castX, critX, life, armour, evadePct, res] = budgetAt(ml, band);
  const sp = spellPowerFor(ml);
  const e = effectivenessAt(rankFractionFor(ml));
  const castsPerSecond = castX / LANCE.castTime;
  const hit = (sp + added) * e * (1 + inc / 100) * p.more * critX;
  return {
    band, ml, level: levelFor(ml), spellPower: sp, added, increasedPct: inc, more: p.more, castX, critX, effectiveness: e, hit, castsPerSecond,
    dps: hit * castsPerSecond, life, armour, evadePct, effectiveResistPct: res, params: p,
  };
}

// ---------------------------------------------------------------------------------------------
// The tree's credit (5.2 itemised cell, passive-tree.md 4): the stand-in until the Orrery exists
// ---------------------------------------------------------------------------------------------

/** Passive points earned at a level: 1 per level to 50, then 1 per 2 levels, plus 3 boss marks from ML40 and 3 more from ML60. */
export function treePoints(ml: number): number {
  const L = levelFor(ml);
  return Math.max(0, Math.min(L - 1, 49) + (L > 50 ? Math.floor((L - 50) / 2) : 0)) + (ml >= 40 ? 3 : 0) + (ml >= 60 ? 3 : 0);
}
/** Share of the points spent on offence (26.6 of 59 in the Good ML60 cell). */
export const TREE_OFFENCE_SHARE = 0.45;
/** Increased damage per offence point (the doc's 3.8%), cast speed and crit per offence point at the endgame band (passive-tree 8% and 10% per 31). */
export const TREE_PER_POINT = { inc: 3.8, cast: 8 / 31, crit: 10 / 31 } as const;

export interface TreeCredit { points: number; offencePoints: number; incPct: number; castPct: number; critPct: number }

export function treeCredit(ml: number, band: Band): TreeCredit {
  const eff = BAND_PARAMS[band].efficiency;
  const offencePoints = treePoints(ml) * TREE_OFFENCE_SHARE;
  return {
    points: treePoints(ml), offencePoints, incPct: offencePoints * TREE_PER_POINT.inc * eff, castPct: offencePoints * TREE_PER_POINT.cast * eff,
    critPct: offencePoints * TREE_PER_POINT.crit * eff,
  };
}

// ---------------------------------------------------------------------------------------------
// Monsters (6.1, 6.3): constants of the roster plus the data curve
// ---------------------------------------------------------------------------------------------

/** Base numbers of the Ashen Forge roster the doc uses (src/sim/rosters/ashenForge/index.ts). */
export const ROSTER = { ashlingLife: 22, ashlingBite: 6, bruteSlam: 22, bossLife: 4800, bossDamage: 26, bossSlamFactor: 1.8, bossWave: 6, trashWave: 3 } as const;

/** Monster level of a tier (6t - 2). */
export const monsterLevelOfTier = (tier: number): number => Math.min(90, 6 * tier - 2);
export const tierOfMonsterLevel = (ml: number): number => (ml + 2) / 6;

/** Rare life floor (6.3): 22 at T1 to 150 from T6. */
export function rareLifeFloor(ml: number): number {
  const t = Math.max(0, Math.min(1, (tierOfMonsterLevel(ml) - 1) / 5));
  return lerp(22, 150, t);
}

export const waveGrowth = (wave: number): number => 1 + WAVE_LIFE_GROWTH * (wave - 1);

export interface MonsterRow {
  lifeScale: number;
  damageScale: number;
  trashLife: number;
  packLife: number;
  rareLife: number;
  bossLife: number;
}

export function monsterRow(ml: number): MonsterRow {
  const ls = monsterLifeScale(ml);
  const ds = monsterDamageScale(ml);
  const trash = ROSTER.ashlingLife * ls * waveGrowth(ROSTER.trashWave);
  return {
    lifeScale: ls, damageScale: ds, trashLife: trash, packLife: trash * 6,
    rareLife: Math.max(ROSTER.ashlingLife, rareLifeFloor(ml)) * 3 * ls * waveGrowth(ROSTER.trashWave),
    bossLife: ROSTER.bossLife * waveGrowth(ROSTER.bossWave) * ls,
  };
}

// ---------------------------------------------------------------------------------------------
// Time to kill (7.1, 6.3)
// ---------------------------------------------------------------------------------------------

/** Pack throughput factor: uptime in range 0.8, overlap 0.85, at most six targets. */
export const packFactor = (band: Band): number => 0.8 * Math.min(BAND_PARAMS[band].targets, 6) * 0.85;

export interface KillTimes { trash: number; pack: number; rare: number; boss: number }

export function killTimes(ml: number, band: Band): KillTimes {
  const row = build(ml, band);
  const m = monsterRow(ml);
  return {
    trash: m.trashLife / row.dps,
    pack: m.packLife / (row.dps * packFactor(band)),
    rare: m.rareLife / (row.dps * 0.8),
    boss: m.bossLife / (row.dps * row.params.uptime),
  };
}

/** Seconds to kill a fire-proof rare (4.3): `answerTaken` is the fraction of a clean hit that lands (0.10 none, 0.25 pen 15, ...). */
export function proofRareSeconds(ml: number, band: Band, answerTaken: number, juggernaut = false): number {
  const row = build(ml, band);
  const life = monsterRow(ml).rareLife * (juggernaut ? 3 : 1);
  return life / (row.dps * 0.8 * answerTaken);
}

// ---------------------------------------------------------------------------------------------
// Incoming hits (7.2): armour build, damage-taken multiplier of the band
// ---------------------------------------------------------------------------------------------

export interface Incoming {
  life: number;
  biteAbs: number; bitePct: number;
  bruteSlamAbs: number; bruteSlamPct: number;
  bossSlamAbs: number; bossSlamPct: number;
}

/** Post-mitigation physical hit: d x (1 - A / (A + 10 d)) x damage taken. */
export const mitigated = (d: number, armour: number, damageTaken: number): number => d * (1 - armour / (armour + 10 * d)) * damageTaken;

export function incoming(ml: number, band: Band, characterLevel = levelFor(ml)): Incoming {
  const row = build(ml, band);
  const ds = monsterDamageScale(ml);
  const gap = 1 + Math.min(1, Math.max(0, ml - characterLevel - 3) * 0.05);
  const hit = (base: number) => mitigated(base * ds * gap, row.armour, row.params.damageTaken);
  const bite = hit(ROSTER.ashlingBite), brute = hit(ROSTER.bruteSlam), slam = hit(ROSTER.bossDamage * ROSTER.bossSlamFactor);
  return {
    life: row.life, biteAbs: bite, bitePct: (100 * bite) / row.life, bruteSlamAbs: brute, bruteSlamPct: (100 * brute) / row.life,
    bossSlamAbs: slam, bossSlamPct: (100 * slam) / row.life,
  };
}

// ---------------------------------------------------------------------------------------------
// Clear time (9.3)
// ---------------------------------------------------------------------------------------------

/** Packs per wave: 60% of 40 + 18 (w - 1) monsters in packs of about six. */
export const PACKS_PER_WAVE = [4, 6, 8, 9, 11, 13] as const;
const ARENA_AREA = Math.PI * 900 * 900;

export interface ClearOptions {
  /** Monster count multiplier of the map (Teeming, density nodes): scales the packs per wave. */
  density?: number;
  /** Multiplier on the monsters' life from map modifiers (the level curve is already in the model). */
  life?: number;
  /** Multiplier on the boss's life. */
  boss?: number;
}

/** Fixed seconds of a map that no kill speed shortens (9.3): six 3-second tells, and loot clicks, chest and portal at the end. */
export const TELL_SECONDS = 18;
export const LOOT_SECONDS = 45;

/** Seconds of walking between packs while a wave of `packs` packs is cleared (9.3): route inefficiency 1.8, hop = spacing minus the engage reach. */
export function walkSeconds(band: Band, packs: number): number {
  if (packs <= 0) return 0;
  const v = 110 * (1 + BAND_PARAMS[band].moveSpeed);
  const hop = Math.max(60, 0.7124 * Math.sqrt(ARENA_AREA / packs) - 250);
  return (1.8 * packs * hop) / v;
}

export interface ClearBreakdown { walk: number; kills: number; tells: number; boss: number; loot: number; total: number }

export function clearBreakdown(ml: number, band: Band, o: ClearOptions = {}): ClearBreakdown {
  const row = build(ml, band);
  const m = monsterRow(ml);
  const density = o.density ?? 1;
  let walk = 0, kills = 0;
  PACKS_PER_WAVE.forEach((base, i) => {
    const packs = base * density;
    walk += walkSeconds(band, packs);
    const packLife = ROSTER.ashlingLife * monsterLifeScale(ml) * waveGrowth(i + 1) * 6 * (o.life ?? 1);
    kills += packs * (packLife / (row.dps * packFactor(band)) + 0.4);
  });
  const boss = (m.bossLife * (o.life ?? 1) * (o.boss ?? 1)) / (row.dps * row.params.uptime);
  const tells = TELL_SECONDS, loot = LOOT_SECONDS;
  return { walk, kills, tells, boss, loot, total: walk + kills + tells + boss + loot };
}

export const clearSeconds = (ml: number, band: Band, o: ClearOptions = {}): number => clearBreakdown(ml, band, o).total;

// ---------------------------------------------------------------------------------------------
// The Atlas harness' kill rate (9.2): speed is character power
// ---------------------------------------------------------------------------------------------

export interface KillRate {
  /** Life units per second the character kills in a crowd (one unit = one baseline monster's life at the map's own multipliers). */
  speed: number;
  /** Seconds the unmodified boss of this level takes (uptime applied). */
  bossSeconds: number;
  /** Life of one unit in hit points at this monster level. */
  unitLife: number;
}

/**
 * `speed(band, ML) = DPS x pack factor / unit life`: the harness counts life in "units" where a unit is one baseline
 * monster at the map's own life multiplier (which already holds the level curve), so a unit is `ashlingLife` hit points.
 */
export function killRate(ml: number, band: Band): KillRate {
  const row = build(ml, band);
  const m = monsterRow(ml);
  return { speed: (row.dps * packFactor(band)) / ROSTER.ashlingLife, bossSeconds: m.bossLife / (row.dps * row.params.uptime), unitLife: ROSTER.ashlingLife };
}

/** Level cap in force in the rules (reported next to the table level so a reader sees the P0 switch). */
export const RULES_LEVEL_CAP = LEVEL_CAP;
