// Pooled transient effects: damage numbers, shock rings, chain-lightning bolts, light pulses, dash afterimages,
// ground decals (scorch marks), corpses fading to ash, one-shot animated sprites and floating world texts.
// Every pool is a fixed-capacity struct-of-arrays ring: spawning overwrites the oldest entry when full, nothing is
// allocated per frame (apart from the number strings, created once per distinct value and cached).
import { DAMAGE_TYPES, MONSTER_KINDS, type DamageType } from '../contracts/content';
import type { RGB } from '../contracts/render';
import { C, DAMAGE_COLOR, DAMAGE_CRIT_COLOR } from './colors';
import type { FrameCtx } from './context';
import { clamp01, easeOutCubic, TAU } from './math';
import type { Pen } from './pen';

/** Text width in pixels at an integer font scale (the renderer's measureText). */
export type MeasureText = (text: string, scale: number) => number;

// ------------------------------------------------------------------------------------------------------------
// Damage numbers
// ------------------------------------------------------------------------------------------------------------

/** Cached decimal strings for damage numbers (a busy frame shows hundreds; don't rebuild them every hit). */
const NUM_STRINGS: string[] = [];
export function numberText(n: number): string {
  const v = Math.max(0, Math.round(n));
  if (v >= 20000) return String(v);
  let s = NUM_STRINGS[v];
  if (s === undefined) {
    s = String(v);
    NUM_STRINGS[v] = s;
  }
  return s;
}

export const NUM_STYLE_PLAYER_HURT = 5;
const NUM_CAP = 180;
const NUM_LIFE = 0.78;
const NUM_RISE = 30;
const NUM_RISE_TIME = 0.62;
/** Your own crits pop at font scale 3 for this long after they appear, then settle at 2. */
const NUM_POP = 0.07;
/** A merged number flashes towards white for this long ("the total just went up"). */
const NUM_REPOP = 0.12;
/** Capitals/digits of the renderer's bitmap font are 7 px tall; the default outline adds 1 px on every side. */
const GLYPH_ASCENT = 7;
const NUM_OUTLINE = 1;
/** Vertical gap kept between stacked numbers. */
const NUM_GAP = 1;
/** Numbers anchored this close together belong to one stack (hits on one target / one tight spot). */
const STACK_DX = 14;
const STACK_DY = 36;
/** Hits closer than this (on both axes) may accumulate into one number. */
const MERGE_DIST = 14;
/** With this many numbers already on a spot, new hits accumulate into the newest matching number… */
const MERGE_AFTER = 3;
/** …while that number is younger than this (seconds). */
const MERGE_WINDOW = 0.3;
/** Hard cap per stack: a full stack accumulates every matching hit, and makes room for a new style by dropping
 * its oldest (topmost) number, so a column never climbs more than a few rows above its target. */
const STACK_MAX = 5;
const ALIVE = 4;
const CRIT = 1;
const OWN = 2;
const PLAYER_HURT: RGB = [1, 0.32, 0.28];

/**
 * Floating damage numbers that never overlap on one target.
 *
 * Every number rises on the same cubic-out curve from its anchor, so an older number is always at least as high
 * as a younger one from the same spot. On top of that each number carries a `push`: when a new number appears,
 * every number of its stack whose box could meet it is pushed up (instantly) until the new box clears it. Since
 * pushes preserve the order and the shared rise only ever adds separation, a stack stays legible for its whole
 * life. Under sustained fire, hits accumulate into the newest matching number (same style, crit and owner)
 * instead of growing the column: the classic ARPG running total, re-flashing on every merge.
 */
export class DamageNumbers {
  private readonly ax = new Float32Array(NUM_CAP);
  private readonly ay = new Float32Array(NUM_CAP);
  private readonly push = new Float32Array(NUM_CAP);
  /** Rise clock (never reset: keeps stack order). */
  private readonly age = new Float32Array(NUM_CAP);
  /** Fade clock (a merge restarts it so the running total stays up). */
  private readonly fade = new Float32Array(NUM_CAP);
  /** Seconds since the last merge (re-pop highlight). */
  private readonly pop = new Float32Array(NUM_CAP);
  private readonly amount = new Float32Array(NUM_CAP);
  private readonly style = new Uint8Array(NUM_CAP);
  private readonly flags = new Uint8Array(NUM_CAP); // CRIT | OWN | ALIVE
  private readonly text: string[] = new Array<string>(NUM_CAP).fill('');
  /** Text width at scale 1 (cached on every text change). */
  private readonly w1 = new Float32Array(NUM_CAP);
  private next = 0;
  /** New numbers this frame (a dense wave can produce hundreds of hits per frame). */
  private spawned = 0;
  private readonly c: [number, number, number] = [1, 1, 1];

