import assert from "node:assert/strict";
import test from "node:test";
import { decodeWorldEvents, encodeWorldEvents } from "../../multiplayer/wire/events";
import { SpatialGrid } from "../../server/engine/SpatialGrid";
import { DamageTypeCode, MonsterArchetype, World } from "../../server/engine/World";
import type { Clock } from "../../server/engine/clock";
import { entitySlot } from "../../server/engine/entity";
import { WorldEventType } from "../../server/engine/events";
import { SeededRng } from "../../server/engine/rng";
import { MonsterStore } from "../../server/engine/stores/Monsters";
import { MonsterReplicator } from "../../server/engine/snapshot";
import { MonsterInterpolationBuffer } from "../../app/game2d/MonsterInterpolationBuffer";
import { decodeMonsterLifecycle, encodeMonsterLifecycle, encodeMonsterSnapshot } from "../../multiplayer/wire/snapshot";

class ManualClock implements Clock {
  constructor(private currentMilliseconds = 0) {}

  nowMilliseconds(): number {
    return this.currentMilliseconds;
  }

  advance(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new RangeError("Clock advance must be finite and non-negative");
    this.currentMilliseconds += milliseconds;
  }
}

function createReplayWorld(seed: number): { world: World; clock: ManualClock } {
  const clock = new ManualClock();
  const world = new World({ width: 960, height: 960, monsterCapacity: 128, projectileCapacity: 128 }, { clock, rng: new SeededRng(seed) });
  world.addPlayer({ characterId: "player-one", x: 480, y: 480, life: 1_000, focus: 100, armor: 10, evadeChance: 0.05, moveSpeed: 190 });
  for (let index = 0; index < 40; index += 1) {
    const angle = index / 40 * Math.PI * 2;
    world.spawnMonster({
      x: 480 + Math.cos(angle) * 170,
      y: 480 + Math.sin(angle) * 170,
      archetype: index % 3,
      rarity: index % 5 === 0 ? 1 : 0,
      packId: Math.floor(index / 5),
      life: 80,
      damage: 8,
      moveSpeed: 55,
      experience: 4,
      itemQuantity: 120,
      itemRarity: 110,
    });
  }
  return { world, clock };
}

test("typed-array stores reuse slots with generation-safe entity ids", () => {
  const monsters = new MonsterStore(2);
  const first = monsters.spawn({ x: 1, y: 2, archetype: 0, rarity: 0, life: 10, damage: 1, moveSpeed: 2 });
  assert.notEqual(first, 0);
  assert.equal(monsters.has(first), true);
  assert.equal(monsters.release(first), true);
  const replacement = monsters.spawn({ x: 3, y: 4, archetype: 1, rarity: 0, life: 10, damage: 1, moveSpeed: 2 });
  assert.notEqual(replacement, first);
  assert.equal(monsters.has(first), false);
  assert.equal(monsters.has(replacement), true);
});

test("monster SoA storage remains below the 200-byte per-slot budget", () => {
  const capacity = 2_000;
  const monsters = new MonsterStore(capacity);
  const bytes = Object.values(monsters).reduce((sum, value) => ArrayBuffer.isView(value) ? sum + value.byteLength : sum, 0);
  assert.ok(bytes / capacity <= 200, `monster store uses ${(bytes / capacity).toFixed(1)} bytes/slot`);
});

test("spatial grid returns only entities in intersected cells", () => {
  const grid = new SpatialGrid(512, 512, 64, 16);
  grid.insert(1, 20, 20);
  grid.insert(2, 90, 20);
  grid.insert(3, 400, 400);
  const nearby: number[] = [];
  grid.queryAabb(0, 0, 120, 60, (slot) => nearby.push(slot));
  assert.deepEqual(new Set(nearby), new Set([1, 2]));
  const segment: number[] = [];
  grid.querySegment(0, 0, 100, 0, 20, (slot) => segment.push(slot));
  assert.deepEqual(new Set(segment), new Set([1, 2]));
});

