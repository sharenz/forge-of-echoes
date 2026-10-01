import { describe, expect, it } from 'vitest';
import {
  EMPTY_FOCUS, LOW_LIFE, SLOSH_MAX_KICK, TRAIL_HOLD, applyTarget, beatPeriod, beatShape, createGlobeState, debuffTint, emptyFlicker, hash01, heartbeat,
  isSettling, lowAmount, sloshKick, stepGlobe, stepSpring, stepTint, waveOffset,
} from '../../src/ui/lib/globe-fx';

const run = (s: ReturnType<typeof createGlobeState>, seconds: number, dt = 1 / 60): void => {
  for (let t = 0; t < seconds; t += dt) stepGlobe(s, dt);
};

describe('slosh spring', () => {
  it('rings and then settles to rest', () => {
    const s = { x: 0, v: 8 };
    let crossed = 0;
    let prev = s.x;
    for (let i = 0; i < 60 * 6; i++) {
      stepSpring(s, 1 / 60);
      if (prev * s.x < 0) crossed++;
      prev = s.x;
    }
    expect(crossed).toBeGreaterThanOrEqual(2); // underdamped: it overshoots
    expect(Math.abs(s.x)).toBeLessThan(0.01);
    expect(Math.abs(s.v)).toBeLessThan(0.05);
  });

  it('stays finite after a very long frame', () => {
    const s = { x: 3, v: 40 };
    stepSpring(s, 5);
    expect(Number.isFinite(s.x) && Number.isFinite(s.v)).toBe(true);
    expect(Math.abs(s.x)).toBeLessThan(10);
  });

  it('kicks harder for hits than heals, signed, and clamped', () => {
    expect(sloshKick(-0.2)).toBeLessThan(0);
    expect(sloshKick(0.2)).toBeGreaterThan(0);
    expect(Math.abs(sloshKick(-0.1))).toBeGreaterThan(Math.abs(sloshKick(0.1)));
    expect(sloshKick(-1)).toBe(-SLOSH_MAX_KICK);
    expect(sloshKick(1)).toBe(SLOSH_MAX_KICK);
    expect(sloshKick(0)).toBe(0);
  });
});

describe('globe state', () => {
  it('starts at rest at the first fill', () => {
    const s = createGlobeState(0.7);
    expect([s.shown, s.target, s.trail]).toEqual([0.7, 0.7, 0.7]);
    expect(isSettling(s)).toBe(false);
  });

  it('a hit drops the fill quickly, leaves a trail that waits and then drains, and sloshes', () => {
    const s = createGlobeState(0.9);
    applyTarget(s, 0.5);
    expect(s.slosh.v).toBeLessThan(0);
    expect(s.trailHold).toBe(TRAIL_HOLD);
    run(s, 0.2);
    expect(s.shown).toBeCloseTo(0.5, 1);
    expect(s.trail).toBeGreaterThan(s.shown + 0.2); // the chunk is still hanging
    run(s, 0.2);
    const midTrail = s.trail;
    run(s, 2);
    expect(s.trail).toBeLessThanOrEqual(midTrail);
    expect(s.trail).toBeCloseTo(s.shown, 5);
    expect(s.flash).toBe(0);
  });

  it('a second hit extends the same trail instead of restarting it lower', () => {
    const s = createGlobeState(1);
    applyTarget(s, 0.8);
    run(s, 0.1);
    const top = s.trail;
    applyTarget(s, 0.6);
    run(s, 0.1);
    expect(s.trail).toBeGreaterThanOrEqual(top - 1e-9);
    expect(s.trailHold).toBeGreaterThan(0.2);
  });

  it('a heal flashes and raises the fill without a trail; tiny regen only shimmers', () => {
    const s = createGlobeState(0.3);
    applyTarget(s, 0.7);
    expect(s.flash).toBeGreaterThan(0.9);
    expect(s.sweep).toBe(0);
    run(s, 0.3);
    expect(s.shown).toBeGreaterThan(0.6);
    expect(s.trail).toBe(s.shown);
    const r = createGlobeState(0.3);
    applyTarget(r, 0.305);
    expect(r.flash).toBeLessThan(0.1);
    run(s, 2);
    expect(s.flash).toBe(0);
    expect(s.sweep).toBe(1);
  });

  it('ignores sub-pixel jitter and clamps targets', () => {
    const s = createGlobeState(0.5);
    applyTarget(s, 0.5005);
    expect(s.slosh.v).toBe(0);
    applyTarget(s, 7);
    expect(s.target).toBe(1);
    applyTarget(s, -3);
    expect(s.target).toBe(0);
  });

  it('settles completely so reduced motion can stop drawing', () => {
    const s = createGlobeState(0.9);
    applyTarget(s, 0.2);
    expect(isSettling(s)).toBe(true);
    run(s, 8);
    expect(isSettling(s)).toBe(false);
  });
});

