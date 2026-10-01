// Ground items (GAME_SPEC §12): currency / flasks / maps are walked over, equipment is clicked, and
// items a player puts on the floor are public — anyone may click them, nobody collects them by
// walking over them, and they outlive the player who dropped them.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PICKUP_REACH, SIM_DT, type DropSpec, type DropView, type PlayerIntent, type SimRun } from '../../src/contracts/sim';
import { drainHookErrors } from '../../src/sim';
import { damageMonster, damagePlayer } from '../../src/sim/combat';
import { DROP_EDGE_MARGIN, DROP_PROP_RADIUS, FLOOR_TOSS_ANGLE_MAX, FLOOR_TOSS_ANGLE_MIN } from '../../src/sim/constants';
import { DAMAGE_INDEX } from '../../src/sim/math';
import { PICKUP_APPROACH } from '../../src/sim/movement';
import { createRunInternal } from '../../src/sim/run';
import type { World } from '../../src/sim/world';
import { createBot } from './bot';
import {
  STRONG_LOADOUT, TIER5, floorSpec, idleIntent, makeConfig, makeHooks, makeJoin, makeSolo, makeStats, rulesAutoPickup, strongSkills,
  strongStats,
} from './fixtures';
import { joinArena, makeArena, ofType, outcomesOf, placeMonster, pv, stepN, walkIntent, type Arena } from './helpers';

const sturdy = (pickupRadius = 90) => makeStats({ maxLife: 1e9, evasion: 0, pickupRadius });

function teleport(world: World, id: number, x: number, y: number): void {
  const p = world.playerById[id]!;
  p.x = p.prevX = x;
  p.y = p.prevY = y;
}

/** The drop with this id in the view (undefined once gone). */
function dropById(run: SimRun, id: number): DropView | undefined {
  return run.view.drops.find((d) => d.id === id);
}

/** Step until the drop has landed (and a little longer), returning everything emitted. */
function settle(run: SimRun, ticks = 90) {
  return stepN(run, ticks);
}

/** Kill a monster at (x, y) whose loot is exactly `specs` (credited to player `by`). */
function killWithLoot(world: World, x: number, y: number, specs: DropSpec[], by = 1): void {
  world.config.hooks.rollKillLoot = () => specs;
  const i = placeMonster(world, 'ashling', x, y, { life: 1 });
  damageMonster(world, i, 1e6, DAMAGE_INDEX.fire, 0, 1.5, 0, 1, 0, 1, true, by);
}

const currency = (token: number, owner: number): DropSpec => ({
  token, owner, autoPickup: true, label: 'Forge Scrap', tone: 'currency', sprite: 'currency', iconId: 'icon/currency/scrap',
});
const wand = (token: number, owner: number): DropSpec => ({
  token, owner, autoPickup: false, label: 'Rare Wand', tone: 'rare', sprite: 'equipment', iconId: 'icon/base/ashwoodWand',
});

function arena(o: Parameters<typeof makeArena>[0] = {}): Arena {
  return makeArena({ stats: sturdy(), ...o });
}

