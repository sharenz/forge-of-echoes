// End-to-end: a real two-player map run from src/sim, encoded per viewer every SNAPSHOT_EVERY ticks and fed to a
// ClientWorld. Built from contract types only (no sim internals), so it keeps working while the sim evolves.
import { describe, expect, it } from 'vitest';
import type { SkillId, Theme } from '../../src/contracts/content';
import { MONSTER_KINDS } from '../../src/contracts/content';
import { NEW_AREA_KINDS, NEW_MONSTER_KINDS, NEW_PROJECTILE_KINDS } from '../../src/contracts/bestiary';
import { PROJECTILE_KINDS } from '../../src/contracts/sim';
import { AOI_HALF_HEIGHT, AOI_HALF_WIDTH, SNAPSHOT_EVERY } from '../../src/contracts/net';
import type { InputMessage } from '../../src/contracts/net';
import type {
  DropSpec, PlayerCombatStats, PlayerIntent, PlayerRuntime, RunConfig, SimEvent, SkillRuntimeDef, WorldView,
} from '../../src/contracts/sim';
import {
  AOI_MARGIN, MAX_WIRE_GROUND_AREAS, PULL_STEPS, createClientWorld, createInputQueue, createSnapshotEncoder, decodeSnapshot,
} from '../../src/net';
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

