// Player debuffs over the wire (GAME_SPEC §13): the ClientWorld's debuff lists (remote players on the render timeline,
// the local player on the live timeline) and the local player's prediction under roots, freezes, chill and tar pools.
import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/contracts/sim';
import type { PlayerDebuffView } from '../../src/contracts/sim';
import { DebuffClock, WARD_DEBUFF_RATE, debuffTimerAt } from '../../src/net/prediction';
import { NetHarness } from './harness';
import { makeArea, makePlayer } from './fixtures';

/** Seqs whose authoritative position equals the previous seq's (the server did not move her on that input). */
function stuckSeqs(h: NetHarness): number[] {
  const out: number[] = [];
  for (const [seq, pos] of h.serverAt) {
    const prev = h.serverAt.get(seq - 1);
    if (prev && prev.x === pos.x && prev.y === pos.y) out.push(seq);
  }
  return out;
}

function maxPredictionError(h: NetHarness, from: number, to: number): { compared: number; maxErr: number } {
  let compared = 0;
  let maxErr = 0;
  for (const [seq, pred] of h.predictedAt) {
    if (seq < from || seq > to) continue;
    const auth = h.serverAt.get(seq);
    if (!auth) continue;
    maxErr = Math.max(maxErr, Math.hypot(pred.x - auth.x, pred.y - auth.y));
    compared++;
  }
  return { compared, maxErr };
}

describe('debuff timing helpers', () => {
  it('rebuilds a tick-aligned timer to the sim\'s exact double from its millisecond wire value', () => {
    // The sim: t = duration, then t -= SIM_DT per tick. A 2 s chill leaves a positive residue after 120 ticks and
    // only expires on the 121st; the rebuilt timer must reproduce that, the raw ms value cannot.
    let exact = 2;
    for (let k = 0; k < 90; k++) exact -= SIM_DT;
    const wire = Math.round(exact * 1000) / 1000;
    expect(debuffTimerAt(wire, 2)).toBe(exact);
    let t = debuffTimerAt(wire, 2);
    let ticks = 0;
    while (t > 0) {
      t -= SIM_DT;
      ticks++;
    }
    expect(90 + ticks).toBe(121);
    // Not consistent with whole ticks off the duration (resistance-scaled, ward): the wire value as is.
    expect(debuffTimerAt(1.2345, 2)).toBe(1.2345);
    expect(debuffTimerAt(0, 2)).toBe(0);
    expect(debuffTimerAt(0.5, 0)).toBe(0.5);
  });

  it('runs rooted / frozen / chilled forward like the sim: after the move, twice as fast under the ward', () => {
    const clock = new DebuffClock();
    const list: PlayerDebuffView[] = [
      { id: 'rooted', remaining: 0.05, duration: 1.4, stacks: 1, source: 'web' },
      { id: 'chilled', remaining: 1, duration: 2, stacks: 1, source: null },
      { id: 'burning', remaining: 2, duration: 3, stacks: 1, source: null },
    ];
    clock.load(list, 0);
    expect(clock.rooted && clock.chilled && !clock.frozen && clock.any).toBe(true);
    // 0.05 s = 3 ticks: held on the next three moves, free on the fourth.
    const held: boolean[] = [];
    for (let k = 0; k < 4; k++) {
      clock.beginTick();
      held.push(clock.rooted);
      clock.endTick();
    }
    expect(held).toEqual([true, true, true, false]);
    expect(clock.left(list[0])).toBe(0);
    expect(clock.left(list[2])).toBeCloseTo(2 - 4 * SIM_DT, 9); // untracked debuffs: remaining − elapsed
    // Under Cinder Ward every timer loses WARD_DEBUFF_RATE ticks' worth per tick.
    clock.load(list, 3);
    clock.beginTick();
    clock.endTick();
    expect(clock.left(list[1])).toBeCloseTo(1 - WARD_DEBUFF_RATE * SIM_DT, 9);
    clock.load(undefined, 0);
    expect(clock.any).toBe(false);
  });
});

