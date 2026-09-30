// Ground areas: danger telegraphs (slam, leap landing, eruption, meteor) with fill progress, burning fire pools,
// the player's fire trail and the Herald's empowering aura.
//
// Telegraph readability (render convention): the translucent fill sits on 'decal' (under the horde) while the
// rim and the growing progress ring are additive on 'fx', so a lethal outline is never hidden by monster sprites.
// The last quarter blinks faster. Meteors show the rock falling into its ring; eruptions smoke before they blow.
//
// The Matriarch's charge arrives from the sim as a line of small slam circles spawned on the same tick, resolving
// one after another as she tramples over them. They are drawn as ONE lane: a band from where she stands to where
// she stops, filling up during her wind-up, with chevrons streaming in the charge direction and hard rims; the
// lane shortens from its start as she passes.
//
// Convergence (CONCEPTS pillar 5: VFX never hide what matters): the Matriarch's meteor rain lands 6–10 rocks around
// a player, against the arena rim they bunch onto one spot, and a pack of rift stalkers leaps at one player at once.
// Per frame (heat.ts Proximity), ground danger lights (telegraphs, fire pools) within 40 units of each other share
// one light budget (GROUND_LIGHT: about two telegraphs' worth), the falling rocks bound for one spot share another,
// and piled-up fire pools share their additive glow. Coincident telegraphs (centre and radius within 12) share one
// fill and progress ring (1/(1+n)² each: the first drawn, i.e. the oldest, which resolves first, shows in full), and
// identical danger rims (within 3) one rim's brightness. Every distinct circle keeps its full outline.
//
// The Rimed Ossuary and Iron Coliseum kinds (novas, spikes, the ice prison, blizzards, choir rings, wisp bursts, tar,
// charge and aim lines, the execution mark, arena spikes, whirlwinds) are drawn by bestiary-areas.ts through the same
// telegraph and light budgets.
import type { RGB } from '../contracts/render';
import type { AreaView } from '../contracts/sim';
import { FAULT_WEDGE_HALF_ANGLE, areaAngle, voidTideInner } from '../sim/area-geometry';
import { BestiaryAreaPainter, type AreaAppear } from './bestiary-areas';
import { C } from './colors';
import { CHARGE_MAX_RADIUS, LIGHT_CAPS, type FrameCtx } from './context';
import { Proximity } from './heat';
import type { Effects } from './fx';
import { clamp01, easeInCubic, TAU } from './math';
import type { Pen } from './pen';
import type { SpriteTable } from './sprites';

const SLAM: RGB = [1, 0.16, 0.1];
const LEAP: RGB = [1, 0.38, 0.14];
const ERUPT: RGB = [1, 0.46, 0.12];
const METEOR: RGB = [1, 0.28, 0.08];
const STORM: RGB = [0.5, 0.72, 1];
const REND: RGB = [0.78, 0.06, 0.16];
const POOL_DEEP: RGB = [0.55, 0.08, 0.03];
const POOL_CORE: RGB = [0.95, 0.35, 0.08];
const TRAIL: RGB = [1, 0.5, 0.16];
const AURA: RGB = [0.85, 0.2, 0.08];
const AURA_DEEP: RGB = [0.4, 0.05, 0.03];
const SCORCH: RGB = [0.03, 0.015, 0.015];
const SMOKE: RGB = [0.32, 0.24, 0.22];
const LANE: RGB = [1, 0.14, 0.08];
const LANE_HOT: RGB = [1, 0.5, 0.22];
/** Charge segments spawned together share their age exactly; allow for float noise. */
const SAME_AGE = 1e-3;
const LANE_CAP = 32;
/** Ground danger lights closer than this (world units, about a meteor's diameter) share one budget. */
const LIGHT_NEAR = 40;
/** Light intensity budget of one spot: a single telegraph peaks at 0.53, so two overlapping ones still add up. */
const GROUND_LIGHT = 0.9;
/** Falling rocks bound for one spot share this much light (one rock: 0.6). */
const ROCK_LIGHT = 0.8;
/** Telegraphs closer than this (centre and radius) are coincident: they share one fill and progress ring. */
const FILL_NEAR = 12;
/** Rims this close (centre and radius) are the same circle drawn again: they share one rim's brightness. */
const RIM_NEAR = 3;
/** Fire pools closer than this share their additive glow. */
const POOL_NEAR = 36;
const LIGHT_SLOTS = 64;
const SHAPE_SLOTS = 192;

