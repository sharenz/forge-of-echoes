// Cold skill behaviours (data for the executor).
import type { SkillBehaviour } from '../types';

export const COLD_BEHAVIOURS = {
  rimeShards: {
    emitter: 'projectile', kind: 'rimeShard', speed: 360, range: 260, radius: { fixed: 3.5 }, spread: 0.35, pierce: 'def',
    pierceAll: { skill: 'pierceAll', player: 'shardPierceAll' }, echo: { skill: 'echo', player: 'rimeEcho' },
  },
} satisfies Record<string, SkillBehaviour>;
