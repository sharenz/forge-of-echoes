// Shared helpers for the Rimed Ossuary roster tests: arena stepping with event capture, fixtures for the
// map runs (a new-ish Tier 1 character, the fair Tier 5 one) and the telegraph-fairness monitor.
import type { PlayerDebuff } from '../../src/contracts/bestiary';
import type { SkillId } from '../../src/contracts/content';
import {
  PROJECTILE_KINDS, SIM_DT, type AreaKind, type MonsterScaling, type PlayerIntent, type SimEvent, type SimRun, type WorldView,
} from '../../src/contracts/sim';
import { PLAYER_RADIUS } from '../../src/sim/constants';
import { createRunInternal } from '../../src/sim/run';
import type { World } from '../../src/sim/world';
import { createBot } from '../sim/bot';
import {
  STRONG_LOADOUT, TIER5, fairSkills, fairStats, idleIntent, makeConfig, makeJoin, makeSkill, makeStats, type PlayerOptions,
} from '../sim/fixtures';
import { stepWith, type Arena } from '../sim/helpers';

/** A player who never dies and never evades (behaviour tests measure what lands). */
export const tough = () => makeStats({ maxLife: 1e6, evasion: 0 });

export const ticks = (seconds: number): number => Math.round(seconds / SIM_DT);

