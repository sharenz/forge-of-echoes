// Test harness helpers: a bare arena (no director, no props, no dummy) with hand-placed monsters,
// and intent-driven stepping for one or more players.
import type { MonsterKind, SkillId } from '../../src/contracts/content';
import type { PlayerCombatStats, PlayerIntent, PlayerView, SimEvent, SimOutcome, SimRun, SkillRuntimeDef } from '../../src/contracts/sim';
import { createRunInternal, defaultCapacities } from '../../src/sim/run';
import { spawnMonster } from '../../src/sim/spawn';
import type { PlayerState, World } from '../../src/sim/world';
import { idleIntent, makeConfig, makeHooks, makeJoin, type HookLog, type HookOptions } from './fixtures';

/** The id of the solo player in single-player tests. */
export const P1 = 1;

export interface Arena {
  run: SimRun;
  world: World;
  log: HookLog;
  /** The solo player's internal state (id 1). */
  player: PlayerState;
}

export interface ArenaOptions {
  seed?: number;
  stats?: PlayerCombatStats;
  skills?: SkillRuntimeDef[];
  loadout?: (SkillId | null)[];
  hooks?: HookOptions;
}

/**
 * A 600-radius empty arena with player 1 at the origin and no wave director (a hideout-mode run
 * stripped of its furniture and dummy, with map-sized stores so tests can fill it).
 */
export function makeArena(o: ArenaOptions = {}): Arena {
  const { hooks, log } = makeHooks(o.hooks);
  const { run, world } = createRunInternal(
    makeConfig({ mode: 'hideout', arenaRadius: 600, seed: o.seed ?? 99, hooks }), { capacities: defaultCapacities('map') },
  );
  world.props.length = 0;
  world.propGrid.clear();
  const m = world.monsters;
  for (let i = 0; i < m.capacity; i++) if (m.alive[i]) m.release(i);
  run.addPlayer(makeJoin(P1, { stats: o.stats, skills: o.skills, loadout: o.loadout, x: 0, y: 0 }));
  run.drainEvents();
  return { run, world, log, player: world.players[0] };
}

/** Add another player to an arena (at a given spot). */
export function joinArena(a: Arena, id: number, x: number, y: number, stats?: PlayerCombatStats): PlayerState {
  a.run.addPlayer(makeJoin(id, { stats, x, y }));
  a.run.drainEvents();
  return a.world.playerById[id]!;
}

export interface PlaceOptions {
  life?: number;
  /** Keep the monster rooted and passive (default true). */
  still?: boolean;
}

export function placeMonster(world: World, kind: MonsterKind, x: number, y: number, o: PlaceOptions = {}): number {
  const i = spawnMonster(world, kind, x, y, { animate: false });
  const m = world.monsters;
  if (o.life !== undefined) {
    m.life[i] = o.life;
    m.maxLife[i] = o.life;
  }
  if (o.still ?? true) {
    m.speed[i] = 0;
    m.attackCd[i] = 1e9;
    m.knockback[i] = 0;
  }
  return i;
}

export function hold(slot: number, aimX: number, aimY: number): PlayerIntent {
  const intent = idleIntent(aimX, aimY);
  intent.held[slot] = true;
  return intent;
}

/** Intent that walks from (px, py) toward (tx, ty). */
export function walkIntent(px: number, py: number, tx: number, ty: number): PlayerIntent {
  const it = idleIntent();
  const dx = tx - px;
  const dy = ty - py;
  const l = Math.hypot(dx, dy);
  if (l > 1) {
    it.moveX = dx / l;
    it.moveY = dy / l;
  }
  return it;
}

/** A player's view by id (throws when absent — a test bug). */
export function pv(run: SimRun, id = P1): PlayerView {
  const p = run.view.players.find((q) => q.id === id);
  if (!p) throw new Error(`player ${id} is not in the instance`);
  return p;
}

export interface Recorded {
  events: SimEvent[];
  outcomes: SimOutcome[];
}

/** Set player `id`'s intent (or intent factory) and step n ticks, collecting everything emitted. */
export function stepN(
  run: SimRun, n: number, intent: PlayerIntent | ((tick: number) => PlayerIntent) = idleIntent(), id = P1,
): Recorded {
  const out: Recorded = { events: [], outcomes: [] };
  for (let k = 0; k < n; k++) {
    run.setIntent(id, typeof intent === 'function' ? intent(k) : intent);
    run.step();
    out.events.push(...run.drainEvents());
    out.outcomes.push(...run.drainOutcomes());
  }
  return out;
}

/** Step once with a single player's intent. */
export function stepWith(run: SimRun, intent: PlayerIntent, id = P1): void {
  run.setIntent(id, intent);
  run.step();
}

export function ofType<T extends SimEvent['t']>(events: SimEvent[], t: T): Extract<SimEvent, { t: T }>[] {
  return events.filter((e): e is Extract<SimEvent, { t: T }> => e.t === t);
}

export function outcomesOf<T extends SimOutcome['t']>(outcomes: SimOutcome[], t: T): Extract<SimOutcome, { t: T }>[] {
  return outcomes.filter((o): o is Extract<SimOutcome, { t: T }> => o.t === t);
}