/** Light granted to a ground light wanting `want` where `used` is already spent nearby this frame. */
export function grantLight(want: number, used: number, budget: number): number {
  return Math.max(0, Math.min(want, budget - used));
}

export class AreaPainter {
  /** Per-area "already drawn as part of a charge lane" marks (indexed like world.areas). */
  private laneMark = new Uint8Array(64);
  private readonly lane = new Int32Array(LANE_CAP);
  /** Per-frame convergence guards: ground light spent, rock light spent, telegraph fills, pool glows. */
  private readonly groundLights = new Proximity(LIGHT_SLOTS, LIGHT_NEAR);
  private readonly rockLights = new Proximity(LIGHT_SLOTS, LIGHT_NEAR);
  private readonly fills = new Proximity(SHAPE_SLOTS, FILL_NEAR);
  private readonly rims = new Proximity(SHAPE_SLOTS, RIM_NEAR);
  private readonly pools = new Proximity(SHAPE_SLOTS, POOL_NEAR);
  private readonly bestiary: BestiaryAreaPainter | null;

  constructor(table?: SpriteTable, fx?: Effects) {
    this.bestiary = table ? new BestiaryAreaPainter(this, table, fx ?? null) : null;
  }

  /** Zone change: forget per-area memory (storm drift, announced telegraphs). */
  reset(): void {
    this.bestiary?.reset();
  }

  /** Announce new execution marks and ice prisons (the presenter's event visuals give them their beat). */
  set onAppear(fn: AreaAppear | null) {
    if (this.bestiary) this.bestiary.onAppear = fn;
  }

  draw(pen: Pen, f: FrameCtx): void {
    const areas = f.world.areas;
    const v = f.view;
    this.bestiary?.beginFrame();
    this.groundLights.reset();
    this.rockLights.reset();
    this.fills.reset();
    this.rims.reset();
    this.pools.reset();
    if (this.laneMark.length < areas.length) this.laneMark = new Uint8Array(areas.length * 2);
    this.laneMark.fill(0, 0, areas.length);
    this.lanes(pen, f);
    for (let k = 0; k < areas.length; k++) {
      if (this.laneMark[k]) continue;
      const ar = areas[k];
      const rad = ar.radius;
      if (ar.x + rad < v.x0 - 40 || ar.x - rad > v.x1 + 40 || ar.y + rad < v.y0 - 160 || ar.y - rad > v.y1 + 40) continue;
      switch (ar.kind) {
        case 'slamWarning':
          this.telegraph(pen, f, ar, SLAM, rad >= 56 ? 2 : 1);
          break;
        case 'leapWarning':
          this.telegraph(pen, f, ar, LEAP, 1);
          this.crosshair(pen, ar, LEAP);
          break;
        case 'eruptionWarning':
          this.telegraph(pen, f, ar, ERUPT, 1);
          this.smoulder(pen, f, ar);
          break;
        case 'meteorWarning':
          this.telegraph(pen, f, ar, METEOR, 1);
          this.meteor(pen, f, ar);
          break;
        case 'stormStrike':
          this.telegraph(pen, f, ar, STORM, 1, [0.85, 0.93, 1]);
          this.crosshair(pen, ar, STORM);
          break;
        case 'rendStrike':
          this.telegraph(pen, f, ar, REND, 1);
          this.crosshair(pen, ar, REND);
          break;
        case 'firePool':
          this.firePool(pen, f, ar);
          break;
        case 'fireTrail':
          this.fireTrail(pen, f, ar);
          break;
        case 'heraldAura':
          this.aura(pen, f, ar);
          break;
        case 'echoMark':
          this.echoMark(pen, f, ar);
          break;
        case 'faultWedge':
          this.faultWedge(pen, f, ar);
          break;
        case 'voidTide':
          this.voidTide(pen, f, ar);
          break;
        default:
          this.bestiary?.draw(pen, f, ar);
      }
    }
  }

