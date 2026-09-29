// Telegraph fairness for the Rimed Ossuary (GAME_SPEC §13: "a debuff never comes from an invisible source.
// Every root and freeze comes from a projectile you can see or a telegraph you can read"). The fairness
// monitor (./helpers.ts) checks every freeze and root a player suffers against what was on screen.
import { describe, expect, it } from 'vitest';
import { WISP_FREEZE_FRACTION } from '../../src/sim/area-geometry';
import { PLAYER_RADIUS } from '../../src/sim/constants';
import { monsterDef } from '../../src/sim/rosters';
import { CHORISTER, WARDEN, WEAVER, WISP } from '../../src/sim/rosters/ossuary/tuning';
import { idleIntent } from '../sim/fixtures';
import { makeArena, placeMonster, stepWith } from '../sim/helpers';
import { SLOPPY, TIER1_OSSUARY, TIER5, createFairnessMonitor, fairPlayer, newishPlayer, playOssuary, ticks, tough } from './helpers';

describe('fair by construction', () => {
  it('the only freezes are telegraphed and the only root is a slow, visible web', () => {
    // A wisp stops to pulse with its player inside the freezing core: standing still is what freezes.
    expect(monsterDef('glacialWisp').radius + PLAYER_RADIUS + WISP.trigger).toBeLessThanOrEqual(WISP.radius * WISP_FREEZE_FRACTION);
    // …and the pulse lasts long enough to step out of it (≈ 77 units of walking).
    expect(WISP.pulse).toBeGreaterThanOrEqual(0.7);
    // The prison takes 2 s to close: a walking player is out of its shrinking ring in under half a second.
    expect(WARDEN.prison.close).toBeGreaterThanOrEqual(1.5);
    // The web crawls (a Cinder Spitter lob is 150 units/s): 1.7 s to cross 200 units.
    expect(WEAVER.speed).toBeLessThanOrEqual(130);
    // Choir rings expand a little slower than a player walks (≈ 105 vs 110 units/s): walking out ahead of
    // a ring while working round to a gap always works. A player who is already Chilled walks 77 and can
    // be caught short of a gap — the rings only chill and nip (never root or freeze), so that costs her a
    // refreshed chill, not control.
    expect((CHORISTER.ringEnd - CHORISTER.ringStart) / CHORISTER.ringTime).toBeLessThan(110);
  });
});

describe('the fairness monitor', () => {
  it('sees every freeze and root in a gauntlet where the player never dodges, and all of them had a visible source', () => {
    const a = makeArena({ stats: tough(), seed: 5 });
    placeMonster(a.world, 'frostWeaver', 200, 0, { life: 1e9, still: false });
    placeMonster(a.world, 'frostWeaver', -180, 90, { life: 1e9, still: false });
    const w = placeMonster(a.world, 'hollowWarden', 0, 160, { life: 1e9, still: false });
    a.world.monsters.life[w] = a.world.monsters.maxLife[w] * 0.6; // phase 2: Ice Prisons
    const monitor = createFairnessMonitor();
    const kinds = new Set<string>();
    for (let t = 0; t < ticks(45); t++) {
      // A fresh wisp every 3 s, from all sides.
      if (t % ticks(3) === 0) {
        const ang = t * 0.37;
        placeMonster(a.world, 'glacialWisp', Math.cos(ang) * 150, Math.sin(ang) * 150, { life: 1e9, still: false });
      }
      monitor.before(a.run.view);
      stepWith(a.run, idleIntent());
      const ev = a.run.drainEvents();
      a.run.drainOutcomes();
      monitor.after(a.run.view, ev);
      for (const e of ev) if (e.t === 'debuff') kinds.add(e.debuff);
    }
    expect(monitor.unfair).toEqual([]);
    expect(kinds.has('frozen')).toBe(true);
    expect(kinds.has('rooted')).toBe(true);
    expect(monitor.checked).toBeGreaterThanOrEqual(8);
  });

  it('flags a freeze that comes out of nowhere (the monitor itself works)', () => {
    const a = makeArena({ stats: tough() });
    const monitor = createFairnessMonitor();
    stepWith(a.run, idleIntent());
    a.run.drainEvents();
    monitor.before(a.run.view);
    a.world.events.push({ t: 'debuff', playerId: 1, debuff: 'frozen', stacks: 1, x: 0, y: 0 });
    a.world.events.push({ t: 'debuff', playerId: 1, debuff: 'rooted', stacks: 1, x: 0, y: 0 });
    stepWith(a.run, idleIntent());
    monitor.after(a.run.view, a.run.drainEvents());
    expect(monitor.unfair).toHaveLength(2);
  });
});

// Whole maps with a careless player (SLOPPY: she stops walking for 1.2 s every 3 s), so webs, wisp
// bursts and prisons really land and the monitor has something to check. (The dodging bot of the map
// tests is rarely rooted and almost never frozen.)
describe('whole Ossuary maps, played carelessly', () => {
  it('Tier 5: every root and freeze the careless fair character suffers had a visible source', () => {
    // Two seeded maps cover both debuffs even when one route avoids every freezing core.
    const runs = [6, 7].map((seed) => playOssuary(seed, fairPlayer(), { ...TIER5 }, { sloppy: SLOPPY }));
    for (const r of runs) expect(r.unfair).toEqual([]);
    expect(runs.reduce((n, r) => n + r.roots, 0), 'no root to check').toBeGreaterThan(0);
    expect(runs.reduce((n, r) => n + r.freezes, 0), 'no freeze to check').toBeGreaterThan(0);
    // She got as far as the Warden (her Ice Prisons were in play).
    for (const r of runs) expect(r.boss).not.toBe('');
  }, 60_000);

  it('Tier 1: the same for a careless new-ish character', () => {
    // Two maps: a Tier 1 Warden falls fast, so one map may end before any of her Ice Prisons closes.
    const runs = [3, 4].map((seed) => playOssuary(seed, newishPlayer(), { ...TIER1_OSSUARY }, { sloppy: SLOPPY }));
    for (const r of runs) expect(r.unfair).toEqual([]);
    expect(runs.reduce((n, r) => n + r.roots, 0), 'no root to check').toBeGreaterThan(0);
    expect(runs.reduce((n, r) => n + r.freezes, 0), 'no freeze to check').toBeGreaterThan(0);
  }, 90_000);
});
