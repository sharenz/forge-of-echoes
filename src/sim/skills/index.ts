// Skill behaviour (GAME_SPEC §4): the executor and its primitive groups. The numbers come pre-resolved in SkillRuntimeDef;
// this directory only decides what each skill *does* when its cast releases.
//   executor.ts         releaseSkill (emitter dispatch + post-cast primitives), the echo queue
//   emitters.ts         projectile fans, bursts, chains, blinks
//   projectile-mods.ts  flags, aim, fan / pierce / radius rules
//   buffs.ts            Cinder Ward, Phase Stride, Arcane Reprieve and their upkeep
//   roster.ts           roster batch 1 emitters: Glacial Nova's blast, Cinder Mortar's lob, Frost Orb, Storm Call, Glacial Spikes
//   roster2.ts          roster batch 2 emitters: zones (Gravity Well, Entropy Hex, Wither Field), Immolation Sigil's pillar,
//                       Voltaic Pulse's ring, Concussive Blast's cone, Static Lash's beam; their ground upkeep
//   defence.ts          Rime Bulwark's barrier, Static Aegis' retaliation, Echo Sigil's charges (hitPlayer reads the first two)
//   ground.ts           ground left behind (fire trail)
//   behaviours/         per-element skill data (which emitter, fallbacks, which flags)
export { releaseSkill, tickPendingNovas } from './executor';
export { tickSelfBuffs, tickWard } from './buffs';
export { tickPendingStrikes } from './roster';
export { tickRoster2 } from './roster2';
export { tickFireTrail } from './ground';
export { SKILL_BEHAVIOURS } from './behaviours';
export type { SkillBehaviour } from './types';
