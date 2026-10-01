import { afterEach, describe, expect, it, vi } from 'vitest';
import { SIM_DT, type PlayerIntent, type SimRun } from '../../src/contracts/sim';
import { createRun } from '../../src/sim';
import { createBot } from './bot';
import {
  STRONG_LOADOUT, TIER5, floorSpec, makeConfig, makeHooks, makeJoin, rulesAutoPickup, strongSkills, strongStats, type ConfigOptions,
} from './fixtures';

const TICKS = 3000;

/**
 * Golden digests of the long-standing paths (bot play through waves, packs, elites, hazards, skills,
 * loot scatter, the Matriarch and the clear). The replay tests below only compare the
 * code with itself; these catch any drift of the old behaviour. Nothing but src/sim, src/core/rng and
 * the frozen contracts feeds them (the fixtures and the bot are local), so they only move when the
 * sim's behaviour does. A DELIBERATE behaviour change updates them — say so in the change; an
 * accidental one is a bug.
 *
 * History:
 *  - pinned when click pickups and floor items were added: 4242 → [2176940347, 1429865467, 547817646],
 *    9001 → 2785589049 in 17574 ticks.
 *  - the roster move (Ashen Forge onto src/sim/rosters) reproduced those exactly (checked before
 *    anything else changed).
 *  - re-pinned deliberately for player debuffs (GAME_SPEC §13): spitter lobs, Matriarch orbs, fire
 *    pools and eruptions now set players burning, Rift Stalker leaps and Herald orbs wither; area ids
 *    carry a heading/variant (area-geometry.ts); the digest now covers each player's debuff timers.
 *    The 9001 map still ends on the same tick.
 *  - 9001 re-pinned deliberately for the prop slide (ai.ts integrate: a hunting heavy body that walks
 *    into props without headway for 0.25 s slides around them). One Ironhide Brute, chasing the bot
 *    during the boss fight, walked head-on into a brazier and used to grind against it; it now steps
 *    along its surface after 0.25 s (tick 14743), and the fight plays out differently from there: previously
 *    483987865 in 17574 ticks. 4242 is unchanged (no slide fires there). Lifting debuffs on the clear
 *    changes neither.
 *  - 9001 re-pinned deliberately for the cross-theme balance pass (numbers only: Matriarch and Herald
 *    life 7000 → 1300 and 1200 → 850, Matriarch orb/slam/meteor multipliers, the Herald's speed and
 *    distance band, ROOT_GRACE). The boss now falls much sooner, so the map ends earlier: previously
 *    213161676 in 17553 ticks. 4242 is unchanged (its 3000 ticks end before the Herald arrives).
 */
/** record(4242): digests after ticks 1000, 2000 and 3000. */
// Re-pinned 2026-09-30 for the bot's pillar-navigation fix: static props no longer stop pursuit, and again for
// level-scaled enemy projectile speed and intercept aim.
// Re-pinned 2026-10-01: spawns resolve to a point clear of solid props (spawn.ts freeSpawnPoint; tick 1000 is unchanged), and the
// bot no longer flip-flops on drops near the rim.
// Re-pinned 2026-10-01 for cover (props have a cover height: tall props stop straight shots, src/sim/cover.ts; shooters hold fire behind
// walls) and the bot that sees it (tests/sim/bot.ts aims at what it can see). Tick 1000 is unchanged: no shot meets a wall before it.
const GOLDEN_4242 = [3614022833, 1187237647, 2269660000];
/** The whole tier-5 map at seed 9001 (the bot clears it and takes the return portal): its final digest and length. */
// Re-pinned 2026-09-30 after removing the wave-3 lieutenant and fixing bot pursuit around pillars.
// The complete intent recording still replays to identical intermediate and final digests below.
// Re-pinned 2026-10-01 with GOLDEN_4242 (spawn placement clear of solids, rim/drop decision).
// Re-pinned 2026-10-01 for cover (see GOLDEN_4242): previously 1734587646 in 16189 ticks. The map still clears.
const GOLDEN_9001 = { digest: 993620320, ticks: 16617 };
const strong = { stats: strongStats(), skills: strongSkills(), loadout: STRONG_LOADOUT };

function soloRun(seed: number, extra: Partial<ConfigOptions> = {}): SimRun {
  const run = createRun(makeConfig({ seed, scaling: { ...TIER5, hazards: true }, ...extra }));
  run.addPlayer(makeJoin(1, strong));
  return run;
}

