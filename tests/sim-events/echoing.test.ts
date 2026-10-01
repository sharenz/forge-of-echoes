import { describe, expect, it } from 'vitest';
import { ELITE_BIT } from '../../src/contracts/sim';
import { ECHO_FIRST_DELAY, ECHO_GATE_RADIUS, ECHO_GATE_WEIGHT, ECHO_INTERVAL, ECHO_LIFE, ECHO_SPEED } from '../../src/data/progression/map-events';
import { driveEventMonster } from '../../src/sim/map-events';
import { spawnMonster } from '../../src/sim/spawn';
import { MFLAG } from '../../src/sim/stores';
import type { World } from '../../src/sim/world';
import { eventRun, revealed, slay, step, until } from './helpers';

/** Kill `n` monsters at spread-out points so the kill log has something to replay; the rare ones carry mods. */
function fillLog(w: World, n: number, rareAt = -1): void {
  for (let k = 0; k < n; k++) {
    const a = k * 0.9;
    const rare = k === rareAt;
    const i = spawnMonster(w, 'ashling', Math.cos(a) * 400, Math.sin(a) * 400, rare ? { rarity: 'rare', mods: ELITE_BIT.fireProof | ELITE_BIT.fierce, animate: false } : { animate: false });
    slay(w, w.monsters.id[i]);
  }
}

/** A spot on the far ring of the arena that is as far as possible from the anchor and the echo spawn points. */
function hide(w: World, e: ReturnType<typeof revealed>): void {
  const anchor = (e.s as { anchor: { x: number; y: number } }).anchor;
  let best = { x: 0, y: 0 }, bestD = -1;
  for (let k = 0; k < 32; k++) {
    const a = k / 32 * Math.PI * 2, x = Math.cos(a) * (w.arenaRadius - 40), y = Math.sin(a) * (w.arenaRadius - 40);
    let d = Math.hypot(x - anchor.x, y - anchor.y);
    for (const q of (e.s as { queue: { x: number; y: number }[] }).queue) d = Math.min(d, Math.hypot(x - q.x, y - q.y));
    for (let j = 0; j < 8; j++) d = Math.min(d, Math.hypot(x - Math.cos(j * 0.9) * 400, y - Math.sin(j * 0.9) * 400), Math.hypot(x - anchor.x, y - anchor.y));
    if (d > bestD) { bestD = d; best = { x, y }; }
  }
  w.players[0].x = best.x; w.players[0].y = best.y;
}

const open = (w: World, e: ReturnType<typeof revealed>) => {
  const anchor = (e.s as { anchor: { x: number; y: number } }).anchor;
  w.players[0].x = anchor.x + 20; w.players[0].y = anchor.y;
};

