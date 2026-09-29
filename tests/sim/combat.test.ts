import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/contracts/sim';
import { damageMonster, damagePlayer } from '../../src/sim/combat';
import { DAMAGE_INDEX } from '../../src/sim/math';
import { idleIntent, makeSkill, makeStats } from './fixtures';
import { hold, makeArena, ofType, placeMonster, pv, stepN, stepWith } from './helpers';

describe('player defences', () => {
  it('caps total melee damage at 35% of max life per 0.5 s window', () => {
    const { run, world } = makeArena({ stats: makeStats({ maxLife: 1000, evasion: 0 }) });
    // A ring of brutal attackers all ready to bite at once.
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const i = placeMonster(world, 'ashling', Math.cos(a) * 14, Math.sin(a) * 14, { still: false });
      world.monsters.damage[i] = 500;
      world.monsters.attackCd[i] = 0;
    }
    const lifeAt: number[] = [];
    for (let t = 0; t < 120; t++) {
      stepWith(run, idleIntent());
      lifeAt.push(pv(run).life);
    }
    const window = Math.round(0.5 / SIM_DT);
    for (let t = window; t < lifeAt.length; t++) {
      if (lifeAt[t] <= 0) break;
      expect(lifeAt[t - window] - lifeAt[t]).toBeLessThanOrEqual(350 + 1e-3);
    }
    expect(pv(run).life).toBeLessThan(1000);
  });

  it('applies armour to physical hits, resistances to elemental hits, and damageTaken', () => {
    const { world, player: p } = makeArena({ stats: makeStats({ maxLife: 1e6, evasion: 0, armor: 1000, resist: { physical: 0, fire: 0.5, cold: 0, lightning: 0, void: 0 }, damageTaken: 1.1 }) });
    for (let k = 0; k < 50; k++) {
      const before = p.life;
      damagePlayer(world, p, 100, DAMAGE_INDEX.physical, 'area');
      const taken = before - p.life;
      // roll 80..120, then armour: d * (1 - A / (A + 10 d)), then ×1.1
      const lo = 80 * (1 - 1000 / (1000 + 800)) * 1.1;
      const hi = 120 * (1 - 1000 / (1000 + 1200)) * 1.1;
      expect(taken).toBeGreaterThanOrEqual(lo - 1e-6);
      expect(taken).toBeLessThanOrEqual(hi + 1e-6);
    }
    const before = p.life;
    damagePlayer(world, p, 100, DAMAGE_INDEX.fire, 'dot');
    expect(before - p.life).toBeCloseTo(100 * 0.5 * 1.1, 6);
  });

  it('evasion is capped at 75% and only applies to attacks', () => {
    const { world, run, player } = makeArena({ stats: makeStats({ maxLife: 1e9, evasion: 1 }) });
    let landed = 0;
    for (let k = 0; k < 2000; k++) if (damagePlayer(world, player, 10, DAMAGE_INDEX.physical, 'melee') > 0) landed++;
    expect(landed / 2000).toBeGreaterThan(0.2);
    expect(landed / 2000).toBeLessThan(0.3);
    expect(damagePlayer(world, player, 10, DAMAGE_INDEX.fire, 'area')).toBeGreaterThan(0);
    const evades = ofType(run.drainEvents(), 'evade');
    expect(evades.length).toBeGreaterThan(1000);
    expect(evades.every((e) => e.playerId === 1 && e.target === 'player')).toBe(true);
  });

  it('invulnerability (rift step, run start) ignores all damage', () => {
    const { world, player } = makeArena();
    player.invulnTime = 1;
    expect(damagePlayer(world, player, 1e6, DAMAGE_INDEX.physical, 'area')).toBe(0);
    expect(player.dead).toBe(false);
  });
});

