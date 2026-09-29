// End-to-end: a real two-player map run from src/sim, encoded per viewer every SNAPSHOT_EVERY ticks and fed to a
// ClientWorld. Built from contract types only (no sim internals), so it keeps working while the sim evolves.
import { describe, expect, it } from 'vitest';
import type { SkillId } from '../../src/contracts/content';
import { AOI_HALF_HEIGHT, AOI_HALF_WIDTH, SNAPSHOT_EVERY } from '../../src/contracts/net';
import type { InputMessage } from '../../src/contracts/net';
import type {
  DropSpec, PlayerCombatStats, PlayerIntent, PlayerRuntime, RunConfig, SkillRuntimeDef, WorldView,
} from '../../src/contracts/sim';
import { AOI_MARGIN, createClientWorld, createInputQueue, createSnapshotEncoder, decodeSnapshot } from '../../src/net';
import { createRun } from '../../src/sim';
import { makeZone } from './fixtures';

function stats(): PlayerCombatStats {
  return {
    maxLife: 5000, lifeRegen: 50, maxFocus: 400, focusRegen: 40, armor: 200, evasion: 0.3,
    resist: { physical: 0, fire: 0.5, cold: 0.5, lightning: 0.5, void: 0.3 }, damageTaken: 1, moveSpeed: 125,
    pickupRadius: 60, lifeOnKill: 0, focusOnKill: 0, flaskEffect: 1, flags: [],
  };
}

function skill(id: SkillId, over: Partial<SkillRuntimeDef>): SkillRuntimeDef {
  return {
    id, rank: 5, focusCost: 0, castTime: 0.3, cooldown: 0, charges: 1, damage: 40, damageType: 'fire', critChance: 0.05,
    critMultiplier: 1.5, ailmentChance: 0.1, projectiles: 1, pierce: 1, projectileSpeed: 420, range: 320, spread: 0,
    radius: 0, duration: 0, chains: 0, distance: 0, damageReduction: 0, flags: [], ...over,
  };
}

function runtime(): PlayerRuntime {
  return {
    stats: stats(),
    skills: [
      skill('emberLance', {}),
      skill('emberNova', { focusCost: 5, castTime: 0.4, cooldown: 1.5, projectiles: 16, projectileSpeed: 260, range: 170, damage: 30 }),
    ],
    loadout: ['emberLance', 'emberNova', null, null, null, null],
    flasks: [null, null, null, null],
  };
}

function config(): RunConfig {
  let token = 1;
  return {
    mode: 'map', seed: 424242, theme: 'ashenForge', mapName: 'Ashen Forge', tier: 4, arenaRadius: 900,
    monsters: {
      level: 30, lifeMultiplier: 1, damageMultiplier: 0.2, speedMultiplier: 1, countMultiplier: 2.5, magicPackChance: 0.3,
      rarePackChance: 0.15, resistBonus: 0, xpMultiplier: 1, extraProjectiles: 0, hazards: true,
    },
    waves: { count: 6, baseMonsters: 40, monstersPerWave: 18, waveDuration: 20, tellDuration: 1, lieutenantWave: 3, bossWave: 6 },
    hooks: {
      rollKillLoot(ctx, playerIds, rng) {
        const out: DropSpec[] = [];
        for (const owner of playerIds) {
          if (rng.next() < 0.25) {
            out.push({ token: token++, owner, autoPickup: true, label: `Forge Scrap (${ctx.kind})`, tone: 'currency', sprite: 'currency', iconId: 'icon/currency/scrap' });
          }
        }
        return out;
      },
      rollChestLoot(playerIds) {
        return playerIds.map((owner): DropSpec => ({ token: token++, owner, autoPickup: true, label: 'Tier 5 Map', tone: 'map', sprite: 'map', iconId: 'icon/map/ashenForge' }));
      },
      tryPickup: () => false, // keep drops on the ground so they stay in the snapshots
    },
  };
}

function inAoi(v: WorldView, viewerX: number, viewerY: number, x: number, y: number, r: number): boolean {
  const hw = AOI_HALF_WIDTH + AOI_MARGIN;
  const hh = AOI_HALF_HEIGHT + AOI_MARGIN;
  void v;
  return Math.abs(x - Math.round(viewerX)) <= hw + r && Math.abs(y - Math.round(viewerY)) <= hh + r;
}

