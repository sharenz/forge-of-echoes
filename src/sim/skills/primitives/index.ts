// The flagship augment primitives (power rework SK5, docs/power-rework/skills.md 4.2). The rules resolve each picked augment into
// SkillRuntimeDef.augments; the emitters (../emitters.ts, ../roster.ts, ../buffs.ts) hand them to these modules:
//   state.ts     per-world / per-player state (WeakMaps), the reads the core systems make (marks, status bits, ward cap, cast cost)
//   burst.ts     the shared damage circle and the 'augment' presenter cue
//   riders.ts    the projectile rider: what a hit, the flight, the range end and the end of an augmented projectile do
//   expose.ts    exposure on hit                      convert.ts  conversion's ailment rules
//   lodge.ts     lodge and detonate                   split.ts    children on kill / end / hit
//   mark.ts      marks (damage taken, ailment chance) onkill.ts   corpse explosions (depth and per-tick caps)
//   chain.ts     fork / return / ramp of Arc Chain, Storm Call's Conduction
//   trail.ts     ground left behind (burning, chilling, static, molten)
//   blast.ts     extra bursts (blink origin / landing, ward end, orb end), Phase Weave, the ward cap
//   mortar.ts    Cluster Shell, Delayed Fuse, Skip Shot, Magma Core
//   shape.ts     Freezing Core, Glacial Nova's Shatter, Frozen Heart, Frost Orb's Shatter
//   tick.ts      per-player upkeep (scheduled bursts, lodges, pruning)
export { tickAugments } from './tick';
export { attachRider, needsRider, riderOf, AUG_RIDER } from './riders';
export { convertSpec } from './convert';
export { emitChainAugmented, conductFrom } from './chain';
export { spawnTrail } from './trail';
export { afterBlink, blastNow, blastsOf, wardCast, wardEnded } from './blast';
export { shellLanded, afterShellAt } from './mortar';
export { novaAugmented, novaBlast, orbEnded, orbFaded, orbNeedsRider, orbRate, orbRider, orbShardDef } from './shape';
export { augPlayer, castCost, markTakenMult, noteCast, prim, schedule, wardCapOf } from './state';
export { lodgesOf } from './lodge';
export { ON_KILL_CAP } from './onkill';
