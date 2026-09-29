// Offline level analysis (browser only): renders SFX and music through the real engine graph
// into an OfflineAudioContext and measures them, so levels can be verified without listening.
//
// Loudness follows ITU-R BS.1770 K-weighting. For SFX we report the maximum *short* (200 ms)
// window, a good proxy for how loud a transient event is perceived; music uses gated integrated
// loudness. Both are in LUFS-like dB units.
import { MUSIC_IDS, SFX_IDS, type MusicId, type SfxId } from '../contracts/audio';
import type { Theme } from '../contracts/content';
import { BANKED_IDS, SampleBank } from './bank';
import { START_AHEAD, WebAudioEngine } from './engine';
import { COMBAT_COMP, compressorMakeupDb, gainToDb, LIMITER, probeAllMakeup } from './graph';
import { MIX_GAIN_DB, MUSIC_TARGET, MUSIC_TRIM_DB, SFX_TRIM_DB } from './levels';
import type { MusicSolo } from './music/player';
import { Rand } from './rand';
import { SFX } from './sfx';

export const ANALYSIS_RATE = 48000;
/**
 * Sounds start after a short pre-roll: a freshly created DynamicsCompressorNode needs a few
 * hundred milliseconds for its internal gain state to settle, which would otherwise make the
 * master limiter look like it squashes the first transient.
 */
const START = 0.5;

export interface LevelReport {
  /** Sample peak after the master chain (dBFS). Must stay below 0. */
  peakDb: number;
  /** Sample peak of the raw mix before the master stage (mix gain, limiter, clipper) (dBFS). */
  prePeakDb: number;
  /** RMS over the audible span (dBFS). */
  rmsDb: number;
  /** Max 200 ms K-weighted loudness of the raw mix. */
  loudness: number;
  /** Gated integrated K-weighted loudness of the raw mix. */
  integrated: number;
  /** Seconds until the output stays below −60 dBFS. */
  duration: number;
  /** Mean of the master output over the audible span (DC offset). */
  dc: number;
  /** Gain reduction the master limiter applied at the loudest moment (dB, ≥ 0). */
  limiting: number;
  /** Seconds from the start to the loudest 10 ms of the raw mix (where the impact lands). */
  peakAt: number;
}

export interface SfxReport extends LevelReport {
  id: SfxId;
  target: number;
  trim: number;
  /** Declared impact delay (sfxImpactDelay). */
  impact: number;
}

export interface MusicReport extends LevelReport {
  id: MusicId;
  intensity: number;
  /** Theme colour the track was rendered with (null = plain). */
  theme: Theme | null;
  target: number;
  trim: number;
}

// --- K-weighting (BS.1770 coefficients at 48 kHz) ---------------------------

const K_SHELF = { b: [1.53512485958697, -2.69169618940638, 1.19839281085285], a: [1, -1.69065929318241, 0.73248077421585] };
const K_HIGHPASS = { b: [1, -2, 1], a: [1, -1.99004745483398, 0.99007225036621] };

function biquad(x: Float32Array, c: { b: number[]; a: number[] }): Float32Array {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const [b0, b1, b2] = c.b;
  const [, a1, a2] = c.a;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = yi;
    y[i] = yi;
  }
  return y;
}

/** Prefix sums of the summed K-weighted power of the given channels. */
function kPowerPrefix(chans: Float32Array[]): Float64Array {
  const n = chans[0].length;
  const prefix = new Float64Array(n + 1);
  const weighted = chans.map((c) => biquad(biquad(c, K_SHELF), K_HIGHPASS));
  for (let i = 0; i < n; i++) {
    let p = 0;
    for (const w of weighted) p += w[i] * w[i];
    prefix[i + 1] = prefix[i] + p;
  }
  return prefix;
}

const lufs = (meanPower: number): number => -0.691 + 10 * Math.log10(Math.max(meanPower, 1e-12));

function maxWindowLoudness(prefix: Float64Array, sr: number, window: number): number {
  const w = Math.floor(window * sr);
  const hop = Math.floor(0.01 * sr);
  const n = prefix.length - 1;
  let best = -Infinity;
  for (let s = 0; s + w <= n; s += hop) best = Math.max(best, lufs((prefix[s + w] - prefix[s]) / w));
  if (n < w) best = lufs(prefix[n] / w); // shorter than one window: count it as a window with silence
  return best;
}

