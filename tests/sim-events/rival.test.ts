import { describe, expect, it } from 'vitest';
import { eventRun, revealed, slay, step, until } from './helpers';
import { bossRuntime } from '../../src/sim/bosses';
import { crownPending } from '../../src/sim/map-events';
import { rivalGrade, rivalKind, rivalScript } from '../../src/sim/events/rival';
import { spawnArea } from '../../src/sim/areas';
import { MSTATE } from '../../src/sim/stores';
import { spawnMonster } from '../../src/sim/spawn';
import { startBoss } from '../../src/sim/bosses';
import { monsterDef } from '../../src/sim/rosters';
import { AILMENT_BIT } from '../../src/contracts/sim';

type RivalS = { a: number; b: number; stage: string; fight: number; spoils: boolean; kind: string; held: number; offset: number; enraged: number; feudKills: number };

/** The map's boss is on the field (as the wave director would have spawned it) and the crown plan reveals itself. */
function crown(o: Parameters<typeof eventRun>[1] = {}) {
  const r = eventRun('secondCrown', { vulnerable: true, ...o });
  const w = r.w;
  const i = spawnMonster(w, w.roster.boss, 200, 0, { boss: true, animate: false });
  startBoss(w, i, monsterDef(w.roster.boss));
  w.director.bossId = w.monsters.id[i];
  w.director.bossSpawned = true;
  const e = revealed(w, 'secondCrown');
  return { ...r, e, s: e.s as RivalS, a: w.monsters.id[i] };
}

