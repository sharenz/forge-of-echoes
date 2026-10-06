// Sound recipes of the power rework's roster batch 3 (SK4): cast cues, Tempest Surge's charge, the batch's big moments (a meteor
// landing, Storm Step's strike, Event Horizon's collapse). Each is a variation of a calibrated recipe (named in its comment) with the
// same layer gains, so the trim it borrows in levels.ts keeps it on its target until the offline calibration is re-run.

import type { SfxDef } from './sfx';
import { midi, PARTIALS as P } from './voice';

export type Roster3SfxId =
  | 'castMeteor' | 'meteorImpact' | 'stormStepStrike' | 'tempestSurge' | 'castBlizzard' | 'castHorizon' | 'horizonCollapse';

export const ROSTER3_SFX: Record<Roster3SfxId, SfxDef> = {
  castMeteor: {
    // castMortar aimed at the sky: a rising roar of heat and a crackling call.
    group: 'skill', target: -20, maxVoices: 2, minInterval: 0.15, pitchVar: 0.04, reverb: 0.3, priority: 1,
    build(v) {
      v.thump({ f: [150, 70, 0.2], gain: 0.85, d: 0.28, drive: 1.6 });
      v.noise({ color: 'brown', gain: 2, env: { a: 0.08, d: 0.4 }, filter: { type: 'lowpass', f: [300, 2400, 0.4], q: 0.8 } });
      v.tone({ wave: 'hollow', f: [140, 320, 0.35], gain: 0.16, env: { a: 0.05, d: 0.35 }, filter: { type: 'lowpass', f: 1400 } });
      v.crackle({ at: 0.05, dur: 0.5, gain: 0.18, hp: 2600 });
    },
  },
  meteorImpact: {
    // mortarBlast with a whistle before it: the meteor screaming in, then the boom.
    group: 'combat', target: -20, maxVoices: 3, minInterval: 0.08, pitchVar: 0.07, reverb: 0.3, priority: 1, burst: 'loudest',
    build(v) {
      v.noise({ color: 'white', gain: 0.8, env: { pts: [[0.08, 1], [0.1, 0]] }, filter: { type: 'bandpass', f: [4200, 1400, 0.1], q: 0.8 } });
      v.thump({ at: 0.08, f: [120, 38, 0.3], gain: 1, d: 0.45, drive: 2 });
      v.noise({ at: 0.08, color: 'brown', gain: 2.2, env: { a: 0.003, d: 0.45 }, filter: { type: 'lowpass', f: [3000, 240, 0.35], q: 0.8 } });
      v.crackle({ at: 0.1, dur: 0.5, gain: 0.22, hp: 2200 });
    },
  },
  stormStepStrike: {
    // stormCallStrike, tighter: the crack of a bolt where she blinks.
    group: 'combat', target: -21, maxVoices: 4, minInterval: 0.04, pitchVar: 0.08, reverb: 0.25, priority: 1, burst: 'loudest',
    build(v) {
      v.click({ gain: 0.9, f: 2400, d: 0.03 });
      v.tone({ type: 'sawtooth', f: v.rr(800, 1000), noiseFm: 1800, gain: 0.25, drive: 1.4, env: { a: 0.001, d: 0.12 }, filter: { type: 'bandpass', f: 2600, q: 1 } });
      v.thump({ f: [150, 55, 0.12], gain: 0.7, d: 0.22, drive: 1.4 });
      v.noise({ at: 0.03, color: 'brown', gain: 1.4, env: { a: 0.02, d: 0.3 }, filter: { type: 'lowpass', f: [900, 200, 0.3] } });
    },
  },
  tempestSurge: {
    // aegisUp wound higher: a charging hum that climbs and a crackling edge.
    group: 'skill', target: -22, maxVoices: 1, minInterval: 0.3, pitchVar: 0.03, reverb: 0.25, priority: 1,
    build(v) {
      v.tone({
        type: 'sawtooth', f: [200, 420, 0.35], noiseFm: 600, gain: 0.14, env: { a: 0.04, d: 0.5 },
        filter: [{ type: 'bandpass', f: 2000, q: 1.2 }, { type: 'lowpass', f: 6000, fixed: true }], am: { rate: 50, depth: 0.4, type: 'square' },
      });
      v.noise({ color: 'white', gain: 0.3, env: { a: 0.02, d: 0.35 }, filter: { type: 'highpass', f: 6000 }, am: { rate: 70, depth: 0.8, type: 'square' } });
      v.click({ gain: 0.4, f: 2800, d: 0.02 });
    },
  },
  castBlizzard: {
    // castOrb blown wide: a cold gust rising and a glass chord.
    group: 'skill', target: -22, maxVoices: 2, minInterval: 0.15, pitchVar: 0.04, reverb: 0.35, priority: 1,
    build(v) {
      v.noise({ color: 'pink', gain: 1.2, env: { a: 0.12, d: 0.45 }, filter: { type: 'bandpass', f: [900, 3600, 0.45], q: 1.4 } });
      v.bell({ at: 0.05, f: midi(74), partials: P.glass, gain: 0.14, decay: 0.7, wet: 0.4 });
      v.bell({ at: 0.11, f: midi(79), partials: P.glass, gain: 0.09, decay: 0.6, wet: 0.4, pan: -0.2 });
      v.thump({ f: [260, 120, 0.06], gain: 0.15, d: 0.08 });
    },
  },
  castHorizon: {
    // castUmbral deepened: the air sucked toward a point and a low hum bending down.
    group: 'skill', target: -21, maxVoices: 1, minInterval: 0.3, pitchVar: 0.03, reverb: 0.35, priority: 1,
    build(v) {
      v.noise({ color: 'pink', gain: 1.6, env: { pts: [[0.3, 1], [0.6, 0]] }, filter: { type: 'bandpass', f: [3600, 260, 0.55], q: 1.6 } });
      v.thump({ at: 0.2, f: [100, 32, 0.3], gain: 0.6, d: 0.35 });
      v.tone({ at: 0.1, wave: 'hollow', f: [220, 80, 0.6], gain: 0.16, env: { a: 0.06, d: 0.6 }, filter: { type: 'lowpass', f: 1000 } });
      v.tone({ at: 0.1, type: 'sine', f: v.rr(58, 64), detune: 14, gain: 0.08, env: { a: 0.06, d: 0.7 }, wet: 0.4 });
    },
  },
  horizonCollapse: {
    // wellCollapse at full size: a long suck, then a saturated void boom.
    group: 'combat', target: -19, maxVoices: 2, minInterval: 0.1, pitchVar: 0.04, reverb: 0.35, priority: 1, burst: 'loudest',
    build(v) {
      v.noise({ color: 'pink', gain: 1.4, env: { pts: [[0.16, 1], [0.2, 0]] }, filter: { type: 'bandpass', f: [500, 3600, 0.18], q: 1.4 } });
      v.thump({ at: 0.18, f: [100, 30, 0.35], gain: 1, d: 0.5, drive: 2 });
      v.noise({ at: 0.18, color: 'brown', gain: 2.2, env: { a: 0.003, d: 0.55 }, filter: { type: 'lowpass', f: [2400, 180, 0.4], q: 0.8 } });
    },
  },
};
