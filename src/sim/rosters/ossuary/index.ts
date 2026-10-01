// Rimed Ossuary roster (GAME_SPEC §13–§14): cold and bone. Numbers sit next to their Ashen Forge twins
// (swarmer ≈ Ashling, fast ≈ Ember Skitter, artillery ≈ Cinder Spitter, hunter ≈ Rift Stalker, bruiser ≈
// Ironhide Brute, lieutenant ≈ Ashbound Herald, boss ≈ Cinder Matriarch); MonsterScaling — the map's tier,
// its early-tier easing and the Ossuary's +20% monster life — multiplies them like everyone else's.
//
//   Bone Thrall     swarmer (wave 1+): a clattering skeleton; short windup, lunge-bite. No debuff. Its
//                   bones stay: every death is a corpse the Chorister can raise.
//   Glacial Wisp    fast (wave 1+): weaves in, rushes the last 170 units, stops and pulses 0.7 s (a
//                   wispBurst ring), then shatters: chill in the ring, Frozen in its inner 40%. Killing it
//                   during the pulse cancels the burst; a shattered wisp still drops its loot (credited to
//                   nobody).
//   Rimeshade       hunter (wave 2+): a ghost (drifts through monsters and props, no crowding, never slows
//                   a player); weaves in, glides the last stretch, touches (Chilled) and fades back.
//   Frost Weaver    artillery (wave 2+): keeps 150–230 away and spits a slow web shot (120 units/s) that
//                   Roots (source 'web') on hit. Aimed where a player walking steadily would meet it: keep
//                   walking into it and it catches you; stop, turn or sidestep while it flies and it misses.
//   Ossuary Golem   bruiser (wave 4+): armoured (35% less damage from hits); a 1 s frost slam telegraph
//                   (frostNovaWarning) in front of it that Chills.
//   Bone Chorister  Choral Crypt boss: haste aura (allies +25% speed); every 4 s a Choir Wave — two expanding
//                   frost rings with three gaps each, the second ring's gaps turned a little further (stand
//                   where both overlap; Chilled on touch); raises Bone Thralls from corpses, or the ground,
//                   every 9 s (never onto a saturated field: SUMMON_FIELD_CAP).
//   Hollow Warden   boss: see ./warden.ts (nova rings and shard volleys; spikes and the Ice Prison from
//                   phase 2; blizzards in phase 3; summons Rimeshades).
//
// Debuffs: Chilled (Rimeshade touch, wisp burst ring, golem slam, choir rings, every frost shard, the
// Warden's nova, lantern, spikes and blizzards) · Rooted only from web shots · Frozen only from telegraphs:
// the inner ring of a wisp's 0.7 s pulse and the Warden's Ice Prison (2 s closing ring).
//
// Presenter / audio cues ('monsterAttack' per kind, x/y = where it happens):
//   boneThrall     'melee' on every bite (meleeHit's low-priority cue).
//   rimeshade      'melee' on every touch, landed or not (anim windup = the 0.24 s reach before it).
//   frostWeaver    'web' as the web leaves (anim attack).
//   glacialWisp    'pulse' when its ring appears (anim windup = the 0.7 s pulse), 'burst' at the ring when it
//                  resolves — its 'death' follows in the same tick (play monster/glacialWisp/burst there).
//   ossuaryGolem   'slam' at the slam centre when it lands (anim windup during the telegraph).
//   boneChorister  Choir Wave: anim windup (the toll) for 0.6 s, then 'sing' on each of the two rings.
//                  Raising: 'summon' as the 0.9 s chant starts (anim windup — the sing loop), the thralls
//                  appear at its end ('monsterSpawn' each, summoned).
//   hollowWarden   'spikes' / 'prison' (x/y = the prison) / 'blizzard' as those casts start — the telegraphs
//                  appear in the same tick and she holds anim windup (her cast pose) for the cast; 'summon'
//                  as the 0.6 s summoning cast starts, the Rimeshades rising at its end ('monsterSpawn' each,
//                  summoned); a windup with none of these is the Frost Nova channel (1.2 s), ended by 'nova'
//                  at the burst; 'orb' when a shard volley leaves; 'melee' on a lantern swing.
//   A frostNovaWarning resolve is voiced by the 'slam' / 'nova' of the same tick.
import { meleeBrain, slamBrain } from '../kit';
import type { MonsterDef } from '../types';
import { brainRimeshade, brainWeaver, brainWisp } from './brains';
import { brainChorister, onChoristerSpawn } from './chorister';
import { gapLeap } from '../pressure';
import { GOLEM, THRALL, THRALL_LEAP } from './tuning';
import { WARDEN_SCRIPT, brainWarden } from './warden';