test("fixed timestep accumulator is driven by the injected clock", () => {
  const clock = new ManualClock();
  const world = new World({ fixedStepMilliseconds: 50 }, { clock, rng: new SeededRng(1) });
  assert.equal(world.stepToClock(), 0);
  clock.advance(49);
  assert.equal(world.stepToClock(), 0);
  clock.advance(1);
  assert.equal(world.stepToClock(), 1);
  assert.equal(world.tickNumber, 1);
  clock.advance(250);
  assert.equal(world.stepToClock(), 4, "catch-up work is capped");
});

test("monsters emit one authoritative aggro event when they enter activation range", () => {
  const world = new World({
    width: 800,
    height: 800,
    monsterCapacity: 4,
    thinkIntervalTicks: 1,
    activationRadius: 120,
  }, { rng: new SeededRng(3) });
  const player = world.addPlayer({ characterId: "listener", x: 100, y: 100, life: 100, focus: 100, moveSpeed: 0 });
  const monsterId = world.spawnMonster({
    x: 500,
    y: 100,
    archetype: MonsterArchetype.Melee,
    rarity: 0,
    life: 20,
    damage: 0,
    moveSpeed: 0,
  });
  assert.ok(player);
  assert.equal(world.tick().some((event) => event.type === WorldEventType.MonsterAggro), false);

  player!.x = 430;
  const aggroEvents = world.tick().filter((event) => event.type === WorldEventType.MonsterAggro);
  assert.equal(aggroEvents.length, 1);
  assert.equal(aggroEvents[0].actorId, monsterId);
  assert.equal(aggroEvents[0].auxA, MonsterArchetype.Melee);
  assert.equal(world.tick().some((event) => event.type === WorldEventType.MonsterAggro), false, "aggro audio is a one-shot transition");
});

test("same seed and input log produce an identical event stream and state digest", () => {
  const first = createReplayWorld(42);
  const second = createReplayWorld(42);
  const eventPackets: string[][] = [[], []];
  const worlds = [first.world, second.world];
  for (let tick = 1; tick <= 30; tick += 1) {
    for (const [index, world] of worlds.entries()) {
      world.enqueueInput({ kind: "movement", playerIndex: 0, sequence: tick * 2 - 1, x: tick % 2 ? 1 : 0, y: tick % 2 ? 0 : 1 });
      world.enqueueInput({
        kind: "projectileBurst", playerIndex: 0, sequence: tick * 2,
        directions: [{ x: Math.cos(tick * 0.4), y: Math.sin(tick * 0.4) }],
        speed: 600, range: 360, radius: 9, damage: 18, damageType: DamageTypeCode.Fire, pierces: 2, skillId: 1,
      });
      const events = world.tick();
      eventPackets[index].push(Buffer.from(encodeWorldEvents(events)).toString("hex"));
    }
  }
  assert.deepEqual(eventPackets[0], eventPackets[1]);
  assert.equal(first.world.snapshotDigest(), second.world.snapshotDigest());
});

test("projectile sweeps use the spatial grid, aggregate damage, and obey caps", () => {
  const world = new World({ width: 512, height: 512, monsterCapacity: 32, projectileCapacity: 128, maximumProjectilesPerPlayer: 2 }, { rng: new SeededRng(7) });
  world.addPlayer({ characterId: "caster", x: 100, y: 256, life: 100, focus: 100, moveSpeed: 100 });
  const monsterId = world.spawnMonster({ x: 160, y: 256, archetype: MonsterArchetype.Melee, rarity: 0, life: 100, damage: 0, moveSpeed: 0 });
  const projectile = { ownerPlayer: 0, x: 100, y: 256, directionX: 1, directionY: 0, speed: 1_200, range: 200, radius: 8, damage: 15, damageType: DamageTypeCode.Fire, pierces: 0 };
  assert.notEqual(world.spawnProjectile(projectile), 0);
  assert.notEqual(world.spawnProjectile(projectile), 0);
  assert.equal(world.spawnProjectile(projectile), 0);
  const events = world.tick(0.05);
  assert.equal(events.filter((event) => event.type === WorldEventType.Damage && event.targetId === monsterId).length, 1, "damage numbers are aggregated per target and tick");
  assert.equal(world.monsters.life[monsterId & 0xffff], 70);
  assert.equal(world.rejectedProjectiles, 1);
});