describe('walk-over vs click pickup', () => {
  it('only autoPickup drops are magnetised and collected; equipment lies still until clicked', () => {
    const a = arena();
    killWithLoot(a.world, 40, 0, [currency(1, 1), wand(2, 1)]);
    const spawned = ofType(a.run.drainEvents(), 'dropSpawn');
    expect(spawned.map((e) => e.owner)).toEqual([1, 1]);
    const r = settle(a.run, 180);
    // The currency flew in and was collected; the 'pickup' cue names owner and picker.
    expect(outcomesOf(r.outcomes, 'pickup')).toEqual([{ t: 'pickup', playerId: 1, token: 1 }]);
    expect(ofType(r.events, 'pickup')).toEqual([expect.objectContaining({ owner: 1, playerId: 1, tone: 'currency', label: 'Forge Scrap' })]);
    expect(a.log.pickups).toEqual([1]);
    // The wand stayed where it landed, though well inside the pickup radius.
    expect(a.run.view.drops).toHaveLength(1);
    const d = a.run.view.drops[0];
    expect(d.spec.token).toBe(2);
    expect(d.z).toBe(0);
    const landed = { x: d.x, y: d.y };
    expect(Math.hypot(d.x - pv(a.run).x, d.y - pv(a.run).y)).toBeLessThan(90);
    // Standing right on it (and walking off and on again) does nothing.
    const walk = stepN(a.run, 120, () => walkIntent(pv(a.run).x, pv(a.run).y, landed.x, landed.y));
    stepN(a.run, 40, () => walkIntent(pv(a.run).x, pv(a.run).y, landed.x + 60, landed.y));
    const back = stepN(a.run, 60, () => walkIntent(pv(a.run).x, pv(a.run).y, landed.x, landed.y));
    expect(outcomesOf([...walk.outcomes, ...back.outcomes], 'pickup')).toHaveLength(0);
    expect(a.log.pickups).toEqual([1]);
    expect(a.run.view.drops.map((x) => [x.x, x.y])).toEqual([[landed.x, landed.y]]);
    // A click collects it.
    expect(a.run.requestPickup(1, d.id)).toBe('ok');
    expect(a.run.view.drops).toHaveLength(0);
    expect(a.run.drainOutcomes()).toEqual([{ t: 'pickup', playerId: 1, token: 2 }]);
    expect(ofType(a.run.drainEvents(), 'pickup')).toEqual([
      { t: 'pickup', owner: 1, playerId: 1, tone: 'rare', x: landed.x, y: landed.y, label: 'Rare Wand' },
    ]);
    expect(a.log.pickupsBy).toEqual([{ playerId: 1, token: 1 }, { playerId: 1, token: 2 }]);
  });

  it('a click works on walk-over loot too, even while it is still in the air', () => {
    const a = arena({ stats: sturdy(10) });
    killWithLoot(a.world, 30, 0, [currency(5, 1)]);
    const d = a.run.view.drops[0];
    a.run.step();
    expect(d.z).toBeGreaterThan(0);
    expect(a.run.requestPickup(1, d.id)).toBe('ok');
    expect(a.run.view.drops).toHaveLength(0);
    expect(a.log.pickups).toEqual([5]);
    // Gone for good: a second click (a double-click) answers 'missing' and grants nothing.
    expect(a.run.requestPickup(1, d.id)).toBe('missing');
    expect(a.log.pickups).toEqual([5]);
  });

  it('with the rules\' flags the bot clears a map, collecting only walk-over loot; the equipment stays', () => {
    const { hooks, log } = makeHooks({ dropChance: 0.5, autoPickup: rulesAutoPickup });
    const { run } = makeSolo({
      seed: 21, hooks, stats: strongStats(), skills: strongSkills(), loadout: STRONG_LOADOUT, scaling: TIER5,
      waves: { count: 2, bossWave: 0, lieutenantWave: 0, waveDuration: 20 },
    });
    const bot = createBot();
    for (let t = 0; t < Math.round(60 / SIM_DT); t++) {
      run.setIntent(1, bot.intent(run.view, 1));
      run.step();
      run.drainEvents();
      run.drainOutcomes();
    }
    const tokens = new Map(log.specs.map((s) => [s.token, s]));
    expect(log.pickups.length).toBeGreaterThan(3);
    expect(log.pickups.every((t) => tokens.get(t)!.autoPickup)).toBe(true);
    const lying = run.view.drops.filter((d) => d.spec.sprite === 'equipment');
    expect(lying.length).toBeGreaterThan(0);
    expect(lying.every((d) => !d.spec.autoPickup && !d.blocked)).toBe(true);
  }, 60_000);
});

