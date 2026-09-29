// Instance-level behaviour a server running many rooms relies on: small hideouts, cheap empty
// instances, exact high-water marks, resumable vitals, and streams that stay off everyone's screen.
import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/contracts/sim';
import { createRun, type SimPlayerJoin } from '../../src/sim';
import {
  HIDEOUT_MONSTER_CAPACITY, HIDEOUT_MOTE_CAPACITY, HIDEOUT_PROJECTILE_CAPACITY, MONSTER_CAPACITY, VIEW_HALF_H, VIEW_HALF_W,
} from '../../src/sim/constants';
import { createRunInternal } from '../../src/sim/run';
import { MonsterStore } from '../../src/sim/stores';
import { makeConfig, makeJoin, makeParty, makeStats, makeSolo, strongSkills, STRONG_LOADOUT } from './fixtures';
import { hold, ofType, pv, stepN } from './helpers';

const sturdy = () => makeStats({ maxLife: 1e9, evasion: 0 });

describe('store sizes and high-water marks', () => {
  it('hideouts get small stores, maps big ones; spell practice in a full hideout still fits', () => {
    const hideout = createRun(makeConfig({ mode: 'hideout' }));
    expect(hideout.view.monsters.capacity).toBe(HIDEOUT_MONSTER_CAPACITY);
    expect(hideout.view.projectiles.capacity).toBe(HIDEOUT_PROJECTILE_CAPACITY);
    expect(hideout.view.motes.capacity).toBe(HIDEOUT_MOTE_CAPACITY);
    expect(createRun(makeConfig({ mode: 'map' })).view.monsters.capacity).toBe(MONSTER_CAPACITY);
    // Four visitors spamming every projectile skill at the dummy never run out of room.
    const { run, world } = makeSolo({ mode: 'hideout', stats: makeStats({ maxFocus: 1e6, focusRegen: 1e6 }), skills: strongSkills(), loadout: STRONG_LOADOUT });
    for (let id = 2; id <= 4; id++) run.addPlayer(makeJoin(id, { stats: makeStats({ maxFocus: 1e6, focusRegen: 1e6 }), skills: strongSkills(), loadout: STRONG_LOADOUT }));
    let peak = 0;
    for (let t = 0; t < Math.round(10 / SIM_DT); t++) {
      for (const p of run.view.players) {
        const it = hold(0, 0, 150);
        it.held[1] = it.held[3] = true; // nova + rime shards
        run.setIntent(p.id, it);
      }
      run.step();
      run.drainEvents();
      peak = Math.max(peak, world.projectiles.count);
    }
    expect(peak).toBeGreaterThan(40);
    expect(peak).toBeLessThan(HIDEOUT_PROJECTILE_CAPACITY * 0.75);
  });

  it('hwm: every slot at or past it is dead, and the one below it is alive', () => {
    const m = new MonsterStore(256);
    let seed = 12345;
    const rand = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
    const live: number[] = [];
    for (let step = 0; step < 5000; step++) {
      if (live.length > 0 && (rand() < 0.48 || live.length === 256)) {
        const k = Math.floor(rand() * live.length);
        m.release(live[k]);
        live.splice(k, 1);
      } else {
        const i = m.alloc();
        if (i >= 0) live.push(i);
      }
      const hwm = m.hwm;
      for (let i = hwm; i < m.capacity; i++) expect(m.alive[i]).toBe(0);
      if (hwm > 0) expect(m.alive[hwm - 1]).toBe(1);
      expect(m.count).toBe(live.length);
    }
  });
});

describe('empty instances', () => {
  it('hold perfectly still while nobody is inside, then pick up where they left off', () => {
    const { run, world } = makeParty({ seed: 4 }, [{ stats: sturdy() }]);
    stepN(run, Math.round(10 / SIM_DT));
    expect(world.monsters.count).toBeGreaterThan(10);
    run.removePlayer(1);
    const m = world.monsters;
    const xs = Array.from(m.x.subarray(0, m.hwm));
    const waveTime = run.view.run.waveTime;
    const tick = run.view.tick;
    const evs = stepN(run, 600);
    expect(run.view.tick).toBe(tick + 600);
    expect(evs.events).toEqual([]);
    expect(evs.outcomes).toEqual([]);
    expect(Array.from(m.x.subarray(0, m.hwm))).toEqual(xs);
    expect(run.view.run.waveTime).toBe(waveTime);
    // Someone comes back through a portal: the wave resumes.
    run.addPlayer(makeJoin(2, { stats: sturdy() }));
    stepN(run, 60, undefined, 2);
    expect(run.view.run.waveTime).toBeGreaterThan(waveTime);
    expect(Array.from(m.x.subarray(0, m.hwm))).not.toEqual(xs);
  });
});

describe('resumed vitals', () => {
  it('a player re-added with life/focus keeps them (clamped); without them they arrive full', () => {
    const run = createRun(makeConfig({ mode: 'hideout' }));
    const stats = makeStats({ maxLife: 200, maxFocus: 100, focusRegen: 0 });
    const hurt: SimPlayerJoin = { ...makeJoin(1, { stats }), life: 37, focus: 12 };
    run.addPlayer(hurt);
    expect(pv(run, 1).life).toBe(37);
    expect(pv(run, 1).focus).toBe(12);
    run.addPlayer({ ...makeJoin(2, { stats }), life: 0, focus: -5 } as SimPlayerJoin);
    expect(pv(run, 2).life).toBe(1);
    expect(pv(run, 2).focus).toBe(0);
    expect(pv(run, 2).dead).toBe(false);
    run.addPlayer({ ...makeJoin(3, { stats }), life: 1e9, focus: Number.NaN } as SimPlayerJoin);
    expect(pv(run, 3).life).toBe(200);
    expect(pv(run, 3).focus).toBe(100);
    run.addPlayer(makeJoin(4, { stats }));
    expect(pv(run, 4).life).toBe(200);
  });
});

describe('stream placement in a party', () => {
  it('stream groups arrive off-screen for their player and out of the other players\' views', () => {
    const { run, world } = createRunInternal(makeConfig({ seed: 8, waves: { baseMonsters: 120 } }));
    run.addPlayer(makeJoin(1, { stats: sturdy(), x: -300, y: 0 }));
    run.addPlayer(makeJoin(2, { stats: sturdy(), x: 300, y: 60 }));
    let started = false;
    let streamed = 0;
    let visible = 0;
    for (let t = 0; t < Math.round(55 / SIM_DT); t++) {
      run.step();
      const spawns = ofType(run.drainEvents(), 'monsterSpawn');
      if (run.drainOutcomes().some((o) => o.t === 'waveStart')) {
        started = true;
        continue; // the wave's packs
      }
      if (!started) continue;
      for (const e of spawns) {
        streamed++;
        const seen = world.living.some((p) => Math.abs(e.x - p.x) < VIEW_HALF_W && Math.abs(e.y - p.y) < VIEW_HALF_H);
        const atEdge = Math.hypot(e.x, e.y) >= world.arenaRadius - 31;
        if (seen && !atEdge) visible++;
      }
    }
    expect(streamed).toBeGreaterThan(40);
    // Only the rare fallback (no clear bearing in 12 tries) may appear in someone's view.
    expect(visible / streamed).toBeLessThan(0.1);
  });
});
