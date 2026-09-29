// Multiplayer: parties of up to 4 in one instance — joining and leaving, instanced loot, shared XP,
// party scaling, targeting, per-player death, and a full map cleared by four bots.
import { describe, expect, it } from 'vitest';
import { MONSTER_KINDS } from '../../src/contracts/content';
import { SIM_DT, type SimEvent, type SimOutcome } from '../../src/contracts/sim';
import { createRun } from '../../src/sim';
import { monsterDef } from '../../src/sim/rosters';
import { damageMonster, damagePlayer } from '../../src/sim/combat';
import { MAX_PLAYERS } from '../../src/sim/constants';
import { DAMAGE_INDEX } from '../../src/sim/math';
import { createRunInternal } from '../../src/sim/run';
import { planWave } from '../../src/sim/waves';
import { createBot } from './bot';
import {
  STRONG_LOADOUT, TIER5, idleIntent, makeConfig, makeHooks, makeJoin, makeParty, makeSkill, makeStats, strongSkills, strongStats,
} from './fixtures';
import { joinArena, makeArena, ofType, outcomesOf, placeMonster, pv, stepN, walkIntent } from './helpers';

const strong = { stats: strongStats(), skills: strongSkills(), loadout: STRONG_LOADOUT };
const sturdy = () => makeStats({ maxLife: 1e9, evasion: 0 });

