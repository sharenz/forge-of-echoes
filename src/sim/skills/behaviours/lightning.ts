// Lightning skill behaviours (data for the executor).
import { ARC_JUMP_RANGE } from '../../constants';
import { SKILL_TIMING } from '../../../data/progression/skill-timing';
import type { SkillBehaviour } from '../types';

export const LIGHTNING_BEHAVIOURS = {
  arcChain: { emitter: 'chain', jump: ARC_JUMP_RANGE, revisit: { skill: 'revisit', player: 'arcReturns' } },
  spark: {
    emitter: 'projectile', kind: 'spark', speed: 150, range: 300, radius: { fallback: 5 }, spread: 0.8, pierce: 'all',
    rehit: SKILL_TIMING.sparkRehit,
  },
  stormCall: {
    emitter: 'strikes', telegraph: SKILL_TIMING.stormTelegraph, scatter: 70, radius: 28, reach: 360,
    tethered: { skill: 'tethered', player: 'tethered' },
  },
  // Roster batch 2 (SK3)
  staticAegis: { emitter: 'buff', buff: 'aegis', duration: 5, radius: 70 },
  voltaicPulse: { emitter: 'pulse', speed: SKILL_TIMING.pulseSpeed, radius: 150 },
  staticLash: {
    emitter: 'lash', arc: { skill: 'arcLash', player: 'arcLash' }, second: SKILL_TIMING.lashSecondShare, jump: SKILL_TIMING.lashJump,
    chainShare: SKILL_TIMING.lashChainShare,
  },
  // Roster batch 3 (SK4)
  stormStep: { emitter: 'dash', distance: 140, strikes: { radius: 60, third: { skill: 'thirdStrike', player: 'thirdStrike' } } },
  tempestSurge: {
    emitter: 'buff', buff: 'surge', duration: 6, radius: 100, pulse: SKILL_TIMING.surgePulse, castSpeed: SKILL_TIMING.surgeCastSpeed,
    tempo: { skill: 'overchargedTempo', player: 'overchargedTempo' }, skin: { skill: 'lightningSkin', player: 'lightningSkin' },
  },
} satisfies Record<string, SkillBehaviour>;
