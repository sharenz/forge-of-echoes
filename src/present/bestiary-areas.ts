// Ground areas of the Rimed Ossuary and Iron Coliseum rosters, drawn by the conventions of src/sim/area-geometry.ts
// (heading and variant packed into the area id) with the art of src/art/bestiary/fxAreas.ts. Telegraph readability
// follows areas.ts: fills on 'decal' (under the horde), danger rims and progress rings additive on 'fx' (over it),
// the last quarter blinking faster; cold danger reads in ice white on frost blue, the arena's in danger red.
//
//   frostNovaWarning  the Warden's nova and the golem's slam: a frost telegraph, frost motes streaming inward.
//   glacialSpike      one spike of a line: a small frost telegraph over the rime crack (fx/iceSpike frame 0,
//                     leaning with the line's heading); the eruption plays at its resolve (events.ts).
//   icePrison         ICE_PRISON_SHARDS 'fx/icePrisonShard' sprites standing on the CURRENT radius, y-sorted with the
//                     player (far half behind her, near half in front), leaning inward harder as it closes; a frost
//                     fill inside, the rim, and the snap radius (ICE_PRISON_END_FRACTION of the start) as an inner ring.
//   blizzard          'fx/blizzard' scaled to the radius, its snow blowing with the wind (mirrored when the storm drifts
//                     west — drift measured from the x/y deltas, the storm bounces), a pale zone fill and edge, and
//                     snow streaming across it.
//   choirWave         the expanding band (±CHOIR_RING_HALF_WIDTH) drawn as arcs between its variant + 1 gaps, bright
//                     ticks at every gap edge: walk through the gap.
//   wispBurst         the pulse telegraph with the freeze core (WISP_FREEZE_FRACTION of the radius) as a hard white
//                     inner ring, beating faster as the burst comes.
//   tarPool           'fx/tarPool' (variant by id) scaled to the radius, with a dim amber edge so black tar reads on
//                     dark stone.
//   chargeLine        variant 0: the crossbow's aim — a thin laser with a travelling glint, hardening as the shot
//                     comes; variant ≥ 1: a charge lane (areas.ts laneBand) of exactly the drawn half-width. The lane
//                     outlives its cast by the dash (CHARGE_LANE_DASH_TAIL): its fill completes AT the launch, and
//                     while he dashes it burns fully filled and hot (a white-hot core down its axis).
//   executionMark     'fx/executionMark' under its player, a countdown sweep, and — once it locks (the last
//                     MARK_LOCKED_TAIL seconds, counted from the time left) — a thick rim and an outer ring tightening
//                     onto it (Varkus leaps onto it: monsters.ts draws him in the air).
//   arenaSpikes       the grate (fx/arenaSpike frame 1, holes glowing) inside a danger telegraph; the spikes shoot up
//                     at the resolve (events.ts).
//   whirlwind         variant 0: a dashed ring turning (the harmless windup); variant 1: the blade ring — danger
//                     fill, a hot rim, motion arcs sweeping round, sparks flung off, blood left on the sand.
import type { RGB } from '../contracts/render';
import type { AreaView } from '../contracts/sim';
import { BESTIARY_FX_RADIUS, BLIZZARD_WIND, ICE_PRISON_SHARDS, icePrisonShardFrame } from '../art';
import {
  CHOIR_RING_HALF_WIDTH, WISP_FREEZE_FRACTION, areaAngle, areaVariant,
} from '../sim/area-geometry';
import type { AreaPainter } from './areas';
import { laneBand } from './areas';
import {
  chargeLaneLaunched, chargeLaneProgress, choirArcs, isWhirlBlades, laneOf, markLocked, markLockProgress, prisonEndRadius, type Lane,
} from './bestiary';
import { C } from './colors';
import type { FrameCtx } from './context';
import type { Effects } from './fx';
import { clamp01, hash01, hash1, TAU } from './math';
import type { Pen } from './pen';
import type { SpriteMeta, SpriteTable } from './sprites';