describe('joining and leaving', () => {
  it('holds at most 4 players with unique ids 1..255', () => {
    const run = createRun(makeConfig());
    for (let id = 1; id <= MAX_PLAYERS; id++) run.addPlayer(makeJoin(id * 10));
    expect(MAX_PLAYERS).toBe(4);
    expect(() => run.addPlayer(makeJoin(99))).toThrow(/at most 4/);
    run.removePlayer(20);
    expect(() => run.addPlayer(makeJoin(10))).toThrow(/already/);
    expect(() => run.addPlayer(makeJoin(0))).toThrow();
    expect(() => run.addPlayer(makeJoin(256))).toThrow();
    run.addPlayer(makeJoin(99));
    // Stable join order in the view; removing an unknown id is harmless.
    expect(run.view.players.map((p) => p.id)).toEqual([10, 30, 40, 99]);
    expect(() => run.removePlayer(123)).not.toThrow();
  });

  it('an empty instance steps safely and waits for its first player', () => {
    for (const mode of ['map', 'hideout'] as const) {
      const run = createRun(makeConfig({ mode, seed: 2 }));
      run.setIntent(1, idleIntent()); // nobody here yet: ignored
      for (let t = 0; t < 600; t++) run.step();
      expect(run.view.run.wave).toBe(0);
      expect(run.view.run.playersAlive).toBe(0);
      expect(run.drainOutcomes()).toEqual([]);
      run.addPlayer(makeJoin(1, { stats: sturdy() }));
      for (let t = 0; t < Math.round(5 / SIM_DT); t++) run.step();
      if (mode === 'map') expect(run.view.run.wave).toBe(1);
      else expect(run.view.run.phase).toBe('hideout');
    }
  });

  it('a player arriving after the clear can still open the chest and go home', () => {
    const { hooks, log } = makeHooks();
    const { run, world } = makeParty({ seed: 8, hooks, waves: { count: 0 } }, [{ stats: sturdy() }]);
    run.step();
    expect(run.view.run.phase).toBe('cleared');
    run.removePlayer(1);
    run.addPlayer(makeJoin(2, { stats: sturdy() }));
    const chest = run.view.props.find((p) => p.kind === 'chest')!;
    const portal = run.view.props.find((p) => p.kind === 'returnPortal')!;
    const r1 = stepN(run, 400, () => walkIntent(pv(run, 2).x, pv(run, 2).y, chest.x, chest.y), 2);
    expect(outcomesOf(r1.outcomes, 'chestOpened')).toEqual([{ t: 'chestOpened', playerId: 2 }]);
    expect(log.chestRolls).toEqual([[2]]);
    const r2 = stepN(run, 400, () => walkIntent(pv(run, 2).x, pv(run, 2).y, portal.x, portal.y), 2);
    expect(outcomesOf(r2.outcomes, 'returnPortal')).toEqual([{ t: 'returnPortal', playerId: 2 }]);
    expect(world.players.map((p) => p.id)).toEqual([2]);
  });

  it('a party arriving together fans out around the entry point', () => {
    const { run } = makeParty({ seed: 3 }, [{}, {}, {}, {}]);
    const ps = run.view.players;
    for (let a = 0; a < ps.length; a++) {
      expect(Math.hypot(ps[a].x, ps[a].y)).toBeLessThan(20);
      for (let b = a + 1; b < ps.length; b++) expect(Math.hypot(ps[a].x - ps[b].x, ps[a].y - ps[b].y)).toBeGreaterThan(10);
    }
    expect(ofType(run.drainEvents(), 'playerJoin').map((e) => e.playerId)).toEqual([1, 2, 3, 4]);
    expect(run.view.run.playersAlive).toBe(4);
  });

  it('allies standing on the same spot are eased apart', () => {
    const a = makeArena();
    joinArena(a, 2, 0, 0);
    stepN(a.run, 60);
    const [p1, p2] = a.run.view.players;
    expect(Math.hypot(p1.x - p2.x, p1.y - p2.y)).toBeGreaterThan(12);
    expect(Math.hypot(p1.x - p2.x, p1.y - p2.y)).toBeLessThan(20);
  });

  it('join and leave mid-wave: ids and view objects stay stable, the leaver takes their drops and effects', () => {
    const { hooks } = makeHooks({ dropChance: 1 });
    const { run, world } = createRunInternal(makeConfig({ seed: 44, hooks }));
    run.addPlayer(makeJoin(1, { stats: sturdy(), skills: strongSkills(), loadout: STRONG_LOADOUT }));
    const view1 = run.view.players[0];
    // Into wave 1.
    for (let t = 0; t < Math.round(6 / SIM_DT); t++) {
      run.setIntent(1, idleIntent());
      run.step();
    }
    expect(run.view.run.wave).toBe(1);
    run.addPlayer(makeJoin(2, { stats: makeStats({ maxLife: 1e9, evasion: 0, flags: ['fireTrail'] }), skills: strongSkills(), loadout: STRONG_LOADOUT }));
    const p2 = world.playerById[2]!;
    // Player 2 walks around (fire trail), wards up, and a kill drops loot for both.
    const ward = { ...idleIntent(), moveX: 1 };
    ward.held[4] = true; // cinder ward
    for (let t = 0; t < 60; t++) {
      run.setIntent(1, idleIntent());
      run.setIntent(2, ward);
      run.step();
    }
    expect(pv(run, 2).wardTime).toBeGreaterThan(0);
    expect(world.areas.some((a) => a.kind === 'fireTrail' && a.source === 2)).toBe(true);
    const i = placeMonster(world, 'ashling', p2.x + 30, p2.y, { life: 1 });
    damageMonster(world, i, 100, DAMAGE_INDEX.fire, 0, 1.5, 0, 1, 0, 1, true, 2);
    expect(new Set(run.view.drops.map((d) => d.spec.owner))).toEqual(new Set([1, 2]));
    // Monsters locked on player 2 must let go when they leave.
    const m = world.monsters;
    run.removePlayer(2);
    expect(run.view.players).toEqual([view1]);
    expect(run.view.players[0]).toBe(view1);
    expect(run.view.drops.every((d) => d.spec.owner === 1)).toBe(true);
    expect(run.view.drops.length).toBeGreaterThan(0);
    expect(world.areas.some((a) => a.source === 2)).toBe(false);
    expect(run.view.run.playersAlive).toBe(1);
    // The instance keeps running for player 1; nobody hunts a ghost.
    for (let t = 0; t < 120; t++) {
      run.setIntent(1, idleIntent());
      run.step();
    }
    for (let k = 0; k < m.capacity; k++) if (m.alive[k] && m.spawnTime[k] <= 0) expect(m.target[k]).not.toBe(2);
    // Ids are per instance: player 2 may come back.
    run.addPlayer(makeJoin(2));
    expect(run.view.players.map((p) => p.id)).toEqual([1, 2]);
  });
});

