// The static mixing graph shared by SFX and music:
//
//   hits/deaths   ─► combat ─► combatComp ─► combatMakeup ─┐
//   skills, slams ─► combatDirect ─────────────────────────┴─► combatDuck ─┐
//   other voices  ─► sfx ────────────────────────────────────────────────────┼─► sfxVol ──┐
//   music notes   ─► music ─► musicDuck ─► musicVol ──────────────────────────────────────┼─► preMaster ─► mix gain ─► dcBlock ─► limiter ─► makeup ─► safety clip ─► master ─► out
//   sends: sfxWet / combatWet(duck) / musicWet(duck) ─► reverbIn ─► HPF ─► convolver ─► reverbOut ─┘
//          sfxEcho / combatEcho(duck) / musicEcho(duck) ─► stereo damped delay ─► echoOut ─────────┘ (+ a little into the reverb)
//
// Send inputs carry the category volume so reverb/echo tails follow the sliders, and every path
// of a duckable bus (dry, reverb send, echo send) is ducked together.
import { dspResources, type DspResources } from './dsp';
import { MIX_GAIN_DB } from './levels';
import { qValue } from './voice';

export interface Volumes {
  master: number;
  music: number;
  sfx: number;
}

export type DuckTarget = 'music' | 'combat';

export interface AudioGraph {
  readonly ctx: BaseAudioContext;
  readonly res: DspResources;
  /**
   * Small impacts that stack by the dozen (hits, deaths, bites): bus-compressed, and ducked
   * under big loot / boss moments.
   */
  readonly combat: GainNode;
  /** Casts and big single impacts: ducked with combat, never compressed (they come one at a time). */
  readonly combatDirect: GainNode;
  readonly combatWet: GainNode;
  readonly combatEcho: GainNode;
  /** All other SFX. */
  readonly sfx: GainNode;
  readonly sfxWet: GainNode;
  readonly sfxEcho: GainNode;
  readonly music: GainNode;
  readonly musicWet: GainNode;
  readonly musicEcho: GainNode;
  /** Sum of all buses before dynamics (analysis tap). */
  readonly preMaster: GainNode;
  /** Final output (after master volume). */
  readonly output: GainNode;
  /**
   * Dynamics stages with the node that feeds each one, for gain-reduction metering (combat is
   * null when the graph was built without its compressor).
   */
  readonly meters: { readonly limiter: DynamicsStage; readonly combat: DynamicsStage | null };
  /** Smoothly (or immediately) apply the three volume sliders (0..1, perceptual taper). */
  setVolumes(v: Volumes, when?: number, immediate?: boolean): void;
  /**
   * Temporarily lower a bus by `db` from `when` (after a 50 ms attack), hold for `hold` seconds,
   * then recover over `release`. Overlapping ducks combine: at every instant the deepest wins.
   */
  duck(target: DuckTarget, db: number, hold: number, release: number, when?: number): void;
  dispose(): void;
}

export interface DynamicsStage {
  /** The node feeding the compressor (tap it to compare input vs output). */
  readonly input: AudioNode;
  readonly node: DynamicsCompressorNode;
}

export interface CompressorSettings {
  readonly threshold: number;
  readonly knee: number;
  readonly ratio: number;
  readonly attack: number;
  readonly release: number;
}

/**
 * Hard-knee brickwall-ish limiter on the master. The safety clipper after it is transparent up
 * to −1.9 dBFS and only rounds the last fraction of a dB below this ceiling.
 */
export const LIMITER: CompressorSettings = { threshold: -1.5, knee: 0, ratio: 20, attack: 0.001, release: 0.12 };

/**
 * Combat bus compressor for the small, stackable impacts (SfxDef.glue). A single calibrated hit
 * or death peaks between −13 and −5 dBFS, so it only grazes the knee (≤ 0.5 dB loudness,
 * measured); stacked, frame-aligned impacts are caught here so the master limiter (which would
 * pump the music too) only sees rare overs.
 */
export const COMBAT_COMP: CompressorSettings = { threshold: -9, knee: 6, ratio: 4, attack: 0.002, release: 0.08 };

/** Duck attack (s). */
export const DUCK_ATTACK = 0.05;

