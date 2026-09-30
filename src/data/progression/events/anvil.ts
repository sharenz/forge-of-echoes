// WAYSIDE ANVIL (event id 'anvil'): data. docs/atlas-rework/C-map-events.md 7.6, GAME_SPEC map events.
import type { MapEventText } from '../map-events';

export const ANVIL_NAME = 'Wayside Anvil';
export const ANVIL_MIN_TIER = 3;
export const ANVIL_WINDOW: readonly [number, number] = [2, 4];
export const ANVIL_COLOR: readonly [number, number, number] = [1, 0.6, 0.25];

/** Kills within this many units of the anvil charge it. */
export const ANVIL_RADIUS = 260;
/** Weighted kills needed (a normal monster counts 1, magic 2, rare or stronger 3). Anvil Blessing's price multiplies it. */
export const ANVIL_CHARGE = 28;
export const ANVIL_WEIGHT_MAGIC = 2;
export const ANVIL_WEIGHT_RARE = 3;
/** Charged within this many seconds of the onset: Gold (two boons). Silver up to ANVIL_SILVER_SECONDS. */
export const ANVIL_GOLD_SECONDS = 54;
export const ANVIL_SILVER_SECONDS = 90;
export const ANVIL_CLEARANCE = 200;
export const ANVIL_STONES = 3;
export const ANVIL_STONE_RING = 80;
export const ANVIL_STONE_RADIUS = 24;
export const ANVIL_DWELL = 1;
/** The boons in stable order (a stone's n is boon * 16 + class index for Attuned). */
export const ANVIL_BOONS = ['tempered', 'keen', 'attuned', 'recast'] as const;
export type AnvilBoon = (typeof ANVIL_BOONS)[number];
export const ANVIL_BOON_NAMES: Record<AnvilBoon, string> = {
  tempered: 'Tempered', keen: 'Keen', attuned: 'Attuned', recast: 'Recast',
};
export const ANVIL_BOON_LINES: Record<AnvilBoon, string> = {
  tempered: '+1 Stability', keen: 'Best implicits', attuned: 'Chosen class', recast: 'Roll twice',
};

export const ANVIL_TEXT: MapEventText = {
  omen: 'An anvil rings by the road.',
  phases: { available: 'A cold anvil', warning: 'The anvil warms', active: 'Fight around the anvil', complete: 'Boon forged', failed: 'The anvil went cold' },
  objectives: ['Charge', 'Boons'],
  timers: ['Gold pace', 'Second boon'],
  hints: [
    'Kills near the anvil charge it. Charge it before the Gold timer runs out for a second boon.',
    'The anvil is charged. Stand on a stone for one second to forge a boon into the completion chest.',
    'Gold: choose a second boon.',
    'The anvil goes cold at the boss wave.',
  ],
};
