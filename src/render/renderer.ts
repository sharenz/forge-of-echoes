// WebGL2 renderer: crisp low-res pixel art in a dark world lit by coloured point lights, with emissive glow,
// bloom and post-processing. See shaders.ts for the pass structure and instances.ts for the instance layout.
import type { PixelImage, SpriteDef } from '../contracts/art';
import type {
  Camera, FrameSetup, Layer, LightOptions, ParticleBurst, PostFx, RenderStats, Renderer, RGB, ShapeOptions,
  SpriteOptions, TextOptions,
} from '../contracts/render';
import { AtlasStore } from './atlas';
import { lightSeed, packRGBA, WHITE_RGBA } from './color';
import {
  fontImages, GLYPH_ASCENT, GLYPH_CELL_W, GLYPH_CELL_H, GLYPHS, glyphIndex, LETTER_SPACING, measureText, PLATE_PADDING,
  plateHeight,
} from './font';
import {
  createFramebuffer, createProgram, createTargetTexture, createTextureArray, probeHalfFloatTargets, rgba16f, rgba8,
  type ColorFormat, type Program,
} from './gl';
import {
  FLAG_ACTOR, FLAG_ADDITIVE, FLAG_BORDER, FLAG_FLIP_X, FLAG_FLIP_Y, FLAG_OUTLINE8, FLAG_SHADOW, InstanceList,
  KIND_CIRCLE, KIND_LINE, KIND_RECT, KIND_SPRITE, L_DECAL, L_FX, L_GROUND, L_SHADOW, L_TOP, L_WORLD, LAYERS, STRIDE,
  STRIDE_BYTES, WordBuffer,
} from './instances';
import { ParticlePool } from './particles';
import {
  BLOOM_DOWN_FS, BLOOM_UP_FS, COMPOSITE_FS, FINAL_FS, FULLSCREEN_VS, HALO_FS, LIGHT_FS, LIGHT_VS, SPRITE_FS, SPRITE_VS,
} from './shaders';
import { radixSortIndices, sortKey } from './sort';
import {
  computeViewport, createCameraFrame, resolveCamera, screenToWorld, snapRotatedPivot, snapRotation, worldToScreen,
  type Viewport,
} from './viewport';

const LAYER_INDEX: Record<Layer, number> = { ground: L_GROUND, decal: L_DECAL, shadow: L_SHADOW, world: L_WORLD, fx: L_FX, top: L_TOP };

const ATLAS_PAGE_SIZE = 1024;
const BLOOM_LEVELS = 5;
const LIGHT_STRIDE = 8; // floats per light: x, y, radius, flicker, r, g, b, seed
/** Light quantisation steps for a subtle pixel-art banding (0 = smooth). */
const LIGHT_BANDS = 0;
/** Share of the dynamic light added as airborne glow, so light sources read as luminous even over black. */
const LIGHT_HAZE = 0.03;
/** Bloom mix: wide dual-filter chain and a tight halo built from whole virtual pixels. */
const BLOOM_WIDE = 0.55;
const BLOOM_TIGHT = 0.3;
/**
 * Actor readability ('world' sprites): extra ambient fill as a multiple of the frame ambient, and a sky rim on the
 * silhouette's top edge (gain × ambient × (albedo + base)). Both scale with the scene's ambient, so dark maps stay
 * dark while horde silhouettes still separate from the floor.
 */
const ACTOR_LIFT = 1.5;
const RIM_GAIN = 1.6;
const RIM_BASE = 0.3;
/** HDR headroom when the context cannot render to half-float targets (values stored / 4 in RGBA8). */
const LDR_RANGE = 4;

const DEFAULT_AMBIENT: RGB = [0.18, 0.16, 0.2];
const DEFAULT_CLEAR: RGB = [0.02, 0.016, 0.024];
const TEXT_OUTLINE: RGB = [0.05, 0.035, 0.05];
const TEXT_COLOR = packRGBA(1, 1, 1, 1);

const FONT_ID = '__font';
const SPARK_ID = '__spark';
const DEFAULT_PARTICLE = 'fx/spark';

interface SpriteEntry {
  index: number;
  id: string;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
  fps: number;
  loop: boolean;
  frameCount: number;
  /** Per frame: page, u, v (atlas texel origin). */
  frames: Uint16Array;
}

interface BloomLevel {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

interface Targets {
  w: number;
  h: number;
  albedo: WebGLTexture;
  emissive: WebGLTexture;
  flat: WebGLTexture;
  sceneFb: WebGLFramebuffer;
  light: WebGLTexture;
  lightFb: WebGLFramebuffer;
  hdr: WebGLTexture;
  bright: WebGLTexture;
  compositeFb: WebGLFramebuffer;
  halo: WebGLTexture;
  haloFb: WebGLFramebuffer;
  top: WebGLTexture;
  topFb: WebGLFramebuffer;
  bloom: BloomLevel[];
}

interface Gpu {
  sprite: Program;
  light: Program;
  composite: Program;
  halo: Program;
  down: Program;
  up: Program;
  final: Program;
  sceneVao: WebGLVertexArrayObject;
  topVao: WebGLVertexArrayObject;
  lightVao: WebGLVertexArrayObject;
  emptyVao: WebGLVertexArrayObject;
  sceneBuf: WebGLBuffer;
  topBuf: WebGLBuffer;
  lightBuf: WebGLBuffer;
  bufBytes: [number, number, number]; // allocated bytes of scene/top/light buffers
  atlasAlbedo: WebGLTexture | null;
  atlasEmissive: WebGLTexture | null;
  atlasLayers: number;
  targets: Targets | null;
  halfFloat: boolean;
}

function spriteLayoutVao(gl: WebGL2RenderingContext, buf: WebGLBuffer): WebGLVertexArrayObject {
  const vao = gl.createVertexArray();
  if (!vao) throw new Error('render: createVertexArray failed');
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  const S = STRIDE_BYTES;
  const f = (loc: number, size: number, offset: number) => {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, S, offset);
    gl.vertexAttribDivisor(loc, 1);
  };
  const i = (loc: number, type: number, offset: number) => {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribIPointer(loc, 4, type, S, offset);
    gl.vertexAttribDivisor(loc, 1);
  };
  const n = (loc: number, offset: number) => {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 4, gl.UNSIGNED_BYTE, true, S, offset);
    gl.vertexAttribDivisor(loc, 1);
  };
  f(0, 4, 0);
  f(1, 3, 16);
  f(2, 2, 28);
  i(3, gl.UNSIGNED_SHORT, 36);
  i(4, gl.UNSIGNED_BYTE, 44);
  n(5, 48);
  n(6, 52);
  n(7, 56);
  gl.bindVertexArray(null);
  return vao;
}

export class WebGLRenderer implements Renderer {
  readonly canvas: HTMLCanvasElement;

