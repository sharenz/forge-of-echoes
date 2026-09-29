// Shared DSP resources: noise beds, impulse response, waveshaper curves and periodic waves.
// Everything here is generated once per sample rate and reused by every voice and context, so a
// sound effect never allocates sample data at play time.
import { Rand } from './rand';

export type NoiseColor = 'white' | 'pink' | 'brown' | 'crackle';
export type WaveName = 'warm' | 'hollow';

/** Level all continuous noise colours are normalised to, so recipe gains are comparable. */
export const NOISE_RMS = 0.25;
/** The soft-clip curve spans ±DRIVE_RANGE input units; callers pre-scale by drive / DRIVE_RANGE. */
export const DRIVE_RANGE = 8;

// ---------------------------------------------------------------------------
// Pure generators (no WebAudio; unit-testable in Node)
// ---------------------------------------------------------------------------

export function whiteNoise(n: number, rand: Rand): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = rand.next() * 2 - 1;
  return out;
}

/** Pink noise (-3 dB/oct) via Paul Kellet's refined filter bank. */
export function pinkNoise(n: number, rand: Rand): Float32Array {
  const out = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = rand.next() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  return out;
}

/** Brown (red) noise (-6 dB/oct): leaky integrator, DC removed afterwards. */
export function brownNoise(n: number, rand: Rand): Float32Array {
  const out = new Float32Array(n);
  let last = 0;
  for (let i = 0; i < n; i++) {
    last = (last + 0.02 * (rand.next() * 2 - 1)) / 1.02;
    out[i] = last;
  }
  return out;
}

/**
 * Fire crackle: sparse, randomly timed micro-bursts of decaying noise with a heavy-tailed
 * amplitude distribution (many ticks, occasional pops). Looping it gives an endless fire.
 */
export function crackleNoise(n: number, sampleRate: number, rand: Rand): Float32Array {
  const out = new Float32Array(n);
  const burst = (at: number, len: number, amp: number) => {
    for (let j = 0; j < len; j++) {
      const idx = (at + j) % n; // wrap so the buffer loops seamlessly
      out[idx] += (rand.next() * 2 - 1) * amp * Math.exp((-5 * j) / len);
    }
  };
  // Ticks: Poisson process ~90/s.
  let t = 0;
  while (true) {
    t += -Math.log(1 - rand.next()) / 90;
    const at = Math.floor(t * sampleRate);
    if (at >= n) break;
    const amp = 0.15 + 0.85 * Math.pow(rand.next(), 3);
    burst(at, Math.floor(sampleRate * rand.range(0.0006, 0.004)), amp);
  }
  // Pops: rarer, longer and louder.
  t = 0;
  while (true) {
    t += -Math.log(1 - rand.next()) / 5;
    const at = Math.floor(t * sampleRate);
    if (at >= n) break;
    burst(at, Math.floor(sampleRate * rand.range(0.004, 0.012)), rand.range(0.8, 1.4));
  }
  removeDc(out);
  normalizePeak(out, 1);
  return out;
}

export function removeDc(data: Float32Array): void {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  const mean = sum / data.length;
  for (let i = 0; i < data.length; i++) data[i] -= mean;
}

export function rms(data: Float32Array): number {
  let s = 0;
  for (let i = 0; i < data.length; i++) s += data[i] * data[i];
  return Math.sqrt(s / Math.max(1, data.length));
}

export function normalizeRms(data: Float32Array, target: number): void {
  const r = rms(data);
  if (r <= 0) return;
  const k = target / r;
  for (let i = 0; i < data.length; i++) data[i] *= k;
}

export function normalizePeak(data: Float32Array, target: number): void {
  let p = 0;
  for (let i = 0; i < data.length; i++) p = Math.max(p, Math.abs(data[i]));
  if (p <= 0) return;
  const k = target / p;
  for (let i = 0; i < data.length; i++) data[i] *= k;
}

/**
 * Make a buffer loop without a seam: generate `n + fade` samples, then crossfade the overflow
 * tail into the head so sample n-1 flows into sample 0. Returns a buffer of length n.
 */
export function loopable(data: Float32Array, fade: number): Float32Array {
  const n = data.length - fade;
  const out = data.slice(0, n);
  for (let i = 0; i < fade; i++) {
    const w = i / fade;
    out[i] = data[i] * w + data[n + i] * (1 - w);
  }
  return out;
}

/**
 * Stereo reverb impulse response: pre-delay, a handful of early reflections, then a
 * decorrelated exponentially decaying tail whose high end darkens over time (air damping).
 * Normalised to unit energy per channel so send gains translate directly to wet level.
 */
