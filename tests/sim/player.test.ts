import { describe, expect, it } from 'vitest';
import { SIM_DT, type PlayerIntent } from '../../src/contracts/sim';
import { CAST_MOVE_FACTOR, CROWD_SLOW_PER_MONSTER, PLAYER_RADIUS } from '../../src/sim/constants';
import { EventBuffer } from '../../src/sim/events';
import { MonsterStore } from '../../src/sim/stores';
import { CAST_SLOW, createRun, movePlayer, predictionSlow, type SimPlayerUpdate } from '../../src/sim';
import { STRONG_LOADOUT, idleIntent, makeConfig, makeFlasks, makeJoin, makeSkill, makeSolo, makeStats, strongSkills } from './fixtures';
import { hold, makeArena, ofType, placeMonster, pv, stepN, stepWith } from './helpers';

describe('flasks', () => {
  it('recover over their duration, one use at a time, and report the charge used', () => {
    const { run, player } = makeArena({ stats: makeStats({ maxLife: 400 }) });
    player.life = 100;
    const use = { ...idleIntent(), flask: 0 };
    const r = stepN(run, 1, use);
    expect(r.outcomes).toEqual([{ t: 'flaskUsed', playerId: 1, slot: 0 }]);
    expect(ofType(r.events, 'flask')).toEqual([{ t: 'flask', playerId: 1, resource: 'life' }]);
    expect(pv(run).flasks[0]!.count).toBe(2);
    expect(pv(run).flasks[0]!.active).toBeGreaterThan(2.9);
    // Pressing again while active does nothing.
    expect(stepN(run, 1, use).outcomes).toHaveLength(0);
    const mid = pv(run).life;
    expect(mid).toBeGreaterThan(100);
    expect(mid).toBeLessThan(140);
    stepN(run, Math.round(3.2 / SIM_DT));
    expect(pv(run).life).toBeCloseTo(220, 3);
    expect(pv(run).flasks[0]!.active).toBe(0);
  });

  it('a flask press is an edge: an intent left in place does not keep drinking', () => {
    const { run, player } = makeArena({ stats: makeStats({ maxLife: 400 }) });
    player.life = 50;
    run.setIntent(1, { ...idleIntent(), flask: 0 });
    const used: number[] = [];
    for (let t = 0; t < Math.round(8 / SIM_DT); t++) {
      run.step(); // the server has no newer input for this player: the old intent stays applied
      for (const o of run.drainOutcomes()) if (o.t === 'flaskUsed') used.push(o.slot);
    }
    expect(used).toEqual([0]);
  });

  it('an empty flask cannot be used; the app can refill it through updatePlayer', () => {
    const { run } = makeArena();
    const flasks = makeFlasks();
    flasks[2] = { ...flasks[2]!, count: 0 };
    run.updatePlayer(1, { flasks });
    expect(stepN(run, 1, { ...idleIntent(), flask: 2 }).outcomes).toHaveLength(0);
    flasks[2] = { ...flasks[2]!, count: 4 };
    run.updatePlayer(1, { flasks });
    expect(stepN(run, 1, { ...idleIntent(), flask: 2 }).outcomes).toEqual([{ t: 'flaskUsed', playerId: 1, slot: 2 }]);
    expect(pv(run).flasks[2]!.count).toBe(3);
  });
});