function integratedLoudness(prefix: Float64Array, sr: number): number {
  const w = Math.floor(0.4 * sr);
  const hop = Math.floor(0.1 * sr);
  const n = prefix.length - 1;
  const blocks: number[] = [];
  for (let s = 0; s + w <= n; s += hop) blocks.push((prefix[s + w] - prefix[s]) / w);
  const abs = blocks.filter((p) => lufs(p) > -70);
  if (!abs.length) return -Infinity;
  const rel = lufs(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const gated = abs.filter((p) => lufs(p) > rel);
  return lufs(gated.reduce((a, b) => a + b, 0) / gated.length);
}

/** Lookahead latency (samples) of a DynamicsCompressorNode, measured once with an impulse. */
let compressorLatency: Promise<number> | null = null;
function measureLatency(): Promise<number> {
  compressorLatency ??= (async () => {
    const sr = ANALYSIS_RATE;
    const ctx = new OfflineAudioContext(1, sr / 4, sr);
    const b = ctx.createBuffer(1, 1, sr);
    b.getChannelData(0)[0] = 0.01;
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.connect(ctx.createDynamicsCompressor()).connect(ctx.destination);
    src.start(0.05);
    const d = (await ctx.startRendering()).getChannelData(0);
    let idx = 0, m = 0;
    for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > m) (m = Math.abs(d[i])), (idx = i);
    return idx - Math.round(0.05 * sr);
  })();
  return compressorLatency;
}

/**
 * Gain reduction (dB) of a dynamics stage per 20 ms window, from the energy of its input vs its
 * output (stereo pairs), shifted by the stage's measured latency, minus any static gain the
 * stage applies when idle (`offsetDb`). Windows with a quiet input are skipped.
 */
function reductionWindows(input: Float32Array[], output: Float32Array[], from: number, to: number, offsetDb: number, lag: number): number[] {
  const w = Math.floor(0.02 * ANALYSIS_RATE);
  const floor = Math.pow(10, -60 / 10) * w * 2;
  const out: number[] = [];
  for (let s = from; s + w + lag <= to; s += w) {
    let ei = 0, eo = 0;
    for (let i = s; i < s + w; i++) {
      ei += input[0][i] * input[0][i] + input[1][i] * input[1][i];
      eo += output[0][i + lag] * output[0][i + lag] + output[1][i + lag] * output[1][i + lag];
    }
    if (ei > floor) out.push(Math.max(0, 10 * Math.log10(ei / Math.max(eo, 1e-12)) + offsetDb));
  }
  return out;
}

/**
 * Measure a render. Channels 0/1 = raw mix, 2/3 = master output, 4/5 → 6/7 = the limiter's own
 * input → output (so its gain reduction is read without the DC blocker or clipper in between).
 */
function measure(buf: AudioBuffer, from: number, limiterLag: number): LevelReport {
  const sr = buf.sampleRate;
  const pre = [buf.getChannelData(0), buf.getChannelData(1)];
  const post = [buf.getChannelData(2), buf.getChannelData(3)];
  const start = Math.floor(from * sr);
  let peak = 0, prePeak = 0, last = start;
  let maxRed = 0;
  for (let i = start; i < buf.length; i++) {
    const a = Math.max(Math.abs(post[0][i]), Math.abs(post[1][i]));
    const b = Math.max(Math.abs(pre[0][i]), Math.abs(pre[1][i]));
    if (a > peak) peak = a;
    if (b > prePeak) prePeak = b;
    if (a > 0.001) last = i;
  }
  let sum = 0, sq = 0, count = 0;
  for (let i = start; i <= last; i++) {
    for (let c = 0; c < 2; c++) {
      sum += post[c][i];
      sq += post[c][i] * post[c][i];
    }
    count += 2;
  }
  const lim = reductionWindows(
    [buf.getChannelData(4), buf.getChannelData(5)], [buf.getChannelData(6), buf.getChannelData(7)],
    start, last, compressorMakeupDb(LIMITER), limiterLag,
  );
  maxRed = Math.max(0, ...lim);
  const slice = pre.map((c) => c.subarray(start, last + 1));
  const prefix = kPowerPrefix(slice);
  // Loudest 10 ms window (K-weighted power), hop 2.5 ms.
  const w10 = Math.floor(0.01 * sr);
  const hop = Math.floor(0.0025 * sr);
  let best = -1, peakAt = 0;
  for (let s = 0; s + w10 < prefix.length; s += hop) {
    const p = prefix[s + w10] - prefix[s];
    if (p > best) {
      best = p;
      peakAt = s / sr;
    }
  }
  return {
    peakDb: gainToDb(peak),
    prePeakDb: gainToDb(prePeak),
    rmsDb: gainToDb(Math.sqrt(sq / Math.max(1, count))),
    loudness: maxWindowLoudness(prefix, sr, 0.2),
    integrated: integratedLoudness(prefix, sr),
    duration: (last - start) / sr,
    dc: sum / Math.max(1, count),
    limiting: Math.max(0, maxRed),
    peakAt,
  };
}

let analysisBank: Promise<SampleBank> | null = null;

/** One sample bank at the analysis rate, rendered once and shared by every analysis render. */
export function sharedAnalysisBank(): Promise<SampleBank> {
  analysisBank ??= (async () => {
    const bank = new SampleBank(ANALYSIS_RATE, 0xba4c);
    await bank.prepare(() => Promise.resolve());
    return bank;
  })();
  return analysisBank;
}

