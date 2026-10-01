// The fairness rules the skeleton rosters demonstrate (GAME_SPEC §13: a debuff never comes from an
// invisible source; §14 behaviour). Roster specialists replacing a skeleton keep these passing: they test
// what players see and suffer, not how a brain is written.
import { describe, expect, it } from 'vitest';
import { SIM_DT } from '../../src/contracts/sim';
import { CHARGE_LINE_HALF_WIDTH, areaAngle, areaVariant, inChargeLine } from '../../src/sim/area-geometry';
import { spawnArea } from '../../src/sim/areas';
import { HASTE_BONUS, PLAYER_RADIUS } from '../../src/sim/constants';
import { DAMAGE_INDEX } from '../../src/sim/math';
import { PROJ } from '../../src/sim/projectiles';
import type { Area } from '../../src/sim/world';
import { idleIntent, makeStats } from './fixtures';
import { joinArena, makeArena, ofType, placeMonster, pv, stepWith, type Arena } from './helpers';

const tough = () => makeStats({ maxLife: 1e6, evasion: 0 });

/** Step (all players idle) until `find` returns something, at most `seconds`. */
function stepUntil<T>(a: Arena, seconds: number, find: () => T | undefined): T | undefined {
  for (let t = 0; t < Math.round(seconds / SIM_DT); t++) {
    stepWith(a.run, idleIntent());
    a.run.drainEvents();
    const hit = find();
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/** A monster's own charge lane (a chargeLine of variant ≥ 1: aim lines are variant 0). */
const laneOf = (a: Arena, id: number): Area | undefined =>
  a.world.areas.find((x) => x.kind === 'chargeLine' && x.owner === id && areaVariant(x) >= 1 && !x.dead);

describe('Varkus: the charge is exactly what the lane shows', () => {
  it('shows the lane for the cast and the whole dash, stays in it, and hits exactly the players touching it', () => {
    const a = makeArena({ stats: tough() });
    const v = placeMonster(a.world, 'varkus', 200, 0, { life: 1e6, still: false });
    const m = a.world.monsters;
    const lane = stepUntil(a, 10, () => laneOf(a, m.id[v]));
    expect(lane, 'Varkus never telegraphed a charge').toBeDefined();
    const L = lane!;
    const hw = CHARGE_LINE_HALF_WIDTH[areaVariant(L)];
    expect(hw).toBeGreaterThanOrEqual(m.radius[v]); // the lane is at least as wide as his body
    const ux = Math.cos(areaAngle(L));
    const uy = Math.sin(areaAngle(L));
    // Out of the way: the target steps aside; one ally just touches the lane's edge, one stands 1 unit clear.
    a.player.x = L.x + ux * 40 - uy * 250;
    a.player.y = L.y + uy * 40 + ux * 250;
    const touching = joinArena(a, 2, L.x + ux * L.radius * 0.5 - uy * (hw + PLAYER_RADIUS - 1), L.y + uy * L.radius * 0.5 + ux * (hw + PLAYER_RADIUS - 1), tough());
    const clear = joinArena(a, 3, L.x + ux * L.radius * 0.6 + uy * (hw + PLAYER_RADIUS + 1), L.y + uy * L.radius * 0.6 - ux * (hw + PLAYER_RADIUS + 1), tough());
    touching.invulnTime = 0;
    clear.invulnTime = 0;
    let moved = 0;
    let movedWithoutLane = 0;
    let outside = 0;
    for (let t = 0; t < Math.round(3 / SIM_DT); t++) {
      const x0 = m.x[v];
      const y0 = m.y[v];
      stepWith(a.run, idleIntent());
      a.run.drainEvents();
      const step = Math.hypot(m.x[v] - x0, m.y[v] - y0);
      const shown = !L.dead && a.world.areas.includes(L);
      if (step > 3) {
        moved++;
        if (!shown) movedWithoutLane++;
      }
      if (shown && !inChargeLine(L, m.x[v], m.y[v], 0.5)) outside++;
    }
    expect(moved).toBeGreaterThan(10); // he dashed
    expect(movedWithoutLane).toBe(0);
    expect(outside).toBe(0);
    expect(touching.life).toBeLessThan(1e6);
    expect(pv(a.run, 2).debuffs.map((d) => d.id)).toContain('bleeding');
    expect(clear.life).toBe(1e6);
  });

  it('the Execution Mark never moves him off a lane: a mark landing mid-cast or mid-dash only strikes', () => {
    const a = makeArena({ stats: tough() });
    const v = placeMonster(a.world, 'varkus', 200, 0, { life: 1e6, still: false });
    const m = a.world.monsters;
    // His own mark carries the leap; borrow its effect for marks timed into a charge.
    const mark = stepUntil(a, 15, () => a.world.areas.find((x) => x.kind === 'executionMark' && x.owner === m.id[v]));
    expect(mark, 'Varkus never cast an Execution Mark').toBeDefined();
    expect(mark!.effect).toBeGreaterThan(0);
    const leap = mark!.effect;
    mark!.dead = true;
    const lane = stepUntil(a, 15, () => laneOf(a, m.id[v]));
    expect(lane, 'Varkus never charged after his mark').toBeDefined();
    const L = lane!;
    const ux = Math.cos(areaAngle(L));
    const uy = Math.sin(areaAngle(L));
    // Two marks far off the lane: one lands during the cast, one during the dash.
    const opts = { owner: m.id[v], hurts: 'player' as const, damage: 1, dtype: DAMAGE_INDEX.physical, effect: leap };
    spawnArea(a.world, 'executionMark', L.x - uy * 200, L.y + ux * 200, 30, 0.3, opts);
    spawnArea(a.world, 'executionMark', L.x + uy * 200, L.y - ux * 200, 30, 1.25, opts);
    let leaps = 0;
    let strikes = 0;
    let outside = 0;
    for (let t = 0; t < Math.round(2.5 / SIM_DT); t++) {
      stepWith(a.run, idleIntent());
      const ev = a.run.drainEvents();
      const shown = !L.dead && a.world.areas.includes(L);
      if (shown && !inChargeLine(L, m.x[v], m.y[v], 0.5)) outside++;
      for (const e of ev) {
        if (e.t === 'monsterAttack' && e.kind === 'varkus' && e.attack === 'leap' && shown) leaps++;
        if (e.t === 'areaResolve' && e.kind === 'executionMark') strikes++;
      }
    }
    expect(strikes).toBe(2);
    expect(leaps).toBe(0);
    expect(outside).toBe(0);
  });
});

describe('aim lines', () => {
  it("the Iron Crossbowman's bolt leaves from the start of the line it drew, even after a shove", () => {
    const a = makeArena({ stats: tough() });
    const c = placeMonster(a.world, 'ironCrossbowman', 220, 0, { life: 1e6, still: false });
    const m = a.world.monsters;
    const line = stepUntil(a, 10, () => a.world.areas.find((x) => x.kind === 'chargeLine' && x.owner === m.id[c]));
    expect(line, 'no aim line').toBeDefined();
    expect(areaVariant(line!)).toBe(0);
    const lx = line!.x;
    const ly = line!.y;
    const ang = areaAngle(line!);
    // Shoved sideways during the windup.
    m.y[c] += 12;
    m.x[c] -= 5;
    const pr = a.world.projectiles;
    const bolt = stepUntil(a, 2, () => {
      for (let i = 0; i < pr.hwm; i++) if (pr.alive[i] && pr.kind[i] === PROJ.crossbowBolt) return i;
      return undefined;
    });
    expect(bolt).toBeDefined();
    const b = bolt!;
    // Where it was launched: back along its velocity by its age.
    expect(pr.x[b] - pr.vx[b] * pr.age[b]).toBeCloseTo(lx, 3);
    expect(pr.y[b] - pr.vy[b] * pr.age[b]).toBeCloseTo(ly, 3);
    expect(Math.atan2(pr.vy[b], pr.vx[b])).toBeCloseTo(Math.atan2(Math.sin(ang), Math.cos(ang)), 5);
  });
});

describe('Bone Chorister', () => {
  it('hastes nearby allies by HASTE_BONUS — speed only, no empower', () => {
    const run = (withChorister: boolean) => {
      const a = makeArena({ stats: tough() });
      if (withChorister) placeMonster(a.world, 'boneChorister', 300, 60, { life: 1e6 });
      const t = placeMonster(a.world, 'boneThrall', 300, 0, { life: 1e6, still: false });
      const m = a.world.monsters;
      stepUntil(a, 0.5, () => undefined);
      const x0 = m.x[t];
      const y0 = m.y[t];
      stepUntil(a, 0.5, () => undefined);
      return { dist: Math.hypot(m.x[t] - x0, m.y[t] - y0), haste: m.hasteTime[t], empower: m.empowerTime[t], damage: m.damage[t] };
    };
    const alone = run(false);
    const hasted = run(true);
    expect(hasted.haste).toBeGreaterThan(0);
    expect(hasted.empower).toBe(0);
    expect(hasted.damage).toBe(alone.damage);
    expect(hasted.dist / alone.dist).toBeCloseTo(1 + HASTE_BONUS, 2);
  });
});

describe('hooks', () => {
  it("a chain hook's pull is shown by its 'pull' event and drawn from its launch point", () => {
    const a = makeArena({ stats: tough() });
    const t = placeMonster(a.world, 'chainThrall', 150, 0, { life: 1e6, still: false });
    const m = a.world.monsters;
    const pr = a.world.projectiles;
    const hook = stepUntil(a, 12, () => {
      for (let i = 0; i < pr.hwm; i++) if (pr.alive[i] && pr.kind[i] === PROJ.chainHook) return i;
      return undefined;
    });
    expect(hook).toBeDefined();
    // The documented drawing rule: the chain runs from (x − vx·age, y − vy·age), the thrower's muzzle.
    const h = hook!;
    const lx = pr.x[h] - pr.vx[h] * pr.age[h];
    const ly = pr.y[h] - pr.vy[h] * pr.age[h];
    expect(Math.hypot(lx - m.x[t], ly - m.y[t])).toBeLessThanOrEqual(m.radius[t] + 2 + 1e-3);
    let pulls = 0;
    for (let k = 0; k < 60; k++) {
      stepWith(a.run, idleIntent());
      pulls += ofType(a.run.drainEvents(), 'pull').length;
    }
    expect(pulls).toBe(1);
  });
});