  constructor(private readonly measure: MeasureText) {}

  beginFrame(): void {
    this.spawned = 0;
  }

  /** Integer font scale number `i` is drawn at right now. */
  scaleOf(i: number): number {
    const f = this.flags[i];
    if ((f & (CRIT | OWN)) !== (CRIT | OWN)) return 1;
    return this.age[i] < NUM_POP ? 3 : 2;
  }

  private halfH(scale: number): number {
    return (GLYPH_ASCENT * scale) / 2 + NUM_OUTLINE;
  }

  private halfW(i: number, scale: number): number {
    return (this.w1[i] * scale) / 2 + NUM_OUTLINE;
  }

  /** Rendered centre y of number i. */
  yOf(i: number): number {
    return this.ay[i] - easeOutCubic(clamp01(this.age[i] / NUM_RISE_TIME)) * NUM_RISE - this.push[i];
  }

  /**
   * Show `amount` at (x, y). `style` is a DAMAGE_TYPES index or NUM_STYLE_PLAYER_HURT; `own` numbers (your hits,
   * hits on you, the training dummy) are bright, everyone else's are dimmer and budgeted.
   */
  spawn(x: number, y: number, amount: number, style: number, crit: boolean, own: boolean): void {
    const want = (crit ? CRIT : 0) | (own ? OWN : 0);
    const newScale = crit && own ? 3 : 1;
    const newHalfW = (this.measure(numberText(amount), 1) * newScale) / 2 + NUM_OUTLINE;
    // Gather the stack this number joins, the newest matching number to accumulate into, and the oldest member.
    let members = 0;
    let same = -1;
    let oldest = -1;
    for (let i = 0; i < NUM_CAP; i++) {
      const fl = this.flags[i];
      if (!(fl & ALIVE)) continue;
      const dx = Math.abs(this.ax[i] - x);
      const dy = Math.abs(this.ay[i] - y);
      if (dy >= STACK_DY) continue;
      if (dx >= STACK_DX && dx >= this.halfW(i, this.scaleOf(i)) + newHalfW + NUM_GAP) continue;
      members++;
      if (oldest < 0 || this.age[i] > this.age[oldest]) oldest = i;
      if (
        dx < MERGE_DIST && dy < MERGE_DIST && this.style[i] === style && (fl & (CRIT | OWN)) === want &&
        (same < 0 || this.age[i] < this.age[same])
      ) same = i;
    }
    if (same >= 0 && (members >= STACK_MAX || (members >= MERGE_AFTER && this.age[same] < MERGE_WINDOW))) {
      const total = this.amount[same] + amount;
      this.amount[same] = total;
      this.text[same] = numberText(total);
      this.w1[same] = this.measure(this.text[same], 1);
      this.fade[same] = Math.min(this.fade[same], 0.12);
      this.pop[same] = 0;
      return;
    }
    // Crits and your own numbers always show; everything else is capped per frame.
    if (!crit && this.spawned > (own ? 40 : 14)) return;
    this.spawned++;
    while (members >= STACK_MAX && oldest >= 0) {
      this.flags[oldest] = 0;
      members--;
      oldest = this.oldestNear(x, y, newHalfW);
    }

    // Push the stack up until the new box clears every member. Separation is measured on the rise-free
    // ("virtual") centres: the shared rise only ever increases it, so what clears now stays clear.
    const hhNew = this.halfH(newScale);
    let delta = 0;
    for (let i = 0; i < NUM_CAP; i++) {
      if (!(this.flags[i] & ALIVE)) continue;
      const dx = Math.abs(this.ax[i] - x);
      if (Math.abs(this.ay[i] - y) >= STACK_DY) continue;
      if (dx >= STACK_DX && dx >= this.halfW(i, this.scaleOf(i)) + newHalfW + NUM_GAP) continue;
      const need = this.halfH(this.scaleOf(i)) + hhNew + NUM_GAP - (y - (this.ay[i] - this.push[i]));
      if (need > delta) delta = need;
    }
    if (delta > 0) {
      for (let i = 0; i < NUM_CAP; i++) {
        if (!(this.flags[i] & ALIVE)) continue;
        const dx = Math.abs(this.ax[i] - x);
        if (Math.abs(this.ay[i] - y) >= STACK_DY) continue;
        if (dx >= STACK_DX && dx >= this.halfW(i, this.scaleOf(i)) + newHalfW + NUM_GAP) continue;
        this.push[i] += delta;
      }
    }

    const i = this.next;
    this.next = (this.next + 1) % NUM_CAP;
    this.ax[i] = x;
    this.ay[i] = y;
    this.push[i] = 0;
    this.age[i] = 0;
    this.fade[i] = 0;
    this.pop[i] = NUM_REPOP;
    this.amount[i] = amount;
    this.style[i] = style;
    this.flags[i] = ALIVE | want;
    this.text[i] = numberText(amount);
    this.w1[i] = this.measure(this.text[i], 1);
  }

