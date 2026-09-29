import { describe, expect, it } from 'vitest';
import type { Dir4 } from '../../src/contracts/sim';
import { FACING_HYSTERESIS, HORIZONTAL_HALF_WIDTH, facingFromVector, spriteDir } from '../../src/present/direction';

const at = (deg: number): [number, number] => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];

describe('facingFromVector', () => {
  it('picks the obvious direction for axis-aligned vectors (y down = south)', () => {
    expect(facingFromVector(1, 0, 'north')).toBe('east');
    expect(facingFromVector(-1, 0, 'north')).toBe('west');
    expect(facingFromVector(0, 1, 'east')).toBe('south');
    expect(facingFromVector(0, -1, 'east')).toBe('north');
  });

  it('keeps the current facing for tiny vectors', () => {
    expect(facingFromVector(0, 0, 'west')).toBe('west');
    expect(facingFromVector(1e-6, -1e-6, 'south')).toBe('south');
  });

  it('prefers the side view on exact diagonals', () => {
    for (const deg of [45, 135, -45, -135]) {
      const [x, y] = at(deg);
      const d = facingFromVector(x, y, deg > 90 || deg < -90 ? 'east' : 'west');
      expect(d === 'east' || d === 'west').toBe(true);
    }
  });

  it('does not flicker when the vector jitters around a sector boundary', () => {
    const boundary = (HORIZONTAL_HALF_WIDTH * 180) / Math.PI; // east/south boundary in degrees
    let facing: Dir4 = 'east';
    const seen = new Set<Dir4>();
    for (let k = 0; k < 200; k++) {
      const jitter = Math.sin(k * 1.7) * ((FACING_HYSTERESIS * 180) / Math.PI) * 0.8;
      const [x, y] = at(boundary + jitter);
      facing = facingFromVector(x, y, facing);
      seen.add(facing);
    }
    expect([...seen]).toEqual(['east']);
  });

  it('switches once the vector is clearly past the boundary plus the hysteresis', () => {
    const boundary = HORIZONTAL_HALF_WIDTH;
    const [x1, y1] = [Math.cos(boundary + FACING_HYSTERESIS * 0.5), Math.sin(boundary + FACING_HYSTERESIS * 0.5)];
    expect(facingFromVector(x1, y1, 'east')).toBe('east');
    const [x2, y2] = [Math.cos(boundary + FACING_HYSTERESIS * 1.2), Math.sin(boundary + FACING_HYSTERESIS * 1.2)];
    expect(facingFromVector(x2, y2, 'east')).toBe('south');
    // …and coming back needs the same margin on the other side.
    const [x3, y3] = [Math.cos(boundary - FACING_HYSTERESIS * 0.5), Math.sin(boundary - FACING_HYSTERESIS * 0.5)];
    expect(facingFromVector(x3, y3, 'south')).toBe('south');
  });

  it('turns around fully on a reversal regardless of hysteresis', () => {
    expect(facingFromVector(-1, 0.05, 'east')).toBe('west');
    expect(facingFromVector(0.02, -1, 'south')).toBe('north');
  });
});

describe('spriteDir', () => {
  it('mirrors west onto the east set', () => {
    expect(spriteDir('west')).toBe('east');
    expect(spriteDir('east')).toBe('east');
    expect(spriteDir('south')).toBe('south');
    expect(spriteDir('north')).toBe('north');
  });
});
