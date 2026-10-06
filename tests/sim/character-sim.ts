// Sim runners for the character harness (power rework P3): they hand a BuiltCharacter's runtime (the real rules plus the
// harness' stand-ins) to the real sim and measure what the band tables of power-curve.md predict, with the scripted bot of
// ./bot.ts (extended with the archetype's cast script):
//   measureDps     single-target damage per second against the training dummy (Focus-free, ailments excluded)  -> table 5.2 DPS
//   measurePack    seconds to kill a clump of six Ashlings of the level, and the crowd throughput relative to DPS -> 7.1 pack
//   playBoss       the boss alone (the others crumble when it arrives), with the bot dodging                      -> 7.1 boss
//   playMapRun     a whole six-wave map with the bot: clear time, deaths, lowest life, incoming hit sizes        -> 9.3, 7.2
import type { MonsterScaling, PlayerIntent, PlayerJoin, SimEvent } from '../../src/contracts/sim';
import { SIM_DT } from '../../src/contracts/sim';
import { monsterDamageScale, monsterLifeScale } from '../../src/data/progression';
import { createRunInternal, defaultCapacities } from '../../src/sim/run';
import { spawnMonster } from '../../src/sim/spawn';
import { MFLAG } from '../../src/sim/stores';
import { killMonster } from '../../src/sim/combat';
import type { World } from '../../src/sim/world';
import type { BuiltCharacter } from '../game-progression/character-harness';
import { createBot } from './bot';
import { makeConfig, makeHooks } from './fixtures';

/** Monster scaling of a monster level the way the rules hand it to the sim (curve from the data modules). */
export function scalingFor(ml: number): Partial<MonsterScaling> {
  return { level: ml, lifeMultiplier: monsterLifeScale(ml), damageMultiplier: monsterDamageScale(ml), magicPackChance: 0.15, rarePackChance: 0.05 };
}

export interface JoinOptions {
  /** Unlimited Focus (the tables' DPS is Focus-free). */
  freeFocus?: boolean;
  /** Nothing hurts the player (time-to-kill measured even for characters that would die). */
  invulnerable?: boolean;
  /** Life so large that standing in front of a monster never kills (hit sizes are measured, not survival). */
  hugeLife?: boolean;
}

export function joinFor(b: BuiltCharacter, id = 1, o: JoinOptions = {}, x?: number, y?: number): PlayerJoin {
  const rt = b.runtime;
  const stats = {
    ...rt.stats,
    ...(o.freeFocus ? { maxFocus: 1e6, focusRegen: 1e6 } : {}),
    ...(o.invulnerable ? { damageTaken: 0 } : {}),
    ...(o.hugeLife ? { maxLife: 1e7 } : {}),
  };
  const join: PlayerJoin = { id, name: b.archetype.id.slice(0, 16), level: b.level, runtime: { ...rt, stats } };
  if (x !== undefined) join.x = x;
  if (y !== undefined) join.y = y;
  return join;
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
export const mean = (xs: readonly number[]) => (xs.length ? sum(xs) / xs.length : NaN);
export const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN;
};

/**
 * A map-mode arena with no waves and no props (hand-placed monsters only) and the level's monster scaling. Map mode, because a
 * hideout does not let the player hurt anything but its dummy.
 */
function arena(b: BuiltCharacter, seed: number, o: JoinOptions, withDummy = false) {
  const waves = { count: 1, baseMonsters: 0, monstersPerWave: 0, waveDuration: 100000, tellDuration: 3, lieutenantWave: 0, bossWave: 0 };
  const { run, world } = createRunInternal(
    makeConfig({ mode: 'map', theme: 'ashenForge', arenaRadius: 700, seed, hooks: makeHooks().hooks, scaling: scalingFor(b.ml), waves }),
  );
  world.props.length = 0;
  world.propGrid.clear();
  const m = world.monsters;
  for (let i = 0; i < m.capacity; i++) if (m.alive[i]) m.release(i);
  void withDummy;
  run.addPlayer(joinFor(b, 1, o, 0, 0));
  run.drainEvents();
  return { run, world };
}

const idle = (aimX: number, aimY: number): PlayerIntent => ({ moveX: 0, moveY: 0, aimX, aimY, held: [false, false, false, false, false, false], flask: -1 });
const hits = (events: readonly SimEvent[], target: 'monster' | 'player') =>
  events.filter((e): e is Extract<SimEvent, { t: 'hit' }> => e.t === 'hit' && e.target === target);

/** The loadout slot of the archetype's main skill (slot 0 when it is not in the loadout). */
export const slotOf = (b: BuiltCharacter): number => Math.max(0, b.runtime.loadout.indexOf(b.archetype.main));

export interface DpsResult { dps: number; hit: number; casts: number }

