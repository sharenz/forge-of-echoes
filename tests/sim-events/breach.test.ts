import { describe, expect, it } from 'vitest';
import { AILMENT_BIT } from '../../src/contracts/sim';
import { damageMonster } from '../../src/sim/combat';
import { spawnMonster } from '../../src/sim/spawn';
import { areaContains, voidTideInner } from '../../src/sim/area-geometry';
import { breachGrade } from '../../src/sim/events/breach';
import { BREACH_SAFE } from '../../src/data/progression/events/void-breach';
import { eventRun, revealed, slay, step, until } from './helpers';

type S = {
  center: { x: number; y: number }; field: number; outer: number; safe: number[]; t: number; step: number; heart: number;
  callers: Set<number>; slain: number; warded: boolean; overflow: boolean; nova: unknown;
};
const sOf = (e: ReturnType<typeof revealed>) => e.s as S;
const tides = (w: ReturnType<typeof eventRun>['w']) => w.areas.filter(a => a.kind === 'voidTide' && !a.dead);

/** Open the breach by walking up to it and run to the first step. */
function open(o: Parameters<typeof eventRun>[1] = {}) {
  const r = eventRun('voidBreach', { vulnerable: true, ...o });
  const e = revealed(r.w, 'voidBreach');
  const s = sOf(e);
  r.w.players[0].x = s.center.x + 30; r.w.players[0].y = s.center.y;
  expect(until(r.w, () => e.phase === 'active', 5)).toBe(true);
  return { ...r, e, s };
}

