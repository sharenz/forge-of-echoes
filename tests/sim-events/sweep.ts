// The forced-event sweep: a fair bot plays a tier-5 map with one event forced into a chosen wave, in any of the three roster
// families. Used by bot-play.test.ts (a few seeds: no softlock, no exception, the map still clears) and by the gated sweep
// (tests/sim-events/sweep.test.ts, EVENT_SWEEP=1: many seeds, grade distribution, durations) that calibrates the Gold thresholds.
//
// A bot that only fights cannot open an optional site or stand on a stone, so each event has a POLICY: it receives the bot's ordinary
// intent and may overwrite the movement (and the aim) for the moment the event needs it. Policies live in policy-*.ts next to the
// events' tests; the core four (Stalker, Echoing, Relay, Fault) are here.
import type { PlayerIntent } from '../../src/contracts/sim';
import type { Theme } from '../../src/contracts/content';
import { MAP_EVENT_WINDOW } from '../../src/data/progression/map-events';
import type { MapEventKind } from '../../src/contracts/map-events';
import { SIM_DT } from '../../src/contracts/sim';
import { createRunInternal } from '../../src/sim/run';
import type { World } from '../../src/sim/world';
import { createBot } from '../sim/bot';
import { STRONG_LOADOUT, TIER5, fairSkills, fairStats, makeConfig, makeHooks, makeJoin } from '../sim/fixtures';

export type EventPolicy = (w: World, playerId: number, base: PlayerIntent) => PlayerIntent;

export const SWEEP_THEMES: readonly Theme[] = ['ashenForge', 'rimedOssuary', 'ironColiseum'];
const ARENA: Partial<Record<Theme, number>> = { ashenForge: 900, rimedOssuary: 900, ironColiseum: 650 };

/** Walk toward (x, y) unless already within `stop`; the bot's aim and casting stay as they were. */
export function walkTo(w: World, playerId: number, x: number, y: number, base: PlayerIntent, stop = 24): PlayerIntent {
  const p = w.playerById[playerId];
  if (!p) return base;
  const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy);
  if (d <= stop) return { ...base, moveX: 0, moveY: 0 };
  return { ...base, moveX: dx / d, moveY: dy / d };
}

const liveOf = (w: World, kind: MapEventKind) => w.mapEvent?.live.find(e => e.kind === kind && e.phase !== 'complete' && e.phase !== 'failed');

/**
 * Echoing: walk to the anchor to open it, then play the brief's choice the way a matched player does: cut off the nearest echo
 * that is still far from the anchor (roam) and fall back to the anchor when none is (guard).
 */
export const echoPolicy: EventPolicy = (w, id, base) => {
  const e = liveOf(w, 'echoRift');
  const s = e?.s as { anchor?: { x: number; y: number }; echoes?: Map<number, boolean> } | undefined;
  if (!e || !s?.anchor) return base;
  const p = w.playerById[id]!;
  if (e.phase === 'available') return walkTo(w, id, s.anchor.x, s.anchor.y, base, 30);
  let best: { x: number; y: number } | null = null, bd = 420;
  for (const echo of s.echoes?.keys() ?? []) {
    const j = w.monsters.slotOf(echo);
    if (j < 0) continue;
    const ex = w.monsters.x[j], ey = w.monsters.y[j];
    if (Math.hypot(ex - s.anchor.x, ey - s.anchor.y) < 170) continue; // at the door: the guard deals with it
    const d = Math.hypot(ex - p.x, ey - p.y);
    if (d < bd) { bd = d; best = { x: ex, y: ey }; }
  }
  if (best) return walkTo(w, id, best.x, best.y, { ...base, aimX: best.x, aimY: best.y }, 90);
  return Math.hypot(p.x - s.anchor.x, p.y - s.anchor.y) > 100 ? walkTo(w, id, s.anchor.x, s.anchor.y, base, 50) : base;
};

/** Fault: walk to the crack to open the field, then stay inside it (the bot steers out of telegraphed wedges itself). */
export const woundPolicy: EventPolicy = (w, id, base) => {
  const e = liveOf(w, 'wound');
  const s = e?.s as { center?: { x: number; y: number } } | undefined;
  if (!e || !s?.center) return base;
  if (e.phase === 'available') return walkTo(w, id, s.center.x, s.center.y, base, 30);
  const p = w.playerById[id]!;
  return Math.hypot(p.x - s.center.x, p.y - s.center.y) > 200 ? walkTo(w, id, s.center.x, s.center.y, base, 80) : base;
};