describe('instanced loot', () => {
  it('each drop has an owner; only the owner draws it in and picks it up', () => {
    const a = makeArena({ hooks: { dropChance: 1 }, stats: makeStats({ pickupRadius: 30 }) });
    const p2 = joinArena(a, 2, -150, 0, makeStats({ pickupRadius: 30 }));
    // Out of both players' pickup reach, so nothing is drawn in until someone walks over.
    const i = placeMonster(a.world, 'ashling', 0, 150, { life: 1 });
    damageMonster(a.world, i, 100, DAMAGE_INDEX.fire, 0, 1.5, 0, 1, 0, 1, true, 1);
    expect(a.log.killRolls.map((r) => r.playerIds)).toEqual([[1, 2]]);
    const spawns = ofType(a.run.drainEvents(), 'dropSpawn');
    expect(spawns.map((e) => e.owner).sort()).toEqual([1, 2]);
    stepN(a.run, 60); // land
    const mine = a.run.view.drops.find((d) => d.spec.owner === 1)!;
    const theirs = a.run.view.drops.find((d) => d.spec.owner === 2)!;
    // Player 2 walks over player 1's drop: nothing happens (no magnet, no pickup attempt).
    const walk2 = stepN(a.run, 150, () => walkIntent(p2.x, p2.y, mine.x, mine.y), 2);
    expect(a.log.pickupsBy.filter((e) => e.token === mine.spec.token)).toHaveLength(0);
    expect(outcomesOf(walk2.outcomes, 'pickup').every((o) => o.playerId === 2 && o.token === theirs.spec.token)).toBe(true);
    expect(a.run.view.drops.some((d) => d.spec.token === mine.spec.token)).toBe(true);
    // Its owner collects it.
    const walk1 = stepN(a.run, 150, () => walkIntent(pv(a.run, 1).x, pv(a.run, 1).y, mine.x, mine.y), 1);
    expect(outcomesOf(walk1.outcomes, 'pickup')).toContainEqual({ t: 'pickup', playerId: 1, token: mine.spec.token });
    expect(ofType(walk1.events, 'pickup').find((e) => e.owner === 1)).toBeDefined();
    // Every pickup went to the drop's owner.
    const ownerOf = new Map(a.log.specs.map((s) => [s.token, s.owner]));
    for (const e of a.log.pickupsBy) expect(ownerOf.get(e.token)).toBe(e.playerId);
  });

  it('a full inventory blocks only that player; tryPickup is asked with the right player id', () => {
    const a = makeArena({ hooks: { dropChance: 1, full: (id) => id === 2 }, stats: makeStats({ pickupRadius: 200 }) });
    joinArena(a, 2, 0, 20, makeStats({ pickupRadius: 200 }));
    const i = placeMonster(a.world, 'ashling', 40, 10, { life: 1 });
    damageMonster(a.world, i, 100, DAMAGE_INDEX.fire, 0, 1.5, 0, 1, 0, 1, true, 1);
    stepN(a.run, 180);
    expect(a.log.pickupsBy.map((e) => e.playerId)).toEqual([1]);
    expect(a.log.blocked).toBe(1);
    expect(a.run.view.drops).toHaveLength(1);
    expect(a.run.view.drops[0].spec.owner).toBe(2);
    expect(a.run.view.drops[0].blocked).toBe(true);
  });

  it('the completion chest opens once, for everyone: every living player gets their own chest loot', () => {
    const { hooks, log } = makeHooks();
    const { run, world } = makeParty(
      { seed: 17, hooks, waves: { count: 1, bossWave: 1, lieutenantWave: 0, waveDuration: 8, tellDuration: 1 } },
      [{ stats: sturdy() }, { stats: sturdy() }, { stats: sturdy() }],
    );
    let boss = -1;
    for (let t = 0; t < Math.round(20 / SIM_DT) && boss < 0; t++) {
      run.step();
      const m = world.monsters;
      for (let k = 0; k < m.capacity; k++) if (m.alive[k] && MONSTER_KINDS[m.kind[k]] === 'cinderMatriarch' && m.spawnTime[k] <= 0) boss = k;
    }
    expect(boss).toBeGreaterThanOrEqual(0);
    // Party of 3: the Matriarch has ×2 life.
    expect(world.monsters.maxLife[boss]).toBeCloseTo(monsterDef('cinderMatriarch').life * 2 * 1, 0);
    // Player 3 falls before the end: the dead get no loot.
    damagePlayer(world, world.playerById[3]!, 1e12, DAMAGE_INDEX.physical, 'area');
    world.monsters.life[boss] = 1;
    damageMonster(world, boss, 1e6, DAMAGE_INDEX.fire, 0, 1.5, 0, 1, 0, 1, true, 2);
    const bossRoll = log.killRolls.find((r) => r.ctx.isBoss)!;
    expect(bossRoll.playerIds).toEqual([1, 2]);
    run.step();
    expect(run.view.run.phase).toBe('cleared');
    const chest = run.view.props.find((p) => p.kind === 'chest')!;
    const portal = run.view.props.find((p) => p.kind === 'returnPortal')!;
    run.drainEvents();
    run.drainOutcomes();
    const r = stepN(run, 300, () => walkIntent(pv(run, 2).x, pv(run, 2).y, chest.x, chest.y), 2);
    expect(outcomesOf(r.outcomes, 'chestOpened')).toEqual([{ t: 'chestOpened', playerId: 2 }]);
    expect(log.chestRolls).toEqual([[1, 2]]);
    const chestDrops = ofType(r.events, 'dropSpawn');
    expect(chestDrops.filter((e) => e.owner === 1)).toHaveLength(6);
    expect(chestDrops.filter((e) => e.owner === 2)).toHaveLength(6);
    // Walking into the opened chest again does nothing; the return portal works per player.
    const back = stepN(run, 400, () => walkIntent(pv(run, 1).x, pv(run, 1).y, portal.x, portal.y), 1);
    expect(outcomesOf(back.outcomes, 'returnPortal')).toEqual([{ t: 'returnPortal', playerId: 1 }]);
    expect(outcomesOf(back.outcomes, 'chestOpened')).toHaveLength(0);
  });
});

