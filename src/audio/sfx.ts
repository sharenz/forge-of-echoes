// Sound-effect recipes. Every SfxId is synthesised from scratch by a small layered patch.
//
// Design rules for this table:
//  - Frequent sounds (hits, deaths, basic casts, motes) are short, mid-focused and randomised in
//    pitch/timbre every play, with tight voice caps, so hundreds per minute stay pleasant.
//  - Rare sounds (rare/unique drops, boss, level up) are rich, wide and wet, and duck the music
//    and combat so the moment reads as an *event*.
//  - `target` is the intended perceived loudness (max 200 ms K-weighted, LUFS-like). The actual
//    voice gain comes from SFX_TRIM_DB (levels.ts), calibrated offline by the analysis tool.
//  - `impact` is where the main transient lands. Most sounds hit at 0; a few have a deliberate
//    anticipation (rare/unique drops, level up). The presenter reads it via sfxImpactDelay() to
//    fire flashes, hit-stop and slow-mo on the same frame the listener hears the hit.
//  - Frequent ids declare a `bank`: after unlock they are pre-rendered into a handful of
//    AudioBuffer variants and played as a single buffer source each (see bank.ts).
import type { SfxId } from '../contracts/audio';
import type { BurstPolicy } from './mixing';
import { ROSTER_SFX } from './sfx-skills';
import { ROSTER2_SFX } from './sfx-skills2';
import { ROSTER3_SFX } from './sfx-skills3';
import { midi, PARTIALS, type Partial as BellPartial, type VoiceBuilder } from './voice';

export type SfxGroup = 'skill' | 'combat' | 'monster' | 'boss' | 'player' | 'loot' | 'flow' | 'ui' | 'craft';

export interface SfxDef {
  readonly group: SfxGroup;
  /** Intended perceived loudness (dB, max short-term K-weighted). */
  readonly target: number;
  readonly maxVoices: number;
  readonly minInterval: number;
  /** ± fractional random pitch variation per play. */
  readonly pitchVar: number;
  /** Base reverb send for the whole voice. */
  readonly reverb: number;
  /** 0 = expendable spam, 1 = normal, 2 = must play. */
  readonly priority: 0 | 1 | 2;
  /** Duck the music / combat buses while this plays (dB). */
  readonly duck?: { readonly music?: number; readonly combat?: number; readonly hold: number; readonly release: number };
  /** Seconds from the voice start to its main transient (default 0). */
  readonly impact?: number;
  /**
   * Seconds the whole voice starts after the request (default 0). Debuffs arrive in the same frame
   * as the hit that applied them: the lag lets the hit's thump land first, so the two transients
   * never sum into the limiter, and the pair reads as cause → effect.
   */
  readonly lag?: number;
  /** Ignore the caller's pitch multiplier (musical ladders stay in tune). */
  readonly fixedPitch?: boolean;
  /**
   * A small impact that stacks by the dozen in the same frame: routed through the combat bus
   * compressor. Other combat-bus sounds (casts, slams, big deaths) bypass it.
   */
  readonly glue?: boolean;
  /** What happens to a request inside `minInterval` (default 'drop'; see mixing.ts). */
  readonly burst?: BurstPolicy;
  /** Repetition-energy time constant (s); longer = sustained repeats settle lower. */
  readonly energyTau?: number;
  /** Repeats closer than this count as a combo (`v.combo`); default 0.35 s. */
  readonly comboWindow?: number;
  /**
   * Pre-render this sound into `variants` buffers (per combo step when the recipe depends on
   * `v.combo`: `steps` distinct steps, `step(combo)` maps a combo onto one, and must satisfy
   * step(s) === s for s < steps so the bank can render step s with combo s).
   */
  readonly bank?: { readonly variants: number; readonly steps?: number; readonly step?: (combo: number) => number };
  build(v: VoiceBuilder): void;
}

/** Groups routed through the duckable combat bus. */
export const COMBAT_BUS_GROUPS: ReadonlySet<SfxGroup> = new Set(['skill', 'combat', 'monster']);
/** Groups that share density attenuation (many different hits at once get gently quieter). */
export const DENSITY_GROUPS: ReadonlySet<SfxGroup> = new Set(['combat', 'monster']);

const P = PARTIALS;

/** Dry bone knock: a free-bar pair (like a xylophone bar with no resonator) that dies at once. */
export const BONE: readonly BellPartial[] = [{ r: 1, g: 1, d: 1 }, { r: 2.76, g: 0.32, d: 0.3 }];
/** Iron chain link: a bright, sparse inharmonic pair with a quick decay. */
export const LINK: readonly BellPartial[] = [{ r: 1, g: 1, d: 1 }, { r: 1.73, g: 0.7, d: 0.6 }];
/** Tower-shield plate: dense low plate modes that clang, then choke. */
export const PLATE: readonly BellPartial[] = [
  { r: 1, g: 1, d: 1 }, { r: 1.59, g: 0.75, d: 0.75 }, { r: 2.14, g: 0.55, d: 0.6 }, { r: 2.3, g: 0.45, d: 0.55 }, { r: 2.95, g: 0.3, d: 0.4 },
];
/** Greatsword edge: long, thin high partials (the steel "shing"). */
export const BLADE: readonly BellPartial[] = [{ r: 1, g: 1, d: 1 }, { r: 2.41, g: 0.45, d: 0.7 }, { r: 3.87, g: 0.22, d: 0.5 }];

/**
 * Echo-mote ladder: D minor pentatonic from A4 over two octaves (in key with the D-centred music).
 * A stream climbs the ladder, then ping-pongs through the top octave instead of sticking on one
 * note, so hundreds of motes read as a wind-chime arpeggio rather than one repeated ping.
 */
export const MOTE_LADDER = [69, 72, 74, 77, 79, 81, 84, 86, 89, 91] as const;
export function moteStep(combo: number): number {
  if (combo < MOTE_LADDER.length) return Math.max(0, combo);
  return 5 + Math.abs(4 - ((combo - 9) % 8));
}

/** Coin cascades (currency drops / pickups) climb a short major-pentatonic run. */
const COIN_LADDER = [0, 2, 4, 7, 9, 12] as const;
export function coinStep(combo: number): number {
  if (combo < COIN_LADDER.length) return Math.max(0, combo);
  return 3 + ((combo - COIN_LADDER.length) % 3);
}
const coinRatio = (combo: number): number => Math.pow(2, COIN_LADDER[coinStep(combo)] / 12);

/** Seconds from play() to a sound's main transient (0 for most sounds): its lag plus its impact. */
export function sfxImpactDelay(id: SfxId): number {
  const d = SFX[id];
  return d ? (d.lag ?? 0) + (d.impact ?? 0) : 0;
}

/** Start lag of the ailment cues (see SfxDef.lag): 30 ms clears the hurt thump's attack. */
export const DEBUFF_LAG = 0.03;

/**
 * Revolution periods of the two spins. chainWhirl / varkusWhirl each play 6 revolutions (1.44 s /
 * 1.68 s) plus a wind-down turn; a spin that lasts longer replays the sound every 6 revolutions.
 */
export const CHAIN_REV = 0.24;
export const VARKUS_REV = 0.28;

