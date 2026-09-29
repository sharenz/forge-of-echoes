import { describe, expect, it } from 'vitest';
import { MONSTER_ANIM, SIM_DT } from '../../src/contracts/sim';
import { damageMonster } from '../../src/sim/combat';
import { ARMOURED_HIT_REDUCTION, PLAYER_RADIUS, SPIT_FLIGHT } from '../../src/sim/constants';
import { DAMAGE_INDEX } from '../../src/sim/math';
import { MFLAG } from '../../src/sim/stores';
import { idleIntent, makeStats } from './fixtures';
import { makeArena, ofType, placeMonster, stepN, stepWith } from './helpers';

const tough = () => makeStats({ maxLife: 1e9, evasion: 0 });
const walkEast = () => ({ ...idleIntent(), moveX: 1 });

describe('heavy bodies', () => {
  it('the player cannot shove the Matriarch, the Herald or a brute — they block her', () => {
    for (const kind of ['cinderMatriarch', 'ashboundHerald', 'ironhideBrute'] as const) {
      const { run, world } = makeArena({ stats: tough() });
      const i = placeMonster(world, kind, 60, 0, { life: 1e9 });
      const m = world.monsters;
      m.timerA[i] = m.timerB[i] = 99; // no Herald summons crowding the scene
      stepN(run, Math.round(2 / SIM_DT), walkEast);
      expect(Math.hypot(m.x[i] - 60, m.y[i])).toBeLessThan(1);
      // She is stopped at contact, not inside the body.
      const p = world.players[0];
      expect(Math.hypot(m.x[i] - p.x, m.y[i] - p.y)).toBeGreaterThanOrEqual(m.radius[i] + PLAYER_RADIUS - 0.5);
      expect(p.x).toBeGreaterThan(60 - m.radius[i] - PLAYER_RADIUS - 3);
    }
  });

  it('regular monsters still give way', () => {
    const { run, world } = makeArena({ stats: tough() });
    const i = placeMonster(world, 'ashling', 40, 0, { life: 1e9 });
    stepN(run, Math.round(1 / SIM_DT), walkEast);
    expect(world.monsters.x[i]).toBeGreaterThan(60);
  });
});

describe('Cinder Matriarch', () => {
  it('one huge hit past both thresholds still roars phase 2, then phase 3', () => {
    const { run, world } = makeArena({ stats: tough() });
    const i = placeMonster(world, 'cinderMatriarch', 150, 0, { life: 10000 });
    world.monsters.life[i] = 1500; // 15%: straight from phase 1 into phase-3 territory
    const r = stepN(run, Math.round(3 / SIM_DT));
    const phases = ofType(r.events, 'bossPhase');
    expect(phases.map((e) => e.phase)).toEqual([2, 3]);
    expect(world.boss.phase).toBe(3);
  });

  it('a burn cannot hurt her while she roars (phase-change immunity)', () => {
    const { run, world } = makeArena({ stats: tough() });
    const i = placeMonster(world, 'cinderMatriarch', 150, 0, { life: 10000 });
    const m = world.monsters;
    m.life[i] = 6000; // below 66%: she roars on the next tick
    m.igniteTime[i] = 3;
    m.igniteDps[i] = 600;
    stepWith(run, idleIntent());
    expect(m.flags[i] & MFLAG.immune).toBeTruthy();
    const roaring = m.life[i];
    stepN(run, Math.round(1 / SIM_DT)); // the roar lasts 1.2 s
    expect(m.life[i]).toBe(roaring);
    // The rest of the burn resumes once she is vulnerable again.
    stepN(run, Math.round(0.8 / SIM_DT));
    expect(m.flags[i] & MFLAG.immune).toBe(0);
    expect(m.life[i]).toBeLessThan(roaring - 100);
  });
});