  private gl: WebGL2RenderingContext;
  private gpu: Gpu | null = null;
  private lost = false;
  private disposed = false;

  private vp: Viewport;
  /** Last resize() arguments; null until the owner first calls resize(). */
  private css: { width: number; height: number; dpr: number } | null = null;
  /** The canvas's exact device-pixel box as reported by the browser (ResizeObserver), when supported. */
  private deviceBox: { width: number; height: number } | null = null;
  private observer: ResizeObserver | null = null;
  private cam = createCameraFrame();
  private readonly snapped = { x: 0, y: 0 };
  private ambient: RGB = DEFAULT_AMBIENT;
  private clearColor = new Float32Array([DEFAULT_CLEAR[0], DEFAULT_CLEAR[1], DEFAULT_CLEAR[2], 0]);
  private readonly zero4 = new Float32Array(4);
  private time = 0;

  private readonly lists = LAYERS.map((_, i) => new InstanceList(i === L_WORLD || i === L_GROUND ? 4096 : 1024));
  private lightData = new Float32Array(256 * LIGHT_STRIDE);
  private lightCount = 0;
  private readonly upload = new WordBuffer(4096 * STRIDE);
  private sortA = new Uint32Array(4096);
  private sortB = new Uint32Array(4096);

  private readonly atlas = new AtlasStore(ATLAS_PAGE_SIZE, 1);
  private readonly sprites = new Map<string, SpriteEntry>();
  private readonly spriteTable: SpriteEntry[] = [];
  private readonly missing = new Set<string>();
  private font!: SpriteEntry;
  private spark!: SpriteEntry;

  private readonly particles = new ParticlePool();
  private frameSprites = 0;
  private drawCalls = 0;
  private lastStats: RenderStats = { drawCalls: 0, sprites: 0, particles: 0, lights: 0 };

  private readonly onLost = (e: Event) => {
    e.preventDefault();
    this.lost = true;
    this.gpu = null; // every GL object died with the context
  };
  private readonly onRestored = () => {
    this.lost = false;
    try {
      this.initGpu();
    } catch (err) {
      // Lost again while rebuilding: the next 'webglcontextrestored' retries. Anything else is a real error.
      this.gpu = null;
      if (!this.gl.isContextLost()) throw err;
    }
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 is not available in this browser');
    this.gl = gl;
    // No side effects on the canvas until resize(): treat its current backing size as device pixels.
    this.vp = computeViewport(canvas.width || 640, canvas.height || 360, 1);
    canvas.addEventListener('webglcontextlost', this.onLost, false);
    canvas.addEventListener('webglcontextrestored', this.onRestored, false);
    this.observeDeviceBox();
    this.registerBuiltins();
    this.initGpu();
  }

