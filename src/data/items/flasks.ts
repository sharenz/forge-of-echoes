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
};