/** Build an offline context whose channels 0/1 tap the raw mix and 2/3 the master output. */
/**
 * Build an offline context and engine. Channels: 0/1 raw mix, 2/3 master output, 4/5 → 6/7 the
 * limiter's input → output; `extra` more channels are left for the caller's own taps.
 */
async function offlineRig(
  seconds: number, seed: number, bank: SampleBank | false = false, combatComp = true, extra = 0,
): Promise<{ ctx: OfflineAudioContext; engine: WebAudioEngine; lag: number; tap: (ch: number) => AudioNode }> {
  await probeAllMakeup();
  const lag = await measureLatency();
  const channels = 8 + extra;
  const ctx = new OfflineAudioContext({ numberOfChannels: channels, length: Math.ceil(seconds * ANALYSIS_RATE), sampleRate: ANALYSIS_RATE });
  const merger = ctx.createChannelMerger(channels);
  merger.connect(ctx.destination);
  const tap = (ch: number): AudioNode => {
    const split = ctx.createChannelSplitter(2);
    split.connect(merger, 0, ch);
    split.connect(merger, 1, ch + 1);
    return split;
  };
  const engine = new WebAudioEngine({ context: ctx, destination: tap(2), seed, bank, combatComp });
  const g = engine.graph!;
  g.preMaster.connect(tap(0));
  g.meters.limiter.input.connect(tap(4));
  g.meters.limiter.node.connect(tap(6));
  return { ctx, engine, lag, tap };
}

/**
 * Render one SFX through the full graph. Channels 0/1 = raw mix, 2/3 = master output; the
 * sound starts at START (+ offset) seconds. Raw (calibration) renders bypass the combat bus
 * compressor so trims describe the recipe, not the bus dynamics; `combatComp` overrides.
 */
export async function renderSfx(
  id: SfxId,
  opts: { raw?: boolean; seed?: number; seconds?: number; offset?: number; bank?: SampleBank; combatComp?: boolean } = {},
): Promise<AudioBuffer> {
  return (await renderSfxWithLag(id, opts)).buf;
}

async function renderSfxWithLag(
  id: SfxId,
  opts: { raw?: boolean; seed?: number; seconds?: number; offset?: number; bank?: SampleBank; combatComp?: boolean },
): Promise<{ buf: AudioBuffer; lag: number }> {
  const comp = opts.combatComp ?? !opts.raw;
  const { ctx, engine, lag } = await offlineRig((opts.seconds ?? 5.5) + START + (opts.offset ?? 0), opts.seed ?? 7, opts.bank ?? false, comp);
  engine.playAt(id, START + (opts.offset ?? 0), { seed: opts.seed ?? 7, trimDb: opts.raw ? 0 : SFX_TRIM_DB[id] ?? 0 });
  return { buf: await ctx.startRendering(), lag };
}

const powerMean = (dbs: number[]): number => 10 * Math.log10(dbs.reduce((a, d) => a + Math.pow(10, d / 10), 0) / dbs.length);

/**
 * Render one SFX several times (different seeds → pitch/timbre variation, and different
 * sub-render-quantum start offsets, which shift oscillator levels by a few tenths of a dB in
 * browsers) and report the power-averaged loudness with worst-case peaks.
 */
export async function analyzeSfx(
  id: SfxId,
  opts: { raw?: boolean; seed?: number; renders?: number; bank?: SampleBank; combatComp?: boolean } = {},
): Promise<SfxReport> {
  const n = Math.max(1, opts.renders ?? 4);
  const rs: LevelReport[] = [];
  for (let k = 0; k < n; k++) {
    const offset = (k * 37) / ANALYSIS_RATE;
    const { buf, lag } = await renderSfxWithLag(id, { raw: opts.raw, seed: (opts.seed ?? 7) + k * 101, offset, bank: opts.bank, combatComp: opts.combatComp });
    rs.push(measure(buf, START + offset, lag));
  }
  return {
    id,
    target: SFX[id].target,
    trim: opts.raw ? 0 : SFX_TRIM_DB[id] ?? 0,
    impact: SFX[id].impact ?? 0,
    loudness: powerMean(rs.map((r) => r.loudness)),
    integrated: powerMean(rs.map((r) => r.integrated)),
    rmsDb: powerMean(rs.map((r) => r.rmsDb)),
    peakDb: Math.max(...rs.map((r) => r.peakDb)),
    prePeakDb: Math.max(...rs.map((r) => r.prePeakDb)),
    duration: Math.max(...rs.map((r) => r.duration)),
    dc: rs.reduce((a, r) => (Math.abs(r.dc) > Math.abs(a) ? r.dc : a), 0),
    limiting: Math.max(...rs.map((r) => r.limiting)),
    peakAt: rs.reduce((a, r) => a + r.peakAt, 0) / rs.length,
  };
}

export const RENDER_START = START;