  /**
   * Track the canvas's exact device-pixel box. At fractional device pixel ratios round(css × dpr) can be one
   * pixel off the real box, and the compositor then resamples the whole canvas (uneven pixel columns or blur).
   * Browsers without `device-pixel-content-box` keep the rounded estimate.
   */
  private observeDeviceBox(): void {
    if (typeof ResizeObserver === 'undefined') return;
    try {
      const observer = new ResizeObserver((entries) => {
        const box = entries[entries.length - 1]?.devicePixelContentBoxSize?.[0];
        if (!box || this.disposed) return;
        const w = Math.round(box.inlineSize);
        const h = Math.round(box.blockSize);
        if (w <= 0 || h <= 0 || (this.deviceBox && this.deviceBox.width === w && this.deviceBox.height === h)) return;
        this.deviceBox = { width: w, height: h };
        if (this.css) this.applyViewport();
      });
      observer.observe(this.canvas, { box: 'device-pixel-content-box' });
      this.observer = observer;
    } catch {
      this.observer = null; // 'device-pixel-content-box' unsupported (e.g. Safari): the estimate is used
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Viewport
  // ---------------------------------------------------------------------------------------------------------------

  get viewWidth(): number {
    return this.vp.viewWidth;
  }
  get viewHeight(): number {
    return this.vp.viewHeight;
  }
  get pixelScale(): number {
    return this.vp.pixelScale;
  }

  resize(cssWidth: number, cssHeight: number, devicePixelRatio: number): void {
    if (this.disposed) return;
    this.css = { width: cssWidth, height: cssHeight, dpr: devicePixelRatio };
    this.applyViewport();
  }

  private applyViewport(): void {
    const css = this.css;
    if (!css) return;
    // The observed device box belongs to whatever CSS box was laid out last; trust it only while it still matches
    // the requested size (within rounding), so a stale box never survives a real resize.
    const box = this.deviceBox;
    const dpr = css.dpr > 0 && Number.isFinite(css.dpr) ? css.dpr : 1;
    const exact = box && Math.abs(box.width - css.width * dpr) < 1.5 && Math.abs(box.height - css.height * dpr) < 1.5 ? box : null;
    const vp = computeViewport(css.width, css.height, css.dpr, undefined, exact);
    this.vp = vp;
    const canvas = this.canvas;
    if (canvas.width !== vp.deviceWidth) canvas.width = vp.deviceWidth;
    if (canvas.height !== vp.deviceHeight) canvas.height = vp.deviceHeight;
    canvas.style.width = `${vp.cssWidth}px`;
    canvas.style.height = `${vp.cssHeight}px`;
    // Safety net: if the compositor ever has to rescale the canvas, keep it nearest-neighbour rather than blurry.
    canvas.style.imageRendering = 'pixelated';
    this.ensureTargets();
  }

  screenToWorld(cssX: number, cssY: number, camera: Camera): { x: number; y: number } {
    return screenToWorld(this.vp, camera, cssX, cssY);
  }

  worldToScreen(x: number, y: number, camera: Camera): { x: number; y: number } {
    return worldToScreen(this.vp, camera, x, y);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Sprites / atlas
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Re-registering an id with the same frame size and count rewrites its pixels in place (no atlas growth); a
   * changed size releases the old slots for reuse. Invalid defs are skipped with a warning and leave any existing
   * registration of that id untouched.
   */
  registerSprites(defs: SpriteDef[]): void {
    if (this.disposed) return;
    const jobs: { def: SpriteDef; entry: SpriteEntry; frame: number; inPlace: boolean }[] = [];
    // An id listed twice in one call: the last definition wins (earlier ones never get atlas slots).
    const unique = new Map<string, SpriteDef>();
    for (const def of defs) unique.set(def.id, def);
    for (const def of unique.values()) {
      if (!def.frames.length || !(def.width > 0) || !(def.height > 0)) {
        console.warn(`render: sprite "${def.id}" has no frames or an empty size; skipped`);
        continue;
      }
      if (!this.atlas.fits(def.width, def.height)) {
        console.warn(`render: sprite "${def.id}" (${def.width}x${def.height}) exceeds the ${ATLAS_PAGE_SIZE}px atlas page; skipped`);
        continue;
      }
      const existing = this.sprites.get(def.id);
      const inPlace = !!existing && existing.width === def.width && existing.height === def.height && existing.frameCount === def.frames.length;
      if (existing && !inPlace) {
        for (let f = 0; f < existing.frameCount; f++) {
          const fr = existing.frames;
          this.atlas.release({ page: fr[f * 3], x: fr[f * 3 + 1], y: fr[f * 3 + 2] }, existing.width, existing.height);
        }
      }
      const entry: SpriteEntry = inPlace && existing ? existing : {
        index: existing ? existing.index : this.spriteTable.length,
        id: def.id,
        width: def.width,
        height: def.height,
        anchorX: def.anchorX,
        anchorY: def.anchorY,
        fps: def.fps,
        loop: def.loop,
        frameCount: def.frames.length,
        frames: new Uint16Array(def.frames.length * 3),
      };
      entry.anchorX = def.anchorX;
      entry.anchorY = def.anchorY;
      entry.fps = def.fps;
      entry.loop = def.loop;
      this.sprites.set(def.id, entry);
      this.spriteTable[entry.index] = entry;
      this.missing.delete(def.id);
      for (let f = 0; f < def.frames.length; f++) jobs.push({ def, entry, frame: f, inPlace });
    }
    // Pack tallest frames first for a tighter skyline.
    jobs.sort((a, b) => b.def.height - a.def.height || b.def.width - a.def.width);
    for (const { def, entry, frame, inPlace } of jobs) {
      const fr = entry.frames;
      const slot = inPlace
        ? { page: fr[frame * 3], x: fr[frame * 3 + 1], y: fr[frame * 3 + 2] }
        : this.atlas.allocate(def.width, def.height);
      this.atlas.blit(slot, this.fitImage(def.frames[frame], def), 'albedo');
      const em = def.emissive?.[frame];
      // Always write the emissive layer: a reused slot must not keep a previous sprite's glow.
      if (em) this.atlas.blit(slot, this.fitImage(em, def), 'emissive');
      else this.atlas.clear(slot, def.width, def.height, 'emissive');
      fr[frame * 3] = slot.page;
      fr[frame * 3 + 1] = slot.x;
      fr[frame * 3 + 2] = slot.y;
    }
    this.syncAtlas();
  }

  /** Guard against frames whose size disagrees with the def: crop/pad into a def-sized image. */
  private fitImage(img: PixelImage, def: SpriteDef): PixelImage {
    if (img.width === def.width && img.height === def.height && img.data.length >= def.width * def.height * 4) return img;
    console.warn(`render: sprite "${def.id}" frame is ${img.width}x${img.height}, expected ${def.width}x${def.height}`);
    const data = new Uint8ClampedArray(def.width * def.height * 4);
    const w = Math.min(img.width, def.width);
    const h = Math.min(img.height, def.height);
    for (let y = 0; y < h; y++) {
      data.set(img.data.subarray(y * img.width * 4, (y * img.width + w) * 4), y * def.width * 4);
    }
    return { width: def.width, height: def.height, data };
  }

  hasSprite(id: string): boolean {
    return this.sprites.has(id);
  }

  spriteInfo(id: string) {
    const s = this.sprites.get(id);
    if (!s) return null;
    return { frames: s.frameCount, width: s.width, height: s.height, fps: s.fps, loop: s.loop, anchorX: s.anchorX, anchorY: s.anchorY };
  }

  private registerBuiltins(): void {
    const glyphs = fontImages();
    const spark = new Uint8ClampedArray(3 * 3 * 4);
    const put = (x: number, y: number, a: number) => {
      const o = (y * 3 + x) * 4;
      spark[o] = spark[o + 1] = spark[o + 2] = 255;
      spark[o + 3] = a;
    };
    put(1, 1, 255);
    put(0, 1, 110);
    put(2, 1, 110);
    put(1, 0, 110);
    put(1, 2, 110);
    this.registerSprites([
      { id: FONT_ID, width: GLYPH_CELL_W, height: GLYPH_CELL_H, frames: glyphs, anchorX: 0, anchorY: 0, fps: 0, loop: false },
      { id: SPARK_ID, width: 3, height: 3, frames: [{ width: 3, height: 3, data: spark }], anchorX: 1.5, anchorY: 1.5, fps: 0, loop: false },
    ]);
    this.font = this.sprites.get(FONT_ID)!;
    this.spark = this.sprites.get(SPARK_ID)!;
  }

  private warnMissing(id: string): void {
    if (this.missing.has(id)) return;
    this.missing.add(id);
    console.warn(`render: unknown sprite "${id}"`);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Frame recording
  // ---------------------------------------------------------------------------------------------------------------

  beginFrame(setup: FrameSetup): void {
    resolveCamera(setup.camera, this.vp, this.cam);
    this.ambient = setup.ambient;
    const c = setup.clearColor ?? DEFAULT_CLEAR;
    this.clearColor[0] = c[0];
    this.clearColor[1] = c[1];
    this.clearColor[2] = c[2];
    this.time = setup.time;
    for (const l of this.lists) l.reset();
    this.lightCount = 0;
    this.frameSprites = 0;
    this.drawCalls = 0;
  }

  /**
   * Write one instance. (px, py) is the pivot in target pixels, (w, h) the quad size, (pvx, pvy) the pivot inside
   * the quad. Returns nothing; y-sorted layers also get `key`.
   */
  private push(
    layer: number, key: number, px: number, py: number, w: number, h: number, pvx: number, pvy: number, rot: number,
    p0: number, p1: number, uv: number, size: number, meta: number, tint: number, flash: number, outline: number,
  ): void {
    const list = this.lists[layer];
    const o = list.push();
    const f = list.f32;
    const u = list.u32;
    f[o] = px;
    f[o + 1] = py;
    f[o + 2] = w;
    f[o + 3] = h;
    f[o + 4] = pvx;
    f[o + 5] = pvy;
    f[o + 6] = rot;
    f[o + 7] = p0;
    f[o + 8] = p1;
    u[o + 9] = uv;
    u[o + 10] = size;
    u[o + 11] = meta;
    u[o + 12] = tint;
    u[o + 13] = flash;
    u[o + 14] = outline;
    list.keys[list.count - 1] = key;
  }

  private visible(px: number, py: number, extent: number): boolean {
    return px + extent >= 0 && py + extent >= 0 && px - extent <= this.vp.targetWidth && py - extent <= this.vp.targetHeight;
  }

  sprite(id: string, frame: number, x: number, y: number, opts?: SpriteOptions): void {
    const s = this.sprites.get(id);
    if (!s) {
      this.warnMissing(id);
      return;
    }
    const layer = opts?.layer ? LAYER_INDEX[opts.layer] : L_WORLD;
    const cam = this.cam;
    const scale = opts?.scale ?? 1;
    let sx = (opts?.scaleX ?? 1) * scale * cam.zoom;
    let sy = (opts?.scaleY ?? 1) * scale * cam.zoom;
    let flipX = opts?.flipX === true;
    let flipY = false;
    if (sx < 0) {
      sx = -sx;
      flipX = !flipX;
    }
    if (sy < 0) {
      sy = -sy;
      flipY = true;
    }
    if (!(sx > 0 && sy > 0)) return;
    const w = s.width * sx;
    const h = s.height * sy;
    let px = x * cam.zoom - cam.originX;
    let py = y * cam.zoom - cam.originY;
    if (!this.visible(px, py, w + h + 2)) return;

    const ax = (flipX ? s.width - s.anchorX : s.anchorX) * sx;
    const ay = (flipY ? s.height - s.anchorY : s.anchorY) * sy;
    let rot = opts?.rotation ?? 0;
    // Rotations step at the sprite's angular pixel resolution (farthest pixel moves ~1 px per step).
    if (rot !== 0) rot = snapRotation(rot, Math.hypot(Math.max(ax, w - ax), Math.max(ay, h - ay)));
    if (rot === 0) {
      // Snap the quad's top-left corner onto the world pixel grid.
      px = Math.round(px - ax) + ax;
      py = Math.round(py - ay) + ay;
    } else {
      // Snap the rotated quad's corner, not its pivot: at quarter turns pixel centres then hit texel centres.
      const p = snapRotatedPivot(px, py, ax, ay, rot, this.snapped);
      px = p.x;
      py = p.y;
    }

    const n = s.frameCount;
    let f = Math.floor(frame);
    if (!(f >= 0 && f < n)) f = s.loop ? ((f % n) + n) % n : f > 0 ? n - 1 : 0;
    if (!(f >= 0)) f = 0; // NaN frame
    const fr = s.frames;
    const page = fr[f * 3];

    let flags = (flipX ? FLAG_FLIP_X : 0) | (flipY ? FLAG_FLIP_Y : 0);
    if (opts?.additive) flags |= FLAG_ADDITIVE;
    else if (layer === L_WORLD) flags |= FLAG_ACTOR;
    if (layer === L_SHADOW) flags |= FLAG_SHADOW;
    const emissive = opts?.emissive ?? (layer === L_FX ? 1 : 0);
    const e = emissive > 0 ? (emissive < 1 ? (emissive * 255 + 0.5) | 0 : 255) : 0;
    const alpha = opts?.alpha ?? 1;
    const t = opts?.tint;
    const tint = t ? packRGBA(t[0], t[1], t[2], alpha) : alpha === 1 ? WHITE_RGBA : packRGBA(1, 1, 1, alpha);
    const fl = opts?.flash ?? 0;
    const fc = opts?.flashColor;
    const flash = fl > 0 ? (fc ? packRGBA(fc[0], fc[1], fc[2], fl) : packRGBA(1, 1, 1, fl)) : 0;
    const oc = opts?.outline;
    const outline = oc ? packRGBA(oc[0], oc[1], oc[2], 1) : 0;

    this.push(
      layer, sortKey(opts?.sortY ?? y), px, py, w, h, ax, ay, rot, 0, 0,
      (fr[f * 3 + 1] | (fr[f * 3 + 2] << 16)) >>> 0, (s.width | (s.height << 16)) >>> 0,
      (page | (KIND_SPRITE << 8) | (flags << 16) | (e << 24)) >>> 0, tint, flash, outline,
    );
    this.frameSprites++;
  }

  private shapeMeta(kind: number, layer: number, opts: ShapeOptions, extraFlags = 0): number {
    let flags = extraFlags;
    if (opts.additive) flags |= FLAG_ADDITIVE;
    if (layer === L_SHADOW) flags |= FLAG_SHADOW;
    const emissive = opts.emissive ?? (layer === L_FX ? 1 : 0);
    const e = emissive > 0 ? (emissive < 1 ? (emissive * 255 + 0.5) | 0 : 255) : 0;
    return ((kind << 8) | (flags << 16) | (e << 24)) >>> 0;
  }

  private disc(x: number, y: number, radius: number, thickness: number, opts: ShapeOptions): void {
    const cam = this.cam;
    const r = radius * cam.zoom;
    if (!(r > 0)) return;
    const arc = opts.arc ?? 1;
    if (!(arc > 0)) return;
    const cx = Math.round(x * cam.zoom - cam.originX);
    const cy = Math.round(y * cam.zoom - cam.originY);
    if (!this.visible(cx, cy, r + 2)) return;
    const layer = LAYER_INDEX[opts.layer ?? 'decal'];
    const c = opts.color;
    // Pixel-stepped rings are at least one whole pixel wide (thinner rings would break up into dots).
    const t = thickness > 0 ? Math.max(1, thickness * cam.zoom) : 0;
    this.push(
      layer, sortKey(y), cx, cy, r * 2, r * 2, r, r, 0, t, Math.min(arc, 1), 0, 0,
      this.shapeMeta(KIND_CIRCLE, layer, opts), packRGBA(c[0], c[1], c[2], opts.alpha ?? 1), 0, 0,
    );
    this.frameSprites++;
  }

  circle(x: number, y: number, radius: number, opts: ShapeOptions): void {
    this.disc(x, y, radius, 0, opts);
  }

  ring(x: number, y: number, radius: number, opts: ShapeOptions): void {
    this.disc(x, y, radius, Math.max(opts.thickness ?? 1, 1e-3), opts);
  }

  line(x1: number, y1: number, x2: number, y2: number, opts: ShapeOptions): void {
    const cam = this.cam;
    const t = Math.max(1, Math.round((opts.thickness ?? 1) * cam.zoom));
    // Endpoints snap to pixel centres (odd widths) or pixel corners (even widths), so the pixel-stepped line is
    // exactly t pixels across and rasterises like a hand-drawn pixel line.
    const half = (t & 1) === 1 ? 0.5 : 0; // floor(v + 0.5 - half) + half: centre for odd t, corner for even t
    const ax = Math.floor(x1 * cam.zoom - cam.originX + 0.5 - half) + half;
    const ay = Math.floor(y1 * cam.zoom - cam.originY + 0.5 - half) + half;
    const bx = Math.floor(x2 * cam.zoom - cam.originX + 0.5 - half) + half;
    const by = Math.floor(y2 * cam.zoom - cam.originY + 0.5 - half) + half;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (!this.visible((ax + bx) / 2, (ay + by) / 2, len / 2 + t + 2)) return;
    const layer = LAYER_INDEX[opts.layer ?? 'decal'];
    const c = opts.color;
    this.push(
      layer, sortKey((y1 + y2) / 2), ax, ay, len + t, t, t / 2, t / 2, Math.atan2(dy, dx), t, 1, 0, 0,
      this.shapeMeta(KIND_LINE, layer, opts), packRGBA(c[0], c[1], c[2], opts.alpha ?? 1), 0, 0,
    );
    this.frameSprites++;
  }

  rect(x: number, y: number, w: number, h: number, opts: ShapeOptions): void {
    const cam = this.cam;
    if (w < 0) {
      x += w;
      w = -w;
    }
    if (h < 0) {
      y += h;
      h = -h;
    }
    const rx = Math.round(x * cam.zoom - cam.originX);
    const ry = Math.round(y * cam.zoom - cam.originY);
    const rw = Math.round(w * cam.zoom);
    const rh = Math.round(h * cam.zoom);
    if (rw <= 0 || rh <= 0) return;
    if (!this.visible(rx + rw / 2, ry + rh / 2, (rw + rh) / 2 + 2)) return;
    const layer = LAYER_INDEX[opts.layer ?? 'decal'];
    const c = opts.color;
    this.push(
      layer, sortKey(y + h), rx, ry, rw, rh, 0, 0, 0, 0, 1, 0, 0,
      this.shapeMeta(KIND_RECT, layer, opts), packRGBA(c[0], c[1], c[2], opts.alpha ?? 1), 0, 0,
    );
    this.frameSprites++;
  }

  light(x: number, y: number, radius: number, opts: LightOptions): void {
    const cam = this.cam;
    const r = radius * cam.zoom;
    if (!(r > 0)) return;
    const lx = x * cam.zoom - cam.originX;
    const ly = y * cam.zoom - cam.originY;
    if (!this.visible(lx, ly, r)) return;
    const k = opts.intensity ?? 1;
    if (!(k > 0)) return;
    this.pushLight(lx, ly, r, opts.flicker ?? 0, opts.color[0] * k, opts.color[1] * k, opts.color[2] * k, lightSeed(x, y));
  }

  private pushLight(x: number, y: number, r: number, flicker: number, cr: number, cg: number, cb: number, seed: number): void {
    if ((this.lightCount + 1) * LIGHT_STRIDE > this.lightData.length) {
      const next = new Float32Array(this.lightData.length * 2);
      next.set(this.lightData);
      this.lightData = next;
    }
    const d = this.lightData;
    const o = this.lightCount++ * LIGHT_STRIDE;
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = r;
    d[o + 3] = flicker;
    d[o + 4] = cr;
    d[o + 5] = cg;
    d[o + 6] = cb;
    d[o + 7] = seed;
  }

  text(str: string, x: number, y: number, opts?: TextOptions): void {
    if (!str) return;
    const cam = this.cam;
    const scale = Math.max(1, Math.round(opts?.scale ?? 1));
    const layer = LAYER_INDEX[opts?.layer ?? 'top'];
    const width = measureText(str, scale);
    const align = opts?.align ?? 'left';
    const ax = x * cam.zoom - cam.originX;
    const ay = y * cam.zoom - cam.originY;
    let left = Math.round(ax - (align === 'center' ? width / 2 : align === 'right' ? width : 0));
    // y is the vertical middle of capitals/digits.
    const top = Math.round(ay - (GLYPH_ASCENT * scale) / 2);
    const box = opts?.box;
    const pad = box ? Math.max(0, Math.round(box.padding ?? PLATE_PADDING)) : 0;
    // Glyph cells include the descender rows; plates always reserve them, so every label has the same height.
    const textH = GLYPH_CELL_H * scale;
    if (!this.visible(left + width / 2, top + textH / 2, (width + textH) / 2 + pad + 2)) return;

    const alpha = opts?.alpha ?? 1;
    const key = sortKey(y);
    if (box && box.alpha * alpha > 0) {
      const bc = box.color;
      const border = box.border;
      const rw = width + pad * 2;
      const rh = plateHeight(scale, pad);
      this.push(
        layer, key, left - pad, top - pad, rw, rh, 0, 0, 0, 0, 1, 0, 0,
        ((KIND_RECT << 8) | ((border ? FLAG_BORDER : 0) << 16)) >>> 0,
        packRGBA(bc[0], bc[1], bc[2], box.alpha * alpha), 0,
        border ? packRGBA(border[0], border[1], border[2], 1) : 0,
      );
    }
    const c = opts?.color;
    const tint = c ? packRGBA(c[0], c[1], c[2], alpha) : alpha === 1 ? TEXT_COLOR : packRGBA(1, 1, 1, alpha);
    const oc = opts?.outline === undefined ? TEXT_OUTLINE : opts.outline;
    const outline = oc ? packRGBA(oc[0], oc[1], oc[2], 1) : 0;
    const font = this.font;
    const flags = oc ? FLAG_OUTLINE8 : 0;
    const meta = (KIND_SPRITE << 8) | (flags << 16);
    const size = (GLYPH_CELL_W | (GLYPH_CELL_H << 16)) >>> 0;
    const gw = GLYPH_CELL_W * scale;
    const gh = GLYPH_CELL_H * scale;
    for (let i = 0; i < str.length; i++) {
      const g = glyphIndex(str.charCodeAt(i));
      const glyph = GLYPHS[g];
      if (glyph.char !== ' ') {
        const fr = font.frames;
        this.push(
          layer, key, left, top, gw, gh, 0, 0, 0, 0, 0, (fr[g * 3 + 1] | (fr[g * 3 + 2] << 16)) >>> 0, size,
          (fr[g * 3] | meta) >>> 0, tint, 0, outline,
        );
      }
      left += (glyph.width + LETTER_SPACING) * scale;
    }
    this.frameSprites += str.length;
  }

  measureText(str: string, scale = 1): number {
    return measureText(str, scale);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Particles
  // ---------------------------------------------------------------------------------------------------------------

  emit(burst: ParticleBurst): void {
    if (this.disposed || !(burst.count > 0)) return;
    const id = burst.sprite ?? DEFAULT_PARTICLE;
    let s = this.sprites.get(id);
    if (!s) {
      if (id !== DEFAULT_PARTICLE) this.warnMissing(id);
      s = this.spark;
    }
    this.particles.emit(burst, s.index, s.frameCount, LAYER_INDEX[burst.layer ?? 'fx']);
  }

  updateParticles(dt: number): void {
    this.particles.update(Math.min(dt, 0.1));
  }

  clearParticles(): void {
    this.particles.clear();
  }

  /** Turn live particles into instances (and lights) for this frame. */
  private recordParticles(): void {
    const p = this.particles;
    const cam = this.cam;
    const z = cam.zoom;
    for (let i = 0; i < p.count; i++) {
      const t = p.age[i] / p.life[i];
      const s = this.spriteTable[p.sprite[i]] ?? this.spark;
      const size = p.size[i] * (1 + (p.sizeEnd[i] - 1) * t) * z;
      if (!(size > 0)) continue;
      const wx = p.x[i];
      const wy = p.y[i] - p.z[i];
      let px = wx * z - cam.originX;
      let py = wy * z - cam.originY;
      const w = Math.max(1, s.width * size);
      const h = Math.max(1, s.height * size);
      if (!this.visible(px, py, w + h)) continue;
      const ax = (s.anchorX / s.width) * w;
      const ay = (s.anchorY / s.height) * h;
      px = Math.round(px - ax) + ax;
      py = Math.round(py - ay) + ay;
      const alpha = Math.min(1, (1 - t) * 3);
      const r = p.r0[i] + (p.r1[i] - p.r0[i]) * t;
      const g = p.g0[i] + (p.g1[i] - p.g0[i]) * t;
      const b = p.b0[i] + (p.b1[i] - p.b0[i]) * t;
      const layer = p.layer[i];
      const nf = s.frameCount;
      const f = nf > 1 ? Math.min(nf - 1, Math.floor(t * nf)) : 0;
      const fr = s.frames;
      let flags = p.isAdditive(i) ? FLAG_ADDITIVE : 0;
      if (layer === L_SHADOW) flags |= FLAG_SHADOW;
      const em = p.emissive[i];
      const e = em > 0 ? (em < 1 ? (em * 255 + 0.5) | 0 : 255) : 0;
      this.push(
        layer, sortKey(p.y[i]), px, py, w, h, ax, ay, 0, 0, 0, (fr[f * 3 + 1] | (fr[f * 3 + 2] << 16)) >>> 0,
        (s.width | (s.height << 16)) >>> 0, (fr[f * 3] | (KIND_SPRITE << 8) | (flags << 16) | (e << 24)) >>> 0,
        packRGBA(r, g, b, alpha), 0, 0,
      );
      const lr = p.light[i];
      if (lr > 0) this.pushLight(wx * z - cam.originX, wy * z - cam.originY, lr * z, 0, r * alpha, g * alpha, b * alpha, 0);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // GPU
  // ---------------------------------------------------------------------------------------------------------------

  private initGpu(): void {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    const sprite = createProgram(gl, 'sprite', SPRITE_VS, SPRITE_FS, ['uTarget', 'uAlbedo', 'uEmissive', 'uUnlit', 'uAmbient', 'uActor']);
    const light = createProgram(gl, 'light', LIGHT_VS, LIGHT_FS, ['uTarget', 'uTime', 'uInvRange']);
    const composite = createProgram(gl, 'composite', FULLSCREEN_VS, COMPOSITE_FS, ['uAlbedo', 'uEmissive', 'uFlat', 'uLight', 'uAmbient', 'uRange', 'uBands', 'uHaze']);
    const halo = createProgram(gl, 'halo', FULLSCREEN_VS, HALO_FS, ['uSrc']);
    const down = createProgram(gl, 'bloomDown', FULLSCREEN_VS, BLOOM_DOWN_FS, ['uSrc', 'uTexel']);
    const up = createProgram(gl, 'bloomUp', FULLSCREEN_VS, BLOOM_UP_FS, ['uSrc', 'uTexel']);
    const final = createProgram(gl, 'final', FULLSCREEN_VS, FINAL_FS, [
      'uHdr', 'uBloom', 'uHalo', 'uTop', 'uDevice', 'uOffset', 'uFrac', 'uScale', 'uTargetSize', 'uRange',
      'uBloomWide', 'uBloomTight', 'uExposure', 'uSaturation', 'uVignette', 'uChromatic', 'uFlash',
    ]);
    // Sampler units and constants never change per program.
    gl.useProgram(sprite.program);
    gl.uniform1i(sprite.uniforms.uAlbedo, 0);
    gl.uniform1i(sprite.uniforms.uEmissive, 1);
    gl.uniform3f(sprite.uniforms.uActor, ACTOR_LIFT, RIM_GAIN, RIM_BASE);
    gl.useProgram(composite.program);
    gl.uniform1i(composite.uniforms.uAlbedo, 0);
    gl.uniform1i(composite.uniforms.uEmissive, 1);
    gl.uniform1i(composite.uniforms.uLight, 2);
    gl.uniform1i(composite.uniforms.uFlat, 3);
    gl.useProgram(halo.program);
    gl.uniform1i(halo.uniforms.uSrc, 0);
    gl.useProgram(down.program);
    gl.uniform1i(down.uniforms.uSrc, 0);
    gl.useProgram(up.program);
    gl.uniform1i(up.uniforms.uSrc, 0);
    gl.useProgram(final.program);
    gl.uniform1i(final.uniforms.uHdr, 0);
    gl.uniform1i(final.uniforms.uBloom, 1);
    gl.uniform1i(final.uniforms.uHalo, 2);
    gl.uniform1i(final.uniforms.uTop, 3);

    const buffer = () => {
      const b = gl.createBuffer();
      if (!b) throw new Error('render: createBuffer failed');
      return b;
    };
    const sceneBuf = buffer();
    const topBuf = buffer();
    const lightBuf = buffer();
    const lightVao = gl.createVertexArray();
    const emptyVao = gl.createVertexArray();
    if (!lightVao || !emptyVao) throw new Error('render: createVertexArray failed');
    gl.bindVertexArray(lightVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, lightBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, LIGHT_STRIDE * 4, 0);
    gl.vertexAttribDivisor(0, 1);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, LIGHT_STRIDE * 4, 16);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);

    this.gpu = {
      sprite, light, composite, halo, down, up, final,
      sceneVao: spriteLayoutVao(gl, sceneBuf),
      topVao: spriteLayoutVao(gl, topBuf),
      lightVao,
      emptyVao,
      sceneBuf,
      topBuf,
      lightBuf,
      bufBytes: [0, 0, 0],
      atlasAlbedo: null,
      atlasEmissive: null,
      atlasLayers: 0,
      targets: null,
      halfFloat: probeHalfFloatTargets(gl),
    };
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    this.syncAtlas();
    this.ensureTargets();
  }

  /** Upload dirty atlas pages; grow the texture arrays when pages were added. */
  private syncAtlas(): void {
    const g = this.gpu;
    const gl = this.gl;
    if (!g || this.lost) return;
    const pages = this.atlas.pages;
    if (!pages.length) return;
    const size = this.atlas.pageSize;
    if (g.atlasLayers < pages.length) {
      if (g.atlasAlbedo) gl.deleteTexture(g.atlasAlbedo);
      if (g.atlasEmissive) gl.deleteTexture(g.atlasEmissive);
      g.atlasAlbedo = createTextureArray(gl, size, pages.length);
      g.atlasEmissive = createTextureArray(gl, size, pages.length);
      g.atlasLayers = pages.length;
      for (const p of pages) p.dirty = true;
    }
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      if (!p.dirty) continue;
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, g.atlasAlbedo);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, p.albedo);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, g.atlasEmissive);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, p.emissive);
      p.dirty = false;
    }
  }

