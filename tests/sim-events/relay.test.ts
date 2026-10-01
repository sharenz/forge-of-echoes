import { describe, expect, it } from 'vitest';
import { eventRun, revealed, slay, step, until } from './helpers';
import { hitPlayer } from '../../src/sim/combat';
import { spawnMonster } from '../../src/sim/spawn';
import { relayGrade } from '../../src/sim/events/relay';
import { RELAY_CARRY_SLOW, RELAY_GOLD_SECONDS } from '../../src/data/progression/map-events';

type RelayS = {
  braziers: { x: number; y: number; lit: boolean; progress: number }[]; lit: number; lost: number; bearers: number[];
  ember: { x: number; y: number; carrier: number; wick: number } | null;
};

/** Run to the first Wickbearer and kill it: the Ember drops where it fell. */
function firstEmber(w: ReturnType<typeof eventRun>['w'], e: ReturnType<typeof revealed>): RelayS {
  const s = e.s as RelayS;
  expect(until(w, () => s.bearers.length > 0, 20)).toBe(true);
  const i = w.monsters.slotOf(s.bearers[0]);
  w.monsters.x[i] = 10; w.monsters.y[i] = 0;
  slay(w, s.bearers[0]);
  return s;
}

describe('Ember Relay', () => {
  it('stands three cold braziers at least 300 u apart, with a 3 s warning and a dimmed floor', () => {
    const { w } = eventRun('blackout');
    const e = revealed(w, 'blackout');
    const s = e.s as RelayS;
    expect(e.phase).toBe('warning');
    expect(s.braziers).toHaveLength(3);
    for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) {
      expect(Math.hypot(s.braziers[a].x - s.braziers[b].x, s.braziers[a].y - s.braziers[b].y)).toBeGreaterThanOrEqual(295);
    }
    expect(e.view.zones.filter(z => z.kind === 'brazier')).toHaveLength(3);
    step(w, 3.1);
    expect(e.phase).toBe('active');
  });

  it('a Wickbearer arrives far from the players; killing it drops the Ember, which a player picks up and carries', () => {
    const { w } = eventRun('blackout', { vulnerable: true });
    const e = revealed(w, 'blackout');
    const s = firstEmber(w, e);
    expect(s.ember).toMatchObject({ carrier: 0 });
    step(w, 0.1);
    expect(s.ember!.carrier).toBe(1);
    expect(e.view.markers[0].icon).toBe('ember');
    expect(e.view.timers[0]).toMatchObject({ id: 0, total: 30 });
  });

  it('the wick burns down, every hit taken shortens it, and a dead wick loses the Ember', () => {
    const { w } = eventRun('blackout', { vulnerable: true });
    const e = revealed(w, 'blackout');
    const s = firstEmber(w, e);
    step(w, 1);
    const before = s.ember!.wick;
    expect(before).toBeLessThan(30);
    hitPlayer(w, w.players[0], 10, 0, 'area');
    expect(s.ember!.wick).toBeCloseTo(before - 2, 1);
    expect(until(w, () => s.lost === 1, 40)).toBe(true);
    expect(s.ember).toBeNull();
    expect(e.view.hint).toBeDefined();
    // A new bearer comes for the next Ember.
    expect(until(w, () => s.bearers.length > 0, 20)).toBe(true);
  });

  it('dwelling two seconds at a dark brazier with the Ember lights it; three lit with no losses is Gold', () => {
    const { w, log } = eventRun('blackout', { vulnerable: true });
    const e = revealed(w, 'blackout');
    const s = e.s as RelayS;
    for (let k = 0; k < 3; k++) {
      expect(until(w, () => s.bearers.length > 0, 30)).toBe(true);
      const i = w.monsters.slotOf(s.bearers[0]);
      w.monsters.x[i] = w.players[0].x + 5; w.monsters.y[i] = w.players[0].y;
      slay(w, s.bearers[0]);
      step(w, 0.1);
      expect(s.ember!.carrier).toBe(1);
      const b = s.braziers.find(q => !q.lit)!;
      w.players[0].x = b.x + 10; w.players[0].y = b.y;
      step(w, 1);
      expect(b.lit).toBe(false);
      step(w, 1.2);
      expect(b.lit).toBe(true);
      expect(s.lit).toBe(k + 1);
      expect(s.ember).toBeNull();
    }
    expect(e.phase).toBe('complete');
    expect(e.grade).toBe(3);
    expect(log.eventRolls).toHaveLength(1);
    expect(log.eventRolls[0].ctx).toMatchObject({ kind: 'blackout', grade: 3, tally: 3 });
  });

  it('grades: 3 lit with 0 lost Gold, one lost Silver, more Bronze; two lit at the end Bronze, fewer nothing', () => {
    expect(relayGrade(3, 0)).toBe(3);
    expect(relayGrade(3, 0, RELAY_GOLD_SECONDS)).toBe(3);
    expect(relayGrade(3, 0, RELAY_GOLD_SECONDS + 1)).toBe(2); // a clean run that is too slow is Silver
    expect(relayGrade(3, 0, RELAY_GOLD_SECONDS + 1, 1.1)).toBe(3); // Long Fuse stretches the pace
    expect(relayGrade(3, 1)).toBe(2);
    expect(relayGrade(3, 2)).toBe(1);
    expect(relayGrade(2, 3)).toBe(1);
    expect(relayGrade(1, 3)).toBe(0);
  });

  it('three lost Embers end the event', () => {
    const { w, log } = eventRun('blackout', { vulnerable: true });
    const e = revealed(w, 'blackout');
    const s = e.s as RelayS;
    for (let k = 0; k < 3; k++) {
      expect(until(w, () => s.bearers.length > 0, 30)).toBe(true);
      const i = w.monsters.slotOf(s.bearers[0]);
      w.monsters.x[i] = w.players[0].x + 5; w.monsters.y[i] = w.players[0].y;
      slay(w, s.bearers[0]);
      step(w, 0.1);
      s.ember!.wick = 0.05;
      step(w, 0.2);
    }
    expect(s.lost).toBe(3);
    expect(e.phase).toBe('failed');
    expect(log.eventRolls).toHaveLength(0);
  });

  it('shrouded monsters near the carrier run faster; lit ground is safe from it', () => {
    const { w } = eventRun('blackout', { vulnerable: true });
    const e = revealed(w, 'blackout');
    const s = firstEmber(w, e);
    step(w, 0.1);
    expect(s.ember!.carrier).toBe(1);
    const near = spawnMonster(w, 'ashling', 100, 0, { animate: false });
    step(w, 0.2);
    expect(w.monsters.hasteTime[near]).toBeGreaterThan(0);
    const far = spawnMonster(w, 'ashling', 700, 0, { animate: false });
    step(w, 0.2);
    expect(w.monsters.hasteTime[far]).toBe(0);
  });

  it('the carrier moves 12% slower (only the carrier) until the Ember is lit, lost or the event is dropped', () => {
    const { w } = eventRun('blackout', { vulnerable: true, players: [{ x: 0, y: 0 }, { x: 40, y: 40 }] });
    const e = revealed(w, 'blackout');
    const s = firstEmber(w, e);
    step(w, 0.2);
    expect(s.ember!.carrier).toBeGreaterThan(0);
    const carrier = w.playerById[s.ember!.carrier]!, other = w.players.find(p => p !== carrier)!;
    expect(carrier.eventSlow).toBe(RELAY_CARRY_SLOW);
    expect(other.eventSlow).toBe(0);
    expect(carrier.view.eventSlow).toBe(RELAY_CARRY_SLOW); // what the wire carries
    // The carrier really is slower: same input, same time, 12% less ground.
    const walk = (p: typeof carrier) => { const x0 = p.x; p.intent.moveX = 1; p.intent.moveY = 0; step(w, 0.5); p.intent.moveX = 0; return p.x - x0; };
    carrier.x = -200; other.x = -200; carrier.y = 0; other.y = 80;
    const slow = walk(carrier), fast = walk(other);
    expect(slow / fast).toBeCloseTo(1 - RELAY_CARRY_SLOW, 1);
    // Lost Ember: the slow is gone at once.
    s.ember!.wick = 0.01;
    step(w, 0.2);
    expect(s.lost).toBe(1);
    expect(w.players.every(p => p.eventSlow === 0)).toBe(true);
  });

  it('dropping the event (map cleared) frees the carrier', () => {
    const { w } = eventRun('blackout', { vulnerable: true });
    const e = revealed(w, 'blackout');
    const s = firstEmber(w, e);
    step(w, 0.2);
    expect(w.players[0].eventSlow).toBeGreaterThan(0);
    w.director.cleared = true;
    step(w, 0.1);
    expect(w.players[0].eventSlow).toBe(0);
    void s;
  });
});