  /** The oldest live number in the stack at (x, y), or −1. */
  private oldestNear(x: number, y: number, newHalfW: number): number {
    let oldest = -1;
    for (let i = 0; i < NUM_CAP; i++) {
      if (!(this.flags[i] & ALIVE) || Math.abs(this.ay[i] - y) >= STACK_DY) continue;
      const dx = Math.abs(this.ax[i] - x);
      if (dx >= STACK_DX && dx >= this.halfW(i, this.scaleOf(i)) + newHalfW + NUM_GAP) continue;
      if (oldest < 0 || this.age[i] > this.age[oldest]) oldest = i;
    }
    return oldest;
  }

  private lifeOf(i: number): number {
    return NUM_LIFE * ((this.flags[i] & CRIT) ? 1.25 : 1);
  }

  update(dt: number): void {
    for (let i = 0; i < NUM_CAP; i++) {
      if (!(this.flags[i] & ALIVE)) continue;
      this.age[i] += dt;
      this.pop[i] += dt;
      const f = this.fade[i] + dt;
      this.fade[i] = f;
      if (f >= this.lifeOf(i)) this.flags[i] = 0;
    }
  }

  draw(pen: Pen): void {
    const r = pen.r;
    const c = this.c;
    for (let i = 0; i < NUM_CAP; i++) {
      const fl = this.flags[i];
      if (!(fl & ALIVE)) continue;
      const crit = (fl & CRIT) !== 0;
      const own = (fl & OWN) !== 0;
      const t = this.fade[i] / this.lifeOf(i);
      const alpha = (t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1) * (own ? 1 : 0.55);
      const st = this.style[i];
      const base = st === NUM_STYLE_PLAYER_HURT ? PLAYER_HURT : crit ? DAMAGE_CRIT_COLOR[DAMAGE_TYPES[st]] : DAMAGE_COLOR[DAMAGE_TYPES[st]];
      // A fresh or freshly merged number flashes towards white for a beat.
      const hot = this.pop[i] < NUM_REPOP ? 0.6 * (1 - this.pop[i] / NUM_REPOP) : 0;
      c[0] = base[0] + (1 - base[0]) * hot;
      c[1] = base[1] + (1 - base[1]) * hot;
      c[2] = base[2] + (1 - base[2]) * hot;
      // Integer font scales only: your crits pop at 3 for a beat, then settle at 2; allies' numbers stay small.
      const o = pen.text(c, alpha, this.scaleOf(i));
      r.text(this.text[i], this.ax[i], this.yOf(i), o);
    }
  }

  clear(): void {
    this.flags.fill(0);
  }
}

// ------------------------------------------------------------------------------------------------------------
// Shock rings (nova, impacts, level-up, portal bursts)
// ------------------------------------------------------------------------------------------------------------

const RING_CAP = 72;

class Rings {
  private readonly x = new Float32Array(RING_CAP);
  private readonly y = new Float32Array(RING_CAP);
  private readonly r0 = new Float32Array(RING_CAP);
  private readonly r1 = new Float32Array(RING_CAP);
  private readonly age = new Float32Array(RING_CAP);
  private readonly life = new Float32Array(RING_CAP);
  private readonly thick = new Float32Array(RING_CAP);
  private readonly alpha = new Float32Array(RING_CAP);
  private readonly col = new Float32Array(RING_CAP * 3);
  private readonly light = new Float32Array(RING_CAP);
  private next = 0;
  private readonly c: [number, number, number] = [1, 1, 1];

