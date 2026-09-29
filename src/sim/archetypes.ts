// Monster archetypes (GAME_SPEC §8). The sim owns these numbers; MonsterScaling multiplies them.
import { MONSTER_KINDS, type DamageType, type MonsterKind } from '../contracts/content';
import { ELITE_BIT } from '../contracts/sim';

export type ResistRow = readonly [physical: number, fire: number, cold: number, lightning: number, voidRes: number];

export interface Archetype {
  kind: MonsterKind;
  radius: number;
  life: number;
  speed: number;
  damage: number;
  xp: number;
  /** First wave in which the archetype can appear in regular packs (0 = never). */
  fromWave: number;
  /** Composition weight when unlocked, and its growth per wave after unlocking. */
  weight: number;
  weightGrowth: number;
  damageType: DamageType;
  resist: ResistRow;
  /** 0..1 knockback susceptibility. */
  knockback: number;
}

const A = (a: Archetype): Archetype => a;

export const ARCHETYPES: Record<MonsterKind, Archetype> = {
  ashling: A({
    kind: 'ashling', radius: 6, life: 22, speed: 50, damage: 6, xp: 3, fromWave: 1, weight: 10, weightGrowth: -0.06,
    damageType: 'physical', resist: [0, 0.1, 0, 0, 0], knockback: 1,
  }),
  emberSkitter: A({
    kind: 'emberSkitter', radius: 5, life: 12, speed: 95, damage: 4, xp: 2, fromWave: 1, weight: 6, weightGrowth: 0,
    damageType: 'fire', resist: [0, 0.25, -0.15, 0, 0], knockback: 1,
  }),
  cinderSpitter: A({
    kind: 'cinderSpitter', radius: 7, life: 18, speed: 40, damage: 8, xp: 5, fromWave: 2, weight: 4, weightGrowth: 0.15,
    damageType: 'fire', resist: [0, 0.2, 0, 0, 0], knockback: 1,
  }),
  riftStalker: A({
    kind: 'riftStalker', radius: 8, life: 40, speed: 60, damage: 14, xp: 8, fromWave: 3, weight: 3, weightGrowth: 0.2,
    damageType: 'void', resist: [0, 0, 0, -0.1, 0.3], knockback: 0.8,
  }),
  ironhideBrute: A({
    kind: 'ironhideBrute', radius: 12, life: 120, speed: 34, damage: 22, xp: 14, fromWave: 4, weight: 2, weightGrowth: 0.25,
    // "Armoured": 40% less damage from every hit (ARMOURED_HIT_REDUCTION, applied in damageMonster)
    // rather than a physical resistance the all-elemental Sorceress would never meet. Burning
    // (ignite, fire trails, ward embers) ignores it — the build answer to brutes.
    damageType: 'physical', resist: [0, 0.1, 0, -0.15, 0], knockback: 0.35,
  }),
  ashboundHerald: A({
    kind: 'ashboundHerald', radius: 14, life: 1200, speed: 38, damage: 16, xp: 150, fromWave: 0, weight: 0, weightGrowth: 0,
    damageType: 'void', resist: [0.15, 0.25, 0.15, 0.15, 0.15], knockback: 0,
  }),
  cinderMatriarch: A({
    kind: 'cinderMatriarch', radius: 24, life: 7000, speed: 42, damage: 26, xp: 1000, fromWave: 0, weight: 0, weightGrowth: 0,
    damageType: 'fire', resist: [0.2, 0.3, 0.15, 0.15, 0.15], knockback: 0,
  }),
  trainingDummy: A({
    kind: 'trainingDummy', radius: 10, life: 1000, speed: 0, damage: 0, xp: 0, fromWave: 0, weight: 0, weightGrowth: 0,
    damageType: 'physical', resist: [0, 0, 0, 0, 0], knockback: 0,
  }),
};

export const KIND_INDEX = Object.fromEntries(MONSTER_KINDS.map((k, i) => [k, i])) as Record<MonsterKind, number>;
export const KIND_BY_INDEX: readonly MonsterKind[] = MONSTER_KINDS;
export const ARCHETYPE_BY_INDEX: readonly Archetype[] = MONSTER_KINDS.map((k) => ARCHETYPES[k]);

/** Kinds that make up regular packs, in a fixed order (deterministic weighted picks). */
export const PACK_KINDS: readonly MonsterKind[] = ['ashling', 'emberSkitter', 'cinderSpitter', 'riftStalker', 'ironhideBrute'];

export function packWeight(kind: MonsterKind, wave: number): number {
  const a = ARCHETYPES[kind];
  if (a.fromWave <= 0 || wave < a.fromWave) return 0;
  return Math.max(0.5, a.weight * (1 + a.weightGrowth * (wave - a.fromWave)));
}

// --- elite modifiers (bit flags in MonsterStore.mods, exactly the contract's ELITE_BIT) --------------
//   magic: swift +30% speed · stout +70% life · fierce +40% damage
//   rare:  juggernaut +200% life · frenzied +50% speed · emberTouched (telegraphed fire burst on
//          death) · warded (40% less damage taken while allies are near)
export const ELITE = ELITE_BIT;

export const MAGIC_MODS: readonly number[] = [ELITE.swift, ELITE.stout, ELITE.fierce];
export const RARE_MODS: readonly number[] = [ELITE.juggernaut, ELITE.frenzied, ELITE.emberTouched, ELITE.warded];

export function eliteLifeMult(mods: number): number {
  let m = 1;
  if (mods & ELITE.stout) m *= 1.7;
  if (mods & ELITE.juggernaut) m *= 3;
  return m;
}

export function eliteSpeedMult(mods: number): number {
  let m = 1;
  if (mods & ELITE.swift) m *= 1.3;
  if (mods & ELITE.frenzied) m *= 1.5;
  return m;
}

export function eliteDamageMult(mods: number): number {
  return mods & ELITE.fierce ? 1.4 : 1;
}

export const RARITY_XP = { normal: 1, magic: 2, rare: 6 } as const;

// --- behaviour tuning ------------------------------------------------------------------------------
export const BEHAVIOUR = {
  ashling: { reach: 10, windup: 0.22, lungeTime: 0.15, lungeSpeed: 120, cooldown: 1.2 },
  skitter: { reach: 4, biteTime: 0.15, cooldown: 0.9, zigzagFreq: 6, zigzagAmp: 0.9, burstFreq: 5 },
  // Spit lands where the player will be `lead` seconds after release (partial lead: walking dodges it).
  spitter: {
    near: 140, far: 220, fireRange: 300, cooldown: 2.4, windup: 0.45, lead: 0.5, minRange: 40, range: 360, radius: 5, spread: 0.2,
  },
  stalker: { trigger: 190, minTrigger: 30, cooldown: 4, windup: 0.35, flight: 0.25, recover: 0.45, radius: 26 },
  brute: { windup: 0.9, radius: 42, cooldown: 3.2, recover: 0.4 },
  herald: {
    keepNear: 110, keepFar: 170, summonEvery: 6, summonCount: 6, summonCastTime: 0.45, orbEvery: 3, orbCount: 5,
    orbSpread: 0.7, orbSpeed: 140, orbRange: 420, orbRadius: 6, castTime: 0.5, releaseTime: 0.3,
  },
} as const;