describe('shared XP', () => {
  it('a kill is one immediate shared XP outcome regardless of which player is nearby', () => {
    const a = makeArena({ stats: makeStats({ pickupRadius: 0 }) });
    joinArena(a, 2, 200, 0, makeStats({ pickupRadius: 0 }));
    const i = placeMonster(a.world, 'riftStalker', 500, 0, { life: 1 });
    damageMonster(a.world, i, 100, DAMAGE_INDEX.fire, 0, 1.5, 0, 1, 0, 1, true, 1);
    const outcomes = a.run.drainOutcomes();
    expect(outcomesOf(outcomes, 'xp')).toEqual([{ t: 'xp', amount: 8 }]);
    expect(outcomesOf(outcomes, 'kill')).toEqual([expect.objectContaining({ playerId: 1 })]);
    expect(a.run.view.motes.count).toBe(0);
    expect(outcomesOf(stepN(a.run, 120).outcomes, 'xp')).toEqual([]);
  });
});

describe('party scaling', () => {
  it('monster life ×(1 + 0.5·(n−1)) at spawn for the living party', () => {
    const lifeWith = (n: number) => {
      const a = makeArena();
      for (let id = 2; id <= n; id++) joinArena(a, id, id * 20, 0);
      const i = placeMonster(a.world, 'ironhideBrute', 300, 0);
      return a.world.monsters.maxLife[i];
    };
    const solo = lifeWith(1);
    expect(solo).toBeCloseTo(monsterDef('ironhideBrute').life, 3);
    expect(lifeWith(2) / solo).toBeCloseTo(1.5, 5);
    expect(lifeWith(4) / solo).toBeCloseTo(2.5, 5);
  });

  it('wave budget ×(1 + 0.25·(n−1)): wave 1 of 40 becomes 50 with two, 70 with four', () => {
    const wave1 = (n: number) => {
      const { run } = makeParty({ seed: 21 }, Array.from({ length: n }, () => ({ stats: sturdy() })));
      let spawned = 0;
      let started = false;
      for (let t = 0; t < Math.round(62 / SIM_DT); t++) {
        run.step();
        for (const e of run.drainEvents()) if (e.t === 'monsterSpawn' && run.view.run.wave === 1) spawned++;
        if (run.drainOutcomes().some((o) => o.t === 'waveStart' && o.wave === 2)) break;
        started ||= run.view.run.wave === 1;
      }
      expect(started).toBe(true);
      return spawned;
    };
    expect(wave1(1)).toBe(40);
    expect(wave1(2)).toBe(50);
    expect(wave1(4)).toBe(70);
  }, 30_000);

  it('a player joining during the tell is absorbed by the stream (the announced packs stay)', () => {
    const { run, world } = makeParty({ seed: 23 }, [{ stats: sturdy() }]);
    let tellSeen = false;
    for (let t = 0; t < 600 && !tellSeen; t++) {
      run.step();
      tellSeen = run.drainEvents().some((e) => e.t === 'waveTell' && e.wave === 1);
    }
    expect(tellSeen).toBe(true);
    run.addPlayer(makeJoin(2, { stats: sturdy() }));
    let packs = -1;
    for (let t = 0; t < 400 && packs < 0; t++) {
      run.step();
      if (run.drainOutcomes().some((o) => o.t === 'waveStart')) packs = world.monsters.count;
    }
    expect(packs).toBe(24); // 60% of the solo budget of 40, as announced
    expect(world.director.stream.remaining).toBe(26); // 16 + the 10 the second player adds
  });

  it('magic and rare pack chances grow 10% per extra player', () => {
    /** Share of rare and magic packs over many planned waves for a party of n. */
    const shares = (n: number) => {
      const { world } = makeParty({ seed: 5, scaling: { rarePackChance: 0.2, magicPackChance: 0.3 } }, Array.from({ length: n }, () => ({})));
      let packs = 0;
      let rare = 0;
      let magic = 0;
      for (let k = 0; k < 400; k++) {
        for (const p of planWave(world, 1 + (k % 6)).packs) {
          packs++;
          if (p.rarity === 'rare') rare++;
          else if (p.rarity === 'magic') magic++;
        }
      }
      return { rare: rare / packs, magic: magic / (packs - rare) };
    };
    const solo = shares(1);
    const four = shares(4);
    expect(solo.rare).toBeCloseTo(0.2, 1);
    expect(four.rare).toBeCloseTo(0.2 * 1.3, 1);
    expect(four.rare / solo.rare).toBeGreaterThan(1.15);
    expect(four.magic / solo.magic).toBeGreaterThan(1.15);
    expect(four.magic / solo.magic).toBeLessThan(1.45);
  });
});

