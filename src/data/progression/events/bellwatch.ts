// BELLWATCH (event id 'bellwatch'): data. docs/atlas-rework/C-map-events.md 7.7, GAME_SPEC map events.
import type { MapEventText } from '../map-events';

export const BELLWATCH_NAME = 'Bellwatch';
export const BELLWATCH_MIN_TIER = 5;
export const BELLWATCH_WINDOW: readonly [number, number] = [3, 5];
export const BELLWATCH_COLOR: readonly [number, number, number] = [0.85, 0.82, 0.7];

export const BELL_CANTORS = 4;
/** Outer cantors stand outside the toll rings' reach, inner ones in the gaps' heart beside the bell. */
export const BELL_OUTER_RADIUS = 230;
export const BELL_INNER_RADIUS = 90;
/** Seconds after the onset to the first toll, then between tolls (x tollScale, x 1.25 per fallen cantor). */
export const BELL_FIRST_TOLL = 6;
export const BELL_TOLL_SECONDS = 8;
export const BELL_TOLL_SLOWING = 0.25;
/** The bell swings this long before its ring leaves it (F1: nothing hurts inside the telegraph). */
export const BELL_SWING_SECONDS = 1.5;
export const BELL_TOLLS = 8;
/** Gold needs all four cantors down before this toll rings. */
export const BELL_GOLD_TOLL = 4;
export const BELL_RING_START = 18;
export const BELL_RING_END = 430;
export const BELL_RING_SECONDS = 4.2;
export const BELL_RING_GAPS = 3;
export const BELL_RING_DAMAGE = 7;
export const BELL_DIRGE_MAX = 5;
export const BELL_DIRGE_SPEED = 0.08;
export const BELL_AFTERMATH_SECONDS = 60;
export const BELL_CLEARANCE = 340;
export const BELL_CANTOR_LIFE = 20;

export const BELLWATCH_TEXT: MapEventText = {
  omen: 'A great bell begins to toll.',
  phases: { available: 'A bell on a scaffold', warning: 'The bell swings', active: 'Silence the cantors', complete: 'The bell is silent', failed: 'The bell rang on' },
  objectives: ['Cantors', 'Dirge', 'Toll'],
  timers: ['Next toll', 'Dirge fades'],
  hints: [
    'Cut down the outer cantors first; the inner ones are shielded while an outer cantor lives.',
    `Gold needs all four cantors before toll ${BELL_GOLD_TOLL}. Each one that falls quiets the bell.`,
    'The bell has fallen silent. The Dirge fades.',
    'Step through a gap in the ring, or out of its way.',
  ],
};