// --- spectrogram --------------------------------------------------------------

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k], ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br;
        im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br;
        im[i + k + len / 2] = ai - bi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

export interface Spectrogram {
  frames: number;
  bins: number;
  hop: number;
  sampleRate: number;
  /** frames × bins magnitudes in dBFS (row-major by frame). */
  db: Float32Array;
}

/** Short-time Fourier transform (Hann window) of a mono signal, in dBFS. */
export function spectrogram(x: Float32Array, sampleRate: number, size = 1024, hop = 256): Spectrogram {
  const frames = Math.max(1, Math.floor((x.length - size) / hop) + 1);
  const bins = size / 2;
  const db = new Float32Array(frames * bins);
  const win = new Float64Array(size);
  for (let i = 0; i < size; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  const norm = 2 / win.reduce((a, b) => a + b, 0);
  const re = new Float64Array(size);
  const im = new Float64Array(size);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < size; i++) {
      re[i] = (x[f * hop + i] ?? 0) * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let b = 0; b < bins; b++) db[f * bins + b] = 20 * Math.log10(Math.hypot(re[b], im[b]) * norm + 1e-9);
  }
  return { frames, bins, hop, sampleRate, db };
}

/** Mono mix of a render's master output (channels 2/3): `seconds` from `from` (default: SFX start). */
export function outputMono(buf: AudioBuffer, seconds: number, from = START): Float32Array {
  const a = buf.getChannelData(2), b = buf.getChannelData(3);
  const s = Math.floor(from * buf.sampleRate);
  const n = Math.min(buf.length - s, Math.floor(seconds * buf.sampleRate));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = 0.5 * (a[s + i] + b[s + i]);
  return out;
}

export async function analyzeAllSfx(
  opts: { raw?: boolean; renders?: number; combatComp?: boolean; ids?: readonly SfxId[]; onProgress?: (done: number, total: number) => void } = {},
): Promise<SfxReport[]> {
  const out: SfxReport[] = [];
  const ids = opts.ids ?? SFX_IDS;
  for (const id of ids) {
    out.push(await analyzeSfx(id, opts));
    opts.onProgress?.(out.length, ids.length);
  }
  return out;
}

/** Render `seconds` of a music track (from t = 0) at a fixed intensity. Channels as renderSfx. */
export async function renderMusic(
  id: MusicId, seconds: number, intensity: number, opts: { raw?: boolean; seed?: number; theme?: Theme | null; solo?: MusicSolo } = {},
): Promise<AudioBuffer> {
  const { ctx, engine } = await offlineRig(seconds, opts.seed ?? 11);
  if (opts.raw) {
    // Measure without the calibrated trim by scaling the music bus back.
    const trim = MUSIC_TRIM_DB[id] ?? 0;
    for (const bus of [engine.graph!.music, engine.graph!.musicWet, engine.graph!.musicEcho]) bus.gain.value = Math.pow(10, -trim / 20);
  }
  engine.prerenderMusic(id, seconds, intensity, opts.theme ?? null, opts.solo ?? null);
  return ctx.startRendering();
}

/** Render `seconds` of a music track at a fixed intensity and measure it (from 1 s in). */
export async function analyzeMusic(
  id: MusicId, seconds: number, intensity: number, opts: { raw?: boolean; seed?: number; theme?: Theme | null } = {},
): Promise<MusicReport> {
  const buf = await renderMusic(id, seconds + 1, intensity, opts);
  const theme = opts.theme ?? null;
  return { id, intensity, theme, target: MUSIC_TARGET[id], trim: opts.raw ? 0 : MUSIC_TRIM_DB[id] ?? 0, ...measure(buf, 1, await measureLatency()) };
}

/** Intensities analysed per track (the calm tracks do not use intensity). */
export const MUSIC_INTENSITIES: Record<MusicId, readonly number[]> = { title: [0], hideout: [0], map: [0, 0.5, 1], boss: [0, 0.5, 1] };

export async function analyzeAllMusic(seconds = 20, opts: { raw?: boolean } = {}): Promise<MusicReport[]> {
  const out: MusicReport[] = [];
  for (const id of MUSIC_IDS) for (const I of MUSIC_INTENSITIES[id]) out.push(await analyzeMusic(id, seconds, I, opts));
  return out;
}

/** Map themes that colour the themed tracks (the plain tracks are the Ashen Forge's). */
export const MUSIC_THEMES: readonly Theme[] = ['rimedOssuary', 'ironColiseum'];

/**
 * The themed tracks (map / boss) at every analysed intensity, plain and in each theme colour.
 * Colours are layered on top of calibrated tracks, so each theme should land within about a dB
 * of the plain track (`delta`); the calibration itself uses the plain tracks only.
 */