/** Frost danger: a blue fill under an ice-white rim. */
export const FROST_FILL: RGB = [0.3, 0.58, 1];
export const FROST_RIM: RGB = [0.78, 0.94, 1];
const FROST_CORE: RGB = [0.9, 0.98, 1];
const BLIZZARD_FILL: RGB = [0.42, 0.62, 0.9];
const CHOIR_BAND: RGB = [0.4, 0.66, 1];
const LANE: RGB = [1, 0.14, 0.08];
const LANE_HOT: RGB = [1, 0.5, 0.22];
const AIM: RGB = [1, 0.18, 0.12];
const AIM_HOT: RGB = [1, 0.72, 0.5];
const MARK: RGB = [1, 0.12, 0.1];
const SPIKE: RGB = [1, 0.2, 0.1];
const WHIRL: RGB = [1, 0.3, 0.12];
const WHIRL_HOT: RGB = [1, 0.62, 0.3];
const TAR_EDGE: RGB = [0.62, 0.36, 0.12];
const SNOW: RGB = [0.92, 0.97, 1];
const SNOW_END: RGB = [0.55, 0.68, 0.85];
/** Longest straight piece of a drawn arc (world units): short enough to look round at any radius. */
const ARC_STEP = 14;
/** Seconds a drifting storm keeps its measured velocity without new movement. */
const DRIFT_MEMORY = 60;

interface Drift {
  x: number;
  y: number;
  vx: number;
  vy: number;
  frame: number;
}

/** Called on the first sight of a telegraph worth a beat of its own (the execution mark, the ice prison). */
export type AreaAppear = (kind: AreaView['kind'], x: number, y: number, radius: number, id: number) => void;

export class BestiaryAreaPainter {
  private readonly arcs = new Float32Array(16);
  /** Areas already announced (id → frame last seen). */
  private readonly seen = new Map<number, number>();
  /** Set by the presenter: announces new execution marks and ice prisons. */
  onAppear: AreaAppear | null = null;
  private readonly lane: Lane = { x0: 0, y0: 0, ux: 1, uy: 0, len: 0, half: 0, aim: false };
  private readonly drift = new Map<number, Drift>();
  private frameNo = 0;
  private readonly blizzard: SpriteMeta;
  private readonly mark: SpriteMeta;

  constructor(private readonly host: AreaPainter, table: SpriteTable, private readonly fx: Effects | null) {
    this.blizzard = table.get('fx/blizzard');
    this.mark = table.get('fx/executionMark');
  }

  beginFrame(): void {
    this.frameNo++;
    // Forget storms that are gone (checked once a second: the map holds a handful).
    if (this.frameNo % DRIFT_MEMORY === 0) {
      for (const [id, d] of this.drift) if (this.frameNo - d.frame > DRIFT_MEMORY) this.drift.delete(id);
      for (const [id, frame] of this.seen) if (this.frameNo - frame > DRIFT_MEMORY) this.seen.delete(id);
    }
  }

  reset(): void {
    this.drift.clear();
    this.seen.clear();
  }

  /** First sight of a fresh telegraph worth its own beat (one walked into view later is not news any more). */
  private announce(a: AreaView): void {
    if (!this.seen.has(a.id) && a.age < 0.3) this.onAppear?.(a.kind, a.x, a.y, a.radius, a.id);
    this.seen.set(a.id, this.frameNo);
  }

  /** Draw a bestiary area; false when `a` is not one of them. */
  draw(pen: Pen, f: FrameCtx, a: AreaView): boolean {
    switch (a.kind) {
      case 'frostNovaWarning':
        this.host.telegraph(pen, f, a, FROST_FILL, a.radius >= 70 ? 2 : 1, FROST_RIM);
        this.frostInflow(pen, f, a);
        return true;
      case 'glacialSpike':
        this.glacialSpike(pen, f, a);
        return true;
      case 'icePrison':
        this.announce(a);
        this.icePrison(pen, f, a);
        return true;
      case 'blizzard':
        this.blizzardZone(pen, f, a);
        return true;
      case 'choirWave':
        this.choirWave(pen, f, a);
        return true;
      case 'wispBurst':
        this.wispBurst(pen, f, a);
        return true;
      case 'tarPool':
        this.tarPool(pen, f, a);
        return true;
      case 'chargeLine':
        this.chargeLine(pen, f, a);
        return true;
      case 'executionMark':
        this.announce(a);
        this.executionMark(pen, f, a);
        return true;
      case 'arenaSpikes':
        this.arenaSpikes(pen, f, a);
        return true;
      case 'whirlwind':
        this.whirlwind(pen, f, a);
        return true;
      default:
        return false;
    }
  }