  spawn(x: number, y: number, r0: number, r1: number, life: number, color: RGB, thickness = 1, alpha = 1, light = 0): void {
    const i = this.next;
    this.next = (this.next + 1) % RING_CAP;
    this.x[i] = x;
    this.y[i] = y;
    this.r0[i] = r0;
    this.r1[i] = r1;
    this.age[i] = 0;
    this.life[i] = life;
    this.thick[i] = thickness;
    this.alpha[i] = alpha;
    this.col[i * 3] = color[0];
    this.col[i * 3 + 1] = color[1];
    this.col[i * 3 + 2] = color[2];
    this.light[i] = light;
  }

  update(dt: number): void {
    for (let i = 0; i < RING_CAP; i++) if (this.life[i] > 0) this.age[i] += dt;
  }

  draw(pen: Pen): void {
    const r = pen.r;
    const c = this.c;
    for (let i = 0; i < RING_CAP; i++) {
      const life = this.life[i];
      if (!(life > 0)) continue;
      const t = this.age[i] / life;
      if (t >= 1) {
        this.life[i] = 0;
        continue;
      }
      const e = easeOutCubic(t);
      const rad = this.r0[i] + (this.r1[i] - this.r0[i]) * e;
      c[0] = this.col[i * 3];
      c[1] = this.col[i * 3 + 1];
      c[2] = this.col[i * 3 + 2];
      const a = this.alpha[i] * (1 - t) * (1 - t);
      const o = pen.shape(c, a, 'fx');
      o.additive = true;
      o.emissive = 1;
      o.thickness = Math.max(1, this.thick[i] * (1 - t * 0.5));
      r.ring(this.x[i], this.y[i], rad, o);
      if (this.light[i] > 0) pen.light(this.x[i], this.y[i], rad * 1.4 + 20, c, this.light[i] * (1 - t));
    }
  }

  clear(): void {
    this.life.fill(0);
  }
}

// ------------------------------------------------------------------------------------------------------------
// Chain lightning bolts: jagged polylines re-jittered every frame while they flicker out
// ------------------------------------------------------------------------------------------------------------

const CHAIN_CAP = 24;
const CHAIN_MAX_POINTS = 16;
const CHAIN_LIFE = 0.3;

class Chains {
  private readonly pts = new Float32Array(CHAIN_CAP * CHAIN_MAX_POINTS * 2);
  private readonly n = new Uint8Array(CHAIN_CAP);
  private readonly age = new Float32Array(CHAIN_CAP);
  private readonly type = new Uint8Array(CHAIN_CAP);
  private next = 0;

  spawn(points: readonly number[], damageType: DamageType): void {
    const count = Math.min(CHAIN_MAX_POINTS, Math.floor(points.length / 2));
    if (count < 2) return;
    const i = this.next;
    this.next = (this.next + 1) % CHAIN_CAP;
    const o = i * CHAIN_MAX_POINTS * 2;
    for (let k = 0; k < count * 2; k++) this.pts[o + k] = points[k];
    this.n[i] = count;
    this.age[i] = 0;
    this.type[i] = DAMAGE_TYPES.indexOf(damageType);
  }

  update(dt: number): void {
    for (let i = 0; i < CHAIN_CAP; i++) if (this.n[i] > 0) this.age[i] += dt;
  }

  draw(pen: Pen): void {
    const r = pen.r;
    for (let i = 0; i < CHAIN_CAP; i++) {
      const n = this.n[i];
      if (n < 2) continue;
      const t = this.age[i] / CHAIN_LIFE;
      if (t >= 1) {
        this.n[i] = 0;
        continue;
      }
      // Flicker: visible most frames, dropping out briefly as it dies.
      const fade = (1 - t) * (Math.random() < 0.15 + t * 0.4 ? 0.35 : 1);
      const o = i * CHAIN_MAX_POINTS * 2;
      for (let k = 0; k + 1 < n; k++) {
        const x0 = this.pts[o + k * 2];
        const y0 = this.pts[o + k * 2 + 1] - (k === 0 ? 14 : 7);
        const x1 = this.pts[o + k * 2 + 2];
        const y1 = this.pts[o + k * 2 + 3] - 7;
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;
        const steps = Math.max(2, Math.round(len / 11));
        let px = x0;
        let py = y0;
        for (let s = 1; s <= steps; s++) {
          const u = s / steps;
          const off = s === steps ? 0 : (Math.random() - 0.5) * 12 * (1 - Math.abs(u - 0.5));
          const qx = x0 + dx * u + nx * off;
          const qy = y0 + dy * u + ny * off;
          const glow = pen.shape(C.storm, 0.45 * fade, 'fx');
          glow.thickness = 3;
          glow.additive = true;
          r.line(px, py, qx, qy, glow);
          const core = pen.shape(C.lightning, fade, 'fx');
          core.thickness = 1;
          core.emissive = 1;
          r.line(px, py, qx, qy, core);
          px = qx;
          py = qy;
        }
        pen.light(x1, y1, 46, C.storm, 0.9 * fade);
      }
    }
  }

