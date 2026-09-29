// Player debuffs (GAME_SPEC §13) on every sorceress in the instance: the art's overlay sprites
// ('fx/debuff/<id>', feet-anchored like her, frames from debuffOverlayFrame: bleeding / withered by stack count,
// rooted by what holds her), the multiply tint on her own body while chilled or frozen (DEBUFF_PLAYER_TINT), small
// lights for the burning and shocked ones, and ambient particles. The one-shot moments live here too: the "apply pop"
// when a debuff lands (a coloured burst, and for the local player a word for the hard ones: "Frozen", "Rooted"), the
// cleanse flash when a flask or Rift Step lifts them, and the ice shattering off her when a freeze ends.
//
// Readability: overlays draw one sortY step in front of her (in a fixed order: what holds her feet first, the ice
// block last, since it encases everything); each fades in over DEBUFF_FADE_IN and out over the last DEBUFF_FADE_OUT
// seconds of its timer so nothing pops. Allies wear the same visuals (the HUD icons are the local player's only).
// Her silhouette survives any combination: all her debuff lights share one budget (DEBUFF_LIGHT_BUDGET — they scale
// down together; the withered glow stays dark under a burn), and with two or more glowing overlays on her (burning,
// withered, shocked, frozen) each is drawn at STACKED_GLOW_ALPHA (withered under a burn fainter still, its smoke a
// dark miasma instead of a glow).
// Pops follow what changed, not the event stream: the sim repeats 'debuff' once a second while an unchanged debuff
// keeps being refreshed (a blizzard, a fire pool), so shouldPop() lets a full pop through only when the debuff is new
// on her or its stacks rose (a refresh gets a faint shimmer); stacks that ran down (bleed timers) re-arm the pop.
// Damage over time: the sim reports burning / bleeding as ordinary 'hit' events on the player every 0.5 s (the event
// has no DoT flag yet); isDotTick() tells them apart so they read as ticks, not as blows.
import { PLAYER_DEBUFFS, type PlayerDebuff } from '../contracts/bestiary';
import type { DamageType } from '../contracts/content';
import type { RGB } from '../contracts/render';
import type { PlayerDebuffView, PlayerView, RootSource, SimEvent, WorldView } from '../contracts/sim';
import { DEBUFF_PLAYER_TINT, debuffOverlayFrame } from '../art';
import { C } from './colors';
import { playerById, type FrameCtx } from './context';
import type { Effects } from './fx';
import { clamp01, hash1, TAU } from './math';
import type { Pen } from './pen';

/** Seconds a fresh overlay takes to fade in, and the last seconds of its timer over which it fades out. */
export const DEBUFF_FADE_IN = 0.12;
export const DEBUFF_FADE_OUT = 0.25;

/** Back-to-front drawing order of the overlays: what holds her feet first, the ice block (it encases her) last. */
export const DEBUFF_DRAW_ORDER: readonly PlayerDebuff[] = ['rooted', 'bleeding', 'withered', 'burning', 'chilled', 'shocked', 'frozen'];

/** Signature colour of each debuff (pops, cleanse flashes, lights). Rooted takes its source's colour. */
export const DEBUFF_COLOR: Record<PlayerDebuff, RGB> = {
  chilled: [0.55, 0.82, 1],
  frozen: [0.85, 0.96, 1],
  rooted: [0.8, 0.74, 0.62],
  burning: [1, 0.55, 0.18],
  bleeding: [0.95, 0.16, 0.14],
  shocked: [0.78, 0.7, 1],
  withered: [0.75, 0.45, 1],
};

export const ROOT_COLOR: Record<RootSource, RGB> = {
  bone: [0.86, 0.8, 0.66],
  web: [0.8, 0.93, 1],
  chain: [0.7, 0.68, 0.7],
  tar: [0.85, 0.55, 0.2],
};

/** Floating word for the local player when a hard debuff lands (why she can't move). */
export const DEBUFF_WORD: Partial<Record<PlayerDebuff, string>> = { frozen: 'Frozen', rooted: 'Rooted' };