  // ------------------------------------------------------------------------------------------------------------

  /** Frost motes drawn in from the rim towards the centre: the cold gathering before the nova. */
  private frostInflow(pen: Pen, f: FrameCtx, a: AreaView): void {
    const p = a.duration > 0 ? clamp01(a.age / a.duration) : 1;
    if (!(Math.random() < f.fxDt * (6 + a.radius * 0.25) * (0.4 + p))) return;
    const ang = Math.random() * TAU;
    const b = pen.burst(a.x + Math.cos(ang) * a.radius, a.y + Math.sin(ang) * a.radius, 1, C.ice, C.frost);
    b.sprite = 'fx/frost';
    const sp = a.radius / 0.6;
    pen.speed(sp * 0.8, sp);
    pen.life(0.45, 0.6);
    pen.size(0.45, 0.75);
    b.angle = ang + Math.PI;
    b.spread = 0.15;
    b.drag = 0.6;
    pen.emit();
  }

  private glacialSpike(pen: Pen, f: FrameCtx, a: AreaView): void {
    this.host.telegraph(pen, f, a, FROST_FILL, 1, FROST_RIM, 0.6);
    const p = a.duration > 0 ? clamp01(a.age / a.duration) : 1;
    // The rime crack the spike will burst from (frame 0, held while telegraphing), glowing up as it comes. Mirrored
    // by position, exactly like the eruption that follows it (events.ts: the resolve carries no heading).
    const o = pen.sprite('decal');
    o.flipX = spikeFlip(a.x, a.y);
    o.alpha = clamp01(a.age / 0.12);
    o.emissive = 0.3 + 0.6 * p * p;
    pen.r.sprite('fx/iceSpike', 0, a.x, a.y, o);
  }

  private icePrison(pen: Pen, f: FrameCtx, a: AreaView): void {
    const r = pen.r;
    const close = a.duration > 0 ? clamp01(a.age / a.duration) : 1;
    const rad = Math.max(1, a.radius);
    const late = close > 0.75 ? 0.5 + 0.5 * Math.sin(f.time * 36) : 1;
    // Inside is the danger: a frost fill that deepens as it closes, the rim on 'fx', the snap radius inside.
    const fill = pen.shape(FROST_FILL, 0.08 + 0.12 * close, 'decal');
    fill.emissive = 0.5;
    r.circle(a.x, a.y, rad, fill);
    const rim = pen.shape(FROST_RIM, (0.6 + 0.3 * close) * late, 'fx');
    rim.additive = true;
    rim.emissive = 1;
    rim.thickness = 1;
    r.ring(a.x, a.y, rad, rim);
    const end = prisonEndRadius(rad, close);
    if (end > 2 && end < rad - 2) {
      const snap = pen.shape(FROST_CORE, 0.25 + 0.35 * close, 'decal');
      snap.additive = true;
      snap.emissive = 0.8;
      snap.thickness = 1;
      r.ring(a.x, a.y, end, snap);
    }
    // The shards: one prop-like sprite each on the current radius (y-sorted: the ring stands around her).
    const rise = clamp01(a.age / 0.18);
    const n = ICE_PRISON_SHARDS;
    for (let i = 0; i < n; i++) {
      const ang = ((i + 0.5) / n) * TAU;
      const sx = a.x + Math.cos(ang) * rad;
      const sy = a.y + Math.sin(ang) * rad;
      const o = pen.sprite('world');
      o.alpha = rise;
      o.scaleY = 0.35 + 0.65 * rise;
      r.sprite('fx/icePrisonShard', icePrisonShardFrame(ang, close, i, f.time), sx, sy, o);
    }
    // A cold light that gathers as it closes (kept low: she must stay readable inside it).
    this.host.groundLight(pen, f, a.x, a.y - 8, rad * 1.2 + 20, FROST_FILL, 0.12 + 0.25 * close, 0.05);
  }

