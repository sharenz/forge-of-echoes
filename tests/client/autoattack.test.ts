// Auto-attack target choice: nearest to the cursor among monsters within reach of the player.
import { describe, expect, it } from 'vitest';
import { AUTO_ATTACK_RANGE, MAX_AIM_LEAD, leadAim, monsterPosition, pickAutoTarget } from '../../src/client/autoattack';
import { SNAPSHOT_EVERY } from '../../src/contracts/net';
import { SIM_DT } from '../../src/contracts/sim';
import { addMonster, monsterStore } from './helpers';

describe('pickAutoTarget', () => {
  it('returns -1 without monsters in range', () => {
    const m = monsterStore();
    expect(pickAutoTarget(m, 1, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(-1);
    addMonster(m, AUTO_ATTACK_RANGE + 5, 0);
    expect(pickAutoTarget(m, 1, { x: 0, y: 0 }, { x: 300, y: 0 })).toBe(-1);
  });

  it('picks the monster closest to the cursor, not to the player', () => {
    const m = monsterStore();
    const near = addMonster(m, 20, 0);
    const byCursor = addMonster(m, 0, 200);
    expect(pickAutoTarget(m, 1, { x: 0, y: 0 }, { x: 0, y: 190 })).toBe(byCursor);
    expect(pickAutoTarget(m, 1, { x: 0, y: 0 }, { x: 30, y: 0 })).toBe(near);
  });

  it('skips dead monsters and the hideout training dummy', () => {
    const m = monsterStore();
    addMonster(m, 10, 0, 'trainingDummy');
    const dead = addMonster(m, 12, 0);
    m.alive[dead] = 0;
    expect(pickAutoTarget(m, 1, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(-1);
    const live = addMonster(m, 100, 0);
    expect(pickAutoTarget(m, 1, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(live);
  });

  it('uses the interpolated render position (alpha between prev and current)', () => {
    const m = monsterStore();
    // Moving from (300, 0) — out of range — to (200, 0): at alpha 0 it is out of reach, at alpha 1 in reach.
    const i = addMonster(m, 200, 0, 'ashling', { x: 300, y: 0 });
    expect(pickAutoTarget(m, 0, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(-1);
    expect(pickAutoTarget(m, 1, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(i);
    const at = monsterPosition(m, i, 0.5, { x: 0, y: 0 });
    expect(at).toEqual({ x: 250, y: 0 });
  });
});

describe('leadAim', () => {
  const interval = SNAPSHOT_EVERY * SIM_DT;

  it('aims straight at a monster standing still', () => {
    const m = monsterStore();
    const i = addMonster(m, 120, 40);
    expect(leadAim(m, i, 1, { x: 0, y: 0 }, 0.2, 420, { x: 0, y: 0 })).toEqual({ x: 120, y: 40 });
  });

  it('leads a sideways mover by its velocity over the delay plus the flight time', () => {
    const m = monsterStore();
    // Moving +y at 60 units/s, 200 units in front of the player.
    const i = addMonster(m, 200, 0, 'ashling', { x: 200, y: -60 * interval });
    const delay = 0.15;
    const speed = 400;
    const out = leadAim(m, i, 1, { x: 0, y: 0 }, delay, speed, { x: 0, y: 0 });
    const t = delay + 200 / speed;
    expect(out.x).toBeCloseTo(200);
    expect(out.y).toBeCloseTo(60 * t, 3);
  });

  it('never leads further than MAX_AIM_LEAD (leaps, teleports)', () => {
    const m = monsterStore();
    const i = addMonster(m, 100, 0, 'ashling', { x: 100, y: -400 * interval });
    const out = leadAim(m, i, 1, { x: 0, y: 0 }, 0.5, 300, { x: 0, y: 0 });
    expect(Math.hypot(out.x - 100, out.y)).toBeCloseTo(MAX_AIM_LEAD, 3);
  });
});
