// Branch colour identity of the Codex (brief A, 8.2): Cartography bone + mana blue, Foundry ember, Bounty rust + olive,
// Fortune gold, Echoes void glow, Peril blood + hot white. Bridges wear two of them, the inner ring is brass, and the
// six theme seals take their theme's light. Every colour is the shared palette, only re-ordered into ramps here.
import type { MapBaseId } from '../../contracts/content';
import type { Frame } from '../frame';
import { C, RAMPS, hexToColor, type Color, type Ramp } from '../palette';
import { emblem } from '../atlas/emblems';

export const BRANCH_TONES = ['cartography', 'foundry', 'bounty', 'fortune', 'echoes', 'peril'] as const;
export type BranchTone = (typeof BRANCH_TONES)[number];
export type Tone = BranchTone | 'hub' | 'origin' | MapBaseId;

export interface ToneDef {
  label: string;
  /** Dark to light; the plate face takes the lower half, the lit rim the upper half. */
  face: Ramp;
  /** Glyph colours when the node is lit. */
  glyph: { body: Color; hi: Color; lo: Color };
  /** Wire and glow colour of an allocated node. */
  light: Color;
  css: string;
}

const hx = (...s: string[]): Ramp => s.map((h) => hexToColor(h));
const glyph = (body: string, hi: string, lo: string) => ({ body: hexToColor(body), hi: hexToColor(hi), lo: hexToColor(lo) });

export const TONES: Record<Tone, ToneDef> = {
  cartography: { label: 'Cartography', face: hx('#0f1a33', '#1f3766', '#33569e', '#4a7bd6', '#8fb4ee', '#dbe8ff'), glyph: glyph('#e8dcc0', '#fbf4e6', '#16264a'), light: hexToColor('#7fb0ff'), css: '#7fb0ff' },
  foundry: { label: 'Foundry', face: [...RAMPS.ember.slice(0, 5), C.hot], glyph: glyph('#ffe7a8', '#fff8e0', '#4a1410'), light: hexToColor('#ff9a3c'), css: '#ff9a3c' },
  bounty: { label: 'Bounty', face: hx('#1d0d0f', '#3d1a15', '#6a3220', '#8f4c26', '#b8862f', '#dcc277'), glyph: glyph('#b9c07a', '#e6ebb0', '#2a1a10'), light: hexToColor('#b8c25e'), css: '#b8c25e' },
  fortune: { label: 'Fortune', face: hx('#26190c', '#4d3512', '#7c5718', '#b8862f', '#e0b04a', '#f7dc8c'), glyph: glyph('#fff0b8', '#ffffff', '#5a3a10'), light: hexToColor('#ffd35c'), css: '#ffd35c' },
  echoes: { label: 'Echoes', face: RAMPS.void, glyph: glyph('#e6cbff', '#ffffff', '#2b1245'), light: hexToColor('#c07bff'), css: '#c07bff' },
  peril: { label: 'Peril', face: [...RAMPS.life.slice(0, 5), C.hot], glyph: glyph('#ffe0d0', '#ffffff', '#3d0d14'), light: hexToColor('#ff5a4a'), css: '#ff5a4a' },
  hub: { label: 'Tier ring', face: hx('#1e160d', '#3d2c18', '#66492a', '#8a6a3e', '#c9a064', '#f0d9a0'), glyph: glyph('#fff0c0', '#ffffff', '#3d2c18'), light: hexToColor('#e8c070'), css: '#e8c070' },
  origin: { label: 'Cinder Crossing', face: RAMPS.ember, glyph: glyph('#fff0c0', '#ffffff', '#7a1e22'), light: hexToColor('#ffb04a'), css: '#ffb04a' },
  ashenForge: { label: 'Ashen Forge', face: [...RAMPS.ember.slice(0, 5), C.hot], glyph: glyph('#ffe7a8', '#fff8e0', '#4a1410'), light: hexToColor('#ff8a3a'), css: '#ff8a3a' },
  cinderChapel: { label: 'Cinder Chapel', face: hx('#2a1c0c', '#4d3512', '#7c5718', '#b8862f', '#e0b04a', '#f7dc8c'), glyph: glyph('#fff0b8', '#ffffff', '#5a3a10'), light: hexToColor('#e0b04a'), css: '#e0b04a' },
  rimedOssuary: { label: 'Rimed Ossuary', face: [...RAMPS.frost.slice(0, 5), C.ice], glyph: glyph('#d4f1ff', '#ffffff', '#16264a'), light: hexToColor('#7fc6e8'), css: '#7fc6e8' },
  choralCrypt: { label: 'Choral Crypt', face: RAMPS.void, glyph: glyph('#e6cbff', '#ffffff', '#2b1245'), light: hexToColor('#c07bff'), css: '#c07bff' },
  ironColiseum: { label: 'Iron Coliseum', face: hx('#1c1210', '#3a2418', '#6a3f24', '#94582e', '#c2683a', '#e8a070'), glyph: glyph('#ffd8b0', '#ffffff', '#3a1c10'), light: hexToColor('#d8794a'), css: '#d8794a' },
  chainworks: { label: 'Chainworks', face: [...RAMPS.metal.slice(0, 5), hexToColor('#cfc8d4')], glyph: glyph('#e6e0ea', '#ffffff', '#1e1a22'), light: hexToColor('#b8b0c0'), css: '#b8b0c0' },
};

/**
 * A tree's colour identity: its tones by id, plus the emblem its `seal` plates wear. The plates, threads and renderer
 * take a palette, so the Atlas Codex and any other tree (the Orrery, a test graph) share every drawing function and only
 * swap colours. `id` namespaces the plate cache, so two palettes never share a cached plate.
 */
export interface TonePalette<T extends string = string> {
  id: string;
  tones: Readonly<Record<T, ToneDef>>;
  /** The emblem a `seal` plate wears for its tone; without one a seal wears its glyph. */
  emblem?(tone: T): Frame;
}

/** The Atlas Codex palette: branch, hub and origin tones; theme seals wear their map base's emblem. */
export const CODEX_PALETTE: TonePalette<Tone> = { id: 'codex', tones: TONES, emblem: (tone: Tone) => emblem(tone as MapBaseId) };

/** Frame side (odd, so a glyph centres on a pixel) and visible radius of each plate class, in Codex art px. */
export const PLATE_CLASSES = ['small', 'notable', 'lens', 'tier', 'seal', 'keystone'] as const;
export type PlateClass = (typeof PLATE_CLASSES)[number];
export const PLATE_SIZE: Record<PlateClass, number> = { small: 23, notable: 29, lens: 29, tier: 29, seal: 33, keystone: 37 };
export const PLATE_R: Record<PlateClass, number> = { small: 9.5, notable: 11.5, lens: 11.5, tier: 11.5, seal: 13, keystone: 13.5 };
