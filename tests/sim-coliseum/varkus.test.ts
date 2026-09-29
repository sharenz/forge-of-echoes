// Varkus, the Iron Champion (Iron Coliseum boss, GAME_SPEC §14): three phases, and every blow he deals is
// one the player saw coming — the cleave's slam circle, the charge lane, the Execution Mark he leaps onto,
// the whirlwind's ring, Crowd's Favour's spike tiles.
import { describe, expect, it } from 'vitest';
// The harness first: it loads the sim through run.ts (the core's modules import each other in a cycle).
import { placeMonster, pv } from '../sim/helpers';
import { MONSTER_ANIM, SIM_DT, type SimEvent } from '../../src/contracts/sim';
import { areaAngle, areaVariant, inChargeLine } from '../../src/sim/area-geometry';
import { startBoss } from '../../src/sim/bosses';
import { PLAYER_RADIUS, ROOT_DURATION } from '../../src/sim/constants';
import { applyDebuff, cleanseDebuffs, isHeld } from '../../src/sim/debuffs';
import { monsterDef } from '../../src/sim/rosters';
import { VARKUS as V } from '../../src/sim/rosters/coliseum/tuning';
import { CHARGE_VARIANT, SPIKE_WARN, type VarkusState } from '../../src/sim/rosters/coliseum/varkus';
import { spawnMonster } from '../../src/sim/spawn';
import { MSTATE } from '../../src/sim/stores';
import type { Area } from '../../src/sim/world';
import { PLAYER_DEBUFFS } from '../../src/contracts/bestiary';
import { idleIntent } from '../sim/fixtures';
import { joinArena } from '../sim/helpers';
import { arena, areasOf, attacksOf, cullExcept, monstersOf, step, stepUntil, ticks, toughStats, touchesDisc, walkDir } from './helpers';

/** The run's boss, placed by hand: Varkus at (x, y) with `life` (so phases can be driven by setting it). */
function boss(a: ReturnType<typeof arena>, x: number, y: number, life = 1e6): number {
  const i = spawnMonster(a.world, 'varkus', x, y, { boss: true, animate: false, wave: 6 });
  const m = a.world.monsters;
  m.life[i] = m.maxLife[i] = life;
  startBoss(a.world, i, monsterDef('varkus'));
  return i;
}

/** Put the boss at `frac` of his life (the core roars into the matching phase on the next tick). */
function setLife(a: ReturnType<typeof arena>, i: number, frac: number): void {
  a.world.monsters.life[i] = a.world.monsters.maxLife[i] * frac;
}

describe('Varkus: phases', () => {
  it('whirls from phase 2 and calls Crowd\'s Favour in phase 3 only; roars into each phase', () => {
    const a = arena();
    a.player.invulnTime = 0;
    const i = boss(a, 150, 0);
    const counts = [0, 0, 0].map(() => ({ whirl: 0, spikes: 0, charge: 0, mark: 0, slam: 0, summon: 0 }));
    const phases: number[] = [];
    for (let phase = 1; phase <= 3; phase++) {
      if (phase === 2) setLife(a, i, 0.6);
      if (phase === 3) setLife(a, i, 0.3);
      for (let t = 0; t < ticks(30); t++) {
        const ev = step(a);
        cullExcept(a.world, [i]);
        cleanseDebuffs(a.world, a.player, PLAYER_DEBUFFS);
        for (const e of ev) {
          if (e.t === 'bossPhase') phases.push(e.phase);
          if (e.t === 'monsterAttack' && e.kind === 'varkus' && e.attack in counts[0]) counts[phase - 1][e.attack as keyof (typeof counts)[0]]++;
        }
      }
    }
    expect(phases).toEqual([2, 3]);
    expect(counts[0].whirl + counts[0].spikes).toBe(0);
    expect(counts[1].whirl).toBeGreaterThan(0);
    expect(counts[1].spikes).toBe(0);
    expect(counts[2].spikes).toBeGreaterThan(0);
    for (const c of counts) {
      expect(c.charge + c.slam, JSON.stringify(c)).toBeGreaterThan(0);
      expect(c.mark).toBeGreaterThan(0);
      expect(c.summon).toBeGreaterThan(0);
    }
  });

  it('summons Pit Hounds, and stops while enough of them are near him', () => {
    const a = arena();
    a.player.invulnTime = 0;
    const i = boss(a, 150, 0);
    let summons = 0;
    for (let t = 0; t < ticks(60); t++) {
      const before = monstersOf(a.world, 'pitHound').length;
      const ev = step(a);
      cleanseDebuffs(a.world, a.player, PLAYER_DEBUFFS);
      if (!attacksOf(ev, 'varkus', 'summon').length) continue;
      summons++;
      expect(before).toBeLessThan(V.summonCap);
      expect(monstersOf(a.world, 'pitHound').length).toBeGreaterThan(before);
    }
    expect(summons).toBeGreaterThanOrEqual(2);
    expect(a.world.monsters.alive[i]).toBe(1);
  });
});

