// Pure math behind the Life and Focus globes (the canvas painter in globe-render.ts only draws what this decides):
// a damped spring that sloshes the liquid when the value jumps, the lagging damage trail, the heal / refill flash,
// the low-life heartbeat, the wave profile of the surface and the debuff tint. Everything here is allocation-free
// on the per-frame path (mutable state objects, no closures) and deterministic, so tests/ui/globe-fx.test.ts can
// pin it down. No DOM.
import type { PlayerDebuff } from '../../contracts/bestiary';

export type GlobeKind = 'life' | 'focus';

/** A damped spring (position x, velocity v) around 0. Stiff and slightly underdamped: it overshoots, then settles. */
export interface Spring {
  x: number;
  v: number;
}

export const SLOSH_STIFFNESS = 85;
export const SLOSH_DAMPING = 4.2;
/** Largest impulse one value change may give the spring (a one-shot kill must not fling the liquid out of the glass). */
export const SLOSH_MAX_KICK = 16;
/** How long the pale damage chunk waits before it drains, and how fast it then goes (fraction of the globe per second). */
export const TRAIL_HOLD = 0.42;
export const TRAIL_DRAIN = 0.4;
/** Life below this fraction starts the heartbeat and desaturates the edge. */
export const LOW_LIFE = 0.3;
/** Focus at or below this counts as empty (flicker state). */
export const EMPTY_FOCUS = 0.012;

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Advance the spring by dt seconds (sub-stepped so a long frame cannot blow it up). */
export function stepSpring(s: Spring, dt: number, k = SLOSH_STIFFNESS, c = SLOSH_DAMPING): void {
  const step = Math.min(dt, 0.1);
  const n = Math.max(1, Math.ceil(step / 0.008));
  const h = step / n;
  for (let i = 0; i < n; i++) {
    s.v += (-k * s.x - c * s.v) * h;
    s.x += s.v * h;
  }
}

/** The spring impulse a change of `delta` (fraction of the globe, negative = loss) gives. Hits kick harder than heals. */
export function sloshKick(delta: number): number {
  const k = delta * (delta < 0 ? 70 : 45);
  return k > SLOSH_MAX_KICK ? SLOSH_MAX_KICK : k < -SLOSH_MAX_KICK ? -SLOSH_MAX_KICK : k;
}

/** Everything one globe animates, in one mutable record. */
export interface GlobeState {
  /** The fill drawn now (eases to the target so the 15 Hz HUD feed never steps). */
  shown: number;
  /** The fill the HUD last reported. */
  target: number;
  /** Where the pale damage chunk reaches up to (>= shown). */
  trail: number;
  trailHold: number;
  slosh: Spring;
  /** 0..1: heal / refill brightness; decays by itself. */
  flash: number;
  /** 0..1 position of the light band that rises through the liquid while flashing. */
  sweep: number;
  /** Seconds since the globe was created (drives wave phase; wrapped to stay precise). */
  time: number;
  /** Debuff tint colour (rgb 0..255) and how strongly it is mixed in, eased. */
  tintR: number;
  tintG: number;
  tintB: number;
  tintAmt: number;
}

export function createGlobeState(fill = 0): GlobeState {
  const f = clamp01(fill);
  return { shown: f, target: f, trail: f, trailHold: 0, slosh: { x: 0, v: 0 }, flash: 0, sweep: 1, time: 0, tintR: 0, tintG: 0, tintB: 0, tintAmt: 0 };
}

/** The HUD reported a new fill: kick the spring, start the trail on a loss, light the flash on a gain. */
export function applyTarget(s: GlobeState, next: number): void {
  const t = clamp01(next);
  const delta = t - s.target;
  s.target = t;
  if (Math.abs(delta) < 0.0015) return;
  s.slosh.v += sloshKick(delta);
  if (delta < 0) {
    // The chunk starts from the level that was drawn, so a hit during a hit extends the same chunk.
    if (s.trail < s.shown) s.trail = s.shown;
    s.trailHold = TRAIL_HOLD;
  } else {
    // Regeneration ticks give a faint shimmer; a flask or a heal lights the whole globe.
    const before = s.flash;
    s.flash = Math.min(1, s.flash + delta * 9);
    if (before < 0.05 && s.flash >= 0.05) s.sweep = 0;
  }
}

/** Advance one frame. */
export function stepGlobe(s: GlobeState, dt: number): void {
  const d = Math.min(dt, 0.1);
  s.time = (s.time + d) % 3600;
  // Ease the drawn fill: quick when falling (the hit must read), slightly softer when rising.
  const rate = s.target < s.shown ? 16 : 9;
  const k = 1 - Math.exp(-rate * d);
  s.shown += (s.target - s.shown) * k;
  if (Math.abs(s.target - s.shown) < 0.0004) s.shown = s.target;
  stepSpring(s.slosh, d);
  if (s.trailHold > 0) s.trailHold = Math.max(0, s.trailHold - d);
  else if (s.trail > s.shown) {
    // It drains faster the further it lags, so a big chunk does not hang around.
    s.trail = Math.max(s.shown, s.trail - d * (TRAIL_DRAIN + (s.trail - s.shown) * 1.6));
  }
  if (s.trail < s.shown) s.trail = s.shown;
  if (s.flash > 0) s.flash = Math.max(0, s.flash - d * 1.9);
  if (s.sweep < 1) s.sweep = Math.min(1, s.sweep + d * 1.5);
}

