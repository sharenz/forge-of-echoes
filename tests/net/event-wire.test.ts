// Map events, wave 2, on the wire (snapshot version 10): frozen / fixture ailments (u16), a carried object's eventSlow, the second
// boss bar and the zone `n` / marker `w` values; and the client's prediction slows with the carried Ember.
import { describe, expect, it } from 'vitest';
import { AILMENT_BIT, RARITY_CODE } from '../../src/contracts/sim';
import { Snapshot, createSnapshotEncoder, decodeSnapshot } from '../../src/net';
import { ByteReader, StringInterner } from '../../src/net/bytes';
import { SIM_DT } from '../../src/contracts/sim';
import { NetHarness } from './harness';
import { makePlayer, makeView, putMonster, setTick } from './fixtures';

describe('map events wave 2 on the wire', () => {
  it('carries the frozen and fixture ailment bits (they need more than 8 bits) next to the old ones', () => {
    const v = makeView();
    setTick(v, 10);
    v.players.push(makePlayer(1));
    putMonster(v, { slot: 1, gen: 1, kind: 0, rarity: RARITY_CODE.normal, x: 10, y: 10, life: 50, maxLife: 50, ailments: AILMENT_BIT.frozen | AILMENT_BIT.chilled });
    putMonster(v, { slot: 2, gen: 1, kind: 1, rarity: RARITY_CODE.normal, x: 30, y: 10, life: 50, maxLife: 50, ailments: AILMENT_BIT.fixture });
    putMonster(v, { slot: 3, gen: 1, kind: 1, rarity: RARITY_CODE.normal, x: 50, y: 10, life: 50, maxLife: 50, ailments: AILMENT_BIT.exposed | AILMENT_BIT.spectral });
    const s = decodeSnapshot(createSnapshotEncoder().encode(v, 1, 1));
    expect(s.monsters.n).toBe(3);
    const at = [0, 1, 2].map(i => s.monsters.ailments[i]);
    expect(at[0]).toBe(AILMENT_BIT.frozen | AILMENT_BIT.chilled);
    expect(at[1]).toBe(AILMENT_BIT.fixture);
    expect(at[2]).toBe(AILMENT_BIT.exposed | AILMENT_BIT.spectral);
  });

  it('a carried Ember slows the carrier only: eventSlow round-trips per player', () => {
    const v = makeView();
    setTick(v, 10);
    v.players.push(makePlayer(1, { eventSlow: 0.12 }), makePlayer(2));
    const s = decodeSnapshot(createSnapshotEncoder().encode(v, 1, 1));
    expect(s.players[0].eventSlow).toBeCloseTo(0.12, 2);
    expect(s.players[1].eventSlow ?? 0).toBe(0);
  });

  it('carries the second boss bar only while it exists', () => {
    const v = makeView();
    setTick(v, 10);
    v.players.push(makePlayer(1));
    v.run.boss = { name: 'Cinder Matriarch', life: 900, maxLife: 1000, phase: 2 };
    v.run.boss2 = { name: 'Varkus, the Iron Champion', life: 300, maxLife: 600, phase: 1 };
    const enc = createSnapshotEncoder();
    const reader = new ByteReader(), strings = new StringInterner(256), snap = new Snapshot();
    snap.decode(enc.encode(v, 1, 1), reader, strings);
    expect(snap.run.boss).toMatchObject({ name: 'Cinder Matriarch', life: 900, phase: 2 });
    expect(snap.run.boss2).toMatchObject({ name: 'Varkus, the Iron Champion', life: 300, maxLife: 600, phase: 1 });
    v.run.boss2 = null;
    snap.decode(enc.encode(v, 1, 2), reader, strings);
    expect(snap.run.boss2).toBeNull();
    expect(snap.run.boss).not.toBeNull();
  });

  it('predicts the Ember carrier 12% slower exactly, without learning the slowed speed as her base speed', () => {
    const h = new NetHarness({ latencyMs: 50, moveSpeed: 140 }, {
      tick(hh, t) {
        if (t === 300) hh.player.eventSlow = 0.12;
        if (t === 700) hh.player.eventSlow = 0;
      },
    });
    h.run(14000, () => ({ moveX: Math.cos(0.004), moveY: Math.sin(0.004) }));
    const seqs = [...h.serverAt.keys()].filter((s) => s > 340 && s < 660 && h.serverAt.has(s - 1));
    expect(seqs.length).toBeGreaterThan(100);
    // (Inputs that arrive late are repeated, so some steps are zero: the largest step is the real pace.)
    const step = (s: number) => Math.hypot(h.serverAt.get(s)!.x - h.serverAt.get(s - 1)!.x, h.serverAt.get(s)!.y - h.serverAt.get(s - 1)!.y);
    expect(Math.max(...seqs.map(step))).toBeCloseTo(140 * 0.88 * SIM_DT, 3);
    const before = [...h.serverAt.keys()].filter((s) => s > 60 && s < 280 && h.serverAt.has(s - 1));
    expect(Math.max(...before.map(step))).toBeCloseTo(140 * SIM_DT, 3);
    let worst = 0;
    for (const [seq, pred] of h.predictedAt) {
      if (seq < 400 || seq > 660) continue;
      const auth = h.serverAt.get(seq);
      if (auth) worst = Math.max(worst, Math.hypot(pred.x - auth.x, pred.y - auth.y));
    }
    expect(worst).toBeLessThan(1e-3);
    expect(h.client.stats().moveSpeed).toBeCloseTo(140, 3);
  });
});