describe('ClientWorld debuff lists', () => {
  it('shows every player\'s debuffs: allies on the render timeline, her own on the live timeline', () => {
    const ally = makePlayer(2, { name: 'Brann', x: 60, y: 0 });
    const h = new NetHarness({ latencyMs: 40 }, {
      tick(hh, t) {
        if (t === 1) hh.view.players.push(ally);
        // The ally's timer runs down like the sim's (no harness model for allies): first, then new debuffs land.
        for (const d of ally.debuffs) d.remaining -= SIM_DT;
        ally.debuffs = ally.debuffs.filter((d) => d.remaining > 1e-9);
        if (t === 120) {
          hh.applyDebuff('chilled', 2);
          ally.debuffs.push({ id: 'bleeding', remaining: 4, duration: 4, stacks: 2, source: null });
        }
      },
    });
    const localSeen: number[] = [];
    const allySeen: number[] = [];
    let arrays: { mine: PlayerDebuffView[]; theirs: PlayerDebuffView[] } | null = null;
    h.run(8000, () => ({ moveX: 0, moveY: 0 }), (hh) => {
      const me = hh.client.view.players.find((p) => p.id === 1);
      const other = hh.client.view.players.find((p) => p.id === 2);
      if (!me || !other) return;
      if (!arrays) arrays = { mine: me.debuffs, theirs: other.debuffs };
      // The view's arrays are stable for the lifetime of the player views.
      expect(me.debuffs).toBe(arrays.mine);
      expect(other.debuffs).toBe(arrays.theirs);
      const render = hh.client.renderTick;
      if (me.debuffs.length) {
        const d = me.debuffs[0];
        expect(d).toMatchObject({ id: 'chilled', duration: 2, stacks: 1, source: null });
        // Her predicted present: the newest record's timer minus the inputs predicted past it (ms on the wire).
        const truth = 2 - (hh.client.latestTick - 120) * SIM_DT - hh.client.stats().pendingInputs * SIM_DT;
        expect(Math.abs(d.remaining - truth)).toBeLessThan(0.0006);
        expect(d.remaining).toBeGreaterThan(0);
        localSeen.push(hh.client.latestTick);
      }
      if (other.debuffs.length) {
        const d = other.debuffs[0];
        expect(d).toMatchObject({ id: 'bleeding', duration: 4, stacks: 2, source: null });
        // Render timeline: the timer at the render tick (full while the render time is before it landed).
        const truth = Math.min(4, 4 - (render - 120) * SIM_DT);
        expect(Math.abs(d.remaining - truth)).toBeLessThan(0.002);
        allySeen.push(render);
      }
    });
    expect(localSeen.length).toBeGreaterThan(200);
    expect(allySeen.length).toBeGreaterThan(400);
    // Her chill is on screen right when the newest snapshot has it; the ally's bleed ~2.2 snapshots later.
    expect(Math.min(...localSeen)).toBeGreaterThanOrEqual(120);
    expect(Math.max(...localSeen)).toBeLessThan(240);
    expect(Math.min(...allySeen)).toBeGreaterThan(117); // the bracket's newer snapshot has it
    expect(Math.max(...allySeen)).toBeLessThan(360);
    const me = h.client.view.players.find((p) => p.id === 1)!;
    expect(me.debuffs).toHaveLength(0);
    expect(h.client.view.players.find((p) => p.id === 2)!.debuffs).toHaveLength(0);
  });

  it('carries stacks and root sources, reuses its objects, and drops a player\'s list on death', () => {
    const h = new NetHarness({ latencyMs: 30 }, {
      tick(hh, t) {
        if (t === 60) hh.applyDebuff('rooted', 1.4, { source: 'chain' });
        if (t === 62) hh.applyDebuff('withered', 4, { stacks: 3 });
        if (t === 200) {
          hh.player.dead = true;
          hh.playerAnim = 'death';
        }
      },
    });
    let sawBoth = false;
    const objects = new Set<PlayerDebuffView>();
    h.run(3600, () => ({ moveX: 0, moveY: 0 }), (hh) => {
      const me = hh.client.view.players.find((p) => p.id === 1);
      if (!me) return;
      for (const d of me.debuffs) objects.add(d);
      const root = me.debuffs.find((d) => d.id === 'rooted');
      const wither = me.debuffs.find((d) => d.id === 'withered');
      if (root) expect(root.source).toBe('chain');
      if (wither) expect(wither.stacks).toBe(3);
      if (root && wither) sawBoth = true;
      if (me.dead) expect(me.debuffs).toHaveLength(0);
    });
    expect(sawBoth).toBe(true);
    expect(objects.size).toBeLessThanOrEqual(2); // pooled: no per-frame allocation
  });
});