/** Step every player idle (or with `intent`) until `find` returns something, at most `seconds`; collects all events. */
export function stepUntil<T>(
  a: Arena, seconds: number, find: (events: SimEvent[]) => T | undefined, intent: PlayerIntent | (() => PlayerIntent) = idleIntent(),
  log?: SimEvent[],
): T | undefined {
  for (let t = 0; t < ticks(seconds); t++) {
    stepWith(a.run, typeof intent === 'function' ? intent() : intent);
    const events = a.run.drainEvents();
    log?.push(...events);
    a.run.drainOutcomes();
    const hit = find(events);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** Step `seconds`, returning every event (and outcome) emitted. */
export function stepFor(a: Arena, seconds: number, intent: PlayerIntent | (() => PlayerIntent) = idleIntent()) {
  const events: SimEvent[] = [];
  const outcomes: ReturnType<SimRun['drainOutcomes']> = [];
  for (let t = 0; t < ticks(seconds); t++) {
    stepWith(a.run, typeof intent === 'function' ? intent() : intent);
    events.push(...a.run.drainEvents());
    outcomes.push(...a.run.drainOutcomes());
  }
  return { events, outcomes };
}

/** The live areas of a kind (optionally owned by monster id `owner`). */
export function areasOf(w: World, kind: AreaKind, owner?: number) {
  return w.areas.filter((x) => x.kind === kind && !x.dead && (owner === undefined || x.owner === owner));
}

export function debuffEvents(events: SimEvent[], id: PlayerDebuff, playerId = 1) {
  return events.filter((e): e is Extract<SimEvent, { t: 'debuff' }> => e.t === 'debuff' && e.debuff === id && e.playerId === playerId);
}

export function attacks(events: SimEvent[], kind: string, attack?: string) {
  return events.filter((e): e is Extract<SimEvent, { t: 'monsterAttack' }> =>
    e.t === 'monsterAttack' && e.kind === kind && (attack === undefined || e.attack === attack));
}

// ---------------------------------------------------------------------------------------------------------
// Map fixtures
// ---------------------------------------------------------------------------------------------------------

/** A Tier 1 Rimed Ossuary as the rules build it: tier 1 (65% less life, 40% less damage) × the base's +20% life. */
export const TIER1_OSSUARY: Partial<MonsterScaling> = { level: 12, lifeMultiplier: 0.42, damageMultiplier: 0.6 };

/**
 * A new-ish character: level 6, the level a fresh Sorceress reaches over the two Ashen Forge Tier 1 maps of
 * her starting kit before she opens its Rimed Ossuary — the starting gear (a Blazing Ashwood Wand, an Ashen
 * Robe), no resistances, rank 1 Lance / Shards / Rift Step / Ward and a rank 3 Nova, the starting belt. The
 * numbers are what the rules resolve for exactly that character (rules.playerRuntime with the balance
 * playthrough's point policy), written out so these sim tests don't depend on the rules. Unlike a real
 * player she doesn't level up (and refill) during the map.
 */
export function newishPlayer(): PlayerOptions {
  const lance = makeSkill('emberLance', 1);
  const nova = makeSkill('emberNova', 3);
  const shards = makeSkill('rimeShards', 1);
  const step = makeSkill('riftStep', 1);
  const ward = makeSkill('cinderWard', 1);
  return {
    level: 6,
    stats: makeStats({ maxLife: 127, maxFocus: 107, focusRegen: 5.14, evasion: 0.33, moveSpeed: 110, pickupRadius: 90 }),
    skills: [
      { ...lance, damage: 22.78 },
      { ...nova, damage: 24.7, projectiles: 12, pierce: 1 },
      { ...shards, damage: 10.19, projectiles: 3 },
      { ...step, distance: 90, charges: 2, cooldown: 3.5 },
      { ...ward, damage: 5.7, cooldown: 14, duration: 4, damageReduction: 0.35 },
    ],
    loadout: ['emberLance', 'emberNova', 'cinderWard', 'riftStep', 'rimeShards', null] as (SkillId | null)[],
    flasks: [
      { flaskId: 'lifeFlask', count: 3, resource: 'life', amount: 88, duration: 3 },
      { flaskId: 'lifeFlask', count: 3, resource: 'life', amount: 88, duration: 3 },
      { flaskId: 'focusFlask', count: 3, resource: 'focus', amount: 54, duration: 3 },
      null,
    ],
  };
}

/** The fair Tier 5 character of the balance suite (tests/sim/balance.ts). */
export function fairPlayer(): PlayerOptions {
  return { stats: fairStats(), skills: fairSkills(), loadout: STRONG_LOADOUT };
}

export interface MapRun {
  result: 'cleared' | 'died' | 'timeout';
  minutes: number;
  minLife: number;
  /** Lowest life share during the boss fight (1 when she never came). */
  bossMinLife: number;
  flasks: number;
  seen: Set<string>;
  debuffs: Map<string, number>;
  lieutenant: string;
  boss: string;
  digests: number[];
  /** Freezes / roots that had no visible source (must stay empty). */
  unfair: string[];
  /** Freezes and roots checked by the fairness monitor (and how many of each). */
  checked: number;
  roots: number;
  freezes: number;
}

/**
 * A careless player: every `every` seconds she stops walking for `idle` seconds (still casting and
 * drinking) — long enough for webs, wisp bursts and prisons to land on her, so the fairness monitor has
 * roots and freezes to check over a whole map.
 */
export interface Sloppy {
  every: number;
  idle: number;
}

export const SLOPPY: Sloppy = { every: 3, idle: 1.2 };

/**
 * The bot plays a whole Rimed Ossuary map (a party of one) until the clear, a death or `maxMinutes`. Every
 * tick the fairness monitor checks each freeze and root against what the player could see.
 */
export function playOssuary(
  seed: number, player: PlayerOptions, scaling: Partial<MonsterScaling>,
  opts: { maxMinutes?: number; record?: PlayerIntent[]; sloppy?: Sloppy } = {},
): MapRun {
  const { run, world } = createRunInternal(makeConfig({ theme: 'rimedOssuary', seed, arenaRadius: 900, scaling }));
  run.addPlayer(makeJoin(1, player));
  const bot = createBot();
  const monitor = createFairnessMonitor();
  const out: MapRun = {
    result: 'timeout', minutes: 0, minLife: 1, bossMinLife: 1, flasks: 0, seen: new Set(), debuffs: new Map(), lieutenant: '', boss: '', digests: [],
    unfair: [], checked: 0, roots: 0, freezes: 0,
  };
  const limit = ticks((opts.maxMinutes ?? 20) * 60);
  const every = opts.sloppy ? ticks(opts.sloppy.every) : 0;
  const idle = opts.sloppy ? ticks(opts.sloppy.idle) : 0;
  for (let t = 0; t < limit; t++) {
    const intent = bot.intent(run.view, 1);
    if (every > 0 && t % every < idle) {
      intent.moveX = 0;
      intent.moveY = 0;
    }
    opts.record?.push(structuredClone(intent));
    monitor.before(run.view);
    run.setIntent(1, intent);
    run.step();
    const events = run.drainEvents();
    monitor.after(run.view, events);
    for (const e of events) {
      if (e.t === 'monsterSpawn') out.seen.add(e.kind);
      if (e.t === 'debuff') out.debuffs.set(e.debuff, (out.debuffs.get(e.debuff) ?? 0) + 1);
    }
    out.lieutenant ||= run.view.run.lieutenant?.name ?? '';
    out.boss ||= run.view.run.boss?.name ?? '';
    const p = run.view.players[0];
    if (!p.dead) out.minLife = Math.min(out.minLife, p.life / p.maxLife);
    if (!p.dead && run.view.run.boss) out.bossMinLife = Math.min(out.bossMinLife, p.life / p.maxLife);
    if (t % 300 === 299) out.digests.push(run.digest());
    const outcomes = run.drainOutcomes();
    out.flasks += outcomes.filter((o) => o.t === 'flaskUsed').length;
    if (outcomes.some((o) => o.t === 'playerDied')) {
      out.result = 'died';
      break;
    }
    if (outcomes.some((o) => o.t === 'cleared')) {
      out.result = 'cleared';
      break;
    }
  }
  out.minutes = (world.tick * SIM_DT) / 60;
  out.unfair = monitor.unfair;
  out.checked = monitor.checked;
  out.roots = monitor.roots;
  out.freezes = monitor.freezes;
  return out;
}

/** Replay recorded intents on a fresh run of the same map: the digests every 300 ticks. */
export function replayOssuary(seed: number, player: PlayerOptions, scaling: Partial<MonsterScaling>, intents: PlayerIntent[]): number[] {
  const { run } = createRunInternal(makeConfig({ theme: 'rimedOssuary', seed, arenaRadius: 900, scaling }));
  run.addPlayer(makeJoin(1, player));
  const digests: number[] = [];
  for (let t = 0; t < intents.length; t++) {
    run.setIntent(1, intents[t]);
    run.step();
    run.drainEvents();
    run.drainOutcomes();
    if (t % 300 === 299) digests.push(run.digest());
  }
  return digests;
}

export { TIER5 };

// ---------------------------------------------------------------------------------------------------------
// Telegraph fairness (GAME_SPEC §13: every root and freeze comes from a projectile you can see or a
// telegraph you can read)
// ---------------------------------------------------------------------------------------------------------

const WEB = PROJECTILE_KINDS.indexOf('webShot');
/** A web must have been in flight at least this long to count as seen (≈ 6 frames). */
const MIN_WEB_FLIGHT = 0.1;

interface SeenArea {
  kind: AreaKind;
  x: number;
  y: number;
  radius: number;
  firstSeen: number;
  duration: number;
}

export interface FairnessMonitor {
  /** Call with the view before a step (snapshots the webs in flight and the telegraphs shown). */
  before(view: WorldView): void;
  /** Call with the view and the drained events after the step. */
  after(view: WorldView, events: SimEvent[]): void;
  readonly unfair: string[];
  readonly checked: number;
  readonly roots: number;
  readonly freezes: number;
}

/**
 * Checks every 'debuff' frozen / rooted event against what its player could see:
 *  - rooted ← a webShot (the Ossuary's only root) in flight for ≥ MIN_WEB_FLIGHT that was about to
 *    reach the player on the tick the root landed;
 *  - frozen ← a wispBurst or icePrison telegraph that resolved on that tick with the player inside, and
 *    had been on screen for its whole duration (0.7 s pulse, 2 s prison) — at least 0.6 s either way.
 */
export function createFairnessMonitor(): FairnessMonitor {
  const webs: { x: number; y: number; vx: number; vy: number; r: number; age: number }[] = [];
  const shown = new Map<number, SeenArea>();
  const players = new Map<number, { x: number; y: number }>();
  const state = { unfair: [] as string[], roots: 0, freezes: 0 };
  return {
    get unfair() {
      return state.unfair;
    },
    get checked() {
      return state.roots + state.freezes;
    },
    get roots() {
      return state.roots;
    },
    get freezes() {
      return state.freezes;
    },
    before(view) {
      webs.length = 0;
      const pr = view.projectiles;
      for (let i = 0; i < pr.capacity; i++) {
        if (!pr.alive[i] || !pr.hostile[i] || pr.kind[i] !== WEB) continue;
        webs.push({ x: pr.x[i], y: pr.y[i], vx: pr.vx[i], vy: pr.vy[i], r: pr.radius[i], age: pr.age[i] });
      }
      players.clear();
      for (const p of view.players) players.set(p.id, { x: p.x, y: p.y });
      for (const a of view.areas) {
        if (!shown.has(a.id)) shown.set(a.id, { kind: a.kind, x: a.x, y: a.y, radius: a.radius, firstSeen: view.time - a.age, duration: a.duration });
        else {
          const s = shown.get(a.id)!;
          s.x = a.x;
          s.y = a.y;
          s.radius = a.radius;
        }
      }
    },
    after(view, events) {
      for (const e of events) {
        if (e.t !== 'debuff' || (e.debuff !== 'rooted' && e.debuff !== 'frozen')) continue;
        if (e.debuff === 'rooted') state.roots++;
        else state.freezes++;
        const p = players.get(e.playerId) ?? { x: e.x, y: e.y };
        if (e.debuff === 'rooted') {
          const ok = webs.some((wb) => {
            if (wb.age < MIN_WEB_FLIGHT) return false;
            // Where the web can reach this tick (its sweep plus the bodies' radii, a little slack).
            const reach = Math.hypot(wb.vx, wb.vy) * SIM_DT * 2 + wb.r + PLAYER_RADIUS + 2;
            return Math.hypot(wb.x - p.x, wb.y - p.y) <= reach;
          });
          if (!ok) state.unfair.push(`t=${view.time.toFixed(2)} player ${e.playerId} rooted without a web in flight`);
        } else {
          const ok = events.some((r) => {
            if (r.t !== 'areaResolve' || (r.kind !== 'wispBurst' && r.kind !== 'icePrison')) return false;
            if (Math.hypot(r.x - p.x, r.y - p.y) > r.radius + PLAYER_RADIUS) return false;
            for (const s of shown.values()) {
              if (s.kind !== r.kind || Math.hypot(s.x - r.x, s.y - r.y) > 1) continue;
              const onScreen = view.time - s.firstSeen;
              if (onScreen >= Math.min(0.6, s.duration) && onScreen >= s.duration - SIM_DT * 1.5) return true;
            }
            return false;
          });
          if (!ok) state.unfair.push(`t=${view.time.toFixed(2)} player ${e.playerId} frozen without a telegraph shown to its end`);
        }
      }
      // Forget areas that are gone.
      if (shown.size > 256) {
        const live = new Set(view.areas.map((a) => a.id));
        for (const id of [...shown.keys()]) if (!live.has(id)) shown.delete(id);
      }
    },
  };
}