describe('Ashbound Herald', () => {
  it('summons every 6 s through a visible cast, independent of its orb volleys', () => {
    const { run, world } = makeArena({ stats: tough() });
    const i = placeMonster(world, 'ashboundHerald', 140, 0, { life: 1e9 });
    const m = world.monsters;
    m.timerA[i] = 3;
    m.timerB[i] = 1.5;
    const summons: number[] = [];
    const animBefore: number[] = [];
    const animAfter: number[] = [];
    let prevAnim: number = m.anim[i];
    let checkAt = -1;
    for (let t = 0; t < Math.round(20 / SIM_DT); t++) {
      stepWith(run, idleIntent());
      const ev = run.drainEvents();
      if (ev.some((e) => e.t === 'monsterAttack' && e.kind === 'ashboundHerald' && e.attack === 'summon')) {
        summons.push(t * SIM_DT);
        animBefore.push(prevAnim);
        checkAt = t + 5;
      }
      // The attack pose is held after the release (not overwritten by the move/idle pose).
      if (t === checkAt) animAfter.push(m.anim[i]);
      prevAnim = m.anim[i];
    }
    // Due at 3, 9 and 15 s; each released after its 0.45 s cast.
    expect(summons).toHaveLength(3);
    expect(summons[0]).toBeCloseTo(3.45, 1);
    expect(summons[1] - summons[0]).toBeCloseTo(6, 1);
    expect(summons[2] - summons[1]).toBeCloseTo(6, 1);
    expect(animBefore).toEqual([MONSTER_ANIM.windup, MONSTER_ANIM.windup, MONSTER_ANIM.windup]);
    expect(animAfter).toEqual([MONSTER_ANIM.attack, MONSTER_ANIM.attack, MONSTER_ANIM.attack]);
  });

  it('summoned minions roll no loot and carry half XP', () => {
    const { run, world, log } = makeArena({ stats: tough(), hooks: { dropChance: 1 } });
    const h = placeMonster(world, 'ashboundHerald', 140, 0, { life: 1e9 });
    world.monsters.timerA[h] = 0;
    world.monsters.timerB[h] = 99;
    stepN(run, Math.round(1 / SIM_DT));
    const m = world.monsters;
    const minions: number[] = [];
    for (let i = 0; i < m.capacity; i++) if (m.alive[i] && i !== h) minions.push(i);
    expect(minions).toHaveLength(6);
    expect(minions.every((i) => (m.flags[i] & MFLAG.summoned) !== 0)).toBe(true);
    expect(m.xp[minions[0]]).toBeCloseTo(1.5, 5); // ashling 3 XP × 0.5
    stepN(run, Math.round(0.6 / SIM_DT)); // let their spawn animation finish
    for (const i of minions) damageMonster(world, i, 1e6, DAMAGE_INDEX.fire, 0, 1.5, 0, 1, 0, 1);
    const out = run.drainOutcomes();
    expect(out.filter((o) => o.t === 'kill')).toHaveLength(6);
    // The sim never asks for loot for summons (KillLootContext.summoned would be true).
    expect(log.killRolls).toHaveLength(0);
    expect(run.view.drops).toHaveLength(0);
  });
});

