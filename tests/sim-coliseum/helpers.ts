// Helpers for the Iron Coliseum roster tests: a bare arena (tests/sim/helpers.ts) with hand-placed monsters,
// plus small probes over the SoA stores. Everything here reads the sim the way a player would see it: areas
// (telegraphs), projectiles, events and the player's own view.
// The harness first: it loads the sim through run.ts (the core's modules import each other in a cycle).
import { makeArena, type Arena, type ArenaOptions } from '../sim/helpers';
import { MONSTER_KINDS, type MonsterKind } from '../../src/contracts/content';
import { SIM_DT, type PlayerIntent, type SimEvent } from '../../src/contracts/sim';
import { areaVariant } from '../../src/sim/area-geometry';
import { killMonster } from '../../src/sim/combat';
import { PLAYER_RADIUS } from '../../src/sim/constants';
import { PROJ } from '../../src/sim/projectiles';
import type { Area, World } from '../../src/sim/world';
import { idleIntent, makeStats } from '../sim/fixtures';

export const ticks = (seconds: number): number => Math.round(seconds / SIM_DT);

/** A player who can't die or evade (every hit connects), for behaviour tests. */
export const toughStats = () => makeStats({ maxLife: 1e6, evasion: 0 });

/** makeArena with a tough solo player at the origin. */
export function arena(o: ArenaOptions = {}): Arena {
  return makeArena({ stats: toughStats(), ...o });
}

const KINDS: readonly string[] = MONSTER_KINDS;

/** One step with every player's intent, returning the events emitted. */
export function step(a: Arena, intents: Map<number, PlayerIntent> | PlayerIntent = idleIntent()): SimEvent[] {
  if (intents instanceof Map) for (const [id, it] of intents) a.run.setIntent(id, it);
  else a.run.setIntent(1, intents);
  a.run.step();
  a.run.drainOutcomes();
  return a.run.drainEvents();
}

/** Step (player 1 with `intent`) until `find` returns something, at most `seconds`; undefined on timeout. */
export function stepUntil<T>(a: Arena, seconds: number, find: (events: SimEvent[]) => T | undefined, intent?: () => PlayerIntent): T | undefined {
  for (let t = 0; t < ticks(seconds); t++) {
    const events = step(a, intent ? intent() : idleIntent());
    const hit = find(events);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** Intent that walks in direction (dx, dy) (normalised). */
export function walkDir(dx: number, dy: number): PlayerIntent {
  const l = Math.hypot(dx, dy) || 1;
  const it = idleIntent();
  it.moveX = dx / l;
  it.moveY = dy / l;
  return it;
}

/** Live areas of `kind` (optionally of a variant, optionally owned or followed by monster id `owner`). */
export function areasOf(w: World, kind: Area['kind'], opts: { variant?: number; owner?: number } = {}): Area[] {
  return w.areas.filter((a) =>
    !a.dead && a.kind === kind && (opts.variant === undefined || areaVariant(a) === opts.variant) &&
    (opts.owner === undefined || a.owner === opts.owner || a.follow === opts.owner));
}

/** Slots of live hostile projectiles of a kind. */
export function projectilesOf(w: World, kind: keyof typeof PROJ): number[] {
  const pr = w.projectiles;
  const out: number[] = [];
  for (let i = 0; i < pr.hwm; i++) if (pr.alive[i] && pr.hostile[i] && pr.kind[i] === PROJ[kind]) out.push(i);
  return out;
}

/** Slots of live monsters of a kind. */
export function monstersOf(w: World, kind: MonsterKind): number[] {
  const m = w.monsters;
  const k = KINDS.indexOf(kind);
  const out: number[] = [];
  for (let i = 0; i < m.hwm; i++) if (m.alive[i] && m.kind[i] === k) out.push(i);
  return out;
}

/** Remove every monster but `keep` (slots) — e.g. a boss's summons, to test the boss alone. */
export function cullExcept(w: World, keep: readonly number[]): void {
  const m = w.monsters;
  for (let i = 0; i < m.hwm; i++) if (m.alive[i] && !keep.includes(i)) killMonster(w, i, 0, false);
}

/** Whether a player at (x, y) touches a disc area (the core's rule: body pad PLAYER_RADIUS / 2). */
export function touchesDisc(a: Pick<Area, 'x' | 'y' | 'radius'>, x: number, y: number): boolean {
  return Math.hypot(x - a.x, y - a.y) <= a.radius + PLAYER_RADIUS * 0.5;
}

/** Hits on player `id` in a batch of events. */
export function hitsOn(events: SimEvent[], id = 1): Extract<SimEvent, { t: 'hit' }>[] {
  return events.filter((e): e is Extract<SimEvent, { t: 'hit' }> => e.t === 'hit' && e.target === 'player' && e.playerId === id);
}

/** 'monsterAttack' events of a kind (optionally one attack name). */
export function attacksOf(events: SimEvent[], kind: MonsterKind, attack?: string): Extract<SimEvent, { t: 'monsterAttack' }>[] {
  return events.filter((e): e is Extract<SimEvent, { t: 'monsterAttack' }> =>
    e.t === 'monsterAttack' && e.kind === kind && (attack === undefined || e.attack === attack));
}
