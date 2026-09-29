import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/contracts/sim';
import { MAX_EXTRAPOLATION_TICKS, createClientWorld, createSnapshotEncoder } from '../../src/net';
import { NetHarness, TICK } from './harness';
import {
  killMonster, makeArea, makeDrop, makePlayer, makeProp, makeView, makeZone, putMonster, putMote, putProjectile, setTick,
} from './fixtures';

/** Presenter-style interpolation of a store position. */
function lerp(prev: number, cur: number, alpha: number): number {
  return prev + (cur - prev) * alpha;
}

describe('ClientWorld interpolation', () => {
  it('renders monsters at their true position for the render tick, ~2.2 snapshot intervals behind', () => {
    const h = new NetHarness({ latencyMs: 30 }, {
      tick(hh, t) {
        putMonster(hh.view, { slot: 7, gen: 2, kind: 1, x: 10 + t * 1.5, y: 20 - t * 0.5, anim: 1, animTime: t * SIM_DT });
      },
    });
    let checked = 0;
    let maxErr = 0;
    h.run(3000, undefined, (hh) => {
      const m = hh.client.view.monsters;
      if (!m.alive[7] || hh.now < 500) return;
      const rt = hh.client.renderTick;
      const x = lerp(m.prevX[7], m.x[7], hh.lastAlpha);
      const y = lerp(m.prevY[7], m.y[7], hh.lastAlpha);
      maxErr = Math.max(maxErr, Math.abs(x - (10 + rt * 1.5)), Math.abs(y - (20 - rt * 0.5)));
      // Anim time is evaluated at the render time too (smooth frames at any display rate).
      expect(m.animTime[7]).toBeCloseTo(rt * SIM_DT, 3);
      expect(m.id[7]).toBe((2 << 16) | 7);
      expect(m.kind[7]).toBe(1);
      checked++;
    });
    expect(checked).toBeGreaterThan(300);
    expect(maxErr).toBeLessThan(0.05);
    const stats = h.client.stats();
    expect(stats.interpDelayMs).toBeGreaterThanOrEqual(70);
    expect(stats.interpDelayMs).toBeLessThanOrEqual(80);
    const behind = (h.client.liveTick(h.now) - h.client.renderTick) * TICK;
    expect(Math.abs(behind - stats.interpDelayMs)).toBeLessThan(8);
    expect(stats.extrapolating).toBe(false);
  });

  it('matches entities by id: new ones do not slide in, removed ones vanish, reused slots restart', () => {
    const h = new NetHarness({ latencyMs: 20 }, {
      tick(hh, t) {
        putMonster(hh.view, { slot: 1, x: t, y: 0 });
        if (t >= 20) putMonster(hh.view, { slot: 2, x: 100 + t, y: 5 });
        if (t <= 20) putMonster(hh.view, { slot: 3, gen: 1, x: -50, y: t });
        else if (t === 21) killMonster(hh.view, 3);
        // Slot 4: generation 1 until tick 40, then a different monster far away reuses the slot.
        if (t <= 40) putMonster(hh.view, { slot: 4, gen: 1, x: 300, y: 300 + t });
        else putMonster(hh.view, { slot: 4, gen: 2, x: -300, y: -300 - t });
      },
    });
    let sawNew = false;
    let sawReuse = false;
    h.run(1500, undefined, (hh) => {
      const m = hh.client.view.monsters;
      const rt = hh.client.renderTick;
      if (hh.client.stats().extrapolating) return;
      const upper = Math.floor(rt / 2) * 2 + 2; // snapshots every 2 ticks
      const lower = upper - 2;
      if (m.alive[2] && lower < 20) {
        expect(m.prevX[2]).toBe(m.x[2]);
        sawNew = true;
      }
      if (m.alive[2] && lower >= 20) expect(m.x[2] - m.prevX[2]).toBeCloseTo(2, 3);
      if (upper > 20) expect(m.alive[3]).toBe(0);
      if (upper <= 20 && rt > 4) expect(m.alive[3]).toBe(1);
      if (upper > 40 && lower <= 40 && m.alive[4]) {
        expect(m.id[4]).toBe((2 << 16) | 4);
        expect(m.prevX[4]).toBe(m.x[4]); // never interpolated from the old occupant
        sawReuse = true;
      }
      let alive = 0;
      for (let i = 0; i < m.capacity; i++) alive += m.alive[i];
      expect(m.count).toBe(alive);
    });
    expect(sawNew).toBe(true);
    expect(sawReuse).toBe(true);
  });

  it('stays smooth under jitter, loss and reordering', () => {
    const speed = 1.2; // units per tick
    const h = new NetHarness({ latencyMs: 45, jitterMs: 35, reorder: 0.1, loss: 0.05, seed: 7 }, {
      tick(hh, t) {
        putMonster(hh.view, { slot: 9, x: t * speed, y: 0 });
        putProjectile(hh.view, { slot: 3, x: 500 - t * 4, y: 10, vx: -240, vy: 0, age: t * SIM_DT });
      },
    });
    let last = -Infinity;
    let frames = 0;
    let extrapFrames = 0;
    let maxErr = 0;
    let maxStep = 0;
    h.run(6000, undefined, (hh) => {
      const m = hh.client.view.monsters;
      if (!m.alive[9] || hh.now < 800) return;
      const x = lerp(m.prevX[9], m.x[9], hh.lastAlpha);
      const truth = Math.min(hh.client.renderTick, hh.client.latestTick + MAX_EXTRAPOLATION_TICKS) * speed;
      maxErr = Math.max(maxErr, Math.abs(x - truth));
      if (last > -Infinity) {
        expect(x).toBeGreaterThanOrEqual(last - 1e-3); // never moves backwards
        maxStep = Math.max(maxStep, x - last);
      }
      last = x;
      frames++;
      if (hh.client.stats().extrapolating) extrapFrames++;
      const p = hh.client.view.projectiles;
      if (p.alive[3]) {
        const px = lerp(p.prevX[3], p.x[3], hh.lastAlpha);
        expect(Math.abs(px - (500 - Math.min(hh.client.renderTick, hh.client.latestTick + MAX_EXTRAPOLATION_TICKS) * 4))).toBeLessThan(0.1);
      }
    });
    expect(frames).toBeGreaterThan(700);
    expect(maxErr).toBeLessThan(0.1);
    // At 144 Hz a frame advances 1/2.4 tick; time warp (≤ 10 %) keeps steps close to that.
    expect(maxStep).toBeLessThan((speed * 60) / 144 * 1.5);
    expect(extrapFrames / frames).toBeLessThan(0.1);
    expect(h.client.stats().interpDelayMs).toBeGreaterThan(80); // grew to cover the jitter
  });

  it('extrapolates at most 100 ms when the stream stops, then holds', () => {
    let sending = true;
    let lastSentX = 0;
    const h = new NetHarness({ latencyMs: 20 }, {
      tick(hh, t) {
        if (!sending) return;
        putMonster(hh.view, { slot: 1, x: t * 2, y: 0 });
        lastSentX = t * 2;
      },
    });
    h.run(1000);
    // Freeze the server view (the harness keeps encoding it, so drop delivery instead).
    const frozen = h.client.latestTick;
    sending = false;
    const client = h.client;
    const frames: number[] = [];
    // Drive the client alone for 400 ms without any new snapshot.
    for (let t = 0; t <= 400; t += 7) {
      const alpha = client.update(h.now + t);
      const m = client.view.monsters;
      frames.push(lerp(m.prevX[1], m.x[1], alpha));
    }
    const maxX = Math.max(...frames);
    expect(maxX).toBeLessThanOrEqual(frozen * 2 + 2 * MAX_EXTRAPOLATION_TICKS + 1e-3);
    expect(frames[frames.length - 1]).toBeCloseTo(maxX, 5); // holding, not drifting
    expect(client.stats().extrapolating).toBe(true);
    expect(lastSentX).toBeGreaterThan(0);
  });

  it('accepts out-of-order snapshots and ignores duplicates and garbage', () => {
    const cw = createClientWorld();
    cw.setZone(makeZone());
    const enc = createSnapshotEncoder();
    const v = makeView();
    v.players.push(makePlayer(1));
    const snaps = new Map<number, ArrayBuffer>();
    for (let t = 2; t <= 40; t += 2) {
      setTick(v, t);
      putMonster(v, { slot: 1, x: t * 3, y: 0 });
      snaps.set(t, enc.encode(v, 1, 0));
    }
    const order = [2, 4, 8, 6, 10, 14, 12, 16, 18, 20, 24, 22, 26, 28, 30, 32, 34, 36, 38, 40];
    let now = 1000;
    for (const t of order) {
      cw.pushSnapshot(snaps.get(t)!, now);
      now += 33.3;
    }
    cw.pushSnapshot(snaps.get(20)!, now); // duplicate
    cw.pushSnapshot(new Uint8Array([1, 2, 3]).buffer, now); // garbage
    expect(cw.stats().duplicates).toBe(1);
    expect(cw.stats().decodeErrors).toBe(1);
    expect(cw.latestTick).toBe(40);
    for (let k = 0; k < 20; k++) {
      const alpha = cw.update(now + k * 5);
      const m = cw.view.monsters;
      expect(lerp(m.prevX[1], m.x[1], alpha)).toBeCloseTo(Math.min(cw.renderTick, 40 + MAX_EXTRAPOLATION_TICKS) * 3, 2);
    }
  });

  it('keeps object identity stable across frames and zone changes', () => {
    const h = new NetHarness({}, {
      tick(hh, t) {
        putMonster(hh.view, { slot: 1, x: t, y: 0 });
      },
    });
    const view = h.client.view;
    const refs = [view.monsters, view.monsters.x, view.monsters.alive, view.projectiles, view.projectiles.x, view.motes, view.motes.x, view.players, view.areas, view.drops, view.props, view.run];
    h.run(600);
    const me = view.players.find((p) => p.id === 1)!;
    h.run(300);
    expect(view.players.find((p) => p.id === 1)).toBe(me);
    h.client.setZone(makeZone({ instanceId: 'hideout-2', kind: 'hideout', theme: 'hideout', arenaRadius: 400 }));
    expect(h.client.view).toBe(view);
    expect([view.monsters, view.monsters.x, view.monsters.alive, view.projectiles, view.projectiles.x, view.motes, view.motes.x, view.players, view.areas, view.drops, view.props, view.run]).toEqual(refs);
    refs.forEach((r, i) => expect([view.monsters, view.monsters.x, view.monsters.alive, view.projectiles, view.projectiles.x, view.motes, view.motes.x, view.players, view.areas, view.drops, view.props, view.run][i]).toBe(r));
    expect(view.monsters.count).toBe(0);
    expect(view.monsters.alive[1]).toBe(0);
    expect(view.players.length).toBe(0);
    expect(view.theme).toBe('hideout');
    expect(view.arenaRadius).toBe(400);
  });

  it('restarts cleanly when a new instance starts its tick counter over', () => {
    const cw = createClientWorld();
    cw.setZone(makeZone());
    const enc = createSnapshotEncoder();
    const v = makeView();
    v.players.push(makePlayer(1));
    setTick(v, 50_000);
    putMonster(v, { slot: 1, x: 1, y: 1 });
    cw.pushSnapshot(enc.encode(v, 1, 0), 0);
    cw.update(10);
    setTick(v, 2);
    killMonster(v, 1);
    putMonster(v, { slot: 2, x: 2, y: 2 });
    cw.pushSnapshot(enc.encode(v, 1, 0), 40);
    cw.update(50);
    expect(cw.stats().resets).toBe(1);
    expect(cw.latestTick).toBe(2);
    expect(cw.view.monsters.alive[1]).toBe(0);
    expect(cw.view.monsters.alive[2]).toBe(1);
  });
});

