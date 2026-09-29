// Walk-in portals cost something real online (a hideout portal is one of the map's 8 uses; the
// return portal sends you home, deleting your un-picked loot), so they only take a player who
// deliberately stops in them — never one walking past, picking up loot, or standing where one opens.
import { describe, expect, it } from 'vitest';
import { MONSTER_KINDS } from '../../src/contracts/content';
import { SIM_DT, type PlayerIntent, type SimRun } from '../../src/contracts/sim';
import { damageMonster } from '../../src/sim/combat';
import { PORTAL_DWELL, PORTAL_ENTER_RADIUS, RETURN_PORTAL_CLEARANCE } from '../../src/sim/constants';
import { DAMAGE_INDEX } from '../../src/sim/math';
import type { World } from '../../src/sim/world';
import { STRONG_LOADOUT, idleIntent, makeHooks, makeJoin, makeParty, makeSolo, makeStats, strongSkills, strongStats } from './fixtures';
import { ofType, outcomesOf, pv, stepN, walkIntent, type Recorded } from './helpers';

const strong = { stats: strongStats(), skills: strongSkills(), loadout: STRONG_LOADOUT };
const sturdy = () => makeStats({ maxLife: 1e9, evasion: 0 });
const DWELL_TICKS = Math.round(PORTAL_DWELL / SIM_DT);

function walkTo(run: SimRun, x: number, y: number, n: number, id = 1): Recorded {
  return stepN(run, n, () => {
    const p = pv(run, id);
    return Math.hypot(x - p.x, y - p.y) > 1.5 ? walkIntent(p.x, p.y, x, y) : idleIntent();
  }, id);
}

function hideout() {
  return makeSolo({ mode: 'hideout', arenaRadius: 260, ...strong });
}

function teleport(world: World, id: number, x: number, y: number): void {
  const p = world.playerById[id]!;
  p.x = p.prevX = x;
  p.y = p.prevY = y;
}

