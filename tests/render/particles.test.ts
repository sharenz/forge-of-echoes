import { describe, expect, it } from 'vitest';
import { ParticlePool } from '../../src/render/particles';

/** Deterministic "random" source for the pool. */
function seq(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

const base = { x: 10, y: 20, color: [1, 0.5, 0] as const, speed: [100, 100] as [number, number], life: [1, 1] as [number, number], size: [1, 1] as [number, number] };

describe('ParticlePool', () => {
  it('emits the requested count with burst defaults', () => {
    const p = new ParticlePool(64, seq([0.5]));
    expect(p.emit({ ...base, count: 5 }, 3, 1, 4)).toBe(5);
    expect(p.count).toBe(5);
    expect(p.sprite[0]).toBe(3);
    expect(p.layer[0]).toBe(4);
    expect(p.isAdditive(0)).toBe(true);
    expect(p.emissive[0]).toBe(1);
    expect(p.sizeEnd[0]).toBeCloseTo(0.3);
    expect(p.r1[0]).toBe(1); // colorEnd defaults to color
  });

  it('respects angle and spread', () => {
    const p = new ParticlePool(8, seq([0.5]));
    p.emit({ ...base, count: 1, angle: Math.PI / 2, spread: 0 }, 0, 1, 4);
    expect(p.vx[0]).toBeCloseTo(0, 4);
    expect(p.vy[0]).toBeCloseTo(100, 4);
  });

  it('integrates velocity, gravity along screen y, and drag', () => {
    const p = new ParticlePool(8, seq([0.5]));
    p.emit({ ...base, count: 1, angle: 0, spread: 0, gravity: 50 }, 0, 1, 4);
    p.update(0.1);
    expect(p.x[0]).toBeCloseTo(20, 4);
    expect(p.vy[0]).toBeCloseTo(5, 4);
    expect(p.z[0]).toBe(0);

    const d = new ParticlePool(8, seq([0.5]));
    d.emit({ ...base, count: 1, angle: 0, spread: 0, drag: 0.5, life: [5, 5] }, 0, 1, 4);
    d.update(1);
    expect(d.vx[0]).toBeCloseTo(50, 3); // loses half its speed per second
  });

  it('flies fountain particles in z, lands on the ground and settles', () => {
    const p = new ParticlePool(8, seq([0.5]));
    p.emit({ ...base, count: 1, speed: [0, 0], upward: [100, 100], gravity: 400, life: [5, 5] }, 0, 1, 4);
    let maxZ = 0;
    for (let i = 0; i < 120; i++) {
      p.update(1 / 60);
      maxZ = Math.max(maxZ, p.z[0]);
      expect(p.z[0]).toBeGreaterThanOrEqual(0);
    }
    expect(maxZ).toBeGreaterThan(10);
    expect(p.z[0]).toBe(0);
    expect(p.vz[0]).toBe(0);
    expect(p.y[0]).toBeCloseTo(20); // z never moves the ground position
  });

  it('removes particles at the end of their life and keeps the pool dense', () => {
    const p = new ParticlePool(16, seq([0.5]));
    p.emit({ ...base, count: 3, life: [0.1, 0.1] }, 0, 1, 4);
    p.emit({ ...base, count: 3, life: [1, 1] }, 0, 1, 4);
    p.update(0.5);
    expect(p.count).toBe(3);
    for (let i = 0; i < p.count; i++) expect(p.life[i]).toBeGreaterThan(0.5);
    p.clear();
    expect(p.count).toBe(0);
  });

  it('recycles slots when full instead of growing', () => {
    const p = new ParticlePool(4, seq([0.5]));
    p.emit({ ...base, count: 10 }, 0, 1, 4);
    expect(p.count).toBe(4);
    p.emit({ ...base, count: 2, x: 99 }, 0, 1, 4);
    expect(p.count).toBe(4);
    expect(Array.from(p.x).filter((x) => x === 99)).toHaveLength(2);
  });
});
