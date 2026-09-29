import { describe, expect, it } from 'vitest';
import {
  AIR_CUTOFF, AUDIBLE_RADIUS, DEFER_HORIZON, DEFER_MAX, MASS_DB_MAX, MAX_PAN, massDb, panCompensation, spatialize, VoiceGate,
  type GateRules, type GateVoice,
} from '../../src/audio/mixing';

const db = (g: number) => 20 * Math.log10(g);
/** Distance gain only (undo the pan-law compensation for on-axis checks). */
const distDb = (dx: number, dy: number) => {
  const s = spatialize(dx, dy);
  return db(s.gain / panCompensation(s.pan));
};

describe('spatialize', () => {
  it('is full level at the listener and silent at the audible radius', () => {
    expect(spatialize(0, 0).gain).toBe(1);
    expect(spatialize(0, 0).pan).toBe(0);
    expect(spatialize(0, 0).lowpass).toBe(0);
    expect(spatialize(AUDIBLE_RADIUS, 0).gain).toBe(0);
    expect(spatialize(0, AUDIBLE_RADIUS + 100).gain).toBe(0);
  });

  it('stays flat across the ~640×360 view and falls off beyond it', () => {
    expect(distDb(0, 100)).toBe(0); // inside the near radius
    expect(distDb(0, 180)).toBeGreaterThan(-1); // vertical screen edge
    expect(distDb(250, 0)).toBeGreaterThan(-3.5);
    const edge = distDb(320, 0); // horizontal screen edge = Ember Lance range
    expect(edge).toBeGreaterThan(-6.5);
    expect(edge).toBeLessThan(-5);
    expect(distDb(450, 0)).toBeLessThan(-15);
  });

  it('attenuates monotonically and darkens only off-screen', () => {
    let last = 2;
    let lastLp = Infinity;
    for (let d = 60; d < AUDIBLE_RADIUS; d += 20) {
      const s = spatialize(0, d);
      expect(s.gain).toBeLessThanOrEqual(last);
      if (d <= 300) expect(s.lowpass, `no air absorption at ${d}`).toBe(0);
      if (s.lowpass > 0) {
        expect(s.lowpass).toBeLessThan(lastLp);
        lastLp = s.lowpass;
      }
      last = s.gain;
    }
    expect(spatialize(0, 320).lowpass).toBeGreaterThan(14000); // barely touched at the screen edge
    expect(spatialize(0, AUDIBLE_RADIUS - 0.01).lowpass).toBeCloseTo(AIR_CUTOFF, -1);
  });

  it('pans with horizontal offset, never fully hard', () => {
    expect(spatialize(200, 0).pan).toBeGreaterThan(0);
    expect(spatialize(-200, 0).pan).toBeLessThan(0);
    expect(Math.abs(spatialize(10000, 0).pan)).toBeCloseTo(MAX_PAN);
    expect(spatialize(0, 300).pan).toBe(0);
  });

  it('compensates the StereoPanner balance law so panned voices keep their power', () => {
    expect(panCompensation(0)).toBe(1);
    for (const p of [-0.8, -0.3, 0.1, 0.5, 0.8]) {
      // StereoPannerNode on a stereo input with L = R = 1 (spec equations).
      const x = p <= 0 ? p + 1 : p;
      const gl = Math.cos((x * Math.PI) / 2);
      const gr = Math.sin((x * Math.PI) / 2);
      const [l, r] = p <= 0 ? [1 + gl, gr] : [gl, 1 + gr];
      const k = panCompensation(p);
      expect((l * k) ** 2 + (r * k) ** 2).toBeCloseTo(2, 9); // centre power
    }
    // Same distance, one on-axis and one to the side: equal distance gain, side carries the law.
    const side = spatialize(200, 0);
    const front = spatialize(0, 200);
    expect(side.gain / front.gain).toBeCloseTo(panCompensation(side.pan), 9);
  });
});

function voice(start: number, end: number, priority = 0): GateVoice & { killed: number | null; massDb: number } {
  const v = {
    start,
    end,
    priority,
    killed: null as number | null,
    massDb: 0,
    kill(when: number) {
      v.killed = when;
    },
    mass(d: number) {
      v.massDb = d;
    },
  };
  return v;
}