describe('Varkus: the Execution Mark', () => {
  it('follows its player until it locks, then he leaps onto it and lands exactly as it strikes', () => {
    const a = arena();
    a.player.invulnTime = 0;
    const i = boss(a, 200, 0);
    const m = a.world.monsters;
    const mark = stepUntil(a, 12, () => {
      cullExcept(a.world, [i]);
      return areasOf(a.world, 'executionMark', { owner: m.id[i] })[0];
    });
    expect(mark, 'no mark').toBeDefined();
    expect(mark!.followPlayer).toBe(1);
    let leapAt = -1;
    let lockedX = NaN;
    let lockedY = NaN;
    let landed = false;
    for (let t = 0; t < ticks(V.markTime + 0.2) && !landed; t++) {
      // She walks until just after the lock, then stands in the mark.
      const walking = mark!.age < V.markLock + 0.1;
      const ev = step(a, walking ? walkDir(0, 1) : idleIntent());
      cullExcept(a.world, [i]);
      // Before the lock it sits on her; from a tick after the lock it never moves again (she keeps walking).
      if (mark!.age < V.markLock - SIM_DT) expect(Math.hypot(mark!.x - a.player.x, mark!.y - a.player.y)).toBeLessThan(1e-3);
      else if (mark!.age >= V.markLock + SIM_DT) {
        if (Number.isNaN(lockedX)) {
          lockedX = mark!.x;
          lockedY = mark!.y;
        } else expect([mark!.x, mark!.y]).toEqual([lockedX, lockedY]);
      }
      if (attacksOf(ev, 'varkus', 'leap').length) {
        leapAt = mark!.age;
        expect(m.anim[i]).toBe(MONSTER_ANIM.leap);
      }
      if (ev.some((e) => e.t === 'areaResolve' && e.kind === 'executionMark')) {
        landed = true;
        expect(Math.hypot(m.x[i] - lockedX, m.y[i] - lockedY)).toBeLessThan(3);
      }
    }
    expect(landed).toBe(true);
    expect(leapAt).toBeCloseTo(V.markTime - V.leapFlight, 1);
    expect(a.player.life).toBeLessThan(1e6); // she stood in it
    // He recovers after the landing: the opening.
    expect(m.state[i]).toBe(MSTATE.attack);
  });

  it('a player who walks out after the lock takes nothing', () => {
    const a = arena();
    a.player.invulnTime = 0;
    const i = boss(a, 200, 0);
    const m = a.world.monsters;
    const mark = stepUntil(a, 12, () => areasOf(a.world, 'executionMark', { owner: m.id[i] })[0]);
    expect(mark).toBeDefined();
    stepUntil(a, V.markLock + 0.05, () => (mark!.age >= V.markLock ? true : undefined));
    cleanseDebuffs(a.world, a.player, PLAYER_DEBUFFS);
    const life = a.player.life;
    let strikes = 0;
    for (let t = 0; t < ticks(V.markTime - V.markLock + 0.1); t++) {
      const ev = step(a, walkDir(-1, 0.3));
      cullExcept(a.world, [i]);
      strikes += ev.filter((e) => e.t === 'areaResolve' && e.kind === 'executionMark').length;
    }
    expect(strikes).toBe(1);
    expect(a.player.life).toBe(life);
  });

  it('a root at the lock never takes the walk-out away: the mark waits while its player is held', () => {
    const a = arena();
    a.player.invulnTime = 0;
    const i = boss(a, 200, 0);
    const m = a.world.monsters;
    const mark = stepUntil(a, 12, () => areasOf(a.world, 'executionMark', { owner: m.id[i] })[0]);
    expect(mark).toBeDefined();
    // Rooted (tar, say) a moment before the mark locks.
    stepUntil(a, V.markLock, () => (mark!.age >= V.markLock - 0.1 ? true : undefined));
    expect(applyDebuff(a.world, a.player, 'rooted', 0, 'tar')).toBe(true);
    const ageAtRoot = mark!.age;
    for (let t = 0; t < ticks(ROOT_DURATION) - 1; t++) {
      step(a, walkDir(-1, 0));
      cullExcept(a.world, [i]);
    }
    expect(mark!.age).toBeLessThan(ageAtRoot + 0.2); // it stood still while she was held
    // Free again: the full walk-out is still there.
    cleanseDebuffs(a.world, a.player, ['bleeding']);
    const life = a.player.life;
    let strikes = 0;
    for (let t = 0; t < ticks(V.markTime - V.markLock + 1); t++) {
      const ev = step(a, walkDir(-1, 0));
      cullExcept(a.world, [i]);
      strikes += ev.filter((e) => e.t === 'areaResolve' && e.kind === 'executionMark').length;
    }
    expect(pv(a.run).debuffs.map((d) => d.id)).not.toContain('rooted');
    expect(strikes).toBe(1);
    expect(a.player.life).toBe(life);
  });
});

