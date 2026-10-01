import { describe, expect, it } from 'vitest';
import { eventRun, revealed, slay, step, until } from './helpers'; // first: the sim modules import each other in a cycle
import { spawnMonster } from '../../src/sim/spawn';
import { MFLAG } from '../../src/sim/stores';
import { AILMENT_BIT } from '../../src/contracts/sim';
import { orchardGrade, stageAt } from '../../src/sim/events/orchard';

type Bloom = { x: number; y: number; kind: number; id: number; stage: number; state: string };
type OrchS = { blooms: Bloom[]; t: number; points: number };

function open(o: Parameters<typeof eventRun>[1] = {}) {
  const r = eventRun('orchard', { wave: 2, ...o });
  const e = revealed(r.w, 'orchard');
  step(r.w, 3.1);
  return { ...r, e, s: e.s as OrchS };
}
const bloomSlot = (w: ReturnType<typeof eventRun>['w'], b: Bloom) => w.monsters.slotOf(b.id);

describe('Ashseed Orchard', () => {
  it('bursts three inert, hittable fixtures 250-450 u apart and far from the party, after a 3 s warning', () => {
    const { w } = eventRun('orchard');
    const e = revealed(w, 'orchard');
    const s = e.s as OrchS;
    expect(e.phase).toBe('warning');
    expect(s.blooms.map(b => b.kind)).toEqual([0, 1, 2]);
    for (let a = 0; a < 3; a++) {
      const i = bloomSlot(w, s.blooms[a]);
      expect(w.monsters.flags[i] & MFLAG.fixture).toBeTruthy();
      expect(w.monsters.ailments[i] & AILMENT_BIT.fixture).toBeTruthy(); // the presenter hides the body
      expect(Math.hypot(s.blooms[a].x, s.blooms[a].y)).toBeGreaterThanOrEqual(249);
      for (let b = a + 1; b < 3; b++) {
        const d = Math.hypot(s.blooms[a].x - s.blooms[b].x, s.blooms[a].y - s.blooms[b].y);
        expect(d).toBeGreaterThanOrEqual(240);
        expect(d).toBeLessThanOrEqual(460);
      }
    }
    expect(e.view.markers.filter(m => m.icon === 'bloom')).toHaveLength(3);
    step(w, 3.1);
    expect(e.phase).toBe('active');
  });

  it('ripens through stages 1, 2 and 3 at 15, 35 and 60 s (faster with Green Thumb) and announces each', () => {
    expect([0, 14.9, 15, 34.9, 35, 59.9, 60].map(stageAt)).toEqual([0, 0, 1, 1, 2, 2, 3]);
    const { w, e, s } = open({ eventModifiers: { bloomRipen: 2 } });
    step(w, 7.6);
    expect(s.blooms[0].stage).toBe(1);
    expect(e.view.markers[0].v).toBe(1);
    step(w, 30);
    expect(s.blooms[0].stage).toBe(3);
    expect(e.view.timers[0].id).toBe(0);
  });

  it('standing at a ripening bloom for 1.5 s harvests it (nothing to give at stage 0) and pays by kind and stage', () => {
    const { w, s, log } = open();
    w.players[0].x = s.blooms[1].x; w.players[0].y = s.blooms[1].y;
    step(w, 14.9);
    expect(s.blooms[1].state).toBe('growing'); // still a seed mound: nothing to give
    step(w, 0.6);
    expect(s.blooms[1].stage).toBe(1);
    step(w, 0.6);
    expect(s.blooms[1].state).toBe('growing');
    step(w, 0.6);
    expect(s.blooms[1].state).toBe('harvested');
    expect(log.eventRolls.at(-1)!.ctx).toMatchObject({ kind: 'orchard', choice: 1 * 4 + 1 });
    expect(bloomSlot(w, s.blooms[1])).toBe(-1);
    expect(s.points).toBe(1);
  });

  it('monsters away from the party gnaw the weakest bloom; one beside a player ignores it; a destroyed bloom pays nothing', () => {
    const { w, e, s, log } = open({ vulnerable: true });
    const b = s.blooms[0];
    const near = spawnMonster(w, w.roster.family[0], b.x + 30, b.y, { animate: false });
    const near2 = spawnMonster(w, w.roster.family[0], 5, 40, { animate: false }); // beside the player: normal brain
    const x0 = w.monsters.x[near2];
    const life0 = w.monsters.life[bloomSlot(w, b)];
    step(w, 3);
    expect(w.monsters.life[bloomSlot(w, b)]).toBeLessThan(life0);
    expect(w.monsters.x[near2]).not.toBe(x0); // chasing the player, not stuck on a bloom
    // Finish it off: the bloom dies uncredited.
    const rolls = log.eventRolls.length;
    w.monsters.life[bloomSlot(w, b)] = 1;
    until(w, () => b.state === 'lost', 10);
    step(w, 0.1);
    expect(b.state).toBe('lost');
    expect(log.eventRolls.length).toBe(rolls);
    expect(e.view.markers.find(m => m.icon === 'bloom' && m.x === b.x)!.v).toBe(255);
    expect(near).toBeGreaterThanOrEqual(0);
  });

  it('diverts only monsters within the reach of a bloom (Green Thumb widens it)', () => {
    const { w, s } = open({ eventModifiers: { bloomTarget: 1.2 } });
    const b = s.blooms[2];
    const far = spawnMonster(w, w.roster.family[0], b.x + 240, b.y, { animate: false }); // 240 > 220 but <= 264
    const farther = spawnMonster(w, w.roster.family[0], b.x + 290, b.y, { animate: false });
    const d0 = [far, farther].map(i => Math.hypot(w.monsters.x[i] - b.x, w.monsters.y[i] - b.y));
    step(w, 1);
    const d1 = [far, farther].map(i => Math.hypot(w.monsters.x[i] - b.x, w.monsters.y[i] - b.y));
    expect(d1[0]).toBeLessThan(d0[0] - 5);
    expect(d1[1]).toBeGreaterThanOrEqual(d0[1] - 1 - 0); // out of reach: not steered (it still may walk to the player elsewhere)
  });

  it('grades by harvested stage points (3 / 6 / 9), eased by the lens, and ends when every bloom is settled', () => {
    expect([0, 2, 3, 5, 6, 8, 9].map(p => orchardGrade(p))).toEqual([0, 0, 1, 1, 2, 2, 3]);
    expect(orchardGrade(8, 0.15)).toBe(3);
    const { w, e, s, log } = open();
    // Ripen fully, then harvest all three.
    step(w, 61);
    for (const b of s.blooms) {
      w.players[0].x = b.x; w.players[0].y = b.y;
      step(w, 1.7);
    }
    expect(s.points).toBe(9);
    expect(e.phase).toBe('complete');
    expect(e.grade).toBe(3);
    expect(log.eventRolls.filter(r => r.ctx.kind === 'orchard')).toHaveLength(4);
    expect(log.eventRolls.at(-1)!.ctx).toMatchObject({ grade: 3, choice: 0, tally: 9 });
  });

  it('unharvested blooms wither at 90 s with nothing left in the store; the boss wave and a cancel clean up too', () => {
    const { w, e } = open();
    step(w, 92);
    expect(e.phase).toBe('failed');
    expect(w.monsters.count).toBe(0);
    const b = open();
    b.w.director.wave = b.w.config.waves.bossWave;
    step(b.w, 0.2);
    expect(b.w.monsters.count).toBe(0);
    const c = open();
    c.w.director.cleared = true;
    step(c.w, 0.1);
    expect(c.w.monsters.count).toBe(0);
  });

  it('blooms killed by the party count as lost, not as a harvest', () => {
    const { w, s } = open();
    slay(w, s.blooms[0].id);
    step(w, 0.1);
    expect(s.blooms[0].state).toBe('lost');
    expect(s.points).toBe(0);
  });

  it('is deterministic', () => {
    const sites = () => open().s.blooms.map(b => `${b.x.toFixed(3)},${b.y.toFixed(3)}`).join('|');
    expect(sites()).toBe(sites());
  });

  it('works for each roster and a party of four', () => {
    for (const theme of ['ashenForge', 'rimedOssuary', 'ironColiseum'] as const) {
      const { w, s } = open({ theme, players: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }] });
      expect(s.blooms).toHaveLength(3);
      expect(w.living).toHaveLength(4);
    }
  });
});