describe('Void Breach', () => {
  it('is a tear near the arena heart that opens when someone walks up to it (3 s warning) or by itself after 20 s', () => {
    const { w } = eventRun('voidBreach', { vulnerable: true, players: [{ x: 500, y: 300 }] });
    const e = revealed(w, 'voidBreach');
    const s = sOf(e);
    expect(e.phase).toBe('available');
    expect(Math.hypot(s.center.x, s.center.y)).toBeLessThanOrEqual(w.arenaRadius * 0.2);
    expect(e.view.zones[0]).toMatchObject({ kind: 'breach', v: 0 });
    step(w, 10);
    expect(e.phase).toBe('available');
    w.players[0].x = s.center.x + 40; w.players[0].y = s.center.y;
    step(w, 0.2);
    expect(e.phase).toBe('warning');
    expect(tides(w)).toHaveLength(0);
    expect(until(w, () => e.phase === 'active', 4)).toBe(true);
    // Nobody comes: it opens by itself.
    const b = eventRun('voidBreach', { vulnerable: true, players: [{ x: 500, y: 500 }] });
    const eb = revealed(b.w, 'voidBreach');
    expect(until(b.w, () => eb.phase !== 'available', 25)).toBe(true);
    expect(eb.age).toBeGreaterThanOrEqual(20);
  });

  it('opens with a fixture Void Heart and a first tide band that telegraphs at least 1.8 s and hurts everything', () => {
    const { w, s } = open();
    const i = w.monsters.slotOf(s.heart);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(w.monsters.ailments[i] & AILMENT_BIT.fixture).toBe(AILMENT_BIT.fixture);
    const [band] = tides(w);
    expect(band.duration).toBeGreaterThanOrEqual(1.8);
    expect(band.hurts).toBe('all');
    expect(band.radius).toBe(s.outer);
    // The inner edge is never inside the ring the HUD shows.
    expect(voidTideInner(band)).toBeGreaterThanOrEqual(s.field - 1e-6);
    expect(voidTideInner(band)).toBeLessThan(s.field + s.outer / 256 + 1e-6);
  });

  it('shrinks the field in four steps (72%, 50%, 34% of it) and re-fires the band as a fresh telegraph every 6 s', () => {
    const { w, e, s } = open();
    const radii: number[] = [];
    let pulses = 0;
    const seen = new Set<number>();
    for (let k = 0; k < 60 * 46; k++) {
      step(w, 1 / 60);
      for (const a of tides(w)) if (!seen.has(a.id)) { seen.add(a.id); pulses++; expect(a.duration).toBeGreaterThanOrEqual(1.8); }
      const z = e.view.zones.find(q => q.kind === 'tide' && !q.n);
      if (z && radii[radii.length - 1] !== z.r) radii.push(z.r);
    }
    expect(radii).toHaveLength(4);
    BREACH_SAFE.forEach((share, k) => expect(radii[k]).toBeGreaterThanOrEqual(s.field * share - 1e-6));
    BREACH_SAFE.forEach((share, k) => expect(radii[k]).toBeLessThan(s.field * share + s.outer / 256 + 1e-6));
    expect(s.step).toBe(4);
    expect(pulses).toBeGreaterThan(8);
  });

  it('hurts players and monsters inside the band (a hit, a share of life) but not those inside the safe ring', () => {
    const { w, e, s } = open({ players: [{ x: 0, y: 0 }, { x: 0, y: 0 }] });
    w.players[0].x = s.center.x + 40; w.players[0].y = s.center.y;   // safe
    w.players[1].x = s.center.x + s.field + 100; w.players[1].y = s.center.y; // in the band
    w.players[1].x = Math.min(w.players[1].x, w.arenaRadius - 30);
    const before = w.players.map(p => p.life);
    const a = spawnMonster(w, 'ashling', s.center.x + 120, s.center.y, { animate: false });
    const b = spawnMonster(w, 'ashling', s.center.x + s.field + 100, s.center.y - 30, { animate: false });
    w.monsters.life[a] = w.monsters.maxLife[a]; w.monsters.life[b] = w.monsters.maxLife[b];
    w.monsters.damage[a] = 0; w.monsters.damage[b] = 0;
    const band = tides(w)[0];
    expect(areaContains(band, w.players[1].x, w.players[1].y, 3)).toBe(true);
    expect(until(w, () => band.dead, 4)).toBe(true);
    expect(w.players[0].life).toBe(before[0]);
    expect(w.players[1].life).toBeLessThan(before[1]);
    expect(w.monsters.life[a]).toBe(w.monsters.maxLife[a]);
    expect(w.monsters.life[b]).toBeLessThan(w.monsters.maxLife[b] * 0.8);
    void e;
  });

  it('warns one Voidcaller per step on a ground mark, a rare that keeps clear of the players, and wards the Heart until all three fall', () => {
    const { w, e, s } = open({ players: [{ x: 0, y: 0 }] });
    w.players[0].x = s.center.x; w.players[0].y = s.center.y;
    expect(s.warded).toBe(true);
    expect(until(w, () => w.areas.some(a => a.kind === 'echoMark'), 16)).toBe(true);
    expect(s.callers.size).toBe(0);
    expect(until(w, () => s.callers.size === 1, 3)).toBe(true);
    const c = w.monsters.slotOf([...s.callers][0]);
    expect(w.monsters.rarity[c]).toBe(2);
    expect(Math.hypot(w.monsters.x[c] - w.players[0].x, w.monsters.y[c] - w.players[0].y)).toBeGreaterThanOrEqual(250 - 1);
    // The ward: the Heart takes no damage.
    const h = w.monsters.slotOf(s.heart);
    const life = w.monsters.life[h];
    damageMonster(w, h, 100, 1, 0, 1.5, 0, 0, 0, 0, true, 1);
    expect(w.monsters.life[h]).toBe(life);
    expect(w.monsters.ailments[h] & AILMENT_BIT.shielded).toBe(AILMENT_BIT.shielded);
    // Three Voidcallers (one per step) must fall.
    const slain: number[] = [];
    until(w, () => { for (const id of [...s.callers]) { slay(w, id); slain.push(id); } return s.slain >= 3; }, 60);
    expect(s.slain).toBe(3);
    expect(s.warded).toBe(false);
    damageMonster(w, h, 100, 1, 0, 1.5, 0, 0, 0, 0, true, 1);
    expect(w.monsters.life[h]).toBeLessThan(life);
    step(w, 0.05);
    expect(e.view.hint).toBe(3);
  });

  it('with the ward down the Heart fires a telegraphed nova (>= 1.8 s) at the nearest player, never on a held one', () => {
    const { w, s } = open();
    until(w, () => { for (const id of [...s.callers]) slay(w, id); return s.slain >= 3; }, 60);
    w.players[0].x = s.center.x + 60; w.players[0].y = s.center.y;
    expect(until(w, () => w.areas.some(a => a.kind === 'slamWarning' && a.radius === 70), 12)).toBe(true);
    const nova = w.areas.find(a => a.kind === 'slamWarning' && a.radius === 70)!;
    expect(nova.duration).toBeGreaterThanOrEqual(1.8);
    expect(Math.hypot(nova.x - w.players[0].x, nova.y - w.players[0].y)).toBeLessThan(1);
  });

  it('grades by seal time from the opening: Gold <= 56 s, Silver <= 80 s, Bronze after; overflow is Bronze at best', () => {
    expect(breachGrade(50)).toBe(3);
    expect(breachGrade(70)).toBe(2);
    expect(breachGrade(90)).toBe(1);
    expect(breachGrade(40, 0, 1, true)).toBe(1);
    expect(breachGrade(60, 0, 1.1)).toBe(3);
    expect(breachGrade(60, 5)).toBe(3);
  });

  it('breaking the Heart seals it: Gold pays through rollEventReward with the strength in the choice', () => {
    const { w, e, s, log } = open({ eventModifiers: { voidStrength: 50 } });
    until(w, () => { for (const id of [...s.callers]) slay(w, id); return s.slain >= 3; }, 60);
    expect(s.t).toBeLessThan(56);
    w.players[0].x = s.center.x + 30; w.players[0].y = s.center.y;
    slay(w, s.heart);
    step(w, 0.1);
    expect(e.phase).toBe('complete');
    expect(e.grade).toBe(3);
    expect(log.eventRolls).toHaveLength(1);
    expect(log.eventRolls[0].ctx).toMatchObject({ kind: 'voidBreach', grade: 3, choice: 50 });
    // The tide is gone.
    expect(tides(w)).toHaveLength(0);
  });

  it('overflows after 130 s: surges of monsters, a faster tide, Bronze at best', () => {
    const { w, e, s } = open();
    w.players[0].x = s.center.x; w.players[0].y = s.center.y;
    step(w, 131);
    expect(s.overflow).toBe(true);
    expect(e.view.hint).toBe(4);
    until(w, () => { for (const id of [...s.callers]) slay(w, id); return s.slain >= 3; }, 5);
    slay(w, s.heart);
    step(w, 0.1);
    expect(e.phase).toBe('complete');
    expect(e.grade).toBe(1);
  });

  it('scales the tide with the Voidtouched Atlas strength', () => {
    const base = open().w;
    const strong = open({ eventModifiers: { voidStrength: 50 } }).w;
    const a = tides(base)[0], b = tides(strong)[0];
    expect(b.damage / a.damage).toBeCloseTo(1.5, 5);
  });

  it('is deterministic and cancel-safe', () => {
    const run = () => {
      const { w, s } = open({ theme: 'rimedOssuary' });
      step(w, 20);
      return [s.step, w.areas.map(a => a.id).join(','), w.monsters.count, w.mapEvent!.rng.next()];
    };
    expect(run()).toEqual(run());
    const { w, e, s } = open();
    expect(w.monsters.slotOf(s.heart)).toBeGreaterThanOrEqual(0);
    w.director.cleared = true;
    step(w, 0.2);
    expect(w.mapEvent!.live.includes(e)).toBe(false);
    expect(w.monsters.slotOf(s.heart)).toBe(-1);
    expect(tides(w)).toHaveLength(0);
  });
});