describe("Varkus: Crowd's Favour", () => {
  /** Tiles of one Crowd's Favour cast (phase 3), with the player's position at the cast. */
  function casts(n: number) {
    const a = arena();
    a.player.invulnTime = 0;
    const i = boss(a, 160, 0);
    setLife(a, i, 0.3);
    const out: { tiles: Area[]; cx: number; cy: number }[] = [];
    for (let t = 0; t < ticks(80) && out.length < n; t++) {
      const ev = step(a);
      cullExcept(a.world, [i]);
      cleanseDebuffs(a.world, a.player, PLAYER_DEBUFFS);
      if (!attacksOf(ev, 'varkus', 'spikes').length) continue;
      out.push({ tiles: areasOf(a.world, 'arenaSpikes').filter((s) => s.age <= SIM_DT + 1e-9), cx: a.player.x, cy: a.player.y });
      // Clear the stage for the next one (she's tough, but the sim keeps going).
      a.player.life = a.player.stats.maxLife;
    }
    return out;
  }

  it('raises tiles round the player in three different patterns, each tile telegraphed ≥ SPIKE_WARN', () => {
    const cs = casts(3);
    expect(cs).toHaveLength(3);
    const shapes = new Set<string>();
    for (const c of cs) {
      expect(c.tiles.length).toBeGreaterThan(10);
      for (const tile of c.tiles) {
        expect(tile.duration).toBeGreaterThanOrEqual(SPIKE_WARN - 1e-9);
        expect(tile.hurts).toBe('player');
        expect(Math.hypot(tile.x - c.cx, tile.y - c.cy)).toBeLessThan(160);
      }
      shapes.add(`${c.tiles.length}:${c.tiles.some((tile) => Math.hypot(tile.x - c.cx, tile.y - c.cy) < 1)}`);
    }
    expect(shapes.size).toBe(3);
  });

  it('every pattern can be walked out of in any direction; standing still is safe only in the rings', () => {
    const speed = arena().player.stats.moveSpeed;
    let stillSafe = 0;
    for (const c of casts(3)) {
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2 + 0.2;
        for (const tile of c.tiles) {
          // Where she is when this tile bursts, walking straight out from the cast on.
          const d = speed * tile.duration;
          const x = c.cx + Math.cos(ang) * d;
          const y = c.cy + Math.sin(ang) * d;
          expect(touchesDisc(tile, x, y), `walking out at ${k * 45}° meets a tile`).toBe(false);
        }
      }
      if (!c.tiles.some((tile) => touchesDisc(tile, c.cx, c.cy))) stillSafe++;
    }
    expect(stillSafe).toBe(1);
  });
});