describe('wave profile', () => {
  it('is flat in calm mode', () => {
    for (const x of [-1, -0.3, 0.8]) expect(waveOffset(x, 1.23, 2, 36, true)).toBe(0);
  });
  it('swells with the spring and tilts with its sign', () => {
    const calmMax = Math.max(...[-1, -0.5, 0, 0.5, 1].map((x) => Math.abs(waveOffset(x, 0.4, 0, 36, false))));
    const hotMax = Math.max(...[-1, -0.5, 0, 0.5, 1].map((x) => Math.abs(waveOffset(x, 0.4, 1.2, 36, false))));
    expect(hotMax).toBeGreaterThan(calmMax * 1.8);
    // Large positive slosh lowers the right side and raises the left: a see-saw.
    expect(waveOffset(0.9, 0, 1.5, 36, false) - waveOffset(-0.9, 0, 1.5, 36, false)).toBeGreaterThan(2);
    expect(waveOffset(0.9, 0, -1.5, 36, false) - waveOffset(-0.9, 0, -1.5, 36, false)).toBeLessThan(-2);
  });
  it('scales with the canvas size', () => {
    const a = waveOffset(0.7, 0.2, 1, 36, false);
    expect(waveOffset(0.7, 0.2, 1, 72, false)).toBeCloseTo(a * 2, 6);
  });
});

describe('low life heartbeat', () => {
  it('is silent above the threshold and grows below it', () => {
    expect(lowAmount(LOW_LIFE)).toBe(0);
    expect(lowAmount(0.9)).toBe(0);
    expect(heartbeat(0.1, 0.5)).toBe(0);
    expect(lowAmount(0.05)).toBeGreaterThan(lowAmount(0.2));
    expect(lowAmount(0)).toBe(1);
  });
  it('beats faster the closer to death and has a lub-dub shape', () => {
    expect(beatPeriod(0.02)).toBeLessThan(beatPeriod(0.29));
    expect(beatShape(0.08)).toBeGreaterThan(0.95);
    expect(beatShape(0.3)).toBeGreaterThan(0.6);
    expect(beatShape(0.18)).toBeLessThan(0.4);
    expect(beatShape(0.7)).toBeLessThan(0.01);
    const peaks = Array.from({ length: 200 }, (_, i) => heartbeat(i * 0.01, 0.1));
    expect(Math.max(...peaks)).toBeGreaterThan(0.5);
    expect(Math.min(...peaks)).toBeLessThan(0.05);
  });
});

describe('empty focus flicker', () => {
  it('is deterministic, in range, and actually flickers', () => {
    const vals = Array.from({ length: 200 }, (_, i) => emptyFlicker(i * 0.05));
    expect(vals.every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(emptyFlicker(3.3)).toBe(emptyFlicker(3.3));
    expect(new Set(vals.map((v) => v.toFixed(2))).size).toBeGreaterThan(10);
    expect(Math.max(...vals)).toBeGreaterThan(0.5);
    expect(EMPTY_FOCUS).toBeGreaterThan(0);
  });
  it('hash noise stays in [0, 1)', () => {
    for (let i = -50; i < 500; i += 7) expect(hash01(i)).toBeGreaterThanOrEqual(0), expect(hash01(i)).toBeLessThan(1);
  });
});

describe('debuff tint', () => {
  it('has no tint without debuffs or for debuffs that do not touch the globe', () => {
    expect(debuffTint('life', undefined).amt).toBe(0);
    expect(debuffTint('life', []).amt).toBe(0);
    expect(debuffTint('life', [{ id: 'rooted' }]).amt).toBe(0);
    expect(debuffTint('focus', [{ id: 'burning' }]).amt).toBe(0);
  });
  it('picks by priority and differs per globe', () => {
    const life = debuffTint('life', [{ id: 'chilled' }, { id: 'burning' }]);
    expect(life.r).toBeGreaterThan(life.b); // burning wins: warm
    const focus = debuffTint('focus', [{ id: 'withered' }, { id: 'chilled' }]);
    expect(focus.g).toBeGreaterThan(focus.b); // withered wins: sickly green
    expect(debuffTint('life', [{ id: 'bleeding' }]).amt).toBeGreaterThan(0);
    expect(debuffTint('focus', [{ id: 'shocked' }]).amt).toBeGreaterThan(0);
  });
  it('eases in and out without popping', () => {
    const s = createGlobeState(1);
    const want = debuffTint('life', [{ id: 'burning' }]);
    stepTint(s, want, 1 / 60);
    expect(s.tintAmt).toBeGreaterThan(0);
    expect(s.tintAmt).toBeLessThan(want.amt / 2);
    for (let i = 0; i < 240; i++) stepTint(s, want, 1 / 60);
    expect(s.tintAmt).toBeCloseTo(want.amt, 2);
    for (let i = 0; i < 600; i++) stepTint(s, debuffTint('life', undefined), 1 / 60);
    expect(s.tintAmt).toBe(0);
  });
});
