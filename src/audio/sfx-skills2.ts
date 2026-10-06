// Sound recipes of the power rework's roster batch 2 (SK3): cast cues, the three self-buffs and the skills' big moments. Each is
// a variation of a calibrated recipe (named in its comment) with the same layer gains, so the trim it borrows in levels.ts keeps
// it on its target until the offline calibration is re-run.

import type { SfxDef } from './sfx';
import { midi, PARTIALS as P } from './voice';

export type Roster2SfxId =
  | 'castGravityWell' | 'wellCollapse' | 'castHex' | 'castWither' | 'castSigil' | 'sigilPillar' | 'barrierUp' | 'barrierBreak'
  | 'aegisUp' | 'voltaicPulse' | 'concussiveBlast' | 'castLash' | 'echoSigil';

export const ROSTER2_SFX: Record<Roster2SfxId, SfxDef> = {
  castGravityWell: {
    // castUmbral stretched: a long inward suck and a low hum that bends downward as the vortex opens.
    group: 'skill', target: -22, maxVoices: 2, minInterval: 0.15, pitchVar: 0.04, reverb: 0.3, priority: 1,
    build(v) {
      v.noise({ color: 'pink', gain: 1.6, env: { pts: [[0.2, 1], [0.45, 0]] }, filter: { type: 'bandpass', f: [3000, 300, 0.4], q: 1.6 } });
      v.thump({ at: 0.15, f: [120, 40, 0.25], gain: 0.6, d: 0.3 });
      v.tone({ at: 0.1, wave: 'hollow', f: [260, 110, 0.45], gain: 0.16, env: { a: 0.05, d: 0.5 }, filter: { type: 'lowpass', f: 1100 } });
      v.tone({ at: 0.1, type: 'sine', f: v.rr(70, 78), detune: 12, gain: 0.08, env: { a: 0.05, d: 0.6 }, wet: 0.4 });
    },
  },
  wellCollapse: {
    // mortarBlast's boom with a void suck before it: the Singularity folding in.
    group: 'combat', target: -20, maxVoices: 2, minInterval: 0.1, pitchVar: 0.05, reverb: 0.3, priority: 1, burst: 'loudest',
    build(v) {
      v.noise({ color: 'pink', gain: 1.4, env: { pts: [[0.12, 1], [0.16, 0]] }, filter: { type: 'bandpass', f: [600, 3200, 0.14], q: 1.4 } });
      v.thump({ at: 0.14, f: [110, 34, 0.3], gain: 1, d: 0.45, drive: 2 });
      v.noise({ at: 0.14, color: 'brown', gain: 2.2, env: { a: 0.003, d: 0.45 }, filter: { type: 'lowpass', f: [2400, 200, 0.35], q: 0.8 } });
    },
  },
  castHex: {
    // A whispered curse: a breathy rise and two dissonant low bells (castUmbral's palette, softer).
    group: 'skill', target: -22, maxVoices: 2, minInterval: 0.15, pitchVar: 0.03, reverb: 0.4, priority: 1,
    build(v) {
      v.noise({ color: 'pink', gain: 1.2, env: { a: 0.12, d: 0.35 }, filter: { type: 'bandpass', f: [700, 2200, 0.35], q: 2 } });
      v.bell({ at: 0.05, f: midi(50), partials: P.silver, gain: 0.12, decay: 0.9, wet: 0.5 });
      v.bell({ at: 0.09, f: midi(56), partials: P.silver, gain: 0.08, decay: 0.8, wet: 0.5, pan: -0.2 });
      v.tone({ type: 'sine', f: [180, 140, 0.4], detune: 18, gain: 0.07, env: { a: 0.05, d: 0.45 }, wet: 0.4 });
    },
  },
  castWither: {
    // castHex's rotten sibling: a wet, sinking hiss and a sour low drone.
    group: 'skill', target: -22, maxVoices: 2, minInterval: 0.15, pitchVar: 0.04, reverb: 0.3, priority: 1,
    build(v) {
      v.noise({ color: 'brown', gain: 1.6, env: { a: 0.05, d: 0.5 }, filter: { type: 'lowpass', f: [1800, 300, 0.5], q: 1.2 } });
      v.crackle({ at: 0.05, dur: 0.45, gain: 0.14, hp: 1800 });
      v.tone({ type: 'sawtooth', f: [110, 82, 0.5], detune: 22, gain: 0.06, env: { a: 0.06, d: 0.5 }, filter: { type: 'lowpass', f: 700 } });
    },
  },
  castSigil: {
    // castMortar's fuse without the launch: a searing brand hissing into stone.
    group: 'skill', target: -21, maxVoices: 2, minInterval: 0.1, pitchVar: 0.04, reverb: 0.2, priority: 1,
    build(v) {
      v.noise({ color: 'white', gain: 0.6, env: { a: 0.01, d: 0.35 }, filter: { type: 'bandpass', f: [5200, 2400, 0.3], q: 1.2 } });
      v.crackle({ at: 0.02, dur: 0.5, gain: 0.2, hp: 2600 });
      v.thump({ f: [220, 90, 0.08], gain: 0.4, d: 0.12 });
    },
  },
  sigilPillar: {
    // eruption's roar upward: a deep boom and a column of fire rushing up.
    group: 'combat', target: -19, maxVoices: 3, minInterval: 0.06, pitchVar: 0.05, reverb: 0.3, priority: 1, burst: 'loudest',
    build(v) {
      v.thump({ f: [130, 40, 0.3], gain: 1, d: 0.45, drive: 2 });
      v.noise({ color: 'brown', gain: 2, env: { a: 0.01, d: 0.7 }, filter: { type: 'lowpass', f: [400, 3200, 0.5], q: 0.8 } });
      v.noise({ color: 'pink', gain: 0.9, env: { a: 0.04, d: 0.6 }, filter: { type: 'bandpass', f: [800, 4200, 0.6], q: 1 } });
      v.crackle({ at: 0.05, dur: 0.7, gain: 0.22, hp: 2200 });
    },
  },
  barrierUp: {
    // castOrb's glass swell closing around you: frost forming and a bright fifth.
    group: 'skill', target: -21, maxVoices: 1, minInterval: 0.3, pitchVar: 0.02, reverb: 0.35, priority: 1,
    build(v) {
      v.noise({ color: 'pink', gain: 1.2, env: { a: 0.1, d: 0.35 }, filter: { type: 'bandpass', f: [1600, 4600, 0.35], q: 1.6 } });
      v.bell({ at: 0.06, f: midi(76), partials: P.glass, gain: 0.15, decay: 0.9, wet: 0.4 });
      v.bell({ at: 0.12, f: midi(83), partials: P.glass, gain: 0.1, decay: 0.8, wet: 0.4, pan: 0.2 });
    },
  },
  barrierBreak: {
    // frostSpike made bigger: ice shattering, glass shards scattering.
    group: 'player', target: -19, maxVoices: 2, minInterval: 0.2, pitchVar: 0.05, reverb: 0.3, priority: 2,
    build(v) {
      v.thump({ f: [200, 70, 0.1], gain: 0.7, d: 0.2, drive: 1.4 });
      v.noise({ color: 'white', gain: 1.3, env: { a: 0.001, d: 0.18 }, filter: { type: 'bandpass', f: [5200, 1800, 0.18], q: 1 } });
      [1500, 1900, 2400].forEach((f, k) => v.bell({ at: 0.01 + k * 0.03, f: v.rr(f * 0.95, f * 1.05), partials: P.glass, gain: 0.09, decay: 0.35, wet: 0.3 }));
    },
  },
  aegisUp: {
    // castSpark sustained: a charged hum settling around you with a crackling edge.
    group: 'skill', target: -22, maxVoices: 1, minInterval: 0.3, pitchVar: 0.03, reverb: 0.25, priority: 1,
    build(v) {
      v.tone({
        type: 'sawtooth', f: [180, 240, 0.2], noiseFm: 600, gain: 0.14, env: { a: 0.04, d: 0.45 },
        filter: [{ type: 'bandpass', f: 1800, q: 1.2 }, { type: 'lowpass', f: 6000, fixed: true }], am: { rate: 40, depth: 0.4, type: 'square' },
      });
      v.noise({ color: 'white', gain: 0.3, env: { a: 0.02, d: 0.3 }, filter: { type: 'highpass', f: 6000 }, am: { rate: 60, depth: 0.8, type: 'square' } });
      v.click({ gain: 0.4, f: 2600, d: 0.02 });
    },
  },
  voltaicPulse: {
    // glacialNovaBurst's shape in lightning: a sub hit and a crackling ring racing outward.
    group: 'skill', target: -19, maxVoices: 2, minInterval: 0.12, pitchVar: 0.04, reverb: 0.25, priority: 1,
    build(v) {
      v.thump({ f: [160, 50, 0.2], gain: 0.8, d: 0.3, drive: 1.6 });
      v.click({ gain: 0.6, f: 2800, d: 0.02 });
      v.tone({ type: 'sawtooth', f: [900, 400, 0.3], noiseFm: 1600, gain: 0.2, drive: 1.3, env: { a: 0.002, d: 0.3 }, filter: { type: 'bandpass', f: 2400, q: 1 } });
      v.noise({ color: 'white', gain: 0.4, env: { a: 0.001, d: 0.3 }, filter: { type: 'highpass', f: 5000 }, am: { rate: 45, depth: 0.8, type: 'square' } });
    },
  },
  concussiveBlast: {
    // castKinetic scaled up: an air-splitting crack and a heavy whump of force.
    group: 'skill', target: -20, maxVoices: 2, minInterval: 0.1, pitchVar: 0.05, reverb: 0.2, priority: 1,
    build(v) {
      v.click({ gain: 0.7, f: 2400, d: 0.02 });
      v.thump({ f: [160, 45, 0.18], gain: 1, d: 0.3, drive: 1.8 });
      v.noise({ color: 'pink', gain: 2.4, env: { pts: [[0.01, 1], [0.25, 0]] }, filter: { type: 'bandpass', f: [2600, 500, 0.2], q: 1.2 } });
    },
  },
  castLash: {
    // castSpark's tight zap, shorter (it repeats every 0.15 s while held).
    group: 'skill', target: -25, maxVoices: 3, minInterval: 0.08, pitchVar: 0.08, reverb: 0.1, priority: 1,
    build(v) {
      v.tone({
        type: 'sawtooth', f: v.rr(1100, 1400), noiseFm: 1400, gain: 0.2, env: { a: 0.001, h: 0.02, d: 0.07 },
        filter: [{ type: 'bandpass', f: 3000, q: 1.4 }, { type: 'lowpass', f: 8000, fixed: true }],
      });
      v.noise({ color: 'white', gain: 0.25, env: { a: 0.001, d: 0.05 }, filter: { type: 'highpass', f: 6500 } });
    },
  },
  echoSigil: {
    // arcaneReprieve's triad, echoed: one chime and its two softer repeats.
    group: 'skill', target: -21, maxVoices: 1, minInterval: 0.3, pitchVar: 0, reverb: 0.45, priority: 1, fixedPitch: true,
    build(v) {
      v.noise({ color: 'pink', gain: 0.8, env: { a: 0.1, d: 0.3 }, filter: { type: 'bandpass', f: [600, 1800, 0.3], q: 1.2 } });
      [0, 0.14, 0.28].forEach((at, k) => v.bell({ at, f: midi(79), partials: P.chime, gain: 0.12 - k * 0.035, decay: 0.8, wet: 0.5, fixed: true }));
    },
  },
};