describe('Varkus: nothing untelegraphed', () => {
  it('every blow he lands comes from a telegraph that contains the player: a resolving circle, his lane or his whirl', () => {
    const a = arena();
    a.player.invulnTime = 0;
    const i = boss(a, 120, 0);
    const m = a.world.monsters;
    let blows = 0;
    const warned: Record<string, number> = {};
    const seen = new Set<Area>();
    for (let t = 0; t < ticks(90); t++) {
      if (t === ticks(30)) setLife(a, i, 0.6);
      if (t === ticks(60)) setLife(a, i, 0.3);
      const life = a.player.life;
      const px = a.player.x;
      const py = a.player.y;
      const ev: SimEvent[] = step(a);
      cullExcept(a.world, [i]);
      cleanseDebuffs(a.world, a.player, PLAYER_DEBUFFS); // no damage over time: only direct blows count
      for (const ar of a.world.areas) {
        if (seen.has(ar) || (ar.owner !== m.id[i] && ar.follow !== m.id[i])) continue;
        seen.add(ar);
        warned[ar.kind + areaVariant(ar)] = Math.min(warned[ar.kind + areaVariant(ar)] ?? Infinity, ar.duration);
      }
      if (a.player.life >= life) continue;
      blows++;
      const resolved = ev.some((e) => e.t === 'areaResolve' && (touchesDisc(e, px, py) || touchesDisc(e, a.player.x, a.player.y)));
      const lane = areasOf(a.world, 'chargeLine', { owner: m.id[i] }).some((l) => areaVariant(l) === CHARGE_VARIANT && inChargeLine(l, px, py, PLAYER_RADIUS));
      const whirl = areasOf(a.world, 'whirlwind', { variant: 1, owner: m.id[i] }).some((w) => touchesDisc(w, px, py) || touchesDisc(w, a.player.x, a.player.y));
      expect(resolved || lane || whirl, `an untelegraphed blow at t=${a.world.time.toFixed(2)}`).toBe(true);
    }
    expect(blows).toBeGreaterThan(5);
    // How long each telegraph shows before it acts.
    expect(warned.slamWarning0).toBeGreaterThanOrEqual(V.cleaveCast - 1e-9);
    expect(warned.executionMark0).toBeGreaterThanOrEqual(V.markTime - 1e-9);
    expect(warned.arenaSpikes0).toBeGreaterThanOrEqual(SPIKE_WARN - 1e-9);
    expect(warned[`chargeLine${CHARGE_VARIANT}`]).toBeGreaterThanOrEqual(V.chargeCast);
    expect(warned.whirlwind0).toBeGreaterThanOrEqual(V.whirlCast - 1e-9);
  });

  it('his charge knocks back and bleeds whoever its lane catches', () => {
    const a = arena();
    a.player.invulnTime = 0;
    const i = boss(a, 220, 0);
    const m = a.world.monsters;
    const lane = stepUntil(a, 8, () => areasOf(a.world, 'chargeLine', { owner: m.id[i] }).find((l) => areaVariant(l) === CHARGE_VARIANT));
    expect(lane).toBeDefined();
    const x0 = a.player.x;
    const y0 = a.player.y;
    const hit = stepUntil(a, 2, () => (a.player.life < 1e6 ? true : undefined));
    expect(hit).toBe(true);
    expect(pv(a.run).debuffs.map((d) => d.id)).toContain('bleeding');
    for (let t = 0; t < 20; t++) step(a);
    expect(Math.hypot(a.player.x - x0, a.player.y - y0)).toBeGreaterThan(V.chargeKnockback * 0.6);
  });
});

describe('Varkus: a placed-by-hand boss', () => {
  it('works without the director (tests, dev pages): no errors for a minute of play', () => {
    const a = arena();
    const i = placeMonster(a.world, 'varkus', 100, 0, { life: 1e6, still: false });
    for (let t = 0; t < ticks(60); t++) {
      step(a);
      cleanseDebuffs(a.world, a.player, PLAYER_DEBUFFS);
    }
    expect(a.world.monsters.alive[i]).toBe(1);
  });
});

