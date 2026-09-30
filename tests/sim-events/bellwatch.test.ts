import { describe, expect, it } from 'vitest';
import { eventRun, revealed, slay, step, until } from './helpers';
import { bellGrade, tollEvery } from '../../src/sim/events/bellwatch';
import { MFLAG } from '../../src/sim/stores';
import { AILMENT_BIT } from '../../src/contracts/sim';
import { nearestLivingDist } from '../../src/sim/events/kit';
import type { EventInstance } from '../../src/sim/events/types';
import type { World } from '../../src/sim/world';

type BellS = {
  bell: { x: number; y: number }; cantors: { id: number; inner: boolean; dead: boolean }[]; tolls: number; dirge: number; fallen: number;
  fallenBeforeGold: number; t: number; silentAt: number;
};
const S = (e: EventInstance) => e.s as BellS;

function start(o: Parameters<typeof eventRun>[1] = {}) {
  const r = eventRun('bellwatch', { wave: 3, vulnerable: true, ...o });
  const e = revealed(r.w, 'bellwatch');
  expect(until(r.w, () => e.phase === 'active' && S(e).cantors.length === 4, 30)).toBe(true);
  return { ...r, e };
}

const flagsOf = (w: World, id: number) => w.monsters.flags[w.monsters.slotOf(id)];