/** Run with the bot, recording every intent and a digest every 100 ticks. */
function record(seed: number) {
  const run = soloRun(seed);
  const bot = createBot();
  const intents: PlayerIntent[] = [];
  const digests: number[] = [];
  for (let t = 0; t < TICKS; t++) {
    const intent = bot.intent(run.view, 1);
    intents.push(structuredClone(intent));
    run.setIntent(1, intent);
    run.step();
    run.drainEvents();
    run.drainOutcomes();
    if (t % 100 === 99) digests.push(run.digest());
  }
  return { intents, digests, kills: run.view.run.kills };
}

function replay(seed: number, intents: PlayerIntent[]) {
  const run = soloRun(seed);
  const digests: number[] = [];
  for (let t = 0; t < intents.length; t++) {
    run.setIntent(1, intents[t]);
    run.step();
    run.drainEvents();
    run.drainOutcomes();
    if (t % 100 === 99) digests.push(run.digest());
  }
  return digests;
}

describe('determinism', () => {
  afterEach(() => vi.restoreAllMocks());

  it('same seed + same intents → identical digests for 3000 ticks', () => {
    const a = record(4242);
    expect(a.kills).toBeGreaterThan(20); // the run actually did things
    const b = replay(4242, a.intents);
    expect(b).toEqual(a.digests);
  });

  it('the old paths are unchanged: bot play at seed 4242 matches the pinned golden digests', () => {
    const a = record(4242);
    expect([a.digests[9], a.digests[19], a.digests[29]]).toEqual(GOLDEN_4242);
  });

  it('a whole tier-5 map (elites, hazards, extra projectiles, boss, clear) replays exactly', () => {
    const cfg = () =>
      makeConfig({ seed: 9001, scaling: { ...TIER5, magicPackChance: 0.4, rarePackChance: 0.2, hazards: true, extraProjectiles: 1 } });
    const run = createRun(cfg());
    run.addPlayer(makeJoin(1, strong));
    const bot = createBot();
    const intents: PlayerIntent[] = [];
    const digests: number[] = [];
    const seen = new Set<string>();
    let done = false;
    for (let t = 0; t < Math.round((15 * 60) / SIM_DT) && !done; t++) {
      const intent = bot.intent(run.view, 1);
      intents.push(structuredClone(intent));
      run.setIntent(1, intent);
      run.step();
      for (const e of run.drainEvents()) if (e.t === 'bossPhase' || e.t === 'cleared' || e.t === 'waveStart') seen.add(`${e.t}`);
      for (const o of run.drainOutcomes()) {
        if (o.t === 'returnPortal' || o.t === 'playerDied') done = true;
        if (o.t === 'kill' && o.isLieutenant) seen.add('herald');
      }
      if (t % 200 === 199) digests.push(run.digest());
    }
    // The run really covered the whole map.
    expect(done).toBe(true);
    expect([...seen].sort()).toEqual(['bossPhase', 'cleared', 'waveStart']);
    expect(run.view.run.phase).toBe('cleared');

    const again = createRun(cfg());
    again.addPlayer(makeJoin(1, strong));
    const replayed: number[] = [];
    for (let t = 0; t < intents.length; t++) {
      again.setIntent(1, intents[t]);
      again.step();
      again.drainEvents();
      again.drainOutcomes();
      if (t % 200 === 199) replayed.push(again.digest());
    }
    expect(replayed).toEqual(digests);
    expect(again.digest()).toBe(run.digest());
    // …and the old path itself is unchanged (see GOLDEN_9001).
    expect({ digest: run.digest(), ticks: intents.length }).toEqual(GOLDEN_9001);
  }, 120_000);

  it('two players (one joining mid-wave) replay to identical digests', () => {
    /** Player 1 from the start, player 2 joins 12 s in; both bots; intents recorded per player. */
    const play = (recorded: PlayerIntent[][] | null) => {
      const run = createRun(makeConfig({ seed: 555, scaling: { ...TIER5, hazards: true, magicPackChance: 0.3, rarePackChance: 0.1 } }));
      run.addPlayer(makeJoin(1, strong));
      const bots = [createBot(), createBot()];
      const intents: PlayerIntent[][] = [[], []];
      const digests: number[] = [];
      let kills = 0;
      for (let t = 0; t < 2400; t++) {
        if (t === 720) run.addPlayer(makeJoin(2, { ...strong, name: 'Second' }));
        for (let k = 0; k < run.view.players.length; k++) {
          const id = run.view.players[k].id;
          const intent = recorded ? recorded[id - 1][t] : structuredClone(bots[id - 1].intent(run.view, id));
          if (!recorded) intents[id - 1][t] = intent;
          run.setIntent(id, intent);
        }
        run.step();
        run.drainEvents();
        for (const o of run.drainOutcomes()) if (o.t === 'kill') kills++;
        if (t % 100 === 99) digests.push(run.digest());
      }
      return { intents, digests, kills, players: run.view.players.length };
    };
    const a = play(null);
    expect(a.players).toBe(2);
    expect(a.kills).toBeGreaterThan(20);
    const b = play(a.intents);
    expect(b.digests).toEqual(a.digests);
  }, 60_000);

  it('floor items and click pickups (server calls between ticks) replay to identical digests and results', () => {
    /** Two bots; player 1 drops an item every 150 ticks, player 2 clicks every public item in reach. */
    const play = (recorded: PlayerIntent[][] | null) => {
      const { hooks, log } = makeHooks({ dropChance: 0.4, autoPickup: rulesAutoPickup });
      const run = createRun(makeConfig({ seed: 808, hooks, scaling: { ...TIER5, magicPackChance: 0.3 } }));
      run.addPlayer(makeJoin(1, strong));
      run.addPlayer(makeJoin(2, { ...strong, name: 'Second' }));
      const bots = [createBot(), createBot()];
      const intents: PlayerIntent[][] = [[], []];
      const digests: number[] = [];
      const results: string[] = [];
      let token = 1_000_000;
      for (let t = 0; t < 2400; t++) {
        if (t % 150 === 75) {
          const p = run.view.players[0];
          results.push(`drop ${run.spawnDrop(floorSpec(token++), p.x, p.y)}`);
        }
        if (t % 30 === 10) {
          const p2 = run.view.players[1];
          for (const d of run.view.drops) {
            if (d.spec.owner === 0 || (d.spec.owner === 2 && !d.spec.autoPickup)) results.push(`${d.id}:${run.requestPickup(2, d.id)}`);
          }
          if (t % 600 === 10 && run.view.drops.length > 0) run.removeDrop(run.view.drops[0].id);
          results.push(`p2 ${Math.round(p2.x)},${Math.round(p2.y)}`);
        }
        for (let k = 0; k < run.view.players.length; k++) {
          const id = run.view.players[k].id;
          const intent = recorded ? recorded[id - 1][t] : structuredClone(bots[id - 1].intent(run.view, id));
          if (!recorded) intents[id - 1][t] = intent;
          run.setIntent(id, intent);
        }
        run.step();
        run.drainEvents();
        run.drainOutcomes();
        if (t % 100 === 99) digests.push(run.digest());
      }
      return { intents, digests, results, picked: log.pickupsBy.length };
    };
    const a = play(null);
    expect(a.results.some((r) => r.endsWith(':ok'))).toBe(true);
    expect(a.results.some((r) => r.endsWith(':tooFar'))).toBe(true);
    const b = play(a.intents);
    expect(b.results).toEqual(a.results);
    expect(b.digests).toEqual(a.digests);
    expect(b.picked).toBe(a.picked);
  }, 60_000);

  it('a different seed diverges', () => {
    const a = record(1);
    const b = replay(2, a.intents);
    expect(b[b.length - 1]).not.toBe(a.digests[a.digests.length - 1]);
  });

  it('never reads Math.random, Date.now or performance.now', () => {
    const boom = () => {
      throw new Error('non-deterministic source used by the sim');
    };
    vi.spyOn(Math, 'random').mockImplementation(boom);
    vi.spyOn(Date, 'now').mockImplementation(boom);
    vi.spyOn(performance, 'now').mockImplementation(boom);
    const run = soloRun(77);
    run.addPlayer(makeJoin(2, strong));
    const bots = [createBot(), createBot()];
    for (let t = 0; t < 1200; t++) {
      run.setIntent(1, bots[0].intent(run.view, 1));
      run.setIntent(2, bots[1].intent(run.view, 2));
      run.step();
      run.drainEvents();
      run.drainOutcomes();
    }
    expect(run.view.tick).toBe(1200);
  });
});
