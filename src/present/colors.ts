// Presentation palette (GAME_SPEC §10) as linear-ish 0..1 RGB triples for the renderer, plus the few
// derived colours the presenter needs (danger rims, plates, damage-type number colours).
import type { DamageType } from '../contracts/content';
import type { RGB } from '../contracts/render';
import type { DropTone } from '../contracts/sim';

/** '#rrggbb' → [r, g, b] in 0..1. */
export function hexRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export const C = {
  // neutrals
  ink: hexRgb('#0d0b0e'),
  coal: hexRgb('#1a1619'),
  char: hexRgb('#2a2326'),
  iron: hexRgb('#3b3438'),
  stone: hexRgb('#5a5057'),
  stoneLight: hexRgb('#7d7278'),
  ashGrey: hexRgb('#a0948d'),
  bone: hexRgb('#cbbfa8'),
  parchment: hexRgb('#e8dcc0'),
  white: hexRgb('#fbf4e6'),
  // earth
  moss: hexRgb('#4b5a3a'),
  rust: hexRgb('#7a3b24'),
  blood: hexRgb('#7a1e22'),
  burgundy: hexRgb('#5a1a2a'),
  ochre: hexRgb('#b8862f'),
  gold: hexRgb('#e0b04a'),
  // emissive
  ember: hexRgb('#e8662a'),
  flame: hexRgb('#ff9a3c'),
  hot: hexRgb('#ffe7a8'),
  lavaDeep: hexRgb('#3d0f12'),
  lavaDark: hexRgb('#9a2a1a'),
  // elements
  frost: hexRgb('#7fc6e8'),
  ice: hexRgb('#d4f1ff'),
  mana: hexRgb('#4a7bd6'),
  storm: hexRgb('#b9a6ff'),
  lightning: hexRgb('#efe9ff'),
  void: hexRgb('#7b3fa0'),
  voidGlow: hexRgb('#c07bff'),
  voidHi: hexRgb('#e6cbff'),
  // rarity
  normal: hexRgb('#d8d2c4'),
  magic: hexRgb('#7aa2ff'),
  rare: hexRgb('#f2d15c'),
  unique: hexRgb('#e8772e'),
  currency: hexRgb('#c9b58a'),
  map: hexRgb('#d0d0dc'),
  life: hexRgb('#b0222c'),
  lifeLight: hexRgb('#e8504a'),
  // presentation-only
  danger: [1, 0.2, 0.12] as RGB,
  dangerHot: [1, 0.55, 0.25] as RGB,
  plate: [0.035, 0.028, 0.035] as RGB,
  smoke: [0.2, 0.18, 0.19] as RGB,
  smokeEnd: [0.06, 0.05, 0.06] as RGB,
  ash: [0.36, 0.33, 0.33] as RGB,
  echo: [0.42, 0.72, 1] as RGB,
  echoCore: [0.9, 0.97, 1] as RGB,
} as const;

/** Floating damage number colours by damage type (hits on monsters). */
export const DAMAGE_COLOR: Record<DamageType, RGB> = {
  physical: [0.93, 0.89, 0.8],
  fire: [1, 0.62, 0.26],
  cold: [0.62, 0.86, 1],
  lightning: [0.98, 0.94, 0.62],
  void: [0.8, 0.55, 1],
};

/** Crit numbers: the same hue pushed towards hot white. */
export const DAMAGE_CRIT_COLOR: Record<DamageType, RGB> = {
  physical: [1, 1, 0.92],
  fire: [1, 0.86, 0.42],
  cold: [0.86, 0.97, 1],
  lightning: [1, 1, 0.82],
  void: [0.93, 0.8, 1],
};

/** Impact spark colours (start → end) per damage type. */
export const IMPACT_COLOR: Record<DamageType, readonly [RGB, RGB]> = {
  physical: [[0.95, 0.9, 0.8], [0.45, 0.4, 0.38]],
  fire: [C.hot, C.ember],
  cold: [C.ice, C.mana],
  lightning: [C.lightning, C.storm],
  void: [C.voidHi, C.void],
};

/** Drop label / beam colour per tone. */
export const TONE_COLOR: Record<DropTone, RGB> = {
  normal: C.normal,
  magic: C.magic,
  rare: C.rare,
  unique: C.unique,
  currency: C.currency,
  map: C.map,
  flask: [0.92, 0.5, 0.48],
};
