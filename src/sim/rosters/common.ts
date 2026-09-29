// Kinds that belong to no map roster: the hideout's training dummy.
import { DT, MONSTER_ANIM as ANIM, faceTarget, setAnim, stop, type PlayerState, type World } from './api';
import type { MonsterDef } from './types';

/** The dummy never moves; after being struck it plays its wobble for a moment (see combat.ts). */
function brainDummy(w: World, i: number, t: PlayerState | null): void {
  const m = w.monsters;
  stop(w, i);
  if (m.stateTime[i] > 0) {
    m.stateTime[i] -= DT;
    if (m.stateTime[i] <= 0) setAnim(w, i, ANIM.idle);
  }
  faceTarget(w, i, t);
}

export function commonDefs(): MonsterDef[] {
  return [
    {
      kind: 'trainingDummy', name: 'Training Dummy', role: 'dummy',
      radius: 10, life: 1000, speed: 0, damage: 0, xp: 0, damageType: 'physical', resist: [0, 0, 0, 0, 0], knockback: 0,
      fromWave: 0, weight: 0, weightGrowth: 0,
      brain: brainDummy,
    },
  ];
}
