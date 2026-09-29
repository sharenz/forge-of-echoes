import { describe, expect, it } from 'vitest';
import { AILMENT_BIT, SIM_DT } from '../../src/contracts/sim';
import { idleIntent, makeSkill, makeStats } from './fixtures';
import { hold, makeArena, ofType, placeMonster, pv, stepN, stepWith } from './helpers';

const lance = (o: Parameters<typeof makeSkill>[2] = {}, rank = 1) => makeSkill('emberLance', rank, { level: 10, ...o });

describe('held-slot casting', () => {
  it('casts on the release frame, repeats while held, and reports progress', () => {
    const { run } = makeArena({ skills: [lance()] });
    // Mid-cast: anim 'cast', progress between 0 and 1, nothing released yet.
    const mid = stepN(run, 12, hold(0, 100, 0));
    expect(ofType(mid.events, 'cast')).toHaveLength(0);
    expect(pv(run).anim).toBe('cast');
    expect(pv(run).castSkill).toBe('emberLance');
    expect(pv(run).castProgress).toBeGreaterThan(0.3);
    expect(pv(run).castProgress).toBeLessThan(0.7);
    // 0.42 s cast → 5 releases within 2.1 s (plus a couple of ticks of discretisation slack).
    const rest = stepN(run, Math.round(2.1 / SIM_DT) - 12 + 3, hold(0, 100, 0));
    const casts = ofType(rest.events, 'cast');
    expect(casts).toHaveLength(5);
    expect(casts[0].dirX).toBeCloseTo(1, 5);
  });

  it('pays focus, respects cooldowns and warns when focus is short', () => {
    const nova = makeSkill('emberNova', 1, { level: 10 });
    const { run } = makeArena({ skills: [lance(), nova], loadout: ['emberLance', 'emberNova', null, null, null, null], stats: makeStats({ maxFocus: 20, focusRegen: 0 }) });
    const r = stepN(run, 40, hold(1, 0, 100));
    expect(ofType(r.events, 'nova')).toHaveLength(1);
    expect(pv(run).focus).toBeCloseTo(8, 5);
    expect(pv(run).slots[1].cooldown).toBeGreaterThan(2);
    expect(pv(run).slots[1].usable).toBe(false);
    // Off cooldown but only 8 focus: releasing and re-pressing warns once per press.
    stepN(run, Math.round(3 / SIM_DT));
    const again = stepN(run, 5, hold(1, 0, 100));
    expect(ofType(again.events, 'notEnoughFocus')).toHaveLength(1);
    expect(ofType(again.events, 'nova')).toHaveLength(0);
  });

  it('lets any skill interrupt the free basic attack', () => {
    const nova = makeSkill('emberNova', 1, { level: 10 });
    const { run } = makeArena({ skills: [lance(), nova], loadout: ['emberLance', 'emberNova', null, null, null, null] });
    stepN(run, 10, hold(0, 100, 0));
    expect(pv(run).castSkill).toBe('emberLance');
    const both = hold(0, 100, 0);
    both.held[1] = true;
    stepWith(run, both);
    expect(pv(run).castSkill).toBe('emberNova');
  });
});

describe('ember lance', () => {
  it('pierces exactly `pierce` extra targets', () => {
    const { run, world } = makeArena({ skills: [{ ...lance(), pierce: 2 }] });
    const ids = [40, 70, 100, 130].map((x) => placeMonster(world, 'ashling', x, 0, { life: 1e6 }));
    stepN(run, 60, (k) => hold(0, k < 26 ? 200 : 200, 0));
    const hitCount = ids.filter((i) => world.monsters.life[i] < 1e6).length;
    expect(hitCount).toBe(3);
    expect(world.monsters.life[ids[3]]).toBe(1e6);
  });

  it('pierces everything with pierceAll (skill flag or The Patient Spark)', () => {
    for (const setup of ['skill', 'player'] as const) {
      const def = { ...lance(), pierce: 0, flags: setup === 'skill' ? ['pierceAll'] : [] };
      const stats = makeStats({ flags: setup === 'player' ? ['lancePierceAll'] : [] });
      const { run, world } = makeArena({ skills: [def], stats });
      const ids = [40, 70, 100, 130, 160].map((x) => placeMonster(world, 'ashling', x, 0, { life: 1e6 }));
      stepN(run, 70, hold(0, 300, 0));
      expect(ids.every((i) => world.monsters.life[i] < 1e6)).toBe(true);
    }
  });

  it('never tunnels through a target, even at extreme speed', () => {
    const { run, world } = makeArena({ skills: [{ ...lance(), projectileSpeed: 4000, range: 600 }] });
    const i = placeMonster(world, 'emberSkitter', 211, 0, { life: 1e6 });
    stepN(run, 40, hold(0, 400, 0));
    expect(world.monsters.life[i]).toBeLessThan(1e6);
  });

  it('crits multiply and every hit stays inside the ±20% roll', () => {
    const def = { ...lance(), critChance: 1, critMultiplier: 2, ailmentChance: 0 };
    const { run, world } = makeArena({ skills: [def] });
    placeMonster(world, 'trainingDummy', 60, 0, { life: 1e9 });
    const r = stepN(run, 300, hold(0, 100, 0));
    const hits = ofType(r.events, 'hit').filter((h) => h.target === 'monster');
    expect(hits.length).toBeGreaterThan(5);
    for (const h of hits) {
      expect(h.crit).toBe(true);
      expect(h.amount).toBeGreaterThanOrEqual(def.damage * 2 * 0.8 - 1e-6);
      expect(h.amount).toBeLessThanOrEqual(def.damage * 2 * 1.2 + 1e-6);
    }
  });
});

