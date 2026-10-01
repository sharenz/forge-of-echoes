// The Ember Chart renderer (brief A): plain 2D canvases, no engine library. Ground, fog, roads, node plates,
// particles and the discovery cinematic are drawn from the art in src/art/atlas at an integer zoom (1x/2x/3x) so
// pixel art never smears. All text is DOM (names, banners, tooltips); this file draws none.
import type { AtlasAreaId } from '../../contracts/atlas';
import type { SpriteDef } from '../../contracts/art';
import { ATLAS_AREAS, findAtlasArea } from '../../data/progression/atlas';
import { bakeChartSteps, type ChartLayers } from '../../art/atlas/ground';
import {
  ATLAS_EDGES, ATLAS_POS, CHART_H, CHART_W, KEY_COLOUR, edgeKey, pathLength, plumeAreas, pointAt, roadKind, roadPoints, THEMES,
  type Edge, type RoadKind,
} from '../../art/atlas/geometry';
import {
  chainFrame, crownFrame, doorFrame, gemFrame, haloRaster, lanternFrame, newFlagFrame, nodeFrame, pipFrame, plumeFrame, portalFrame, sealFrame,
} from '../../art/atlas/plates';
import { octagonPixels, paintRoad, type Pt } from '../../art/atlas/roads';
import { drawFrameSurface, frameToSurface, newCanvas, rasterToCanvas, ctx2d, type FrameSurface, type Surface } from '../../art/atlas/canvas';
import type { Frame } from '../../art/frame';
import { C, hexToColor } from '../../art/palette';
import { Raster, ca, cb, cg, cr, luma, mix, rgba } from '../../art/raster';
import { valueNoise } from '../../art/shade';
import { NODE_REVEAL_R, ROAD_REVEAL_R, SEALED_REVEAL_R, computeReveal, type Disc } from './reveal';
import { ParticleField, type Emitter } from './particles';
import { nodeModel, type ChartContext, type NodeModel } from './model';
import { drawLensLayer, type LensInput } from './lens-draw';
import { drawSurgePips } from './surge-view';

// ---- assets ----------------------------------------------------------------------------------------------
export class ChartAssets {
  layers!: ChartLayers;
  unknown!: Surface;
  known!: Surface;
  glow!: Surface;
  glint!: Surface;
  frame!: Surface;
  soot!: Surface;
  private nodes = new Map<string, FrameSurface>();
  private halos = new Map<string, Surface>();
  private misc = new Map<string, FrameSurface>();
  private spriteFrames = new Map<string, FrameSurface[]>();

  constructor(private sprites: readonly SpriteDef[]) {}

  static async load(sprites: readonly SpriteDef[]): Promise<ChartAssets> {
    const a = new ChartAssets(sprites);
    const it = bakeChartSteps(sprites);
    for (;;) {
      const r = it.next();
      if (r.done) { a.layers = r.value; break; }
      await new Promise<void>((res) => setTimeout(res, 0));
    }
    a.unknown = rasterToCanvas(a.layers.unknown);
    a.known = rasterToCanvas(a.layers.known);
    a.glow = rasterToCanvas(a.layers.glow);
    a.glint = rasterToCanvas(a.layers.glint);
    a.frame = rasterToCanvas(a.layers.frame);
    a.soot = sootCanvas();
    return a;
  }

  node(model: NodeModel, shallow: boolean): FrameSurface {
    const theme = model.area.baseId;
    const key = `${model.material}|${model.rivets}|${theme}|${shallow ? 1 : 0}`;
    let s = this.nodes.get(key);
    if (!s) {
      const f = nodeFrame(model.material, model.rivets, theme);
      if (shallow) desaturate(f, 0.62);
      s = frameToSurface(f);
      this.nodes.set(key, s);
    }
    return s;
  }
  halo(hex: string): Surface {
    let s = this.halos.get(hex);
    if (!s) { s = rasterToCanvas(haloRaster(hexToColor(hex))); this.halos.set(hex, s); }
    return s;
  }
  small(key: string, make: () => Frame): FrameSurface {
    let s = this.misc.get(key);
    if (!s) { s = frameToSurface(make()); this.misc.set(key, s); }
    return s;
  }
  door(keyId: string, ajar: boolean): FrameSurface {
    return this.small(`door|${keyId}|${ajar}`, () => doorFrame(hexToColor(KEY_COLOUR[keyId] ?? '#c07bff'), ajar));
  }
  sprite(id: string): { def: SpriteDef; frames: FrameSurface[] } | null {
    const def = this.sprites.find((s) => s.id === id);
    if (!def) return null;
    let frames = this.spriteFrames.get(id);
    if (!frames) {
      frames = def.frames.map((im, i) => {
        const c = rasterToCanvas(new Raster(im.width, im.height, new Uint8ClampedArray(im.data)));
        const e = def.emissive?.[i];
        return { color: c, glow: e ? rasterToCanvas(new Raster(e.width, e.height, new Uint8ClampedArray(e.data))) : null, w: im.width, h: im.height };
      });
      this.spriteFrames.set(id, frames);
    }
    return { def, frames };
  }
}

function desaturate(f: Frame, k: number): void {
  f.c.map((c) => {
    const l = luma(c) * 255 * 0.85;
    return (mix(c, rgba(l, l * 0.97, l * 0.93, 255), k) & 0xffffff00) | ca(c);
  });
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) if (f.e.opaque(x, y)) f.e.set(x, y, 0);
}

function sootCanvas(): Surface {
  const w = 320, h = 180;
  const r = new Raster(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const n = valueNoise(x, y, 40, 901, 8) * 0.6 + valueNoise(x, y, 20, 902, 16) * 0.28 + valueNoise(x, y, 10, 903, 32) * 0.12;
    const a = Math.max(0, Math.min(1, (n - 0.36) * 2.2));
    if (a <= 0.02) continue;
    r.set(x, y, mix(C.coal, C.char, n) & 0xffffff00 | Math.round(a * 200));
  }
  // upscale 2x nearest so it tiles at 640x360
  const big = new Raster(w * 2, h * 2);
  for (let y = 0; y < h * 2; y++) for (let x = 0; x < w * 2; x++) big.set(x, y, r.get(x >> 1, y >> 1));
  return rasterToCanvas(big);
}

