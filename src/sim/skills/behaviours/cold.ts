// Cold skill behaviours (data for the executor).
import { SKILL_TIMING } from '../../../data/progression/skill-timing';
import type { SkillBehaviour } from '../types';

export const COLD_BEHAVIOURS = {
  rimeShards: {
    emitter: 'projectile', kind: 'rimeShard', speed: 360, range: 260, radius: { fixed: 3.5 }, spread: 0.35, pierce: 'def',
    pierceAll: { skill: 'pierceAll', player: 'shardPierceAll' }, echo: { skill: 'echo', player: 'rimeEcho' },
  },
  glacialNova: { emitter: 'blast', radius: 90, knock: 0.5 },
  frostOrb: {
    emitter: 'orb', kind: 'frostOrb', speed: 90, duration: 3, seek: 140, spread: 0.5,
    shard: {
      kind: 'rimeShard', interval: SKILL_TIMING.orbShardInterval, speed: SKILL_TIMING.orbShardSpeed, range: SKILL_TIMING.orbShardRange,
      radius: 3.5,
    },
  },
  glacialSpikes: {
    emitter: 'spikes', length: 200, radius: 20, lead: SKILL_TIMING.spikeLead, step: SKILL_TIMING.spikeStep,
    twin: { skill: 'twinLines', player: 'twinLines' }, twinAngle: SKILL_TIMING.twinLineAngle,
  },
  // Roster batch 2 (SK3)
  rimeBulwark: { emitter: 'buff', buff: 'barrier', duration: 6 },
} satisfies Record<string, SkillBehaviour>;