describe('requestPickup results', () => {
  it('reach is measured from the player\'s feet: PICKUP_REACH is in, a hair beyond is not', () => {
    const a = arena();
    const id = a.run.spawnDrop(floorSpec(9), 200, 0);
    settle(a.run);
    const d = dropById(a.run, id)!;
    teleport(a.world, 1, d.x - PICKUP_REACH - 0.5, d.y);
    expect(a.run.requestPickup(1, id)).toBe('tooFar');
    expect(a.log.pickups).toEqual([]);
    expect(dropById(a.run, id)).toBeDefined();
    teleport(a.world, 1, d.x, d.y + PICKUP_REACH - 0.01);
    expect(a.run.requestPickup(1, id)).toBe('ok');
    expect(a.log.pickupsBy).toEqual([{ playerId: 1, token: 9 }]);
  });

  it('someone else\'s instanced loot is notYours; unknown drops and absent players are missing; the dead are tooFar', () => {
    const a = arena();
    joinArena(a, 2, 0, 30, sturdy(1));
    killWithLoot(a.world, 0, 60, [wand(1, 1), wand(2, 2)]);
    settle(a.run);
    const mine = a.run.view.drops.find((d) => d.spec.owner === 1)!;
    const theirs = a.run.view.drops.find((d) => d.spec.owner === 2)!;
    expect(a.run.requestPickup(1, theirs.id)).toBe('notYours');
    expect(a.run.requestPickup(2, mine.id)).toBe('notYours');
    expect(a.run.requestPickup(1, 987654)).toBe('missing');
    expect(a.run.requestPickup(3, mine.id)).toBe('missing');
    expect(a.run.requestPickup(0, mine.id)).toBe('missing');
    expect(a.run.requestPickup(Number.NaN, mine.id)).toBe('missing');
    expect(a.log.pickups).toEqual([]);
    // A fallen player can't pick anything up, not even right beside it.
    const p2 = a.world.playerById[2]!;
    teleport(a.world, 2, theirs.x, theirs.y + 4);
    p2.invulnTime = 0;
    damagePlayer(a.world, p2, 1e12, DAMAGE_INDEX.physical, 'area');
    a.run.step();
    expect(pv(a.run, 2).dead).toBe(true);
    expect(a.run.requestPickup(2, theirs.id)).toBe('tooFar');
    expect(a.log.pickups).toEqual([]);
    // No state changed along the way.
    expect(a.run.view.drops.every((d) => !d.blocked)).toBe(true);
    expect(a.run.drainOutcomes().filter((o) => o.t === 'pickup')).toEqual([]);
  });

  it('a full inventory answers full and flags the drop blocked; the next click after making room takes it', () => {
    let full = true;
    const a = arena({ hooks: { full: () => full } });
    const id = a.run.spawnDrop(floorSpec(4), 20, 0);
    settle(a.run);
    a.run.drainEvents();
    expect(a.run.requestPickup(1, id)).toBe('full');
    expect(a.log.blocked).toBe(1);
    const d = dropById(a.run, id)!;
    expect(d.blocked).toBe(true);
    expect(a.run.drainOutcomes()).toEqual([]);
    expect(ofType(a.run.drainEvents(), 'pickup')).toEqual([]);
    // Still full: still refused (and asked again — a click is a deliberate retry).
    expect(a.run.requestPickup(1, id)).toBe('full');
    expect(a.log.blocked).toBe(2);
    full = false;
    expect(a.run.requestPickup(1, id)).toBe('ok');
    expect(dropById(a.run, id)).toBeUndefined();
    expect(a.log.pickups).toEqual([4]);
  });

  it('a click retries a blocked walk-over drop; a throwing tryPickup is a refusal', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    let mode: 'full' | 'throw' | 'ok' = 'full';
    const a = arena({ hooks: { full: () => mode === 'full' } });
    const record = a.world.config.hooks.tryPickup;
    a.world.config.hooks.tryPickup = (id, token) => {
      if (mode === 'throw') throw new Error('inventory service down');
      return record(id, token);
    };
    killWithLoot(a.world, 30, 0, [currency(3, 1)]);
    settle(a.run, 120);
    const d = a.run.view.drops[0];
    expect(d.blocked).toBe(true);
    mode = 'throw';
    expect(a.run.requestPickup(1, d.id)).toBe('full');
    expect(String(drainHookErrors(a.run)[0])).toMatch(/inventory service down/);
    mode = 'ok';
    expect(a.run.requestPickup(1, d.id)).toBe('ok');
    expect(a.log.pickups).toEqual([3]);
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it('under input lag: stopping at PICKUP_APPROACH works first time; stopping at PICKUP_REACH needs a retry after the queued ticks', () => {
    /**
     * A client walks its predicted feet towards a drop and sends the click once within `threshold`.
     * The server is `lag` inputs behind (still queued), so it answers from where the player stood
     * `lag` ticks earlier; afterwards it applies the queued inputs, retrying the click after each.
     */
    const lagged = (threshold: number, lag: number) => {
      const setup = () => {
        const a = arena({ stats: makeStats({ maxLife: 1e9, evasion: 0, moveSpeed: 150 }) });
        const id = a.run.spawnDrop(floorSpec(5), 260, 0);
        settle(a.run);
        const d = dropById(a.run, id)!;
        const walk = () => {
          const p = pv(a.run);
          a.run.setIntent(1, walkIntent(p.x, p.y, d.x, d.y));
          a.run.step();
          return Math.hypot(pv(a.run).x - d.x, pv(a.run).y - d.y);
        };
        return { a, id, walk };
      };
      // The tick at which the client's prediction crosses the threshold (the same path, replayed).
      const probe = setup();
      let tc = 0;
      while (probe.walk() > threshold) tc++;
      tc++;
      const live = setup();
      for (let t = 0; t < tc - lag; t++) live.walk();
      const first = live.a.run.requestPickup(1, live.id);
      let result = first;
      let retries = 0;
      while (result === 'tooFar' && retries < lag) {
        live.walk();
        retries++;
        result = live.a.run.requestPickup(1, live.id);
      }
      return { first, result, retries };
    };
    expect(PICKUP_APPROACH).toBeLessThan(PICKUP_REACH);
    // Six queued inputs at 150 units/s (a burst's worth) still land inside the cushion.
    expect(lagged(PICKUP_APPROACH, 6)).toEqual({ first: 'ok', result: 'ok', retries: 0 });
    // Stopping at the reach itself: two queued inputs are enough for 'tooFar'; a retry after them succeeds
    // (requestPickup changes nothing on 'tooFar', so a server may simply ask again after each tick).
    const edge = lagged(PICKUP_REACH, 2);
    expect(edge.first).toBe('tooFar');
    expect(edge.result).toBe('ok');
    expect(edge.retries).toBeLessThanOrEqual(2);
  });
});

describe('public floor items', () => {
  afterEach(() => vi.restoreAllMocks());

  it('everyone sees them, nobody walks them up, anyone in reach clicks them', () => {
    const a = arena();
    joinArena(a, 2, 150, 0, sturdy());
    const id = a.run.spawnDrop(floorSpec(11), 0, 0);
    expect(typeof id).toBe('number');
    const spawned = ofType(a.run.drainEvents(), 'dropSpawn');
    expect(spawned).toEqual([{ t: 'dropSpawn', owner: 0, tone: 'magic', x: 0, y: 0, label: 'Ashwood Wand' }]);
    expect(dropById(a.run, id)!.spec.owner).toBe(0);
    // Even a public spec flagged autoPickup is never collected by walking over it.
    const id2 = a.run.spawnDrop(floorSpec(12, { autoPickup: true, sprite: 'currency', tone: 'currency' }), 0, 0);
    settle(a.run);
    for (const target of [dropById(a.run, id)!, dropById(a.run, id2)!]) {
      stepN(a.run, 90, () => walkIntent(pv(a.run, 1).x, pv(a.run, 1).y, target.x, target.y), 1);
      stepN(a.run, 90, () => walkIntent(pv(a.run, 2).x, pv(a.run, 2).y, target.x, target.y), 2);
    }
    expect(a.log.pickups).toEqual([]);
    expect(a.run.view.drops.map((d) => d.id).sort()).toEqual([id, id2].sort());
    // Player 2 (not the dropper) picks the wand up: the tryPickup, outcome and cue are theirs.
    a.run.drainEvents();
    a.run.drainOutcomes();
    teleport(a.world, 2, dropById(a.run, id)!.x + 40, dropById(a.run, id)!.y);
    expect(a.run.requestPickup(2, id)).toBe('ok');
    expect(a.log.pickupsBy).toEqual([{ playerId: 2, token: 11 }]);
    expect(a.run.drainOutcomes()).toEqual([{ t: 'pickup', playerId: 2, token: 11 }]);
    expect(ofType(a.run.drainEvents(), 'pickup')).toEqual([expect.objectContaining({ owner: 0, playerId: 2, label: 'Ashwood Wand' })]);
    // First come, first served: the dropper's click comes too late.
    expect(a.run.requestPickup(1, id)).toBe('missing');
    expect(a.run.requestPickup(1, id2)).toBe('ok');
  });

  it('removePlayer takes only the leaver\'s own loot; public items stay for everyone', () => {
    const a = arena();
    joinArena(a, 2, -200, 0, sturdy(1));
    killWithLoot(a.world, 0, 120, [wand(1, 1), wand(2, 2), currency(3, 2)]);
    const pub = a.run.spawnDrop(floorSpec(4), -200, 0);
    settle(a.run);
    expect(a.run.view.drops.map((d) => d.spec.owner).sort()).toEqual([0, 1, 2, 2]);
    a.run.removePlayer(2);
    expect(a.run.view.drops.map((d) => d.spec.owner).sort()).toEqual([0, 1]);
    a.run.removePlayer(1);
    expect(a.run.view.drops.map((d) => d.id)).toEqual([pub]);
    // Whoever comes next can still take it.
    a.run.addPlayer(makeJoin(5, { stats: sturdy(), x: -190, y: 0 }));
    expect(a.run.requestPickup(5, pub)).toBe('ok');
    expect(a.log.pickupsBy).toEqual([{ playerId: 5, token: 4 }]);
  });

  it('removeDrop (expiry) takes it away silently; unknown ids are ignored', () => {
    const a = arena();
    const id = a.run.spawnDrop(floorSpec(6), 10, 10);
    const keep = a.run.spawnDrop(floorSpec(7), -10, 10);
    settle(a.run);
    a.run.drainEvents();
    a.run.removeDrop(id);
    a.run.removeDrop(id);
    a.run.removeDrop(424242);
    expect(a.run.view.drops.map((d) => d.id)).toEqual([keep]);
    expect(a.run.drainEvents()).toEqual([]);
    expect(a.run.drainOutcomes()).toEqual([]);
    expect(a.run.requestPickup(1, id)).toBe('missing');
    expect(a.log.pickups).toEqual([]);
  });
});

describe('spawnDrop placement', () => {
  it('tosses the item a short hop from the given point: it rises, bounces once and lands close by', () => {
    const a = arena();
    const id = a.run.spawnDrop(floorSpec(1), 100, 50);
    const d = dropById(a.run, id)!;
    expect(d.x).toBe(100);
    expect(d.y).toBe(50);
    expect(d.z).toBe(0);
    let peak = 0;
    let dips = 0;
    let lastZ = 0;
    let rising = true;
    for (let t = 0; t < 90; t++) {
      a.run.step();
      peak = Math.max(peak, d.z);
      if (rising && d.z < lastZ) rising = false;
      if (!rising && d.z > lastZ) {
        dips++;
        rising = true;
      }
      lastZ = d.z;
    }
    expect(peak).toBeGreaterThan(6);
    expect(peak).toBeLessThan(20);
    expect(dips).toBe(1); // exactly one bounce
    expect(d.z).toBe(0);
    // A step in front of the feet (towards the camera, +y): clear of the dropper's sprite, well in reach.
    const dist = Math.hypot(d.x - 100, d.y - 50);
    expect(dist).toBeGreaterThan(12);
    expect(dist).toBeLessThan(30);
    expect(d.y - 50).toBeGreaterThan(8);
    // Landed means still: it never moves again.
    const at = [d.x, d.y];
    stepN(a.run, 60);
    expect([d.x, d.y]).toEqual(at);
  });

  it('different drops fly different ways (hashed from id and tick), identically on every replay', () => {
    const place = () => {
      const a = arena();
      const out: number[][] = [];
      for (let k = 0; k < 8; k++) {
        const id = a.run.spawnDrop(floorSpec(k), 0, 0);
        a.run.step();
        out.push([id]);
      }
      settle(a.run);
      for (const o of out) {
        const d = dropById(a.run, o[0])!;
        o.push(d.x, d.y);
      }
      return out;
    };
    const first = place();
    expect(place()).toEqual(first);
    const angles = first.map(([, x, y]) => Math.atan2(y, x));
    const distinct = new Set(angles.map((v) => Math.round(v * 8)));
    expect(distinct.size).toBeGreaterThanOrEqual(5);
    // Always into the front arc (never behind the feet, under the character's sprite).
    for (const v of angles) {
      expect(v).toBeGreaterThanOrEqual(FLOOR_TOSS_ANGLE_MIN - 1e-9);
      expect(v).toBeLessThanOrEqual(FLOOR_TOSS_ANGLE_MAX + 1e-9);
    }
  });

  it('never consumes the world rng: a floor item that comes and goes leaves the run exactly as it was', () => {
    const play = (withDrop: boolean) => {
      const { run, world } = createRunInternal(makeConfig({ seed: 314, scaling: { ...TIER5 } }));
      run.addPlayer(makeJoin(1, { stats: strongStats(), skills: strongSkills(), loadout: STRONG_LOADOUT }));
      const bot = createBot();
      const digests: number[] = [];
      for (let t = 0; t < 1500; t++) {
        if (withDrop && t === 300) {
          const before = world.worldRng.state();
          const p = pv(run);
          const id = run.spawnDrop(floorSpec(77), p.x, p.y);
          expect(world.worldRng.state()).toBe(before);
          // Picked up again at once by its dropper.
          expect(run.requestPickup(1, id)).toBe('ok');
        } else if (t === 300) {
          // The only trace a floor item leaves is the drop id it used (later drops' ids are digested).
          world.nextDropId++;
        }
        const intent: PlayerIntent = bot.intent(run.view, 1);
        run.setIntent(1, intent);
        run.step();
        run.drainEvents();
        run.drainOutcomes();
        if (t % 100 === 99) digests.push(run.digest());
      }
      return digests;
    };
    expect(play(true)).toEqual(play(false));
  }, 60_000);

  it('lands inside the arena even when dropped at (or beyond) its edge', () => {
    const a = arena();
    const R = a.world.arenaRadius;
    const ids = [
      a.run.spawnDrop(floorSpec(1), R + 300, 0),
      a.run.spawnDrop(floorSpec(2), 0, -(R - 1)),
      a.run.spawnDrop(floorSpec(3), (R - 2) * Math.SQRT1_2, (R - 2) * Math.SQRT1_2),
    ];
    for (const id of ids) {
      const d = dropById(a.run, id)!;
      expect(Math.hypot(d.x, d.y)).toBeLessThanOrEqual(R - DROP_EDGE_MARGIN + 1e-6);
    }
    for (let t = 0; t < 90; t++) {
      a.run.step();
      for (const d of a.run.view.drops) expect(Math.hypot(d.x, d.y)).toBeLessThanOrEqual(R - DROP_EDGE_MARGIN + 1e-6);
    }
  });

  it('never starts or lands inside solid furniture', () => {
    const { run, world } = makeSolo({ mode: 'hideout', arenaRadius: 260, stats: sturdy() });
    const solid = run.view.props.filter((p) => p.radius > 0);
    expect(solid.length).toBeGreaterThan(5);
    const ids: number[] = [];
    for (const p of solid) ids.push(run.spawnDrop(floorSpec(ids.length + 1), p.x, p.y));
    for (const id of ids) {
      const d = dropById(run, id)!;
      for (const p of solid) expect(Math.hypot(d.x - p.x, d.y - p.y)).toBeGreaterThanOrEqual(p.radius + DROP_PROP_RADIUS - 1e-3);
    }
    stepN(run, 120);
    expect(run.view.drops).toHaveLength(ids.length);
    for (const d of run.view.drops) {
      expect(d.z).toBe(0);
      for (const p of solid) expect(Math.hypot(d.x - p.x, d.y - p.y)).toBeGreaterThanOrEqual(p.radius + DROP_PROP_RADIUS - 1e-3);
      expect(Math.hypot(d.x, d.y)).toBeLessThanOrEqual(world.arenaRadius - DROP_EDGE_MARGIN + 1e-6);
    }
  });

  it('non-finite coordinates fall back to the arena centre instead of poisoning the world', () => {
    const a = arena();
    const id = a.run.spawnDrop(floorSpec(1), Number.NaN, Number.POSITIVE_INFINITY);
    settle(a.run);
    const d = dropById(a.run, id)!;
    expect(Number.isFinite(d.x) && Number.isFinite(d.y)).toBe(true);
    expect(Math.hypot(d.x, d.y)).toBeLessThan(20);
    expect(Number.isFinite(a.run.digest())).toBe(true);
  });

  it('rejects a malformed spec or a stranger as owner before touching anything; accepts a present owner', () => {
    const a = arena();
    const bad: unknown[] = [
      null,
      { ...floorSpec(1), token: Number.NaN },
      { ...floorSpec(1), autoPickup: undefined },
      { ...floorSpec(1), label: 3 },
      { ...floorSpec(1), owner: 2 }, // nobody with id 2 here
      { ...floorSpec(1), owner: -1 },
      { ...floorSpec(1), owner: 1.5 },
    ];
    for (const spec of bad) expect(() => a.run.spawnDrop(spec as DropSpec, 0, 0)).toThrow(TypeError);
    expect(a.run.view.drops).toHaveLength(0);
    expect(a.run.drainEvents()).toEqual([]);
    // An item handed back to a player present in the instance is theirs alone.
    const id = a.run.spawnDrop(floorSpec(2, { owner: 1 }), 0, 0);
    expect(dropById(a.run, id)!.spec.owner).toBe(1);
    expect(ofType(a.run.drainEvents(), 'dropSpawn')[0].owner).toBe(1);
  });
});