describe('arc chain', () => {
  it('strikes the enemy nearest the cursor and chains to unhit targets within jump range', () => {
    const arc = makeSkill('arcChain', 1, { level: 10 }); // chains 3 → 4 targets
    const { run, world } = makeArena({ skills: [lance(), arc], loadout: ['emberLance', 'arcChain', null, null, null, null] });
    const xs = [60, 120, 180, 240];
    const ids = xs.map((x) => placeMonster(world, 'ashling', x, 0, { life: 1e6 }));
    const far = placeMonster(world, 'ashling', 400, 0, { life: 1e6 }); // outside jump range of the last
    const decoy = placeMonster(world, 'ashling', -30, 0, { life: 1e6 }); // closer to the player, far from the cursor
    const r = stepN(run, 30, hold(1, 65, 5));
    const chains = ofType(r.events, 'chain');
    expect(chains).toHaveLength(1);
    const pts = chains[0].points;
    expect(pts.length).toBe(2 + 4 * 2);
    // First strike: the monster nearest the cursor, then outward along the line.
    expect([pts[2], pts[4], pts[6], pts[8]]).toEqual([60, 120, 180, 240]);
    expect(ids.every((i) => world.monsters.life[i] < 1e6)).toBe(true);
    expect(world.monsters.life[far]).toBe(1e6);
    expect(world.monsters.life[decoy]).toBe(1e6);
    expect(chains[0].damageType).toBe('lightning');
  });

  it('fizzles toward the cursor when nothing is in reach', () => {
    const arc = makeSkill('arcChain', 1, { level: 10 });
    const { run } = makeArena({ skills: [lance(), arc], loadout: ['emberLance', 'arcChain', null, null, null, null] });
    const r = stepN(run, 30, hold(1, 100, 0));
    const chains = ofType(r.events, 'chain');
    expect(chains).toHaveLength(1);
    expect(chains[0].points).toHaveLength(4);
    expect(ofType(r.events, 'hit')).toHaveLength(0);
  });
});

describe('ember nova', () => {
  it('bursts a ring of the configured projectile count', () => {
    const nova = makeSkill('emberNova', 1, { level: 10 });
    const { run, world } = makeArena({ skills: [lance(), nova], loadout: ['emberLance', 'emberNova', null, null, null, null] });
    const r = stepN(run, Math.ceil(nova.castTime / SIM_DT) + 1, hold(1, 0, 100));
    expect(ofType(r.events, 'nova')).toHaveLength(1);
    expect(world.projectiles.count).toBe(nova.projectiles);
  });

  it("echoes once 0.4 s later with the 'echo' flag or Echo of the Matriarch", () => {
    for (const setup of ['none', 'skill', 'player'] as const) {
      const nova = { ...makeSkill('emberNova', 1, { level: 10 }), flags: setup === 'skill' ? ['echo'] : [] };
      const stats = makeStats({ flags: setup === 'player' ? ['novaEcho'] : [] });
      const { run } = makeArena({ skills: [lance(), nova], loadout: ['emberLance', 'emberNova', null, null, null, null], stats });
      const ticks: number[] = [];
      for (let k = 0; k < 90; k++) {
        stepWith(run, hold(1, 0, 100));
        for (const e of run.drainEvents()) if (e.t === 'nova') ticks.push(run.view.tick);
      }
      if (setup === 'none') expect(ticks).toHaveLength(1);
      else {
        expect(ticks).toHaveLength(2);
        expect((ticks[1] - ticks[0]) * SIM_DT).toBeCloseTo(0.4, 1);
      }
    }
  });
});