describe('targeting', () => {
  it('monsters chase the nearest living player; a horde splits between two players', () => {
    const a = makeArena({ stats: sturdy() });
    joinArena(a, 2, 400, 0, sturdy());
    const left: number[] = [];
    const right: number[] = [];
    for (let k = 0; k < 8; k++) {
      left.push(placeMonster(a.world, 'ashling', 100, -60 + k * 15, { still: false }));
      right.push(placeMonster(a.world, 'ashling', 300, -60 + k * 15, { still: false }));
    }
    for (const i of [...left, ...right]) a.world.monsters.attackCd[i] = 1e9;
    stepN(a.run, 90);
    const m = a.world.monsters;
    for (const i of left) expect(m.target[i]).toBe(1);
    for (const i of right) expect(m.target[i]).toBe(2);
    for (const i of left) expect(m.x[i]).toBeLessThan(100);
    for (const i of right) expect(m.x[i]).toBeGreaterThan(300);
  });

  it('keeps its player until another is clearly closer (no flicker at the midpoint)', () => {
    const a = makeArena({ stats: sturdy() });
    joinArena(a, 2, 200, 0, sturdy());
    const i = placeMonster(a.world, 'ashling', 90, 0, { still: false });
    a.world.monsters.attackCd[i] = 1e9;
    a.world.monsters.speed[i] = 0; // hold still at the (almost) midpoint
    stepN(a.run, 2);
    expect(a.world.monsters.target[i]).toBe(1);
    a.world.monsters.x[i] = 106; // now 94 from player 2, 106 from player 1: not enough to switch
    stepN(a.run, 2);
    expect(a.world.monsters.target[i]).toBe(1);
    a.world.monsters.x[i] = 150; // 50 vs 150: switch
    stepN(a.run, 2);
    expect(a.world.monsters.target[i]).toBe(2);
  });

  it('contact damage caps apply per player', () => {
    const a = makeArena({ stats: makeStats({ maxLife: 1000, evasion: 0 }) });
    joinArena(a, 2, 300, 0, makeStats({ maxLife: 1000, evasion: 0 }));
    for (const [cx, n] of [[0, 20], [300, 20]] as const) {
      for (let k = 0; k < n; k++) {
        const ang = (k / n) * Math.PI * 2;
        const i = placeMonster(a.world, 'ashling', cx + Math.cos(ang) * 14, Math.sin(ang) * 14, { still: false });
        a.world.monsters.damage[i] = 500;
        a.world.monsters.attackCd[i] = 0;
      }
    }
    stepN(a.run, 20);
    // Each player lost at most 35% within the first 0.5 s window — independently.
    expect(pv(a.run, 1).life).toBeGreaterThanOrEqual(650 - 1e-3);
    expect(pv(a.run, 2).life).toBeGreaterThanOrEqual(650 - 1e-3);
    expect(pv(a.run, 1).life).toBeLessThan(1000);
    expect(pv(a.run, 2).life).toBeLessThan(1000);
  });
});

