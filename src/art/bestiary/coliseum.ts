// Iron Coliseum bestiary (GAME_SPEC §14): the arena family, its lieutenant and its boss.
//
//   coliseumSprites(): SpriteDef[] — every NEW_REQUIRED_SPRITES id for COLISEUM_MONSTERS (idle / move / windup /
//   attack / corpse) plus the extra action sets: chainThrall/throw, shieldbearer/block, chainmaster/whirl,
//   varkus/charge and varkus/whirl. 40 sprites, deterministic, Node-safe (raw RGBA, no DOM).
//
// Same conventions as src/art/monsters: sprites face east (west is mirrored about anchorX at render time), anchor =
// bottom-centre of the feet (the idle/move ground contact is centred on anchorX so the mirrored view doesn't jump),
// every animation of a monster shares one frame size and anchor.
//   • Loop: idle, move, chainmaster/whirl, varkus/whirl, varkus/charge, and chainThrall/windup (the hook whirling
//     overhead is a continuous telegraph that runs for as long as the windup lasts).
//   • Hold the last frame: every other windup, attack, chainThrall/throw, shieldbearer/block, corpse.
//   • Frame sizes (w×h, anchor): pitHound 34×19 (14,17) · chainThrall 30×25 (11,24) · ironCrossbowman 30×24 (12,23) ·
//     shieldbearer 38×34 (16,32) · tarSlinger 26×25 (11,24) · chainmaster 66×50 (32,47) · varkus 96×82 (40,79).
//     Standing frames put their lowest row on anchorY (nothing floats or sinks), and nothing is clipped by a frame
//     border (≤ 2 px on any edge row / column).
//   • Emissive: ember eyes / visor slits on all seven; the thrall's chest brand (every frame); the crossbowman's aim
//     glint at the bolt head (windup, the origin of the chargeLine telegraph); the Chainmaster's red-hot hook heads
//     and chest brand (~20 px); Varkus' forge-hot shield boss and ember rivets and a greatsword edge that never cools
//     (~35 px at rest), heating to white through windup / cleave, with burning whirl and cleave arcs.
//   • Throw / lash frames show only the first links leaving the fist plus a short pay-out blur: the chainHook
//     projectile and fx/chain draw the real line in its true direction (monsters only mirror east / west).
//   • Corpses end ash-grey (monsters/common ashify + squash), like the Ashen Forge roster.
import type { SpriteDef } from '../../contracts/art';
import { chainmasterSprites } from './coliseumChainmaster';
import { chainThrallSprites } from './coliseumChainThrall';
import { ironCrossbowmanSprites } from './coliseumCrossbowman';
import { pitHoundSprites } from './coliseumPitHound';
import { shieldbearerSprites } from './coliseumShieldbearer';
import { tarSlingerSprites } from './coliseumTarSlinger';
import { varkusSprites } from './coliseumVarkus';

export function coliseumSprites(): SpriteDef[] {
  return [
    ...pitHoundSprites(),
    ...chainThrallSprites(),
    ...ironCrossbowmanSprites(),
    ...shieldbearerSprites(),
    ...tarSlingerSprites(),
    ...chainmasterSprites(),
    ...varkusSprites(),
  ];
}
