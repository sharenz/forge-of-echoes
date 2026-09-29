// Cost of the per-snapshot / per-frame hot paths at the GAME_SPEC performance target
// (800 live monsters + 600 projectiles). Bounds are generous; the printed numbers are the real signal.
import { describe, expect, it } from 'vitest';
import { createClientWorld, createSnapshotEncoder } from '../../src/net';
import { makePlayer, makeView, makeZone, putMonster, putMote, putProjectile, setTick } from './fixtures';

describe('net performance', () => {
  it('encodes, decodes and interpolates a dense horde cheaply', () => {
    const v = makeView();
    v.players.push(makePlayer(1), makePlayer(2, { x: 40 }), makePlayer(3, { x: -40 }), makePlayer(4, { y: 30 }));
    const enc = createSnapshotEncoder();
    const cw = createClientWorld();
    cw.setZone(makeZone());
    const place = (t: number) => {
      setTick(v, t);
      for (let i = 0; i < 800; i++) {
        const a = i * 2.39996 + t * 0.01;
        const r = 30 + (i % 400) * 1.2;
        putMonster(v, { slot: i, gen: 1, kind: i % 5, x: Math.cos(a) * r, y: Math.sin(a) * r * 0.55, animTime: t / 60 });
      }
      for (let i = 0; i < 600; i++) putProjectile(v, { slot: i, x: ((i * 37 + t * 7) % 1000) - 500, y: ((i * 53) % 640) - 320, age: 0.2 });
      for (let i = 0; i < 150; i++) putMote(v, i, (i % 30) * 15 - 225, Math.floor(i / 30) * 15);
    };
    let encodeMs = 0;
    let bytes = 0;
    let pushMs = 0;
    let updateMs = 0;
    let frames = 0;
    const snapshots = 120;
    for (let k = 0; k < snapshots; k++) {
      const t = 2 * (k + 1);
      place(t);
      let t0 = performance.now();
      // Four viewers per snapshot, like a full party.
      let buf!: ArrayBuffer;
      for (let viewer = 4; viewer >= 1; viewer--) buf = enc.encode(v, viewer, t);
      encodeMs += (performance.now() - t0) / 4;
      bytes += buf.byteLength;
      const now = t * (1000 / 60) + 40;
      t0 = performance.now();
      cw.pushSnapshot(buf, now);
      pushMs += performance.now() - t0;
      for (let f = 0; f < 4; f++) {
        t0 = performance.now();
        cw.update(now + f * 8);
        updateMs += performance.now() - t0;
        frames++;
      }
    }
    const perEncode = encodeMs / snapshots;
    const perPush = pushMs / snapshots;
    const perUpdate = updateMs / frames;
    process.stdout.write(
      `[net] 800 monsters + 600 projectiles: encode ${perEncode.toFixed(3)} ms/viewer, decode ${perPush.toFixed(3)} ms, ` +
      `update ${perUpdate.toFixed(3)} ms/frame, ${(bytes / snapshots / 1024).toFixed(1)} KB/snapshot\n`,
    );
    expect(cw.view.monsters.count).toBeGreaterThan(400);
    expect(perEncode).toBeLessThan(3);
    expect(perPush).toBeLessThan(3);
    expect(perUpdate).toBeLessThan(3);
  });
});
