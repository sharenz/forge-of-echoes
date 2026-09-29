// The Rimed Ossuary family (GAME_SPEC §13–§14): what each monster does to a player, and that every debuff
// comes from something the player can see (a root from a web in flight, a freeze from a telegraph shown
// to its end).
import { describe, expect, it } from 'vitest';
import { PROJECTILE_KINDS, type SimEvent } from '../../src/contracts/sim';
import { WISP_FREEZE_FRACTION } from '../../src/sim/area-geometry';
import { damageMonster } from '../../src/sim/combat';
import { PLAYER_RADIUS } from '../../src/sim/constants';
import { DAMAGE_INDEX } from '../../src/sim/math';
import { MSTATE } from '../../src/sim/stores';
import { interceptTime } from '../../src/sim/rosters/ossuary/brains';
import { GOLEM, SHADE, WEAVER, WISP } from '../../src/sim/rosters/ossuary/tuning';
import { idleIntent } from '../sim/fixtures';
import { makeArena, placeMonster, pv, walkIntent } from '../sim/helpers';
import { areasOf, attacks, debuffEvents, stepFor, stepUntil, ticks, tough } from './helpers';

const WEB = PROJECTILE_KINDS.indexOf('webShot');

describe('Bone Thrall', () => {
  it('walks up, winds up and lunge-bites: physical damage, no debuff', () => {
    const a = makeArena({ stats: tough() });
    const i = placeMonster(a.world, 'boneThrall', 80, 0, { life: 1e6, still: false });
    const m = a.world.monsters;
    let windupTicks = 0;
    const bite = stepUntil(a, 6, (ev) => {
      if (m.state[i] === MSTATE.windup) windupTicks++;
      return ev.find((e) => e.t === 'hit' && e.target === 'player');
    });
    expect(bite, 'the thrall never bit').toBeDefined();
    expect(bite && bite.t === 'hit' && bite.damageType).toBe('physical');
    // The bite comes out of a visible windup (≈ 0.26 s).
    expect(windupTicks).toBeGreaterThanOrEqual(ticks(0.2));
    const later = stepFor(a, 3);
    expect(later.events.filter((e) => e.t === 'debuff')).toEqual([]);
  });

  it('leaves its bones: a dead thrall is a corpse the Chorister can raise', () => {
    const a = makeArena({ stats: tough() });
    const i = placeMonster(a.world, 'boneThrall', 150, 40, { life: 5 });
    stepFor(a, 0.1);
    damageMonster(a.world, i, 100, DAMAGE_INDEX.fire, 0, 1.5, 0, 0, 0, 0, true, 1);
    expect(a.world.corpses.some((c) => c.kind === 'boneThrall' && Math.hypot(c.x - 150, c.y - 40) < 1 && !c.used)).toBe(true);
  });
});

