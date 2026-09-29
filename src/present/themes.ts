// Per-theme lighting mood: ambient light, backdrop, post-processing and the ambient particles/light pools that
// give each map its atmosphere. The world is dark: light comes from the player's wand, projectiles, braziers,
// lava, crystals and loot.
//
// Readability: monsters must read against every floor, even outside the light pools, and the scene must not be
// murky. The renderer lifts actors (world-layer sprites) by the ambient (src/render: "actor lift", 2.5× the frame
// ambient in total, plus a sky rim), while the floor receives the ambient once. So brightness is set with the
// ambient and exposure (which keep the actor : floor ratio) and each floor's own multiplier (`floor`, `detail`,
// which trade it away): the dark basalt of the Ashen Forge can take its full tile brightness, the pale sand of the
// Iron Coliseum is held down. tests/present/scene.test.ts pins both halves from the art's albedo: every monster at
// least 1.75× its floor outside the light, and the unlit floor between the light pools never near-black
// (≥ 10/255 before grading). The mood comes from the light pools, lava, braziers and a moderate vignette.
// Monsters also carry a dim, theme-contrasting 1 px rim (`monsterRim`, unlit): lighter than the floor in the dark,
// darker than it in a light pool, so the silhouette separates either way without looking like a rarity outline.
import type { Theme } from '../contracts/content';
import type { RGB } from '../contracts/render';
import { C } from './colors';

export interface ThemeLook {
  ambient: RGB;
  /** Unlit backdrop (the abyss beyond the arena). */
  clear: RGB;
  bloom: number;
  vignette: number;
  exposure: number;
  saturation: number;
  /** Large, dim coloured light pools scattered over the floor. */
  pools: readonly RGB[];
  poolIntensity: number;
  poolRadius: readonly [number, number];
  /** Light glowing up out of the abyss just beyond the rim. */
  abyssGlow: RGB;
  abyssGlowIntensity: number;
  /** Particles drifting up out of the abyss. */
  abyssSprite: string;
  abyssColor: RGB;
  abyssColorEnd: RGB;
  /** Airborne motes over the playfield (ash, snow, dust) per second per screen. */
  airRate: number;
  airSprite: string;
  /** Particle scale range for the airborne motes. */
  airSize: readonly [number, number];
  airColor: RGB;
  airColorEnd: RGB;
  airAdditive: boolean;
  /** Gravity for airborne motes (negative rises). */
  airGravity: number;
  /** Tint and strength of the player's personal light (bright floors need less). */
  playerLight: RGB;
  playerLightK: number;
  /** Floor mottling: brightness range of the low-frequency tint. */
  mottle: readonly [number, number];
  /** Brightness multiplier of the floor and rim tiles (lower = more contrast for the actors on it). */
  floor: number;
  /** Brightness multiplier of the (non-glowing) floor detail decals: cracks, bones, moss, runes. */
  detail: number;
  /** Dim 1 px rim around normal monsters (flat colour: not lit, no bloom). */
  monsterRim: RGB;
  /** Spawn sigil colour. */
  sigil: RGB;
}

/** Mean brightness multiplier the ground applies to a floor tile away from the rim (mottle midpoint × floor). */
export function meanFloorShade(look: ThemeLook): number {
  return ((look.mottle[0] + look.mottle[1]) / 2) * look.floor;
}

