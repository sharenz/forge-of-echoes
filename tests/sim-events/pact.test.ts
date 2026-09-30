import { describe, expect, it } from 'vitest';
import { eventRun, revealed, step, until } from './helpers'; // first: the sim modules import each other in a cycle
import { PACT_IDS, type WavePact } from '../../src/contracts/map-events';
import { PACT_DEFS, PACT_ESCALATION } from '../../src/data/progression/events/pact-altar';
import { escalate, pactGrade } from '../../src/sim/events/pact';
import { killMonster, DT_FIRE } from '../../src/sim/combat';
import { hitPlayer } from '../../src/sim/combat';
import { planWave, waveBudget } from '../../src/sim/waves';
import { spawnMonster } from '../../src/sim/spawn';
import { stepWorld } from '../../src/sim/run';

type PactS = { altar: { x: number; y: number }; stones: { x: number; y: number; n: number; state: number }[]; offers: string[]; queue: WavePact[]; kept: number; round: number; open: boolean };

function open(opts: Parameters<typeof eventRun>[1] = {}) {
  const r = eventRun('pactAltar', { wave: 2, ...opts });
  const e = revealed(r.w, 'pactAltar');
  step(r.w, 3.1);
  return { ...r, e, s: e.s as PactS };
}
const stand = (w: ReturnType<typeof eventRun>['w'], k: number, s: PactS, pid = 0) => { w.players[pid].x = s.stones[k].x; w.players[pid].y = s.stones[k].y; };