  private blizzardZone(pen: Pen, f: FrameCtx, a: AreaView): void {
    const r = pen.r;
    const d = this.driftOf(a);
    const fade = clamp01(a.age / 0.6) * clamp01((a.duration - a.age) / 0.8);
    if (fade <= 0.01) return;
    const rad = a.radius;
    // The zone: a pale cold fill and a soft edge on the floor (it chills whoever stands in it).
    const fill = pen.shape(BLIZZARD_FILL, 0.13 * fade, 'decal');
    fill.emissive = 0.4;
    r.circle(a.x, a.y, rad, fill);
    const edge = pen.shape(FROST_RIM, 0.32 * fade, 'decal');
    edge.additive = true;
    edge.emissive = 0.7;
    edge.thickness = 1;
    r.ring(a.x, a.y, rad, edge);
    // The storm itself: wind-driven haze and snow over everything in it, mirrored when it drifts west.
    const west = d.vx < -2;
    const o = pen.sprite('fx');
    o.scale = rad / BESTIARY_FX_RADIUS['fx/blizzard'];
    o.alpha = 0.62 * fade;
    o.emissive = 0.35;
    o.flipX = west;
    o.sortY = a.y + rad * 0.5;
    const m = this.blizzard;
    r.sprite('fx/blizzard', Math.floor(f.time * (m.fps || 12) + hash1(a.id) * m.frames) % Math.max(1, m.frames), a.x, a.y, o);
    // Snow streaming across it with the wind (and the storm's own drift).
    if (Math.random() < f.fxDt * 26 * fade) {
      const wx = west ? -BLIZZARD_WIND.x : BLIZZARD_WIND.x;
      const wy = BLIZZARD_WIND.y;
      const across = (Math.random() - 0.5) * 2 * rad;
      const sx = a.x - wx * rad * 0.9 - wy * across;
      const sy = a.y - wy * rad * 0.9 + wx * across * 0.6;
      const b = pen.burst(sx, sy - 6, 1, SNOW, SNOW_END);
      b.sprite = 'fx/spark';
      pen.speed(70, 110);
      pen.life(0.5, 0.9);
      pen.size(0.35, 0.6);
      b.angle = Math.atan2(wy + d.vy / 90, wx + d.vx / 90);
      b.spread = 0.25;
      b.emissive = 0.6;
      pen.emit();
    }
    this.host.groundLight(pen, f, a.x, a.y, rad * 1.2, BLIZZARD_FILL, 0.18 * fade, 0.1);
  }

  /** Drift velocity of a moving area from its position deltas (smoothed; a bounce turns it within a few frames). */
  private driftOf(a: AreaView): Drift {
    let d = this.drift.get(a.id);
    if (!d) {
      const ang = areaAngle(a);
      d = { x: a.x, y: a.y, vx: Math.cos(ang) * 20, vy: Math.sin(ang) * 20, frame: this.frameNo };
      this.drift.set(a.id, d);
      return d;
    }
    const frames = Math.max(1, this.frameNo - d.frame);
    const dx = a.x - d.x;
    const dy = a.y - d.y;
    if (dx !== 0 || dy !== 0) {
      // Per-frame deltas at ~60 fps; snapshots arrive at 30 Hz, so only moves count (never a zero in between).
      const k = 0.2;
      d.vx += (dx * 60 / frames - d.vx) * k;
      d.vy += (dy * 60 / frames - d.vy) * k;
      d.x = a.x;
      d.y = a.y;
      d.frame = this.frameNo;
    } else if (frames > DRIFT_MEMORY) d.frame = this.frameNo;
    return d;
  }

