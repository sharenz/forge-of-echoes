// Monster kind indices and elite modifiers (GAME_SPEC §8). Each kind's stats and behaviour live in its
// roster's MonsterDef (src/sim/rosters); MonsterScaling, wave growth, elite mods and party size multiply
// them at spawn (spawn.ts).
import { MONSTER_KINDS, type MonsterKind } from '../contracts/content';
import { ELITE_BIT } from '../contracts/sim';
import type { Rng } from '../contracts/rng';
import type { MonsterDef } from './rosters/types';

export type { ResistRow } from './rosters/types';

export const KIND_INDEX = Object.fromEntries(MONSTER_KINDS.map((k, i) => [k, i])) as Record<MonsterKind, number>;
export const KIND_BY_INDEX: readonly MonsterKind[] = MONSTER_KINDS;

/** Pack composition weight of a kind in `wave` (0 before it unlocks, and for kinds that never join packs). */
export function packWeight(def: MonsterDef, wave: number): number {
  if (def.fromWave <= 0 || wave < def.fromWave) return 0;
  return Math.max(0.5, def.weight * (1 + def.weightGrowth * (wave - def.fromWave)));
}

// --- elite modifiers (bit flags in MonsterStore.mods, exactly the contract's ELITE_BIT) --------------
//   magic: swift +30% speed · stout +70% life · fierce +40% damage
//   rare:  juggernaut +200% life · frenzied +50% speed · emberTouched (telegraphed fire burst on
//          death) · warded (40% less damage taken while allies are near)
//          fire/cold/lightning-proof (ELITE_PROOF_RESIST to one element: a build with no answer grinds, one with
//          another element or penetration shreds it) · stormcalled (telegraphed lightning bolts that shock) ·
//          rending (telegraphed raking strikes that bleed). The last five are gated by map tier (rollRareMods).
export const ELITE = ELITE_BIT;

export const MAGIC_MODS: readonly number[] = [ELITE.swift, ELITE.stout, ELITE.fierce];
export const RARE_MODS: readonly number[] = [ELITE.juggernaut, ELITE.frenzied, ELITE.emberTouched, ELITE.warded];

/** Elemental proofs: [bit, damage-type index in MonsterStore.res]. Order matches DAMAGE_TYPES (physical, fire, cold, lightning, void). */
export const PROOF_MODS: readonly (readonly [number, number])[] = [[ELITE.fireProof, 1], [ELITE.coldProof, 2], [ELITE.lightningProof, 3]];
export const PROOF_MASK = ELITE.fireProof | ELITE.coldProof | ELITE.lightningProof;
/** Behavioural rare mods that punish weak defences with telegraphed strikes (ai.ts eliteStrikes). */
export const STRIKE_MODS: readonly number[] = [ELITE.stormcalled, ELITE.rending];
export const STRIKE_MASK = ELITE.stormcalled | ELITE.rending;

/**
 * Resistance a proof rare has to its element (before the map's own bonus). Not a literal immunity. Monster
 * resistance is capped at MONSTER_RESIST_CAP (constants.ts, 90%).
 */
export const ELITE_PROOF_RESIST = 0.9;

/** Map tier a monster level belongs to (inverse of monsterLevelForTier: level = 6 × tier − 2). */
function tierOfLevel(level: number): number {
  return Math.max(1, Math.min(15, (level + 2) / 6));
}

/**
 * Weight of each rare mod for monsters of `level`. The basic four are always in the pool. Behavioural strikes
 * fade in over tiers 1–5 and are absent in Tier 1; elemental proofs fade in over tiers 2–8 (absent in T1–T2),
 * so the first maps stay forgiving and deeper ones increasingly demand a second damage answer.
 */
export function rareModWeights(level: number): readonly (readonly [number, number])[] {
  const tier = tierOfLevel(level);
  const ramp = (from: number, to: number) => Math.max(0, Math.min(1, (tier - from) / (to - from)));
  const strike = ramp(1, 5);
  const proof = ramp(2, 8);
  return [
    ...RARE_MODS.map((bit) => [bit, 1] as const),
    ...STRIKE_MODS.map((bit) => [bit, strike] as const),
    ...PROOF_MODS.map(([bit]) => [bit, proof * 0.6] as const),
  ];
}

/**
 * Roll a rare pack leader's distinct mods for `level`: two, or three from Tier 10 up a quarter of the time.
 * At most one elemental proof, so a rare never shrugs off two elements at once.
 */
export function rollRareMods(rng: Pick<Rng, 'next' | 'weighted' | 'shuffle'>, level: number): number {
  // Tier 1 rolls exactly as before the tier-gated mods existed (same rng draws, same packs).
  if (tierOfLevel(level) <= 1) {
    const two = rng.shuffle(RARE_MODS).slice(0, 2);
    return two[0] | two[1];
  }
  let pool = rareModWeights(level).filter(([, wt]) => wt > 0);
  const count = tierOfLevel(level) >= 10 && rng.next() < 0.25 ? 3 : 2;
  let mods = 0;
  for (let k = 0; k < count; k++) {
    const pick = rng.weighted(pool, ([, wt]) => wt);
    if (!pick) break;
    mods |= pick[0];
    pool = pool.filter(([bit]) => bit !== pick[0] && !(PROOF_MASK & pick[0] && PROOF_MASK & bit));
  }
  return mods;
}

/** Monster resistance to damage type `dtype` after elite mods: proofs raise their element to ELITE_PROOF_RESIST. */
export function eliteResist(mods: number, dtype: number, base: number): number {
  for (const [bit, type] of PROOF_MODS) if (type === dtype && mods & bit) return Math.max(base, ELITE_PROOF_RESIST);
  return base;
}

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

/** Baseline rarity strength, before the pack's rolled modifiers. Named bosses use their own tuning. */
export const RARITY_STRENGTH = {
  normal: { life: 1, damage: 1 },
  magic: { life: 1.5, damage: 1.2 },
  rare: { life: 3, damage: 1.5 },
} as const;