/** Single-target DPS of the main skill against the training dummy: hold its slot for `seconds`, sum the direct hits. */
export function measureDps(b: BuiltCharacter, seed: number, seconds = 20, slot = slotOf(b)): DpsResult {
  const { run, world } = arena(b, seed, { freeFocus: true });
  const dummyAt = 220;
  const i = spawnMonster(world, 'trainingDummy', dummyAt, 0, { animate: false });
  world.monsters.life[i] = world.monsters.maxLife[i] = 1e15;
  const intent = idle(dummyAt, 0);
  intent.held[slot] = true;
  let total = 0, n = 0;
  for (let t = 0; t < Math.round(seconds / SIM_DT); t++) {
    run.setIntent(1, intent);
    run.step();
    for (const e of hits(run.drainEvents(), 'monster')) { total += e.amount; n++; }
    run.drainOutcomes();
  }
  return { dps: total / seconds, hit: n ? total / n : 0, casts: n };
}

export interface PackResult {
  /** Seconds until all six are dead (the cap when they are not). */
  seconds: number;
  killed: boolean;
  /** Pack life divided by the time it took, relative to the single-target DPS the same build deals: the effective targets per cast. */
  throughput: number;
}

/** Six Ashlings of the monster level in a clump 230 units away, standing still: how fast the loadout deletes a pack. */
export function measurePack(b: BuiltCharacter, seed: number, capSeconds = 60): PackResult {
  const { run, world } = arena(b, seed, { freeFocus: true, invulnerable: true });
  const ids: number[] = [];
  const centre = 230;
  let life = 0;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const i = spawnMonster(world, 'ashling', centre + Math.cos(a) * 34, Math.sin(a) * 34, { animate: false, wave: 3 });
    world.monsters.speed[i] = 0;
    world.monsters.attackCd[i] = 1e9;
    world.monsters.knockback[i] = 0;
    life += world.monsters.maxLife[i];
    ids.push(i);
  }
  const intent = idle(centre, 0);
  // Every damaging slot is held: a pack is cleared with the whole kit. The player aims at the nearest living member, as a player does.
  b.runtime.loadout.forEach((id, s) => { if (id && id !== 'riftStep' && id !== 'cinderWard') intent.held[s] = true; });
  let t = 0;
  for (; t < Math.round(capSeconds / SIM_DT); t++) {
    let best = -1, bd = Infinity;
    for (const i of ids) {
      if (!world.monsters.alive[i]) continue;
      const d = Math.hypot(world.monsters.x[i], world.monsters.y[i]);
      if (d < bd) { bd = d; best = i; }
    }
    if (best >= 0) { intent.aimX = world.monsters.x[best]; intent.aimY = world.monsters.y[best]; }
    run.setIntent(1, intent);
    run.step();
    run.drainEvents();
    run.drainOutcomes();
    if (ids.every((i) => !world.monsters.alive[i])) break;
  }
  const seconds = t * SIM_DT;
  const single = b.sheet.dps;
  return { seconds, killed: ids.every((i) => !world.monsters.alive[i]), throughput: life / Math.max(1e-6, seconds) / Math.max(1, single) };
}

/** PlayOptions.isolate of the playthrough harness: everything but monster `id` crumbles (uncredited) and the stream is dropped. */
function isolate(w: World, id: number): void {
  const m = w.monsters;
  const keep = m.slotOf(id);
  for (let i = 0; i < m.hwm; i++) {
    if (!m.alive[i] || i === keep) continue;
    if ((m.flags[i] & MFLAG.boss) !== 0) continue;
    killMonster(w, i, 0, false);
  }
  w.director.stream.remaining = 0;
}

export interface HitStats {
  /** Damage of each monster hit on the player as the sim reports it (after armour, resistance and damage taken). */
  amounts: number[];
  maxLife: number;
}

export interface IncomingResult {
  /** Average of the monster's big hits (after mitigation) over `seconds` of standing still in front of it. */
  bite: number;
  brute: number;
  bossSlam: number;
  life: number;
}

/** Stand in front of one monster of the kind, unkillable and passive, and record the largest hit it lands. */
function largestHit(b: BuiltCharacter, seed: number, kind: 'ashling' | 'ironhideBrute' | 'cinderMatriarch', seconds: number): number {
  const { run, world } = arena(b, seed, { hugeLife: true });
  const i = spawnMonster(world, kind, 90, 0, { animate: false, boss: kind === 'cinderMatriarch', wave: 1 });
  world.monsters.life[i] = world.monsters.maxLife[i] = 1e15;
  const intent = idle(90, 0);
  const amounts: number[] = [];
  for (let t = 0; t < Math.round(seconds / SIM_DT); t++) {
    run.setIntent(1, intent);
    run.step();
    for (const e of hits(run.drainEvents(), 'player')) amounts.push(e.amount);
    run.drainOutcomes();
  }
  // The big attack's average: every hit above 60% of the largest (each hit rolls 0.8 to 1.2 around its average, so the maximum alone overstates it).
  const max = Math.max(0, ...amounts);
  return mean(amounts.filter((a) => a >= max * 0.6));
}