/**
 * DynamicsCompressorNode applies an automatic makeup gain ((1 / fullRangeGain)^0.6 per the spec).
 * We cancel it so material below the threshold passes at exactly unity. Because the makeup is
 * computed inside the browser it is measured once per page with a tiny offline probe; the
 * hard-knee spec value is the fallback until (or if) the probe cannot run.
 */
export function specMakeupDb(c: CompressorSettings): number {
  return -0.6 * c.threshold * (1 - 1 / c.ratio);
}

const measuredMakeup = new Map<CompressorSettings, number | null>();
const makeupProbes = new Map<CompressorSettings, Promise<number | null>>();

function applyCompressor(c: DynamicsCompressorNode, s: CompressorSettings): void {
  c.threshold.value = s.threshold;
  c.knee.value = s.knee;
  c.ratio.value = s.ratio;
  c.attack.value = s.attack;
  c.release.value = s.release;
}

/** Measure a compressor's built-in makeup gain (dB) by pushing quiet DC through an identical node. */
export function probeMakeup(s: CompressorSettings): Promise<number | null> {
  const known = makeupProbes.get(s);
  if (known) return known;
  const Offline = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
  if (!Offline) {
    const none = Promise.resolve(null);
    makeupProbes.set(s, none);
    return none;
  }
  const probe = (async () => {
    let db: number | null = null;
    try {
      const sr = 8000;
      const ctx = new Offline(1, sr / 4, sr);
      const src = ctx.createConstantSource();
      src.offset.value = 0.001; // −60 dBFS, far below any threshold/knee
      const comp = ctx.createDynamicsCompressor();
      applyCompressor(comp, s);
      src.connect(comp).connect(ctx.destination);
      src.start();
      const buf = await ctx.startRendering();
      const out = Math.abs(buf.getChannelData(0)[buf.length - 1]);
      const v = 20 * Math.log10(out / 0.001);
      db = Number.isFinite(v) && Math.abs(v) < 30 ? v : null;
    } catch {
      db = null;
    }
    measuredMakeup.set(s, db);
    return db;
  })();
  makeupProbes.set(s, probe);
  return probe;
}

/** The automatic makeup gain (dB) a compressor with these settings applies (measured when possible). */
export function compressorMakeupDb(s: CompressorSettings): number {
  return measuredMakeup.get(s) ?? specMakeupDb(s);
}

/** Probe every compressor used by the graph (analysis awaits this before rendering). */
export function probeAllMakeup(): Promise<void> {
  return Promise.all([probeMakeup(LIMITER), probeMakeup(COMBAT_COMP)]).then(() => undefined);
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function gainToDb(g: number): number {
  return 20 * Math.log10(Math.max(g, 1e-9));
}

/** Perceptual taper for 0..1 volume sliders (≈ −12 dB at half). */
export function volumeToGain(v: number): number {
  const c = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  return c * c;
}

// ---------------------------------------------------------------------------
// Duck curves (pure; exported for tests)
// ---------------------------------------------------------------------------

/** A piecewise-linear gain curve: `[time, value]` breakpoints; flat before the first / after the last. */
export type Curve = readonly (readonly [number, number])[];

export function curveAt(c: Curve, t: number): number {
  if (!c.length) return 1;
  if (t <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    const [t1, v1] = c[i];
    if (t <= t1) {
      const [t0, v0] = c[i - 1];
      return t1 > t0 ? v0 + ((v1 - v0) * (t - t0)) / (t1 - t0) : v1;
    }
  }
  return c[c.length - 1][1];
}

/** The curve of a single duck (1 before `when`, attack, hold, release back to 1). */
export function duckCurve(level: number, when: number, hold: number, release: number): Curve {
  const until = when + DUCK_ATTACK + hold;
  return [[when, 1], [when + DUCK_ATTACK, level], [until, level], [until + Math.max(0.01, release), 1]];
}

/**
 * Pointwise minimum of two curves from `from` on (exact: breakpoints of both plus crossings).
 * The result starts at `from` with the value `a` has there, so scheduling it is continuous.
 */
export function minCurve(a: Curve, b: Curve, from: number): Curve {
  const times = new Set<number>([from]);
  for (const [t] of a) if (t > from) times.add(t);
  for (const [t] of b) if (t > from) times.add(t);
  const sorted = [...times].sort((x, y) => x - y);
  const out: [number, number][] = [];
  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    if (i > 0) {
      const p = sorted[i - 1];
      const d0 = curveAt(a, p) - curveAt(b, p);
      const d1 = curveAt(a, t) - curveAt(b, t);
      if (d0 * d1 < 0) {
        const x = p + ((t - p) * d0) / (d0 - d1);
        out.push([x, Math.min(curveAt(a, x), curveAt(b, x))]);
      }
    }
    out.push([t, Math.min(curveAt(a, t), curveAt(b, t))]);
  }
  // Drop interior points that lie on the line through their neighbours (short automation lists).
  const simple: [number, number][] = [];
  for (const pt of out) {
    while (simple.length >= 2) {
      const [t0, v0] = simple[simple.length - 2];
      const [t1, v1] = simple[simple.length - 1];
      const [t2, v2] = pt;
      const onLine = t2 > t0 ? v0 + ((v2 - v0) * (t1 - t0)) / (t2 - t0) : v2;
      if (Math.abs(onLine - v1) < 1e-6) simple.pop();
      else break;
    }
    simple.push(pt);
  }
  return simple;
}