describe('Pact Altar', () => {
  it('lays an altar far from the party with three stones (two bold pacts and Ember Tax), a 3 s warning first', () => {
    const { w } = eventRun('pactAltar');
    const e = revealed(w, 'pactAltar');
    const s = e.s as PactS;
    expect(e.phase).toBe('warning');
    expect(Math.hypot(s.altar.x, s.altar.y)).toBeGreaterThanOrEqual(250);
    expect(s.stones).toHaveLength(3);
    expect(s.offers[2]).toBe('emberTax');
    expect(s.offers[0]).not.toBe(s.offers[1]);
    expect(s.offers.slice(0, 2).every(o => o !== 'emberTax')).toBe(true);
    for (const st of s.stones) expect(Math.hypot(st.x - s.altar.x, st.y - s.altar.y)).toBeGreaterThan(60);
    expect(e.view.zones.filter(z => z.kind === 'stone')).toHaveLength(3);
    expect(e.view.zones.some(z => z.kind === 'altar')).toBe(true);
    step(w, 3.1);
    expect(e.phase).toBe('active');
  });

  it('the Pact Broker lens adds a fourth stone with a hard pact', () => {
    const r = eventRun('pactAltar', { eventModifiers: { pactExtra: 1 } });
    const e = revealed(r.w, 'pactAltar');
    const s = e.s as PactS;
    expect(s.stones).toHaveLength(4);
    expect(new Set(s.offers).size).toBe(4);
  });

  it('standing on a stone for one second chooses it: the pact shapes the NEXT wave and the other stones are spent', () => {
    const { w, e, s } = open();
    stand(w, 0, s);
    step(w, 0.8);
    expect(s.queue).toHaveLength(0);
    step(w, 0.4);
    expect(s.queue).toHaveLength(1);
    expect(s.queue[0].id).toBe(s.offers[0]);
    expect(s.queue[0].wave).toBe(w.director.wave + 1);
    expect(w.pact).toBe(s.queue[0]);
    expect(e.view.zones.filter(z => z.kind === 'stone').map(z => z.v).sort()).toEqual([254, 254, 255]);
  });

  it('a party: the most-occupied stone wins even when another has the longest dwell', () => {
    const { w, s } = open({ players: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }] });
    stand(w, 0, s, 0);
    step(w, 0.9);
    stand(w, 1, s, 1);
    stand(w, 1, s, 2);
    step(w, 0.3); // stone 0 reaches its second, but stone 1 holds two of the three players
    expect(s.queue[0].id).toBe(s.offers[1]);
  });

  it('Ember Tax declines: no pact, a Scrap consolation is paid at the choice', () => {
    const { w, s, log } = open();
    stand(w, 2, s);
    step(w, 1.2);
    expect(s.queue).toHaveLength(0);
    expect(w.pact).toBeNull();
    expect(log.eventRolls).toHaveLength(1);
    expect(log.eventRolls[0].ctx).toMatchObject({ kind: 'pactAltar', choice: 10 });
  });

  it('an undecided round expires when the next wave is announced, and nothing is shaped', () => {
    const { w, s } = open();
    w.director.tellWave = 3;
    step(w, 0.1);
    expect(s.open).toBe(false);
    expect(s.queue).toHaveLength(0);
    expect(w.pact).toBeNull();
    stand(w, 0, s);
    step(w, 1.5);
    expect(w.pact).toBeNull();
  });

  it('round two opens when the pact wave starts and is escalated after a bold first pact; both kept is Silver, no death Gold', () => {
    const { w, e, s, log } = open({ vulnerable: true });
    stand(w, 0, s);
    step(w, 1.2);
    expect(s.queue[0].wave).toBe(3);
    const first = { ...s.queue[0] };
    w.players[0].x = 0; w.players[0].y = 0;
    w.director.wave = 3;
    step(w, 0.2);
    expect(s.round).toBe(2);
    expect(s.open).toBe(true);
    expect(s.stones.every(st => st.state === 0)).toBe(true);
    stand(w, 0, s);
    step(w, 1.2);
    const def = PACT_DEFS[s.offers[0] as keyof typeof PACT_DEFS];
    expect(s.queue[1].monsters).toBeCloseTo(1 + (def.monsters - 1) * PACT_ESCALATION);
    expect(w.pact).toBe(s.queue[0]); // the first pact keeps shaping its own wave
    expect(w.pactNext).toBe(s.queue[1]);
    expect(first.wave).toBe(3);
    w.players[0].x = 0; w.players[0].y = 0;
    w.director.wave = 4;
    step(w, 0.2);
    expect(s.kept).toBe(1);
    w.director.wave = 5;
    step(w, 0.3);
    expect(e.phase).toBe('complete');
    expect(e.grade).toBe(3);
    expect(w.pact).toBeNull();
    expect(log.eventRolls.at(-1)!.ctx).toMatchObject({ kind: 'pactAltar', grade: 3, tally: 2 });
  });

  it('grades: bold pacts kept and deaths', () => {
    expect(pactGrade(0, 0)).toBe(0);
    expect(pactGrade(1, 0)).toBe(1);
    expect(pactGrade(2, 1)).toBe(2);
    expect(pactGrade(2, 0)).toBe(3);
    expect(pactGrade(2, 0, 1)).toBe(3); // one pact wave still running when the next was announced is forgiven
    expect(pactGrade(2, 0, 2)).toBe(2); // both running past their tell is not
  });

  it('two Ember Taxes fail the event quietly (grade 0); the boss wave closes an open altar', () => {
    const { w, e, s } = open();
    stand(w, 2, s);
    step(w, 1.2);
    w.players[0].x = 0; w.players[0].y = 0;
    w.director.wave = 3;
    step(w, 0.2);
    stand(w, 2, s);
    step(w, 1.2);
    w.players[0].x = 0; w.players[0].y = 0;
    w.director.wave = 4;
    step(w, 0.3);
    expect(e.phase).toBe('failed');
    const b = open();
    b.w.director.wave = b.w.config.waves.bossWave;
    step(b.w, 0.2);
    expect(b.e.phase).toBe('failed');
  });

  it('cancel leaves no pact behind', () => {
    const { w, s } = open();
    stand(w, 0, s);
    step(w, 1.2);
    expect(w.pact).not.toBeNull();
    w.director.cleared = true;
    step(w, 0.1);
    expect(w.pact).toBeNull();
    expect(w.pactResist).toBe(0);
  });

  it('escalation scales the deltas over neutral only', () => {
    const d = escalate(PACT_DEFS.swarm, 1.35);
    expect(d.monsters).toBeCloseTo(1 + (PACT_DEFS.swarm.monsters - 1) * 1.35);
    expect(d.ambush).toBe(false);
    expect(escalate(PACT_DEFS.emberTax, 1.35).monsters).toBe(1);
    expect(PACT_IDS).toContain('ambush');
  });
});