describe('prediction under debuffs', () => {
  const east = () => ({ moveX: 1, moveY: 0.3 });

  it('stops her while rooted and lets her go on the tick the root runs out, exactly like the server', () => {
    const h = new NetHarness({ latencyMs: 45, moveSpeed: 137 }, {
      tick(hh, t) {
        if (t === 150) hh.applyDebuff('rooted', 1.4, { source: 'web' });
      },
    });
    let frozenFrames = 0;
    h.run(5000, east, (hh) => {
      const me = hh.client.view.players.find((p) => p.id === 1);
      if (!me) return;
      if (me.debuffs.some((d) => d.id === 'rooted') && hh.client.predictedPosition()) {
        // Holding a direction while rooted: no run-in-place, no velocity.
        expect(me.vx).toBe(0);
        expect(me.vy).toBe(0);
        expect(me.anim).toBe('idle');
        frozenFrames++;
      }
    });
    const stuck = stuckSeqs(h);
    expect(stuck.length).toBe(84); // ticks 151..234: 1.4 s, the timer runs down after each held move
    const first = stuck[0];
    const last = stuck[stuck.length - 1];
    expect(last - first).toBe(83);
    expect(frozenFrames).toBeGreaterThan(100);
    // Inputs predicted after the root reached the client (≈ RTT + a snapshot later) are exact, through the release.
    const { compared, maxErr } = maxPredictionError(h, first + 12, last + 120);
    expect(compared).toBeGreaterThan(130); // through the release to the end of the run
    expect(maxErr).toBeLessThan(1e-3);
    // The root never corrupts the learned speed, and the slide back to where it caught her is blended, not snapped.
    expect(h.client.stats().moveSpeed).toBeCloseTo(137, 3);
    expect(h.client.stats().snaps).toBe(0);
    expect(h.client.stats().lastCorrection).toBeLessThan(1e-3);
  });

  it('keeps her in place while frozen: no movement and no cast starts until it thaws', () => {
    const h = new NetHarness({ latencyMs: 40, moveSpeed: 130, skills: [{ slot: 1, skill: 'emberNova', castTime: 0.45 }] }, {
      tick(hh, t) {
        if (t === 200) hh.applyDebuff('frozen', 0.8);
      },
    });
    h.client.setPredictionHints({ moveSpeed: 130, castTimes: { emberNova: 0.45 } });
    h.run(6000, (seq) => ({ moveX: 0.6, moveY: -0.8, held: seq > 100 && seq % 80 < 30 ? 2 : 0 }));
    const stuck = stuckSeqs(h);
    expect(stuck.length).toBe(48);
    const { compared, maxErr } = maxPredictionError(h, stuck[0] + 12, stuck[0] + 140);
    expect(compared).toBeGreaterThan(120);
    expect(maxErr).toBeLessThan(1e-3);
    expect(h.client.stats().moveSpeed).toBeCloseTo(130, 3);
  });

  it('moves and casts chilled at the spec rates without touching the learned speed or cast times', () => {
    const h = new NetHarness({ latencyMs: 50, moveSpeed: 140, skills: [{ slot: 1, skill: 'emberNova', castTime: 0.45 }] }, {
      tick(hh, t) {
        if (t === 400) hh.applyDebuff('chilled', 3);
      },
    });
    // No hints: the cast time is learned from unchilled casts first, and must not be re-learned from chilled ones.
    h.run(12000, (seq) => ({ moveX: Math.cos(seq * 0.01), moveY: Math.sin(seq * 0.01), held: seq > 60 && seq % 120 < 70 ? 2 : 0 }));
    expect(h.client.stats().moveSpeed).toBeCloseTo(140, 3);
    // Chilled window: ticks 401..579. Predictions made with the chill known are exact, casts included.
    const during = maxPredictionError(h, 415, 575);
    expect(during.compared).toBeGreaterThan(140);
    expect(during.maxErr).toBeLessThan(1e-3);
    const after = maxPredictionError(h, 600, 700);
    expect(after.maxErr).toBeLessThan(1e-3);
    const seqs = [...h.serverAt.keys()].filter((s) => s > 420 && s < 570);
    // She really was slowed: 0.7 × the base speed (× 0.7 again while casting).
    const step = (s: number) => Math.hypot(h.serverAt.get(s)!.x - h.serverAt.get(s - 1)!.x, h.serverAt.get(s)!.y - h.serverAt.get(s - 1)!.y);
    const steps = seqs.filter((s) => h.serverAt.has(s - 1)).map(step);
    expect(Math.max(...steps)).toBeCloseTo(140 * 0.7 * SIM_DT, 3);
  });

  it('slows her in a tar pool and predicts walking through it exactly', () => {
    const h = new NetHarness({ latencyMs: 45, moveSpeed: 137, startX: -150, startY: 0 });
    h.view.areas.push(makeArea({ id: 77, kind: 'tarPool', x: 0, y: 4, radius: 46, age: 0, duration: 60 }));
    h.run(6000, () => ({ moveX: 1, moveY: 0 }));
    const { compared, maxErr } = maxPredictionError(h, 20, 400);
    expect(compared).toBeGreaterThan(300);
    expect(maxErr).toBeLessThan(1e-3);
    // The pool really slowed her, and the slowed samples never fed the speed estimate.
    const inPool = [...h.serverAt.entries()].filter(([s, p]) => Math.abs(p.x) < 30 && h.serverAt.has(s - 1));
    expect(inPool.length).toBeGreaterThan(10);
    for (const [s, p] of inPool) expect(p.x - h.serverAt.get(s - 1)!.x).toBeCloseTo(137 * 0.5 * SIM_DT, 3);
    expect(h.client.stats().moveSpeed).toBeCloseTo(137, 3);
  });

  it('degrades gracefully when the sim slows differently: small blended corrections, speed estimate intact', () => {
    const h = new NetHarness({ latencyMs: 60, moveSpeed: 150, chillSlow: 0.45 }, {
      tick(hh, t) {
        if (t % 400 === 100) hh.applyDebuff('chilled', 2);
      },
    });
    let maxJump = 0;
    let last: { x: number; y: number } | null = null;
    h.run(10000, (seq) => ({ moveX: Math.cos(seq * 0.013), moveY: Math.sin(seq * 0.017) }), (hh) => {
      const r = hh.localRender();
      if (r && last) maxJump = Math.max(maxJump, Math.hypot(r.x - last.x, r.y - last.y));
      last = r;
    });
    expect(h.client.stats().moveSpeed).toBeCloseTo(150, 3);
    expect(h.client.stats().snaps).toBe(0);
    // On screen she never jumps: at most a running frame plus a slice of the blended correction.
    expect(maxJump).toBeLessThan((150 / 144) * 2);
    // Unchilled stretches are exact again.
    const clean = maxPredictionError(h, 260, 480);
    expect(clean.maxErr).toBeLessThan(1e-3);
  });

  it('runs a root out twice as fast under Cinder Ward, and a 2 s chill to its exact last tick', () => {
    const h = new NetHarness({ latencyMs: 40, moveSpeed: 137 }, {
      tick(hh, t) {
        if (t === 100) {
          hh.player.wardTime = 5;
          hh.player.wardDuration = 5;
        }
        if (t === 150) hh.applyDebuff('rooted', 1.4, { source: 'bone' });
        if (t === 500) hh.applyDebuff('chilled', 2);
      },
    });
    // Circling (radius ≈ 115 units) keeps her clear of the arena edge for the whole run.
    h.run(12000, (seq) => ({ moveX: Math.cos(seq * 0.02), moveY: Math.sin(seq * 0.02) }));
    // 1.4 s at 2× = 42 held ticks (the ward is still up when the root runs out).
    const stuck = stuckSeqs(h);
    expect(stuck.length).toBe(42);
    const root = maxPredictionError(h, stuck[0] + 12, stuck[0] + 200);
    expect(root.compared).toBeGreaterThan(150);
    expect(root.maxErr).toBeLessThan(1e-3);
    // The chill: the float timer outlives 120 ticks by a hair; predicted inputs through its 121st tick stay exact.
    const chill = maxPredictionError(h, 515, 700);
    expect(chill.compared).toBeGreaterThan(150);
    expect(chill.maxErr).toBeLessThan(1e-3);
    expect(h.client.stats().moveSpeed).toBeCloseTo(137, 3);
  });

  it('snaps back into sync when a root is broken early (Rift Step, cleanse): no stuck prediction', () => {
    const h = new NetHarness({ latencyMs: 45, moveSpeed: 137 }, {
      tick(hh, t) {
        if (t === 120) hh.applyDebuff('rooted', 1.4, { source: 'tar' });
        if (t === 150) hh.player.debuffs.length = 0; // broken after half a second
      },
    });
    h.run(5000, east);
    expect(stuckSeqs(h).length).toBe(30);
    const { maxErr } = maxPredictionError(h, 200, 400);
    expect(maxErr).toBeLessThan(1e-3);
    expect(h.client.stats().moveSpeed).toBeCloseTo(137, 3);
  });
});

