// Music instruments. Notes are short-lived voices (VoiceBuilder) scheduled by the lookahead
// scheduler; drones and beds are long-lived nodes created once per track and reused for its
// whole life (cheap: no per-step allocation for sustained layers).
import type { Theme } from '../../contracts/content';
import type { DspResources, NoiseColor, WaveName } from '../dsp';
import type { Rand } from '../rand';
import { PARTIALS, qValue, VoiceBuilder, type Partial, type Vowel } from '../voice';

export interface TrackIO {
  readonly ctx: BaseAudioContext;
  readonly res: DspResources;
  /** Dry output (the track's crossfade gain). */
  readonly out: AudioNode;
  /** Reverb send (crossfaded with the track). */
  readonly wet: AudioNode;
  /** Echo send (crossfaded with the track). */
  readonly echo: AudioNode;
  readonly rand: Rand;
  /** Map theme colouring the 'map' / 'boss' tracks (absent = the Ashen Forge). Fixed for the track's life. */
  readonly theme?: Theme | null;
  /**
   * Where the theme colour's layers play (default: this IO). Offline analysis mutes the track or
   * its colour through it to measure one against the other; both share `rand`, so either render
   * is sample-identical to its part of the full mix.
   */
  readonly colourIo?: TrackIO;
}

/** Schedule one note-voice at time t. */
export function note(io: TrackIO, t: number, build: (v: VoiceBuilder) => void): void {
  const v = new VoiceBuilder(io.ctx, io.res, t, { out: io.out, wet: () => io.wet, echo: () => io.echo }, 1, io.rand, 0);
  build(v);
  v.finish();
}

// ---------------------------------------------------------------------------
// Sustained layers
// ---------------------------------------------------------------------------

export interface Sustained {
  /** Sidechain-style dip at t (depth 0..1), recovering over `recover` seconds. */
  pump(t: number, depth: number, recover: number): void;
  /** Stop at t. The track's crossfade gain is already silent by then, so no release is needed. */
  stop(t: number): void;
}

interface LayerCommon {
  gain: number;
  /** Fade-in seconds from track start. */
  attack: number;
  /** Slow tremolo. */
  trem?: { rate: number; depth: number };
  pan?: number;
  wet?: number;
}

function finishLayer(io: TrackIO, t0: number, head: AudioNode, o: LayerCommon, nodes: AudioNode[], sources: AudioScheduledSourceNode[]): Sustained {
  const { ctx } = io;
  const mk = <T extends AudioNode>(n: T): T => {
    nodes.push(n);
    return n;
  };
  if (o.trem) {
    const tg = mk(ctx.createGain());
    tg.gain.value = 1 - o.trem.depth / 2;
    const lfo = mk(ctx.createOscillator());
    lfo.frequency.value = o.trem.rate;
    const d = mk(ctx.createGain());
    d.gain.value = o.trem.depth / 2;
    lfo.connect(d).connect(tg.gain);
    sources.push(lfo);
    head.connect(tg);
    head = tg;
  }
  const pumpG = mk(ctx.createGain());
  const level = mk(ctx.createGain());
  level.gain.setValueAtTime(0, t0);
  level.gain.linearRampToValueAtTime(o.gain, t0 + Math.max(0.05, o.attack));
  head.connect(pumpG).connect(level);
  let out: AudioNode = level;
  if (o.pan) {
    const p = mk(ctx.createStereoPanner());
    p.pan.value = o.pan;
    level.connect(p);
    out = p;
  }
  out.connect(io.out);
  if (o.wet) {
    const send = mk(ctx.createGain());
    send.gain.value = o.wet;
    out.connect(send).connect(io.wet);
  }
  for (const s of sources) s.start(t0);
  let cleaned = false;
  sources[0].onended = () => {
    if (cleaned) return;
    cleaned = true;
    for (const n of nodes) {
      try {
        n.disconnect();
      } catch {
        /* gone */
      }
    }
  };
  return {
    pump(t, depth, recover) {
      const p = pumpG.gain;
      p.setValueAtTime(1, t);
      p.linearRampToValueAtTime(1 - depth, t + 0.015);
      p.linearRampToValueAtTime(1, t + recover);
    },
    stop(t) {
      for (const s of sources) {
        try {
          s.stop(t);
        } catch {
          /* already stopped */
        }
      }
    },
  };
}

