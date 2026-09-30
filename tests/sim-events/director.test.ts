import { describe, expect, it } from 'vitest';
import { FAULT_GRADE_SECONDS } from '../../src/data/progression/map-events';
import { eventRun, live, revealed, slay, step, until } from './helpers';
import { killMonster, DT_FIRE } from '../../src/sim/combat';
import { digestWorld } from '../../src/sim/digest';
import { crownPending, eventHoldsWaveTell, requiredEventPending } from '../../src/sim/map-events';
import { updateDirector } from '../../src/sim/waves';
import { stepWorld } from '../../src/sim/run';
import { spawnMonster } from '../../src/sim/spawn';
import type { MapEventPlan } from '../../src/contracts/map-events';
import { EVENT_ONSET_GAP } from '../../src/data/progression/map-events';

describe('Event Director v2', () => {
  it('keeps events hidden until their wave, then publishes them in the run view', () => {
    const { w } = eventRun('hunted', { wave: 1, plan: { wave: 3 } });
    step(w, 1);
    expect(w.view.run.events).toHaveLength(0);
    expect(w.mapEvent!.pending).toHaveLength(1);
    w.director.wave = 3;
    step(w, 0.1);
    expect(w.view.run.events).toHaveLength(1);
    expect(w.view.run.events[0]).toBe(w.mapEvent!.live[0].view);
    expect(w.view.run.events[0]).toMatchObject({ kind: 'hunted', phase: 'warning' });
  });

  it('waits for its wave tell to end before revealing', () => {
    const { w } = eventRun('hunted');
    w.director.tellWave = 3;
    step(w, 0.5);
    expect(w.mapEvent!.live).toHaveLength(0);
    w.director.tellWave = 0;
    step(w, 0.1);
    expect(w.mapEvent!.live).toHaveLength(1);
  });

  it('overlays the waves instead of pausing them: the wave clock and the stream keep running through a live event', () => {
    const { w } = eventRun('hunted', { director: true, wave: 1, plan: { wave: 2 } });
    step(w, 0.5); // the director starts wave 1 on its own
    // Jump the clock to wave 2 with the event live.
    until(w, () => w.director.wave >= 2, 90);
    const e = revealed(w, 'hunted');
    expect(e.phase).not.toBe('complete');
    const t0 = w.director.waveTime;
    step(w, 5);
    expect(w.director.waveTime).toBeGreaterThan(t0 + 4.9);
    expect(eventHoldsWaveTell(w)).toBe(false);
    // A wave tell queued during the event ticks down too.
    w.director.tellWave = w.director.wave + 1; w.director.tellTimer = 2;
    step(w, 1);
    expect(w.director.tellTimer).toBeLessThan(1.1);
  });

  it('runs a slate of two concurrently in their own waves', () => {
    const plan: MapEventPlan = { kind: 'hunted', wave: 2, angle: 0.3, also: { kind: 'echoRift', wave: 3, angle: 2, variant: 3 } };
    const { w } = eventRun('hunted', { plan });
    const a = revealed(w, 'hunted');
    expect(w.mapEvent!.live).toHaveLength(1);
    w.director.wave = 3;
    step(w, 0.1);
    const b = live(w, 'echoRift')!;
    expect(b).toBeDefined();
    expect(w.mapEvent!.live).toEqual([a, b]);
    expect(w.view.run.events.map(v => v.kind)).toEqual(['hunted', 'echoRift']);
    expect(a.view.uid).not.toBe(b.view.uid);
  });

  it('never runs more than three events at once', () => {
    const also = (kind: MapEventPlan['kind'], wave: number, next?: MapEventPlan): MapEventPlan => ({ kind, wave, angle: 1, ...(next ? { also: next } : {}) });
    const plan = { ...also('hunted', 2, also('echoRift', 2, also('wound', 2, also('vaultbreakers', 2)))) } as MapEventPlan;
    const { w } = eventRun('hunted', { plan, wave: 3, vulnerable: true });
    step(w, 5);
    expect(w.mapEvent!.live.length).toBeLessThanOrEqual(3);
    expect(w.mapEvent!.pending.length).toBeGreaterThanOrEqual(1);
  });

  it('two events never begin their onset within eight seconds of each other', () => {
    const plan: MapEventPlan = { kind: 'hunted', wave: 2, angle: 0.3, also: { kind: 'wound', wave: 2, angle: 2 } };
    const { w } = eventRun('hunted', { plan, vulnerable: true });
    const a = revealed(w, 'hunted');
    step(w, 0.1);
    const f = live(w, 'wound')!;
    expect(f).toBeDefined();
    // Stand at the crack: it still waits for the gap.
    const s = f.s as { center: { x: number; y: number } };
    w.players[0].x = s.center.x; w.players[0].y = s.center.y;
    step(w, 3);
    expect(f.phase).toBe('available');
    expect(a.phase).not.toBe('available');
    step(w, EVENT_ONSET_GAP);
    expect(f.phase).not.toBe('available');
  });

  it('freezes every event timer while the whole party is down, and resumes with them', () => {
    const { w } = eventRun('hunted', { vulnerable: true });
    const e = revealed(w, 'hunted');
    step(w, 1);
    const t = e.timer, age = e.age;
    const living = w.living;
    w.living = [];
    step(w, 30);
    expect(e.timer).toBe(t);
    expect(e.age).toBe(age);
    w.living = living;
    step(w, 1);
    expect(e.age).toBeGreaterThan(age);
  });

  it('waits for store capacity instead of spawning partially or losing the event', () => {
    const { w } = eventRun('hunted', { vulnerable: true, monsterCapacity: 6 });
    const e = revealed(w, 'hunted');
    const slots: number[] = [];
    while (w.monsters.count < w.monsters.capacity) slots.push(w.monsters.alloc());
    step(w, 5);
    expect(e.phase).toBe('warning');
    expect(e.members.size).toBe(0);
    w.monsters.release(slots[0]);
    step(w, 0.1);
    expect(e.members.size).toBe(1);
  });

  it('pays only credited kills and drops everything when the map clears', () => {
    const { w, log } = eventRun('hunted', { vulnerable: true });
    const e = revealed(w, 'hunted');
    until(w, () => e.phase === 'active', 5);
    const id = [...e.members][0];
    killMonster(w, w.monsters.slotOf(id), DT_FIRE, false);
    expect(log.eventRolls).toHaveLength(0);
    expect(e.phase).toBe('active'); // cleanup kills never pay (and never complete)
    w.director.cleared = true;
    step(w, 0.1);
    expect(w.mapEvent!.live).toHaveLength(0);
    expect(w.mapEvent!.members.size).toBe(0);
  });

  it('a finished event stays on the HUD for five seconds, then leaves', () => {
    const { w } = eventRun('hunted', { vulnerable: true });
    const e = revealed(w, 'hunted');
    until(w, () => e.phase === 'active', 5);
    slay(w, [...e.members][0]);
    expect(e.phase).toBe('complete');
    step(w, 4.5);
    expect(w.mapEvent!.live).toContain(e);
    expect(w.view.run.events[0].phase).toBe('complete');
    step(w, 1);
    expect(w.mapEvent!.live).not.toContain(e);
    expect(w.view.run.events).toHaveLength(0);
  });

  it('runs sealed sequences one after another, and blocks the clear until they are done', () => {
    const plan: MapEventPlan = { kind: 'hunted', wave: 2, angle: 0, required: true,
      next: { kind: 'hunted', wave: 3, angle: 1, required: true, next: { kind: 'hunted', wave: 4, angle: 2, required: true } } };
    const { w } = eventRun('hunted', { plan, vulnerable: true });
    expect(requiredEventPending(w)).toBe(true);
    for (let k = 0; k < 3; k++) {
      w.director.wave = 2 + k;
      const e = revealed(w, 'hunted');
      expect(requiredEventPending(w)).toBe(true);
      until(w, () => e.phase === 'active', 5);
      slay(w, [...e.members][0]);
      step(w, 5.2);
    }
    expect(requiredEventPending(w)).toBe(false);
    expect(w.mapEvent!.results.filter(r => r.kind === 'hunted')).toHaveLength(3);
  });

  it('is deterministic: the same seed and the same inputs give the same digest and the same payouts', () => {
    const run = () => {
      const r = eventRun('hunted', { director: true, wave: 1, plan: { wave: 2 } });
      for (const p of r.w.players) p.invulnTime = 1e9;
      for (let i = 0; i < 60 * 100; i++) {
        stepWorld(r.w);
        const e = live(r.w, 'hunted');
        if (e?.phase === 'active' && i % 600 === 0) for (const id of e.members) slay(r.w, id);
      }
      return r;
    };
    const a = run(), b = run();
    expect(digestWorld(a.w)).toBe(digestWorld(b.w));
    expect(a.log.eventRolls).toEqual(b.log.eventRolls);
    expect(a.w.mapEvent!.results.length).toBeGreaterThan(0);
  });

  it('the digest sees event state', () => {
    const { w } = eventRun('hunted');
    const e = revealed(w, 'hunted');
    const before = digestWorld(w);
    e.tally += 1;
    expect(digestWorld(w)).not.toBe(before);
  });

  it('only keeps a kill log when an Echoing is planned', () => {
    const a = eventRun('hunted');
    const b = eventRun('echoRift');
    for (const r of [a, b]) {
      const i = spawnMonster(r.w, 'ashling', 100, 100, { animate: false });
      slay(r.w, r.w.monsters.id[i]);
    }
    expect(a.w.mapEvent!.killLog).toHaveLength(0);
    expect(b.w.mapEvent!.killLog).toHaveLength(1);
  });

  it('crown pending is false without a crown plan', () => {
    const { w } = eventRun('hunted');
    expect(crownPending(w)).toBe(false);
    void updateDirector;
  });
});