describe('kill credit and loot', () => {
  it('awards exactly one kill to the hit that crossed zero (overkill guard)', () => {
    const { run, world, log } = makeArena();
    const i = placeMonster(world, 'ashling', 30, 0, { life: 5 });
    const k1 = damageMonster(world, i, 1000, DAMAGE_INDEX.fire, 0, 1.5, 0, 1, 0, 1, true, 1);
    const k2 = damageMonster(world, i, 1000, DAMAGE_INDEX.fire, 0, 1.5, 0, 1, 0, 1, true, 1);
    expect([k1, k2]).toEqual([true, false]);
    const outcomes = run.drainOutcomes();
    expect(outcomes.filter((o) => o.t === 'kill')).toEqual([
      { t: 'kill', playerId: 1, kind: 'ashling', rarity: 'normal', isLieutenant: false, isBoss: false },
    ]);
    expect(log.killRolls).toHaveLength(1);
    expect(log.killRolls[0].playerIds).toEqual([1]);
    expect(log.killRolls[0].ctx.summoned).toBe(false);
    const hits = ofType(run.drainEvents(), 'hit');
    expect(hits.filter((h) => h.killed)).toHaveLength(1);
    expect(hits[0].playerId).toBe(1);
  });

  it('two piercing projectiles on the same tick still kill only once', () => {
    const lance = { ...makeSkill('emberLance', 1, { level: 10 }), projectiles: 2, spread: 0.0001, damage: 500 };
    const { run, world } = makeArena({ skills: [lance] });
    placeMonster(world, 'ashling', 60, 0, { life: 10 });
    const r = stepN(run, 60, hold(0, 100, 0));
    expect(r.outcomes.filter((o) => o.t === 'kill')).toEqual([expect.objectContaining({ t: 'kill', playerId: 1 })]);
  });

  it('drops bounce out of the corpse, land, magnetise and are picked up through tryPickup', () => {
    const { run, world, log } = makeArena({ hooks: { dropChance: 1 }, stats: makeStats({ pickupRadius: 200 }) });
    const i = placeMonster(world, 'ashling', 60, 0, { life: 1 });
    damageMonster(world, i, 100, DAMAGE_INDEX.fire, 0, 1.5, 0, 1, 0, 1);
    const spawned = ofType(run.drainEvents(), 'dropSpawn');
    expect(spawned).toHaveLength(1);
    expect(spawned[0].owner).toBe(1);
    expect(run.view.drops).toHaveLength(1);
    expect(run.view.drops[0].spec.owner).toBe(1);
    let peak = 0;
    const r = stepN(run, 180, () => {
      peak = Math.max(peak, run.view.drops[0]?.z ?? 0);
      return idleIntent();
    });
    expect(peak).toBeGreaterThan(5);
    expect(log.pickups).toHaveLength(1);
    expect(r.outcomes.filter((o) => o.t === 'pickup')).toEqual([{ t: 'pickup', playerId: 1, token: log.pickups[0] }]);
    expect(ofType(r.events, 'pickup')).toEqual([expect.objectContaining({ t: 'pickup', owner: 1 })]);
    expect(run.view.drops).toHaveLength(0);
  });

  it('a drop that cannot be picked up stays, flagged blocked, until the player returns', () => {
    let full = true;
    const { run, world, log } = makeArena({ hooks: { dropChance: 1, full: () => full } });
    const i = placeMonster(world, 'ashling', 40, 0, { life: 1 });
    damageMonster(world, i, 100, DAMAGE_INDEX.fire, 0, 1.5, 0, 1, 0, 1);
    stepN(run, 60); // land
    const d = run.view.drops[0];
    const walkTo = (x: number, y: number, n: number) =>
      stepN(run, n, () => {
        const p = pv(run);
        const dx = x - p.x;
        const dy = y - p.y;
        const l = Math.hypot(dx, dy);
        const it = idleIntent();
        if (l > 1) {
          it.moveX = dx / l;
          it.moveY = dy / l;
        }
        return it;
      });
    walkTo(d.x, d.y, 90);
    expect(log.blocked).toBeGreaterThanOrEqual(1);
    expect(run.view.drops).toHaveLength(1);
    expect(run.view.drops[0].blocked).toBe(true);
    // Standing on it does not spam tryPickup.
    const blockedOnce = log.blocked;
    stepN(run, 30);
    expect(log.blocked).toBe(blockedOnce);
    // Free space, walk away and back: picked up.
    full = false;
    walkTo(-100, 0, 90);
    walkTo(run.view.drops[0].x, run.view.drops[0].y, 120);
    expect(run.view.drops).toHaveLength(0);
    expect(log.pickups).toHaveLength(1);
  });

  it('awards XP on a distant kill immediately, without orbs or pickup radius', () => {
    const { run, world } = makeArena({ stats: makeStats({ pickupRadius: 0 }) });
    const i = placeMonster(world, 'riftStalker', 500, 0, { life: 1 });
    damageMonster(world, i, 100, DAMAGE_INDEX.fire, 0, 1.5, 0, 1, 0, 1);
    expect(run.drainOutcomes().filter((o) => o.t === 'xp')).toEqual([{ t: 'xp', amount: 8 }]);
    expect(run.view.motes.count).toBe(0);
    // An overkill and later ticks cannot award the same kill twice.
    damageMonster(world, i, 100, DAMAGE_INDEX.fire, 0, 1.5, 0, 1, 0, 1);
    const later = stepN(run, 120);
    expect(later.outcomes.filter((o) => o.t === 'xp')).toEqual([]);
    expect(ofType(later.events, 'mote')).toEqual([]);
  });

  it('keeps fractional XP across kills without leaving any on the ground', () => {
    const { run, world } = makeArena({ stats: makeStats({ pickupRadius: 0 }) });
    const gained: number[] = [];
    for (let k = 0; k < 4; k++) {
      const i = placeMonster(world, 'ashling', 500, 0, { life: 1 });
      world.monsters.xp[i] = 1.25;
      damageMonster(world, i, 100, DAMAGE_INDEX.fire, 0, 1.5, 0, 1, 0, 1);
      for (const o of run.drainOutcomes()) if (o.t === 'xp') gained.push(o.amount);
    }
    expect(gained).toEqual([1, 1, 1, 2]);
    expect(run.view.motes.count).toBe(0);
  });
});

