// Flasks: recover over time (never instantly). They stack to 20 in grids and 5 per belt slot. Drinking one
// also cleanses debuffs (GAME_SPEC §13; the sim applies it): Life removes Burning and Bleeding, Focus
// removes Withered.
import type { FlaskId } from '../../contracts/content';
import type { FlaskDef } from './types';

export const FLASKS: Record<FlaskId, FlaskDef> = {
  lifeFlask: {
    id: 'lifeFlask',
    name: 'Life Flask',
    description: 'Recovers Life over a few seconds. Drinking it removes Burning and Bleeding.',
    resource: 'life',
    recoverBase: 40,
    recoverPerLevel: 8,
    duration: 3,
  },
  focusFlask: {
    id: 'focusFlask',
    name: 'Focus Flask',
    description: 'Recovers Focus over a few seconds. Drinking it removes Withered.',
    resource: 'focus',
    recoverBase: 30,
    recoverPerLevel: 4,
    duration: 3,
  },
  // Utility flasks (power rework 10.3): no recovery; the sim applies the effect while the flask is active (src/sim/player.ts reads
  // the numbers in FLASK_FX, which tests/game-items/flasks.test.ts keeps equal to `fx` here). `resource` only picks the sound and
  // the belt art; 'utility' flasks never cleanse debuffs except where the description says so.
  quickstep: {
    id: 'quickstep', name: 'Quickstep Flask',
    description: 'Grants 30% increased Movement Speed for 4 seconds and breaks Roots.',
    resource: 'life', recoverBase: 0, recoverPerLevel: 0, duration: 4,
    utility: { kind: 'quickstep', lines: ['+30% Movement Speed', 'Removes Rooted'], fx: { moveSpeed: 0.3 } },
  },
  aegis: {
    id: 'aegis', name: 'Aegis Flask',
    description: 'Grants +15 to all Resistances for 6 seconds. Resistances never exceed their maximum.',
    resource: 'life', recoverBase: 0, recoverPerLevel: 0, duration: 6,
    utility: { kind: 'aegis', lines: ['+15% to all Resistances'], fx: { resist: 0.15 } },
  },
  quicksilverMind: {
    id: 'quicksilverMind', name: 'Quicksilver Mind Flask',
    description: 'Restores 15% of your maximum Focus at once and grants 25% increased Focus Regeneration for 5 seconds.',
    resource: 'focus', recoverBase: 0, recoverPerLevel: 0, duration: 5,
    utility: { kind: 'quicksilverMind', lines: ['Restores 15% of maximum Focus', '+25% Focus Regeneration Rate'], fx: { focusRegen: 0.25, focusInstant: 0.15 } },
  },
};
