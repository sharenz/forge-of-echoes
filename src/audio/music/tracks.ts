// Generative music. Each track is a step sequencer driven by the lookahead scheduler: `step`
// is called ahead of time for every grid step with its exact audio-clock time and the current
// (smoothed) intensity, and decides — partly by chance — what to play. Sustained layers are
// created once in `create` and live for the whole track.
//
// Tonal centre is D throughout (so crossfades never clash): D minor / dorian in the calm
// tracks, D phrygian (flat 2nd) and tritones for tension and the boss.
import type { MusicId } from '../../contracts/audio';
import { midi } from '../voice';
import { bossColour, mapColour } from './colours';
import {
  anvil, bass, bed, bell, boom, choir, crash, drone, frame, kick, note, pad, pluck, riser, shaker, stab, strings, tom,
  type Sustained, type TrackIO,
} from './instruments';

export interface TrackState {
  step(i: number, t: number, intensity: number): void;
  stop(t: number): void;
}

export interface TrackDef {
  readonly id: MusicId;
  readonly bpm: number;
  readonly stepsPerBeat: number;
  /**
   * Track level offset (dB) by smoothed intensity. Tracks are calibrated at full pressure; this
   * keeps sparse low-intensity states from sagging under the SFX.
   */
  readonly levelDb?: (intensity: number) => number;
  /** The track takes a theme colour (TrackIO.theme); a theme change restarts it with a crossfade. */
  readonly themed?: boolean;
  create(io: TrackIO, t0: number): TrackState;
}

export function stepDuration(def: TrackDef): number {
  return 60 / def.bpm / def.stepsPerBeat;
}

const stopAll = (layers: Sustained[], t: number) => {
  for (const l of layers) l.stop(t);
};

// ---------------------------------------------------------------------------
// Title — slow, mysterious drones and distant bells
// ---------------------------------------------------------------------------

const title: TrackDef = {
  id: 'title', bpm: 56, stepsPerBeat: 2,
  create(io, t0) {
    const sd = stepDuration(title);
    const layers = [
      drone(io, t0, { f: midi(38), type: 'sawtooth', detune: [-6, 5], gain: 0.05, attack: 5, lp: 340, q: 1.2, lpLfo: { rate: 0.045, depth: 150 }, wet: 0.35 }),
      drone(io, t0, { f: midi(45), wave: 'hollow', gain: 0.028, attack: 8, lp: 800, trem: { rate: 0.07, depth: 0.7 }, wet: 0.5, pan: 0.25 }),
      drone(io, t0, { f: midi(38), type: 'sine', gain: 0.06, attack: 4, lp: 200 }),
      bed(io, t0, { color: 'pink', gain: 0.09, attack: 6, filters: [{ type: 'bandpass', f: 650, q: 1.3 }], lfo: { rate: 0.055, depth: 380 }, wet: 0.4, pan: -0.2 }),
    ];
    // Dm → Bb → Gm → A: a slow minor cadence that never quite resolves.
    const chords = [[50, 53, 57], [46, 53, 58], [43, 50, 55, 58], [45, 52, 57, 61]];
    const bells = [62, 65, 67, 69, 72, 74, 77];
    let lastBell = -99;
    return {
      step(i, t) {
        if (i % 32 === 0) choir(io, t, chords[(i / 32) % chords.length].map(midi), 0.018, { a: 5, h: 4, r: 6, vowel: 'o', wet: 0.7 });
        if (i - lastBell >= 5 && io.rand.chance(0.16)) {
          lastBell = i;
          const n = io.rand.pick(bells);
          const pan = io.rand.range(-0.5, 0.5);
          bell(io, t + io.rand.range(0, 0.15), midi(n), 0.08, 5.5, { wet: 0.75, echo: 0.3, pan });
          if (io.rand.chance(0.3)) bell(io, t + sd * 2, midi(n - 5), 0.055, 5, { wet: 0.75, echo: 0.3, pan: -pan });
        }
        if (io.rand.chance(0.025)) pluck(io, t, midi(io.rand.pick([86, 89, 93])), 0.025, { wet: 0.8, echo: 0.4, pan: io.rand.range(-0.6, 0.6), decay: 3 });
      },
      stop: (t) => stopAll(layers, t),
    };
  },
};

