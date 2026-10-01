// The AudioEngine implementation (src/contracts/audio.ts).
//
// Lifecycle: nothing touches WebAudio until `unlock()` runs inside a user gesture, which creates
// the AudioContext (avoiding autoplay warnings) and resumes it. Before that, plays are queued
// briefly (a click that unlocks audio still gets its click sound) and music/volume/intensity
// requests are remembered. Without WebAudio (Node, tests, old browsers) every call is a no-op.
//
// Once running, the frequent sounds are pre-rendered into a sample bank in idle time (bank.ts);
// until an id is banked it is synthesised live, so there is never a gap.
import { MUSIC_IDS, type AudioEngine, type MusicId, type PlayOptions, type SfxId } from '../contracts/audio';
import { THEMES, type Theme } from '../contracts/content';
import { SampleBank, type BankStats, type BankVariant } from './bank';
import { buildGraph, dbToGain, type AudioGraph, type Volumes } from './graph';
import { MUSIC_TRIM_DB, SFX_TRIM_DB } from './levels';
import { spatialize, VoiceGate, type GateRules, type GateStats, type GateVoice } from './mixing';
import { MusicPlayer, type MusicSolo } from './music/player';
import { Rand, sessionSeed } from './rand';
import { COMBAT_BUS_GROUPS, DENSITY_GROUPS, SFX, type SfxDef } from './sfx';
import { VoiceBuilder, type VoiceIO } from './voice';

/** Sounds start this far ahead of currentTime so no envelope event lands in the past (clicks). */
export const START_AHEAD = 0.012;
/**
 * Combat/monster voices start up to this much later (random): plays from one 60 Hz frame would
 * otherwise begin on the same sample, and their phase-aligned thumps and clicks sum coherently.
 */
export const START_SCATTER = 0.008;
const PENDING_MAX = 16;
/** Queued (pre-unlock) plays older than this are stale and dropped. */
const PENDING_MAX_AGE_MS = 400;
/** Fade applied to a stolen voice. */
const STEAL_FADE = 0.02;
/** Below this linear gain a positional sound is culled (not worth a voice). */
const CULL_GAIN = 0.012;
const MAX_VOICES = 56;

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;