describe('The Echoing', () => {
  it('places a dormant anchor away from the players; it is optional and only opens when approached', () => {
    const { w } = eventRun('echoRift', { wave: 2 });
    const e = revealed(w, 'echoRift');
    const anchor = (e.s as { anchor: { x: number; y: number } }).anchor;
    expect(e.phase).toBe('available');
    expect(Math.hypot(anchor.x, anchor.y)).toBeGreaterThanOrEqual(250);
    expect(Math.hypot(anchor.x, anchor.y)).toBeLessThanOrEqual(w.arenaRadius - 200);
    step(w, 5);
    expect(e.phase).toBe('available');
    expect(w.monsters.count).toBe(0);
    expect(e.view.zones[0].kind).toBe('anchor');
  });

  it('closes unopened at the boss wave', () => {
    const { w } = eventRun('echoRift', { wave: 2 });
    const e = revealed(w, 'echoRift');
    w.director.wave = w.config.waves.bossWave;
    step(w, 0.1);
    expect(w.mapEvent!.live).not.toContain(e);
    expect(e.finished).toBe(true);
  });

  it('replays the kill log: echoes appear oldest first at the original death spots, ECHO_INTERVAL apart, with ECHO_LIFE of a normal monster and the rare\'s mods', () => {
    const { w } = eventRun('echoRift');
    fillLog(w, 8, 3);
    expect(w.mapEvent!.killLog).toHaveLength(8);
    const e = revealed(w, 'echoRift');
    open(w, e);
    step(w, 0.1);
    expect(e.phase).toBe('warning');
    expect(until(w, () => e.phase === 'active', 4)).toBe(true);
    const s = e.s as { queue: { x: number; y: number; at: number; kind: string; rarity: string; spawned: boolean }[]; echoes: Map<number, boolean>; total: number };
    expect(s.total).toBe(8);
    expect(s.queue.map(q => q.at)).toEqual(Array.from({ length: 8 }, (_, k) => ECHO_FIRST_DELAY + k * ECHO_INTERVAL));
    expect(s.queue[3].rarity).toBe('rare');
    step(w, 3.2);
    expect(s.echoes.size).toBe(1);
    const id = [...s.echoes.keys()][0];
    const i = w.monsters.slotOf(id);
    // The first echo stands at (or, when a player is near, pushed off) the first death position.
    expect(Math.hypot(w.monsters.x[i] - 400, w.monsters.y[i])).toBeLessThan(150);
    expect(w.monsters.spawnTime[i]).toBeGreaterThan(0); // shimmering
    expect(w.monsters.maxLife[i]).toBeLessThan(20 * ECHO_LIFE * 1.6); // ECHO_LIFE of an Ashling's life
    expect(w.mapEvent!.spectral.has(id)).toBe(true);
    // The rare's echo (4th) keeps its mods.
    until(w, () => s.echoes.size >= 1 && s.queue[3].spawned, 20);
    const rareId = [...s.echoes.keys()].find(k => s.echoes.get(k));
    expect(rareId).toBeDefined();
    expect(w.monsters.mods[w.monsters.slotOf(rareId!)] & ELITE_BIT.fireProof).toBe(ELITE_BIT.fireProof);
    expect(w.monsters.rarity[w.monsters.slotOf(rareId!)]).toBe(2);
  });

  it('pads a short log to six ordinary echoes and never with rares', () => {
    const { w } = eventRun('echoRift');
    fillLog(w, 2);
    const e = revealed(w, 'echoRift');
    open(w, e);
    until(w, () => e.phase === 'active', 4);
    const s = e.s as { queue: { rarity: string }[]; total: number };
    expect(s.total).toBe(6);
    expect(s.queue.every(q => q.rarity === 'normal')).toBe(true);
  });

  it('caps the train at twelve, keeping the newest', () => {
    const { w } = eventRun('echoRift');
    fillLog(w, 20);
    const e = revealed(w, 'echoRift');
    open(w, e);
    until(w, () => e.phase === 'active', 4);
    expect((e.s as { total: number }).total).toBe(12);
  });

  it('an echo walks home at ECHO_SPEED, fights a player within 110 u, and reaching the anchor adds Resonance', () => {
    const { w } = eventRun('echoRift');
    fillLog(w, 6);
    const e = revealed(w, 'echoRift');
    open(w, e);
    const s = e.s as { anchor: { x: number; y: number }; echoes: Map<number, boolean>; resonance: number };
    // Walk the player far away so the echo ignores her.
    until(w, () => s.echoes.size > 0, 10);
    hide(w, e);
    const id = [...s.echoes.keys()][0];
    const i = w.monsters.slotOf(id);
    expect(w.monsters.speed[i]).toBe(ECHO_SPEED);
    expect(driveEventMonster(w, i, w.players[0])).toBe(true); // it is walking
    // Now stand right beside it: the brain runs instead.
    w.players[0].x = w.monsters.x[i] + 30; w.players[0].y = w.monsters.y[i];
    step(w, 0.05);
    expect(driveEventMonster(w, i, w.players[0])).toBe(false);
    // Back out of the fight and let it go home.
    hide(w, e);
    expect(until(w, () => !s.echoes.has(id), 60)).toBe(true);
    expect(s.resonance).toBeGreaterThanOrEqual(1);
    expect(w.monsters.slotOf(id)).toBeLessThan(0); // gone: no corpse, no loot
  });

  it('intercepting every echo seals the rift with Gold; the payout carries the tally', () => {
    const { w, log } = eventRun('echoRift');
    fillLog(w, 6);
    const e = revealed(w, 'echoRift');
    open(w, e);
    const s = e.s as { echoes: Map<number, boolean>; queue: { spawned: boolean }[] };
    let guard = 0;
    while (e.phase !== 'complete' && guard++ < 4000) {
      step(w, 0.25);
      for (const id of [...s.echoes.keys()]) slay(w, id);
    }
    expect(e.phase).toBe('complete');
    expect(e.grade).toBe(3);
    expect(log.eventRolls).toHaveLength(1);
    expect(log.eventRolls[0].ctx).toMatchObject({ kind: 'echoRift', grade: 3, tally: 6 });
  });

  it('half intercepted is Bronze; six returns erupt the rift, then a Rift Warden pays Bronze only if it dies', () => {
    const { w, log } = eventRun('echoRift');
    fillLog(w, 6);
    const e = revealed(w, 'echoRift');
    open(w, e);
    const s = e.s as { anchor: { x: number; y: number }; stage: string; resonance: number; wardenId: number };
    until(w, () => e.phase === 'active', 5);
    hide(w, e); // never engage
    expect(until(w, () => s.stage === 'erupt', 80)).toBe(true);
    expect(s.resonance).toBe(6);
    const nova = w.areas.find(a => a.kind === 'slamWarning' && a.radius === 150)!;
    expect(nova.duration).toBe(5);
    expect(until(w, () => s.wardenId !== 0, 20)).toBe(true);
    const i = w.monsters.slotOf(s.wardenId);
    expect(w.monsters.rarity[i]).toBe(2);
    expect(log.eventRolls).toHaveLength(0);
    slay(w, s.wardenId);
    expect(e.phase).toBe('complete');
    expect(e.grade).toBe(1);
    expect(log.eventRolls).toHaveLength(1);
  });

  it('Resonant Rift tolerates two more returns and raises echo life', () => {
    const { w } = eventRun('echoRift', { eventModifiers: { echoTolerance: 2, echoLife: 2 } });
    fillLog(w, 6);
    const e = revealed(w, 'echoRift');
    open(w, e);
    const s = e.s as { anchor: { x: number; y: number }; stage: string; resonance: number; echoes: Map<number, boolean> };
    until(w, () => e.phase === 'active', 5);
    hide(w, e);
    until(w, () => s.echoes.size > 0, 10);
    const i = w.monsters.slotOf([...s.echoes.keys()][0]);
    expect(w.monsters.maxLife[i]).toBeGreaterThan(20 * ECHO_LIFE * 0.9);
    expect(until(w, () => e.phase !== 'active' || s.stage !== 'recall', 80)).toBe(true);
    expect(s.resonance).toBe(6);
    expect(s.stage).toBe('done'); // 6 < 6 + 2: sealed
  });

  it('skins: ossuary echoes pass through monsters, coliseum echoes come in chained pairs, ashen ones light a pool first', () => {
    const oss = eventRun('echoRift', { theme: 'rimedOssuary' });
    fillLog(oss.w, 6);
    const eo = revealed(oss.w, 'echoRift'); open(oss.w, eo);
    until(oss.w, () => (eo.s as { echoes: Map<number, boolean> }).echoes.size > 0, 10);
    const io = oss.w.monsters.slotOf([...(eo.s as { echoes: Map<number, boolean> }).echoes.keys()][0]);
    expect(oss.w.monsters.flags[io] & MFLAG.ghost).toBe(MFLAG.ghost);

    const col = eventRun('echoRift', { theme: 'ironColiseum' });
    fillLog(col.w, 6);
    const ec = revealed(col.w, 'echoRift'); open(col.w, ec);
    const cs = ec.s as { echoes: Map<number, boolean>; pairs: Map<number, number> };
    until(col.w, () => cs.echoes.size >= 2, 10);
    expect(cs.pairs.size).toBe(2);
    const [a, b] = [...cs.pairs.keys()];
    expect(cs.pairs.get(a)).toBe(b);
    slay(col.w, a);
    expect(col.w.monsters.chillTime[col.w.monsters.slotOf(b)]).toBeGreaterThan(0); // killing one slows the other

    const ash = eventRun('echoRift');
    fillLog(ash.w, 6);
    const ea = revealed(ash.w, 'echoRift'); open(ash.w, ea);
    until(ash.w, () => ash.w.areas.some(x => x.kind === 'firePool'), 6);
    const pool = ash.w.areas.find(x => x.kind === 'firePool')!;
    expect(pool.tickTimer).toBeGreaterThan(0.95); // fairness F1: no damage for a full second
    expect(ash.w.areas.some(x => x.kind === 'echoMark')).toBe(true);
  });

  it('echoes never drop loot and are credited to the event only', () => {
    const { w, log } = eventRun('echoRift');
    fillLog(w, 6);
    const before = log.killRolls.length;
    const e = revealed(w, 'echoRift');
    open(w, e);
    const s = e.s as { echoes: Map<number, boolean> };
    until(w, () => s.echoes.size > 0, 10);
    slay(w, [...s.echoes.keys()][0]);
    expect(log.killRolls.length).toBe(before + 0);
  });

  it('an echo cut off on the way counts whole, one caught at the door (within ECHO_GATE_RADIUS of the anchor) counts ECHO_GATE_WEIGHT', () => {
    const { w } = eventRun('echoRift');
    fillLog(w, 6);
    const e = revealed(w, 'echoRift');
    open(w, e);
    const s = e.s as { anchor: { x: number; y: number }; echoes: Map<number, boolean>; weighted: number; intercepted: number };
    until(w, () => s.echoes.size >= 2, 20);
    const [far, near] = [...s.echoes.keys()];
    const ia = w.monsters.slotOf(far), ib = w.monsters.slotOf(near);
    w.monsters.x[ia] = s.anchor.x + ECHO_GATE_RADIUS + 60; w.monsters.y[ia] = s.anchor.y;
    w.monsters.x[ib] = s.anchor.x + ECHO_GATE_RADIUS - 60; w.monsters.y[ib] = s.anchor.y;
    slay(w, far);
    slay(w, near);
    expect(s.intercepted).toBe(2);
    expect(s.weighted).toBeCloseTo(1 + ECHO_GATE_WEIGHT, 5);
  });
});