describe('snapshots of a real sim run', () => {
  it('replicates a busy two-player map faithfully and compactly', () => {
    const run = createRun(config());
    run.addPlayer({ id: 1, name: 'Mira', level: 30, runtime: runtime() });
    run.addPlayer({ id: 2, name: 'Brann', level: 28, runtime: runtime() });
    const enc = createSnapshotEncoder();
    const clients = [createClientWorld(), createClientWorld()];
    clients[0].setZone(makeZone({ localPlayerId: 1 }));
    clients[1].setZone(makeZone({ localPlayerId: 2 }));

    const held = [true, false, false, false, false, false];
    const sizes: number[] = [];
    let maxMonstersSent = 0;
    let checkedSnapshots = 0;
    let sawDrops = false;
    const ticks = 60 * 45;
    for (let t = 0; t < ticks; t++) {
      const a = t * 0.01;
      const p1 = run.view.players[0];
      const intent1: PlayerIntent = { moveX: Math.cos(a), moveY: Math.sin(a), aimX: p1.x + 60 * Math.cos(a * 3), aimY: p1.y + 60 * Math.sin(a * 3), held: t % 180 < 150 ? held : [true, true, false, false, false, false], flask: -1 };
      run.setIntent(1, intent1);
      run.setIntent(2, { moveX: 0, moveY: 0, aimX: 0, aimY: 100, held, flask: -1 });
      run.step();
      run.drainEvents();
      run.drainOutcomes();
      if (run.view.tick % SNAPSHOT_EVERY !== 0) continue;
      const v = run.view;
      for (const viewerId of [1, 2]) {
        const buf = enc.encode(v, viewerId, t);
        sizes.push(buf.byteLength);
        const cw = clients[viewerId - 1];
        cw.pushSnapshot(buf, t * (1000 / 60) + 30);
        cw.update(t * (1000 / 60) + 30);
        if (v.tick % 60 !== 0) continue;
        // Full fidelity check once a second.
        const s = decodeSnapshot(buf);
        const me = v.players.find((p) => p.id === viewerId)!;
        let expected = 0;
        const m = v.monsters;
        const sent = new Map<number, number>();
        for (let i = 0; i < s.monsters.n; i++) sent.set(s.monsters.id[i], i);
        for (let i = 0; i < m.capacity; i++) {
          if (!m.alive[i] || !inAoi(v, me.x, me.y, m.x[i], m.y[i], m.radius[i])) continue;
          expected++;
          const key = ((((m.id[i] >>> 16) & 0xff) << 16) | (m.id[i] & 0xffff)) >>> 0;
          const j = sent.get(key);
          expect(j).toBeDefined();
          expect(Math.abs(s.monsters.x[j!] - m.x[i])).toBeLessThanOrEqual(1 / 32 + 1e-3);
          expect(Math.abs(s.monsters.y[j!] - m.y[i])).toBeLessThanOrEqual(1 / 32 + 1e-3);
          expect(s.monsters.kind[j!]).toBe(m.kind[i]);
          expect(s.monsters.rarity[j!]).toBe(m.rarity[i]);
          expect(s.monsters.anim[j!]).toBe(m.anim[i]);
          expect(s.monsters.mods[j!]).toBe(m.mods[i]);
          const frac = m.maxLife[i] > 0 ? m.life[i] / m.maxLife[i] : 1;
          expect(Math.abs(s.monsters.life[j!] / s.monsters.maxLife[j!] - Math.min(1, frac))).toBeLessThan(1 / 255 + 1e-3);
        }
        expect(s.monsters.n).toBe(expected);
        maxMonstersSent = Math.max(maxMonstersSent, expected);
        expect(s.playerCount).toBe(v.players.length);
        for (let k = 0; k < s.dropCount; k++) expect(s.drops[k].spec.owner).toBe(viewerId);
        if (s.dropCount > 0) sawDrops = true;
        expect(s.run.phase).toBe(v.run.phase);
        expect(s.run.kills).toBe(v.run.kills);
        checkedSnapshots++;
      }
    }
    expect(checkedSnapshots).toBeGreaterThan(80);
    expect(maxMonstersSent).toBeGreaterThan(40); // it really was busy
    expect(sawDrops).toBe(true);
    const avg = sizes.reduce((x, y) => x + y, 0) / sizes.length;
    const max = Math.max(...sizes);
    // 30 Hz × avg bytes per client: comfortably below 250 kB/s even in a dense fight.
    expect(avg).toBeLessThan(8000);
    expect(max).toBeLessThan(20000);
    // Both clients kept their local player and saw the ally.
    for (const cw of clients) {
      expect(cw.view.players.length).toBe(2);
      expect(cw.stats().decodeErrors).toBe(0);
    }
    process.stdout.write(`[net] real run: ${sizes.length} snapshots, avg ${avg.toFixed(0)} B, max ${max} B, peak AOI monsters ${maxMonstersSent}\n`);
  });
});