/** Relay: kill the Wickbearer, pick up the Ember and carry it to the nearest dark brazier. */
export const blackoutPolicy: EventPolicy = (w, id, base) => {
  const e = liveOf(w, 'blackout');
  const s = e?.s as { braziers: { x: number; y: number; lit: boolean }[]; ember: { x: number; y: number; carrier: number } | null } | undefined;
  if (!e || e.phase !== 'active' || !s) return base;
  const p = w.playerById[id]!;
  if (s.ember && s.ember.carrier === id) {
    let best: { x: number; y: number } | null = null, bd = Infinity;
    for (const b of s.braziers) if (!b.lit) { const d = Math.hypot(b.x - p.x, b.y - p.y); if (d < bd) { bd = d; best = b; } }
    return best ? walkTo(w, id, best.x, best.y, base, 18) : base;
  }
  if (s.ember && s.ember.carrier === 0) return walkTo(w, id, s.ember.x, s.ember.y, base, 6);
  return base;
};

const CORE: Partial<Record<MapEventKind, EventPolicy>> = { echoRift: echoPolicy, wound: woundPolicy, blackout: blackoutPolicy };

/** Every policy-*.ts next to this file exports `<name>Policy`; the names map onto event kinds. */
const NAMED: Record<string, MapEventKind> = {
  pactPolicy: 'pactAltar', orchardPolicy: 'orchard', ringPolicy: 'ring', hostPolicy: 'host', anvilPolicy: 'anvil', bellwatchPolicy: 'bellwatch',
  breachPolicy: 'voidBreach', caravanPolicy: 'vaultbreakers', rivalPolicy: 'secondCrown',
};
const modules = import.meta.glob('./policy-*.ts', { eager: true }) as Record<string, Record<string, unknown>>;
export const POLICIES: Partial<Record<MapEventKind, EventPolicy>> = { ...CORE };
for (const mod of Object.values(modules)) for (const [name, fn] of Object.entries(mod)) {
  const kind = NAMED[name];
  if (kind && typeof fn === 'function') POLICIES[kind] = fn as EventPolicy;
}

export interface SweepOptions {
  /** Party size (default 1; the fair stats are per player). */
  party?: number;
  /** Play at most this many minutes of map time (default 20). */
  minutes?: number;
  /** The wave to force the plan into (default: inside the kind's window by seed). */
  wave?: number;
  /** Run without the event policy (what a bot that ignores the event does). */
  noPolicy?: boolean;
  scaling?: Partial<typeof TIER5>;
}

export interface SweepResult {
  kind: MapEventKind | 'none';
  theme: Theme;
  seed: number;
  /**
   * 'stuck': the scripted bot stood pinned against scenery for over a minute with nothing to fight (a bot limitation that predates the
   * events: the run ends there; the event's own outcome is still counted).
   */
  result: 'cleared' | 'died' | 'timeout' | 'stuck';
  minutes: number;
  /** The forced event's finish record (undefined when it never finished). */
  event?: { grade: number; tally: number };
  /** Seconds between the event becoming active and its finish (0 if it never did). */
  eventSeconds: number;
  /** Longest stretch (s) a wave tell was held by an event. */
  maxHold: number;
  errors: number;
  deaths: number;
  /** Deaths while the forced event was running (its own death-rate delta; later boss deaths are flask and level attrition). */
  eventDeaths: number;
}