/** True while anything still moves for a reason other than ambient decoration (reduced motion keeps drawing only then). */
export function isSettling(s: GlobeState): boolean {
  return s.shown !== s.target || s.trail > s.shown + 0.0005 || s.flash > 0 || Math.abs(s.slosh.x) > 0.01 || Math.abs(s.slosh.v) > 0.05;
}

/**
 * Height of the liquid surface (in globe pixels, positive = lower) at column xn in -1..1:
 * a small ambient ripple, a bigger swell while the spring is excited, and a see-saw tilt that follows the spring's sign.
 * `calm` leaves a flat surface (reduced motion).
 */
export function waveOffset(xn: number, time: number, slosh: number, size: number, calm: boolean): number {
  if (calm) return 0;
  const unit = size / 36;
  const energy = Math.min(1.6, Math.abs(slosh));
  const ripple = (0.45 + energy * 1.7) * unit;
  const a = Math.sin(xn * 5.6 + time * 2.4) + 0.55 * Math.sin(xn * 11.3 - time * 3.1 + 1.3);
  return ripple * a * 0.7 + slosh * xn * 2.6 * unit;
}

/**
 * The low-life heartbeat: a "lub-dub" pulse in 0..1 for the given phase (0..1 of one beat).
 */
export function beatShape(phase: number): number {
  const a = (phase - 0.08) / 0.07;
  const b = (phase - 0.3) / 0.09;
  return Math.min(1, Math.exp(-a * a) + 0.65 * Math.exp(-b * b));
}

/** How dire the globe is, 0 (healthy) .. 1 (nearly empty): 0 above LOW_LIFE, smooth below. */
export function lowAmount(fill: number): number {
  const x = clamp01((LOW_LIFE - fill) / LOW_LIFE);
  return x * x * (3 - 2 * x);
}

/** Seconds per heartbeat: slow at the threshold, quicker the closer to death. */
export function beatPeriod(fill: number): number {
  return 1.55 - 0.7 * lowAmount(fill);
}

/** The heartbeat pulse (0..1) at `time`, scaled by how low the fill is; 0 when healthy. */
export function heartbeat(time: number, fill: number): number {
  const low = lowAmount(fill);
  if (low <= 0) return 0;
  const p = beatPeriod(fill);
  return beatShape((time % p) / p) * (0.35 + 0.65 * low);
}

/** Cheap deterministic hash noise in 0..1 (empty-focus flicker, particle seeds). */
export function hash01(n: number): number {
  let x = (n | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

/** Empty-Focus flicker: a stuttering 0..1 value, mostly dark with brief sputters (changes ~14 times a second). */
export function emptyFlicker(time: number): number {
  const slot = Math.floor(time * 14);
  const r = hash01(slot);
  const base = 0.18 + 0.12 * Math.sin(time * 3.1);
  return r > 0.72 ? 0.55 + 0.45 * hash01(slot + 77) : base * (r > 0.4 ? 1 : 0.45);
}

export interface Tint {
  r: number;
  g: number;
  b: number;
  amt: number;
}

const NO_TINT: Tint = { r: 0, g: 0, b: 0, amt: 0 };
const LIFE_TINTS: Partial<Record<PlayerDebuff, Tint>> = {
  burning: { r: 255, g: 150, b: 40, amt: 0.5 },
  bleeding: { r: 60, g: 0, b: 10, amt: 0.5 },
  frozen: { r: 170, g: 224, b: 255, amt: 0.55 },
  chilled: { r: 130, g: 200, b: 245, amt: 0.4 },
};
const FOCUS_TINTS: Partial<Record<PlayerDebuff, Tint>> = {
  withered: { r: 112, g: 126, b: 78, amt: 0.55 },
  shocked: { r: 235, g: 228, b: 255, amt: 0.4 },
  frozen: { r: 170, g: 224, b: 255, amt: 0.55 },
  chilled: { r: 130, g: 200, b: 245, amt: 0.38 },
};
const LIFE_PRIORITY: readonly PlayerDebuff[] = ['burning', 'bleeding', 'frozen', 'chilled'];
const FOCUS_PRIORITY: readonly PlayerDebuff[] = ['withered', 'frozen', 'shocked', 'chilled'];

/** The tint a globe takes from the debuffs the HUD already carries (first match in priority order; none = no tint). */
export function debuffTint(kind: GlobeKind, debuffs: readonly { id: PlayerDebuff }[] | undefined): Tint {
  if (!debuffs || debuffs.length === 0) return NO_TINT;
  const table = kind === 'life' ? LIFE_TINTS : FOCUS_TINTS;
  for (const id of kind === 'life' ? LIFE_PRIORITY : FOCUS_PRIORITY) {
    if (debuffs.some((d) => d.id === id)) return table[id] ?? NO_TINT;
  }
  return NO_TINT;
}

/** Ease the tint toward the wanted one (fades out through the old colour so it never pops). */
export function stepTint(s: GlobeState, want: Tint, dt: number): void {
  const k = 1 - Math.exp(-6 * Math.min(dt, 0.1));
  if (want.amt > 0) {
    if (s.tintAmt < 0.02) {
      s.tintR = want.r;
      s.tintG = want.g;
      s.tintB = want.b;
    } else {
      s.tintR += (want.r - s.tintR) * k;
      s.tintG += (want.g - s.tintG) * k;
      s.tintB += (want.b - s.tintB) * k;
    }
  }
  s.tintAmt += (want.amt - s.tintAmt) * k;
  if (s.tintAmt < 0.002) s.tintAmt = 0;
}