// ---------------------------------------------------------------------------

export interface GraphOptions {
  /** Build the combat bus compressor (default true). Calibration measures recipes without it. */
  combatComp?: boolean;
}

export function buildGraph(ctx: BaseAudioContext, destination: AudioNode, opts: GraphOptions = {}): AudioGraph {
  const res = dspResources(ctx);
  const nodes: AudioNode[] = [];
  const gain = (v = 1): GainNode => {
    const g = ctx.createGain();
    g.gain.value = v;
    nodes.push(g);
    return g;
  };
  const biquad = (type: BiquadFilterType, f: number, q = 0.707): BiquadFilterNode => {
    const b = ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = qValue(type, q);
    nodes.push(b);
    return b;
  };
  /** A compressor followed by a gain that cancels its automatic makeup. */
  const compressor = (s: CompressorSettings): { comp: DynamicsCompressorNode; out: GainNode } => {
    const comp = ctx.createDynamicsCompressor();
    applyCompressor(comp, s);
    nodes.push(comp);
    const known = measuredMakeup.get(s);
    const out = gain(dbToGain(-(known ?? specMakeupDb(s))));
    comp.connect(out);
    if (known === undefined) {
      void probeMakeup(s).then((db) => {
        if (db !== null) out.gain.setTargetAtTime(dbToGain(-db), ctx.currentTime, 0.02);
      });
    }
    return { comp, out };
  };

  // --- master chain -------------------------------------------------------
  const preMaster = gain();
  const mixGain = gain(dbToGain(MIX_GAIN_DB));
  const dcBlock = biquad('highpass', 20);
  const limiter = compressor(LIMITER);
  const clip = ctx.createWaveShaper();
  clip.curve = res.safety;
  clip.oversample = '2x';
  nodes.push(clip);
  const output = gain(1);
  preMaster.connect(mixGain).connect(dcBlock).connect(limiter.comp);
  limiter.out.connect(clip).connect(output).connect(destination);

  // --- sfx ----------------------------------------------------------------
  const sfxVol = gain();
  sfxVol.connect(preMaster);
  const combat = gain();
  const combatDuck = gain();
  combatDuck.connect(sfxVol);
  const combatComp = opts.combatComp === false ? null : compressor(COMBAT_COMP);
  if (combatComp) {
    combat.connect(combatComp.comp);
    combatComp.out.connect(combatDuck);
  } else {
    combat.connect(combatDuck);
  }
  const combatDirect = gain();
  combatDirect.connect(combatDuck);
  const sfx = gain();
  sfx.connect(sfxVol);

  // --- music --------------------------------------------------------------
  const music = gain();
  const musicDuck = gain();
  const musicVol = gain();
  music.connect(musicDuck).connect(musicVol).connect(preMaster);

  // --- reverb -------------------------------------------------------------
  const reverbIn = gain();
  const reverbHp = biquad('highpass', 170);
  const convolver = ctx.createConvolver();
  convolver.normalize = false;
  convolver.buffer = res.ir;
  nodes.push(convolver);
  const reverbOut = gain(0.85);
  reverbIn.connect(reverbHp).connect(convolver).connect(reverbOut).connect(preMaster);
  const sfxWet = gain();
  sfxWet.connect(reverbIn);
  const combatWet = gain();
  const combatWetDuck = gain();
  combatWet.connect(combatWetDuck).connect(sfxWet);
  const musicWet = gain();
  const musicWetDuck = gain();
  musicWet.connect(musicWetDuck).connect(reverbIn);

  // --- echo: two damped feedback delays, one per side ---------------------
  const echoIn = gain();
  const merger = ctx.createChannelMerger(2);
  nodes.push(merger);
  const side = (time: number, damp: number, ch: number) => {
    const d = ctx.createDelay(1);
    d.delayTime.value = time;
    nodes.push(d);
    const lp = biquad('lowpass', damp);
    const fb = gain(0.34);
    echoIn.connect(d);
    d.connect(lp);
    lp.connect(fb).connect(d);
    lp.connect(merger, 0, ch);
  };
  side(0.27, 3400, 0);
  side(0.405, 2800, 1);
  const echoOut = gain(0.75);
  merger.connect(echoOut).connect(preMaster);
  const echoToReverb = gain(0.3);
  echoOut.connect(echoToReverb).connect(reverbIn);
  const sfxEcho = gain();
  sfxEcho.connect(echoIn);
  const combatEcho = gain();
  const combatEchoDuck = gain();
  combatEcho.connect(combatEchoDuck).connect(sfxEcho);
  const musicEcho = gain();
  const musicEchoDuck = gain();
  musicEcho.connect(musicEchoDuck).connect(echoIn);

  /** Each duck target remembers the curve it scheduled, so a new duck can merge with it exactly. */
  const ducks: Record<DuckTarget, { params: AudioParam[]; curve: Curve }> = {
    music: { params: [musicDuck.gain, musicWetDuck.gain, musicEchoDuck.gain], curve: [] },
    combat: { params: [combatDuck.gain, combatWetDuck.gain, combatEchoDuck.gain], curve: [] },
  };

  return {
    ctx,
    res,
    combat,
    combatDirect,
    combatWet,
    combatEcho,
    sfx,
    sfxWet,
    sfxEcho,
    music,
    musicWet,
    musicEcho,
    preMaster,
    output,
    meters: {
      limiter: { input: dcBlock, node: limiter.comp },
      combat: combatComp ? { input: combat, node: combatComp.comp } : null,
    },
    setVolumes(v, when, immediate) {
      const t = when ?? ctx.currentTime;
      const set = (p: AudioParam, value: number) => {
        p.cancelScheduledValues(t);
        if (immediate) p.setValueAtTime(value, t);
        else p.setTargetAtTime(value, t, 0.04);
      };
      const s = volumeToGain(v.sfx);
      const m = volumeToGain(v.music);
      set(sfxVol.gain, s);
      set(sfxWet.gain, s);
      set(sfxEcho.gain, s);
      set(musicVol.gain, m);
      set(musicWet.gain, m);
      set(musicEcho.gain, m);
      set(output.gain, volumeToGain(v.master));
    },
    duck(target, db, hold, release, when) {
      const now = ctx.currentTime;
      const start = Math.max(now, when ?? now);
      const d = ducks[target];
      const next = minCurve(d.curve, duckCurve(dbToGain(-Math.abs(db)), start, hold, release), now);
      const v0 = next[0][1];
      for (const p of d.params) {
        // Hold the value the current automation has *now* (never re-schedule from a later time:
        // that would cut an in-progress ramp and step back to an older, deeper level).
        const cancelHold = (p as AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam }).cancelAndHoldAtTime;
        if (typeof cancelHold === 'function') cancelHold.call(p, now);
        else {
          p.cancelScheduledValues(now);
          p.setValueAtTime(v0, now);
        }
        for (let i = 1; i < next.length; i++) p.linearRampToValueAtTime(next[i][1], next[i][0]);
      }
      d.curve = next;
    },
    dispose() {
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* already disconnected */
        }
      }
    },
  };
}
