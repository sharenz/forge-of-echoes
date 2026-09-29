// Voice builder: a tiny synthesis DSL that SFX recipes and music instruments are written in.
//
// Every layer is scheduled up front on the audio clock (no JS timers), starts from silence and
// ends in silence (click-free ramps), and registers its sources so the whole voice disconnects
// itself once the last source has ended.
import type { DspResources, NoiseColor, WaveName } from './dsp';
import { DRIVE_RANGE } from './dsp';
import type { Rand } from './rand';

// ---------------------------------------------------------------------------
// Parameter shapes
// ---------------------------------------------------------------------------

/**
 * A value over time: a constant, a [from, to, seconds, curve?] glide, or breakpoints
 * `{ pts: [[dt, value], …] }`. Curves default to exponential (musical for pitch and cutoff).
 */
export type Sweep =
  | number
  | readonly [number, number, number]
  | readonly [number, number, number, 'lin' | 'exp']
  | { readonly pts: readonly (readonly [number, number])[]; readonly curve?: 'lin' | 'exp' };

/**
 * Amplitude envelopes (all start and end at exactly 0):
 *  - percussive `{ a?, h?, d }`: attack → hold → exponential decay reaching −60 dB at `d`
 *  - swell `{ pad: true, a, h, r }`: attack → sustain for `h` → exponential release over `r`
 *  - breakpoints `{ pts: [[dt, level], …] }`: linear segments (level 0..1)
 */
export type Env =
  | { readonly a?: number; readonly h?: number; readonly d: number }
  | { readonly pad: true; readonly a: number; readonly h: number; readonly r: number }
  | { readonly pts: readonly (readonly [number, number])[] };

export interface FilterSpec {
  readonly type: BiquadFilterType;
  readonly f: Sweep;
  readonly q?: number;
  /** dB, for peaking / shelving types. */
  readonly gain?: number;
  /** Ignore the voice pitch multiplier. */
  readonly fixed?: boolean;
}

interface Routing {
  /** Seconds after the voice start. */
  readonly at?: number;
  readonly filter?: FilterSpec | readonly FilterSpec[];
  /** Soft saturation amount (1 = gentle, 3 = crunchy). */
  readonly drive?: number;
  /** Tremolo: gain oscillates between 1 − depth and 1. */
  readonly am?: { readonly rate: number; readonly depth: number; readonly type?: OscillatorType };
  readonly pan?: number;
  /** Extra reverb send (0..1) for this layer. */
  readonly wet?: number;
  /** Echo (delay) send (0..1) for this layer. */
  readonly echo?: number;
  /** Destination (defaults to the voice output). */
  readonly to?: AudioNode;
}

export interface ToneSpec extends Routing {
  readonly type?: OscillatorType;
  readonly wave?: WaveName;
  /** Frequency in Hz (scaled by the voice pitch unless `fixed`). */
  readonly f: Sweep;
  readonly fixed?: boolean;
  readonly detune?: number;
  readonly gain: number;
  readonly env: Env;
  /** Sine FM: modulator at f·ratio, peak deviation = index · modulator frequency. */
  readonly fm?: { readonly ratio: number; readonly index: Sweep; readonly type?: OscillatorType };
  /** Audio-rate noise into the frequency (Hz deviation) — rasp, electricity, growls. */
  readonly noiseFm?: number;
  readonly vib?: { readonly rate: number; readonly cents: number; readonly delay?: number };
}

export interface NoiseSpec extends Routing {
  readonly color?: NoiseColor;
  readonly gain: number;
  readonly env: Env;
  readonly rate?: number;
}

export interface Partial {
  /** Frequency ratio to the fundamental. */
  readonly r: number;
  /** Relative amplitude. */
  readonly g: number;
  /** Relative decay time. */
  readonly d: number;
}

export interface BellSpec extends Omit<Routing, 'filter' | 'drive' | 'am'> {
  readonly f: number;
  readonly partials: readonly Partial[];
  readonly gain: number;
  /** Decay (−60 dB) of the fundamental in seconds. */
  readonly decay: number;
  readonly fixed?: boolean;
  /** Attack time (default 1.5 ms). */
  readonly a?: number;
}

