import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/contracts/sim';
import { CORRECTION_RATE, SNAP_DISTANCE } from '../../src/net';
import { NetHarness } from './harness';
import { makeProp } from './fixtures';

const wander = (seq: number) => {
  // Curving walk with periodic stops (exercises start/stop/turn).
  if (seq % 150 > 120) return { moveX: 0, moveY: 0 };
  const a = seq * 0.035;
  return { moveX: Math.cos(a), moveY: Math.sin(a) * 0.8 };
};

function comparePredictions(h: NetHarness, fromSeq: number): { compared: number; maxErr: number } {
  let compared = 0;
  let maxErr = 0;
  for (const [seq, pred] of h.predictedAt) {
    if (seq < fromSeq) continue;
    const auth = h.serverAt.get(seq);
    if (!auth) continue;
    maxErr = Math.max(maxErr, Math.hypot(pred.x - auth.x, pred.y - auth.y));
    compared++;
  }
  return { compared, maxErr };
}

describe('local player prediction', () => {
  it('replays unacked inputs so the prediction equals the future authoritative position', () => {
    const h = new NetHarness({ latencyMs: 45, moveSpeed: 137 });
    h.run(4000, wander);
    expect(h.repeats).toBe(0); // clean network: the server never starved
    // The very first inputs are predicted with the default speed until a moving snapshot reveals 137.
    const { compared, maxErr } = comparePredictions(h, 40);
    expect(compared).toBeGreaterThan(150);
    expect(maxErr).toBeLessThan(1e-3);
    expect(h.client.stats().moveSpeed).toBeCloseTo(137, 3);
    expect(h.client.stats().snaps).toBe(0);
  });

  it('collides with props and the arena edge exactly like the server', () => {
    const props = [
      makeProp({ id: 1, kind: 'pillar', x: 60, y: 4, radius: 12 }),
      makeProp({ id: 2, kind: 'standingStone', x: 140, y: -10, radius: 9 }),
    ];
    const h = new NetHarness({ latencyMs: 30, props, arenaRadius: 220, startX: 0, startY: 0 });
    h.run(3500, (seq) => (seq < 120 ? { moveX: 1, moveY: 0 } : { moveX: Math.cos(seq * 0.02), moveY: Math.sin(seq * 0.02) }));
    const { compared, maxErr } = comparePredictions(h, 30);
    expect(compared).toBeGreaterThan(150);
    expect(maxErr).toBeLessThan(1e-3);
    // She really was blocked: never inside the pillar, never outside the arena.
    for (const p of h.predictedAt.values()) {
      expect(Math.hypot(p.x - 60, p.y - 4)).toBeGreaterThan(12 + 7 - 1e-3);
      expect(Math.hypot(p.x, p.y)).toBeLessThanOrEqual(220 - 7 + 1e-3);
    }
  });

  it('keeps the base speed through a cast slow and applies the slow when replaying', () => {
    const h = new NetHarness({ latencyMs: 35, moveSpeed: 150 }, {
      beforeMove(hh, t) {
        const casting = t >= 120 && t < 200;
        hh.castSlow = casting;
        hh.player.castSkill = casting ? 'emberNova' : null;
      },
    });
    h.run(4500, () => ({ moveX: 0.6, moveY: -0.8 }));
    expect(h.client.stats().moveSpeed).toBeCloseTo(150, 3);
    // Inputs predicted well inside the cast (after the client saw it start) replay with the slow: exact again.
    let compared = 0;
    for (const [seq, pred] of h.predictedAt) {
      const auth = h.serverAt.get(seq);
      if (!auth || seq < 150 || seq > 180) continue;
      expect(Math.hypot(pred.x - auth.x, pred.y - auth.y)).toBeLessThan(1e-3);
      compared++;
    }
    expect(compared).toBeGreaterThan(10);
  });

  it('blends a small correction out at ~10/s without a visible pop', () => {
    let shoved = false;
    const h = new NetHarness({ latencyMs: 40 }, {
      tick(hh, t) {
        if (t === 90) {
          hh.player.x += 20; // a shove the client could not predict
          shoved = true;
        }
      },
    });
    const samples: { now: number; x: number; err: number }[] = [];
    h.run(2600, () => ({ moveX: 0, moveY: 0 }), (hh) => {
      const r = hh.localRender();
      const p = hh.client.predictedPosition();
      if (r && p) samples.push({ now: hh.now, x: r.x, err: r.x - p.x });
    });
    expect(shoved).toBe(true);
    const first = samples.findIndex((s) => Math.abs(s.err) > 1);
    expect(first).toBeGreaterThan(0);
    // The on-screen position does not jump when the correction arrives: the first frame already blends at 10/s...
    const blendStep = 20 * CORRECTION_RATE * (7 / 1000) + 0.05;
    expect(Math.abs(samples[first].x - samples[first - 1].x)).toBeLessThan(blendStep);
    expect(samples[first].err).toBeLessThan(-15);
    // ...it converges exponentially.
    const t0 = samples[first].now;
    const e0 = samples[first].err;
    const at = (ms: number) => samples.find((s) => s.now >= t0 + ms)!;
    expect(at(100).err / e0).toBeCloseTo(Math.exp((-CORRECTION_RATE * 100) / 1000), 1);
    expect(Math.abs(at(500).err)).toBeLessThan(0.25);
    for (let k = first + 1; k < samples.length; k++) {
      expect(Math.abs(samples[k].x - samples[k - 1].x)).toBeLessThan(blendStep);
    }
  });

  it('snaps on large errors and on blinks', () => {
    const h = new NetHarness({ latencyMs: 40 }, {
      tick(hh, t) {
        if (t === 90) hh.player.x += SNAP_DISTANCE + 40; // teleport-sized error
        if (t === 200) {
          hh.player.x += 12; // a short Rift Step (below the jump heuristic): a blink must still never slide
          hh.playerAnim = 'dash';
        }
        if (t === 212) hh.playerAnim = 'idle';
      },
    });
    const errs: { now: number; err: number; x: number }[] = [];
    h.run(4000, () => ({ moveX: 0, moveY: 0 }), (hh) => {
      const r = hh.localRender();
      const p = hh.client.predictedPosition();
      if (r && p) errs.push({ now: hh.now, err: Math.abs(r.x - p.x), x: r.x });
    });
    expect(Math.max(...errs.map((e) => e.err))).toBeLessThan(1e-6);
    expect(h.client.stats().snaps).toBe(2);
    expect(errs[errs.length - 1].x).toBeCloseTo(SNAP_DISTANCE + 40 + 12, 3);
  });

  it('renders the moving local player smoothly at 144 Hz and reacts on the very next frame', () => {
    const h = new NetHarness({ latencyMs: 50, moveSpeed: 120 });
    h.run(1000, () => ({ moveX: 0, moveY: 0 }));
    const xs: number[] = [];
    let reacted = -1;
    let frame = 0;
    h.run(1500, () => ({ moveX: 1, moveY: 0 }), (hh) => {
      const me = hh.client.view.players.find((p) => p.id === 1)!;
      const r = hh.localRender()!;
      xs.push(r.x);
      if (reacted < 0 && me.anim === 'run') {
        reacted = frame;
        expect(me.facing).toBe('east');
        expect(me.vx).toBeGreaterThan(0);
      }
      frame++;
    });
    // Input latency: running on the first frames, long before the server (50 ms away) confirms anything.
    expect(reacted).toBeGreaterThanOrEqual(0);
    expect(reacted).toBeLessThanOrEqual(3);
    const steps = xs.slice(200).map((x, i, a) => (i ? x - a[i - 1] : 120 / 144)).slice(1);
    const nominal = 120 / 144;
    for (const s of steps) expect(Math.abs(s - nominal)).toBeLessThan(nominal * 0.6);
    const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
    expect(mean).toBeCloseTo(nominal, 1);
  });

  it('stays continuous and converges under jitter (server-side input starvation)', () => {
    const h = new NetHarness({ latencyMs: 40, jitterMs: 30, seed: 3, moveSpeed: 130 });
    let maxJump = 0;
    let last: { x: number; y: number } | null = null;
    h.run(6000, wander, (hh) => {
      const r = hh.localRender();
      if (r && last) maxJump = Math.max(maxJump, Math.hypot(r.x - last.x, r.y - last.y));
      last = r;
    });
    expect(h.repeats).toBeGreaterThan(0); // the scenario really produced mispredictions
    // A frame never moves more than a running frame plus a slice of correction.
    expect(maxJump).toBeLessThan((130 / 144) * 2.5);
    // Standing still at the end: the display converges onto the authoritative position.
    h.run(1500, () => ({ moveX: 0, moveY: 0 }));
    const r = h.localRender()!;
    expect(Math.hypot(r.x - h.player.x, r.y - h.player.y)).toBeLessThan(0.01);
  });

  it('settles into a jitter cushion: 30–60 ms of uplink jitter stops causing corrections', () => {
    for (const jitterMs of [30, 60]) {
      const h = new NetHarness({ latencyMs: 40, jitterMs, seed: 9, moveSpeed: 130 });
      h.run(1000, wander);
      const c0 = h.client.stats().corrections;
      let queued = 0;
      let frames = 0;
      h.run(8000, wander, (hh) => {
        queued += hh.inputQueue.length;
        frames++;
      });
      expect(h.repeats).toBeGreaterThan(0); // the first spikes did starve the server…
      expect(h.client.stats().corrections - c0).toBe(0); // …then the queue kept a cushion
      expect(queued / frames).toBeLessThan(3); // ≈ 1–2 inputs of added server-side delay
      expect(h.inputQueue.skipped).toBe(0);
    }
  });

  it('does not move a dead player and snaps to the corpse', () => {
    const h = new NetHarness({ latencyMs: 30 }, {
      tick(hh, t) {
        if (t === 100) {
          hh.player.dead = true;
          hh.playerAnim = 'death';
        }
      },
    });
    h.run(2600, () => ({ moveX: 1, moveY: 1 }));
    const me = h.client.view.players.find((p) => p.id === 1)!;
    expect(me.dead).toBe(true);
    expect(me.anim).toBe('death');
    expect(me.vx).toBe(0);
    // Still holding the move keys: the body stays exactly where the server says it fell.
    expect(me.x).toBeCloseTo(h.player.x, 3); // f32 on the wire
    expect(me.y).toBeCloseTo(h.player.y, 3);
    const x0 = me.x;
    h.run(500, () => ({ moveX: 1, moveY: 1 }));
    expect(me.x).toBe(x0);
  });
});