const OVERLAY_IDS: Record<PlayerDebuff, string> = Object.fromEntries(PLAYER_DEBUFFS.map((d) => [d, `fx/debuff/${d}`])) as Record<PlayerDebuff, string>;
const BIT: Record<PlayerDebuff, number> = Object.fromEntries(PLAYER_DEBUFFS.map((d, i) => [d, 1 << i])) as Record<PlayerDebuff, number>;
const BURN_LIGHT: RGB = [1, 0.5, 0.16];
const SHOCK_LIGHT: RGB = [0.72, 0.62, 1];
const FROZEN_LIGHT: RGB = [0.62, 0.84, 1];
const WITHER_LIGHT: RGB = [0.6, 0.3, 0.9];
const BLOOD_END: RGB = [0.35, 0.03, 0.04];
const TAR_END: RGB = [0.06, 0.04, 0.03];

/** All of one player's debuff lights together never exceed this intensity (they scale down as one). */
export const DEBUFF_LIGHT_BUDGET = 0.4;
/** With two or more glowing overlays on a player, each is drawn at this share of its opacity. */
export const STACKED_GLOW_ALPHA = 0.75;
/** Overlays with emissive art (they bloom): burning, withered, shocked and the ice block. */
const GLOWING = BIT.burning | BIT.withered | BIT.shocked | BIT.frozen;
/** A popped debuff the view never showed active is forgotten after this long (it ran out in between). */
const POP_GRACE = 0.6;
/** A player 'hit' taking less than this share of max life while its damage-over-time debuff is on is a tick. */
export const DOT_TICK_MAX_FRACTION = 0.04;

/** Base intensity of a debuff's light on a player carrying `mask` (before fading and the budget); 0 = no light. */
export function debuffLightWant(id: PlayerDebuff, stacks: number, mask: number): number {
  switch (id) {
    case 'burning':
      return 0.38;
    case 'shocked':
      return 0.34;
    case 'frozen':
      return 0.3;
    case 'withered':
      // Violet under orange fire only washes her out: the burn's light speaks for both.
      return mask & BIT.burning ? 0 : 0.12 * Math.max(1, Math.min(3, stacks));
    default:
      return 0;
  }
}

/** Scale for every debuff light of a player whose lights want `total` intensity in all (DEBUFF_LIGHT_BUDGET). */
export function debuffLightScale(total: number): number {
  return total > DEBUFF_LIGHT_BUDGET ? DEBUFF_LIGHT_BUDGET / total : 1;
}

/** Opacity factor of a glowing overlay on a player carrying `mask`: STACKED_GLOW_ALPHA with two or more of them. */
export function glowStackFactor(mask: number): number {
  const g = mask & GLOWING;
  return g & (g - 1) ? STACKED_GLOW_ALPHA : 1;
}

/** The withered curse under a burn: violet bloom over orange fire sums to white, so the burn leads and it recedes. */
export const WITHER_UNDER_BURN = 0.7;

/** Opacity factor of debuff `id`'s overlay on a player carrying `mask` (1 for overlays that do not glow). */
export function overlayGlowFactor(id: PlayerDebuff, mask: number): number {
  if (!(GLOWING & BIT[id])) return 1;
  const k = glowStackFactor(mask);
  return id === 'withered' && mask & BIT.burning ? k * WITHER_UNDER_BURN : k;
}

/** The debuff whose damage over time arrives as a player 'hit' of this type (burning: fire, bleeding: physical). */
export function dotDebuffOf(t: DamageType): PlayerDebuff | null {
  return t === 'fire' ? 'burning' : t === 'physical' ? 'bleeding' : null;
}

/**
 * Is a 'hit' on a player one of her burn / bleed ticks? The event has no DoT flag (contract gap): a non-crit hit of
 * fire / physical damage while she carries burning / bleeding (in the view, or in `lastMask` — the tick that ends a
 * debuff arrives as it leaves the view), smaller than DOT_TICK_MAX_FRACTION of her max life.
 */
