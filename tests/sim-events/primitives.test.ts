// The Event Director v2 wave-2 primitives: frozen statues, destructible fixtures, choice by dwell, the carrier slow and the
// wave-plan pact seam. Each event's own tests build on these; this file pins their contracts.
import { describe, expect, it } from 'vitest';
import { AILMENT_BIT } from '../../src/contracts/sim';
import type { WavePact } from '../../src/contracts/map-events';
import { damageMonster } from '../../src/sim/combat';
import { damageFixture, eventFixture, eventMonster, familyKind, fixtureLife, lootBonus, makeStone, stoneZones, thawStatue, tickStones } from '../../src/sim/events/kit';
import { MFLAG } from '../../src/sim/stores';
import { planWave } from '../../src/sim/waves';
import { spawnMonster } from '../../src/sim/spawn';
import { hitPlayer, DT_FIRE } from '../../src/sim/combat';
import { eventRun, revealed, step } from './helpers';

function pact(over: Partial<WavePact> = {}): WavePact {
  return { id: 'swarm', wave: 2, monsters: 1, magic: false, life: 1, ambush: false, quantity: 0, rarity: 0, resist: 0, ...over };
}

describe('frozen statues', () => {
  it('are not hittable, do not move, show the frozen bit, and wake after a thaw shimmer', () => {
    const { w } = eventRun('hunted', { players: [{ x: 0, y: 0 }] });
    const e = revealed(w, 'hunted');
    const i = eventMonster(w, e, familyKind(w, 'bruiser'), 200, 100, { frozen: true, rarity: 'rare' });
    expect(i).toBeGreaterThanOrEqual(0);
    const id = w.monsters.id[i];
    expect(w.monsters.flags[i] & MFLAG.frozen).toBeTruthy();
    damageMonster(w, i, 500, DT_FIRE, 0, 1.5, 0, 1, 0, 0, true, 1);
    expect(w.monsters.life[i]).toBe(w.monsters.maxLife[i]);
    step(w, 2);
    expect(w.monsters.x[i]).toBe(200);
    expect(w.monsters.y[i]).toBe(100);
    expect(w.monsters.ailments[i] & AILMENT_BIT.frozen).toBeTruthy();
    expect(thawStatue(w, id)).toBe(true);
    expect(thawStatue(w, id)).toBe(false); // already awake
    damageMonster(w, i, 5, DT_FIRE, 0, 1.5, 0, 1, 0, 0, true, 1);
    expect(w.monsters.life[i]).toBe(w.monsters.maxLife[i]); // still shimmering
    step(w, 1.2);
    expect(w.monsters.ailments[i] & AILMENT_BIT.frozen).toBeFalsy();
    damageMonster(w, i, 5, DT_FIRE, 0, 1.5, 0, 1, 0, 0, true, 1);
    expect(w.monsters.life[i]).toBeLessThan(w.monsters.maxLife[i]);
  });

  it('keep their loot and XP (they are real monsters) and can carry a loot bonus', () => {
    const { w } = eventRun('hunted');
    const e = revealed(w, 'hunted');
    const i = eventMonster(w, e, familyKind(w, 'bruiser'), 200, 100, { frozen: true });
    expect(w.monsters.flags[i] & MFLAG.summoned).toBeFalsy();
    expect(w.monsters.xp[i]).toBeGreaterThan(0);
    lootBonus(w, w.monsters.id[i], 60);
    expect(w.mapEvent!.lootBonus.get(w.monsters.id[i])).toEqual({ quantity: 60, rarity: 0 });
  });
});

describe('destructible fixtures', () => {
  it('are hittable inert props: no attacks, no xp, no loot, hidden body bit, die uncredited from the monsters side', () => {
    const { w, log } = eventRun('echoRift');
    const e = revealed(w, 'echoRift');
    const i = eventFixture(w, e, 150, 0, 4, 13);
    expect(i).toBeGreaterThanOrEqual(0);
    const m = w.monsters;
    const id = m.id[i];
    expect(m.radius[i]).toBe(13);
    expect(m.xp[i]).toBe(0);
    expect(m.damage[i]).toBe(0);
    expect(m.ailments[i]).toBe(0); // set on the next monster update
    step(w, 0.1);
    expect(m.ailments[i] & AILMENT_BIT.fixture).toBeTruthy();
    const x = m.x[i];
    step(w, 3);
    expect(m.x[i]).toBe(x);
    expect(fixtureLife(w, id)).toBe(1);
    damageMonster(w, i, 1, DT_FIRE, 0, 1.5, 0, 1, 0, 0, true, 1);
    expect(fixtureLife(w, id)).toBeLessThan(1);
    const before = log.killRolls.length;
    expect(damageFixture(w, i, 1e9)).toBe(true);
    expect(m.slotOf(id)).toBe(-1);
    expect(log.killRolls.length).toBe(before); // nothing dropped
    expect(fixtureLife(w, id)).toBe(0);
  });

  it('count as monsters until they are gone (so an event must clear them up)', () => {
    const { w } = eventRun('echoRift');
    const e = revealed(w, 'echoRift');
    const n = w.monsters.count;
    eventFixture(w, e, 150, 0, 2, 10);
    expect(w.monsters.count).toBe(n + 1);
  });
});

