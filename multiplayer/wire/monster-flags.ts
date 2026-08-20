/** Flags replicated with monster snapshots. Shared to keep client animation and server simulation in lockstep. */
export const enum MonsterFlags {
  None = 0,
  Alive = 1 << 0,
  Sleeping = 1 << 1,
  Moved = 1 << 2,
  Spawned = 1 << 3,
  Aggroed = 1 << 4,
}
