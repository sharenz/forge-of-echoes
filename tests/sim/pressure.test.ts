// Anti-kiting pressure (src/sim/rosters/pressure.ts): the swarmers' telegraphed gap-closing leap and the artillery's
// predictive ground markers. Tier 1 is rare and light, the full ramp frequent and predictive; both are dodgeable and
// never start on a held player.
import { describe, expect, it } from 'vitest';
import { idleIntent, makeStats } from './fixtures';
import { makeArena, ofType, placeMonster, stepN, stepWith } from './helpers';
import { applyDebuff } from '../../src/sim/debuffs';
import { MSTATE } from '../../src/sim/stores';

const RAMP_FULL = 40; // PROJECTILE_SCALING.levelFull

function arena(level: number) {
  const a = makeArena({ stats: makeStats({ maxLife: 1e6, evasion: 0 }) });
  a.world.config.monsters.level = level;
  return a;
}

/** An ashling `x` units east of the player, armed to leap now. */
function armedAshling(a: ReturnType<typeof arena>, x: number, kind: 'ashling' | 'boneThrall' | 'chainThrall' = 'ashling'): number {
  const i = placeMonster(a.world, kind, x, 0, { still: false });
  a.world.monsters.attackCd[i] = 1e9; // its own melee is out of the picture
  a.world.monsters.timerD[i] = 0.001;
  return i;
}

describe('gap-closing leap', () => {
  it('telegraphs its landing before it goes, then closes the gap and lands its disc', () => {
    const a = arena(RAMP_FULL);
    const i = armedAshling(a, 150);
    stepN(a.run, 2);
    const warn = a.run.view.areas.find((x) => x.kind === 'leapWarning');
    expect(warn, 'the landing telegraph is up at the windup').toBeDefined();
    expect(a.world.monsters.state[i]).toBe(MSTATE.charge);
    expect(a.world.monsters.vx[i]).toBe(0); // it stands and crouches: the tell
    const x0 = a.world.monsters.x[i];
    const r = stepN(a.run, 60);
    expect(ofType(r.events, 'monsterAttack').some((e) => e.attack === 'leap')).toBe(true);
    expect(ofType(r.events, 'areaResolve').some((e) => e.kind === 'leapWarning')).toBe(true);
    expect(x0 - a.world.monsters.x[i], 'covered most of the gap in one hop').toBeGreaterThan(80);
  });

  it('a player who keeps walking away, then turns, is not caught by the landing', () => {
    const a = arena(RAMP_FULL);
    armedAshling(a, 150);
    stepN(a.run, 2);
    // The landing is drawn for the whole crouch and flight (~0.65 s): step out of it sideways.
    stepN(a.run, 45, () => ({ ...idleIntent(), moveY: 1 }));
    expect(a.world.players[0].life).toBe(1e6);
  });

  it('a player who stands still on the landing takes its hit', () => {
    const a = arena(RAMP_FULL);
    armedAshling(a, 150);
    const r = stepN(a.run, 60);
    expect(ofType(r.events, 'areaResolve').some((e) => e.kind === 'leapWarning')).toBe(true);
    expect(a.world.players[0].life).toBeLessThan(1e6);
  });

  it('stays out of tier 1 mid range beyond its short reach, and never starts on a held player', () => {
    const t1 = arena(1);
    const far = armedAshling(t1, 150); // beyond the tier-1 window (60-100)
    stepN(t1.run, 5);
    expect(t1.world.monsters.state[far]).toBe(MSTATE.chase);
    const near = armedAshling(t1, -80);
    stepN(t1.run, 2);
    expect(t1.world.monsters.state[near]).toBe(MSTATE.charge);

    const held = arena(RAMP_FULL);
    const i = armedAshling(held, 120);
    applyDebuff(held.world, held.world.players[0], 'rooted', 0, 'bone');
    stepN(held.run, 5);
    expect(held.world.monsters.state[i]).toBe(MSTATE.chase);
    expect(held.run.view.areas.some((x) => x.kind === 'leapWarning')).toBe(false);
  });

  it('ramps: a longer window, a shorter crouch and a harder landing at the full ramp', () => {
    const windup = (level: number) => {
      const a = arena(level);
      const i = armedAshling(a, 80);
      stepN(a.run, 1);
      return { time: a.world.monsters.stateTime[i], dmg: a.world.areas.find((x) => x.kind === 'leapWarning')!.damage, base: a.world.monsters.damage[i] };
    };
    const lo = windup(1);
    const hi = windup(RAMP_FULL);
    expect(hi.time).toBeLessThan(lo.time);
    expect(hi.dmg / hi.base).toBeGreaterThan(lo.dmg / lo.base);
  });

  it('carries the Bone Thrall and the Chain Thrall too (the thrall keeps its hook as the opener)', () => {
    const a = arena(RAMP_FULL);
    const bone = armedAshling(a, 150, 'boneThrall');
    stepN(a.run, 2);
    expect(a.world.monsters.state[bone]).toBe(MSTATE.charge);

    const b = arena(RAMP_FULL);
    const chain = armedAshling(b, 150, 'chainThrall');
    b.world.monsters.attackCd[chain] = 0; // hook ready and in range: it throws instead of leaping
    stepN(b.run, 2);
    expect(b.world.monsters.state[chain]).toBe(MSTATE.cast);
    b.world.monsters.attackCd[chain] = 1e9; // hook spent: now the leap
    b.world.monsters.state[chain] = MSTATE.chase;
    stepN(b.run, 2);
    expect(b.world.monsters.state[chain]).toBe(MSTATE.charge);
  });
});

