// FROZEN CONTRACT — WebGL2 renderer. src/render/index.ts must `export function createRenderer(canvas: HTMLCanvasElement): Renderer`.
//
// Look: crisp low-resolution pixel art (virtual resolution ~360 px tall, integer upscaled), rendered into a
// dark world lit by dynamic coloured point lights, with an emissive + bloom pass, vignette and colour grading.
// World units == virtual pixels at zoom 1.
import type { SpriteDef } from './art';

export type RGB = readonly [number, number, number]; // 0..1 each

/**
 * Draw layers, back to front:
 *  ground – floor tiles (lit, not sorted)
 *  decal  – scorch marks, corpses, telegraph fills (lit, not sorted)
 *  shadow – blob shadows (darkening, not sorted)
 *  world  – characters, monsters, props, drops (lit, y-sorted by sortY)
 *  fx     – projectiles, particles, glows (emissive/additive, bloom source, y-sorted)
 *  top    – world-anchored overlays not affected by light or bloom (drop labels, damage numbers, health bars)
 */
export type Layer = 'ground' | 'decal' | 'shadow' | 'world' | 'fx' | 'top';

export interface Camera {
  x: number;          // world coordinate at view centre
  y: number;
  zoom: number;       // 1 = one world unit per virtual pixel
  shakeX?: number;    // world-unit offset applied this frame
  shakeY?: number;
}

export interface SpriteOptions {
  layer?: Layer;          // default 'world'
  sortY?: number;         // default y
  flipX?: boolean;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;      // radians, around the anchor
  alpha?: number;
  tint?: RGB;             // multiply
  /** 0..1 mix towards flashColor (default white) — hit flashes. */
  flash?: number;
  flashColor?: RGB;
  additive?: boolean;
  /** 0..1: fraction of the sprite that ignores lighting and feeds bloom (independent of the sprite's emissive mask). */
  emissive?: number;
  /** Draw a 1px outline in this colour (rarity outlines, hover highlight). */
  outline?: RGB;
}

export interface ShapeOptions {
  color: RGB;
  alpha?: number;
  layer?: Layer;          // default 'decal'
  additive?: boolean;
  emissive?: number;
  /** Ring/line thickness in world units (default 1). */
  thickness?: number;
  /** For circle/ring: fraction 0..1 of the arc to draw (telegraph fill progress). Default 1. */
  arc?: number;
}

export interface LightOptions {
  color: RGB;
  intensity?: number;     // default 1
  /** Soft flicker amount 0..1 (fires, braziers). */
  flicker?: number;
}

export interface TextOptions {
  color?: RGB;
  alpha?: number;
  /** Integer pixel scale of the built-in bitmap font (5x7 glyphs at scale 1). */
  scale?: number;
  align?: 'left' | 'center' | 'right';
  outline?: RGB | null;   // default near-black outline
  layer?: Layer;          // default 'top'
  /** Optional background plate (drop labels). */
  box?: { color: RGB; alpha: number; border?: RGB; padding?: number };
}

export interface ParticleBurst {
  x: number;
  y: number;
  /** Height above ground (world units) — rendered as a y-offset. */
  z?: number;
  count: number;
  sprite?: string;        // default 'fx/spark'
  color: RGB;
  colorEnd?: RGB;
  speed: [number, number];
  angle?: number;         // centre direction (radians), default random
  spread?: number;        // radians, default 2π
  life: [number, number]; // seconds
  size: [number, number]; // sprite scale
  sizeEnd?: number;       // multiplier at end of life (default 0.3)
  gravity?: number;       // world units / s² (positive = falls down the screen)
  drag?: number;          // 0..1 per second velocity damping
  upward?: [number, number]; // initial vertical (z) velocity for "fountain" bursts
  additive?: boolean;     // default true
  emissive?: number;      // default 1
  layer?: Layer;          // default 'fx'
  /** Attach a small light of this radius to each particle (use sparingly; big bursts only). */
  light?: number;
}

export interface PostFx {
  bloom?: number;         // 0..2, default 1
  vignette?: number;      // 0..1, default 0.5
  /** Full-screen colour flash (level up, unique drop, damage). */
  flash?: { color: RGB; alpha: number };
  saturation?: number;    // default 1 (0 = greyscale on death)
  chromatic?: number;     // 0..1 chromatic aberration (big hits)
  exposure?: number;      // default 1
}

export interface FrameSetup {
  camera: Camera;
  /** Ambient light colour/strength. Dark scenes use something like [0.16, 0.13, 0.16]. */
  ambient: RGB;
  time: number;           // seconds, for shader animation (flicker, heat shimmer)
  clearColor?: RGB;
}

export interface RenderStats {
  drawCalls: number;
  sprites: number;
  particles: number;
  lights: number;
}

export interface Renderer {
  readonly canvas: HTMLCanvasElement;
  /** Current virtual (pixel-art) resolution of the view. */
  readonly viewWidth: number;
  readonly viewHeight: number;
  /** Integer upscale factor from virtual pixels to device pixels. */
  readonly pixelScale: number;

  /** Call on window resize. Picks the virtual resolution (~360 px tall) and integer pixel scale. */
  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void;

  /** Pack sprites (and emissive masks) into texture atlases. May be called more than once. */
  registerSprites(defs: SpriteDef[]): void;
  hasSprite(id: string): boolean;
  spriteInfo(id: string): { frames: number; width: number; height: number; fps: number; loop: boolean; anchorX: number; anchorY: number } | null;

  screenToWorld(cssX: number, cssY: number, camera: Camera): { x: number; y: number };
  worldToScreen(x: number, y: number, camera: Camera): { x: number; y: number };

  beginFrame(setup: FrameSetup): void;
  sprite(id: string, frame: number, x: number, y: number, opts?: SpriteOptions): void;
  circle(x: number, y: number, radius: number, opts: ShapeOptions): void;
  ring(x: number, y: number, radius: number, opts: ShapeOptions): void;
  line(x1: number, y1: number, x2: number, y2: number, opts: ShapeOptions): void;
  rect(x: number, y: number, w: number, h: number, opts: ShapeOptions): void;
  light(x: number, y: number, radius: number, opts: LightOptions): void;
  text(str: string, x: number, y: number, opts?: TextOptions): void;
  measureText(str: string, scale?: number): number;
  emit(burst: ParticleBurst): void;
  /** Advance particle simulation (call once per rendered frame). */
  updateParticles(dt: number): void;
  clearParticles(): void;
  endFrame(post?: PostFx): void;

  stats(): RenderStats;
  dispose(): void;
}

export type CreateRenderer = (canvas: HTMLCanvasElement) => Renderer;
