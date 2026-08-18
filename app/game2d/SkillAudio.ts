import { SKILL_AUDIO } from "../game/config/audio";
import type { SkillAudioId } from "../game/domain";

type BrowserWindow = Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext };

export class SkillAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;

  play(id: SkillAudioId): void {
    const context = this.getContext();
    if (!context || !this.master) return;
    if (context.state === "suspended") void context.resume();
    const definition = SKILL_AUDIO[id];
    const start = context.currentTime;

    for (const tone of definition.tones) {
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
      oscillator.start(toneStart);
      oscillator.stop(toneEnd + 0.02);
    }
  }

  dispose(): void {
    const context = this.context;
    this.context = null;
    this.master = null;
    if (context && context.state !== "closed") void context.close();
  }

  private getContext(): AudioContext | null {
    if (this.context) return this.context;
    if (typeof window === "undefined") return null;
    const AudioContextConstructor = window.AudioContext ?? (window as BrowserWindow).webkitAudioContext;
    if (!AudioContextConstructor) return null;
    this.context = new AudioContextConstructor();
    this.master = this.context.createGain();
    this.master.gain.value = 0.72;
    this.master.connect(this.context.destination);
    return this.context;
  }
}