describe('rime shards & flame wave', () => {
  it('rime shards fan out and chill', () => {
    const rime = { ...makeSkill('rimeShards', 4, { level: 10 }), ailmentChance: 1 };
    const { run, world } = makeArena({ skills: [lance(), rime], loadout: ['emberLance', 'rimeShards', null, null, null, null] });
    const i = placeMonster(world, 'ashling', 80, 0, { life: 1e6 });
    const r = stepN(run, 40, hold(1, 200, 0));
    expect(ofType(r.events, 'cast').filter((c) => c.skill === 'rimeShards').length).toBeGreaterThan(0);
    expect(world.monsters.ailments[i] & AILMENT_BIT.chilled).toBeTruthy();
  });

  it('flame waves pierce everything in their path', () => {
    const wave = makeSkill('flameWave', 1, { level: 10 });
    const { run, world } = makeArena({ skills: [lance(), wave], loadout: ['emberLance', 'flameWave', null, null, null, null] });
    const ids = [40, 60, 80, 100, 120, 140].map((x) => placeMonster(world, 'ashling', x, 0, { life: 1e6 }));
    stepN(run, 90, hold(1, 200, 0));
    expect(ids.every((i) => world.monsters.life[i] < 1e6)).toBe(true);
  });
});

describe('rift step', () => {
  it('blinks toward the cursor with charges that recover one at a time', () => {
    const rift = makeSkill('riftStep', 1, { level: 10 }); // 2 charges, 3.5 s each, distance 90
    const { run } = makeArena({ skills: [lance(), rift], loadout: ['emberLance', null, null, null, null, 'riftStep'] });
    const press = (x: number) => {
      const r = stepN(run, 1, hold(5, pv(run).x + x, pv(run).y));
      stepN(run, 1); // release
      return ofType(r.events, 'dash');
    };
    const d1 = press(500);
    expect(d1).toHaveLength(1);
    expect(d1[0].toX - d1[0].fromX).toBeCloseTo(rift.distance, 3);
    expect(pv(run).invulnTime).toBeGreaterThan(0);
    expect(pv(run).anim).toBe('dash');
    expect(press(500)).toHaveLength(1);
    expect(pv(run).slots[5].charges).toBe(0);
    expect(press(500)).toHaveLength(0);
    stepN(run, Math.round(3.5 / SIM_DT) + 2);
    expect(pv(run).slots[5].charges).toBe(1);
    expect(press(-500)).toHaveLength(1);
  });

  it('a real keypress (100 ms = 6 held ticks) blinks once; a quick second tap blinks again', () => {
    const rift = makeSkill('riftStep', 10, { level: 10 }); // 3 charges, distance ≈ 104
    const { run } = makeArena({ skills: [lance(), rift], loadout: ['emberLance', null, null, null, null, 'riftStep'] });
    const ahead = () => hold(5, pv(run).x + 500, pv(run).y);
    const press = stepN(run, 6, ahead);
    expect(ofType(press.events, 'dash')).toHaveLength(1);
    expect(pv(run).slots[5].charges).toBe(2);
    expect(pv(run).x).toBeCloseTo(rift.distance, 3);
    stepN(run, 1); // release
    const tap = stepN(run, 3, ahead);
    expect(ofType(tap.events, 'dash')).toHaveLength(1);
    expect(pv(run).slots[5].charges).toBe(1);
  });

  it('holding the key re-blinks at most every 0.4 s while charges last', () => {
    const rift = makeSkill('riftStep', 10, { level: 10 });
    const { run } = makeArena({ skills: [lance(), rift], loadout: ['emberLance', null, null, null, null, 'riftStep'] });
    const ahead = () => hold(5, pv(run).x + 500, pv(run).y);
    const ticks: number[] = [];
    for (let k = 0; k < Math.round(0.9 / SIM_DT); k++) {
      stepWith(run, ahead());
      if (run.drainEvents().some((e) => e.t === 'dash')) ticks.push(k);
    }
    // 0 s, 0.4 s, 0.8 s → three blinks, all three charges.
    expect(ticks).toHaveLength(3);
    expect((ticks[1] - ticks[0]) * SIM_DT).toBeCloseTo(0.4, 1);
    expect(pv(run).slots[5].charges).toBe(0);
    expect(pv(run).x).toBeCloseTo(3 * rift.distance, 2);
  });

  it('is clamped to the arena', () => {
    const rift = { ...makeSkill('riftStep', 1, { level: 10 }), distance: 5000 };
    const { run } = makeArena({ skills: [lance(), rift], loadout: ['emberLance', null, null, null, null, 'riftStep'] });
    stepN(run, 1, hold(5, 10000, 0));
    expect(Math.hypot(pv(run).x, pv(run).y)).toBeLessThanOrEqual(600);
  });
});