describe('monster behaviour', () => {
  it('spawning monsters are invulnerable for the spawn animation', () => {
    const { run, world } = makeArena({ skills: [makeSkill('emberLance', 1, { level: 10 })] });
    const i = placeMonster(world, 'ashling', 40, 0, { life: 1e6 });
    world.monsters.spawnTime[i] = 0.5;
    world.monsters.anim[i] = 5;
    expect(damageMonster(world, i, 100, 1, 0, 1.5, 0, 1, 0, 1)).toBe(false);
    expect(world.monsters.life[i]).toBe(1e6);
    stepN(run, 40);
    expect(world.monsters.anim[i]).not.toBe(5);
    damageMonster(world, i, 100, 1, 0, 1.5, 0, 1, 0, 1);
    expect(world.monsters.life[i]).toBeLessThan(1e6);
  });

  it('knocks monsters back 2–4 units per hit', () => {
    const { run, world } = makeArena();
    const i = placeMonster(world, 'ashling', 100, 0, { life: 1e6 });
    world.monsters.knockback[i] = 1;
    damageMonster(world, i, 10, 1, 0, 1.5, 0, 1, 0, 1);
    stepN(run, 30);
    const moved = world.monsters.x[i] - 100;
    expect(moved).toBeGreaterThanOrEqual(2 - 0.05);
    expect(moved).toBeLessThanOrEqual(4 + 0.05);
  });

  it('knockback never exceeds 4 units, however many hits land at once', () => {
    const { run, world } = makeArena();
    const i = placeMonster(world, 'ashling', 100, 0, { life: 1e6 });
    world.monsters.knockback[i] = 1;
    // A rank-20 Flame Wave's worth of overlapping hits in one tick.
    for (let k = 0; k < 9; k++) damageMonster(world, i, 10, 1, 0, 1.5, 0, 1, 0, 1);
    stepN(run, 60);
    expect(world.monsters.x[i] - 100).toBeLessThanOrEqual(4 + 0.05);
    expect(world.monsters.x[i] - 100).toBeGreaterThan(3);
  });

  it('hordes do not stack into one point', () => {
    const { run, world } = makeArena({ stats: makeStats({ maxLife: 1e9, evasion: 0 }) });
    const ids: number[] = [];
    for (let k = 0; k < 120; k++) {
      const i = placeMonster(world, 'ashling', 200 + (k % 12) * 3, Math.floor(k / 12) * 3, { still: false });
      world.monsters.attackCd[i] = 1e9;
      ids.push(i);
    }
    stepN(run, 600);
    const m = world.monsters;
    let overlapping = 0;
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        const d = Math.hypot(m.x[ids[a]] - m.x[ids[b]], m.y[ids[a]] - m.y[ids[b]]);
        if (d < (m.radius[ids[a]] + m.radius[ids[b]]) * 0.5) overlapping++;
      }
    }
    expect(overlapping).toBeLessThan(6);
    // ...and they surround the player rather than piling on one side.
    const angles = new Set(ids.map((i) => Math.floor(((Math.atan2(m.y[i], m.x[i]) + Math.PI) / (Math.PI * 2)) * 8)));
    expect(angles.size).toBeGreaterThanOrEqual(6);
    // The player was never shoved by the crowd.
    expect(Math.hypot(world.players[0].x, world.players[0].y)).toBeLessThan(1);
  });

  it('rift stalkers telegraph their landing spot before leaping onto it', () => {
    const { run, world } = makeArena({ stats: makeStats({ maxLife: 1e6, evasion: 0 }) });
    const i = placeMonster(world, 'riftStalker', 120, 0, { still: false });
    world.monsters.attackCd[i] = 0;
    const r = stepN(run, 2);
    const warn = run.view.areas.find((a) => a.kind === 'leapWarning');
    expect(warn).toBeDefined();
    expect(warn!.x).toBeCloseTo(0, 3);
    const rest = stepN(run, 60);
    expect(ofType([...r.events, ...rest.events], 'monsterAttack').some((e) => e.attack === 'leap')).toBe(true);
    expect(ofType(rest.events, 'areaResolve').some((e) => e.kind === 'leapWarning')).toBe(true);
    expect(Math.hypot(world.monsters.x[i], world.monsters.y[i])).toBeLessThan(20);
  });

  it('ironhide brutes slam after a telegraph; the slam hurts only inside the circle', () => {
    const { run, world } = makeArena({ stats: makeStats({ maxLife: 1e6, evasion: 0 }) });
    const i = placeMonster(world, 'ironhideBrute', 40, 0, { still: false });
    world.monsters.attackCd[i] = 0;
    stepN(run, 2);
    const warn = run.view.areas.find((a) => a.kind === 'slamWarning');
    expect(warn).toBeDefined();
    // Walk out of the telegraph before it resolves.
    const r = stepN(run, 60, () => ({ ...idleIntent(), moveX: -1 }));
    expect(ofType(r.events, 'areaResolve').some((e) => e.kind === 'slamWarning')).toBe(true);
    expect(world.players[0].life).toBe(1e6);
  });
});