  private choirWave(pen: Pen, f: FrameCtx, a: AreaView): void {
    const r = pen.r;
    const rad = a.radius;
    const fade = clamp01(a.age / 0.2) * clamp01((a.duration - a.age) / 0.4);
    if (fade <= 0.01 || rad < 2) return;
    const v = f.view;
    // Entirely off screen?
    if (a.x + rad + 8 < v.x0 || a.x - rad - 8 > v.x1 || a.y + rad + 8 < v.y0 || a.y - rad - 8 > v.y1) return;
    const hw = CHOIR_RING_HALF_WIDTH;
    const n = choirArcs(a, this.arcs);
    for (let k = 0; k < n; k++) {
      const a0 = this.arcs[k * 2];
      const a1 = this.arcs[k * 2 + 1];
      // (Pen shape options are one reused object: fill each right before its lines.)
      const band = pen.shape(CHOIR_BAND, 0.2 * fade, 'decal');
      band.emissive = 0.6;
      band.thickness = hw * 2;
      arcLines(pen, f, a.x, a.y, rad, a0, a1, band);
      const edge = pen.shape(FROST_RIM, 0.7 * fade, 'fx');
      edge.additive = true;
      edge.emissive = 1;
      edge.thickness = 1;
      arcLines(pen, f, a.x, a.y, rad - hw, a0, a1, edge);
      arcLines(pen, f, a.x, a.y, rad + hw, a0, a1, edge);
      const core = pen.shape(FROST_CORE, 0.35 * fade, 'fx');
      core.additive = true;
      core.emissive = 1;
      core.thickness = 1;
      arcLines(pen, f, a.x, a.y, rad, a0, a1, core);
      // The gap edges: short bright ticks across the band (the way through).
      const tick = pen.shape(C.white, 0.85 * fade, 'fx');
      tick.additive = true;
      tick.emissive = 1;
      tick.thickness = 1;
      gapTick(pen, a.x, a.y, rad, hw, a0, tick);
      gapTick(pen, a.x, a.y, rad, hw, a1, tick);
    }
    // Frost blowing off the leading edge.
    if (Math.random() < f.fxDt * Math.min(40, rad * 0.12) * fade) {
      const k = Math.floor(Math.random() * n);
      const g = this.arcs[k * 2] + Math.random() * (this.arcs[k * 2 + 1] - this.arcs[k * 2]);
      const b = pen.burst(a.x + Math.cos(g) * rad, a.y + Math.sin(g) * rad - 4, 1, C.ice, C.frost);
      b.sprite = 'fx/frost';
      pen.speed(10, 25);
      pen.life(0.3, 0.6);
      pen.size(0.4, 0.7);
      b.angle = g;
      b.spread = 0.5;
      pen.emit();
    }
  }

  private wispBurst(pen: Pen, f: FrameCtx, a: AreaView): void {
    const r = pen.r;
    const p = a.duration > 0 ? clamp01(a.age / a.duration) : 1;
    this.host.telegraph(pen, f, a, FROST_FILL, 1, FROST_RIM, 0.7);
    // The freeze core: point blank at the burst means Frozen — a hard white inner ring, beating faster.
    const inner = a.radius * WISP_FREEZE_FRACTION;
    const beat = 0.5 + 0.5 * Math.sin(f.time * (12 + 36 * p));
    const fill = pen.shape(FROST_CORE, 0.1 + 0.12 * p, 'decal');
    fill.emissive = 0.7;
    r.circle(a.x, a.y, inner, fill);
    const ring = pen.shape(C.white, 0.55 + 0.45 * beat, 'fx');
    ring.additive = true;
    ring.emissive = 1;
    ring.thickness = 1;
    r.ring(a.x, a.y, inner, ring);
    // Pulses running out from the wisp to the rim.
    const pulse = (f.time * (2.5 + 4 * p) + hash1(a.id)) % 1;
    const wave = pen.shape(FROST_RIM, 0.45 * (1 - pulse), 'fx');
    wave.additive = true;
    wave.thickness = 1;
    r.ring(a.x, a.y, Math.max(1, a.radius * pulse), wave);
  }

  private tarPool(pen: Pen, f: FrameCtx, a: AreaView): void {
    const r = pen.r;
    const fade = clamp01(a.age / 0.2) * clamp01((a.duration - a.age) / 0.6);
    if (fade <= 0.01) return;
    const o = pen.sprite('decal');
    o.scale = a.radius / BESTIARY_FX_RADIUS['fx/tarPool'];
    o.alpha = fade;
    r.sprite('fx/tarPool', Math.floor(hash1(a.id) * 3) % 3, a.x, a.y, o);
    // A dim amber edge: black tar must read on dark stone, and its edge is where the slow starts.
    const edge = pen.shape(TAR_EDGE, 0.3 * fade, 'decal');
    edge.emissive = 0.4;
    edge.thickness = 1;
    r.ring(a.x, a.y, a.radius, edge);
    if (Math.random() < f.fxDt * 0.8 * fade) {
      const ang = Math.random() * TAU;
      const dd = Math.sqrt(Math.random()) * a.radius * 0.7;
      const b = pen.burst(a.x + Math.cos(ang) * dd, a.y + Math.sin(ang) * dd, 1, [0.35, 0.25, 0.15], [0.05, 0.04, 0.03]);
      b.sprite = 'fx/spark';
      pen.speed(0, 2);
      pen.life(0.4, 0.7);
      pen.size(0.4, 0.6);
      b.gravity = -6;
      b.additive = false;
      b.emissive = 0.2;
      b.layer = 'decal';
      pen.emit();
    }
  }