export interface VoiceIO {
  /** Dry output. */
  readonly out: AudioNode;
  /** Lazily created reverb send input. */
  wet(): AudioNode;
  /** Lazily created echo send input. */
  echo(): AudioNode;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function midi(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}

const MIN_EXP = 1e-4;

/**
 * Biquad Q from a linear Q. The Web Audio spec interprets Q in dB for lowpass/highpass
 * (resonance) but linearly for band/peak/notch types; recipes always speak linear Q
 * (0.707 = Butterworth, 4 = resonant).
 */
export function qValue(type: BiquadFilterType, q: number): number {
  return type === 'lowpass' || type === 'highpass' ? 20 * Math.log10(Math.max(q, 0.05)) : q;
}

function ramp(p: AudioParam, v: number, t: number, curve: 'lin' | 'exp' | undefined): void {
  if (curve === 'lin') p.linearRampToValueAtTime(v, t);
  else p.exponentialRampToValueAtTime(Math.max(MIN_EXP, v), t);
}

/** Schedule a sweep on a parameter, multiplied by `k`. */
export function applySweep(p: AudioParam, t: number, s: Sweep, k = 1, curve?: 'lin' | 'exp'): void {
  if (typeof s === 'number') {
    p.setValueAtTime(s * k, t);
    return;
  }
  if (Array.isArray(s)) {
    const [a, b, dur, c] = s as readonly [number, number, number, ('lin' | 'exp')?];
    const cv = c ?? curve;
    p.setValueAtTime(cv === 'lin' ? a * k : Math.max(MIN_EXP, a * k), t);
    ramp(p, b * k, t + Math.max(0.001, dur), cv);
    return;
  }
  const { pts } = s as { pts: readonly (readonly [number, number])[]; curve?: 'lin' | 'exp' };
  const cv = (s as { curve?: 'lin' | 'exp' }).curve ?? curve;
  const [t0, v0] = pts[0];
  p.setValueAtTime(cv === 'lin' ? v0 * k : Math.max(MIN_EXP, v0 * k), t + t0);
  let last = t0;
  for (let i = 1; i < pts.length; i++) {
    const dt = Math.max(last + 0.001, pts[i][0]);
    ramp(p, pts[i][1] * k, t + dt, cv);
    last = dt;
  }
}

/** First value of a sweep (used to size FM depth). */
export function sweepStart(s: Sweep): number {
  if (typeof s === 'number') return s;
  if (Array.isArray(s)) return (s as readonly number[])[0];
  return (s as { pts: readonly (readonly [number, number])[] }).pts[0][1];
}

function scaleSweep(s: Sweep, k: number): Sweep {
  if (typeof s === 'number') return s * k;
  if (Array.isArray(s)) {
    const [a, b, d, c] = s as readonly [number, number, number, ('lin' | 'exp')?];
    return c ? ([a * k, b * k, d, c] as const) : ([a * k, b * k, d] as const);
  }
  const o = s as { pts: readonly (readonly [number, number])[]; curve?: 'lin' | 'exp' };
  return { pts: o.pts.map(([dt, v]) => [dt, v * k] as const), curve: o.curve };
}

/** Total length of an envelope in seconds (including the final 10 ms settle). */
export function envLength(env: Env): number {
  if ('pts' in env) {
    const last = env.pts[env.pts.length - 1];
    return last[0] + (last[1] > 0 ? 0.012 : 0);
  }
  if ('pad' in env) return Math.max(0.002, env.a) + env.h + env.r + 0.01;
  return Math.max(0.0008, env.a ?? 0.002) + (env.h ?? 0) + env.d + 0.01;
}

/** Schedule an amplitude envelope that starts and ends at exactly zero. Returns its length. */
export function applyEnv(p: AudioParam, t: number, peak: number, env: Env): number {
  const pk = Math.max(peak, 1e-5);
  p.setValueAtTime(0, t);
  if ('pts' in env) {
    let lastT = 0;
    let lastV = 0;
    for (const [dt, lv] of env.pts) {
      if (dt <= lastT && lastT > 0) continue;
      if (dt <= 0) continue;
      p.linearRampToValueAtTime(lv * pk, t + dt);
      lastT = dt;
      lastV = lv;
    }
    if (lastV > 0) {
      p.linearRampToValueAtTime(0, t + lastT + 0.012);
      lastT += 0.012;
    }
    return lastT;
  }
  if ('pad' in env) {
    const a = Math.max(0.002, env.a);
    p.linearRampToValueAtTime(pk, t + a);
    p.setValueAtTime(pk, t + a + env.h);
    p.exponentialRampToValueAtTime(pk * 1e-3, t + a + env.h + env.r);
    p.linearRampToValueAtTime(0, t + a + env.h + env.r + 0.01);
    return a + env.h + env.r + 0.01;
  }
  const a = Math.max(0.0008, env.a ?? 0.002);
  const h = env.h ?? 0;
  p.linearRampToValueAtTime(pk, t + a);
  if (h > 0) p.setValueAtTime(pk, t + a + h);
  p.exponentialRampToValueAtTime(pk * 1e-3, t + a + h + env.d);
  p.linearRampToValueAtTime(0, t + a + h + env.d + 0.01);
  return a + h + env.d + 0.01;
}

// ---------------------------------------------------------------------------
// Partial sets for additive bells / metals (ratio, amplitude, relative decay)
// ---------------------------------------------------------------------------

export const PARTIALS = {
  /** Bright glockenspiel-like chime (near-harmonic). */
  chime: [
    { r: 1, g: 1, d: 1 }, { r: 2.0, g: 0.32, d: 0.5 }, { r: 3.01, g: 0.18, d: 0.33 },
    { r: 4.18, g: 0.1, d: 0.22 }, { r: 5.43, g: 0.05, d: 0.15 },
  ],
  /** Glass / ice: sparse inharmonic partials. */
  glass: [{ r: 1, g: 1, d: 1 }, { r: 2.32, g: 0.42, d: 0.55 }, { r: 4.25, g: 0.22, d: 0.32 }, { r: 6.63, g: 0.09, d: 0.2 }],
  /** Large church bell: hum, prime, minor-third tierce (dark), quint, nominal… */
  church: [
    { r: 0.5, g: 0.55, d: 1.25 }, { r: 1, g: 1, d: 1 }, { r: 1.19, g: 0.45, d: 0.7 }, { r: 1.5, g: 0.28, d: 0.55 },
    { r: 2.0, g: 0.5, d: 0.5 }, { r: 2.99, g: 0.2, d: 0.32 }, { r: 4.02, g: 0.12, d: 0.22 },
  ],
  /** Struck bar / anvil (free-bar modes). */
  anvil: [{ r: 1, g: 1, d: 1 }, { r: 2.76, g: 0.6, d: 0.6 }, { r: 5.4, g: 0.34, d: 0.38 }, { r: 8.93, g: 0.18, d: 0.24 }],
  /** Coin / small metal disc. */
  coin: [{ r: 1, g: 1, d: 1 }, { r: 1.59, g: 0.62, d: 0.72 }, { r: 2.14, g: 0.45, d: 0.52 }, { r: 2.65, g: 0.3, d: 0.4 }, { r: 3.9, g: 0.14, d: 0.28 }],
  /** Dull wood / leather tick. */
  dull: [{ r: 1, g: 1, d: 1 }, { r: 2.3, g: 0.28, d: 0.4 }],
  /** Silver chime: bright but softer than glass. */
  silver: [{ r: 1, g: 1, d: 1 }, { r: 2.0, g: 0.38, d: 0.6 }, { r: 2.99, g: 0.22, d: 0.42 }, { r: 5.1, g: 0.09, d: 0.22 }],
  /** Two-partial ping: cheap sparkle grains for shimmer tails. */
  ping: [{ r: 1, g: 1, d: 1 }, { r: 2.01, g: 0.22, d: 0.45 }],
  /** Gong / tam: dense low inharmonic cluster. */
  gong: [
    { r: 1, g: 1, d: 1 }, { r: 1.48, g: 0.6, d: 0.9 }, { r: 2.03, g: 0.5, d: 0.8 },
    { r: 2.61, g: 0.35, d: 0.62 }, { r: 3.31, g: 0.24, d: 0.5 }, { r: 4.1, g: 0.14, d: 0.38 },
  ],
} as const satisfies Record<string, readonly Partial[]>;

export type Vowel = 'a' | 'o' | 'u' | 'e';
const FORMANTS: Record<Vowel, readonly (readonly [number, number])[]> = {
  a: [[650, 1], [1080, 0.5], [2650, 0.22]],
  o: [[400, 1], [800, 0.42], [2600, 0.12]],
  u: [[350, 1], [600, 0.3], [2700, 0.08]],
  e: [[400, 1], [1700, 0.35], [2600, 0.2]],
};

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

export class VoiceBuilder {
  /** Latest stop time of any scheduled source (audio clock). */
  end: number;
  /** Nodes created by this voice (for cleanup / accounting). */
  readonly nodes: AudioNode[] = [];
  readonly sources: AudioScheduledSourceNode[] = [];
  private pendingEnds = 0;
  private onDone: (() => void) | null = null;
  private done = false;