test("projectile bursts reserve capacity before the simulation consumes them", () => {
  const world = new World({
    width: 512,
    height: 512,
    projectileCapacity: 3,
    maximumProjectilesPerPlayer: 2,
  }, { rng: new SeededRng(23) });
  world.addPlayer({ characterId: "caster", x: 100, y: 100, life: 100, focus: 100, moveSpeed: 0 });
  const burst = {
    kind: "projectileBurst" as const,
    playerIndex: 0,
    sequence: 1,
    directions: [{ x: 1, y: 0 }, { x: 0, y: 1 }],
    speed: 100,
    range: 200,
    radius: 5,
    damage: 10,
    damageType: DamageTypeCode.Fire,
    pierces: 0,
    skillId: 1,
  };
  assert.equal(world.enqueueInput(burst), true);
  assert.equal(world.enqueueInput({ ...burst, sequence: 2, directions: [{ x: -1, y: 0 }] }), false);
  assert.equal(world.rejectedProjectiles, 1);
  world.tick();
  assert.equal(world.projectiles.count, 2);
});

test("authoritative kill and drop outcomes survive a flooded cosmetic event buffer", () => {
  const world = new World({
    width: 512,
    height: 512,
    monsterCapacity: 16,
    projectileCapacity: 4,
    maximumEventsPerTick: 1,
  }, { rng: new SeededRng(29) });
  world.addPlayer({ characterId: "caster", x: 100, y: 256, life: 100, focus: 100, moveSpeed: 0 });
  for (let index = 0; index < 12; index += 1) {
    world.spawnMonster({
      x: 180 + index,
      y: 256,
      archetype: MonsterArchetype.Melee,
      rarity: 0,
      life: 1,
      damage: 0,
      moveSpeed: 0,
      experience: 3,
      itemQuantity: 100,
      itemRarity: 100,
    });
  }
  world.tick();
  world.spawnProjectile({
    ownerPlayer: 0,
    x: 100,
    y: 256,
    directionX: 1,
    directionY: 0,
    speed: 2_000,
    range: 300,
    radius: 24,
    damage: 10,
    damageType: DamageTypeCode.Fire,
    pierces: 15,
  });
  world.tick(0.05);

  assert.ok(world.events.dropped > 0, "the cosmetic stream is intentionally saturated");
  assert.equal(world.outcomes.view().filter((outcome) => outcome.type === WorldEventType.Kill).length, 12);
  assert.equal(world.outcomes.view().filter((outcome) => outcome.type === WorldEventType.Drop).length, 12);
  assert.equal(world.outcomes.view().filter((outcome) => outcome.type === WorldEventType.MonsterDespawn).length, 12);
  assert.equal(world.monsters.count, 0, "wave completion can derive directly from authoritative storage");
});

test("co-op damage is reported per owner and kill credit goes to the zero-crossing hit", () => {
  const world = new World({ width: 512, height: 512, monsterCapacity: 4, projectileCapacity: 4 }, { rng: new SeededRng(31) });
  world.addPlayer({ characterId: "first", x: 100, y: 250, life: 100, focus: 100, moveSpeed: 0 });
  world.addPlayer({ characterId: "second", x: 100, y: 260, life: 100, focus: 100, moveSpeed: 0 });
  const monsterId = world.spawnMonster({ x: 170, y: 256, archetype: 0, rarity: 0, life: 10, damage: 0, moveSpeed: 0 });
  world.tick();
  const projectile = { x: 100, y: 256, directionX: 1, directionY: 0, speed: 2_000, range: 200, radius: 12, damageType: DamageTypeCode.Fire, pierces: 0 };
  world.spawnProjectile({ ...projectile, ownerPlayer: 0, damage: 6, sequence: 11 });
  world.spawnProjectile({ ...projectile, ownerPlayer: 1, damage: 5, sequence: 12 });
  const events = world.tick(0.05);

  const damageEvents = events.filter((event) => event.type === WorldEventType.Damage && event.targetId === monsterId);
  assert.deepEqual(damageEvents.map((event) => [event.actorId, event.amount, event.sequence]), [
    [0x8000_0000, 6, 11],
    [0x8000_0001, 5, 12],
  ]);
  const kill = world.outcomes.view().find((outcome) => outcome.type === WorldEventType.Kill);
  assert.equal(kill?.actorId, 0x8000_0001);
  assert.equal(kill?.sequence, 12);
  assert.equal(kill?.auxA, 0, "the authoritative death outcome carries the monster archetype");
  assert.equal(kill?.auxB, 0, "the authoritative death outcome carries the monster rarity");
});