  clear(): void {
    this.n.fill(0);
  }
}

// ------------------------------------------------------------------------------------------------------------
// Light pulses (impact flashes, explosions)
// ------------------------------------------------------------------------------------------------------------

const PULSE_CAP = 96;

class Pulses {
  private readonly x = new Float32Array(PULSE_CAP);
  private readonly y = new Float32Array(PULSE_CAP);
  private readonly rad = new Float32Array(PULSE_CAP);
  private readonly age = new Float32Array(PULSE_CAP);
  private readonly life = new Float32Array(PULSE_CAP);
  private readonly k = new Float32Array(PULSE_CAP);
  private readonly col = new Float32Array(PULSE_CAP * 3);
  private next = 0;
  private readonly c: [number, number, number] = [1, 1, 1];

  spawn(x: number, y: number, radius: number, life: number, color: RGB, intensity: number): void {
    const i = this.next;
    this.next = (this.next + 1) % PULSE_CAP;
    this.x[i] = x;
    this.y[i] = y;
    this.rad[i] = radius;
    this.age[i] = 0;
    this.life[i] = life;
    this.k[i] = intensity;
    this.col[i * 3] = color[0];
    this.col[i * 3 + 1] = color[1];
    this.col[i * 3 + 2] = color[2];
  }

  update(dt: number): void {
    for (let i = 0; i < PULSE_CAP; i++) if (this.life[i] > 0) this.age[i] += dt;
  }

  draw(pen: Pen): void {
    const c = this.c;
    for (let i = 0; i < PULSE_CAP; i++) {
      const life = this.life[i];
      if (!(life > 0)) continue;
      const t = this.age[i] / life;
      if (t >= 1) {
        this.life[i] = 0;
        continue;
      }
      c[0] = this.col[i * 3];
      c[1] = this.col[i * 3 + 1];
      c[2] = this.col[i * 3 + 2];
      pen.light(this.x[i], this.y[i], this.rad[i] * (0.8 + 0.2 * t), c, this.k[i] * (1 - t) * (1 - t));
    }
  }

  clear(): void {
    this.life.fill(0);
  }
}

// ------------------------------------------------------------------------------------------------------------
// One-shot animated sprites (impact stars, slashes, level-up column) and afterimages
// ------------------------------------------------------------------------------------------------------------

const SFX_CAP = 96;

class SpriteFx {
  private readonly ids: string[] = new Array<string>(SFX_CAP).fill('');
  private readonly x = new Float32Array(SFX_CAP);
  private readonly y = new Float32Array(SFX_CAP);
  private readonly age = new Float32Array(SFX_CAP);
  private readonly life = new Float32Array(SFX_CAP);
  private readonly frames = new Uint8Array(SFX_CAP);
  private readonly scale = new Float32Array(SFX_CAP);
  private readonly rot = new Float32Array(SFX_CAP);
  private readonly alpha = new Float32Array(SFX_CAP);
  private readonly flip = new Uint8Array(SFX_CAP);
  private readonly additive = new Uint8Array(SFX_CAP);
  private readonly layerFx = new Uint8Array(SFX_CAP);
  private readonly col = new Float32Array(SFX_CAP * 3);
  private readonly fixedFrame = new Int16Array(SFX_CAP);
  private next = 0;
  private readonly c: [number, number, number] = [1, 1, 1];

