// FROZEN CONTRACT — procedural pixel art. src/art/index.ts must `export function generateArt(): ArtBundle`.
//
// All art is generated in code (no image files), palette-constrained, at native pixel resolution.
// Generation must work in Node (vitest) — produce raw RGBA buffers, not canvases. Only `icon()`/`portrait()`
// (DOM data URLs) may touch `document`, lazily.
import { NEW_REQUIRED_SPRITES } from './bestiary';
import { THEMES } from './content';

/** Raw RGBA image (straight alpha), row-major, width*height*4 bytes. */
export interface PixelImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface SpriteDef {
  /** e.g. "sorceress/run/south", "monster/ashling/move", "tile/ashenForge/floor". */
  id: string;
  /** Frame width/height in pixels (all frames of a sprite share a size). */
  width: number;
  height: number;
  frames: PixelImage[];
  /** Optional per-frame emissive mask (same size; RGB = glow colour, A = strength). Emissive pixels ignore lighting and feed bloom. */
  emissive?: PixelImage[];
  /** Pivot in pixels from the frame's top-left. Characters/props: bottom-centre of the feet/base. FX/projectiles: centre. */
  anchorX: number;
  anchorY: number;
  fps: number;
  loop: boolean;
}

export interface ArtBundle {
  sprites: SpriteDef[];
  /** DOM data URL (PNG) of a UI icon, pixel art upscaled with nearest-neighbour to `size` px (default 64). */
  icon(iconId: string, size?: number): string;
  /** DOM data URL of the sorceress portrait for the UI (character select / sheet). */
  portrait(size?: number): string;
  /** Named palette colours as CSS hex strings (shared with UI CSS where useful). */
  palette: Record<string, string>;
}

/**
 * Sprite ids the presenter relies on. Art must provide every one (a test checks this).
 * Directional sets use south / north / east; west is east mirrored at render time.
 * Monster sets face east; west is mirrored.
 */
export const DIRS = ['south', 'north', 'east'] as const;

export const SORCERESS_ANIMS = ['idle', 'run', 'cast', 'dash', 'hit'] as const;
export const MONSTER_ANIMS_SPRITES = ['idle', 'move', 'windup', 'attack'] as const;

export const REQUIRED_SPRITES: readonly string[] = [
  // player (+ 'sorceress/death/south')
  ...SORCERESS_ANIMS.flatMap((a) => DIRS.map((d) => `sorceress/${a}/${d}`)),
  'sorceress/death/south',
  // monsters: idle/move/windup/attack + corpse; bosses additionally 'leap' where relevant
  ...['ashling', 'emberSkitter', 'cinderSpitter', 'riftStalker', 'ironhideBrute', 'ashboundHerald', 'cinderMatriarch']
    .flatMap((m) => [...MONSTER_ANIMS_SPRITES.map((a) => `monster/${m}/${a}`), `monster/${m}/corpse`]),
  'monster/riftStalker/leap',
  'monster/trainingDummy/idle', 'monster/trainingDummy/attack',
  // projectiles (centre anchored, pointing east; rotated at render time)
  'proj/emberLance', 'proj/novaFlame', 'proj/flameWave', 'proj/rimeShard',
  'proj/cinderSpit', 'proj/heraldOrb', 'proj/matriarchOrb',
  // fx (centre anchored)
  'fx/spark', 'fx/ember', 'fx/smoke', 'fx/ash', 'fx/frost', 'fx/bolt', 'fx/ring', 'fx/sigil', 'fx/slash',
  'fx/glow', 'fx/shadow', 'fx/ward', 'fx/beam', 'fx/mote', 'fx/impact', 'fx/levelUp', 'fx/scorch', 'fx/blood',
  // world tiles (16x16, several variant frames each) per theme
  ...THEMES.flatMap((t) => [
    `tile/${t}/floor`, `tile/${t}/detail`, `tile/${t}/edge`,
  ]),
  // props (bottom-centre anchored)
  'prop/mapDevice', 'prop/stash', 'prop/merchant', 'prop/portal', 'prop/returnPortal', 'prop/chest',
  'prop/pillar', 'prop/brazier', 'prop/standingStone', 'prop/rubble', 'prop/bones', 'prop/crystal',
  'prop/banner', 'prop/anvil', 'prop/ruinWall',
  // ground drops (bottom-centre anchored, untinted; rarity is a runtime treatment)
  'drop/equipment', 'drop/currency', 'drop/map', 'drop/flask',
  // Ossuary / Coliseum rosters, new projectiles, debuff overlays and area visuals (contracts/bestiary.ts)
  ...NEW_REQUIRED_SPRITES,
];