describe('live player updates', () => {
  it('level-up restore, new stats, extra charges and loadout changes', () => {
    const rift = makeSkill('riftStep', 1);
    const { run, player } = makeArena({ skills: [makeSkill('emberLance', 1), rift], loadout: ['emberLance', null, null, null, null, 'riftStep'] });
    player.life = 10;
    player.focus = 5;
    expect(pv(run).level).toBe(1);
    run.updatePlayer(1, { stats: makeStats({ maxLife: 120, maxFocus: 90 }), restore: true });
    expect(pv(run).life).toBe(120);
    expect(pv(run).maxFocus).toBe(90);
    expect(pv(run).focus).toBe(90);
    // PlayerUpdate has no level: restore alone never guesses one; the explicit SimPlayerUpdate.level
    // (a level-up may gain several at once) is the only thing that moves it.
    expect(pv(run).level).toBe(1);
    const levelUp: SimPlayerUpdate = { restore: true, level: 5 };
    run.updatePlayer(1, levelUp);
    expect(pv(run).level).toBe(5);
    run.updatePlayer(1, { restore: true });
    expect(pv(run).level).toBe(5);
    run.updatePlayer(1, { level: Number.NaN } as SimPlayerUpdate);
    expect(pv(run).level).toBe(5);
    // Spend both charges, then rank up to 3 charges: the new one is available immediately.
    stepN(run, 1, hold(5, 200, 0));
    stepN(run, 1);
    stepN(run, 1, hold(5, 200, 0));
    expect(pv(run).slots[5].charges).toBe(0);
    run.updatePlayer(1, { skills: [makeSkill('emberLance', 1), makeSkill('riftStep', 10)] });
    expect(pv(run).slots[5].maxCharges).toBe(3);
    expect(pv(run).slots[5].charges).toBe(1);
    // Removing the skill being cast cancels the cast.
    stepN(run, 5, hold(0, 100, 0));
    expect(pv(run).castSkill).toBe('emberLance');
    run.updatePlayer(1, { loadout: [null, null, null, null, null, 'riftStep'] });
    expect(pv(run).castSkill).toBeNull();
    expect(pv(run).slots[0].skillId).toBeNull();
    // Updates for players who are not here are ignored.
    expect(() => run.updatePlayer(42, { restore: true })).not.toThrow();
  });

  it('a map starts (and every later arrival begins) with a short grace period', () => {
    const run = createRun(makeConfig());
    run.addPlayer(makeJoin(1));
    expect(pv(run, 1).invulnTime).toBeGreaterThan(0.5);
    stepN(run, 600);
    run.addPlayer(makeJoin(2));
    expect(pv(run, 2).invulnTime).toBeGreaterThan(0.5);
  });
});

describe('movement feel', () => {
  const nova = makeSkill('emberNova', 1, { level: 10 });
  const kit = { skills: [makeSkill('emberLance', 1, { level: 10 }), nova], loadout: ['emberLance', 'emberNova', null, null, null, null] as const };

  it('the held basic attack never slows her; a timed active does while it casts', () => {
    const { run } = makeArena({ ...kit, loadout: [...kit.loadout] });
    const attacking = { ...hold(0, 300, 0), moveX: 1 };
    const speeds: number[] = [];
    stepN(run, 60, () => {
      speeds.push(pv(run).vx);
      return attacking;
    });
    expect(pv(run).castSkill).toBe('emberLance');
    expect(Math.min(...speeds.slice(1))).toBeCloseTo(110, 6);
    expect(pv(run).x).toBeCloseTo(110, 3);
    const casting = { ...hold(1, 300, 0), moveX: 1 };
    stepWith(run, casting);
    stepWith(run, casting);
    expect(pv(run).castSkill).toBe('emberNova');
    expect(pv(run).vx).toBeCloseTo(110 * CAST_MOVE_FACTOR, 6);
  });

  it('a horde pressed in front slows her; monsters at her back or sides never do', () => {
    const vxWith = (angles: number[]) => {
      const { run, world } = makeArena({ stats: makeStats({ maxLife: 1e9, evasion: 0 }) });
      const r = 6 + PLAYER_RADIUS; // ashlings touching the player
      for (const a of angles) placeMonster(world, 'ashling', Math.cos(a) * r, Math.sin(a) * r);
      stepWith(run, { ...idleIntent(), moveX: 1 });
      return pv(run).vx;
    };
    expect(vxWith([])).toBeCloseTo(110, 6);
    expect(vxWith([0, 0.5, -0.5])).toBeCloseTo(110 * (1 - 3 * CROWD_SLOW_PER_MONSTER), 6);
    expect(vxWith([Math.PI, Math.PI - 0.5, Math.PI + 0.5])).toBeCloseTo(110, 6);
    expect(vxWith([Math.PI / 2, -Math.PI / 2])).toBeCloseTo(110, 6);
    // Floor: however deep the wall, she still crawls forward.
    const wall = [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9];
    expect(vxWith(wall)).toBeCloseTo(110 * 0.4, 6);
  });
});

