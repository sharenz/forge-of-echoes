// Procedural pixel art for Forge of Echoes.
//
//   generateArt(): ArtBundle — every sprite in REQUIRED_SPRITES (plus the Rift Stalker leap and dummy sets) and in
//   the wave-5 NEW_REQUIRED_SPRITES (src/contracts/bestiary.ts: the Rimed Ossuary and Iron Coliseum rosters, their
//   projectiles, player debuff overlays and area visuals — see src/art/bestiary/index.ts), generated from code as raw
//   RGBA frames with emissive masks. Runs in Node and the browser.
//
// Conventions other modules rely on (see also the header comments of props.ts and tiles.ts):
//   • Sorceress: 32x32 frames, anchor (16,30) for every animation; cast release frame = CAST_RELEASE_FRAME (3).
//   • Monsters face east; anchor is bottom-centre of the feet. corpse / windup / attack / leap don't loop
//     (hold the last frame). trainingDummy/attack is the wobble when struck. The wave-5 kinds follow the same rules;
//     their extra action sets (burst, throw, block, charge, whirl, cast, sing) and loop flags are tabled in
//     src/art/bestiary/ossuary.ts and coliseum.ts.
//   • Debuff overlays 'fx/debuff/<id>' are 32x36, feet-anchored at (16,33); pick frames with `debuffOverlayFrame()`
//     (re-exported below with the other bestiary FX helpers).
//   • Tiles: 16x16, anchor (0,0), fps 0; frames are interchangeable variants (pick by hashing the cell).
//   • Props: fps 0 ⇒ frame = state (mapDevice, chest) or variant (pillar, standingStone, rubble, bones, crystal,
//     ruinWall); fps > 0 ⇒ animated loop.
//   • FX: centre-anchored. spark, glow, ring, smoke, ash, frost, beam and shadow are near-white/neutral and meant
//     to be tinted; the rest are colour-baked with white-hot cores.
//   • fx/scorch and fx/blood frames are decal variants (fps 0).
//   • Icons: `icon(id, size)` treats `size` as the pixel size of ONE inventory grid cell (default 64). Icons are
//     drawn at 32 px per cell and equipment icons take their item's footprint, so a wand (1x3) comes back 64x192 at
//     the default size and a helmet (2x2) 128x128; currencies, flasks, maps, skills and UI icons are square. Render
//     them into a box of item.size.w x item.size.h cells (or use `object-fit: contain` in a square slot) with
//     `image-rendering: pixelated`. `iconFootprint(id)` gives the [w, h] in cells. Debuff HUD icons
//     ('icon/debuff/<id>') are square 32 px plates like the skill icons.
import type { ArtBundle, PixelImage, SpriteDef } from '../contracts/art';
import { bestiarySprites } from './bestiary';
import { toDataUrl } from './dom';
import { dropSprites } from './drops';
import { fxSprites } from './fx';
import { ICON_CELL, ICON_IDS, iconFootprint, iconPixels } from './icons';
import { ashboundHeraldSprites } from './monsters/ashboundHerald';
import { ashlingSprites } from './monsters/ashling';
import { cinderMatriarchSprites } from './monsters/cinderMatriarch';
import { cinderSpitterSprites } from './monsters/cinderSpitter';
import { emberSkitterSprites } from './monsters/emberSkitter';
import { ironhideBruteSprites } from './monsters/ironhideBrute';
import { riftStalkerSprites } from './monsters/riftStalker';
import { trainingDummySprites } from './monsters/trainingDummy';
import { PALETTE } from './palette';
import { PORTRAIT_SIZE, drawPortrait } from './portrait';
import { projectileSprites } from './projectiles';
import { propSprites } from './props';
import { sorceressSprites } from './sorceress';
import { tileSprites } from './tiles';

export {
  BESTIARY_FX_RADIUS,
  BLIZZARD_WIND,
  CHAIN_PERIOD,
  DEBUFF_ANCHOR_X,
  DEBUFF_ANCHOR_Y,
  DEBUFF_PLAYER_TINT,
  ICE_PRISON_SHARDS,
  ROOTED_VARIANTS,
  debuffOverlayFrame,
  icePrisonShardFrame,
  type RootSource,
} from './bestiary';
export { CAST_RELEASE_FRAME } from './sorceress';
export { ICON_CELL, ICON_IDS, iconFootprint, iconPixels };

let portraitCache: PixelImage | null = null;

/** Raw RGBA pixels of the 64x64 portrait. */
export function portraitPixels(): PixelImage {
  portraitCache ??= drawPortrait();
  return portraitCache;
}

/** Generate the complete sprite set. Deterministic: the same code always yields identical pixels. */
export function generateSprites(): SpriteDef[] {
  return [
    ...sorceressSprites(),
    ...ashlingSprites(),
    ...emberSkitterSprites(),
    ...cinderSpitterSprites(),
    ...riftStalkerSprites(),
    ...ironhideBruteSprites(),
    ...ashboundHeraldSprites(),
    ...cinderMatriarchSprites(),
    ...trainingDummySprites(),
    ...bestiarySprites(),
    ...projectileSprites(),
    ...fxSprites(),
    ...tileSprites(),
    ...propSprites(),
    ...dropSprites(),
  ];
}

export function generateArt(): ArtBundle {
  const sprites = generateSprites();
  const iconUrls = new Map<string, string>();
  let portraitUrl: { size: number; url: string } | null = null;
  return {
    sprites,
    icon(iconId: string, size = 64): string {
      const key = `${iconId}@${size}`;
      const hit = iconUrls.get(key);
      if (hit !== undefined) return hit;
      const img = iconPixels(iconId);
      const url = img ? toDataUrl(img, size, ICON_CELL) : '';
      iconUrls.set(key, url);
      return url;
    },
    portrait(size = PORTRAIT_SIZE * 2): string {
      if (portraitUrl && portraitUrl.size === size) return portraitUrl.url;
      portraitUrl = { size, url: toDataUrl(portraitPixels(), size) };
      return portraitUrl.url;
    },
    palette: { ...PALETTE },
  };
}