describe('choice by dwell', () => {
  it('resolves to the most-occupied stone after one player has dwelt the time; ties go to the longer dwell, then the lower index', () => {
    const { w } = eventRun('hunted', { players: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 500, y: 0 }] });
    const stones = [makeStone(0, 0, 26, 0), makeStone(500, 0, 26, 1), makeStone(-500, 0, 26, 2)];
    let chosen = -1;
    for (let k = 0; k < 120 && chosen < 0; k++) chosen = tickStones(w, stones, 1);
    // Two players share stone 0, one is alone on stone 1: the crowd decides even though both reached one second together.
    expect(chosen).toBe(0);
    expect(stones.map(s => s.state)).toEqual([1, 2, 2]);
    expect(tickStones(w, stones, 1)).toBe(-1); // decided once
  });

  it('decays when a player steps off and never completes without one second of standing', () => {
    const { w } = eventRun('hunted', { players: [{ x: 0, y: 0 }] });
    const stones = [makeStone(0, 0, 26, 0), makeStone(300, 0, 26, 1)];
    for (let k = 0; k < 50; k++) expect(tickStones(w, stones, 1)).toBe(-1); // 0.83 s
    w.players[0].x = 200;
    for (let k = 0; k < 70; k++) tickStones(w, stones, 1);
    expect(stones[0].dwell.size === 0 || (stones[0].dwell.get(1) ?? 0) < 0.05).toBe(true);
    w.players[0].x = 0;
    for (let k = 0; k < 50; k++) expect(tickStones(w, stones, 1)).toBe(-1);
    for (let k = 0; k < 20; k++) tickStones(w, stones, 1);
    expect(stones[0].state).toBe(1);
  });

  it('draws as ground zones: dwell percent, chosen 255, spent 254, the choice number', () => {
    const { w } = eventRun('hunted', { players: [{ x: 0, y: 0 }] });
    const stones = [makeStone(0, 0, 26, 4), makeStone(300, 0, 26, 5)];
    for (let k = 0; k < 30; k++) tickStones(w, stones, 1);
    const zones: import('../../src/contracts/map-events').MapEventZone[] = [];
    stoneZones(stones, 1, zones);
    expect(zones.map(z => z.kind)).toEqual(['stone', 'stone']);
    expect(zones[0].v).toBeGreaterThan(40);
    expect(zones[0].v).toBeLessThan(60);
    expect(zones.map(z => z.n)).toEqual([4, 5]);
    for (let k = 0; k < 40; k++) tickStones(w, stones, 1);
    zones.length = 0;
    stoneZones(stones, 1, zones);
    expect(zones.map(z => z.v)).toEqual([255, 254]);
  });
});

describe('the wave-plan pact seam', () => {
  it('scales the budget, makes every pack at least magic, folds in the ambush and multiplies spawned life for its wave only', () => {
    const base = eventRun('hunted', { director: true });
    const plain = planWave(base.w, 2);
    const total = (p: typeof plain) => p.packs.reduce((n, pk) => n + pk.members.length, 0) + p.streamCount;
    const swarm = eventRun('hunted', { director: true });
    swarm.w.pact = pact({ monsters: 1.4 });
    expect(total(planWave(swarm.w, 2))).toBeGreaterThan(total(plain) * 1.25);
    expect(total(planWave(swarm.w, 3))).toBeLessThan(total(plain) * 1.6); // another wave: untouched by the pact (its own growth only)
    const moon = eventRun('hunted', { director: true });
    moon.w.pact = pact({ magic: true });
    expect(planWave(moon.w, 2).packs.every(pk => pk.rarity !== 'normal')).toBe(true);
    const amb = eventRun('hunted', { director: true });
    amb.w.pact = pact({ ambush: true });
    const p = planWave(amb.w, 2);
    expect(p.ambush).toBe(true);
    expect(p.streamCount).toBeLessThan(plain.streamCount);
    // Life: only monsters of the pact's wave.
    const { w } = eventRun('hunted', { director: true });
    w.pact = pact({ life: 1.6, wave: 2 });
    const a = spawnMonster(w, familyKind(w, 'bruiser'), 100, 100, { wave: 2 });
    const b = spawnMonster(w, familyKind(w, 'bruiser'), 100, 140, { wave: 3 });
    expect(w.monsters.maxLife[a] / w.monsters.maxLife[b]).toBeGreaterThan(1.3);
  });

  it('puts the wave quantity and rarity onto that wave\'s kills, and the resistance penalty into hitPlayer', () => {
    const { w, log } = eventRun('hunted', { director: true, vulnerable: true });
    w.pact = pact({ quantity: 40, rarity: 25, wave: 2, resist: 10 });
    w.players[0].stats.resist = w.players[0].stats.resist ?? ({} as never);
    const i = spawnMonster(w, familyKind(w, 'bruiser'), 40, 0, { wave: 2, animate: false });
    const j = spawnMonster(w, familyKind(w, 'bruiser'), 60, 0, { wave: 3, animate: false });
    damageMonster(w, i, 1e9, DT_FIRE, 0, 1.5, 0, 1, 0, 0, true, 1);
    damageMonster(w, j, 1e9, DT_FIRE, 0, 1.5, 0, 1, 0, 0, true, 1);
    const ctxs = log.killRolls.map(k => k.ctx);
    expect(ctxs.find(c => c.wave === 2)).toMatchObject({ quantityMore: 40, rarityMore: 25 });
    expect(ctxs.find(c => c.wave === 3)?.quantityMore).toBeUndefined();
    // Resistance: the same hit hurts more while the curse lasts.
    const p = w.players[0];
    p.invulnTime = 0;
    w.pactResist = 0;
    const life0 = p.life;
    hitPlayer(w, p, 50, 1, 'area');
    const plain = life0 - p.life;
    p.life = life0; p.invulnTime = 0;
    w.pactResist = 0.3;
    hitPlayer(w, p, 50, 1, 'area');
    expect(life0 - p.life).toBeGreaterThan(plain);
  });
});