describe('ClientWorld drops, areas, props, players', () => {
  it('interpolates own drops on the render timeline and ages areas on the live clock', () => {
    const h = new NetHarness({ latencyMs: 25 }, {
      tick(hh, t) {
        hh.view.drops.length = 0;
        if (t >= 10) {
          const age = (t - 10) * SIM_DT;
          hh.view.drops.push(makeDrop({ id: 5, owner: 1, x: 40 + (t - 10), y: 10, z: Math.max(0, 12 - (t - 10) * 0.5), age }));
          hh.view.drops.push(makeDrop({ id: 6, owner: 2, x: 0, y: 0 })); // an ally's loot: never replicated to us
        }
        hh.view.areas.length = 0;
        if (t >= 30 && t < 84) hh.view.areas.push(makeArea({ id: 77, x: 5, y: 5, age: (t - 30) * SIM_DT, duration: 0.9 }));
        putMote(hh.view, 4, 200 - t, 0, 1);
      },
    });
    let dropFrames = 0;
    let areaFrames = 0;
    let lastAreaAge = -1;
    h.run(2000, undefined, (hh) => {
      const cw = hh.client;
      const d = cw.view.drops;
      expect(d.every((x) => x.spec.owner === 1)).toBe(true);
      if (d.length && !cw.stats().extrapolating) {
        const rt = cw.renderTick;
        const drop = d[0];
        expect(drop.id).toBe(5);
        expect(drop.spec.label).toBe('Forge Scrap');
        const x = lerp(drop.prevX, drop.x, hh.lastAlpha);
        if (rt >= 12) {
          expect(x).toBeCloseTo(40 + (rt - 10), 1);
          expect(drop.age).toBeCloseTo((rt - 10) * SIM_DT, 3);
        }
        dropFrames++;
      }
      const a = cw.view.areas;
      if (a.length) {
        const area = a[0];
        expect(area.age).toBeLessThanOrEqual(area.duration);
        // Ticks along smoothly between snapshots (live timeline), never backwards by more than a snapshot's slack.
        if (lastAreaAge >= 0) expect(area.age).toBeGreaterThanOrEqual(lastAreaAge - 2 * SIM_DT);
        lastAreaAge = area.age;
        areaFrames++;
      }
      const mo = cw.view.motes;
      if (mo.alive[4]) expect(mo.size[4]).toBe(1);
    });
    expect(dropFrames).toBeGreaterThan(100);
    expect(areaFrames).toBeGreaterThan(50);
  });

  it('merges static zone props with replicated dynamic props', () => {
    const cw = createClientWorld();
    const pillar = makeProp({ id: 1, kind: 'pillar', x: 50, y: 0, radius: 12, variant: 3 });
    const portal = makeProp({ id: 2, kind: 'portal', x: 0, y: -60, radius: 0, state: 8, interactive: true });
    const device = makeProp({ id: 3, kind: 'mapDevice', x: 0, y: -90, radius: 16, interactive: true });
    cw.setZone(makeZone({ kind: 'hideout', theme: 'hideout', props: [pillar, portal, device] }));
    expect(cw.view.props.map((p) => p.id)).toEqual([1, 2, 3]); // before any snapshot: the zone's list

    const enc = createSnapshotEncoder();
    const v = makeView({ theme: 'hideout' });
    v.players.push(makePlayer(1));
    v.props.push({ ...pillar }, { ...portal, state: 7 }, { ...device, state: 1 }, makeProp({ id: 9, kind: 'chest', x: 30, y: 30, radius: 10 }));
    setTick(v, 2);
    cw.pushSnapshot(enc.encode(v, 1, 0), 0);
    cw.update(100);
    const ids = cw.view.props.map((p) => p.id);
    expect(ids).toEqual([1, 2, 3, 9]);
    expect(cw.view.props[1].state).toBe(7);
    expect(cw.view.props[2].state).toBe(1);
    expect(cw.view.props[0].variant).toBe(3);
    const chest = cw.view.props[3];

    // Portal closes (removed from the sim), device state back to 0, chest opens.
    v.props.length = 0;
    v.props.push({ ...pillar }, { ...device, state: 0 }, makeProp({ id: 9, kind: 'chest', x: 30, y: 30, radius: 10, state: 1 }));
    setTick(v, 4);
    cw.pushSnapshot(enc.encode(v, 1, 0), 33);
    for (let t = 133; t < 400; t += 16) cw.update(t);
    expect(cw.view.props.map((p) => p.id)).toEqual([1, 3, 9]);
    expect(cw.view.props[1].state).toBe(0);
    expect(cw.view.props[2]).toBe(chest); // same object, updated in place
    expect(chest.state).toBe(1);
  });

  it('interpolates allies and keeps the local player alpha-independent', () => {
    const h = new NetHarness({ latencyMs: 30 }, {
      tick(hh, t) {
        let ally = hh.view.players.find((p) => p.id === 2);
        if (!ally) {
          ally = makePlayer(2, { name: 'Brann' });
          hh.view.players.push(ally);
        }
        ally.x = 100 + t * 1.8;
        ally.y = -40;
        ally.vx = 108;
        ally.anim = 'run';
        ally.animTime = t * SIM_DT;
        ally.life = 50 + (t % 7);
      },
    });
    let checked = 0;
    h.run(1500, () => ({ moveX: 1, moveY: 0 }), (hh) => {
      const players = hh.client.view.players;
      const me = players.find((p) => p.id === 1);
      const ally = players.find((p) => p.id === 2);
      if (!me || !ally || hh.now < 400) return;
      expect(me.prevX).toBe(me.x);
      expect(me.prevY).toBe(me.y);
      expect(me.focus).toBe(70); // own HUD data
      expect(ally.focus).toBe(0);
      expect(ally.name).toBe('Brann');
      const rt = hh.client.renderTick;
      if (!hh.client.stats().extrapolating) {
        expect(lerp(ally.prevX, ally.x, hh.lastAlpha)).toBeCloseTo(100 + rt * 1.8, 2);
        expect(ally.animTime).toBeCloseTo(rt * SIM_DT, 3);
      }
      expect(players.indexOf(me)).toBe(0); // join order kept
      checked++;
    });
    expect(checked).toBeGreaterThan(100);
  });
});