  /** Find the charge segments (small slam circles sharing one spawn tick) and draw each group as one lane. */
  private lanes(pen: Pen, f: FrameCtx): void {
    const areas = f.world.areas;
    const mark = this.laneMark;
    const lane = this.lane;
    for (let k = 0; k < areas.length; k++) {
      const a = areas[k];
      if (mark[k] || a.kind !== 'slamWarning' || !(a.radius < CHARGE_MAX_RADIUS)) continue;
      // Gather the group, ordered by resolve time (= distance along the charge).
      let n = 0;
      for (let q = k; q < areas.length && n < LANE_CAP; q++) {
        const b = areas[q];
        if (mark[q] || b.kind !== 'slamWarning' || !(b.radius < CHARGE_MAX_RADIUS) || Math.abs(b.age - a.age) > SAME_AGE) continue;
        mark[q] = 1;
        let at = n++;
        while (at > 0 && areas[lane[at - 1]].duration > b.duration) {
          lane[at] = lane[at - 1];
          at--;
        }
        lane[at] = q;
      }
      this.drawLane(pen, f, n);
    }
  }

  private drawLane(pen: Pen, f: FrameCtx, n: number): void {
    const areas = f.world.areas;
    const first = areas[this.lane[0]];
    const last = areas[this.lane[n - 1]];
    const rad = first.radius;
    const span = Math.hypot(last.x - first.x, last.y - first.y);
    if (n < 2 || span < 1) {
      // The last segment left under her feet.
      this.telegraph(pen, f, first, LANE, 1);
      return;
    }
    // Wind-up progress: her charge starts as the first segment comes due.
    const p = first.duration > 0 ? clamp01(first.age / first.duration) : 1;
    laneBand(pen, f, first.x, first.y, last.x, last.y, rad, p, LANE, LANE_HOT);
  }

  /**
   * A round danger telegraph: translucent fill and a sweep on 'decal', the growing progress ring and the rim
   * (optionally in its own colour) on 'fx'; coincident telegraphs share one fill's glow (see the header).
   */
  telegraph(pen: Pen, f: FrameCtx, a: AreaView, col: RGB, thickness: number, rimCol: RGB = col, lightK = 1): void {
    const r = pen.r;
    const p = a.duration > 0 ? clamp01(a.age / a.duration) : 1;
    // Blink faster as it comes due.
    const late = p > 0.75 ? 0.5 + 0.5 * Math.sin(f.time * 40) : 1;
    // Coincident telegraphs share one fill's worth of glow; an identical rim drawn again adds little.
    const nf = this.fills.sum(a.x, a.y, a.radius);
    this.fills.add(a.x, a.y, 1, a.radius);
    const share = 1 / ((1 + nf) * (1 + nf));
    const nr = this.rims.sum(a.x, a.y, a.radius);
    this.rims.add(a.x, a.y, 1, a.radius);
    const rimShare = 1 / ((1 + nr) * (1 + nr));
    const fill = pen.shape(col, (0.1 + 0.05 * p) * share, 'decal');
    fill.emissive = 0.45;
    r.circle(a.x, a.y, a.radius, fill);
    const sweep = pen.shape(col, (0.16 + 0.12 * p) * share, 'decal');
    sweep.emissive = 0.7;
    sweep.arc = p;
    r.circle(a.x, a.y, a.radius, sweep);
    const grow = pen.shape(col, 0.5 * share, 'fx');
    grow.additive = true;
    grow.emissive = 0.8;
    grow.thickness = 1;
    r.ring(a.x, a.y, Math.max(1, a.radius * p), grow);
    const rim = pen.shape(rimCol, (0.75 + 0.25 * late) * rimShare, 'fx');
    rim.additive = true;
    rim.emissive = 1;
    rim.thickness = thickness;
    r.ring(a.x, a.y, a.radius, rim);
    if (lightK > 0) this.groundLight(pen, f, a.x, a.y, a.radius * 1.3 + 12, col, (0.18 + 0.35 * p) * lightK, 0.1);
  }

  /** A harmless shimmer where an echo, guardian or escort is about to appear: a violet ring closing on the spot (never a hazard). */
  private echoMark(pen: Pen, f: FrameCtx, a: AreaView): void {
    const p = a.duration > 0 ? clamp01(a.age / a.duration) : 1;
    const r = pen.r;
    const col: RGB = [0.62, 0.42, 0.9];
    const ring = pen.shape(col, 0.7 * (1 - p * 0.4), 'decal');
    ring.additive = true;
    ring.emissive = 0.8;
    ring.thickness = 1;
    r.ring(a.x, a.y, Math.max(2, a.radius * (1.6 - 0.6 * p)), ring);
    const core = pen.shape(col, 0.12 + 0.2 * p, 'decal');
    core.additive = true;
    r.circle(a.x, a.y, a.radius * 0.5 * p, core);
    this.groundLight(pen, f, a.x, a.y, a.radius * 2.2, col, 0.2 + 0.2 * p, 0.2);
  }

