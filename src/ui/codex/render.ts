// The tree renderer behind the Atlas Codex (and every other tree view): plain 2D canvases, no engine library. The board, threads and node plates come from the pixel
// art in src/art/codex and are drawn at a whole zoom (or an exact half for the overview) so nothing smears. All text
// (names, tooltips, branch banners, counters) is DOM on the shared type scale; this file draws none.
//
// Feedback beats (brief A, 8.3): allocation runs an ember along the thread into the node (0.25 s), then the plate
// takes a hammer flash and a spark burst; keystones add a shockwave across the table and thicken the ambient embers;
// refunds crumble the plate to ash and let the thread go dark; hovering a far node lights the cheapest path.
// Everything tree-specific (nodes, edges, origin, world size, board, colours) comes from the view (view.ts).
import { hexToColor } from '../../art/palette';
import { Raster } from '../../art/raster';
import { haloRaster } from '../../art/atlas/plates';
import { drawFrameSurface, frameToSurface, newCanvas, rasterToCanvas, ctx2d, type FrameSurface, type Surface } from '../../art/atlas/canvas';
import { paintThread } from '../../art/codex/board';
import { excludeBadge, padlockBadge } from '../../art/codex/plates';
import { PLATE_SIZE, type ToneDef } from '../../art/codex/tones';
import type { PathPreview, TreeModel, TreeNode, TreeNodeData, TreeState } from './tree';
import type { TreeView } from './view';

export const ZOOMS = [0.5, 1, 2, 3] as const;
export type TreeZoom = (typeof ZOOMS)[number];

export interface TreeInput {
  allocated: ReadonlySet<string>;
  selected: string | null;
  hovered: string | null;
  matches: ReadonlySet<string>;
  searching: boolean;
  preview: PathPreview | null;
  previewOk: boolean;
  reduceMotion: boolean;
}

export interface TreeEvents<N extends TreeNodeData = TreeNodeData, T extends string = string> {
  onTransform?(ox: number, oy: number, zoom: number): void;
  onBeat?(beat: 'impact' | 'refund', node: TreeNode<N, T>): void;
}

interface Spark { x: number; y: number; vx: number; vy: number; age: number; life: number; col: string; size: number; g: number }
interface Run { to: string; from: string; t: number; dur: number }
interface Ghost<Nd> { node: Nd; t: number }
interface Ring { x: number; y: number; t: number; maxR: number; col: string; dur: number }

const ease = (t: number): number => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const RUN_TIME = 0.25;
const hex = (c: number): string => `#${(c >>> 8).toString(16).padStart(6, '0')}`;

const ringCache = new Map<number, [number, number][]>();
/** Pixel offsets of a 1 px ring (midpoint circle), cached per radius. */
function ringPixels(r: number): [number, number][] {
  let list = ringCache.get(r);
  if (list) return list;
  const seen = new Set<string>();
  list = [];
  const steps = Math.max(24, Math.round(r * 9));
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const x = Math.round(Math.cos(a) * r), y = Math.round(Math.sin(a) * r);
    const k = `${x},${y}`;
    if (!seen.has(k)) { seen.add(k); list.push([x, y]); }
  }
  list.sort((p, q) => Math.atan2(p[1], p[0]) - Math.atan2(q[1], q[0]));
  ringCache.set(r, list);
  return list;
}

export class TreeRenderer<N extends TreeNodeData = TreeNodeData, T extends string = string> {
  zoom: TreeZoom = 1;
  camX: number;
  camY: number;
  private tx: number;
  private ty: number;
  private readonly m: TreeModel<N, T>;
  private readonly tones: Readonly<Record<T, ToneDef>>;
  private readonly origin: string;
  /** World size and centre (the board's). */
  private readonly W: number;
  private readonly H: number;
  private readonly CX: number;
  private readonly CY: number;
  /** Nodes back to front (by y), so lower plates overlap the ones above them. */
  private readonly byY: readonly TreeNode<N, T>[];
  private vw = 800;
  private vh = 500;
  private dpr = 1;
  private input: TreeInput | null = null;
  private vis = new Set<string>();
  private pending = new Map<string, Run>();
  private runs: Run[] = [];
  private ghosts: Ghost<TreeNode<N, T>>[] = [];
  private flash = new Map<string, number>();
  private rings: Ring[] = [];
  private sparks: Spark[] = [];
  private ambient = 0;
  private freeze = 0;
  private raf = 0;
  private last = 0;
  private time = 0;
  private dirty = true;
  private ox = NaN;
  private oy = NaN;
  private lz = 0;
  private dragging = false;
  private surfaces = new Map<string, FrameSurface>();
  private halos = new Map<string, Surface>();
  private slate: CanvasPattern | null = null;
  private board: Surface;
  private dim: Surface;
  private lit: Surface;
  private reach: Surface;
  private glow: Surface;
  private states = new Map<string, TreeState>();
  private clashing = new Set<string>();
  private flow: { ax: number; ay: number; bx: number; by: number; len: number; col: string }[] = [];
  private badge = frameToSurface(padlockBadge());
  private xbadge = frameToSurface(excludeBadge());
  private seed = 7;