describe('death in a party', () => {
  it('one player dies, the others fight on; monsters ignore the corpse', () => {
    const { run, world } = makeParty({ seed: 9 }, [{ stats: makeStats({ maxLife: 30, evasion: 0 }) }, { ...strong, stats: sturdy(), x: 60, y: 0 }]);
    const p1 = world.playerById[1]!;
    const outcomes: SimOutcome[] = [];
    const events: SimEvent[] = [];
    const bot = createBot();
    let died = -1;
    for (let t = 0; t < Math.round(90 / SIM_DT) && died < 0; t++) {
      run.setIntent(2, bot.intent(run.view, 2));
      // The idle player usually falls to the horde; make sure of it after 20 s.
      if (t === Math.round(20 / SIM_DT) && !p1.dead) damagePlayer(world, p1, 1e12, DAMAGE_INDEX.physical, 'area');
      run.step();
      events.push(...run.drainEvents());
      const out = run.drainOutcomes();
      outcomes.push(...out);
      if (out.some((o) => o.t === 'playerDied')) died = t;
    }
    expect(died).toBeGreaterThan(0);
    expect(outcomesOf(outcomes, 'playerDied')).toEqual([{ t: 'playerDied', playerId: 1 }]);
    expect(ofType(events, 'playerDeath').map((e) => e.playerId)).toEqual([1]);
    expect(run.view.run.phase).not.toBe('failed');
    expect(run.view.run.playersAlive).toBe(1);
    const wave = run.view.run.wave;
    const corpse = { x: p1.x, y: p1.y };
    let hitsOnCorpse = 0;
    let waveStarts = 0;
    for (let t = 0; t < Math.round(70 / SIM_DT); t++) {
      run.setIntent(2, bot.intent(run.view, 2));
      run.step();
      for (const e of run.drainEvents()) if (e.t === 'hit' && e.target === 'player' && e.playerId === 1) hitsOnCorpse++;
      for (const o of run.drainOutcomes()) if (o.t === 'waveStart') waveStarts++;
    }
    // The waves roll on for the survivor; nothing targets or hurts the fallen.
    expect(waveStarts).toBeGreaterThan(0);
    expect(run.view.run.wave).toBeGreaterThan(wave);
    expect(hitsOnCorpse).toBe(0);
    const m = world.monsters;
    for (let k = 0; k < m.capacity; k++) if (m.alive[k]) expect(m.target[k]).not.toBe(1);
    expect(pv(run, 1).anim).toBe('death');
    expect(pv(run, 1).dead).toBe(true);
    expect({ x: p1.x, y: p1.y }).toEqual(corpse);
    // The fallen respawns elsewhere: the server removes them.
    run.removePlayer(1);
    expect(run.view.players.map((p) => p.id)).toEqual([2]);
  }, 60_000);

  it('a wiped party freezes the map (failed) until someone comes through a portal', () => {
    const { run, world } = makeParty({ seed: 9 }, [{ stats: sturdy() }, { stats: sturdy() }]);
    stepN(run, Math.round(8 / SIM_DT));
    expect(run.view.run.phase).toBe('fight');
    for (const p of [...world.players]) damagePlayer(world, p, 1e12, DAMAGE_INDEX.physical, 'area');
    stepN(run, 1);
    expect(run.view.run.phase).toBe('failed');
    const waveTime = run.view.run.waveTime;
    const count = world.monsters.count;
    const r = stepN(run, Math.round(20 / SIM_DT));
    expect(run.view.run.waveTime).toBe(waveTime);
    expect(ofType(r.events, 'monsterSpawn')).toHaveLength(0);
    expect(world.monsters.count).toBe(count);
    // The dead leave (respawn at home); a party member re-enters through a portal.
    run.removePlayer(1);
    run.removePlayer(2);
    expect(run.view.players).toHaveLength(0);
    run.addPlayer(makeJoin(3, { stats: sturdy() }));
    expect(run.view.run.phase).toBe('fight');
    stepN(run, 60, idleIntent(), 3);
    expect(run.view.run.waveTime).toBeGreaterThan(waveTime);
  });
});