/** The hit sizes of 7.2: a bite, a Brute slam and the boss's telegraphed slam, against this character's defences. */
export function measureIncoming(b: BuiltCharacter, seed: number): IncomingResult {
  return {
    bite: largestHit(b, seed, 'ashling', 12), brute: largestHit(b, seed, 'ironhideBrute', 20), bossSlam: largestHit(b, seed, 'cinderMatriarch', 40),
    life: b.runtime.stats.maxLife,
  };
}

export interface BossResult {
  result: 'killed' | 'died' | 'timeout';
  /** Seconds from the boss's arrival to its fall (or to the player's death / the cap). */
  seconds: number;
  minLife: number;
  hits: HitStats;
  deaths: number;
}

const WAVES_BOSS_ONLY = { count: 1, baseMonsters: 4, monstersPerWave: 0, waveDuration: 60, tellDuration: 3, lieutenantWave: 0, bossWave: 1 } as const;
/** The boss of a wave-6 arrival has 1 + 0.08 x 5 of the base life; a boss-only run arrives in wave 1, so it is given the difference. */
const BOSS_WAVE6_LIFE = 1 + 0.08 * 5;

/** The boss alone (everything else crumbles when it arrives), fought with the bot until it or the player falls. */
export function playBoss(b: BuiltCharacter, seed: number, o: JoinOptions & { capSeconds?: number } = {}): BossResult {
  const cfg = makeConfig({ theme: 'ashenForge', seed, arenaRadius: 900, scaling: scalingFor(b.ml), waves: { ...WAVES_BOSS_ONLY } });
  cfg.bossLifeMultiplier = BOSS_WAVE6_LIFE;
  const { run, world } = createRunInternal(cfg);
  run.addPlayer(joinFor(b, 1, o));
  const bot = createBot({ collectDrops: false, usePortal: false, cast: b.archetype.cast });
  const stats: HitStats = { amounts: [], maxLife: b.runtime.stats.maxLife };
  let bossAt = -1, minLife = 1, deaths = 0, result: BossResult['result'] = 'timeout', endAt = -1;
  const cap = Math.round((o.capSeconds ?? 600) / SIM_DT);
  for (let t = 0; t < cap; t++) {
    run.setIntent(1, bot.intent(run.view, 1));
    run.step();
    if (bossAt < 0 && world.director.bossId >= 0) {
      bossAt = t;
      isolate(world, world.director.bossId);
    }
    for (const e of hits(run.drainEvents(), 'player')) stats.amounts.push(e.amount);
    for (const out of run.drainOutcomes()) {
      if (out.t === 'playerDied') { deaths++; result = 'died'; endAt = t; }
      if (out.t === 'cleared' && result !== 'died') { result = 'killed'; endAt = t; }
    }
    for (const p of run.view.players) if (p.maxLife > 0) minLife = Math.min(minLife, Math.max(0, p.life) / p.maxLife);
    if (endAt >= 0) break;
  }
  const end = endAt >= 0 ? endAt : cap;
  return { result, seconds: bossAt >= 0 ? (end - bossAt) * SIM_DT : -1, minLife, hits: stats, deaths };
}

export interface MapRunResult {
  result: 'cleared' | 'died' | 'timeout';
  /** Sim seconds until the boss fell (clear), the player died, or the cap. */
  seconds: number;
  minLife: number;
  bossSeconds: number;
  hits: HitStats;
}

/** A whole six-wave map at the monster level with the bot (no re-entry: the first death ends the run). */
export function playMapRun(b: BuiltCharacter, seed: number, o: JoinOptions & { capMinutes?: number } = {}): MapRunResult {
  const { run, world } = createRunInternal(makeConfig({ theme: 'ashenForge', seed, arenaRadius: 900, scaling: scalingFor(b.ml) }));
  run.addPlayer(joinFor(b, 1, o));
  const bot = createBot({ collectDrops: false, usePortal: false, cast: b.archetype.cast });
  const stats: HitStats = { amounts: [], maxLife: b.runtime.stats.maxLife };
  let result: MapRunResult['result'] = 'timeout', endAt = -1, bossAt = -1, minLife = 1;
  const cap = Math.round(((o.capMinutes ?? 20) * 60) / SIM_DT);
  for (let t = 0; t < cap; t++) {
    run.setIntent(1, bot.intent(run.view, 1));
    run.step();
    if (bossAt < 0 && world.director.bossId >= 0) bossAt = t;
    for (const e of hits(run.drainEvents(), 'player')) stats.amounts.push(e.amount);
    for (const out of run.drainOutcomes()) {
      if (out.t === 'playerDied') { result = 'died'; endAt = t; }
      if (out.t === 'cleared' && result !== 'died') { result = 'cleared'; endAt = t; }
    }
    for (const p of run.view.players) if (p.maxLife > 0) minLife = Math.min(minLife, Math.max(0, p.life) / p.maxLife);
    if (endAt >= 0) break;
  }
  const end = endAt >= 0 ? endAt : cap;
  return { result, seconds: end * SIM_DT, minLife, bossSeconds: bossAt >= 0 && result === 'cleared' ? (end - bossAt) * SIM_DT : -1, hits: stats };
}