describe('fire trail (Cinderwalkers)', () => {
  it('keeps its damage when Ember Lance moves or is removed from the bar', () => {
    const damage = (loadout: NonNullable<Parameters<typeof makeArena>[0]>['loadout']) => {
      const { run, world } = makeArena({ stats: makeStats({ flags: ['fireTrail'] }), loadout });
      stepN(run, 1, { ...idleIntent(), moveX: 1 });
      return world.areas.find((a) => a.kind === 'fireTrail')!.damage;
    };
    const baseline = damage(['emberLance', 'emberNova', null, null, null, null]);
    expect(baseline).toBeGreaterThan(0);
    expect(damage(['emberNova', null, null, null, null, 'emberLance'])).toBe(baseline);
    expect(damage(['emberNova', null, null, null, null, null])).toBe(baseline);
  });

  it('moving leaves burning ground that damages monsters; standing still does not', () => {
    const { run, world } = makeArena({ stats: makeStats({ flags: ['fireTrail'] }) });
    stepN(run, 60);
    expect(run.view.areas.filter((a) => a.kind === 'fireTrail')).toHaveLength(0);
    // Beside the path: inside the trail's reach (14 + 6) but not bumped by the player (7 + 6).
    const i = placeMonster(world, 'ashling', 40, 16, { life: 1e5 });
    stepN(run, 50, { ...idleIntent(), moveX: 1 });
    expect(run.view.areas.filter((a) => a.kind === 'fireTrail').length).toBeGreaterThan(3);
    stepN(run, 60);
    expect(world.monsters.life[i]).toBeLessThan(1e5);
  });
});

describe('infrastructure', () => {
  it('the event budget drops low-priority events first and keeps important ones', () => {
    const buf = new EventBuffer();
    buf.beginTick();
    for (let k = 0; k < 3000; k++) buf.low({ t: 'mote', playerId: 1, x: 0, y: 0 });
    for (let k = 0; k < 100; k++) buf.push({ t: 'death', kind: 'ashling', rarity: 0, x: 0, y: 0, facing: 1, damageType: 'fire' });
    const out = buf.drain();
    expect(out.filter((e) => e.t === 'death')).toHaveLength(100);
    expect(out.filter((e) => e.t === 'mote').length).toBeLessThan(3000);
    expect(out.length).toBeLessThanOrEqual(2048);
    expect(buf.dropped).toBeGreaterThan(0);
  });

  it('generation ids never match a reused slot', () => {
    const s = new MonsterStore(4);
    const a = s.alloc();
    const idA = s.id[a];
    s.release(a);
    const b = s.alloc();
    expect(b).toBe(a);
    expect(s.id[b]).not.toBe(idA);
    expect(s.slotOf(idA)).toBe(-1);
    expect(s.slotOf(s.id[b])).toBe(b);
  });

  it('the view is updated in place (stable references for the presenter)', () => {
    const run = createRun(makeConfig());
    const v = run.view;
    const monsters = v.monsters;
    const players = v.players;
    run.addPlayer(makeJoin(1));
    const player = v.players[0];
    stepN(run, 400, idleIntent());
    expect(run.view).toBe(v);
    expect(run.view.monsters).toBe(monsters);
    expect(run.view.players).toBe(players);
    expect(run.view.players[0]).toBe(player);
    expect(v.tick).toBe(400);
    expect(v.monsters.count).toBeGreaterThan(0);
  });
});

