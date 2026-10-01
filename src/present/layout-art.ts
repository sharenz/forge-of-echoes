// Ground art of hand-crafted layouts (docs/atlas-rework/D-territory.md 10.2 `decals`, `light`, non-prop landmarks and 10.6):
// roads, glyph circles, cracks, pools, light shafts, plus the walk-through landmarks (crucible, furnace, pit, lake,
// dais, stair, hatch, skull, plinth) and the layout's own light pools. Pure data on both sides: the client derives
// everything from `WorldView.areaId` (set from the run setup) and the arena radius, so no new wire field exists.
//
// Placeholder-quality by design (flat shapes and glows in the theme's accent, in the decal layer under every body);
// the layout packs refine the look. Per-theme kit hook (10.6): `LOOKS` below is the one place a theme recolours the
// shared decal vocabulary.
import type { AtlasAreaId } from '../contracts/atlas';
import type { Theme } from '../contracts/content';
import type { RGB } from '../contracts/render';
import { compileLayout, type CompiledDecal, type CompiledLandmark, type CompiledLayout, type XY } from '../data/layouts/compile';
import { layoutFor } from '../data/layouts';
import { C, hexRgb } from './colors';
import type { FrameCtx } from './context';
import { hash01, TAU } from './math';
import type { Pen } from './pen';
import { themeGlyph, themeRoad } from './layout-art-chainworks-coliseum';

interface DecalLook {
  /** Road bed and its edge lines. */
  road: RGB;
  edge: RGB;
  /** Cracks, glyphs and light shafts glow in this colour. */
  accent: RGB;
  /** Dark pools and pits. */
  pool: RGB;
  /** Pools that are molten / cold: tinted by the accent instead of `pool`. */
  poolGlows: boolean;
}

const LOOKS: Record<Theme, DecalLook> = {
  hideout: { road: [0.3, 0.26, 0.25], edge: [0.5, 0.44, 0.4], accent: C.ember, pool: [0.05, 0.04, 0.05], poolGlows: false },
  ashenForge: { road: [0.27, 0.22, 0.22], edge: [0.46, 0.38, 0.34], accent: C.ember, pool: [0.04, 0.03, 0.03], poolGlows: true },
  cinderChapel: { road: [0.3, 0.26, 0.26], edge: [0.5, 0.42, 0.4], accent: C.flame, pool: [0.05, 0.04, 0.04], poolGlows: false },
  rimedOssuary: { road: [0.26, 0.3, 0.36], edge: [0.5, 0.58, 0.68], accent: C.frost, pool: [0.06, 0.1, 0.18], poolGlows: true },
  choralCrypt: { road: [0.26, 0.23, 0.32], edge: [0.46, 0.4, 0.58], accent: C.voidGlow, pool: [0.06, 0.04, 0.1], poolGlows: false },
  chainworks: { road: [0.28, 0.25, 0.22], edge: [0.55, 0.44, 0.2], accent: C.flame, pool: [0.05, 0.04, 0.03], poolGlows: false },
  ironColiseum: { road: [0.42, 0.34, 0.24], edge: [0.62, 0.52, 0.36], accent: C.gold, pool: [0.12, 0.09, 0.06], poolGlows: false },
};

const HATCH: RGB = [0.06, 0.05, 0.07];

interface ShapeExtras { thickness?: number; additive?: boolean; emissive?: number }

/** Shape options for a decal (reuses the pen's single options object: valid until the next shape call). */
function S(pen: Pen, color: RGB, alpha: number, x: ShapeExtras): ReturnType<Pen['shape']> {
  const o = pen.shape(color, alpha);
  if (x.thickness !== undefined) o.thickness = x.thickness;
  if (x.additive) o.additive = true;
  if (x.emissive !== undefined) o.emissive = x.emissive;
  return o;
}

export class LayoutArt {
  private key = '';
  private compiled: CompiledLayout | null = null;
  private theme: Theme = 'hideout';
  private look: DecalLook = LOOKS.hideout;
  /** Crack polylines (jittered once per build) by decal index. */
  private cracks = new Map<string, XY[]>();

