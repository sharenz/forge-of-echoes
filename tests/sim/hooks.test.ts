// The server's RunHooks are foreign code: a hook that throws or returns garbage must never corrupt
// the world or abort a tick. The sim commits its own state first and carries on without the hook.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MONSTER_KINDS } from '../../src/contracts/content';
import { SIM_DT, type DropSpec, type RunHooks, type SimOutcome } from '../../src/contracts/sim';
import { drainHookErrors } from '../../src/sim';
import { damageMonster } from '../../src/sim/combat';
import { DAMAGE_INDEX } from '../../src/sim/math';
import { createRunInternal, defaultCapacities } from '../../src/sim/run';
import type { World } from '../../src/sim/world';
import { makeConfig, makeHooks, makeJoin, makeParty, makeStats } from './fixtures';
import { outcomesOf, placeMonster, pv, stepN, walkIntent } from './helpers';

const sturdy = () => makeStats({ maxLife: 1e9, evasion: 0, pickupRadius: 200 });

/** Recording hooks with some calls replaced. */
function hooksWith(over: Partial<RunHooks>, dropChance = 1): RunHooks {
  return { ...makeHooks({ dropChance }).hooks, ...over };
}

/** A bare arena (no director, no furniture, no dummy) with player 1 at the origin. */
function arena(hooks: RunHooks) {
  const { run, world } = createRunInternal(makeConfig({ mode: 'hideout', arenaRadius: 600, seed: 5, hooks }), {
    capacities: defaultCapacities('map'),
  });
  world.props.length = 0;
  world.propGrid.clear();
  const m = world.monsters;
  for (let i = 0; i < m.hwm; i++) if (m.alive[i]) m.release(i);
  run.addPlayer(makeJoin(1, { stats: sturdy(), x: 0, y: 0 }));
  run.drainEvents();
  return { run, world };
}

function kill(world: World, i: number, by = 1): void {
  damageMonster(world, i, 1e6, DAMAGE_INDEX.fire, 0, 1.5, 0, 1, 0, 1, true, by);
}

/** Spawn the one-wave boss map for a sturdy party and return the Matriarch's slot once she stands. */
function bossMap(hooks: RunHooks, players = 1) {
  const r = makeParty(
    { seed: 17, hooks, waves: { count: 1, bossWave: 1, lieutenantWave: 0, waveDuration: 8, tellDuration: 1 } },
    Array.from({ length: players }, () => ({ stats: sturdy() })),
  );
  const m = r.world.monsters;
  let boss = -1;
  for (let t = 0; t < Math.round(20 / SIM_DT) && boss < 0; t++) {
    r.run.step();
    for (let k = 0; k < m.hwm; k++) if (m.alive[k] && MONSTER_KINDS[m.kind[k]] === 'cinderMatriarch' && m.spawnTime[k] <= 0) boss = k;
  }
  expect(boss).toBeGreaterThanOrEqual(0);
  return { ...r, boss };
}