export async function analyzeThemedMusic(seconds = 20): Promise<(MusicReport & { delta: number })[]> {
  const out: (MusicReport & { delta: number })[] = [];
  for (const id of ['map', 'boss'] as const) {
    for (const I of MUSIC_INTENSITIES[id]) {
      const plain = await analyzeMusic(id, seconds, I);
      out.push({ ...plain, delta: 0 });
      for (const theme of MUSIC_THEMES) {
        const r = await analyzeMusic(id, seconds, I, { theme });
        out.push({ ...r, delta: Math.round((r.integrated - plain.integrated) * 10) / 10 });
      }
    }
  }
  return out;
}

// --- theme colours ---------------------------------------------------------------

/** Octave-band centres (Hz) used by the colour analysis. */
export const OCTAVES = [63, 125, 250, 500, 1000, 2000, 4000, 8000] as const;

export interface ColourReport {
  id: 'map' | 'boss';
  theme: Theme;
  intensity: number;
  /** Per octave: the colour alone and the full themed track (dB, power over the render), and colour − full. */
  octaves: { hz: number; colour: number; full: number; delta: number }[];
  /** Colour − full track over 100 ms K-weighted windows (dB): median and 90th percentile. */
  median: number;
  p90: number;
}

/** Mono mix of a render's raw mix (channels 0/1, before the master stage). */
function rawMono(buf: AudioBuffer, from: number, seconds: number): Float32Array {
  const a = buf.getChannelData(0), b = buf.getChannelData(1);
  const s = Math.floor(from * buf.sampleRate);
  const n = Math.max(0, Math.min(buf.length - s, Math.floor(seconds * buf.sampleRate)));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = 0.5 * (a[s + i] + b[s + i]);
  return out;
}

function octavePowers(x: Float32Array, sr: number): number[] {
  const size = 4096;
  const spec = spectrogram(x, sr, size, size / 2);
  const binHz = sr / size;
  return OCTAVES.map((fc) => {
    const b0 = Math.max(1, Math.floor(fc / Math.SQRT2 / binHz)), b1 = Math.ceil((fc * Math.SQRT2) / binHz);
    let p = 0;
    for (let f = 0; f < spec.frames; f++) for (let b = b0; b < b1 && b < spec.bins; b++) p += Math.pow(10, spec.db[f * spec.bins + b] / 10);
    return 10 * Math.log10(p / spec.frames + 1e-20);
  });
}

function percentile(xs: number[], q: number): number {
  if (!xs.length) return -Infinity;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
}

/**
 * How much a theme colour is heard inside its track: render the themed track in full and its
 * colour alone (same seed, so the colour is sample-identical to its part of the full mix), then
 * compare them per octave and per 100 ms window (from 1 s in).
 */
export async function analyzeColour(id: 'map' | 'boss', theme: Theme, intensity: number, seconds = 20, seed = 11): Promise<ColourReport> {
  const full = await renderMusic(id, seconds + 1, intensity, { theme, seed });
  const colour = await renderMusic(id, seconds + 1, intensity, { theme, seed, solo: 'colour' });
  const sr = full.sampleRate;
  const fm = rawMono(full, 1, seconds), cm = rawMono(colour, 1, seconds);
  const fo = octavePowers(fm, sr), co = octavePowers(cm, sr);
  const octaves = OCTAVES.map((hz, i) => ({ hz, colour: co[i], full: fo[i], delta: Math.round((co[i] - fo[i]) * 10) / 10 }));
  const fp = kPowerPrefix([fm]), cp = kPowerPrefix([cm]);
  const w = Math.floor(0.1 * sr);
  const deltas: number[] = [];
  for (let s0 = 0; s0 + w < fp.length; s0 += w) {
    const f = lufs((fp[s0 + w] - fp[s0]) / w), c = lufs((cp[s0 + w] - cp[s0]) / w);
    if (f > -70) deltas.push(c - f);
  }
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return { id, theme, intensity, octaves, median: r1(percentile(deltas, 0.5)), p90: r1(percentile(deltas, 0.9)) };
}

/** Every themed track × theme × analysed intensity. */
export async function analyzeAllColours(seconds = 20): Promise<ColourReport[]> {
  const out: ColourReport[] = [];
  for (const id of ['map', 'boss'] as const) {
    for (const theme of MUSIC_THEMES) for (const I of MUSIC_INTENSITIES[id]) out.push(await analyzeColour(id, theme, I, seconds));
  }
  return out;
}

// --- co-triggers and segments -------------------------------------------------------

export interface CoTriggerReport {
  ids: SfxId[];
  /** Worst sample peak of the raw mix before the master stage (dBFS) over the renders. */
  prePeakDb: number;
  /** Worst master output peak (dBFS). */
  peakDb: number;
  /** Worst master-limiter gain reduction (dB). */
  limiting: number;
}

/**
 * Sounds the presenter plays in one frame: the hit that applies a debuff and the debuff itself
 * (each hit + debuff should stay at or below −3 dBFS before the master stage, where the limiter —
 * −1.5 dBFS after the mix gain — starts working), and heavier in-game stacks listed with and
 * without their debuff, so the debuff's own contribution shows (it should add nothing to the peak).
 * hurt + monsterSlam is the worst pre-wave-5 pair, for reference.
 */