  /**
   * One wedge of the Fault field: a 90-degree sector telegraph. It fills outward from the centre as the eruption nears
   * (rays on 'decal'), its two edges and outer arc are hard rims on 'fx', and the last quarter blinks: standing in it when it
   * resolves hurts players and monsters alike. Same telegraph budget as the round ones.
   */
  private faultWedge(pen: Pen, f: FrameCtx, a: AreaView): void {
    const r = pen.r;
    const p = a.duration > 0 ? clamp01(a.age / a.duration) : 1;
    const late = p > 0.75 ? 0.5 + 0.5 * Math.sin(f.time * 40) : 1;
    const ang = areaAngle(a);
    const half = FAULT_WEDGE_HALF_ANGLE;
    const col: RGB = [1, 0.22, 0.14];
    // Fill: rays out to the growing edge.
    const rays = 22;
    const reach = a.radius * (0.25 + 0.75 * p);
    const step = (half * 2) / rays;
    const fill = pen.shape(col, 0.09 + 0.07 * p, 'decal');
    fill.thickness = Math.max(3, (a.radius * step) * 1.15);
    fill.emissive = 0.6;
    for (let s = 0; s < rays; s++) {
      const u = ang - half + (s + 0.5) * step;
      r.line(a.x + Math.cos(u) * 12, a.y + Math.sin(u) * 12, a.x + Math.cos(u) * reach, a.y + Math.sin(u) * reach, fill);
    }
    // Rims: the two straight edges and the outer arc, all above the horde.
    const rim = pen.shape(col, 0.85 * late, 'fx');
    rim.additive = true;
    rim.emissive = 1;
    rim.thickness = 2;
    const a0 = ang - half, a1 = ang + half;
    r.line(a.x, a.y, a.x + Math.cos(a0) * a.radius, a.y + Math.sin(a0) * a.radius, rim);
    r.line(a.x, a.y, a.x + Math.cos(a1) * a.radius, a.y + Math.sin(a1) * a.radius, rim);
    let px = a.x + Math.cos(a0) * a.radius, py = a.y + Math.sin(a0) * a.radius;
    for (let s = 1; s <= 16; s++) {
      const u = a0 + (a1 - a0) * s / 16;
      const x = a.x + Math.cos(u) * a.radius, y = a.y + Math.sin(u) * a.radius;
      r.line(px, py, x, y, rim);
      px = x; py = y;
    }
    const cx = a.x + Math.cos(ang) * a.radius * 0.55, cy = a.y + Math.sin(ang) * a.radius * 0.55;
    this.groundLight(pen, f, cx, cy, a.radius * 0.8, col, (0.15 + 0.3 * p) * late, 0.2);
  }

  /**
   * One band of the Void Breach's tide (a ring from the safe radius out past the arena rim). The shaded void (concentric rings on
   * 'decal', under the horde) floods inward from the rim as the telegraph nears its end; the danger line at the inner edge is a
   * hard additive rim on 'fx' that blinks in the last quarter. Standing in it when it resolves hurts players and monsters alike.
   */
  private voidTide(pen: Pen, f: FrameCtx, a: AreaView): void {
    const r = pen.r;
    const p = a.duration > 0 ? clamp01(a.age / a.duration) : 1;
    const late = p > 0.75 ? 0.5 + 0.5 * Math.sin(f.time * 40) : 1;
    const inner = voidTideInner(a);
    const theme = f.theme;
    const col: RGB = theme === 'rimedOssuary' || theme === 'choralCrypt' ? [0.45, 0.6, 1] : theme === 'ironColiseum' || theme === 'chainworks' ? [0.85, 0.2, 0.3] : [0.85, 0.35, 0.75];
    // The visible part of the band: only as far out as the arena (the rest is off the map).
    const edge = Math.min(a.radius, f.world.arenaRadius + 30);
    const step = 14;
    const flood = (edge - inner) * (0.25 + 0.75 * p);
    const fill = pen.shape(col, 0.07 + 0.08 * p, 'decal');
    fill.thickness = step * 1.1;
    fill.emissive = 0.5;
    for (let q = edge; q > inner; q -= step) {
      if (edge - q > flood) break;
      r.ring(a.x, a.y, q - step * 0.5, fill);
    }
    const rim = pen.shape(col, 0.9 * late, 'fx');
    rim.additive = true;
    rim.emissive = 1;
    rim.thickness = 2.5;
    r.ring(a.x, a.y, inner, rim);
    this.groundLight(pen, f, a.x + (inner + 30), a.y, 120, col, (0.12 + 0.25 * p) * late, 0.3);
  }

