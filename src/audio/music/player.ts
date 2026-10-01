// Music player: a lookahead scheduler (Chris Wilson's "tale of two clocks" pattern). A coarse JS
// timer wakes every ~50 ms and schedules every grid step that falls inside the next few hundred
// milliseconds on the sample-accurate audio clock. Tracks crossfade with an equal-power law, and
// each track can ride its level with the (smoothed) intensity. The 'map' and 'boss' tracks take a
// theme colour (colours.ts); changing the theme under a playing themed track crossfades it into a
// freshly coloured instance of the same track.
import type { MusicId } from '../../contracts/audio';
import type { Theme } from '../../contracts/content';
import type { AudioGraph } from '../graph';
import { dbToGain } from '../graph';
import type { Rand } from '../rand';
import { colourKey } from './colours';
import type { TrackIO } from './instruments';
import { stepDuration, TRACKS, type TrackDef, type TrackState } from './tracks';

const TICK_MS = 50;
/** How far ahead steps are scheduled (s). Larger while the tab is hidden (timers throttle to 1 Hz). */
const LOOKAHEAD = 0.3;
const LOOKAHEAD_HIDDEN = 1.6;
/** Intensity smoothing time constant (s): drums fade in/out over a couple of bars, not instantly. */
const INTENSITY_TAU = 1.2;
/** Keep a faded track connected this long so ringing tails end naturally before disconnecting. */
const TAIL = 6;
/** Crossfades are drawn as this many linear segments of the sin/cos curve. */
const FADE_SEGMENTS = 12;
/** Level changes smaller than this (dB) are not re-scheduled. */
const LEVEL_EPSILON_DB = 0.1;

/**
 * Equal-power fade on `p` from t0 over `dur`: sin law in (0 → peak), cos law out (from → 0).
 * Two such fades crossing keep constant power, so unrelated tracks do not dip mid-transition.
 * Linear segments (not setValueCurveAtTime) so it composes with cancel/hold without exceptions.
 */
export function equalPowerFade(p: AudioParam, t0: number, dur: number, from: number, to: number): void {
  const d = Math.max(0.01, dur);
  const fadeIn = to > from;
  p.setValueAtTime(from, t0);
  for (let i = 1; i <= FADE_SEGMENTS; i++) {
    const u = (i / FADE_SEGMENTS) * (Math.PI / 2);
    const v = i === FADE_SEGMENTS ? to : fadeIn ? from + (to - from) * Math.sin(u) : to + (from - to) * Math.cos(u);
    p.linearRampToValueAtTime(v, t0 + (d * i) / FADE_SEGMENTS);
  }
}

/** Value of an equal-power fade-in (0 → peak) at time t (piecewise-linear, as scheduled). */
function fadeInValue(t: number, t0: number, dur: number, peak: number): number {
  if (t <= t0) return 0;
  if (t >= t0 + dur) return peak;
  const x = ((t - t0) / dur) * FADE_SEGMENTS;
  const i = Math.floor(x);
  const a = Math.sin((i / FADE_SEGMENTS) * (Math.PI / 2));
  const b = Math.sin(((i + 1) / FADE_SEGMENTS) * (Math.PI / 2));
  return peak * (a + (b - a) * (x - i));
}

interface LiveTrack {
  readonly id: MusicId;
  /** Theme the instance was coloured with. */
  readonly theme: Theme | null;
  readonly def: TrackDef;
  readonly state: TrackState;
  /** Crossfade gains (dry, reverb send, echo send). */
  readonly fades: GainNode[];
  /** Intensity level gains, after the crossfade. */
  readonly levels: GainNode[];
  readonly stepDur: number;
  readonly fadeIn: { t0: number; dur: number; peak: number };
  levelDb: number;
  next: number;
  index: number;
  /** Audio time the fade-out completes (Infinity while playing). */
  endAt: number;
}

/** Offline analysis: render only a themed track's colour, or only the track under it (null = both). */
export type MusicSolo = 'colour' | 'track' | null;

export interface MusicPlayerOptions {
  /** Run the scheduler from a JS timer (live). Offline renders call tick() themselves. */
  autoTick: boolean;
}