export const CO_TRIGGERS: readonly (readonly SfxId[])[] = [
  ['playerHurt'],
  ['playerHurt', 'monsterSlam'],
  ['playerHurt', 'debuffChill'], ['playerHurt', 'debuffFreeze'], ['playerHurt', 'debuffRoot'], ['playerHurt', 'debuffBurn'],
  ['playerHurt', 'debuffBleed'], ['playerHurt', 'debuffShock'], ['playerHurt', 'debuffWither'],
  ['flaskLife', 'debuffCleanse'],
  ['wispBurst', 'playerHurt'], ['wispBurst', 'playerHurt', 'debuffFreeze'],
  ['wispBurst', 'playerHurt', 'hitCold'], ['wispBurst', 'playerHurt', 'hitCold', 'debuffFreeze'],
  ['houndBite', 'playerHurt'], ['houndBite', 'playerHurt', 'debuffBleed'],
  ['golemSlam', 'playerHurt'], ['golemSlam', 'playerHurt', 'debuffChill'],
];

/**
 * Play `ids` in the same frame (one request time, at the listener, full volume) through the
 * real graph and report the worst peaks over `renders` seeds.
 */
export async function analyzeCoTrigger(ids: readonly SfxId[], renders = 6): Promise<CoTriggerReport> {
  let pre = -Infinity, post = -Infinity, lim = 0;
  for (let k = 0; k < renders; k++) {
    const offset = (k * 37) / ANALYSIS_RATE;
    const { ctx, engine, lag } = await offlineRig(4 + START + offset, 7 + k);
    ids.forEach((id, i) => engine.playAt(id, START + offset, { seed: 7 + k * 101 + i * 13 }));
    const r = measure(await ctx.startRendering(), START + offset, lag);
    pre = Math.max(pre, r.prePeakDb);
    post = Math.max(post, r.peakDb);
    lim = Math.max(lim, r.limiting);
  }
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return { ids: [...ids], prePeakDb: r2(pre), peakDb: r2(post), limiting: r2(lim) };
}

export async function analyzeAllCoTriggers(renders = 6): Promise<CoTriggerReport[]> {
  const out: CoTriggerReport[] = [];
  for (const ids of CO_TRIGGERS) out.push(await analyzeCoTrigger(ids, renders));
  return out;
}

/**
 * K-weighted loudness (LUFS-like, power-averaged over renders) of one trimmed SFX in time
 * segments [from, to) measured from the voice start (the request plus the recipe's lag).
 */
export async function analyzeSegments(id: SfxId, segments: readonly (readonly [number, number])[], renders = 4): Promise<number[]> {
  const sums = segments.map(() => 0);
  for (let k = 0; k < renders; k++) {
    const offset = (k * 37) / ANALYSIS_RATE;
    const buf = await renderSfx(id, { seed: 7 + k * 101, offset, combatComp: false });
    const sr = buf.sampleRate;
    const t0 = START + offset + (SFX[id].lag ?? 0);
    const prefix = kPowerPrefix([buf.getChannelData(0), buf.getChannelData(1)]);
    segments.forEach(([a, b], i) => {
      const s0 = Math.floor((t0 + a) * sr), s1 = Math.floor((t0 + b) * sr);
      sums[i] += (prefix[s1] - prefix[s0]) / Math.max(1, s1 - s0);
    });
  }
  return sums.map((p) => Math.round(lufs(p / renders) * 10) / 10);
}

// --- stress ---------------------------------------------------------------------

export interface StressReport extends LevelReport {
  requested: number;
  played: number;
  dropped: number;
  merged: number;
  stolen: number;
  singleHitLoudness: number;
  /** Share of 20 ms windows in which the master limiter reduced the gain by more than 1 dB. */
  limiterActive: number;
  /** Largest master-limiter gain reduction over a 20 ms window (dB). */
  limiterMax: number;
  /** Combat bus compressor: mean / max gain reduction over the busy windows, and share above 1 dB. */
  combatMean: number;
  combatMax: number;
  combatActive: number;
}

/** A weighted combat mix (duplicates within a frame are common, as when a Nova sweeps a pack). */
const STRESS_IDS: readonly SfxId[] = [
  'hitFire', 'hitFire', 'hitFire', 'hitFire', 'hitCold', 'hitPhysical', 'hitLightning', 'monsterDeath', 'monsterDeath', 'monsterDeath',
  'monsterAttack', 'mote', 'mote', 'crit', 'evade', 'castEmber',
];
const FRAME = 1 / 60;
/**
 * A fresh DynamicsCompressorNode settles for a couple of seconds (its meter starts near 20 dB
 * of "reduction" even on silence), so stress renders start after a settle pre-roll.
 */