  /** A ground danger light through the per-frame proximity budget and the area light cap. */
  groundLight(pen: Pen, f: FrameCtx, x: number, y: number, radius: number, col: RGB, intensity: number, flicker: number): void {
    if (f.lights.area >= LIGHT_CAPS.area) return;
    const granted = grantLight(intensity, this.groundLights.sum(x, y), GROUND_LIGHT);
    if (!(granted > 0.01)) return;
    this.groundLights.add(x, y, granted);
    f.lights.area++;
    pen.light(x, y, radius, col, granted, flicker);
  }

  private crosshair(pen: Pen, a: AreaView, col: RGB): void {
    const r = pen.r;
    const s = Math.max(4, a.radius * 0.35);
    const o = pen.shape(col, 0.8, 'fx');
    o.additive = true;
    r.line(a.x - s, a.y, a.x + s, a.y, o);
    r.line(a.x, a.y - s * 0.7, a.x, a.y + s * 0.7, o);
  }

  private smoulder(pen: Pen, f: FrameCtx, a: AreaView): void {
    if (Math.random() < f.fxDt * 16) {
      const ang = Math.random() * TAU;
      const d = Math.sqrt(Math.random()) * a.radius * 0.8;
      const b = pen.burst(a.x + Math.cos(ang) * d, a.y + Math.sin(ang) * d, 1, SMOKE, C.smokeEnd);
      b.sprite = 'fx/smoke';
      pen.speed(2, 8);
      pen.life(0.6, 1);
      pen.size(0.4, 0.7);
      b.sizeEnd = 1.8;
      b.gravity = -26;
      b.additive = false;
      b.emissive = 0;
      pen.emit();
    }
  }

  private meteor(pen: Pen, f: FrameCtx, a: AreaView): void {
    const r = pen.r;
    const p = a.duration > 0 ? clamp01(a.age / a.duration) : 1;
    // The rock appears high above in the second half and accelerates into the ring.
    if (p < 0.4) return;
    const u = (p - 0.4) / 0.6;
    const h = 170 * (1 - easeInCubic(u));
    const x = a.x + 30 * (1 - u);
    const y = a.y - h;
    const so = pen.sprite('shadow');
    so.scale = 0.6 + 1.2 * u;
    so.alpha = 0.3 + 0.5 * u;
    r.sprite('fx/shadow', 0, a.x, a.y, so);
    const o = pen.sprite('fx');
    o.scale = 1.4;
    o.rotation = Math.atan2(h > 0 ? 170 : 1, -30);
    o.sortY = a.y;
    r.sprite('proj/matriarchOrb', Math.floor(f.time * 10) % 4, x, y, o);
    // Keyed by the landing spot: rocks converging on one spot share its light.
    const granted = grantLight(0.6, this.rockLights.sum(a.x, a.y), ROCK_LIGHT);
    if (granted > 0.01) {
      this.rockLights.add(a.x, a.y, granted);
      pen.light(x, y, 54, C.flame, granted, 0.3);
    }
    if (Math.random() < f.fxDt * 20) {
      const b = pen.burst(x, y, 1, C.hot, C.lavaDark);
      b.sprite = 'fx/ember';
      pen.speed(4, 16);
      pen.life(0.2, 0.45);
      pen.size(0.7, 1.1);
      pen.emit();
    }
  }