describe('the wave-plan seam of a pact', () => {
  const pactOf = (id: keyof typeof PACT_DEFS, wave = 3): WavePact => ({ ...PACT_DEFS[id], wave });

  it('Swarm grows the wave budget; Blood Moon makes every pack magic; Ambush folds the stream away and rings the packs', () => {
    const { w } = eventRun('pactAltar');
    const plain = planWave(w, 3);
    const total = (p: typeof plain) => p.packs.reduce((n, pk) => n + pk.members.length, 0) + p.streamCount;
    expect(total(plain)).toBe(waveBudget(w, 3, 1));
    w.pact = pactOf('swarm');
    expect(total(planWave(w, 3))).toBe(Math.round(waveBudget(w, 3, 1) * PACT_DEFS.swarm.monsters));
    expect(total(planWave(w, 4))).toBe(waveBudget(w, 4, 1)); // only its own wave
    w.pact = pactOf('bloodMoon');
    expect(planWave(w, 3).packs.every(pk => pk.rarity !== 'normal')).toBe(true);
    w.pact = pactOf('ambush');
    const amb = planWave(w, 3);
    expect(amb.ambush).toBe(true);
    expect(amb.streamCount).toBeLessThan(plain.streamCount);
  });

  it('Ambush places every pack on a ring round the party, hunting', () => {
    const { w } = eventRun('pactAltar', { director: true });
    w.director.phase = 'tell';
    w.director.wave = 0;
    w.director.intro = 0;
    w.pact = pactOf('ambush', 1);
    w.director.tellWave = 1;
    w.director.plan = planWave(w, 1);
    w.director.tellTimer = 0.01;
    until(w, () => w.director.wave === 1, 3);
    const packs = w.packs.filter(p => p.active);
    expect(packs.length).toBeGreaterThan(2);
    for (const p of packs) {
      expect(p.aggro).toBe(true);
      const d = Math.hypot(p.homeX - w.players[0].x, p.homeY - w.players[0].y);
      expect(d).toBeGreaterThan(250);
    }
  });

  it('Ironhide multiplies monster life for its wave only; Cinder Curse lowers resistances while set; quantity reaches the loot context', () => {
    const { w, log } = eventRun('pactAltar', { vulnerable: true });
    const life = (wave: number) => { const i = spawnMonster(w, w.roster.family[0], 50, 50, { wave, animate: false }); return w.monsters.maxLife[i]; };
    const base = life(3);
    w.pact = pactOf('ironhide');
    expect(life(3) / base).toBeCloseTo(PACT_DEFS.ironhide.life);
    w.pact = pactOf('swarm');
    const i = spawnMonster(w, w.roster.family[0], 60, 60, { wave: 3, animate: false });
    killMonster(w, i, DT_FIRE, true, 1);
    expect(log.killRolls.at(-1)!.ctx).toMatchObject({ quantityMore: PACT_DEFS.swarm.quantity, rarityMore: 0 });
    const j = spawnMonster(w, w.roster.family[0], 60, 60, { wave: 4, animate: false });
    killMonster(w, j, DT_FIRE, true, 1);
    expect(log.killRolls.at(-1)!.ctx.quantityMore).toBeUndefined();
    w.pact = null;
    const p = w.players[0];
    p.invulnTime = 0;
    p.stats.resist = { ...p.stats.resist };
    const hit = (): number => { p.invulnTime = 0; const l = p.life; hitPlayer(w, p, 100, 1, 'area'); const d = l - p.life; p.life = l; return d; };
    const plain = hit();
    w.pactResist = 0.1;
    expect(hit()).toBeGreaterThan(plain);
    w.pactResist = 0;
    stepWorld(w);
  });
});

describe('determinism', () => {
  it('the same seed picks the same offers', () => {
    const offers = () => { const { s } = open(); return s.offers.join(','); };
    expect(offers()).toBe(offers());
  });
});
