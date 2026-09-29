// Theme colour for the 'map' and 'boss' tracks. The tracks stay the same pieces (same key, tempo,
// form and intensity behaviour, so crossfades and calibration hold); a colour only adds a few
// signature layers on top and swaps the boss track's beat-4 accent:
//
//  - Ashen Forge (and the hideout / no theme): no colour. The tracks' anvils, horns and embers are
//    already the forge's voice.
//  - Rimed Ossuary: a whistling cold wind, a faint singing-glass ring, sparse echoing ice bells and
//    falling music-box figures, bone clacks on the ghost 16ths, a hollow crypt choir under each
//    phrase; the Hollow Warden's fight adds a frozen-lantern whine and swaps the anvil for ice.
//  - Iron Coliseum: the stands murmuring from the first bar (with the odd two-finger whistle), war
//    drums on the downbeats, chains rattling off the beat, the crowd clapping the backbeat once the
//    fight is on, crowd swells and a war horn opening each section; Varkus's fight puts the whole
//    arena on its feet: war drums between the kicks, a brighter, louder crowd clapping every
//    backbeat, whistles, "HEY!" chants, and a chain rattle in place of the anvil.
//
// Colours are chosen when a track instance starts (TrackIO.theme); a theme change mid-track
// crossfades to a fresh instance (MusicPlayer.setTheme).
import type { Theme } from '../../contracts/content';
import { midi, PARTIALS, type Vowel } from '../voice';
import { bed, bell, boneClack, chainRattle, chant, choir, crowd, crowdClap, drone, horn, warDrum, whistle, type TrackIO } from './instruments';

/** Where a step sits in its track's form. */
export interface StepInfo {
  /** 16th within the bar. */
  readonly s: number;
  readonly bar: number;
  /** Bar within the 4-bar phrase. */
  readonly pb: number;
  /** A map breakdown bar (the kit drops out). */
  readonly breakdown: boolean;
}

export interface Colour {
  /** Called for every step, after the track's own layers (including breakdown bars). */
  step(i: number, t: number, intensity: number, p: StepInfo): void;
  /** The boss track's beat-4 accent (the forge's anvil when there is no colour). */
  accent?(t: number, pb: number): void;
  /** Vowel for the boss track's choir stabs. */
  readonly vowel?: Vowel;
  stop(t: number): void;
}

/** The themes that colour the music; everything else plays the plain (forge) tracks. */
export type ColourKey = 'rimedOssuary' | 'ironColiseum' | null;

export function colourKey(theme: Theme | null | undefined): ColourKey {
  return theme === 'rimedOssuary' || theme === 'ironColiseum' ? theme : null;
}

/** High ice bells (D minor pentatonic) for the ossuary. */
const ICE_BELLS = [74, 77, 79, 81, 84, 86, 89] as const;

export function mapColour(io: TrackIO, t0: number, sd: number): Colour | null {
  const cio = io.colourIo ?? io;
  switch (colourKey(io.theme)) {
    case 'rimedOssuary': return ossuaryMap(cio, t0, sd);
    case 'ironColiseum': return coliseumMap(cio, t0, sd);
    default: return null;
  }
}