  private firePool(pen: Pen, f: FrameCtx, a: AreaView): void {
    const r = pen.r;
    const t = a.duration > 0 ? a.age / a.duration : 0;
    const fadeIn = clamp01(a.age / 0.25);
    const fadeOut = clamp01((1 - t) / 0.2);
    const k = fadeIn * fadeOut;
    const pulse = 0.5 + 0.5 * Math.sin(f.time * 3 + a.id);
    const scorch = pen.shape(SCORCH, 0.65 * k, 'decal');
    r.circle(a.x, a.y, a.radius + 3, scorch);
    // Pools piled onto one spot (a meteor shower against the rim) share their glow instead of summing to white.
    const g = k / (1 + 0.6 * this.pools.sum(a.x, a.y));
    this.pools.add(a.x, a.y, k);
    const deep = pen.shape(POOL_DEEP, (0.2 + 0.08 * pulse) * g, 'decal');
    deep.additive = true;
    deep.emissive = 1;
    r.circle(a.x, a.y, a.radius, deep);
    const core = pen.shape(POOL_CORE, (0.1 + 0.07 * pulse) * g, 'decal');
    core.additive = true;
    core.emissive = 1;
    r.circle(a.x, a.y, a.radius * 0.5, core);
    const rim = pen.shape(C.ember, 0.6 * k, 'fx');
    rim.additive = true;
    rim.emissive = 0.9;
    rim.thickness = 1;
    r.ring(a.x, a.y, a.radius, rim);
    this.groundLight(pen, f, a.x, a.y, a.radius * 2.2, C.ember, 0.55 * k, 0.6);
    if (Math.random() < f.fxDt * (6 + a.radius * 0.3) * k) {
      const ang = Math.random() * TAU;
      const d = Math.sqrt(Math.random()) * a.radius * 0.85;
      const b = pen.burst(a.x + Math.cos(ang) * d, a.y + Math.sin(ang) * d, 1, C.hot, C.lavaDark);
      pen.speed(0, 6);
      pen.life(0.45, 0.85);
      pen.size(1, 1.7);
      b.sizeEnd = 0.3;
      b.gravity = -46;
      pen.emit();
    }
  }

  private fireTrail(pen: Pen, f: FrameCtx, a: AreaView): void {
    const r = pen.r;
    const t = a.duration > 0 ? a.age / a.duration : 0;
    const k = clamp01(a.age / 0.15) * clamp01((1 - t) / 0.35);
    const flick = 0.75 + 0.25 * Math.sin(f.time * 17 + a.id * 1.7);
    const o = pen.shape(TRAIL, 0.2 * k * flick, 'decal');
    o.additive = true;
    o.emissive = 1;
    r.circle(a.x, a.y, a.radius * 0.8, o);
    if (f.lights.area < LIGHT_CAPS.area && (a.id & 1) === 0) {
      f.lights.area++;
      pen.light(a.x, a.y - 4, a.radius * 2.2, C.ember, 0.5 * k, 0.6);
    }
    if (Math.random() < f.fxDt * 5 * k) {
      const b = pen.burst(a.x + (Math.random() - 0.5) * a.radius, a.y + (Math.random() - 0.5) * a.radius * 0.6, 1, C.hot, C.ember);
      pen.speed(0, 5);
      pen.life(0.3, 0.6);
      pen.size(0.8, 1.3);
      b.gravity = -40;
      pen.emit();
    }
  }

  private aura(pen: Pen, f: FrameCtx, a: AreaView): void {
    const r = pen.r;
    const pulse = 0.5 + 0.5 * Math.sin(f.time * 2.6);
    const fill = pen.shape(AURA_DEEP, 0.07 + 0.04 * pulse, 'decal');
    fill.additive = true;
    fill.emissive = 0.8;
    r.circle(a.x, a.y, a.radius, fill);
    const rim = pen.shape(AURA, 0.35 + 0.2 * pulse, 'fx');
    rim.additive = true;
    rim.emissive = 0.8;
    rim.thickness = 1;
    r.ring(a.x, a.y, a.radius, rim);
    // A pulse ring breathing outwards from the Herald every beat.
    const beat = (f.time * 0.8) % 1;
    const wave = pen.shape(AURA, 0.35 * (1 - beat), 'fx');
    wave.additive = true;
    wave.thickness = 1;
    r.ring(a.x, a.y, a.radius * (0.3 + 0.7 * beat), wave);
    if (Math.random() < f.fxDt * 14) {
      const ang = Math.random() * TAU;
      const b = pen.burst(a.x + Math.cos(ang) * a.radius, a.y + Math.sin(ang) * a.radius, 1, C.flame, C.lavaDark);
      b.sprite = 'fx/ember';
      pen.speed(12, 22);
      pen.life(0.6, 1);
      pen.size(0.6, 0.9);
      b.angle = ang + Math.PI;
      b.spread = 0.3;
      pen.emit();
    }
  }
}

/**
 * A charge lane: the union of discs of radius `rad` along (x0, y0) → (x1, y1) — a band with round ends — filling
 * with progress `p` (0..1), hard rims on 'fx' so bodies never hide its edge, and chevrons streaming along the charge
 * direction (which way it comes, and that it is coming now). Used by the Matriarch's segment lanes and the
 * bestiary's chargeLine lanes (Varkus).
 */