  /** (Re)build for a zone; no layout (or no area) clears everything. */
  build(areaId: AtlasAreaId | undefined, radius: number, theme: Theme): void {
    this.key = `${areaId ?? ''}:${radius}:${theme}`;
    const layout = layoutFor(areaId);
    this.compiled = layout ? compileLayout(layout, radius) : null;
    this.theme = theme;
    this.look = LOOKS[theme];
    this.cracks.clear();
    if (!this.compiled) return;
    for (const d of this.compiled.decals) if (d.kind === 'crack') this.cracks.set(d.id, jitter(d.path, hashOf(d.id)));
  }

  private ensure(f: FrameCtx): CompiledLayout | null {
    const w = f.world;
    const key = `${w.areaId ?? ''}:${w.arenaRadius}:${f.theme}`;
    if (key !== this.key) this.build(w.areaId, w.arenaRadius, f.theme);
    return this.compiled;
  }

  draw(pen: Pen, f: FrameCtx): void {
    const c = this.ensure(f);
    if (!c) return;
    const v = f.view;
    const vis = (x: number, y: number, r: number): boolean => !(x + r < v.x0 || x - r > v.x1 || y + r < v.y0 || y - r > v.y1);
    for (const l of c.landmarks) if (!l.prop && vis(l.x, l.y, l.r + 20)) this.landmark(pen, f, l);
    for (const d of c.decals) {
      if (d.kind === 'road') { if (!themeRoad(this.theme, pen, f, d, vis)) this.road(pen, d, vis); }
      else if (d.kind === 'crack') this.crack(pen, f, d, vis);
      else if (d.kind === 'pool') this.pool(pen, d, vis);
      else if (d.kind === 'glyph') { if (!themeGlyph(this.theme, pen, f, d, vis)) this.glyph(pen, f, d, vis); }
    }
  }

  /** The layout's own light pools and light shafts (called with the ground's lights). */
  lights(pen: Pen, f: FrameCtx): void {
    const c = this.ensure(f);
    if (!c) return;
    const v = f.view;
    const acc = this.look.accent;
    if (c.light) {
      for (const p of c.light.pools) {
        if (p.x + p.r < v.x0 || p.x - p.r > v.x1 || p.y + p.r < v.y0 || p.y - p.r > v.y1) continue;
        pen.light(p.x, p.y, p.r, hexRgb(p.colour), 0.5 * (c.light.ambient > 0 ? 0.6 + c.light.ambient : 1), p.flicker);
      }
    }
    for (const d of c.decals) {
      if (d.kind === 'light' && d.r > 0 && d.x + d.r >= v.x0 && d.x - d.r <= v.x1 && d.y + d.r >= v.y0 && d.y - d.r <= v.y1) {
        pen.light(d.x, d.y, d.r, acc, 0.45, 0.1);
      }
    }
    for (const l of c.landmarks) {
      if (l.prop || l.x + l.r < v.x0 || l.x - l.r > v.x1 || l.y + l.r < v.y0 || l.y - l.r > v.y1) continue;
      const pulse = 0.85 + 0.15 * Math.sin(f.time * 1.4 + l.x * 0.01);
      if (l.kind === 'furnace') pen.light(l.x, l.y, l.r * 1.7, C.ember, 0.75 * pulse, 0.5);
      else if (l.kind === 'crucible') pen.light(l.x, l.y, l.r * 1.5, C.flame, 0.55 * pulse, 0.5);
      else if (l.kind === 'plinth') pen.light(l.x, l.y, l.r * 2.4, acc, 0.4 * pulse, 0.1);
      else if (l.kind === 'pit') pen.light(l.x, l.y, l.r * 1.2, this.look.accent, 0.25 * pulse, 0.3);
    }
  }

  // --- decals -----------------------------------------------------------------------------------------------------

  private road(pen: Pen, d: CompiledDecal, vis: (x: number, y: number, r: number) => boolean): void {
    const r = pen.r;
    const w = d.width > 0 ? d.width : 70;
    const look = this.look;
    for (let i = 1; i < d.path.length; i++) {
      const a = d.path[i - 1];
      const b = d.path[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1 || !vis((a.x + b.x) / 2, (a.y + b.y) / 2, len / 2 + w)) continue;
      const nx = -(b.y - a.y) / len;
      const ny = (b.x - a.x) / len;
      r.line(a.x, a.y, b.x, b.y, S(pen, look.road, 0.34, { thickness: w }));
      for (const s of [-1, 1]) {
        const o = (w / 2) * s;
        r.line(a.x + nx * o, a.y + ny * o, b.x + nx * o, b.y + ny * o, S(pen, look.edge, 0.4, { thickness: 2 }));
      }
      // Paving seams across the road every ~28 u.
      const n = Math.floor(len / 28);
      for (let k = 1; k < n; k++) {
        const t = k / n;
        const cx = a.x + (b.x - a.x) * t;
        const cy = a.y + (b.y - a.y) * t;
        r.line(cx - nx * w * 0.5, cy - ny * w * 0.5, cx + nx * w * 0.5, cy + ny * w * 0.5, S(pen, look.edge, 0.1, { thickness: 1 }));
      }
    }
  }