// ---- state -----------------------------------------------------------------------------------------------
export interface ChartInput {
  ctx: ChartContext;
  selected: AtlasAreaId | null;
  hovered: AtlasAreaId | null;
  /** The destination set on the device (drawn as a small pennant). */
  course: AtlasAreaId | null;
  reduceMotion: boolean;
  /** The area an open portal leads to: it wears a portal glyph. */
  portal?: AtlasAreaId | null;
  /** Screen-space spots (CSS px inside the chart) where the owned keys sit: a dashed thread runs from each to its door. */
  keyAnchors?: readonly { keyId: string; x: number; y: number }[];
  /** Chart lenses (src/ui/atlas/lens.ts): pins on every lens, the Sources arrows on its own. */
  lens?: LensInput;
}

export interface CineItem { id: AtlasAreaId; from: AtlasAreaId | null; start: number }
interface CineState { items: CineItem[]; t: number; total: number; skipped: boolean; instant: boolean }

const ease = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const RUN_SPEED = 240;
const STAGGER = 0.7;

export interface RendererEvents {
  /** The ember run or forge-in of a node just landed (for sounds). */
  onBeat?(beat: 'depart' | 'arrive' | 'forge', id: AtlasAreaId): void;
  onCinematicDone?(ids: AtlasAreaId[]): void;
  onTransform?(ox: number, oy: number, zoom: number): void;
}

export class ChartRenderer {
  zoom: 1 | 2 | 3 = 2;
  camX = CHART_W / 2;
  camY = CHART_H / 2;
  private tx = CHART_W / 2;
  private ty = CHART_H / 2;
  private vw = 800;
  private vh = 500;
  private dpr = 1;
  private input: ChartInput | null = null;
  private models: NodeModel[] = [];
  private composed = newCanvas(CHART_W, CHART_H);
  private mask = newCanvas(CHART_W, CHART_H);
  private soft = newCanvas(CHART_W, CHART_H);
  private rim = newCanvas(CHART_W, CHART_H);
  private roads = newCanvas(CHART_W, CHART_H);
  private fog = newCanvas(CHART_W, CHART_H);
  private live = newCanvas(CHART_W, CHART_H);
  private tmp = newCanvas(CHART_W, CHART_H);
  private snapshot: Surface | null = null;
  private snapshotT = 0;
  private particles = new ParticleField();
  private emitters: Emitter[] = [];
  private cine: CineState | null = null;
  private cineProgress = new Map<AtlasAreaId, { reveal: number; forge: number; road: number }>();
  private cineBeats = new Set<string>();
  private last = 0;
  private raf = 0;
  private time = 0;
  private dragging = false;
  private revealKey = '';
  private lastOx = NaN;
  private lastOy = NaN;
  private lastZoom = 0;
  private forgeBursts: { x: number; y: number; t: number }[] = [];
  private flares: { id: AtlasAreaId; t: number; calm: boolean }[] = [];
  private bg: CanvasPattern | null = null;
  readonly ringPixels = octagonPixels(23.5);
  readonly ring2Pixels = octagonPixels(24.5);
  readonly wellPixels = octagonPixels(13);

  constructor(private canvas: HTMLCanvasElement, private assets: ChartAssets, private events: RendererEvents = {}) {}