describe('VoiceGate', () => {
  const rules: GateRules = { maxVoices: 3, minInterval: 0.03, priority: 0 };

  it('drops plays that come faster than the minimum interval', () => {
    const g = new VoiceGate<string>();
    expect(g.admit('hit', 1, rules).ok).toBe(true);
    expect(g.admit('hit', 1.01, rules)).toEqual({ ok: false, reason: 'interval' });
    expect(g.admit('hit', 1.04, rules).ok).toBe(true);
    expect(g.stats.droppedInterval).toBe(1);
  });

  it('steals the oldest voice beyond the per-id cap', () => {
    const g = new VoiceGate<string>();
    const vs: ReturnType<typeof voice>[] = [];
    for (let i = 0; i < 5; i++) {
      const t = 1 + i * 0.05;
      expect(g.admit('hit', t, rules).ok).toBe(true);
      const v = voice(t, t + 1);
      g.add('hit', v);
      vs.push(v);
    }
    expect(g.active(1.3, 'hit')).toBe(3);
    expect(vs[0].killed).not.toBeNull();
    expect(vs[1].killed).not.toBeNull();
    expect(vs[2].killed).toBeNull();
    expect(g.stats.stolen).toBe(2);
  });

  it('attenuates sustained repetition but leaves isolated plays untouched', () => {
    const g = new VoiceGate<string>();
    const first = g.admit('hit', 1, rules);
    expect(first.ok && first.gain).toBe(1);
    let gain = 1;
    for (let i = 1; i < 40; i++) {
      const a = g.admit('hit', 1 + i * 0.03, rules);
      if (a.ok) gain = a.gain;
    }
    expect(gain).toBeLessThan(0.7);
    expect(gain).toBeGreaterThan(0.3);
    const later = g.admit('hit', 10, rules);
    expect(later.ok && later.gain).toBeGreaterThan(0.99);
  });

  it('a longer energy time constant settles slow repeats lower (crafting spam)', () => {
    const settle = (tau: number | undefined) => {
      const g = new VoiceGate<string>();
      let gain = 1;
      for (let i = 0; i < 30; i++) {
        const a = g.admit('craftApply', i * 0.4, { maxVoices: 2, minInterval: 0.08, priority: 2, energyTau: tau });
        if (a.ok) gain = a.gain;
      }
      return db(gain);
    };
    expect(settle(undefined)).toBeGreaterThan(-1); // default tau barely notices 2.5 plays/s
    expect(settle(1.5)).toBeLessThan(-2.5);
    expect(settle(1.5)).toBeGreaterThan(-4.5);
  });

  it('shares density attenuation across a group', () => {
    const g = new VoiceGate<string>();
    const grouped = { ...rules, minInterval: 0, maxVoices: 100, group: 'combat' };
    let last = 1;
    for (let i = 0; i < 60; i++) {
      const a = g.admit(`id${i % 6}`, 1 + i * 0.005, grouped);
      if (a.ok) last = a.gain;
    }
    expect(last).toBeLessThan(0.75);
  });

  it('counts combos for quick successions (per-rule window) and resets after a pause', () => {
    const g = new VoiceGate<string>();
    const r: GateRules = { maxVoices: 6, minInterval: 0.02, priority: 0 };
    const combos = [1, 1.1, 1.2, 1.3].map((t) => {
      const a = g.admit('mote', t, r);
      return a.ok ? a.combo : -1;
    });
    expect(combos).toEqual([0, 1, 2, 3]);
    const a = g.admit('mote', 3, r);
    expect(a.ok && a.combo).toBe(0);
    const slow: GateRules = { ...r, comboWindow: 1.2 };
    g.admit('craft', 5, slow);
    const b = g.admit('craft', 5.9, slow);
    expect(b.ok && b.combo).toBe(1);
  });

  it('drops expendable sounds when the global budget is full, but important ones steal', () => {
    const g = new VoiceGate<string>(4);
    const spam: GateRules = { maxVoices: 10, minInterval: 0, priority: 0 };
    const vs: ReturnType<typeof voice>[] = [];
    for (let i = 0; i < 4; i++) {
      expect(g.admit(`s${i}`, 1, spam).ok).toBe(true);
      const v = voice(1, 5);
      g.add(`s${i}`, v);
      vs.push(v);
    }
    expect(g.admit('s9', 1.1, spam)).toEqual({ ok: false, reason: 'budget' });
    expect(g.admit('dropUnique', 1.1, { maxVoices: 1, minInterval: 0, priority: 2 }).ok).toBe(true);
    expect(vs.some((v) => v.killed !== null)).toBe(true);
  });

  describe('loudest burst policy (combat)', () => {
    const hit: GateRules = { maxVoices: 5, minInterval: 0.03, priority: 0, burst: 'loudest' };

    it('merges a same-frame burst into one voice that gains mass (+1.5 dB per doubling, capped)', () => {
      const g = new VoiceGate<string>();
      const a = g.admit('death', 1, hit, 0.5);
      expect(a.ok).toBe(true);
      const v = voice(1.005, 1.3);
      g.add('death', v);
      for (let i = 1; i < 20; i++) expect(g.admit('death', 1, hit, 0.4)).toEqual({ ok: false, reason: 'merged' });
      expect(g.stats.merged).toBe(19);
      expect(g.stats.played).toBe(1);
      expect(v.massDb).toBeCloseTo(MASS_DB_MAX, 9);
      expect(massDb(2)).toBeCloseTo(1.5, 9);
      expect(massDb(4)).toBeCloseTo(3, 9);
      expect(massDb(1)).toBe(0);
    });

    it('lets a much louder (nearer) same-frame request replace the not-yet-audible voice', () => {
      const g = new VoiceGate<string>();
      g.admit('hit', 1, hit, 0.2); // a far, quiet hit arrived first
      const far = voice(1.004, 1.2);
      g.add('hit', far);
      expect(g.admit('hit', 1, hit, 0.25)).toEqual({ ok: false, reason: 'merged' }); // not loud enough
      const near = g.admit('hit', 1, hit, 0.9);
      expect(near.ok).toBe(true);
      if (near.ok) {
        expect(near.at).toBe(1);
        expect(near.massDb).toBeCloseTo(massDb(3), 9); // it stands for all three requests
      }
      expect(far.killed).toBe(1);
      expect(g.stats.played).toBe(1); // a swap, not a second voice
      const nearVoice = voice(1.002, 1.2);
      g.add('hit', nearVoice);
      expect(g.active(1, 'hit')).toBe(1);
    });

    it('does not merge across frames: the next frame inside the interval is dropped', () => {
      const g = new VoiceGate<string>();
      g.admit('hit', 1, hit);
      g.add('hit', voice(1, 1.2));
      expect(g.admit('hit', 1 + 1 / 60, hit)).toEqual({ ok: false, reason: 'interval' });
      expect(g.admit('hit', 1 + 2 / 60, hit).ok).toBe(true);
    });
  });

  describe('defer burst policy (loot)', () => {
    const coin: GateRules = { maxVoices: 3, minInterval: 0.05, priority: 1, burst: 'defer' };

    it('turns a same-frame fountain into an evenly spaced, climbing cascade', () => {
      const g = new VoiceGate<string>(56, () => 0.5);
      const starts: number[] = [];
      const combos: number[] = [];
      for (let i = 0; i < 6; i++) {
        const a = g.admit('coin', 2, coin);
        expect(a.ok).toBe(true);
        if (!a.ok) continue;
        starts.push(a.at);
        combos.push(a.combo);
        g.add('coin', voice(a.at, a.at + 0.3));
      }
      expect(starts[0]).toBe(2);
      for (let i = 1; i < starts.length; i++) {
        const gap = starts[i] - starts[i - 1];
        expect(gap).toBeGreaterThanOrEqual(0.05);
        expect(gap).toBeLessThanOrEqual(0.05 + 0.025 + 1e-9);
      }
      expect(combos).toEqual([0, 1, 2, 3, 4, 5]);
      expect(g.stats.deferred).toBe(5);
    });

    it('bounds the queue (count and horizon) and caps overlapping voices at their start', () => {
      const g = new VoiceGate<string>(56, () => 0);
      const vs: ReturnType<typeof voice>[] = [];
      let admitted = 0;
      for (let i = 0; i < 20; i++) {
        const a = g.admit('coin', 2, coin);
        if (!a.ok) continue;
        admitted++;
        expect(a.at - 2).toBeLessThanOrEqual(DEFER_HORIZON);
        const v = voice(a.at, a.at + 0.3);
        g.add('coin', v);
        vs.push(v);
      }
      expect(admitted).toBeLessThanOrEqual(DEFER_MAX + 1);
      expect(admitted).toBeGreaterThanOrEqual(DEFER_MAX);
      // Voices are 0.3 s long and 50 ms apart: the per-id cap (3) fades the oldest out as later
      // ones start, never cutting a voice before it has begun.
      for (const v of vs) if (v.killed !== null) expect(v.killed).toBeGreaterThanOrEqual(v.start);
      expect(vs.filter((v) => v.killed !== null).length).toBeGreaterThan(0);
    });
  });
});