describe('tree lenses in the sim', () => {
  it('Sworn to the Veil: an event still running past its soft timeout fails and pays nothing', () => {
    const { w, log } = eventRun('hunted', { eventModifiers: { timeoutSeconds: 20 }, vulnerable: true });
    const e = revealed(w, 'hunted');
    expect(until(w, () => e.phase === 'active', 5)).toBe(true);
    step(w, 19);
    expect(e.phase).toBe('active');
    step(w, 2);
    expect(e.phase).toBe('failed');
    expect(log.eventRolls).toHaveLength(0);
  });

  it('Sworn to the Veil: the events that run longer by design get a longer soft timeout (Laden Caravan x1.5)', () => {
    const { w } = eventRun('vaultbreakers', { eventModifiers: { timeoutSeconds: 20 }, vulnerable: true });
    const e = revealed(w, 'vaultbreakers');
    expect(until(w, () => e.phase === 'active', 5)).toBe(true);
    step(w, 28);
    expect(e.phase).toBe('active'); // a plain event would have failed at 20 s
    step(w, 3);
    expect(e.phase).toBe('failed');
  });

  it('lens effects change exactly what they name', () => {
    const base = eventRun('hunted');
    const eb = revealed(base.w, 'hunted'); until(base.w, () => eb.phase === 'active', 5);
    const lens = eventRun('hunted', { eventModifiers: { stalkerLife: 1.1 } });
    const el = revealed(lens.w, 'hunted'); until(lens.w, () => el.phase === 'active', 5);
    const life = (r: typeof base, e: typeof eb) => r.w.monsters.maxLife[r.w.monsters.slotOf([...e.members][0])];
    expect(life(lens, el)).toBeCloseTo(life(base, eb) * 1.1, 1);

    const quick = eventRun('vaultbreakers', { eventModifiers: { lockLife: 0.8, caravanSpeed: 1.1 }, vulnerable: true });
    const plain = eventRun('vaultbreakers', { vulnerable: true });
    const eq = revealed(quick.w, 'vaultbreakers'), ep = revealed(plain.w, 'vaultbreakers');
    until(quick.w, () => eq.phase === 'active', 5); until(plain.w, () => ep.phase === 'active', 5);
    const lock = (r: typeof quick, e: typeof eq) => r.w.monsters.maxLife[r.w.monsters.slotOf((e.s as { locks: number[] }).locks[0])];
    expect(lock(quick, eq)).toBeCloseTo(lock(plain, ep) * 0.8, 1);
    step(quick.w, 2); step(plain.w, 2);
    expect((eq.s as { along: number }).along).toBeCloseTo((ep.s as { along: number }).along * 1.1, 1);

    const fault = eventRun('wound', { eventModifiers: { faultPreview: 1, faultMonsterDamage: 1.5 }, vulnerable: true });
    const ef = revealed(fault.w, 'wound');
    const c = (ef.s as { center: { x: number; y: number } }).center;
    fault.w.players[0].x = c.x + 20; fault.w.players[0].y = c.y;
    until(fault.w, () => ef.phase === 'active', 5);
    expect(ef.view.zones.filter(z => z.kind === 'wedgePlan')).toHaveLength(1);
    until(fault.w, () => fault.w.areas.some(a => a.kind === 'faultWedge'), 12);
    expect(fault.w.areas.find(a => a.kind === 'faultWedge')!.damageFrac).toBeCloseTo(0.45);

    const relay = eventRun('blackout', { eventModifiers: { relayBearers: 1, relayWick: 1.5 }, vulnerable: true });
    const er = revealed(relay.w, 'blackout');
    expect(until(relay.w, () => (er.s as { bearers: number[] }).bearers.length === 2, 20)).toBe(true);
    const rs = er.s as { bearers: number[]; ember: { wick: number } | null };
    relay.w.monsters.x[relay.w.monsters.slotOf(rs.bearers[0])] = 10; relay.w.monsters.y[relay.w.monsters.slotOf(rs.bearers[0])] = 0;
    slay(relay.w, rs.bearers[0]);
    expect(rs.ember!.wick).toBeCloseTo(45, 0);
  });

  it('Long Fuse and Quick Study stretch the Fault\'s timed grade', () => {
    const { w } = eventRun('wound', { eventModifiers: { timerScale: 1.1, gradeEase: 0.05 }, vulnerable: true });
    const e = revealed(w, 'wound');
    const c = (e.s as { center: { x: number; y: number } }).center;
    w.players[0].x = c.x + 20; w.players[0].y = c.y;
    until(w, () => e.phase === 'active', 5);
    expect(e.view.timers[0].total).toBeCloseTo(FAULT_GRADE_SECONDS.ashen[0] * 1.1 * 1.05, 5);
  });
});