// ---------------------------------------------------------------------------
// Hideout — warm and calm: fire crackle, soft pads, sparse harp phrases
// ---------------------------------------------------------------------------

interface PhraseNote {
  step: number;
  note: number;
  g: number;
}

const hideout: TrackDef = {
  id: 'hideout', bpm: 64, stepsPerBeat: 2,
  create(io, t0) {
    const sd = stepDuration(hideout);
    const layers = [
      bed(io, t0, { color: 'crackle', gain: 0.1, attack: 3, filters: [{ type: 'highpass', f: 900 }, { type: 'lowpass', f: 7000 }], pan: 0.3 }),
      bed(io, t0, { color: 'brown', gain: 0.08, attack: 3, filters: [{ type: 'lowpass', f: 170 }], pan: 0.3 }),
      drone(io, t0, { f: midi(50), wave: 'warm', detune: [-4, 4], gain: 0.02, attack: 6, lp: 700, trem: { rate: 0.11, depth: 0.4 }, wet: 0.4 }),
    ];
    // D dorian: Dm9 → G(add9) → Fmaj7 → Csus2 — warm, unhurried.
    const prog = [
      { bass: 38, pad: [50, 53, 57, 60], pool: [62, 64, 65, 69, 72, 74, 76] },
      { bass: 43, pad: [55, 59, 62, 69], pool: [67, 69, 71, 74, 76, 79] },
      { bass: 41, pad: [53, 57, 60, 64], pool: [65, 69, 72, 76, 79, 81] },
      { bass: 36, pad: [48, 55, 62, 64], pool: [67, 72, 74, 76, 79] },
    ];
    let phrase: PhraseNote[] = [];
    const makePhrase = (start: number, pool: readonly number[]): PhraseNote[] => {
      const out: PhraseNote[] = [];
      const len = io.rand.int(3, 6);
      let idx = io.rand.int(0, pool.length - 1);
      let s = start + io.rand.int(0, 1);
      const dir = io.rand.chance(0.5) ? 1 : -1;
      for (let k = 0; k < len; k++) {
        out.push({ step: s, note: pool[idx], g: 0.085 - k * 0.008 });
        s += io.rand.chance(0.65) ? 1 : 2;
        idx = Math.min(pool.length - 1, Math.max(0, idx + dir * io.rand.int(1, 2) * (io.rand.chance(0.2) ? -1 : 1)));
      }
      return out;
    };
    return {
      step(i, t) {
        const chord = prog[Math.floor(i / 16) % prog.length];
        if (i % 16 === 0) {
          pad(io, t, chord.pad.map(midi), 0.02, { a: 2.2, h: 3.6, r: 3.5, lp: 950, wet: 0.5 });
          pluck(io, t, midi(chord.bass), 0.09, { bright: 0.3, wet: 0.2, decay: 3.2 });
        }
        if (i % 8 === 0 && io.rand.chance(0.7)) phrase = makePhrase(i, chord.pool);
        for (const p of phrase) {
          if (p.step !== i) continue;
          const swing = io.rand.range(0, 0.03);
          const pan = io.rand.range(-0.4, 0.4);
          pluck(io, t + swing, midi(p.note), p.g, { wet: 0.35, echo: 0.22, pan });
          if (io.rand.chance(0.15)) pluck(io, t + swing + sd * 0.5, midi(p.note + 12), p.g * 0.4, { wet: 0.45, echo: 0.3, pan: -pan });
        }
        // An occasional louder log pop from the fire.
        if (io.rand.chance(0.1)) {
          firePop(io, t + io.rand.range(0, sd), io.rand.range(0.25, 0.6));
        }
      },
      stop: (t) => stopAll(layers, t),
    };
  },
};

