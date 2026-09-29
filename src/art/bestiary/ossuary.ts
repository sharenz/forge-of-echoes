// Rimed Ossuary bestiary (GAME_SPEC §14): the cold, bone roster that replaces the Ashen Forge family in ossuary
// maps.
//
//   ossuarySprites(): SpriteDef[] — every `monster/<kind>/{idle,move,windup,attack,corpse}` for OSSUARY_MONSTERS
//   plus 'monster/glacialWisp/burst', 'monster/hollowWarden/cast' and 'monster/boneChorister/sing' (38 sprites).
//   Spread it into generateSprites() in src/art/index.ts.
//
// Conventions (same as src/art/monsters/*): monsters face east (west is mirrored about the anchor at render time),
// the anchor is the bottom-centre of the feet — for the floating Rimeshade, Glacial Wisp and Hollow Warden it is the
// ground point under them — and every sprite of one kind shares frame size and anchor. corpse / windup / attack /
// burst / cast don't loop (hold the last frame); idle / move / sing loop. Corpses rime over (the cold twin of the
// forge's ash); bone thralls leave a bone pile, the Rimeshade leaves a faint rime stain.
//
//   kind           frame  anchor   idle     move      windup  attack   extra                corpse
//   boneThrall     18x17  (9,16)   4f@6     6f@12     3f@8    3f@14    -                    3f@8
//   rimeshade      24x22  (12,21)  6f@6     6f@10     3f@7    3f@12    -                    4f@6  (alpha-baked)
//   frostWeaver    40x28  (20,27)  4f@5     6f@12     3f@6    3f@12    -                    3f@8
//   glacialWisp    24x26  (12,25)  6f@8     6f@14     4f@6    3f@12    burst 6f@14          3f@8
//   ossuaryGolem   48x48  (20,46)  4f@4     6f@7      4f@5    3f@10    -                    3f@6
//   boneChorister  46x56  (20,54)  4f@5     6f@8      4f@6    3f@10    sing 6f@8 loop       3f@6
//   hollowWarden   68x86  (27,83)  6f@5     6f@7      4f@5    3f@9     cast 5f@7            4f@5
//
// Timing notes for the presenter: glacialWisp/windup is the 0.7 s pulse (4f@6 ≈ 0.67 s, then holds a cracked,
// swollen shard); glacialWisp/burst is the detonation (crack → white flash → fragments; its last frame is a few
// faint motes, so the sprite can simply be dropped when it ends). frostWeaver/attack's first frame is the web shot's
// release (the strand leaves the raised spinnerets). hollowWarden/windup is the nova telegraph; cast is shared by
// Ice Prison, Glacial Spikes and summons (hold its last frame while channelling). boneChorister/windup + attack is
// the Choir Wave (the toll ring at its feet has the wave's gap); sing is the thrall-raising chant. The Rimeshade's
// shroud is alpha-baked; the floating Wisp and Warden carry a faint pool of their own light on the floor row, so their
// lowest pixels sit on the anchor row like every other monster's.
import type { SpriteDef } from '../../contracts/art';
import { boneChoristerSprites } from './ossuaryChorister';
import { ossuaryGolemSprites } from './ossuaryGolem';
import { rimeshadeSprites } from './ossuaryShade';
import { boneThrallSprites } from './ossuaryThrall';
import { frostWeaverSprites } from './ossuaryWeaver';
import { hollowWardenSprites } from './ossuaryWarden';
import { glacialWispSprites } from './ossuaryWisp';

export function ossuarySprites(): SpriteDef[] {
  return [...boneThrallSprites(), ...rimeshadeSprites(), ...frostWeaverSprites(), ...glacialWispSprites(), ...ossuaryGolemSprites(), ...boneChoristerSprites(), ...hollowWardenSprites()];
}
