import { describe, expect, it } from 'vitest';
import { eventRun, live, revealed, slay, step, until } from './helpers';
import { HOST_GRADE_SECONDS, HOST_SHOCK_SECONDS, HOST_STATUES } from '../../src/data/progression/events/host';
import { damageMonster, isHittable } from '../../src/sim/combat';
import { hostGrade } from '../../src/sim/events/host';
import { nearestLivingDist } from '../../src/sim/events/kit';
import { MFLAG } from '../../src/sim/stores';
import type { World } from '../../src/sim/world';

interface HostS { prism: number; order: number[]; alive: Set<number>; total: number; thawed: number; bar: number; t: number; shattered: boolean; shock: number }

const open = (o: Parameters<typeof eventRun>[1] = {}) => {
  const r = eventRun('host', { wave: 3, vulnerable: true, ...o });
  const e = revealed(r.w, 'host');
  return { ...r, e, s: e.s as HostS };
};
const active = (o: Parameters<typeof eventRun>[1] = {}) => { const r = open(o); step(r.w, 3.1); expect(r.e.phase).toBe('active'); return r; };
const frozen = (w: World, id: number) => (w.monsters.flags[w.monsters.slotOf(id)] & MFLAG.frozen) !== 0;
/** Keep the horde out of the way: nothing else lives on this map, statues are the only monsters. */