  /**
   * Play `id` once over `life` seconds (its frames spread over the life), or hold `fixedFrame` ≥ 0 fading out
   * (afterimages). Colour multiplies the sprite.
   */
  spawn(
    id: string, frames: number, x: number, y: number, life: number, opts: {
      scale?: number; rotation?: number; alpha?: number; flip?: boolean; additive?: boolean; world?: boolean; color?: RGB; frame?: number;
    },
  ): void {
    const i = this.next;
    this.next = (this.next + 1) % SFX_CAP;
    this.ids[i] = id;
    this.frames[i] = Math.max(1, frames);
    this.x[i] = x;
    this.y[i] = y;
    this.age[i] = 0;
    this.life[i] = life;
    this.scale[i] = opts.scale ?? 1;
    this.rot[i] = opts.rotation ?? 0;
    this.alpha[i] = opts.alpha ?? 1;
    this.flip[i] = opts.flip ? 1 : 0;
    this.additive[i] = opts.additive === false ? 0 : 1;
    this.layerFx[i] = opts.world ? 0 : 1;
    const c = opts.color ?? C.white;
    this.col[i * 3] = opts.color ? c[0] : 1;
    this.col[i * 3 + 1] = opts.color ? c[1] : 1;
    this.col[i * 3 + 2] = opts.color ? c[2] : 1;
    this.fixedFrame[i] = opts.frame ?? -1;
  }

  update(dt: number): void {
    for (let i = 0; i < SFX_CAP; i++) if (this.life[i] > 0) this.age[i] += dt;
  }

  draw(pen: Pen): void {
    const r = pen.r;
    const c = this.c;
    for (let i = 0; i < SFX_CAP; i++) {
      const life = this.life[i];
      if (!(life > 0)) continue;
      const t = this.age[i] / life;
      if (t >= 1) {
        this.life[i] = 0;
        continue;
      }
      const fixed = this.fixedFrame[i];
      const frame = fixed >= 0 ? fixed : Math.min(this.frames[i] - 1, Math.floor(t * this.frames[i]));
      const o = pen.sprite(this.layerFx[i] ? 'fx' : 'world');
      c[0] = this.col[i * 3];
      c[1] = this.col[i * 3 + 1];
      c[2] = this.col[i * 3 + 2];
      o.tint = c;
      o.additive = this.additive[i] === 1;
      o.alpha = this.alpha[i] * (fixed >= 0 ? (1 - t) * (1 - t) : t > 0.7 ? (1 - t) / 0.3 : 1);
      o.flipX = this.flip[i] === 1;
      const s = this.scale[i];
      if (s !== 1) o.scale = s;
      if (this.rot[i] !== 0) o.rotation = this.rot[i];
      if (this.layerFx[i] === 0) o.emissive = 0.35;
      r.sprite(this.ids[i], frame, this.x[i], this.y[i], o);
    }
  }

  clear(): void {
    this.life.fill(0);
  }
}

// ------------------------------------------------------------------------------------------------------------
// Ground decals: scorch marks (cooling embers)
// ------------------------------------------------------------------------------------------------------------

const DECAL_CAP = 64;

class Decals {
  private readonly x = new Float32Array(DECAL_CAP);
  private readonly y = new Float32Array(DECAL_CAP);
  private readonly age = new Float32Array(DECAL_CAP);
  private readonly life = new Float32Array(DECAL_CAP);
  private readonly variant = new Uint8Array(DECAL_CAP);
  private readonly scale = new Float32Array(DECAL_CAP);
  private readonly hot = new Float32Array(DECAL_CAP);
  private next = 0;

  spawn(x: number, y: number, scale: number, life: number, hot: number): void {
    const i = this.next;
    this.next = (this.next + 1) % DECAL_CAP;
    this.x[i] = x;
    this.y[i] = y;
    this.age[i] = 0;
    this.life[i] = life;
    this.variant[i] = (Math.random() * 2) | 0;
    this.scale[i] = scale;
    this.hot[i] = hot;
  }

  update(dt: number): void {
    for (let i = 0; i < DECAL_CAP; i++) if (this.life[i] > 0) this.age[i] += dt;
  }

  draw(pen: Pen, f: FrameCtx): void {
    const r = pen.r;
    const v = f.view;
    for (let i = 0; i < DECAL_CAP; i++) {
      const life = this.life[i];
      if (!(life > 0)) continue;
      const t = this.age[i] / life;
      if (t >= 1) {
        this.life[i] = 0;
        continue;
      }
      const x = this.x[i];
      const y = this.y[i];
      if (x < v.x0 - 40 || x > v.x1 + 40 || y < v.y0 - 40 || y > v.y1 + 40) continue;
      const o = pen.sprite('decal');
      o.alpha = t > 0.6 ? 1 - (t - 0.6) / 0.4 : 1;
      o.scale = this.scale[i];
      // Embers in the scorch cool over the first seconds.
      o.emissive = this.hot[i] * Math.max(0, 1 - this.age[i] / 2.5);
      r.sprite('fx/scorch', this.variant[i], x, y, o);
    }
  }