export interface DroneSpec extends LayerCommon {
  f: number;
  type?: OscillatorType;
  wave?: WaveName;
  /** One oscillator per detune value (cents): chorus width. */
  detune?: number[];
  lp: number;
  q?: number;
  /** Slow filter sweep. */
  lpLfo?: { rate: number; depth: number };
}

/** Detuned oscillators through a slowly breathing lowpass. */
export function drone(io: TrackIO, t0: number, o: DroneSpec): Sustained {
  const { ctx } = io;
  const nodes: AudioNode[] = [];
  const sources: AudioScheduledSourceNode[] = [];
  const lp = ctx.createBiquadFilter();
  nodes.push(lp);
  lp.type = 'lowpass';
  lp.frequency.value = o.lp;
  lp.Q.value = qValue('lowpass', o.q ?? 0.707);
  for (const dt of o.detune ?? [0]) {
    const osc = ctx.createOscillator();
    nodes.push(osc);
    if (o.wave) osc.setPeriodicWave(io.res.wave(o.wave));
    else osc.type = o.type ?? 'sine';
    osc.frequency.value = o.f;
    osc.detune.value = dt;
    osc.connect(lp);
    sources.push(osc);
  }
  if (o.lpLfo) {
    const l = ctx.createOscillator();
    l.frequency.value = o.lpLfo.rate;
    const d = ctx.createGain();
    d.gain.value = o.lpLfo.depth;
    nodes.push(l, d);
    l.connect(d).connect(lp.frequency);
    sources.push(l);
  }
  return finishLayer(io, t0, lp, o, nodes, sources);
}

export interface BedSpec extends LayerCommon {
  color: NoiseColor;
  filters: { type: BiquadFilterType; f: number; q?: number }[];
  /** Slow sweep of the first filter's frequency. */
  lfo?: { rate: number; depth: number };
}

