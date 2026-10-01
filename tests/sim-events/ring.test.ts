import { describe, expect, it } from 'vitest';
import { eventRun, live, revealed, slay, step, until } from './helpers';
import { RING_GRADE_SECONDS, RING_RADIUS, RING_SLAM_RADIUS, RING_TIMEOUT } from '../../src/data/progression/events/ring';
import { ringGrade } from '../../src/sim/events/ring';
import { spawnMonster } from '../../src/sim/spawn';
import { projSpec, spawnProjectile } from '../../src/sim/projectiles';
import { stepWorld } from '../../src/sim/run';
import type { World } from '../../src/sim/world';

interface RingS {
  center: { x: number; y: number };
  stones: { x: number; y: number; state: number }[];
  vow: number;
  champion: number;
  t: number;
  left: boolean;
  move: { kind: string; area: { duration: number; radius: number; kind: string } } | null;
}

function stand(w: World, e: ReturnType<typeof revealed>, stone: number, who = 0): void {
  const s = (e.s as RingS).stones[stone];
  w.players[who].x = s.x; w.players[who].y = s.y;
}

/** Take a vow and run the warning: the ring is up and the Champion stands. */
function openRing(o: Parameters<typeof eventRun>[1] = {}, vow = 0) {
  const r = eventRun('ring', { wave: 3, vulnerable: true, ...o });
  const e = revealed(r.w, 'ring');
  stand(r.w, e, vow);
  step(r.w, 1.2);
  expect((e.s as RingS).vow).toBe(vow);
  step(r.w, 3.3);
  expect(e.phase).toBe('active');
  return { ...r, e, s: e.s as RingS };
}

const enter = (w: World, s: RingS, who = 0) => { w.players[who].x = s.center.x + 40; w.players[who].y = s.center.y; };