  private chargeLine(pen: Pen, f: FrameCtx, a: AreaView): void {
    const l = laneOf(a, this.lane);
    const x1 = l.x0 + l.ux * l.len;
    const y1 = l.y0 + l.uy * l.len;
    if (!l.aim) {
      // Full fill = the launch (the lane stays up through the dash that follows).
      const launched = chargeLaneLaunched(a.age, a.duration);
      laneBand(pen, f, l.x0, l.y0, x1, y1, l.half, chargeLaneProgress(a.age, a.duration), LANE, LANE_HOT, 0.6, launched);
      if (launched) this.laneLaunched(pen, f, l, x1, y1);
      return;
    }
    const p = a.duration > 0 ? clamp01(a.age / a.duration) : 1;
    // The crossbow's aim: a thin laser along the exact path of the coming bolt, hardening as the shot comes.
    const r = pen.r;
    const late = p > 0.75 ? 0.45 + 0.55 * Math.sin(f.time * 44) : 1;
    const lift = 8;
    const glow = pen.shape(AIM, (0.1 + 0.16 * p) * late, 'fx');
    glow.additive = true;
    glow.emissive = 1;
    glow.thickness = 3;
    r.line(l.x0, l.y0 - lift, x1, y1 - lift, glow);
    const core = pen.shape(p > 0.75 ? AIM_HOT : AIM, (0.45 + 0.5 * p) * late, 'fx');
    core.additive = true;
    core.emissive = 1;
    core.thickness = 1;
    r.line(l.x0, l.y0 - lift, x1, y1 - lift, core);
    // A glint running down the line (the eye follows it to where the bolt will go).
    const run = ((f.time * 1.6 + hash1(a.id)) % 1) * l.len;
    const g = pen.sprite('fx');
    g.additive = true;
    g.tint = AIM_HOT;
    g.alpha = 0.7;
    g.scale = 0.9;
    g.sortY = l.y0 + l.uy * run;
    r.sprite('fx/spark', 0, l.x0 + l.ux * run, l.y0 + l.uy * run - lift, g);
    // Faint ground trace so the lane reads under the horde too.
    const trace = pen.shape(AIM, 0.08 + 0.1 * p, 'decal');
    trace.emissive = 0.6;
    trace.thickness = 2;
    r.line(l.x0, l.y0, x1, y1, trace);
    if (f.lights.area < 24) {
      f.lights.area++;
      pen.light(l.x0, l.y0 - lift, 26, AIM, 0.25 + 0.35 * p, 0.2);
    }
  }

  /** A charge lane while the dash runs: white-hot down its axis, the rims burning steady (no more warning blink). */
  private laneLaunched(pen: Pen, f: FrameCtx, l: Lane, x1: number, y1: number): void {
    const r = pen.r;
    const core = pen.shape(LANE_HOT, 0.55, 'fx');
    core.additive = true;
    core.emissive = 1;
    core.thickness = 2;
    r.line(l.x0, l.y0, x1, y1, core);
    const heat = pen.shape(LANE, 0.16, 'decal');
    heat.emissive = 0.8;
    heat.thickness = l.half * 2;
    r.line(l.x0, l.y0, x1, y1, heat);
    if (f.lights.area < 24) {
      f.lights.area++;
      pen.light((l.x0 + x1) / 2, (l.y0 + y1) / 2, l.len / 2 + l.half, LANE_HOT, 0.3, 0.2);
    }
  }

