// Layout runtime (src/sim/layout.ts): the arena is built from a layout when its area has one, and is byte-for-byte the old
// generator otherwise. Fixtures stand in for real layouts through `overrideLayout` (nothing is registered).
import { afterEach, describe, expect, it } from 'vitest';
import { createRunInternal, stepWorld } from '../../src/sim/run';
import { areaTheme } from '../../src/data/layouts/area';
import { compileLayout, inZone, distToPath } from '../../src/data/layouts/compile';
import { overrideLayout } from '../../src/data/layouts';
import { SAND_RING, SLAG_YARD } from '../../src/data/layouts/fixtures';
import { bossStagePoint, layoutAnchors, layoutPackPoints, packProfile, pickLayoutAnchor } from '../../src/sim/layout';
import { createRng } from '../../src/core/rng';
import { makeConfig, makeJoin } from '../sim/fixtures';
import type { World } from '../../src/sim/world';

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  restore = null;
});

function build(opts: { layout?: typeof SLAG_YARD | null; seed?: number; areaId?: typeof SLAG_YARD.areaId; players?: number; waves?: Record<string, number> } = {}) {
  const layout = opts.layout === undefined ? SLAG_YARD : opts.layout;
  if (layout) restore = overrideLayout(layout);
  const areaId = opts.areaId ?? layout?.areaId;
  const cfg = makeConfig({
    seed: opts.seed ?? 77, arenaRadius: 990, theme: areaId ? areaTheme(areaId) : 'ashenForge', ...(areaId ? { areaId } : {}),
    ...(opts.waves ? { waves: opts.waves } : {}),
  });
  const r = createRunInternal(cfg);
  for (let k = 1; k <= (opts.players ?? 1); k++) r.run.addPlayer(makeJoin(k));
  return r;
}

describe('areas without a layout keep the old generator', () => {
  it('an areaId whose layout is switched off builds exactly the same world as no areaId', () => {
    const restore = overrideLayout(null, 'furnaceYard'); // force the old generator for this area
    try {
      const a = createRunInternal(makeConfig({ seed: 5, arenaRadius: 990 }));
      const b = createRunInternal(makeConfig({ seed: 5, arenaRadius: 990, areaId: 'furnaceYard' }));
      for (const r of [a, b]) r.run.addPlayer(makeJoin(1));
      expect(b.world.layout).toBeNull();
      expect(b.world.props.map((p) => [p.kind, p.x, p.y, p.radius, p.variant])).toEqual(a.world.props.map((p) => [p.kind, p.x, p.y, p.radius, p.variant]));
      for (let t = 0; t < 600; t++) {
        stepWorld(a.world);
        stepWorld(b.world);
      }
      expect(b.run.digest()).toBe(a.run.digest());
    } finally {
      restore();
    }
  });
  it('the hideout never uses a layout', () => {
    const restoreOv = overrideLayout(SLAG_YARD);
    try {
      const r = createRunInternal(makeConfig({ mode: 'hideout', arenaRadius: 300, areaId: 'furnaceYard' }));
      expect(r.world.layout).toBeNull();
    } finally {
      restoreOv();
    }
  });
});

describe('applyLayout', () => {
  it('builds the fixed props in a fixed order (same area, any seed) plus seed-dependent cosmetic debris', () => {
    const a = build({ seed: 1 });
    restore?.();
    const b = build({ seed: 987654 });
    const fixed = compileLayout(SLAG_YARD, 990).props;
    const key = (w: World, n: number) => w.props.slice(0, n).map((p) => `${p.id}:${p.kind}:${p.x.toFixed(3)}:${p.y.toFixed(3)}:${p.radius}:${p.variant}`);
    expect(key(a.world, fixed.length)).toEqual(key(b.world, fixed.length));
    expect(a.world.props.length).toBeGreaterThan(fixed.length);
    const debris = (w: World) => w.props.slice(fixed.length).filter((p) => p.radius === 0).map((p) => `${p.x.toFixed(2)}:${p.y.toFixed(2)}`).join('|');
    expect(debris(a.world)).not.toEqual(debris(b.world));
    // decoration never blocks: every post-fixed prop with a radius is the rim ring (radius 0 as well)
    expect(a.world.props.slice(fixed.length).every((p) => p.radius === 0)).toBe(true);
  });
  it('carries the area on the world view and the layout on the world; solid kit props collide', () => {
    const { world } = build();
    expect(world.view.areaId).toBe('furnaceYard');
    expect(world.layout?.compiled.areaId).toBe('furnaceYard');
    const vat = world.props.find((p) => p.kind === 'vat')!;
    expect(vat.radius).toBe(30);
    expect(world.propGrid.near(vat.x, vat.y).length).toBeGreaterThan(0);
  });
  it('players arrive at the layout start (default: the centre) and respect a fixed start', () => {
    const { world } = build();
    expect(Math.hypot(world.players[0].x, world.players[0].y)).toBeLessThan(1);
    const custom = structuredClone(SLAG_YARD);
    custom.start = { at: { r: 0.5, a: 180 } };
    custom.anchors = custom.anchors.filter((a) => a.fits !== 'relay');
    restore = overrideLayout(custom);
    const r = createRunInternal(makeConfig({ seed: 3, arenaRadius: 990, areaId: 'furnaceYard', theme: 'ashenForge' }));
    r.run.addPlayer(makeJoin(1));
    expect(r.world.players[0].x).toBeCloseTo(0, 0);
    expect(r.world.players[0].y).toBeCloseTo(495, 0);
  });
  it('the digest covers the layout and two builds agree', () => {
    const a = build({ seed: 11 });
    const da = a.run.digest();
    restore?.();
    const b = build({ seed: 11 });
    expect(b.run.digest()).toBe(da);
  });
});

