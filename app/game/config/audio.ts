import type { SkillAudioId } from "../domain";

export type OscillatorWave = "sine" | "square" | "sawtooth" | "triangle";

export interface AudioToneDefinition {
  wave: OscillatorWave;
  frequency: number;
  endFrequency: number;
  delay: number;
  duration: number;
  gain: number;
}

export interface SkillAudioDefinition {
  volume: number;
  tones: readonly AudioToneDefinition[];
}

/** Small procedural cues avoid network latency and can later be replaced per skill without changing combat. */
export const SKILL_AUDIO: Record<SkillAudioId, SkillAudioDefinition> = {
  "ember-lance": {
    volume: 0.18,
    tones: [
      { wave: "sawtooth", frequency: 260, endFrequency: 110, delay: 0, duration: 0.09, gain: 0.5 },
      { wave: "sine", frequency: 720, endFrequency: 340, delay: 0.01, duration: 0.07, gain: 0.32 },
    ],
  },
  "ember-nova": {
    volume: 0.24,
    tones: [
      { wave: "sine", frequency: 120, endFrequency: 68, delay: 0, duration: 0.32, gain: 0.65 },
      { wave: "sawtooth", frequency: 380, endFrequency: 90, delay: 0.035, duration: 0.24, gain: 0.3 },
      { wave: "triangle", frequency: 860, endFrequency: 420, delay: 0.02, duration: 0.16, gain: 0.22 },
    ],
  },
  "rift-step": {
    volume: 0.2,
    tones: [
      { wave: "sine", frequency: 150, endFrequency: 620, delay: 0, duration: 0.13, gain: 0.48 },
      { wave: "triangle", frequency: 520, endFrequency: 980, delay: 0.02, duration: 0.1, gain: 0.26 },
    ],
  },
};