describe('ClientWorld timelines under stress', () => {
  it('pauses through a 300 ms stall and catches up without teleporting anything', () => {
    const speed = 90; // units per second
    const h = new NetHarness({ latencyMs: 40, stalls: [{ at: 2000, ms: 300 }] }, {
      tick(hh, t) {
        putMonster(hh.view, { slot: 3, x: (t * speed) / 60, y: 0 });
      },
    });
    const xs: number[] = [];
    h.run(4000, undefined, (hh) => {
      const m = hh.client.view.monsters;
      if (hh.now > 1000 && m.alive[3]) xs.push(lerp(m.prevX[3], m.x[3], hh.lastAlpha));
    });
    const nominal = speed * (h.opts.frameMs / 1000);
    const steps = xs.slice(1).map((x, k) => x - xs[k]);
    expect(Math.max(...steps)).toBeLessThanOrEqual(nominal * 2);
    expect(Math.min(...steps)).toBeGreaterThanOrEqual(-1e-6);
    expect(h.client.stats().holds).toBeGreaterThan(0);
    // Caught up: back to rendering ~one delay behind the live edge.
    const behind = (h.client.liveTick(h.now) - h.client.renderTick) * TICK;
    expect(behind).toBeLessThan(h.client.interpDelayMs + 5);
  });

  it('removes a resolved telegraph and plays its explosion on the same frame', () => {
    const h = new NetHarness({ latencyMs: 35 }, {
      tick(hh, t) {
        hh.view.areas.length = 0;
        if (t >= 30 && t < 84) hh.view.areas.push(makeArea({ id: 9, x: 12, y: 0, age: (t - 30) * SIM_DT, duration: 0.9 }));
        if (t === 84) hh.pendingEvents.push({ t: 'areaResolve', kind: 'slamWarning', x: 12, y: 0, radius: 42 });
      },
    });
    let areaGoneFrame = -1;
    let resolveFrame = -1;
    let frame = 0;
    let hadArea = false;
    h.run(2500, undefined, (hh) => {
      const has = hh.client.view.areas.some((a) => a.id === 9);
      if (has) hadArea = true;
      if (hadArea && !has && areaGoneFrame < 0) areaGoneFrame = frame;
      if (hh.lastEvents.some((e) => e.t === 'areaResolve')) resolveFrame = frame;
      frame++;
    });
    expect(areaGoneFrame).toBeGreaterThan(0);
    expect(Math.abs(resolveFrame - areaGoneFrame)).toBeLessThanOrEqual(1);
  });

  it('shows new drops on the render timeline but removes picked-up drops at once', () => {
    const h = new NetHarness({ latencyMs: 30 }, {
      tick(hh, t) {
        hh.view.drops.length = 0;
        if (t >= 20 && t < 150) hh.view.drops.push(makeDrop({ id: 4, owner: 1, x: 30, y: 0, z: 0, age: (t - 20) * SIM_DT }));
      },
    });
    let firstSeenRender = -1;
    let goneAtLatest = -1;
    h.run(3000, undefined, (hh) => {
      const cw = hh.client;
      const has = cw.view.drops.some((d) => d.id === 4);
      if (has && firstSeenRender < 0) firstSeenRender = cw.renderTick;
      if (!has && firstSeenRender >= 0 && goneAtLatest < 0) goneAtLatest = cw.latestTick;
    });
    // Appears when the render clock reaches it (never before its tick)…
    expect(firstSeenRender).toBeGreaterThanOrEqual(18);
    // …and disappears as soon as the newest snapshot lacks it, not a render delay later.
    expect(goneAtLatest).toBeGreaterThanOrEqual(150);
    expect(goneAtLatest).toBeLessThanOrEqual(152);
  });

  it('replicates public drops next to her own loot, keeping their pickup mode, and drops them at once when taken', () => {
    const h = new NetHarness({ latencyMs: 30, jitterMs: 8 }, {
      tick(hh, t) {
        hh.view.drops.length = 0;
        // Her own currency (walk-over) and an item an ally threw on the floor (public, click to pick up) that the
        // ally picks up again at tick 200 — while the ally's failed attempt marked it "blocked" on the server.
        hh.view.drops.push(makeDrop({ id: 8, owner: 1, x: -40, y: 10, z: 0, age: t * SIM_DT, autoPickup: true }));
        if (t >= 30 && t < 200) {
          const thrown = makeDrop({ id: 9, owner: 0, x: 60, y: -20, z: 0, age: (t - 30) * SIM_DT, autoPickup: false, label: 'Storm Loop' });
          thrown.blocked = t >= 120;
          hh.view.drops.push(thrown);
        }
        hh.view.drops.push(makeDrop({ id: 10, owner: 2, x: 0, y: 0 })); // the ally's own loot: never ours
      },
    });
    let publicFrames = 0;
    let goneAtLatest = -1;
    let sawPublic = false;
    h.run(4200, undefined, (hh) => {
      const cw = hh.client;
      expect(cw.view.drops.some((d) => d.id === 10)).toBe(false);
      const own = cw.view.drops.find((d) => d.id === 8);
      if (own) expect(own.spec.autoPickup).toBe(true);
      const pub = cw.view.drops.find((d) => d.id === 9);
      if (pub) {
        sawPublic = true;
        publicFrames++;
        expect(pub.spec.owner).toBe(0);
        expect(pub.spec.autoPickup).toBe(false);
        expect(pub.spec.label).toBe('Storm Loop');
        expect(pub.blocked).toBe(false);
        expect(pub.x).toBeCloseTo(60, 3);
      } else if (sawPublic && goneAtLatest < 0) goneAtLatest = cw.latestTick;
    });
    expect(publicFrames).toBeGreaterThan(100);
    // Taken by someone else: gone with the first snapshot that lacks it, not a render delay later.
    expect(goneAtLatest).toBeGreaterThanOrEqual(200);
    expect(goneAtLatest).toBeLessThanOrEqual(202);
  });

  it('flips dynamic props (a chest opening) with the newest snapshot', () => {
    const chest = makeProp({ id: 7, kind: 'chest', x: 40, y: 40, radius: 10 });
    const h = new NetHarness({ latencyMs: 30 }, {
      tick(hh, t) {
        hh.view.props.length = 0;
        hh.view.props.push({ ...chest, state: t >= 100 ? 1 : 0 });
      },
    });
    let openedAtLatest = -1;
    h.run(2500, undefined, (hh) => {
      const p = hh.client.view.props.find((q) => q.id === 7);
      if (p && p.state === 1 && openedAtLatest < 0) openedAtLatest = hh.client.latestTick;
    });
    expect(openedAtLatest).toBeGreaterThanOrEqual(100);
    expect(openedAtLatest).toBeLessThanOrEqual(102);
  });

  it('launches her own bolts from her predicted hand and blends them onto the true path', () => {
    const boltSpeed = 420;
    const spawnTicks: number[] = [];
    const launchX: number[] = [];
    const h = new NetHarness({ latencyMs: 60, moveSpeed: 125 }, {
      tick(hh, t) {
        const p = hh.view.projectiles;
        // A bolt from her position every 40 ticks, flying north (across her eastward run).
        if (t % 40 === 0 && t >= 120) {
          putProjectile(hh.view, { slot: (t / 40) % 8, gen: t % 250, x: hh.player.x, y: hh.player.y, vx: 0, vy: -boltSpeed, age: 0 });
          spawnTicks[(t / 40) % 8] = t;
          launchX[(t / 40) % 8] = hh.player.x;
        }
        for (let i = 0; i < 8; i++) {
          if (!p.alive[i]) continue;
          p.x[i] += p.vx[i] * SIM_DT;
          p.y[i] += p.vy[i] * SIM_DT;
          p.age[i] += SIM_DT;
          if (p.age[i] > 0.6) {
            p.alive[i] = 0;
            p.count--;
          }
        }
      },
    });
    let firstFrames = 0;
    let lateFrames = 0;
    const seenIds = new Set<number>();
    h.run(8000, (seq) => ({ moveX: seq % 400 < 200 ? 1 : -1, moveY: 0 }), (hh) => {
      const cw = hh.client;
      const me = cw.view.players.find((q) => q.id === 1);
      const p = cw.view.projectiles;
      if (!me || cw.stats().extrapolating) return;
      for (let i = 0; i < 8; i++) {
        if (!p.alive[i]) continue;
        const x = lerp(p.prevX[i], p.x[i], hh.lastAlpha);
        const y = lerp(p.prevY[i], p.y[i], hh.lastAlpha);
        const age = cw.renderTick * SIM_DT - spawnTicks[i] * SIM_DT;
        if (!seenIds.has(p.id[i])) {
          seenIds.add(p.id[i]);
          // First frame: it leaves her on-screen body (not the spot she stood on ~RTT + delay ago: ~25 units back).
          expect(Math.abs(x - me.x)).toBeLessThan(4);
          firstFrames++;
        }
        if (age > 0.3) {
          // Past the blend: on its authoritative path (it flies north from where she was at launch), up to the
          // wire's 1/16-unit position resolution.
          expect(Math.abs(x - launchX[i])).toBeLessThanOrEqual(1 / 32 + 1e-6);
          lateFrames++;
        }
      }
    });
    expect(firstFrames).toBeGreaterThan(5);
    expect(lateFrames).toBeGreaterThan(50);
  });

  it('fades monster hit flashes smoothly at display rate', () => {
    const h = new NetHarness({ latencyMs: 30 }, {
      tick(hh, t) {
        const flash = t >= 100 ? Math.max(0, 1 - ((t - 100) * SIM_DT) / 0.14) : 0;
        putMonster(hh.view, { slot: 2, x: 50, y: 0, hitFlash: flash });
      },
    });
    const flashes: number[] = [];
    h.run(3000, undefined, (hh) => {
      const m = hh.client.view.monsters;
      if (m.alive[2] && hh.client.renderTick > 90 && hh.client.renderTick < 120) flashes.push(m.hitFlash[2]);
    });
    const peak = flashes.indexOf(Math.max(...flashes));
    expect(flashes[peak]).toBeGreaterThan(0.8);
    // After the hit, each 144 Hz frame fades a little — no 30 Hz staircase (4-bit wire steps are 1/15).
    const perFrame = (h.opts.frameMs / 1000) / 0.14;
    for (let k = peak + 1; k < flashes.length; k++) {
      const d = flashes[k - 1] - flashes[k];
      expect(d).toBeGreaterThanOrEqual(-1e-6);
      expect(d).toBeLessThan(perFrame * 1.6 + 1 / 15);
    }
    const fading = flashes.slice(peak + 1).filter((f) => f > 0.05);
    expect(new Set(fading.map((f) => f.toFixed(3))).size).toBeGreaterThan(8);
  });
});