/** Only direct blows count: bleeding (and any burn) is washed off every tick, roots are left alone. */
const DOTS = ['bleeding', 'burning'] as const;

/** His lane (the charge's chargeLine) if one is shown. */
const laneOf = (a: ReturnType<typeof arena>, i: number) =>
  areasOf(a.world, 'chargeLine', { owner: a.world.monsters.id[i] }).find((l) => areaVariant(l) === CHARGE_VARIANT);

describe('Varkus: roots never take a dodge away', () => {
  it('tuning: the walk-out window fits inside every held cast (a hold never rewinds a telegraph past its start)', () => {
    expect(V.walkOut).toBeLessThan(V.chargeCast - 2 * SIM_DT);
    expect(V.walkOut).toBeLessThan(V.cleaveCast - 2 * SIM_DT);
    expect(V.walkOut).toBeLessThan(SPIKE_WARN);
    // Out of a lane from its axis at half speed (tar): half-width 22 + body 7 at 55 u/s.
    expect(V.walkOut).toBeGreaterThanOrEqual((22 + PLAYER_RADIUS) / 55);
  });

  it('a root during his charge cast holds the lane: freed, she still has walkOut to step out of it', () => {
    const a = arena();
    a.player.invulnTime = 0;
    const i = boss(a, 220, 0);
    const m = a.world.monsters;
    const lane = stepUntil(a, 8, () => {
      cullExcept(a.world, [i]);
      return laneOf(a, i);
    });
    expect(lane, 'no charge').toBeDefined();
    // The cast runs until only 0.2 s is left — then tar roots her where she stands, in the lane.
    stepUntil(a, 1, () => (m.stateTime[i] <= 0.2 ? true : undefined));
    expect(m.state[i]).toBe(MSTATE.cast);
    expect(inChargeLine(lane!, a.player.x, a.player.y, PLAYER_RADIUS)).toBe(true);
    expect(applyDebuff(a.world, a.player, 'rooted', 0, 'tar')).toBe(true);
    const life = a.player.life;
    const fill = lane!.age;
    for (let t = 0; t < ticks(3) && isHeld(a.player); t++) {
      step(a, walkDir(0, 1));
      cullExcept(a.world, [i]);
      expect(a.player.life, 'hit while rooted').toBe(life);
      expect(m.state[i], 'he launched while she was held').toBe(MSTATE.cast);
      expect(lane!.dead).toBe(false);
      expect(lane!.age).toBeLessThanOrEqual(fill + 1e-9); // the fill never advances past where it was
    }
    expect(isHeld(a.player)).toBe(false);
    expect(m.stateTime[i]).toBeGreaterThanOrEqual(V.walkOut - 2 * SIM_DT);
    // She steps out sideways and the charge goes past her.
    let launched = false;
    for (let t = 0; t < ticks(2); t++) {
      const ev = step(a, walkDir(0, 1));
      cullExcept(a.world, [i]);
      if (attacksOf(ev, 'varkus', 'charge').length) launched = true;
    }
    expect(launched).toBe(true);
    expect(a.player.life).toBe(life);
  });

  it('a root on a spike tile holds that tile: freed, she has walkOut to step off it', () => {
    const a = arena();
    a.player.invulnTime = 0;
    const i = boss(a, 160, 0);
    setLife(a, i, 0.3);
    let tile: Area | undefined;
    for (let t = 0; t < ticks(60) && !tile; t++) {
      step(a);
      cullExcept(a.world, [i]);
      cleanseDebuffs(a.world, a.player, PLAYER_DEBUFFS);
      a.player.life = a.player.stats.maxLife;
      tile = areasOf(a.world, 'arenaSpikes').find((s) => s.age <= SIM_DT + 1e-9 && touchesDisc(s, a.player.x, a.player.y));
    }
    expect(tile, 'no Crowd\'s Favour tile under her').toBeDefined();
    stepUntil(a, 3, () => {
      cullExcept(a.world, [i]);
      return tile!.duration - tile!.age <= 0.15 ? true : undefined;
    });
    expect(applyDebuff(a.world, a.player, 'rooted', 0, 'tar')).toBe(true);
    const life = a.player.life;
    let spikedHer = 0;
    for (let t = 0; t < ticks(3) && isHeld(a.player); t++) {
      const ev = step(a);
      cullExcept(a.world, [i]);
      spikedHer += ev.filter((e) => e.t === 'areaResolve' && e.kind === 'arenaSpikes' && touchesDisc(e, a.player.x, a.player.y)).length;
      expect(tile!.dead, 'her tile burst while she was rooted').toBe(false);
    }
    expect(spikedHer).toBe(0);
    expect(a.player.life).toBe(life);
    expect(tile!.duration - tile!.age).toBeGreaterThanOrEqual(V.walkOut - 2 * SIM_DT);
    // Every other tile of the pattern has burst by now: she walks off hers, away from him.
    for (let t = 0; t < ticks(1); t++) {
      const ev = step(a, walkDir(-1, 0.2));
      cullExcept(a.world, [i]);
      spikedHer += ev.filter((e) => e.t === 'areaResolve' && e.kind === 'arenaSpikes' && touchesDisc(e, a.player.x, a.player.y)).length;
    }
    expect(tile!.dead).toBe(true);
    expect(spikedHer).toBe(0);
  });

  it('his whirlwind never walks its blades into a held player (he stands and spins until she is free)', () => {
    const a = arena();
    a.player.invulnTime = 0;
    const i = boss(a, 100, 0);
    setLife(a, i, 0.6);
    const m = a.world.monsters;
    const blades = stepUntil(a, 30, () => {
      cullExcept(a.world, [i]);
      cleanseDebuffs(a.world, a.player, PLAYER_DEBUFFS);
      return areasOf(a.world, 'whirlwind', { variant: 1, owner: m.id[i] })[0];
    });
    expect(blades, 'no whirlwind').toBeDefined();
    // Rooted (tar) just outside the blades' reach.
    a.player.x = m.x[i] - (blades!.radius + 30);
    a.player.y = m.y[i];
    expect(applyDebuff(a.world, a.player, 'rooted', 0, 'tar')).toBe(true);
    const life = a.player.life;
    const d0 = Math.hypot(m.x[i] - a.player.x, m.y[i] - a.player.y);
    for (let t = 0; t < ticks(3) && isHeld(a.player) && !blades!.dead; t++) {
      step(a);
      cullExcept(a.world, [i]);
      if (!isHeld(a.player)) break; // freed this tick: he may walk on
      expect(Math.hypot(m.x[i] - a.player.x, m.y[i] - a.player.y)).toBeGreaterThanOrEqual(d0 - 1e-3);
    }
    expect(a.player.life).toBe(life);
  });

  it('over three phases of roots: nothing starts on her while she is held, and no lane, circle or tile lands on her unless she has been free for walkOut', () => {
    for (const seed of [4, 11]) {
      const a = arena({ seed });
      a.player.invulnTime = 0;
      const i = boss(a, 140, 0);
      const m = a.world.monsters;
      const s = () => a.world.boss.state as VarkusState;
      let freeSince = 0;
      let roots = 0;
      let covered = 0;
      let heldLane = 0;
      let heldSpike = 0;
      const seen = new Set<Area>();
      for (let t = 0; t < ticks(120); t++) {
        if (t === ticks(40)) setLife(a, i, 0.6);
        if (t === ticks(80)) setLife(a, i, 0.3);
        // Tar every 2.3 s (the root grace refuses some): at every moment of his casts sooner or later.
        if (t % ticks(2.3) === ticks(1) && applyDebuff(a.world, a.player, 'rooted', 0, 'tar')) roots++;
        const life = a.player.life;
        const px = a.player.x;
        const py = a.player.y;
        const ev = step(a);
        cullExcept(a.world, [i]);
        cleanseDebuffs(a.world, a.player, DOTS);
        // Players act before monsters: held after the step = held when he decided this tick.
        const held = isHeld(a.player);
        if (held) freeSince = a.world.time;
        heldLane = Math.max(heldLane, s().held);
        heldSpike = Math.max(heldSpike, s().spikeHold);
        // What he starts: never a lane, a cleave or a pattern on a held player.
        for (const ar of a.world.areas) {
          if (seen.has(ar) || ar.owner !== m.id[i]) continue;
          seen.add(ar);
          if (ar.kind === 'slamWarning' || ar.kind === 'arenaSpikes' || (ar.kind === 'chargeLine' && areaVariant(ar) === CHARGE_VARIANT)) {
            expect(held, `${ar.kind} started on a held player at t=${a.world.time.toFixed(2)}`).toBe(false);
          }
        }
        if (a.player.life >= life) continue;
        const touches = (kind: string) => ev.some((e) => e.t === 'areaResolve' && e.kind === kind && (touchesDisc(e, px, py) || touchesDisc(e, a.player.x, a.player.y)));
        const whirl = areasOf(a.world, 'whirlwind', { variant: 1, owner: m.id[i] }).some((w) => touchesDisc(w, px, py) || touchesDisc(w, a.player.x, a.player.y));
        if (whirl || touches('executionMark')) continue;
        const lane = m.state[i] === MSTATE.charge;
        if (!(touches('slamWarning') || touches('arenaSpikes') || lane)) continue;
        covered++;
        expect(a.world.time - freeSince, `seed ${seed}: a lane / circle / tile landed ${(a.world.time - freeSince).toFixed(2)} s after a root at t=${a.world.time.toFixed(2)}`)
          .toBeGreaterThanOrEqual(V.walkOut - 2 * SIM_DT);
      }
      expect(roots, `seed ${seed}`).toBeGreaterThan(20);
      expect(covered, `seed ${seed}: he never landed anything`).toBeGreaterThan(5);
      // The holds were exercised.
      expect(heldLane + heldSpike, `seed ${seed}`).toBeGreaterThan(0);
    }
  });
});

