// Sound recipes of the power rework's roster batch 1 (SK2): cast cues, the two self-buffs and the skills' big moments.
// Each is a variation of a calibrated recipe in sfx.ts (named in its comment) with the same layer gains, so the trim it
// borrows in levels.ts keeps it on its target until the offline calibration is re-run.

import type { SfxDef } from './sfx';
import { midi, PARTIALS as P } from './voice';

export type RosterSfxId =
  | 'castSpark' | 'castMortar' | 'castUmbral' | 'castKinetic' | 'castOrb' | 'castStormCall' | 'phaseStride' | 'arcaneReprieve'
  | 'glacialNovaBurst' | 'mortarBlast' | 'stormCallStrike' | 'frostSpike';

export const ROSTER_SFX: Record<RosterSfxId, SfxDef> = {
  castSpark: {
    // castArc, lighter and higher: a skittering buzz of sparks leaving the wand.
    group: 'skill', target: -24, maxVoices: 3, minInterval: 0.05, pitchVar: 0.07, reverb: 0.15, priority: 1,
    build(v) {
      v.click({ gain: 0.6, f: 2600, d: 0.02 });
      v.tone({
        type: 'sawtooth', f: v.rr(1300, 1550), noiseFm: 1500, gain: 0.22, env: { a: 0.002, h: 0.03, d: 0.14 },
        filter: [{ type: 'bandpass', f: [3600, 2000, 0.14], q: 1.4 }, { type: 'lowpass', f: 8000, fixed: true }],
        am: { rate: 52, depth: 0.5, type: 'square' },
      });
      v.noise({ color: 'white', gain: 0.3, env: { a: 0.001, d: 0.08 }, filter: { type: 'highpass', f: 6500 }, am: { rate: 70, depth: 0.8, type: 'square' } });
    },
  },
  castMortar: {
    // castNova's punch, shorter: a hollow tube "thoomp" and a fizzing fuse.
    group: 'skill', target: -20, maxVoices: 3, minInterval: 0.08, pitchVar: 0.04, reverb: 0.2, priority: 1,
    build(v) {
      v.thump({ f: [190, 60, 0.18], gain: 0.85, d: 0.28, drive: 1.6 });
      v.noise({ color: 'brown', gain: 2, env: { a: 0.004, d: 0.3 }, filter: { type: 'lowpass', f: [2200, 260, 0.25], q: 0.8 } });
      v.tone({ wave: 'hollow', f: [300, 140, 0.15], gain: 0.16, env: { a: 0.003, d: 0.2 }, filter: { type: 'lowpass', f: 1400 } });
      v.crackle({ at: 0.04, dur: 0.4, gain: 0.18, hp: 2600 });
    },
  },
  castUmbral: {
    // hitVoid made into a cast: a heavy inward suck, then a low detuned hum as the bolt leaves.
    group: 'skill', target: -22, maxVoices: 3, minInterval: 0.08, pitchVar: 0.05, reverb: 0.25, priority: 1,
    build(v) {
      v.noise({ color: 'pink', gain: 1.6, env: { pts: [[0.09, 1], [0.16, 0]] }, filter: { type: 'bandpass', f: [2600, 420, 0.16], q: 1.6 } });
      v.thump({ at: 0.06, f: [v.rr(150, 175), 45, 0.12], gain: 0.6, d: 0.2 });
      v.tone({ at: 0.06, wave: 'hollow', f: [v.rr(220, 245), 150, 0.25], gain: 0.16, env: { a: 0.01, d: 0.3 }, filter: { type: 'lowpass', f: 1200 } });
      v.tone({ at: 0.06, type: 'sine', f: v.rr(110, 118), detune: 9, gain: 0.08, env: { a: 0.02, d: 0.35 }, wet: 0.4 });
    },
  },
  castKinetic: {
    // A dry, physical "thwip": an air crack and a short tight whoosh, no element colour.
    group: 'skill', target: -24, maxVoices: 4, minInterval: 0.045, pitchVar: 0.06, reverb: 0.08, priority: 1,
    build(v) {
      v.click({ gain: 0.55, f: 3200, d: 0.015 });
      v.noise({ color: 'pink', gain: 2.2, env: { pts: [[0.02, 1], [0.12, 0]] }, filter: { type: 'bandpass', f: [1200, 4200, 0.1], q: 2 } });
      v.thump({ f: [240, 110, 0.05], gain: 0.35, d: 0.07 });
    },
  },
  castOrb: {
    // castFrost slowed down: a glass swell gathering into the orb, a soft cold breath.
    group: 'skill', target: -22, maxVoices: 2, minInterval: 0.1, pitchVar: 0.04, reverb: 0.3, priority: 1,
    build(v) {
      const f = v.rr(1200, 1400);
      v.noise({ color: 'pink', gain: 1.2, env: { a: 0.08, d: 0.3 }, filter: { type: 'bandpass', f: [1800, 4200, 0.3], q: 1.6 } });
      v.bell({ at: 0.03, f, partials: P.glass, gain: 0.18, decay: 0.6, pan: v.rr(-0.15, 0.15), wet: 0.35 });
      v.bell({ at: 0.09, f: f * 1.335, partials: P.glass, gain: 0.1, decay: 0.5, wet: 0.35 });
      v.thump({ f: [280, 140, 0.05], gain: 0.15, d: 0.08 });
    },
  },
  castStormCall: {
    // The sky answering: a rising rumble and a crackle building toward the strikes.
    group: 'skill', target: -22, maxVoices: 2, minInterval: 0.15, pitchVar: 0.04, reverb: 0.35, priority: 1,
    build(v) {
      v.noise({ color: 'brown', gain: 1.6, env: { pts: [[0.25, 1], [0.6, 0]] }, filter: { type: 'lowpass', f: [180, 700, 0.5], q: 1 } });
      v.noise({ color: 'white', gain: 0.35, env: { a: 0.2, d: 0.35 }, filter: { type: 'highpass', f: 5500 }, am: { rate: 30, depth: 0.7, type: 'square' } });
      v.tone({ type: 'sine', f: [400, 900, 0.45], gain: 0.05, env: { a: 0.15, d: 0.4 }, wet: 0.5 });
    },
  },
  phaseStride: {
    // dash's swish, longer and rising: a whoosh of wind and a light arcane lift.
    group: 'skill', target: -22, maxVoices: 2, minInterval: 0.2, pitchVar: 0.04, reverb: 0.2, priority: 1,
    build(v) {
      v.noise({ color: 'pink', gain: 2.6, env: { pts: [[0.08, 1], [0.35, 0]] }, filter: { type: 'bandpass', f: { pts: [[0, 500], [0.12, 2800], [0.35, 1600]] }, q: 2 } });
      v.tone({ type: 'sine', f: [520, 1300, 0.25], gain: 0.07, env: { a: 0.02, d: 0.32 }, wet: 0.5, echo: 0.2 });
      v.bell({ at: 0.08, f: midi(81), partials: P.silver, gain: 0.05, decay: 0.5, wet: 0.4 });
    },
  },
  arcaneReprieve: {
    // flaskFocus's calm cousin: a breath in and a soft rising chime triad.
    group: 'skill', target: -21, maxVoices: 1, minInterval: 0.3, pitchVar: 0, reverb: 0.4, priority: 1, fixedPitch: true,
    build(v) {
      v.noise({ color: 'pink', gain: 1, env: { a: 0.15, d: 0.4 }, filter: { type: 'bandpass', f: [400, 1400, 0.4], q: 1.2 } });
      [69, 74, 78].forEach((n, k) => v.bell({ at: 0.06 + k * 0.1, f: midi(n), partials: P.chime, gain: 0.08 + k * 0.02, decay: 1, wet: 0.45, fixed: true }));
    },
  },
  glacialNovaBurst: {
    // wardenNova's player-sized sibling: a sub hit, a cold blast rushing outward, a short glass fifth.
    group: 'skill', target: -19, maxVoices: 2, minInterval: 0.15, pitchVar: 0.03, reverb: 0.3, priority: 1,
    build(v) {
      v.thump({ f: [150, 45, 0.25], gain: 0.85, d: 0.4, drive: 1.6 });
      v.click({ gain: 0.5, f: 3200, d: 0.02 });
      v.noise({
        color: 'pink', gain: 1.5, drive: 1.4, env: { pts: [[0.015, 1], [0.2, 0.45], [0.55, 0]] },
        filter: { type: 'bandpass', f: { pts: [[0, 4200], [0.25, 1600], [0.55, 600]] }, q: 1.2 },
      });
      v.bell({ at: 0.005, f: midi(74), partials: P.glass, gain: 0.15, decay: 0.8, wet: 0.35 });
      v.bell({ at: 0.005, f: midi(81), partials: P.glass, gain: 0.11, decay: 0.7, wet: 0.35, pan: 0.2 });
      v.crackle({ at: 0.02, dur: 0.5, gain: 0.2, hp: 3000 });
    },
  },
  mortarBlast: {
    // eruption-like but tighter: a saturated boom, a dirt-and-fire roar, crackle settling.
    group: 'combat', target: -20, maxVoices: 3, minInterval: 0.06, pitchVar: 0.06, reverb: 0.25, priority: 1, burst: 'loudest',
    build(v) {
      v.thump({ f: [120, 38, 0.3], gain: 1, d: 0.45, drive: 2 });
      v.noise({ color: 'brown', gain: 2.2, env: { a: 0.003, d: 0.45 }, filter: { type: 'lowpass', f: [3000, 240, 0.35], q: 0.8 } });
      v.noise({ color: 'white', gain: 0.8, env: { a: 0.001, d: 0.1 }, filter: { type: 'bandpass', f: [3500, 1200, 0.1], q: 0.8 } });
      v.crackle({ at: 0.03, dur: 0.5, gain: 0.22, hp: 2200 });
    },
  },
  stormCallStrike: {
    // A thunderbolt landing: a hard crack, a noise-thrashed zap and a short rolling thunder.
    group: 'combat', target: -21, maxVoices: 4, minInterval: 0.04, pitchVar: 0.08, reverb: 0.3, priority: 1, burst: 'loudest',
    build(v) {
      v.click({ gain: 0.9, f: 2200, d: 0.03 });
      v.tone({ type: 'sawtooth', f: v.rr(700, 900), noiseFm: 1800, gain: 0.25, drive: 1.4, env: { a: 0.001, d: 0.14 }, filter: { type: 'bandpass', f: 2400, q: 1 } });
      v.thump({ f: [140, 50, 0.15], gain: 0.7, d: 0.25, drive: 1.4 });
      v.noise({ at: 0.04, color: 'brown', gain: 1.4, env: { a: 0.02, d: 0.4 }, filter: { type: 'lowpass', f: [900, 200, 0.4] } });
    },
  },
  frostSpike: {
    // glacialSpikes, smaller: a crack in the floor and an icy shing (a row plays spike by spike).
    group: 'combat', target: -23, maxVoices: 4, minInterval: 0.03, pitchVar: 0.08, reverb: 0.2, priority: 1, burst: 'loudest',
    build(v) {
      v.thump({ f: [190, 60, 0.08], gain: 0.6, d: 0.14, drive: 1.4 });
      v.noise({ color: 'white', gain: 1.1, env: { a: 0.001, d: 0.06 }, filter: { type: 'bandpass', f: [1800, 5200, 0.05], q: 1.2 } });
      v.bell({ at: 0.01, f: v.rr(1400, 1700), partials: P.glass, gain: 0.1, decay: 0.3, wet: 0.25 });
    },
  },
};
