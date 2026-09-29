// Test doubles for the presenter: a renderer that records draw calls (no WebGL) and an audio engine that records
// plays, plus small world builders.
import type { AudioEngine, PlayOptions, SfxId } from '../../src/contracts/audio';
import type { SpriteDef } from '../../src/contracts/art';
import type {
  Camera, FrameSetup, LightOptions, ParticleBurst, PostFx, RenderStats, Renderer, ShapeOptions, SpriteOptions, TextOptions,
} from '../../src/contracts/render';
import type { PlayerView, WorldView } from '../../src/contracts/sim';

export interface TextCall {
  text: string;
  x: number;
  y: number;
  scale: number;
  alpha: number;
  color: readonly number[] | undefined;
}

export interface LightCall {
  x: number;
  y: number;
  radius: number;
  intensity: number;
}

export interface ShapeCall {
  kind: 'circle' | 'ring' | 'line' | 'rect';
  x: number;
  y: number;
  x2: number;
  y2: number;
  radius: number;
  thickness: number;
  layer: string;
  color: readonly number[];
  alpha: number;
}

export interface SpriteCall {
  id: string;
  x: number;
  y: number;
  layer: string;
  outline: readonly number[] | undefined;
}

/** Records every draw call; the per-frame lists are cleared by beginFrame. Font: 6 px advance per glyph. */
export class RecordingRenderer implements Renderer {
  readonly canvas = {} as HTMLCanvasElement;
  readonly viewWidth = 640;
  readonly viewHeight = 360;
  readonly pixelScale = 2;
  sprites = 0;
  shapes = 0;
  lights = 0;
  texts = 0;
  particles = 0;
  frames = 0;
  missing = new Set<string>();
  lastPost: PostFx | undefined;
  frameTexts: TextCall[] = [];
  frameLights: LightCall[] = [];
  frameShapes: ShapeCall[] = [];
  frameSprites: SpriteCall[] = [];
  private readonly defs = new Map<string, SpriteDef>();
  resize(): void {}
  registerSprites(defs: SpriteDef[]): void {
    for (const d of defs) this.defs.set(d.id, d);
  }
  hasSprite(id: string): boolean {
    return this.defs.has(id);
  }
  spriteInfo(id: string) {
    const d = this.defs.get(id);
    return d ? { frames: d.frames.length, width: d.width, height: d.height, fps: d.fps, loop: d.loop, anchorX: d.anchorX, anchorY: d.anchorY } : null;
  }
  screenToWorld(x: number, y: number, c: Camera) {
    return { x: x / 2 - 320 + c.x, y: y / 2 - 180 + c.y };
  }
  worldToScreen(x: number, y: number, c: Camera) {
    return { x: (x - c.x + 320) * 2, y: (y - c.y + 180) * 2 };
  }
  beginFrame(_s: FrameSetup): void {
    this.frames++;
    this.frameTexts = [];
    this.frameLights = [];
    this.frameShapes = [];
    this.frameSprites = [];
  }
  sprite(id: string, frame: number, x: number, y: number, o?: SpriteOptions): void {
    if (!this.defs.has(id)) this.missing.add(id);
    if (!Number.isFinite(frame)) throw new Error(`bad frame for ${id}`);
    if (o?.tint && o.tint.some((v) => !Number.isFinite(v))) throw new Error(`bad tint for ${id}`);
    this.sprites++;
    this.frameSprites.push({ id, x, y, layer: o?.layer ?? 'world', outline: o?.outline ? [...o.outline] : undefined });
  }
  private shape(kind: ShapeCall['kind'], x: number, y: number, x2: number, y2: number, radius: number, o: ShapeOptions): void {
    if (![x, y, x2, y2, radius].every(Number.isFinite)) throw new Error(`bad ${kind}`);
    this.shapes++;
    this.frameShapes.push({
      kind, x, y, x2, y2, radius, thickness: o.thickness ?? 1, layer: o.layer ?? 'decal', color: [...o.color], alpha: o.alpha ?? 1,
    });
  }
  circle(x: number, y: number, r: number, o: ShapeOptions): void {
    this.shape('circle', x, y, x, y, r, o);
  }
  ring(x: number, y: number, r: number, o: ShapeOptions): void {
    this.shape('ring', x, y, x, y, r, o);
  }
  line(x1: number, y1: number, x2: number, y2: number, o: ShapeOptions): void {
    this.shape('line', x1, y1, x2, y2, 0, o);
  }
  rect(x: number, y: number, w: number, h: number, o: ShapeOptions): void {
    this.shape('rect', x, y, x + w, y + h, 0, o);
  }
  light(x: number, y: number, r: number, o: LightOptions): void {
    if (!Number.isFinite(r) || !Number.isFinite(o.intensity ?? 1)) throw new Error('bad light');
    this.lights++;
    this.frameLights.push({ x, y, radius: r, intensity: o.intensity ?? 1 });
  }
  text(s: string, x: number, y: number, o?: TextOptions): void {
    if (typeof s !== 'string') throw new Error('bad text');
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`bad text position for ${s}`);
    this.texts++;
    this.frameTexts.push({ text: s, x, y, scale: o?.scale ?? 1, alpha: o?.alpha ?? 1, color: o?.color ? [...o.color] : undefined });
  }
  measureText(s: string, scale = 1): number {
    return s.length * 6 * scale;
  }
  emit(b: ParticleBurst): void {
    if (b.sprite && !this.defs.has(b.sprite)) this.missing.add(b.sprite);
    this.particles += b.count;
  }
  updateParticles(): void {}
  clearParticles(): void {}
  endFrame(post?: PostFx): void {
    this.lastPost = post;
  }
  stats(): RenderStats {
    return { drawCalls: 1, sprites: this.sprites, particles: this.particles, lights: this.lights };
  }
  dispose(): void {}
}