describe('predictive ground markers', () => {
  /** A spitter 200 east, ready to fire and to mark; the player walks north at full speed. */
  function walkerVsSpitter(level: number, kind: 'cinderSpitter' | 'frostWeaver') {
    const a = arena(level);
    const i = placeMonster(a.world, kind, 200, 0, { still: false });
    a.world.monsters.attackCd[i] = 0;
    a.world.monsters.timerD[i] = 0.001;
    const walk = { ...idleIntent(), moveY: 1 };
    stepN(a.run, 20, () => walk);
    const mark = () => a.world.areas.find((x) => x.kind === (kind === 'cinderSpitter' ? 'eruptionWarning' : 'frostNovaWarning'));
    let k = 0;
    while (!mark() && k++ < 200) stepWith(a.run, walk);
    return { a, i, mark: mark() };
  }

  it('the ember marker lands ahead of a walking player, not where they stand; it leaves a burning pool', () => {
    for (const level of [1, RAMP_FULL]) {
      const { a, mark } = walkerVsSpitter(level, 'cinderSpitter');
      expect(mark, `level ${level}: a marker was dropped`).toBeDefined();
      expect(mark!.y - a.world.players[0].y, `level ${level}: ahead of them`).toBeGreaterThan(25);
    }
    const { a, mark } = walkerVsSpitter(RAMP_FULL, 'cinderSpitter');
    expect(mark!.duration).toBeLessThan(1.1);
    const pools = () => a.world.areas.filter((x) => x.kind === 'firePool');
    stepN(a.run, 80, () => ({ ...idleIntent(), moveY: -1 }));
    expect(pools().length).toBeGreaterThan(0);
  });

  it('the frost weaver marks too (damage only; its lingering storm chills), and a rooted player is left alone', () => {
    const { mark } = walkerVsSpitter(RAMP_FULL, 'frostWeaver');
    expect(mark).toBeDefined();
    expect(mark!.hurts).toBe('player');

    const a = arena(RAMP_FULL);
    const i = placeMonster(a.world, 'cinderSpitter', 200, 0, { still: false });
    a.world.monsters.attackCd[i] = 0;
    a.world.monsters.timerD[i] = 0.001;
    applyDebuff(a.world, a.world.players[0], 'rooted', 0, 'bone');
    stepN(a.run, 60);
    expect(a.world.areas.some((x) => x.kind === 'eruptionWarning')).toBe(false);
  });

  it('is tier-scaled: the full ramp marks more often and with a shorter notice than tier 1', () => {
    const notice = (level: number) => walkerVsSpitter(level, 'cinderSpitter').mark!.duration;
    expect(notice(RAMP_FULL)).toBeLessThan(notice(1));
  });
});

describe('determinism', () => {
  it('a run with leaps and markers replays to the same digest', () => {
    const digest = () => {
      const a = arena(RAMP_FULL);
      for (let k = 0; k < 6; k++) placeMonster(a.world, k % 2 ? 'ashling' : 'cinderSpitter', 120 + k * 15, k * 20 - 50, { still: false });
      stepN(a.run, 400, () => ({ ...idleIntent(), moveX: 0.6, moveY: 0.8 }));
      return a.run.digest();
    };
    expect(digest()).toBe(digest());
  });
});