const SETTLE = 2.5;

/** An offline suspend point on a render-quantum boundary. */
const quantum = (t: number): number => (Math.round((t * ANALYSIS_RATE) / 128) * 128) / ANALYSIS_RATE;

/**
 * The limiter/gate stress test, the way a game actually calls the engine: `rate` plays per
 * second arrive in 60 Hz frame batches (every play of a frame has the same request time), at
 * random positions around the listener, through the real voice gate and sample bank. Gain
 * reduction is measured from signal energy at the limiter and at the combat bus compressor.
 */
export async function analyzeStress(rate = 200, seconds = 3, opts: { bank?: boolean } = {}): Promise<StressReport> {
  const bank = opts.bank === false ? false : await sharedAnalysisBank();
  const sr = ANALYSIS_RATE;
  // Channels 8/9 → 10/11 tap the combat bus compressor's input → output.
  const { ctx, engine, lag, tap } = await offlineRig(SETTLE + seconds + 1.5, 3, bank, true, 4);
  const g = engine.graph!;
  g.meters.combat!.input.connect(tap(8));
  g.meters.combat!.node.connect(tap(10));
  let k = 0;
  let owed = 0;
  let requested = 0;
  const pickRand = new Rand(0x57e55);
  const frames = Math.floor(seconds / FRAME);
  for (let f = 0; f < frames; f++) {
    void ctx.suspend(quantum(SETTLE + f * FRAME)).then(() => {
      owed += rate * FRAME;
      const when = ctx.currentTime + START_AHEAD;
      for (; owed >= 1; owed--) {
        k++;
        requested++;
        const a = (k * 2.39996) % (Math.PI * 2);
        const r = 40 + ((k * 97) % 280);
        const pick = STRESS_IDS[Math.floor(pickRand.next() * STRESS_IDS.length)];
        engine.playAt(pick, when, { x: Math.cos(a) * r, y: Math.sin(a) * r, seed: k });
      }
      void ctx.resume();
    });
  }
  const buf = await ctx.startRendering();
  const pair = (c: number) => [buf.getChannelData(c), buf.getChannelData(c + 1)];
  const from = Math.floor(SETTLE * sr);
  const to = Math.floor((SETTLE + seconds) * sr);
  // Compressor node outputs still carry their automatic makeup gain.
  const lim = reductionWindows(pair(4), pair(6), from, to, compressorMakeupDb(LIMITER), lag);
  const comb = reductionWindows(pair(8), pair(10), from, to, compressorMakeupDb(COMBAT_COMP), lag);
  const single = await analyzeSfx('hitFire', { renders: 2 });
  const s = engine.debug().stats;
  const share = (xs: number[]) => xs.filter((x) => x > 1).length / Math.max(1, xs.length);
  return {
    requested, played: s.played, dropped: s.droppedInterval + s.droppedBudget, merged: s.merged, stolen: s.stolen,
    singleHitLoudness: single.loudness,
    limiterActive: share(lim),
    limiterMax: Math.max(0, ...lim),
    combatMean: comb.reduce((a, b) => a + b, 0) / Math.max(1, comb.length),
    combatMax: Math.max(0, ...comb),
    combatActive: share(comb),
    ...measure(buf, SETTLE, lag),
  };
}

// --- CPU ----------------------------------------------------------------------

export interface CpuReport {
  scenario: string;
  /** Audio-thread render time as a share of real time (%), one core. */
  audioPct: number;
  /** Main-thread time spent building voices and scheduling music (ms per second of audio). */
  mainMsPerSec: number;
  voicesPerSec: number;
  bankedShare: number;
}

interface CpuScenario {
  name: string;
  music: MusicId | null;
  /** Theme colour of the music (setMusicTheme). */
  theme?: Theme | null;
  combat: boolean;
  bank: boolean;
  /** Extra plays: [every n frames, id] (a boss fight's own sounds). */
  extras?: readonly (readonly [number, SfxId])[];
}

/** Varkus's fight on top of the dense combat: whirl replays, spikes, crowd, bleed, charge. */
const VARKUS_SCENE: readonly (readonly [number, SfxId])[] = [
  [101, 'varkusWhirl'], [60, 'arenaSpikes'], [240, 'crowdRoar'], [90, 'debuffBleed'], [150, 'varkusCharge'], [20, 'houndBite'], [45, 'playerHurt'],
];

export const CPU_SCENARIOS: readonly CpuScenario[] = [
  { name: 'idle graph', music: null, combat: false, bank: true },
  { name: 'boss music', music: 'boss', combat: false, bank: true },
  { name: 'dense combat · live synthesis', music: null, combat: true, bank: false },
  { name: 'dense combat · sample bank', music: null, combat: true, bank: true },
  { name: 'boss music + combat · live', music: 'boss', combat: true, bank: false },
  { name: 'boss music + combat · bank', music: 'boss', combat: true, bank: true },
  { name: 'Coliseum boss music + combat + Varkus · bank', music: 'boss', theme: 'ironColiseum', combat: true, bank: true, extras: VARKUS_SCENE },
  { name: 'Ossuary boss music + combat · bank', music: 'boss', theme: 'rimedOssuary', combat: true, bank: true },
];

