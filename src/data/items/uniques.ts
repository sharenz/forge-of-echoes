// Uniques (GAME_SPEC §5): fixed, rule-changing items. They keep their base's implicit and properties,
// roll their own mod values and grant player flags. Only Crown Fragments reroll their values.
import type { UniqueId } from '../../contracts/content';
import type { UniqueDef } from './types';

export const UNIQUES: Record<UniqueId, UniqueDef> = {
  thePatientSpark: {
    id: 'thePatientSpark',
    name: 'The Patient Spark',
    baseId: 'ashwoodWand',
    flavor: 'It waits for the whole line.',
    levelRequirement: 10,
    mods: [
      { stats: ['fireDamage'], mode: 'increased', min: 30, max: 45 },
      { stats: ['castSpeed'], mode: 'increased', min: -15, max: -15 },
    ],
    flags: [{ flag: 'lancePierceAll', text: 'Ember Lance pierces all targets' }],
    dropWeight: 100,
  },
  cinderwalkers: {
    id: 'cinderwalkers',
    name: 'Cinderwalkers',
    baseId: 'ashenSandals',
    flavor: 'Where she walked, the ash remembered.',
    levelRequirement: 16,
    mods: [
      { stats: ['moveSpeed'], mode: 'increased', min: 15, max: 20 },
      { stats: ['fireRes'], mode: 'flat', min: 20, max: 30 },
    ],
    flags: [{ flag: 'fireTrail', text: 'You leave a trail of burning ground while moving' }],
    dropWeight: 100,
  },
  echoOfTheMatriarch: {
    id: 'echoOfTheMatriarch',
    name: 'Echo of the Matriarch',
    baseId: 'cinderPendant',
    flavor: 'Her last command still rings in the embers.',
    levelRequirement: 20,
    mods: [
      { stats: ['maxFocus'], mode: 'flat', min: 15, max: 25 },
      { stats: ['maxLife'], mode: 'increased', min: -8, max: -8 },
    ],
    flags: [{ flag: 'novaEcho', text: 'Ember Nova repeats once after 0.4 seconds' }],
    dropWeight: 100,
  },
  ruinheartBand: {
    id: 'ruinheartBand',
    name: 'Ruinheart Band',
    baseId: 'voidSignet',
    flavor: 'Power pours from the wound, not the hand.',
    levelRequirement: 24,
    mods: [
      { stats: ['extraProjectiles'], mode: 'flat', min: 1, max: 1 },
      { stats: ['voidRes'], mode: 'flat', min: 20, max: 30 },
      { stats: ['damageTaken'], mode: 'increased', min: 12, max: 12 },
    ],
    flags: [],
    dropWeight: 100,
  },
};
