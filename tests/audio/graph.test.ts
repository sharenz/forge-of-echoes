import { describe, expect, it } from 'vitest';
import { buildGraph, curveAt, dbToGain, DUCK_ATTACK, duckCurve, minCurve, type Curve } from '../../src/audio/graph';
import { equalPowerFade } from '../../src/audio/music/player';
import { asCtx, FakeAudioContext, FakeGain, FakeNode, FakeParam } from './fake-audio';

const graphOf = () => {
  const ctx = new FakeAudioContext();
  const g = buildGraph(asCtx(ctx), ctx.destination as unknown as AudioNode);
  return { ctx, g };
};

/** The duck gain that sits right after a bus (bus → duck). */
const duckAfter = (bus: AudioNode): FakeParam => {
  const next = (bus as unknown as FakeNode).outputs[0] as FakeGain;
  return next.gain;
};

/** combat → compressor → makeup gain → duck. */
const combatDuck = (g: ReturnType<typeof graphOf>['g']): FakeParam => {
  const comp = (g.combat as unknown as FakeNode).outputs[0] as FakeNode;
  const makeup = comp.outputs[0] as FakeGain;
  return (makeup.outputs[0] as FakeGain).gain;
};

const sample = (from: number, to: number, step = 0.005): number[] => {
  const out: number[] = [];
  for (let t = from; t <= to + 1e-9; t += step) out.push(t);
  return out;
};

describe('duck curves', () => {
  it('minCurve is the exact pointwise minimum and starts at the first curve', () => {
    const a = duckCurve(dbToGain(-6), 0, 1.2, 1);
    const b = duckCurve(dbToGain(-3), 1.9, 1.5, 1);
    const m = minCurve(a, b, 1.5);
    expect(m[0]).toEqual([1.5, curveAt(a, 1.5)]);
    for (const t of sample(1.5, 6)) expect(curveAt(m, t)).toBeCloseTo(Math.min(curveAt(a, t), curveAt(b, t)), 9);
  });

  it('drops interior collinear breakpoints', () => {
    const line: Curve = [[0, 1], [1, 0.75], [2, 0.5], [3, 0.5]];
    expect(minCurve(line, [], 0)).toEqual([[0, 1], [2, 0.5], [3, 0.5]]);
  });
});

describe('graph.duck', () => {
  it('a second duck mid-release never steps below the curve already playing (no click)', () => {
    const { ctx, g } = graphOf();
    const p = duckAfter(g.music);
    // levelUp: −6 dB, hold 1.2, release 1 — then a waveTell (−3 dB) arrives mid-release.
    g.duck('music', 6, 1.2, 1, 0.012);
    const before = sample(0, 5).map((t) => p.valueAt(t));
    const oldAt = (t: number) => before[Math.round(t / 0.005)];
    ctx.currentTime = 2.0;
    g.duck('music', 3, 1.5, 1, 2.012);
    const next = duckCurve(dbToGain(-3), 2.012, 1.5, 1);
    for (const t of sample(2.0, 5)) {
      const v = p.valueAt(t);
      const expected = Math.min(oldAt(t), curveAt(next, t));
      expect(v, `t=${t.toFixed(3)}`).toBeCloseTo(expected, 6);
      expect(v).toBeLessThanOrEqual(oldAt(t) + 1e-9);
    }
    // Continuity at the moment of the second call.
    expect(p.valueAt(2.0)).toBeCloseTo(oldAt(2.0), 9);
  });

  it('a shallow duck during a deep one leaves the deep one intact; a deeper one takes over smoothly', () => {
    const { ctx, g } = graphOf();
    const p = combatDuck(g);
    g.duck('combat', 10, 2, 1.5, 0.012); // unique drop
    ctx.currentTime = 0.03; // still in the deep duck's attack
    g.duck('combat', 4, 0.8, 0.6, 0.042); // rare drop in the same moment
    const deep = duckCurve(dbToGain(-10), 0.012, 2, 1.5);
    for (const t of sample(0.03, 4)) expect(p.valueAt(t)).toBeCloseTo(curveAt(deep, t), 6);
    ctx.currentTime = 3.0; // deep duck releasing
    const releasing = (t: number) => curveAt(deep, t);
    g.duck('combat', 12, 0.5, 0.5, 3.012);
    const deeper = duckCurve(dbToGain(-12), 3.012, 0.5, 0.5);
    let last = p.valueAt(3.0);
    expect(last).toBeCloseTo(releasing(3.0), 9);
    for (const t of sample(3.0, 3.012 + DUCK_ATTACK + 0.02, 0.001)) {
      const v = p.valueAt(t);
      expect(v).toBeCloseTo(Math.min(releasing(t), curveAt(deeper, t)), 6);
      // At most the attack slope (12 dB in 50 ms ≈ 0.015 per ms): never a jump.
      expect(Math.abs(v - last)).toBeLessThan(0.02);
      last = v;
    }
    expect(p.valueAt(3.2)).toBeCloseTo(dbToGain(-12), 6);
    expect(p.valueAt(5)).toBeCloseTo(1, 9);
  });

  it('ducks the music dry, reverb and echo paths together (and the combat sends)', () => {
    const { g } = graphOf();
    g.duck('music', 10, 1, 1, 0.012);
    g.duck('combat', 8, 1, 1, 0.012);
    for (const bus of [g.music, g.musicWet, g.musicEcho, g.combatWet, g.combatEcho]) {
      expect(duckAfter(bus).valueAt(0.5), 'ducked during hold').toBeLessThan(0.5);
    }
    // The combat dry path goes through the bus compressor before its duck.
    expect(combatDuck(g).valueAt(0.5)).toBeCloseTo(dbToGain(-8), 6);
  });
});

describe('equal-power crossfades', () => {
  it('keep constant power while one track fades out and the next fades in', () => {
    const out = new FakeParam(1, 'gain');
    const inn = new FakeParam(0, 'gain');
    equalPowerFade(out as unknown as AudioParam, 1, 2.5, 0.8, 0);
    equalPowerFade(inn as unknown as AudioParam, 1, 2.5, 0, 0.8);
    for (const t of sample(1, 3.5, 0.01)) {
      const power = out.valueAt(t) ** 2 + inn.valueAt(t) ** 2;
      expect(power).toBeGreaterThan(0.64 * 0.97); // linear fades dip to 0.5 (−3 dB) mid-way
      expect(power).toBeLessThan(0.64 * 1.001);
    }
    expect(out.valueAt(3.5)).toBe(0);
    expect(inn.valueAt(3.5)).toBeCloseTo(0.8, 9);
  });
});