describe('hideout portal', () => {
  it('opens beside the map device, off the walk from the spawn: walking up to the device never enters it', () => {
    const { run } = hideout();
    run.setPortal(8);
    const portal = run.view.props.find((p) => p.kind === 'portal')!;
    const device = run.view.props.find((p) => p.kind === 'mapDevice')!;
    const spawn = { x: pv(run).x, y: pv(run).y };
    // Near the device, but well clear of the straight spawn → device line.
    expect(Math.hypot(portal.x - device.x, portal.y - device.y)).toBeLessThan(80);
    const t = ((portal.x - spawn.x) * (device.x - spawn.x) + (portal.y - spawn.y) * (device.y - spawn.y)) /
      ((device.x - spawn.x) ** 2 + (device.y - spawn.y) ** 2);
    const cx = spawn.x + (device.x - spawn.x) * t;
    const cy = spawn.y + (device.y - spawn.y) * t;
    expect(Math.hypot(portal.x - cx, portal.y - cy)).toBeGreaterThan(PORTAL_ENTER_RADIUS + 20);
    // Walk up to the device, linger in front of it, sidle around it: never pulled into the map.
    const r1 = walkTo(run, device.x, device.y + device.radius + 9, 300);
    const r2 = walkTo(run, device.x + device.radius + 10, device.y, 200);
    const r3 = walkTo(run, spawn.x, spawn.y, 300);
    for (const r of [r1, r2, r3]) expect(outcomesOf(r.outcomes, 'enterPortal')).toHaveLength(0);
    expect(portal.state).toBe(8);
  });

  it('walking straight through does nothing; stopping in it enters after the dwell time', () => {
    const { run, world } = hideout();
    run.setPortal(8);
    const portal = run.view.props.find((p) => p.kind === 'portal')!;
    teleport(world, 1, portal.x - 70, portal.y);
    const through = stepN(run, 70, { ...idleIntent(), moveX: 1 });
    expect(pv(run).x).toBeGreaterThan(portal.x + 40); // really went through
    expect(outcomesOf(through.outcomes, 'enterPortal')).toHaveLength(0);
    // Even slowed by a timed cast (Ember Nova), a straight crossing is shorter than the dwell.
    teleport(world, 1, portal.x - 40, portal.y);
    const nova: PlayerIntent = { ...idleIntent(portal.x, portal.y - 100), moveX: 1 };
    nova.held[1] = true;
    const slowed = stepN(run, 50, nova);
    expect(outcomesOf(slowed.outcomes, 'enterPortal')).toHaveLength(0);
    // Stop inside: taken after PORTAL_DWELL of continuous standing, exactly once.
    teleport(world, 1, portal.x + 30, portal.y);
    let inside = -1;
    let entered = -1;
    const all: Recorded = { events: [], outcomes: [] };
    for (let t = 0; t < 120; t++) {
      const p = pv(run);
      run.setIntent(1, Math.hypot(portal.x - p.x, portal.y - p.y) > 1.5 ? walkIntent(p.x, p.y, portal.x, portal.y) : idleIntent());
      run.step();
      if (inside < 0 && Math.hypot(pv(run).x - portal.x, pv(run).y - portal.y) <= PORTAL_ENTER_RADIUS) inside = t;
      const out = run.drainOutcomes();
      if (out.some((o) => o.t === 'enterPortal')) entered = t;
      all.outcomes.push(...out);
      all.events.push(...run.drainEvents());
    }
    expect(outcomesOf(all.outcomes, 'enterPortal')).toEqual([{ t: 'enterPortal', playerId: 1 }]);
    expect(ofType(all.events, 'portal').filter((e) => e.kind === 'enter')).toEqual([
      { t: 'portal', playerId: 1, x: portal.x, y: portal.y, kind: 'enter' },
    ]);
    expect(inside).toBeGreaterThanOrEqual(0);
    expect(entered - inside).toBe(DWELL_TICKS - 1);
  });

  it('a portal opening under a player needs a step out and back in', () => {
    const { run, world } = hideout();
    run.setPortal(8);
    const portal = run.view.props.find((p) => p.kind === 'portal')!;
    run.setPortal(0);
    // A visitor waits on the (hidden) spot; the owner activates a new map.
    run.addPlayer(makeJoin(2, { stats: sturdy(), x: portal.x, y: portal.y }));
    teleport(world, 1, portal.x + 5, portal.y);
    run.setPortal(8);
    // Both stand still where it opened (player 2 keeps its idle join intent): nobody is taken.
    const wait = stepN(run, 120);
    expect(outcomesOf(wait.outcomes, 'enterPortal')).toHaveLength(0);
    // Player 1 steps out and back in: taken.
    walkTo(run, portal.x + 60, portal.y, 90);
    const back = walkTo(run, portal.x, portal.y, 150);
    expect(outcomesOf(back.outcomes, 'enterPortal')).toEqual([{ t: 'enterPortal', playerId: 1 }]);
  });
});

