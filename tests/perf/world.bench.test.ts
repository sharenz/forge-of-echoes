import assert from "node:assert/strict";
import test from "node:test";
import { performance } from "node:perf_hooks";
import { DamageTypeCode, World } from "../../server/engine/World";
import { SeededRng } from "../../server/engine/rng";

interface ProjectileSequence { value: number }

function topUpProjectiles(world: World, target: number, sequence: ProjectileSequence): void {
  while (world.projectiles.count < target) {
    const index = sequence.value++;
    const owner = index % 4;
    const angle = index * 2.399963229728653;
    const id = world.spawnProjectile({
      ownerPlayer: owner,
      x: 1_920 + Math.cos(angle) * (index % 240),
      y: 1_920 + Math.sin(angle) * (index % 240),
      directionX: Math.cos(angle),
      directionY: Math.sin(angle),
      speed: 620,
      range: 1e9,
      radius: 7,
      damage: 1,
      damageType: DamageTypeCode.Fire,
      pierces: 4_000,
    }, false);
    assert.notEqual(id, 0, "benchmark projectile admission must not reject a top-up");
  }
}

function benchmarkWorld(monsterCount: number, projectileCount: number): { world: World; projectileSequence: ProjectileSequence } {
  const world = new World({
    monsterCapacity: Math.max(2_048, monsterCount + 16),
    projectileCapacity: Math.max(1_024, projectileCount + 16),
    // A long-running top-up may become owner-skewed as different trajectories expire.
    maximumProjectilesPerPlayer: Math.max(64, projectileCount + 4),
    maximumEventsPerTick: 8_192,
    forceAllMonstersActive: monsterCount <= 2_000,
  }, { rng: new SeededRng(0xc0ffee) });
  const positions = [[1_760, 1_760], [2_080, 1_760], [1_760, 2_080], [2_080, 2_080]];
  positions.forEach(([x, y], index) => world.addPlayer({ characterId: `perf-${index}`, x, y, life: 1e12, focus: 1e12, armor: 0, evadeChance: 0, moveSpeed: 190 }));
  const side = Math.ceil(Math.sqrt(monsterCount));
  for (let index = 0; index < monsterCount; index += 1) {
    world.spawnMonster({
      x: 80 + (index % side) * (3_680 / side),
      y: 80 + Math.floor(index / side) * (3_680 / side),
      archetype: index % 3,
      rarity: index % 19 === 0 ? 2 : index % 7 === 0 ? 1 : 0,
      packId: Math.floor(index / 6),
      life: 1e12,
      damage: 1,
      armor: 0,
      evadeChance: 0,
      moveSpeed: 45 + index % 35,
      attackCooldownSeconds: 2,
    });
  }
  const projectileSequence = { value: 0 };
  topUpProjectiles(world, projectileCount, projectileSequence);
  return { world, projectileSequence };
}

interface TickMetrics { average: number; p95: number; maximum: number }

function measureSteadyState(monsterCount: number, projectileCount: number, warmup = 150, samples = 600): TickMetrics {
  const { world, projectileSequence } = benchmarkWorld(monsterCount, projectileCount);
  for (let index = 0; index < warmup; index += 1) {
    topUpProjectiles(world, projectileCount, projectileSequence);
    world.tick();
  }
  const timings: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    topUpProjectiles(world, projectileCount, projectileSequence);
    const started = performance.now();
    world.tick();
    timings.push(performance.now() - started);
    assert.equal(world.events.dropped, 0, "cosmetic events must remain inside the configured tick budget");
  }
  assert.equal(world.rejectedProjectiles, 0, "steady-state projectile admission must not reject top-ups");
  timings.sort((left, right) => left - right);
  return {
    average: timings.reduce((sum, value) => sum + value, 0) / timings.length,
    p95: timings[Math.ceil(timings.length * 0.95) - 1],
    maximum: timings[timings.length - 1],
  };
}

test("124-monster headless sanity floor stays comfortably below the target", (context) => {
  const metrics = measureSteadyState(124, 0, 50, 600);
  context.diagnostic(`avg=${metrics.average.toFixed(3)}ms p95=${metrics.p95.toFixed(3)}ms max=${metrics.maximum.toFixed(3)}ms`);
  assert.ok(metrics.average <= 2, `124-monster tick averaged ${metrics.average.toFixed(2)}ms`);
  assert.ok(metrics.p95 <= 4, `124-monster p95 was ${metrics.p95.toFixed(2)}ms`);
  assert.ok(metrics.maximum <= 20, `124-monster max was ${metrics.maximum.toFixed(2)}ms`);
});

test("2000 monsters and 1000 projectiles stay within the 8ms tick budget", (context) => {
  const metrics = measureSteadyState(2_000, 1_000);
  context.diagnostic(`avg=${metrics.average.toFixed(3)}ms p95=${metrics.p95.toFixed(3)}ms max=${metrics.maximum.toFixed(3)}ms`);
  assert.ok(metrics.average <= 8, `2000-monster/1000-projectile tick averaged ${metrics.average.toFixed(2)}ms`);
  assert.ok(metrics.p95 <= 12, `2000-monster/1000-projectile p95 was ${metrics.p95.toFixed(2)}ms`);
  assert.ok(metrics.maximum <= 50, `2000-monster/1000-projectile max was ${metrics.maximum.toFixed(2)}ms`);
});

test("5000 monsters with activation sleep and pack steering stay within the 8ms tick budget", (context) => {
  const metrics = measureSteadyState(5_000, 0);
  context.diagnostic(`avg=${metrics.average.toFixed(3)}ms p95=${metrics.p95.toFixed(3)}ms max=${metrics.maximum.toFixed(3)}ms`);
  assert.ok(metrics.average <= 8, `5000-monster sleep/pack tick averaged ${metrics.average.toFixed(2)}ms`);
  assert.ok(metrics.p95 <= 12, `5000-monster sleep/pack p95 was ${metrics.p95.toFixed(2)}ms`);
  assert.ok(metrics.maximum <= 50, `5000-monster sleep/pack max was ${metrics.maximum.toFixed(2)}ms`);
});
