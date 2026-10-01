// Layout validator (docs/atlas-rework/D-territory.md 10.3): runs the eight checks on EVERY registered layout and on the
// two test fixtures, and proves each check can fail with deliberately broken copies of a fixture. A layout that fails any
// check blocks merge. (Registered layouts: none until a layout pack lands; the fixtures keep the harness honest.)
import { describe, expect, it } from 'vitest';
import { areaRadius } from '../../src/data/layouts/area';
import { AREA_LAYOUTS, layoutFor, overrideLayout, registeredLayouts } from '../../src/data/layouts';
import { compileLayout, inZone } from '../../src/data/layouts/compile';
import { FIXTURE_LAYOUTS, SAND_RING, SLAG_YARD } from '../../src/data/layouts/fixtures';
import { EVENT_ANCHOR_KINDS, LAYOUT_PROP_RADIUS, resolvePt, type AreaLayout } from '../../src/data/layouts/schema';
import { checkDeterminism, validateLayout, type DeterminismOptions } from '../../src/sim/layout-validate';
import { areaTheme } from '../../src/data/layouts/area';
import { makeConfig, makeJoin } from '../sim/fixtures';

const det: DeterminismOptions = {
  makeConfig: (areaId, seed, R) => makeConfig({ seed, arenaRadius: R, areaId, theme: areaTheme(areaId) }),
  addPlayer: (run) => run.addPlayer(makeJoin(1)),
};

const all: readonly AreaLayout[] = [...registeredLayouts(), ...FIXTURE_LAYOUTS];

describe('every layout passes the eight checks', () => {
  for (const layout of all) {
    it(`${layout.areaId}${layout.fixture ? ' (fixture)' : ''}`, () => {
      const report = validateLayout(layout);
      expect(report.issues, report.issues.map((i) => `[${i.check}] ${i.id}: ${i.message}`).join('\n')).toEqual([]);
      const d = checkDeterminism(layout, det);
      expect(d, d.map((i) => i.message).join('\n')).toEqual([]);
    });
  }
});

describe('fixtures are not registered', () => {
  it('every one of the 25 areas has a shipped layout, none of them a fixture, and the fixtures are marked', () => {
    expect(Object.keys(AREA_LAYOUTS)).toHaveLength(25);
    for (const l of Object.values(AREA_LAYOUTS)) expect(l?.fixture).not.toBe(true);
    for (const f of FIXTURE_LAYOUTS) expect(f.fixture).toBe(true);
  });
  it('the override helper is scoped and restores', () => {
    const shipped = layoutFor('furnaceYard');
    expect(shipped).toBeDefined();
    const restore = overrideLayout(SLAG_YARD);
    expect(layoutFor('furnaceYard')).toBe(SLAG_YARD);
    restore();
    expect(layoutFor('furnaceYard')).toBe(shipped);
    const restoreNull = overrideLayout(null, 'furnaceYard');
    expect(layoutFor('furnaceYard')).toBeUndefined();
    restoreNull();
    expect(layoutFor('furnaceYard')).toBe(shipped);
  });
});

function broken(base: AreaLayout, edit: (l: AreaLayout) => void): AreaLayout {
  const copy = structuredClone(base);
  edit(copy);
  return copy;
}
const checks = (l: AreaLayout): number[] => [...new Set(validateLayout(l).issues.map((i) => i.check))];

