// CHAMPION'S RING (event id 'ring'): data. docs/atlas-rework/C-map-events.md 7.4, GAME_SPEC map events.
import type { MapEventText } from '../map-events';

export const RING_NAME = "Champion's Ring";
export const RING_MIN_TIER = 4;
export const RING_WINDOW: readonly [number, number] = [3, 5];
export const RING_COLOR: readonly [number, number, number] = [0.7, 0.68, 0.62];

/** Vows, in stone order (the zone `n` of a stone and EventRewardContext.choice). 3 = no vow kept (the player left the ring). */
export const RING_VOWS = ['bareHands', 'ironPride', 'crowdsFavour'] as const;
/** Reward multiplier of each vow (x1.5 / x1.3 / x1.3): an extra rare base with this much chance above 1 (and an extra currency). */
export const RING_VOW_REWARD: readonly number[] = [1.5, 1.3, 1.3, 1];

export const RING_RADIUS = 160;
export const RING_STONE_RADIUS = 24;
export const RING_STONE_SPACING = 64;
export const RING_VOW_SECONDS = 1;
export const RING_SITE_CLEARANCE = 300;
/** Seconds from the vow to the chains standing (the warning), and from the chains to the closing of the ring. */
export const RING_RISE_SECONDS = 3;
export const RING_TIMEOUT = 60;
/**
 * Champion life: this many average family members of the roster (normalised for armour in the script), calibrated on the fair
 * bot to about 35-40 s of duel; Iron Pride adds 40%. It starts at least RING_CHAMPION_CLEARANCE from every player.
 */
export const RING_CHAMPION_LIFE = 28;
/** Per-roster correction found on the fair bot (Ossuary champions outlast its skill mix, so they get less life; Coliseum ones die too fast, so more). */
export const RING_SKIN_LIFE = { ashen: 1, ossuary: 0.8, coliseum: 1.3 } as const;
export const RING_IRON_LIFE = 1.4;
export const RING_CHAMPION_CLEARANCE = 120;
/** Seconds between the champion's moves (lane charge and slam alternate). */
export const RING_MOVE_SECONDS = 4.5;
/** The lane is 230 u long, so F1's large-radius rule makes it 1.8 s (eventArea raises it). */
export const RING_LANE_SECONDS = 1.8;
export const RING_LANE_LENGTH = 230;
export const RING_LANE_DASH = 0.3;
export const RING_LANE_DAMAGE = 20;
export const RING_SLAM_RADIUS = 55;
export const RING_SLAM_SECONDS = 1.5;
export const RING_SLAM_DAMAGE = 26;
/** Crowd's Favour: spikes every 6 s, telegraphed 1.3 s. */
export const RING_SPIKE_SECONDS = 6;
export const RING_SPIKE_TELEGRAPH = 1.3;
export const RING_SPIKE_RADIUS = 38;
export const RING_SPIKE_DAMAGE = 14;
/** A player outside the ring this long has left it (the vow multiplier is forfeit). */
export const RING_LEAVE_SECONDS = 3;
/** Kill time from the chains standing (seconds) for Gold / Silver; any kill before RING_TIMEOUT is Bronze. */
export const RING_GRADE_SECONDS: readonly [number, number] = [38, 52];

export const RING_TEXT: MapEventText = {
  omen: 'A chained ring rises.',
  phases: { available: 'Three vows wait', warning: 'The chains rise', active: 'The Champion', complete: 'Champion fallen', failed: 'The ring closed' },
  objectives: ['Champion'],
  timers: ['Gold pace', 'Ring closes'],
  hints: [
    'Stand on a vow for one second to name your terms. Most feet win.',
    'The chains keep the horde out. Duel the Champion.',
    'A lane charge. Step out of the lane.',
    'A slam. Leave the marked circle.',
    'You left the ring: the vow bonus is forfeit.',
    'The ring is closing. The Champion joins the horde.',
  ],
};