function findAudioContext(): AudioContextCtor | null {
  const g = globalThis as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

const wallClockMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const finiteOr = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Gate rules per id, derived once from the SFX table. */
const RULES = new Map<SfxId, GateRules>(
  (Object.entries(SFX) as [SfxId, SfxDef][]).map(([id, d]) => [id, {
    maxVoices: d.maxVoices,
    minInterval: d.minInterval,
    priority: d.priority,
    group: DENSITY_GROUPS.has(d.group) ? 'combat' : undefined,
    burst: d.burst,
    energyTau: d.energyTau,
    comboWindow: d.comboWindow,
  }]),
);

/**
 * Gate lane of a request. Player sounds are the local player's when un-positioned; a positioned
 * one is someone else's (an ally's hurt, debuff or level-up), so it gets its own lane and can
 * never block — or steal — the local player's cue inside its minInterval.
 */
export function laneOf(id: SfxId, positional: boolean): string {
  return positional && SFX[id]?.group === 'player' ? `${id}@ally` : id;
}

export interface AudioDebugInfo {
  state: AudioContextState | 'unavailable' | 'locked' | 'offline' | 'disposed';
  sampleRate: number;
  activeVoices: number;
  stats: GateStats & { culled: number; banked: number; live: number };
  bank: BankStats | null;
  /** Current gain reduction of the dynamics stages (dB, ≥ 0). */
  reduction: { limiter: number; combat: number };
  music: MusicId | null;
  /** Theme colouring the map/boss tracks. */
  theme: Theme | null;
  intensity: number;
}

/** Extra options for explicit scheduling (offline analysis, stress tests). */
export interface PlayAtOptions extends PlayOptions {
  /** Seed the variation for reproducible renders. */
  seed?: number;
  /** Override the calibrated trim (dB); used by calibration to measure raw recipe loudness. */
  trimDb?: number;
  /** Force live synthesis even if the id is banked (analysis parity checks). */
  live?: boolean;
}

/** Engine internals for the dev sound board and offline analysis (not part of the contract). */
export interface AudioEngineDebug extends AudioEngine {
  readonly context: BaseAudioContext | null;
  readonly graph: AudioGraph | null;
  debug(): AudioDebugInfo;
  /** Theme colour for the 'map' / 'boss' tracks (see setMusicTheme in index.ts). */
  setMusicTheme(theme: Theme | null): void;
  /** Schedule a play at an explicit audio-clock time. Returns whether a voice started. */
  playAt(id: SfxId, when: number, opts?: PlayAtOptions): boolean;
  /** Offline: schedule a whole music track up front (optionally theme-coloured; `solo` isolates the colour or the track). */
  prerenderMusic(id: MusicId, seconds: number, intensity: number, theme?: Theme | null, solo?: MusicSolo): void;
  /** Run one music scheduler wake-up now (offline renders drive the scheduler by hand). */
  tickMusic(): void;
  /** Set the music intensity without smoothing (offline renders). */
  snapIntensity(v: number): void;
  /** Render the sample bank now (resolves when every banked id is ready). */
  prepareBank(): Promise<void>;
}

export interface EngineOptions {
  /** Use this (e.g. Offline) context immediately instead of creating one on unlock. */
  context?: BaseAudioContext;
  /** Output node (defaults to the context destination). */
  destination?: AudioNode;
  /** Variation seed (defaults to a per-session seed). */
  seed?: number;
  /**
   * Sample bank: `true` builds one for this engine (the default for live engines; offline
   * engines default to pure live synthesis), `false` disables it, or share an existing bank.
   */
  bank?: boolean | SampleBank;
  /** Build the combat bus compressor (default true; calibration measures without it). */
  combatComp?: boolean;
}

/** Where a voice's output goes. */
interface Route {
  bus: AudioNode;
  wet: AudioNode;
  echo: AudioNode;
  lowpass: number;
  pan: number;
  /** Voice-level reverb send. */
  send: number;
}

interface EngineVoice extends GateVoice {
  end: number;
  mass(db: number): void;
}

export class WebAudioEngine implements AudioEngineDebug {
  private ctx: BaseAudioContext | null = null;
  graph: AudioGraph | null = null;
  private music: MusicPlayer | null = null;
  private bank: SampleBank | null = null;
  private readonly ctor: AudioContextCtor | null;
  private readonly rand: Rand;
  private readonly gate: VoiceGate<string>;
  private readonly offline: boolean;
  private disposed = false;
  private resuming: Promise<void> | null = null;
  private readonly listener = { x: 0, y: 0 };
  private volumes: Volumes = { master: 1, music: 1, sfx: 1 };
  private wantedMusic: MusicId | null = null;
  private wantedTheme: Theme | null = null;
  private wantedIntensity = 0;
  private pending: { id: SfxId; opts?: PlayOptions; at: number }[] = [];
  private counts = { culled: 0, banked: 0, live: 0 };

  constructor(private readonly options: EngineOptions = {}) {
    this.ctor = findAudioContext();
    const seed = options.seed ?? sessionSeed();
    this.rand = new Rand(seed);
    this.gate = new VoiceGate<string>(MAX_VOICES, () => this.rand.next());
    this.offline = !!options.context;
    if (options.context) this.init(options.context);
  }

  get context(): BaseAudioContext | null {
    return this.ctx;
  }

  get unlocked(): boolean {
    if (this.disposed || !this.ctx) return false;
    return this.offline || (this.ctx as AudioContext).state === 'running';
  }

  private init(ctx: BaseAudioContext): void {
    this.ctx = ctx;
    this.graph = buildGraph(ctx, this.options.destination ?? ctx.destination, { combatComp: this.options.combatComp });
    this.graph.setVolumes(this.volumes, ctx.currentTime, true);
    this.music = new MusicPlayer(this.graph, this.rand, MUSIC_TRIM_DB, { autoTick: !this.offline });
    this.music.setIntensity(this.wantedIntensity);
    this.music.setTheme(this.wantedTheme);
    const bank = this.options.bank ?? !this.offline;
    if (bank instanceof SampleBank) this.bank = bank;
    else if (bank) this.bank = new SampleBank(ctx.sampleRate, this.rand.int(0, 0x7fffffff));
    if (!this.offline) {
      (ctx as AudioContext).addEventListener('statechange', () => {
        if (this.unlocked) this.onRunning();
      });
    }
  }

  unlock(): Promise<void> {
    if (this.disposed || this.offline) return Promise.resolve();
    if (!this.ctx) {
      if (!this.ctor) return Promise.resolve();
      try {
        this.init(new this.ctor({ latencyHint: 'interactive' }));
      } catch {
        return Promise.resolve();
      }
    }
    const ctx = this.ctx as AudioContext;
    if (ctx.state === 'running') {
      this.onRunning();
      return Promise.resolve();
    }
    if (ctx.state === 'closed') return Promise.resolve();
    // iOS/Safari: starting a (silent) buffer inside the gesture is what actually opens output.
    this.primeOutput(ctx);
    this.resuming ??= ctx
      .resume()
      .catch(() => undefined)
      .then(() => {
        this.resuming = null;
        if (this.unlocked) this.onRunning();
      });
    return this.resuming;
  }

  private primeOutput(ctx: AudioContext): void {
    try {
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.onended = () => src.disconnect();
      src.start(0);
    } catch {
      /* best effort */
    }
  }

  private onRunning(): void {
    if (this.disposed || !this.music) return;
    if (this.music.current !== this.wantedMusic) this.music.setTrack(this.wantedMusic);
    void this.bank?.prepare();
    if (!this.pending.length) return;
    const now = wallClockMs();
    const queue = this.pending;
    this.pending = [];
    for (const p of queue) if (now - p.at <= PENDING_MAX_AGE_MS) this.play(p.id, p.opts);
  }

  play(id: SfxId, opts?: PlayOptions): void {
    if (this.disposed) return;
    if (!this.unlocked) {
      // Queue only if audio can ever start; drop the oldest when full. Options are copied:
      // callers may reuse one scratch object per frame.
      if (!this.ctor && !this.ctx) return;
      if (this.pending.length >= PENDING_MAX) this.pending.shift();
      const copy = opts && { x: opts.x, y: opts.y, volume: opts.volume, pitch: opts.pitch };
      this.pending.push({ id, opts: copy, at: wallClockMs() });
      return;
    }
    this.playAt(id, this.ctx!.currentTime + START_AHEAD, opts);
  }

  playAt(id: SfxId, when: number, opts?: PlayAtOptions): boolean {
    const ctx = this.ctx;
    const graph = this.graph;
    const def = SFX[id];
    if (!ctx || !graph || this.disposed || !def) return false;

    // Position → gain / pan / air absorption / distance reverb.
    let volume = Math.min(1, Math.max(0, finiteOr(opts?.volume, 1)));
    let pan = 0;
    let lowpass = 0;
    let distWet = 0;
    const positional = !!opts && Number.isFinite(opts.x) && Number.isFinite(opts.y);
    if (positional) {
      const s = spatialize(opts!.x! - this.listener.x, opts!.y! - this.listener.y);
      volume *= s.gain;
      pan = s.pan;
      lowpass = s.lowpass;
      distWet = s.wet;
    }
    if (volume < CULL_GAIN) {
      this.counts.culled++;
      return false;
    }
    const lane = laneOf(id, positional);
    const adm = this.gate.admit(lane, when, RULES.get(id)!, volume);
    if (!adm.ok) return false;

    const rnd = opts?.seed !== undefined ? new Rand(opts.seed) : this.rand;
    const start = adm.at + (def.lag ?? 0) + (DENSITY_GROUPS.has(def.group) ? rnd.range(0, START_SCATTER) : 0);
    const level = dbToGain(opts?.trimDb ?? SFX_TRIM_DB[id] ?? 0) * volume * adm.gain;
    const callerPitch = def.fixedPitch ? 1 : Math.max(0.25, Math.min(4, finiteOr(opts?.pitch, 1)));
    const pitch = callerPitch * rnd.jitter(def.pitchVar);
    const combat = COMBAT_BUS_GROUPS.has(def.group);
    const route: Route = {
      bus: !combat ? graph.sfx : def.glue ? graph.combat : graph.combatDirect,
      wet: combat ? graph.combatWet : graph.sfxWet,
      echo: combat ? graph.combatEcho : graph.sfxEcho,
      lowpass,
      pan,
      send: def.reverb + distWet,
    };
    const variant = opts?.live ? null : this.bank?.pick(id, adm.combo, rnd) ?? null;
    const voice = variant
      ? this.startBanked(variant, def, start, level, pitch, route)
      : this.startLive(def, start, level, pitch, route, rnd, adm.combo);
    if (variant) this.counts.banked++;
    else this.counts.live++;
    if (adm.massDb) voice.mass(adm.massDb);
    this.gate.add(lane, voice);
    if (def.duck?.music) graph.duck('music', def.duck.music, def.duck.hold, def.duck.release, start);
    if (def.duck?.combat) graph.duck('combat', def.duck.combat, def.duck.hold, def.duck.release, start);
    return true;
  }

  /**
   * The per-voice output chain: level (explicit stereo, so mono recipes up-mix exactly as the
   * calibration heard them) → air-absorption lowpass → pan → bus, plus the voice reverb send.
   */
  private outputChain(level: number, r: Route, nodes: AudioNode[]): GainNode {
    const ctx = this.ctx!;
    const input = ctx.createGain();
    input.gain.value = level;
    input.channelCount = 2;
    input.channelCountMode = 'explicit';
    input.channelInterpretation = 'speakers';
    nodes.push(input);
    let head: AudioNode = input;
    if (r.lowpass > 0) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = r.lowpass;
      nodes.push(lp);
      head.connect(lp);
      head = lp;
    }
    if (r.pan !== 0) {
      const pn = ctx.createStereoPanner();
      pn.pan.value = r.pan;
      nodes.push(pn);
      head.connect(pn);
      head = pn;
    }
    head.connect(r.bus);
    if (r.send > 0) {
      const send = ctx.createGain();
      send.gain.value = r.send;
      nodes.push(send);
      head.connect(send).connect(r.wet);
    }
    return input;
  }

  /** A send input that carries the voice level (reverb / echo tails of individual layers). */
  private sendInput(level: number, dest: AudioNode, nodes: AudioNode[]): GainNode {
    const g = this.ctx!.createGain();
    g.gain.value = level;
    nodes.push(g);
    g.connect(dest);
    return g;
  }

  /** One buffer source per rendered channel pair: the cheap path for frequent sounds. */
  private startBanked(v: BankVariant, def: SfxDef, start: number, level: number, pitch: number, r: Route): EngineVoice {
    const ctx = this.ctx!;
    const nodes: AudioNode[] = [];
    const input = this.outputChain(level, r, nodes);
    const faders = [input];
    const sources: AudioBufferSourceNode[] = [];
    let pendingEnds = 0;
    const onEnded = () => {
      if (--pendingEnds > 0) return;
      for (const n of nodes) n.disconnect();
    };
    const play = (buf: AudioBuffer, dest: AudioNode) => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.playbackRate.value = pitch;
      s.connect(dest);
      s.onended = onEnded;
      s.start(start);
      nodes.push(s);
      sources.push(s);
      pendingEnds++;
    };
    play(v.dry, input);
    if (v.wet) {
      const g = this.sendInput(level, r.wet, nodes);
      faders.push(g);
      play(v.wet, g);
    }
    if (v.echo) {
      const g = this.sendInput(level, r.echo, nodes);
      faders.push(g);
      play(v.echo, g);
    }
    return this.handle(start, start + v.duration / pitch, def.priority, faders, level, (t) => {
      for (const s of sources) {
        try {
          s.stop(t);
        } catch {
          /* already stopped */
        }
      }
    });
  }

  /** Full synthesis through the recipe (rare/big sounds, and anything not banked yet). */
  private startLive(def: SfxDef, start: number, level: number, pitch: number, r: Route, rnd: Rand, combo: number): EngineVoice {
    const nodes: AudioNode[] = [];
    const input = this.outputChain(level, r, nodes);
    const faders = [input];
    let wetIn: GainNode | null = null;
    let echoIn: GainNode | null = null;
    const io: VoiceIO = {
      out: input,
      wet: () => {
        if (!wetIn) {
          wetIn = this.sendInput(level, r.wet, nodes);
          faders.push(wetIn);
        }
        return wetIn;
      },
      echo: () => {
        if (!echoIn) {
          echoIn = this.sendInput(level, r.echo, nodes);
          faders.push(echoIn);
        }
        return echoIn;
      },
    };
    const voice = new VoiceBuilder(this.ctx!, this.graph!.res, start, io, pitch, rnd, combo);
    def.build(voice);
    voice.finish(() => {
      for (const n of nodes) n.disconnect();
    });
    return this.handle(start, voice.end, def.priority, faders, level, (t) => voice.stopAll(t));
  }

  /** The gate's view of a voice: stealing (fade, or silent cancel before it starts) and mass. */
  private handle(start: number, end: number, priority: number, faders: GainNode[], level: number, stop: (t: number) => void): EngineVoice {
    const ctx = this.ctx!;
    let current = level;
    const h: EngineVoice = {
      start,
      end,
      priority,
      kill(at) {
        const now = ctx.currentTime;
        const t = Math.max(at, now);
        if (t <= start + 0.001) {
          // Killed before it starts (same-frame burst swap): it never plays, so no fade.
          for (const f of faders) f.gain.value = 0;
          stop(t);
          h.end = t;
          return;
        }
        for (const f of faders) {
          f.gain.cancelScheduledValues(t);
          f.gain.setValueAtTime(current, t);
          f.gain.linearRampToValueAtTime(0, t + STEAL_FADE);
        }
        stop(t + STEAL_FADE + 0.005);
        h.end = Math.min(h.end, t + STEAL_FADE + 0.005);
      },
      mass(db) {
        current = level * dbToGain(db);
        for (const f of faders) f.gain.value = current;
      },
    };
    return h;
  }

  setListener(x: number, y: number): void {
    if (Number.isFinite(x)) this.listener.x = x;
    if (Number.isFinite(y)) this.listener.y = y;
  }

  setMusic(id: MusicId | null): void {
    if (this.disposed) return;
    if (id !== null && !(MUSIC_IDS as readonly string[]).includes(id)) return;
    this.wantedMusic = id;
    if (this.unlocked && this.music) this.music.setTrack(id);
  }

  /**
   * Colour the 'map' and 'boss' tracks for a map theme (null or an unknown value = uncoloured).
   * Remembered until unlock; a change under a playing themed track crossfades into the new colour.
   */
  setMusicTheme(theme: Theme | null): void {
    if (this.disposed) return;
    const t = theme !== null && (THEMES as readonly string[]).includes(theme) ? theme : null;
    this.wantedTheme = t;
    this.music?.setTheme(t);
  }

  setIntensity(v: number): void {
    this.wantedIntensity = Math.min(1, Math.max(0, finiteOr(v, 0)));
    this.music?.setIntensity(this.wantedIntensity);
  }

  setVolumes(v: { master: number; music: number; sfx: number }): void {
    this.volumes = {
      master: finiteOr(v?.master, this.volumes.master),
      music: finiteOr(v?.music, this.volumes.music),
      sfx: finiteOr(v?.sfx, this.volumes.sfx),
    };
    this.graph?.setVolumes(this.volumes);
  }

  prerenderMusic(id: MusicId, seconds: number, intensity: number, theme: Theme | null = null, solo: MusicSolo = null): void {
    this.music?.prerender(id, seconds, intensity, theme, solo);
  }

  tickMusic(): void {
    this.music?.tick();
  }

  snapIntensity(v: number): void {
    this.wantedIntensity = Math.min(1, Math.max(0, finiteOr(v, 0)));
    this.music?.setIntensity(this.wantedIntensity, true);
  }

  prepareBank(): Promise<void> {
    return this.bank?.prepare(() => Promise.resolve()) ?? Promise.resolve();
  }

  debug(): AudioDebugInfo {
    const ctx = this.ctx;
    const state: AudioDebugInfo['state'] = this.disposed
      ? 'disposed'
      : !ctx
        ? this.ctor ? 'locked' : 'unavailable'
        : this.offline ? 'offline' : (ctx as AudioContext).state;
    const reduction = (n: DynamicsCompressorNode | null | undefined) => Math.abs(finiteOr(n?.reduction, 0));
    return {
      state,
      sampleRate: ctx?.sampleRate ?? 0,
      activeVoices: ctx ? this.gate.active(ctx.currentTime) : 0,
      stats: { ...this.gate.stats, ...this.counts },
      bank: this.bank?.stats() ?? null,
      reduction: { limiter: reduction(this.graph?.meters.limiter.node), combat: reduction(this.graph?.meters.combat?.node) },
      music: this.music?.current ?? null,
      theme: this.wantedTheme,
      intensity: this.music?.intensity ?? 0,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pending = [];
    this.bank?.cancel();
    this.music?.dispose();
    this.graph?.dispose();
    this.gate.clear();
    if (this.ctx && !this.offline) {
      (this.ctx as AudioContext).close().catch(() => undefined);
    }
    this.music = null;
    this.graph = null;
  }
}
