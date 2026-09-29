// The Sorceress (GAME_SPEC §3) and the experience curve. Per-level and per-attribute rules are plain
// modifier data: the stat rules turn them into labelled StatModifiers, so the character sheet can
// explain every number.
import type { ClassDef } from './types';

export const SORCERESS: ClassDef = {
  id: 'sorceress',
  name: 'Sorceress',
  attributes: {
    str: { base: 10, perLevel: 0.3 },
    dex: { base: 14, perLevel: 0.5 },
    int: { base: 30, perLevel: 1.2 },
  },
  attributePointsPerLevel: 3,
  skillPointsPerLevel: 1,
  baseStats: {
    maxLife: 70,
    maxFocus: 40,
    evasion: 20,
    moveSpeed: 110,
    // Echo motes (XP) inside this radius fly to you. 90 rather than a tighter 60: kiting leaves kills
    // behind, and the balance playthroughs lost about half of the early experience at 60.
    pickupRadius: 90,
    critMultiplier: 150,
  },
  perLevel: [
    { stat: 'maxLife', mode: 'flat', value: 8 },
    { stat: 'maxFocus', mode: 'flat', value: 2 },
    { stat: 'evasion', mode: 'flat', value: 3 },
  ],
  perAttribute: [
    { attribute: 'str', stat: 'maxLife', mode: 'flat', per: 1, value: 1 },
    { attribute: 'str', stat: 'maxLife', mode: 'increased', per: 10, value: 1 },
    { attribute: 'dex', stat: 'evasion', mode: 'flat', per: 1, value: 2 },
    { attribute: 'dex', stat: 'evasion', mode: 'increased', per: 5, value: 1 },
    { attribute: 'int', stat: 'maxFocus', mode: 'flat', per: 1, value: 1 },
    { attribute: 'int', stat: 'spellDamage', mode: 'increased', per: 5, value: 1 },
  ],
  focusRegen: { flat: 3, percentOfMaxFocus: 2 },
  // GAME_SPEC's starting target was 5 at level 1; 11 keeps a new character's first fights on the
  // hard Tier 1 (monster level 4) from dragging on for minutes while she dies and levels
  // (tuned with the balance playthroughs) and barely matters later (+4% at level 40).
  spellPower: { base: 11, perLevel: 1.6 },
  evasionPerMonsterLevel: 30,
  evasionCap: 0.75,
  resistCap: 75,
};

/** Level cap of the vertical slice. */
export const LEVEL_CAP = 60;

/** XP to the next level = floor(XP_BASE × level^XP_EXPONENT)  (L1 → 90, L10 → 5.0k, L30 → 34k). */
export const XP_BASE = 90;
export const XP_EXPONENT = 1.75;