describe('cast slow prediction', () => {
  it.each([0, 1, 2, 3, 4, 5])('predicts a timed active in slot %i without movement corrections', (slot) => {
    const h = new NetHarness({ latencyMs: 60, moveSpeed: 125, skills: [{ slot, skill: 'rimeShards', castTime: 0.34 }] });
    h.client.setPredictionHints({ moveSpeed: 125, castTimes: { rimeShards: 0.34 } });
    h.run(3000, (seq) => ({ moveX: 0.6, moveY: 0.8, held: seq > 40 && seq % 90 < 50 ? 1 << slot : 0 }));
    const { compared, maxErr } = comparePredictions(h, 1);
    expect(compared).toBeGreaterThan(150);
    expect(maxErr).toBeLessThan(1e-3);
    expect(h.client.stats().corrections).toBe(0);
  });

  // Kiting east while spamming a 0.34 s Rime Shards (held in bursts): the server slows every cast tick to 70 %.
  const speed = 125;
  const kite = (seq: number) => ({ moveX: 1, moveY: 0, held: seq % 130 < 95 ? 4 : 0 });

  function kiteRun(latencyMs: number, hints: boolean) {
    const h = new NetHarness({ latencyMs, moveSpeed: speed, skills: [{ slot: 2, skill: 'rimeShards', castTime: 0.34 }] });
    if (hints) h.client.setPredictionHints({ moveSpeed: speed, castTimes: { rimeShards: 0.34 } });
    // Warm-up: without hints, the first cast of the skill teaches the client its cast time.
    h.run(1500, kite);
    const corrections0 = h.client.stats().corrections;
    const xs: number[] = [];
    const errors: number[] = [];
    let c = corrections0;
    h.run(4000, kite, (hh) => {
      xs.push(hh.localRender()!.x);
      const st = hh.client.stats();
      if (st.corrections !== c) {
        c = st.corrections;
        errors.push(st.lastCorrection);
      }
    });
    const frame = h.opts.frameMs / 1000;
    const steps = xs.slice(1).map((x, k) => x - xs[k]);
    return { h, steps, slowStep: speed * 0.7 * frame, fullStep: speed * frame, corrections: c - corrections0, errors };
  }

  for (const latencyMs of [50, 90]) {
    it(`keeps on-screen speed within ±15 % of nominal through back-to-back casts at ${latencyMs} ms one-way`, () => {
      const { steps, slowStep, fullStep, corrections, errors } = kiteRun(latencyMs, false);
      for (const step of steps) {
        expect(step).toBeGreaterThanOrEqual(slowStep * 0.85);
        expect(step).toBeLessThanOrEqual(fullStep * 1.15);
      }
      // Cast starts and ends are predicted. With a cast time learned from snapshots, a chained cast whose carried
      // overshoot lands exactly on a tick boundary (every 5th cast of a 20.4-tick skill) can still end one tick off:
      // at most a one-tick slow difference (0.625 units), blended out. (It was ~22 corrections in 4 s before.)
      expect(corrections).toBeLessThanOrEqual(3);
      for (const e of errors) expect(e).toBeLessThanOrEqual(speed * 0.3 * SIM_DT + 1e-3);
    });
  }

  it('predicts back-to-back casts exactly with the cast time from the rules (zero corrections)', () => {
    const { h, steps, slowStep, fullStep, corrections } = kiteRun(70, true);
    expect(corrections).toBe(0);
    for (const step of steps) {
      expect(step).toBeGreaterThanOrEqual(slowStep * 0.85);
      expect(step).toBeLessThanOrEqual(fullStep * 1.15);
    }
    const { compared, maxErr } = comparePredictions(h, 1);
    expect(compared).toBeGreaterThan(300);
    expect(maxErr).toBeLessThan(1e-3);
  });

  it('predicts the very first cast when the rules hint the cast time', () => {
    const h = new NetHarness({ latencyMs: 60, moveSpeed: speed, skills: [{ slot: 1, skill: 'emberNova', castTime: 0.45 }] });
    h.client.setPredictionHints({ moveSpeed: speed, castTimes: { emberNova: 0.45 } });
    h.run(3000, (seq) => ({ moveX: 0.6, moveY: 0.8, held: seq > 40 && seq % 90 < 50 ? 2 : 0 }));
    const { compared, maxErr } = comparePredictions(h, 1);
    expect(compared).toBeGreaterThan(150);
    expect(maxErr).toBeLessThan(1e-3);
    expect(h.client.stats().corrections).toBe(0);
  });

  it('fills the local cast bar between snapshots once the cast time is known', () => {
    const h = new NetHarness({ latencyMs: 40, skills: [{ slot: 2, skill: 'rimeShards', castTime: 0.5 }] });
    h.client.setPredictionHints({ castTimes: { rimeShards: 0.5 } });
    let last = -1;
    let frames = 0;
    h.run(2000, () => ({ moveX: 0, moveY: 0, held: 4 }), (hh) => {
      const me = hh.client.view.players.find((p) => p.id === 1);
      if (!me || me.castSkill === null || hh.now < 800) return;
      // Monotonic within a cast, and never more than a frame's worth ahead of the last value.
      if (last >= 0 && me.castProgress >= last) expect(me.castProgress - last).toBeLessThan((hh.opts.frameMs / 1000 / 0.5) * 1.6);
      last = me.castProgress;
      frames++;
    });
    expect(frames).toBeGreaterThan(100);
  });
});