describe('Rival Crowns', () => {
  it('picks the boss of a different roster, deterministically', () => {
    const { w } = eventRun('secondCrown');
    for (let v = 0; v < 6; v++) {
      expect(rivalKind(w, v)).not.toBe('cinderMatriarch');
      expect(rivalKind(w, v)).toBe(rivalKind(w, v));
    }
    expect(new Set([0, 1].map(v => rivalKind(w, v))).size).toBe(2);
  });

  it('announces itself on the boss wave; the rival arrives 20 s later after a 3 s shimmer, from far away', () => {
    const { w, e, s } = crown({ arenaRadius: 900 });
    expect(e.phase).toBe('warning');
    expect(s.stage).toBe('wait');
    expect(crownPending(w)).toBe(true);
    step(w, 19);
    expect(s.stage).toBe('wait');
    step(w, 1.2);
    expect(s.stage).toBe('shimmer');
    expect(w.areas.some(a => a.kind === 'echoMark' && a.radius === 60)).toBe(true);
    expect(w.monsters.count).toBe(1);
    expect(until(w, () => s.stage === 'fight', 4)).toBe(true);
    expect(crownPending(w)).toBe(false);
    const bi = w.monsters.slotOf(s.b);
    expect(w.monsters.maxLife[bi]).toBeGreaterThan(0);
    expect(w.monsters.rarity[bi]).toBe(4); // boss
    expect(Math.hypot(w.monsters.x[bi] - w.players[0].x, w.monsters.y[bi] - w.players[0].y)).toBeGreaterThanOrEqual(350);
    expect(bossRuntime(w, bi).lockPhase).toBe(1); // phase-1 kit only
  });

  it('the rival has 60% life and 80% damage of a normal boss of its kind', () => {
    const { w, s } = crown();
    until(w, () => s.stage === 'fight', 30);
    const bi = w.monsters.slotOf(s.b);
    const ref = spawnMonster(w, s.kind as 'hollowWarden', 0, 0, { boss: true, animate: false });
    expect(w.monsters.maxLife[bi]).toBeCloseTo(w.monsters.maxLife[ref] * 0.6, 1);
    expect(w.monsters.damage[bi]).toBeCloseTo(w.monsters.damage[ref] * 0.8, 1);
  });

  it('killing either first empowers the survivor (heal, glow); both dead completes it and pays by the fight time', () => {
    const { w, e, s, a, log } = crown();
    until(w, () => s.stage === 'fight', 30);
    const bi = w.monsters.slotOf(s.b);
    w.monsters.life[bi] = w.monsters.maxLife[bi] * 0.5;
    slay(w, a);
    expect(s.spoils).toBe(true);
    expect(w.monsters.life[bi]).toBeCloseTo(w.monsters.maxLife[bi] * 0.7, 1);
    step(w, 0.1);
    expect(w.monsters.ailments[bi] & AILMENT_BIT.empowered).toBe(AILMENT_BIT.empowered);
    expect(w.director.bossDefeated).toBe(false);
    expect(log.eventRolls).toHaveLength(0);
    slay(w, s.b);
    expect(e.phase).toBe('complete');
    expect(e.grade).toBe(3); // well under 55 s
    expect(log.eventRolls).toHaveLength(1);
    expect(log.eventRolls[0].ctx).toMatchObject({ kind: 'secondCrown', grade: 3 });
    expect(w.director.bossDefeated).toBe(true);
    // The last death carries the crown flag (the reliquary's unique rides on it).
    expect(log.killRolls.at(-1)!.ctx.eventReward).toBe('secondCrown');
    expect(rivalGrade(80)).toBe(2);
    expect(rivalGrade(150)).toBe(1);
  });

  it('if the first boss falls before the rival arrives, the map is not won yet', () => {
    const { w, s, a } = crown();
    slay(w, a);
    expect(w.director.bossDefeated).toBe(false);
    expect(crownPending(w)).toBe(true);
    expect(until(w, () => s.stage === 'fight', 30)).toBe(true);
    expect(w.director.bossId).toBe(s.b);
    slay(w, s.b);
    expect(w.director.bossDefeated).toBe(true);
  });

  it('the Feud: minions of the two rosters fight each other, uncredited, while both bosses live (never the boss bodies)', () => {
    const { w, s, a, log } = crown();
    // Not before the rival arrives.
    const ling = spawnMonster(w, 'ashling', -300, 300, { animate: false });
    const thrall = spawnMonster(w, 'boneThrall', -290, 300, { animate: false });
    w.monsters.life[ling] = 1; w.monsters.life[thrall] = 1;
    const ids = [w.monsters.id[ling], w.monsters.id[thrall]];
    step(w, 1);
    expect(s.feudKills).toBe(0);
    expect(ids.every(id => w.monsters.slotOf(id) >= 0)).toBe(true);
    expect(until(w, () => s.stage === 'fight', 30)).toBe(true);
    const bi = w.monsters.slotOf(s.b), ai = w.monsters.slotOf(a);
    const lifeA = w.monsters.life[ai], lifeB = w.monsters.life[bi];
    const killsBefore = log.killRolls.length;
    w.players[0].x = 0; w.players[0].y = 0;
    const l2 = w.monsters.slotOf(ids[0]), t2 = w.monsters.slotOf(ids[1]);
    if (l2 >= 0) { w.monsters.x[l2] = -300; w.monsters.y[l2] = 300; w.monsters.life[l2] = 1; }
    if (t2 >= 0) { w.monsters.x[t2] = -290; w.monsters.y[t2] = 300; w.monsters.life[t2] = 1; }
    step(w, 0.7);
    expect(s.feudKills).toBeGreaterThan(0);
    expect(log.killRolls.length).toBe(killsBefore); // uncredited: no loot
    expect(w.monsters.life[bi]).toBeLessThanOrEqual(lifeB);
    expect(w.monsters.slotOf(a)).toBeGreaterThanOrEqual(0);
    expect(w.monsters.life[ai]).toBe(lifeA); // the boss bodies are untouched
  });

  it('the telegraph budget holds the RIVAL\'s next cast (at most 3 s), never the first boss\'s', () => {
    const { w, e, s, a } = crown();
    expect(until(w, () => s.stage === 'fight', 30)).toBe(true);
    step(w, 2.5); // the 1.5 s offset runs out
    expect(s.offset).toBeLessThanOrEqual(0);
    const bi = w.monsters.slotOf(s.b);
    w.monsters.state[bi] = MSTATE.chase;
    w.players[0].x = w.monsters.x[bi] - 300; w.players[0].y = w.monsters.y[bi];
    for (let k = 0; k < 2; k++) spawnArea(w, 'slamWarning', 0, 0, 80, 20, { owner: a, hurts: 'player', damage: 1 });
    const x0 = w.monsters.x[bi], y0 = w.monsters.y[bi];
    step(w, 1);
    expect(Math.hypot(w.monsters.x[bi] - x0, w.monsters.y[bi] - y0)).toBeLessThan(1);
    expect(s.held).toBeGreaterThan(0.9);
    expect(rivalScript.drive!(w, e, w.monsters.slotOf(a), null)).toBe(false); // the first boss is never delayed
    step(w, 3);
    expect(s.held).toBeGreaterThanOrEqual(3);
    const x1 = w.monsters.x[bi];
    step(w, 0.5);
    expect(Math.abs(w.monsters.x[bi] - x1)).toBeGreaterThan(0.2); // the hold has a cap: it moves again
  });

  it('both bosses roll their own exclusive unique: the kill context carries the multiplier (Crown Rivalry 1.5)', () => {
    const { w, s, a, log } = crown({ eventModifiers: { rivalUnique: 1.5 } });
    expect(until(w, () => s.stage === 'fight', 30)).toBe(true);
    slay(w, a);
    slay(w, s.b);
    const rolls = log.killRolls.filter(k => k.ctx.isBoss);
    expect(rolls).toHaveLength(2);
    expect(rolls.every(k => k.ctx.rival === 1.5)).toBe(true);
    const plain = crown();
    expect(until(plain.w, () => plain.s.stage === 'fight', 30)).toBe(true);
    slay(plain.w, plain.a);
    expect(plain.log.killRolls.filter(k => k.ctx.isBoss)[0].ctx.rival).toBe(1);
  });

  it('enrage: 240 s after the rival arrives both bosses gain 2% damage every 10 s', () => {
    const { w, s, a } = crown();
    expect(until(w, () => s.stage === 'fight', 30)).toBe(true);
    const bi = w.monsters.slotOf(s.b), ai = w.monsters.slotOf(a);
    const d0 = [w.monsters.damage[ai], w.monsters.damage[bi]];
    s.fight = 239.95;
    step(w, 0.2);
    expect(s.enraged).toBe(1);
    expect(w.monsters.damage[ai]).toBeCloseTo(d0[0] * 1.02, 3);
    expect(w.monsters.damage[bi]).toBeCloseTo(d0[1] * 1.02, 3);
    s.fight = 259.95;
    step(w, 0.2);
    expect(s.enraged).toBe(3);
  });

  it('the second boss bar: RunView.boss2 is the rival while both live, and nothing once one has fallen', () => {
    const { w, s, a } = crown();
    expect(until(w, () => s.stage === 'fight', 30)).toBe(true);
    step(w, 0.1);
    expect(w.view.run.boss).not.toBeNull();
    expect(w.view.run.boss2).toMatchObject({ maxLife: expect.any(Number) });
    slay(w, a);
    step(w, 0.1);
    expect(w.view.run.boss2).toBeNull();
  });
});

describe('Rival Crowns: spoils with the first boss in slot 0', () => {
  it('killing the rival first empowers the first boss too (ids are not truthiness)', () => {
    const { w, s, a } = crown();
    expect(a).toBe(0);
    expect(until(w, () => s.stage === 'fight', 30)).toBe(true);
    slay(w, s.b);
    expect(s.spoils).toBe(true);
    step(w, 0.1);
    expect(w.monsters.ailments[w.monsters.slotOf(a)] & AILMENT_BIT.empowered).toBe(AILMENT_BIT.empowered);
  });
});