  private ensureTargets(): void {
    const g = this.gpu;
    if (!g || this.lost) return;
    const { targetWidth: w, targetHeight: h } = this.vp;
    if (g.targets && g.targets.w === w && g.targets.h === h) return;
    if (g.targets) this.deleteTargets(g.targets);
    g.targets = null;
    let t = this.createTargets(w, h, g.halfFloat);
    if (!t && g.halfFloat) {
      g.halfFloat = false; // half-float MRT not supported here; fall back to RGBA8 with headroom scaling
      t = this.createTargets(w, h, false);
    }
    if (!t) throw new Error('render: could not create render targets');
    g.targets = t;
  }

  private createTargets(w: number, h: number, halfFloat: boolean): Targets | null {
    const gl = this.gl;
    const hdrFmt: ColorFormat = halfFloat ? rgba16f(gl) : rgba8(gl);
    const ldr = rgba8(gl);
    const made: WebGLTexture[] = [];
    const tex = (tw: number, th: number, fmt: ColorFormat, linear: boolean) => {
      const t = createTargetTexture(gl, tw, th, fmt, linear);
      made.push(t);
      return t;
    };
    const albedo = tex(w, h, ldr, false);
    const emissive = tex(w, h, hdrFmt, false);
    const flat = tex(w, h, ldr, false);
    const light = tex(w, h, hdrFmt, false);
    const hdr = tex(w, h, hdrFmt, false);
    const bright = tex(w, h, hdrFmt, true); // linear: the bloom chain's first downsample filters it
    const halo = tex(w, h, hdrFmt, false);
    const top = tex(w, h, ldr, false);
    const sceneFb = createFramebuffer(gl, [albedo, emissive, flat]);
    const lightFb = createFramebuffer(gl, [light]);
    const compositeFb = createFramebuffer(gl, [hdr, bright]);
    const haloFb = createFramebuffer(gl, [halo]);
    const topFb = createFramebuffer(gl, [top]);
    const bloom: BloomLevel[] = [];
    let bw = w;
    let bh = h;
    let ok = !!(sceneFb && lightFb && compositeFb && haloFb && topFb);
    // Always at least one level (tiny/minimised canvases), then halve while the image is big enough to blur.
    for (let i = 0; ok && i < BLOOM_LEVELS && (i === 0 || (bw > 2 && bh > 2)); i++) {
      bw = Math.max(1, Math.ceil(bw / 2));
      bh = Math.max(1, Math.ceil(bh / 2));
      const t = tex(bw, bh, hdrFmt, true);
      const fb = createFramebuffer(gl, [t]);
      if (!fb) ok = false;
      else bloom.push({ fb, tex: t, w: bw, h: bh });
    }
    if (!ok || !sceneFb || !lightFb || !compositeFb || !haloFb || !topFb || !bloom.length) {
      for (const fb of [sceneFb, lightFb, compositeFb, haloFb, topFb, ...bloom.map((b) => b.fb)]) if (fb) gl.deleteFramebuffer(fb);
      for (const t of made) gl.deleteTexture(t);
      return null;
    }
    return { w, h, albedo, emissive, flat, sceneFb, light, lightFb, hdr, bright, compositeFb, halo, haloFb, top, topFb, bloom };
  }