/** Ossuary Golems are armoured like the Ironhide Brute, a little less (they are brittle to fire). */
const GOLEM_HIT_REDUCTION = 0.35;

export function ossuaryRoster(): MonsterDef[] {
  return [
    {
      kind: 'boneThrall', name: 'Bone Thrall', role: 'swarmer',
      radius: 6, life: 21, speed: 48, damage: 6, xp: 3, damageType: 'physical', resist: [0, 0, 0.25, 0, 0], knockback: 1,
      fromWave: 1, weight: 10, weightGrowth: -0.06,
      brain: gapLeap(
        meleeBrain({ reach: THRALL.reach, windup: THRALL.windup, recover: THRALL.recover, cooldown: THRALL.cooldown, lunge: THRALL.lunge }),
        THRALL_LEAP,
      ),
    },
    {
      kind: 'rimeshade', name: 'Rimeshade', role: 'hunter',
      radius: 7, life: 32, speed: 56, damage: 12, xp: 7, damageType: 'cold', resist: [0.3, -0.1, 0.4, 0, 0.1], knockback: 0.6,
      fromWave: 2, weight: 3.5, weightGrowth: 0.12, maxPerPack: 3,
      ghost: true,
      brain: brainRimeshade,
    },
    {
      kind: 'frostWeaver', name: 'Frost Weaver', role: 'artillery',
      radius: 8, life: 18, speed: 40, damage: 7, xp: 5, damageType: 'cold', resist: [0, -0.15, 0.3, 0, 0], knockback: 1,
      fromWave: 2, weight: 3, weightGrowth: 0.12, streamWeight: 0.7, maxPerPack: 2,
      brain: brainWeaver,
    },
    {
      kind: 'glacialWisp', name: 'Glacial Wisp', role: 'fast',
      radius: 5, life: 12, speed: 82, damage: 8, xp: 3, damageType: 'cold', resist: [0, -0.25, 0.6, 0, 0], knockback: 1,
      fromWave: 1, weight: 5, weightGrowth: 0.02, maxPerPack: 3,
      brain: brainWisp,
    },
    {
      kind: 'ossuaryGolem', name: 'Ossuary Golem', role: 'bruiser',
      radius: 12, life: 114, speed: 32, damage: 22, xp: 14, damageType: 'cold', resist: [0.1, -0.1, 0.4, 0, 0], knockback: 0.35,
      fromWave: 4, weight: 2, weightGrowth: 0.25, streamWeight: 0.5, maxPerPack: 2,
      heavy: true, hitReduction: GOLEM_HIT_REDUCTION,
      // frostNovaWarning's default rider chills.
      brain: slamBrain({
        windup: GOLEM.windup, radius: GOLEM.radius, offset: GOLEM.offset, cooldown: GOLEM.cooldown, recover: GOLEM.recover,
        mult: GOLEM.mult, dtype: 'cold', area: 'frostNovaWarning', attack: 'slam',
      }),
    },
    {
      kind: 'boneChorister', name: 'Bone Chorister', role: 'boss',
      radius: 14, life: 3600, speed: 36, damage: 24, xp: 1000, damageType: 'cold', resist: [0.15, 0.1, 0.3, 0.15, 0.15], knockback: 0,
      fromWave: 0, weight: 0, weightGrowth: 0,
      heavy: true,
      brain: brainChorister,
      onSpawn: onChoristerSpawn,
    },
    {
      // The champions' 4800 life, less the Ossuary's +20% monster life (MAP_BASES implicit): in her own map she has
      // about the Matriarch's and Varkus's life. A rime-lich, she burns (−10% fire, like her family).
      kind: 'hollowWarden', name: 'The Hollow Warden', role: 'boss',
      radius: 22, life: 4000, speed: 60, damage: 26, xp: 1000, damageType: 'cold', resist: [0.2, -0.1, 0.35, 0.15, 0.2], knockback: 0,
      fromWave: 0, weight: 0, weightGrowth: 0,
      heavy: true,
      brain: brainWarden,
      boss: WARDEN_SCRIPT,
    },
  ];
}
