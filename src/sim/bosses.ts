// Boss phases (the core half of a BossScript, see rosters/types.ts) and summoning, shared by every roster.
import type { MonsterKind } from '../contracts/content';
import { KIND_BY_INDEX } from './archetypes';
import { removeOwnedAreas } from './areas';
import { MONSTER_ANIM as ANIM, MSTATE, setAnim, stop, toChase } from './behaviour';
import { DT, MAX_LIVE_MONSTERS, SUMMONED_XP_FACTOR, SUMMON_FIELD_CAP } from './constants';
import { TAU } from './math';
import type { MonsterDef } from './rosters/types';
import { spawnMonster } from './spawn';
import { MFLAG } from './stores';
import type { BossRuntime, PlayerState, World } from './world';

/**
 * Whether the field is saturated for lieutenant and boss summons: SUMMON_FIELD_CAP or more monsters alive.
 * Every lieutenant and boss checks it before a summoning cast starts and again as its minions appear.
 */
export function fieldFull(w: World): boolean {
  return w.monsters.count >= SUMMON_FIELD_CAP;
}

/**
 * Summon minions in a ring around monster `i` (skipped when the store is saturated). Summons join its
 * pack, are flagged (no loot, SUMMONED_XP_FACTOR of their XP) and emit one 'monsterAttack' 'summon'.
 * Returns how many appeared.
 */
export function summon(w: World, i: number, kind: MonsterKind, count: number, rMin: number, rMax: number): number {
  const m = w.monsters;
  if (m.count + count > MAX_LIVE_MONSTERS) return 0;
  const rng = w.worldRng;
  const base = rng.range(0, TAU);
  const lim = w.arenaRadius - 16;
  let n = 0;
  for (let k = 0; k < count; k++) {
    const a = base + (k / count) * TAU;
    const r = rng.range(rMin, rMax);
    let x = m.x[i] + Math.cos(a) * r;
    let y = m.y[i] + Math.sin(a) * r;
    const d = Math.hypot(x, y);
    if (d > lim) {
      x *= lim / d;
      y *= lim / d;
    }
    if (summonAt(w, i, kind, x, y) >= 0) n++;
  }
  w.events.push({ t: 'monsterAttack', kind: KIND_BY_INDEX[m.kind[i]], x: m.x[i], y: m.y[i], attack: 'summon' });
  return n;
}

/**
 * One summoned minion of monster `i` at (x, y) (no event, no saturation check): joins its pack, no
 * loot, reduced XP. Returns its slot or -1.
 */
export function summonAt(w: World, i: number, kind: MonsterKind, x: number, y: number): number {
  const m = w.monsters;
  const j = spawnMonster(w, kind, x, y, { pack: m.pack[i], wave: w.director.wave });
  if (j >= 0) {
    m.flags[j] |= MFLAG.summoned;
    m.xp[j] *= SUMMONED_XP_FACTOR;
  }
  return j;
}

/** Start a boss encounter: phase 1 and a fresh script state. */
export function startBoss(w: World, i: number, def: MonsterDef): void {
  const b: BossRuntime = w.bossStates.size === 0 ? w.boss : { phase: 1, roar: 0, state: null };
  w.bossStates.set(w.monsters.id[i], b);
  b.phase = 1;
  b.roar = 0;
  b.state = def.boss ? def.boss.init(w, i) : null;
}

export function bossRuntime(w: World, i: number): BossRuntime {
  return w.bossStates.get(w.monsters.id[i]) ?? w.boss;
}

/** The script state of this monster, including its own phase and attack timers. */
export function bossState<S>(w: World, i: number): S {
  return bossRuntime(w, i).state as S;
}

/**
 * The core's half of a boss: phase changes (one per roar), the immune roar itself, then the brain.
 * Runs for every monster whose def carries a BossScript (a boss placed by hand in a test too; its
 * state is created on its first tick).
 */
export function driveBoss(
  w: World, i: number, def: MonsterDef, t: PlayerState | null, dx: number, dy: number, d: number, hunting: boolean,
): void {
  const script = def.boss;
  if (!script) {
    def.brain(w, i, t, dx, dy, d, hunting);
    return;
  }
  const m = w.monsters;
  if (!w.bossStates.has(m.id[i])) startBoss(w, i, def);
  const b = bossRuntime(w, i);
  if (b.state === null) b.state = script.init(w, i);
  const frac = m.life[i] / m.maxLife[i];
  let want = 1;
  for (let k = 0; k < script.phases.length; k++) if (frac <= script.phases[k]) want++;
  // One phase per roar: a single huge hit past two thresholds still plays the phase-2 roar (event,
  // flash, hit-stop) and then the phase-3 one as soon as it ends.
  if (m.state[i] !== MSTATE.roar && want > b.phase) {
    b.phase++;
    b.roar = script.roar;
    script.onPhase?.(w, i, b.state, b.phase);
    removeOwnedAreas(w, m.id[i]);
    m.state[i] = MSTATE.roar;
    m.flags[i] = (m.flags[i] | MFLAG.immune) & ~MFLAG.unpushable;
    stop(w, i);
    setAnim(w, i, ANIM.windup);
    w.events.push({ t: 'bossPhase', phase: b.phase });
    return;
  }
  if (m.state[i] === MSTATE.roar) {
    stop(w, i);
    b.roar -= DT;
    if (b.roar <= 0) {
      m.flags[i] &= ~MFLAG.immune;
      toChase(w, i);
      script.onRoarEnd?.(w, i, b.state, b.phase);
    }
    return;
  }
  def.brain(w, i, t, dx, dy, d, hunting);
}
