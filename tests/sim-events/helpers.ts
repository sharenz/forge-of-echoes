// Helpers for the Event Director v2 tests: a map with one hidden event plan and the wave director held still, so an event
// can be driven tick by tick without a horde around it.
import type { MapEventKind, MapEventPlan } from '../../src/contracts/map-events';
import type { Theme } from '../../src/contracts/content';
import { DT_FIRE, killMonster } from '../../src/sim/combat';
import { createRunInternal, stepWorld } from '../../src/sim/run';
import type { EventInstance } from '../../src/sim/events/types';
import type { World } from '../../src/sim/world';
import { makeConfig, makeHooks, makeJoin, makeStats, type ConfigOptions } from '../sim/fixtures';

export interface EventSetup {
  w: World;
  log: ReturnType<typeof makeHooks>['log'];
  run: ReturnType<typeof createRunInternal>['run'];
}

export interface EventSetupOptions extends ConfigOptions {
  plan?: Partial<MapEventPlan>;
  players?: { x: number; y: number }[];
  /** Keep the wave director running (default: held still). */
  director?: boolean;
  wave?: number;
  vulnerable?: boolean;
  /** A tiny monster store (capacity tests). */
  monsterCapacity?: number;
}

export function eventRun(kind: MapEventKind, o: EventSetupOptions = {}): EventSetup {
  const { hooks, log } = makeHooks();
  const wave = o.wave ?? (kind === 'secondCrown' ? 6 : kind === 'wound' ? 3 : 2);
  const plan: MapEventPlan = { kind, wave, angle: 0.7, variant: 0, ...o.plan };
  const config = { ...makeConfig({ ...o, hooks, ...(o.theme ? { theme: o.theme } : {}) }), event: plan };
  const { run, world: w } = o.monsterCapacity ? createRunInternal(config, { capacities: { monsters: o.monsterCapacity, projectiles: 16, motes: 16 } }) : createRunInternal(config);
  const players = o.players ?? [{ x: 0, y: 0 }];
  players.forEach((p, k) => run.addPlayer(makeJoin(k + 1, { x: p.x, y: p.y, stats: makeStats({ maxLife: o.vulnerable ? 1e6 : 80 }) })));
  w.director.intro = 0;
  w.director.wave = wave;
  if (!o.director) w.director.phase = 'cleared';
  for (const p of w.players) p.invulnTime = o.vulnerable ? 0 : 1e9;
  return { w, log, run };
}

export function step(w: World, seconds: number): void {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) stepWorld(w);
}

/** Step until `done()` or `limit` seconds; returns whether it finished. */
export function until(w: World, done: () => boolean, limit = 60): boolean {
  for (let i = 0; i < limit * 60; i++) {
    if (done()) return true;
    stepWorld(w);
  }
  return done();
}

export function live(w: World, kind?: MapEventKind): EventInstance | undefined {
  return w.mapEvent!.live.find(e => !kind || e.kind === kind);
}

export function slay(w: World, id: number, credited = true, source = 1): void {
  const i = w.monsters.slotOf(id);
  if (i >= 0) killMonster(w, i, DT_FIRE, credited, source);
}

export function membersOf(w: World, e: EventInstance): number[] {
  return [...e.members];
}

/** Run one tick so the plan reveals itself, and return its instance. */
export function revealed(w: World, kind?: MapEventKind): EventInstance {
  stepWorld(w);
  const e = live(w, kind);
  if (!e) throw new Error(`event ${kind ?? ''} did not reveal`);
  return e;
}
