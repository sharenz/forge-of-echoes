// Steady-state load in a real map (themed props, edge ring, the wave director running) with a full
// party of 4: 800 live monsters hunting the players (a mix of every regular archetype, so spitters
// lob, stalkers leap and brutes slam) plus 600 live projectiles. Reports avg / p99.
import { describe, expect, it } from 'vitest';
import { PROJECTILE_KINDS, type PlayerIntent } from '../../src/contracts/sim';
import { createRunInternal } from '../../src/sim/run';
import { projSpec, spawnProjectile } from '../../src/sim/projectiles';
import { spawnMonster } from '../../src/sim/spawn';
import type { World } from '../../src/sim/world';
import type { MonsterKind } from '../../src/contracts/content';
import { STRONG_LOADOUT, makeConfig, makeJoin, makeStats, strongSkills } from './fixtures';
import { hold } from './helpers';

const MONSTERS = 800;
const PROJECTILES = 600;
const PLAYERS = 4;
const MIX: MonsterKind[] = ['ashling', 'ashling', 'ashling', 'emberSkitter', 'emberSkitter', 'cinderSpitter', 'riftStalker', 'ironhideBrute'];

function topUp(w: World, k: number): void {
  const m = w.monsters;
  const rng = w.worldRng;
  while (m.count < MONSTERS) {
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(120, 700);
    const i = spawnMonster(w, MIX[k++ % MIX.length], Math.cos(a) * r, Math.sin(a) * r, { animate: false });
    m.maxLife[i] = m.life[i] = 1e12; // they never die: steady state
  }
  const pr = w.projectiles;
  const s = projSpec;
  let n = 0;
  while (pr.count < PROJECTILES) {
    const p = w.players[n++ % w.players.length];
    const hostile = rng.next() < 0.25;
    s.kind = hostile ? 4 : rng.int(0, 3);
    s.hostile = hostile;
    s.owner = p.id;
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(0, 500);
    s.x = p.x + Math.cos(a) * r;
    s.y = p.y + Math.sin(a) * r;
    s.angle = rng.range(0, Math.PI * 2);
    s.speed = rng.range(150, 420);
    s.range = rng.range(200, 400);
    s.radius = s.kind === 2 ? 14 : 5;
    s.damage = 10;
    s.dtype = 1;
    s.critChance = 0.1;
    s.critMult = 1.5;
    s.ailmentChance = 0.2;
    s.pierce = rng.next() < 0.3 ? -1 : 2;
    spawnProjectile(w, s);
  }
}

describe('performance', () => {
  it(`${MONSTERS} monsters + ${PROJECTILES} projectiles with ${PLAYERS} players in a map: avg < 3 ms per tick`, () => {
    const { run, world } = createRunInternal(
      makeConfig({ mode: 'map', theme: 'ashenForge', arenaRadius: 900, scaling: { hazards: true, extraProjectiles: 1 } }),
    );
    for (let id = 1; id <= PLAYERS; id++) {
      run.addPlayer(makeJoin(id, {
        stats: makeStats({ maxLife: 1e12, evasion: 0.2, pickupRadius: 80 }), skills: strongSkills(), loadout: STRONG_LOADOUT,
        x: Math.cos(id * 1.7) * 200, y: Math.sin(id * 1.7) * 200,
      }));
    }
    const solidProps = world.props.filter((p) => p.radius > 0).length;
    const intents: PlayerIntent[] = [];
    for (let id = 1; id <= PLAYERS; id++) {
      const intent = hold(0, 200, 0);
      intent.held[1] = true;
      intent.held[2] = true;
      intent.held[3] = true;
      intents.push(intent);
    }
    const times: number[] = [];
    for (let t = 0; t < 1500; t++) {
      topUp(world, t);
      for (let k = 0; k < PLAYERS; k++) {
        const intent = intents[k];
        const p = world.players[k];
        intent.moveX = Math.cos(t * 0.01 + k * 1.3);
        intent.moveY = Math.sin(t * 0.013 + k * 0.7);
        intent.aimX = p.x + Math.cos(t * 0.05 + k) * 150;
        intent.aimY = p.y + Math.sin(t * 0.05 + k) * 150;
        run.setIntent(p.id, intent);
      }
      const t0 = performance.now();
      run.step();
      const dt = performance.now() - t0;
      run.drainEvents();
      run.drainOutcomes();
      if (t >= 300) times.push(dt);
    }
    times.sort((a, b) => a - b);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const p99 = times[Math.floor(times.length * 0.99)];
    const p50 = times[Math.floor(times.length * 0.5)];
    const kinds = new Set<number>();
    for (let i = 0; i < world.projectiles.capacity; i++) if (world.projectiles.alive[i]) kinds.add(world.projectiles.kind[i]);
    console.log(
      `[sim perf] map, ${PLAYERS} players, ${world.props.length} props (${solidProps} solid), ${world.monsters.count} monsters, ` +
        `${world.projectiles.count} projectiles (${[...kinds].map((k) => PROJECTILE_KINDS[k]).join(', ')}): ` +
        `avg ${avg.toFixed(3)} ms, p50 ${p50.toFixed(3)} ms, p99 ${p99.toFixed(3)} ms per tick`,
    );
    expect(world.players.every((p) => !p.dead)).toBe(true);
    expect(solidProps).toBeGreaterThan(40);
    expect(world.monsters.count).toBeGreaterThanOrEqual(MONSTERS);
    expect(world.projectiles.count).toBeGreaterThanOrEqual(PROJECTILES * 0.9);
    expect(avg).toBeLessThan(3);
  }, 60_000);
});