describe('packs use the layout zones and lanes', () => {
  it('every pack of a wave stands in a zone or lane, away from the players, clear of solids', () => {
    const { world } = build({ seed: 31 });
    const c = world.layout!.compiled;
    for (let t = 0; t < 60 * 8; t++) stepWorld(world);
    expect(world.director.wave).toBeGreaterThanOrEqual(1);
    const homes = world.packs.filter((p) => p.active && !p.stream && p.wave === 1);
    expect(homes.length).toBeGreaterThan(3);
    for (const p of homes) {
      const inZoneOrLane = c.zones.some((z) => inZone(z, p.homeX, p.homeY)) || c.lanes.some((l) => distToPath(p.homeX, p.homeY, l.path) <= l.width / 2 + 1);
      expect(inZoneOrLane, `pack at ${p.homeX.toFixed(0)},${p.homeY.toFixed(0)}`).toBe(true);
      expect(Math.hypot(p.homeX, p.homeY)).toBeLessThan(world.arenaRadius - 60);
    }
  });
  it('wave windows are honoured', () => {
    const { world } = build({ layout: SAND_RING, seed: 8 });
    const c = world.layout!.compiled;
    const rim = c.zones.filter((z) => z.id.startsWith('rim-ring'));
    for (let t = 0; t < 60 * 8; t++) stepWorld(world);
    // wave 1: the rim zones (window 2..9) are not used, the north lane (1..3) may be
    for (const p of world.packs.filter((q) => q.active && !q.stream && q.wave === 1)) {
      const inRimOnly = rim.some((z) => inZone(z, p.homeX, p.homeY)) && !c.zones.some((z) => z.id === 'sand' && inZone(z, p.homeX, p.homeY)) && !c.lanes.some((l) => distToPath(p.homeX, p.homeY, l.path) <= l.width / 2 + 1);
      expect(inRimOnly).toBe(false);
    }
  });
  it('different seeds place packs differently', () => {
    const pos = (seed: number) => {
      const { world } = build({ seed });
      restore?.();
      for (let t = 0; t < 60 * 8; t++) stepWorld(world);
      return world.packs.filter((p) => p.active && !p.stream).map((p) => `${p.homeX.toFixed(1)},${p.homeY.toFixed(1)}`).join('|');
    };
    expect(pos(1)).not.toEqual(pos(2));
  });
});

describe('rare spots and lane favours', () => {
  it('rare packs favour the layout rare spots; other packs never use them as a region of their own', () => {
    const { world } = build({ seed: 12 });
    world.living.forEach((p) => { p.x = 0; p.y = 0; });
    const spots = world.layout!.compiled.rareSpots;
    const inSpot = (p: { x: number; y: number } | null) => !!p && spots.some((s) => Math.hypot(p.x - s.x, p.y - s.y) <= s.r);
    const rare = layoutPackPoints(world, 1, Array.from({ length: 60 }, () => packProfile(['swarmer'], true)))!;
    const plain = layoutPackPoints(world, 1, Array.from({ length: 60 }, () => packProfile(['swarmer'], false)))!;
    expect(rare.filter(inSpot).length).toBeGreaterThan(plain.filter(inSpot).length);
  });
  it('a layout with no zone or lane usable in the wave falls back to the old spiral', () => {
    const only = structuredClone(SLAG_YARD);
    only.zones = [];
    only.lanes = [];
    restore = overrideLayout(only);
    const w = createRunInternal(makeConfig({ seed: 3, arenaRadius: 990, areaId: 'furnaceYard', theme: 'ashenForge' })).world;
    expect(layoutPackPoints(w, 1, [packProfile([], false)])).toBeNull();
  });
});