  clear(): void {
    this.life.fill(0);
  }
}

// ------------------------------------------------------------------------------------------------------------
// Corpses: collapse animation, then char to ash and fade (capped; the oldest goes first)
// ------------------------------------------------------------------------------------------------------------

const CORPSE_CAP = 220;
const CORPSE_IDS = MONSTER_KINDS.map((k) => `monster/${k}/corpse`);

class Corpses {
  private readonly x = new Float32Array(CORPSE_CAP);
  private readonly y = new Float32Array(CORPSE_CAP);
  private readonly age = new Float32Array(CORPSE_CAP);
  private readonly life = new Float32Array(CORPSE_CAP);
  private readonly kind = new Uint8Array(CORPSE_CAP);
  private readonly flip = new Uint8Array(CORPSE_CAP);
  private readonly dtype = new Uint8Array(CORPSE_CAP);
  private readonly fps = new Float32Array(MONSTER_KINDS.length);
  private readonly frameCount = new Uint8Array(MONSTER_KINDS.length);
  private readonly ashed = new Uint8Array(CORPSE_CAP);
  private next = 0;
  private readonly tint: [number, number, number] = [1, 1, 1];

  setInfo(kind: number, frames: number, fps: number): void {
    this.frameCount[kind] = frames;
    this.fps[kind] = fps;
  }

  spawn(kind: number, x: number, y: number, flip: boolean, dtype: number, life: number): number {
    const i = this.next;
    this.next = (this.next + 1) % CORPSE_CAP;
    this.x[i] = x;
    this.y[i] = y;
    this.age[i] = 0;
    this.life[i] = life;
    this.kind[i] = kind;
    this.flip[i] = flip ? 1 : 0;
    this.dtype[i] = dtype;
    this.ashed[i] = 0;
    return i;
  }

  update(dt: number, pen: Pen): void {
    for (let i = 0; i < CORPSE_CAP; i++) {
      const life = this.life[i];
      if (!(life > 0)) continue;
      const a = this.age[i] + dt;
      this.age[i] = a;
      if (a >= life) this.life[i] = 0;
      else if (!this.ashed[i] && a > life * 0.62) {
        // Crumbling: a puff of ash drifting up as the body turns to cinders.
        this.ashed[i] = 1;
        const b = pen.burst(this.x[i], this.y[i] - 3, 4, C.ash, C.smokeEnd);
        b.sprite = 'fx/ash';
        pen.speed(3, 12);
        pen.life(0.8, 1.6);
        pen.size(1, 1.4);
        b.gravity = -14;
        b.additive = false;
        b.emissive = 0;
        b.angle = -Math.PI / 2;
        b.spread = 1.6;
        b.layer = 'world';
        pen.emit();
      }
    }
  }

  draw(pen: Pen, f: FrameCtx): void {
    const r = pen.r;
    const v = f.view;
    const tint = this.tint;
    for (let i = 0; i < CORPSE_CAP; i++) {
      const life = this.life[i];
      if (!(life > 0)) continue;
      const x = this.x[i];
      const y = this.y[i];
      if (x < v.x0 - 40 || x > v.x1 + 40 || y < v.y0 - 20 || y > v.y1 + 60) continue;
      const k = this.kind[i];
      const a = this.age[i];
      const t = a / life;
      const frame = Math.min(this.frameCount[k] - 1, Math.floor(a * (this.fps[k] || 8)));
      // Fresh → charred → ash grey, then fade.
      const ash = clamp01((t - 0.35) / 0.35);
      const dt = this.dtype[i];
      let cr = 1;
      let cg = 1;
      let cb = 1;
      if (dt === 1) { cr = 0.62; cg = 0.5; cb = 0.46; } // fire: charred
      else if (dt === 2) { cr = 0.7; cg = 0.86; cb = 1; } // cold: frosted
      else if (dt === 4) { cr = 0.78; cg = 0.6; cb = 0.9; } // void
      tint[0] = cr + (0.42 - cr) * ash;
      tint[1] = cg + (0.4 - cg) * ash;
      tint[2] = cb + (0.41 - cb) * ash;
      const o = pen.sprite('decal');
      o.tint = tint;
      o.flipX = this.flip[i] === 1;
      o.alpha = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
      // Burning corpses smoulder for a moment.
      if (dt === 1 && a < 1.6) o.emissive = 0.35 * (1 - a / 1.6);
      r.sprite(CORPSE_IDS[k], frame, x, y, o);
    }
  }