test("ranged monster projectiles deal damage only on collision and can be dodged", () => {
  const createRangedEncounter = () => {
    const world = new World({
      width: 800,
      height: 800,
      monsterCapacity: 8,
      monsterProjectileCapacity: 8,
      thinkIntervalTicks: 1,
    }, { rng: new SeededRng(11) });
    const player = world.addPlayer({ characterId: "target", x: 300, y: 256, life: 100, focus: 100, moveSpeed: 300 });
    world.spawnMonster({
      x: 100,
      y: 256,
      archetype: 1,
      behavior: MonsterArchetype.Ranged,
      rarity: 0,
      life: 100,
      damage: 10,
      moveSpeed: 0,
      attackCooldownSeconds: 100,
      projectileSpeed: 245,
      projectileRange: 560,
      projectileRadius: 8,
    });
    assert.ok(player);
    return { world, player: player! };
  };

  const direct = createRangedEncounter();
  const launchEvents = direct.world.tick(0.05);
  assert.equal(direct.player.life, 100, "launching a projectile must not apply instant damage");
  assert.ok(launchEvents.some((event) => event.type === WorldEventType.MonsterAction && event.sequence !== 0));
  let hit = false;
  for (let tick = 0; tick < 24; tick += 1) {
    if (direct.world.tick(0.05).some((event) => event.type === WorldEventType.MonsterProjectileHit)) hit = true;
  }
  assert.equal(hit, true);
  assert.equal(direct.player.life, 90);

  const dodged = createRangedEncounter();
  dodged.world.tick(0.05);
  dodged.player.y = 500;
  let expired = false;
  for (let tick = 0; tick < 52; tick += 1) {
    if (dodged.world.tick(0.05).some((event) => event.type === WorldEventType.MonsterProjectileExpire)) expired = true;
  }
  assert.equal(expired, true);
  assert.equal(dodged.player.life, 100, "moving out of the flight path must evade the projectile");
});

test("contact damage is capped per victim while every monster may still animate", () => {
  const world = new World({
    width: 512,
    height: 512,
    monsterCapacity: 16,
    thinkIntervalTicks: 1,
    playerContactCooldownSeconds: 0.9,
  }, { rng: new SeededRng(37) });
  const player = world.addPlayer({ characterId: "solo", x: 256, y: 256, life: 100, focus: 100, evadeChance: 0, moveSpeed: 0 });
  for (let index = 0; index < 8; index += 1) {
    world.spawnMonster({
      x: 250 + index,
      y: 256,
      archetype: MonsterArchetype.Melee,
      rarity: 0,
      life: 20,
      damage: 10,
      moveSpeed: 0,
      attackRange: 40,
      attackCooldownSeconds: 0.05,
    });
  }
  const firstActions = world.tick(0.05).filter((event) => event.type === WorldEventType.MonsterAction);
  assert.equal(firstActions.length, 8);
  assert.equal(player?.life, 90, "the pack applies at most one contact hit per victim window");
  for (let tick = 0; tick < 17; tick += 1) world.tick(0.05);
  assert.equal(player?.life, 90);
  world.tick(0.05);
  assert.equal(player?.life, 80, "contact damage resumes after the victim cooldown");
});

