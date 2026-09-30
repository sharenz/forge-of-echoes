import { describe, expect, it } from 'vitest';
import { eventRun, revealed, slay, step, until } from './helpers';
import { areaContains } from '../../src/sim/area-geometry';
import { spawnMonster } from '../../src/sim/spawn';
import { faultGrade, wedgeAngle } from '../../src/sim/events/fault';

const stateOf = (e: ReturnType<typeof revealed>) => e.s as {
  center: { x: number; y: number }; base: number; t: number; pulses: number; guardians: Set<number>; queue: number[]; hotArea: { dead: boolean } | null; bornId: number;
};

function open(w: ReturnType<typeof eventRun>['w'], e: ReturnType<typeof revealed>): void {
  const s = stateOf(e);
  w.players[0].x = s.center.x + 30; w.players[0].y = s.center.y;
}

describe('The Fault', () => {
  it('is an optional crack far from the players; it opens on approach with a 3 s warning', () => {
    const { w } = eventRun('wound', { vulnerable: true });
    const e = revealed(w, 'wound');
    const s = stateOf(e);
    expect(e.phase).toBe('available');
    expect(Math.hypot(s.center.x, s.center.y)).toBeGreaterThanOrEqual(300);
    expect(e.view.zones[0].kind).toBe('crack');
    step(w, 3);
    expect(e.phase).toBe('available');
    open(w, e);
    step(w, 0.1);
    expect(e.phase).toBe('warning');
    expect(until(w, () => e.phase === 'active', 4)).toBe(true);
    expect(e.view.zones.some(z => z.kind === 'field')).toBe(true);
    expect(e.view.zones.filter(z => z.kind === 'wedgePlan')).toHaveLength(2); // the next two hot wedges are always shown
  });

  it('a pulse shimmers on the cracks for a second, then six guardians appear between the wedges', () => {
    const { w } = eventRun('wound', { vulnerable: true });
    const e = revealed(w, 'wound'); open(w, e);
    const s = stateOf(e);
    until(w, () => e.phase === 'active', 4);
    expect(until(w, () => w.areas.some(a => a.kind === 'echoMark'), 3)).toBe(true);
    expect(w.monsters.count).toBe(0);
    expect(until(w, () => s.guardians.size > 0, 3)).toBe(true);
    expect(s.guardians.size).toBe(6);
    for (const id of s.guardians) {
      const i = w.monsters.slotOf(id);
      expect(w.monsters.rarity[i]).toBe(1); // magic
      expect(Math.hypot(w.monsters.x[i] - s.center.x, w.monsters.y[i] - s.center.y)).toBeLessThanOrEqual(260);
    }
  });

  it('a hot wedge telegraphs for at least 1.8 s, then hurts players by a hit and monsters by a share of their life', () => {
    const { w } = eventRun('wound', { vulnerable: true });
    const e = revealed(w, 'wound'); open(w, e);
    const s = stateOf(e);
    until(w, () => e.phase === 'active', 4);
    expect(until(w, () => w.areas.some(a => a.kind === 'faultWedge'), 10)).toBe(true);
    const wedge = w.areas.find(a => a.kind === 'faultWedge')!;
    expect(wedge.duration).toBeGreaterThanOrEqual(1.8);
    expect(wedge.hurts).toBe('all');
    expect(wedge.radius).toBe(240);
    // Put a normal monster, a rare and a boss inside the wedge, and the player too.
    const a = wedge.angle;
    const at = (r: number) => ({ x: s.center.x + Math.cos(a) * r, y: s.center.y + Math.sin(a) * r });
    const normal = spawnMonster(w, 'ironhideBrute', at(150).x, at(150).y, { animate: false });
    const rare = spawnMonster(w, 'ironhideBrute', at(170).x, at(170).y + 6, { rarity: 'rare', animate: false });
    const boss = spawnMonster(w, 'cinderMatriarch', at(190).x, at(190).y, { boss: true, animate: false });
    const player = w.players[0];
    player.x = at(100).x; player.y = at(100).y;
    expect(areaContains(wedge, player.x, player.y, 0)).toBe(true);
    const life = player.life;
    const nl = w.monsters.life[normal], rl = w.monsters.life[rare], bl = w.monsters.life[boss];
    const nMax = w.monsters.maxLife[normal], rMax = w.monsters.maxLife[rare];
    expect(until(w, () => wedge.dead, 3)).toBe(true);
    expect(player.life).toBeLessThan(life);
    expect(w.monsters.life[normal]).toBeCloseTo(nl - nMax * 0.3, 0);
    expect(w.monsters.life[rare]).toBeCloseTo(rl - rMax * 0.15, 0);
    expect(w.monsters.life[boss]).toBe(bl);
    expect(w.areas.some(x => x.kind === 'firePool')).toBe(true); // the cinder crust
  });

  it('never begins an eruption while a player is held', () => {
    const { w } = eventRun('wound', { vulnerable: true });
    const e = revealed(w, 'wound'); open(w, e);
    until(w, () => e.phase === 'active', 4);
    w.players[0].pullTime = 10;
    step(w, 8);
    expect(w.areas.some(a => a.kind === 'faultWedge')).toBe(false);
    w.players[0].pullTime = 0;
    expect(until(w, () => w.areas.some(a => a.kind === 'faultWedge'), 3)).toBe(true);
  });

  it('plans the most-occupied wedges and shows them two ahead', () => {
    const { w } = eventRun('wound', { vulnerable: true });
    const e = revealed(w, 'wound'); open(w, e);
    const s = stateOf(e);
    until(w, () => e.phase === 'active', 4);
    expect(s.queue).toHaveLength(2);
    expect(new Set(s.queue).size).toBe(2);
    const plan = e.view.zones.filter(z => z.kind === 'wedgePlan');
    expect(plan.map(z => z.a)).toEqual(s.queue.map(k => wedgeAngle(s.base, k)));
  });

  it('seals when the last pulse is cleared: Gold under 30 s, and pays once', () => {
    const { w, log } = eventRun('wound', { vulnerable: true });
    const e = revealed(w, 'wound'); open(w, e);
    const s = stateOf(e);
    until(w, () => e.phase === 'active', 4);
    let guard = 0;
    while (e.phase === 'active' && guard++ < 400) {
      step(w, 0.25);
      for (const id of [...s.guardians]) slay(w, id);
    }
    expect(e.phase).toBe('complete');
    expect(s.pulses).toBe(4);
    expect(e.grade).toBe(3);
    expect(log.eventRolls).toHaveLength(1);
    expect(log.eventRolls[0].ctx.kind).toBe('wound');
    expect(faultGrade(31)).toBe(2);
    expect(faultGrade(46)).toBe(1);
    expect(faultGrade(46, 5)).toBe(2);
  });

  it('the fourth pulse carries the Fault-born rare with the theme\'s elemental mod', () => {
    const { w } = eventRun('wound', { vulnerable: true, theme: 'rimedOssuary' });
    const e = revealed(w, 'wound'); open(w, e);
    const s = stateOf(e);
    until(w, () => e.phase === 'active', 4);
    expect(until(w, () => {
      if (s.bornId !== 0) return true;
      for (const id of [...s.guardians]) slay(w, id);
      return false;
    }, 60)).toBe(true);
    expect(w.monsters.rarity[w.monsters.slotOf(s.bornId)]).toBe(2);
    expect(w.monsters.mods[w.monsters.slotOf(s.bornId)] & 256).toBe(256); // coldProof
  });

  it('overflows past 75 s: extra monsters keep coming and the best it can pay is Bronze', () => {
    const { w, log } = eventRun('wound', { vulnerable: true });
    const e = revealed(w, 'wound'); open(w, e);
    const s = stateOf(e);
    until(w, () => e.phase === 'active', 4);
    // Leave the guardians alone (kill the field's monsters only after 75 s).
    step(w, 80);
    expect(s.t).toBeGreaterThan(75);
    expect(e.phase).toBe('active');
    expect(s.pulses).toBe(4);
    const before = s.guardians.size;
    step(w, 11);
    expect(s.guardians.size).toBeGreaterThan(before);
    let guard = 0;
    while (e.phase === 'active' && guard++ < 200) { step(w, 0.5); for (const id of [...s.guardians]) slay(w, id); }
    expect(e.grade).toBe(1);
    expect(log.eventRolls.at(-1)!.ctx.grade).toBe(1);
  });

  it('is required in a sealed area: the boss wave does not close it', () => {
    const { w } = eventRun('wound', { vulnerable: true, plan: { required: true } });
    const e = revealed(w, 'wound');
    w.director.wave = w.config.waves.bossWave;
    step(w, 0.2);
    expect(w.mapEvent!.live).toContain(e);
  });
});