describe('public drops through the real sim', () => {
  it('shows a floor item to everyone nearby, keeps instanced loot private and removes it for all once taken', () => {
    let full = false;
    const run = createRun({
      ...config(),
      mode: 'hideout', theme: 'hideout', mapName: 'Hideout', tier: 0, arenaRadius: 420,
      waves: { count: 0, baseMonsters: 0, monstersPerWave: 0, waveDuration: 60, tellDuration: 1, lieutenantWave: 0, bossWave: 0 },
      hooks: { rollKillLoot: () => [], rollChestLoot: () => [], tryPickup: () => !full },
    });
    run.addPlayer({ id: 1, name: 'Mira', level: 30, runtime: runtime(), x: -60, y: 80 });
    run.addPlayer({ id: 2, name: 'Brann', level: 28, runtime: runtime(), x: 40, y: 80 });
    const idle: PlayerIntent = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, held: [], flask: -1 };
    const enc = createSnapshotEncoder();
    const step = (ticks: number) => {
      for (let t = 0; t < ticks; t++) {
        run.setIntent(1, idle);
        run.setIntent(2, idle);
        run.step();
        run.drainOutcomes();
      }
    };
    const seen = (viewer: number) => {
      const s = decodeSnapshot(enc.encode(run.view, viewer, 0));
      return s.drops.slice(0, s.dropCount);
    };
    const spec = (token: number, owner: number, label: string): DropSpec => ({
      token, owner, autoPickup: false, label, tone: 'rare', sprite: 'equipment', iconId: 'icon/base/stormLoop',
    });

    // Brann throws a ring on the floor between them; Mira has a (click-to-pick-up) item of her own.
    const thrown = run.spawnDrop(spec(1, 0, 'Storm Loop'), -10, 80);
    const mine = run.spawnDrop(spec(2, 1, 'Ember Bite'), -60, 90);
    const spawnEvents = run.drainEvents().filter((e) => e.t === 'dropSpawn');
    expect(spawnEvents.map((e) => (e.t === 'dropSpawn' ? e.owner : -1))).toEqual([0, 1]);
    step(60);
    const forMira = seen(1);
    const forBrann = seen(2);
    expect(forMira.map((d) => d.id)).toEqual([mine, thrown]);
    expect(forBrann.map((d) => d.id)).toEqual([thrown]);
    const pub = forBrann[0];
    expect(pub.spec).toEqual(spec(1, 0, 'Storm Loop'));
    const truth = run.view.drops.find((d) => d.id === thrown)!;
    expect(Math.abs(pub.x - truth.x)).toBeLessThanOrEqual(1 / 32 + 1e-3);
    expect(Math.abs(pub.y - truth.y)).toBeLessThanOrEqual(1 / 32 + 1e-3);

    // Brann's backpack is full: the sim flags the drop, but only as his problem — onlookers see no "full" marker.
    full = true;
    expect(run.requestPickup(2, thrown)).toBe('full');
    expect(run.view.drops.find((d) => d.id === thrown)!.blocked).toBe(true);
    expect(seen(1).find((d) => d.id === thrown)!.blocked).toBe(false);
    // Mira's own loot is not his to take; the public ring is hers once she clicks it.
    full = false;
    expect(run.requestPickup(2, mine)).toBe('notYours');
    run.drainEvents();
    expect(run.requestPickup(1, thrown)).toBe('ok');
    const pickups = run.drainEvents().filter((e) => e.t === 'pickup');
    expect(pickups).toEqual([expect.objectContaining({ t: 'pickup', owner: 0, playerId: 1, label: 'Storm Loop' })]);
    step(2);
    expect(seen(1).map((d) => d.id)).toEqual([mine]);
    expect(seen(2)).toEqual([]);

    // An expired floor item leaves every view.
    const stale = run.spawnDrop(spec(3, 0, 'Silk Wraps'), 40, 70);
    step(30);
    expect(seen(1).map((d) => d.id)).toContain(stale);
    run.removeDrop(stale);
    step(2);
    expect(seen(1).map((d) => d.id)).not.toContain(stale);
    expect(seen(2).map((d) => d.id)).not.toContain(stale);
  });
});