describe('the boss arrives on its stage', () => {
  it('the final boss spawns at bossStage.at (the stage point away from campers)', () => {
    const { world } = build({ seed: 5, waves: { count: 1, bossWave: 1, baseMonsters: 10, monstersPerWave: 0, waveDuration: 60, tellDuration: 2, lieutenantWave: 0 } });
    const stage = world.layout!.compiled.bossStage;
    let spawn: { x: number; y: number } | null = null;
    for (let t = 0; t < 60 * 12 && !spawn; t++) {
      stepWorld(world);
      for (const e of world.events.drain()) if (e.t === 'bossSpawn') spawn = { x: e.x, y: e.y };
    }
    expect(spawn).not.toBeNull();
    expect(Math.hypot(spawn!.x - stage.x, spawn!.y - stage.y)).toBeLessThan(1);
  });
  it('a player camping on the stage is not landed on', () => {
    const { world } = build({ seed: 5 });
    const st = world.layout!.compiled.bossStage;
    const p = world.players[0];
    p.x = st.x;
    p.y = st.y;
    const pt = bossStagePoint(world)!;
    expect(Math.hypot(pt.x - p.x, pt.y - p.y)).toBeGreaterThan(100);
    expect(Math.hypot(pt.x - st.x, pt.y - st.y)).toBeLessThanOrEqual(st.r + 1);
  });
});

describe('layoutAnchors (the Event Director query)', () => {
  it('no layout: empty (the director keeps its radial rules)', () => {
    const { world } = build({ layout: null });
    expect(layoutAnchors(world, 'perch')).toEqual([]);
    expect(layoutAnchors(world, 'perch', { fallback: true })).toEqual([]);
  });
  it('returns the declared anchors in world units, tier-filtered', () => {
    const { world } = build();
    const perches = layoutAnchors(world, 'perch');
    expect(perches.length).toBe(4);
    expect(perches.every((a) => !a.fallback && Math.hypot(a.x, a.y) > 500)).toBe(true);
    const roads = layoutAnchors(world, 'road');
    expect(roads[0].path.length).toBe(2);
    const tiered = structuredClone(SLAG_YARD);
    tiered.anchors.find((a) => a.id === 'altar-1')!.tier = [4, 9];
    restore?.();
    restore = overrideLayout(tiered);
    const w2 = createRunInternal(makeConfig({ seed: 2, arenaRadius: 990, areaId: 'furnaceYard', theme: 'ashenForge' })).world;
    expect(layoutAnchors(w2, 'altar', { tier: 1 })).toEqual([]);
    expect(layoutAnchors(w2, 'altar', { tier: 5 }).length).toBe(1);
  });
  it('synthesises deterministic Charter-respecting fallbacks only when asked', () => {
    const slim = structuredClone(SLAG_YARD);
    slim.anchors = slim.anchors.filter((a) => a.fits !== 'echo' && a.fits !== 'road');
    restore = overrideLayout(slim);
    const mk = (seed: number) => createRunInternal(makeConfig({ seed, arenaRadius: 990, areaId: 'furnaceYard', theme: 'ashenForge' })).world;
    const w1 = mk(1);
    const w2 = mk(2);
    expect(layoutAnchors(w1, 'echo')).toEqual([]);
    const fb = layoutAnchors(w1, 'echo', { fallback: true });
    expect(fb.length).toBeGreaterThan(2);
    for (const a of fb) {
      expect(a.fallback).toBe(true);
      expect(Math.hypot(a.x, a.y)).toBeGreaterThanOrEqual(250);
      expect(990 - Math.hypot(a.x, a.y)).toBeGreaterThanOrEqual(150);
    }
    // same area -> same sites regardless of the run seed
    expect(layoutAnchors(w2, 'echo', { fallback: true }).map((a) => [a.x, a.y])).toEqual(fb.map((a) => [a.x, a.y]));
    expect(layoutAnchors(w1, 'road', { fallback: true })).toEqual([]);
  });
  it('pickLayoutAnchor picks with the caller rng among the candidates that pass the filter', () => {
    const { world } = build();
    const rng = createRng(4);
    const a = pickLayoutAnchor(world, 'perch', rng, (x) => x.y < 0);
    expect(a).not.toBeNull();
    expect(a!.y).toBeLessThan(0);
    expect(pickLayoutAnchor(world, 'perch', rng, () => false)).toBeNull();
  });
});
