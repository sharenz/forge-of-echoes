// ASHSEED ORCHARD (event id 'orchard'): data. docs/atlas-rework/C-map-events.md 7.3.
// Three blooms ripen over a minute. Harvest any time by standing at one; the riper the bloom, the better the yield. Monsters
// near a bloom and away from the party gnaw it.
import type { MapEventText } from '../map-events';

export const ORCHARD_NAME = 'Ashseed Orchard';
export const ORCHARD_MIN_TIER = 2;
export const ORCHARD_WINDOW: readonly [number, number] = [2, 4];
export const ORCHARD_COLOR: readonly [number, number, number] = [0.55, 0.78, 0.35];

export const ORCHARD_BLOOMS = 3;
/** Distance between blooms, and from every living player at the start. */
export const ORCHARD_SPACING: readonly [number, number] = [250, 450];
export const ORCHARD_CLEARANCE = 250;
/** Seconds since the pods burst at which a bloom reaches stage 1, 2 and 3 (ripe). */
export const ORCHARD_STAGE_SECONDS: readonly [number, number, number] = [15, 35, 60];
/** Unharvested blooms wither this long after the pods burst (the orchard ends). */
export const ORCHARD_WITHER_SECONDS = 90;
export const ORCHARD_DWELL = 1.5;
export const ORCHARD_HARVEST_RADIUS = 32;
/** A bloom has this many times the life of an ordinary bruiser of the map. */
export const ORCHARD_LIFE = 4;
export const ORCHARD_RADIUS = 13;
/** Monsters within this of a bloom, and farther than ORCHARD_PLAYER_GUARD from every player, turn on it. */
export const ORCHARD_DIVERT = 220;
export const ORCHARD_PLAYER_GUARD = 140;
export const ORCHARD_GNAW_SECONDS = 1;
/** A gnaw deals this share of the monster's own damage. */
export const ORCHARD_GNAW_SHARE = 0.6;
/** Sum of the harvested stages (max 9) for Bronze / Silver / Gold. */
export const ORCHARD_GRADE_POINTS: readonly [number, number, number] = [3, 6, 9];
/** EventRewardContext.choice of a harvest is kind * 4 + stage (stage >= 1); the final grade payout is choice 0. */
export const BLOOM_KIND_NAMES = ['Essence bloom', 'Seal bloom', 'Metal bloom'] as const;

export const ORCHARD_TEXT: MapEventText = {
  omen: 'Seed pods burst from the ground.',
  phases: { available: 'Pods stir', warning: 'The pods swell', active: 'Grow and harvest', complete: 'Orchard harvested', failed: 'The orchard withered' },
  objectives: ['Harvest (3 / 6 / 9)', 'Blooms left'],
  timers: ['Fully ripe'],
  hints: [
    'Stand at a ripening bloom to harvest it. Riper is richer.',
    'Monsters gnaw the weakest bloom when you are not near. Guard it or harvest early.',
    'Every bloom at full ripeness is Gold.',
    'The orchard is spent.',
  ],
};