  // ---- lifecycle -------------------------------------------------------------------------------------------
  start(): void {
    if (this.raf) return;
    const loop = (now: number): void => {
      this.raf = requestAnimationFrame(loop);
      const busy = !!this.cine || this.snapshot || Math.abs(this.camX - this.tx) > 0.05 || Math.abs(this.camY - this.ty) > 0.05 || this.dragging;
      if (now - this.last < (busy ? 15 : 32)) return;
      const dt = Math.min(0.1, (now - this.last) / 1000 || 0.016);
      this.last = now;
      this.frame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop(): void { cancelAnimationFrame(this.raf); this.raf = 0; }

  resize(w: number, h: number, dpr: number): void {
    this.vw = Math.max(64, Math.round(w));
    this.vh = Math.max(64, Math.round(h));
    this.dpr = Math.max(1, dpr);
    this.canvas.width = Math.round(this.vw * this.dpr);
    this.canvas.height = Math.round(this.vh * this.dpr);
    this.clampTarget();
  }

  get viewport(): { w: number; h: number } { return { w: this.vw, h: this.vh }; }

  // ---- camera ----------------------------------------------------------------------------------------------
  private clamp(x: number, y: number, z = this.zoom): [number, number] {
    // a few px of give at the edge, never a void: the zoom floor (fillZoom in model.ts) keeps the chart covering the view
    const over = 8 / z;
    const hx = this.vw / (2 * z), hy = this.vh / (2 * z);
    const cl = (v: number, size: number, half: number): number => (size + 2 * over <= half * 2 ? size / 2 : Math.max(half - over, Math.min(size - half + over, v)));
    return [cl(x, CHART_W, hx), cl(y, CHART_H, hy)];
  }
  private clampTarget(): void {
    [this.tx, this.ty] = this.clamp(this.tx, this.ty);
    [this.camX, this.camY] = this.clamp(this.camX, this.camY);
  }
  panTo(x: number, y: number, instant = false): void {
    [this.tx, this.ty] = this.clamp(x, y);
    if (instant) { this.camX = this.tx; this.camY = this.ty; }
  }
  panByScreen(dx: number, dy: number): void {
    this.tx -= dx / this.zoom; this.ty -= dy / this.zoom;
    [this.tx, this.ty] = this.clamp(this.tx, this.ty);
    this.camX = this.tx; this.camY = this.ty;
  }
  setDragging(on: boolean): void { this.dragging = on; }
  /** Activation: the chosen node flares (a white-hot plate, a ring and sparks; a quiet fade when calm). */
  flare(id: AtlasAreaId): void {
    const calm = !!this.input?.reduceMotion;
    this.flares.push({ id, t: 0, calm });
    if (!calm) { const p = ATLAS_POS[id]; this.forgeBursts.push({ x: p.x, y: p.y, t: 0 }); }
  }
  setZoom(z: 1 | 2 | 3, focus?: { x: number; y: number }, instant = false): void {
    if (z === this.zoom) return;
    if (!instant && this.input && !this.input.reduceMotion) this.captureSnapshot();
    this.zoom = z;
    if (focus) { this.tx = focus.x; this.ty = focus.y; }
    [this.tx, this.ty] = this.clamp(this.tx, this.ty);
    this.camX = this.tx; this.camY = this.ty;
  }
  get center(): { x: number; y: number } { return { x: this.camX, y: this.camY }; }
  artToScreen(x: number, y: number): { x: number; y: number } {
    return { x: Math.round(this.vw / 2 - this.camX * this.zoom) + x * this.zoom, y: Math.round(this.vh / 2 - this.camY * this.zoom) + y * this.zoom };
  }
  private captureSnapshot(): void {
    const s = newCanvas(this.canvas.width, this.canvas.height);
    s.getContext('2d')!.drawImage(this.canvas, 0, 0);
    this.snapshot = s;
    this.snapshotT = 0.14;
  }

  // ---- input -----------------------------------------------------------------------------------------------
  setInput(next: ChartInput): void {
    const prev = this.input;
    this.input = next;
    this.models = ATLAS_AREAS.map((a) => nodeModel(a, next.ctx));
    const key = [...next.ctx.discovered].sort().join(',') + '|' + [...next.ctx.completed].sort().join(',');
    if (!this.cine && (key !== this.revealKey || !prev)) this.rebuildReveal();
    if (!this.cine) this.rebuildRoads();
    this.emitters = this.computeEmitters();
  }

  private computeEmitters(): Emitter[] {
    const out: Emitter[] = [];
    const vis = (x: number, y: number): boolean => this.isRevealedAt(x, y);
    for (const e of this.assets.layers.emitters) if (vis(e.x, e.y)) out.push({ x: e.x, y: e.y, kind: e.kind });
    for (const m of this.models) {
      if (m.completed) out.push({ x: m.x, y: m.y - 10, kind: 'node' });
      if (m.known && m.area.sealed) out.push({ x: m.x, y: m.y, kind: 'void' });
    }
    return out;
  }

  private revealPixels: Uint8Array | null = null;
  private isRevealedAt(x: number, y: number): boolean {
    if (!this.revealPixels) return false;
    x = Math.floor(x); y = Math.floor(y);
    return x >= 0 && y >= 0 && x < CHART_W && y < CHART_H && this.revealPixels[y * CHART_W + x] > 0;
  }

  // ---- cinematic -------------------------------------------------------------------------------------------
  startCinematic(items: CineItem[], instant: boolean): void {
    if (!items.length) return;
    const total = Math.max(...items.map((i) => i.start + this.itemDuration(i))) + 0.1;
    this.cine = { items, t: 0, total: instant ? 0.2 : total, skipped: false, instant };
    this.cineBeats.clear();
    this.cineProgress.clear();
    this.rebuildRoads();
    this.rebuildReveal();
  }
  get cinematic(): boolean { return !!this.cine; }
  skipCinematic(): void { if (this.cine) this.cine.t = this.cine.total; }
  private itemDuration(i: CineItem): number {
    const len = i.from ? pathLength(roadPoints(i.from, i.id)) : 0;
    return 0.3 + len / RUN_SPEED + 0.75;
  }
  private itemTimes(i: CineItem): { run: number; reveal: number; forge: number; len: number } {
    const len = i.from ? pathLength(roadPoints(i.from, i.id)) : 0;
    return { len, run: 0.3 + len / RUN_SPEED, reveal: 0.6, forge: 0.25 };
  }

  private advanceCinematic(dt: number): void {
    const cine = this.cine;
    if (!cine) return;
    cine.t += dt;
    this.cineProgress.clear();
    for (const it of cine.items) {
      const local = cine.t - it.start;
      const tm = this.itemTimes(it);
      if (cine.instant) {
        const k = Math.min(1, cine.t / 0.18);
        this.cineProgress.set(it.id, { road: 1, reveal: k, forge: k });
        continue;
      }
      const road = it.from ? Math.min(1, Math.max(0, (local - 0.3) / (tm.run - 0.3))) : 1;
      const reveal = ease((local - tm.run) / tm.reveal);
      const forge = Math.min(1, Math.max(0, (local - tm.run - tm.reveal * 0.55) / tm.forge));
      this.cineProgress.set(it.id, { road, reveal, forge });
      if (local >= 0 && !this.cineBeats.has(`d${it.id}`)) { this.cineBeats.add(`d${it.id}`); this.events.onBeat?.('depart', it.id); }
      if (local >= tm.run && !this.cineBeats.has(`a${it.id}`)) { this.cineBeats.add(`a${it.id}`); this.events.onBeat?.('arrive', it.id); }
      if (forge > 0.3 && !this.cineBeats.has(`f${it.id}`)) {
        this.cineBeats.add(`f${it.id}`); this.events.onBeat?.('forge', it.id);
        const p = ATLAS_POS[it.id];
        this.forgeBursts.push({ x: p.x, y: p.y, t: 0 });
      }
    }
    // the camera follows the first unfinished run
    const active = cine.items.find((i) => (this.cineProgress.get(i.id)?.forge ?? 0) < 1) ?? cine.items[cine.items.length - 1];
    const pr = this.cineProgress.get(active.id);
    const from = active.from ? ATLAS_POS[active.from] : ATLAS_POS[active.id];
    const to = ATLAS_POS[active.id];
    const k = pr ? pr.road : 1;
    this.panTo(from.x + (to.x - from.x) * k * 0.6, from.y + (to.y - from.y) * k * 0.6);
    this.rebuildReveal();
    if (cine.t >= cine.total) {
      const ids = cine.items.map((i) => i.id);
      this.cine = null;
      this.cineProgress.clear();
      this.rebuildReveal();
      this.rebuildRoads();
      this.events.onCinematicDone?.(ids);
    }
  }

  // ---- reveal, roads ---------------------------------------------------------------------------------------
  private rebuildReveal(): void {
    if (!this.input) return;
    const { ctx } = this.input;
    const cine = this.cine;
    const cineIds = new Set(cine?.items.map((i) => i.id));
    const discs: Disc[] = [];
    const trail: Disc[] = [];
    for (const a of ATLAS_AREAS) {
      if (!ctx.discovered.has(a.id)) continue;
      const p = ATLAS_POS[a.id];
      const base = a.sealed ? SEALED_REVEAL_R : NODE_REVEAL_R;
      const pr = cineIds.has(a.id) ? this.cineProgress.get(a.id) : null;
      discs.push({ x: p.x, y: p.y, r: base * (pr ? pr.reveal : 1) });
    }
    for (const e of ATLAS_EDGES) {
      const a = findAtlasArea(e.a)!, b = findAtlasArea(e.b)!;
      const kind = roadKind(a, b, ctx.discovered, ctx.completed);
      if (kind === 'hidden') continue;
      const pts = roadPoints(e.a, e.b, 8);
      const total = pathLength(pts);
      let upto = total;
      if (kind === 'stub') upto = total * 0.55;
      const cineItem = cine?.items.find((i) => i.from && ((i.from === e.a && i.id === e.b) || (i.from === e.b && i.id === e.a)));
      if (cineItem) upto = total * (this.cineProgress.get(cineItem.id)?.road ?? 0);
      // stub roads run from the completed end only
      const fromEnd = kind === 'stub' && ctx.completed.has(e.b) && !ctx.completed.has(e.a);
      for (let d = 0; d <= upto; d += 8) {
        const p = fromEnd || (cineItem && cineItem.from === e.b) ? pointAt(pts, total - d) : pointAt(pts, d);
        trail.push({ x: p.x, y: p.y, r: ROAD_REVEAL_R });
      }
    }
    const rv = computeReveal({ discs, trail });
    this.revealPixels = rv.alpha;
    // mask canvas
    const mctx = ctx2d(this.mask);
    const id = mctx.createImageData(CHART_W, CHART_H);
    const rimId = ctx2d(this.rim).createImageData(CHART_W, CHART_H);
    for (let i = 0; i < rv.alpha.length; i++) {
      if (!rv.alpha[i]) continue;
      id.data[i * 4 + 3] = 255;
      const r = rv.rim[i];
      if (r) {
        const c = r === 3 ? C.hot : r === 2 ? C.flame : C.ember;
        rimId.data[i * 4] = cr(c); rimId.data[i * 4 + 1] = cg(c); rimId.data[i * 4 + 2] = cb(c); rimId.data[i * 4 + 3] = r === 3 ? 255 : r === 2 ? 210 : 140;
      }
    }
    mctx.putImageData(id, 0, 0);
    ctx2d(this.rim).putImageData(rimId, 0, 0);
    // soft mask for the fog haze
    const sctx = ctx2d(this.soft);
    sctx.clearRect(0, 0, CHART_W, CHART_H);
    sctx.filter = 'blur(3px)';
    sctx.drawImage(this.mask, 0, 0);
    sctx.filter = 'none';
    // composed ground: vellum, then the painted chart through the mask
    const cctx = ctx2d(this.composed);
    cctx.globalCompositeOperation = 'source-over';
    cctx.drawImage(this.assets.unknown, 0, 0);
    const t = ctx2d(this.tmp);
    t.globalCompositeOperation = 'source-over';
    t.clearRect(0, 0, CHART_W, CHART_H);
    t.drawImage(this.assets.known, 0, 0);
    t.globalCompositeOperation = 'destination-in';
    t.drawImage(this.mask, 0, 0);
    t.globalCompositeOperation = 'source-over';
    cctx.drawImage(this.tmp, 0, 0);
    if (!cine) this.revealKey = [...ctx.discovered].sort().join(',') + '|' + [...ctx.completed].sort().join(',');
  }

  private edgeStates(): { e: Edge; kind: RoadKind; pts: Pt[]; lit: boolean }[] {
    if (!this.input) return [];
    const { ctx, selected } = this.input;
    return ATLAS_EDGES.map((e) => {
      const a = findAtlasArea(e.a)!, b = findAtlasArea(e.b)!;
      return { e, kind: roadKind(a, b, ctx.discovered, ctx.completed), pts: roadPoints(e.a, e.b), lit: !!selected && (e.a === selected || e.b === selected) };
    });
  }

  private rebuildRoads(): void {
    const r = new Raster(CHART_W, CHART_H);
    const skip = new Set<string>();
    if (this.cine) for (const i of this.cine.items) if (i.from) skip.add(edgeKey(i.from, i.id));
    for (const { e, kind, pts, lit } of this.edgeStates()) {
      if (skip.has(e.key)) continue;
      if (kind === 'stub') {
        const ctx = this.input!.ctx;
        const fromEnd = ctx.completed.has(e.b) && !ctx.completed.has(e.a);
        const total = pathLength(pts);
        const ordered = fromEnd ? [...pts].reverse() : pts;
        paintRoad(r, ordered, 'stub', false, total * 0.55);
      } else paintRoad(r, pts, kind, lit);
    }
    const c = ctx2d(this.roads);
    c.clearRect(0, 0, CHART_W, CHART_H);
    const id = c.createImageData(CHART_W, CHART_H);
    id.data.set(r.data);
    c.putImageData(id, 0, 0);
  }

  // ---- frame -----------------------------------------------------------------------------------------------
  private frame(dt: number): void {
    if (!this.input) return;
    this.time += dt;
    const z = this.zoom;
    const motion = !this.input.reduceMotion;
    if (this.cine) this.advanceCinematic(dt);
    else {
      const k = 1 - Math.exp(-dt * 12);
      this.camX += (this.tx - this.camX) * k;
      this.camY += (this.ty - this.camY) * k;
      if (Math.abs(this.camX - this.tx) < 0.02) this.camX = this.tx;
      if (Math.abs(this.camY - this.ty) < 0.02) this.camY = this.ty;
    }
    const ox = Math.round(this.vw / 2 - this.camX * z);
    const oy = Math.round(this.vh / 2 - this.camY * z);
    if (ox !== this.lastOx || oy !== this.lastOy || z !== this.lastZoom) {
      this.lastOx = ox; this.lastOy = oy; this.lastZoom = z;
      this.events.onTransform?.(ox, oy, z);
    }
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#0a080b';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const s = z * this.dpr;
    ctx.setTransform(s, 0, 0, s, ox * this.dpr, oy * this.dpr);
    // beyond the chart (a very large window) the vellum continues, darkened, so the view never floats in a black void
    if (ox > 0 || oy > 0 || ox + CHART_W * z < this.vw || oy + CHART_H * z < this.vh) {
      this.bg ??= ctx.createPattern(this.assets.unknown, 'repeat');
      if (this.bg) { ctx.fillStyle = this.bg; ctx.fillRect(-ox / z - 2, -oy / z - 2, this.vw / z + 4, this.vh / z + 4); }
      ctx.fillStyle = 'rgba(8, 6, 9, 0.62)';
      ctx.fillRect(-ox / z - 2, -oy / z - 2, this.vw / z + 4, this.vh / z + 4);
    }
    const t = this.time;

    // ground and roads
    ctx.drawImage(this.composed, 0, 0);
    ctx.drawImage(this.roads, 0, 0);
    this.drawLiveLayer(ctx, t, motion);
    this.drawRoadLife(ctx, t, motion);
    this.drawFog(ctx, t, motion);
    // burn line
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (this.cine ? 0.95 : 0.55) + (motion ? Math.sin(t * 2.2) * 0.15 : 0);
    ctx.drawImage(this.rim, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    this.drawPlumes(ctx, t, motion);
    this.drawNodes(ctx, t, motion);
    drawLensLayer(ctx, this.input.lens, this.models, t, motion, { halo: (hex) => this.assets.halo(hex) });
    this.drawOverlays(ctx, dt, t, motion);
    this.drawCineRun(ctx);
    this.drawParticles(ctx, dt, ox, oy, motion);
    this.drawKeyThreads(ctx, t, motion);
    ctx.setTransform(s, 0, 0, s, ox * this.dpr, oy * this.dpr);
    ctx.drawImage(this.assets.frame, 0, 0);
    // zoom cross-scale: the previous frame fades out over 140 ms
    if (this.snapshot) {
      this.snapshotT -= dt;
      if (this.snapshotT <= 0) this.snapshot = null;
      else {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = Math.max(0, this.snapshotT / 0.14);
        ctx.drawImage(this.snapshot, 0, 0);
        ctx.globalAlpha = 1;
      }
    }
  }

  private drawLiveLayer(ctx: CanvasRenderingContext2D, t: number, motion: boolean): void {
    const l = ctx2d(this.live);
    l.globalCompositeOperation = 'source-over';
    l.clearRect(0, 0, CHART_W, CHART_H);
    l.globalAlpha = motion ? 0.28 + 0.24 * (0.5 + 0.5 * Math.sin(t * 1.5)) : 0.36;
    l.drawImage(this.assets.glow, 0, 0);
    l.globalAlpha = motion ? 0.35 + 0.65 * Math.abs(Math.sin(t * 2.7)) : 0.7;
    l.drawImage(this.assets.glint, 0, 0);
    l.globalAlpha = 1;
    for (const p of this.assets.layers.animated) {
      const sp = this.assets.sprite(`prop/${p.id}`);
      if (!sp) continue;
      const fi = motion ? Math.floor(t * sp.def.fps + p.phase * 1.7) % sp.frames.length : 0;
      drawFrameSurface(l, sp.frames[fi], p.x - sp.def.anchorX, p.y - sp.def.anchorY, 1);
      if (p.id === 'brazier') {
        // a warm pool of light on the ground under each brazier
        l.globalCompositeOperation = 'lighter';
        l.fillStyle = '#ff9a3c';
        const flick = motion ? 0.03 * Math.sin(t * 9 + p.phase) : 0;
        for (const [rx, ry, a] of [[16, 6, 0.05], [11, 4, 0.06], [6, 2.4, 0.08]] as const) {
          l.globalAlpha = a + flick;
          l.beginPath();
          l.ellipse(p.x, p.y - 1, rx, ry, 0, 0, Math.PI * 2);
          l.fill();
        }
        l.globalCompositeOperation = 'source-over';
        l.globalAlpha = 1;
      }
    }
    l.globalCompositeOperation = 'destination-in';
    l.drawImage(this.mask, 0, 0);
    l.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.live, 0, 0);
  }

  /** Ember dots travel down walked roads in the direction of depth. */
  private drawRoadLife(ctx: CanvasRenderingContext2D, t: number, motion: boolean): void {
    if (!motion || !this.input) return;
    ctx.globalCompositeOperation = 'lighter';
    for (const { e, kind, pts } of this.edgeStates()) {
      if (kind !== 'walked') continue;
      const a = findAtlasArea(e.a)!, b = findAtlasArea(e.b)!;
      const forward = a.depth <= b.depth;
      const len = pathLength(pts);
      const n = Math.max(1, Math.round(len / 46));
      for (let k = 0; k < n; k++) {
        const phase = ((t * 11 + k * (len / n) + e.a.length * 7) % len + len) % len;
        const p = pointAt(pts, forward ? phase : len - phase);
        ctx.globalAlpha = 0.85;
        ctx.fillStyle = '#ff9a3c';
        ctx.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 2, 2);
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = '#e8662a';
        ctx.fillRect(Math.round(p.x) - 2, Math.round(p.y) - 2, 4, 4);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawFog(ctx: CanvasRenderingContext2D, t: number, motion: boolean): void {
    const f = ctx2d(this.fog);
    f.globalCompositeOperation = 'source-over';
    f.clearRect(0, 0, CHART_W, CHART_H);
    const draw = (dx: number, dy: number, a: number): void => {
      f.globalAlpha = a;
      const ox = ((Math.round(dx) % CHART_W) + CHART_W) % CHART_W, oy = ((Math.round(dy) % CHART_H) + CHART_H) % CHART_H;
      for (const [ax, ay] of [[0, 0], [-CHART_W, 0], [0, -CHART_H], [-CHART_W, -CHART_H]] as const) f.drawImage(this.assets.soot, ox + ax, oy + ay);
    };
    const m = motion ? t : 0;
    draw(m * 4, m * 1.5, 0.95);
    draw(-m * 2.5 + 200, m * 3 + 90, 0.7);
    f.globalAlpha = 1;
    f.globalCompositeOperation = 'destination-out';
    f.drawImage(this.soft, 0, 0);
    f.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.fog, 0, 0);
  }

  private drawPlumes(ctx: CanvasRenderingContext2D, t: number, motion: boolean): void {
    if (!this.input) return;
    const { discovered, completed } = this.input.ctx;
    for (const id of plumeAreas(discovered, completed)) {
      if (this.cine?.items.some((i) => i.id === id)) continue;
      const p = ATLAS_POS[id];
      const fi = motion ? Math.floor(t * 3 + id.length) % 4 : 0;
      const s = this.assets.small(`plume${fi}`, () => plumeFrame(fi));
      drawFrameSurface(ctx, s, p.x - 9, p.y - 34, 1);
      // a faint ember pool where it burns
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.16 + (motion ? 0.05 * Math.sin(t * 3 + id.length) : 0);
      ctx.fillStyle = '#e8662a';
      ctx.fillRect(p.x - 6, p.y + 3, 12, 3);
      ctx.fillRect(p.x - 3, p.y + 1, 6, 8);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  private drawNodes(ctx: CanvasRenderingContext2D, t: number, motion: boolean): void {
    if (!this.input) return;
    const { selected, hovered } = this.input;
    const corrupted = this.input.ctx.corrupted;
    const order = [...this.models].filter((m) => m.known).sort((a, b) => a.y - b.y);
    for (const m of order) {
      const pr = this.cineProgress.get(m.id);
      if (this.cine && pr && pr.forge <= 0) continue; // still under the fog
      const forge = pr ? pr.forge : 1;
      const sel = selected === m.id;
      const hov = hovered === m.id;
      const theme = THEMES[m.area.baseId];
      const cx = Math.round(m.x), cy = Math.round(m.y);
      const pulse = motion ? 0.5 + 0.5 * Math.sin(t * (Math.PI * 2) / 1.6 + m.x * 0.07) : 0.6;
      if (m.kind === 'sealedLocked' || m.kind === 'sealedKeyed') {
        this.drawSealed(ctx, m, cx, cy, t, motion, sel, hov, forge);
        continue;
      }
      // spur lantern
      if (m.deadEnd) {
        const lf = motion ? Math.floor(t * 6 + m.x) & 1 : 0;
        const s = this.assets.small(`lantern${lf}`, () => lanternFrame(lf));
        const parentX = m.area.neighbours.length ? ATLAS_POS[m.area.neighbours[0]].x : m.x;
        drawFrameSurface(ctx, s, cx + (parentX < m.x ? 22 : -34), cy - 6, 1);
      }
      // halo
      const dim = m.tooShallow ? 0.25 : m.completed ? 0.4 : 0.6 + pulse * 0.28;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, (sel ? 0.95 : hov ? 0.85 : dim)) * forge;
      ctx.drawImage(this.assets.halo(theme.glow), cx - 32, cy - 32);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      // plate
      const surf = this.assets.node(m, m.tooShallow);
      const size = forge < 1 ? Math.round(42 * (1.24 - 0.24 * ease(forge)) / 2) * 2 : 42;
      ctx.globalAlpha = forge < 1 ? 0.4 + forge * 0.6 : 1;
      if (size !== 42) {
        ctx.drawImage(surf.color, cx - size / 2, cy - size / 2, size, size);
        if (surf.glow) { ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(surf.glow, cx - size / 2, cy - size / 2, size, size); ctx.globalCompositeOperation = 'source-over'; }
      } else drawFrameSurface(ctx, surf, cx - 21, cy - 21, motion ? 0.75 + 0.25 * pulse : 0.85);
      ctx.globalAlpha = 1;
      // state light: an ember ring pulses on available nodes, a steady bone ring marks the cleared
      if (m.completed) {
        this.pixels(ctx, this.wellPixels, cx, cy, '#cbbfa8', 0.9);
        const seal = this.assets.small('seal', sealFrame);
        drawFrameSurface(ctx, seal, cx + 7, cy + 8, 1);
        if (motion && Math.floor(t / 4 + m.x) % 2 === 0 && (t % 4) < 0.05) this.particles.list.push({ kind: 'ember', x: cx + (m.x % 7) - 3, y: cy - 8, vx: 0, vy: -12, age: 0, life: 1.8, size: 1 });
      } else if (m.tooShallow) {
        // nothing: a shallow node has no light of its own
      } else {
        ctx.globalCompositeOperation = 'lighter';
        this.pixels(ctx, this.ringPixels, cx, cy, sel ? '#ffe7a8' : '#ff9a3c', (sel ? 0.9 : 0.35 + 0.5 * pulse) * forge);
        ctx.globalCompositeOperation = 'source-over';
      }
      if (m.tooShallow) drawFrameSurface(ctx, this.assets.small('chain', chainFrame), cx - 8, cy + 18, 1);
      // tier pips
      const material = m.material;
      for (let i = 0; i < 5; i++) {
        const lit = i <= m.band;
        const pf = this.assets.small(`pip|${lit ? 1 : 0}|${material}`, () => pipFrame(lit, material));
        drawFrameSurface(ctx, pf, cx - 22 + i * 9, cy + 22, 1, m.tooShallow ? 0.55 : 1);
      }
      drawSurgePips(ctx, m.id, cx, cy, 31, m.tooShallow ? 0.55 : 1);
      // boss crowns
      const crown = this.assets.small('crown', crownFrame);
      const cn = m.crowns;
      for (let i = 0; i < cn; i++) drawFrameSurface(ctx, crown, cx - (cn === 2 ? 13 : 6) + i * 13, cy - 31, 1);
      if (motion && cn && (Math.floor(t * 1.3 + m.x) % 5) === 0) { ctx.fillStyle = '#fbf4e6'; ctx.fillRect(cx - 6 + (Math.floor(t * 5) % 12), cy - 30, 1, 1); }
      // the course pennant: a gold flag on a bone pole where the device is pointed
      if (this.input.course === m.id) {
        ctx.fillStyle = '#cbbfa8'; ctx.fillRect(cx - 25, cy - 36, 1, 12);
        ctx.fillStyle = '#e0b04a'; ctx.fillRect(cx - 24, cy - 36, 7, 3); ctx.fillRect(cx - 24, cy - 33, 5, 2); ctx.fillRect(cx - 24, cy - 31, 3, 1);
        ctx.fillStyle = '#b8862f'; ctx.fillRect(cx - 24, cy - 33, 7, 1);
      }
      // fits / ceiling flags
      if (m.fits && !m.completed) { ctx.fillStyle = '#a9dc86'; for (const [dx, dy] of [[0, 2], [1, 3], [2, 2], [3, 1], [4, 0]] as const) ctx.fillRect(cx + 14 + dx, cy - 21 + dy, 1, 1); }
      if (m.atCeiling) { ctx.fillStyle = '#e0b04a'; ctx.fillRect(cx - 24, cy - 22, 5, 3); ctx.fillStyle = '#7a3b24'; ctx.fillRect(cx - 24, cy - 19, 1, 4); }
      // new flag
      if (m.isNew) {
        const nf = this.assets.small('newflag', newFlagFrame);
        drawFrameSurface(ctx, nf, cx + 12, cy - 34 + (motion ? Math.round(Math.sin(t * 4)) : 0), 1);
      }
      // selection: flame ring, brackets, a spinning sigil
      if (sel) {
        ctx.globalCompositeOperation = 'lighter';
        const n = this.ring2Pixels.length;
        const off = motion ? Math.floor(t * 14) : 0;
        ctx.fillStyle = '#ff9a3c';
        for (let i = 0; i < n; i++) if (((i + off) % 8) < 5) { const [px, py] = this.ring2Pixels[i]; ctx.fillRect(cx + px, cy + py, 1, 1); }
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#ffe7a8';
        // corner brackets: an L of six pixels at each corner of the selection
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
          for (let k = 0; k < 6; k++) {
            ctx.fillRect(cx + sx * 28 - sx * k, cy + sy * 28, 1, 1);
            ctx.fillRect(cx + sx * 28, cy + sy * 28 - sy * k, 1, 1);
          }
        }
        const sig = this.assets.sprite('fx/sigil');
        if (sig) {
          const fi = motion ? Math.floor(t * 8) % sig.frames.length : 0;
          const above = m.y > 66;
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.85;
          drawFrameSurface(ctx, sig.frames[fi], cx - 16 + (above ? 0 : 40), cy - (above ? 62 : 16), 0.8);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
        }
      } else if (hov) {
        ctx.fillStyle = '#e8dcc0';
        ctx.globalAlpha = 0.7;
        for (const [px, py] of this.ringPixels) ctx.fillRect(cx + px, cy + py, 1, 1);
        ctx.globalAlpha = 1;
      }
      // a corrupted map slotted: the selected node cracks with void light and takes a violet halo
      if (corrupted && sel) {
        const pulse2 = motion ? 0.5 + 0.5 * Math.sin(t * 4.2) : 0.7;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.45 + 0.3 * pulse2;
        ctx.drawImage(this.assets.halo('#c07bff'), cx - 32, cy - 32);
        const crack: [number, number][] = [[7, -20], [4, -15], [8, -10], [2, -5], [6, 0], [0, 5], [4, 10], [-3, 14], [-1, 20]];
        for (let i = 1; i < crack.length; i++) {
          const [x0, y0] = crack[i - 1], [x1, y1] = crack[i];
          const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
          for (let k = 0; k <= n; k++) {
            const x = cx + Math.round(x0 + ((x1 - x0) * k) / n), y = cy + Math.round(y0 + ((y1 - y0) * k) / n);
            ctx.globalAlpha = 0.55 + 0.35 * pulse2;
            ctx.fillStyle = '#c07bff';
            ctx.fillRect(x - 1, y, 3, 1);
            ctx.globalAlpha = 0.9;
            ctx.fillStyle = '#fbf4e6';
            ctx.fillRect(x, y, 1, 1);
          }
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    // forge sparks
    this.forgeBursts = this.forgeBursts.filter((b) => (b.t += 0.016) < 0.5);
    ctx.globalCompositeOperation = 'lighter';
    for (const b of this.forgeBursts) {
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2 + 0.3, d = 6 + b.t * 70 * (0.6 + (k % 3) * 0.25);
        ctx.globalAlpha = Math.max(0, 1 - b.t * 2);
        ctx.fillStyle = k % 2 ? '#ffe7a8' : '#ff9a3c';
        ctx.fillRect(Math.round(b.x + Math.cos(a) * d), Math.round(b.y + Math.sin(a) * d * 0.8 + b.t * 30 * b.t), 1, 1);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Portal glyph on the node an open portal leads to, and the activation flare on the node just lit. */
  private drawOverlays(ctx: CanvasRenderingContext2D, dt: number, t: number, motion: boolean): void {
    const portalId = this.input?.portal;
    if (portalId) {
      const m = this.models.find((q) => q.id === portalId);
      if (m && m.known) {
        const fi = motion ? Math.floor(t * 9) % 8 : 0;
        const surf = this.assets.small(`portal${fi}`, () => portalFrame(fi));
        const sealed = !!m.area.sealed;
        const px = Math.round(m.x) + (sealed ? 14 : 15) - 9, py = Math.round(m.y) - (sealed ? 34 : 33) + (motion ? Math.round(Math.sin(t * 2.4) * 1) : 0);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.4 + (motion ? 0.2 * Math.sin(t * 3) : 0.1);
        ctx.drawImage(this.assets.halo('#c07bff'), px - 22, py - 22, 62, 62);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        drawFrameSurface(ctx, surf, px, py, 1);
      }
    }
    // the flare: a white-hot wash on the plate, a pair of expanding rings
    this.flares = this.flares.filter((f) => (f.t += dt) < (f.calm ? 0.9 : 1.15));
    for (const f of this.flares) {
      const p = ATLAS_POS[f.id];
      const u = f.t / (f.calm ? 0.9 : 1.15);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.max(0, (1 - u) * (f.calm ? 0.45 : 0.85));
      ctx.drawImage(this.assets.halo('#ffe7a8'), Math.round(p.x) - 40, Math.round(p.y) - 40, 80, 80);
      if (!f.calm) {
        for (const [delay, col] of [[0, '#ffe7a8'], [0.12, '#ff9a3c']] as const) {
          const k = Math.max(0, (f.t - delay) / 0.8);
          if (k <= 0 || k >= 1) continue;
          ctx.globalAlpha = 0.9 * (1 - k);
          ctx.strokeStyle = col;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(Math.round(p.x) + 0.5, Math.round(p.y) + 0.5, 14 + 70 * ease(Math.sqrt(k)), 0, Math.PI * 2);
          ctx.stroke();
        }
        // the chart brightens a moment as the device lights
        ctx.globalAlpha = Math.max(0, 0.12 * (1 - u));
        ctx.fillStyle = '#ff9a3c';
        ctx.fillRect(0, 0, CHART_W, CHART_H);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  /** Dashed key-coloured threads from each owned key (top-left tray) to the sealed door it opens. Screen space. */
  private drawKeyThreads(ctx: CanvasRenderingContext2D, t: number, motion: boolean): void {
    const anchors = this.input?.keyAnchors;
    if (!anchors?.length) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    for (const m of this.models) {
      if (m.kind !== 'sealedKeyed' || !m.keyId) continue;
      const a = anchors.find((q) => q.keyId === m.keyId);
      if (!a) continue;
      const door = this.artToScreen(m.x, m.y - 4);
      const col = KEY_COLOUR[m.keyId] ?? '#c07bff';
      const cx = (a.x + door.x) / 2 + 30, cy = Math.min(a.y, door.y) - 50;
      const len = Math.hypot(door.x - a.x, door.y - a.y) * 1.15;
      const n = Math.max(12, Math.round(len / 3));
      const off = motion ? Math.floor(t * 14) : 0;
      ctx.fillStyle = col;
      for (let i = 0; i <= n; i++) {
        if (((i + off) % 6) > 3) continue;
        const u = i / n;
        const x = Math.round((1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * cx + u * u * door.x);
        const y = Math.round((1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * cy + u * u * door.y);
        if (x < -4 || y < -4 || x > this.vw + 4 || y > this.vh + 4) continue;
        ctx.globalAlpha = 0.92;
        ctx.fillRect(x, y, 3, 3);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.22;
        ctx.fillRect(x - 2, y - 2, 7, 7);
        ctx.globalCompositeOperation = 'source-over';
      }
      // the keyhole end: a bright bead on the door
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = motion ? 0.6 + 0.3 * Math.sin(t * 4) : 0.8;
      ctx.fillRect(Math.round(door.x) - 2, Math.round(door.y) - 2, 4, 4);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  private drawSealed(ctx: CanvasRenderingContext2D, m: NodeModel, cx: number, cy: number, t: number, motion: boolean, sel: boolean, hov: boolean, forge: number): void {
    const keyed = m.kind === 'sealedKeyed';
    const key = m.keyId ?? 'riftKey';
    const col = KEY_COLOUR[key] ?? '#c07bff';
    const surf = this.assets.door(key, keyed);
    const breath = motion ? 0.5 + 0.5 * Math.sin(t * 2 + m.x) : 0.6;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (keyed ? 0.5 + breath * 0.3 : 0.22 + (sel || hov ? 0.25 : 0)) * forge;
    ctx.drawImage(this.assets.halo(col), cx - 32, cy - 34);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    const yoff = forge < 1 ? Math.round((1 - forge) * -6) : 0;
    ctx.globalAlpha = forge;
    drawFrameSurface(ctx, surf, cx - 20, cy - 26 + yoff, keyed ? 0.6 + breath * 0.4 : 0.9);
    ctx.globalAlpha = 1;
    // a chain sways across a locked door
    if (!keyed) {
      ctx.fillStyle = '#9a919c';
      const sway = motion ? Math.round(Math.sin(t * 1.4 + m.x) * 1.4) : 0;
      for (let i = 0; i < 6; i++) ctx.fillRect(cx - 22 + i * 2, cy - 8 + i + (i & 1) + sway, 2, 1);
    }
    if (sel) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#ffe7a8';
      ctx.globalAlpha = 0.6 + (motion ? 0.3 * Math.sin(t * 6) : 0);
      for (let x = -21; x <= 21; x++) { ctx.fillRect(cx + x, cy + 24, 1, 1); }
      for (let y = -27; y <= 24; y++) { ctx.fillRect(cx - 21, cy + y, 1, 1); ctx.fillRect(cx + 21, cy + y, 1, 1); }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    // tier pips under the door too
    for (let i = 0; i < 5; i++) {
      const lit = i <= m.band;
      const pf = this.assets.small(`pip|${lit ? 1 : 0}|${m.material}`, () => pipFrame(lit, m.material));
      drawFrameSurface(ctx, pf, cx - 22 + i * 9, cy + 25, 1, 0.85);
    }
    drawSurgePips(ctx, m.id, cx, cy, 34, 0.85);
  }

  private pixels(ctx: CanvasRenderingContext2D, px: readonly [number, number][], cx: number, cy: number, fill: string, alpha: number): void {
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.fillStyle = fill;
    for (const [x, y] of px) ctx.fillRect(cx + x, cy + y, 1, 1);
    ctx.globalAlpha = 1;
  }

  /** The ember runs along the road toward a newly revealed node. */
  private drawCineRun(ctx: CanvasRenderingContext2D): void {
    if (!this.cine) return;
    for (const it of this.cine.items) {
      const pr = this.cineProgress.get(it.id);
      if (!it.from || !pr || pr.road <= 0) continue;
      const pts = roadPoints(it.from, it.id, 1.5);
      const total = pathLength(pts);
      // the road it leaves behind: bone-lit cobble up to the head
      const r = new Raster(CHART_W, CHART_H);
      paintRoad(r, pts, 'walked', false, total * pr.road);
      const surf = this.tmp;
      const t = ctx2d(surf);
      t.globalCompositeOperation = 'source-over';
      t.clearRect(0, 0, CHART_W, CHART_H);
      const id = t.createImageData(CHART_W, CHART_H);
      id.data.set(r.data);
      t.putImageData(id, 0, 0);
      ctx.drawImage(surf, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 14; k++) {
        const d = Math.max(0, total * pr.road - k * 1.6);
        const p = pointAt(pts, d);
        ctx.globalAlpha = 1 - k / 14;
        ctx.fillStyle = k < 2 ? '#ffe7a8' : k < 6 ? '#ff9a3c' : '#e8662a';
        const w = k < 3 ? 3 : 2;
        ctx.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, w, w);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  private drawParticles(ctx: CanvasRenderingContext2D, dt: number, ox: number, oy: number, motion: boolean): void {
    this.particles.step(dt, this.emitters, (x, y) => this.isRevealedAt(x, y), !motion);
    const z = this.zoom;
    // parallax: embers and ash sit slightly above the ground, so they move a little faster than the chart
    const baseOx = this.vw / 2 - (CHART_W * z) / 2, baseOy = this.vh / 2 - (CHART_H * z) / 2;
    const par = motion ? 0.14 : 0;
    const dxs = (ox - baseOx) * par, dys = (oy - baseOy) * par;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.particles.list) {
      const u = p.age / p.life;
      let col: string, a: number;
      switch (p.kind) {
        case 'ember': col = u < 0.3 ? '#ffe7a8' : u < 0.65 ? '#ff9a3c' : '#e8662a'; a = 1 - u * u; break;
        case 'ash': col = '#a0948d'; a = 0.35 * Math.sin(Math.PI * Math.min(1, u)); break;
        case 'glint': col = '#d4f1ff'; a = Math.sin(Math.PI * u); break;
        default: col = '#c07bff'; a = 0.8 * Math.sin(Math.PI * u); break;
      }
      const sx = Math.round(ox + p.x * z + dxs), sy = Math.round(oy + p.y * z + dys);
      if (sx < 0 || sy < 0 || sx > this.vw || sy > this.vh) continue;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillStyle = col;
      ctx.fillRect(sx, sy, p.size * z, p.size * z);
      if (p.kind === 'glint') { ctx.fillRect(sx - z, sy, z, z); ctx.fillRect(sx + z, sy, z, z); ctx.fillRect(sx, sy - z, z, z); ctx.fillRect(sx, sy + z, z, z); }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }
}