test("binary event batches round-trip as one bounded packet", () => {
  const events = [{ type: WorldEventType.Damage, tick: 9, actorId: 3, targetId: 4, amount: 12.5, x: 123.25, y: 456.5, auxA: 1, auxB: 2, sequence: 77 }];
  const encoded = encodeWorldEvents(events);
  assert.equal(encoded.byteLength, 31, "tick is stored once and damage uses the compact record layout");
  assert.deepEqual(decodeWorldEvents(encoded), events);
});

test("authoritative kill packets preserve death presentation data", () => {
  const events = [{
    type: WorldEventType.Kill,
    tick: 15,
    actorId: 0x8000_0001,
    targetId: 91,
    amount: 0,
    x: 612.25,
    y: 488.5,
    auxA: 3,
    auxB: 2,
    sequence: 44,
  }];
  const encoded = encodeWorldEvents(events);
  assert.equal(encoded.byteLength, 27);
  assert.deepEqual(decodeWorldEvents(encoded), events);
});

test("projectile event batches preserve the full 16-bit direction angle", () => {
  const directions = [0, 255, 256, 16_384, 32_768, 49_151, 65_535];
  const events = directions.map((direction, index) => ({
    type: WorldEventType.ProjectileSpawn,
    tick: 12,
    actorId: 3,
    targetId: index + 1,
    amount: 520,
    x: 512,
    y: 768,
    auxA: direction,
    auxB: 4,
    sequence: index + 20,
  }));

  const decoded = decodeWorldEvents(encodeWorldEvents(events));

  assert.deepEqual(decoded.map((event) => event.auxA), directions);
  assert.deepEqual(decoded.map((event) => event.auxB), events.map((event) => event.auxB));
});

test("AOI snapshots are quantized, change-only, and remain below the bandwidth budget", () => {
  const world = new World({ monsterCapacity: 2_048 }, { rng: new SeededRng(9) });
  world.addPlayer({ characterId: "observer", x: 1_920, y: 1_920, life: 100, focus: 100, moveSpeed: 0 });
  const side = Math.ceil(Math.sqrt(2_000));
  for (let index = 0; index < 2_000; index += 1) {
    world.spawnMonster({
      x: 40 + (index % side) * (3_760 / side), y: 40 + Math.floor(index / side) * (3_760 / side),
      archetype: index % 3, rarity: 0, packId: Math.floor(index / 6), life: 100, damage: 0, moveSpeed: 0,
    });
  }
  world.tick();
  const replicators = [[960, 960], [2_880, 960], [960, 2_880], [2_880, 2_880]].map(() => new MonsterReplicator(world));
  const bytesPerSecond = replicators.map((replicator, index) => {
    const [centerX, centerY] = [[960, 960], [2_880, 960], [960, 2_880], [2_880, 2_880]][index];
    const frame = replicator.build({ centerX, centerY, width: 960, height: 960, margin: 120 });
    return frame.snapshot.byteLength * 15;
  });
  for (const bandwidth of bytesPerSecond) assert.ok(bandwidth <= 80 * 1_024, `snapshot stream is ${(bandwidth / 1_024).toFixed(1)}KB/s`);
  const unchanged = replicators[0].build({ centerX: 960, centerY: 960, width: 960, height: 960, margin: 120 });
  assert.equal(unchanged.snapshot.byteLength, 8, "an unchanged AOI sends only its header");
});