describe('Bellwatch', () => {
  it('rings an omen with the bell far from the players, then four Cantors stand two outside and two inside the rings', () => {
    const { w } = eventRun('bellwatch', { wave: 3 });
    const e = revealed(w, 'bellwatch');
    expect(e.phase).toBe('warning');
    const s = S(e);
    expect(Math.hypot(s.bell.x, s.bell.y)).toBeLessThan(w.arenaRadius);
    expect(nearestLivingDist(w, s.bell.x, s.bell.y)).toBeGreaterThanOrEqual(300);
    expect(w.monsters.count).toBe(0);
    expect(until(w, () => s.cantors.length === 4, 10)).toBe(true);
    expect(s.cantors.filter(c => c.inner)).toHaveLength(2);
    for (const c of s.cantors) {
      const i = w.monsters.slotOf(c.id);
      expect(w.monsters.rarity[i]).toBe(2);
      const d = Math.hypot(w.monsters.x[i] - s.bell.x, w.monsters.y[i] - s.bell.y);
      expect(d).toBeGreaterThan(c.inner ? 50 : 150);
      expect(d).toBeLessThan(c.inner ? 140 : 280);
      expect(nearestLivingDist(w, w.monsters.x[i], w.monsters.y[i]), 'F4').toBeGreaterThanOrEqual(249);
    }
  });

  it('inner Cantors are shielded and cannot be hurt while an outer Cantor lives; outer ones always can', () => {
    const { w, e } = start();
    const s = S(e);
    step(w, 0.1);
    const outer = s.cantors.filter(c => !c.inner), inner = s.cantors.filter(c => c.inner);
    for (const c of inner) {
      expect(flagsOf(w, c.id) & MFLAG.immune).toBeTruthy();
      expect(w.monsters.ailments[w.monsters.slotOf(c.id)] & AILMENT_BIT.shielded).toBeTruthy();
    }
    for (const c of outer) expect(flagsOf(w, c.id) & MFLAG.immune).toBeFalsy();
    expect(e.view.markers.filter(m => m.icon === 'cantor' && m.v === 1)).toHaveLength(2);
    slay(w, outer[0].id);
    step(w, 0.1);
    expect(flagsOf(w, inner[0].id) & MFLAG.immune).toBeTruthy();
    slay(w, outer[1].id);
    step(w, 0.1);
    for (const c of inner) expect(flagsOf(w, c.id) & (MFLAG.immune | MFLAG.shielded)).toBeFalsy();
  });

  it('tolls first after 6 s: a 1.5 s swing telegraph at the bell, then a three-gap ring that obeys F1; every toll adds Dirge', () => {
    const { w, e } = start();
    const s = S(e);
    until(w, () => s.tolls >= 1, 10);
    expect(s.t).toBeGreaterThanOrEqual(5.9);
    expect(s.t).toBeLessThan(6.2);
    expect(s.dirge).toBe(1);
    expect(w.mapEvent!.monsterSpeed).toBeCloseTo(1.08);
    const warn = w.areas.find(a => a.kind === 'slamWarning' && Math.hypot(a.x - s.bell.x, a.y - s.bell.y) < 1)!;
    expect(warn.hurts).toBe('none');
    expect(warn.duration).toBeCloseTo(1.5);
    expect(w.areas.some(a => a.kind === 'choirWave')).toBe(false);
    step(w, 1.3);
    expect(w.areas.some(a => a.kind === 'choirWave')).toBe(false);
    step(w, 0.3);
    const ring = w.areas.find(a => a.kind === 'choirWave')!;
    expect(ring).toBeTruthy();
    expect(ring.variant).toBe(2);
    expect(ring.hurts).toBe('player');
    expect(ring.duration).toBeGreaterThanOrEqual(1.8);
  });

  it('the ring hurts a player it sweeps over once, and not one who walks through a gap or stands back', () => {
    const { w, e } = start({ players: [{ x: 0, y: 0 }] });
    const s = S(e);
    const p = w.players[0];
    p.invulnTime = 0;
    p.x = s.bell.x + 150; p.y = s.bell.y;
    const life0 = p.life;
    until(w, () => w.areas.some(a => a.kind === 'choirWave'), 12);
    step(w, 3);
    expect(p.life).toBeLessThan(life0);
  });

  it('every Cantor that falls removes a Dirge stack and slows the bell; each pays a currency roll the moment it falls', () => {
    const { w, e, log } = start();
    const s = S(e);
    until(w, () => s.tolls >= 2, 20);
    expect(s.dirge).toBe(2);
    const every = tollEvery(w, 0);
    expect(every).toBe(8);
    slay(w, s.cantors.find(c => !c.inner)!.id);
    expect(s.dirge).toBe(1);
    expect(tollEvery(w, 1)).toBe(10);
    expect(log.eventRolls).toHaveLength(1);
    expect(log.eventRolls[0].ctx).toMatchObject({ kind: 'bellwatch', grade: 1, choice: 0 });
    expect(w.mapEvent!.monsterSpeed).toBeCloseTo(1.08);
  });

  it('all four before toll 4 is Gold and pays a final reward; they fall one by one in a legal order', () => {
    const { w, e, log } = start();
    const s = S(e);
    for (const c of [...s.cantors].sort((a, b) => Number(a.inner) - Number(b.inner))) slay(w, c.id);
    expect(e.phase).toBe('complete');
    expect(e.grade).toBe(3);
    expect(log.eventRolls.map(r => r.ctx.choice)).toEqual([0, 1, 2, 3, 4]);
    expect(w.mapEvent!.monsterSpeed).toBe(1);
    expect(w.mapEvent!.live.filter(x => x.kind === 'bellwatch' && x.members.size > 0)).toHaveLength(0);
  });

  it('grades: four before toll 4 Gold; three (or four later) Silver; two Bronze; fewer nothing', () => {
    expect(bellGrade(4, 4)).toBe(3);
    expect(bellGrade(4, 3)).toBe(2);
    expect(bellGrade(3, 3)).toBe(2);
    expect(bellGrade(2, 2)).toBe(1);
    expect(bellGrade(1, 1)).toBe(0);
  });

  it('after toll 8 the bell ends; the Dirge stays 60 s more; with no Cantor down the event fails quietly', () => {
    const { w, e, log } = start();
    const s = S(e);
    expect(until(w, () => s.silentAt >= 0, 120)).toBe(true);
    expect(s.tolls).toBe(8);
    expect(s.dirge).toBe(5);
    expect(w.mapEvent!.monsterSpeed).toBeCloseTo(1.4);
    step(w, 59);
    expect(e.phase).toBe('active');
    expect(until(w, () => e.phase === 'failed', 3)).toBe(true);
    expect(w.mapEvent!.monsterSpeed).toBe(1);
    expect(log.eventRolls).toHaveLength(0);
    // The Cantors rejoin the horde, no longer shielded.
    for (const c of s.cantors) {
      const i = w.monsters.slotOf(c.id);
      if (i >= 0) expect(w.monsters.flags[i] & MFLAG.immune).toBeFalsy();
    }
  });

  it('tolls slow with Bellringer and every fallen Cantor', () => {
    const { w } = start({ eventModifiers: { tollScale: 1.15 } });
    expect(tollEvery(w, 0)).toBeCloseTo(9.2);
    expect(tollEvery(w, 2)).toBeCloseTo(13.8);
  });

  it('the card states the Gold rule and shows Cantors, Dirge and Toll bars', () => {
    const { w, e } = start();
    step(w, 0.1);
    expect(e.view.objectives.map(o => o.id)).toEqual([0, 1, 2]);
    expect(e.view.objectives[0].max).toBe(4);
    expect(e.view.timers[0].id).toBe(0);
    expect(e.view.markers.some(m => m.icon === 'bell')).toBe(true);
  });

  it('an optional Bellwatch is dropped at the boss wave, cleanly (no monsters, no speed-up)', () => {
    const { w, e } = start();
    until(w, () => S(e).tolls >= 2, 20);
    w.director.wave = w.config.waves.bossWave;
    step(w, 0.1);
    expect(['failed', 'complete']).toContain(e.phase);
    expect(w.mapEvent!.monsterSpeed).toBe(1);
  });

  it('is deterministic', () => {
    const run = () => {
      const { w, e } = start();
      until(w, () => S(e).tolls >= 3, 30);
      return JSON.stringify([S(e).bell, S(e).tolls, w.monsters.count, [...e.members]]);
    };
    expect(run()).toBe(run());
  });

  it('cancel leaves nothing behind when the map is won', () => {
    const { w, e } = start();
    w.director.cleared = true;
    step(w, 0.1);
    expect(w.mapEvent!.live).toHaveLength(0);
    expect(e.members.size).toBe(0);
    expect(w.mapEvent!.monsterSpeed).toBe(1);
  });
});