describe('Rimeshade', () => {
  it('drifts straight through a wall of monsters to reach its player', () => {
    const a = makeArena({ stats: tough() });
    // A packed wall of heavy golems between the shade and the player.
    for (let y = -90; y <= 90; y += 18) placeMonster(a.world, 'ossuaryGolem', 90, y, { life: 1e6 });
    const s = placeMonster(a.world, 'rimeshade', 200, 0, { life: 1e6, still: false });
    const m = a.world.monsters;
    const reached = stepUntil(a, 8, () => (Math.hypot(m.x[s], m.y[s]) < m.radius[s] + PLAYER_RADIUS + SHADE.reach + 1 ? true : undefined));
    expect(reached, `the shade stalled at (${m.x[s].toFixed(0)}, ${m.y[s].toFixed(0)})`).toBe(true);
    // A thrall behind the same wall can't follow it through.
    const b = makeArena({ stats: tough() });
    for (let y = -90; y <= 90; y += 18) placeMonster(b.world, 'ossuaryGolem', 90, y, { life: 1e6 });
    const t = placeMonster(b.world, 'boneThrall', 200, 0, { life: 1e6, still: false });
    stepFor(b, 3);
    expect(b.world.monsters.x[t]).toBeGreaterThan(90);
  });

  it('touches after a visible reach: a cold hit that chills (never a root or a freeze)', () => {
    const a = makeArena({ stats: tough() });
    const s = placeMonster(a.world, 'rimeshade', 60, 0, { life: 1e6, still: false });
    const m = a.world.monsters;
    let windup = 0;
    const log: SimEvent[] = [];
    const chill = stepUntil(a, 6, (ev) => {
      if (m.state[s] === MSTATE.windup) windup++;
      return debuffEvents(ev, 'chilled')[0];
    }, idleIntent(), log);
    expect(chill, 'the touch never chilled').toBeDefined();
    expect(windup).toBeGreaterThanOrEqual(ticks(SHADE.windup) - 1);
    expect(attacks(log, 'rimeshade', 'melee').length).toBeGreaterThan(0);
    expect(log.some((e) => e.t === 'hit' && e.target === 'player' && e.damageType === 'cold')).toBe(true);
    expect(pv(a.run).debuffs.map((d) => d.id)).toEqual(['chilled']);
    const more = stepFor(a, 6);
    expect(more.events.some((e) => e.t === 'debuff' && (e.debuff === 'rooted' || e.debuff === 'frozen'))).toBe(false);
  });

  it('wails on every touch, landed or not — one cue per touch', () => {
    // Landed: exactly one 'melee' on the tick the chill lands.
    const a = makeArena({ stats: tough() });
    placeMonster(a.world, 'rimeshade', 60, 0, { life: 1e6, still: false });
    let landed: SimEvent[] = [];
    stepUntil(a, 6, (ev) => {
      if (debuffEvents(ev, 'chilled').length === 0) return undefined;
      landed = ev;
      return true;
    });
    expect(attacks(landed, 'rimeshade', 'melee')).toHaveLength(1);
    // Missed: the player is out of its grasp when the reach ends — still one 'melee', no hit, no chill.
    const b = makeArena({ stats: tough() });
    const s = placeMonster(b.world, 'rimeshade', 60, 0, { life: 1e6, still: false });
    const m = b.world.monsters;
    expect(stepUntil(b, 6, () => (m.state[s] === MSTATE.windup ? true : undefined))).toBe(true);
    b.player.x = m.x[s] - 120;
    const r = stepFor(b, SHADE.windup + 0.1);
    expect(attacks(r.events, 'rimeshade', 'melee')).toHaveLength(1);
    expect(r.events.some((e) => e.t === 'hit' && e.target === 'player')).toBe(false);
    expect(r.events.filter((e) => e.t === 'debuff')).toEqual([]);
  });

  it('fades back after a touch instead of sitting on its victim', () => {
    const a = makeArena({ stats: tough() });
    const s = placeMonster(a.world, 'rimeshade', 60, 0, { life: 1e6, still: false });
    const m = a.world.monsters;
    stepUntil(a, 6, (ev) => debuffEvents(ev, 'chilled')[0]);
    const d0 = Math.hypot(m.x[s], m.y[s]);
    stepFor(a, SHADE.recoil * 0.8);
    expect(Math.hypot(m.x[s], m.y[s])).toBeGreaterThan(d0 + 10);
  });
});

