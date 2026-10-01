// Per-viewer event classes: own events always, loot only to its owner, run-wide cues to all, the rest by AOI.
import { describe, expect, it } from 'vitest';
import { AOI_HALF_WIDTH } from '../../src/contracts/net';
import type { SimEvent } from '../../src/contracts/sim';
import { EventOutbox, eventClass } from '../../src/server/event-filter';

const far = AOI_HALF_WIDTH + 400;

describe('event classes', () => {
  it('delivers the viewer’s own events wherever they happen, and drops only to their owner', () => {
    const hit = (playerId: number, x: number, crit = false): SimEvent =>
      ({ t: 'hit', playerId, x, y: 0, amount: 5, damageType: 'fire', crit, target: 'monster', killed: false });
    expect(eventClass(hit(1, far), 1, 0, 0)).toBe(1);
    expect(eventClass(hit(2, far), 1, 0, 0)).toBe(-1);
    expect(eventClass(hit(2, 10), 1, 0, 0)).toBe(2);
    expect(eventClass(hit(2, 10, true), 1, 0, 0)).toBe(1);
    const drop: SimEvent = { t: 'dropSpawn', owner: 2, tone: 'rare', x: 0, y: 0, label: 'Grave Coil' };
    expect(eventClass(drop, 2, 0, 0)).toBe(0);
    expect(eventClass(drop, 1, 0, 0)).toBe(-1);
    expect(eventClass({ t: 'notEnoughFocus', playerId: 2 }, 1, 0, 0)).toBe(-1);
    expect(eventClass({ t: 'waveTell', wave: 2, families: ['ashling'], lieutenant: false, boss: false }, 1, far, far)).toBe(0);
    expect(eventClass({ t: 'playerDeath', playerId: 3, x: far, y: 0 }, 1, 0, 0)).toBe(0);
    expect(eventClass({ t: 'death', kind: 'cinderMatriarch', rarity: 4, x: far, y: 0, facing: 1, damageType: 'fire' }, 1, 0, 0)).toBe(0);
    expect(eventClass({ t: 'death', kind: 'ashling', rarity: 0, x: far, y: 0, facing: 1, damageType: 'fire' }, 1, 0, 0)).toBe(-1);
  });

  it('sends public ground items (owner 0) to everyone in view, and a pickup always to whoever picked it up', () => {
    const dropped: SimEvent = { t: 'dropSpawn', owner: 0, tone: 'rare', x: 10, y: 0, label: 'Grave Coil' };
    expect(eventClass(dropped, 1, 0, 0)).toBe(0);
    expect(eventClass(dropped, 2, 0, 0)).toBe(0);
    expect(eventClass(dropped, 1, far, 0)).toBe(-1);
    const taken: SimEvent = { t: 'pickup', owner: 0, playerId: 2, tone: 'rare', x: 10, y: 0, label: 'Grave Coil' };
    expect(eventClass(taken, 1, 0, 0)).toBe(0);
    expect(eventClass(taken, 1, far, 0)).toBe(-1);
    expect(eventClass(taken, 2, far, 0)).toBe(0);
    // Instanced loot stays private, even in view.
    const own: SimEvent = { t: 'pickup', owner: 3, playerId: 3, tone: 'magic', x: 0, y: 0, label: 'Wand' };
    expect(eventClass(own, 3, 0, 0)).toBe(0);
    expect(eventClass(own, 1, 0, 0)).toBe(-1);
  });

  it('debuff cues: the viewer’s own debuffs, cleanses and pulls always (never capped); others’ and shield blocks only in view', () => {
    const debuff = (playerId: number, x: number): SimEvent => ({ t: 'debuff', playerId, debuff: 'rooted', stacks: 1, x, y: 0 });
    expect(eventClass(debuff(1, far), 1, 0, 0)).toBe(0);
    expect(eventClass(debuff(2, 10), 1, 0, 0)).toBe(1);
    expect(eventClass(debuff(2, far), 1, 0, 0)).toBe(-1);
    const cleanse = (playerId: number, x: number): SimEvent => ({ t: 'cleanse', playerId, debuffs: ['burning', 'bleeding'], x, y: 0 });
    expect(eventClass(cleanse(1, far), 1, 0, 0)).toBe(0);
    expect(eventClass(cleanse(2, 10), 1, 0, 0)).toBe(1);
    expect(eventClass(cleanse(2, far), 1, 0, 0)).toBe(-1);
    // The viewer's own chain-hook drag feeds their prediction: it must arrive even from far away.
    const pull = (playerId: number, fromX: number, toX: number): SimEvent => ({ t: 'pull', playerId, fromX, fromY: 0, toX, toY: 0 });
    expect(eventClass(pull(1, far, far + 40), 1, 0, 0)).toBe(0);
    expect(eventClass(pull(2, far, 10), 1, 0, 0)).toBe(1);
    expect(eventClass(pull(2, 10, far), 1, 0, 0)).toBe(1);
    expect(eventClass(pull(2, far, far + 40), 1, 0, 0)).toBe(-1);
    expect(eventClass({ t: 'blocked', x: 10, y: 0 }, 1, 0, 0)).toBe(1);
    expect(eventClass({ t: 'blocked', x: far, y: 0 }, 1, 0, 0)).toBe(-1);
    // The new rosters' attacks are ordinary monster attacks: in view only.
    expect(eventClass({ t: 'monsterAttack', kind: 'varkus', x: 10, y: 0, attack: 'whirl' }, 1, 0, 0)).toBe(1);
    expect(eventClass({ t: 'monsterAttack', kind: 'frostWeaver', x: far, y: 0, attack: 'web' }, 1, 0, 0)).toBe(-1);
    // A congested packet keeps the viewer's own debuff cues over a flood of cosmetic ones.
    const box = new EventOutbox();
    const flood: SimEvent[] = [];
    for (let k = 0; k < 100; k++) flood.push({ t: 'blocked', x: 0, y: 0 });
    flood.push(debuff(1, 0), pull(1, 0, 20));
    box.collect(flood, 1, 0, 0);
    const out = box.take(10)!;
    expect(out.filter((e) => e.t === 'debuff' || e.t === 'pull')).toHaveLength(2);
    expect(out.filter((e) => e.t === 'blocked')).toHaveLength(10);
  });

  it('fails closed on an event type it does not know (a sim ahead of this build): nobody gets it', () => {
    const unknown = { t: 'somethingNew', playerId: 1, x: 0, y: 0 } as unknown as SimEvent;
    expect(eventClass(unknown, 1, 0, 0)).toBe(-1);
    expect(eventClass(unknown, 2, 0, 0)).toBe(-1);
    const box = new EventOutbox();
    box.collect([unknown, { t: 'waveStart', wave: 2 }], 1, 0, 0);
    expect(box.take()).toEqual([{ t: 'waveStart', wave: 2 }]);
  });

  it('caps a packet by priority, keeping class 0 and the chronological order', () => {
    const box = new EventOutbox();
    const events: SimEvent[] = [];
    for (let k = 0; k < 300; k++) events.push({ t: 'projectileEnd', kind: 'emberLance', x: k % 50, y: 0 });
    events.splice(150, 0, { t: 'waveStart', wave: 3 });
    for (let k = 0; k < 20; k++) events.push({ t: 'monsterAttack', kind: 'ashling', x: 0, y: 0, attack: 'melee' });
    box.collect(events, 1, 0, 0);
    const out = box.take(50)!;
    expect(out).toHaveLength(51);
    expect(out.filter((e) => e.t === 'monsterAttack')).toHaveLength(20);
    expect(out.filter((e) => e.t === 'projectileEnd')).toHaveLength(30);
    expect(out.some((e) => e.t === 'waveStart')).toBe(true);
    const iWave = out.findIndex((e) => e.t === 'waveStart');
    const iAttack = out.findIndex((e) => e.t === 'monsterAttack');
    expect(iWave).toBeLessThan(iAttack);
    expect(box.take()).toBeNull();
  });
});
