// Wave-5 bestiary art (GAME_SPEC §13–§14), one entry point for src/art/index.ts and the presenter.
//
//   bestiarySprites(): SpriteDef[] — every id in NEW_REQUIRED_SPRITES plus 'fx/icePrisonShard':
//     • ossuarySprites()     Rimed Ossuary family, lieutenant (Bone Chorister) and boss (Hollow Warden) — 38 sprites
//     • coliseumSprites()    Iron Coliseum family, lieutenant (Chainmaster) and boss (Varkus) — 40 sprites
//     • bestiaryFxSprites()  new projectiles, player debuff overlays and area visuals
//   BESTIARY_ICONS / debuffIconPixels — the 'icon/debuff/<PLAYER_DEBUFFS>' HUD icons (merged into the icon registry,
//   so `ArtBundle.icon('icon/debuff/chilled')` works like every other icon).
//
// Monster conventions match src/art/monsters: face east, bottom-centre foot anchor (floating kinds: the ground point
// under them), one frame size + anchor per kind, idle/move (and the listed whirl/sing/charge loops) loop, every other
// action holds its last frame. Frame sizes, anchors and fps per kind are tabled in ossuary.ts and coliseum.ts; debuff
// overlay frame selection (stacks, root sources), the chilled/frozen player tint and area radii are exported below.
import type { SpriteDef } from '../../contracts/art';
import { coliseumSprites } from './coliseum';
import { bestiaryFxSprites } from './fx';
import { ossuarySprites } from './ossuary';

export { coliseumSprites } from './coliseum';
export {
  BESTIARY_FX_RADIUS,
  BLIZZARD_WIND,
  CHAIN_PERIOD,
  DEBUFF_ANCHOR_X,
  DEBUFF_ANCHOR_Y,
  DEBUFF_H,
  DEBUFF_LOOP,
  DEBUFF_PLAYER_TINT,
  DEBUFF_STACK_LOOPS,
  DEBUFF_W,
  ICE_PRISON_SHARDS,
  ROOTED_VARIANTS,
  bestiaryFxSprites,
  debuffOverlayFrame,
  icePrisonShardFrame,
  type RootSource,
} from './fx';
export { BESTIARY_ICONS, bestiaryIconIds, debuffIconPixels } from './icons';
export { ossuarySprites } from './ossuary';

/** Every wave-5 sprite: both new rosters, their projectiles, the debuff overlays and the area visuals. */
export function bestiarySprites(): SpriteDef[] {
  return [...ossuarySprites(), ...coliseumSprites(), ...bestiaryFxSprites()];
}