describe('Cinder Spitter', () => {
  function spitter(stats = tough()) {
    const a = makeArena({ stats });
    const i = placeMonster(a.world, 'cinderSpitter', 200, 0, { life: 1e9 });
    a.world.monsters.attackCd[i] = 0;
    return { ...a, i };
  }

  it('lobs its spit: it flies for a fixed time and bursts where the player stood', () => {
    const { run, world } = spitter();
    let launched = -1;
    let landed = -1;
    let hurtAt = -1;
    let end: { x: number; y: number } | null = null;
    for (let t = 0; t < 150 && landed < 0; t++) {
      const before = world.players[0].life;
      stepWith(run, idleIntent());
      const ev = run.drainEvents();
      if (ev.some((e) => e.t === 'monsterAttack' && e.attack === 'spit')) launched = t;
      const pe = ofType(ev, 'projectileEnd').find((e) => e.kind === 'cinderSpit');
      if (pe) {
        landed = t;
        end = pe;
      }
      if (world.players[0].life < before && hurtAt < 0) hurtAt = t;
    }
    expect(launched).toBeGreaterThan(0);
    expect((landed - launched) * SIM_DT).toBeCloseTo(SPIT_FLIGHT, 1);
    // Only the landing hurts, and it lands on the spot it was aimed at.
    expect(hurtAt).toBe(landed);
    expect(Math.hypot(end!.x, end!.y)).toBeLessThan(1.5);
  });

  it('walking off the landing spot dodges it', () => {
    const { run, world } = spitter();
    let launched = -1;
    for (let t = 0; t < 60 && launched < 0; t++) {
      stepWith(run, idleIntent());
      if (run.drainEvents().some((e) => e.t === 'monsterAttack' && e.attack === 'spit')) launched = t;
    }
    expect(launched).toBeGreaterThan(0);
    // The view carries the lob's flight time (ProjectileStoreView.life) for the arc.
    const pj = run.view.projectiles;
    let lob = -1;
    for (let k = 0; k < pj.capacity; k++) if (pj.alive[k] && pj.hostile[k]) lob = k;
    expect(pj.life[lob]).toBeCloseTo(SPIT_FLIGHT, 5);
    const life = world.players[0].life;
    // The spit is airborne: walking across its path is safe; leaving the target zone dodges it.
    const r = stepN(run, Math.round((SPIT_FLIGHT + 0.2) / SIM_DT), () => ({ ...idleIntent(), moveY: 1 }));
    expect(ofType(r.events, 'projectileEnd').some((e) => e.kind === 'cinderSpit')).toBe(true);
    expect(world.players[0].life).toBe(life);
  });
});

describe('Ironhide Brute armour', () => {
  /** Mean damage per call against a brute vs an ashling with identical (zeroed) resistances. */
  function ratio(hit: boolean): number {
    const { world } = makeArena();
    const b = placeMonster(world, 'ironhideBrute', 100, 0, { life: 1e7 });
    const a = placeMonster(world, 'ashling', -100, 0, { life: 1e7 });
    const m = world.monsters;
    for (let k = 0; k < 5; k++) m.res[b * 5 + k] = m.res[a * 5 + k] = 0;
    for (let n = 0; n < 400; n++) {
      damageMonster(world, b, 100, DAMAGE_INDEX.fire, 0, 1.5, 0, 0, 0, 0, hit);
      damageMonster(world, a, 100, DAMAGE_INDEX.fire, 0, 1.5, 0, 0, 0, 0, hit);
    }
    return (1e7 - m.life[b]) / (1e7 - m.life[a]);
  }

  it('takes 40% less from hits, full damage from burning', () => {
    expect(ratio(true)).toBeCloseTo(1 - ARMOURED_HIT_REDUCTION, 1);
    expect(ratio(false)).toBeCloseTo(1, 1);
  });

  it('armour does not weaken the ignite a hit applies', () => {
    const burn = (kind: 'ironhideBrute' | 'ashling') => {
      const { world } = makeArena({ seed: 5 });
      // A small life pool keeps Float32 life exact to well below the tolerance.
      const i = placeMonster(world, kind, 100, 0, { life: 1000 });
      for (let k = 0; k < 5; k++) world.monsters.res[i * 5 + k] = 0;
      damageMonster(world, i, 100, DAMAGE_INDEX.fire, 0, 1.5, 1, 0, 0, 0);
      return { dps: world.monsters.igniteDps[i], hit: 1000 - world.monsters.life[i] };
    };
    const brute = burn('ironhideBrute');
    const ashling = burn('ashling');
    expect(brute.dps).toBeGreaterThan(0);
    expect(brute.dps).toBeCloseTo(ashling.dps, 6);
    expect(brute.hit).toBeCloseTo(ashling.hit * (1 - ARMOURED_HIT_REDUCTION), 3);
  });
});