describe('map return portal', () => {
  /** A one-wave boss map for a sturdy party; the boss dies next to player 1. */
  function clearBossMap(seed: number) {
    const { hooks, log } = makeHooks({ dropChance: 1 });
    const { run, world } = makeParty(
      { seed, hooks, waves: { count: 1, bossWave: 1, lieutenantWave: 0, waveDuration: 8, tellDuration: 1 } },
      [{ stats: sturdy() }, { stats: sturdy() }],
    );
    const m = world.monsters;
    let boss = -1;
    for (let t = 0; t < Math.round(20 / SIM_DT) && boss < 0; t++) {
      run.step();
      for (let k = 0; k < m.hwm; k++) if (m.alive[k] && MONSTER_KINDS[m.kind[k]] === 'cinderMatriarch' && m.spawnTime[k] <= 0) boss = k;
    }
    expect(boss).toBeGreaterThanOrEqual(0);
    // Player 1 fights in melee range (the worst case: loot lands all around the anchor).
    teleport(world, 1, m.x[boss] + 30, m.y[boss]);
    const bx = m.x[boss];
    const by = m.y[boss];
    m.life[boss] = 1;
    damageMonster(world, boss, 1e6, DAMAGE_INDEX.fire, 0, 1.5, 0, 1, 0, 1, true, 1);
    run.step();
    expect(run.view.run.phase).toBe('cleared');
    return { run, world, log, bx, by };
  }

  it('opens clear of the boss\'s fall, the chest and the loot, yet close to the player', () => {
    for (const seed of [17, 3, 29, 41]) {
      const { run, world, bx, by } = clearBossMap(seed);
      const portal = run.view.props.find((p) => p.kind === 'returnPortal')!;
      const chest = run.view.props.find((p) => p.kind === 'chest')!;
      expect(Math.hypot(portal.x - bx, portal.y - by)).toBeGreaterThanOrEqual(RETURN_PORTAL_CLEARANCE - 1e-3);
      expect(Math.hypot(portal.x - chest.x, portal.y - chest.y)).toBeGreaterThanOrEqual(RETURN_PORTAL_CLEARANCE - 1e-3);
      const p1 = world.playerById[1]!;
      expect(Math.hypot(portal.x - p1.x, portal.y - p1.y)).toBeLessThanOrEqual(200);
      // After the boss loot has landed, none of it lies in (or right beside) the portal.
      stepN(run, 180);
      for (const d of run.view.drops) expect(Math.hypot(d.x - portal.x, d.y - portal.y)).toBeGreaterThan(PORTAL_ENTER_RADIUS + 20);
    }
  });

  it('collecting loot and opening the chest never sends anyone home; standing in the portal does', () => {
    const { run, log } = clearBossMap(17);
    const portal = run.view.props.find((p) => p.kind === 'returnPortal')!;
    const chest = run.view.props.find((p) => p.kind === 'chest')!;
    const home: number[] = [];
    // Player 1 opens the chest, then both collect every drop they own.
    const r = walkTo(run, chest.x, chest.y, 400);
    for (const o of outcomesOf(r.outcomes, 'returnPortal')) home.push(o.playerId);
    for (let t = 0; t < 1500 && run.view.drops.length > 0; t++) {
      for (const id of [1, 2]) {
        const p = pv(run, id);
        const mine = run.view.drops.filter((d) => d.spec.owner === id && d.z < 0.5);
        const next = mine.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y))[0];
        run.setIntent(id, next ? walkIntent(p.x, p.y, next.x, next.y) : idleIntent());
      }
      run.step();
      for (const o of run.drainOutcomes()) if (o.t === 'returnPortal') home.push(o.playerId);
    }
    expect(run.view.drops).toHaveLength(0);
    expect(log.pickupsBy.length).toBeGreaterThan(10);
    expect(home).toEqual([]);
    // Now player 2 walks in and stops: home.
    const exit = walkTo(run, portal.x, portal.y, 400, 2);
    expect(outcomesOf(exit.outcomes, 'returnPortal')).toEqual([{ t: 'returnPortal', playerId: 2 }]);
  });

  it('the return portal is clickable (interactive) from the moment it opens', () => {
    const { run } = clearBossMap(17);
    const portal = run.view.props.find((p) => p.kind === 'returnPortal')!;
    expect(portal.state).toBe(1);
    expect(portal.interactive).toBe(true);
    // The chest is walked into, never clicked.
    expect(run.view.props.find((p) => p.kind === 'chest')!.interactive).toBe(false);
  });

  it('a player arriving right on the open return portal is not sent straight back', () => {
    const { run } = clearBossMap(17);
    const portal = run.view.props.find((p) => p.kind === 'returnPortal')!;
    run.addPlayer(makeJoin(3, { stats: sturdy(), x: portal.x + 4, y: portal.y }));
    const wait = stepN(run, 120, idleIntent(), 3);
    expect(outcomesOf(wait.outcomes, 'returnPortal')).toHaveLength(0);
    walkTo(run, portal.x, portal.y + 60, 90, 3);
    const back = walkTo(run, portal.x, portal.y, 150, 3);
    expect(outcomesOf(back.outcomes, 'returnPortal')).toEqual([{ t: 'returnPortal', playerId: 3 }]);
  });
});