export function bossColour(io: TrackIO, t0: number, sd: number): Colour | null {
  const cio = io.colourIo ?? io;
  switch (colourKey(io.theme)) {
    case 'rimedOssuary': return ossuaryBoss(cio, t0, sd);
    case 'ironColiseum': return coliseumBoss(cio, sd);
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Rimed Ossuary
// ---------------------------------------------------------------------------

function ossuaryMap(io: TrackIO, t0: number, sd: number): Colour {
  const wind = bed(io, t0, { color: 'pink', gain: 0.03, attack: 5, filters: [{ type: 'bandpass', f: 1500, q: 4 }], lfo: { rate: 0.06, depth: 650 }, wet: 0.5, pan: -0.25 });
  const glass = drone(io, t0, { f: midi(86), type: 'sine', detune: [-8, 8], gain: 0.0035, attack: 8, lp: 5000, trem: { rate: 0.13, depth: 0.8 }, wet: 0.7, pan: 0.3 });
  let lastBell = -99;
  return {
    step(i, t, I, p) {
      const r = io.rand;
      // Icy bells: sparse and echoing, more of them while it is calm; now and then a falling
      // three-note music-box figure down the pentatonic.
      if (p.s % 4 === 0 && i - lastBell >= 6 && r.chance(0.16 * (1.2 - 0.5 * I))) {
        lastBell = i;
        const k = r.int(2, ICE_BELLS.length - 1);
        const pan = r.range(-0.6, 0.6);
        bell(io, t, midi(ICE_BELLS[k]), 0.04, 2.6, { partials: PARTIALS.glass, wet: 0.7, echo: 0.35, pan });
        if (r.chance(0.35)) {
          bell(io, t + sd * 2, midi(ICE_BELLS[k - 1]), 0.03, 2.2, { partials: PARTIALS.glass, wet: 0.7, echo: 0.35, pan: -pan });
          bell(io, t + sd * 4, midi(ICE_BELLS[k - 2]), 0.025, 2.2, { partials: PARTIALS.glass, wet: 0.7, echo: 0.35, pan });
        }
      }
      if (p.breakdown) {
        // Instead of silence: one glass tone hanging over the riser.
        if (p.s === 8) bell(io, t, midi(86), 0.035, 3, { partials: PARTIALS.glass, wet: 0.8, echo: 0.4 });
        return;
      }
      // Bone clacks on the ghost 16ths as the pressure rises (a skeleton's rattle under the kit).
      const ghost = p.s === 3 || p.s === 11 || (p.s === 7 && I > 0.6) || (p.s === 15 && I > 0.7);
      if (I > 0.3 && ghost && r.chance(0.45 + 0.45 * I)) boneClack(io, t, 0.028 + 0.022 * I, { pan: p.s === 7 ? 0.3 : -0.35 });
      // A hollow crypt choir (D–A on "u") under each phrase, between the string swells.
      if (i % 64 === 32) choir(io, t, [midi(50), midi(57)], 0.01 + 0.004 * I, { a: 2, h: 3, r: 3, vowel: 'u', wet: 0.7 });
    },
    stop(t) {
      wind.stop(t);
      glass.stop(t);
    },
  };
}

function ossuaryBoss(io: TrackIO, t0: number, sd: number): Colour {
  // The Hollow Warden's frozen lantern: a thin, beating semitone whine high above the fight.
  const lantern = drone(io, t0, { f: midi(86), wave: 'hollow', detune: [0, 100], gain: 0.0055, attack: 4, lp: 3500, trem: { rate: 0.21, depth: 0.7 }, wet: 0.7, pan: 0.2 });
  const wind = bed(io, t0, { color: 'pink', gain: 0.028, attack: 3, filters: [{ type: 'bandpass', f: 1900, q: 5 }], lfo: { rate: 0.09, depth: 800 }, wet: 0.5, pan: -0.3 });
  return {
    vowel: 'o',
    accent(t, pb) {
      bell(io, t, pb === 1 ? 1250 : 1180, 0.065, 1.6, { partials: PARTIALS.glass, pan: 0.35, wet: 0.45, echo: 0.2 });
    },
    step(i, t, I, p) {
      // Ice bells toll the phrase: D6 on bar 1, A5 on bar 3, with a grace note falling a fourth.
      if (p.s === 0 && (p.pb === 0 || p.pb === 2)) {
        const n = p.pb === 0 ? 86 : 81;
        bell(io, t, midi(n), 0.075, 3, { partials: PARTIALS.glass, wet: 0.6, echo: 0.3, pan: p.pb === 0 ? -0.3 : 0.3 });
        bell(io, t + sd * 3, midi(n - 5), 0.05, 2.4, { partials: PARTIALS.glass, wet: 0.6, echo: 0.3, pan: p.pb === 0 ? 0.3 : -0.3 });
      }
      if ((p.s === 3 || p.s === 11 || (p.s === 7 && I > 0.7)) && I > 0.3 && io.rand.chance(0.5 + 0.4 * I)) boneClack(io, t, 0.04, { pan: p.s === 7 ? 0.3 : -0.3 });
    },
    stop(t) {
      lantern.stop(t);
      wind.stop(t);
    },
  };
}

// ---------------------------------------------------------------------------
// Iron Coliseum
// ---------------------------------------------------------------------------

function coliseumMap(io: TrackIO, t0: number, sd: number): Colour {
  const bar = sd * 16;
  return {
    step(i, t, I, p) {
      const r = io.rand;
      // The stands murmur: overlapping two-bar crowd swells on alternating sides, fuller as the
      // fight heats up.
      if (p.s === 0 && p.bar % 2 === 0) {
        crowd(io, t, bar * 2.6, 0.026 + 0.002 * I, { vowel: p.bar % 4 === 0 ? 'o' : 'a', pan: p.bar % 4 === 0 ? -0.4 : 0.4, wet: 0.65 });
      }
      if (p.breakdown) {
        // The crowd rises with the riser into the next section.
        if (p.s === 0 && I > 0.25) crowd(io, t, bar, 0.012 + 0.01 * I, { vowel: 'o', pan: 0.1 });
        return;
      }
      // War drums: their own syncopated taiko figure ("DUM ... DUM-DUM" on 1, the "and" of 3 and
      // 4), not the kick's steps, so the arena reads through the kit; a pickup at full pressure.
      if (p.s === 0 && I <= 0.15) warDrum(io, t, 0.08, { f: 60, pan: -0.15 }); // the arena from the first bar
      if (I > 0.15 && (p.s === 0 || (p.s === 10 && I > 0.4) || (p.s === 12 && I > 0.6))) {
        warDrum(io, t, (p.s === 0 ? 0.14 : 0.11) + 0.05 * I, { f: p.s === 0 ? 60 : 66, pan: p.s === 0 ? -0.15 : 0.2 });
      }
      if (I > 0.7 && p.pb === 3 && (p.s === 13 || p.s === 14)) warDrum(io, t, 0.1, { f: 70, pan: 0.15 });
      // Chains rattling off the beat.
      if (I > 0.35 && (p.s === 6 || p.s === 14) && r.chance(0.2 + 0.3 * I)) {
        chainRattle(io, t, 0.015 + 0.01 * I, { pan: r.chance(0.5) ? -0.45 : 0.45, links: r.int(3, 5) });
      }
      // Someone in the stands whistles now and then; once the fight is on, the crowd claps the
      // backbeat along with the frame drums.
      if (p.s === 8 && r.chance(0.3 + 0.15 * I)) whistle(io, t, 0.016 + 0.008 * I, { pan: r.range(-0.7, 0.7) });
      if (I > 0.55 && (p.s === 4 || p.s === 12)) crowdClap(io, t, 0.14 + 0.1 * I, { pan: p.s === 4 ? -0.2 : 0.2 });
      // A crowd swell every 8 bars once the fight is on; a war horn opens each 16-bar section.
      if (p.bar % 8 === 4 && p.s === 0 && I > 0.45) crowd(io, t, 3, 0.01 + 0.012 * I, { vowel: 'a' });
      if (p.bar % 16 === 0 && p.s === 0) horn(io, t, [midi(38), midi(45)], 0.014 + 0.008 * I, { a: 0.35, h: 0.9, r: 1.2, wet: 0.5 });
    },
    stop() {
      // Only note voices: they end on their own (the track's crossfade has silenced them).
    },
  };
}

function coliseumBoss(io: TrackIO, sd: number): Colour {
  const bar = sd * 16;
  return {
    accent(t) {
      chainRattle(io, t, 0.045, { pan: 0.35, links: 4 });
    },
    step(i, t, I, p) {
      // War drums between the kicks (the kick owns 0, 3, 6, 8, 11, 14): "and-of-1" and "and-of-3".
      if (p.s === 2 || p.s === 10 || (p.s === 13 && I > 0.7)) warDrum(io, t, p.s === 2 ? 0.22 : 0.16, { f: p.s === 2 ? 60 : 66, pan: p.s === 10 ? 0.15 : -0.1 });
      // The whole arena is on its feet: overlapping crowd swells every two bars, a big roar every
      // eight, and "HEY!" chants on the backbeats of bars 2 and 4 when the fight heats up.
      if (p.s === 0 && p.bar % 2 === 0) crowd(io, t, bar * 2.6, 0.022 + 0.008 * I, { vowel: p.bar % 4 === 0 ? 'a' : 'e', q: 3, pan: p.bar % 4 === 0 ? 0.4 : -0.4, wet: 0.6 });
      if (i % 128 === 64) crowd(io, t, 3, 0.022, { vowel: 'a' });
      const hey = (p.pb === 1 || p.pb === 3) && (p.s === 4 || p.s === 12);
      if ((I > 0.55 && hey) || (I > 0.75 && p.s === 12)) chant(io, t, 0.03 + 0.012 * I, { pan: p.s === 4 ? -0.15 : 0.15 });
      // The stands clap every backbeat and whistle between the chants.
      if (I > 0.35 && (p.s === 4 || p.s === 12)) crowdClap(io, t, 0.22 + 0.14 * I, { pan: p.s === 4 ? -0.25 : 0.25 });
      if (p.s === 8 && I > 0.3 && io.rand.chance(0.35)) whistle(io, t, 0.018 + 0.006 * I, { pan: io.rand.range(-0.7, 0.7) });
    },
    stop() {
      // Only note voices: they end on their own (the track's crossfade has silenced them).
    },
  };
}
