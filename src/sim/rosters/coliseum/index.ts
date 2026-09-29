// Iron Coliseum roster (GAME_SPEC §14): physical damage, Bleeding, chains and tar in a torch-lit arena.
//
//   Pit Hound         fast (the bulk)  prowls round its prey, crouches 0.3 s (the tell), pounces; the bite
//                                      Bleeds (family.ts).
//   Chain Thrall      hunter           whirls its hook overhead 0.7 s, throws a visible chainHook that drags
//                                      its victim 40 units toward it and roots them ('chain'); rushes in and
//                                      rakes (a plain hit).
//   Iron Crossbowman  artillery        a 0.6 s locked aim line (chargeLine variant 0), then a fast bolt exactly
//                                      along it that Bleeds. Splitting's extra bolts fan out beside the aimed
//                                      one, each with its own line; at most 2 crossbowmen aim at one player.
//   Shieldbearer      bruiser          blocks player projectiles in a 120° front (flank it); a bash with
//                                      knockback at whoever stands in front — its guard is down while it bashes.
//   Tar Slinger       support          lobs tar where its target is heading; the tarPool slows 50% and roots
//                                      ('tar') on first contact. No carpets: at most TAR.maxNear pools (lying,
//                                      in flight or being loaded) round one player.
//   The Chainmaster   Chainworks boss       hooks the farthest player along an aim line and drags them in, whirls
//                                      his chains (a telegraphed ring, then bleeding blades), summons Chain
//                                      Thralls (chainmaster.ts).
//   Varkus            boss, 3 phases   cleave, charge, Execution Mark + leap (all phases), whirlwind (2+),
//                                      Crowd's Favour spike patterns (3), Pit Hound summons (varkus.ts). One big
//                                      telegraph at a time, and a root never takes a dodge away (varkus.ts).
//
// Debuffs: Bleeding (hound bites, crossbow bolts, the Chainmaster's chains, Varkus's charge and whirlwind) and
// Rooted (chain hooks, tar pools) only — every root comes from a projectile you can see (a hook) or ground you
// can see (tar, landed from a visible lob). Nothing here roots or freezes on a plain hit. Varkus starts no
// lane, cleave, whirl or spike pattern on a held player, and his lane, cleave circle and spike tiles wait for
// one standing in them (VARKUS.walkOut).
//
// Numbers (GAME_SPEC §14 "Scaling and loot"): hounds ≈ Ashling (the swarmers), thralls ≈ Rift Stalker, the
// crossbowman ≈ Cinder Spitter, the Shieldbearer ≈ Ironhide Brute (its shield instead of armour), the
// Chainmaster ≈ Ashbound Herald, Varkus ≈ Cinder Matriarch. MonsterScaling (tier and the early-tier easing),
// wave growth, elite mods and party size multiply them at spawn; every hit here is a multiple of the
// monster's scaled damage (monsterDamage), so the easing applies to all of it.
//
// monsterAttack cues (the presenter's poses and sounds; src/audio/index.ts maps them). Telegraph starts without a
// cue of their own (the thrall's whirling hook, the Chainmaster's aim line, Varkus's lane) are drawn from their
// areas / poses; the cues mark the releases:
//   pitHound         'melee' (the bite; from meleeHit)
//   chainThrall      'hook' (release; the windup pose is the whirling hook), 'melee' (rake)
//   ironCrossbowman  'aim' (the aim line appears) → 'bolt' (release)
//   shieldbearer     'bash' (the strike), 'melee' (a bash that reaches); a 'blocked' event per stopped projectile
//   tarSlinger       'tar' (release; tarSplat is the tarGlob's 'projectileEnd')
//   chainmaster      'hook' (release; the aim line shows during the cast), 'whirl' (the ring appears; the blades
//                    are a whirlwind variant 1 following him for 2.2 s), 'summon', 'melee'
//   varkus           'slam' (cleave strike, at the telegraph's centre), 'charge' (the launch; he dashes ≤ 0.7 s),
//                    'mark' (the cast start — he raises the blade; the executionMark area appears markCast = 0.4 s
//                    later), 'leap' (airborne VARKUS.leapFlight = 0.5 s, MONSTER_ANIM.leap), 'whirl' (the ring;
//                    blades follow for 3 s), 'spikes' (Crowd's Favour, cast start), 'summon'
import type { MonsterDef } from '../types';
import { chainmasterBrain, onChainmasterSpawn } from './chainmaster';
import {
  brainChainThrall, brainCrossbowman, brainPitHound, brainShieldbearer, registerFamilyEffects, tarSlingerBrain,
} from './family';
import { SHIELD } from './tuning';
import { VARKUS_SCRIPT, registerVarkusEffects, varkusBrain } from './varkus';