describe('prediction of chain hook drags', () => {
  const east = () => ({ moveX: 1, moveY: 0.3 });

  /** Seqs the server applied while the drag held her (moved, but not by her input: velocity-free steps). */
  function draggedSeqs(h: NetHarness, fromSeq: number, toSeq: number): number[] {
    const out: number[] = [];
    for (let s = fromSeq; s <= toSeq; s++) {
      const a = h.serverAt.get(s - 1);
      const b = h.serverAt.get(s);
      if (a && b && (a.x !== b.x || a.y !== b.y) && b.x < a.x) out.push(s); // she runs east; the hook drags her west
    }
    return out;
  }

  function hooked(opts: { noteEvents?: boolean; eventsFirst?: boolean; rooted?: boolean; latencyMs?: number } = {}) {
    const h = new NetHarness({ latencyMs: opts.latencyMs ?? 45, moveSpeed: 137, noteEvents: opts.noteEvents, eventsFirst: opts.eventsFirst }, {
      tick(hh, t) {
        if (t === 150) hh.pull(hh.player.x - 200, hh.player.y + 40, 40, opts.rooted ?? true);
      },
    });
    h.client.setPredictionHints({ moveSpeed: 137 }); // no start-up correction: only the drag is measured
    let maxJump = 0;
    let last: { x: number; y: number } | null = null;
    h.run(9000, east, (hh) => {
      const r = hh.localRender();
      if (r && last) maxJump = Math.max(maxJump, Math.hypot(r.x - last.x, r.y - last.y));
      last = r;
    });
    return { h, maxJump };
  }

  it('replays the drag exactly once her pull is known: one blended correction instead of one per snapshot', () => {
    const { h, maxJump } = hooked();
    // The server really dragged her: 16 steps of the sim's lerp toward the hook, ≈ 40 units.
    const dragged = draggedSeqs(h, 140, 200);
    expect(dragged.length).toBe(15); // the 16th step lands on `to` itself (u = 1 after 0.9999999999999998)
    const first = dragged[0];
    const from = h.serverAt.get(first - 1)!;
    const to = h.serverAt.get(first + 15)!;
    expect(Math.hypot(to.x - from.x, to.y - from.y)).toBeCloseTo(40, 3);
    // Every input predicted once the snapshot + pull reached her is exact — through the drag and the root after it.
    const { compared, maxErr } = maxPredictionError(h, first + 12, first + 300);
    expect(compared).toBeGreaterThan(250);
    expect(maxErr).toBeLessThan(1e-3);
    const st = h.client.stats();
    expect(st.pulls).toBe(1);
    expect(st.snaps).toBe(0);
    // The root and the drag arrive together (snapshot, then its events): at most one correction each.
    expect(st.corrections).toBeLessThanOrEqual(2);
    expect(st.moveSpeed).toBeCloseTo(137, 3);
    // On screen the yank is blended, never a teleport.
    expect(maxJump).toBeLessThan(12);
  });

  it('without the pull event every snapshot of the drag is a correction (what noteEvents saves)', () => {
    const blind = hooked({ noteEvents: false }).h.client.stats();
    expect(blind.pulls).toBe(0);
    expect(blind.corrections).toBeGreaterThanOrEqual(7);
  });

  it('drags her during the root grace too (no root): held for the drag, free on its exact last tick', () => {
    const { h } = hooked({ rooted: false });
    const dragged = draggedSeqs(h, 140, 200);
    expect(dragged.length).toBe(15);
    const { compared, maxErr } = maxPredictionError(h, dragged[0] + 12, dragged[0] + 300);
    expect(compared).toBeGreaterThan(250);
    expect(maxErr).toBeLessThan(1e-3);
    expect(h.client.stats().pulls).toBe(1);
  });

  it('matches a pull whose event arrives before its snapshot on the next snapshot instead', () => {
    const { h } = hooked({ eventsFirst: true });
    const dragged = draggedSeqs(h, 140, 200);
    const { maxErr } = maxPredictionError(h, dragged[0] + 12, dragged[0] + 300);
    expect(maxErr).toBeLessThan(1e-3);
    expect(h.client.stats().pulls).toBe(1);
  });

  it('drops a drag that a Rift Step breaks mid-way, and ignores other players\' pulls', () => {
    const h = new NetHarness({ latencyMs: 40, moveSpeed: 137 }, {
      tick(hh, t) {
        if (t === 150) hh.pull(hh.player.x - 200, hh.player.y, 40);
        if (t === 156) {
          // Rift Step: breaks the root and the drag, blinks her ahead.
          hh.pullState = null;
          hh.player.debuffs.length = 0;
          hh.player.x += 70;
          hh.playerAnim = 'dash';
        }
        if (t === 170) hh.playerAnim = 'idle';
        if (t === 300) hh.pendingEvents.push({ t: 'pull', playerId: 2, fromX: 0, fromY: 0, toX: 40, toY: 0 });
      },
    });
    h.run(6000, east);
    const { compared, maxErr } = maxPredictionError(h, 200, 400);
    expect(compared).toBeGreaterThan(150);
    expect(maxErr).toBeLessThan(1e-3);
    expect(h.client.stats().pulls).toBe(1);
  });
});