export function impulseResponse(sampleRate: number, seconds: number, rand: Rand): [Float32Array, Float32Array] {
  const n = Math.floor(sampleRate * seconds);
  const pre = Math.floor(0.014 * sampleRate);
  const chans: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  for (const data of chans) {
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sampleRate;
      const decay = Math.exp((-6.91 * t) / seconds); // -60 dB at `seconds`
      const damp = 0.82 * Math.exp(-t * 2.4) + 0.07; // bright onset, dark tail
      lp += (rand.next() * 2 - 1 - lp) * damp;
      const fadeIn = Math.min(1, t / 0.004);
      data[i] = lp * decay * fadeIn;
    }
    // Early reflections: sparse taps in the first ~75 ms.
    for (let k = 0; k < 9; k++) {
      const at = pre + Math.floor(sampleRate * rand.range(0.004, 0.075));
      const g = (0.9 - k * 0.07) * (rand.chance(0.5) ? 1 : -1);
      for (let j = 0; j < 24 && at + j < n; j++) data[at + j] += g * Math.exp(-j / 5) * 0.5;
    }
    removeDc(data.subarray(pre)); // keep the pre-delay exactly silent
    let energy = 0;
    for (let i = 0; i < n; i++) energy += data[i] * data[i];
    const k = 1 / Math.sqrt(energy || 1);
    for (let i = 0; i < n; i++) data[i] *= k;
  }
  return chans;
}

/** tanh soft clip over ±DRIVE_RANGE input units (odd-symmetric → no DC). */
export function softClipCurve(size = 4097): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * DRIVE_RANGE);
  }
  return curve;
}

/**
 * Final safety clipper: perfectly linear up to 0.8, then a tanh knee that approaches (but
 * never exceeds) ~0.95. With the limiter in front it only touches stray inter-sample overs.
 */
export function safetyCurve(size = 4097): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const x = (i / (size - 1)) * 2 - 1;
    const a = Math.abs(x);
    const y = a < 0.8 ? a : 0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2);
    curve[i] = Math.sign(x) * y;
  }
  return curve;
}

// ---------------------------------------------------------------------------
// Resource caches
// ---------------------------------------------------------------------------

export interface DspResources {
  readonly noise: Readonly<Record<NoiseColor, AudioBuffer>>;
  readonly ir: AudioBuffer;
  readonly softClip: Float32Array<ArrayBuffer>;
  readonly safety: Float32Array<ArrayBuffer>;
  wave(name: WaveName): PeriodicWave;
}

interface SharedBuffers {
  noise: Record<NoiseColor, AudioBuffer>;
  ir: AudioBuffer;
}

/**
 * Sample data depends only on the sample rate, and AudioBuffers are not tied to the context that
 * created them, so noise beds and the impulse response are generated once per rate and shared by
 * the live context and every offline render (analysis, sample bank).
 */
const bufferCache = new Map<number, SharedBuffers>();
const contextCache = new WeakMap<BaseAudioContext, DspResources>();

function sharedBuffers(ctx: BaseAudioContext): SharedBuffers {
  const sr = ctx.sampleRate;
  const hit = bufferCache.get(sr);
  if (hit) return hit;
  const rand = new Rand(0x5eed_a0d1); // fixed seed: identical beds in live and offline renders
  const fade = Math.floor(sr * 0.05);
  const bed = (gen: (n: number, r: Rand) => Float32Array, seconds: number): Float32Array => {
    const data = loopable(gen(Math.floor(sr * seconds) + fade, rand), fade);
    removeDc(data);
    normalizeRms(data, NOISE_RMS);
    return data;
  };
  const mono = (data: Float32Array): AudioBuffer => {
    const buf = ctx.createBuffer(1, data.length, sr);
    buf.getChannelData(0).set(data);
    return buf;
  };
  const [irL, irR] = impulseResponse(sr, 2.6, rand);
  const ir = ctx.createBuffer(2, irL.length, sr);
  ir.getChannelData(0).set(irL);
  ir.getChannelData(1).set(irR);
  const shared: SharedBuffers = {
    ir,
    noise: {
      white: mono(bed(whiteNoise, 2)),
      pink: mono(bed(pinkNoise, 3)),
      brown: mono(bed(brownNoise, 3)),
      crackle: mono(crackleNoise(Math.floor(sr * 4), sr, rand)),
    },
  };
  bufferCache.set(sr, shared);
  return shared;
}

function makeWave(ctx: BaseAudioContext, name: WaveName): PeriodicWave {
  const n = 40;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let h = 1; h < n; h++) {
    if (name === 'warm') imag[h] = 1 / Math.pow(h, 1.7);
    else imag[h] = h % 2 === 1 ? 1 / Math.pow(h, 1.25) : 0;
  }
  return ctx.createPeriodicWave(real, imag);
}

const softClip = softClipCurve();
const safety = safetyCurve();

/** Lazily build (once per context) and return the shared DSP resources. */
export function dspResources(ctx: BaseAudioContext): DspResources {
  const hit = contextCache.get(ctx);
  if (hit) return hit;
  const { noise, ir } = sharedBuffers(ctx);
  const waves = new Map<WaveName, PeriodicWave>();
  const res: DspResources = {
    noise,
    ir,
    softClip,
    safety,
    wave(name) {
      let w = waves.get(name);
      if (!w) {
        w = makeWave(ctx, name);
        waves.set(name, w);
      }
      return w;
    },
  };
  contextCache.set(ctx, res);
  return res;
}