  private executionMark(pen: Pen, f: FrameCtx, a: AreaView): void {
    const r = pen.r;
    const p = a.duration > 0 ? clamp01(a.age / a.duration) : 1;
    // The mark stops following its player for its last MARK_LOCKED_TAIL seconds (the sim's markTime − markLock):
    // from then on it is too late to hope it moves — step out.
    const locked = markLocked(a.age, a.duration);
    const late = locked ? 0.5 + 0.5 * Math.sin(f.time * (20 + 30 * p)) : 1;
    const rad = a.radius;
    const fade = clamp01(a.age / 0.2);
    // The sigil lies under her: bright enough to dread, never so bright she disappears in it (the rim carries the
    // urgency, the light stays modest).
    const glow = pen.sprite('decal');
    glow.additive = true;
    glow.emissive = 1;
    glow.tint = MARK;
    glow.alpha = (0.06 + 0.08 * p) * fade;
    glow.scaleX = rad / 12;
    glow.scaleY = rad / 24;
    r.sprite('fx/glow', 0, a.x, a.y, glow);
    const o = pen.sprite('decal');
    o.scale = rad / BESTIARY_FX_RADIUS['fx/executionMark'];
    o.alpha = fade * (0.75 + 0.2 * p);
    o.emissive = 0.15 + 0.25 * p;
    const m = this.mark;
    r.sprite('fx/executionMark', Math.floor(f.time * (m.fps || 10)) % Math.max(1, m.frames), a.x, a.y, o);
    const sweep = pen.shape(MARK, 0.1 * fade, 'decal');
    sweep.emissive = 0.6;
    sweep.arc = p;
    r.circle(a.x, a.y, rad, sweep);
    const rim = pen.shape(MARK, (0.6 + 0.4 * late) * fade, 'fx');
    rim.additive = true;
    rim.emissive = 1;
    rim.thickness = locked ? 2 : 1;
    r.ring(a.x, a.y, rad, rim);
    if (locked) {
      // Locked: an outer ring tightening onto the mark (the champion himself is in the air by then).
      const u = markLockProgress(a.age, a.duration);
      const ring = pen.shape(MARK, 0.8 * late, 'fx');
      ring.additive = true;
      ring.emissive = 1;
      ring.thickness = 1;
      r.ring(a.x, a.y, rad * (1.8 - 0.8 * u), ring);
    }
    this.host.groundLight(pen, f, a.x, a.y, rad * 1.5 + 16, MARK, 0.08 + 0.16 * p, 0.1);
  }

  private arenaSpikes(pen: Pen, f: FrameCtx, a: AreaView): void {
    this.host.telegraph(pen, f, a, SPIKE, 1, SPIKE, 0.5);
    const p = a.duration > 0 ? clamp01(a.age / a.duration) : 1;
    // The grate: dormant for a blink, then the holes glow (held while it telegraphs).
    const o = pen.sprite('decal');
    o.alpha = clamp01(a.age / 0.1);
    o.emissive = 0.2 + 0.7 * p;
    pen.r.sprite('fx/arenaSpike', a.age < 0.08 ? 0 : 1, a.x, a.y, o);
  }