export const THEME_LOOKS: Record<Theme, ThemeLook> = {
  hideout: {
    ambient: [0.29, 0.24, 0.235],
    clear: [0.018, 0.012, 0.016],
    bloom: 1,
    vignette: 0.44,
    exposure: 1.1,
    saturation: 1,
    pools: [[0.55, 0.32, 0.16], [0.42, 0.2, 0.2]],
    poolIntensity: 0.22,
    poolRadius: [120, 170],
    abyssGlow: [0.5, 0.18, 0.08],
    abyssGlowIntensity: 0.35,
    abyssSprite: 'fx/ember',
    abyssColor: C.flame,
    abyssColorEnd: C.lavaDark,
    airRate: 0,
    airSprite: 'fx/ash',
    airSize: [0.6, 1],
    airColor: C.ash,
    airColorEnd: C.ash,
    airAdditive: false,
    airGravity: 4,
    playerLight: [1, 0.78, 0.6],
    playerLightK: 0.75,
    floor: 0.94,
    detail: 0.84,
    monsterRim: [0.3, 0.24, 0.21],
    mottle: [0.84, 1],
    sigil: C.ember,
  },
  ashenForge: {
    ambient: [0.45, 0.325, 0.295],
    clear: [0.02, 0.008, 0.008],
    bloom: 0.95,
    vignette: 0.38,
    exposure: 1.16,
    saturation: 1.02,
    pools: [[0.7, 0.2, 0.08], [0.55, 0.14, 0.1], [0.45, 0.22, 0.12]],
    poolIntensity: 0.36,
    poolRadius: [150, 230],
    abyssGlow: [0.75, 0.2, 0.06],
    abyssGlowIntensity: 0.8,
    abyssSprite: 'fx/ember',
    abyssColor: C.flame,
    abyssColorEnd: C.lavaDark,
    airRate: 7,
    airSprite: 'fx/ember',
    airSize: [0.6, 1],
    airColor: C.ember,
    airColorEnd: C.lavaDark,
    airAdditive: true,
    airGravity: -9,
    playerLight: [1, 0.72, 0.52],
    playerLightK: 1,
    floor: 1,
    detail: 0.86,
    monsterRim: [0.34, 0.22, 0.17],
    mottle: [0.84, 1],
    sigil: C.ember,
  },
  rimedOssuary: {
    ambient: [0.26, 0.29, 0.36],
    clear: [0.008, 0.012, 0.024],
    bloom: 1,
    vignette: 0.45,
    exposure: 1.1,
    saturation: 0.95,
    pools: [[0.22, 0.4, 0.7], [0.3, 0.3, 0.6], [0.18, 0.45, 0.55]],
    poolIntensity: 0.24,
    poolRadius: [130, 210],
    abyssGlow: [0.2, 0.35, 0.7],
    abyssGlowIntensity: 0.65,
    abyssSprite: 'fx/frost',
    abyssColor: C.ice,
    abyssColorEnd: C.mana,
    airRate: 26,
    airSprite: 'fx/spark',
    airSize: [0.5, 0.75],
    airColor: [0.85, 0.92, 1],
    airColorEnd: [0.5, 0.6, 0.8],
    airAdditive: true,
    airGravity: 7,
    playerLight: [0.95, 0.8, 0.7],
    playerLightK: 1,
    floor: 0.88,
    detail: 0.78,
    monsterRim: [0.24, 0.29, 0.37],
    mottle: [0.82, 1],
    sigil: C.frost,
  },
  ironColiseum: {
    ambient: [0.32, 0.26, 0.22],
    clear: [0.02, 0.014, 0.01],
    bloom: 0.95,
    vignette: 0.45,
    exposure: 1.1,
    saturation: 0.98,
    pools: [[0.65, 0.42, 0.2], [0.55, 0.3, 0.14]],
    poolIntensity: 0.16,
    poolRadius: [140, 200],
    abyssGlow: [0.5, 0.25, 0.1],
    abyssGlowIntensity: 0.3,
    abyssSprite: 'fx/ash',
    abyssColor: [0.6, 0.5, 0.4],
    abyssColorEnd: [0.25, 0.2, 0.16],
    airRate: 6,
    airSprite: 'fx/ash',
    airSize: [0.6, 1],
    airColor: [0.62, 0.52, 0.4],
    airColorEnd: [0.3, 0.25, 0.2],
    airAdditive: false,
    airGravity: 1,
    playerLight: [1, 0.8, 0.62],
    playerLightK: 0.6,
    floor: 0.78,
    detail: 0.78,
    monsterRim: [0.34, 0.27, 0.2],
    mottle: [0.8, 1],
    sigil: C.ember,
  },
};