test("a 2000-monster rush stays below the per-client p95 snapshot bandwidth budget", (context) => {
  const world = new World({ monsterCapacity: 2_048, forceAllMonstersActive: true }, { rng: new SeededRng(0x51a7) });
  world.addPlayer({ characterId: "rush-observer", x: 1_920, y: 1_920, life: 1e12, focus: 100, moveSpeed: 0 });
  for (let index = 0; index < 2_000; index += 1) {
    world.spawnMonster({
      x: 1_130 + (index % 50) * 31,
      y: 1_250 + Math.floor(index / 50) * 33,
      archetype: index % 3,
      rarity: 0,
      packId: Math.floor(index / 6),
      life: 1e12,
      damage: 1,
      moveSpeed: 90,
      attackCooldownSeconds: 2,
    });
  }
  const replicator = new MonsterReplicator(world);
  const aoi = { centerX: 1_920, centerY: 1_920, width: 960, height: 720, margin: 320 };
  world.tick();
  replicator.build(aoi);
  for (let tick = 0; tick < 20; tick += 1) {
    world.tick();
    if (world.tickNumber % 2 === 0) replicator.build(aoi);
  }
  const rates: number[] = [];
  for (let tick = 0; tick < 120; tick += 1) {
    world.tick();
    if (world.tickNumber % 2 !== 0) continue;
    const frame = replicator.build(aoi);
    rates.push((frame.snapshot.byteLength + (frame.lifecycle?.byteLength ?? 0)) * 10);
  }
  rates.sort((left, right) => left - right);
  const p95 = rates[Math.ceil(rates.length * 0.95) - 1];
  context.diagnostic(`rush snapshot p95: ${(p95 / 1_024).toFixed(2)} KiB/s`);
  assert.ok(p95 <= 80 * 1_024, `rush snapshot p95 was ${(p95 / 1_024).toFixed(2)} KiB/s`);
});

test("client interpolation consumes lifecycle and snapshot packets with a 100ms buffer", () => {
  const buffer = new MonsterInterpolationBuffer(100);
  buffer.applyLifecycle(encodeMonsterLifecycle({ spawns: [{ id: 65_537, archetype: 1, rarity: 0, maxLife: 100, x: 10, y: 20 }], despawns: [] }));
  buffer.applySnapshot(encodeMonsterSnapshot({ tick: 1, monsters: [{ id: 65_537, x: 10, y: 20, lifePercent: 1, flags: 1 }] }), 1_000);
  buffer.applySnapshot(encodeMonsterSnapshot({ tick: 2, monsters: [{ id: 65_537, x: 30, y: 40, lifePercent: 0.5, flags: 5 }] }), 1_100);
  const [sample] = buffer.sample(1_150);
  assert.equal(sample.x, 20);
  assert.equal(sample.y, 30);
  assert.ok(Math.abs(sample.lifePercent - 0.75) < 0.01);
  buffer.applyLifecycle(encodeMonsterLifecycle({ spawns: [], despawns: [65_537] }));
  assert.equal(buffer.size, 0);
});

test("replicator despawns the previous generation when a visible slot is reused", () => {
  const world = new World({ width: 512, height: 512, monsterCapacity: 2 }, { rng: new SeededRng(17) });
  world.addPlayer({ characterId: "observer", x: 256, y: 256, life: 100, focus: 100, moveSpeed: 0 });
  const previousId = world.spawnMonster({ x: 240, y: 240, archetype: 0, rarity: 0, life: 10, damage: 0, moveSpeed: 0 });
  world.tick();
  const replicator = new MonsterReplicator(world);
  const area = { centerX: 256, centerY: 256, width: 512, height: 512, margin: 0 };
  const initial = replicator.build(area);
  assert.ok(initial.lifecycle);

  assert.equal(world.monsters.release(previousId), true);
  const replacementId = world.spawnMonster({ x: 260, y: 260, archetype: 1, rarity: 1, life: 20, damage: 0, moveSpeed: 0 });
  assert.notEqual(replacementId, previousId);
  assert.equal(entitySlot(replacementId), entitySlot(previousId));
  const replacement = replicator.build(area);
  assert.ok(replacement.lifecycle);
  const lifecycle = decodeMonsterLifecycle(replacement.lifecycle!);
  assert.deepEqual(lifecycle.despawns, [previousId]);
  assert.deepEqual(lifecycle.spawns.map((spawn) => spawn.id), [replacementId]);

  const buffer = new MonsterInterpolationBuffer(0);
  buffer.applyLifecycle(initial.lifecycle!);
  buffer.applyLifecycle(replacement.lifecycle!);
  assert.equal(buffer.staticRecord(previousId), null);
  assert.equal(buffer.staticRecord(replacementId)?.archetype, 1);
  assert.equal(buffer.size, 1);
});