  constructor(private view: TreeView<N, T>, private canvas: HTMLCanvasElement, private events: TreeEvents<N, T> = {}) {
    const { model, board, palette } = view;
    this.m = model;
    this.tones = palette.tones;
    this.origin = model.originId;
    this.W = board.w; this.H = board.h; this.CX = board.cx; this.CY = board.cy;
    this.camX = this.tx = board.cx;
    this.camY = this.ty = board.cy;
    this.byY = [...model.nodes].sort((p, q) => p.y - q.y);
    this.lit = newCanvas(board.w, board.h);
    this.reach = newCanvas(board.w, board.h);
    this.glow = newCanvas(board.w, board.h);
    const st = view.staticAssets();
    this.board = st.board;
    this.dim = st.dim;
    const ctx = canvas.getContext('2d');
    this.slate = ctx ? ctx.createPattern(st.tile, 'repeat') : null;
  }

  // ---- lifecycle ---------------------------------------------------------------------------------------------
  start(): void {
    if (this.raf) return;
    const loop = (now: number): void => {
      this.raf = requestAnimationFrame(loop);
      const motion = !!this.input && !this.input.reduceMotion;
      const busy = this.dragging || this.pending.size > 0 || this.runs.length > 0 || this.sparks.length > 0 || this.ghosts.length > 0 || this.rings.length > 0 || this.flash.size > 0
        || Math.abs(this.camX - this.tx) > 0.05 || Math.abs(this.camY - this.ty) > 0.05;
      if (!busy && !motion && !this.dirty) return;
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
    const tile = this.slate;
    void tile;
    this.clampTarget();
    this.dirty = true;
  }
  get viewport(): { w: number; h: number } { return { w: this.vw, h: this.vh }; }

  // ---- camera ------------------------------------------------------------------------------------------------
  private clamp(x: number, y: number, z: number = this.zoom): [number, number] {
    const over = 70 / z;
    const cl = (v: number, size: number, half: number): number => (size + 2 * over <= half * 2 ? size / 2 : Math.max(half - over, Math.min(size - half + over, v)));
    return [cl(x, this.W, this.vw / (2 * z)), cl(y, this.H, this.vh / (2 * z))];
  }
  private clampTarget(): void {
    [this.tx, this.ty] = this.clamp(this.tx, this.ty);
    [this.camX, this.camY] = this.clamp(this.camX, this.camY);
  }
  panTo(x: number, y: number, instant = false): void {
    [this.tx, this.ty] = this.clamp(x, y);
    if (instant) { this.camX = this.tx; this.camY = this.ty; }
    this.dirty = true;
  }
  panByScreen(dx: number, dy: number): void {
    this.tx -= dx / this.zoom; this.ty -= dy / this.zoom;
    [this.tx, this.ty] = this.clamp(this.tx, this.ty);
    this.camX = this.tx; this.camY = this.ty;
    this.dirty = true;
  }
  setDragging(on: boolean): void { this.dragging = on; }
  setZoom(z: TreeZoom, focus?: { x: number; y: number }): void {
    if (z === this.zoom) return;
    this.zoom = z;
    if (focus) { this.tx = focus.x; this.ty = focus.y; }
    [this.tx, this.ty] = this.clamp(this.tx, this.ty);
    this.camX = this.tx; this.camY = this.ty;
    this.dirty = true;
  }
  get center(): { x: number; y: number } { return { x: this.camX, y: this.camY }; }
  worldToScreen(x: number, y: number): { x: number; y: number } {
    return { x: Math.round(this.vw / 2 - this.camX * this.zoom) + x * this.zoom, y: Math.round(this.vh / 2 - this.camY * this.zoom) + y * this.zoom };
  }
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - Math.round(this.vw / 2 - this.camX * this.zoom)) / this.zoom, y: (sy - Math.round(this.vh / 2 - this.camY * this.zoom)) / this.zoom };
  }

  // ---- input -------------------------------------------------------------------------------------------------
  setInput(next: TreeInput, first = false): void {
    const prev = this.input;
    this.input = next;
    this.dirty = true;
    if (first || !prev) {
      this.vis = new Set(next.allocated);
      this.pending.clear();
      this.rebuildWires();
      return;
    }
    let changed = false;
    // newly allocated: run an ember along the thread, then land
    for (const id of next.allocated) {
      if (this.vis.has(id) || this.pending.has(id)) continue;
      const n = this.m.byId.get(id);
      if (!n) continue;
      if (next.reduceMotion) { this.vis.add(id); this.land(n, true); changed = true; continue; }
      const from = n.node.links.find((l) => l === this.origin || this.vis.has(l)) ?? this.origin;
      const run: Run = { to: id, from, t: 0, dur: RUN_TIME };
      this.pending.set(id, run);
      this.runs.push(run);
    }
    // refunded: crumble to ash, the thread goes dark
    for (const id of [...this.vis]) {
      if (next.allocated.has(id)) continue;
      const n = this.m.byId.get(id);
      this.vis.delete(id);
      changed = true;
      if (n) this.crumble(n, next.reduceMotion);
    }
    for (const id of [...this.pending.keys()]) if (!next.allocated.has(id)) { this.pending.delete(id); this.runs = this.runs.filter((r) => r.to !== id); }
    if (changed) this.rebuildWires();
  }

  /** A short shockwave and spark burst at a node (search jumps, "you are here"). */
  pulse(id: string): void {
    const n = this.m.byId.get(id);
    if (!n || this.input?.reduceMotion) return;
    this.rings.push({ x: n.x, y: n.y, t: 0, maxR: 26, col: '#ffe7a8', dur: 0.5 });
    this.dirty = true;
  }

  private land(n: TreeNode<N, T>, quiet: boolean): void {
    this.flash.set(n.id, 0);
    this.events.onBeat?.('impact', n);
    if (quiet) return;
    const big = n.cls === 'keystone', mid = n.cls !== 'small';
    this.burst(n.x, n.y, big ? 46 : mid ? 24 : 12, this.tones[n.tone].css, big ? 110 : 70);
    if (big) {
      this.freeze = 0.25;
      this.rings.push({ x: n.x, y: n.y, t: 0, maxR: 380, col: this.tones[n.tone].css, dur: 1.1 });
      this.rings.push({ x: n.x, y: n.y, t: -0.12, maxR: 300, col: '#ffe7a8', dur: 0.9 });
      this.ambient = 1;
    } else if (mid) this.rings.push({ x: n.x, y: n.y, t: 0, maxR: 40, col: this.tones[n.tone].css, dur: 0.5 });
  }
  private crumble(n: TreeNode<N, T>, quiet: boolean): void {
    this.events.onBeat?.('refund', n);
    if (quiet) return;
    this.ghosts.push({ node: n, t: 0 });
    const list: Spark[] = [];
    const count = n.cls === 'keystone' ? 30 : n.cls === 'small' ? 12 : 20;
    for (let i = 0; i < count; i++) {
      const a = this.rand() * Math.PI * 2, s = 6 + this.rand() * 22;
      list.push({ x: n.x + Math.cos(a) * n.r * 0.6, y: n.y + Math.sin(a) * n.r * 0.6, vx: Math.cos(a) * s * 0.6, vy: Math.sin(a) * s * 0.5 - 8, age: 0, life: 0.7 + this.rand() * 0.7, col: this.rand() < 0.5 ? '#a0948d' : '#5a5057', size: 1 + (this.rand() < 0.25 ? 1 : 0), g: 18 });
    }
    this.sparks.push(...list);
  }
  private burst(x: number, y: number, n: number, css: string, speed: number): void {
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2, s = speed * (0.35 + this.rand() * 0.65);
      this.sparks.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 10, age: 0, life: 0.45 + this.rand() * 0.6, col: this.rand() < 0.45 ? '#ffe7a8' : css, size: this.rand() < 0.2 ? 2 : 1, g: 60 });
    }
  }
  private rand(): number {
    this.seed ^= this.seed << 13; this.seed ^= this.seed >>> 17; this.seed ^= this.seed << 5;
    return ((this.seed >>> 0) % 100003) / 100003;
  }

  // ---- baked thread layers -----------------------------------------------------------------------------------
  private rebuildWires(): void {
    const { W, H, CX, CY } = this;
    const lit = new Raster(W, H), reach = new Raster(W, H), glow = new Raster(W, H);
    const on = (n: TreeNode<N, T>): boolean => n.id === this.origin || this.vis.has(n.id);
    const flow: typeof this.flow = [];
    for (const { a, b } of this.m.edges) {
      const ao = on(a), bo = on(b);
      if (ao && bo) {
        // inner endpoint first so the ember flows outward; the colour is the outer node's light
        const [p, q] = Math.hypot(a.x - CX, a.y - CY) <= Math.hypot(b.x - CX, b.y - CY) ? [a, b] : [b, a];
        const col = this.tones[(q.id === this.origin ? p : q).tone].light;
        paintThread(lit, a.x, a.y, b.x, b.y, 'lit', col, glow);
        flow.push({ ax: p.x, ay: p.y, bx: q.x, by: q.y, len: Math.hypot(q.x - p.x, q.y - p.y), col: hex(col) });
      } else if (ao !== bo) {
        const other = ao ? b : a;
        if (this.m.nodeState(other.node, this.vis) === 'ready') paintThread(reach, a.x, a.y, b.x, b.y, 'reach');
      }
    }
    for (const [layer, raster] of [[this.lit, lit], [this.reach, reach], [this.glow, glow]] as const) {
      const c = ctx2d(layer);
      c.clearRect(0, 0, W, H);
      const id = c.createImageData(W, H);
      id.data.set(raster.data);
      c.putImageData(id, 0, 0);
    }
    this.flow = flow;
    // per-node state, once per change instead of once per frame
    this.states.clear();
    this.clashing.clear();
    for (const n of this.m.nodes) {
      const st: TreeState = n.id === this.origin || this.vis.has(n.id) ? 'on' : this.m.nodeState(n.node, this.vis);
      this.states.set(n.id, st);
      if (st === 'locked' && this.m.exclusionOf(n.node, this.vis)) this.clashing.add(n.id);
    }
  }

  private surface(n: TreeNode<N, T>, state: TreeState): FrameSurface {
    const key = `${n.cls}|${n.tone}|${n.tone2 ?? ''}|${n.glyph}|${state}`;
    let s = this.surfaces.get(key);
    if (!s) { s = frameToSurface(this.view.plate(n, state)); this.surfaces.set(key, s); }
    return s;
  }
  private halo(css: string): Surface {
    let s = this.halos.get(css);
    if (!s) { s = rasterToCanvas(haloRaster(hexToColor(css))); this.halos.set(css, s); }
    return s;
  }

  // ---- frame -------------------------------------------------------------------------------------------------
  private frame(dt: number): void {
    const input = this.input;
    if (!input) return;
    this.dirty = false;
    const motion = !input.reduceMotion;
    const z = this.zoom;
    if (this.freeze > 0) { this.freeze -= dt; dt = 0; }
    this.time += dt;
    const t = this.time;
    const k = 1 - Math.exp(-dt * 12);
    this.camX += (this.tx - this.camX) * k; this.camY += (this.ty - this.camY) * k;
    if (Math.abs(this.camX - this.tx) < 0.02) this.camX = this.tx;
    if (Math.abs(this.camY - this.ty) < 0.02) this.camY = this.ty;
    this.stepFx(dt, motion);

    const ox = Math.round(this.vw / 2 - this.camX * z), oy = Math.round(this.vh / 2 - this.camY * z);
    if (ox !== this.ox || oy !== this.oy || z !== this.lz) { this.ox = ox; this.oy = oy; this.lz = z; this.events.onTransform?.(ox, oy, z); }
    const ctx = this.canvas.getContext('2d')!;
    const s = z * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#0c090d';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(s, 0, 0, s, ox * this.dpr, oy * this.dpr);
    ctx.imageSmoothingEnabled = z < 1;
    if (this.slate) {
      ctx.fillStyle = this.slate;
      ctx.fillRect(-ox / z - 2, -oy / z - 2, this.vw / z + 4, this.vh / z + 4);
    }
    const searching = input.searching;
    // board, brighter for a few seconds after a keystone lands
    ctx.drawImage(this.board, 0, 0);
    if (this.ambient > 0.01) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(0.5, this.ambient * 0.5);
      ctx.drawImage(this.board, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = searching ? 0.4 : 1;
    ctx.drawImage(this.dim, 0, 0);
    ctx.drawImage(this.reach, 0, 0);
    ctx.drawImage(this.lit, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (motion ? 0.42 + 0.14 * Math.sin(t * 1.7) : 0.5) * (searching ? 0.5 : 1);
    ctx.drawImage(this.glow, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = false;

    if (motion) this.drawFlow(ctx, t);
    this.drawExclusion(ctx, t, motion);
    this.drawPreview(ctx, t, motion);
    this.drawNodes(ctx, t, motion);
    this.drawRuns(ctx);
    this.drawFx(ctx, motion);
  }

  private stepFx(dt: number, motion: boolean): void {
    for (const run of this.runs) run.t += dt;
    for (const run of [...this.runs]) {
      if (run.t < run.dur) continue;
      this.runs = this.runs.filter((r) => r !== run);
      this.pending.delete(run.to);
      const n = this.m.byId.get(run.to);
      if (n && this.input?.allocated.has(run.to)) { this.vis.add(run.to); this.rebuildWires(); this.land(n, false); }
    }
    for (const [id, t0] of this.flash) { const nt = t0 + dt; if (nt > 0.3) this.flash.delete(id); else this.flash.set(id, nt); }
    for (const p of this.sparks) { p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; p.vx *= 1 - dt * 1.2; }
    this.sparks = this.sparks.filter((p) => p.age < p.life);
    for (const g of this.ghosts) g.t += dt;
    this.ghosts = this.ghosts.filter((g) => g.t < 0.55);
    for (const r of this.rings) r.t += dt;
    this.rings = this.rings.filter((r) => r.t < r.dur);
    this.ambient = Math.max(0, this.ambient - dt / 6);
    if (motion) {
      // a slow trickle of embers rising off lit notables, keystones and the brazier
      this.emberBudget += dt * (2.2 + this.ambient * 14);
      while (this.emberBudget >= 1 && this.sparks.length < 160) {
        this.emberBudget -= 1;
        const pool = this.emberPool();
        if (!pool.length) break;
        const n = pool[Math.floor(this.rand() * pool.length)];
        this.sparks.push({ x: n.x + (this.rand() - 0.5) * n.r, y: n.y - n.r * 0.4, vx: (this.rand() - 0.5) * 6, vy: -(6 + this.rand() * 9), age: 0, life: 1 + this.rand() * 1.4, col: this.rand() < 0.4 ? '#ffe7a8' : this.tones[n.tone].css, size: 1, g: -3 });
      }
    }
  }
  private emberBudget = 0;
  private emberCache: { key: number; list: TreeNode<N, T>[] } = { key: -1, list: [] };
  private emberPool(): TreeNode<N, T>[] {
    if (this.emberCache.key !== this.vis.size) {
      this.emberCache = { key: this.vis.size, list: this.m.nodes.filter((n) => (n.id === this.origin || (this.vis.has(n.id) && n.cls !== 'small'))) };
    }
    return this.emberCache.list;
  }

  private drawFlow(ctx: CanvasRenderingContext2D, t: number): void {
    ctx.globalCompositeOperation = 'lighter';
    for (const e of this.flow) {
      const n = Math.max(1, Math.round(e.len / 26));
      for (let i = 0; i < n; i++) {
        const d = (((t * 15 + (i * e.len) / n) % e.len) + e.len) % e.len / e.len;
        const x = Math.round(e.ax + (e.bx - e.ax) * d), y = Math.round(e.ay + (e.by - e.ay) * d);
        ctx.globalAlpha = 0.28; ctx.fillStyle = e.col; ctx.fillRect(x - 1, y - 1, 3, 3);
        ctx.globalAlpha = 0.95; ctx.fillStyle = '#ffe7a8'; ctx.fillRect(x, y, 1, 1);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawRuns(ctx: CanvasRenderingContext2D): void {
    if (!this.runs.length) return;
    ctx.globalCompositeOperation = 'lighter';
    for (const run of this.runs) {
      const a = this.m.byId.get(run.from), b = this.m.byId.get(run.to);
      if (!a || !b) continue;
      const u = ease(run.t / run.dur);
      for (let i = 0; i < 12; i++) {
        const d = Math.max(0, u - i * 0.035);
        const x = Math.round(a.x + (b.x - a.x) * d), y = Math.round(a.y + (b.y - a.y) * d);
        ctx.globalAlpha = 1 - i / 12;
        ctx.fillStyle = i < 2 ? '#ffffff' : i < 5 ? '#ffe7a8' : this.tones[b.tone].css;
        const w = i < 3 ? 3 : 2;
        ctx.fillRect(x - 1, y - 1, w, w);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Cheapest-path preview: marching ember dots and rings on the nodes it would allocate. */
  private drawPreview(ctx: CanvasRenderingContext2D, t: number, motion: boolean): void {
    const pv = this.input?.preview;
    if (!pv || !pv.nodes.length) return;
    const ok = this.input!.previewOk;
    const first = this.m.byId.get(pv.nodes[0])!;
    const startId = first.node.links.find((l) => l === this.origin || this.vis.has(l)) ?? this.origin;
    const chain = [this.m.byId.get(startId)!, ...pv.nodes.map((id) => this.m.byId.get(id)!)];
    ctx.globalCompositeOperation = 'lighter';
    const off = motion ? Math.floor(t * 12) : 0;
    for (let i = 1; i < chain.length; i++) {
      const a = chain[i - 1], b = chain[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      for (let d = 0; d <= len; d += 1) {
        if (((Math.floor(d) + off) % 6) > 2) continue;
        const x = Math.round(a.x + ((b.x - a.x) * d) / len), y = Math.round(a.y + ((b.y - a.y) * d) / len);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = ok ? '#ff9a3c' : '#d05a4a';
        ctx.fillRect(x, y, 1, 1);
        ctx.globalAlpha = 0.22;
        ctx.fillRect(x - 1, y - 1, 3, 3);
      }
    }
    ctx.globalAlpha = 1;
    for (const id of pv.nodes) {
      const n = this.m.byId.get(id)!;
      ctx.fillStyle = ok ? '#ffe7a8' : '#e08070';
      const r = ringPixels(Math.round(n.r + 2.5));
      ctx.globalAlpha = id === pv.nodes[pv.nodes.length - 1] ? 0.95 : 0.6;
      r.forEach(([px, py], i) => { if (((i + off) % 4) < 2) ctx.fillRect(n.x + px, n.y + py, 1, 1); });
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Exclusion pairs: an iron chain drawn across the wheel between the two nodes, taut and red when one side is held. */
  private drawExclusion(ctx: CanvasRenderingContext2D, t: number, motion: boolean): void {
    const input = this.input!;
    const focus = new Set([input.selected, input.hovered].filter((x): x is string => !!x));
    for (const n of this.m.nodes) {
      if (!n.node.excludes.length) continue;
      for (const oid of n.node.excludes) {
        const o = this.m.byId.get(oid);
        if (!o || o.i < n.i) continue;
        const held = this.vis.has(n.id) || this.vis.has(o.id);
        const shown = focus.has(n.id) || focus.has(o.id);
        if (!held && !shown) continue;
        this.chain(ctx, n, o, held ? 0.95 : 0.55, t, motion, held);
      }
    }
  }
  private chain(ctx: CanvasRenderingContext2D, a: TreeNode<N, T>, b: TreeNode<N, T>, alpha: number, t: number, motion: boolean, held: boolean): void {
    const { CX, CY } = this;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const da = Math.hypot(a.x - CX, a.y - CY) || 1, db = Math.hypot(b.x - CX, b.y - CY) || 1;
    let dx = (a.x - CX) / da + (b.x - CX) / db, dy = (a.y - CY) / da + (b.y - CY) / db;
    let m = Math.hypot(dx, dy);
    if (m < 0.35) { dx = -(a.y - CY) / da; dy = (a.x - CX) / da; m = 1; }
    const bow = Math.hypot(a.x - b.x, a.y - b.y) < 90 ? 46 : 150;
    const cx = mx + (dx / m) * bow, cy = my + (dy / m) * bow;
    const len = Math.hypot(a.x - b.x, a.y - b.y) + bow;
    const links = Math.max(8, Math.round(len / 6));
    const glow = motion ? 0.5 + 0.5 * Math.sin(t * 4.5) : 0.7;
    const at = (u: number): [number, number] => [
      Math.round((1 - u) * (1 - u) * a.x + 2 * (1 - u) * u * cx + u * u * b.x),
      Math.round((1 - u) * (1 - u) * a.y + 2 * (1 - u) * u * cy + u * u * b.y),
    ];
    // a red underglow first, so the iron links sit in it
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = '#e0503a';
    for (let i = 1; i < links; i++) {
      const [x, y] = at(i / links);
      ctx.globalAlpha = (held ? 0.3 : 0.16) * (0.5 + glow * 0.5);
      ctx.fillRect(x - 3, y - 3, 7, 7);
    }
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 1; i < links; i++) {
      const [x, y] = at(i / links);
      const horiz = i % 2 === 0;
      const w = horiz ? 5 : 3, h = horiz ? 3 : 5;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#0d0b0e'; ctx.fillRect(x - (w >> 1) - 1, y - (h >> 1) - 1, w + 2, h + 2);
      ctx.fillStyle = i % 3 === 0 ? '#c4bcc8' : '#8c8494'; ctx.fillRect(x - (w >> 1), y - (h >> 1), w, h);
      ctx.fillStyle = '#0d0b0e'; ctx.fillRect(x - (w >> 1) + 1, y - (h >> 1) + 1, Math.max(0, w - 2), Math.max(0, h - 2));
    }
    ctx.globalAlpha = 1;
  }

  private drawNodes(ctx: CanvasRenderingContext2D, t: number, motion: boolean): void {
    const input = this.input!;
    for (const n of this.byY) {
      const id = n.id;
      const isOrigin = id === this.origin;
      const state: TreeState = this.states.get(id) ?? 'locked';
      const match = !input.searching || input.matches.has(id) || isOrigin;
      const alpha = match ? 1 : 0.26;
      const surf = this.surface(n, state);
      const c = (PLATE_SIZE[n.cls] - 1) / 2;
      const pulse = motion ? 0.5 + 0.5 * Math.sin(t * 3.9 + n.x * 0.05 + n.y * 0.03) : 0.6;
      const sel = input.selected === id, hov = input.hovered === id;
      const fl = this.flash.get(id);
      // halo
      if (state === 'on' || isOrigin) {
        const css = this.tones[n.tone].css;
        const sz = Math.round(n.r * (n.cls === 'keystone' ? 5.4 : n.cls === 'small' ? 4 : 4.6));
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = alpha * (n.cls === 'keystone' ? 0.5 + pulse * 0.2 : n.cls === 'small' ? 0.2 : 0.3 + pulse * 0.08);
        ctx.drawImage(this.halo(css), n.x - sz / 2, n.y - sz / 2, sz, sz);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      }
      // plate (a hammer bump for the first 0.2 s after landing)
      const bump = fl !== undefined && fl < 0.22 ? 1 + 0.3 * (1 - fl / 0.22) : 1;
      if (bump > 1.01) {
        const sz = Math.round(surf.w * bump);
        ctx.globalAlpha = alpha;
        ctx.drawImage(surf.color, n.x - sz / 2 + 0.5, n.y - sz / 2 + 0.5, sz, sz);
        if (surf.glow) { ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(surf.glow, n.x - sz / 2 + 0.5, n.y - sz / 2 + 0.5, sz, sz); ctx.globalCompositeOperation = 'source-over'; }
        ctx.globalAlpha = 1;
      } else drawFrameSurface(ctx, surf, n.x - c, n.y - c, state === 'on' ? (motion ? 0.8 + 0.2 * pulse : 0.9) : 0, alpha);
      if (fl !== undefined) {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.max(0, 0.9 - fl * 5) * alpha;
        ctx.drawImage(surf.color, n.x - c, n.y - c);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      const base = Math.round(n.r + 1.5);
      if (state === 'ready') {
        // a brass ring that breathes: this node can be taken now
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = alpha * (0.3 + pulse * 0.45);
        ctx.fillStyle = '#ff9a3c';
        for (const [px, py] of ringPixels(base)) ctx.fillRect(n.x + px, n.y + py, 1, 1);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      if (state === 'on' && motion && n.cls !== 'small' && !isOrigin) {
        // two sparks orbit a lit notable, three a keystone
        const count = n.cls === 'keystone' ? 3 : 2;
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < count; i++) {
          const a = t * (n.cls === 'keystone' ? 0.7 : 1.3) + (i * Math.PI * 2) / count + n.x;
          const px = Math.round(n.x + Math.cos(a) * (n.r + 0.5)), py = Math.round(n.y + Math.sin(a) * (n.r + 0.5));
          ctx.globalAlpha = 0.9; ctx.fillStyle = '#ffe7a8'; ctx.fillRect(px, py, 1, 1);
          ctx.globalAlpha = 0.3; ctx.fillStyle = this.tones[n.tone].css; ctx.fillRect(px - 1, py - 1, 3, 3);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      if (isOrigin && motion) this.drawBrazier(ctx, n, t);
      if (state === 'gated') {
        ctx.globalAlpha = alpha;
        const off = Math.round(n.r * 0.72);
        ctx.drawImage(this.badge.color, n.x + off - 4, n.y + off - 5);
        ctx.globalAlpha = 1;
      }
      if (this.clashing.has(id)) {
        ctx.globalAlpha = alpha;
        const off = Math.round(n.r * 0.72);
        ctx.drawImage(this.xbadge.color, n.x + off - 4, n.y - off - 8);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = alpha * (motion ? 0.25 + 0.25 * Math.sin(t * 5 + n.x) : 0.35);
        ctx.fillStyle = '#e0503a';
        for (const [px, py] of ringPixels(base)) ctx.fillRect(n.x + px, n.y + py, 1, 1);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      if (input.searching && input.matches.has(id)) {
        ctx.globalCompositeOperation = 'lighter';
        const off = motion ? Math.floor(t * 10) : 0;
        ctx.fillStyle = '#d4f1ff';
        ctx.globalAlpha = 0.95;
        ringPixels(base + 3).forEach(([px, py], i) => { if (((i + off) % 4) < 2) ctx.fillRect(n.x + px, n.y + py, 1, 1); });
        ctx.globalAlpha = 0.25;
        const sz = Math.round(n.r * 6);
        ctx.drawImage(this.halo('#d4f1ff'), n.x - sz / 2, n.y - sz / 2, sz, sz);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      if (hov && !sel) {
        ctx.fillStyle = '#e8dcc0'; ctx.globalAlpha = 0.85;
        for (const [px, py] of ringPixels(base + 1)) ctx.fillRect(n.x + px, n.y + py, 1, 1);
        ctx.globalAlpha = 1;
      }
      if (sel) {
        ctx.globalCompositeOperation = 'lighter';
        const off = motion ? Math.floor(t * 12) : 0;
        ctx.fillStyle = '#ff9a3c';
        ringPixels(base + 2).forEach(([px, py], i) => { if (((i + off) % 8) < 5) ctx.fillRect(n.x + px, n.y + py, 1, 1); });
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#ffe7a8';
        const b = base + 5;
        for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) for (let k = 0; k < 4; k++) {
          ctx.fillRect(n.x + sx * b - sx * k, n.y + sy * b, 1, 1);
          ctx.fillRect(n.x + sx * b, n.y + sy * b - sy * k, 1, 1);
        }
      }
    }
  }

  private drawBrazier(ctx: CanvasRenderingContext2D, n: TreeNode<N, T>, t: number): void {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const ph = (t * 1.6 + i * 0.37) % 1;
      const x = Math.round(n.x + Math.sin(t * 3 + i * 2) * 2.5), y = Math.round(n.y - 3 - ph * 18);
      ctx.globalAlpha = (1 - ph) * 0.85;
      ctx.fillStyle = ph < 0.3 ? '#ffe7a8' : ph < 0.65 ? '#ff9a3c' : '#e8662a';
      const w = ph < 0.5 ? 2 : 1;
      ctx.fillRect(x, y, w, w + 1);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawFx(ctx: CanvasRenderingContext2D, motion: boolean): void {
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.sparks) {
      const u = p.age / p.life;
      ctx.globalAlpha = Math.max(0, 1 - u * u);
      ctx.fillStyle = p.col;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    for (const g of this.ghosts) {
      const s = this.surface(g.node, 'on');
      const c = (PLATE_SIZE[g.node.cls] - 1) / 2;
      ctx.globalAlpha = Math.max(0, 0.7 - g.t * 1.4);
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(s.color, g.node.x - c, g.node.y - c + Math.round(g.t * 5));
      ctx.globalCompositeOperation = 'lighter';
    }
    for (const r of this.rings) {
      if (r.t < 0) continue;
      const u = r.t / r.dur;
      ctx.globalAlpha = Math.max(0, 0.85 * (1 - u));
      ctx.strokeStyle = r.col;
      ctx.lineWidth = 2 - u;
      ctx.beginPath();
      ctx.arc(r.x + 0.5, r.y + 0.5, Math.max(1, r.maxR * ease(Math.sqrt(u))), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    void motion;
  }
}