describe('Frost Weaver', () => {
  it('keeps its distance: backs off when crowded, closes in from afar', () => {
    const near = makeArena({ stats: tough() });
    const i = placeMonster(near.world, 'frostWeaver', 70, 0, { life: 1e6, still: false });
    near.world.monsters.attackCd[i] = 1e9; // just the footwork
    stepFor(near, 2);
    expect(Math.hypot(near.world.monsters.x[i], near.world.monsters.y[i])).toBeGreaterThan(130);
    const far = makeArena({ stats: tough() });
    const j = placeMonster(far.world, 'frostWeaver', 420, 0, { life: 1e6, still: false });
    far.world.monsters.attackCd[j] = 1e9;
    stepFor(far, 7);
    expect(Math.hypot(far.world.monsters.x[j], far.world.monsters.y[j])).toBeLessThanOrEqual(WEAVER.far + 10);
  });

  it('spits a slow, visible web that roots (source web) on hit', () => {
    const a = makeArena({ stats: tough() });
    placeMonster(a.world, 'frostWeaver', 200, 0, { life: 1e6, still: false });
    const pr = a.world.projectiles;
    let firstSeen = -1;
    let speed = 0;
    const log: SimEvent[] = [];
    const root = stepUntil(a, 8, (ev) => {
      for (let k = 0; k < pr.hwm; k++) {
        if (!pr.alive[k] || pr.kind[k] !== WEB) continue;
        if (firstSeen < 0) firstSeen = a.world.time;
        speed = Math.hypot(pr.vx[k], pr.vy[k]);
      }
      return debuffEvents(ev, 'rooted')[0];
    }, idleIntent(), log);
    expect(root, 'never rooted').toBeDefined();
    expect(attacks(log, 'frostWeaver', 'web').length).toBeGreaterThan(0);
    expect(speed).toBeCloseTo(WEAVER.speed, 3);
    // The web was in the air (on screen) for most of a second before it landed.
    expect(a.world.time - firstSeen).toBeGreaterThan(0.8);
    const rooted = pv(a.run).debuffs.find((d) => d.id === 'rooted');
    expect(rooted?.source).toBe('web');
  });

  it('aims where a steady walker meets the web: keep walking and it catches you, turn and it misses', () => {
    // She walks past it at an angle (toward it and across); the weaver holds its ground and spits once.
    const heading = (50 * Math.PI) / 180;
    const run = (turnWhenSpat: boolean) => {
      const a = makeArena({ stats: tough() });
      const i = placeMonster(a.world, 'frostWeaver', 220, 0, { life: 1e6, still: false });
      const m = a.world.monsters;
      m.speed[i] = 0;
      m.attackCd[i] = 0.4;
      let dir = 1;
      const log: SimEvent[] = [];
      const walk = () => walkIntent(a.player.x, a.player.y, a.player.x + Math.cos(heading) * 500 * dir, a.player.y + Math.sin(heading) * 500 * dir);
      for (let k = 0; k < ticks(4.5); k++) {
        const r = stepFor(a, 1 / 60, walk);
        log.push(...r.events);
        if (turnWhenSpat && attacks(r.events, 'frostWeaver', 'web').length > 0) dir = -1;
        if (attacks(log, 'frostWeaver', 'web').length > 0) m.attackCd[i] = 1e9; // one web only
      }
      return { log, rooted: debuffEvents(log, 'rooted'), view: pv(a.run) };
    };
    const steady = run(false);
    expect(attacks(steady.log, 'frostWeaver', 'web')).toHaveLength(1);
    expect(steady.rooted, 'a steady walker should be caught').toHaveLength(1);
    const turned = run(true);
    expect(attacks(turned.log, 'frostWeaver', 'web')).toHaveLength(1);
    expect(turned.rooted, 'turning back should dodge it').toEqual([]);
    expect(turned.log.some((e) => e.t === 'projectileEnd' && e.kind === 'webShot')).toBe(true);
  });

  it('solves the intercept: head-on, standing, and a crossing it cannot catch within range', () => {
    const max = (WEAVER.range - 10) / WEAVER.speed;
    // Standing still: the flight time over the gap beyond the muzzle.
    expect(interceptTime(200, 0, 0, 0, WEAVER.speed, 10, max)).toBeCloseTo(190 / WEAVER.speed, 6);
    // Walking straight at it at 110: they close at 230 units/s.
    expect(interceptTime(200, 0, -110, 0, WEAVER.speed, 10, max)).toBeCloseTo(190 / 230, 6);
    // Squarely across at 110 from 200 away: the meeting (≈ 4.2 s, 500 units) lies far beyond the web's range.
    expect(interceptTime(200, 0, 0, 110, WEAVER.speed, 10, max)).toBe(-1);
    // Walking away at 110: the web gains 10 units/s — out of range too.
    expect(interceptTime(200, 0, 110, 0, WEAVER.speed, 10, max)).toBe(-1);
    // Any meeting it returns is a real one: the web and the walker arrive at the same point.
    const [dx, dy, vx, vy] = [150, -60, -40, 90];
    const t = interceptTime(dx, dy, vx, vy, WEAVER.speed, 10, max);
    expect(t).toBeGreaterThan(0);
    expect(Math.hypot(dx + vx * t, dy + vy * t)).toBeCloseTo(10 + WEAVER.speed * t, 6);
  });

  it('can be dodged: a player who steps aside when it spits is never caught', () => {
    const a = makeArena({ stats: tough() });
    placeMonster(a.world, 'frostWeaver', 200, 0, { life: 1e6, still: false });
    // Stand still until the web leaves, then walk across its path.
    const spat = stepUntil(a, 8, (ev) => attacks(ev, 'frostWeaver', 'web')[0]);
    expect(spat).toBeDefined();
    const r = stepFor(a, 3, () => walkIntent(a.player.x, a.player.y, a.player.x, a.player.y + 500));
    expect(debuffEvents(r.events, 'rooted')).toEqual([]);
    expect(r.events.some((e) => e.t === 'projectileEnd' && e.kind === 'webShot')).toBe(true);
  });
});