  clear(): void {
    this.life.fill(0);
  }
}

// ------------------------------------------------------------------------------------------------------------
// Floating world texts ("LEVEL UP", "Evade")
// ------------------------------------------------------------------------------------------------------------

const TEXT_CAP = 16;

class WorldTexts {
  private readonly str: string[] = new Array<string>(TEXT_CAP).fill('');
  private readonly x = new Float32Array(TEXT_CAP);
  private readonly y = new Float32Array(TEXT_CAP);
  private readonly age = new Float32Array(TEXT_CAP);
  private readonly life = new Float32Array(TEXT_CAP);
  private readonly scale = new Uint8Array(TEXT_CAP);
  private readonly rise = new Float32Array(TEXT_CAP);
  private readonly col = new Float32Array(TEXT_CAP * 3);
  private readonly boxed = new Uint8Array(TEXT_CAP);
  private next = 0;
  private readonly c: [number, number, number] = [1, 1, 1];
  private readonly edge: [number, number, number] = [1, 1, 1];

  spawn(text: string, x: number, y: number, color: RGB, life: number, scale = 1, rise = 10, boxed = false): void {
    const i = this.next;
    this.next = (this.next + 1) % TEXT_CAP;
    this.str[i] = text;
    this.x[i] = x;
    this.y[i] = y;
    this.age[i] = 0;
    this.life[i] = life;
    this.scale[i] = scale;
    this.rise[i] = rise;
    this.col[i * 3] = color[0];
    this.col[i * 3 + 1] = color[1];
    this.col[i * 3 + 2] = color[2];
    this.boxed[i] = boxed ? 1 : 0;
  }

  update(dt: number): void {
    for (let i = 0; i < TEXT_CAP; i++) if (this.life[i] > 0) this.age[i] += dt;
  }

  draw(pen: Pen): void {
    const r = pen.r;
    const c = this.c;
    for (let i = 0; i < TEXT_CAP; i++) {
      const life = this.life[i];
      if (!(life > 0)) continue;
      const t = this.age[i] / life;
      if (t >= 1) {
        this.life[i] = 0;
        continue;
      }
      c[0] = this.col[i * 3];
      c[1] = this.col[i * 3 + 1];
      c[2] = this.col[i * 3 + 2];
      const alpha = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
      const o = pen.text(c, alpha, this.scale[i]);
      if (this.boxed[i]) {
        this.edge[0] = c[0] * 0.55;
        this.edge[1] = c[1] * 0.55;
        this.edge[2] = c[2] * 0.55;
        pen.plate(o, C.plate, 0.8, this.edge, 3);
      }
      r.text(this.str[i], this.x[i], this.y[i] - easeOutCubic(clamp01(t * 1.6)) * this.rise[i], o);
    }
  }

  clear(): void {
    this.life.fill(0);
  }
}

// ------------------------------------------------------------------------------------------------------------

/** All pools together (the presenter owns one). */
export class Effects {
  readonly numbers: DamageNumbers;
  readonly rings = new Rings();
  readonly chains = new Chains();
  readonly pulses = new Pulses();
  readonly sprites = new SpriteFx();
  readonly decals = new Decals();
  readonly corpses = new Corpses();
  readonly texts = new WorldTexts();

  constructor(measure: MeasureText) {
    this.numbers = new DamageNumbers(measure);
  }

  update(dt: number, pen: Pen): void {
    this.numbers.update(dt);
    this.rings.update(dt);
    this.chains.update(dt);
    this.pulses.update(dt);
    this.sprites.update(dt);
    this.decals.update(dt);
    this.corpses.update(dt, pen);
    this.texts.update(dt);
  }

  clear(): void {
    this.numbers.clear();
    this.rings.clear();
    this.chains.clear();
    this.pulses.clear();
    this.sprites.clear();
    this.decals.clear();
    this.corpses.clear();
    this.texts.clear();
  }
}

/** Radial spark burst helper: `count` sparks from (x, y) in all directions. */
export function sparks(pen: Pen, x: number, y: number, count: number, c0: RGB, c1: RGB, speedLo: number, speedHi: number, life = 0.35): void {
  const b = pen.burst(x, y, count, c0, c1);
  pen.speed(speedLo, speedHi);
  pen.life(life * 0.45, life);
  pen.size(0.7, 1.2);
  b.drag = 0.9;
  b.spread = TAU;
  pen.emit();
}
