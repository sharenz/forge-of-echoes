import { SKILL_AUDIO } from "../../game/config/audio";
import type { SkillAudioId } from "../../game/domain";

type BrowserWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };

export interface SamplePlayback {
  volume?: number;
  /** Play only a slice of the buffer (seconds). */
  offset?: number;
  duration?: number;
  /** Fade in/out length applied to the slice so cuts stay click-free (seconds). */
  fade?: number;
  /** Stereo placement in listener space, from -1 (left) to 1 (right). */
  pan?: number;
  playbackRate?: number;
  /** Shared concurrency bucket used to prevent a pack from flooding the mix. */
  voiceGroup?: string;
  maxVoices?: number;
}

export interface SampleAudioPlayer {
  preloadSample(url: string): void;
  playSample(url: string, playback?: SamplePlayback): void;
}

interface PendingSample {
  url: string;
  buffer: AudioBuffer;
  playback: SamplePlayback;
}

const MAX_PROCEDURAL_TONE_VOICES = 24;
const DEFAULT_SFX_MASTER_GAIN = 0.72;

/**
 * Owns the browser AudioContext, decoded sample cache and master SFX bus.
 * Higher-level systems decide *what* should play; this class only renders it.
 */
export class GameAudio implements SampleAudioPlayer {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly sampleBuffers = new Map<string, Promise<AudioBuffer | null>>();
  private readonly pendingSamples: PendingSample[] = [];
  private readonly activeVoices = new Map<string, number>();
  private activeProceduralToneVoices = 0;
  private removeUnlockListeners: (() => void) | null = null;
  private volume = 1;

  setMasterVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, Number.isFinite(volume) ? volume : 0));
    if (this.master) this.master.gain.value = DEFAULT_SFX_MASTER_GAIN * this.volume;
  }

  playSkill(id: SkillAudioId): void {
    const context = this.getContext();
    if (!context || !this.master) return;
    if (context.state === "suspended") void context.resume();
    const definition = SKILL_AUDIO[id];
    const start = context.currentTime;

    for (const tone of definition.tones) {
      if (this.activeProceduralToneVoices >= MAX_PROCEDURAL_TONE_VOICES) break;
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      const toneStart = start + tone.delay;
      const toneEnd = toneStart + tone.duration;
      oscillator.type = tone.wave;
      oscillator.frequency.setValueAtTime(tone.frequency, toneStart);
      oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, tone.endFrequency), toneEnd);
      envelope.gain.setValueAtTime(0.0001, toneStart);
      envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, tone.gain * definition.volume), toneStart + Math.min(0.018, tone.duration * 0.25));
      envelope.gain.exponentialRampToValueAtTime(0.0001, toneEnd);
      oscillator.connect(envelope).connect(this.master);
      this.activeProceduralToneVoices += 1;
      oscillator.onended = () => {
        oscillator.disconnect();
        envelope.disconnect();
        this.activeProceduralToneVoices = Math.max(0, this.activeProceduralToneVoices - 1);
      };
      try {
        oscillator.start(toneStart);
        oscillator.stop(toneEnd + 0.02);
      } catch (error) {
        oscillator.onended = null;
        oscillator.disconnect();
        envelope.disconnect();
        this.activeProceduralToneVoices = Math.max(0, this.activeProceduralToneVoices - 1);
        console.error(`[audio] Failed to play procedural skill cue: ${id}`, error);
      }
    }
  }

  /** Fetch and decode a sample so its first authored cue can start instantly. */
  preloadSample(url: string): void {
    this.getContext();
    void this.loadSample(url);
  }

  playSample(url: string, playback: SamplePlayback = {}): void {
    const context = this.getContext();
    if (!context || !this.master || (playback.volume ?? 1) <= 0) return;
    void this.loadSample(url).then((buffer) => {
      if (!buffer || !this.context || !this.master) return;
      if (this.context.state === "running") {
        this.playDecodedSample(url, buffer, playback);
        return;
      }
      // Browsers reject resume() when this call is not inside a user gesture.
      // Keep a bounded queue and flush it from the installed input listener.
      if (this.pendingSamples.length >= 24) this.pendingSamples.shift();
      this.pendingSamples.push({ url, buffer, playback: { ...playback } });
      void context.resume().then(() => this.flushPendingSamples()).catch(() => undefined);
    });
  }

  private playDecodedSample(url: string, buffer: AudioBuffer, playback: SamplePlayback): void {
    if (!this.context || !this.master || this.context.state !== "running") return;
    const voiceGroup = playback.voiceGroup ?? url;
    const maxVoices = Math.max(1, Math.floor(playback.maxVoices ?? Number.MAX_SAFE_INTEGER));
    const activeVoiceCount = this.activeVoices.get(voiceGroup) ?? 0;
    if (activeVoiceCount >= maxVoices) return;

    const start = this.context.currentTime;
    const offset = Math.min(Math.max(0, playback.offset ?? 0), Math.max(0, buffer.duration - 0.01));
    const duration = Math.min(playback.duration ?? buffer.duration - offset, buffer.duration - offset);
    if (duration <= 0) return;
    const playbackRate = Math.max(0.25, Math.min(4, playback.playbackRate ?? 1));
    const audibleDuration = duration / playbackRate;
    const fade = Math.min(playback.fade ?? 0.035, audibleDuration / 2);
    const volume = Math.max(0.0001, playback.volume ?? 1);
    const source = this.context.createBufferSource();
    const envelope = this.context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(volume, start + fade);
    envelope.gain.setValueAtTime(volume, start + Math.max(fade, audibleDuration - fade));
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + audibleDuration);
    source.connect(envelope);

    const createStereoPanner = this.context.createStereoPanner?.bind(this.context);
    if (createStereoPanner) {
      const panner = createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, playback.pan ?? 0));
      envelope.connect(panner).connect(this.master);
    } else {
      envelope.connect(this.master);
    }

    this.activeVoices.set(voiceGroup, activeVoiceCount + 1);
    source.onended = () => {
      const remaining = (this.activeVoices.get(voiceGroup) ?? 1) - 1;
      if (remaining > 0) this.activeVoices.set(voiceGroup, remaining);
      else this.activeVoices.delete(voiceGroup);
    };
    source.start(start, offset, duration);
  }

  private flushPendingSamples(): void {
    if (!this.context || this.context.state !== "running") return;
    for (const pending of this.pendingSamples.splice(0)) {
      this.playDecodedSample(pending.url, pending.buffer, pending.playback);
    }
  }

  private loadSample(url: string): Promise<AudioBuffer | null> {
    const cached = this.sampleBuffers.get(url);
    if (cached) return cached;
    const loading = (async (): Promise<AudioBuffer | null> => {
      try {
        const response = await fetch(url);
        if (!response.ok) return null;
        const encoded = await response.arrayBuffer();
        const context = this.getContext();
        if (!context) return null;
        return await context.decodeAudioData(encoded);
      } catch {
        return null;
      }
    })();
    this.sampleBuffers.set(url, loading);
    return loading;
  }

  dispose(): void {
    const context = this.context;
    this.removeUnlockListeners?.();
    this.removeUnlockListeners = null;
    this.context = null;
    this.master = null;
    this.sampleBuffers.clear();
    this.pendingSamples.length = 0;
    this.activeVoices.clear();
    this.activeProceduralToneVoices = 0;
    if (context && context.state !== "closed") void context.close();
  }

  private getContext(): AudioContext | null {
    if (this.context) return this.context;
    if (typeof window === "undefined") return null;
    const AudioContextConstructor = window.AudioContext ?? (window as BrowserWindow).webkitAudioContext;
    if (!AudioContextConstructor) return null;
    this.context = new AudioContextConstructor();
    this.master = this.context.createGain();
    this.master.gain.value = DEFAULT_SFX_MASTER_GAIN * this.volume;
    this.master.connect(this.context.destination);
    this.installUnlockListeners(this.context);
    return this.context;
  }

  private installUnlockListeners(context: AudioContext): void {
    if (context.state === "running" || this.removeUnlockListeners) return;
    const eventNames = ["pointerdown", "keydown", "touchstart"] as const;
    const remove = () => {
      for (const eventName of eventNames) window.removeEventListener(eventName, unlock, true);
      if (this.removeUnlockListeners === remove) this.removeUnlockListeners = null;
    };
    const unlock = () => {
      void context.resume().then(() => {
        if (context.state === "running") {
          this.flushPendingSamples();
          remove();
        }
      }).catch(() => undefined);
    };
    for (const eventName of eventNames) window.addEventListener(eventName, unlock, true);
    this.removeUnlockListeners = remove;
  }
}