/** A louder log pop from the hideout fire (same side as the crackle bed). */
function firePop(io: TrackIO, t: number, g: number): void {
  note(io, t, (v) => {
    v.noise({ color: 'white', gain: g, env: { a: 0.0005, d: 0.02 }, filter: { type: 'bandpass', f: io.rand.range(1500, 3500), q: 1.2, fixed: true }, pan: 0.3 });
    v.thump({ f: [220, 120, 0.02], gain: g * 0.12, d: 0.03 });
  });
}

// ---------------------------------------------------------------------------
// Map — tense pulse; drum density follows intensity
// ---------------------------------------------------------------------------

/**
 * A map run lasts minutes, so the track moves through 8-bar sections (a 4-bar root progression
 * played twice), each with its own bass figure and arp shape. Every 16th bar is a breakdown.
 */
const MAP_SECTIONS: readonly { roots: readonly number[]; arp: readonly number[]; gallop: boolean }[] = [
  { roots: [38, 38, 39, 36], arp: [62, 65, 63, 62, 69, 67, 65, 63], gallop: false }, // D D E♭ C: the phrygian home
  { roots: [38, 41, 39, 36], arp: [69, 67, 65, 63, 62, 63, 65, 67], gallop: true }, // D F E♭ C: lifts, then sinks
  { roots: [38, 36, 34, 36], arp: [62, 69, 65, 70, 63, 69, 62, 67], gallop: false }, // D C B♭ C: darker descent
  { roots: [38, 39, 41, 39], arp: [74, 70, 69, 65, 63, 65, 69, 70], gallop: true }, // D E♭ F E♭: climbing unrest
];
/** Straight 8th-note pulse accents (by 8th) and the galloping figure's accents (by 16th). */
const PULSE_8 = [1, 0.55, 0.75, 0.55, 0.9, 0.55, 0.75, 0.6];
const GALLOP: ReadonlyMap<number, number> = new Map([[0, 1], [3, 0.6], [6, 0.8], [8, 0.9], [10, 0.55], [11, 0.6], [14, 0.75]]);