describe('shared movement (client prediction)', () => {
  /** Walk a scripted path through the hideout's furniture; after every tick, predict it with movePlayer. */
  it('movePlayer reproduces the sim step exactly (props, arena edge, cast slow)', () => {
    const { run, world } = makeSolo({ mode: 'hideout', skills: strongSkills(), loadout: STRONG_LOADOUT });
    const player = world.players[0];
    const stash = world.props.find((p) => p.kind === 'stash')!;
    const script = (t: number): PlayerIntent => {
      // Toward the stash (solid), then along the arena wall, with the odd Ember Nova cast (slow).
      const it = idleIntent(player.x + 100, player.y);
      if (t < 240) {
        const dx = stash.x - player.x;
        const dy = stash.y - player.y;
        const l = Math.hypot(dx, dy) || 1;
        it.moveX = dx / l;
        it.moveY = dy / l;
      } else {
        it.moveX = Math.cos(t * 0.02);
        it.moveY = -1;
      }
      it.held[1] = t % 200 > 150;
      return it;
    };
    let checked = 0;
    let slowed = 0;
    let blocked = 0;
    for (let t = 0; t < 900; t++) {
      const intent = script(t);
      const before = { x: player.x, y: player.y };
      run.setIntent(1, intent);
      run.step();
      run.drainEvents();
      // The client predicts from what it knows after the step: the cast state the server reports.
      const slow = predictionSlow(pv(run));
      const predicted = movePlayer(before, intent, { speed: player.stats.moveSpeed, arenaRadius: world.arenaRadius, props: run.view.props, slow }, SIM_DT);
      if (slow > 0) slowed++;
      if (Math.hypot(predicted.x - before.x, predicted.y - before.y) < player.stats.moveSpeed * SIM_DT * 0.5) blocked++;
      expect(predicted.x).toBe(player.x);
      expect(predicted.y).toBe(player.y);
      checked++;
    }
    expect(checked).toBe(900);
    expect(slowed).toBeGreaterThan(30); // Ember Nova casts really slowed her…
    expect(blocked).toBeGreaterThan(30); // …and the furniture / the wall really stopped her
  });

  it('movePlayer clamps input, applies slow as a fraction and never mutates its arguments', () => {
    const state = { x: 10, y: 20 };
    const input = { moveX: 3, moveY: 0 };
    const params = { speed: 120, arenaRadius: 500, props: [], slow: 0 };
    const a = movePlayer(state, input, params, SIM_DT);
    expect(a.x).toBeCloseTo(10 + 120 * SIM_DT, 9);
    expect(a.y).toBe(20);
    expect(state).toEqual({ x: 10, y: 20 });
    const b = movePlayer(state, input, { ...params, slow: CAST_SLOW }, SIM_DT);
    expect(b.x - 10).toBeCloseTo(120 * CAST_MOVE_FACTOR * SIM_DT, 9);
    expect(movePlayer(state, input, { ...params, slow: 1 }, SIM_DT)).toEqual({ x: 10, y: 20 });
    const edge = movePlayer({ x: 490, y: 0 }, { moveX: 1, moveY: 0 }, params, 1);
    expect(Math.hypot(edge.x, edge.y)).toBeCloseTo(500 - PLAYER_RADIUS, 9);
    const nan = movePlayer(state, { moveX: Number.NaN, moveY: Number.POSITIVE_INFINITY }, params, SIM_DT);
    expect(nan).toEqual({ x: 10, y: 20 });
  });

  it('predictionSlow: only a timed active slows, never the basic attack', () => {
    const { run } = makeArena({ skills: [makeSkill('emberLance', 1), makeSkill('emberNova', 1)], loadout: ['emberLance', 'emberNova', null, null, null, null] });
    stepN(run, 3, hold(0, 100, 0));
    expect(pv(run).castSkill).toBe('emberLance');
    expect(predictionSlow(pv(run))).toBe(0);
    stepN(run, 3, hold(1, 100, 0));
    expect(pv(run).castSkill).toBe('emberNova');
    expect(predictionSlow(pv(run))).toBe(CAST_SLOW);
  });

  it('server movement and prediction keep the same cast slowdown after reassigning mouse slots', () => {
    const { run } = makeArena({ skills: [makeSkill('emberLance', 1), makeSkill('emberNova', 1)], loadout: ['emberNova', 'emberLance', null, null, null, null] });
    stepN(run, 3, { ...hold(1, 100, 0), moveX: 1 });
    expect(pv(run).castSkill).toBe('emberLance');
    expect(predictionSlow(pv(run))).toBe(0);
    expect(pv(run).vx).toBeCloseTo(110, 6);
    stepN(run, 3, { ...hold(0, 100, 0), moveX: 1 });
    expect(pv(run).castSkill).toBe('emberNova');
    expect(predictionSlow(pv(run))).toBe(CAST_SLOW);
    expect(pv(run).vx).toBeCloseTo(110 * CAST_MOVE_FACTOR, 6);
  });
});
