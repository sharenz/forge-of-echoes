// Bestiary FX (wave 5, GAME_SPEC §13–§14): projectiles, player debuff overlays and area visuals for the Rimed
// Ossuary and Iron Coliseum rosters. `bestiaryFxSprites()` returns every 'proj/<NEW_PROJECTILE_KINDS>' sprite, every
// 'fx/debuff/<PLAYER_DEBUFFS>' overlay and the nine area visuals listed in NEW_REQUIRED_SPRITES, plus one extra id,
// 'fx/icePrisonShard' (a single prison shard the presenter places round the closing ring).
//
// Conventions (details in each module's header):
//   • Projectiles (fxProjectiles.ts): centre anchored, pointing east, colour-baked with emissive glints, looped.
//   • Debuff overlays (fxDebuffs.ts): 32x36, FEET anchored at (16,33) — draw at the player's position with her
//     flipX, just in front of her (normal blending; the emissive mask supplies the glow). Pick frames with
//     `debuffOverlayFrame()`: rooted holds one 4-frame loop per source (bone/web/chain/tar), bleeding and withered one
//     6-frame loop per stack count. `DEBUFF_PLAYER_TINT` is the multiply tint for her own sprite while chilled/frozen.
//   • Areas (fxAreas.ts): ground decals are round (like the sim's circles) and list their native radius R for scaling;
//     fx/iceSpike and fx/arenaSpike are anchored at the ground point (they rise out of the floor like props) and play
//     once with a "hold this frame while telegraphing" first frame; fx/chain is one tileable CHAIN_PERIOD px period
//     drawn WITHOUT a per-sprite outline. The Ice Prison is ICE_PRISON_SHARDS 'fx/icePrisonShard' sprites placed on
//     the current radius at 1:1 (`icePrisonShardFrame()`), y-sorted with the player; 'fx/icePrison' is the same ring
//     baked at R 20 for a static telegraph.
//   • Colour rule, as in src/art/fx.ts: everything here is colour-baked except fx/shieldArc (pale bone-gold, reads
//     untinted and takes a tint).
import type { SpriteDef } from '../../contracts/art';
import { bestiaryAreaSprites } from './fxAreas';
import { debuffOverlaySprites } from './fxDebuffs';
import { bestiaryProjectileSprites } from './fxProjectiles';

export {
  DEBUFF_ANCHOR_X,
  DEBUFF_ANCHOR_Y,
  DEBUFF_H,
  DEBUFF_LOOP,
  DEBUFF_PLAYER_TINT,
  DEBUFF_STACK_LOOPS,
  DEBUFF_W,
  ROOTED_VARIANTS,
  debuffOverlayFrame,
  type RootSource,
} from './fxDebuffs';
export { BLIZZARD_WIND, CHAIN_PERIOD, ICE_PRISON_SHARDS, icePrisonShardFrame } from './fxAreas';

/** Native radius (world units at scale 1) of the round area decals, for `scale = area.radius / R`. */
export const BESTIARY_FX_RADIUS = {
  'fx/icePrison': 20,
  'fx/blizzard': 30,
  'fx/tarPool': 18,
  'fx/web': 18,
  'fx/executionMark': 22,
  'fx/shieldArc': 13,
} as const;

export function bestiaryFxSprites(): SpriteDef[] {
  return [...bestiaryProjectileSprites(), ...debuffOverlaySprites(), ...bestiaryAreaSprites()];
}