describe('Stasis Host', () => {
  it('stands a Time Prism and 24 frozen statues far from the players; the statues belong to the event', () => {
    const { w, e, s } = open();
    expect(e.phase).toBe('warning');
    expect(s.total).toBe(HOST_STATUES);
    expect(s.order).toHaveLength(HOST_STATUES);
    expect(e.members.size).toBe(HOST_STATUES + 1);
    for (const id of s.order) {
      const i = w.monsters.slotOf(id);
      expect(frozen(w, id)).toBe(true);
      // F4: a statue never starts within 250 u of a living player.
      expect(nearestLivingDist(w, w.monsters.x[i], w.monsters.y[i]), 'statue clearance').toBeGreaterThanOrEqual(249);
    }
    const prism = w.monsters.slotOf(s.prism);
    expect(w.monsters.flags[prism] & MFLAG.fixture).toBeTruthy();
    expect(e.view.markers.some(m => m.icon === 'prism')).toBe(true);
  });

  it('frozen statues are invulnerable and inert until thawed', () => {
    const { w, s } = active();
    const id = s.order[s.order.length - 1];
    const i = w.monsters.slotOf(id);
    const x = w.monsters.x[i], y = w.monsters.y[i];
    expect(isHittable(w, i)).toBe(false);
    const life = w.monsters.life[i];
    expect(damageMonster(w, i, 1e6, 0, 0, 1.5, 0, 1, 0, 0, true, 1)).toBe(false);
    w.players[0].x = x - 30; w.players[0].y = y;
    step(w, 2);
    expect(w.monsters.life[i]).toBe(life);
    expect(w.monsters.x[i]).toBe(x);
    expect(w.monsters.y[i]).toBe(y);
    expect(w.players[0].life).toBe(w.players[0].stats.maxLife);
  });

  it('the thaw bar fills with time (1% per second) and with kills (1.5% each); every 100/24 percent wakes the next statue in order', () => {
    const { w, e, s } = active();
    step(w, 8.5);
    expect(s.bar).toBeCloseTo(8.5, 0);
    expect(s.thawed).toBe(2);
    expect(frozen(w, s.order[0])).toBe(false);
    expect(frozen(w, s.order[1])).toBe(false);
    expect(frozen(w, s.order[2])).toBe(true);
    const before = s.bar;
    slay(w, s.order[0]);
    step(w, 0.05);
    expect(s.bar - before).toBeGreaterThanOrEqual(1.5);
    expect(e.view.objectives[0]).toMatchObject({ id: 0, max: 100 });
    expect(e.view.objectives[1]).toMatchObject({ id: 1, max: HOST_STATUES });
    expect(e.view.timers[0]).toMatchObject({ id: 0, total: HOST_GRADE_SECONDS[0] });
  });

  it('every statue drops as a monster of its rarity with +60% quantity', () => {
    const { w, s, log } = active();
    step(w, 5);
    slay(w, s.order[0]);
    expect(log.killRolls.at(-1)!.ctx.quantityMore).toBe(60);
  });

  it('shattering the prism telegraphs a shockwave (F1) and then thaws every remaining statue at once; it pays double', () => {
    const { w, e, s, log } = active();
    slay(w, s.prism);
    expect(s.shattered).toBe(true);
    const shock = w.areas.find(a => a.kind === 'slamWarning' && a.radius > 100)!;
    expect(shock.duration).toBeGreaterThanOrEqual(1.8);
    expect(shock.hurts).toBe('player');
    expect(s.thawed).toBeLessThan(HOST_STATUES);
    step(w, HOST_SHOCK_SECONDS + 0.2);
    expect(s.thawed).toBe(HOST_STATUES);
    expect(w.monsters.slotOf(s.prism)).toBeLessThan(0);
    for (const id of s.order) slay(w, id);
    expect(e.phase).toBe('complete');
    expect(log.eventRolls[0].ctx).toMatchObject({ kind: 'host', choice: 1, grade: 3 });
  });

  it('grades by the time to the last statue: Gold 31 s, Silver 90 s, else Bronze; killing all without the prism pays choice 0', () => {
    expect(hostGrade(HOST_GRADE_SECONDS[0])).toBe(3);
    expect(hostGrade(HOST_GRADE_SECONDS[0] + 1)).toBe(2);
    expect(hostGrade(91)).toBe(1);
    const { w, e, s, log } = active();
    step(w, 100);
    expect(s.bar).toBeGreaterThanOrEqual(100);
    expect(s.thawed).toBe(HOST_STATUES);
    for (const id of s.order) slay(w, id);
    expect(e.phase).toBe('complete');
    expect(e.grade).toBe(1);
    expect(log.eventRolls[0].ctx).toMatchObject({ choice: 0, grade: 1 });
    expect(w.monsters.slotOf(s.prism)).toBeLessThan(0); // the unbroken prism is taken away
  });

  it('waits for room: nothing spawns partially when the store cannot hold the host (F5)', () => {
    const { w } = eventRun('host', { wave: 3, monsterCapacity: 16 });
    step(w, 1);
    expect(live(w, 'host')).toBeUndefined();
    expect(w.monsters.count).toBe(0);
  });

  it('the boss wave releases whatever is left into the horde: Bronze from 75% fallen, otherwise nothing; no prism or frozen statue lingers', () => {
    const a = active();
    a.w.director.wave = 6;
    step(a.w, 0.2);
    expect(a.e.phase).toBe('failed');
    expect(a.log.eventRolls).toHaveLength(0);
    expect([...a.s.alive].every(id => a.w.monsters.slotOf(id) < 0 || !frozen(a.w, id))).toBe(true);
    expect(a.w.monsters.slotOf(a.s.prism)).toBeLessThan(0);
    const b = active();
    step(b.w, 100);
    for (const id of b.s.order.slice(0, 19)) slay(b.w, id);
    b.w.director.wave = 6;
    step(b.w, 0.2);
    expect(b.e.phase).toBe('complete');
    expect(b.e.grade).toBe(1);
  });

  it('cancelling (the map is won) removes the prism and every frozen statue', () => {
    const { w, s } = active();
    step(w, 6);
    w.director.cleared = true;
    step(w, 0.1);
    expect(live(w, 'host')).toBeUndefined();
    for (const id of s.order) {
      const i = w.monsters.slotOf(id);
      if (i >= 0) expect(frozen(w, id)).toBe(false);
    }
    expect(w.monsters.slotOf(s.prism)).toBeLessThan(0);
  });

  it('Thaw Warden: a 15% larger host that thaws 20% slower', () => {
    const { s } = active({ eventModifiers: { hostCount: 1.15, thawRate: 0.8 } } as never);
    expect(s.total).toBe(Math.round(HOST_STATUES * 1.15));
  });

  it('is deterministic', () => {
    const run = () => {
      const { w, s } = active();
      step(w, 20);
      return [s.bar.toFixed(3), s.thawed, [...w.monsters.x.slice(0, 40)].map(x => x.toFixed(2)).join(',')].join(';');
    };
    expect(run()).toBe(run());
  });
});
