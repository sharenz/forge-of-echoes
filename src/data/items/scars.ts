// Scars (GAME_SPEC §6): permanent drawbacks gained when crafting at low stability. At most 2 per item,
// never the same scar twice. Values are rolled as positive magnitudes; `sign` gives the direction.
import type { ScarDef } from './types';

export const SCARS: readonly ScarDef[] = [
  { id: 'frail', name: 'Frail', stats: ['maxLife'], mode: 'increased', sign: -1, min: 5, max: 10, weight: 100 },
  { id: 'hollow', name: 'Hollow', stats: ['maxFocus'], mode: 'increased', sign: -1, min: 5, max: 10, weight: 100 },
  { id: 'smouldering', name: 'Smouldering', stats: ['fireRes'], mode: 'flat', sign: -1, min: 6, max: 12, weight: 100 },
  { id: 'rimebitten', name: 'Rimebitten', stats: ['coldRes'], mode: 'flat', sign: -1, min: 6, max: 12, weight: 80 },
  { id: 'sluggish', name: 'Sluggish', stats: ['castSpeed'], mode: 'increased', sign: -1, min: 4, max: 8, weight: 90 },
  { id: 'leaden', name: 'Leaden', stats: ['moveSpeed'], mode: 'increased', sign: -1, min: 3, max: 6, weight: 70 },
  { id: 'dim', name: 'Dim', stats: ['spellDamage'], mode: 'increased', sign: -1, min: 6, max: 12, weight: 90 },
  { id: 'exposed', name: 'Exposed', stats: ['damageTaken'], mode: 'increased', sign: 1, min: 3, max: 6, weight: 60 },
  {
    id: 'brittle', name: 'Brittle', stats: ['armor'], mode: 'increased', sign: -1, min: 15, max: 25, weight: 120,
    requiresProperty: 'armor',
  },
  {
    id: 'frayed', name: 'Frayed', stats: ['evasion'], mode: 'increased', sign: -1, min: 15, max: 25, weight: 120,
    requiresProperty: 'evasion',
  },
];
