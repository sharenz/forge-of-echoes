// Sample bank: after unlock, the frequent sounds (hits, deaths, basic casts, motes, pickups, UI
// ticks) are rendered once into a handful of AudioBuffer variants with an OfflineAudioContext.
// A banked play is then one AudioBufferSourceNode (+ a gain, and a panner/lowpass when
// positional) instead of a ~20-node synth voice with per-play automation: roughly 5× fewer
// nodes on the audio thread in dense combat, with the same recipes and the same variety
// (several seeded variants, never the same one twice in a row, plus per-play pitch jitter).
//
// Variants are rendered at unity gain and pitch 1; the engine applies the calibrated trim,
// distance, repetition attenuation and pitch (as playbackRate) at play time. Rare, big sounds
// stay live-synthesised.
import type { SfxId } from '../contracts/audio';
import { dspResources } from './dsp';
import { Rand } from './rand';
import { SFX } from './sfx';
import { VoiceBuilder, type VoiceIO } from './voice';

export interface BankVariant {
  /** The voice's dry output (stereo). */
  readonly dry: AudioBuffer;
  /** Per-layer reverb send, when the recipe has one. */
  readonly wet: AudioBuffer | null;
  /** Per-layer echo send, when the recipe has one. */
  readonly echo: AudioBuffer | null;
  /** Seconds at playbackRate 1. */
  readonly duration: number;
}

/** Every id with a `bank` spec in sfx.ts. */
export const BANKED_IDS: readonly SfxId[] = (Object.keys(SFX) as SfxId[]).filter((id) => SFX[id].bank);

export type OfflineCtor = new (options: OfflineAudioContextOptions) => OfflineAudioContext;

/** The standard OfflineAudioContext (the legacy webkit one lacks the options constructor): null = live only. */
export function findOfflineContext(): OfflineCtor | null {
  return (globalThis as unknown as { OfflineAudioContext?: OfflineCtor }).OfflineAudioContext ?? null;
}

/** Silence between variants in the shared render (s). */
const GAP = 0.01;
/** A send channel quieter than this is treated as absent. */
const SILENT = 1e-6;

