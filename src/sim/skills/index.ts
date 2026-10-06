// Skill behaviour (GAME_SPEC §4): the executor and its primitive groups. The numbers come pre-resolved in SkillRuntimeDef;
// this directory only decides what each skill *does* when its cast releases.
//   executor.ts         releaseSkill (emitter dispatch + post-cast primitives), the echo queue
//   emitters.ts         projectile fans, bursts, chains, blinks
//   projectile-mods.ts  flags, aim, fan / pierce / radius rules
//   buffs.ts            Cinder Ward and its upkeep
//   ground.ts           ground left behind (fire trail)
//   behaviours/         per-element skill data (which emitter, fallbacks, which flags)
export { releaseSkill, tickPendingNovas } from './executor';
export { tickWard } from './buffs';
export { tickFireTrail } from './ground';
export { SKILL_BEHAVIOURS } from './behaviours';
export type { SkillBehaviour } from './types';
