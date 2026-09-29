import { describe, expect, it } from 'vitest';
import { ELITE_BIT, RARITY_CODE, SIM_DT, type SimEvent, type SimOutcome } from '../../src/contracts/sim';
import { damageMonster, killMonster } from '../../src/sim/combat';
import { PACK_MIN_DISTANCE, STREAM_ARC, VIEW_HALF_H, VIEW_HALF_W } from '../../src/sim/constants';
import { createBot } from './bot';
import {
  STRONG_LOADOUT, TIER5, fairSkills, fairStats, idleIntent, makeHooks, makeSolo, makeStats, strongSkills, strongStats,
} from './fixtures';
import { ofType, pv, stepN, stepWith, walkIntent } from './helpers';

const sturdy = () => makeStats({ maxLife: 1e9, evasion: 0 });

describe('full map with the bot', () => {
  it('clears 6 waves: herald on 3, matriarch on 6, chest, loot, return portal', () => {
    const { hooks, log } = makeHooks({ dropChance: 0.1 });
    const { run } = makeSolo({ seed: 11, stats: strongStats(), skills: strongSkills(), loadout: STRONG_LOADOUT, scaling: TIER5, hooks });
    const bot = createBot();
    const events: SimEvent[] = [];
    const outcomes: SimOutcome[] = [];
    let lieutenantWave = 0;
    let bossWave = 0;
    let minLife = Infinity;
    const maxTicks = Math.round((12 * 60) / SIM_DT);
    for (let t = 0; t < maxTicks; t++) {
      stepWith(run, bot.intent(run.view, 1));
      for (const e of run.drainEvents()) if (e.t !== 'hit' && e.t !== 'projectileEnd' && e.t !== 'mote') events.push(e);
      const out = run.drainOutcomes();
      outcomes.push(...out);
      const v = run.view;
      minLife = Math.min(minLife, v.players[0].life);
      if (!lieutenantWave && v.run.lieutenant) lieutenantWave = v.run.wave;
      if (!bossWave && v.run.boss) bossWave = v.run.wave;
      if (out.some((o) => o.t === 'returnPortal' || o.t === 'playerDied')) break;
    }
    const kinds = outcomes.map((o) => o.t);
    expect(kinds).not.toContain('playerDied');
    expect(outcomes.filter((o) => o.t === 'waveStart').map((o) => (o.t === 'waveStart' ? o.wave : 0))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(lieutenantWave).toBe(3);
    expect(bossWave).toBe(6);

    const tells = ofType(events, 'waveTell');
    expect(tells.map((e) => e.wave)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(tells[2].lieutenant).toBe(true);
    expect(tells[5].boss).toBe(true);
    expect(tells[0].families).toContain('ashling');
    expect(ofType(events, 'bossSpawn')).toHaveLength(1);
    expect(ofType(events, 'bossPhase').map((e) => e.phase)).toEqual([2, 3]);

    const kills = outcomes.filter((o): o is Extract<SimOutcome, { t: 'kill' }> => o.t === 'kill');
    expect(kills.filter((k) => k.isLieutenant)).toHaveLength(1);
    expect(kills.filter((k) => k.isBoss)).toHaveLength(1);
    expect(kills.length).toBeGreaterThan(300);
    // Ordering of the finale.
    const idx = (t: SimOutcome['t']) => kinds.indexOf(t);
    expect(idx('bossDefeated')).toBeGreaterThan(-1);
    expect(idx('cleared')).toBeGreaterThan(idx('bossDefeated'));
    expect(idx('chestOpened')).toBeGreaterThan(idx('cleared'));
    expect(idx('returnPortal')).toBeGreaterThan(idx('chestOpened'));
    expect(kinds.filter((k) => k === 'cleared')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'returnPortal')).toHaveLength(1);
    expect(log.chestRolls).toEqual([[1]]);

    // Loot: everything picked went through tryPickup and produced a matching outcome.
    const pickups = outcomes.filter((o) => o.t === 'pickup').map((o) => (o.t === 'pickup' ? o.token : -1));
    expect(pickups.length).toBeGreaterThan(5);
    expect(pickups).toEqual(log.pickups);
    const xp = outcomes.reduce((a, o) => a + (o.t === 'xp' ? o.amount : 0), 0);
    expect(xp).toBeGreaterThan(1000);
    expect(run.view.run.phase).toBe('cleared');
    expect(run.view.run.portalOpen).toBe(true);
    expect(minLife).toBeGreaterThan(0);
  }, 120_000);

  it('a fairly geared character clears tier 5 but feels real pressure (no stroll)', () => {
    const { hooks } = makeHooks({ dropChance: 0.1 });
    const stats = fairStats();
    const { run } = makeSolo({ seed: 11, stats, skills: fairSkills(), loadout: STRONG_LOADOUT, scaling: TIER5, hooks });
    const bot = createBot();
    let minLife = Infinity;
    let flasks = 0;
    let end: SimOutcome['t'] | null = null;
    for (let t = 0; t < Math.round((12 * 60) / SIM_DT) && !end; t++) {
      stepWith(run, bot.intent(run.view, 1));
      run.drainEvents();
      for (const o of run.drainOutcomes()) {
        if (o.t === 'flaskUsed') flasks++;
        if (o.t === 'returnPortal' || o.t === 'playerDied') end = o.t;
      }
      minLife = Math.min(minLife, pv(run).life);
    }
    expect(end).toBe('returnPortal');
    // The horde got to her: she dipped well below full and needed her flasks.
    expect(minLife).toBeLessThan(0.85 * stats.maxLife);
    expect(minLife).toBeGreaterThan(0);
    expect(flasks).toBeGreaterThan(0);
  }, 120_000);
});

describe('player death', () => {
  it('a lone weak idle character dies once; the map reads failed and freezes', () => {
    const { run } = makeSolo({ seed: 5, stats: makeStats({ maxLife: 40, evasion: 0 }) });
    let diedAt = -1;
    const all: SimOutcome[] = [];
    for (let t = 0; t < Math.round(180 / SIM_DT) && diedAt < 0; t++) {
      stepWith(run, idleIntent());
      run.drainEvents();
      const out = run.drainOutcomes();
      all.push(...out);
      if (out.some((o) => o.t === 'playerDied')) diedAt = t;
    }
    expect(diedAt).toBeGreaterThan(0);
    expect(all.filter((o) => o.t === 'playerDied')).toEqual([{ t: 'playerDied', playerId: 1 }]);
    const v = run.view;
    const p = pv(run);
    expect(p.dead).toBe(true);
    expect(p.anim).toBe('death');
    expect(p.life).toBe(0);
    expect(v.run.phase).toBe('failed');
    expect(v.run.playersAlive).toBe(0);
    const wave = v.run.wave;
    const waveTime = v.run.waveTime;
    const x = p.x;
    const after = stepN(run, Math.round(90 / SIM_DT), { ...idleIntent(), moveX: 1, held: [true, true, true, true, true, true] });
    expect(after.outcomes.filter((o) => o.t === 'playerDied' || o.t === 'waveStart')).toHaveLength(0);
    expect(ofType(after.events, 'cast')).toHaveLength(0);
    // Nobody alive: the director holds (no wave timer, no new spawns) and the corpse stays put.
    expect(ofType(after.events, 'monsterSpawn')).toHaveLength(0);
    expect(run.view.run.wave).toBe(wave);
    expect(run.view.run.waveTime).toBe(waveTime);
    expect(run.view.run.phase).toBe('failed');
    expect(pv(run).x).toBe(x);
    expect(pv(run).anim).toBe('death');
  }, 30_000);
});

describe('wave director', () => {
  it('tells 3 s ahead, places packs away from the player and streams the rest', () => {
    const { run, world } = makeSolo({ seed: 21, stats: sturdy() });
    let tellTick = -1;
    let startTick = -1;
    for (let t = 1; startTick < 0 && t < 1000; t++) {
      stepWith(run, idleIntent());
      for (const e of run.drainEvents()) if (e.t === 'waveTell' && e.wave === 1) tellTick = t;
      if (run.drainOutcomes().some((o) => o.t === 'waveStart')) startTick = t;
    }
    expect(run.view.run.phase).toBe('fight');
    expect((startTick - tellTick) * SIM_DT).toBeCloseTo(3, 1);
    // 60% of 40 as packs, all well away from the player.
    const m = world.monsters;
    expect(m.count).toBe(24);
    for (let i = 0; i < m.capacity; i++) {
      if (!m.alive[i]) continue;
      expect(Math.hypot(m.x[i] - world.players[0].x, m.y[i] - world.players[0].y)).toBeGreaterThan(PACK_MIN_DISTANCE - 40);
    }
    // The other 40% arrive over the wave from just off-screen.
    let spawned = 0;
    for (let t = 0; t < Math.round(50 / SIM_DT); t++) {
      stepWith(run, idleIntent());
      spawned += ofType(run.drainEvents(), 'monsterSpawn').length;
      run.drainOutcomes();
    }
    expect(spawned).toBe(16);
  });

  it('streams arrive as groups of 4–8 on an arc around one bearing, just off-screen', () => {
    const { run, world } = makeSolo({ seed: 31, stats: sturdy(), waves: { baseMonsters: 90 } });
    const groups: { x: number; y: number }[][] = [];
    let started = false;
    for (let t = 0; t < Math.round(50 / SIM_DT); t++) {
      stepWith(run, idleIntent());
      const spawns = ofType(run.drainEvents(), 'monsterSpawn');
      if (run.drainOutcomes().some((o) => o.t === 'waveStart')) {
        started = true;
        continue; // the wave's packs
      }
      if (started && spawns.length > 0) groups.push(spawns.map((e) => ({ x: e.x - world.players[0].x, y: e.y - world.players[0].y })));
    }
    // 40% of 90 = 36 streamed monsters, ~6 per group.
    expect(groups.reduce((a, g) => a + g.length, 0)).toBe(36);
    expect(groups.length).toBeGreaterThanOrEqual(5);
    for (const g of groups) {
      expect(g.length).toBeGreaterThanOrEqual(4);
      expect(g.length).toBeLessThanOrEqual(8);
      const mean = Math.atan2(g.reduce((a, p) => a + Math.sin(Math.atan2(p.y, p.x)), 0), g.reduce((a, p) => a + Math.cos(Math.atan2(p.y, p.x)), 0));
      let spread = 0;
      for (const p of g) {
        const da = Math.abs(Math.atan2(Math.sin(Math.atan2(p.y, p.x) - mean), Math.cos(Math.atan2(p.y, p.x) - mean)));
        spread = Math.max(spread, da);
        expect(da).toBeLessThanOrEqual(STREAM_ARC + 0.1);
        // Just off-screen: outside the camera's view box (or pulled in to the arena's edge).
        const offscreen = Math.abs(p.x) >= VIEW_HALF_W || Math.abs(p.y) >= VIEW_HALF_H;
        const atEdge = Math.hypot(p.x + world.players[0].x, p.y + world.players[0].y) >= world.arenaRadius - 31;
        expect(offscreen || atEdge).toBe(true);
        expect(Math.max(Math.abs(p.x) - VIEW_HALF_W, Math.abs(p.y) - VIEW_HALF_H)).toBeLessThan(80);
      }
      // A line sweeping in, not a clump.
      expect(spread).toBeGreaterThan(STREAM_ARC * 0.6);
    }
  });

  it('the pressure floor pulls the stream forward when the player out-kills it', () => {
    /** Seconds after the wave start at which each stream group arrived. */
    const arrivals = (killEverything: boolean) => {
      const { run, world } = makeSolo({ seed: 12, stats: sturdy() });
      const times: number[] = [];
      let start = -1;
      for (let t = 0; t < Math.round(60 / SIM_DT); t++) {
        stepWith(run, idleIntent());
        const spawns = ofType(run.drainEvents(), 'monsterSpawn');
        if (run.drainOutcomes().some((o) => o.t === 'waveStart' && o.wave === 1)) start = t;
        else if (start >= 0 && run.view.run.wave === 1 && spawns.length > 0) times.push((t - start) * SIM_DT);
        if (killEverything && start >= 0) {
          // A player who deletes every hunter the moment it arrives (packs stay asleep far away).
          const m = world.monsters;
          for (let i = 0; i < m.capacity; i++) if (m.alive[i] && m.pack[i] >= 0 && world.packs[m.pack[i]].stream) killMonster(world, i, 1, true);
        }
      }
      return times;
    };
    const cadence = arrivals(false);
    const pulled = arrivals(true);
    expect(cadence).toHaveLength(3); // 16 streamed monsters in wave 1
    expect(pulled).toHaveLength(3);
    // Out-killed: the whole stream arrives within seconds, one group per STREAM_MIN_GAP.
    expect(pulled[2]).toBeLessThan(8);
    // Not out-killed (the idle player lets the first groups crowd her): the last group keeps the cadence.
    expect(cadence[2]).toBeGreaterThan(15);
  });

  it('the next wave arrives on the timer even when monsters remain (waves stack)', () => {
    const { run } = makeSolo({ seed: 3, stats: sturdy(), waves: { waveDuration: 20 } });
    const starts: number[] = [];
    for (let t = 0; t < Math.round(70 / SIM_DT); t++) {
      stepWith(run, idleIntent());
      run.drainEvents();
      for (const o of run.drainOutcomes()) if (o.t === 'waveStart') starts.push(t);
    }
    expect(starts.length).toBeGreaterThanOrEqual(3);
    expect((starts[1] - starts[0]) * SIM_DT).toBeCloseTo(20, 0);
    expect(run.view.run.monstersAlive).toBeGreaterThan(60);
  });

  it('rolls magic and rare packs with the configured chances', () => {
    const { run, world } = makeSolo({ seed: 8, stats: sturdy(), scaling: { rarePackChance: 1 } });
    stepN(run, Math.round(4.5 / SIM_DT));
    const m = world.monsters;
    let rares = 0;
    for (let i = 0; i < m.capacity; i++) if (m.alive[i] && m.rarity[i] === RARITY_CODE.rare) rares++;
    expect(rares).toBeGreaterThanOrEqual(3);
    const magic = makeSolo({ seed: 8, stats: sturdy(), scaling: { magicPackChance: 1, rarePackChance: 0 } });
    stepN(magic.run, Math.round(4.5 / SIM_DT));
    const mm = magic.world.monsters;
    for (let i = 0; i < mm.capacity; i++) {
      if (!mm.alive[i]) continue;
      expect(mm.rarity[i]).toBe(RARITY_CODE.magic);
      // The shared magic mod is visible in the view (ELITE_BIT).
      expect([ELITE_BIT.swift, ELITE_BIT.stout, ELITE_BIT.fierce]).toContain(mm.mods[i]);
    }
  });

  it('volcanic maps telegraph eruptions that leave fire pools', () => {
    const { run } = makeSolo({ seed: 4, stats: sturdy(), scaling: { hazards: true } });
    const r = stepN(run, Math.round(20 / SIM_DT));
    const resolved = ofType(r.events, 'areaResolve').filter((e) => e.kind === 'eruptionWarning');
    expect(resolved.length).toBeGreaterThan(1);
    // Each resolved eruption leaves burning ground behind.
    let pools = 0;
    for (let t = 0; t < 400; t++) {
      stepWith(run, idleIntent());
      if (run.view.areas.some((a) => a.kind === 'firePool')) pools++;
    }
    expect(pools).toBeGreaterThan(0);
  });

  it('the boss death clears the map: survivors crumble, motes vacuum, chest and return portal appear', () => {
    const { hooks, log } = makeHooks();
    const { run, world } = makeSolo({
      seed: 17, stats: sturdy(), hooks, waves: { count: 2, bossWave: 2, lieutenantWave: 0, waveDuration: 8, tellDuration: 1 },
    });
    let bossSlot = -1;
    for (let t = 0; t < Math.round(30 / SIM_DT) && bossSlot < 0; t++) {
      stepWith(run, idleIntent());
      run.drainEvents();
      run.drainOutcomes();
      const m = world.monsters;
      for (let i = 0; i < m.capacity; i++) if (m.alive[i] && m.rarity[i] === RARITY_CODE.boss && m.spawnTime[i] <= 0) bossSlot = i;
    }
    expect(bossSlot).toBeGreaterThanOrEqual(0);
    expect(run.view.run.phase).toBe('boss');
    expect(run.view.run.boss?.name).toBe('Cinder Matriarch');
    const survivors = world.monsters.count - 1;
    expect(survivors).toBeGreaterThan(0);
    // Leave some motes lying far away first.
    world.monsters.life[bossSlot] = 1;
    damageMonster(world, bossSlot, 1e6, 1, 0, 1.5, 0, 1, 0, 1);
    const r = stepN(run, 1);
    expect(r.outcomes.map((o) => o.t)).toContain('cleared');
    expect(run.view.run.phase).toBe('cleared');
    expect(world.monsters.count).toBe(0);
    expect(ofType(r.events, 'death').length).toBeGreaterThanOrEqual(survivors);
    expect(ofType(r.events, 'cleared')).toHaveLength(1);
    // Every mote is on its way to the player.
    for (let i = 0; i < world.motes.capacity; i++) if (world.motes.alive[i]) expect(world.motes.magnet[i]).toBe(1);
    const chest = run.view.props.find((p) => p.kind === 'chest')!;
    const portal = run.view.props.find((p) => p.kind === 'returnPortal')!;
    expect(chest.state).toBe(0);
    expect(portal.state).toBe(1);
    expect(run.view.run.portalOpen).toBe(true);
    // Walk into the chest.
    const toChest = stepN(run, 240, () => walkIntent(pv(run).x, pv(run).y, chest.x, chest.y));
    expect(toChest.outcomes.filter((o) => o.t === 'chestOpened')).toEqual([{ t: 'chestOpened', playerId: 1 }]);
    expect(log.chestRolls).toEqual([[1]]);
    expect(ofType(toChest.events, 'dropSpawn').length).toBe(6);
    expect(chest.state).toBe(1);
    // Then the return portal.
    const toPortal = stepN(run, 300, () => walkIntent(pv(run).x, pv(run).y, portal.x, portal.y));
    expect(toPortal.outcomes.filter((o) => o.t === 'returnPortal')).toEqual([{ t: 'returnPortal', playerId: 1 }]);
    expect(ofType(toPortal.events, 'portal').some((e) => e.kind === 'enter')).toBe(true);
  });
});