function mixSeed(seed: number, id: string, step: number, k: number): number {
  let h = (seed ^ 0x811c9dc5) >>> 0;
  const feed = (x: number) => {
    h ^= x & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (let i = 0; i < id.length; i++) feed(id.charCodeAt(i));
  feed(step);
  feed(step >>> 8);
  feed(k);
  feed(k >>> 8);
  return h >>> 0;
}

function yieldToIdle(): Promise<void> {
  const g = globalThis as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  return new Promise((resolve) => {
    if (g.requestIdleCallback) g.requestIdleCallback(() => resolve(), { timeout: 250 });
    else setTimeout(resolve, 16);
  });
}

export interface BankStats {
  ready: number;
  total: number;
  variants: number;
  bytes: number;
  failed: number;
}

export class SampleBank {
  private readonly sets = new Map<SfxId, BankVariant[][]>();
  private readonly last = new Map<SfxId, BankVariant>();
  private preparing: Promise<void> | null = null;
  private cancelled = false;
  private failed = 0;

  constructor(
    readonly sampleRate: number,
    private readonly seed: number,
    private readonly Offline: OfflineCtor | null = findOfflineContext(),
  ) {}

  /** Whether `id` can be played from buffers. */
  has(id: SfxId): boolean {
    return this.sets.has(id);
  }

  stats(): BankStats {
    let variants = 0;
    let bytes = 0;
    for (const steps of this.sets.values()) {
      for (const list of steps) {
        for (const v of list) {
          variants++;
          for (const b of [v.dry, v.wet, v.echo]) if (b) bytes += b.length * b.numberOfChannels * 4;
        }
      }
    }
    return { ready: this.sets.size, total: BANKED_IDS.length, variants, bytes, failed: this.failed };
  }

  /** A variant for this play (never the same buffer twice in a row), or null if not banked (yet). */
  pick(id: SfxId, combo: number, rand: Rand): BankVariant | null {
    const steps = this.sets.get(id);
    if (!steps) return null;
    const spec = SFX[id].bank;
    const step = spec?.step ? Math.min(steps.length - 1, Math.max(0, spec.step(combo))) : 0;
    const list = steps[step];
    if (!list?.length) return null;
    let i = rand.int(0, list.length - 1);
    if (list.length > 1 && list[i] === this.last.get(id)) i = (i + 1 + rand.int(0, list.length - 2)) % list.length;
    this.last.set(id, list[i]);
    return list[i];
  }

  /** Install variants directly (tests, or sharing a bank between engines). */
  insert(id: SfxId, steps: BankVariant[][]): void {
    this.sets.set(id, steps);
  }

  /** Render every banked id, one per idle chunk. Safe to call repeatedly. */
  prepare(yieldFn: () => Promise<void> = yieldToIdle): Promise<void> {
    if (!this.Offline) return Promise.resolve();
    this.preparing ??= (async () => {
      for (const id of BANKED_IDS) {
        if (this.cancelled) return;
        if (this.sets.has(id)) continue;
        try {
          await this.render(id);
        } catch {
          this.failed++; // this id stays live-synthesised
        }
        await yieldFn();
      }
    })();
    return this.preparing;
  }

  cancel(): void {
    this.cancelled = true;
  }

  /** Render all variants of one id in a single offline pass and slice them apart. */
  async render(id: SfxId): Promise<void> {
    const Offline = this.Offline;
    const spec = SFX[id].bank;
    if (!Offline || !spec) return;
    const sr = this.sampleRate;
    const steps = Math.max(1, spec.steps ?? 1);
    const n = Math.max(1, spec.variants);
    const jobs: { step: number; seed: number; at: number; len: number }[] = [];

    // Pass 1: build each variant in a throwaway (never rendered) context to learn its length.
    const probe = new Offline({ numberOfChannels: 1, length: 1, sampleRate: sr });
    const probeRes = dspResources(probe);
    const sink = probe.createGain();
    const probeIo: VoiceIO = { out: sink, wet: () => sink, echo: () => sink };
    let at = GAP;
    for (let step = 0; step < steps; step++) {
      for (let k = 0; k < n; k++) {
        const seed = mixSeed(this.seed, id, step, k);
        const v = new VoiceBuilder(probe, probeRes, 0, probeIo, 1, new Rand(seed), step);
        SFX[id].build(v);
        const len = Math.max(0.01, v.end);
        jobs.push({ step, seed, at, len });
        at += len + GAP;
      }
    }

    // Pass 2: render them back to back; channels 0/1 dry, 2/3 reverb send, 4/5 echo send.
    const ctx = new Offline({ numberOfChannels: 6, length: Math.ceil(at * sr), sampleRate: sr });
    const res = dspResources(ctx);
    const merger = ctx.createChannelMerger(6);
    merger.connect(ctx.destination);
    const tap = (ch: number): GainNode => {
      // Explicit stereo with speaker up-mix: a mono recipe lands on both channels, exactly as it
      // does when a live voice feeds the (stereo) mix.
      const g = ctx.createGain();
      g.channelCount = 2;
      g.channelCountMode = 'explicit';
      g.channelInterpretation = 'speakers';
      const split = ctx.createChannelSplitter(2);
      g.connect(split);
      split.connect(merger, 0, ch);
      split.connect(merger, 1, ch + 1);
      return g;
    };
    const dry = tap(0);
    const wet = tap(2);
    const echo = tap(4);
    const io: VoiceIO = { out: dry, wet: () => wet, echo: () => echo };
    for (const j of jobs) {
      const v = new VoiceBuilder(ctx, res, j.at, io, 1, new Rand(j.seed), j.step);
      SFX[id].build(v);
      v.finish();
    }
    const out = await ctx.startRendering();
    if (this.cancelled) return;

    const set: BankVariant[][] = Array.from({ length: steps }, () => []);
    for (const j of jobs) {
      const from = Math.floor(j.at * sr);
      const len = Math.min(out.length - from, Math.ceil(j.len * sr));
      const slice = (ch: number, required: boolean): AudioBuffer | null => {
        const l = out.getChannelData(ch).subarray(from, from + len);
        const r = out.getChannelData(ch + 1).subarray(from, from + len);
        let peak = 0;
        let mono = true;
        for (let i = 0; i < len; i++) {
          peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]));
          if (mono && Math.abs(l[i] - r[i]) > 1e-7) mono = false;
        }
        if (!required && peak < SILENT) return null;
        // Most recipes have no internal panning: store those as mono (the voice up-mixes).
        const b = ctx.createBuffer(mono ? 1 : 2, len, sr);
        b.copyToChannel(l, 0);
        if (!mono) b.copyToChannel(r, 1);
        return b;
      };
      set[j.step].push({ dry: slice(0, true)!, wet: slice(2, false), echo: slice(4, false), duration: len / sr });
    }
    this.sets.set(id, set);
  }
}
