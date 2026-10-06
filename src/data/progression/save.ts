// Save format constants, default settings and the starting kit (GAME_SPEC §3).
import type { CurrencyId, FlaskId, SkillId } from '../../contracts/content';
import type { AtlasAreaId } from '../../contracts/atlas';
import type { Settings } from '../../contracts/items';

/** Current save schema version. parseSave migrates anything older and normalises everything. */
// 3: the skill rework (ranks 1 to 10, 2 points per level, 8 loadout slots, augments): game/progression/migrate-skills.ts.
export const SAVE_VERSION = 3;

export const DEFAULT_SETTINGS: Settings = {
  masterVolume: 0.8,
  musicVolume: 0.6,
  sfxVolume: 0.8,
  screenShake: 0.7,
  showFps: false,
  autoAttack: false,
};

/** Character names: 3–16 characters, unique server-wide (contracts/net.ts). */
export const CHARACTER_NAME_MIN = 3;
export const CHARACTER_NAME_MAX = 16;
export const DEFAULT_CHARACTER_NAME = 'Sorceress';
export const DEFAULT_STASH_TABS: readonly string[] = ['Main', 'Maps'];

export interface StartingKit {
  /** Equipped magic Ashwood Wand: the best fire tier item level 1 can roll (T10). */
  wand: { affixId: string; tier: number };
  /** Currency stacks, placed along the top row of the backpack in this order. */
  currency: readonly { currencyId: CurrencyId; count: number }[];
  /** Tier 1 maps bound to the first Atlas area (nobody has a second at creation), placed on the second row. */
  maps: readonly { areaId: AtlasAreaId; count: number }[];
  /** Belt slots (flask + charges). */
  belt: readonly ({ flaskId: FlaskId; count: number } | null)[];
  skills: { basic: SkillId; rank: number; unspentPoints: number };
  wandHistory: string;
  robeHistory: string;
}

export const STARTING_KIT: StartingKit = {
  wand: { affixId: 'fireDamage', tier: 10 },
  currency: [
    { currencyId: 'scrap', count: 10 },
    { currencyId: 'kindling', count: 4 },
    { currencyId: 'essenceEmber', count: 2 },
    { currencyId: 'reforge', count: 1 },
    { currencyId: 'solvent', count: 1 },
    { currencyId: 'seal', count: 1 },
    { currencyId: 'mapDust', count: 3 },
    { currencyId: 'threatGlyph', count: 2 },
  ],
  maps: [
    { areaId: 'cinderCrossing', count: 3 },
  ],
  belt: [
    { flaskId: 'lifeFlask', count: 3 },
    { flaskId: 'lifeFlask', count: 3 },
    { flaskId: 'focusFlask', count: 3 },
    null,
  ],
  skills: { basic: 'emberLance', rank: 1, unspentPoints: 1 },
  wandHistory: 'Carried out of the ashes: your first wand.',
  robeHistory: 'Singed at the hem, but it held.',
};