/**
 * One MonsterDef per COLISEUM_MONSTERS kind. Called once, when the sim's roster table is first built (after
 * every sim module has loaded): the kit's brain factories and the effect registrations need the core ready.
 */
export function coliseumRoster(): MonsterDef[] {
  registerFamilyEffects();
  registerVarkusEffects();
  return [
    {
      kind: 'pitHound', name: 'Pit Hound', role: 'fast',
      // The bulk of every wave: it lopes a little slower than a player (it can be kited) and pounces. The bulk, not
      // the whole arena: at weight 10 (plus every capped pack's overflow) hounds were two thirds of the ~130 monsters
      // alive when Varkus arrived; at 7 they are under half, and the rest of the family reads in the late waves.
      radius: 6, life: 18, speed: 64, damage: 4, xp: 3, damageType: 'physical', resist: [0, 0, 0, 0, 0], knockback: 1,
      fromWave: 1, weight: 7, weightGrowth: -0.06,
      brain: brainPitHound,
    },
    {
      kind: 'chainThrall', name: 'Chain Thrall', role: 'hunter',
      radius: 7, life: 36, speed: 52, damage: 9, xp: 7, damageType: 'physical', resist: [0.1, 0, 0, 0, 0], knockback: 0.9,
      // From wave 2: the first wave is the hounds' alone, roots arrive once a player has their bearings.
      fromWave: 2, weight: 3, weightGrowth: 0.1, streamWeight: 0.6, maxPerPack: 4,
      brain: brainChainThrall,
    },
    {
      kind: 'ironCrossbowman', name: 'Iron Crossbowman', role: 'artillery',
      radius: 7, life: 20, speed: 40, damage: 6, xp: 5, damageType: 'physical', resist: [0.1, 0, 0, 0, 0], knockback: 1,
      fromWave: 2, weight: 2.4, weightGrowth: 0.04, maxPerPack: 2,
      brain: brainCrossbowman,
    },
    {
      kind: 'shieldbearer', name: 'Shieldbearer', role: 'bruiser',
      // Its tower shield is its armour: from the front it takes no projectile at all, from the side or behind
      // it takes everything (no hitReduction).
      radius: 11, life: 100, speed: 32, damage: 18, xp: 14, damageType: 'physical', resist: [0.2, 0, 0, 0, 0], knockback: 0.2,
      fromWave: 4, weight: 1.2, weightGrowth: 0.1, streamWeight: 0.3, maxPerPack: 1,
      heavy: true,
      block: { arc: SHIELD.arc, turnRate: SHIELD.turnRate },
      brain: brainShieldbearer,
    },
    {
      kind: 'tarSlinger', name: 'Tar Slinger', role: 'support',
      radius: 8, life: 24, speed: 38, damage: 7, xp: 6, damageType: 'physical', resist: [0, -0.2, 0, 0, 0], knockback: 1,
      fromWave: 3, weight: 2.2, weightGrowth: 0.1, streamWeight: 0.5, maxPerPack: 2,
      brain: tarSlingerBrain(),
    },
    {
      kind: 'chainmaster', name: 'The Chainmaster', role: 'boss',
      radius: 14, life: 3600, speed: 40, damage: 24, xp: 1000, damageType: 'physical', resist: [0.2, 0.15, 0.15, 0.15, 0.15], knockback: 0,
      fromWave: 0, weight: 0, weightGrowth: 0,
      heavy: true,
      brain: chainmasterBrain(),
      onSpawn: onChainmasterSpawn,
    },
    {
      kind: 'varkus', name: 'Varkus, the Iron Champion', role: 'boss',
      radius: 20, life: 4800, speed: 46, damage: 26, xp: 1000, damageType: 'physical', resist: [0.25, 0.15, 0.15, 0.15, 0.15], knockback: 0,
      fromWave: 0, weight: 0, weightGrowth: 0,
      heavy: true,
      boss: VARKUS_SCRIPT,
      brain: varkusBrain(),
    },
  ];
}