describe("Champion's Ring", () => {
  it('stands three vow stones far from the players and waits (optional, no hostile thing yet)', () => {
    const { w } = eventRun('ring', { wave: 3 });
    const e = revealed(w, 'ring');
    const s = e.s as RingS;
    expect(e.phase).toBe('available');
    expect(s.stones).toHaveLength(3);
    expect(Math.hypot(s.center.x, s.center.y)).toBeGreaterThanOrEqual(280);
    expect(e.view.zones.filter(z => z.kind === 'stone')).toHaveLength(3);
    expect(e.view.zones.some(z => z.kind === 'arena')).toBe(true);
    step(w, 5);
    expect(w.areas.filter(a => a.hurts === 'player')).toHaveLength(0);
  });

  it('a vow is taken by dwelling one second; the warning then runs 3 s and the ring rises with a Champion', () => {
    const { w } = eventRun('ring', { wave: 3 });
    const e = revealed(w, 'ring');
    const s = e.s as RingS;
    stand(w, e, 1);
    step(w, 0.5);
    expect(e.phase).toBe('available');
    expect(e.view.zones.find(z => z.kind === 'stone' && z.n === 1)!.v).toBeGreaterThan(0);
    step(w, 0.7);
    expect(e.phase).toBe('warning');
    expect(s.vow).toBe(1);
    expect(e.view.zones.find(z => z.kind === 'stone' && z.n === 1)!.v).toBe(255);
    expect(e.view.zones.find(z => z.kind === 'stone' && z.n === 0)!.v).toBe(254);
    step(w, 3.1);
    expect(e.phase).toBe('active');
    expect(w.monsters.slotOf(s.champion)).toBeGreaterThanOrEqual(0);
    expect(e.members.has(s.champion)).toBe(true);
  });

  it('in a party the most-occupied stone wins the vow (ties: the longest dwell, then the lowest index)', () => {
    const { w } = eventRun('ring', { wave: 3, players: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }] });
    const e = revealed(w, 'ring');
    const s = e.s as RingS;
    // One player alone starts on stone 0 a little earlier; two stand on stone 2 and win.
    stand(w, e, 0, 0);
    step(w, 0.6);
    stand(w, e, 2, 1); stand(w, e, 2, 2);
    until(w, () => e.phase !== 'available', 3);
    expect(s.vow).toBe(2);
  });

  it('the chain wall pushes the horde out but never a player, and the champion is kept in', () => {
    const { w, s } = openRing();
    const i = spawnMonster(w, 'ashling', s.center.x + 60, s.center.y, { animate: false });
    enter(w, s);
    const px = w.players[0].x;
    step(w, 0.2);
    expect(Math.hypot(w.monsters.x[i] - s.center.x, w.monsters.y[i] - s.center.y)).toBeGreaterThanOrEqual(RING_RADIUS - 6);
    expect(w.players[0].x).toBeCloseTo(px, 0);
    // The champion cannot walk out.
    const c = w.monsters.slotOf(s.champion);
    w.monsters.x[c] = s.center.x + 300; w.monsters.y[c] = s.center.y;
    step(w, 0.1);
    expect(Math.hypot(w.monsters.x[c] - s.center.x, w.monsters.y[c] - s.center.y)).toBeLessThanOrEqual(RING_RADIUS);
    // A player outside is not touched by the wall and may step in and out.
    w.players[0].x = s.center.x + 250; w.players[0].y = s.center.y;
    step(w, 0.2);
    expect(w.players[0].x).toBeGreaterThan(s.center.x + 200);
  });

  it('the champion telegraphs a lane (F1: at least 1.8 s, long) and a slam, alternating, never on a held player', () => {
    const { w, e, s } = openRing();
    enter(w, s);
    expect(until(w, () => w.areas.some(a => a.kind === 'chargeLine' && a.hurts === 'player'), 12)).toBe(true);
    const lane = w.areas.find(a => a.kind === 'chargeLine' && a.owner === s.champion)!;
    expect(lane.duration).toBeGreaterThanOrEqual(1.8);
    expect(s.move?.kind).toBe('lane');
    const mine = (a: { kind: string; owner: number; radius: number }, kind: string) => a.kind === kind && a.owner === s.champion && (kind !== 'slamWarning' || a.radius === RING_SLAM_RADIUS);
    expect(until(w, () => w.areas.some(a => mine(a, 'slamWarning')), 12)).toBe(true);
    const slam = w.areas.find(a => mine(a, 'slamWarning'))!;
    expect(slam.duration).toBeGreaterThanOrEqual(1.0);
    expect(e.view.hint).toBeGreaterThanOrEqual(1);
    // A held player is never the target of a new move.
    until(w, () => s.move === null, 6);
    w.areas.length = 0;
    w.players[0].pullTime = 500; w.players[0].pullTotal = 500; w.players[0].pullFromX = w.players[0].pullToX = w.players[0].x; w.players[0].pullFromY = w.players[0].pullToY = w.players[0].y;
    step(w, 12);
    expect(w.areas.some(a => a.owner === s.champion && (a.kind === 'chargeLine' || (a.kind === 'slamWarning' && a.radius === RING_SLAM_RADIUS)))).toBe(false);
  });

  it('Bare Hands: flasks are refused inside the ring (the press is wasted), allowed outside', () => {
    const { w, run, s } = openRing({}, 0);
    enter(w, s);
    step(w, 0.1);
    expect(w.players[0].noFlasks).toBe(true);
    const before = w.players[0].flasks[0]!.count;
    run.setIntent(1, { moveX: 0, moveY: 0, aimX: 0, aimY: 100, held: [], flask: 0 } as never);
    step(w, 0.1);
    expect(w.players[0].flasks[0]!.count).toBe(before);
    w.players[0].x = s.center.x + 300;
    step(w, 0.1);
    expect(w.players[0].noFlasks).toBe(false);
  });

  it('Iron Pride removes monster projectiles that enter the ring and gives the Champion 40% more life', () => {
    const a = openRing({}, 1);
    const b = openRing({}, 0);
    const life = (r: typeof a) => r.w.monsters.maxLife[r.w.monsters.slotOf(r.s.champion)];
    expect(life(a) / life(b)).toBeCloseTo(1.4, 1);
    const { w, s } = a;
    const pr = spawnProjectile(w, { ...projSpec, hostile: true, x: s.center.x + 100, y: s.center.y, angle: Math.PI, speed: 10, range: 500, radius: 4 });
    expect(w.projectiles.alive[pr]).toBe(1);
    stepWorld(w);
    expect(w.projectiles.alive[pr]).toBe(0);
  });

  it("Crowd's Favour calls spikes over the ring every 6 s, telegraphed at least 1 s", () => {
    const { w, s } = openRing({}, 2);
    enter(w, s);
    expect(until(w, () => w.areas.some(a => a.kind === 'arenaSpikes'), 10)).toBe(true);
    const a = w.areas.find(x => x.kind === 'arenaSpikes')!;
    expect(a.duration).toBeGreaterThanOrEqual(1);
    expect(a.hurts).toBe('player');
    expect(Math.hypot(a.x - s.center.x, a.y - s.center.y)).toBeLessThan(RING_RADIUS);
  });

  it('grades by kill time: Gold within 35 s, Silver within 50 s, otherwise Bronze; the vow is the reward choice', () => {
    expect(ringGrade(RING_GRADE_SECONDS[0])).toBe(3);
    expect(ringGrade(RING_GRADE_SECONDS[0] + 1)).toBe(2);
    expect(ringGrade(RING_GRADE_SECONDS[1] + 1)).toBe(1);
    expect(ringGrade(RING_GRADE_SECONDS[1] + 1, 1.2)).toBe(2);
    const { w, e, s, log } = openRing({}, 2);
    enter(w, s);
    step(w, 10);
    slay(w, s.champion);
    expect(e.phase).toBe('complete');
    expect(e.grade).toBe(3);
    expect(log.eventRolls[0].ctx).toMatchObject({ kind: 'ring', grade: 3, choice: 2 });
    expect(w.players.every(p => !p.noFlasks)).toBe(true);
  });

  it('leaving the ring for 3 s forfeits the vow multiplier (choice 3); walking back does not restore it', () => {
    const { w, e, s, log } = openRing({}, 0);
    w.players[0].x = s.center.x + 400; w.players[0].y = s.center.y;
    step(w, 3.3);
    expect(s.left).toBe(true);
    enter(w, s);
    step(w, 1);
    expect(e.view.hint).toBeGreaterThanOrEqual(1);
    slay(w, s.champion);
    expect(log.eventRolls[0].ctx.choice).toBe(3);
  });

  it('the ring closes after 60 s: the champion joins the horde, nothing pays, flags are cleared', () => {
    const { w, e, s, log } = openRing({}, 0);
    enter(w, s);
    step(w, RING_TIMEOUT + 1);
    expect(e.phase).toBe('failed');
    expect(log.eventRolls).toHaveLength(0);
    expect(e.members.has(s.champion)).toBe(false);
    expect(w.monsters.slotOf(s.champion)).toBeGreaterThanOrEqual(0); // still alive, now ordinary
    expect(w.players[0].noFlasks).toBe(false);
    expect(w.areas.some(a => a.owner === s.champion && a.hurts === 'player')).toBe(false);
  });

  it('the boss wave ends an open ring cleanly; an unopened ring is simply dropped', () => {
    const { w, e } = openRing({}, 1);
    w.director.wave = 6;
    step(w, 0.2);
    expect(e.phase).toBe('failed');
    const r = eventRun('ring', { wave: 3 });
    revealed(r.w, 'ring');
    r.w.director.wave = 6;
    step(r.w, 0.2);
    expect(live(r.w, 'ring')).toBeUndefined();
  });

  it('is deterministic: the same seed and the same play give the same Champion moves', () => {
    const run = () => {
      const r = openRing({}, 0);
      enter(r.w, r.s);
      step(r.w, 12);
      return [r.s.t.toFixed(3), r.w.areas.map(a => `${a.kind}@${Math.round(a.x)},${Math.round(a.y)}`).join('|')].join(';');
    };
    expect(run()).toBe(run());
  });
});
