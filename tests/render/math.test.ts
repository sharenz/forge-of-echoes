import { describe, expect, it } from 'vitest';
import { hexToRgb, lightFalloff, lightSeed, packRGBA, unpackRGBA } from '../../src/render/color';
import { InstanceList, STRIDE, STRIDE_BYTES } from '../../src/render/instances';
import { radixSortIndices, sortKey } from '../../src/render/sort';

describe('colour packing', () => {
  it('packs little-endian RGBA8 with rounding and clamping', () => {
    const v = packRGBA(1, 0.5, 0, 1);
    expect(v & 255).toBe(255);
    expect((v >>> 8) & 255).toBe(128);
    expect((v >>> 16) & 255).toBe(0);
    expect(v >>> 24).toBe(255);
    expect(packRGBA(2, -1, NaN, 0.25)).toBe(packRGBA(1, 0, 0, 0.25));
    expect(packRGBA(1, 1, 1, 1)).toBe(0xffffffff);
  });

  it('round-trips through unpack', () => {
    const [r, g, b, a] = unpackRGBA(packRGBA(0.2, 0.4, 0.6, 0.8));
    expect(r).toBeCloseTo(0.2, 2);
    expect(g).toBeCloseTo(0.4, 2);
    expect(b).toBeCloseTo(0.6, 2);
    expect(a).toBeCloseTo(0.8, 2);
  });

  it('parses hex colours', () => {
    expect(hexToRgb('#ff8000')).toEqual([1, 128 / 255, 0]);
    expect(hexToRgb('#fff')).toEqual([1, 1, 1]);
  });
});

describe('light falloff', () => {
  it('is 1 at the centre, 0 at and beyond the radius, and monotonically decreasing', () => {
    expect(lightFalloff(0, 50)).toBe(1);
    expect(lightFalloff(50, 50)).toBe(0);
    expect(lightFalloff(80, 50)).toBe(0);
    expect(lightFalloff(10, 0)).toBe(0);
    let prev = 1;
    for (let d = 1; d <= 50; d++) {
      const f = lightFalloff(d, 50);
      expect(f).toBeLessThanOrEqual(prev);
      prev = f;
    }
  });

  it('has a smooth (zero-slope) rim', () => {
    const r = 100;
    const nearRim = lightFalloff(99, r) - lightFalloff(100, r);
    const nearCentre = lightFalloff(50, r) - lightFalloff(51, r);
    expect(nearRim).toBeLessThan(nearCentre * 0.05);
  });
});

describe('y-sort', () => {
  it('maps sortY to order-preserving u32 keys', () => {
    const ys = [-5000, -10.5, -0.25, 0, 0.2, 0.25, 1, 900, 12345.75];
    for (let i = 1; i < ys.length; i++) expect(sortKey(ys[i])).toBeGreaterThanOrEqual(sortKey(ys[i - 1]));
    expect(sortKey(1)).toBeGreaterThan(sortKey(0.5));
    expect(sortKey(NaN)).toBe(0);
    expect(sortKey(1e12)).toBe(4294967295);
  });

  it('radix-sorts indices stably and matches a reference sort', () => {
    let seed = 99;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 4294967296);
    for (const n of [0, 1, 2, 17, 1000, 5000]) {
      const keys = new Uint32Array(n);
      for (let i = 0; i < n; i++) keys[i] = sortKey(Math.floor(rnd() * 200) - 100); // many equal keys
      const out = radixSortIndices(keys, n, new Uint32Array(n), new Uint32Array(n));
      const ref = Array.from({ length: n }, (_, i) => i).sort((a, b) => keys[a] - keys[b] || a - b);
      expect(Array.from(out.subarray(0, n))).toEqual(ref);
    }
  });

  it('handles keys that differ only in the high byte', () => {
    const keys = new Uint32Array([0x03000000, 0x01000000, 0x02000000, 0x01000000]);
    const out = radixSortIndices(keys, 4, new Uint32Array(4), new Uint32Array(4));
    expect(Array.from(out)).toEqual([1, 3, 2, 0]);
  });
});

describe('instance staging', () => {
  it('uses the 15-word / 60-byte layout the shader attributes expect', () => {
    expect(STRIDE).toBe(15);
    expect(STRIDE_BYTES).toBe(60);
  });

  it('grows while preserving instance data and keys', () => {
    const list = new InstanceList(2);
    for (let i = 0; i < 9; i++) {
      const o = list.push();
      list.f32[o] = i + 0.5;
      list.u32[o + 14] = 1000 + i;
      list.keys[list.count - 1] = 50 - i;
    }
    expect(list.count).toBe(9);
    for (let i = 0; i < 9; i++) {
      expect(list.f32[i * STRIDE]).toBe(i + 0.5);
      expect(list.u32[i * STRIDE + 14]).toBe(1000 + i);
      expect(list.keys[i]).toBe(50 - i);
    }
    list.reset();
    expect(list.count).toBe(0);
  });
});

describe('light flicker seed', () => {
  // Circular distance between two phases in [0, 1): the shader uses whole multiples of 2π·seed, so 0.99 → 0.01
  // is a tiny step, not a jump.
  const phaseStep = (a: number, b: number) => {
    const d = Math.abs(a - b) % 1;
    return Math.min(d, 1 - d);
  };

  it('stays in [0, 1)', () => {
    for (const [x, y] of [[0, 0], [-913.7, 12.4], [1e5, -3e4], [81.3, 58.48]]) {
      const s = lightSeed(x, y);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(1);
    }
  });

  it('changes continuously for a moving light (no phase pops)', () => {
    // A fire projectile at 420 u/s sampled at 60 fps: 7 units per frame.
    let prev = lightSeed(-500, 120);
    for (let i = 1; i < 300; i++) {
      const s = lightSeed(-500 + i * 7, 120 - i * 2);
      expect(phaseStep(prev, s)).toBeLessThan(0.1);
      prev = s;
    }
  });

  it('decorrelates static lights a few dozen units apart', () => {
    expect(phaseStep(lightSeed(0, 0), lightSeed(40, 0))).toBeGreaterThan(0.2);
    expect(phaseStep(lightSeed(0, 0), lightSeed(0, 40))).toBeGreaterThan(0.2);
  });
});