export function laneBand(
  pen: Pen, f: FrameCtx, x0: number, y0: number, x1: number, y1: number, rad: number, p: number, col: RGB, hot: RGB, lightK = 1,
  steady = false,
): void {
  const r = pen.r;
  let dx = x1 - x0;
  let dy = y1 - y0;
  const span = Math.hypot(dx, dy);
  if (span < 1) return;
  dx /= span;
  dy /= span;
  const nx = -dy;
  const ny = dx;
  const v = f.view;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const reach = span / 2 + rad;
  if (cx + reach < v.x0 - 40 || cx - reach > v.x1 + 40 || cy + reach < v.y0 - 40 || cy - reach > v.y1 + 40) return;
  // The last quarter blinks (it is coming); a `steady` lane (the charge already running) burns without blinking.
  const late = p > 0.75 && !steady ? 0.5 + 0.5 * Math.sin(f.time * 40) : 1;

  const fill = pen.shape(col, 0.1 + 0.05 * p, 'decal');
  fill.emissive = 0.45;
  fill.thickness = rad * 2;
  r.line(x0, y0, x1, y1, fill);
  if (p > 0.02) {
    const sweep = pen.shape(col, 0.12 + 0.1 * p, 'decal');
    sweep.emissive = 0.7;
    sweep.thickness = rad * 2;
    r.line(x0, y0, x0 + dx * span * p, y0 + dy * span * p, sweep);
  }

  // Hard rims on 'fx' so bodies never hide the edge of the lane: two sides and a half-circle at each end.
  const rimAlpha = 0.75 + 0.25 * late;
  const rim = pen.shape(col, rimAlpha, 'fx');
  rim.additive = true;
  rim.emissive = 1;
  rim.thickness = 1;
  const ox = nx * rad;
  const oy = ny * rad;
  r.line(x0 + ox, y0 + oy, x1 + ox, y1 + oy, rim);
  r.line(x0 - ox, y0 - oy, x1 - ox, y1 - oy, rim);
  halfRing(pen, x1, y1, dx, dy, rad, col, rimAlpha);
  halfRing(pen, x0, y0, -dx, -dy, rad, col, rimAlpha);

  // Chevrons streaming along the charge direction: which way it comes, and that it is coming now.
  const step = 30;
  const len = span + rad;
  const count = Math.max(1, Math.floor(len / step));
  const arm = Math.min(12, rad * 0.5);
  const chev = pen.shape(hot, 0, 'fx');
  chev.additive = true;
  chev.emissive = 1;
  chev.thickness = 1;
  for (let c = 0; c < count; c++) {
    const s = -rad * 0.5 + (c + 0.5) * (len / count);
    const wave = Math.max(0, Math.sin(f.time * 9 - s * 0.07));
    chev.alpha = (0.2 + 0.6 * wave * wave) * (0.4 + 0.6 * p);
    const tx = x0 + dx * (s + arm * 0.5);
    const ty = y0 + dy * (s + arm * 0.5);
    const bx = tx - dx * arm;
    const by = ty - dy * arm;
    r.line(bx + nx * arm, by + ny * arm, tx, ty, chev);
    r.line(bx - nx * arm, by - ny * arm, tx, ty, chev);
  }
  if (f.lights.area < LIGHT_CAPS.area && lightK > 0) {
    f.lights.area++;
    pen.light(cx, cy, reach, col, (0.2 + 0.3 * p) * lightK, 0.1);
  }
}

/** The outward half of a lane-rim circle of radius `rad` at (x, y), facing (dx, dy). */
function halfRing(pen: Pen, x: number, y: number, dx: number, dy: number, rad: number, col: RGB, alpha: number): void {
  const r = pen.r;
  const o = pen.shape(col, alpha, 'fx');
  o.additive = true;
  o.emissive = 1;
  o.thickness = 1;
  const a0 = Math.atan2(dy, dx) - Math.PI / 2;
  const n = 8;
  let px = x + Math.cos(a0) * rad;
  let py = y + Math.sin(a0) * rad;
  for (let k = 1; k <= n; k++) {
    const a = a0 + (Math.PI * k) / n;
    const qx = x + Math.cos(a) * rad;
    const qy = y + Math.sin(a) * rad;
    r.line(px, py, qx, qy, o);
    px = qx;
    py = qy;
  }
}
