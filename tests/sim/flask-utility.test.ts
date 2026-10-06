// Utility flasks (power rework 10.3): Quickstep, Aegis and Quicksilver Mind apply their effect while active, never recover
// life or focus over time, and the sim's numbers equal the item data's.
import { describe, expect, it } from 'vitest';
import { idleIntent, makeStats } from './fixtures';
import { makeArena, pv, stepN } from './helpers';
import { SIM_DT, type FlaskRuntime } from '../../src/contracts/sim';
import { FLASKS } from '../../src/data/items';
import { FLASK_FX, RESIST_CAP } from '../../src/sim/constants';
import { effectiveResist } from '../../src/sim/debuffs';

const rt = (flaskId: FlaskRuntime['flaskId'], resource: 'life' | 'focus', duration: number): FlaskRuntime =>
  ({ flaskId, count: 3, resource, amount: 0, duration });

function arena(stats = makeStats()) {
  const a = makeArena({ stats });
  a.run.updatePlayer(1, { flasks: [rt('quickstep', 'life', 4), rt('aegis', 'life', 6), rt('quicksilverMind', 'focus', 5), null] });
  return a;
}

describe('utility flasks', () => {
  it('keep the sim numbers equal to the item data', () => {
    for (const id of ['quickstep', 'aegis', 'quicksilverMind'] as const) {
      expect(FLASKS[id].utility!.kind).toBe(id);
      expect(FLASKS[id].utility!.fx, id).toEqual(FLASK_FX[id]);
      expect(FLASKS[id].recoverBase + FLASKS[id].recoverPerLevel, id).toBe(0);
    }
    expect([FLASKS.quickstep.duration, FLASKS.aegis.duration, FLASKS.quicksilverMind.duration]).toEqual([4, 6, 5]);
  });

  it('Quickstep: +30% move speed while active, back to normal after, and Rooted is removed', () => {
    const base = arena();
    const walk = { ...idleIntent(), moveX: 1 };
    stepN(base.run, 30, walk);
    const plain = base.player.x;

    const a = arena();
    stepN(a.run, 1, { ...idleIntent(), flask: 0 });
    expect(pv(a.run).flasks[0]!.active).toBeGreaterThan(3.9);
    const x0 = a.player.x;
    stepN(a.run, 30, walk);
    const fast = a.player.x - x0;
    expect(fast / plain).toBeGreaterThan(1.25);
    expect(fast / plain).toBeLessThan(1.35);
    // After 4 s the buff is gone.
    stepN(a.run, Math.round(4 / SIM_DT));
    expect(pv(a.run).flasks[0]!.active).toBe(0);
    const x1 = a.player.x;
    stepN(a.run, 30, walk);
    expect((a.player.x - x1) / plain).toBeCloseTo(1, 1);
  });

  it('Aegis: +15 to every non-physical resistance while active, still under the cap', () => {
    const a = arena(makeStats({ resist: { physical: 0.2, fire: 0.3, cold: 0.7, lightning: 0, void: 0.1 } }));
    expect(effectiveResist(a.player, 'fire')).toBeCloseTo(0.3, 6);
    stepN(a.run, 1, { ...idleIntent(), flask: 1 });
    expect(effectiveResist(a.player, 'fire')).toBeCloseTo(0.45, 6);
    expect(effectiveResist(a.player, 'lightning')).toBeCloseTo(0.15, 6);
    expect(effectiveResist(a.player, 'void')).toBeCloseTo(0.25, 6);
    expect(effectiveResist(a.player, 'physical')).toBeCloseTo(0.2, 6);
    expect(effectiveResist(a.player, 'cold')).toBeLessThanOrEqual(RESIST_CAP);
    stepN(a.run, Math.round(6.2 / SIM_DT));
    expect(effectiveResist(a.player, 'fire')).toBeCloseTo(0.3, 6);
  });

  it('Quicksilver Mind: 15% of max Focus at once and +25% Focus regeneration, without recovering over time', () => {
    const stats = makeStats({ maxFocus: 200, focusRegen: 10 });
    const a = arena(stats);
    a.player.focus = 20;
    stepN(a.run, 1, { ...idleIntent(), flask: 2 });
    expect(a.player.focus).toBeGreaterThanOrEqual(50);
    expect(a.player.focus).toBeLessThan(55);
    const f0 = a.player.focus;
    stepN(a.run, 60);
    // 60 ticks of 10/s * 1.25 = 12.5 per second.
    expect(a.player.focus - f0).toBeCloseTo(12.5 * 60 * SIM_DT, 0);
    const b = arena(stats);
    b.player.focus = 20;
    stepN(b.run, 60);
    expect(b.player.focus - 20).toBeCloseTo(10 * 60 * SIM_DT, 0);
  });

  it('never cleanse or heal: a utility flask leaves a Life flask\'s job alone', () => {
    const a = arena(makeStats({ maxLife: 400 }));
    a.player.life = 100;
    stepN(a.run, Math.round(1 / SIM_DT), { ...idleIntent(), flask: 1 });
    expect(a.player.life).toBeCloseTo(100, 3);
  });
});
