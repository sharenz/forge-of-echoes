// The Bone Chorister (Rimed Ossuary lieutenant, GAME_SPEC §14): haste aura, Choir Waves (two expanding frost
// rings you walk through at the gaps) every 4 s, and Bone Thralls raised from corpses or the ground every 7 s.
import { describe, expect, it } from 'vitest';
import { MONSTER_KINDS } from '../../src/contracts/content';
import { SIM_DT, type SimEvent } from '../../src/contracts/sim';
import { CHOIR_RING_HALF_WIDTH, areaAngle, areaVariant, inChoirGap } from '../../src/sim/area-geometry';
import { damageMonster } from '../../src/sim/combat';
import { HASTE_BONUS, PLAYER_RADIUS } from '../../src/sim/constants';
import { DAMAGE_INDEX } from '../../src/sim/math';
import { monsterDef } from '../../src/sim/rosters';
import { CHORISTER } from '../../src/sim/rosters/ossuary/tuning';
import { MFLAG } from '../../src/sim/stores';
import type { Area } from '../../src/sim/world';
import { makeArena, joinArena, placeMonster } from '../sim/helpers';
import { attacks, debuffEvents, stepFor, stepUntil, tough } from './helpers';

const TAU = Math.PI * 2;

describe('Bone Chorister', () => {
  it('hastes the dead around it: allies within reach move 25% faster, nothing else changes', () => {
    const run = (withChorister: boolean) => {
      const a = makeArena({ stats: tough() });
      if (withChorister) placeMonster(a.world, 'boneChorister', 300, 60, { life: 1e6 });
      const t = placeMonster(a.world, 'boneThrall', 300, 0, { life: 1e6, still: false });
      const m = a.world.monsters;
      stepFor(a, 0.5);
      const x0 = m.x[t];
      stepFor(a, 0.5);
      return { dist: Math.abs(m.x[t] - x0), haste: m.hasteTime[t], empower: m.empowerTime[t], damage: m.damage[t] };
    };
    const alone = run(false);
    const hasted = run(true);
    expect(hasted.haste).toBeGreaterThan(0);
    expect(hasted.empower).toBe(0);
    expect(hasted.damage).toBe(alone.damage);
    expect(hasted.dist / alone.dist).toBeCloseTo(1 + HASTE_BONUS, 1);
  });

  it('sings a Choir Wave every 4 s: a toll, then two rings with three gaps each, the second turned a little further', () => {
    const a = makeArena({ stats: tough() });
    const c = placeMonster(a.world, 'boneChorister', 160, 0, { life: 1e6 });
    const m = a.world.monsters;
    const rings: { t: number; area: Area }[] = [];
    const seen = new Set<number>();
    const log: SimEvent[] = [];
    for (let k = 0; k < Math.round(12 / SIM_DT); k++) {
      const r = stepFor(a, SIM_DT);
      log.push(...r.events);
      for (const ar of a.world.areas) {
        if (ar.kind !== 'choirWave' || seen.has(ar.id)) continue;
        seen.add(ar.id);
        rings.push({ t: a.world.time, area: ar });
      }
    }
    // Three waves in 12 s (the first 2.5 s in, each after its 0.6 s toll), two rings each.
    expect(rings.length).toBe(6);
    expect(attacks(log, 'boneChorister', 'sing')).toHaveLength(6);
    for (let w = 0; w < 3; w++) {
      const [r1, r2] = [rings[2 * w], rings[2 * w + 1]];
      expect(r2.t - r1.t).toBeCloseTo(CHORISTER.ringGap, 1);
      expect(areaVariant(r1.area)).toBe(CHORISTER.gaps - 1);
      let turn = areaAngle(r2.area) - areaAngle(r1.area);
      turn -= Math.round(turn / TAU) * TAU;
      expect(Math.abs(turn)).toBeCloseTo(CHORISTER.gapTurn, 1);
      // Both rings grow from the Chorister to far across the field.
      expect(Math.hypot(r1.area.x - m.x[c], r1.area.y - m.y[c])).toBeLessThan(5);
      expect(r1.area.duration).toBe(CHORISTER.ringTime);
      if (w > 0) expect(r1.t - rings[2 * w - 2].t).toBeCloseTo(CHORISTER.choirEvery, 1);
    }
    expect(rings[0].t).toBeCloseTo(CHORISTER.choirFirst + CHORISTER.choirCast, 1);
  });

  it('a ring chills and hurts whoever it passes outside a gap; standing where both rings\' gaps overlap is safe', () => {
    const a = makeArena({ stats: tough() });
    placeMonster(a.world, 'boneChorister', 0, 0, { life: 1e6 });
    a.player.x = 300; // out of the way until the rings are out
    const exposed = joinArena(a, 2, -300, 0, tough());
    // Wait for the second ring of the first wave.
    const pair = stepUntil(a, 5, () => {
      const r = a.world.areas.filter((x) => x.kind === 'choirWave');
      return r.length >= 2 ? r : undefined;
    });
    expect(pair).toBeDefined();
    const [r1, r2] = pair!;
    // Safe spot: between the two rings' gap centres (inside both gaps); exposed: halfway between gaps.
    let diff = areaAngle(r2) - areaAngle(r1);
    diff -= Math.round(diff / TAU) * TAU;
    const safeAng = areaAngle(r1) + diff / 2;
    const openAng = areaAngle(r1) + Math.PI / 2;
    expect(inChoirGap(r1, safeAng) && inChoirGap(r2, safeAng)).toBe(true);
    expect(inChoirGap(r1, openAng) || inChoirGap(r2, openAng)).toBe(false);
    const d = 200;
    a.player.x = r1.x + Math.cos(safeAng) * d;
    a.player.y = r1.y + Math.sin(safeAng) * d;
    exposed.x = r1.x + Math.cos(openAng) * d;
    exposed.y = r1.y + Math.sin(openAng) * d;
    a.player.invulnTime = 0;
    exposed.invulnTime = 0;
    // Both rings pass both players within ~2.5 s.
    const r = stepFor(a, 2.6);
    expect(Math.min(r1.radius, r2.radius)).toBeGreaterThan(d + CHOIR_RING_HALF_WIDTH + PLAYER_RADIUS);
    expect(debuffEvents(r.events, 'chilled', 1)).toEqual([]);
    expect(debuffEvents(r.events, 'chilled', 2).length).toBeGreaterThan(0);
    const hits = r.events.filter((e) => e.t === 'hit' && e.target === 'player' && e.playerId === 2 && e.damageType === 'cold');
    expect(hits).toHaveLength(2); // once per ring
    expect(r.events.some((e) => e.t === 'hit' && e.target === 'player' && e.playerId === 1)).toBe(false);
  });

  it('raises Bone Thralls from the corpses around it', () => {
    const a = makeArena({ stats: tough() });
    const c = placeMonster(a.world, 'boneChorister', 100, 0, { life: 1e6 });
    const m = a.world.monsters;
    const spots = [[160, 40], [60, -70], [140, -50]] as const;
    for (const [x, y] of spots) {
      const i = placeMonster(a.world, 'ossuaryGolem', x, y, { life: 1 });
      damageMonster(a.world, i, 100, DAMAGE_INDEX.fire, 0, 1.5, 0, 0, 0, 0, true, 1);
    }
    const log: SimEvent[] = [];
    const chant = stepUntil(a, 6, (ev) => attacks(ev, 'boneChorister', 'summon')[0], undefined, log);
    expect(chant, 'no raising chant').toBeDefined();
    const raised = stepFor(a, CHORISTER.raiseCast + 0.1);
    const spawns = raised.events.filter((e) => e.t === 'monsterSpawn' && e.kind === 'boneThrall');
    expect(spawns.length).toBeGreaterThanOrEqual(3);
    for (const [x, y] of spots) expect(spawns.some((e) => e.t === 'monsterSpawn' && Math.hypot(e.x - x, e.y - y) < 1), `${x},${y}`).toBe(true);
    // They are summons (no loot, half XP), in the Chorister's pack.
    const thrall = MONSTER_KINDS.indexOf('boneThrall');
    const thralls = [...Array(m.hwm).keys()].filter((i) => m.alive[i] && m.kind[i] === thrall && m.flags[i] & MFLAG.summoned);
    expect(thralls.length).toBeGreaterThanOrEqual(3);
    for (const i of thralls) expect(m.pack[i]).toBe(m.pack[c]);
    for (const i of thralls) expect(m.xp[i]).toBeCloseTo(monsterDef('boneThrall').xp * 0.5, 5);
  });

  it('raises them from the ground when no corpse is near', () => {
    const a = makeArena({ stats: tough() });
    placeMonster(a.world, 'boneChorister', 100, 0, { life: 1e6 });
    expect(stepUntil(a, 6, (ev) => attacks(ev, 'boneChorister', 'summon')[0])).toBeDefined();
    const raised = stepFor(a, CHORISTER.raiseCast + 0.1);
    const spawns = raised.events.filter((e) => e.t === 'monsterSpawn' && e.kind === 'boneThrall');
    expect(spawns).toHaveLength(CHORISTER.raiseMin);
    for (const e of spawns) {
      if (e.t !== 'monsterSpawn') continue;
      const r = Math.hypot(e.x - 100, e.y);
      expect(r).toBeGreaterThanOrEqual(CHORISTER.raiseRingMin - 1);
      expect(r).toBeLessThanOrEqual(CHORISTER.raiseRingMax + 1);
    }
  });

  it('killing a raised thrall rolls no loot', () => {
    const a = makeArena({ stats: tough() });
    placeMonster(a.world, 'boneChorister', 100, 0, { life: 1e6 });
    stepUntil(a, 6, (ev) => attacks(ev, 'boneChorister', 'summon')[0]);
    stepFor(a, CHORISTER.raiseCast + 0.6);
    const m = a.world.monsters;
    const rolls = a.log.killRolls.length;
    let killed = 0;
    for (let i = 0; i < m.hwm; i++) {
      if (!m.alive[i] || !(m.flags[i] & MFLAG.summoned)) continue;
      damageMonster(a.world, i, 1e6, DAMAGE_INDEX.fire, 0, 1.5, 0, 0, 0, 0, true, 1);
      killed++;
    }
    expect(killed).toBeGreaterThan(0);
    expect(a.log.killRolls.length).toBe(rolls);
  });

  it('arrives with a guard of four thralls that belong to its pack', () => {
    const a = makeArena({ stats: tough() });
    const c = placeMonster(a.world, 'boneChorister', 200, 0, { life: 1e6 });
    const before = a.world.monsters.count;
    monsterDef('boneChorister').onSpawn!(a.world, c, -1, 200, 0);
    expect(a.world.monsters.count - before).toBe(CHORISTER.escorts);
  });
});
