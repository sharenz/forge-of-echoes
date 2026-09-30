import { describe, expect, it } from 'vitest';
import { eventRun, revealed, slay, step, until } from './helpers';
import { MFLAG } from '../../src/sim/stores';
import { caravanGrade } from '../../src/sim/events/caravan';
import { isHittable } from '../../src/sim/combat';
import { KIND_BY_INDEX } from '../../src/sim/archetypes';

type CaravanS = {
  road: { x: number; y: number }[]; length: number; along: number; wagon: number; locks: number[]; broken: boolean[];
  escorts: Map<number, number>; reinforced: boolean; gone: boolean;
  groups: Set<number>[]; wheels: number[]; wheelsBroken: number; shielded: boolean[];
};

function launch(o: Parameters<typeof eventRun>[1] = {}) {
  const r = eventRun('vaultbreakers', { vulnerable: true, ...o });
  const e = revealed(r.w, 'vaultbreakers');
  expect(until(r.w, () => e.phase === 'active', 5)).toBe(true);
  return { ...r, e, s: e.s as CaravanS };
}

describe('The Laden Caravan', () => {
  it('draws a road across the arena, with a warning before the wagon appears at the far rim', () => {
    const { w } = eventRun('vaultbreakers', { vulnerable: true });
    const e = revealed(w, 'vaultbreakers');
    const s = e.s as CaravanS;
    expect(e.phase).toBe('warning');
    expect(w.monsters.count).toBe(0);
    expect(s.road).toHaveLength(3);
    expect(new Set(s.road.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)).size).toBe(3); // three distinct points
    expect(s.length).toBeGreaterThan(w.arenaRadius);
    expect(e.view.zones.filter(z => z.kind === 'road')).toHaveLength(3);
    expect(Math.hypot(s.road[0].x, s.road[0].y)).toBeGreaterThan(w.arenaRadius * 0.85);
  });

  it('the wagon is invulnerable and moves at 22 u/s under an escort of eight, locks riding on it', () => {
    const { w, s } = launch();
    const m = w.monsters;
    const wi = m.slotOf(s.wagon);
    expect(m.flags[wi] & MFLAG.immune).toBe(MFLAG.immune);
    expect(s.escorts.size).toBe(8);
    expect(s.locks.filter(Boolean)).toHaveLength(3);
    const x0 = m.x[wi], y0 = m.y[wi];
    step(w, 2);
    expect(Math.hypot(m.x[wi] - x0, m.y[wi] - y0)).toBeGreaterThan(40);
    expect(Math.hypot(m.x[wi] - x0, m.y[wi] - y0)).toBeLessThan(46);
    // Locks ride on the wagon.
    const li = m.slotOf(s.locks[0]);
    expect(Math.hypot(m.x[li] - m.x[wi], m.y[li] - m.y[wi])).toBeLessThan(40);
  });

  it('a trample lane is telegraphed ahead of the wagon for at least a second before it hurts', () => {
    const { w } = launch();
    step(w, 0.2);
    const lane = w.areas.find(a => a.kind === 'chargeLine')!;
    expect(lane).toBeDefined();
    expect(lane.radius).toBe(250);
    expect(lane.duration).toBeGreaterThanOrEqual(1);
    expect(lane.hurts).toBe('player');
  });

  it('each lock broken pays its own prize at once; all three pay the bonus and Gold', () => {
    const { w, log, e, s } = launch();
    slay(w, s.locks[1]);
    expect(log.eventRolls).toHaveLength(1);
    expect(log.eventRolls[0].ctx).toMatchObject({ kind: 'vaultbreakers', choice: 1, grade: 1 });
    expect(e.phase).toBe('active');
    slay(w, s.locks[0]);
    slay(w, s.locks[2]);
    expect(log.eventRolls.map(r => r.ctx.choice)).toEqual([1, 0, 2, 3]);
    expect(e.phase).toBe('complete');
    expect(e.grade).toBe(3);
    // The wagon rolls off empty: no loot, and the event pays no more.
    expect(w.monsters.slotOf(s.wagon)).toBeLessThan(0);
    step(w, 5);
    expect(log.eventRolls).toHaveLength(4);
  });

  it('reinforcements drop from the rim at 45% of the route, after a shimmer', () => {
    const { w, s } = launch();
    const before = w.monsters.count;
    s.along = s.length * 0.45;
    step(w, 0.1);
    expect(s.reinforced).toBe(true);
    expect(w.areas.some(a => a.kind === 'echoMark')).toBe(true);
    expect(w.monsters.count).toBe(before + 4);
  });

  it('escorts hold formation until a player is near, then fight', () => {
    const { w, s } = launch();
    const m = w.monsters;
    const [id] = [...s.escorts.keys()];
    const i = m.slotOf(id);
    step(w, 3);
    expect(s.escorts.has(id)).toBe(true);
    w.players[0].x = m.x[i] + 60; w.players[0].y = m.y[i];
    step(w, 0.1);
    expect(s.escorts.has(id)).toBe(false);
  });

  it('the wagon leaves at the far rim with its unbroken locks: the grade is the locks broken, paid at each break', () => {
    const { w, log, e, s } = launch();
    slay(w, s.locks[0]);
    s.along = s.length - 1;
    step(w, 0.2);
    expect(s.gone).toBe(true);
    expect(e.phase).toBe('complete');
    expect(e.grade).toBe(1);
    expect(log.eventRolls).toHaveLength(1); // only the break paid
    expect(w.monsters.slotOf(s.wagon)).toBeLessThan(0);
    expect(s.locks.every(id => id === 0)).toBe(true);
  });

  it('a wagon that escapes with every lock is a failure and pays nothing', () => {
    const { w, log, e, s } = launch();
    s.along = s.length - 1;
    step(w, 0.2);
    expect(e.phase).toBe('failed');
    expect(log.eventRolls).toHaveLength(0);
  });

  it('the sealed Gilded Vault doubles the escort; Teeming adds more', () => {
    const sealed = launch({ plan: { required: true } });
    expect(sealed.s.escorts.size).toBe(16);
    const teeming = launch({ eventModifiers: { monsterCount: 1.5 } });
    expect(teeming.s.escorts.size).toBe(12);
    expect(caravanGrade(2)).toBe(2);
  });

  it('two wheel hardpoints ride the axle: each broken one slows the wagon 30% (stacking), pays nothing and is not a prize', () => {
    const { w, log, e, s } = launch();
    const m = w.monsters;
    expect(s.wheels.filter(Boolean)).toHaveLength(2);
    const wi = m.slotOf(s.wheels[0]);
    expect(m.flags[wi] & MFLAG.fixture).toBe(MFLAG.fixture);
    const rate = () => { const a = s.along; step(w, 1); return s.along - a; };
    const base = rate();
    expect(base).toBeCloseTo(22, 0);
    slay(w, s.wheels[0]);
    expect(s.wheelsBroken).toBe(1);
    expect(rate()).toBeCloseTo(22 * 0.7, 0);
    slay(w, s.wheels[1]);
    expect(rate()).toBeCloseTo(22 * 0.49, 0);
    expect(log.eventRolls).toHaveLength(0);
    expect(e.tally).toBe(0);
    expect(e.view.markers.filter(k => k.icon === 'wheel')).toHaveLength(0);
  });

  it('the shield line: a lock is invulnerable while more than one of its escort group lives; killing the group opens it', () => {
    const { w, s, run } = launch();
    const m = w.monsters;
    const lock = 0;
    const li = () => m.slotOf(s.locks[lock]);
    step(w, 0.7); // the spawn shimmer
    expect(m.flags[li()] & MFLAG.immune).toBe(MFLAG.immune);
    expect(isHittable(w, li())).toBe(false);
    expect(s.groups[0].size).toBe(3);
    // The other groups do not matter: killing the right column leaves lock 0 shielded.
    for (const id of [...s.groups[1]]) slay(w, id, true);
    step(w, 0.1);
    expect(isHittable(w, li())).toBe(false);
    const [a, b] = [...s.groups[0]];
    slay(w, a);
    step(w, 0.1);
    expect(isHittable(w, li())).toBe(false); // two left: still shielded
    run.drainEvents();
    slay(w, b);
    step(w, 0.1);
    expect(run.drainEvents().some(ev => ev.t === 'mapEvent' && ev.beat === 'crack' && ev.n === 1)).toBe(true);
    expect(s.shielded[0]).toBe(false);
    expect(isHittable(w, li())).toBe(true);
    // The marker says so: open (w 0), no shield marker for it.
    const view = launchView(w);
    expect(view.markers.find(k => k.icon === 'lock' && k.v === 0)!.w).toBe(0);
    expect(view.markers.some(k => k.icon === 'shield' && k.v === 0)).toBe(false);
    expect(view.markers.some(k => k.icon === 'shield' && k.v === 2)).toBe(true);
  });

  it('the trample lane knocks a player caught in it sideways out of the lane', () => {
    const { w, s } = launch({ vulnerable: true });
    step(w, 0.1);
    const lane = w.areas.find(a => a.kind === 'chargeLine')!;
    const ux = Math.cos(lane.angle), uy = Math.sin(lane.angle);
    const p = w.players[0];
    p.x = lane.x + ux * 120; p.y = lane.y + uy * 120;
    const side = (x: number, y: number) => Math.abs((x - lane.x) * -uy + (y - lane.y) * ux);
    expect(side(p.x, p.y)).toBeLessThan(2);
    expect(until(w, () => lane.dead, 3)).toBe(true);
    step(w, 0.6);
    expect(side(p.x, p.y)).toBeGreaterThan(40);
    void s;
  });

  it('Ashen: a broken crucible spills a fire pool that waits a second before it burns; Ossuary: the Reliquary lock releases a Rimeshade', () => {
    const ash = launch({ theme: 'ashenForge' });
    const before = ash.w.areas.filter(a => a.kind === 'firePool').length;
    slay(ash.w, ash.s.locks[0]);
    const pool = ash.w.areas.filter(a => a.kind === 'firePool');
    expect(pool.length).toBe(before + 1);
    expect(pool.at(-1)!.tickTimer).toBeGreaterThanOrEqual(1);
    const bone = launch({ theme: 'rimedOssuary', arenaRadius: 650 });
    const n = bone.w.monsters.count;
    slay(bone.w, bone.s.locks[0]);
    expect(bone.w.monsters.count).toBe(n - 1);
    slay(bone.w, bone.s.locks[1]);
    const m = bone.w.monsters;
    const shades = [...bone.e.members].filter(id => m.slotOf(id) >= 0 && KIND_BY_INDEX[m.kind[m.slotOf(id)]] === 'rimeshade');
    expect(shades.length).toBeGreaterThan(0);
  });
});

/** The current view markers of the live caravan (a fresh tick first). */
function launchView(w: ReturnType<typeof launch>['w']) {
  step(w, 0.02);
  return w.mapEvent!.live[0].view;
}
