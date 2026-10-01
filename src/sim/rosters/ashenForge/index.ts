// Ashen Forge roster (GAME_SPEC §8, §14): Ashling, Ember Skitter, Cinder Spitter, Rift Stalker, Ironhide
// Brute, the Ashbound Herald (Cinder Chapel boss) and the Cinder Matriarch (boss).
//
// Debuffs (GAME_SPEC §13–§14): the spitter's lob, the Matriarch's orbs and every fire pool / eruption set
// players Burning; Rift Stalker leaps and the Herald's void orbs Wither. Those riders are the defaults of
// the projectile and area kinds (projectiles.ts PROJECTILE_RIDERS, areas.ts AREA_RIDERS), so the brains
// don't mention them.
import { ARMOURED_HIT_REDUCTION } from '../../constants';
import type { MonsterDef } from '../types';
import { brainAshling, brainBrute, brainSkitter, brainSpitter, brainStalker } from './brains';
import { brainHerald, onHeraldSpawn } from './herald';
import { MATRIARCH_SCRIPT, brainMatriarch } from './matriarch';

export function ashenForgeRoster(): MonsterDef[] {
  return [
    {
      kind: 'ashling', name: 'Ashling', role: 'swarmer',
      radius: 6, life: 22, speed: 50, damage: 6, xp: 3, damageType: 'physical', resist: [0, 0.1, 0, 0, 0], knockback: 1,
      fromWave: 1, weight: 10, weightGrowth: -0.06,
      brain: brainAshling,
    },
    {
      kind: 'emberSkitter', name: 'Ember Skitter', role: 'fast',
      radius: 5, life: 12, speed: 95, damage: 4, xp: 2, damageType: 'fire', resist: [0, 0.25, -0.15, 0, 0], knockback: 1,
      fromWave: 1, weight: 6, weightGrowth: 0,
      brain: brainSkitter,
    },
    {
      kind: 'cinderSpitter', name: 'Cinder Spitter', role: 'artillery',
      radius: 7, life: 18, speed: 40, damage: 8, xp: 5, damageType: 'fire', resist: [0, 0.2, 0, 0, 0], knockback: 1,
      fromWave: 2, weight: 4, weightGrowth: 0.15,
      brain: brainSpitter,
    },
    {
      kind: 'riftStalker', name: 'Rift Stalker', role: 'hunter',
      radius: 8, life: 40, speed: 60, damage: 14, xp: 8, damageType: 'void', resist: [0, 0, 0, -0.1, 0.3], knockback: 0.8,
      fromWave: 3, weight: 3, weightGrowth: 0.2, streamWeight: 0.5,
      brain: brainStalker,
    },
    {
      kind: 'ironhideBrute', name: 'Ironhide Brute', role: 'bruiser',
      // "Armoured": 40% less damage from every hit (hitReduction, applied in damageMonster) rather than a
      // physical resistance the all-elemental Sorceress would never meet. Burning (ignite, fire trails,
      // ward embers) ignores it — the build answer to brutes.
      radius: 12, life: 120, speed: 34, damage: 22, xp: 14, damageType: 'physical', resist: [0, 0.1, 0, -0.15, 0], knockback: 0.35,
      fromWave: 4, weight: 2, weightGrowth: 0.25, streamWeight: 0.5, maxPerPack: 2,
      heavy: true, hitReduction: ARMOURED_HIT_REDUCTION,
      brain: brainBrute,
    },
    {
      // Promoted Cinder Chapel commander: existing casts and escorts, now a final encounter.
      kind: 'ashboundHerald', name: 'Ashbound Herald', role: 'boss',
      radius: 14, life: 3600, speed: 50, damage: 24, xp: 1000, damageType: 'void', resist: [0.15, 0.25, 0.15, 0.15, 0.15], knockback: 0,
      fromWave: 0, weight: 0, weightGrowth: 0,
      heavy: true,
      brain: brainHerald,
      onSpawn: onHeraldSpawn,
    },
    {
      // Existing Ashen Forge final boss; the map split preserves her approved tuning.
      kind: 'cinderMatriarch', name: 'Cinder Matriarch', role: 'boss',
      radius: 24, life: 4800, speed: 42, damage: 26, xp: 1000, damageType: 'fire', resist: [0.2, 0.05, 0.15, 0.15, 0.15], knockback: 0,
      fromWave: 0, weight: 0, weightGrowth: 0,
      heavy: true,
      brain: brainMatriarch,
      boss: MATRIARCH_SCRIPT,
    },
  ];
}