  private crack(pen: Pen, f: FrameCtx, d: CompiledDecal, vis: (x: number, y: number, r: number) => boolean): void {
    const pts = this.cracks.get(d.id) ?? d.path;
    const r = pen.r;
    const pulse = 0.75 + 0.25 * Math.sin(f.time * 1.6 + hashOf(d.id) * 0.001);
    const col = this.look.accent;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (!vis((a.x + b.x) / 2, (a.y + b.y) / 2, 60)) continue;
      r.line(a.x, a.y, b.x, b.y, S(pen, col, 0.4 * pulse, { thickness: 6, additive: true, emissive: 0.7 }));
      r.line(a.x, a.y, b.x, b.y, S(pen, C.flame, 0.85 * pulse, { thickness: 2, additive: true, emissive: 1 }));
    }
  }

  private pool(pen: Pen, d: CompiledDecal, vis: (x: number, y: number, r: number) => boolean): void {
    const rad = d.r > 0 ? d.r : 60;
    if (!vis(d.x, d.y, rad)) return;
    const r = pen.r;
    const look = this.look;
    r.circle(d.x, d.y, rad, pen.shape(look.pool, 0.55));
    r.ring(d.x, d.y, rad, S(pen, look.poolGlows ? look.accent : look.edge, look.poolGlows ? 0.4 : 0.25, { thickness: 2 }));
  }

  private glyph(pen: Pen, f: FrameCtx, d: CompiledDecal, vis: (x: number, y: number, r: number) => boolean): void {
    const rad = d.r > 0 ? d.r : 50;
    if (!vis(d.x, d.y, rad + 8)) return;
    const r = pen.r;
    const acc = this.look.accent;
    const pulse = 0.7 + 0.3 * Math.sin(f.time * 1.2 + d.x * 0.01);
    r.ring(d.x, d.y, rad, S(pen, acc, 0.5 * pulse, { thickness: 1.5, additive: true, emissive: 0.8 }));
    r.ring(d.x, d.y, rad * 0.62, S(pen, acc, 0.32 * pulse, { thickness: 1, additive: true, emissive: 0.6 }));
    // Tick marks round the rim.
    const n = Math.max(6, Math.round(rad / 7));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      r.line(d.x + ca * rad * 0.62, d.y + sa * rad * 0.62, d.x + ca * rad, d.y + sa * rad, S(pen, acc, 0.16 * pulse, { thickness: 1, additive: true }));
    }
  }

  // --- landmarks --------------------------------------------------------------------------------------------------

  private landmark(pen: Pen, f: FrameCtx, l: CompiledLandmark): void {
    const r = pen.r;
    const look = this.look;
    const acc = look.accent;
    const pulse = 0.8 + 0.2 * Math.sin(f.time * 1.3 + l.x * 0.02);
    switch (l.kind) {
      case 'crucible':
      case 'furnace': {
        const furnace = l.kind === 'furnace';
        r.circle(l.x, l.y, l.r, pen.shape(furnace ? C.lavaDeep : C.coal, 0.8));
        r.ring(l.x, l.y, l.r, S(pen, C.stoneLight, 0.55, { thickness: 3 }));
        r.ring(l.x, l.y, l.r * 0.88, S(pen, C.char, 0.7, { thickness: 2 }));
        // The molten pool: soft glows (a flat disc would read as a target), a hot core and a few rising embers.
        const g = pen.sprite('fx');
        g.additive = true;
        g.tint = C.ember;
        g.alpha = 0.5 * pulse;
        g.scale = (l.r * 1.7) / 32;
        g.emissive = 0.8;
        r.sprite('fx/glow', 0, l.x, l.y, g);
        const core = pen.sprite('fx');
        core.additive = true;
        core.tint = C.hot;
        core.alpha = 0.34 * pulse;
        core.scale = (l.r * 0.8) / 32;
        core.emissive = 1;
        r.sprite('fx/glow', 0, l.x, l.y, core);
        if (Math.random() < f.fxDt * (furnace ? 6 : 3)) {
          const a = Math.random() * TAU;
          const rr = Math.random() * l.r * 0.6;
          const b = pen.burst(l.x + Math.cos(a) * rr, l.y + Math.sin(a) * rr, 1, C.hot, C.ember);
          b.sprite = 'fx/ember';
          pen.speed(4, 14);
          pen.life(0.8, 1.5);
          pen.size(0.5, 0.9);
          b.angle = -Math.PI / 2;
          b.spread = 1.2;
          b.gravity = -22;
          pen.emit();
        }
        break;
      }
      case 'pit':
        r.circle(l.x, l.y, l.r, pen.shape(C.ink, 0.92));
        r.circle(l.x, l.y, l.r * 0.7, pen.shape(C.ink, 0.5));
        r.ring(l.x, l.y, l.r, S(pen, C.stone, 0.6, { thickness: 4 }));
        r.ring(l.x, l.y, l.r * 0.92, S(pen, acc, 0.22 * pulse, { thickness: 2, additive: true }));
        break;
      case 'lake':
        r.circle(l.x, l.y, l.r, pen.shape(C.frost, 0.12));
        r.circle(l.x, l.y, l.r * 0.66, pen.shape(C.ice, 0.07));
        r.ring(l.x, l.y, l.r, S(pen, C.ice, 0.4, { thickness: 2 }));
        break;
      case 'dais':
        r.circle(l.x, l.y, l.r, pen.shape(C.stoneLight, 0.16));
        r.ring(l.x, l.y, l.r, S(pen, C.stoneLight, 0.5, { thickness: 3 }));
        r.ring(l.x, l.y, l.r * 0.62, S(pen, C.ashGrey, 0.28, { thickness: 1.5 }));
        break;
      case 'stair':
        for (let k = 0; k < 5; k++) {
          const y = l.y - l.r * 0.5 + k * (l.r / 4);
          r.line(l.x - l.r * 0.5, y, l.x + l.r * 0.5, y, S(pen, k % 2 ? C.stone : C.stoneLight, 0.55, { thickness: 3 }));
        }
        break;
      case 'hatch':
        r.rect(l.x - l.r * 0.5, l.y - l.r * 0.35, l.r, l.r * 0.7, pen.shape(HATCH, 0.7));
        r.line(l.x - l.r * 0.5, l.y, l.x + l.r * 0.5, l.y, S(pen, C.stoneLight, 0.5, { thickness: 1 }));
        break;
      case 'plinth':
        r.ring(l.x, l.y, l.r, S(pen, acc, 0.5 * pulse, { thickness: 2, additive: true, emissive: 0.8 }));
        r.circle(l.x, l.y, l.r * 0.5, S(pen, acc, 0.2 * pulse, { additive: true, emissive: 0.6 }));
        break;
      case 'skull': {
        const o = pen.sprite('decal');
        o.scale = 2.4;
        o.tint = [0.7, 0.66, 0.62];
        r.sprite('prop/bones', 0, l.x, l.y + 6, o);
        r.ring(l.x, l.y, l.r, S(pen, C.bone, 0.18, { thickness: 1.5 }));
        break;
      }
      default:
        break;
    }
  }
}

function hashOf(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}

/** A crack wobbles around its authored line: seeded jitter, a vertex every ~26 u. */
function jitter(path: readonly XY[], seed: number): XY[] {
  const out: XY[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.round(len / 26));
    const nx = len > 0 ? -(b.y - a.y) / len : 0;
    const ny = len > 0 ? (b.x - a.x) / len : 0;
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const t = k / n;
      const wob = k === 0 || k === n ? 0 : (hash01(k, i, seed) - 0.5) * 14;
      out.push({ x: a.x + (b.x - a.x) * t + nx * wob, y: a.y + (b.y - a.y) * t + ny * wob });
    }
  }
  return out.length > 0 ? out : path.map((p) => ({ ...p }));
}