export class RecordingAudio implements AudioEngine {
  readonly unlocked = true;
  plays: { id: SfxId; opts?: PlayOptions }[] = [];
  listener = { x: 0, y: 0 };
  async unlock(): Promise<void> {}
  play(id: SfxId, opts?: PlayOptions): void {
    this.plays.push({ id, opts: opts ? { ...opts } : undefined });
  }
  setListener(x: number, y: number): void {
    this.listener = { x, y };
  }
  setMusic(): void {}
  setIntensity(): void {}
  setVolumes(): void {}
  dispose(): void {}
}

export function player(id: number, x: number, y: number, over: Partial<PlayerView> = {}): PlayerView {
  return {
    id, name: `P${id}`, level: 10, x, y, prevX: x - 1, prevY: y, vx: 60, vy: 0, facing: 'east', aimX: x + 50, aimY: y,
    anim: 'run', animTime: 0.3, castSkill: null, castProgress: 0, life: 80, maxLife: 100, focus: 50, maxFocus: 70,
    wardTime: 0, wardDuration: 0, invulnTime: 0, hitFlash: 0, dead: false, slots: [], flasks: [], ...over,
  };
}

/** An empty map world (stores sized `cap`) with the given players. */
export function emptyWorld(players: PlayerView[], cap = 256): WorldView {
  const f = () => new Float32Array(cap);
  return {
    tick: 600, time: 10, arenaRadius: 900, theme: 'ashenForge', players,
    monsters: {
      capacity: cap, count: 0, alive: new Uint8Array(cap), id: new Uint32Array(cap), kind: new Uint8Array(cap), rarity: new Uint8Array(cap),
      x: f(), y: f(), prevX: f(), prevY: f(), radius: f(), facing: new Int8Array(cap), anim: new Uint8Array(cap), animTime: f(),
      life: f(), maxLife: f(), hitFlash: f(), ailments: new Uint8Array(cap), mods: new Uint8Array(cap),
    },
    projectiles: {
      capacity: cap, count: 0, alive: new Uint8Array(cap), id: new Uint32Array(cap), kind: new Uint8Array(cap), hostile: new Uint8Array(cap),
      x: f(), y: f(), prevX: f(), prevY: f(), vx: f(), vy: f(), radius: f(), age: f(), life: f(),
    },
    motes: { capacity: cap, count: 0, alive: new Uint8Array(cap), x: f(), y: f(), prevX: f(), prevY: f(), size: new Uint8Array(cap) },
    areas: [], drops: [], props: [],
    run: {
      phase: 'fight', wave: 3, waveCount: 6, waveTime: 10, waveDuration: 60, elapsed: 100, kills: 50, monstersAlive: 0,
      boss: null, lieutenant: null, portalOpen: false, playersAlive: players.length,
    },
  };
}

/** Put a monster into slot `i` of `w` (standing still at x, y). */
export function addMonster(w: WorldView, i: number, kind: number, rarity: number, x: number, y: number, radius = 8): void {
  const m = w.monsters;
  m.alive[i] = 1;
  m.id[i] = (1 << 16) | i;
  m.kind[i] = kind;
  m.rarity[i] = rarity;
  m.x[i] = m.prevX[i] = x;
  m.y[i] = m.prevY[i] = y;
  m.radius[i] = radius;
  m.facing[i] = 1;
  m.life[i] = 100;
  m.maxLife[i] = 100;
  m.count++;
}

/** Axis-aligned box of a damage-number text call (digits: 7 px capitals + 1 px outline around). */
export function textBox(t: TextCall, measure: (s: string, scale: number) => number): { x0: number; y0: number; x1: number; y1: number } {
  const hw = measure(t.text, t.scale) / 2 + 1;
  const hh = (7 * t.scale) / 2 + 1;
  return { x0: t.x - hw, y0: t.y - hh, x1: t.x + hw, y1: t.y + hh };
}