  constructor(
    readonly ctx: BaseAudioContext,
    readonly res: DspResources,
    /** Voice start time on the audio clock. */
    readonly t: number,
    readonly io: VoiceIO,
    /** Pitch multiplier (caller pitch × random variation). */
    readonly p: number,
    readonly rand: Rand,
    /** How many times this sound fired in quick succession (for rising pickup scales). */
    readonly combo = 0,
  ) {
    this.end = t;
  }

  /** Uniform random in [a, b). */
  rr(a: number, b: number): number {
    return this.rand.range(a, b);
  }

  // --- low level -----------------------------------------------------------

  private track<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }

  private gainNode(v: number): GainNode {
    const g = this.track(this.ctx.createGain());
    g.gain.value = v;
    return g;
  }

  private startSource(s: AudioScheduledSourceNode, start: number, stop: number, offset?: number): void {
    if (offset !== undefined) (s as AudioBufferSourceNode).start(start, offset);
    else s.start(start);
    s.stop(stop);
    this.sources.push(s);
    this.pendingEnds++;
    s.onended = () => {
      this.pendingEnds--;
      if (this.pendingEnds <= 0) this.cleanup();
    };
    if (stop > this.end) this.end = stop;
  }

  private cleanup(): void {
    if (this.done) return;
    this.done = true;
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        /* already gone */
      }
    }
    this.onDone?.();
  }

  /** Register a callback for when every source has ended and the voice is disconnected. */
  finish(onDone?: () => void): void {
    this.onDone = onDone ?? null;
    if (this.sources.length === 0) this.cleanup();
  }

  /** Stop everything at `when` (used for voice stealing after the caller faded the output). */
  stopAll(when: number): void {
    for (const s of this.sources) {
      try {
        s.stop(when);
      } catch {
        /* not started / already stopped */
      }
    }
    if (when < this.end) this.end = when;
  }

  private filters(head: AudioNode, specs: FilterSpec | readonly FilterSpec[] | undefined, t: number, k: number): AudioNode {
    if (!specs) return head;
    const list = (Array.isArray(specs) ? specs : [specs]) as readonly FilterSpec[];
    for (const f of list) {
      const bq = this.track(this.ctx.createBiquadFilter());
      bq.type = f.type;
      applySweep(bq.frequency, t, f.f, f.fixed ? 1 : k);
      bq.Q.setValueAtTime(qValue(f.type, f.q ?? 0.707), t);
      if (f.gain !== undefined) bq.gain.setValueAtTime(f.gain, t);
      head.connect(bq);
      head = bq;
    }
    return head;
  }

  private lfo(rate: number, type: OscillatorType, t: number, end: number): OscillatorNode {
    const o = this.track(this.ctx.createOscillator());
    o.type = type;
    o.frequency.setValueAtTime(rate, t);
    this.startSource(o, t, end);
    return o;
  }

  /** Post-envelope routing shared by every layer: drive, tremolo, pan, sends, destination. */
  private route(head: AudioNode, o: Routing, gain: number, t: number, end: number): void {
    if (o.drive) {
      const sh = this.track(this.ctx.createWaveShaper());
      sh.curve = this.res.softClip;
      sh.oversample = '2x';
      const post = this.gainNode(gain / Math.tanh(o.drive));
      head.connect(sh).connect(post);
      head = post;
    }
    if (o.am) {
      const g = this.gainNode(1 - o.am.depth / 2);
      const depth = this.gainNode(o.am.depth / 2);
      this.lfo(o.am.rate, o.am.type ?? 'sine', t, end).connect(depth).connect(g.gain);
      head.connect(g);
      head = g;
    }
    if (o.pan) {
      const pn = this.track(this.ctx.createStereoPanner());
      pn.pan.value = Math.max(-1, Math.min(1, o.pan));
      head.connect(pn);
      head = pn;
    }
    head.connect(o.to ?? this.io.out);
    if (o.wet) head.connect(this.gainNode(o.wet)).connect(this.io.wet());
    if (o.echo) head.connect(this.gainNode(o.echo)).connect(this.io.echo());
  }

  /** Envelope gain: with drive the envelope feeds the shaper (pre-gain), otherwise it is the level. */
  private envelope(head: AudioNode, o: Routing & { gain: number; env: Env }, t: number): { node: GainNode; len: number } {
    const g = this.gainNode(0);
    const peak = o.drive ? o.drive / DRIVE_RANGE : o.gain;
    const len = applyEnv(g.gain, t, peak, o.env);
    head.connect(g);
    return { node: g, len };
  }

  // --- layers --------------------------------------------------------------

  /** Oscillator layer (optionally FM / noise-FM / vibrato), filtered and enveloped. */
  tone(o: ToneSpec): number {
    const t = this.t + (o.at ?? 0);
    const k = o.fixed ? 1 : this.p;
    const len = envLength(o.env);
    const end = t + len + 0.02;
    const osc = this.track(this.ctx.createOscillator());
    if (o.wave) osc.setPeriodicWave(this.res.wave(o.wave));
    else osc.type = o.type ?? 'sine';
    applySweep(osc.frequency, t, o.f, k);
    if (o.detune) osc.detune.setValueAtTime(o.detune, t);
    if (o.fm) {
      const mod = this.track(this.ctx.createOscillator());
      mod.type = o.fm.type ?? 'sine';
      applySweep(mod.frequency, t, scaleSweep(o.f, o.fm.ratio), k);
      const depth = this.gainNode(0);
      applySweep(depth.gain, t, o.fm.index, sweepStart(o.f) * o.fm.ratio * k, 'lin');
      mod.connect(depth).connect(osc.frequency);
      this.startSource(mod, t, end);
    }
    if (o.noiseFm) {
      const n = this.track(this.ctx.createBufferSource());
      n.buffer = this.res.noise.white;
      n.loop = true;
      const depth = this.gainNode(o.noiseFm * k / 0.25); // noise RMS is 0.25 → depth is RMS deviation
      n.connect(depth).connect(osc.frequency);
      this.startSource(n, t, end, this.rand.next() * 1.5);
    }
    if (o.vib) {
      const lfo = this.lfo(o.vib.rate, 'sine', t, end);
      const depth = this.gainNode(0);
      const d0 = t + (o.vib.delay ?? 0);
      depth.gain.setValueAtTime(0, t);
      if (d0 > t) depth.gain.setValueAtTime(0, d0);
      depth.gain.linearRampToValueAtTime(o.vib.cents, d0 + 0.25);
      lfo.connect(depth).connect(osc.detune);
    }
    const head = this.filters(osc, o.filter, t, k);
    const envd = this.envelope(head, o, t);
    this.route(envd.node, o, o.gain, t, end);
    this.startSource(osc, t, end);
    return end;
  }

  /** Looping noise-bed layer read from a random offset (free per-play timbre variation). */
  noise(o: NoiseSpec): number {
    const t = this.t + (o.at ?? 0);
    const buf = this.res.noise[o.color ?? 'white'];
    const len = envLength(o.env);
    const end = t + len + 0.02;
    const src = this.track(this.ctx.createBufferSource());
    src.buffer = buf;
    src.loop = true;
    if (o.rate) src.playbackRate.setValueAtTime(o.rate, t);
    const head = this.filters(src, o.filter, t, this.p);
    const envd = this.envelope(head, o, t);
    this.route(envd.node, o, o.gain, t, end);
    this.startSource(src, t, end, this.rand.next() * (buf.duration - 0.05));
    return end;
  }

  /** A summing bus with shared processing (filters sweep from the voice start + at). */
  bus(o: Routing & { gain?: number }): GainNode {
    const t = this.t + (o.at ?? 0);
    const input = this.gainNode(1);
    const head = this.filters(input, o.filter, t, this.p);
    // Buses have no envelope of their own, so tremolo is not supported here (layers own it).
    if (o.drive) {
      const pre = this.gainNode(o.drive / DRIVE_RANGE);
      head.connect(pre);
      this.route(pre, { ...o, am: undefined }, o.gain ?? 1, t, t);
    } else {
      const g = this.gainNode(o.gain ?? 1);
      head.connect(g);
      this.route(g, { ...o, drive: undefined, am: undefined }, 1, t, t);
    }
    return input;
  }

  /** Parallel formant filter bank ("choir" vowels) plus a little low body; returns its input. */
  formant(vowel: Vowel, o: Omit<Routing, 'filter' | 'drive' | 'am'> & { gain?: number; body?: number; q?: number } = {}): GainNode {
    const t = this.t + (o.at ?? 0);
    const input = this.gainNode(1);
    const sum = this.gainNode(o.gain ?? 1);
    for (const [f, g] of FORMANTS[vowel]) {
      const bq = this.track(this.ctx.createBiquadFilter());
      bq.type = 'bandpass';
      bq.frequency.setValueAtTime(f, t);
      bq.Q.setValueAtTime(o.q ?? f / 90, t);
      input.connect(bq).connect(this.gainNode(g * 2.6)).connect(sum);
    }
    const body = this.track(this.ctx.createBiquadFilter());
    body.type = 'lowpass';
    body.frequency.setValueAtTime(420, t);
    input.connect(body).connect(this.gainNode(o.body ?? 0.35)).connect(sum);
    this.route(sum, o, 1, t, t);
    return input;
  }

  // --- presets ---------------------------------------------------------------

  /** Pitch-dropping sine: kicks, impacts, sub booms. */
  thump(o: { at?: number; f: Sweep; gain: number; d: number; a?: number; drive?: number; wet?: number; to?: AudioNode }): number {
    return this.tone({ at: o.at, type: 'sine', f: o.f, gain: o.gain, env: { a: o.a ?? 0.0015, d: o.d }, drive: o.drive, wet: o.wet, to: o.to });
  }

  /** Very short noise transient that gives impacts their edge. */
  click(o: { at?: number; gain: number; f?: number; d?: number; to?: AudioNode }): number {
    return this.noise({
      at: o.at, color: 'white', gain: o.gain, env: { a: 0.0005, d: o.d ?? 0.014 },
      filter: { type: 'highpass', f: o.f ?? 2500 }, to: o.to,
    });
  }

  /** Drum: pitched skin (thump) + noise slap. */
  drum(o: { at?: number; f: Sweep; gain: number; d: number; slap?: number; slapF?: number; wet?: number; to?: AudioNode }): number {
    const end = this.thump({ at: o.at, f: o.f, gain: o.gain, d: o.d, wet: o.wet, to: o.to });
    if (o.slap) {
      this.noise({
        at: o.at, color: 'pink', gain: o.slap, env: { a: 0.001, d: 0.07 },
        filter: { type: 'bandpass', f: o.slapF ?? 900, q: 0.9 }, wet: o.wet, to: o.to,
      });
    }
    return end;
  }

  /** Additive bell / metal: sine partials with individual exponential decays. */
  bell(o: BellSpec): number {
    const t = this.t + (o.at ?? 0);
    const k = o.fixed ? 1 : this.p;
    const nyquistGuard = this.ctx.sampleRate * 0.42;
    const sum = this.gainNode(o.gain);
    let end = t;
    for (const pt of o.partials) {
      const f = o.f * pt.r * k;
      if (f > Math.min(16000, nyquistGuard)) continue;
      const osc = this.track(this.ctx.createOscillator());
      osc.frequency.setValueAtTime(f, t);
      osc.detune.setValueAtTime(this.rr(-3, 3), t);
      const g = this.gainNode(0);
      const len = applyEnv(g.gain, t, pt.g, { a: o.a ?? 0.0015, d: o.decay * pt.d });
      osc.connect(g).connect(sum);
      const e = t + len + 0.02;
      this.startSource(osc, t, e);
      end = Math.max(end, e);
    }
    this.route(sum, o, o.gain, t, end);
    return end;
  }

  /** Scattered high pings over a time span: sparkle / shimmer tails. */
  shimmer(o: { at?: number; dur: number; count: number; notes: readonly number[]; gain: number; wet?: number; echo?: number; decay?: number }): number {
    let end = this.t;
    for (let i = 0; i < o.count; i++) {
      const at = (o.at ?? 0) + (i / o.count) * o.dur + this.rr(0, o.dur / o.count);
      const fade = 1 - (0.6 * i) / o.count; // tail thins out
      end = Math.max(end, this.bell({
        at, f: midi(this.rand.pick(o.notes)), partials: PARTIALS.ping, gain: o.gain * fade * this.rr(0.6, 1),
        decay: (o.decay ?? 0.45) * this.rr(0.7, 1.3), pan: this.rr(-0.75, 0.75), wet: o.wet ?? 0.5, echo: o.echo, fixed: true,
      }));
    }
    return end;
  }

  /** Fire crackle texture for `dur` seconds. */
  crackle(o: { at?: number; dur: number; gain: number; hp?: number; lp?: number; wet?: number; to?: AudioNode }): number {
    const filter: FilterSpec[] = [{ type: 'highpass', f: o.hp ?? 1500, fixed: true }];
    if (o.lp) filter.push({ type: 'lowpass', f: o.lp, fixed: true });
    return this.noise({
      at: o.at, color: 'crackle', gain: o.gain, filter, wet: o.wet, to: o.to,
      env: { pad: true, a: 0.006, h: o.dur * 0.45, r: o.dur * 0.55 },
    });
  }
}