describe('a full party', () => {
  it('four bots clear a tier-5 map together: shared XP, instanced loot, one chest, four exits', () => {
    const { hooks, log } = makeHooks({ dropChance: 0.1 });
    const { run } = makeParty({ seed: 11, scaling: TIER5, hooks }, [strong, strong, strong, strong]);
    const bots = new Map([1, 2, 3, 4].map((id) => [id, createBot()]));
    const outcomes: SimOutcome[] = [];
    const events: SimEvent[] = [];
    const exited: number[] = [];
    let bossLife = 0;
    const maxTicks = Math.round((14 * 60) / SIM_DT);
    for (let t = 0; t < maxTicks && exited.length < 4; t++) {
      for (const [id, bot] of bots) run.setIntent(id, bot.intent(run.view, id));
      run.step();
      for (const e of run.drainEvents()) if (e.t !== 'hit' && e.t !== 'projectileEnd' && e.t !== 'mote') events.push(e);
      const out = run.drainOutcomes();
      outcomes.push(...out);
      if (run.view.run.boss) bossLife = Math.max(bossLife, run.view.run.boss.maxLife);
      for (const o of out) {
        if (o.t === 'returnPortal') {
          exited.push(o.playerId);
          // As the server would: move them home.
          run.removePlayer(o.playerId);
          bots.delete(o.playerId);
        }
      }
    }
    expect(outcomesOf(outcomes, 'playerDied')).toEqual([]);
    expect(exited.sort()).toEqual([1, 2, 3, 4]);
    expect(outcomesOf(outcomes, 'waveStart').map((o) => o.wave)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(outcomesOf(outcomes, 'kill').filter((k) => k.isBoss)).toHaveLength(1);
    expect(outcomesOf(outcomes, 'kill').filter((k) => k.isLieutenant)).toHaveLength(1);
    // The Matriarch was scaled for four (×2.5 life).
    expect(bossLife).toBeGreaterThan(monsterDef('cinderMatriarch').life * TIER5.lifeMultiplier! * 2.4);
    // Everyone pulled their weight (kill credit is spread over the party).
    const credited = new Set(outcomesOf(outcomes, 'kill').map((k) => k.playerId));
    for (const id of [1, 2, 3, 4]) expect(credited.has(id)).toBe(true);
    // One chest, opened once, with loot for all four.
    expect(outcomesOf(outcomes, 'chestOpened')).toHaveLength(1);
    expect(log.chestRolls).toEqual([[1, 2, 3, 4]]);
    expect(ofType(events, 'cleared')).toHaveLength(1);
    // Instanced loot: every pickup was the owner's own, and everyone picked something up.
    const ownerOf = new Map(log.specs.map((s) => [s.token, s.owner]));
    for (const e of log.pickupsBy) expect(ownerOf.get(e.token)).toBe(e.playerId);
    for (const id of [1, 2, 3, 4]) expect(log.pickupsBy.some((e) => e.playerId === id)).toBe(true);
    expect(outcomesOf(outcomes, 'pickup').map((o) => o.token)).toEqual(log.pickups);
    // Kill rolls cover the whole living party.
    expect(log.killRolls.every((r) => r.playerIds.length >= 1)).toBe(true);
    expect(log.killRolls.some((r) => r.playerIds.length === 4)).toBe(true);
    // Shared XP: one outcome stream for the instance.
    const xp = outcomesOf(outcomes, 'xp').reduce((a, o) => a + o.amount, 0);
    expect(xp).toBeGreaterThan(1500);
    expect(run.view.players).toHaveLength(0);
  }, 180_000);
});

describe('skills in a party', () => {
  it('casts, novas and chains are tagged with the caster', () => {
    const lance = makeSkill('emberLance', 1, { level: 10 });
    const a = makeArena({ skills: [lance] });
    joinArena(a, 2, 0, 50);
    placeMonster(a.world, 'trainingDummy', 80, 0, { life: 1e9 });
    const intent = idleIntent(80, 0);
    intent.held[0] = true;
    a.run.setIntent(1, intent);
    a.run.setIntent(2, intent);
    const casts: number[] = [];
    const hits = new Set<number>();
    for (let t = 0; t < 90; t++) {
      a.run.step();
      for (const e of a.run.drainEvents()) {
        if (e.t === 'cast') casts.push(e.playerId);
        if (e.t === 'hit' && e.target === 'monster') hits.add(e.playerId);
      }
    }
    expect(casts.filter((id) => id === 1).length).toBeGreaterThan(1);
    expect(casts.filter((id) => id === 2).length).toBeGreaterThan(1);
    expect(hits).toEqual(new Set([1, 2]));
  });
});