export function isDotTick(
  e: Pick<Extract<SimEvent, { t: 'hit' }>, 'target' | 'crit' | 'damageType' | 'amount'>, debuffs: readonly PlayerDebuffView[],
  lastMask: number, maxLife: number,
): boolean {
  if (e.target !== 'player' || e.crit || !(maxLife > 0)) return false;
  const d = dotDebuffOf(e.damageType);
  if (!d || !(findDebuff(debuffs, d) !== null || (lastMask & BIT[d]) !== 0)) return false;
  return e.amount < DOT_TICK_MAX_FRACTION * maxLife;
}

/** Bit mask of the active debuffs in a PlayerView.debuffs list. */
export function debuffMask(list: readonly PlayerDebuffView[]): number {
  let m = 0;
  for (let i = 0; i < list.length; i++) m |= BIT[list[i].id] ?? 0;
  return m;
}

/** The entry for `id` in a debuff list, or null. */
export function findDebuff(list: readonly PlayerDebuffView[], id: PlayerDebuff): PlayerDebuffView | null {
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

/**
 * Multiply tint for the sorceress herself (frozen beats chilled), written into `out`; null when neither is on her.
 * `k` (0..1) blends from white towards the full tint (fading in / out).
 */
export function debuffTint(list: readonly PlayerDebuffView[], out: [number, number, number], k = 1): [number, number, number] | null {
  let t: readonly [number, number, number] | undefined;
  if (findDebuff(list, 'frozen')) t = DEBUFF_PLAYER_TINT.frozen;
  else if (findDebuff(list, 'chilled')) t = DEBUFF_PLAYER_TINT.chilled;
  if (!t) return null;
  const w = clamp01(k);
  out[0] = 1 + (t[0] - 1) * w;
  out[1] = 1 + (t[1] - 1) * w;
  out[2] = 1 + (t[2] - 1) * w;
  return out;
}

/** Overlay opacity from how long it has been on (`age`, seconds) and what is left of its timer. */
export function overlayAlpha(age: number, remaining: number): number {
  return clamp01(age / DEBUFF_FADE_IN) * clamp01(remaining / DEBUFF_FADE_OUT);
}

/** Colour of a debuff as seen on a player (rooted: by what holds her). */
export function debuffColor(d: PlayerDebuff, source: RootSource | null = null): RGB {
  return d === 'rooted' ? ROOT_COLOR[source ?? 'bone'] : DEBUFF_COLOR[d];
}

interface DebuffState {
  mask: number;
  /** Presentation time each debuff (by PLAYER_DEBUFFS index) was first seen in this run of it. */
  since: Float64Array;
  /** Last rooted source (for the break burst). */
  source: RootSource;
  phase: number;
  /** Pop memory per debuff: stacks last popped (0 = none), when, and whether the view has shown it since. */
  popStacks: Uint8Array;
  popAt: Float64Array;
  popSeen: Uint8Array;
}

export class DebuffPainter {
  private readonly states = new Map<number, DebuffState>();
  private readonly tint: [number, number, number] = [1, 1, 1];
  /** Debuff mask of the player being drawn (read by the particle effects). */
  private drawMask = 0;

  constructor(private readonly fx: Effects) {}

  reset(): void {
    this.states.clear();
  }

  forget(id: number): void {
    this.states.delete(id);
  }

  private state(id: number): DebuffState {
    let s = this.states.get(id);
    if (!s) {
      const n = PLAYER_DEBUFFS.length;
      s = {
        mask: 0, since: new Float64Array(n), source: 'bone', phase: hash1(id * 7 + 3) * 10,
        popStacks: new Uint8Array(n), popAt: new Float64Array(n), popSeen: new Uint8Array(n),
      };
      this.states.set(id, s);
    }
    return s;
  }

  /**
   * A 'debuff' event for player `id` at presentation time `now`: should it pop in full? Only when the debuff is new
   * on her or its stacks rose (the sim repeats unchanged refreshes once a second). Records the pop.
   */
  shouldPop(id: number, debuff: PlayerDebuff, stacks: number, now: number): boolean {
    const s = this.state(id);
    const k = PLAYER_DEBUFFS.indexOf(debuff);
    if (k < 0) return false;
    const n = Math.max(1, Math.min(255, stacks | 0));
    const prev = s.popStacks[k];
    if (prev !== 0 && n <= prev) return false;
    s.popStacks[k] = n;
    s.popAt[k] = now;
    s.popSeen[k] = 0;
    return true;
  }

  /** Debuffs lifted off player `id` ('cleanse'): the next application pops again. */
  cleansed(id: number, debuffs: readonly PlayerDebuff[]): void {
    const s = this.states.get(id);
    if (!s) return;
    for (const d of debuffs) {
      const k = PLAYER_DEBUFFS.indexOf(d);
      if (k >= 0) s.popStacks[k] = 0;
    }
  }

  /** Is this 'hit' one of the burn / bleed ticks of its (player) target? See isDotTick. */
  isDotTick(e: Extract<SimEvent, { t: 'hit' }>, world: WorldView): boolean {
    if (e.target !== 'player' || e.crit) return false;
    const p = playerById(world, e.playerId);
    if (!p) return false;
    const s = this.states.get(p.id);
    return isDotTick(e, p.debuffs, s ? s.mask : 0, p.maxLife);
  }

  /** Keep the pop memory in step with what the view shows (a debuff that ended, stacks that ran down). */
  private syncPops(s: DebuffState, list: readonly PlayerDebuffView[], now: number): void {
    for (let k = 0; k < PLAYER_DEBUFFS.length; k++) {
      const popped = s.popStacks[k];
      if (popped === 0) continue;
      const d = findDebuff(list, PLAYER_DEBUFFS[k]);
      const stale = now - s.popAt[k] > POP_GRACE;
      if (d) {
        s.popSeen[k] = 1;
        // Stacks ran down (bleed timers are independent): the next rise pops again. (A view lagging the event stream
        // is given the grace first.)
        const n = Math.max(1, d.stacks | 0);
        if (n < popped && stale) s.popStacks[k] = n;
      } else if (s.popSeen[k] || stale) {
        s.popStacks[k] = 0;
        s.popSeen[k] = 0;
      }
    }
  }

  /**
   * Tint for her body this frame (chilled / frozen), or null. Also tracks which debuffs started or ended since the
   * last frame (ends: the ice shatters off her, a root lets go). Call once per player per frame, before drawing her.
   */
  update(pen: Pen, f: FrameCtx, p: PlayerView, x: number, y: number): [number, number, number] | null {
    const s = this.state(p.id);
    const list = p.dead ? EMPTY : p.debuffs;
    this.syncPops(s, list, f.time);
    const mask = debuffMask(list);
    const started = mask & ~s.mask;
    const ended = s.mask & ~mask;
    if (started) {
      for (let k = 0; k < PLAYER_DEBUFFS.length; k++) if (started & (1 << k)) s.since[k] = f.time;
    }
    if (ended && !p.dead) {
      if (ended & BIT.frozen) this.shatter(pen, x, y);
      if (ended & BIT.rooted) this.rootBreak(pen, x, y, s.source);
    }
    s.mask = mask;
    const rooted = findDebuff(list, 'rooted');
    if (rooted?.source) s.source = rooted.source;
    if (!(mask & (BIT.frozen | BIT.chilled))) return null;
    const id: PlayerDebuff = mask & BIT.frozen ? 'frozen' : 'chilled';
    const d = findDebuff(list, id)!;
    return debuffTint(list, this.tint, overlayAlpha(f.time - s.since[PLAYER_DEBUFFS.indexOf(id)], d.remaining));
  }

  /** The overlays, lights and ambient particles on player `p`, drawn at (x, y) with her facing. */
  draw(pen: Pen, f: FrameCtx, p: PlayerView, x: number, y: number, flip: boolean, local: boolean): void {
    if (p.dead || p.debuffs.length === 0) return;
    const r = pen.r;
    const s = this.state(p.id);
    const list = p.debuffs;
    const t = f.time + s.phase;
    const mask = debuffMask(list);
    // One light budget for all of her debuffs (they scale down together), glowing overlays dimmed when stacked.
    let want = 0;
    for (let k = 0; k < list.length; k++) {
      const d = list[k];
      const w = debuffLightWant(d.id, d.stacks, mask);
      if (w > 0) want += w * overlayAlpha(f.time - s.since[PLAYER_DEBUFFS.indexOf(d.id)], d.remaining);
    }
    const lightK = debuffLightScale(want) * (local ? 1 : 0.75);
    this.drawMask = mask;
    for (let k = 0; k < DEBUFF_DRAW_ORDER.length; k++) {
      const id = DEBUFF_DRAW_ORDER[k];
      const d = findDebuff(list, id);
      if (!d) continue;
      const idx = PLAYER_DEBUFFS.indexOf(id);
      const a = overlayAlpha(f.time - s.since[idx], d.remaining);
      if (a <= 0.01) continue;
      const o = pen.sprite('world');
      o.flipX = flip;
      o.sortY = y + 0.5 + k * 0.01;
      o.alpha = (id === 'frozen' ? a * 0.95 : a) * overlayGlowFactor(id, mask);
      FRAME_OPTS.stacks = d.stacks;
      FRAME_OPTS.source = d.source ?? undefined;
      r.sprite(OVERLAY_IDS[id], debuffOverlayFrame(id, t, FRAME_OPTS), x, y, o);
      this.extras(pen, f, id, d, x, y, debuffLightWant(id, d.stacks, mask) * a * lightK);
    }
  }

  /** Lights (`light`: this debuff's share of her budget) and particles of one active debuff. */
  private extras(pen: Pen, f: FrameCtx, id: PlayerDebuff, d: PlayerDebuffView, x: number, y: number, light: number): void {
    const fxDt = f.fxDt;
    switch (id) {
      case 'burning': {
        pen.light(x, y - 12, 38, BURN_LIGHT, light, 0.7);
        if (Math.random() < fxDt * 9) {
          const b = pen.burst(x + (Math.random() - 0.5) * 12, y - 4 - Math.random() * 20, 1, C.hot, C.ember);
          b.sprite = 'fx/ember';
          pen.speed(4, 12);
          pen.life(0.35, 0.7);
          pen.size(0.55, 0.9);
          b.angle = -Math.PI / 2;
          b.spread = 0.8;
          b.gravity = -46;
          pen.emit();
        }
        return;
      }
      case 'shocked': {
        // A nervous violet flicker: the light jumps, sparks crawl over her.
        const jolt = Math.random() < 0.3 ? 1 : 0.35;
        pen.light(x, y - 14, 34, SHOCK_LIGHT, light * jolt, 0.9);
        if (Math.random() < fxDt * 10) {
          const b = pen.burst(x + (Math.random() - 0.5) * 14, y - 6 - Math.random() * 18, 2, C.lightning, C.storm);
          pen.speed(20, 55);
          pen.life(0.06, 0.14);
          pen.size(0.35, 0.6);
          pen.emit();
        }
        return;
      }
      case 'frozen':
        pen.light(x, y - 12, 44, FROZEN_LIGHT, light, 0.05);
        if (Math.random() < fxDt * 5) {
          const b = pen.burst(x + (Math.random() - 0.5) * 18, y - Math.random() * 26, 1, C.white, C.ice);
          b.sprite = 'fx/spark';
          pen.speed(0, 3);
          pen.life(0.25, 0.45);
          pen.size(0.4, 0.7);
          pen.emit();
        }
        return;
      case 'chilled':
        if (Math.random() < fxDt * 4) {
          const b = pen.burst(x + (Math.random() - 0.5) * 16, y - Math.random() * 22, 1, C.ice, C.frost);
          b.sprite = 'fx/frost';
          pen.speed(2, 6);
          pen.life(0.5, 0.9);
          pen.size(0.35, 0.6);
          b.gravity = 14;
          pen.emit();
        }
        return;
      case 'withered': {
        const stacks = Math.max(1, Math.min(3, d.stacks));
        if (light > 0) pen.light(x, y - 10, 30, WITHER_LIGHT, light, 0.3);
        if (Math.random() < fxDt * (2 + 2 * stacks)) {
          const b = pen.burst(x + (Math.random() - 0.5) * 16, y - 2 - Math.random() * 20, 1, C.voidHi, C.void);
          b.sprite = 'fx/smoke';
          pen.speed(2, 6);
          pen.life(0.6, 1);
          pen.size(0.25, 0.4);
          b.sizeEnd = 1.4;
          b.gravity = -16;
          // Alone it glows; with another glowing debuff on her it is a dark miasma (glow on glow bleaches her).
          const alone = (this.drawMask & GLOWING & ~BIT.withered) === 0;
          b.additive = alone;
          b.emissive = alone ? 0.5 : 0.3;
          pen.emit();
        }
        return;
      }
      case 'bleeding': {
        const stacks = Math.max(1, Math.min(3, d.stacks));
        // Drops that reach the floor leave small blood marks (moving doubles the bleed: the trail shows it).
        if (Math.random() < fxDt * (1.2 + stacks)) {
          const b = pen.burst(x + (Math.random() - 0.5) * 8, y - 8 - Math.random() * 6, 1, C.lifeLight, BLOOD_END);
          b.sprite = 'fx/spark';
          b.emissive = 0.2;
          b.additive = false;
          pen.speed(0, 6);
          pen.upward(4, 12);
          b.z = 6;
          b.gravity = 220;
          pen.life(0.4, 0.6);
          pen.size(0.45, 0.6);
          b.sizeEnd = 1;
          b.layer = 'world';
          pen.emit();
        }
        if (Math.random() < fxDt * 0.9 * stacks) this.fx.decals.spawn(x + (Math.random() - 0.5) * 10, y + 1, 0.35 + 0.1 * stacks, 6, 0, 'blood');
        return;
      }
      case 'rooted':
        return;
    }
  }

  /** A debuff landed on a player at (x, y): a pop in its colour (hard ones hit harder). */
  pop(pen: Pen, x: number, y: number, id: PlayerDebuff, stacks: number, source: RootSource | null, local: boolean): void {
    const fx = this.fx;
    const col = debuffColor(id, source);
    const k = local ? 1 : 0.7;
    switch (id) {
      case 'frozen': {
        // The ice snaps shut round her: a ring closing in and a few shards, never a white-out (she must stay
        // visible inside the block).
        fx.rings.spawn(x, y - 12, 20, 6, 0.28, C.ice, 1, 0.75 * k, 0.4 * k);
        const b = pen.burst(x, y - 12, 8, C.ice, C.frost);
        b.sprite = 'fx/frost';
        pen.speed(30, 70);
        pen.life(0.15, 0.3);
        pen.size(0.35, 0.55);
        b.drag = 0.9;
        b.emissive = 0.5;
        pen.emit();
        fx.pulses.spawn(x, y - 12, 70, 0.35, C.ice, 0.4 * k);
        return;
      }
      case 'rooted': {
        const end = source === 'tar' ? TAR_END : C.smokeEnd;
        const b = pen.burst(x, y - 1, 10, col, end);
        b.sprite = source === 'tar' ? 'fx/spark' : 'fx/smoke';
        pen.speed(12, 36);
        pen.life(0.3, 0.6);
        pen.size(source === 'tar' ? 0.6 : 0.35, source === 'tar' ? 0.9 : 0.6);
        b.drag = 0.85;
        b.additive = false;
        b.emissive = 0.1;
        b.layer = 'world';
        pen.emit();
        fx.rings.spawn(x, y, 3, 14, 0.3, col, 1, 0.7 * k);
        return;
      }
      case 'bleeding': {
        const b = pen.burst(x, y - 12, 4 + 3 * Math.min(3, stacks), C.lifeLight, BLOOD_END);
        pen.speed(20, 60);
        pen.life(0.2, 0.4);
        pen.size(0.5, 0.8);
        b.drag = 0.85;
        b.additive = false;
        b.emissive = 0.3;
        b.gravity = 160;
        pen.emit();
        return;
      }
      default: {
        const b = pen.burst(x, y - 12, 6, col, col);
        b.sprite = id === 'chilled' ? 'fx/frost' : id === 'burning' ? 'fx/ember' : 'fx/spark';
        pen.speed(20, 55);
        pen.life(0.18, 0.35);
        pen.size(id === 'chilled' ? 0.3 : 0.45, id === 'chilled' ? 0.5 : 0.7);
        b.drag = 0.88;
        b.emissive = 0.6;
        pen.emit();
        fx.rings.spawn(x, y - 10, 4, 16, 0.25, col, 1, 0.55 * k);
      }
    }
  }

  /** An unchanged debuff was refreshed on a player: a faint shimmer in its colour (no pop, no ring). */
  shimmer(pen: Pen, x: number, y: number, id: PlayerDebuff, source: RootSource | null): void {
    const col = debuffColor(id, source);
    const b = pen.burst(x, y - 14, 2, col, col);
    b.sprite = id === 'burning' ? 'fx/ember' : id === 'chilled' || id === 'frozen' ? 'fx/frost' : 'fx/spark';
    pen.speed(6, 16);
    pen.life(0.2, 0.35);
    pen.size(0.3, 0.45);
    b.drag = 0.9;
    b.emissive = 0.4;
    pen.emit();
  }

  /** Flask / Rift Step lifted debuffs off a player: a bright rinse in the colour of what was removed. */
  cleanse(pen: Pen, x: number, y: number, ids: readonly PlayerDebuff[], local: boolean): void {
    if (ids.length === 0) return;
    const fx = this.fx;
    const col = DEBUFF_COLOR[ids[0]] ?? C.white;
    const k = local ? 1 : 0.7;
    fx.rings.spawn(x, y - 12, 6, 26, 0.35, C.white, 1, 0.9 * k, 0.6 * k);
    fx.rings.spawn(x, y, 12, 3, 0.3, col, 1, 0.6 * k);
    const b = pen.burst(x, y - 8, 14, C.white, col);
    b.sprite = 'fx/spark';
    pen.speed(10, 30);
    pen.life(0.35, 0.7);
    pen.size(0.45, 0.7);
    b.angle = -Math.PI / 2;
    b.spread = 1.4;
    b.gravity = -50;
    pen.emit();
  }

  /** The ice block breaks off her when a freeze ends. */
  private shatter(pen: Pen, x: number, y: number): void {
    const b = pen.burst(x, y - 12, 16, C.ice, C.mana);
    b.sprite = 'fx/frost';
    pen.speed(30, 80);
    pen.upward(30, 80);
    b.z = 10;
    b.gravity = 260;
    pen.life(0.4, 0.7);
    pen.size(0.5, 0.9);
    b.emissive = 0.6;
    pen.emit();
    this.fx.rings.spawn(x, y - 10, 6, 22, 0.25, C.ice, 1, 0.7);
  }

  /** A root lets go: a little of what held her scatters. */
  private rootBreak(pen: Pen, x: number, y: number, source: RootSource): void {
    const col = ROOT_COLOR[source];
    const b = pen.burst(x, y - 2, 8, col, source === 'tar' ? TAR_END : C.smokeEnd);
    b.sprite = source === 'web' ? 'fx/frost' : 'fx/spark';
    pen.speed(15, 40);
    pen.life(0.25, 0.45);
    pen.size(0.4, 0.7);
    b.drag = 0.85;
    b.additive = source === 'web';
    b.emissive = source === 'web' ? 0.5 : 0.1;
    b.angle = -Math.PI / 2;
    b.spread = TAU / 2;
    pen.emit();
  }
}

const EMPTY: readonly PlayerDebuffView[] = [];
/** Reused frame-picker options (the draw loop allocates nothing). */
const FRAME_OPTS: { stacks?: number; source?: RootSource } = {};