describe('Glacial Wisp', () => {
  /** Run a wisp at a player until its pulse starts; returns the telegraph and the arena. */
  function pulseStart() {
    const a = makeArena({ stats: tough() });
    const i = placeMonster(a.world, 'glacialWisp', 160, 0, { life: 1e6, still: false });
    const m = a.world.monsters;
    const id = m.id[i];
    const log: SimEvent[] = [];
    const ring = stepUntil(a, 6, () => areasOf(a.world, 'wispBurst', id)[0], idleIntent(), log);
    a.player.invulnTime = 0;
    return { a, i, id, ring, log };
  }

  it('rushes in, stops and pulses a 0.7 s ring, then shatters in the burst', () => {
    const { a, i, id, ring, log } = pulseStart();
    expect(ring, 'the wisp never pulsed').toBeDefined();
    expect(attacks(log, 'glacialWisp', 'pulse')).toHaveLength(1);
    expect(ring!.duration).toBeCloseTo(WISP.pulse, 6);
    expect(ring!.radius).toBe(WISP.radius);
    const m = a.world.monsters;
    const x0 = m.x[i];
    // Nothing lands before the ring resolves.
    const during = stepFor(a, WISP.pulse - 0.1);
    expect(during.events.filter((e) => e.t === 'debuff')).toEqual([]);
    expect(Math.abs(m.x[i] - x0)).toBeLessThan(1); // it holds still while pulsing
    const burst = stepFor(a, 0.3);
    expect(attacks(burst.events, 'glacialWisp', 'burst')).toHaveLength(1);
    expect(burst.events.some((e) => e.t === 'areaResolve' && e.kind === 'wispBurst')).toBe(true);
    // Shattered: dead, and it still counts as a kill (loot and motes), credited to nobody.
    expect(a.world.monsters.slotOf(id)).toBe(-1);
    expect(burst.events.some((e) => e.t === 'death' && e.kind === 'glacialWisp')).toBe(true);
    expect(burst.outcomes).toContainEqual(expect.objectContaining({ t: 'kill', kind: 'glacialWisp', playerId: 0 }));
    // She stood still at point blank: frozen.
    expect(debuffEvents(burst.events, 'frozen')).toHaveLength(1);
  });

  it('freezes only at point blank, chills the rest of the ring, and misses anyone outside', () => {
    const cases: [number, string | null][] = [
      [WISP.radius * WISP_FREEZE_FRACTION - 2, 'frozen'],
      [WISP.radius * 0.75, 'chilled'],
      [WISP.radius + PLAYER_RADIUS + 4, null],
    ];
    for (const [dist, want] of cases) {
      const { a, ring } = pulseStart();
      expect(ring).toBeDefined();
      a.player.x = ring!.x - dist;
      a.player.y = ring!.y;
      const r = stepFor(a, 1);
      const got = r.events.filter((e) => e.t === 'debuff').map((e) => (e.t === 'debuff' ? e.debuff : ''));
      expect(got, `at ${dist.toFixed(1)} units`).toEqual(want ? [want] : []);
    }
  });

  it('killed during its pulse, it takes the burst with it', () => {
    const { a, i, ring } = pulseStart();
    expect(ring).toBeDefined();
    damageMonster(a.world, i, 1e7, DAMAGE_INDEX.fire, 0, 1.5, 0, 0, 0, 0, true, 1);
    const r = stepFor(a, 1.2);
    expect(r.events.some((e) => e.t === 'areaResolve' && e.kind === 'wispBurst')).toBe(false);
    expect(r.events.filter((e) => e.t === 'debuff')).toEqual([]);
  });

  it('a player who walks away when the ring appears escapes the freeze', () => {
    const { a, ring } = pulseStart();
    expect(ring).toBeDefined();
    const away = () => walkIntent(a.player.x, a.player.y, a.player.x - 500, a.player.y);
    const r = stepFor(a, 1, away);
    expect(debuffEvents(r.events, 'frozen')).toEqual([]);
  });
});

