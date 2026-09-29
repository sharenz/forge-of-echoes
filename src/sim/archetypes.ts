// Monster kind indices and elite modifiers (GAME_SPEC §8). Each kind's stats and behaviour live in its
// roster's MonsterDef (src/sim/rosters); MonsterScaling, wave growth, elite mods and party size multiply
// them at spawn (spawn.ts).
import { MONSTER_KINDS, type MonsterKind } from '../contracts/content';
import { ELITE_BIT } from '../contracts/sim';
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

/** Baseline rarity strength, before the pack's rolled modifiers. Named bosses use their own tuning. */
export const RARITY_STRENGTH = {
  normal: { life: 1, damage: 1 },
  magic: { life: 1.5, damage: 1.2 },
  rare: { life: 3, damage: 1.5 },
} as const;