describe('Varkus: one big telegraph at a time', () => {
  it("no lane, cleave or mark while his Crowd's Favour tiles are pending, no Crowd's Favour over a pending mark", () => {
    const a = arena({ seed: 7 });
    a.player.invulnTime = 0;
    const i = boss(a, 160, 0);
    setLife(a, i, 0.3);
    const m = a.world.monsters;
    let spikesBefore = false;
    /** Last time his tiles were pending (end of tick). */
    let spikesSince = -Infinity;
    let markBefore = false;
    const counts = { lanes: 0, cleaves: 0, marks: 0, patterns: 0 };
    const seen = new Set<Area>();
    for (let t = 0; t < ticks(120); t++) {
      // She wanders (a slow circle), so he has to chase, charge and cleave.
      const ang = t * SIM_DT * 0.5;
      step(a, t % ticks(6) < ticks(3) ? walkDir(Math.cos(ang), Math.sin(ang)) : idleIntent());
      cullExcept(a.world, [i]);
      cleanseDebuffs(a.world, a.player, PLAYER_DEBUFFS);
      a.player.life = a.player.stats.maxLife;
      let newPattern = false;
      for (const ar of a.world.areas) {
        if (seen.has(ar) || ar.owner !== m.id[i]) continue;
        seen.add(ar);
        if (ar.kind === 'chargeLine' && areaVariant(ar) === CHARGE_VARIANT) {
          counts.lanes++;
          expect(spikesBefore, `a lane across pending spikes at t=${a.world.time.toFixed(2)}`).toBe(false);
        }
        if (ar.kind === 'slamWarning') {
          counts.cleaves++;
          expect(spikesBefore, `a cleave over pending spikes at t=${a.world.time.toFixed(2)}`).toBe(false);
        }
        if (ar.kind === 'executionMark') {
          counts.marks++;
          // The mark appears markCast after its cast started: no tiles may have been pending then either.
          expect(spikesSince > a.world.time - V.markCast - SIM_DT, `a mark cast over pending spikes at t=${a.world.time.toFixed(2)}`).toBe(false);
        }
        if (ar.kind === 'arenaSpikes') newPattern = true;
      }
      if (newPattern) {
        counts.patterns++;
        expect(markBefore, `Crowd's Favour over a pending mark at t=${a.world.time.toFixed(2)}`).toBe(false);
      }
      spikesBefore = areasOf(a.world, 'arenaSpikes', { owner: m.id[i] }).length > 0;
      if (spikesBefore) spikesSince = a.world.time;
      markBefore = areasOf(a.world, 'executionMark', { owner: m.id[i] }).length > 0;
    }
    expect(counts.patterns).toBeGreaterThan(5);
    expect(counts.lanes + counts.cleaves).toBeGreaterThan(5);
    expect(counts.marks).toBeGreaterThan(3);
  });
});

