// The snapshot clock (jitter buffer) in isolation: arrivals are generated for a server ticking at `hz` and stamped
// the way a browser stamps them (in onmessage), with network jitter, TCP stalls and main-thread hitches.
import { describe, expect, it } from 'vitest';
import { SNAPSHOT_EVERY } from '../../src/contracts/net';
import { MAX_INTERP_DELAY_MS, SnapshotClock, TICK_MS } from '../../src/net/clock';

interface Scenario {
  durationMs: number;
  hz?: number;
  latencyMs?: number;
  /** Extra one-way delay for snapshot k sent at `sentAt` (jitter, stalls, route changes). */
  extra?: (sentAt: number, k: number, rnd: () => number) => number;
  /** Main-thread hitches: nothing is stamped or rendered inside [at, at + ms). */
  hitches?: { at: number; ms: number }[];
  frameMs?: number;
  seed?: number;
}

interface Sample {
  now: number;
  delay: number;
  renderTick: number;
  liveTick: number;
  /** Tick the server actually produced by `now` minus the one-way latency (the true live edge). */
  trueLive: number;
}

function rng(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}

function simulate(sc: Scenario): { samples: Sample[]; clock: SnapshotClock } {
  const hz = sc.hz ?? 60;
  const latency = sc.latencyMs ?? 40;
  const frameMs = sc.frameMs ?? 1000 / 144;
  const rnd = rng(sc.seed ?? 5);
  const hitches = sc.hitches ?? [];
  const inHitch = (t: number) => hitches.find((h) => t >= h.at && t < h.at + h.ms);
  // Arrivals of every snapshot (ordered stream: a delayed one holds back the ones behind it).
  const arrivals: { at: number; tick: number }[] = [];
  let last = 0;
  for (let k = 1; ; k++) {
    const tick = k * SNAPSHOT_EVERY;
    const sentAt = (tick * 1000) / hz;
    if (sentAt > sc.durationMs) break;
    let at = sentAt + latency + (sc.extra ? sc.extra(sentAt, k, rnd) : 0);
    at = Math.max(at, last);
    last = at;
    // Messages that arrive during a hitch are handled right after it, back to back.
    const h = inHitch(at);
    arrivals.push({ at: h ? h.at + h.ms + arrivals.length * 1e-3 : at, tick });
  }
  arrivals.sort((a, b) => a.at - b.at);
  const clock = new SnapshotClock();
  const samples: Sample[] = [];
  let next = 0;
  for (let now = 0; now <= sc.durationMs; now += frameMs) {
    const h = inHitch(now);
    if (h) continue;
    while (next < arrivals.length && arrivals[next].at <= now) {
      clock.onSnapshot(arrivals[next].tick, arrivals[next].at);
      next++;
    }
    if (!clock.hasSamples) continue;
    const renderTick = clock.advance(now);
    samples.push({
      now, delay: clock.delayMs(), renderTick, liveTick: clock.liveTick(now), trueLive: ((now - latency) * hz) / 1000,
    });
  }
  return { samples, clock };
}

const at = (samples: Sample[], t: number): Sample => samples.find((s) => s.now >= t)!;