export class MusicPlayer {
  private live: LiveTrack[] = [];
  private currentId: MusicId | null = null;
  private currentTheme: Theme | null = null;
  private target = 0;
  private smoothed = 0;
  private lastTick = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly graph: AudioGraph,
    private readonly rand: Rand,
    private readonly trims: Partial<Record<MusicId, number>>,
    private readonly options: MusicPlayerOptions = { autoTick: true },
  ) {}

  get current(): MusicId | null {
    return this.currentId;
  }

  get intensity(): number {
    return this.smoothed;
  }

  get theme(): Theme | null {
    return this.currentTheme;
  }

  /**
   * Colour the themed tracks for `theme` (null = uncoloured). Takes effect on the next track
   * start; a playing themed track whose colour changes crossfades into a recoloured instance.
   */
  setTheme(theme: Theme | null, fade = 2.5): void {
    if (theme === this.currentTheme) return;
    this.currentTheme = theme;
    const cur = this.live.find((l) => l.endAt === Infinity);
    if (!cur || !cur.def.themed || colourKey(cur.theme) === colourKey(theme)) return;
    const now = this.graph.ctx.currentTime;
    this.fadeOut(cur, now, fade);
    this.live.push(this.start(cur.id, now + 0.05, fade));
    this.tick();
  }

  /** Target intensity; the scheduler glides toward it (or jumps, when `immediate`). */
  setIntensity(v: number, immediate = false): void {
    this.target = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
    if (immediate) this.smoothed = this.target;
  }

  /** Crossfade to `id` (null = fade to silence). */
  setTrack(id: MusicId | null, fadeIn = 2.5, fadeOut = 2.5): void {
    if (id === this.currentId) return;
    const now = this.graph.ctx.currentTime;
    for (const l of this.live) if (l.endAt === Infinity) this.fadeOut(l, now, fadeOut);
    this.currentId = id;
    if (id) this.live.push(this.start(id, now + 0.05, fadeIn));
    this.lastTick = now;
    this.tick();
    if (this.options.autoTick && this.live.length && !this.timer && typeof setInterval === 'function') {
      this.timer = setInterval(() => this.tick(), TICK_MS);
    }
  }

  private start(id: MusicId, t0: number, fade: number, solo: MusicSolo = null): LiveTrack {
    const { ctx } = this.graph;
    const def = TRACKS[id];
    const peak = dbToGain(this.trims[id] ?? 0);
    const levelDb = def.levelDb?.(this.smoothed) ?? 0;
    const path = (dest: AudioNode): [GainNode, GainNode] => {
      const f = ctx.createGain();
      equalPowerFade(f.gain, t0, fade, 0, peak);
      const l = ctx.createGain();
      l.gain.value = dbToGain(levelDb);
      f.connect(l).connect(dest);
      return [f, l];
    };
    const [out, outL] = path(this.graph.music);
    const [wet, wetL] = path(this.graph.musicWet);
    const [echo, echoL] = path(this.graph.musicEcho);
    const theme = this.currentTheme;
    let io: TrackIO = { ctx, res: this.graph.res, out, wet, echo, rand: this.rand, theme };
    if (solo) {
      // The muted half still builds (and draws the same random numbers), into a silent sink.
      const mute = ctx.createGain();
      mute.gain.value = 0;
      mute.connect(this.graph.music);
      const silent: TrackIO = { ...io, out: mute, wet: mute, echo: mute };
      io = solo === 'colour' ? { ...silent, colourIo: io } : { ...io, colourIo: silent };
    }
    return {
      id, theme, def, state: def.create(io, t0), fades: [out, wet, echo], levels: [outL, wetL, echoL],
      stepDur: stepDuration(def), fadeIn: { t0, dur: Math.max(0.01, fade), peak }, levelDb, next: t0, index: 0, endAt: Infinity,
    };
  }

  private fadeOut(l: LiveTrack, now: number, fade: number): void {
    l.endAt = now + fade;
    const from = fadeInValue(now, l.fadeIn.t0, l.fadeIn.dur, l.fadeIn.peak);
    for (const g of l.fades) {
      g.gain.cancelScheduledValues(now);
      equalPowerFade(g.gain, now, fade, from, 0);
    }
    l.state.stop(l.endAt + 0.05);
  }

  private lookahead(): number {
    return typeof document !== 'undefined' && document.hidden ? LOOKAHEAD_HIDDEN : LOOKAHEAD;
  }

  /** Scheduler wake-up: advance intensity smoothing and schedule steps inside the horizon. */
  tick(): void {
    const now = this.graph.ctx.currentTime;
    const dt = Math.max(0, now - this.lastTick);
    this.lastTick = now;
    this.smoothed += (this.target - this.smoothed) * (1 - Math.exp(-dt / INTENSITY_TAU));
    const horizon = now + this.lookahead();
    for (const l of this.live) {
      if (l.next < now - 0.05) {
        // Fell behind (throttled tab, suspended context): realign to the grid, never burst.
        const skip = Math.ceil((now - l.next) / l.stepDur);
        l.next += skip * l.stepDur;
        l.index += skip;
      }
      while (l.next < horizon && l.next < l.endAt) {
        l.state.step(l.index, l.next, this.smoothed);
        l.index++;
        l.next += l.stepDur;
      }
      this.rideLevel(l, now);
    }
    this.live = this.live.filter((l) => {
      if (now < l.endAt + TAIL) return true;
      for (const g of [...l.fades, ...l.levels]) g.disconnect();
      return false;
    });
    if (!this.live.length) this.stopTimer();
  }

  /** Follow the track's intensity level curve (smoothed intensity → gentle gain glide). */
  private rideLevel(l: LiveTrack, now: number): void {
    const db = l.def.levelDb?.(this.smoothed) ?? 0;
    if (Math.abs(db - l.levelDb) < LEVEL_EPSILON_DB) return;
    l.levelDb = db;
    for (const g of l.levels) g.gain.setTargetAtTime(dbToGain(db), now, 0.1);
  }

  /**
   * Offline use (analysis): schedule a whole track up front into the graph's context.
   * Intensity is held at `intensity` for the entire render; `theme` colours a themed track, and
   * `solo` renders only its colour (or only the track under it).
   */
  prerender(id: MusicId, seconds: number, intensity: number, theme: Theme | null = null, solo: MusicSolo = null): void {
    this.smoothed = this.target = Math.min(1, Math.max(0, intensity));
    this.currentTheme = theme;
    const l = this.start(id, 0, 0.01, solo);
    for (let i = 0; l.next < seconds; i++) {
      l.state.step(i, l.next, this.smoothed);
      l.next += l.stepDur;
    }
    l.state.stop(seconds);
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.stopTimer();
    const now = this.graph.ctx.currentTime;
    for (const l of this.live) {
      l.state.stop(now);
      for (const g of [...l.fades, ...l.levels]) g.disconnect();
    }
    this.live = [];
    this.currentId = null;
  }
}
