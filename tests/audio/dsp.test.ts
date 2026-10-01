import { describe, expect, it } from 'vitest';
import {
  brownNoise, crackleNoise, impulseResponse, loopable, normalizeRms, pinkNoise, removeDc, rms, safetyCurve, softClipCurve, whiteNoise,
} from '../../src/audio/dsp';
import { applyEnv, envLength, midi, qValue } from '../../src/audio/voice';
import { dbToGain, gainToDb, volumeToGain } from '../../src/audio/graph';
import { Rand } from '../../src/audio/rand';
import { FakeParam } from './fake-audio';

const mean = (d: Float32Array) => d.reduce((a, b) => a + b, 0) / d.length;

describe('noise generators', () => {
  it('produce zero-mean beds normalisable to a target RMS', () => {
    for (const gen of [whiteNoise, pinkNoise, brownNoise]) {
      const d = gen(48000, new Rand(1));
      removeDc(d);
      normalizeRms(d, 0.25);
      expect(Math.abs(mean(d))).toBeLessThan(1e-4);
      expect(rms(d)).toBeCloseTo(0.25, 3);
    }
  });

  it('crackle is sparse, bounded and zero-mean', () => {
    const d = crackleNoise(48000, 48000, new Rand(2));
    let peak = 0;
    let quiet = 0;
    for (const v of d) {
      peak = Math.max(peak, Math.abs(v));
      if (Math.abs(v) < 0.01) quiet++;
    }
    expect(peak).toBeCloseTo(1, 5);
    expect(quiet / d.length).toBeGreaterThan(0.5);
    expect(Math.abs(mean(d))).toBeLessThan(1e-3);
  });

  it('loopable buffers have no seam at the loop point', () => {
    const raw = brownNoise(48000 + 2400, new Rand(3));
    const d = loopable(raw, 2400);
    expect(d.length).toBe(48000);
    // The wrap step should look like any other adjacent-sample step.
    let maxStep = 0;
    for (let i = 1; i < d.length; i++) maxStep = Math.max(maxStep, Math.abs(d[i] - d[i - 1]));
    expect(Math.abs(d[0] - d[d.length - 1])).toBeLessThanOrEqual(maxStep * 1.01);
  });

  it('impulse response is stereo, decorrelated and unit-energy per channel', () => {
    const [l, r] = impulseResponse(48000, 2, new Rand(4));
    let el = 0, er = 0, cross = 0;
    for (let i = 0; i < l.length; i++) {
      el += l[i] * l[i];
      er += r[i] * r[i];
      cross += l[i] * r[i];
    }
    expect(el).toBeCloseTo(1, 4);
    expect(er).toBeCloseTo(1, 4);
    expect(Math.abs(cross)).toBeLessThan(0.3);
    expect(l[0]).toBe(0); // pre-delay
  });
});

describe('curves', () => {
  it('soft clip and safety curves are odd-symmetric, monotonic and bounded', () => {
    for (const c of [softClipCurve(), safetyCurve()]) {
      const n = c.length;
      expect(c[(n - 1) / 2]).toBeCloseTo(0, 9);
      for (let i = 1; i < n; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]);
      for (let i = 0; i < n; i++) expect(c[i]).toBeCloseTo(-c[n - 1 - i], 6);
      expect(Math.max(...c)).toBeLessThanOrEqual(1);
    }
    const s = safetyCurve();
    // Transparent below 0.8.
    const idx = Math.round(((0.5 + 1) / 2) * (s.length - 1));
    expect(s[idx]).toBeCloseTo(0.5, 3);
  });
});

describe('envelopes and helpers', () => {
  it('every envelope shape starts and ends at exactly zero and reports its length', () => {
    for (const env of [{ d: 0.2 }, { a: 0.01, h: 0.1, d: 0.3 }, { pad: true as const, a: 0.2, h: 0.5, r: 0.8 }, { pts: [[0.1, 1], [0.3, 0.4], [0.5, 0]] as [number, number][] }, { pts: [[0.1, 1]] as [number, number][] }]) {
      const p = new FakeParam(1, 'gain');
      const len = applyEnv(p as unknown as AudioParam, 2, 0.5, env);
      expect(p.events[0]).toEqual({ type: 'set', value: 0, time: 2 });
      const last = p.events[p.events.length - 1];
      expect(last.value).toBe(0);
      expect(last.time).toBeCloseTo(2 + len, 9);
      expect(envLength(env)).toBeCloseTo(len, 9);
    }
  });

  it('converts filter Q per the Web Audio spec (dB for lowpass/highpass)', () => {
    expect(qValue('lowpass', 0.707)).toBeCloseTo(-3.01, 1);
    expect(qValue('highpass', 1)).toBe(0);
    expect(qValue('bandpass', 4)).toBe(4);
  });

  it('volume taper and dB helpers', () => {
    expect(volumeToGain(1)).toBe(1);
    expect(volumeToGain(0)).toBe(0);
    expect(volumeToGain(0.5)).toBeCloseTo(0.25);
    expect(volumeToGain(Number.NaN)).toBe(0);
    expect(gainToDb(dbToGain(-12))).toBeCloseTo(-12);
    expect(midi(69)).toBe(440);
  });
});
