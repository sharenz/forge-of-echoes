// Click-to-pick-up walking: steering toward the item, arrival inside PICKUP_APPROACH, and every way it ends early.
import { describe, expect, it } from 'vitest';
import { PICKUP_REACH } from '../../src/contracts/sim';
import { AutoWalk, PICKUP_APPROACH, WALK_STALL_TICKS, findDrop, inPickupReach } from '../../src/client/autowalk';
import { drop } from './helpers';

const out = () => ({ moveX: 0, moveY: 0 });

describe('AutoWalk', () => {
  it('stops short of the server reach so the trailing server position is in reach too', () => {
    expect(PICKUP_APPROACH).toBeLessThan(PICKUP_REACH);
    expect(inPickupReach({ x: 0, y: 0 }, { x: PICKUP_APPROACH, y: 0 })).toBe(true);
    expect(inPickupReach({ x: 0, y: 0 }, { x: PICKUP_APPROACH + 1, y: 0 })).toBe(false);
  });

  it('steers straight at the item every tick and arrives inside PICKUP_APPROACH', () => {
    const w = new AutoWalk();
    const drops = [drop(7, 300, 400)];
    w.start(7);
    expect(w.active).toBe(true);
    const o = out();
    expect(w.step({ x: 0, y: 0 }, drops, false, o)).toBe('walking');
    expect(o.moveX).toBeCloseTo(0.6);
    expect(o.moveY).toBeCloseTo(0.8);
    // Walk along the line: still walking until inside the approach radius.
    const at = (d: number) => ({ x: 300 - 0.6 * d, y: 400 - 0.8 * d });
    expect(w.step(at(200), drops, false, out())).toBe('walking');
    expect(w.step(at(PICKUP_APPROACH + 2), drops, false, out())).toBe('walking');
    expect(w.step(at(PICKUP_APPROACH - 2), drops, false, out())).toBe('arrived');
    expect(w.active).toBe(false);
    expect(w.step(at(0), drops, false, out())).toBe('idle');
  });

  it('any movement key cancels it (WASD wins), and so do the item vanishing and death', () => {
    const w = new AutoWalk();
    const drops = [drop(7, 300, 0)];
    w.start(7);
    expect(w.step({ x: 0, y: 0 }, drops, true, out())).toBe('cancelled');
    expect(w.lastCancel).toBe('input');

    w.start(7);
    expect(w.step({ x: 0, y: 0 }, [], false, out())).toBe('cancelled');
    expect(w.lastCancel).toBe('gone');

    w.start(7);
    expect(w.step(null, drops, false, out())).toBe('cancelled');
    expect(w.lastCancel).toBe('dead');
    expect(w.active).toBe(false);
  });

  it('gives up when it stops getting closer (blocked by a wall)', () => {
    const w = new AutoWalk();
    const drops = [drop(7, 300, 0)];
    w.start(7);
    let r = w.step({ x: 0, y: 0 }, drops, false, out());
    for (let i = 0; i < WALK_STALL_TICKS && r === 'walking'; i++) r = w.step({ x: 0, y: 0 }, drops, false, out());
    expect(r).toBe('walking');
    expect(w.step({ x: 0, y: 0 }, drops, false, out())).toBe('cancelled');
    expect(w.lastCancel).toBe('stuck');
  });

  it('findDrop looks the item up by id', () => {
    const drops = [drop(1, 0, 0), drop(9, 5, 5)];
    expect(findDrop(drops, 9)?.x).toBe(5);
    expect(findDrop(drops, 2)).toBeNull();
  });
});