describe('snapshot clock', () => {
  it('sits at 2.2 snapshot intervals on a clean link', () => {
    const { samples } = simulate({ durationMs: 6000 });
    const s = at(samples, 5000);
    expect(s.delay).toBeCloseTo(2.2 * SNAPSHOT_EVERY * TICK_MS, 0);
    // Rendering exactly `delay` behind the true live edge.
    expect(Math.abs((s.trueLive - s.renderTick) * TICK_MS - s.delay)).toBeLessThan(3);
  });

  it('does not raise the delay after one 250 ms stall and recovers the render lag within ~1.5 s', () => {
    const { samples } = simulate({
      durationMs: 9000,
      extra: (sentAt) => (sentAt >= 5000 && sentAt < 5250 ? 5250 - sentAt : 0),
    });
    // The robust estimate ignores a single burst: the target delay never leaves the clean-network value…
    const after = samples.filter((s) => s.now >= 5000);
    expect(Math.max(...after.map((s) => s.delay))).toBeLessThanOrEqual(80);
    expect(at(samples, 8000).delay).toBeLessThanOrEqual(85);
    // …and the render position is back at ~delay behind the live edge soon after the burst.
    const s = at(samples, 6800);
    expect((s.trueLive - s.renderTick) * TICK_MS).toBeLessThan(85);
  });

  it('treats a 100 ms main-thread hitch as a hitch, not as network jitter', () => {
    const { samples } = simulate({ durationMs: 9000, hitches: [{ at: 4000, ms: 100 }] });
    const raised = samples.filter((s) => s.now >= 4000 && s.delay > 80);
    const span = raised.length ? raised[raised.length - 1].now - raised[0].now : 0;
    expect(span).toBeLessThan(2000);
    expect(at(samples, 6500).delay).toBeLessThanOrEqual(80);
  });

  it('grows the delay for recurring jitter (95th percentile per delivery)', () => {
    const { samples, clock } = simulate({ durationMs: 8000, extra: (_t, _k, rnd) => rnd() * 45, seed: 11 });
    const s = at(samples, 7000);
    // interval + ≈ 0.95·45 + 4
    expect(s.delay).toBeGreaterThan(70);
    expect(s.delay).toBeGreaterThanOrEqual(SNAPSHOT_EVERY * TICK_MS + 0.85 * 45);
    expect(s.delay).toBeLessThan(MAX_INTERP_DELAY_MS);
    expect(clock.jitterMs).toBeGreaterThan(35);
    expect(clock.jitterMs).toBeLessThanOrEqual(45);
  });

  it('follows a server ticking at 58 Hz (drift) without inflating the delay', () => {
    const { samples, clock } = simulate({ durationMs: 12000, hz: 58 });
    expect(clock.drift).toBeGreaterThan(0.025);
    expect(clock.drift).toBeLessThan(0.042);
    for (const s of samples.filter((q) => q.now >= 8000)) {
      expect(s.delay).toBeLessThanOrEqual(80);
      // The live tick estimate tracks the server's real tick rate.
      expect(Math.abs(s.liveTick - s.trueLive) * (1000 / 58)).toBeLessThan(6);
    }
    // The render clock advances at the server's rate: 58 ticks per second.
    const a = at(samples, 9000);
    const b = at(samples, 11000);
    expect((b.renderTick - a.renderTick) / ((b.now - a.now) / 1000)).toBeCloseTo(58, 0);
  });

  it('follows a 61.5 Hz server too (negative drift)', () => {
    const { samples, clock } = simulate({ durationMs: 12000, hz: 61.5 });
    expect(clock.drift).toBeLessThan(-0.015);
    const s = at(samples, 10000);
    expect(s.delay).toBeLessThanOrEqual(80);
    expect(Math.abs(s.liveTick - s.trueLive) * (1000 / 61.5)).toBeLessThan(6);
  });

  it('rebases onto a persistent latency step instead of holding the old floor for 2 s', () => {
    const { samples, clock } = simulate({ durationMs: 8000, extra: (sentAt) => (sentAt >= 4000 ? 120 : 0) });
    expect(clock.rebases).toBe(1);
    const s = at(samples, 5000);
    expect(s.delay).toBeLessThanOrEqual(80);
    // The live edge moved back by the step: the clock knows it.
    expect(Math.abs((s.liveTick - (s.trueLive - (120 * 60) / 1000)) * TICK_MS)).toBeLessThan(6);
  });

  it('never runs backwards and never rebases on plain heavy jitter', () => {
    const { samples, clock } = simulate({ durationMs: 15000, extra: (_t, _k, rnd) => rnd() * 90, seed: 3 });
    for (let k = 1; k < samples.length; k++) expect(samples[k].renderTick).toBeGreaterThanOrEqual(samples[k - 1].renderTick);
    expect(clock.rebases).toBe(0);
  });

  it('holds when starved and catches up with a bounded time warp', () => {
    const clock = new SnapshotClock();
    let tick = 0;
    let now = 0;
    const renders: number[] = [];
    for (; now < 3000; now += 7) {
      while ((tick + SNAPSHOT_EVERY) * TICK_MS + 40 <= now && !(now > 2000 && now < 2300)) {
        tick += SNAPSHOT_EVERY;
        clock.onSnapshot(tick, now);
      }
      const r = clock.advance(now);
      if (r > clock.newestTick + 6) clock.holdAt(clock.newestTick + 6);
      if (now > 500) renders.push(clock.renderTick);
    }
    const steps = renders.slice(1).map((r, i) => r - renders[i]);
    const nominal = 7 / TICK_MS;
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...steps)).toBeLessThanOrEqual(nominal * 1.2 + 1e-9);
  });
});