describe('prediction learning at debuff boundaries', () => {
  it('never learns a slowed base speed from the record on which a chill ran out', () => {
    // The chill lands after the move of tick 101, runs 121 moves (2 s outlives 120 ticks by a hair) and is gone from the
    // record of tick 222 — a snapshot tick — whose velocity was still chilled. No clean sample is younger than 90 ticks.
    const h = new NetHarness({ latencyMs: 40, moveSpeed: 137 }, {
      tick(hh, t) {
        if (t === 101) hh.applyDebuff('chilled', 2);
      },
    });
    let minSpeed = Infinity;
    let chilledRecord = false;
    h.run(6000, (seq) => ({ moveX: Math.cos(seq * 0.02), moveY: Math.sin(seq * 0.02) }), (hh) => {
      if (hh.client.latestTick > 60) minSpeed = Math.min(minSpeed, hh.client.stats().moveSpeed);
      if (hh.client.latestTick === 222) chilledRecord = true;
    });
    expect(chilledRecord).toBe(true);
    expect(minSpeed).toBeCloseTo(137, 3);
    const { maxErr } = maxPredictionError(h, 240, 360);
    expect(maxErr).toBeLessThan(1e-3);
  });
});

describe('the local player while frozen', () => {
  it('holds her pose, facing, animation clock and cast bar like the server (and her friends) do, then resumes', () => {
    const h = new NetHarness({ latencyMs: 40, moveSpeed: 130, skills: [{ slot: 1, skill: 'emberNova', castTime: 0.45 }] }, {
      tick(hh, t) {
        if (t === 200) hh.applyDebuff('frozen', 0.8);
      },
    });
    h.client.setPredictionHints({ moveSpeed: 130, castTimes: { emberNova: 0.45 } });
    const frozen: { anim: string; animTime: number; facing: string; cast: number }[] = [];
    let thawedRunning = 0;
    // Running north-east; Ember Nova held from seq 185 so a cast is running when the ice closes.
    h.run(5000, (seq) => ({ moveX: 0.8, moveY: -0.6, held: seq >= 185 && seq < 200 ? 2 : 0 }), (hh) => {
      const me = hh.client.view.players.find((p) => p.id === 1);
      if (!me || !hh.client.predictedPosition()) return;
      if (me.debuffs.some((d) => d.id === 'frozen')) {
        frozen.push({ anim: me.anim, animTime: me.animTime, facing: me.facing, cast: me.castProgress });
        expect(Math.hypot(me.vx, me.vy)).toBe(0);
      } else if (frozen.length > 0 && me.anim === 'run') thawedRunning++;
    });
    expect(frozen.length).toBeGreaterThan(60);
    // Every frozen frame shows the same held pose (the server's), no idle breathing, no turning, no cast progress.
    const first = frozen[0];
    for (const f of frozen) expect(f).toEqual(first);
    expect(first.anim).toBe('cast');
    expect(first.cast).toBeGreaterThan(0);
    expect(thawedRunning).toBeGreaterThan(30); // she runs again once thawed
  });
});