describe("Varkus: Crowd's Favour with two players", () => {
  /** The first Crowd's Favour cast (phase 3) with a second player at (x2, 0). */
  function twoPlayers(x2: number) {
    const a = arena();
    const p2 = joinArena(a, 2, x2, 0, toughStats());
    a.player.invulnTime = 0;
    p2.invulnTime = 0;
    const i = boss(a, x2 / 2, 220);
    setLife(a, i, 0.3);
    const intents = new Map([[1, idleIntent()], [2, idleIntent()]]);
    for (let t = 0; t < ticks(30); t++) {
      const ev = step(a, intents);
      cullExcept(a.world, [i]);
      for (const p of [a.player, p2]) cleanseDebuffs(a.world, p, PLAYER_DEBUFFS);
      if (!attacksOf(ev, 'varkus', 'spikes').length) continue;
      return { a, p2, tiles: areasOf(a.world, 'arenaSpikes').filter((s) => s.age <= SIM_DT + 1e-9) };
    }
    throw new Error("no Crowd's Favour");
  }

  /** Directions (of 16) she can walk straight out along without meeting any tile as it bursts. */
  function clearWays(tiles: Area[], x: number, y: number, speed: number): number[] {
    const out: number[] = [];
    for (let k = 0; k < 16; k++) {
      const ang = (k / 16) * Math.PI * 2;
      const blocked = tiles.some((tile) => touchesDisc(tile, x + Math.cos(ang) * speed * tile.duration, y + Math.sin(ang) * speed * tile.duration));
      if (!blocked) out.push(ang);
    }
    return out;
  }

  it('players standing close together share one pattern', () => {
    const { tiles, a, p2 } = twoPlayers(90);
    expect(tiles.length).toBeGreaterThan(10);
    expect(tiles.length).toBeLessThanOrEqual(25); // one pattern (the checkerboard is the largest: 5 × 5)
    for (const p of [a.player, p2]) expect(clearWays(tiles, p.x, p.y, p.stats.moveSpeed).length).toBeGreaterThan(0);
  });

  it('players farther apart get one each, and each keeps a clear way out — directly away from the other among them', () => {
    const { tiles, a, p2 } = twoPlayers(240);
    expect(tiles.length).toBeGreaterThan(25);
    for (const [p, q] of [[a.player, p2], [p2, a.player]] as const) {
      const ways = clearWays(tiles, p.x, p.y, p.stats.moveSpeed);
      expect(ways.length, `player ${p.id}`).toBeGreaterThan(0);
      const away = Math.atan2(p.y - q.y, p.x - q.x);
      const d = away < 0 ? away + Math.PI * 2 : away;
      expect(ways.some((w) => Math.abs(Math.atan2(Math.sin(w - d), Math.cos(w - d))) < Math.PI / 8 + 1e-9), `player ${p.id}: no way out away from the other`).toBe(true);
    }
  });
});

describe('Varkus: locked casts', () => {
  it('faces down his charge lane for the whole cast, even when his target circles behind him', () => {
    const a = arena();
    a.player.invulnTime = 0;
    const i = boss(a, 220, 0);
    const m = a.world.monsters;
    const lane = stepUntil(a, 8, () => {
      cullExcept(a.world, [i]);
      return laneOf(a, i);
    });
    expect(lane).toBeDefined();
    const face = Math.cos(areaAngle(lane!)) >= 0 ? 1 : -1;
    // She slips round behind him.
    a.player.x = m.x[i] + 60 * face * -1;
    a.player.y = m.y[i] + 70;
    let casting = 0;
    for (let t = 0; t < ticks(1) && m.state[i] === MSTATE.cast; t++) {
      step(a);
      cullExcept(a.world, [i]);
      if (m.state[i] !== MSTATE.cast) break;
      casting++;
      expect(m.facing[i]).toBe(face);
    }
    expect(casting).toBeGreaterThan(10);
  });
});