const map: TrackDef = {
  id: 'map', bpm: 100, stepsPerBeat: 4, themed: true,
  levelDb: (I) => 3 * Math.pow(1 - I, 1.4),
  create(io, t0) {
    const bar16 = stepDuration(map) * 16;
    const colour = mapColour(io, t0, stepDuration(map));
    const low = drone(io, t0, { f: midi(38), type: 'sawtooth', detune: [-5, 5], gain: 0.04, attack: 3, lp: 240, q: 1.4, lpLfo: { rate: 0.05, depth: 80 } });
    const sub = drone(io, t0, { f: midi(26), type: 'sine', gain: 0.07, attack: 3, lp: 120 });
    const air = bed(io, t0, { color: 'pink', gain: 0.035, attack: 4, filters: [{ type: 'bandpass', f: 520, q: 0.9 }], lfo: { rate: 0.03, depth: 260 }, wet: 0.5 });
    return {
      step(i, t, I) {
        const s = i % 16;
        const bar = Math.floor(i / 16);
        const sec = MAP_SECTIONS[Math.floor(bar / 8) % MAP_SECTIONS.length];
        const pb = bar % 4;
        const root = sec.roots[pb];
        const r = io.rand;
        if (s % 4 === 0) {
          low.pump(t, 0.35 + 0.25 * I, 0.34);
          sub.pump(t, 0.3 + 0.3 * I, 0.3);
        }
        colour?.step(i, t, I, { s, bar, pb, breakdown: bar % 16 === 15 });
        // Breakdown bar: the kit and pulse drop out, one long bass note, a riser into the section.
        if (bar % 16 === 15) {
          if (s === 0) {
            bass(io, t, midi(root), 0.07 * (0.75 + 0.35 * I), { dur: 0.9, cutoff: 200 + 500 * I });
            riser(io, t, bar16, 0.16 + 0.2 * I);
            if (I > 0.25) boom(io, t, 0.22 + 0.1 * I);
          }
          return;
        }
        // Tense bass pulse (always present; brighter and louder with intensity). Galloping
        // sections switch to a driving 3-3-2 figure once the pressure is up.
        const accent = sec.gallop && I > 0.35 ? GALLOP.get(s) : s % 2 === 0 ? PULSE_8[s / 2] : undefined;
        if (accent !== undefined) {
          const up = s === 14 && pb === 3 ? 12 : 0;
          bass(io, t, midi(root + up), 0.07 * accent * (0.75 + 0.35 * I), { dur: 0.17, cutoff: 240 + 900 * I });
        }
        // Drums: density grows with intensity.
        const k = s === 0 || (s === 8 && I > 0.15) || ((s === 6 || s === 11) && I > 0.5 && r.chance(I)) || (s === 14 && I > 0.75 && r.chance(0.6));
        if (k) kick(io, t, s === 0 ? 0.34 : 0.27);
        if ((s === 4 || s === 12) && I > 0.3 && r.chance(0.35 + I * 0.6)) tom(io, t, midi(s === 12 ? 42 : 45), 0.16);
        if ((s === 4 || s === 12) && I > 0.55) frame(io, t, 0.12 + 0.06 * I);
        // Time-keeping: a shaker on the 8ths (leaning on the offbeats), 16th rattles and muted
        // frame-drum ghosts as the pressure rises.
        if (I > 0.3) {
          if (s % 2 === 0) shaker(io, t, (s % 4 === 2 ? 0.05 : 0.034) * (0.5 + I), { pan: 0.25 });
          else if (r.chance(Math.min(0.8, Math.max(0, (I - 0.45) * 2)))) shaker(io, t, 0.022 * (0.5 + I), { pan: 0.32 });
        }
        if (I > 0.55 && (s === 7 || s === 10 || s === 15) && r.chance(0.3 + 0.5 * (I - 0.55))) frame(io, t, 0.07, { muted: true, pan: -0.22 });
        if (pb === 3 && s >= 12 && I > 0.6) tom(io, t, midi(50 - (s - 12) * 2), 0.15);
        if (i % 64 === 0 && I > 0.25) boom(io, t, 0.28 + 0.12 * I);
        if (bar % 16 === 0 && bar > 0 && s === 0 && I > 0.35) crash(io, t, 0.022 + 0.014 * I);
        // Tension: a high held note every phrase; a minor second rubs against it when it heats up.
        if (i % 64 === 0) {
          const n = r.pick([69, 70, 75]);
          const notes = I > 0.5 ? [midi(n), midi(n + 1)] : [midi(n)];
          strings(io, t, notes, 0.012 + 0.01 * I, { a: 1.6, h: 4.2, r: 2.6, wet: 0.5, lp: 1800 });
        }
        if (I < 0.5 && s % 4 === 2 && r.chance(0.03)) bell(io, t, midi(r.pick([62, 65, 69, 74])), 0.045, 4, { wet: 0.8, echo: 0.3, pan: r.range(-0.5, 0.5) });
        if (I > 0.7 && s % 2 === 0) {
          pluck(io, t, midi(sec.arp[(s / 2 + pb * 2) % sec.arp.length]), 0.03 * Math.min(1, (I - 0.6) * 2.5), { wet: 0.2, echo: 0.15, pan: 0.25, decay: 0.9 });
        }
      },
      stop: (t) => {
        stopAll([low, sub, air], t);
        colour?.stop(t);
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Boss — driving percussion and dissonant brass stabs
// ---------------------------------------------------------------------------

const boss: TrackDef = {
  id: 'boss', bpm: 132, stepsPerBeat: 4, themed: true,
  // The intensity layers add energy more than loudness: let the track also swell ~2 dB with it.
  levelDb: (I) => -1.5 * (1 - I),
  create(io, t0) {
    const sub = drone(io, t0, { f: midi(26), type: 'sawtooth', detune: [-7, 7], gain: 0.05, attack: 1.2, lp: 160, q: 1.2 });
    const roots = [38, 39, 38, 36]; // D E♭ D C
    // 16th ostinato offsets (semitones): octave jumps, a flat-2nd bite, a tritone at the turn.
    const pattern = [0, 0, 12, 0, 0, 1, 0, 12, 0, 0, 12, 0, 1, 0, 12, 6];
    const kicks = new Set([0, 3, 6, 8, 11, 14]);
    const colour = bossColour(io, t0, stepDuration(boss));
    return {
      step(i, t, I) {
        const s = i % 16;
        const pb = Math.floor(i / 16) % 4;
        const root = roots[pb];
        const r = io.rand;
        // Intensity layers: above 0.6 the toms go double-time, the brass climbs and the forge
        // answers on beat 4; above 0.75 choir stabs cut through.
        const hot = I > 0.6;
        const blaze = I > 0.75;
        if (s % 4 === 0) sub.pump(t, 0.55, 0.2);
        if (kicks.has(s) || (s === 10 && I > 0.5)) kick(io, t, s === 0 ? 0.4 : 0.3, { d: 0.3 });
        if (s === 4 || s === 12) frame(io, t, 0.19);
        if ((s === 7 || s === 15) && I > 0.5 && r.chance(0.5)) frame(io, t, 0.07, { muted: true, pan: -0.2 });
        const turn = s === 14 && pb === 3;
        if (s % 2 === 0 || I > 0.3) {
          shaker(io, t, s % 4 === 2 ? 0.05 : 0.032, { open: turn, jingle: turn ? 1 : hot && s % 4 === 2 ? 0.35 : 0, pan: 0.18 });
        }
        bass(io, t, midi(root + pattern[s]), 0.055 * (s % 4 === 0 ? 1 : 0.72), { dur: 0.1, cutoff: 480 + 900 * I, drive: 2 });
        // Brass: diminished stabs on bars 1 & 3 (on 1 and the "and" of 2, plus beat 3's "and"
        // when hot, voiced a tenth higher), and a swelling flat-9 cluster into the phrase turn.
        if ((pb === 0 || pb === 2) && (s === 0 || s === 6 || (hot && s === 10))) {
          const voicing = hot ? [root + 12, root + 15, root + 18, root + 24, root + 27] : [root + 12, root + 15, root + 18, root + 24];
          stab(io, t, voicing.map(midi), hot ? 0.03 : 0.035, { len: 0.16, bright: 0.55 + 0.45 * I });
        }
        if (pb === 3 && s === 0) stab(io, t, [root + 12, root + 18, root + 24, root + 25].map(midi), 0.03, { len: 1.1, bright: 0.85, swell: true, wet: 0.4 });
        if (pb === 3 && s >= 8 && (s % 2 === 0 || hot)) tom(io, t, midi(52 - (s - 8)), hot ? 0.15 : 0.17, { pan: (s - 11) * 0.1 });
        if (hot && pb === 1 && s >= 12) tom(io, t, midi(50 - (s - 12) * 2), 0.14, { pan: -0.2 + (s - 12) * 0.12 });
        if (hot && s === 12 && pb !== 3) {
          if (colour?.accent) colour.accent(t, pb);
          else anvil(io, t, pb === 1 ? 1250 : 1180, 0.05, { pan: 0.35 });
        }
        if (blaze && (pb === 1 || pb === 3) && s === 0) {
          choir(io, t, [root + 24, root + 27, root + 30].map(midi), 0.022, { a: 0.02, h: 0.18, r: 0.5, vowel: colour?.vowel ?? 'a', wet: 0.5 });
        }
        if (s === 0 && pb === 0) {
          boom(io, t, 0.34);
          crash(io, t, 0.035);
        }
        if (i % 128 === 0) choir(io, t, [50, 56, 62, 63].map(midi), 0.016, { a: 1.5, h: 4, r: 3, vowel: colour?.vowel ?? 'a', wet: 0.6 });
        colour?.step(i, t, I, { s, bar: Math.floor(i / 16), pb, breakdown: false });
      },
      stop: (t) => {
        sub.stop(t);
        colour?.stop(t);
      },
    };
  },
};

export const TRACKS: Record<MusicId, TrackDef> = { title, hideout, map, boss };