describe('Ossuary Golem', () => {
  it('telegraphs a frost slam for a second, then chills whoever stays in it', () => {
    const a = makeArena({ stats: tough() });
    const g = placeMonster(a.world, 'ossuaryGolem', 45, 0, { life: 1e6, still: false });
    const id = a.world.monsters.id[g];
    const slam = stepUntil(a, 6, () => areasOf(a.world, 'frostNovaWarning', id)[0]);
    expect(slam, 'the golem never slammed').toBeDefined();
    a.player.invulnTime = 0;
    expect(slam!.duration).toBeCloseTo(GOLEM.windup, 6);
    expect(slam!.radius).toBe(GOLEM.radius);
    const quiet = stepFor(a, GOLEM.windup - 0.1);
    expect(quiet.events.filter((e) => e.t === 'debuff' || (e.t === 'hit' && e.target === 'player'))).toEqual([]);
    const land = stepFor(a, 0.2);
    expect(attacks(land.events, 'ossuaryGolem', 'slam')).toHaveLength(1);
    expect(land.events.some((e) => e.t === 'hit' && e.target === 'player' && e.damageType === 'cold')).toBe(true);
    expect(debuffEvents(land.events, 'chilled')).toHaveLength(1);
  });

  it('misses a player who walks out of the circle', () => {
    const a = makeArena({ stats: tough() });
    const g = placeMonster(a.world, 'ossuaryGolem', 45, 0, { life: 1e6, still: false });
    const id = a.world.monsters.id[g];
    expect(stepUntil(a, 6, () => areasOf(a.world, 'frostNovaWarning', id)[0])).toBeDefined();
    const r = stepFor(a, GOLEM.windup + 0.2, () => walkIntent(a.player.x, a.player.y, a.player.x - 500, a.player.y));
    expect(r.events.filter((e) => e.t === 'debuff')).toEqual([]);
  });

  it('is armoured: its hits are reduced like a brute\'s, burning is not', () => {
    const a = makeArena({ stats: tough() });
    const g = placeMonster(a.world, 'ossuaryGolem', 200, 0, { life: 1e6 });
    const m = a.world.monsters;
    stepFor(a, 0.1);
    const before = m.life[g];
    for (let k = 0; k < 50; k++) damageMonster(a.world, g, 100, DAMAGE_INDEX.lightning, 0, 1.5, 0, 0, 0, 0, true, 1);
    const perHit = (before - m.life[g]) / 50;
    expect(perHit).toBeGreaterThan(55);
    expect(perHit).toBeLessThan(75); // 100 × (1 − 0.35), rolls averaging out
    // Burning (hit = false: ignite, trails, ward embers) goes through the armour untouched.
    const mid = m.life[g];
    for (let k = 0; k < 50; k++) damageMonster(a.world, g, 100, DAMAGE_INDEX.lightning, 0, 1.5, 0, 0, 0, 0, false, 1);
    const perBurn = (mid - m.life[g]) / 50;
    expect(perBurn).toBeGreaterThan(90);
    expect(perBurn).toBeLessThan(110); // 100, rolls averaging out
  });
});
