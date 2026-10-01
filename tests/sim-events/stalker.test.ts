import { describe, expect, it } from 'vitest';
import { AILMENT_BIT } from '../../src/contracts/sim';
import { addProp } from '../../src/sim/props';
import { exposedMult } from '../../src/sim/map-events';
import { hunterKind, straggler } from '../../src/sim/events/kit';
import { monsterDef } from '../../src/sim/rosters';
import { STALKER_LIFE } from '../../src/data/progression/map-events';
import { applyDebuff } from '../../src/sim/debuffs';
import { eventRun, revealed, slay, step, until } from './helpers';

const stalkerOf = (w: ReturnType<typeof eventRun>['w']) => revealed(w, 'hunted');

describe('The Stalker', () => {
  it('shows an omen, then spawns a shimmering rare at the rim, far from every player', () => {
    const { w } = eventRun('hunted');
    const e = stalkerOf(w);
    expect(e.phase).toBe('warning');
    expect(w.monsters.count).toBe(0);
    expect(e.view.zones[0].kind).toBe('eye');
    expect(until(w, () => e.phase === 'active', 5)).toBe(true);
    const id = [...e.members][0];
    const i = w.monsters.slotOf(id);
    expect(w.monsters.rarity[i]).toBe(2); // rare
    expect(Math.hypot(w.monsters.x[i], w.monsters.y[i])).toBeGreaterThan(w.arenaRadius * 0.85);
    expect(w.mapEvent!.spectral.has(id)).toBe(true);
    expect(w.monsters.ailments[i] & AILMENT_BIT.spectral).toBe(AILMENT_BIT.spectral);
  });

  it('pounces on the straggler: a disc that locks 0.4 s before a leap, dodgeable by walking away', () => {
    const { w } = eventRun('hunted', { players: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 400, y: 200 }] });
    const e = stalkerOf(w);
    expect(straggler(w)!.id).toBe(3);
    until(w, () => e.phase === 'active');
    // The disc appears under the straggler.
    expect(until(w, () => w.areas.some(a => a.kind === 'leapWarning' && a.owner >= 0), 20)).toBe(true);
    const disc = w.areas.find(a => a.kind === 'leapWarning' && a.owner >= 0)!;
    expect(disc.duration).toBeCloseTo(1.2, 5);
    expect(disc.radius).toBe(34);
    expect(Math.hypot(disc.x - w.playerById[3]!.x, disc.y - w.playerById[3]!.y)).toBeLessThan(2);
    expect(disc.hurts).toBe('none'); // the damage is the landing, never the disc
    expect(disc.lockAt).toBeCloseTo(0.8, 5);
  });

  it('a landing on a player feeds it a Hunt stack; a landing on empty ground is a whiff that leaves it Exposed', () => {
    const { w, log } = eventRun('hunted', { vulnerable: true });
    const e = stalkerOf(w);
    until(w, () => e.phase === 'active');
    const p = w.players[0];
    const s = e.s as { hunt: number; whiffs: number; recover: number; pounce: unknown };
    // First pounce: stand still and take it.
    until(w, () => (e.s as { pounce: unknown }).pounce !== null, 20);
    const life0 = p.life;
    expect(until(w, () => (e.s as { pounce: unknown }).pounce === null, 3)).toBe(true);
    expect(s.hunt).toBe(1);
    expect(p.life).toBeLessThan(life0);
    // Second pounce: walk out of the disc after it locks.
    until(w, () => (e.s as { pounce: unknown }).pounce !== null, 30);
    const pounce = s.pounce as { t: number };
    until(w, () => pounce.t >= 0.85, 3);
    p.x += 120;
    expect(until(w, () => (e.s as { pounce: unknown }).pounce === null, 3)).toBe(true);
    expect(s.whiffs).toBe(1);
    step(w, 0.05);
    const id = [...e.members][0];
    const i = w.monsters.slotOf(id);
    expect(exposedMult(w, i)).toBeCloseTo(1.4, 5);
    expect(w.monsters.ailments[i] & AILMENT_BIT.exposed).toBe(AILMENT_BIT.exposed);
    expect(log.eventRolls).toHaveLength(0);
  });

  it('a pillar in the flight line takes the leap: a stunned whiff', () => {
    const { w } = eventRun('hunted', { vulnerable: true });
    const e = stalkerOf(w);
    until(w, () => e.phase === 'active');
    const id = [...e.members][0];
    const i = w.monsters.slotOf(id);
    // A wall of pillars all round the player: whichever way it comes from, the line is blocked.
    for (let k = 0; k < 24; k++) {
      const a = k / 24 * Math.PI * 2;
      addProp(w, 'pillar', Math.cos(a) * 60, Math.sin(a) * 60, 12, {});
    }
    void i;
    const s = e.s as { whiffs: number; recover: number; pounce: { blocked: boolean } | null };
    expect(until(w, () => s.whiffs > 0, 40)).toBe(true);
    expect(s.recover).toBeGreaterThan(2.5);
  });

  it('never starts a pounce on a held (rooted) player', () => {
    const { w } = eventRun('hunted', { vulnerable: true });
    const e = stalkerOf(w);
    until(w, () => e.phase === 'active');
    const s = e.s as { pounce: unknown; nextPounce: number };
    applyDebuff(w, w.players[0], 'rooted', 0, 'bone', 200);
    step(w, 25);
    expect(s.pounce).toBeNull();
  });

  it.each([[0, 1], [1, 2], [2, 2], [3, 3]])('a kill after %i whiffs pays grade %i once per living player', (whiffs, grade) => {
    const { w, log } = eventRun('hunted', { players: [{ x: 0, y: 0 }, { x: 30, y: 0 }] });
    const e = stalkerOf(w);
    until(w, () => e.phase === 'active');
    (e.s as { whiffs: number }).whiffs = whiffs;
    const id = [...e.members][0];
    slay(w, id);
    slay(w, id); // overkill cannot pay twice
    expect(e.phase).toBe('complete');
    expect(e.grade).toBe(grade);
    expect(log.eventRolls).toHaveLength(1);
    expect(w.outcomes.filter(o => o.t === 'eventComplete')).toEqual([{ t: 'eventComplete', kind: 'hunted', grade }]); // the Atlas point hook
    expect(log.eventRolls[0].ctx).toMatchObject({ kind: 'hunted', grade, tally: whiffs });
    expect(log.eventRolls[0].playerIds).toEqual([1, 2]);
  });

  it('Hunter\'s Patience and danger mods change the tally', () => {
    const { w, log } = eventRun('hunted', { eventModifiers: { whiffMultiplier: 2, tally: 1 } });
    const e = stalkerOf(w);
    until(w, () => e.phase === 'active');
    (e.s as { whiffs: number }).whiffs = 1;
    slay(w, [...e.members][0]);
    expect(log.eventRolls[0].ctx.tally).toBe(3);
    expect(log.eventRolls[0].ctx.grade).toBe(3);
  });

  it('turns rogue after 120 s and pays nothing', () => {
    const { w, log } = eventRun('hunted');
    const e = stalkerOf(w);
    until(w, () => e.phase === 'active');
    const id = [...e.members][0];
    step(w, 121);
    expect(e.phase).toBe('failed');
    expect(e.grade).toBe(0);
    slay(w, id);
    expect(log.eventRolls).toHaveLength(0);
  });

  it('a Warded Hunts stalker rolls a proof mod', () => {
    const { w } = eventRun('hunted', { eventModifiers: { stalkerProof: true } });
    const e = stalkerOf(w);
    until(w, () => e.phase === 'active');
    const i = w.monsters.slotOf([...e.members][0]);
    expect(w.monsters.mods[i] & 128).toBe(128); // fireProof on an Ashen map
  });

  it('the Stalker is a sturdy hunt: STALKER_LIFE times a rare of its kind, stretched by the lens', () => {
    const plain = eventRun('hunted', { wave: 2 });
    const a = revealed(plain.w, 'hunted');
    step(plain.w, 3.2);
    const ia = plain.w.monsters.slotOf((a.s as { id: number }).id);
    const lensed = eventRun('hunted', { wave: 2, eventModifiers: { stalkerLife: 1.1 } });
    const b = revealed(lensed.w, 'hunted');
    step(lensed.w, 3.2);
    const ib = lensed.w.monsters.slotOf((b.s as { id: number }).id);
    expect(ia).toBeGreaterThanOrEqual(0);
    expect(lensed.w.monsters.maxLife[ib] / plain.w.monsters.maxLife[ia]).toBeCloseTo(1.1, 3);
    const base = monsterDef(hunterKind(plain.w)).life;
    expect(plain.w.monsters.maxLife[ia]).toBeGreaterThan(base * STALKER_LIFE);
  });
});