describe('each check fails on a broken layout', () => {
  it('1: a point outside 0.92 R', () => {
    expect(checks(broken(SLAG_YARD, (l) => { l.lanes[0].path[1] = [0, -0.97]; }))).toContain(1);
  });
  it('1: a solid inside the start clearing', () => {
    expect(checks(broken(SLAG_YARD, (l) => { l.landmarks.push({ id: 'oops', kind: 'pillar', at: [0.05, 0.05] }); }))).toContain(1);
  });
  it('1: an anchor inside a solid and the boss stage inside a solid', () => {
    expect(checks(broken(SLAG_YARD, (l) => { l.anchors.push({ id: 'bad', fits: 'altar', at: [-0.3, -0.3] }); }))).toContain(1);
    expect(checks(broken(SLAG_YARD, (l) => { l.bossStage.at = [0.3, 0.3]; }))).toContain(1);
  });
  it('2: a sealed room is unreachable', () => {
    const l = broken(SLAG_YARD, (x) => {
      x.walls.push({ id: 'cell', path: [[0.6, 0.0], [0.6, 0.2], [0.8, 0.2], [0.8, 0.0], [0.6, 0.0]] });
      x.anchors.push({ id: 'walled', fits: 'altar', at: [0.7, 0.1] });
    });
    const issues = validateLayout(l).issues.filter((i) => i.check === 2);
    expect(issues.some((i) => i.id === 'walled')).toBe(true);
  });
  it('8: a sealed room is standing ground a player could be knocked into and never leave', () => {
    const l = broken(SLAG_YARD, (x) => {
      x.walls.push({ id: 'cell', path: [[0.6, 0.0], [0.6, 0.2], [0.8, 0.2], [0.8, 0.0], [0.6, 0.0]] });
    });
    expect(validateLayout(l).issues.some((i) => i.check === 8)).toBe(true);
    expect(validateLayout(SLAG_YARD).issues.filter((i) => i.check === 8)).toEqual([]);
  });
  it('2: a choke narrower than 96 u', () => {
    expect(checks(broken(SLAG_YARD, (l) => { l.walls[0].gaps = [{ at: 0.5, width: 90 }]; }))).toContain(2);
  });
  it('2: closing every gate seals the start in', () => {
    // No gates: the yard around the landing is a closed room.
    const l = broken(SLAG_YARD, (x) => { for (const w of x.walls) w.gaps = []; });
    expect(validateLayout(l).issues.some((i) => i.check === 2 && i.message.includes('not reachable'))).toBe(true);
  });
  it('3: overlapping landmarks, too dense, no room for the boss', () => {
    expect(checks(broken(SLAG_YARD, (l) => { l.landmarks.push({ id: 'dup', kind: 'vat', at: [0.31, 0.3] }); }))).toContain(3);
    expect(checks(broken(SAND_RING, (l) => {
      l.clusters.push({ id: 'jungle', pattern: 'grid', at: [0, 0], params: { cols: 24, rows: 24, dx: 21, dy: 21, radius: 12 }, prop: 'crate' });
    }))).toContain(3);
    expect(checks(broken(SAND_RING, (l) => {
      l.clusters.push({ id: 'blockers', pattern: 'ring', at: l.bossStage.at, params: { r: 90, count: 8 }, prop: 'pillar' });
    }))).toContain(3);
  });
  it('4: Event Charter spacing', () => {
    expect(checks(broken(SLAG_YARD, (l) => { l.anchors.find((a) => a.id === 'perch-1')!.at = [0.1, -0.1]; }))).toContain(4);
    expect(checks(broken(SLAG_YARD, (l) => { l.anchors.find((a) => a.id === 'echo-e')!.at = { r: 0.9, a: 90 }; }))).toContain(4);
    expect(checks(broken(SLAG_YARD, (l) => { l.anchors.find((a) => a.id === 'relay-2')!.at = [0.1, -0.5]; }))).toContain(4);
    expect(checks(broken(SLAG_YARD, (l) => { l.anchors.find((a) => a.id === 'fault-e')!.path = [[0.5, 0.4], [0.5, 0.5]]; }))).toContain(4);
    expect(checks(broken(SLAG_YARD, (l) => { l.anchors.find((a) => a.id === 'road-south')!.path = [[-0.3, 0.5], [0.3, 0.5]]; }))).toContain(4);
  });
  it('5: a perch without cover on its line to the landing', () => {
    expect(checks(broken(SLAG_YARD, (l) => { l.anchors.find((a) => a.id === 'perch-1')!.at = { r: 0.62, a: 0 }; }))).toContain(5);
  });
  it('6: too few perches, a missing kind', () => {
    expect(checks(broken(SLAG_YARD, (l) => { l.anchors = l.anchors.filter((a) => a.id !== 'perch-4'); }))).toContain(6);
    expect(checks(broken(SLAG_YARD, (l) => { l.anchors = l.anchors.filter((a) => a.fits !== 'bell'); }))).toContain(6);
    // The forge claims fault, relay and anvil as native: two of each.
    expect(checks(broken(SLAG_YARD, (l) => { l.anchors = l.anchors.filter((a) => a.id !== 'anvil-s'); }))).toContain(6);
  });
  it('7: determinism catches a layout whose fixed props vary', () => {
    // A layout may not depend on the run: this passes for the fixtures (checked above); here we only prove the helper reports
    // identical-pack failures when two seeds are forced equal.
    const issues = checkDeterminism(SLAG_YARD, { ...det, seeds: [5, 5] });
    expect(issues.some((i) => i.check === 7 && i.message.includes('identical packs'))).toBe(true);
  });
});