export const SFX: Record<SfxId, SfxDef> = {
  // ---------------------------------------------------------------------------
  // Skills
  // ---------------------------------------------------------------------------
  castEmber: {
    group: 'skill', target: -24, maxVoices: 4, minInterval: 0.045, pitchVar: 0.06, reverb: 0.12, priority: 1, bank: { variants: 6 },
    build(v) {
      // Airy launch whoosh, a soft falling "fwip" for weight, and a trail of ember crackle.
      v.noise({ color: 'pink', gain: 2.2, env: { a: 0.006, d: 0.17 }, filter: { type: 'bandpass', f: [v.rr(800, 1000), 2800, 0.12], q: 1.3 } });
      v.tone({ type: 'triangle', f: [v.rr(480, 560), 170, 0.1], gain: 0.22, env: { a: 0.003, d: 0.11 }, filter: { type: 'lowpass', f: 1600 } });
      v.crackle({ at: 0.015, dur: 0.2, gain: 0.16, hp: 2600 });
    },
  },
  castNova: {
    group: 'skill', target: -18, maxVoices: 3, minInterval: 0.08, pitchVar: 0.04, reverb: 0.28, priority: 1,
    build(v) {
      // Bassy burst: saturated sub punch, a collapsing low roar, a bright flash edge, crackle.
      v.thump({ f: [150, 42, 0.3], gain: 0.9, d: 0.42, drive: 1.6 });
      v.noise({ color: 'brown', gain: 2.4, env: { a: 0.004, d: 0.5 }, filter: { type: 'lowpass', f: [2600, 220, 0.4], q: 0.8 } });
      v.noise({ color: 'white', gain: 0.9, env: { a: 0.002, d: 0.14 }, filter: { type: 'bandpass', f: [3200, 1100, 0.12], q: 0.8 } });
      v.tone({ type: 'sawtooth', f: [110, 52, 0.32], gain: 0.2, env: { a: 0.006, d: 0.38 }, filter: { type: 'lowpass', f: [900, 150, 0.3] } });
      v.crackle({ at: 0.03, dur: 0.55, gain: 0.2, hp: 2200 });
    },
  },
  castWave: {
    group: 'skill', target: -19, maxVoices: 3, minInterval: 0.1, pitchVar: 0.05, reverb: 0.25, priority: 1,
    build(v) {
      // Roaring whoosh: gritty noise through a sweeping resonant band over a low rumble.
      v.noise({
        color: 'pink', gain: 2.2, drive: 4, env: { pts: [[0.07, 1], [0.28, 0.75], [0.72, 0]] },
        filter: { type: 'bandpass', f: { pts: [[0, 320], [0.16, 1500], [0.72, 420]] }, q: 1.3 },
      });
      v.noise({ color: 'brown', gain: 1.8, env: { a: 0.05, d: 0.65 }, filter: { type: 'lowpass', f: [650, 170, 0.6] } });
      v.tone({ type: 'sawtooth', f: [82, 58, 0.6], gain: 0.1, env: { a: 0.06, d: 0.55 }, filter: { type: 'lowpass', f: 380 }, noiseFm: 6 });
      v.crackle({ at: 0.05, dur: 0.65, gain: 0.2, hp: 1900 });
    },
  },
  castFrost: {
    group: 'skill', target: -24, maxVoices: 4, minInterval: 0.045, pitchVar: 0.05, reverb: 0.2, priority: 1, bank: { variants: 6 },
    build(v) {
      // Glassy: a crisp tick, two inharmonic glass partial sets a fifth apart, icy air.
      const f = v.rr(1750, 2100);
      v.click({ gain: 0.35, f: 5000, d: 0.02 });
      v.bell({ at: 0.004, f, partials: P.glass, gain: 0.2, decay: 0.3, pan: v.rr(-0.15, 0.15) });
      v.bell({ at: 0.03, f: f * 1.498, partials: P.glass, gain: 0.09, decay: 0.2 });
      v.noise({ color: 'pink', gain: 1.4, env: { a: 0.012, d: 0.13 }, filter: { type: 'bandpass', f: [4800, 2400, 0.12], q: 1.8 } });
      v.thump({ f: [300, 150, 0.04], gain: 0.12, d: 0.06 });
    },
  },
  castArc: {
    group: 'skill', target: -20, maxVoices: 3, minInterval: 0.06, pitchVar: 0.05, reverb: 0.2, priority: 1,
    build(v) {
      // Electric zap: the crack, a sawtooth thrashed by audio-rate noise and gated at 45 Hz
      // (buzz, not hiss), a falling sub zap and a high sizzle.
      v.click({ gain: 0.85, f: 1800, d: 0.03 });
      v.tone({
        type: 'sawtooth', f: v.rr(820, 980), noiseFm: 1300, gain: 0.3, env: { a: 0.002, h: 0.05, d: 0.2 },
        filter: [{ type: 'bandpass', f: [2800, 1500, 0.22], q: 1.4 }, { type: 'lowpass', f: 7000, fixed: true }],
        am: { rate: 45, depth: 0.5, type: 'square' },
      });
      v.tone({ type: 'square', f: [230, 90, 0.16], gain: 0.1, env: { a: 0.002, d: 0.16 }, filter: { type: 'lowpass', f: 1000 } });
      v.noise({ color: 'white', gain: 0.35, env: { a: 0.001, d: 0.09 }, filter: { type: 'highpass', f: 6000 }, am: { rate: 60, depth: 0.8, type: 'square' } });
    },
  },
  dash: {
    group: 'skill', target: -21, maxVoices: 2, minInterval: 0.08, pitchVar: 0.06, reverb: 0.15, priority: 1,
    build(v) {
      // Air swish with a faint arcane glint for the blink.
      v.noise({ color: 'pink', gain: 2.8, env: { pts: [[0.05, 1], [0.22, 0]] }, filter: { type: 'bandpass', f: { pts: [[0, 650], [0.07, 3200], [0.22, 1300]] }, q: 2.2 } });
      v.noise({ color: 'white', gain: 0.35, env: { a: 0.02, d: 0.15 }, filter: { type: 'highpass', f: 6500 } });
      v.tone({ type: 'sine', f: [620, 1500, 0.16], gain: 0.07, env: { a: 0.012, d: 0.24 }, wet: 0.5, echo: 0.2 });
    },
  },
  ward: {
    group: 'skill', target: -19, maxVoices: 2, minInterval: 0.2, pitchVar: 0.02, reverb: 0.3, priority: 1,
    build(v) {
      // Warm hum shield: a rising breath, a trembling A-E-A saw chord opening up, soft chimes.
      v.noise({ color: 'pink', gain: 1.2, env: { a: 0.14, d: 0.45 }, filter: { type: 'bandpass', f: [240, 950, 0.3], q: 1.4 } });
      for (const [f, g] of [[110, 1], [164.8, 0.55], [220, 0.4]] as const) {
        v.tone({
          type: 'sawtooth', f, detune: v.rr(-7, 7), gain: 0.1 * g, env: { pad: true, a: 0.12, h: 0.45, r: 0.65 },
          filter: { type: 'lowpass', f: [380, 1100, 0.35], q: 2 }, am: { rate: 6.5, depth: 0.35 },
        });
      }
      v.bell({ at: 0.06, f: 880, partials: P.silver, gain: 0.07, decay: 1.4, wet: 0.5 });
      v.bell({ at: 0.14, f: 1318.5, partials: P.silver, gain: 0.05, decay: 1.2, wet: 0.5 });
      v.thump({ f: [120, 70, 0.12], gain: 0.35, d: 0.25 });
    },
  },
  notEnoughFocus: {
    group: 'player', target: -25, maxVoices: 1, minInterval: 0.25, pitchVar: 0, reverb: 0.1, priority: 1,
    build(v) {
      // A spell fizzling out: falling hollow tone and a dry puff. Informative, never shrill.
      v.tone({ wave: 'hollow', f: [392, 262, 0.18], gain: 0.22, env: { a: 0.004, h: 0.04, d: 0.2 }, filter: { type: 'lowpass', f: 1100 } });
      v.noise({ color: 'pink', gain: 1.0, env: { a: 0.01, d: 0.16 }, filter: { type: 'bandpass', f: [1600, 700, 0.16], q: 1.2 } });
    },
  },

  // ---------------------------------------------------------------------------
  // Impacts (the most frequent sounds in the game)
  // ---------------------------------------------------------------------------
  hitPhysical: {
    group: 'combat', target: -24, maxVoices: 5, minInterval: 0.03, pitchVar: 0.08, reverb: 0.05, priority: 0, burst: 'loudest', glue: true, bank: { variants: 8 },
    build(v) {
      v.thump({ f: [v.rr(170, 210), 68, 0.07], gain: 0.7, d: 0.11 });
      v.noise({ color: 'pink', gain: 1.6, env: { a: 0.001, d: 0.06 }, filter: { type: 'lowpass', f: 2400 } });
      v.click({ gain: 0.32, f: 2800 });
    },
  },
  hitFire: {
    group: 'combat', target: -24, maxVoices: 5, minInterval: 0.03, pitchVar: 0.08, reverb: 0.06, priority: 0, burst: 'loudest', glue: true, bank: { variants: 8 },
    build(v) {
      v.thump({ f: [v.rr(220, 260), 90, 0.06], gain: 0.45, d: 0.1 });
      v.noise({ color: 'pink', gain: 1.8, env: { a: 0.002, d: 0.1 }, filter: { type: 'bandpass', f: [1900, 650, 0.09], q: 0.9 } });
      v.crackle({ at: 0.008, dur: 0.13, gain: 0.2, hp: 2600 });
    },
  },
  hitCold: {
    group: 'combat', target: -24, maxVoices: 5, minInterval: 0.03, pitchVar: 0.07, reverb: 0.08, priority: 0, burst: 'loudest', glue: true, bank: { variants: 8 },
    build(v) {
      v.click({ gain: 0.42, f: 3500, d: 0.03 });
      v.bell({ f: v.rr(2300, 2900), partials: P.glass, gain: 0.12, decay: 0.14, pan: v.rr(-0.1, 0.1) });
      v.thump({ f: [260, 120, 0.04], gain: 0.3, d: 0.06 });
      v.noise({ color: 'pink', gain: 1.1, env: { a: 0.002, d: 0.06 }, filter: { type: 'bandpass', f: 1900, q: 2.5 } });
    },
  },
  hitLightning: {
    group: 'combat', target: -24, maxVoices: 5, minInterval: 0.03, pitchVar: 0.08, reverb: 0.06, priority: 0, burst: 'loudest', glue: true, bank: { variants: 8 },
    build(v) {
      // A crack, a noise-thrashed buzz (lightly saturated: it keeps the bite but not the spikes)
      // and a small thump.
      v.click({ gain: 0.45, f: 2000, d: 0.025 });
      v.tone({ type: 'sawtooth', f: v.rr(1100, 1300), noiseFm: 1600, gain: 0.2, drive: 1.4, env: { a: 0.002, d: 0.08 }, filter: { type: 'bandpass', f: 2600, q: 1.2 } });
      v.thump({ f: [210, 90, 0.04], gain: 0.28, d: 0.055 });
    },
  },
  hitVoid: {
    group: 'combat', target: -24, maxVoices: 5, minInterval: 0.03, pitchVar: 0.08, reverb: 0.1, priority: 0, burst: 'loudest', glue: true, bank: { variants: 8 },
    build(v) {
      // A hollow, inward "thoom": low sine dropping away, a reversed-feeling noise suck and a detuned hum.
      v.thump({ f: [v.rr(190, 230), 55, 0.08], gain: 0.55, d: 0.12 });
      v.noise({ color: 'pink', gain: 1.3, env: { pts: [[0.05, 1], [0.1, 0]] }, filter: { type: 'bandpass', f: [2400, 500, 0.1], q: 1.6 } });
      v.tone({ wave: 'hollow', f: [v.rr(330, 370), 180, 0.12], gain: 0.16, env: { a: 0.004, d: 0.14 }, filter: { type: 'lowpass', f: 1500 } });
    },
  },
  crit: {
    group: 'combat', target: -20, maxVoices: 3, minInterval: 0.06, pitchVar: 0.05, reverb: 0.18, priority: 1, burst: 'loudest', glue: true, bank: { variants: 6 },
    build(v) {
      // Punchy saturated low hit + a metallic FM "shing" that rings a moment.
      v.thump({ f: [150, 45, 0.12], gain: 0.9, d: 0.22, drive: 2.5 });
      v.click({ gain: 0.7, f: 2500, d: 0.02 });
      v.tone({ type: 'sine', f: v.rr(1650, 1850), fm: { ratio: 1.41, index: [3.5, 0.2, 0.25] }, gain: 0.16, env: { a: 0.002, d: 0.38 }, wet: 0.3 });
    },
  },
  evade: {
    group: 'combat', target: -27, maxVoices: 2, minInterval: 0.06, pitchVar: 0.1, reverb: 0.05, priority: 0, burst: 'loudest', glue: true, bank: { variants: 6 },
    build(v) {
      v.noise({ color: 'pink', gain: 2.2, env: { pts: [[0.03, 1], [0.12, 0]] }, filter: { type: 'bandpass', f: [1300, 3800, 0.11], q: 2.6 } });
    },
  },

  // ---------------------------------------------------------------------------
  // Monsters
  // ---------------------------------------------------------------------------
  monsterDeath: {
    group: 'combat', target: -24, maxVoices: 6, minInterval: 0.03, pitchVar: 0.1, reverb: 0.1, priority: 0, burst: 'loudest', glue: true, bank: { variants: 8 },
    build(v) {
      // Crumbling to ash: a soft thud, a closing crumble, sizzle and a faint last breath.
      v.thump({ f: [v.rr(130, 170), 52, 0.06], gain: 0.5, d: 0.09 });
      v.noise({ color: 'pink', gain: 2.0, env: { a: 0.004, d: 0.24 }, filter: { type: 'lowpass', f: [1700, 280, 0.22], q: 0.9 } });
      v.crackle({ at: 0.02, dur: 0.28, gain: 0.2, hp: 1800 });
      v.tone({ type: 'sawtooth', f: [v.rr(160, 200), 85, 0.18], gain: 0.05, env: { a: 0.01, d: 0.18 }, filter: { type: 'lowpass', f: 650 }, noiseFm: 12 });
    },
  },
  monsterDeathBig: {
    group: 'combat', target: -19, maxVoices: 3, minInterval: 0.08, pitchVar: 0.06, reverb: 0.25, priority: 1, burst: 'loudest',
    build(v) {
      v.thump({ f: [100, 32, 0.35], gain: 0.95, d: 0.5, drive: 2 });
      v.click({ gain: 0.45, f: 1500, d: 0.03 });
      v.noise({ color: 'brown', gain: 2.4, env: { a: 0.005, d: 0.75 }, filter: { type: 'lowpass', f: [1300, 150, 0.65] } });
      v.crackle({ at: 0.04, dur: 0.9, gain: 0.24, hp: 1500 });
      v.tone({ type: 'sawtooth', f: [110, 38, 0.6], gain: 0.16, env: { a: 0.02, d: 0.6 }, filter: { type: 'lowpass', f: [800, 200, 0.5], q: 3 }, noiseFm: 18 });
    },
  },
  monsterAttack: {
    group: 'monster', target: -26, maxVoices: 4, minInterval: 0.05, pitchVar: 0.1, reverb: 0.06, priority: 0, burst: 'loudest', glue: true, bank: { variants: 6 },
    build(v) {
      // Snapping bite: a short rising swipe and a raspy snarl.
      v.noise({ color: 'pink', gain: 2.0, env: { a: 0.004, d: 0.08 }, filter: { type: 'bandpass', f: [700, 1500, 0.06], q: 1.6 } });
      v.tone({ type: 'sawtooth', f: [v.rr(220, 260), 140, 0.07], gain: 0.14, env: { a: 0.003, d: 0.08 }, filter: { type: 'lowpass', f: 950 }, noiseFm: 30 });
    },
  },
  monsterSpit: {
    group: 'monster', target: -24, maxVoices: 3, minInterval: 0.06, pitchVar: 0.1, reverb: 0.1, priority: 0, burst: 'loudest', glue: true, bank: { variants: 6 },
    build(v) {
      // Wet "ptoo": a falling blob, a resonant splat and a hiss of cinders.
      v.tone({ type: 'sine', f: [520, 170, 0.08], gain: 0.4, env: { a: 0.003, d: 0.11 } });
      v.noise({ color: 'white', gain: 1.0, env: { a: 0.002, d: 0.08 }, filter: { type: 'bandpass', f: [1250, 2300, 0.07], q: 3.5 } });
      v.crackle({ at: 0.03, dur: 0.18, gain: 0.16, hp: 2100 });
    },
  },
  monsterLeap: {
    group: 'monster', target: -22, maxVoices: 3, minInterval: 0.1, pitchVar: 0.08, reverb: 0.12, priority: 1, burst: 'loudest',
    build(v) {
      // Rising whoosh + snarl: the telegraph you learn to dodge.
      v.noise({ color: 'pink', gain: 2.4, env: { pts: [[0.18, 1], [0.3, 0]] }, filter: { type: 'bandpass', f: [350, 1800, 0.28], q: 1.8 } });
      v.tone({ type: 'sawtooth', f: [130, 210, 0.2], gain: 0.14, env: { a: 0.05, d: 0.22 }, filter: { type: 'lowpass', f: 700, q: 3 }, noiseFm: 25 });
    },
  },
  monsterSlam: {
    group: 'monster', target: -19, maxVoices: 3, minInterval: 0.1, pitchVar: 0.06, reverb: 0.2, priority: 1, burst: 'loudest',
    build(v) {
      v.thump({ f: [95, 30, 0.3], gain: 0.9, d: 0.5, drive: 1.8 });
      v.noise({ color: 'brown', gain: 2.2, env: { a: 0.003, d: 0.55 }, filter: { type: 'lowpass', f: [950, 120, 0.4] } });
      v.noise({ color: 'pink', gain: 1.0, env: { a: 0.001, d: 0.05 }, filter: { type: 'lowpass', f: 3200 } });
      v.crackle({ at: 0.03, dur: 0.5, gain: 0.22, hp: 700, lp: 4000 });
    },
  },
  heraldCall: {
    group: 'boss', target: -16, maxVoices: 1, minInterval: 0.8, pitchVar: 0.02, reverb: 0.35, priority: 2,
    duck: { music: 3, hold: 1.2, release: 1 },
    build(v) {
      // Ominous war horn on D2 (octave + fifth), opening filter, vibrato, a drum under it.
      const horn = v.bus({
        filter: [{ type: 'lowpass', f: { pts: [[0, 280], [0.35, 1500], [1.5, 480]] }, q: 1.4 }, { type: 'peaking', f: 520, q: 1.6, gain: 6, fixed: true }],
        drive: 1.8, wet: 0.45,
      });
      const root = midi(38);
      for (const [r, g, dt] of [[1, 1, -7], [1, 0.8, 6], [1.5, 0.5, 3], [2, 0.35, -3]] as const) {
        v.tone({ type: 'sawtooth', f: root * r, detune: dt, gain: 0.22 * g, env: { pad: true, a: 0.28, h: 0.75, r: 0.65 }, vib: { rate: 5, cents: 14, delay: 0.35 }, to: horn });
      }
      v.drum({ f: [85, 40, 0.3], gain: 0.7, d: 0.7, slap: 0.8, slapF: 500 });
      v.noise({ color: 'brown', gain: 1.0, env: { pad: true, a: 0.3, h: 0.6, r: 0.8 }, filter: { type: 'lowpass', f: 320 } });
    },
  },
  bossRoar: {
    group: 'boss', target: -13, maxVoices: 1, minInterval: 1, pitchVar: 0.03, reverb: 0.4, priority: 2,
    duck: { music: 4, hold: 1.2, release: 1 },
    build(v) {
      // Two raspy saws through a shifting vowel-ish throat, saturated, over a sub drop.
      const throat = v.bus({
        filter: [{ type: 'lowpass', f: { pts: [[0, 500], [0.25, 2600], [1.7, 650]] }, q: 1 }, { type: 'peaking', f: [720, 430, 1.6], q: 2.5, gain: 9 }],
        drive: 3, wet: 0.45,
      });
      const env = { pad: true, a: 0.14, h: 0.95, r: 0.75 } as const;
      v.tone({ type: 'sawtooth', f: { pts: [[0, 68], [0.3, 82], [1.7, 50]] }, noiseFm: 16, gain: 0.3, env, vib: { rate: 7, cents: 28 }, to: throat });
      v.tone({ type: 'sawtooth', f: { pts: [[0, 103], [0.3, 124], [1.7, 76]] }, noiseFm: 24, gain: 0.22, env, vib: { rate: 6.3, cents: 22 }, to: throat });
      v.noise({ color: 'pink', gain: 1.4, env, filter: { type: 'bandpass', f: [1300, 700, 1.7], q: 1 }, to: throat });
      v.thump({ f: [62, 28, 0.9], gain: 0.8, d: 1.3 });
    },
  },
  bossSlam: {
    group: 'boss', target: -14, maxVoices: 2, minInterval: 0.25, pitchVar: 0.04, reverb: 0.35, priority: 2,
    build(v) {
      v.thump({ f: [82, 24, 0.6], gain: 1.0, d: 0.95, drive: 2.5 });
      v.click({ gain: 0.9, f: 1200, d: 0.04 });
      v.noise({ color: 'brown', gain: 2.6, env: { a: 0.002, d: 1.2 }, filter: { type: 'lowpass', f: [1500, 100, 1] } });
      v.crackle({ at: 0.05, dur: 1.1, gain: 0.3, hp: 600, lp: 5000 });
      v.bell({ f: 180, partials: P.anvil, gain: 0.06, decay: 0.9 });
    },
  },
  eruption: {
    group: 'monster', target: -18, maxVoices: 3, minInterval: 0.15, pitchVar: 0.06, reverb: 0.3, priority: 1, burst: 'loudest',
    build(v) {
      // Fires when the telegraph resolves, so the boom is on the first sample: ground crack and
      // boom, a fire whoosh blooming out of it, then a settling rumble under a long crackle.
      v.thump({ f: [80, 30, 0.4], gain: 0.9, d: 0.65, drive: 2 });
      v.click({ gain: 0.45, f: 900, d: 0.04 });
      v.noise({ color: 'brown', gain: 2.2, env: { pts: [[0.03, 1], [0.35, 0.6], [1.1, 0]] }, filter: { type: 'lowpass', f: [900, 200, 0.8] } });
      v.noise({ at: 0.01, color: 'pink', gain: 2.0, drive: 3, env: { a: 0.025, d: 0.65 }, filter: { type: 'bandpass', f: [520, 2200, 0.25], q: 1.1 } });
      v.crackle({ at: 0.02, dur: 1.0, gain: 0.3, hp: 1500 });
    },
  },

  // ---------------------------------------------------------------------------
  // Player
  // ---------------------------------------------------------------------------
  playerHurt: {
    group: 'player', target: -18, maxVoices: 2, minInterval: 0.12, pitchVar: 0.06, reverb: 0.1, priority: 2,
    build(v) {
      v.thump({ f: [165, 70, 0.1], gain: 0.9, d: 0.17, drive: 1.6 });
      v.noise({ color: 'pink', gain: 1.4, env: { a: 0.001, d: 0.09 }, filter: { type: 'lowpass', f: 1800 } });
      v.tone({ type: 'sawtooth', f: [230, 150, 0.12], gain: 0.1, env: { a: 0.005, d: 0.14 }, filter: { type: 'lowpass', f: 850, q: 4 }, noiseFm: 10 });
      v.tone({ type: 'sine', f: [880, 830, 0.3], gain: 0.03, env: { a: 0.003, d: 0.3 } });
    },
  },
  playerDeath: {
    group: 'player', target: -14, maxVoices: 1, minInterval: 1, pitchVar: 0, reverb: 0.45, priority: 2,
    duck: { music: 12, combat: 10, hold: 2.5, release: 2 },
    build(v) {
      // A D-minor chord sagging an octave as its filter closes, under a single low bell toll.
      for (const [n, g] of [[50, 1], [57, 0.7], [53, 0.6]] as const) {
        v.tone({
          type: 'sawtooth', f: { pts: [[0, midi(n)], [2.6, midi(n) * 0.5]] }, fixed: true, detune: v.rr(-8, 8), gain: 0.07 * g,
          env: { pad: true, a: 0.1, h: 1.4, r: 1.3 }, filter: { type: 'lowpass', f: [1800, 200, 2.6], fixed: true }, wet: 0.4,
        });
      }
      v.bell({ at: 0.05, f: midi(38), partials: P.church, gain: 0.3, decay: 4, wet: 0.5, fixed: true });
      v.thump({ f: [90, 30, 0.6], gain: 0.8, d: 0.9 });
      v.noise({ color: 'pink', gain: 0.9, env: { pad: true, a: 0.7, h: 0.8, r: 1.3 }, filter: { type: 'bandpass', f: [380, 1200, 2.2], q: 2 } });
    },
  },
  levelUp: {
    group: 'player', target: -14, maxVoices: 1, minInterval: 0.3, pitchVar: 0, reverb: 0.35, priority: 2, impact: 0.2,
    duck: { music: 6, hold: 1.2, release: 1 },
    build(v) {
      // A short rising swell lands on a D-major bell arpeggio over a warm pad, sparkles trailing.
      v.noise({ color: 'pink', gain: 1.2, env: { pts: [[0.2, 1], [0.28, 0]] }, filter: { type: 'bandpass', f: [600, 5200, 0.25], q: 1.4 } });
      v.thump({ at: 0.2, f: [130, 55, 0.18], gain: 0.6, d: 0.35 });
      [62, 69, 74, 78, 81, 86].forEach((n, i) => {
        v.bell({ at: 0.2 + i * 0.07, f: midi(n), partials: P.chime, gain: 0.2, decay: 1.6 - i * 0.12, pan: (i - 2.5) * 0.18, wet: 0.35, echo: 0.18, fixed: true });
      });
      for (const n of [50, 57, 62, 66]) {
        v.tone({ at: 0.18, type: 'triangle', f: midi(n), fixed: true, detune: v.rr(-5, 5), gain: 0.06, env: { pad: true, a: 0.25, h: 0.7, r: 1.1 }, filter: { type: 'lowpass', f: 2200, fixed: true }, wet: 0.45 });
      }
      v.shimmer({ at: 0.43, dur: 1.2, count: 12, notes: [86, 90, 93, 98, 102], gain: 0.05 });
    },
  },
  flaskLife: {
    group: 'player', target: -21, maxVoices: 2, minInterval: 0.15, pitchVar: 0.04, reverb: 0.2, priority: 1,
    build(v) {
      // Bubbling glugs, a slosh and a warm A-E dyad blooming.
      for (let i = 0; i < 4; i++) {
        v.tone({ at: i * 0.055 + v.rr(0, 0.025), type: 'sine', f: [v.rr(260, 380), v.rr(620, 900), 0.05], gain: 0.2, env: { a: 0.003, d: 0.07 } });
      }
      v.noise({ color: 'pink', gain: 1.0, env: { a: 0.03, d: 0.28 }, filter: { type: 'lowpass', f: 900 } });
      v.tone({ at: 0.1, type: 'triangle', f: midi(57), fixed: true, gain: 0.1, env: { pad: true, a: 0.12, h: 0.2, r: 0.55 }, filter: { type: 'lowpass', f: 1300, fixed: true }, wet: 0.3 });
      v.tone({ at: 0.1, type: 'triangle', f: midi(64), fixed: true, gain: 0.07, env: { pad: true, a: 0.16, h: 0.2, r: 0.55 }, filter: { type: 'lowpass', f: 1300, fixed: true }, wet: 0.3 });
    },
  },
  flaskFocus: {
    group: 'player', target: -21, maxVoices: 2, minInterval: 0.15, pitchVar: 0.04, reverb: 0.25, priority: 1,
    build(v) {
      // Lighter, higher bubbles and a cool trembling glass tone.
      for (let i = 0; i < 4; i++) {
        v.tone({ at: i * 0.05 + v.rr(0, 0.02), type: 'sine', f: [v.rr(420, 560), v.rr(1000, 1400), 0.04], gain: 0.16, env: { a: 0.003, d: 0.06 } });
      }
      v.noise({ color: 'pink', gain: 0.8, env: { a: 0.03, d: 0.24 }, filter: { type: 'lowpass', f: 1400 } });
      v.bell({ at: 0.1, f: midi(81), partials: P.glass, gain: 0.07, decay: 0.9, wet: 0.45, fixed: true });
      v.tone({ at: 0.08, type: 'sine', f: midi(69), fixed: true, gain: 0.08, env: { pad: true, a: 0.1, h: 0.2, r: 0.6 }, am: { rate: 6, depth: 0.4 }, wet: 0.4 });
    },
  },

  allyJoin: {
    group: 'flow', target: -22, maxVoices: 1, minInterval: 0.5, pitchVar: 0.02, reverb: 0.3, priority: 1,
    build(v) {
      // An ally steps through a portal: soft airy rise, then two warm bell notes (a fourth apart).
      v.noise({ color: 'pink', gain: 1.4, env: { pts: [[0.18, 1], [0.32, 0]] }, filter: { type: 'bandpass', f: [500, 2600, 0.2], q: 1.2 }, wet: 0.3 });
      v.bell({ at: 0.16, f: midi(69), partials: P.glass, gain: 0.09, decay: 0.9, wet: 0.4, fixed: true });
      v.bell({ at: 0.27, f: midi(74), partials: P.glass, gain: 0.08, decay: 1.1, wet: 0.45, fixed: true });
    },
  },
  partyInvite: {
    group: 'ui', target: -20, maxVoices: 1, minInterval: 0.6, pitchVar: 0, reverb: 0.25, priority: 2,
    build(v) {
      // A clear three-note summons (rising minor arpeggio) on a dull bell — noticeable, not alarming.
      const notes = [62, 65, 69];
      for (let i = 0; i < notes.length; i++) {
        v.bell({ at: i * 0.09, f: midi(notes[i]), partials: P.dull, gain: 0.1, decay: 0.55, wet: 0.35, fixed: true });
      }
      v.thump({ f: [180, 110, 0.05], gain: 0.2, d: 0.08 });
    },
  },
  chat: {
    group: 'ui', target: -30, maxVoices: 1, minInterval: 0.25, pitchVar: 0.03, reverb: 0.05, priority: 0,
    build(v) {
      // Tiny paper-and-quill tick: a soft high blip plus a short brush of noise.
      v.tone({ type: 'sine', f: [1750, 1500, 0.03], gain: 0.1, env: { a: 0.002, d: 0.05 } });
      v.noise({ color: 'pink', gain: 0.7, env: { a: 0.004, d: 0.05 }, filter: { type: 'highpass', f: 2500 } });
    },
  },

  // ---------------------------------------------------------------------------
  // Loot — luck must *feel* good
  // ---------------------------------------------------------------------------
  dropNormal: {
    group: 'loot', target: -26, maxVoices: 3, minInterval: 0.05, pitchVar: 0.08, reverb: 0.1, priority: 0, burst: 'defer', bank: { variants: 6 },
    build(v) {
      v.thump({ f: [210, 110, 0.05], gain: 0.5, d: 0.09 });
      v.noise({ color: 'pink', gain: 0.9, env: { a: 0.001, d: 0.045 }, filter: { type: 'bandpass', f: 1800, q: 1.4 } });
      v.bell({ at: 0.01, f: v.rr(1150, 1350), partials: P.dull, gain: 0.06, decay: 0.16 });
    },
  },
  dropMagic: {
    group: 'loot', target: -22, maxVoices: 3, minInterval: 0.06, pitchVar: 0.02, reverb: 0.25, priority: 1, burst: 'defer',
    build(v) {
      v.thump({ f: [220, 120, 0.05], gain: 0.35, d: 0.08 });
      v.bell({ at: 0.02, f: midi(81), partials: P.chime, gain: 0.2, decay: 0.8, wet: 0.3 });
      v.bell({ at: 0.09, f: midi(88), partials: P.chime, gain: 0.12, decay: 0.65, wet: 0.3, echo: 0.12 });
    },
  },
  dropRare: {
    group: 'loot', target: -15, maxVoices: 2, minInterval: 0.12, pitchVar: 0, reverb: 0.3, priority: 2, burst: 'defer', impact: 0.18,
    duck: { combat: 4, hold: 0.8, release: 0.6 },
    build(v) {
      // Anticipation: an airy rise that lands on a bright rising A-major chime, then a
      // long shimmering tail of scattered sparkles and air.
      v.noise({ color: 'pink', gain: 1.1, env: { pts: [[0.17, 1], [0.21, 0]] }, filter: { type: 'bandpass', f: [700, 5200, 0.2], q: 2 } });
      v.thump({ at: 0.18, f: [180, 70, 0.1], gain: 0.5, d: 0.22 });
      [81, 85, 88, 93].forEach((n, i) => {
        v.bell({ at: 0.18 + i * 0.065, f: midi(n), partials: P.chime, gain: 0.2, decay: 1.4, pan: -0.3 + i * 0.2, wet: 0.4, echo: 0.22 });
      });
      v.shimmer({ at: 0.32, dur: 1.4, count: 14, notes: [93, 95, 97, 100, 102, 105], gain: 0.045 });
      v.noise({ at: 0.2, color: 'white', gain: 0.25, env: { pad: true, a: 0.2, h: 0.2, r: 1.0 }, filter: { type: 'highpass', f: 7500, fixed: true }, wet: 0.5 });
    },
  },
  dropUnique: {
    group: 'loot', target: -12, maxVoices: 1, minInterval: 0.3, pitchVar: 0, reverb: 0.35, priority: 2, burst: 'defer', impact: 0.15,
    duck: { music: 10, combat: 8, hold: 2, release: 1.5 },
    build(v) {
      // A short low suck-in, then the deep bass hit; a choir-like "ah" swell (detuned saws into
      // a formant bank) on D major add-9, orange bell accents, and a long sparkle tail.
      v.noise({ color: 'brown', gain: 1.6, env: { pts: [[0.14, 1], [0.165, 0]] }, filter: { type: 'lowpass', f: [220, 1400, 0.15] } });
      v.thump({ at: 0.15, f: [72, 28, 0.9], gain: 1.0, d: 1.7, drive: 2 });
      v.click({ at: 0.15, gain: 0.9, f: 900, d: 0.05 });
      v.noise({ at: 0.15, color: 'brown', gain: 1.8, env: { a: 0.003, d: 1.2 }, filter: { type: 'lowpass', f: [900, 120, 1] } });
      const choir = v.formant('a', { at: 0.15, wet: 0.55, echo: 0.1 });
      for (const n of [50, 57, 62, 66, 69]) {
        for (const dt of [-8, 7]) {
          v.tone({
            at: 0.15, type: 'sawtooth', f: midi(n), fixed: true, detune: dt + v.rr(-3, 3), gain: 0.05,
            env: { pad: true, a: 0.7, h: 1.4, r: 1.7 }, vib: { rate: 5.2, cents: 9, delay: 0.5 }, to: choir,
          });
        }
      }
      [74, 81, 86].forEach((n, i) => {
        v.bell({ at: 0.22 + i * 0.11, f: midi(n), partials: P.church, gain: 0.12, decay: 2.4, wet: 0.45, echo: 0.2, fixed: true, pan: (i - 1) * 0.35 });
      });
      v.shimmer({ at: 0.55, dur: 2.4, count: 22, notes: [86, 90, 93, 98, 102, 105], gain: 0.04 });
    },
  },
  dropCurrency: {
    group: 'loot', target: -22, maxVoices: 3, minInterval: 0.05, pitchVar: 0.015, reverb: 0.18, priority: 1, burst: 'defer',
    build(v) {
      // Crisp coin/crystal tink-tink (a fourth apart). A fountain of currency cascades up a
      // pentatonic run, one step per coin.
      const f = v.rr(1950, 2100) * coinRatio(v.combo);
      v.bell({ f, partials: P.coin, gain: 0.16, decay: 0.28, pan: -0.1 });
      v.bell({ at: 0.045, f: f * 1.335, partials: P.coin, gain: 0.11, decay: 0.38, wet: 0.25, pan: 0.12 });
      v.click({ gain: 0.25, f: 4500, d: 0.01 });
    },
  },
  dropMap: {
    group: 'loot', target: -18, maxVoices: 2, minInterval: 0.1, pitchVar: 0.02, reverb: 0.28, priority: 2, burst: 'defer',
    build(v) {
      // Parchment: a paper crinkle and an airy unfurl, then a two-note silver chime.
      v.noise({ color: 'crackle', gain: 0.55, env: { pts: [[0.03, 1], [0.12, 0.6], [0.26, 0]] }, filter: { type: 'bandpass', f: 3200, q: 0.7 } });
      v.noise({ color: 'pink', gain: 1.4, env: { pts: [[0.05, 1], [0.24, 0]] }, filter: { type: 'bandpass', f: [900, 2600, 0.22], q: 0.9 } });
      [88, 95].forEach((n, i) => {
        v.bell({ at: 0.15 + i * 0.09, f: midi(n), partials: P.silver, gain: 0.16, decay: 1.1, wet: 0.4, echo: 0.2, fixed: true, pan: i ? 0.2 : -0.2 });
      });
    },
  },
  pickupItem: {
    group: 'loot', target: -23, maxVoices: 3, minInterval: 0.05, pitchVar: 0.05, reverb: 0.08, priority: 1, burst: 'defer', bank: { variants: 6 },
    build(v) {
      v.thump({ f: [260, 140, 0.05], gain: 0.45, d: 0.08 });
      v.noise({ color: 'pink', gain: 1.1, env: { a: 0.003, d: 0.07 }, filter: { type: 'bandpass', f: 900, q: 1.2 } });
      v.bell({ at: 0.03, f: 1500, partials: P.dull, gain: 0.06, decay: 0.14 });
    },
  },
  pickupCurrency: {
    group: 'loot', target: -23, maxVoices: 3, minInterval: 0.05, pitchVar: 0.015, reverb: 0.1, priority: 1, burst: 'defer',
    bank: { variants: 2, steps: 6, step: coinStep },
    build(v) {
      // Three quick coin tinks on a bright triad; scooping up a pile climbs the coin ladder.
      const f0 = v.rr(1900, 2050) * coinRatio(v.combo);
      [1, 1.26, 1.5].forEach((r, i) => {
        v.bell({ at: i * 0.035 + v.rr(0, 0.012), f: f0 * r * v.rr(0.99, 1.01), partials: P.coin, gain: 0.12 - i * 0.025, decay: 0.2, pan: v.rr(-0.25, 0.25) });
      });
    },
  },
  mote: {
    group: 'loot', target: -28, maxVoices: 6, minInterval: 0.028, pitchVar: 0, reverb: 0.12, priority: 0, burst: 'defer', fixedPitch: true,
    bank: { variants: 3, steps: MOTE_LADDER.length, step: moteStep },
    build(v) {
      // Consecutive motes climb the ladder (resetting after a short pause). Each step is a soft
      // FM blip with a little timbre jitter, 1.5 dB quieter and less bright per octave climbed.
      const n = MOTE_LADDER[moteStep(v.combo)];
      const up = (n - MOTE_LADDER[0]) / 12;
      const g = Math.pow(10, (-1.5 * up) / 20);
      const detune = v.rr(-6, 6);
      v.tone({
        type: 'sine', f: [midi(n) * 0.985, midi(n), 0.02], fixed: true, detune, gain: 0.22 * g,
        env: { a: 0.003, d: 0.1 * v.rr(0.9, 1.15) }, fm: { ratio: 2, index: [1.2 * v.rr(0.75, 1.2), 0, 0.06] },
      });
      v.tone({ type: 'sine', f: midi(n) * 2, fixed: true, detune, gain: 0.04 * g * Math.pow(0.5, up), env: { a: 0.002, d: 0.05 } });
    },
  },

  // ---------------------------------------------------------------------------
  // Run flow
  // ---------------------------------------------------------------------------
  waveTell: {
    group: 'flow', target: -17, maxVoices: 1, minInterval: 1, pitchVar: 0, reverb: 0.4, priority: 2, impact: 0.5,
    duck: { music: 3, hold: 1.5, release: 1 },
    build(v) {
      // Reverse swell into a low A bell toll and two distant war drums.
      v.noise({ color: 'pink', gain: 1.0, env: { pts: [[0.5, 1], [0.54, 0]] }, filter: { type: 'bandpass', f: [280, 1500, 0.5], q: 1.4 }, wet: 0.35 });
      v.bell({ at: 0.5, f: midi(45), partials: P.church, gain: 0.32, decay: 3.2, wet: 0.5, fixed: true });
      v.drum({ at: 0.5, f: [78, 40, 0.4], gain: 0.7, d: 0.8, slap: 0.6, slapF: 400, wet: 0.25 });
      v.drum({ at: 1.1, f: [72, 38, 0.4], gain: 0.45, d: 0.7, slap: 0.4, slapF: 400, wet: 0.25 });
    },
  },
  waveStart: {
    group: 'flow', target: -16, maxVoices: 1, minInterval: 1, pitchVar: 0, reverb: 0.3, priority: 2,
    build(v) {
      // Two war drums, a gong bloom and a short horn stab: "here they come".
      v.drum({ f: [125, 55, 0.25], gain: 0.9, d: 0.55, slap: 1.4, slapF: 700 });
      v.drum({ at: 0.17, f: [112, 50, 0.25], gain: 0.85, d: 0.6, slap: 1.2, slapF: 650 });
      v.bell({ at: 0.17, f: midi(38), partials: P.gong, gain: 0.14, decay: 2.0, wet: 0.45, fixed: true });
      const horn = v.bus({ at: 0.17, filter: { type: 'lowpass', f: { pts: [[0, 400], [0.12, 1800], [0.9, 500]] }, q: 1.2, fixed: true }, drive: 1.5, wet: 0.35 });
      for (const [n, dt] of [[50, -6], [57, 5], [62, 0]] as const) {
        v.tone({ at: 0.17, type: 'sawtooth', f: midi(n), fixed: true, detune: dt, gain: 0.12, env: { pad: true, a: 0.04, h: 0.35, r: 0.5 }, to: horn });
      }
    },
  },
  bossSpawn: {
    group: 'boss', target: -13, maxVoices: 1, minInterval: 2, pitchVar: 0, reverb: 0.45, priority: 2,
    duck: { music: 9, hold: 2, release: 2 },
    build(v) {
      // Sub drop + a dissonant brass cluster (D, G#, D, Eb) snarling open, metallic scrape, rumble.
      v.thump({ f: [62, 22, 1.4], gain: 1.0, d: 2.0, drive: 2.5 });
      v.click({ gain: 0.8, f: 800, d: 0.06 });
      const brass = v.bus({ filter: [{ type: 'lowpass', f: { pts: [[0, 260], [0.14, 2400], [1.9, 480]] }, q: 1.5, fixed: true }], drive: 2.4, wet: 0.45 });
      for (const n of [38, 44, 50, 51]) {
        for (const dt of [-9, 8]) {
          v.tone({ type: 'sawtooth', f: midi(n), fixed: true, detune: dt + v.rr(-3, 3), gain: 0.09, env: { pad: true, a: 0.05, h: 1.05, r: 1.2 }, vib: { rate: 5, cents: 10, delay: 0.5 }, to: brass });
        }
      }
      v.tone({ type: 'sine', f: 1100, fixed: true, fm: { ratio: 1.414, index: [6, 1, 2] }, gain: 0.035, env: { pad: true, a: 0.4, h: 0.6, r: 1.2 }, wet: 0.6 });
      v.noise({ color: 'brown', gain: 1.6, env: { a: 0.3, d: 2.3 }, filter: { type: 'lowpass', f: 360, fixed: true } });
    },
  },
  cleared: {
    group: 'flow', target: -14, maxVoices: 1, minInterval: 2, pitchVar: 0, reverb: 0.4, priority: 2,
    duck: { music: 8, combat: 6, hold: 2.5, release: 2 },
    build(v) {
      // Triumphant resolution: a drum, a rolled D-major bell chord, warm pad, sparkles.
      v.drum({ f: [110, 50, 0.3], gain: 0.8, d: 0.8, slap: 1.0, slapF: 600, wet: 0.3 });
      [62, 66, 69, 74].forEach((n, i) => {
        v.bell({ at: 0.05 + i * 0.13, f: midi(n), partials: P.chime, gain: 0.17, decay: 2.6, pan: -0.3 + i * 0.2, wet: 0.45, echo: 0.2, fixed: true });
      });
      for (const n of [38, 50, 57, 66]) {
        v.tone({ type: 'triangle', f: midi(n), fixed: true, detune: v.rr(-6, 6), gain: 0.07, env: { pad: true, a: 0.45, h: 1.3, r: 1.6 }, filter: { type: 'lowpass', f: 1800, fixed: true }, wet: 0.45 });
      }
      v.shimmer({ at: 0.55, dur: 2.0, count: 16, notes: [86, 90, 93, 98, 102], gain: 0.04 });
    },
  },
  chestOpen: {
    group: 'flow', target: -17, maxVoices: 1, minInterval: 0.5, pitchVar: 0.02, reverb: 0.3, priority: 2, burst: 'defer', impact: 0.36,
    build(v) {
      // Creaking lid (stick-slip tremolo on a resonant saw), latch clunk, treasure sparkle.
      v.tone({
        type: 'sawtooth', f: { pts: [[0, 72], [0.34, 96]] }, noiseFm: 12, gain: 0.3, env: { pad: true, a: 0.05, h: 0.2, r: 0.1 },
        filter: { type: 'bandpass', f: [700, 1150, 0.34], q: 6 }, am: { rate: 21, depth: 0.7, type: 'triangle' },
      });
      v.thump({ at: 0.36, f: [180, 80, 0.08], gain: 0.6, d: 0.16 });
      v.noise({ at: 0.36, color: 'pink', gain: 1.1, env: { a: 0.001, d: 0.07 }, filter: { type: 'lowpass', f: 2600 } });
      [86, 90, 93, 98].forEach((n, i) => {
        v.bell({ at: 0.44 + i * 0.07, f: midi(n), partials: P.chime, gain: 0.13, decay: 1.1, pan: -0.25 + i * 0.17, wet: 0.35, echo: 0.18, fixed: true });
      });
      v.shimmer({ at: 0.62, dur: 1.0, count: 9, notes: [93, 98, 102, 105], gain: 0.04 });
    },
  },
  portalOpen: {
    group: 'flow', target: -18, maxVoices: 1, minInterval: 0.8, pitchVar: 0.02, reverb: 0.45, priority: 2,
    build(v) {
      // A swirling resonant vortex over a chorused A-E drone, with sparkles.
      v.noise({
        color: 'pink', gain: 1.6, env: { pad: true, a: 0.55, h: 0.6, r: 0.9 },
        filter: { type: 'bandpass', f: { pts: [[0, 200], [0.8, 1900], [2.0, 850]] }, q: 3.5 }, am: { rate: 4.5, depth: 0.45 }, wet: 0.4,
      });
      for (const [n, dt] of [[57, -8], [57, 8], [64, 0]] as const) {
        v.tone({ type: 'sine', f: midi(n), fixed: true, detune: dt, gain: 0.07, env: { pad: true, a: 0.6, h: 0.6, r: 0.9 }, vib: { rate: 4, cents: 12 }, wet: 0.45 });
      }
      v.thump({ f: [90, 45, 0.4], gain: 0.45, d: 0.7 });
      v.shimmer({ at: 0.4, dur: 1.4, count: 10, notes: [81, 88, 93, 96], gain: 0.035 });
    },
  },
  portalEnter: {
    group: 'flow', target: -16, maxVoices: 1, minInterval: 0.8, pitchVar: 0.02, reverb: 0.35, priority: 2, impact: 0.46,
    build(v) {
      // Rushing rise, cut off by a low boom as you pass through.
      v.noise({ color: 'pink', gain: 2.4, env: { pts: [[0.45, 1], [0.5, 0.35], [0.95, 0]] }, filter: { type: 'bandpass', f: [300, 4200, 0.48], q: 1.4 }, wet: 0.25 });
      v.tone({ type: 'sine', f: [200, 900, 0.48], gain: 0.1, env: { pts: [[0.45, 1], [0.56, 0]] }, wet: 0.4 });
      v.thump({ at: 0.46, f: [82, 30, 0.5], gain: 0.9, d: 0.75, drive: 1.8 });
      v.bell({ at: 0.46, f: midi(62), partials: P.gong, gain: 0.08, decay: 1.6, wet: 0.5, fixed: true });
    },
  },

  // ---------------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------------
  uiClick: {
    group: 'ui', target: -27, maxVoices: 2, minInterval: 0.03, pitchVar: 0.03, reverb: 0, priority: 1, bank: { variants: 6 },
    build(v) {
      v.click({ gain: 0.42, f: 2600, d: 0.01 });
      v.tone({ type: 'sine', f: [1500, 1150, 0.03], gain: 0.12, env: { a: 0.001, d: 0.045 } });
      v.thump({ f: [300, 180, 0.03], gain: 0.2, d: 0.045 });
    },
  },
  uiHover: {
    group: 'ui', target: -33, maxVoices: 2, minInterval: 0.045, pitchVar: 0.03, reverb: 0, priority: 0, bank: { variants: 4 },
    build(v) {
      v.tone({ type: 'sine', f: 2100, gain: 0.08, env: { a: 0.002, d: 0.035 } });
      v.click({ gain: 0.1, f: 5000, d: 0.008 });
    },
  },
  uiOpen: {
    group: 'ui', target: -24, maxVoices: 2, minInterval: 0.06, pitchVar: 0.03, reverb: 0.08, priority: 1,
    build(v) {
      // Leather flap opening + a small clasp tick.
      v.noise({ color: 'pink', gain: 1.5, env: { a: 0.02, d: 0.15 }, filter: { type: 'lowpass', f: [700, 2300, 0.12] } });
      v.thump({ at: 0.02, f: [170, 90, 0.06], gain: 0.3, d: 0.1 });
      v.bell({ at: 0.07, f: 1800, partials: P.dull, gain: 0.06, decay: 0.2 });
    },
  },
  uiClose: {
    group: 'ui', target: -25, maxVoices: 2, minInterval: 0.06, pitchVar: 0.03, reverb: 0.06, priority: 1,
    build(v) {
      v.noise({ color: 'pink', gain: 1.4, env: { a: 0.01, d: 0.13 }, filter: { type: 'lowpass', f: [2100, 600, 0.1] } });
      v.thump({ at: 0.03, f: [150, 80, 0.06], gain: 0.4, d: 0.1 });
    },
  },
  uiError: {
    group: 'ui', target: -24, maxVoices: 1, minInterval: 0.12, pitchVar: 0, reverb: 0.05, priority: 1,
    build(v) {
      // A muted, slightly beating low buzz — clear "no" without a harsh beep.
      for (const f of [110, 116.5]) v.tone({ type: 'square', f, gain: 0.08, env: { a: 0.003, h: 0.08, d: 0.11 }, filter: { type: 'lowpass', f: 700 } });
      v.thump({ f: [140, 90, 0.05], gain: 0.3, d: 0.08 });
    },
  },
  equip: {
    group: 'ui', target: -22, maxVoices: 2, minInterval: 0.06, pitchVar: 0.05, reverb: 0.12, priority: 1,
    build(v) {
      v.click({ gain: 0.45, f: 2200, d: 0.035 });
      v.bell({ f: v.rr(780, 860), partials: P.anvil, gain: 0.12, decay: 0.38 });
      v.thump({ f: [200, 100, 0.05], gain: 0.4, d: 0.09 });
      v.noise({ at: 0.05, color: 'pink', gain: 0.8, env: { a: 0.005, d: 0.08 }, filter: { type: 'bandpass', f: 1200, q: 1 } });
    },
  },
  buy: {
    group: 'ui', target: -20, maxVoices: 1, minInterval: 0.1, pitchVar: 0.02, reverb: 0.2, priority: 1,
    build(v) {
      for (let i = 0; i < 3; i++) {
        v.bell({ at: i * 0.05 + v.rr(0, 0.015), f: v.rr(2600, 3800), partials: P.coin, gain: 0.1, decay: 0.22, pan: v.rr(-0.3, 0.3) });
      }
      v.thump({ at: 0.02, f: [200, 110, 0.05], gain: 0.3, d: 0.1 });
      v.bell({ at: 0.16, f: midi(81), partials: P.chime, gain: 0.1, decay: 0.7, wet: 0.3, fixed: true });
      v.bell({ at: 0.24, f: midi(86), partials: P.chime, gain: 0.09, decay: 0.8, wet: 0.3, fixed: true });
    },
  },

  // ---------------------------------------------------------------------------
  // Crafting (hideout)
  // ---------------------------------------------------------------------------
  craftArm: {
    group: 'craft', target: -22, maxVoices: 2, minInterval: 0.06, pitchVar: 0.04, reverb: 0.2, priority: 2,
    build(v) {
      // Metallic pick-up: a rising scrape and a short FM ring.
      v.noise({ color: 'white', gain: 0.9, env: { pts: [[0.02, 1], [0.11, 0]] }, filter: { type: 'highpass', f: [3000, 6500, 0.1] } });
      v.tone({ type: 'sine', f: 1320, fm: { ratio: 2.37, index: [2.6, 0.25, 0.2] }, gain: 0.12, env: { a: 0.003, d: 0.4 }, wet: 0.25 });
      v.thump({ f: [240, 140, 0.04], gain: 0.25, d: 0.06 });
    },
  },
  craftApply: {
    group: 'craft', target: -19.5, maxVoices: 2, minInterval: 0.08, pitchVar: 0.03, reverb: 0.25, priority: 2, comboWindow: 1.2, energyTau: 1.5,
    build(v) {
      // Hammer on anvil (thump + strike + ringing bar modes), then a quench sizzle. Repeats within
      // a crafting burst play a short, dry tap instead: the full anvil + sizzle belongs to the first
      // strike, and the result sounds (craftRare / craftScar / craftFinish) carry the drama.
      const repeat = v.combo > 0;
      v.thump({ f: [165, 60, 0.08], gain: 0.85, d: repeat ? 0.11 : 0.15, drive: 1.4 });
      v.noise({ color: 'white', gain: repeat ? 0.8 : 1.0, env: { a: 0.0005, d: 0.025 }, filter: { type: 'bandpass', f: 3500, q: 0.8 } });
      v.bell({ f: v.rr(600, 640), partials: P.anvil, gain: repeat ? 0.16 : 0.2, decay: repeat ? 0.45 : 1.2, wet: repeat ? 0.15 : 0.25 });
      if (repeat) return;
      v.noise({ at: 0.04, color: 'white', gain: 0.5, env: { pad: true, a: 0.03, h: 0.15, r: 0.65 }, filter: { type: 'highpass', f: 4200, fixed: true }, am: { rate: 13, depth: 0.5 } });
      v.crackle({ at: 0.04, dur: 0.65, gain: 0.16, hp: 3500 });
    },
  },
  craftRare: {
    group: 'craft', target: -15, maxVoices: 1, minInterval: 0.2, pitchVar: 0, reverb: 0.35, priority: 2,
    build(v) {
      // Arcane shimmer: a glassy upward glissando, a vibrato pad, and bright air.
      [69, 72, 74, 76, 79, 81, 84, 86].forEach((n, i) => {
        v.bell({ at: i * 0.045, f: midi(n), partials: P.glass, gain: 0.09, decay: 1.0, pan: i % 2 ? 0.35 : -0.35, wet: 0.45, echo: 0.15, fixed: true });
      });
      for (const n of [57, 64, 71]) {
        v.tone({ type: 'triangle', f: midi(n), fixed: true, gain: 0.06, env: { pad: true, a: 0.35, h: 0.45, r: 1.0 }, vib: { rate: 5, cents: 8 }, wet: 0.45 });
      }
      v.noise({ color: 'white', gain: 0.35, env: { pad: true, a: 0.3, h: 0.2, r: 0.7 }, filter: { type: 'bandpass', f: [3000, 8000, 0.8], q: 2, fixed: true }, wet: 0.45 });
      v.shimmer({ at: 0.4, dur: 1.0, count: 8, notes: [88, 91, 93, 98], gain: 0.035 });
    },
  },
  craftScar: {
    group: 'craft', target: -16, maxVoices: 1, minInterval: 0.2, pitchVar: 0.03, reverb: 0.25, priority: 2,
    build(v) {
      // Cracks splintering, a saturated grinding groan and a sour low Eb.
      for (let i = 0; i < 4; i++) {
        v.noise({ at: i * 0.075 + v.rr(0, 0.03), color: 'white', gain: 1.6 - i * 0.25, env: { a: 0.0005, d: 0.035 }, filter: { type: 'bandpass', f: v.rr(1500, 4000), q: 2 } });
      }
      v.tone({
        type: 'sawtooth', f: [55, 47, 0.6], noiseFm: 40, gain: 0.25, drive: 2, env: { pad: true, a: 0.05, h: 0.35, r: 0.3 },
        filter: { type: 'bandpass', f: 450, q: 2.2 }, am: { rate: 17, depth: 0.6, type: 'triangle' },
      });
      v.noise({ color: 'brown', gain: 1.4, env: { a: 0.02, d: 0.6 }, filter: { type: 'bandpass', f: 300, q: 1 } });
      v.tone({ type: 'triangle', f: midi(39), fixed: true, gain: 0.12, env: { pad: true, a: 0.05, h: 0.3, r: 0.5 }, filter: { type: 'lowpass', f: 500, fixed: true } });
    },
  },
  craftFinish: {
    group: 'craft', target: -15, maxVoices: 1, minInterval: 0.2, pitchVar: 0, reverb: 0.3, priority: 2,
    build(v) {
      // Heavy lock: a big clunk with a metal ring, the latch catching, a low resonance.
      v.thump({ f: [115, 45, 0.2], gain: 0.95, d: 0.32, drive: 1.6 });
      v.noise({ color: 'pink', gain: 1.4, env: { a: 0.001, d: 0.1 }, filter: { type: 'lowpass', f: 1800 } });
      v.bell({ f: 330, partials: P.anvil, gain: 0.14, decay: 0.9, wet: 0.3 });
      v.thump({ at: 0.19, f: [220, 120, 0.04], gain: 0.45, d: 0.09 });
      v.noise({ at: 0.19, color: 'white', gain: 1.0, env: { a: 0.0005, d: 0.022 }, filter: { type: 'bandpass', f: 2800, q: 1.2 } });
      v.tone({ at: 0.19, type: 'sine', f: midi(38), fixed: true, gain: 0.16, env: { pad: true, a: 0.02, h: 0.2, r: 0.9 }, wet: 0.35 });
    },
  },
  craftCorrupt: {
    group: 'craft', target: -14, maxVoices: 1, minInterval: 0.3, pitchVar: 0, reverb: 0.45, priority: 2, impact: 0.1,
    build(v) {
      // The corruption takes hold at once: a 0.1 s inhale, then a saturated sub impact with a
      // glassy crack. The void plunge is the tail: a resonant band sinking into the dark under
      // tritone saws sagging an octave, and an eerie FM whine.
      const hit = 0.1;
      v.noise({ color: 'pink', gain: 1.2, env: { pts: [[hit - 0.01, 1], [hit + 0.01, 0]] }, filter: { type: 'bandpass', f: [900, 3600, hit], q: 2, fixed: true } });
      v.thump({ at: hit, f: [72, 26, 0.6], gain: 0.9, d: 0.9, drive: 2 });
      v.click({ at: hit, gain: 0.55, f: 1400, d: 0.05 });
      v.noise({
        at: hit, color: 'pink', gain: 2.0, drive: 3, env: { pts: [[0.04, 1], [0.5, 0.7], [1.3, 0]] },
        filter: { type: 'bandpass', f: { pts: [[0, 3200], [0.9, 260], [1.3, 170]] }, q: 4.5, fixed: true }, wet: 0.45,
      });
      for (const n of [57, 63]) {
        v.tone({
          at: hit, type: 'sawtooth', f: { pts: [[0, midi(n)], [1.3, midi(n) * 0.5]] }, fixed: true, gain: 0.08, env: { pad: true, a: 0.12, h: 0.55, r: 0.75 },
          filter: { type: 'lowpass', f: [2000, 300, 1.3], q: 3, fixed: true }, vib: { rate: 6, cents: 30 }, wet: 0.45,
        });
      }
      v.tone({ at: hit, type: 'sine', f: { pts: [[0, 1500], [1.2, 600]] }, fixed: true, fm: { ratio: 1.5, index: [8, 2, 1.2] }, gain: 0.035, env: { pad: true, a: 0.3, h: 0.4, r: 0.6 }, wet: 0.6 });
    },
  },

  // ---------------------------------------------------------------------------
  // Player debuffs (GAME_SPEC §13). One short, unmistakable signature per ailment, played when
  // it takes hold on the local player (un-positioned) — not on every refresh. They sit on the
  // SFX bus, above the combat mix; the core of each is under 0.35 s (chill's shimmer and the
  // freeze ring a little longer). The ailments start DEBUFF_LAG after the request, behind the
  // hit that applied them, and their minIntervals are the shortest legitimate re-application
  // (so a refresh-per-tick zone cannot machine-gun them).
  // ---------------------------------------------------------------------------
  debuffChill: {
    group: 'player', target: -22, maxVoices: 1, minInterval: 0.6, pitchVar: 0.05, reverb: 0.2, priority: 1, lag: DEBUFF_LAG,
    build(v) {
      // Crystalline crackle: frost racing over you. A spray of tiny ice ticks, a cold hiss
      // sweeping down, and a glass tone that sags and shivers (you are slowed).
      for (let i = 0; i < 7; i++) {
        v.bell({ at: i * 0.024 + v.rr(0, 0.016), f: v.rr(3000, 5400), partials: P.glass, gain: 0.075 * (1 - i * 0.09), decay: v.rr(0.05, 0.1), pan: v.rr(-0.4, 0.4) });
      }
      v.noise({ color: 'white', gain: 0.9, env: { a: 0.003, d: 0.2 }, filter: [{ type: 'bandpass', f: [7200, 2800, 0.2], q: 1.3 }, { type: 'highpass', f: 1800 }] });
      v.crackle({ dur: 0.16, gain: 0.16, hp: 4200 });
      v.bell({ at: 0.015, f: v.rr(1480, 1620), partials: P.glass, gain: 0.05, decay: 0.2, wet: 0.2 });
      v.tone({ at: 0.02, type: 'sine', f: [2000, 1150, 0.24], gain: 0.08, env: { a: 0.01, h: 0.06, d: 0.22 }, vib: { rate: 12, cents: 35 }, wet: 0.3 });
    },
  },
  debuffFreeze: {
    group: 'player', target: -16, maxVoices: 1, minInterval: 2.5, pitchVar: 0.03, reverb: 0.3, priority: 2, lag: DEBUFF_LAG,
    duck: { combat: 4, hold: 0.45, release: 0.5 },
    build(v) {
      // Heavy ice lock: you are encased at once — a saturated low lock (thump + crack + a hard
      // crystalline burst), the block ringing in cold open fifths, ice creaking as it settles,
      // and a muffled hollow hum from inside the ice.
      v.thump({ f: [190, 52, 0.14], gain: 0.95, d: 0.32, drive: 2 });
      v.click({ gain: 0.85, f: 2600, d: 0.03 });
      v.noise({ color: 'white', gain: 1.5, env: { a: 0.001, d: 0.13 }, filter: { type: 'bandpass', f: [5600, 2200, 0.12], q: 1 } });
      ([[587.3, 0.14, 1.1, -0.2], [880, 0.1, 0.9, 0.2], [1318.5, 0.07, 0.7, 0]] as const).forEach(([f, g, d, pan]) => {
        v.bell({ at: 0.004, f, partials: P.glass, gain: g, decay: d, pan, wet: 0.35 });
      });
      v.crackle({ at: 0.04, dur: 0.45, gain: 0.2, hp: 3000 });
      v.noise({ at: 0.02, color: 'pink', gain: 0.7, env: { pad: true, a: 0.03, h: 0.12, r: 0.55 }, filter: { type: 'highpass', f: 3800, fixed: true }, wet: 0.35 });
      v.tone({ wave: 'hollow', f: [233, 196, 0.7], gain: 0.13, env: { pad: true, a: 0.006, h: 0.14, r: 0.6 }, filter: { type: 'lowpass', f: 850 } });
    },
  },
  debuffRoot: {
    group: 'player', target: -20, maxVoices: 1, minInterval: 0.6, pitchVar: 0.05, reverb: 0.15, priority: 2, lag: DEBUFF_LAG,
    build(v) {
      // Grasping creak: something seizes your feet — a light grab, then the loud part: a stick-slip
      // creak (a resonant saw scraped by a fast tremolo) bending up as it pulls taut, ending in a
      // snap. The grab stays soft so the pair with the hit's playerHurt never reads as "hurt twice".
      v.thump({ f: [150, 68, 0.08], gain: 0.3, d: 0.12 });
      v.noise({ color: 'pink', gain: 0.6, env: { a: 0.002, d: 0.08 }, filter: { type: 'lowpass', f: 1300 } });
      v.tone({
        at: 0.02, type: 'sawtooth', f: { pts: [[0, 86], [0.22, 121], [0.3, 114]] }, noiseFm: 9, gain: 0.8,
        env: { pts: [[0.03, 1], [0.22, 0.85], [0.3, 0]] },
        filter: { type: 'bandpass', f: [620, 1080, 0.24], q: 3 }, am: { rate: 27, depth: 0.75, type: 'triangle' },
      });
      v.noise({ at: 0.23, color: 'white', gain: 1.6, env: { a: 0.0005, d: 0.028 }, filter: { type: 'bandpass', f: 2300, q: 2 } });
      v.thump({ at: 0.23, f: [270, 150, 0.03], gain: 0.25, d: 0.06 });
    },
  },
  debuffBurn: {
    group: 'player', target: -22, maxVoices: 1, minInterval: 0.75, pitchVar: 0.06, reverb: 0.15, priority: 1, lag: DEBUFF_LAG,
    build(v) {
      // Ignition whoosh: you catch fire — a hiss of gas, the flame blooming up through a
      // saturated rising band ("fwoomf"), a warm low body, and a trail of crackle.
      v.noise({ color: 'white', gain: 0.45, env: { pts: [[0.015, 1], [0.05, 0]] }, filter: { type: 'highpass', f: 4500 } });
      v.noise({
        color: 'pink', gain: 2.2, drive: 2.5, env: { pts: [[0.035, 1], [0.12, 0.65], [0.34, 0]] },
        filter: { type: 'bandpass', f: { pts: [[0, 320], [0.07, 1800], [0.34, 850]] }, q: 1.2 },
      });
      v.thump({ at: 0.01, f: [125, 58, 0.12], gain: 0.5, d: 0.22 });
      v.crackle({ at: 0.04, dur: 0.38, gain: 0.22, hp: 2000 });
    },
  },
  debuffBleed: {
    group: 'player', target: -22, maxVoices: 1, minInterval: 0.2, pitchVar: 0.06, reverb: 0.1, priority: 1, lag: DEBUFF_LAG,
    build(v) {
      // Wet slice: a thin blade hiss slicing down, a soft cut thump, a wet squelch (a resonant
      // band sliding down over a falling blob) and two droplets.
      v.noise({ color: 'white', gain: 1.1, env: { pts: [[0.01, 1], [0.065, 0]] }, filter: { type: 'bandpass', f: [7800, 3300, 0.065], q: 2.2 } });
      v.thump({ f: [230, 95, 0.05], gain: 0.4, d: 0.08 });
      v.noise({ at: 0.03, color: 'pink', gain: 1.7, env: { a: 0.006, d: 0.14 }, filter: { type: 'bandpass', f: [1150, 380, 0.13], q: 6 } });
      v.tone({ at: 0.035, type: 'sine', f: [480, 185, 0.07], gain: 0.2, env: { a: 0.003, d: 0.09 } });
      v.tone({ at: 0.16 + v.rr(0, 0.04), type: 'sine', f: [v.rr(900, 1080), 1750, 0.025], gain: 0.07, env: { a: 0.002, d: 0.05 } });
      v.tone({ at: 0.27 + v.rr(0, 0.05), type: 'sine', f: [v.rr(780, 920), 1450, 0.025], gain: 0.05, env: { a: 0.002, d: 0.05 } });
    },
  },
  debuffShock: {
    group: 'player', target: -22, maxVoices: 1, minInterval: 0.5, pitchVar: 0.05, reverb: 0.1, priority: 1, lag: DEBUFF_LAG,
    build(v) {
      // Zap: a sharp crack, then a stuttering electric buzz (a noise-thrashed saw gated at 32 Hz)
      // falling away, a sub jolt, and a gated sizzle.
      v.click({ gain: 0.9, f: 2200, d: 0.02 });
      v.tone({
        type: 'sawtooth', f: [1400, 680, 0.2], noiseFm: 900, gain: 0.26, env: { a: 0.001, h: 0.06, d: 0.16 },
        filter: [{ type: 'bandpass', f: 2400, q: 1.1 }, { type: 'lowpass', f: 7000, fixed: true }], am: { rate: 32, depth: 0.85, type: 'square' },
      });
      v.tone({ type: 'square', f: [180, 60, 0.12], gain: 0.12, env: { a: 0.001, d: 0.12 }, filter: { type: 'lowpass', f: 900 } });
      v.noise({ at: 0.01, color: 'white', gain: 0.45, env: { a: 0.002, d: 0.2 }, filter: { type: 'highpass', f: 6500 }, am: { rate: 47, depth: 0.9, type: 'square' } });
    },
  },
  debuffWither: {
    group: 'player', target: -22, maxVoices: 1, minInterval: 0.75, pitchVar: 0.04, reverb: 0.22, priority: 1, lag: DEBUFF_LAG,
    build(v) {
      // Hollow decay: something drains out of you — a hollow "thoom", two hollow tones beating
      // slowly as they sag a fourth under a closing lowpass, a breath exhaling downward and a
      // dry, dusty crumble.
      v.thump({ f: [170, 55, 0.18], gain: 0.55, d: 0.3 });
      for (const dt of [-13, 13]) {
        v.tone({ wave: 'hollow', f: [330, 247, 0.42], detune: dt, gain: 0.12, env: { pad: true, a: 0.012, h: 0.1, r: 0.34 }, filter: { type: 'lowpass', f: [2300, 380, 0.42] }, wet: 0.25 });
      }
      v.noise({ color: 'pink', gain: 1.1, env: { pts: [[0.03, 1], [0.38, 0]] }, filter: { type: 'bandpass', f: [2100, 480, 0.38], q: 1.6 } });
      v.noise({ at: 0.05, color: 'crackle', gain: 0.22, env: { a: 0.02, d: 0.3 }, filter: { type: 'bandpass', f: [2600, 900, 0.3], q: 0.8 } });
    },
  },
  debuffCleanse: {
    group: 'player', target: -21, maxVoices: 1, minInterval: 0.3, pitchVar: 0, reverb: 0.25, priority: 1,
    build(v) {
      // Bright wash: the ailment lifts — an airy sweep rising, a quick upward D-major sparkle and
      // a clean glint of air.
      v.noise({ color: 'pink', gain: 1.1, env: { pts: [[0.1, 1], [0.42, 0]] }, filter: { type: 'bandpass', f: [900, 6500, 0.28], q: 1.1 }, wet: 0.3 });
      v.noise({ color: 'white', gain: 0.28, env: { pad: true, a: 0.08, h: 0.1, r: 0.4 }, filter: { type: 'highpass', f: 7000, fixed: true }, wet: 0.4 });
      [74, 78, 81, 86].forEach((n, i) => {
        v.bell({ at: 0.03 + i * 0.045, f: midi(n), partials: P.chime, gain: 0.1, decay: 0.55 - i * 0.07, pan: -0.25 + i * 0.17, wet: 0.3, fixed: true });
      });
      v.shimmer({ at: 0.16, dur: 0.32, count: 5, notes: [90, 93, 98, 102], gain: 0.03, decay: 0.3 });
    },
  },

  // ---------------------------------------------------------------------------
  // Rimed Ossuary (GAME_SPEC §14): bone, ice, a cold choir. Swarmer sounds are banked.
  // ---------------------------------------------------------------------------
  boneRattle: {
    group: 'monster', target: -25, maxVoices: 4, minInterval: 0.05, pitchVar: 0.08, reverb: 0.08, priority: 0, burst: 'loudest', glue: true, bank: { variants: 6 },
    build(v) {
      // A Bone Thrall's clattering lunge: a burst of dry bone clacks (tight resonant knocks,
      // uneven spacing, falling away), a hollow knock of the skull and a short air swipe.
      let t = 0;
      for (let i = 0; i < 6; i++) {
        v.noise({ at: t, color: 'white', gain: 5.5 * (1 - i * 0.12) * v.rr(0.7, 1), env: { a: 0.0005, d: v.rr(0.018, 0.032) }, filter: { type: 'bandpass', f: v.rr(1300, 2700), q: 4 } });
        t += v.rr(0.018, 0.042);
      }
      v.bell({ f: v.rr(430, 520), partials: BONE, gain: 0.16, decay: 0.08 });
      v.noise({ color: 'pink', gain: 1.1, env: { pts: [[0.03, 1], [0.12, 0]] }, filter: { type: 'bandpass', f: [600, 1500, 0.1], q: 1.4 } });
    },
  },
  ghostWail: {
    group: 'monster', target: -24, maxVoices: 2, minInterval: 0.25, pitchVar: 0.08, reverb: 0.2, priority: 1, burst: 'loudest',
    build(v) {
      // A Rimeshade: an eerie, breathy "oo" wail that swoops up and sags away — a soft sine and
      // triangle a third of a semitone apart (a queasy beat) with a wide vibrato, a whisper of
      // breath riding the same contour, and a faint high ghost an octave and a fifth above.
      const f0 = v.rr(500, 580);
      const contour = (k: number) => ({ pts: [[0, f0 * 0.78 * k], [0.18, f0 * 1.3 * k], [0.62, f0 * 0.6 * k]] as [number, number][] });
      const env = { pad: true, a: 0.1, h: 0.36, r: 0.26 } as const;
      const vib = { rate: 6.2, cents: 42, delay: 0.06 };
      v.tone({ type: 'sine', f: contour(1), gain: 0.2, env, vib, wet: 0.22, echo: 0.1 });
      v.tone({ type: 'triangle', f: contour(1), detune: 34, gain: 0.12, env, vib, filter: { type: 'lowpass', f: 1800 }, wet: 0.22 });
      v.noise({ color: 'pink', gain: 0.8, env, filter: { type: 'bandpass', f: contour(2.6), q: 4 }, wet: 0.2 });
      v.tone({ type: 'sine', f: contour(3), gain: 0.018, env: { pad: true, a: 0.14, h: 0.3, r: 0.26 }, vib, wet: 0.5 });
    },
  },
  webShot: {
    group: 'monster', target: -23, maxVoices: 3, minInterval: 0.08, pitchVar: 0.08, reverb: 0.12, priority: 1, burst: 'loudest', glue: true,
    build(v) {
      // A Frost Weaver's web: a sticky "thwip" (a wet resonant band snapping upward), an
      // elastic twang (a falling, wobbling sine) and a few frosty glints on the strand.
      v.noise({ color: 'pink', gain: 2.2, env: { pts: [[0.012, 1], [0.1, 0]] }, filter: { type: 'bandpass', f: [480, 2600, 0.07], q: 5 } });
      v.tone({ type: 'sine', f: [v.rr(420, 480), 210, 0.18], gain: 0.2, env: { a: 0.003, d: 0.22 }, vib: { rate: 17, cents: 60 } });
      v.click({ gain: 0.25, f: 3000, d: 0.012 });
      for (let i = 0; i < 3; i++) {
        v.bell({ at: 0.04 + i * 0.05 + v.rr(0, 0.02), f: v.rr(3800, 5200), partials: P.ping, gain: 0.04, decay: 0.1, pan: v.rr(-0.3, 0.3) });
      }
    },
  },
  wispPulse: {
    group: 'monster', target: -23, maxVoices: 5, minInterval: 0.1, pitchVar: 0.04, reverb: 0.25, priority: 1, burst: 'loudest',
    build(v) {
      // A Glacial Wisp's 0.7 s fuse (play it when the pulse ring appears; wispBurst lands at the
      // end): glass pings accelerating and climbing, over an icy tremolo hum and a hiss that
      // tighten into the burst — a countdown you learn to run from.
      [0, 0.2, 0.35, 0.47, 0.56, 0.62, 0.665].forEach((t, i) => {
        v.bell({ at: t, f: 1760 * Math.pow(2, (i * 2) / 12), partials: P.glass, gain: 0.05 + i * 0.012, decay: 0.12, pan: i % 2 ? 0.15 : -0.15 });
      });
      v.tone({ type: 'sine', f: { pts: [[0, 660], [0.7, 1320]] }, gain: 0.07, env: { pts: [[0.62, 1], [0.7, 0]] }, am: { rate: 14, depth: 0.6 }, wet: 0.3 });
      v.noise({ color: 'white', gain: 0.5, env: { pts: [[0.64, 1], [0.7, 0]] }, filter: { type: 'bandpass', f: [1500, 7000, 0.7], q: 3 } });
    },
  },
  wispBurst: {
    group: 'monster', target: -20, maxVoices: 3, minInterval: 0.06, pitchVar: 0.06, reverb: 0.25, priority: 1, burst: 'loudest',
    build(v) {
      // The ice shard shatters: a hard crack and cold blast, a spray of glass debris scattering
      // outward, a low body, and a frosty hiss.
      v.thump({ f: [220, 70, 0.08], gain: 0.7, d: 0.16, drive: 1.5 });
      v.click({ gain: 0.8, f: 3500, d: 0.02 });
      v.noise({ color: 'white', gain: 1.5, env: { a: 0.001, d: 0.1 }, filter: { type: 'bandpass', f: [6000, 2500, 0.1], q: 0.9 } });
      for (let i = 0; i < 7; i++) {
        v.bell({ at: i * 0.018 + v.rr(0, 0.03), f: v.rr(2200, 5200), partials: P.glass, gain: 0.06 * (1 - i * 0.08), decay: v.rr(0.1, 0.22), pan: v.rr(-0.5, 0.5) });
      }
      v.noise({ at: 0.02, color: 'pink', gain: 0.9, env: { a: 0.01, d: 0.34 }, filter: { type: 'highpass', f: 3000 }, wet: 0.3 });
    },
  },
  golemSlam: {
    group: 'monster', target: -19, maxVoices: 2, minInterval: 0.12, pitchVar: 0.05, reverb: 0.25, priority: 1, burst: 'loudest',
    build(v) {
      // An Ossuary Golem's frost slam: a massive bone-and-ice body hitting the floor — saturated
      // sub, ground rumble, ice splintering outward, a low glassy ring, a bone knock, cold air.
      v.thump({ f: [90, 28, 0.32], gain: 0.95, d: 0.55, drive: 2 });
      v.click({ gain: 0.6, f: 1600, d: 0.035 });
      v.noise({ color: 'brown', gain: 2.2, env: { a: 0.003, d: 0.6 }, filter: { type: 'lowpass', f: [1000, 120, 0.45] } });
      for (let i = 0; i < 4; i++) {
        v.noise({ at: 0.02 + i * 0.06 + v.rr(0, 0.03), color: 'white', gain: 1.3 - i * 0.22, env: { a: 0.0005, d: 0.045 }, filter: { type: 'bandpass', f: v.rr(2500, 5000), q: 1.8 } });
      }
      v.bell({ at: 0.01, f: v.rr(370, 420), partials: P.glass, gain: 0.1, decay: 0.8, wet: 0.3 });
      v.bell({ f: v.rr(150, 170), partials: BONE, gain: 0.14, decay: 0.25 });
      v.noise({ at: 0.05, color: 'white', gain: 0.45, env: { pad: true, a: 0.05, h: 0.1, r: 0.6 }, filter: { type: 'highpass', f: 4000 }, wet: 0.3 });
    },
  },
  choirSing: {
    group: 'boss', target: -21, maxVoices: 1, minInterval: 1.2, pitchVar: 0.02, reverb: 0.45, priority: 2, energyTau: 8,
    build(v) {
      // The Bone Chorister's Choir Wave: a cold, hollow choir on "o" swelling into D minor with a
      // flat ninth rubbing on top, sagging as it fades; a ring of frost whooshing outward, a
      // scatter of ice glints. The wave repeats every 4 s for the whole lieutenant fight, so the
      // hold is short and a long repetition memory (energyTau) settles back-to-back waves ~1.5 dB.
      const choir = v.formant('o', { wet: 0.55, echo: 0.15 });
      for (const n of [50, 57, 62, 65, 75]) {
        for (const dt of [-9, 8]) {
          v.tone({
            type: 'sawtooth', f: { pts: [[0, midi(n)], [0.75, midi(n)], [1.5, midi(n) * 0.97]] }, detune: dt + v.rr(-3, 3), gain: 0.05,
            env: { pad: true, a: 0.16, h: 0.35, r: 0.8 }, vib: { rate: v.rr(4.8, 5.6), cents: 12, delay: 0.15 }, to: choir,
          });
        }
      }
      v.noise({ at: 0.08, color: 'pink', gain: 1.3, env: { pts: [[0.12, 1], [0.7, 0]] }, filter: { type: 'bandpass', f: { pts: [[0, 400], [0.25, 2600], [0.7, 900]] }, q: 1.6 }, wet: 0.4 });
      v.shimmer({ at: 0.15, dur: 0.9, count: 7, notes: [86, 89, 93, 98], gain: 0.03 });
    },
  },
  wardenNova: {
    group: 'boss', target: -16, maxVoices: 2, minInterval: 0.3, pitchVar: 0.04, reverb: 0.4, priority: 2,
    build(v) {
      // The Hollow Warden's Frost Nova ring: a saturated sub hit, a freezing blast of air rushing
      // outward and down, an icy open-fifth chord ringing (glass), crackling frost and air.
      v.thump({ f: [130, 36, 0.35], gain: 0.95, d: 0.6, drive: 2 });
      v.click({ gain: 0.6, f: 3000, d: 0.03 });
      v.noise({
        color: 'pink', gain: 1.6, drive: 1.6, env: { pts: [[0.02, 1], [0.25, 0.5], [0.8, 0]] },
        filter: { type: 'bandpass', f: { pts: [[0, 3800], [0.3, 1400], [0.8, 500]] }, q: 1.2 },
      });
      ([[62, 0.16, 1.6, 0], [74, 0.2, 1.4, -0.25], [81, 0.16, 1.2, 0.25], [86, 0.11, 1.0, 0]] as const).forEach(([n, g, d, pan]) => {
        v.bell({ at: 0.005, f: midi(n), partials: P.glass, gain: g, decay: d, pan, wet: 0.45, echo: 0.1 });
      });
      v.crackle({ at: 0.03, dur: 0.8, gain: 0.22, hp: 3000 });
      v.noise({ color: 'white', gain: 0.4, env: { pad: true, a: 0.04, h: 0.25, r: 0.8 }, filter: { type: 'highpass', f: 6000, fixed: true }, wet: 0.5 });
    },
  },
  glacialSpikes: {
    group: 'boss', target: -19, maxVoices: 4, minInterval: 0.03, pitchVar: 0.08, reverb: 0.25, priority: 1, burst: 'loudest',
    build(v) {
      // One ice spike erupting from the floor (a line of them plays this spike by spike): a
      // ground crack, a crunching thrust upward, a bright icy "shing" and two splinters trailing.
      v.thump({ f: [160, 50, 0.1], gain: 0.8, d: 0.2, drive: 1.6 });
      v.noise({ color: 'white', gain: 1.4, env: { a: 0.001, d: 0.07 }, filter: { type: 'bandpass', f: [1500, 5000, 0.06], q: 1.2 } });
      v.crackle({ dur: 0.18, gain: 0.3, hp: 1800, lp: 8000 });
      v.bell({ at: 0.01, f: v.rr(1100, 1400), partials: P.glass, gain: 0.12, decay: 0.45, wet: 0.3 });
      v.tone({ at: 0.01, type: 'sine', f: [2400, 3400, 0.08], fm: { ratio: 1.41, index: [2.5, 0.3, 0.2] }, gain: 0.05, env: { a: 0.002, d: 0.3 }, wet: 0.3 });
      for (const [at, g] of [[0.07, 0.65], [0.13, 0.4]] as const) {
        v.noise({ at: at + v.rr(0, 0.02), color: 'white', gain: g, env: { a: 0.0005, d: 0.035 }, filter: { type: 'bandpass', f: v.rr(2500, 4500), q: 2 } });
      }
    },
  },
  icePrison: {
    group: 'boss', target: -18, maxVoices: 2, minInterval: 0.5, pitchVar: 0.02, reverb: 0.4, priority: 2,
    build(v) {
      // The Ice Prison forms around a player (play it when the ring appears; the capture itself is
      // debuffFreeze): ice crystals racing around the ring (glass grains swinging left↔right and
      // accelerating), a cold hum tightening upward, and a thin, tense shimmer left hanging.
      let t = 0;
      for (let i = 0; i < 12; i++) {
        v.bell({ at: t, f: midi(81 + [0, 5, 3, 7][i % 4]) * v.rr(0.995, 1.005), partials: P.glass, gain: 0.05 + i * 0.004, decay: 0.22, pan: Math.sin(i * 1.4) * 0.7, wet: 0.3 });
        t += 0.11 * Math.pow(0.88, i);
      }
      v.tone({ type: 'sine', f: { pts: [[0, 392], [0.8, 784]] }, gain: 0.08, env: { pad: true, a: 0.5, h: 0.3, r: 0.7 }, am: { rate: 9, depth: 0.4 }, wet: 0.4 });
      v.tone({ type: 'triangle', f: { pts: [[0, 196], [0.8, 392]] }, gain: 0.07, env: { pad: true, a: 0.4, h: 0.35, r: 0.6 }, filter: { type: 'lowpass', f: 900 } });
      v.noise({ color: 'white', gain: 0.5, env: { pad: true, a: 0.6, h: 0.2, r: 0.8 }, filter: { type: 'bandpass', f: [2000, 7000, 0.8], q: 2 }, wet: 0.4 });
      v.crackle({ at: 0.1, dur: 0.8, gain: 0.12, hp: 4000 });
    },
  },
  blizzardLoop: {
    group: 'boss', target: -24, maxVoices: 3, minInterval: 0.4, pitchVar: 0.08, reverb: 0.35, priority: 1, burst: 'loudest',
    build(v) {
      // A drifting frost storm. One 2.7 s gust that fades in and out; replay it every ~2 s for the
      // storm zone nearest the listener while any lives, and the overlaps blend into one continuous
      // gale ('loudest': if several zones are requested in one frame, the nearest wins). Howling
      // resonant wind moving slowly, a second whistle band, a low roar and ice pellets.
      const env = { pad: true, a: 0.9, h: 0.8, r: 1.0 } as const;
      const lo = v.rr(480, 620);
      v.noise({ color: 'pink', gain: 2.6, env, filter: { type: 'bandpass', f: { pts: [[0, lo], [1.2, lo * 1.8], [2.7, lo * 1.1]] }, q: 8 }, wet: 0.4, pan: v.rr(-0.3, 0.3) });
      v.noise({ color: 'pink', gain: 1.5, env, filter: { type: 'bandpass', f: { pts: [[0, 1500], [1.5, 2100], [2.7, 1350]] }, q: 6 }, wet: 0.4, pan: v.rr(-0.3, 0.3) });
      v.noise({ color: 'pink', gain: 0.9, env, filter: { type: 'bandpass', f: 900, q: 0.8 }, am: { rate: v.rr(0.9, 1.4), depth: 0.6 } });
      v.noise({ color: 'brown', gain: 0.6, env, filter: { type: 'lowpass', f: 260 } });
      v.noise({ color: 'crackle', gain: 0.4, env, filter: { type: 'highpass', f: 5000, fixed: true }, pan: v.rr(-0.4, 0.4) });
    },
  },

  // ---------------------------------------------------------------------------
  // Iron Coliseum (GAME_SPEC §14): iron, chains, blades and the crowd.
  // ---------------------------------------------------------------------------
  houndBite: {
    group: 'monster', target: -24, maxVoices: 4, minInterval: 0.05, pitchVar: 0.1, reverb: 0.06, priority: 0, burst: 'loudest', glue: true, bank: { variants: 6 },
    build(v) {
      // A Pit Hound's bite: a short fluttering snarl, jaws snapping shut (a hard double
      // tooth-clack) and a wet tearing rip.
      v.tone({ type: 'sawtooth', f: [v.rr(150, 190), 240, 0.07], noiseFm: 40, gain: 0.2, env: { a: 0.008, d: 0.09 }, filter: { type: 'bandpass', f: 900, q: 1.5 }, am: { rate: 34, depth: 0.6 } });
      v.noise({ at: 0.045, color: 'white', gain: 3.2, env: { a: 0.0005, d: 0.018 }, filter: { type: 'bandpass', f: v.rr(1800, 2400), q: 4 } });
      v.noise({ at: 0.06, color: 'white', gain: 2.2, env: { a: 0.0005, d: 0.015 }, filter: { type: 'bandpass', f: v.rr(2400, 3000), q: 4 } });
      v.thump({ at: 0.045, f: [260, 120, 0.03], gain: 0.35, d: 0.05 });
      v.noise({ at: 0.055, color: 'pink', gain: 1.6, env: { a: 0.004, d: 0.1 }, filter: { type: 'bandpass', f: [1700, 700, 0.1], q: 2 } });
    },
  },
  chainThrow: {
    group: 'monster', target: -22, maxVoices: 3, minInterval: 0.1, pitchVar: 0.06, reverb: 0.15, priority: 1, burst: 'loudest',
    build(v) {
      // A hook flung on a chain: a whirring throw, the chain paying out in a rattling run of iron
      // links, and the hook's bright ring.
      v.noise({ color: 'pink', gain: 1.5, env: { pts: [[0.05, 1], [0.18, 0]] }, filter: { type: 'bandpass', f: [500, 2400, 0.12], q: 2 } });
      let t = 0.03;
      for (let i = 0; i < 9; i++) {
        const g = 1 - i * 0.07;
        v.bell({ at: t, f: v.rr(2600, 4200), partials: LINK, gain: 0.1 * g, decay: v.rr(0.04, 0.08) });
        v.noise({ at: t, color: 'white', gain: 1.6 * g, env: { a: 0.0005, d: 0.012 }, filter: { type: 'bandpass', f: v.rr(4000, 6000), q: 3 } });
        t += v.rr(0.022, 0.04);
      }
      v.bell({ at: 0.02, f: v.rr(1500, 1700), partials: P.anvil, gain: 0.07, decay: 0.35, wet: 0.2 });
    },
  },
  crossbowAim: {
    group: 'monster', target: -25, maxVoices: 5, minInterval: 0.1, pitchVar: 0.04, reverb: 0.08, priority: 1, burst: 'loudest',
    build(v) {
      // An Iron Crossbowman taking aim (the 0.6 s aim line): the windlass ratchet clicking tighter
      // and faster, a creaking string drawing taut, and the latch catching just before the shot.
      let t = 0;
      for (let i = 0; i < 9; i++) {
        v.noise({ at: t, color: 'white', gain: 2.4, env: { a: 0.0005, d: 0.012 }, filter: { type: 'bandpass', f: 2500 + i * 130, q: 5 } });
        t += 0.075 * Math.pow(0.9, i);
      }
      v.tone({
        type: 'sawtooth', f: { pts: [[0, 70], [0.5, 106]] }, noiseFm: 8, gain: 0.14, env: { pts: [[0.1, 0.6], [0.48, 1], [0.52, 0]] },
        filter: { type: 'bandpass', f: [700, 1200, 0.5], q: 6 }, am: { rate: 22, depth: 0.6, type: 'triangle' },
      });
      v.noise({ at: 0.54, color: 'white', gain: 1.8, env: { a: 0.0005, d: 0.02 }, filter: { type: 'bandpass', f: 1800, q: 2 } });
      v.thump({ at: 0.54, f: [300, 180, 0.03], gain: 0.2, d: 0.05 });
    },
  },
  crossbowShot: {
    group: 'monster', target: -22, maxVoices: 3, minInterval: 0.06, pitchVar: 0.06, reverb: 0.1, priority: 0, burst: 'loudest', glue: true, bank: { variants: 6 },
    build(v) {
      // The bolt looses: a hard trigger clack, the bowstring's low wobbling twang, the stock's
      // thump, and the bolt whizzing away.
      v.click({ gain: 0.7, f: 2000, d: 0.015 });
      v.tone({ type: 'triangle', f: [v.rr(150, 175), 118, 0.1], gain: 0.28, env: { a: 0.001, d: 0.16 }, vib: { rate: 30, cents: 40 }, filter: { type: 'lowpass', f: 1800 } });
      v.thump({ f: [200, 80, 0.05], gain: 0.5, d: 0.09 });
      v.noise({ at: 0.01, color: 'pink', gain: 1.8, env: { pts: [[0.015, 1], [0.16, 0]] }, filter: { type: 'bandpass', f: [4200, 1500, 0.16], q: 3 } });
    },
  },
  shieldBlock: {
    group: 'combat', target: -23, maxVoices: 4, minInterval: 0.04, pitchVar: 0.07, reverb: 0.12, priority: 0, burst: 'loudest', glue: true, bank: { variants: 6 },
    build(v) {
      // A projectile glancing off a tower shield — flank it! A hard metallic clank (strike +
      // plate modes ringing briefly), a dull body thump and a bright deflecting "tang".
      v.click({ gain: 0.7, f: 2200, d: 0.02 });
      v.thump({ f: [180, 90, 0.05], gain: 0.5, d: 0.08 });
      v.bell({ f: v.rr(520, 620), partials: PLATE, gain: 0.14, decay: 0.26 });
      v.bell({ at: 0.004, f: v.rr(2100, 2500), partials: P.anvil, gain: 0.05, decay: 0.16 });
    },
  },
  tarSplat: {
    group: 'monster', target: -22, maxVoices: 3, minInterval: 0.06, pitchVar: 0.08, reverb: 0.1, priority: 0, burst: 'loudest', glue: true, bank: { variants: 5 },
    build(v) {
      // A glob of tar lands and spreads: a heavy wet "splort" (a low blob and a resonant squelch
      // sliding down), then thick, slow bubbles popping.
      v.thump({ f: [190, 60, 0.08], gain: 0.7, d: 0.14 });
      v.noise({ color: 'pink', gain: 2.0, env: { a: 0.002, d: 0.16 }, filter: { type: 'bandpass', f: [900, 280, 0.14], q: 5 } });
      v.noise({ color: 'white', gain: 0.6, env: { a: 0.001, d: 0.04 }, filter: { type: 'bandpass', f: 1500, q: 1.5 } });
      for (let i = 0; i < 3; i++) {
        v.tone({ at: 0.1 + i * 0.07 + v.rr(0, 0.03), type: 'sine', f: [v.rr(140, 220), v.rr(320, 420), 0.04], gain: 0.14 - i * 0.03, env: { a: 0.003, d: 0.05 } });
      }
    },
  },
  chainWhirl: {
    group: 'boss', target: -19, maxVoices: 1, minInterval: 0.5, pitchVar: 0.04, reverb: 0.25, priority: 2, comboWindow: CHAIN_REV * 6 + 0.15,
    build(v) {
      // The Chainmaster whirls his chains (the spinning ring telegraph): a whoosh on every
      // revolution swinging across the stereo field, links rattling on each pass, a low drone.
      // One play is a 6-revolution spin (1.44 s) and a softer wind-down pass. A longer spin replays
      // it every 1.44 s: a replay inside the combo window continues the spin (full first turn, no
      // drone swell) and takes over the previous play's wind-down (maxVoices 1: a 20 ms crossfade).
      // The drone ignores the per-play pitch jitter so consecutive plays join without a step.
      const rev = CHAIN_REV;
      const cont = v.combo > 0;
      for (let i = 0; i < 7; i++) {
        const at = i * rev;
        const g = i === 0 && !cont ? 0.6 : i === 6 ? 0.45 : 1;
        const pan = i % 2 ? 0.35 : -0.35;
        v.noise({ at, color: 'pink', gain: 2.0 * g, env: { pts: [[0.1, 1], [0.24, 0]] }, filter: { type: 'bandpass', f: { pts: [[0, 520], [0.11, 2100], [0.24, 700]] }, q: 2.2 }, pan });
        for (let k = 0; k < 3; k++) {
          const lt = at + 0.08 + k * 0.025 + v.rr(0, 0.015);
          v.bell({ at: lt, f: v.rr(2600, 4000), partials: LINK, gain: 0.08 * g, decay: 0.06, pan });
          v.noise({ at: lt, color: 'white', gain: 1.4 * g, env: { a: 0.0005, d: 0.012 }, filter: { type: 'bandpass', f: v.rr(4000, 6000), q: 3 }, pan });
        }
      }
      const a = cont ? 0.03 : 0.2;
      v.tone({
        type: 'sawtooth', f: 55, fixed: true, gain: 0.08, env: { pad: true, a, h: 6 * rev - a, r: 0.3 },
        filter: { type: 'lowpass', f: 300, fixed: true }, am: { rate: 1 / rev, depth: 0.5 },
      });
    },
  },
  varkusCharge: {
    group: 'boss', target: -15, maxVoices: 1, minInterval: 0.5, pitchVar: 0.03, reverb: 0.3, priority: 2,
    duck: { music: 3, hold: 0.6, release: 0.6 },
    build(v) {
      // Varkus charges: a raw battle shout ("HAA" — gritty saws driven into an "a" vowel),
      // armoured footfalls accelerating (a thump and an iron jingle each), wind rushing past.
      const vowel = v.formant('a', { wet: 0.35, body: 0.5 });
      const throat = v.bus({ filter: { type: 'lowpass', f: { pts: [[0, 900], [0.12, 3000], [0.8, 1000]] }, q: 0.9 }, drive: 2.4, to: vowel });
      const env = { pad: true, a: 0.05, h: 0.42, r: 0.35 } as const;
      v.tone({ type: 'sawtooth', f: { pts: [[0, 118], [0.1, 158], [0.8, 124]] }, noiseFm: 18, gain: 0.3, env, vib: { rate: 6, cents: 20, delay: 0.1 }, to: throat });
      v.tone({ type: 'sawtooth', f: { pts: [[0, 177], [0.1, 237], [0.8, 186]] }, noiseFm: 24, gain: 0.18, env, to: throat });
      v.noise({ color: 'pink', gain: 1.1, env, filter: { type: 'bandpass', f: 1300, q: 1 }, to: throat });
      [0.05, 0.25, 0.41, 0.54, 0.64, 0.72].forEach((t, i) => {
        v.thump({ at: t, f: [110, 44, 0.1], gain: 0.55 + i * 0.06, d: 0.2 });
        v.noise({ at: t, color: 'white', gain: 0.55, env: { a: 0.001, d: 0.05 }, filter: { type: 'bandpass', f: 3600, q: 2 } });
      });
      v.noise({ color: 'pink', gain: 1.6, env: { pts: [[0.3, 0.4], [0.75, 1], [0.95, 0]] }, filter: { type: 'bandpass', f: [400, 2200, 0.9], q: 1.2 } });
    },
  },
  varkusWhirl: {
    group: 'boss', target: -17, maxVoices: 1, minInterval: 0.4, pitchVar: 0.04, reverb: 0.25, priority: 2, comboWindow: VARKUS_REV * 6 + 0.15,
    build(v) {
      // Varkus's whirlwind: a greatsword cutting circles — heavy, tonal blade swooshes about 3.5
      // turns a second, a steel edge ringing through them, and a deep spinning hum. One play is a
      // 6-turn spin (1.68 s) and a softer wind-down turn; a longer spin replays it every 1.68 s and
      // a replay inside the combo window continues it seamlessly, as chainWhirl (the blade is only
      // drawn — the bright "shing" — on the first play; ring and hum ignore the pitch jitter).
      const rev = VARKUS_REV;
      const cont = v.combo > 0;
      for (let i = 0; i < 7; i++) {
        const g = i === 0 && !cont ? 0.7 : i === 6 ? 0.5 : 1;
        v.noise({ at: i * rev, color: 'pink', gain: 2.4 * g, env: { pts: [[0.12, 1], [0.27, 0]] }, filter: { type: 'bandpass', f: { pts: [[0, 330], [0.13, 1400], [0.27, 420]] }, q: 3 }, pan: i % 2 ? 0.25 : -0.25 });
      }
      if (!cont) v.bell({ f: v.rr(1750, 1900), partials: BLADE, gain: 0.08, decay: 1.4, wet: 0.35 });
      const ra = cont ? 0.03 : 0.05;
      v.tone({ type: 'sine', f: 1850, fixed: true, fm: { ratio: 1.41, index: [2, 0.5, 1] }, gain: 0.04, env: { pad: true, a: ra, h: 6 * rev - ra, r: 0.4 }, am: { rate: 1 / rev, depth: 0.7 }, wet: 0.35 });
      const ha = cont ? 0.03 : 0.15;
      v.tone({ type: 'sawtooth', f: 49, fixed: true, gain: 0.09, env: { pad: true, a: ha, h: 6 * rev - ha, r: 0.35 }, filter: { type: 'lowpass', f: 260, fixed: true }, am: { rate: 1 / rev, depth: 0.6 } });
    },
  },
  executionMark: {
    group: 'boss', target: -16, maxVoices: 1, minInterval: 0.5, pitchVar: 0, reverb: 0.4, priority: 2, impact: 0.18,
    duck: { music: 4, hold: 1, release: 1 },
    build(v) {
      // Varkus marks a player (the strike lands 3 s later): a greatsword scraping out of its
      // sheath into a long steel ring, a deep execution knell on D with a tritone growl under it,
      // and a heartbeat double drum.
      const hit = 0.18;
      v.noise({ color: 'white', gain: 0.8, env: { pts: [[0.03, 1], [hit + 0.02, 0]] }, filter: { type: 'bandpass', f: [2400, 6500, hit], q: 3, fixed: true } });
      v.bell({ at: hit, f: 2200, partials: BLADE, gain: 0.07, decay: 1.2, wet: 0.4, echo: 0.15, fixed: true });
      v.bell({ at: hit, f: midi(38), partials: P.church, gain: 0.22, decay: 2.8, wet: 0.5, fixed: true });
      v.bell({ at: hit, f: midi(50), partials: P.church, gain: 0.08, decay: 2.0, wet: 0.5, fixed: true });
      v.tone({ at: hit, type: 'sawtooth', f: midi(44), fixed: true, gain: 0.07, env: { pad: true, a: 0.1, h: 0.5, r: 0.8 }, filter: { type: 'lowpass', f: 700, fixed: true }, wet: 0.35 });
      v.drum({ at: hit, f: [90, 42, 0.2], gain: 0.48, d: 0.4, slap: 0.6, slapF: 450 });
      v.drum({ at: hit + 0.24, f: [80, 40, 0.2], gain: 0.34, d: 0.35, slap: 0.42, slapF: 450 });
    },
  },
  arenaSpikes: {
    group: 'boss', target: -19, maxVoices: 3, minInterval: 0.03, pitchVar: 0.06, reverb: 0.2, priority: 1, burst: 'loudest',
    build(v) {
      // Crowd's Favour: iron spikes punching up through the arena floor — a heavy mechanism
      // clunk, a fast metal scrape upward, a short steel ring, and dust.
      v.thump({ f: [140, 55, 0.08], gain: 0.8, d: 0.18, drive: 1.6 });
      v.click({ gain: 0.7, f: 1800, d: 0.025 });
      v.noise({ color: 'white', gain: 1.2, env: { pts: [[0.01, 1], [0.09, 0]] }, filter: { type: 'bandpass', f: [900, 5200, 0.08], q: 3 } });
      v.bell({ at: 0.03, f: v.rr(820, 950), partials: P.anvil, gain: 0.1, decay: 0.35, wet: 0.2 });
      v.noise({ at: 0.04, color: 'brown', gain: 1.4, env: { a: 0.004, d: 0.25 }, filter: { type: 'lowpass', f: 600 } });
    },
  },
  crowdRoar: {
    group: 'boss', target: -17, maxVoices: 1, minInterval: 2, pitchVar: 0.03, reverb: 0.5, priority: 2,
    duck: { music: 4, hold: 1.5, release: 1.2 },
    build(v) {
      // The Coliseum crowd erupts: a swelling roar of many rasping voices at scattered pitches,
      // each shouting a rising "ah" into a vowel bank; a babbling bed with uneven flutter;
      // scattered applause left and right; and stamping under it all.
      const crowd = v.formant('a', { wet: 0.5, body: 0.25 });
      for (let i = 0; i < 12; i++) {
        const f = v.rr(130, 320);
        v.tone({
          at: v.rr(0, 0.35), type: 'sawtooth', f: [f * 0.85, f, 0.25], noiseFm: v.rr(6, 14), detune: v.rr(-20, 20), gain: 0.03,
          env: { pad: true, a: 0.25, h: v.rr(0.7, 1.2), r: 0.8 }, vib: { rate: v.rr(4, 7), cents: 25 }, pan: v.rr(-0.7, 0.7), to: crowd,
        });
      }
      for (const rate of [3.3, 4.7, 6.1]) {
        v.noise({ color: 'pink', gain: 0.9, env: { pad: true, a: 0.3, h: 1.0, r: 0.9 }, am: { rate: rate * v.rr(0.9, 1.1), depth: 0.5 }, pan: v.rr(-0.5, 0.5), to: crowd });
      }
      for (const pan of [-0.6, 0.6]) {
        v.noise({ at: 0.15, color: 'crackle', gain: 0.5, env: { pad: true, a: 0.3, h: 0.9, r: 0.9 }, filter: { type: 'bandpass', f: 1900, q: 0.7, fixed: true }, pan, wet: 0.4 });
      }
      v.noise({ color: 'brown', gain: 1.4, env: { pad: true, a: 0.35, h: 0.8, r: 1.0 }, filter: { type: 'lowpass', f: 220 } });
      for (const t of [0.12, 0.6, 1.08]) v.drum({ at: t, f: [80, 44, 0.15], gain: 0.4, d: 0.35, slap: 0.4, slapF: 380, wet: 0.3 });
    },
  },
  // ---------------------------------------------------------------------------
  // Map events (Event Director v2): every event speaks with the same small vocabulary.
  // ---------------------------------------------------------------------------
  eventOmen: {
    group: 'flow', target: -19, maxVoices: 1, minInterval: 1, pitchVar: 0, reverb: 0.55, priority: 2, impact: 0.3,
    duck: { music: 2, hold: 1.2, release: 0.8 },
    build(v) {
      // A rising fifth on a low bell (D3 to A3) over a breath of wind: "something is here".
      v.noise({ color: 'pink', gain: 0.8, env: { pts: [[0.3, 1], [0.36, 0]] }, filter: { type: 'bandpass', f: [240, 1100, 0.3], q: 1.6 }, wet: 0.4 });
      v.bell({ at: 0.0, f: midi(50), partials: P.church, gain: 0.22, decay: 2.2, wet: 0.5, fixed: true });
      v.bell({ at: 0.3, f: midi(57), partials: P.church, gain: 0.26, decay: 2.8, wet: 0.55, fixed: true });
      v.tone({ at: 0.28, type: 'triangle', f: midi(45), fixed: true, gain: 0.07, env: { pad: true, a: 0.2, h: 0.5, r: 1.0 }, filter: { type: 'lowpass', f: 900, fixed: true }, wet: 0.4 });
    },
  },
  eventOnset: {
    group: 'flow', target: -16, maxVoices: 1, minInterval: 0.6, pitchVar: 0, reverb: 0.4, priority: 2,
    duck: { music: 3, hold: 0.8, release: 0.8 },
    build(v) {
      v.drum({ f: [110, 50, 0.3], gain: 0.9, d: 0.6, slap: 1.0, slapF: 600, wet: 0.3 });
      v.bell({ at: 0.02, f: midi(45), partials: P.gong, gain: 0.14, decay: 1.6, wet: 0.45, fixed: true });
      v.noise({ color: 'brown', gain: 0.9, env: { a: 0.01, d: 0.3 }, filter: { type: 'lowpass', f: 300 } });
    },
  },
  eventStep: {
    // Each objective step is one note higher (the D minor pentatonic of the mote ladder), like the level-up ladder.
    group: 'flow', target: -21, maxVoices: 3, minInterval: 0.08, pitchVar: 0, reverb: 0.4, priority: 1, burst: 'defer',
    build(v) {
      // The presenter passes the ladder step as a pitch ratio (2^(semitones / 12)) over a D4 base.
      v.bell({ f: midi(62), partials: P.chime, gain: 0.3, decay: 1.1, wet: 0.35, echo: 0.15 });
      v.click({ gain: 0.25, f: 2400, d: 0.02 });
    },
  },
  eventLock: {
    // The Stalker's disc locks: a short rising whoosh and a tick, the heartbeat doubles.
    group: 'flow', target: -18, maxVoices: 1, minInterval: 0.5, pitchVar: 0.03, reverb: 0.25, priority: 2,
    build(v) {
      v.noise({ color: 'pink', gain: 1.1, env: { pts: [[0.28, 1], [0.34, 0]] }, filter: { type: 'bandpass', f: [400, 3400, 0.28], q: 2.2 } });
      v.click({ at: 0.0, gain: 0.5, f: 1600, d: 0.03 });
      v.thump({ at: 0.0, f: [150, 70, 0.1], gain: 0.5, d: 0.16 });
      v.thump({ at: 0.14, f: [130, 60, 0.1], gain: 0.55, d: 0.2 });
    },
  },
  eventWhiff: {
    group: 'flow', target: -17, maxVoices: 1, minInterval: 0.5, pitchVar: 0.03, reverb: 0.35, priority: 2, impact: 0.02,
    build(v) {
      // A hollow thud: a low body knock, a dry clack and a puff of dust.
      v.thump({ f: [96, 38, 0.2], gain: 0.9, d: 0.5, drive: 1.4 });
      v.click({ gain: 0.5, f: 700, d: 0.05 });
      v.noise({ color: 'brown', gain: 1.0, env: { a: 0.005, d: 0.22 }, filter: { type: 'lowpass', f: 700 } });
      v.bell({ at: 0.03, f: midi(43), partials: BONE, gain: 0.18, decay: 0.6, wet: 0.3, fixed: true });
    },
  },
  eventHit: {
    group: 'flow', target: -17, maxVoices: 1, minInterval: 0.5, pitchVar: 0.03, reverb: 0.3, priority: 2,
    build(v) {
      v.thump({ f: [140, 45, 0.25], gain: 1.0, d: 0.55, drive: 2 });
      v.noise({ color: 'pink', gain: 1.0, env: { a: 0.002, d: 0.14 }, filter: { type: 'lowpass', f: 2200 } });
    },
  },
  eventReturn: {
    group: 'flow', target: -21, maxVoices: 2, minInterval: 0.2, pitchVar: 0, reverb: 0.5, priority: 1, burst: 'defer',
    build(v) {
      // An echo reaches the anchor: a bell one step up the ladder (pitch ratio from the presenter), a soft violet swell.
      v.bell({ f: midi(50), partials: P.church, gain: 0.3, decay: 1.8, wet: 0.5 });
      v.tone({ type: 'sine', f: midi(38), gain: 0.08, env: { pad: true, a: 0.05, h: 0.2, r: 0.6 }, wet: 0.4 });
    },
  },
  eventSeal: {
    group: 'flow', target: -16, maxVoices: 1, minInterval: 1, pitchVar: 0, reverb: 0.55, priority: 2,
    duck: { music: 4, hold: 1.2, release: 1 },
    build(v) {
      // A full chord and a violet ring pulse: the rift closes.
      for (const [n, dt] of [[50, -5], [57, 4], [62, 0], [66, 3]] as const) {
        v.tone({ type: 'triangle', f: midi(n), fixed: true, detune: dt, gain: 0.09, env: { pad: true, a: 0.06, h: 0.6, r: 1.3 }, filter: { type: 'lowpass', f: 2200, fixed: true }, wet: 0.5 });
      }
      v.bell({ f: midi(74), partials: P.glass, gain: 0.16, decay: 2.0, wet: 0.5, fixed: true });
      v.drum({ f: [90, 48, 0.3], gain: 0.5, d: 0.6, slap: 0.4, slapF: 400, wet: 0.35 });
    },
  },
  eventErupt: {
    group: 'flow', target: -15, maxVoices: 1, minInterval: 1, pitchVar: 0, reverb: 0.5, priority: 2,
    duck: { music: 6, hold: 2, release: 1.5 },
    build(v) {
      // A slow downward drone under a swelling rumble: it is about to break.
      v.tone({ type: 'sawtooth', f: [110, 42, 2.2], gain: 0.16, env: { pad: true, a: 0.3, h: 1.6, r: 0.8 }, filter: { type: 'lowpass', f: 420, fixed: true }, wet: 0.35 });
      v.noise({ color: 'brown', gain: 1.6, env: { pad: true, a: 1.4, h: 0.6, r: 0.6 }, filter: { type: 'lowpass', f: 240 } });
      v.thump({ at: 2.1, f: [70, 24, 0.9], gain: 0.9, d: 0.9, drive: 2 });
    },
  },
  eventBronze: {
    group: 'flow', target: -18, maxVoices: 1, minInterval: 1, pitchVar: 0, reverb: 0.4, priority: 2, impact: 0.1,
    duck: { music: 3, hold: 1, release: 0.8 },
    build(v) {
      [62, 69].forEach((n, i) => v.bell({ at: 0.1 + i * 0.12, f: midi(n), partials: P.coin, gain: 0.18, decay: 1.4, wet: 0.35, fixed: true }));
      v.tone({ at: 0.08, type: 'triangle', f: midi(50), fixed: true, gain: 0.06, env: { pad: true, a: 0.1, h: 0.4, r: 0.8 }, wet: 0.4 });
    },
  },
  eventSilver: {
    group: 'flow', target: -17, maxVoices: 1, minInterval: 1, pitchVar: 0, reverb: 0.45, priority: 2, impact: 0.1,
    duck: { music: 4, hold: 1.2, release: 0.9 },
    build(v) {
      [62, 69, 74].forEach((n, i) => v.bell({ at: 0.1 + i * 0.1, f: midi(n), partials: P.silver, gain: 0.2, decay: 1.7, wet: 0.4, fixed: true }));
      for (const n of [50, 57, 62]) v.tone({ at: 0.08, type: 'triangle', f: midi(n), fixed: true, gain: 0.05, env: { pad: true, a: 0.1, h: 0.5, r: 1.0 }, wet: 0.45 });
    },
  },
  eventGold: {
    group: 'flow', target: -15, maxVoices: 1, minInterval: 1, pitchVar: 0, reverb: 0.5, priority: 2, impact: 0.2,
    duck: { music: 6, hold: 1.6, release: 1.1 },
    build(v) {
      // The level-up ladder's bigger sibling: a D-major bell arpeggio, a warm pad and a spray of sparkles.
      v.noise({ color: 'pink', gain: 1.0, env: { pts: [[0.2, 1], [0.26, 0]] }, filter: { type: 'bandpass', f: [600, 4800, 0.2], q: 1.4 } });
      [62, 66, 69, 74, 78, 81].forEach((n, i) => v.bell({ at: 0.2 + i * 0.08, f: midi(n), partials: P.chime, gain: 0.2, decay: 1.9 - i * 0.1, pan: (i - 2.5) * 0.16, wet: 0.4, echo: 0.2, fixed: true }));
      for (const n of [50, 57, 62, 66]) v.tone({ at: 0.18, type: 'triangle', f: midi(n), fixed: true, gain: 0.06, env: { pad: true, a: 0.2, h: 0.8, r: 1.2 }, wet: 0.45 });
      v.shimmer({ at: 0.5, dur: 1.2, count: 12, notes: [86, 90, 93, 98], gain: 0.045 });
    },
  },
  eventFail: {
    // Never harsh: a slow deflate.
    group: 'flow', target: -20, maxVoices: 1, minInterval: 1, pitchVar: 0, reverb: 0.4, priority: 2,
    build(v) {
      v.tone({ type: 'triangle', f: [midi(57), midi(45), 1.0], fixed: true, gain: 0.12, env: { pad: true, a: 0.04, h: 0.35, r: 0.8 }, filter: { type: 'lowpass', f: 1200, fixed: true }, wet: 0.4 });
      v.noise({ color: 'pink', gain: 0.5, env: { a: 0.01, d: 0.6 }, filter: { type: 'lowpass', f: 500 } });
    },
  },
  eventBeat: {
    // The Stalker's heartbeat: lub-dub. The presenter plays it faster as the pounce nears.
    group: 'flow', target: -24, maxVoices: 2, minInterval: 0.25, pitchVar: 0.02, reverb: 0.2, priority: 1,
    build(v) {
      v.thump({ f: [78, 40, 0.12], gain: 0.9, d: 0.22 });
      v.thump({ at: 0.16, f: [68, 36, 0.12], gain: 0.7, d: 0.24 });
    },
  },
  eventHum: {
    // The Echoing's choir hum: one 2.4 s swell of a low D-minor chord, sung on two vowels (the formant filters stay put while the
    // presenter's pitch ratio lifts the voices with every Resonance). Replayed every 2 s, the overlaps blend into one held chord.
    group: 'flow', target: -26, maxVoices: 2, minInterval: 1, pitchVar: 0, reverb: 0.6, priority: 1, burst: 'loudest',
    build(v) {
      const env = { pad: true, a: 0.9, h: 0.8, r: 0.7 } as const;
      for (const [n, dt, formant] of [[38, -6, 700], [45, 5, 1100], [50, -3, 700], [53, 4, 450]] as const) {
        v.tone({ type: 'sawtooth', f: midi(n), detune: dt, gain: 0.05, env, filter: { type: 'bandpass', f: formant, q: 2.4, fixed: true }, wet: 0.5 });
      }
      v.tone({ type: 'triangle', f: midi(26), gain: 0.05, env, filter: { type: 'lowpass', f: 300, fixed: true }, wet: 0.3 });
      v.noise({ color: 'pink', gain: 0.22, env, filter: { type: 'bandpass', f: 1600, q: 1.4, fixed: true }, wet: 0.5 });
    },
  },
  wheelBreak: {
    // A cartwheel gives way: a wooden crack, a splintering rattle and a low thud as the axle drops.
    group: 'flow', target: -17, maxVoices: 2, minInterval: 0.3, pitchVar: 0.05, reverb: 0.25, priority: 2, impact: 0.0,
    build(v) {
      v.click({ gain: 0.7, f: 900, d: 0.04 });
      v.noise({ color: 'pink', gain: 1.0, env: { a: 0.002, d: 0.22 }, filter: { type: 'bandpass', f: [1800, 500, 0.2], q: 1.4 } });
      v.crackle({ at: 0.03, dur: 0.35, gain: 0.25, hp: 1500 });
      v.thump({ at: 0.06, f: [110, 42, 0.2], gain: 0.8, d: 0.35, drive: 1.3 });
      v.bell({ at: 0.04, f: midi(41), partials: BONE, gain: 0.12, decay: 0.5, wet: 0.2, fixed: true });
    },
  },
  shieldBreak: {
    // The shield line drops: a glassy ring that shatters downward, a cold chime of release.
    group: 'flow', target: -19, maxVoices: 1, minInterval: 0.4, pitchVar: 0.03, reverb: 0.4, priority: 2,
    build(v) {
      v.bell({ f: midi(86), partials: P.glass, gain: 0.2, decay: 0.9, wet: 0.45, fixed: true });
      v.bell({ at: 0.05, f: midi(79), partials: P.glass, gain: 0.18, decay: 1.0, wet: 0.45, fixed: true });
      v.noise({ color: 'white', gain: 0.6, env: { a: 0.002, d: 0.3 }, filter: { type: 'highpass', f: 3500, fixed: true }, wet: 0.3 });
      v.crackle({ at: 0.0, dur: 0.3, gain: 0.2, hp: 4500 });
      v.tone({ at: 0.02, type: 'triangle', f: [midi(62), midi(50), 0.4], fixed: true, gain: 0.08, env: { pad: true, a: 0.02, h: 0.15, r: 0.4 }, wet: 0.3 });
    },
  },
  pactStone: {
    // A stone grinding under a foot: dry scrape, a low knock and a faint bell that settles.
    group: 'flow', target: -24, maxVoices: 1, minInterval: 0.3, pitchVar: 0.03, reverb: 0.4, priority: 1,
    build(v) {
      v.noise({ color: 'brown', gain: 1.2, env: { a: 0.02, d: 0.5 }, filter: { type: 'lowpass', f: [420, 160, 0.5] } });
      v.noise({ color: 'pink', gain: 0.5, env: { pts: [[0.1, 0.8], [0.45, 0]] }, filter: { type: 'bandpass', f: [900, 400, 0.4], q: 2 } });
      v.thump({ at: 0.02, f: [90, 48, 0.2], gain: 0.6, d: 0.3 });
      v.bell({ at: 0.05, f: midi(52), partials: P.church, gain: 0.1, decay: 1.4, wet: 0.5, fixed: true });
    },
  },
  pactSeal: {
    // The bargain is struck: a gong, a low fifth under it and a closing tick. Deep and final, never bright.
    group: 'flow', target: -17, maxVoices: 1, minInterval: 0.6, pitchVar: 0, reverb: 0.5, priority: 2, impact: 0.02,
    duck: { music: 3, hold: 0.9, release: 0.8 },
    build(v) {
      v.bell({ f: midi(40), partials: P.gong, gain: 0.3, decay: 2.6, wet: 0.5, fixed: true });
      v.bell({ at: 0.04, f: midi(47), partials: P.gong, gain: 0.16, decay: 2.0, wet: 0.5, fixed: true });
      v.drum({ f: [100, 46, 0.3], gain: 0.6, d: 0.5, slap: 0.5, slapF: 500, wet: 0.3 });
      v.click({ at: 0.0, gain: 0.4, f: 1800, d: 0.03 });
    },
  },
  pactWave: {
    // The pact takes hold: a slow low drone that swells under a soft drum, like a door closing on the wave.
    group: 'flow', target: -18, maxVoices: 1, minInterval: 1, pitchVar: 0, reverb: 0.5, priority: 2,
    duck: { music: 3, hold: 1.0, release: 0.9 },
    build(v) {
      v.tone({ type: 'sawtooth', f: [82, 62, 1.2], gain: 0.1, env: { pad: true, a: 0.3, h: 0.7, r: 0.6 }, filter: { type: 'lowpass', f: 380, fixed: true }, wet: 0.4 });
      v.noise({ color: 'brown', gain: 1.0, env: { pad: true, a: 0.5, h: 0.4, r: 0.5 }, filter: { type: 'lowpass', f: 220 } });
      v.drum({ at: 0.8, f: [90, 44, 0.25], gain: 0.7, d: 0.5, slap: 0.4, slapF: 420, wet: 0.3 });
    },
  },
  bloomGrow: {
    // A bloom ripens a stage: a soft wooden pluck and a warm bell. The presenter passes the ladder step as the pitch ratio.
    group: 'flow', target: -24, maxVoices: 3, minInterval: 0.15, pitchVar: 0, reverb: 0.35, priority: 1, burst: 'defer',
    build(v) {
      v.bell({ f: midi(64), partials: P.chime, gain: 0.22, decay: 0.9, wet: 0.35, echo: 0.1 });
      v.tone({ type: 'triangle', f: midi(52), gain: 0.08, env: { a: 0.004, d: 0.3 }, wet: 0.3 });
      v.noise({ color: 'pink', gain: 0.3, env: { a: 0.002, d: 0.07 }, filter: { type: 'bandpass', f: 1800, q: 1.5 } });
    },
  },
  bloomHarvest: {
    // A harvest: a rustle of leaves, a pop and two rising bells.
    group: 'flow', target: -19, maxVoices: 2, minInterval: 0.3, pitchVar: 0.03, reverb: 0.35, priority: 2,
    build(v) {
      v.noise({ color: 'pink', gain: 0.9, env: { pts: [[0.03, 1], [0.3, 0]] }, filter: { type: 'bandpass', f: [1400, 3800, 0.25], q: 1.2 } });
      v.click({ gain: 0.5, f: 1200, d: 0.03 });
      [62, 69].forEach((n, i) => v.bell({ at: 0.06 + i * 0.1, f: midi(n), partials: P.coin, gain: 0.2, decay: 1.2, wet: 0.35, fixed: true }));
    },
  },
  bloomBite: {
    // A monster gnaws the bloom: a short wet crunch. Cheap and low, it repeats.
    group: 'flow', target: -27, maxVoices: 2, minInterval: 0.12, pitchVar: 0.08, reverb: 0.15, priority: 0, glue: true,
    build(v) {
      v.noise({ color: 'brown', gain: 1.0, env: { a: 0.002, d: 0.09 }, filter: { type: 'lowpass', f: 900 } });
      v.noise({ color: 'pink', gain: 0.6, env: { a: 0.001, d: 0.03 }, filter: { type: 'bandpass', f: 2600, q: 1.5 } });
      v.thump({ f: [140, 70, 0.08], gain: 0.4, d: 0.1 });
    },
  },
  bloomWither: {
    // A bloom is lost: a dry exhale and a falling tone. Never harsh.
    group: 'flow', target: -22, maxVoices: 1, minInterval: 0.4, pitchVar: 0.03, reverb: 0.35, priority: 1,
    build(v) {
      v.noise({ color: 'pink', gain: 0.6, env: { a: 0.01, d: 0.5 }, filter: { type: 'lowpass', f: [1800, 400, 0.5] } });
      v.tone({ type: 'triangle', f: [midi(60), midi(48), 0.6], fixed: true, gain: 0.1, env: { pad: true, a: 0.02, h: 0.2, r: 0.4 }, filter: { type: 'lowpass', f: 1200, fixed: true }, wet: 0.35 });
    },
  },
  ringRise: {
    // The chains stand: a low iron grind under a rising run of links and a dull gong (the arena closes).
    group: 'flow', target: -16, maxVoices: 1, minInterval: 1, pitchVar: 0.02, reverb: 0.45, priority: 2,
    duck: { music: 3, hold: 1, release: 0.8 },
    build(v) {
      v.noise({ color: 'brown', gain: 1.5, env: { pad: true, a: 0.5, h: 0.5, r: 0.5 }, filter: { type: 'lowpass', f: { pts: [[0, 160], [1.2, 420]] } }, wet: 0.3 });
      for (let k = 0; k < 9; k++) v.click({ at: 0.1 + k * 0.1, gain: 0.35, f: 900 + k * 140, d: 0.03 });
      for (let k = 0; k < 7; k++) v.bell({ at: 0.15 + k * 0.12, f: midi(74 + (k % 3) * 2), partials: P.anvil, gain: 0.06, decay: 0.3, wet: 0.2, fixed: true });
      v.bell({ at: 0.95, f: midi(38), partials: P.gong, gain: 0.2, decay: 1.8, wet: 0.45, fixed: true });
      v.thump({ at: 0.95, f: [90, 38, 0.25], gain: 0.8, d: 0.5, drive: 1.6 });
    },
  },
  ringChain: {
    // A vow is taken / the chains drop: a rattle of links and one heavy clank.
    group: 'flow', target: -19, maxVoices: 2, minInterval: 0.4, pitchVar: 0.04, reverb: 0.3, priority: 2,
    build(v) {
      for (let k = 0; k < 6; k++) v.click({ at: k * 0.045, gain: 0.45 - k * 0.04, f: 1500 + v.rr(-300, 300), d: 0.025 });
      v.bell({ f: midi(50), partials: P.anvil, gain: 0.28, decay: 0.7, wet: 0.25, fixed: true });
      v.noise({ color: 'pink', gain: 0.6, env: { a: 0.002, d: 0.18 }, filter: { type: 'bandpass', f: 2600, q: 1.4 } });
    },
  },
  ringSlam: {
    // The Champion commits (a lane charge or a slam is telegraphed): a short rising whoosh, a chain snap and a heavy low knock.
    group: 'flow', target: -17, maxVoices: 1, minInterval: 0.6, pitchVar: 0.03, reverb: 0.3, priority: 2,
    build(v) {
      v.noise({ color: 'pink', gain: 1.0, env: { pts: [[0.32, 1], [0.4, 0]] }, filter: { type: 'bandpass', f: [300, 2600, 0.3], q: 2 } });
      v.thump({ at: 0.0, f: [120, 50, 0.15], gain: 0.8, d: 0.25 });
      v.click({ at: 0.3, gain: 0.5, f: 1200, d: 0.03 });
      v.bell({ at: 0.3, f: midi(43), partials: P.anvil, gain: 0.16, decay: 0.5, wet: 0.2, fixed: true });
    },
  },
  hostThaw: {
    // One statue wakes: an ice crack, a small glassy tick and a breath of rime. Up to two dozen of them: short and soft.
    group: 'flow', target: -24, maxVoices: 3, minInterval: 0.12, pitchVar: 0.08, reverb: 0.35, priority: 1, burst: 'defer',
    build(v) {
      v.click({ gain: 0.6, f: 3200, d: 0.02 });
      v.crackle({ at: 0.01, dur: 0.25, gain: 0.18, hp: 3500 });
      v.bell({ at: 0.02, f: midi(86 + Math.round(v.rr(-3, 3))), partials: P.glass, gain: 0.12, decay: 0.6, wet: 0.4 });
      v.noise({ color: 'pink', gain: 0.5, env: { a: 0.01, d: 0.3 }, filter: { type: 'highpass', f: 2500 } });
    },
  },
  prismShatter: {
    // The Time Prism breaks: a bright burst of glass, a cascade of falling shards and a deep boom under it.
    group: 'flow', target: -14, maxVoices: 1, minInterval: 1, pitchVar: 0.02, reverb: 0.5, priority: 2, impact: 0.02,
    duck: { music: 5, hold: 1.5, release: 1 },
    build(v) {
      v.noise({ color: 'white', gain: 1.1, env: { a: 0.002, d: 0.3 }, filter: { type: 'highpass', f: 3000 }, wet: 0.3 });
      v.thump({ f: [110, 34, 0.35], gain: 1.0, d: 0.8, drive: 2 });
      for (let k = 0; k < 10; k++) v.bell({ at: 0.03 + k * 0.05, f: midi(98 - k * 2 + Math.round(v.rr(-1, 1))), partials: P.glass, gain: 0.12, decay: 0.9, wet: 0.45, pan: v.rr(-0.6, 0.6), fixed: true });
      v.crackle({ at: 0.05, dur: 0.9, gain: 0.2, hp: 4500 });
    },
  },
  hostWake: {
    // The shockwave lands and the whole host thaws at once: a swelling rumble, a chorus of cracks and a low horn-like drone.
    group: 'flow', target: -15, maxVoices: 1, minInterval: 1, pitchVar: 0.02, reverb: 0.5, priority: 2,
    duck: { music: 6, hold: 2, release: 1.4 },
    build(v) {
      v.noise({ color: 'brown', gain: 1.6, env: { pad: true, a: 0.3, h: 0.6, r: 0.9 }, filter: { type: 'lowpass', f: 300 } });
      v.tone({ type: 'sawtooth', f: [70, 48, 1.4], gain: 0.14, env: { pad: true, a: 0.2, h: 0.9, r: 0.7 }, filter: { type: 'lowpass', f: 380, fixed: true }, wet: 0.35 });
      for (let k = 0; k < 14; k++) v.click({ at: 0.05 + k * 0.045 + v.rr(0, 0.03), gain: 0.4, f: v.rr(2200, 4200), d: 0.02 });
      v.crackle({ at: 0.05, dur: 0.8, gain: 0.22, hp: 3000 });
      v.thump({ at: 0.0, f: [80, 30, 0.4], gain: 0.9, d: 0.9, drive: 1.8 });
    },
  },
  anvilStrike: {
    // A kill near the anvil: a hammer tick on hot iron. The presenter climbs the pentatonic ladder as it charges.
    group: 'flow', target: -23, maxVoices: 2, minInterval: 0.1, pitchVar: 0, reverb: 0.3, priority: 1, burst: 'defer', fixedPitch: true,
    build(v) {
      v.click({ gain: 0.5, f: 2600, d: 0.02 });
      v.bell({ f: midi(62), partials: P.coin, gain: 0.22, decay: 0.7, wet: 0.3 });
      v.thump({ f: [200, 90, 0.05], gain: 0.4, d: 0.12 });
    },
  },
  anvilCharged: {
    // Charged: three hammer blows rising, then a white-hot ring.
    group: 'flow', target: -17, maxVoices: 1, minInterval: 1, pitchVar: 0, reverb: 0.45, priority: 2,
    duck: { music: 3, hold: 1, release: 0.8 },
    build(v) {
      [0, 0.16, 0.32].forEach((t, k) => {
        v.thump({ at: t, f: [180 + k * 30, 80, 0.06], gain: 0.7, d: 0.18 });
        v.click({ at: t, gain: 0.5, f: 2200 + k * 300, d: 0.02 });
      });
      v.bell({ at: 0.34, f: midi(74), partials: P.gong, gain: 0.2, decay: 2.2, wet: 0.5, fixed: true });
      v.bell({ at: 0.36, f: midi(86), partials: P.chime, gain: 0.14, decay: 1.6, wet: 0.45, fixed: true });
      v.noise({ color: 'pink', gain: 0.6, env: { a: 0.3, d: 0.4 }, filter: { type: 'bandpass', f: [900, 5200, 0.35], q: 1.4 } });
    },
  },
  anvilForge: {
    // A boon is forged: a heavy strike, a hiss of quench and a warm bell.
    group: 'flow', target: -16, maxVoices: 1, minInterval: 0.6, pitchVar: 0, reverb: 0.45, priority: 2, impact: 0.02,
    duck: { music: 3, hold: 1, release: 0.8 },
    build(v) {
      v.thump({ f: [150, 50, 0.1], gain: 1.0, d: 0.4, drive: 1.8 });
      v.click({ gain: 0.6, f: 1800, d: 0.04 });
      v.noise({ color: 'white', gain: 0.5, env: { a: 0.02, d: 0.6 }, filter: { type: 'highpass', f: 4200, fixed: true } });
      [57, 64, 69].forEach((n, k) => v.bell({ at: 0.1 + k * 0.08, f: midi(n), partials: P.church, gain: 0.2, decay: 1.8, wet: 0.45, fixed: true }));
    },
  },
  bellToll: {
    // The great bell: a deep strike and a long church-bell tail. The presenter detunes it a little lower for each Dirge stack.
    group: 'boss', target: -15, maxVoices: 1, minInterval: 1, pitchVar: 0, reverb: 0.6, priority: 2, impact: 0.02,
    duck: { music: 5, hold: 1.4, release: 1.2 },
    build(v) {
      v.drum({ f: [95, 46, 0.3], gain: 0.7, d: 0.5, slap: 0.5, slapF: 500, wet: 0.35 });
      v.bell({ f: midi(38), partials: P.church, gain: 0.34, decay: 4.2, wet: 0.6, fixed: true });
      v.bell({ at: 0.01, f: midi(50), partials: P.church, gain: 0.26, decay: 3.4, wet: 0.55, fixed: true });
      v.bell({ at: 0.02, f: midi(57), partials: P.gong, gain: 0.14, decay: 2.6, wet: 0.5, fixed: true });
      v.noise({ color: 'brown', gain: 0.8, env: { a: 0.01, d: 0.4 }, filter: { type: 'lowpass', f: 320 } });
    },
  },
  cantorFall: {
    // A cantor falls silent: a choir note that breaks into a fading fall and a soft bell.
    group: 'flow', target: -18, maxVoices: 2, minInterval: 0.4, pitchVar: 0.03, reverb: 0.5, priority: 2,
    build(v) {
      v.tone({ type: 'triangle', f: [midi(62), midi(50), 0.9], fixed: true, gain: 0.14, env: { pad: true, a: 0.03, h: 0.25, r: 0.7 }, filter: { type: 'lowpass', f: 1600, fixed: true }, wet: 0.5 });
      v.bell({ at: 0.05, f: midi(69), partials: P.chime, gain: 0.2, decay: 1.4, wet: 0.45, fixed: true });
      v.noise({ color: 'pink', gain: 0.4, env: { a: 0.01, d: 0.3 }, filter: { type: 'lowpass', f: 900 } });
    },
  },
  dirge: {
    // The Dirge: a low choir drone swelling under the tolls, dark and slow.
    group: 'flow', target: -24, maxVoices: 1, minInterval: 0.6, pitchVar: 0.02, reverb: 0.5, priority: 1,
    build(v) {
      for (const [n, dt] of [[38, -6], [45, 5], [50, 0]] as const) {
        v.tone({ type: 'sawtooth', f: midi(n), fixed: true, detune: dt, gain: 0.06, env: { pad: true, a: 0.8, h: 1.2, r: 1.2 }, filter: { type: 'lowpass', f: 420, fixed: true }, wet: 0.45 });
      }
      v.noise({ color: 'brown', gain: 0.6, env: { pad: true, a: 0.9, h: 0.8, r: 1.0 }, filter: { type: 'lowpass', f: 200 } });
    },
  },
  voidTide: {
    // The void tide advances: a falling groan under a rushing wash, then a low thud as the band closes in.
    group: 'flow', target: -15, maxVoices: 1, minInterval: 1, pitchVar: 0, reverb: 0.55, priority: 2,
    duck: { music: 5, hold: 2, release: 1.4 },
    build(v) {
      v.tone({ type: 'sawtooth', f: [140, 46, 1.8], gain: 0.14, env: { pad: true, a: 0.25, h: 1.3, r: 0.7 }, filter: { type: 'lowpass', f: 380, fixed: true }, wet: 0.4 });
      v.tone({ type: 'sine', f: [97, 52, 1.8], detune: 14, gain: 0.1, env: { pad: true, a: 0.3, h: 1.2, r: 0.7 }, wet: 0.4 });
      v.noise({ color: 'brown', gain: 1.4, env: { pad: true, a: 1.2, h: 0.6, r: 0.6 }, filter: { type: 'lowpass', f: { pts: [[0, 200], [1.6, 700], [2.4, 260]] } } });
      v.noise({ color: 'pink', gain: 0.5, env: { pad: true, a: 1.0, h: 0.6, r: 0.7 }, filter: { type: 'bandpass', f: { pts: [[0, 600], [1.6, 2200], [2.4, 900]] }, q: 1.8 }, wet: 0.4 });
      v.thump({ at: 1.9, f: [80, 28, 0.6], gain: 0.8, d: 0.7, drive: 1.6 });
    },
  },
  voidSurge: {
    // A surge of the void: a dissonant rising cluster over a crackle, then a short dull blow.
    group: 'flow', target: -17, maxVoices: 1, minInterval: 1, pitchVar: 0.02, reverb: 0.45, priority: 2,
    duck: { music: 3, hold: 1, release: 0.8 },
    build(v) {
      for (const [n, dt] of [[45, -8], [46, 9], [52, 0]] as const) {
        v.tone({ type: 'triangle', f: [midi(n), midi(n + 7), 0.9], detune: dt, gain: 0.08, env: { pad: true, a: 0.3, h: 0.4, r: 0.5 }, filter: { type: 'lowpass', f: 1800, fixed: true }, wet: 0.4 });
      }
      v.crackle({ at: 0.3, dur: 0.8, gain: 0.14, hp: 2500, wet: 0.3 });
      v.noise({ color: 'pink', gain: 0.7, env: { pts: [[0.7, 1], [0.78, 0]] }, filter: { type: 'bandpass', f: [300, 2600, 0.7], q: 1.6 } });
      v.thump({ at: 0.85, f: [100, 40, 0.2], gain: 0.8, d: 0.35, drive: 1.4 });
    },
  },
  heartCrack: {
    // The Void Heart: its ward drops or it breaks. A glassy crack, a hollow bell and a low body blow.
    group: 'flow', target: -16, maxVoices: 1, minInterval: 0.6, pitchVar: 0.03, reverb: 0.5, priority: 2, impact: 0.02,
    duck: { music: 4, hold: 1.2, release: 1 },
    build(v) {
      v.click({ gain: 0.7, f: 3200, d: 0.03 });
      v.noise({ color: 'white', gain: 0.6, env: { a: 0.002, d: 0.16 }, filter: { type: 'highpass', f: 3000 } });
      v.bell({ at: 0.02, f: midi(57), partials: P.glass, gain: 0.2, decay: 1.6, wet: 0.5, fixed: true });
      v.bell({ at: 0.06, f: midi(64), partials: P.glass, gain: 0.14, decay: 1.2, wet: 0.5, fixed: true });
      v.thump({ f: [110, 34, 0.25], gain: 0.9, d: 0.6, drive: 1.6 });
      v.crackle({ at: 0.05, dur: 0.5, gain: 0.1, hp: 4000 });
    },
  },

  // ---------------------------------------------------------------------------
  // The Atlas (brief A 5.5, brief D slice F1): stone, brass and ember, quieter than combat
  // ---------------------------------------------------------------------------
  atlasOpen: {
    // The chart is unrolled on the table: a slate scrape (a brown-noise sweep) and one low bell.
    group: 'ui', target: -22, maxVoices: 1, minInterval: 0.4, pitchVar: 0.02, reverb: 0.4, priority: 1,
    build(v) {
      v.noise({ color: 'brown', gain: 1.6, env: { a: 0.04, h: 0.12, d: 0.22 }, filter: { type: 'bandpass', f: [260, 1400, 0.3], q: 0.9 } });
      v.noise({ color: 'pink', gain: 0.5, env: { a: 0.03, d: 0.25 }, filter: { type: 'highpass', f: [1800, 4200, 0.3] } });
      v.bell({ at: 0.18, f: midi(45), partials: P.church, gain: 0.14, decay: 1.6, wet: 0.45, fixed: true });
    },
  },
  atlasHover: {
    // A 25 ms soft tick on the plate.
    group: 'ui', target: -34, maxVoices: 2, minInterval: 0.05, pitchVar: 0.08, reverb: 0, priority: 0, bank: { variants: 4 },
    build(v) {
      v.click({ gain: 0.12, f: 3400, d: 0.01 });
      v.bell({ f: v.rr(1500, 1700), partials: P.dull, gain: 0.05, decay: 0.025 });
    },
  },
  atlasSelect: {
    // A stone chime: two partials a fifth apart.
    group: 'ui', target: -25, maxVoices: 2, minInterval: 0.06, pitchVar: 0.03, reverb: 0.18, priority: 1,
    build(v) {
      v.thump({ f: [220, 120, 0.04], gain: 0.25, d: 0.06 });
      v.bell({ f: midi(69), partials: P.silver, gain: 0.1, decay: 0.45, wet: 0.2 });
      v.bell({ at: 0.012, f: midi(76), partials: P.silver, gain: 0.07, decay: 0.38, wet: 0.2 });
    },
  },
  atlasRoute: {
    // The ember runs along the road to the new node: a crackle trail that follows the dot (0.8 s).
    group: 'flow', target: -27, maxVoices: 2, minInterval: 0.2, pitchVar: 0.05, reverb: 0.15, priority: 1,
    build(v) {
      v.crackle({ dur: 0.8, gain: 0.12, hp: 1800, lp: 7000, wet: 0.15 });
      v.noise({ color: 'pink', gain: 0.6, env: { a: 0.08, h: 0.5, d: 0.2 }, filter: { type: 'bandpass', f: [500, 1300, 0.8], q: 1.2 } });
    },
  },
  atlasReveal: {
    // A rising three-note bell ladder; the plate forges in on the last note (`impact`, read by sfxImpactDelay).
    group: 'flow', target: -18, maxVoices: 1, minInterval: 0.3, pitchVar: 0, reverb: 0.5, priority: 2, impact: 0.24, fixedPitch: true,
    duck: { music: 3, hold: 0.8, release: 0.8 },
    build(v) {
      [62, 66, 69].forEach((n, k) => v.bell({ at: k * 0.12, f: midi(n), partials: P.chime, gain: 0.12 + k * 0.03, decay: 1.2, wet: 0.45, fixed: true }));
      v.thump({ at: 0.24, f: [180, 70, 0.1], gain: 0.4, d: 0.18 });
      v.bell({ at: 0.24, f: midi(57), partials: P.anvil, gain: 0.08, decay: 0.7, wet: 0.35, fixed: true });
      v.crackle({ at: 0.24, dur: 0.4, gain: 0.08, hp: 3000 });
    },
  },
  atlasSeal: {
    // A sealed door opens: a chain drag, then a key turn and a latch (dual transient).
    group: 'ui', target: -22, maxVoices: 1, minInterval: 0.3, pitchVar: 0.03, reverb: 0.25, priority: 1, impact: 0.3,
    build(v) {
      for (let i = 0; i < 4; i++) v.bell({ at: i * 0.05 + v.rr(0, 0.015), f: v.rr(900, 1300), partials: LINK, gain: 0.05, decay: 0.12, pan: v.rr(-0.3, 0.3) });
      v.noise({ color: 'pink', gain: 0.7, env: { a: 0.02, d: 0.2 }, filter: { type: 'bandpass', f: 1500, q: 1.4 } });
      v.click({ at: 0.24, gain: 0.35, f: 2600, d: 0.02 });
      v.thump({ at: 0.3, f: [260, 120, 0.05], gain: 0.5, d: 0.09 });
      v.bell({ at: 0.3, f: v.rr(620, 680), partials: P.anvil, gain: 0.08, decay: 0.3, wet: 0.25 });
    },
  },
  atlasZoom: {
    // A soft paper slide, 120 ms.
    group: 'ui', target: -33, maxVoices: 2, minInterval: 0.08, pitchVar: 0.06, reverb: 0, priority: 0, bank: { variants: 4 },
    build(v) {
      v.noise({ color: 'pink', gain: 0.9, env: { a: 0.03, d: 0.09 }, filter: { type: 'bandpass', f: [1400, 2600, 0.12], q: 0.8 } });
    },
  },
  atlasPin: {
    // A brass pin pressed into the chart: a short tap and a small bright ring.
    group: 'ui', target: -24, maxVoices: 2, minInterval: 0.08, pitchVar: 0.04, reverb: 0.12, priority: 1,
    build(v) {
      v.click({ gain: 0.35, f: 3000, d: 0.012 });
      v.thump({ f: [240, 140, 0.03], gain: 0.3, d: 0.05 });
      v.bell({ at: 0.01, f: midi(81), partials: P.coin, gain: 0.07, decay: 0.32, wet: 0.15 });
    },
  },
  atlasUnpin: {
    // The pin pulled out: a falling, duller tick.
    group: 'ui', target: -27, maxVoices: 2, minInterval: 0.08, pitchVar: 0.04, reverb: 0.06, priority: 1,
    build(v) {
      v.noise({ color: 'pink', gain: 0.6, env: { a: 0.005, d: 0.06 }, filter: { type: 'highpass', f: [3200, 1600, 0.06] } });
      v.bell({ at: 0.02, f: midi(74), partials: P.dull, gain: 0.06, decay: 0.12 });
    },
  },
  surgeSpend: {
    // A surge charge spent at activation: an hourglass turned (a sand hiss) and a warm brass swell.
    group: 'flow', target: -21, maxVoices: 1, minInterval: 0.4, pitchVar: 0, reverb: 0.35, priority: 2, fixedPitch: true,
    build(v) {
      v.noise({ color: 'white', gain: 0.35, env: { a: 0.05, h: 0.2, d: 0.3 }, filter: { type: 'bandpass', f: [5200, 3600, 0.5], q: 1.6 } });
      v.tone({ type: 'triangle', f: midi(57), fixed: true, gain: 0.08, env: { a: 0.12, h: 0.15, d: 0.5 }, filter: { type: 'lowpass', f: 1600, fixed: true }, wet: 0.35 });
      v.bell({ at: 0.1, f: midi(69), partials: P.silver, gain: 0.1, decay: 0.9, wet: 0.35, fixed: true });
      v.bell({ at: 0.18, f: midi(76), partials: P.silver, gain: 0.08, decay: 0.8, wet: 0.35, fixed: true });
    },
  },
  surgeRefill: {
    // Hourglass Sand / Grand Hourglass: sand pours back up and three charges ring in.
    group: 'ui', target: -20, maxVoices: 1, minInterval: 0.3, pitchVar: 0, reverb: 0.35, priority: 1, fixedPitch: true,
    build(v) {
      v.noise({ color: 'white', gain: 0.35, env: { a: 0.1, h: 0.15, d: 0.2 }, filter: { type: 'bandpass', f: [3000, 6000, 0.4], q: 1.4 } });
      [69, 73, 76].forEach((n, k) => v.bell({ at: 0.12 + k * 0.08, f: midi(n), partials: P.coin, gain: 0.08, decay: 0.5, wet: 0.3, fixed: true }));
    },
  },
  // power rework SK2 roster batch 1 (sfx-skills.ts)
  ...ROSTER_SFX,
  // power rework SK3 roster batch 2 (sfx-skills2.ts)
  ...ROSTER2_SFX,
  // power rework SK4 roster batch 3 (sfx-skills3.ts)
  ...ROSTER3_SFX,
};