describe('prediction against the real sim', () => {
  const TICK = 1000 / 60;
  const LATENCY = 45;

  function hideoutConfig(): RunConfig {
    return {
      ...config(),
      mode: 'hideout', theme: 'hideout', mapName: 'Hideout', tier: 0, arenaRadius: 420,
      waves: { count: 0, baseMonsters: 0, monstersPerWave: 0, waveDuration: 60, tellDuration: 1, lieutenantWave: 0, bossWave: 0 },
    };
  }

  function casterRuntime(): PlayerRuntime {
    return {
      stats: { ...stats(), maxFocus: 300, focusRegen: 20 },
      skills: [
        skill('emberLance', { castTime: 0.3 }),
        skill('emberNova', { focusCost: 6, castTime: 0.45, cooldown: 1.2, projectiles: 12, projectileSpeed: 260, range: 150 }),
        skill('rimeShards', { focusCost: 3, castTime: 0.34, damageType: 'cold', projectiles: 3, spread: 0.4 }),
      ],
      loadout: ['emberLance', 'emberNova', 'rimeShards', null, null, null],
      flasks: [null, null, null, null],
    };
  }

  /**
   * A real hideout instance as the server (inputs through createInputQueue, like the game server), a ClientWorld
   * 45 ms away. Returns predicted vs authoritative positions per input seq.
   */
  function play(withHints: boolean) {
    const run = createRun(hideoutConfig());
    run.addPlayer({ id: 1, name: 'Mira', level: 30, runtime: casterRuntime() });
    const enc = createSnapshotEncoder();
    const queue = createInputQueue();
    const intent: PlayerIntent = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, held: [], flask: -1 };
    const cw = createClientWorld();
    cw.setZone(makeZone({ kind: 'hideout', theme: 'hideout', arenaRadius: 420, props: run.view.props.map((p) => ({ ...p })) }));
    if (withHints) cw.setPredictionHints({ moveSpeed: 125, castTimes: { emberLance: 0.3, emberNova: 0.45, rimeShards: 0.34 } });
    const toServer: { at: number; input: InputMessage }[] = [];
    const toClient: { at: number; buf: ArrayBuffer }[] = [];
    const serverAt = new Map<number, { x: number; y: number }>();
    const predictedAt = new Map<number, { x: number; y: number }>();
    let seq = 0;
    let nextServer = TICK;
    let nextInput = 3;
    let nextFrame = 0;
    for (let now = 0; now < 9000; ) {
      now = Math.min(nextServer, nextInput, nextFrame);
      if (now >= nextServer) {
        while (toServer.length && toServer[0].at <= now) queue.push(toServer.shift()!.input);
        run.setIntent(1, queue.next(intent));
        run.step();
        run.drainEvents();
        run.drainOutcomes();
        const me = run.view.players[0];
        if (queue.starved === 0) serverAt.set(queue.ackSeq, { x: me.x, y: me.y });
        if (run.view.tick % SNAPSHOT_EVERY === 0) toClient.push({ at: now + LATENCY, buf: enc.encode(run.view, 1, queue.ackSeq) });
        nextServer += TICK;
      }
      if (now >= nextInput) {
        const s = ++seq;
        const a = s * 0.02;
        // Circle the courtyard (clear of the training dummy) while casting: basic attack always, Ember Nova
        // (cooldown) and Rime Shards (spam) in overlapping bursts.
        const held = 1 | (s % 200 < 120 ? 2 : 0) | (s % 150 > 40 ? 4 : 0);
        const me = cw.view.players[0];
        const input: InputMessage = {
          t: 'input', seq: s, moveX: Math.cos(a), moveY: Math.sin(a), aimX: (me?.x ?? 0) + 80, aimY: (me?.y ?? 0) - 20, held, flask: -1,
        };
        toServer.push({ at: now + LATENCY, input });
        cw.predict(input);
        const p = cw.predictedPosition();
        if (p) predictedAt.set(s, { x: p.x, y: p.y });
        nextInput += TICK;
      }
      if (now >= nextFrame) {
        while (toClient.length && toClient[0].at <= now) cw.pushSnapshot(toClient.shift()!.buf, now);
        cw.update(now);
        nextFrame += 1000 / 144;
      }
    }
    const errAfter = (fromSeq: number) => {
      let maxErr = 0;
      let compared = 0;
      for (const [s, p] of predictedAt) {
        const auth = serverAt.get(s);
        if (!auth || s < fromSeq) continue;
        maxErr = Math.max(maxErr, Math.hypot(p.x - auth.x, p.y - auth.y));
        compared++;
      }
      return { maxErr, compared };
    };
    return { cw, errAfter };
  }

  it('replays the real casting rules: every input lands exactly where the server puts it', () => {
    const { cw, errAfter } = play(true);
    const { maxErr, compared } = errAfter(1);
    expect(compared).toBeGreaterThan(450);
    expect(maxErr).toBeLessThan(1e-3);
    expect(cw.stats().snaps).toBe(0);
  });

  it('learns cast times from snapshots when the rules give no hints', () => {
    const { errAfter } = play(false);
    // After each skill has been seen casting once (well within the first 3 s), prediction is exact.
    const { maxErr, compared } = errAfter(180);
    expect(compared).toBeGreaterThan(300);
    expect(maxErr).toBeLessThan(1e-3);
  });
});
