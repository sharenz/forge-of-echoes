// STASIS HOST (event id 'host'): data. docs/atlas-rework/C-map-events.md 7.5, GAME_SPEC map events.
import type { MapEventText } from '../map-events';

export const HOST_NAME = 'Stasis Host';
export const HOST_MIN_TIER = 6;
export const HOST_WINDOW: readonly [number, number] = [3, 5];
export const HOST_COLOR: readonly [number, number, number] = [0.5, 0.85, 0.95];

export const HOST_STATUES = 24;
export const HOST_INNER_RADIUS = 120;
export const HOST_OUTER_RADIUS = 190;
export const HOST_PRISM_RADIUS = 18;
/** Prism life as a multiple of a bruiser's scaled life. */
export const HOST_PRISM_LIFE = 10;
/** A site this far from every living player (statues stand up to HOST_OUTER_RADIUS round it: F4 keeps them at least 250 away). */
export const HOST_CLEARANCE = 440;
/** Thaw bar percent per second and per credited kill on the map; a statue wakes every 100 / statues percent. */
export const HOST_THAW_PER_SECOND = 1;
export const HOST_THAW_PER_KILL = 1.5;
/** Extra item quantity (percent) on the loot of every statue. */
export const HOST_LOOT_QUANTITY = 60;
/** The shockwave of a shattered prism: radius, telegraph (F1: above 60 u it waits 1.8 s; 2.0 s here) and damage. */
export const HOST_SHOCK_RADIUS = 210;
export const HOST_SHOCK_SECONDS = 2;
export const HOST_SHOCK_DAMAGE = 20;
export const HOST_THAW_SHIMMER = 0.9;
/** Seconds from the onset until the last statue falls, for Gold / Silver; any full clear is Bronze. */
export const HOST_GRADE_SECONDS: readonly [number, number] = [31, 90];
/** The roster's terrain decides how fast a fair build clears the legion: thresholds stretch for Ossuary and Coliseum. */
export const HOST_SKIN_PACE = { ashen: 1, ossuary: 1.15, coliseum: 1.35 } as const;
/** At the boss wave the host is released; at least this share of the statues fallen still pays Bronze. */
export const HOST_PARTIAL_SHARE = 0.75;

export const HOST_TEXT: MapEventText = {
  omen: 'A frozen legion stands in the ice.',
  phases: { available: 'A time prism hums', warning: 'The ice cracks', active: 'The host thaws', complete: 'Host broken', failed: 'The host thawed' },
  objectives: ['Thaw', 'Statues'],
  timers: ['Gold pace'],
  hints: [
    'Shatter the prism to thaw them all at once, or let them wake in streams.',
    'Every kill thaws the next statue. Break the prism for double loot.',
    'The prism broke. Leave the shockwave ring.',
    'Fully thawed. Finish them.',
  ],
};
