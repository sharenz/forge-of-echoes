import { describe, expect, it } from 'vitest';
import { ATLAS_AREA_IDS } from '../../src/contracts/atlas';
import { ATLAS_AREAS, atlasTierCeiling, findAtlasArea } from '../../src/data/progression/atlas';
import {
  ATLAS_EDGES, ATLAS_POS, CHART_H, CHART_W, MATERIALS, REGIONS, crownPips, edgeKey, materialOf, pathLength, plumeAreas, pointAt, roadKind, roadPoints, tierBand, tierRivets,
} from '../../src/art/atlas/geometry';

describe('Atlas chart geography', () => {
  it('places every area exactly once, inside the chart with room for crowns, pips and the frame', () => {
    expect(Object.keys(ATLAS_POS).sort()).toEqual([...ATLAS_AREA_IDS].sort());
    for (const id of ATLAS_AREA_IDS) {
      const p = ATLAS_POS[id];
      expect(p.x, id).toBeGreaterThanOrEqual(28);
      expect(p.x, id).toBeLessThanOrEqual(CHART_W - 28);
      expect(p.y, id).toBeGreaterThanOrEqual(34);
      expect(p.y, id).toBeLessThanOrEqual(CHART_H - 34);
    }
  });

  it('never overlaps two nodes (plate 42 wide, crowns above and pips below make each 62 tall)', () => {
    for (let i = 0; i < ATLAS_AREA_IDS.length; i++) {
      for (let j = i + 1; j < ATLAS_AREA_IDS.length; j++) {
        const a = ATLAS_POS[ATLAS_AREA_IDS[i]], b = ATLAS_POS[ATLAS_AREA_IDS[j]];
        const overlap = Math.abs(a.x - b.x) < 46 && Math.abs(a.y - b.y) < 62;
        expect(overlap, `${ATLAS_AREA_IDS[i]} / ${ATLAS_AREA_IDS[j]}`).toBe(false);
      }
    }
  });

  it('draws every reciprocal edge once, from plate to plate', () => {
    const expected = new Set<string>();
    for (const a of ATLAS_AREAS) for (const n of a.neighbours) expected.add(edgeKey(a.id, n));
    expect(new Set(ATLAS_EDGES.map((e) => e.key))).toEqual(expected);
    for (const e of ATLAS_EDGES) {
      for (const [from, to] of [[e.a, e.b], [e.b, e.a]] as const) {
        const pts = roadPoints(from, to);
        expect(pts[0].x).toBeCloseTo(ATLAS_POS[from].x, 3);
        expect(pts[0].y).toBeCloseTo(ATLAS_POS[from].y, 3);
        expect(pts.at(-1)!.x).toBeCloseTo(ATLAS_POS[to].x, 3);
        expect(pts.at(-1)!.y).toBeCloseTo(ATLAS_POS[to].y, 3);
        expect(pathLength(pts)).toBeGreaterThan(30);
      }
    }
  });

  it('keeps roads out of every plate and every sealed door they are not connected to', () => {
    for (const e of ATLAS_EDGES) {
      const pts = roadPoints(e.a, e.b, 2);
      for (const id of ATLAS_AREA_IDS) {
        if (id === e.a || id === e.b) continue;
        const p = ATLAS_POS[id];
        const min = Math.min(...pts.map((q) => Math.hypot(q.x - p.x, q.y - p.y)));
        expect(min, `${e.key} passes ${id}`).toBeGreaterThan(30);
      }
    }
  });

  it('samples along a road: pointAt walks the arc length', () => {
    const pts = roadPoints('emberRoad', 'furnaceYard');
    const len = pathLength(pts);
    const mid = pointAt(pts, len / 2);
    expect(mid.x).toBeGreaterThan(ATLAS_POS.emberRoad.x);
    expect(mid.x).toBeLessThan(ATLAS_POS.furnaceYard.x);
    expect(pointAt(pts, len + 50)).toEqual(pts.at(-1));
  });

  it('gives every region a banner that clears the plates', () => {
    for (const r of REGIONS) {
      for (const id of ATLAS_AREA_IDS) {
        const p = ATLAS_POS[id];
        // a banner is wide and short; only require that it does not sit on a plate's centre column
        const onPlate = Math.abs(r.banner.x - p.x) < 20 && Math.abs(r.banner.y - p.y) < 20;
        expect(onPlate, `${r.id} banner over ${id}`).toBe(false);
      }
    }
  });
});

describe('Atlas node identity', () => {
  it('maps ceilings onto the five-material ladder with one rivet per tier inside a band', () => {
    const expected = ['iron', 'iron', 'iron', 'bronze', 'bronze', 'bronze', 'gilt', 'gilt', 'gilt', 'ember', 'ember', 'ember', 'void', 'void', 'void'];
    for (let t = 1; t <= 15; t++) {
      expect(materialOf(t)).toBe(expected[t - 1]);
      expect(MATERIALS[tierBand(t)]).toBe(expected[t - 1]);
      expect(tierRivets(t)).toBe(((t - 1) % 3) + 1);
    }
  });

  it('draws 0, 1 or 2 boss crowns as the brief says', () => {
    expect(crownPips(findAtlasArea('shrineField')!)).toBe(0);
    expect(crownPips(findAtlasArea('emberRoad')!)).toBe(1);
    expect(crownPips(findAtlasArea('crownFoundry')!)).toBe(2);
    for (const a of ATLAS_AREAS) expect(atlasTierCeiling(a)).toBeGreaterThanOrEqual(1);
  });
});

describe('Atlas roads and fog rules', () => {
  const get = (id: string) => findAtlasArea(id)!;
  it('classifies roads by what the account has discovered and cleared', () => {
    const disc = new Set(['cinderCrossing', 'emberRoad', 'emberVault']);
    const done = new Set(['cinderCrossing']);
    expect(roadKind(get('cinderCrossing'), 'emberRoad', disc, done)).toBe('open');
    expect(roadKind(get('emberRoad'), 'emberVault', disc, done)).toBe('spur');
    expect(roadKind(get('cinderCrossing'), 'boneApproach', disc, done)).toBe('stub');
    expect(roadKind(get('furnaceYard'), 'shatteredForge', disc, done)).toBe('hidden');
    expect(roadKind(get('cinderCrossing'), 'emberRoad', disc, new Set(['cinderCrossing', 'emberRoad']))).toBe('walked');
    expect(roadKind(get('cinderCrossing'), 'emberRoad', disc, new Set())).toBe('dotted');
  });

  it('shows a plume only for an unrevealed neighbour of a completed area, never for a sealed door', () => {
    const plumes = plumeAreas(new Set(['cinderCrossing', 'emberRoad']), new Set(['cinderCrossing']));
    expect(plumes).toEqual(['boneApproach']);
    expect(plumeAreas(new Set(['cinderCrossing']), new Set())).toEqual([]);
    const all = plumeAreas(new Set(['cinderCrossing']), new Set(['cinderCrossing']));
    for (const id of all) expect(findAtlasArea(id)!.sealed).toBeFalsy();
  });
});