describe('hooks that fail', () => {
  let logged: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logged = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('a throwing rollKillLoot: the monster still dies exactly once and its slot is freed', () => {
    let calls = 0;
    const { run, world } = arena(hooksWith({
      rollKillLoot() {
        calls++;
        throw new Error('loot table exploded');
      },
    }));
    const m = world.monsters;
    const i = placeMonster(world, 'ashling', 60, 0, { life: 1 });
    const id = m.id[i];
    const xp = m.xp[i];
    kill(world, i);
    expect(calls).toBe(1);
    expect(m.alive[i]).toBe(0);
    expect(m.slotOf(id)).toBe(-1);
    expect(m.count).toBe(0);
    // Hitting the corpse again (the old failure mode) is a no-op: exactly one kill.
    kill(world, i);
    const pending = run.drainOutcomes();
    const r = stepN(run, 120);
    expect(outcomesOf([...pending, ...r.outcomes], 'kill')).toEqual([
      { t: 'kill', playerId: 1, kind: 'ashling', rarity: 'normal', isLieutenant: false, isBoss: false },
    ]);
    expect(world.kills).toBe(1);
    // XP is committed with the kill even when the loot hook fails.
    expect(outcomesOf(pending, 'xp')).toEqual([{ t: 'xp', amount: xp }]);
    expect(outcomesOf(r.outcomes, 'xp')).toEqual([]);
    expect(run.view.drops).toHaveLength(0);
    // The server hears about it: logged once, and drainable.
    expect(logged).toHaveBeenCalledTimes(1);
    const errors = drainHookErrors(run);
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toMatch(/loot table exploded/);
    expect(drainHookErrors(run)).toEqual([]);
  });

  it('every boss roll throwing still clears the map; the chest opens even if its roll throws', () => {
    const base = makeHooks().hooks;
    const { run, world, boss } = bossMap(hooksWith({
      rollKillLoot(ctx, ids, rng) {
        if (ctx.isBoss) throw new Error('no boss loot today');
        return base.rollKillLoot(ctx, ids, rng);
      },
      rollChestLoot() {
        throw new Error('chest is empty');
      },
    }));
    world.monsters.life[boss] = 1;
    kill(world, boss);
    expect(world.monsters.alive[boss]).toBe(0);
    const outcomes: SimOutcome[] = [...run.drainOutcomes()];
    expect(outcomesOf(outcomes, 'kill').filter((k) => k.isBoss)).toHaveLength(1);
    expect(outcomesOf(outcomes, 'bossDefeated')).toHaveLength(1);
    run.step();
    outcomes.push(...run.drainOutcomes());
    expect(run.view.run.phase).toBe('cleared');
    expect(run.view.run.boss).toBeNull();
    expect(outcomesOf(outcomes, 'cleared')).toHaveLength(1);
    const chest = run.view.props.find((p) => p.kind === 'chest')!;
    const r = stepN(run, 400, () => walkIntent(pv(run).x, pv(run).y, chest.x, chest.y));
    expect(outcomesOf(r.outcomes, 'chestOpened')).toEqual([{ t: 'chestOpened', playerId: 1 }]);
    expect(chest.state).toBe(1);
    expect(r.events.some((e) => e.t === 'dropSpawn')).toBe(false);
    expect(drainHookErrors(run).map(String)).toEqual(['Error: no boss loot today', 'Error: chest is empty']);
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it('a throwing tryPickup refuses the pickup without cutting the tick short', () => {
    let throwing = true;
    const { run, world } = arena(hooksWith({
      tryPickup() {
        if (throwing) throw new Error('inventory service down');
        return true;
      },
    }));
    const i = placeMonster(world, 'riftStalker', 30, 0, { life: 1 });
    kill(world, i);
    const tick0 = run.view.tick;
    const r = stepN(run, 90);
    // Every tick ran to the end; kill XP is granted and the drop is kept, blocked.
    expect(run.view.tick).toBe(tick0 + 90);
    expect(outcomesOf(r.outcomes, 'xp').length).toBeGreaterThan(0);
    expect(outcomesOf(r.outcomes, 'pickup')).toHaveLength(0);
    expect(run.view.drops.length).toBeGreaterThan(0);
    expect(run.view.drops.every((d) => d.blocked)).toBe(true);
    // Walking off and back onto it retries, and the fixed hook grants it.
    throwing = false;
    const d = run.view.drops[0];
    stepN(run, 40, () => walkIntent(pv(run).x, pv(run).y, d.x - 80, d.y));
    const back = stepN(run, 120, () => walkIntent(pv(run).x, pv(run).y, d.x, d.y));
    expect(outcomesOf(back.outcomes, 'pickup').map((o) => o.token)).toContain(d.spec.token);
    expect(drainHookErrors(run).length).toBeGreaterThan(0);
  });

  it('malformed loot is filtered: bad shapes and owners outside the instance never reach the ground', () => {
    const good = (owner: number): DropSpec => ({
      token: 7, owner, autoPickup: true, label: 'Scrap', tone: 'currency', sprite: 'currency', iconId: 'icon/currency/scrap',
    });
    const { run, world } = arena(hooksWith({
      rollKillLoot() {
        return [good(1), good(42), null, { token: 'x' }, { ...good(1), token: Number.NaN }] as unknown as DropSpec[];
      },
    }));
    kill(world, placeMonster(world, 'ashling', 60, 0, { life: 1 }));
    expect(run.view.drops.map((d) => d.spec.owner)).toEqual([1]);
    expect(drainHookErrors(run)).toHaveLength(1);
    // A non-array result is no loot at all.
    world.config.hooks.rollKillLoot = () => undefined as unknown as DropSpec[];
    kill(world, placeMonster(world, 'ashling', -60, 0, { life: 1 }));
    expect(run.view.drops).toHaveLength(1);
    expect(String(drainHookErrors(run)[0])).toMatch(/expected DropSpec\[\]/);
  });

  it('loot without a boolean autoPickup is kept with the rules\' default for its sprite, and reported', () => {
    const legacy = (token: number, sprite: DropSpec['sprite']) =>
      ({ token, owner: 1, label: 'x', tone: 'normal', sprite, iconId: 'icon/currency/scrap' }) as unknown as DropSpec;
    const { run, world } = arena(hooksWith({ rollKillLoot: () => [legacy(1, 'equipment'), legacy(2, 'currency'), legacy(3, 'map')] }));
    kill(world, placeMonster(world, 'ashling', 60, 0, { life: 1 }));
    expect(run.view.drops.map((d) => [d.spec.token, d.spec.autoPickup])).toEqual([[1, false], [2, true], [3, true]]);
    const errors = drainHookErrors(run);
    expect(errors).toHaveLength(1);
    expect(String(errors[0])).toMatch(/3 drop spec\(s\) without a boolean autoPickup/);
  });
});