/** `kind` 'none' plays the same map with no event at all: the baseline the events' death-rate delta is measured against. */
export function sweepRun(kind: MapEventKind | 'none', theme: Theme, seed: number, o: SweepOptions = {}): SweepResult {
  const { hooks } = makeHooks();
  const [lo, hi] = kind === 'none' ? [2, 4] : MAP_EVENT_WINDOW[kind];
  const wave = o.wave ?? lo + (seed % (hi - lo + 1));
  const party = Math.max(1, o.party ?? 1);
  const { run, world } = createRunInternal({
    ...makeConfig({ theme, seed, hooks, arenaRadius: ARENA[theme] ?? 900, scaling: { ...TIER5, ...(o.scaling ?? {}) } }),
    ...(kind === 'none' ? {} : { event: { kind, wave, angle: seed * 1.37, variant: (seed * 37) & 255 } }),
  });
  for (let k = 1; k <= party; k++) run.addPlayer(makeJoin(k, { stats: fairStats(), skills: fairSkills(), loadout: STRONG_LOADOUT }));
  const bots = Array.from({ length: party }, () => createBot());
  const policy = o.noPolicy || kind === 'none' ? undefined : POLICIES[kind];
  let result: SweepResult['result'] = 'timeout';
  let deaths = 0, eventDeaths = 0, hold = 0, maxHold = 0, activeAt = -1, finishedAt = -1;
  let anchorX = 0, anchorY = 0, anchorT = 0;
  const ticks = Math.round((Math.max(1, o.minutes ?? 20) * 60) / SIM_DT);
  for (let t = 0; t < ticks; t++) {
    for (let k = 0; k < party; k++) {
      let intent = bots[k].intent(run.view, k + 1);
      if (policy) intent = policy(world, k + 1, intent);
      run.setIntent(k + 1, intent);
    }
    run.step();
    run.drainEvents();
    const e = world.mapEvent?.live.find(x => x.kind === kind);
    if (e && e.phase === 'active' && activeAt < 0) activeAt = world.time;
    if (world.mapEvent?.results.some(r => r.kind === kind) && finishedAt < 0) finishedAt = world.time;
    // A wave tell that stays on screen while an event is live is the "hold": boss-time events may hold it a few seconds only.
    hold = world.director.tellWave > 0 && world.mapEvent?.live.some(x => x.hold > 0) ? hold + SIM_DT : 0;
    maxHold = Math.max(maxHold, hold);
    if (t % 60 === 0) {
      const p0 = world.players[0];
      if (p0 && Math.hypot(p0.x - anchorX, p0.y - anchorY) > 25) { anchorX = p0.x; anchorY = p0.y; anchorT = world.time; }
      else if (p0 && !p0.dead && world.time - anchorT > 90 && world.director.phase !== 'cleared' && world.director.phase !== 'hideout') { result = 'stuck'; break; }
    }
    const out = run.drainOutcomes();
    const died = out.filter(x => x.t === 'playerDied').length;
    deaths += died;
    if (died > 0 && world.mapEvent?.live.some(x => x.kind === kind && (x.phase === 'active' || x.phase === 'warning'))) eventDeaths += died;
    if (party === 1 && out.some(x => x.t === 'playerDied')) { result = 'died'; break; }
    if (party > 1 && world.living.length === 0) { result = 'died'; break; }
    if (out.some(x => x.t === 'cleared')) { result = 'cleared'; break; }
  }
  const r = world.mapEvent?.results.find(x => x.kind === kind);
  return {
    kind, theme, seed, result, minutes: world.tick * SIM_DT / 60, ...(r ? { event: { grade: r.grade, tally: r.tally } } : {}),
    eventSeconds: activeAt >= 0 ? Math.max(0, (finishedAt >= 0 ? finishedAt : world.time) - activeAt) : 0, maxHold,
    errors: world.hookErrors.total, deaths, eventDeaths,
  };
}

/** Summaries for a batch of runs. */
export function summarize(runs: readonly SweepResult[]) {
  const n = runs.length || 1;
  const grades = [0, 0, 0, 0];
  let finished = 0, seconds = 0;
  for (const r of runs) if (r.event) { grades[r.event.grade]++; finished++; seconds += r.eventSeconds; }
  return {
    runs: runs.length, cleared: runs.filter(r => r.result === 'cleared').length / n, died: runs.filter(r => r.result === 'died').length / n,
    timeout: runs.filter(r => r.result === 'timeout').length, stuck: runs.filter(r => r.result === 'stuck').length, finished: finished / n, gold: grades[3] / n, silver: grades[2] / n,
    bronze: grades[1] / n, failed: grades[0] / n, meanEventSeconds: finished ? seconds / finished : 0,
    maxHold: Math.max(0, ...runs.map(r => r.maxHold)), errors: runs.reduce((a, r) => a + r.errors, 0),
    eventDied: runs.filter(r => r.eventDeaths > 0).length / n,
  };
}