describe('ClientWorld moving areas (bestiary telegraphs)', () => {
  it('keeps a whirlwind on the monster it follows (render timeline) while its age stays live', () => {
    const h = new NetHarness({ latencyMs: 35 }, {
      tick(hh, t) {
        const x = 40 + t * 1.5;
        putMonster(hh.view, { slot: 3, gen: 1, kind: 21, rarity: 4, x, y: 30, radius: 14, life: 900, maxLife: 9000 });
        hh.view.areas.length = 0;
        if (t >= 60) hh.view.areas.push(makeArea({ id: 4242, kind: 'whirlwind', x, y: 30, radius: 44, age: (t - 60) * SIM_DT, duration: 30 }));
      },
    });
    let checked = 0;
    let maxErr = 0;
    h.run(4000, undefined, (hh) => {
      const a = hh.client.view.areas.find((ar) => ar.id === 4242);
      const m = hh.client.view.monsters;
      if (!a || !m.alive[3] || hh.client.stats().extrapolating) return;
      if (hh.client.renderTick < 64) return; // born after the render bracket: holds its first spot
      const mx = lerp(m.prevX[3], m.x[3], hh.lastAlpha);
      const my = lerp(m.prevY[3], m.y[3], hh.lastAlpha);
      maxErr = Math.max(maxErr, Math.hypot(a.x - mx, a.y - my));
      // Age: live clock (the newest tick), not the render time.
      expect(a.age).toBeGreaterThan((hh.client.renderTick - 60) * SIM_DT);
      checked++;
    });
    expect(checked).toBeGreaterThan(300);
    expect(maxErr).toBeLessThan(0.05);
  });

  it('holds a new moving area at its first-seen spot until the render time reaches it, then moves on smoothly', () => {
    const h = new NetHarness({ latencyMs: 40 }, {
      tick(hh, t) {
        hh.view.areas.length = 0;
        if (t >= 100) hh.view.areas.push(makeArea({ id: 88, kind: 'blizzard', x: -200 + (t - 100) * 0.8, y: 50, radius: 60, age: (t - 100) * SIM_DT, duration: 20 }));
      },
    });
    const xs: number[] = [];
    let firstFrameRender = -1;
    h.run(4000, undefined, (hh) => {
      const a = hh.client.view.areas.find((ar) => ar.id === 88);
      if (!a) return;
      if (firstFrameRender < 0) firstFrameRender = hh.client.renderTick;
      xs.push(a.x);
      if (hh.client.renderTick < 100) expect(a.x).toBe(xs[0]); // not moving before its birth on the render timeline
    });
    expect(firstFrameRender).toBeLessThan(100); // shown at once (live), ahead of the render timeline
    expect(xs[0]).toBeCloseTo(-200, 0);
    // Smooth afterwards: steps of ≈ 0.8 units per tick at 144 Hz (no 30 Hz jumps), never backwards.
    for (let k = 1; k < xs.length; k++) {
      expect(xs[k]).toBeGreaterThanOrEqual(xs[k - 1] - 1e-6);
      expect(xs[k] - xs[k - 1]).toBeLessThan(0.8 * 2.5);
    }
  });

  it('grows and shrinks radii smoothly on the live clock (choir waves, ice prisons)', () => {
    const h = new NetHarness({ latencyMs: 30 }, {
      tick(hh, t) {
        hh.view.areas.length = 0;
        if (t >= 60 && t < 240) hh.view.areas.push(makeArea({ id: 7, kind: 'choirWave', x: 0, y: 0, radius: 10 + (t - 60) * 2, age: (t - 60) * SIM_DT, duration: 3 }));
        if (t >= 60 && t < 180) hh.view.areas.push(makeArea({ id: 8, kind: 'icePrison', x: 90, y: 0, radius: 80 - (t - 60) * 0.5, age: (t - 60) * SIM_DT, duration: 2 }));
      },
    });
    let checked = 0;
    let maxStep = 0;
    let lastR = -1;
    h.run(4200, undefined, (hh) => {
      const wave = hh.client.view.areas.find((ar) => ar.id === 7);
      const prison = hh.client.view.areas.find((ar) => ar.id === 8);
      const live = hh.client.liveTick(hh.now);
      if (wave && live > 70 && live < 230) {
        expect(Math.abs(wave.radius - (10 + (live - 60) * 2))).toBeLessThan(2.5); // within ~1 tick of the truth
        if (lastR >= 0) maxStep = Math.max(maxStep, wave.radius - lastR);
        lastR = wave.radius;
        checked++;
      }
      if (prison && live > 70 && live < 170) expect(Math.abs(prison.radius - (80 - (live - 60) * 0.5))).toBeLessThan(1);
    });
    expect(checked).toBeGreaterThan(200);
    // 2 units per tick at 144 Hz ≈ 0.83 per frame; snapshot steps would be 4 units.
    expect(maxStep).toBeLessThan(2);
  });

  it('draws an execution mark that follows the local player at her on-screen position, and in place once it locks', () => {
    const h = new NetHarness({ latencyMs: 45, moveSpeed: 130 }, {
      tick(hh, t) {
        hh.view.areas.length = 0;
        if (t >= 120 && t < 300) {
          const locked = t >= 250;
          const at = locked ? lockAt : { x: hh.player.x, y: hh.player.y };
          if (!locked) lockAt = at;
          hh.view.areas.push(makeArea({ id: 31, kind: 'executionMark', x: at.x, y: at.y, radius: 36, age: (t - 120) * SIM_DT, duration: 3 }));
        }
      },
    });
    let lockAt = { x: 0, y: 0 };
    let following = 0;
    let lockedFrames = 0;
    let earlyLockFrames = 0;
    h.run(6000, (seq) => ({ moveX: Math.cos(seq * 0.03), moveY: Math.sin(seq * 0.03) }), (hh) => {
      const a = hh.client.view.areas.find((ar) => ar.id === 31);
      const me = hh.client.view.players.find((p) => p.id === 1);
      if (!a || !me) return;
      const live = hh.client.latestTick;
      if (live > 130 && live < 245) {
        expect(a.x).toBe(me.x);
        expect(a.y).toBe(me.y);
        following++;
      }
      // From the first snapshot that shows it standing still (252: 250 and 252 both at the tick-249 spot) it is drawn
      // exactly where it will strike — never slid back along the render timeline, which still shows it moving.
      if (live >= 252) {
        expect(Math.abs(a.x - lockAt.x)).toBeLessThanOrEqual(1 / 32);
        expect(Math.abs(a.y - lockAt.y)).toBeLessThanOrEqual(1 / 32);
        if (hh.client.renderTick < 250) earlyLockFrames++;
        lockedFrames++;
      }
    });
    expect(following).toBeGreaterThan(200);
    expect(lockedFrames).toBeGreaterThan(40);
    expect(earlyLockFrames).toBeGreaterThan(3); // the frames the old render-timeline placement got wrong
  });
});