/**
 * Estimate audio-thread cost the way the game drives the engine: the offline render is suspended
 * every 1/60 s, that frame's plays are scheduled (5 combat requests, a mote every other frame, an
 * Ember Lance cast every 0.42 s), the music scheduler ticks every 50 ms, and the render resumes.
 * Render wall time minus the JS time spent inside the suspensions ≈ audio-thread time.
 */
export async function analyzeCpu(seconds = 8, scenarios: readonly CpuScenario[] = CPU_SCENARIOS): Promise<CpuReport[]> {
  const bank = await sharedAnalysisBank();
  const ids: SfxId[] = ['hitFire', 'hitCold', 'hitPhysical', 'hitLightning', 'monsterDeath', 'monsterAttack', 'crit', 'evade'];
  const run = async (sc: CpuScenario): Promise<CpuReport> => {
    const { ctx, engine } = await offlineRig(seconds, 5, sc.bank ? bank : false);
    let js = 0;
    let k = 0;
    if (sc.music) {
      engine.snapIntensity(1);
      engine.setMusicTheme(sc.theme ?? null);
      engine.setMusic(sc.music);
    }
    const frames = Math.floor(seconds / FRAME) - 2;
    for (let f = 1; f < frames; f++) {
      void ctx.suspend(quantum(f * FRAME)).then(() => {
        const t0 = performance.now();
        const when = ctx.currentTime + START_AHEAD;
        if (sc.combat) {
          for (let i = 0; i < 5; i++) {
            k++;
            const a = k * 2.39996;
            const r = 60 + ((k * 97) % 260);
            engine.playAt(ids[k % ids.length], when, { x: Math.cos(a) * r, y: Math.sin(a) * r, seed: k });
          }
          if (f % 2 === 0) engine.playAt('mote', when, { seed: k });
          if (f % 25 === 0) engine.playAt('castEmber', when, { seed: k });
        }
        for (const [n, id] of sc.extras ?? []) if (f % n === 0) engine.playAt(id, when, { x: 60, y: -20, seed: f });
        if (sc.music && f % 3 === 0) engine.tickMusic();
        js += performance.now() - t0;
        void ctx.resume();
      });
    }
    const t0 = performance.now();
    await ctx.startRendering();
    const wall = performance.now() - t0;
    const st = engine.debug().stats;
    return {
      scenario: sc.name,
      audioPct: Math.round(((wall - js) / (seconds * 1000)) * 1000) / 10,
      mainMsPerSec: Math.round((js / seconds) * 10) / 10,
      voicesPerSec: Math.round(st.played / seconds),
      bankedShare: st.banked + st.live ? Math.round((st.banked / (st.banked + st.live)) * 100) / 100 : 0,
    };
  };
  await run(scenarios[scenarios.length - 1]); // warm-up (JIT, shared buffers)
  const out: CpuReport[] = [];
  for (const sc of scenarios) out.push(await run(sc));
  return out;
}

// --- bank parity -----------------------------------------------------------------

export interface ParityRow {
  id: SfxId;
  live: number;
  banked: number;
  delta: number;
  livePeak: number;
  bankedPeak: number;
}

/** Banked playback must sound as loud as the live recipe it was rendered from. */
export async function analyzeBankParity(renders = 6): Promise<ParityRow[]> {
  const bank = await sharedAnalysisBank();
  const out: ParityRow[] = [];
  for (const id of BANKED_IDS) {
    const live = await analyzeSfx(id, { renders });
    const banked = await analyzeSfx(id, { renders, bank });
    out.push({
      id, live: live.loudness, banked: banked.loudness, delta: Math.round((banked.loudness - live.loudness) * 100) / 100,
      livePeak: live.peakDb, bankedPeak: banked.peakDb,
    });
  }
  return out;
}

// --- calibration -------------------------------------------------------------------

/** Suggested trims (dB) that land every SFX on its target, from a raw (untrimmed) analysis. */
export function suggestSfxTrims(raw: readonly SfxReport[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of raw) out[r.id] = Math.round((r.target - r.loudness) * 10) / 10;
  return out;
}

/** Music is calibrated on its most intense, uncoloured state (the level curve lifts the calmer states). */
export function suggestMusicTrims(raw: readonly MusicReport[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of MUSIC_IDS) {
    const rows = raw.filter((r) => r.id === id && !r.theme);
    const top = rows.reduce((a, b) => (b.intensity > a.intensity ? b : a), rows[0]);
    if (top) out[id] = Math.round((MUSIC_TARGET[id] - top.integrated) * 10) / 10;
  }
  return out;
}