describe('the Rimed Ossuary and Iron Coliseum rosters through the real sim', () => {
  for (const theme of ['rimedOssuary', 'ironColiseum'] as const satisfies readonly Theme[]) {
    it(`replicates a ${theme} map exactly: new monster/projectile/area kinds and every player's debuffs`, () => {
      const cfg = config();
      const run = createRun({
        ...cfg, theme, mapName: theme, seed: theme === 'rimedOssuary' ? 91 : 92,
        monsters: { ...cfg.monsters, damageMultiplier: 0.05 },
        waves: { ...cfg.waves, waveDuration: 12, baseMonsters: 30 },
      });
      run.addPlayer({ id: 1, name: 'Mira', level: 30, runtime: runtime() });
      run.addPlayer({ id: 2, name: 'Brann', level: 28, runtime: runtime() });
      const enc = createSnapshotEncoder();
      const cw = createClientWorld();
      cw.setZone(makeZone({ localPlayerId: 1, theme }));
      const seenKinds = new Set<string>();
      const seenProjectiles = new Set<string>();
      const seenAreas = new Set<string>();
      const seenDebuffs = new Set<string>();
      let checked = 0;
      for (let t = 0; t < 60 * 50; t++) {
        const a = t * 0.013;
        run.setIntent(1, { moveX: Math.cos(a), moveY: Math.sin(a), aimX: 0, aimY: 0, held: [true, false, false, false, false, false], flask: -1 });
        run.setIntent(2, { moveX: 0, moveY: 0, aimX: 0, aimY: 100, held: [true, false, false, false, false, false], flask: -1 });
        run.step();
        run.drainEvents();
        run.drainOutcomes();
        if (run.view.tick % SNAPSHOT_EVERY !== 0) continue;
        const v = run.view;
        const buf = enc.encode(v, 1, t);
        cw.pushSnapshot(buf, t * (1000 / 60) + 30);
        cw.update(t * (1000 / 60) + 30);
        if (v.tick % 30 !== 0) continue;
        const s = decodeSnapshot(buf);
        const me = v.players[0];
        // Monsters: every one in the AOI, with its (possibly new) kind.
        const sent = new Map<number, number>();
        for (let i = 0; i < s.monsters.n; i++) sent.set(s.monsters.id[i], i);
        let expected = 0;
        for (let i = 0; i < v.monsters.capacity; i++) {
          if (!v.monsters.alive[i] || !inAoi(v, me.x, me.y, v.monsters.x[i], v.monsters.y[i], v.monsters.radius[i])) continue;
          expected++;
          const j = sent.get(((((v.monsters.id[i] >>> 16) & 0xff) << 16) | (v.monsters.id[i] & 0xffff)) >>> 0);
          expect(j).toBeDefined();
          expect(s.monsters.kind[j!]).toBe(v.monsters.kind[i]);
          expect(s.monsters.rarity[j!]).toBe(v.monsters.rarity[i]);
          seenKinds.add(MONSTER_KINDS[v.monsters.kind[i]]);
        }
        expect(s.monsters.n).toBe(expected);
        // Projectiles: kinds and hostility.
        const pSent = new Map<number, number>();
        for (let i = 0; i < s.projectiles.n; i++) pSent.set(s.projectiles.id[i], i);
        for (let i = 0; i < v.projectiles.capacity; i++) {
          if (!v.projectiles.alive[i] || !inAoi(v, me.x, me.y, v.projectiles.x[i], v.projectiles.y[i], v.projectiles.radius[i])) continue;
          const j = pSent.get(((((v.projectiles.id[i] >>> 16) & 0xff) << 16) | (v.projectiles.id[i] & 0xffff)) >>> 0);
          expect(j).toBeDefined();
          expect(s.projectiles.kind[j!]).toBe(v.projectiles.kind[i]);
          expect(s.projectiles.hostile[j!]).toBe(v.projectiles.hostile[i]);
          seenProjectiles.add(PROJECTILE_KINDS[v.projectiles.kind[i]]);
        }
        // Areas: every telegraph in the AOI, and the pools too while they fit the ground budget (in the sim's order).
        const areaKinds = s.areas.slice(0, s.areaCount).map((ar) => `${ar.id}:${ar.kind}`);
        const inView = v.areas.filter((ar) => inAoi(v, me.x, me.y, ar.x, ar.y, ar.radius));
        const isGround = (ar: { kind: string }) => ar.kind === 'tarPool' || ar.kind === 'firePool' || ar.kind === 'fireTrail';
        if (inView.filter(isGround).length <= MAX_WIRE_GROUND_AREAS) {
          expect(areaKinds).toEqual(inView.map((ar) => `${ar.id}:${ar.kind}`));
        } else {
          const sent = new Set(areaKinds);
          for (const ar of inView) if (!isGround(ar)) expect(sent.has(`${ar.id}:${ar.kind}`)).toBe(true);
          expect(areaKinds.length).toBe(inView.filter((ar) => !isGround(ar)).length + MAX_WIRE_GROUND_AREAS);
        }
        for (const ar of v.areas) seenAreas.add(ar.kind);
        // Debuffs of every player, exactly (timers to the millisecond; a timer still running below 0.5 ms travels
        // as 1 ms — the sim applies it on its next tick, so the client must never read it as run out).
        for (const p of v.players) {
          const got = s.player(p.id)!.debuffs;
          expect(got.map((d) => [d.id, d.stacks, d.source])).toEqual(p.debuffs.map((d) => [d.id, d.stacks, d.source]));
          got.forEach((d, k) => {
            const want = p.debuffs[k].remaining;
            const tol = want > 0 && want < 0.0005 ? 0.001 + 1e-6 : 0.0005 + 1e-6;
            expect(Math.abs(d.remaining - want)).toBeLessThanOrEqual(tol);
            if (want > 0) expect(d.remaining).toBeGreaterThanOrEqual(0.001);
          });
          for (const d of p.debuffs) seenDebuffs.add(d.id);
        }
        checked++;
      }
      expect(checked).toBeGreaterThan(90);
      expect(cw.stats().decodeErrors).toBe(0);
      const fresh = (seen: Set<string>, table: readonly string[]) => table.filter((k) => seen.has(k)).join(',') || '–';
      process.stdout.write(
        `[net] ${theme}: new kinds ${fresh(seenKinds, NEW_MONSTER_KINDS)} · projectiles ${fresh(seenProjectiles, NEW_PROJECTILE_KINDS)}` +
        ` · areas ${fresh(seenAreas, NEW_AREA_KINDS)} · debuffs ${[...seenDebuffs].join(',') || '–'}\n`,
      );
    });
  }
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

describe('chain hook drags against the real sim (Iron Coliseum)', () => {
  const TICK = 1000 / 60;

  function coliseum(): RunConfig {
    const cfg = config();
    return {
      ...cfg, theme: 'ironColiseum', mapName: 'Iron Coliseum', seed: 3, tier: 5,
      monsters: { ...cfg.monsters, damageMultiplier: 0.05, countMultiplier: 1.5, rarePackChance: 0 }, // chain-hook test: no rare strike mods muddying pulls
      hooks: { rollKillLoot: () => [], rollChestLoot: () => [], tryPickup: () => false },
    };
  }

  /**
   * One real instance behind a `latency` link (inputs through createInputQueue; each snapshot followed by the events
   * collected since the previous one, like the game server sends them). The inputs never depend on the client, so the
   * server plays out identically with and without noteEvents. Correction sizes are bucketed per snapshot / batch.
   */
  function play(note: boolean, latency: number) {
    const run = createRun(coliseum());
    const rt = runtime();
    rt.stats = { ...rt.stats, maxLife: 50000, lifeRegen: 500 };
    run.addPlayer({ id: 1, name: 'Mira', level: 30, runtime: rt });
    const enc = createSnapshotEncoder();
    const queue = createInputQueue();
    const intent: PlayerIntent = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, held: [], flask: -1 };
    const cw = createClientWorld();
    cw.setZone(makeZone({ localPlayerId: 1, theme: 'ironColiseum', arenaRadius: 900, props: run.view.props.map((p) => ({ ...p })) }));
    cw.setPredictionHints({ moveSpeed: 125, castTimes: { emberLance: 0.3, emberNova: 0.4 } });
    const toServer: { at: number; input: InputMessage }[] = [];
    const toClient: { at: number; buf: ArrayBuffer; tick: number; events: SimEvent[] }[] = [];
    let pending: SimEvent[] = [];
    let pullBatches = 0;
    const sizes = { small: 0, mid: 0, large: 0 }; // < 1 · 1–15 · ≥ 15 units
    let seq = 0;
    let nextServer = TICK;
    let nextInput = 3;
    let nextFrame = 0;
    const bucket = (before: number) => {
      const st = cw.stats();
      if (st.corrections === before) return;
      const e = st.lastCorrection;
      if (e < 1) sizes.small++;
      else if (e < 15) sizes.mid++;
      else sizes.large++;
    };
    for (let now = 0; now < 80000; ) {
      now = Math.min(nextServer, nextInput, nextFrame);
      if (now >= nextServer) {
        while (toServer.length && toServer[0].at <= now) queue.push(toServer.shift()!.input);
        run.setIntent(1, queue.next(intent));
        run.step();
        for (const e of run.drainEvents()) pending.push(e);
        run.drainOutcomes();
        if (run.view.tick % SNAPSHOT_EVERY === 0) {
          if (pending.some((e) => e.t === 'pull' && e.playerId === 1)) pullBatches++;
          toClient.push({ at: now + latency, buf: enc.encode(run.view, 1, queue.ackSeq), tick: run.view.tick, events: pending });
          pending = [];
        }
        nextServer += TICK;
      }
      if (now >= nextInput) {
        const s = ++seq;
        const a = s * 0.012;
        const input: InputMessage = {
          t: 'input', seq: s, moveX: Math.cos(a), moveY: Math.sin(a), aimX: Math.cos(a * 3) * 400, aimY: Math.sin(a * 3) * 400, held: 1, flask: -1,
        };
        toServer.push({ at: now + latency, input });
        cw.predict(input);
        nextInput += TICK;
      }
      if (now >= nextFrame) {
        while (toClient.length && toClient[0].at <= now) {
          const m = toClient.shift()!;
          let before = cw.stats().corrections;
          cw.pushSnapshot(m.buf, now);
          bucket(before);
          before = cw.stats().corrections;
          if (note) cw.noteEvents(m.tick, m.events);
          bucket(before);
        }
        cw.update(now);
        nextFrame += 1000 / 144;
      }
    }
    return { st: cw.stats(), pullBatches, sizes };
  }

  /**
   * The e2e's rubber-band check, against the real sim: after each of her pulls, once a snapshot past every drag of
   * hers is in (mid-drag the prediction is already further along it), the predicted position is exactly where that
   * snapshot puts her plus what her unacknowledged inputs may walk — nothing when a root or freeze holds her through
   * the whole predicted stretch. Client frames at 12 fps, like a software-rendered headless page.
   */
  function pullAgreement(latency: number, seed: number) {
    const run = createRun({ ...coliseum(), seed });
    const rt = runtime();
    rt.stats = { ...rt.stats, maxLife: 50000, lifeRegen: 500 };
    run.addPlayer({ id: 1, name: 'Mira', level: 30, runtime: rt });
    const enc = createSnapshotEncoder();
    const queue = createInputQueue();
    const intent: PlayerIntent = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, held: [], flask: -1 };
    const cw = createClientWorld();
    cw.setZone(makeZone({ localPlayerId: 1, theme: 'ironColiseum', arenaRadius: 900, props: run.view.props.map((p) => ({ ...p })) }));
    cw.setPredictionHints({ moveSpeed: 125, castTimes: { emberLance: 0.3, emberNova: 0.4 } });
    const toServer: { at: number; input: InputMessage }[] = [];
    const toClient: { at: number; buf: ArrayBuffer; tick: number; events: SimEvent[]; x: number; y: number; hold: number }[] = [];
    let pending: SimEvent[] = [];
    let last: { tick: number; x: number; y: number; hold: number } | null = null;
    const waiting: { at: number; tick: number }[] = [];
    const dragTicks: number[] = [];
    const bad: string[] = [];
    let judged = 0;
    let seq = 0;
    let nextServer = TICK;
    let nextInput = 3;
    let nextFrame = 0;
    for (let now = 0; now < 90000; ) {
      now = Math.min(nextServer, nextInput, nextFrame);
      if (now >= nextServer) {
        while (toServer.length && toServer[0].at <= now) queue.push(toServer.shift()!.input);
        run.setIntent(1, queue.next(intent));
        run.step();
        for (const e of run.drainEvents()) pending.push(e);
        run.drainOutcomes();
        if (run.view.tick % SNAPSHOT_EVERY === 0) {
          const p = run.view.players[0];
          const hold = Math.max(0, ...p.debuffs.filter((d) => d.id === 'rooted' || d.id === 'frozen').map((d) => d.remaining));
          toClient.push({ at: now + latency, buf: enc.encode(run.view, 1, queue.ackSeq), tick: run.view.tick, events: pending, x: p.x, y: p.y, hold });
          pending = [];
        }
        nextServer += TICK;
      }
      if (now >= nextInput) {
        const s = ++seq;
        const a = s * 0.012;
        const input: InputMessage = {
          t: 'input', seq: s, moveX: Math.cos(a), moveY: Math.sin(a), aimX: Math.cos(a * 3) * 400, aimY: Math.sin(a * 3) * 400, held: 1, flask: -1,
        };
        toServer.push({ at: now + latency, input });
        cw.predict(input);
        nextInput += TICK;
      }
      if (now >= nextFrame) {
        while (toClient.length && toClient[0].at <= now) {
          const m = toClient.shift()!;
          cw.pushSnapshot(m.buf, now);
          cw.noteEvents(m.tick, m.events);
          last = m;
          for (const e of m.events) {
            if (e.t !== 'pull' || e.playerId !== 1) continue;
            waiting.push({ at: now, tick: m.tick });
            dragTicks.push(m.tick);
          }
        }
        cw.update(now);
        for (let k = 0; k < waiting.length; k++) {
          const w = waiting[k];
          if (!last || now < w.at + 300 || last.tick < w.tick + PULL_STEPS + 1) continue;
          if (dragTicks.some((t) => t <= last!.tick && last!.tick < t + PULL_STEPS + 1)) continue;
          waiting.splice(k--, 1);
          const pp = cw.predictedPosition()!;
          const st = cw.stats();
          const held = last.hold > ((st.pendingInputs + 2) / 60) * 2;
          const bound = held ? 12 : 12 + (st.pendingInputs * st.moveSpeed) / 60;
          const dist = Math.hypot(pp.x - last.x, pp.y - last.y);
          judged++;
          if (dist > bound) bad.push(`tick ${last.tick}: ${dist.toFixed(1)} u off (≤ ${bound.toFixed(1)}${held ? ', held' : ''})`);
        }
        nextFrame += 1000 / 12;
      }
    }
    return { judged, bad };
  }

  for (const latency of [50, 133]) {
    it(`after every hook drag at ${latency} ms one way, her prediction agrees with the server (no rubber band)`, () => {
      const { judged, bad } = pullAgreement(latency, 2);
      expect(judged).toBeGreaterThanOrEqual(5); // the chain thralls really hooked her
      expect(bad).toEqual([]);
    });
  }

  for (const latency of [50, 133]) {
    it(`replays every hook drag at ${latency} ms one way: one correction per pull instead of one per snapshot`, () => {
      const seen = play(true, latency);
      const blind = play(false, latency);
      process.stdout.write(
        `[net] coliseum ${latency} ms: ${seen.pullBatches} pulls, ${seen.st.pulls} replayed · corrections <1/1–15/≥15 units: ` +
        `${seen.sizes.small}/${seen.sizes.mid}/${seen.sizes.large} with noteEvents, ${blind.sizes.small}/${blind.sizes.mid}/${blind.sizes.large} without\n`,
      );
      expect(seen.pullBatches).toBeGreaterThanOrEqual(5); // the chain thralls really hooked her
      expect(seen.st.pulls).toBe(seen.pullBatches); // every delivered pull matched its snapshot
      expect(blind.st.pulls).toBe(0);
      // The drags stop costing a correction per snapshot: the mid-size ones (a drag step is 2.7 units) mostly vanish …
      // (The sub-unit ones are the horde's crowd slow and shoves — sim-only either way.)
      expect(seen.sizes.mid).toBeLessThan(blind.sizes.mid * 0.5);
      expect(seen.sizes.mid + seen.sizes.large).toBeLessThan((blind.sizes.mid + blind.sizes.large) * 0.6);
      // … leaving about one (unforeseeable) correction per hook.
      expect(seen.sizes.large).toBeLessThanOrEqual(seen.pullBatches + 2);
    });
  }
});