  private whirlwind(pen: Pen, f: FrameCtx, a: AreaView): void {
    const r = pen.r;
    const rad = a.radius;
    const p = a.duration > 0 ? clamp01(a.age / a.duration) : 1;
    if (!isWhirlBlades(a)) {
      // The windup: a dashed ring turning where the blades will be, a thin progress ring growing to it.
      const spin = f.time * 3 + hash1(a.id) * TAU;
      const dash = pen.shape(WHIRL, 0.35 + 0.4 * p, 'fx');
      dash.additive = true;
      dash.emissive = 1;
      dash.thickness = 1;
      const n = 12;
      for (let k = 0; k < n; k++) {
        const a0 = spin + (k / n) * TAU;
        arcLines(pen, f, a.x, a.y, rad, a0, a0 + (TAU / n) * 0.55, dash);
      }
      const grow = pen.shape(WHIRL, 0.4, 'fx');
      grow.additive = true;
      grow.thickness = 1;
      r.ring(a.x, a.y, Math.max(1, rad * p), grow);
      const fill = pen.shape(WHIRL, 0.05 + 0.05 * p, 'decal');
      fill.emissive = 0.4;
      r.circle(a.x, a.y, rad, fill);
      return;
    }
    // The blades: danger inside, a hot rim, motion arcs sweeping round. Kept lean on light and glow: the whirler
    // and whoever is caught in it must stay readable inside the ring.
    const fade = clamp01(a.age / 0.1) * clamp01((a.duration - a.age) / 0.2);
    const fill = pen.shape(WHIRL, 0.08 * fade, 'decal');
    fill.emissive = 0.5;
    r.circle(a.x, a.y, rad, fill);
    const rim = pen.shape(WHIRL_HOT, 0.6 * fade, 'fx');
    rim.additive = true;
    rim.emissive = 1;
    rim.thickness = 1;
    r.ring(a.x, a.y, rad, rim);
    const spin = f.time * 9 + hash1(a.id) * TAU;
    for (let k = 0; k < 3; k++) {
      const head = spin + (k / 3) * TAU;
      for (let s = 0; s < 4; s++) {
        const o = pen.shape(s === 0 ? C.hot : WHIRL_HOT, (0.55 - s * 0.12) * fade, 'fx');
        o.additive = true;
        o.emissive = 1;
        o.thickness = s === 0 ? 2 : 1;
        arcLines(pen, f, a.x, a.y, rad * (0.62 + 0.1 * s), head - 0.9 + s * 0.12, head - s * 0.1, o);
      }
    }
    if (Math.random() < f.fxDt * 18 * fade) {
      const ang = spin + Math.floor(Math.random() * 3) * (TAU / 3);
      const b = pen.burst(a.x + Math.cos(ang) * rad * 0.8, a.y + Math.sin(ang) * rad * 0.8 - 8, 2, C.hot, C.ember);
      pen.speed(60, 120);
      pen.life(0.12, 0.3);
      pen.size(0.4, 0.7);
      b.angle = ang + Math.PI / 2;
      b.spread = 0.4;
      b.drag = 0.8;
      pen.emit();
    }
    // The blades leave blood on the sand where they pass (the whirl bleeds).
    if (this.fx && areaVariant(a) >= 1 && Math.random() < f.fxDt * 3 * fade) {
      const ang = Math.random() * TAU;
      const dd = rad * (0.4 + 0.5 * Math.random());
      this.fx.decals.spawn(a.x + Math.cos(ang) * dd, a.y + Math.sin(ang) * dd, 0.5 + Math.random() * 0.3, 8, 0, 'blood');
    }
    this.host.groundLight(pen, f, a.x, a.y - 10, rad * 1.4, WHIRL, 0.22 * fade, 0.4);
  }
}

/** A short bright tick across a choir band at angle `g` (a gap edge: the way through). */
function gapTick(pen: Pen, x: number, y: number, rad: number, hw: number, g: number, o: Parameters<Pen['r']['line']>[4]): void {
  const cx = Math.cos(g);
  const cy = Math.sin(g);
  pen.r.line(x + cx * (rad - hw - 3), y + cy * (rad - hw - 3), x + cx * (rad + hw + 3), y + cy * (rad + hw + 3), o);
}

/** Whether the ice spike at (x, y) is drawn mirrored (a stable variety; shared by its telegraph and its eruption). */
export function spikeFlip(x: number, y: number): boolean {
  return hash01(Math.round(x), Math.round(y), 7) < 0.5;
}

/**
 * Draw the arc from angle a0 to a1 (radians, a1 > a0) of the circle (x, y, rad) as straight pieces with the given
 * shape options (thick options draw a band). Pieces entirely off screen are skipped.
 */
export function arcLines(
  pen: Pen, f: FrameCtx, x: number, y: number, rad: number, a0: number, a1: number, o: Parameters<Pen['r']['line']>[4],
): void {
  if (!(rad > 0.5) || !(a1 > a0)) return;
  const r = pen.r;
  const v = f.view;
  const pad = (o.thickness ?? 1) + 2;
  const n = Math.max(1, Math.min(160, Math.ceil(((a1 - a0) * rad) / ARC_STEP)));
  let px = x + Math.cos(a0) * rad;
  let py = y + Math.sin(a0) * rad;
  for (let k = 1; k <= n; k++) {
    const a = a0 + ((a1 - a0) * k) / n;
    const qx = x + Math.cos(a) * rad;
    const qy = y + Math.sin(a) * rad;
    const inView = !(Math.max(px, qx) < v.x0 - pad || Math.min(px, qx) > v.x1 + pad || Math.max(py, qy) < v.y0 - pad || Math.min(py, qy) > v.y1 + pad);
    if (inView) r.line(px, py, qx, qy, o);
    px = qx;
    py = qy;
  }
}