/** Looping noise bed (wind, fire, room tone). */
export function bed(io: TrackIO, t0: number, o: BedSpec): Sustained {
  const { ctx } = io;
  const nodes: AudioNode[] = [];
  const src = ctx.createBufferSource();
  src.buffer = io.res.noise[o.color];
  src.loop = true;
  nodes.push(src);
  const sources: AudioScheduledSourceNode[] = [src];
  let head: AudioNode = src;
  let first: BiquadFilterNode | null = null;
  for (const f of o.filters) {
    const bq = ctx.createBiquadFilter();
    bq.type = f.type;
    bq.frequency.value = f.f;
    bq.Q.value = qValue(f.type, f.q ?? 0.707);
    nodes.push(bq);
    head.connect(bq);
    head = bq;
    first ??= bq;
  }
  if (o.lfo && first) {
    const l = ctx.createOscillator();
    l.frequency.value = o.lfo.rate;
    const d = ctx.createGain();
    d.gain.value = o.lfo.depth;
    nodes.push(l, d);
    l.connect(d).connect(first.frequency);
    sources.push(l);
  }
  return finishLayer(io, t0, head, o, nodes, sources);
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

interface Place {
  pan?: number;
  wet?: number;
  echo?: number;
}

/** Harp-like pluck: triangle through a closing lowpass, an octave partial and a pick transient. */
export function pluck(io: TrackIO, t: number, f: number, g: number, o: Place & { decay?: number; bright?: number } = {}): void {
  const decay = o.decay ?? 2.2;
  const bright = o.bright ?? 1;
  note(io, t, (v) => {
    v.tone({
      type: 'triangle', f, fixed: true, gain: g, env: { a: 0.002, d: decay },
      filter: { type: 'lowpass', f: [Math.min(12000, f * 7 * bright), f * 1.6, 0.35], fixed: true }, pan: o.pan, wet: o.wet, echo: o.echo,
    });
    v.tone({ type: 'sine', f: f * 2, fixed: true, gain: g * 0.22, env: { a: 0.002, d: decay * 0.35 }, pan: o.pan, wet: o.wet });
    v.noise({ color: 'white', gain: g * 0.9, env: { a: 0.0005, d: 0.012 }, filter: { type: 'bandpass', f: Math.min(8000, f * 4), q: 2, fixed: true }, pan: o.pan });
  });
}

export function bell(io: TrackIO, t: number, f: number, g: number, decay: number, o: Place & { partials?: readonly Partial[] } = {}): void {
  note(io, t, (v) => {
    v.bell({ f, partials: o.partials ?? PARTIALS.church, gain: g, decay, fixed: true, pan: o.pan, wet: o.wet, echo: o.echo });
  });
}

/** Low taiko-style drum. */
export function kick(io: TrackIO, t: number, g: number, o: { f0?: number; f1?: number; d?: number } = {}): void {
  note(io, t, (v) => {
    v.thump({ f: [o.f0 ?? 118, o.f1 ?? 46, 0.12], gain: g, d: o.d ?? 0.4 });
    v.noise({ color: 'pink', gain: g * 1.3, env: { a: 0.001, d: 0.045 }, filter: { type: 'lowpass', f: 1300, fixed: true } });
  });
}

export function tom(io: TrackIO, t: number, f: number, g: number, o: Place = {}): void {
  note(io, t, (v) => {
    v.tone({ type: 'sine', f: [f * 1.45, f, 0.08], fixed: true, gain: g, env: { a: 0.0015, d: 0.4 }, pan: o.pan, wet: o.wet ?? 0.15 });
    v.noise({ color: 'pink', gain: g * 1.4, env: { a: 0.001, d: 0.06 }, filter: { type: 'bandpass', f: f * 5, q: 1, fixed: true }, pan: o.pan });
  });
}

/**
 * Frame drum / dark snare: a band of noise over a short pitched skin. `muted` is a ghost note:
 * a damped palm slap with no rattle, for the in-between 16ths.
 */
export function frame(io: TrackIO, t: number, g: number, o: Place & { muted?: boolean } = {}): void {
  note(io, t, (v) => {
    if (o.muted) {
      v.noise({ color: 'pink', gain: g * 3.4, env: { a: 0.0015, d: 0.055 }, filter: { type: 'bandpass', f: 820, q: 1.1, fixed: true }, pan: o.pan });
      v.tone({ type: 'triangle', f: [190, 160, 0.03], fixed: true, gain: g * 0.5, env: { a: 0.001, d: 0.05 }, pan: o.pan });
      return;
    }
    v.noise({ color: 'pink', gain: g * 3.2, env: { a: 0.001, d: 0.16 }, filter: { type: 'bandpass', f: 1150, q: 0.8, fixed: true }, pan: o.pan, wet: o.wet ?? 0.2 });
    v.tone({ type: 'triangle', f: [210, 165, 0.06], fixed: true, gain: g * 0.6, env: { a: 0.001, d: 0.12 }, pan: o.pan });
    v.noise({ color: 'white', gain: g * 0.9, env: { a: 0.0005, d: 0.05 }, filter: { type: 'highpass', f: 4500, fixed: true }, pan: o.pan });
  });
}

/**
 * Seed / bone shaker: band-passed noise with a soft, scooped attack (no hi-hat tick), so the
 * time-keeping reads as a ritual rattle rather than an electronic hat. `open` lets it rattle on;
 * `jingle` adds a faint inharmonic metal shimmer for accents.
 */
export function shaker(io: TrackIO, t: number, g: number, o: Place & { open?: boolean; jingle?: number } = {}): void {
  const pan = o.pan ?? 0.2;
  note(io, t, (v) => {
    const env = o.open ? { pts: [[0.012, 1], [0.06, 0.45], [0.24, 0]] as const } : { pts: [[0.007, 1], [0.05, 0]] as const };
    v.noise({
      color: 'white', gain: g * 2.4, env,
      filter: [{ type: 'bandpass', f: v.rr(3000, 3600), q: 1.3, fixed: true }, { type: 'highpass', f: 1600, fixed: true }], pan,
    });
    if (o.jingle) {
      for (const f of [5130, 6870, 8410]) {
        v.tone({ type: 'sine', f: f * v.rr(0.99, 1.01), fixed: true, gain: g * o.jingle * 0.12, env: { a: 0.002, d: o.open ? 0.22 : 0.08 }, pan, wet: o.wet });
      }
    }
  });
}

/** A forge hammer on an anvil: struck-bar modes with a hard strike. */
export function anvil(io: TrackIO, t: number, f: number, g: number, o: Place = {}): void {
  note(io, t, (v) => {
    v.bell({ f, partials: PARTIALS.anvil, gain: g, decay: 0.45, fixed: true, pan: o.pan, wet: o.wet ?? 0.3, echo: o.echo });
    v.noise({ color: 'white', gain: g * 2.2, env: { a: 0.0005, d: 0.018 }, filter: { type: 'bandpass', f: 3200, q: 0.9, fixed: true }, pan: o.pan });
  });
}

/** A reversed-noise swell that rises into the next downbeat (section transitions). */
export function riser(io: TrackIO, t: number, dur: number, g: number, o: Place = {}): void {
  note(io, t, (v) => {
    v.noise({
      color: 'pink', gain: g, env: { pts: [[dur * 0.55, 0.2], [dur * 0.92, 1], [dur, 0]] },
      filter: { type: 'bandpass', f: [300, 2400, dur], q: 1.6, fixed: true }, pan: o.pan, wet: o.wet ?? 0.4,
    });
  });
}

/** Deep phrase-marking boom with a rumble tail. */
export function boom(io: TrackIO, t: number, g: number): void {
  note(io, t, (v) => {
    v.thump({ f: [72, 30, 0.6], gain: g, d: 1.4, drive: 1.5, wet: 0.25 });
    v.noise({ color: 'brown', gain: g * 2, env: { a: 0.004, d: 1.3 }, filter: { type: 'lowpass', f: [600, 90, 1.0], fixed: true }, wet: 0.3 });
  });
}

/** Dark cymbal wash. */
export function crash(io: TrackIO, t: number, g: number): void {
  note(io, t, (v) => {
    v.noise({ color: 'white', gain: g * 2.5, env: { a: 0.002, d: 1.6 }, filter: [{ type: 'highpass', f: 3200, fixed: true }, { type: 'lowpass', f: 9000, fixed: true }], wet: 0.4 });
  });
}

/** Saw + sub bass with a filter pluck. */
export function bass(io: TrackIO, t: number, f: number, g: number, o: { dur: number; cutoff: number; drive?: number }): void {
  note(io, t, (v) => {
    v.tone({
      type: 'sawtooth', f, fixed: true, gain: g, drive: o.drive, env: { a: 0.004, h: o.dur * 0.4, d: o.dur },
      filter: { type: 'lowpass', f: [o.cutoff * 2.2, o.cutoff, o.dur * 0.6], q: 2, fixed: true },
    });
    v.tone({ type: 'sine', f, fixed: true, gain: g * 0.8, env: { a: 0.004, h: o.dur * 0.4, d: o.dur } });
  });
}

export interface SwellShape {
  a: number;
  h: number;
  r: number;
}

/** Soft sustained chord. */
export function pad(io: TrackIO, t: number, notes: readonly number[], g: number, o: SwellShape & Place & { lp: number; wave?: WaveName; type?: OscillatorType }): void {
  note(io, t, (v) => {
    for (const f of notes) {
      for (const dt of [-6, 6]) {
        v.tone({
          type: o.type, wave: o.wave ?? (o.type ? undefined : 'warm'), f, fixed: true, detune: dt + v.rr(-2, 2), gain: g,
          env: { pad: true, a: o.a, h: o.h, r: o.r }, filter: { type: 'lowpass', f: o.lp, fixed: true }, pan: o.pan, wet: o.wet,
        });
      }
    }
  });
}

/** Choir-ish pad: detuned saws into a vowel formant bank. */
export function choir(io: TrackIO, t: number, notes: readonly number[], g: number, o: SwellShape & Place & { vowel: Vowel }): void {
  note(io, t, (v) => {
    const bank = v.formant(o.vowel, { wet: o.wet, echo: o.echo, pan: o.pan });
    for (const f of notes) {
      for (const dt of [-9, 8]) {
        v.tone({
          type: 'sawtooth', f, fixed: true, detune: dt + v.rr(-3, 3), gain: g, env: { pad: true, a: o.a, h: o.h, r: o.r },
          vib: { rate: v.rr(4.6, 5.6), cents: 8, delay: o.a * 0.5 }, to: bank,
        });
      }
    }
  });
}

/** High sustained string-like tension notes. */
export function strings(io: TrackIO, t: number, notes: readonly number[], g: number, o: SwellShape & Place & { lp?: number }): void {
  note(io, t, (v) => {
    for (const f of notes) {
      for (const dt of [-7, 7]) {
        v.tone({
          type: 'sawtooth', f, fixed: true, detune: dt, gain: g, env: { pad: true, a: o.a, h: o.h, r: o.r },
          filter: { type: 'lowpass', f: o.lp ?? 1600, fixed: true }, vib: { rate: 5.2, cents: 7, delay: o.a * 0.6 }, pan: o.pan, wet: o.wet,
        });
      }
    }
  });
}

/** Brass-like stab: stacked saws into a snarling filter envelope and saturation. */
export function stab(io: TrackIO, t: number, notes: readonly number[], g: number, o: { len: number; bright: number; swell?: boolean; wet?: number }): void {
  note(io, t, (v) => {
    const peak = 700 + 2400 * o.bright;
    const a = o.swell ? o.len * 0.7 : 0.012;
    const bus = v.bus({
      filter: { type: 'lowpass', f: { pts: [[0, 220], [a + 0.02, peak], [a + o.len + 0.25, 300]] }, q: 1.6, fixed: true },
      drive: 2.2, wet: o.wet ?? 0.3,
    });
    for (const f of notes) {
      for (const dt of [-8, 8]) {
        v.tone({ type: 'sawtooth', f, fixed: true, detune: dt + v.rr(-3, 3), gain: g, env: { pad: true, a, h: o.len, r: 0.25 }, to: bus });
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Theme colour instruments (Rimed Ossuary / Iron Coliseum; see colours.ts)
// ---------------------------------------------------------------------------

const BONE_KNOCK: readonly Partial[] = [{ r: 1, g: 1, d: 1 }, { r: 2.76, g: 0.3, d: 0.3 }];
const CHAIN_LINK: readonly Partial[] = [{ r: 1, g: 1, d: 1 }, { r: 1.73, g: 0.7, d: 0.6 }];

/** Dry bone clack: a tight resonant knock and a short hollow body (ossuary time-keeping). */
export function boneClack(io: TrackIO, t: number, g: number, o: Place = {}): void {
  note(io, t, (v) => {
    v.noise({ color: 'white', gain: g * 5, env: { a: 0.0005, d: 0.022 }, filter: { type: 'bandpass', f: v.rr(1500, 2300), q: 4, fixed: true }, pan: o.pan, wet: o.wet });
    v.bell({ f: v.rr(640, 820), partials: BONE_KNOCK, gain: g * 0.6, decay: 0.06, fixed: true, pan: o.pan });
  });
}

/** A short run of iron chain links jingling (arena colour). */
export function chainRattle(io: TrackIO, t: number, g: number, o: Place & { links?: number } = {}): void {
  note(io, t, (v) => {
    let at = 0;
    const n = o.links ?? 4;
    for (let i = 0; i < n; i++) {
      const k = 1 - i * 0.14;
      v.bell({ at, f: v.rr(2500, 3900), partials: CHAIN_LINK, gain: g * k, decay: v.rr(0.05, 0.09), fixed: true, pan: o.pan, wet: o.wet ?? 0.25 });
      v.noise({ at, color: 'white', gain: g * 14 * k, env: { a: 0.0005, d: 0.01 }, filter: { type: 'bandpass', f: v.rr(4200, 6000), q: 3, fixed: true }, pan: o.pan });
      at += v.rr(0.025, 0.045);
    }
  });
}

/** Deep war drum (a big taiko): lower and longer than the kick, with a hard skin slap. */
export function warDrum(io: TrackIO, t: number, g: number, o: Place & { f?: number } = {}): void {
  const f = o.f ?? 62;
  note(io, t, (v) => {
    v.tone({ type: 'sine', f: [f * 1.8, f, 0.1], fixed: true, gain: g, env: { a: 0.0015, d: 0.65 }, pan: o.pan, wet: o.wet ?? 0.3 });
    v.noise({ color: 'pink', gain: g * 1.7, env: { a: 0.001, d: 0.07 }, filter: { type: 'bandpass', f: 650, q: 0.9, fixed: true }, pan: o.pan, wet: o.wet ?? 0.3 });
  });
}

/**
 * A distant crowd swelling and falling back: a breathy many-voice "oh" (noise and a handful of
 * rasping saws at scattered pitches into a vowel bank) with a slow, uneven flutter. `q` widens
 * the vowel formants (default: narrow, ~90 Hz wide): a crowd shouting harder sounds brighter.
 */
export function crowd(io: TrackIO, t: number, dur: number, g: number, o: Place & { vowel?: Vowel; q?: number } = {}): void {
  note(io, t, (v) => {
    const bank = v.formant(o.vowel ?? 'o', { wet: o.wet ?? 0.55, pan: o.pan, body: 0.2, q: o.q });
    const env = { pts: [[dur * 0.45, 1], [dur * 0.7, 0.75], [dur, 0]] as [number, number][] };
    v.noise({ color: 'pink', gain: g * 7, env, am: { rate: v.rr(4.5, 6), depth: 0.35 }, to: bank });
    for (let i = 0; i < 6; i++) {
      v.tone({
        type: 'sawtooth', f: v.rr(140, 310), fixed: true, noiseFm: v.rr(5, 10), gain: g * 0.45, env,
        vib: { rate: v.rr(4, 6.5), cents: 30 }, to: bank,
      });
    }
  });
}

/** A crowd chant: one short, punchy many-voice "HEY!" (arena boss colour). */
export function chant(io: TrackIO, t: number, g: number, o: Place = {}): void {
  note(io, t, (v) => {
    const bank = v.formant('e', { wet: o.wet ?? 0.45, pan: o.pan, body: 0.3 });
    const env = { pts: [[0.03, 1], [0.12, 0.6], [0.26, 0]] as [number, number][] };
    for (let i = 0; i < 5; i++) {
      const f = v.rr(180, 260);
      v.tone({ type: 'sawtooth', f: [f * 0.92, f, 0.06], fixed: true, noiseFm: 8, detune: v.rr(-25, 25), gain: g * 1.18, env, to: bank });
    }
    v.noise({ color: 'pink', gain: g * 10, env, to: bank });
  });
}

/**
 * The stands clapping along: a loose smear of hand claps — three clusters (left, centre, right),
 * each one band-limited noise source whose envelope fires 3 uneven claps within ~30 ms, so a
 * whole crowd costs three voices — the crowd's backbeat (arena colour).
 */
export function crowdClap(io: TrackIO, t: number, g: number, o: Place = {}): void {
  note(io, t, (v) => {
    const c = o.pan ?? 0;
    for (const side of [-0.45, 0, 0.45]) {
      const pts: [number, number][] = [];
      let at = v.rr(0, 0.008);
      for (let k = 0; k < 3; k++) {
        const peak = v.rr(0.65, 1);
        pts.push([at + 0.0008, peak], [at + 0.009, peak * 0.3]);
        at += v.rr(0.007, 0.013);
      }
      pts.push([at + v.rr(0.03, 0.05), 0]);
      v.noise({
        color: 'white', gain: g * 1.6, env: { pts },
        filter: { type: 'bandpass', f: v.rr(900, 1600), q: 1.1, fixed: true }, pan: Math.max(-0.8, Math.min(0.8, c + side)), wet: o.wet ?? 0.4,
      });
    }
  });
}

/** A two-finger whistle from the stands: a bright sine swooping up and falling away, with breath. */
export function whistle(io: TrackIO, t: number, g: number, o: Place = {}): void {
  note(io, t, (v) => {
    const f = v.rr(2000, 2500);
    const pts: [number, number][] = [[0, f * 0.82], [0.07, f * 1.08], [0.32, f], [0.5, f * 0.72]];
    const env = { pad: true, a: 0.03, h: 0.3, r: 0.17 } as const;
    v.tone({ type: 'sine', f: { pts }, fixed: true, gain: g, env, vib: { rate: 7, cents: 20, delay: 0.1 }, pan: o.pan, wet: o.wet ?? 0.5, echo: o.echo });
    v.noise({ color: 'pink', gain: g * 3, env, filter: { type: 'bandpass', f: { pts }, q: 9, fixed: true }, pan: o.pan, wet: o.wet ?? 0.5 });
  });
}

/** War horn: stacked saws opening slowly through a resonant lowpass. */
export function horn(io: TrackIO, t: number, notes: readonly number[], g: number, o: SwellShape & Place): void {
  note(io, t, (v) => {
    const bus = v.bus({
      filter: [{ type: 'lowpass', f: { pts: [[0, 240], [o.a + 0.1, 1300], [o.a + o.h + o.r, 380]] }, q: 1.4, fixed: true }, { type: 'peaking', f: 520, q: 1.5, gain: 5, fixed: true }],
      drive: 1.6, wet: o.wet ?? 0.45, pan: o.pan,
    });
    for (const f of notes) {
      for (const dt of [-7, 6]) {
        v.tone({ type: 'sawtooth', f, fixed: true, detune: dt + v.rr(-2, 2), gain: g, env: { pad: true, a: o.a, h: o.h, r: o.r }, vib: { rate: 4.8, cents: 10, delay: o.a }, to: bus });
      }
    }
  });
}