  private deleteTargets(t: Targets): void {
    const gl = this.gl;
    for (const fb of [t.sceneFb, t.lightFb, t.compositeFb, t.haloFb, t.topFb]) gl.deleteFramebuffer(fb);
    for (const tex of [t.albedo, t.emissive, t.flat, t.light, t.hdr, t.bright, t.halo, t.top]) gl.deleteTexture(tex);
    for (const b of t.bloom) {
      gl.deleteFramebuffer(b.fb);
      gl.deleteTexture(b.tex);
    }
  }

  /** Upload `words` u32 words into a stream buffer (orphaning it first to avoid GPU sync stalls). */
  private uploadWords(buf: WebGLBuffer, slot: 0 | 1 | 2, data: Uint32Array | Float32Array, words: number): void {
    const gl = this.gl;
    const g = this.gpu!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    const bytes = words * 4;
    let cap = g.bufBytes[slot];
    if (bytes > cap) {
      cap = Math.max(bytes, cap * 2, 64 * 1024);
      g.bufBytes[slot] = cap;
    }
    gl.bufferData(gl.ARRAY_BUFFER, cap, gl.STREAM_DRAW);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, words);
  }

  /** Append a y-sorted copy of a layer into `dst` at word offset `o`; returns the new offset. */
  private appendSorted(list: InstanceList, dst: Uint32Array, o: number): number {
    const n = list.count;
    if (n === 0) return o;
    if (this.sortA.length < n) {
      let cap = this.sortA.length;
      while (cap < n) cap *= 2;
      this.sortA = new Uint32Array(cap);
      this.sortB = new Uint32Array(cap);
    }
    const order = radixSortIndices(list.keys, n, this.sortA, this.sortB);
    const src = list.u32;
    for (let i = 0; i < n; i++) {
      let s = order[i] * STRIDE;
      const end = s + STRIDE;
      while (s < end) dst[o++] = src[s++];
    }
    return o;
  }

  endFrame(post?: PostFx): void {
    if (this.disposed) return;
    this.recordParticles();
    const g = this.gpu;
    const gl = this.gl;
    if (g && g.targets && !this.lost && !gl.isContextLost()) this.draw(g, g.targets, post);
    const s = this.lastStats;
    s.drawCalls = this.drawCalls;
    s.sprites = this.frameSprites;
    s.particles = this.particles.count;
    s.lights = this.lightCount;
    // The frame is consumed; drawing without a new beginFrame() must not accumulate.
    for (const l of this.lists) l.reset();
    this.lightCount = 0;
    this.frameSprites = 0;
  }

  private draw(g: Gpu, t: Targets, post: PostFx | undefined): void {
    const gl = this.gl;
    const L = this.lists;
    const range = g.halfFloat ? 1 : LDR_RANGE;

    // --- 1. Scene (albedo + emissive + flat MRT), one instanced draw for every lit layer in order -------------
    const sceneCount = L[L_GROUND].count + L[L_DECAL].count + L[L_SHADOW].count + L[L_WORLD].count + L[L_FX].count;
    const up = this.upload.ensure(sceneCount * STRIDE);
    let o = 0;
    for (let li = L_GROUND; li <= L_SHADOW; li++) {
      // Unsorted layers are copied verbatim, in submission order.
      const n = L[li].count * STRIDE;
      if (n) up.set(L[li].u32.subarray(0, n), o);
      o += n;
    }
    o = this.appendSorted(L[L_WORLD], up, o);
    o = this.appendSorted(L[L_FX], up, o);

    gl.bindFramebuffer(gl.FRAMEBUFFER, t.sceneFb);
    gl.viewport(0, 0, t.w, t.h);
    gl.clearBufferfv(gl.COLOR, 0, this.zero4);
    gl.clearBufferfv(gl.COLOR, 1, this.clearColor);
    gl.clearBufferfv(gl.COLOR, 2, this.zero4);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const amb = this.ambient;
    if (sceneCount > 0) {
      this.uploadWords(g.sceneBuf, 0, up, sceneCount * STRIDE);
      gl.useProgram(g.sprite.program);
      gl.uniform2f(g.sprite.uniforms.uTarget, t.w, t.h);
      gl.uniform1i(g.sprite.uniforms.uUnlit, 0);
      gl.uniform3f(g.sprite.uniforms.uAmbient, amb[0], amb[1], amb[2]);
      this.bindAtlas(g);
      gl.bindVertexArray(g.sceneVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, sceneCount);
      this.drawCalls++;
    }

    // --- 2. Lights (additive) ------------------------------------------------------------------------------------
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.lightFb);
    gl.clearBufferfv(gl.COLOR, 0, this.zero4);
    if (this.lightCount > 0) {
      this.uploadWords(g.lightBuf, 2, this.lightData, this.lightCount * LIGHT_STRIDE);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(g.light.program);
      gl.uniform2f(g.light.uniforms.uTarget, t.w, t.h);
      gl.uniform1f(g.light.uniforms.uTime, this.time);
      gl.uniform1f(g.light.uniforms.uInvRange, 1 / range);
      gl.bindVertexArray(g.lightVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.lightCount);
      this.drawCalls++;
    }

    // --- 3. Composite: albedo × (ambient + light) + emissive → hdr + bright ------------------------------------
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.compositeFb);
    gl.useProgram(g.composite.program);
    gl.uniform3f(g.composite.uniforms.uAmbient, amb[0], amb[1], amb[2]);
    gl.uniform1f(g.composite.uniforms.uRange, range);
    gl.uniform1f(g.composite.uniforms.uBands, LIGHT_BANDS);
    gl.uniform1f(g.composite.uniforms.uHaze, LIGHT_HAZE);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t.albedo);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, t.emissive);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, t.light);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, t.flat);
    gl.bindVertexArray(g.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.drawCalls++;

    // --- 4. Bloom: tight virtual-pixel halo + dual-filter down/up chain on the bright pass ----------------------
    const bloomAmount = post?.bloom ?? 1;
    if (bloomAmount > 0) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.haloFb);
      gl.useProgram(g.halo.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, t.bright);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.drawCalls++;

      gl.useProgram(g.down.program);
      gl.activeTexture(gl.TEXTURE0);
      let src = t.bright;
      let sw = t.w;
      let sh = t.h;
      for (const lvl of t.bloom) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, lvl.fb);
        gl.viewport(0, 0, lvl.w, lvl.h);
        gl.bindTexture(gl.TEXTURE_2D, src);
        gl.uniform2f(g.down.uniforms.uTexel, 1 / sw, 1 / sh);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        this.drawCalls++;
        src = lvl.tex;
        sw = lvl.w;
        sh = lvl.h;
      }
      gl.useProgram(g.up.program);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = t.bloom.length - 2; i >= 0; i--) {
        const dst = t.bloom[i];
        const from = t.bloom[i + 1];
        gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
        gl.viewport(0, 0, dst.w, dst.h);
        gl.bindTexture(gl.TEXTURE_2D, from.tex);
        gl.uniform2f(g.up.uniforms.uTexel, 1 / from.w, 1 / from.h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        this.drawCalls++;
      }
      gl.disable(gl.BLEND);
    }

    // --- 5. Top overlay (unlit, crisp) ---------------------------------------------------------------------------
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.topFb);
    gl.viewport(0, 0, t.w, t.h);
    gl.clearBufferfv(gl.COLOR, 0, this.zero4);
    const topCount = L[L_TOP].count;
    if (topCount > 0) {
      this.uploadWords(g.topBuf, 1, L[L_TOP].u32, topCount * STRIDE);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(g.sprite.program);
      gl.uniform2f(g.sprite.uniforms.uTarget, t.w, t.h);
      gl.uniform1i(g.sprite.uniforms.uUnlit, 1);
      this.bindAtlas(g);
      gl.bindVertexArray(g.topVao);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, topCount);
      this.drawCalls++;
      gl.disable(gl.BLEND);
    }

    // --- 6. Final: nearest upscale with sub-pixel camera shift, bloom, grading, post, overlay ------------------
    const vp = this.vp;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, vp.deviceWidth, vp.deviceHeight);
    gl.useProgram(g.final.program);
    const u = g.final.uniforms;
    gl.uniform2f(u.uDevice, vp.deviceWidth, vp.deviceHeight);
    gl.uniform2f(u.uOffset, vp.offsetX, vp.offsetY);
    gl.uniform2f(u.uFrac, this.cam.fracX, this.cam.fracY);
    gl.uniform1f(u.uScale, vp.pixelScale);
    gl.uniform2f(u.uTargetSize, t.w, t.h);
    gl.uniform1f(u.uRange, range);
    gl.uniform1f(u.uBloomWide, BLOOM_WIDE * bloomAmount);
    gl.uniform1f(u.uBloomTight, BLOOM_TIGHT * bloomAmount);
    gl.uniform1f(u.uExposure, post?.exposure ?? 1);
    gl.uniform1f(u.uSaturation, post?.saturation ?? 1);
    gl.uniform1f(u.uVignette, post?.vignette ?? 0.5);
    gl.uniform1f(u.uChromatic, post?.chromatic ?? 0);
    const fl = post?.flash;
    if (fl && fl.alpha > 0) gl.uniform4f(u.uFlash, fl.color[0], fl.color[1], fl.color[2], Math.min(1, fl.alpha));
    else gl.uniform4f(u.uFlash, 0, 0, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, t.hdr);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, t.bloom[0].tex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, t.halo);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, t.top);
    gl.bindVertexArray(g.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.drawCalls++;
    gl.bindVertexArray(null);
  }

  private bindAtlas(g: Gpu): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, g.atlasAlbedo);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, g.atlasEmissive);
  }

  stats(): RenderStats {
    return { ...this.lastStats };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
    this.observer?.disconnect();
    this.observer = null;
    const g = this.gpu;
    const gl = this.gl;
    if (g && !gl.isContextLost()) {
      if (g.targets) this.deleteTargets(g.targets);
      for (const p of [g.sprite, g.light, g.composite, g.halo, g.down, g.up, g.final]) gl.deleteProgram(p.program);
      for (const v of [g.sceneVao, g.topVao, g.lightVao, g.emptyVao]) gl.deleteVertexArray(v);
      for (const b of [g.sceneBuf, g.topBuf, g.lightBuf]) gl.deleteBuffer(b);
      if (g.atlasAlbedo) gl.deleteTexture(g.atlasAlbedo);
      if (g.atlasEmissive) gl.deleteTexture(g.atlasEmissive);
    }
    this.gpu = null;
    this.particles.clear();
    for (const l of this.lists) l.reset();
    this.lightCount = 0;
  }
}