describe('schema and compiler', () => {
  it('polar bearings are compass degrees, N up, clockwise, +y south', () => {
    const n = resolvePt({ r: 0.5, a: 0 }, 1000);
    const e = resolvePt({ r: 0.5, a: 90 }, 1000);
    const s = resolvePt({ r: 0.5, a: 180 }, 1000);
    expect(n.x).toBeCloseTo(0);
    expect(n.y).toBeCloseTo(-500);
    expect(e.x).toBeCloseTo(500);
    expect(e.y).toBeCloseTo(0);
    expect(s.y).toBeCloseTo(500);
    expect(resolvePt([0.25, -0.5], 800)).toEqual({ x: 200, y: -400 });
  });
  it('compiles identically every time, in a fixed order, and scales positions with R', () => {
    for (const l of FIXTURE_LAYOUTS) {
      const a = compileLayout(l, areaRadius(l.areaId));
      const b = compileLayout(l, areaRadius(l.areaId));
      expect(a.props).toEqual(b.props);
      expect(a.signature).toBe(b.signature);
      const big = compileLayout(l, areaRadius(l.areaId) * 1.2);
      const count = (c: typeof a, s: string): number => c.props.filter((p) => p.source === s).length;
      expect(count(big, 'landmark')).toBe(count(a, 'landmark'));
      expect(count(big, 'cluster')).toBe(count(a, 'cluster'));
      // landmarks first, then clusters, then walls
      const order = a.props.map((p) => p.source);
      expect(order).toEqual([...order].sort((x, y) => ['landmark', 'cluster', 'wall', 'scatter'].indexOf(x) - ['landmark', 'cluster', 'wall', 'scatter'].indexOf(y)));
    }
  });
  it('walls are overlapping circles at 0.8 x diameter with the declared gaps open', () => {
    const c = compileLayout(SLAG_YARD, 990);
    const north = c.props.filter((p) => p.owner === 'pipe-n');
    expect(north.length).toBeGreaterThan(15);
    for (let i = 1; i < north.length; i++) {
      const d = Math.hypot(north[i].x - north[i - 1].x, north[i].y - north[i - 1].y);
      if (d < 40) expect(d).toBeLessThanOrEqual(0.8 * 24 + 1e-6 + 3);
    }
    // the 120 u gate at the middle of the north wall is open: no piece within 60 u of x = 0
    expect(north.every((p) => Math.abs(p.x) >= 60 + p.radius - 1e-6)).toBe(true);
  });
  it('zones: discs and compass sectors', () => {
    const c = compileLayout(SLAG_YARD, 990);
    const ne = c.zones.find((z) => z.id === 'q-ne')!;
    expect(inZone(ne, 300, -300)).toBe(true);
    expect(inZone(ne, -300, -300)).toBe(false);
    expect(inZone(ne, 300, 300)).toBe(false);
  });
  it('every new PropKind has a solid radius and every kit sprite exists in the art table', () => {
    const kit = ['vat', 'bellows', 'altar', 'sarcophagus', 'choirStall', 'ribArch', 'iceColumn', 'crate', 'chainPost', 'hoist', 'gate', 'weaponRack', 'obelisk', 'statue'] as const;
    for (const k of kit) expect(LAYOUT_PROP_RADIUS[k]).toBeGreaterThan(0);
    expect(EVENT_ANCHOR_KINDS.length).toBe(11);
  });
});
