// VOID BREACH (event id 'voidBreach'): data. Designed for the Voidtouched Atlas keystone (a corrupted map always rolls it); see
// GAME_SPEC map events. The verb: the arena shrinks. A tide of void eats it from the rim in four steps; the party is squeezed toward
// the Void Heart, which is warded until the three Voidcallers are slain.
import type { MapEventText } from '../map-events';

export const BREACH_NAME = 'Void Breach';
export const BREACH_MIN_TIER = 6;
/** Waves 3 and 4 only: from the opening the breach needs ~90 s of a 60 s wave, so a wave-5 breach would run into the boss wave. */
export const BREACH_WINDOW: readonly [number, number] = [3, 4];
export const BREACH_COLOR: readonly [number, number, number] = [0.6, 0.3, 0.9];

/** Radius (units) of the field the tide starts from (clipped to the arena). */
export const BREACH_FIELD = 480;
/** Safe radius after each step, as a share of the field: the tide band runs from there to beyond the arena rim. */
export const BREACH_SAFE: readonly number[] = [1, 0.72, 0.5, 0.34];
export const BREACH_STEP_SECONDS = 14;
/** Seconds a tide band telegraphs (F1: above radius 60 it must be at least 1.8). */
export const BREACH_TELEGRAPH = 2.2;
/** Seconds between re-fired pulses of the current band (a fresh telegraph each), and once overflowing. */
export const BREACH_PULSE_SECONDS = 6;
export const BREACH_PULSE_OVERFLOW = 4.5;
export const BREACH_DAMAGE = 15;
export const BREACH_MONSTER_FRAC = 0.25;
/** The eye opens on its own this many seconds after it appeared if nobody walked up to it. */
export const BREACH_AUTO_OPEN = 20;
export const BREACH_REACH = 70;
export const BREACH_CLEARANCE = 250;
export const BREACH_HEART_LIFE = 14;
export const BREACH_HEART_RADIUS = 20;
export const BREACH_CALLERS = 3;
export const BREACH_CALLER_SHIMMER = 1.0;
export const BREACH_NOVA_SECONDS = 10;
export const BREACH_NOVA_RADIUS = 70;
export const BREACH_NOVA_DAMAGE = 12;
/** Seal time (s from the opening) for Gold / Silver. */
/** (The floor is ~45 s: the third Voidcaller only arrives at 43 s. A matched fair bot seals in 52-64 s: Gold on about a quarter of runs.) */
export const BREACH_GRADE_SECONDS: readonly [number, number] = [61.5, 86];
/** A smaller arena seals sooner: the thresholds scale with the roster's arena (Ashen and Ossuary 900, Coliseum 650). */
export const BREACH_SKIN_PACE = { ashen: 1, ossuary: 0.93, coliseum: 0.85 } as const;
export const BREACH_OVERFLOW_SECONDS = 130;
export const BREACH_SURGE_SECONDS = 12;
export const BREACH_SURGE_MONSTERS = 4;

export const BREACH_TEXT: MapEventText = {
  omen: 'Reality tears open.',
  phases: { available: 'A tear in the air', warning: 'The void breathes in', active: 'The tide rises', complete: 'Breach sealed', failed: 'The breach widened' },
  objectives: ['Voidcallers', 'Void Heart'],
  timers: ['Next tide', 'Gold pace', 'Overflow'],
  hints: [
    'A tear in the air. Walk to it, or it opens by itself.',
    'Stay inside the bright ring. Everything outside it is eaten.',
    'Slay the three voidcallers to drop the heart\'s ward.',
    'The ward is down. Break the Void Heart.',
    'The breach overflows. Finish it: Bronze at best.',
    'Sealed. A faster seal is a better trophy.',
    'The breach closes unfinished.',
  ],
};