describe('cinder ward', () => {
  it('reduces damage taken by exactly its reduction and burns adjacent monsters', () => {
    const ward = makeSkill('cinderWard', 1, { level: 10 });
    const setup = (withWard: boolean) => {
      const a = makeArena({ skills: [lance(), ward], loadout: ['emberLance', 'cinderWard', null, null, null, null], stats: makeStats({ evasion: 0, maxLife: 1e6 }) });
      if (withWard) stepN(a.run, 30, hold(1, 0, 100));
      else stepN(a.run, 30);
      return a;
    };
    const plain = setup(false);
    const warded = setup(true);
    expect(pv(warded.run).wardTime).toBeGreaterThan(0);
    // Identical burning ground under both players (DoT: no roll, no evasion) — only the ward differs.
    for (const w of [plain.world, warded.world]) {
      w.areas.push({
        id: 999, kind: 'firePool', x: 0, y: 0, radius: 30, age: 0, duration: 1, damage: 100, dtype: 1, hurts: 'player',
        tickInterval: 0.5, tickTimer: 0, owner: -1, source: 0, follow: -1, poolDuration: 0, poolDamage: 0, dead: false,
      });
    }
    const before = [plain.player.life, warded.player.life];
    stepWith(plain.run, idleIntent());
    stepWith(warded.run, idleIntent());
    const hitA = plain.world;
    const hitB = warded.world;
    const takenPlain = before[0] - hitA.players[0].life;
    const takenWarded = before[1] - hitB.players[0].life;
    expect(takenPlain).toBeCloseTo(100, 5);
    expect(takenWarded).toBeCloseTo(100 * (1 - ward.damageReduction), 5);

    // Embers burn a monster standing inside the ward radius.
    const i = placeMonster(warded.world, 'ashling', 20, 0, { life: 1e6 });
    stepN(warded.run, 40);
    expect(warded.world.monsters.life[i]).toBeLessThan(1e6);
  });
});

describe('ailments', () => {
  it('ignite burns over time after the hit', () => {
    const def = { ...lance(), ailmentChance: 1 };
    const { run, world } = makeArena({ skills: [def] });
    const i = placeMonster(world, 'ashling', 50, 0, { life: 1e6 });
    stepN(run, 40, hold(0, 100, 0));
    expect(world.monsters.ailments[i] & AILMENT_BIT.burning).toBeTruthy();
    const afterHit = world.monsters.life[i];
    stepN(run, 30);
    expect(world.monsters.life[i]).toBeLessThan(afterHit);
    stepN(run, 200);
    expect(world.monsters.ailments[i] & AILMENT_BIT.burning).toBe(0);
  });

  it('chill slows movement by 30%', () => {
    const walk = (chilled: boolean) => {
      const { run, world } = makeArena();
      const i = placeMonster(world, 'ashling', 300, 0, { still: false });
      world.monsters.attackCd[i] = 1e9;
      if (chilled) world.monsters.chillTime[i] = 10;
      stepN(run, 60);
      return 300 - world.monsters.x[i];
    };
    const normal = walk(false);
    const slow = walk(true);
    expect(slow / normal).toBeCloseTo(0.7, 1);
  });

  it('shock makes the target take 20% more damage', () => {
    const fire = (shocked: boolean) => {
      const { run, world } = makeArena({ skills: [{ ...lance(), critChance: 0, ailmentChance: 0 }] });
      // Small life pool: Float32 life keeps full precision here.
      const i = placeMonster(world, 'ashling', 50, 0, { life: 2000 });
      if (shocked) world.monsters.shockTime[i] = 10;
      stepN(run, 40, hold(0, 100, 0));
      return 2000 - world.monsters.life[i];
    };
    expect(fire(true) / fire(false)).toBeCloseTo(1.2, 4);
  });
});
