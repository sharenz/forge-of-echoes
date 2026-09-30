import { describe, expect, it } from 'vitest';
import { ATLAS_AREAS, findAtlasArea } from '../../src/data/progression/atlas';
import { allNodeModels, chartedCount, keyboardOrder, nearestInDirection, nodeModel, type ChartContext } from '../../src/ui/atlas/model';
import { ParticleField } from '../../src/ui/atlas/particles';
import { computeReveal } from '../../src/ui/atlas/reveal';

const ctx = (over: Partial<ChartContext> = {}): ChartContext => ({
  discovered: new Set(['cinderCrossing', 'emberRoad', 'boneApproach', 'sealedReliquary', 'gildedVault']),
  completed: new Set(['cinderCrossing']),
  tier: null,
  keys: new Set(),
  fresh: new Set(),
  corrupted: false,
  ...over,
});
const model = (id: string, c = ctx()) => nodeModel(findAtlasArea(id)!, c);

describe('Atlas node states (brief 5.2)', () => {
  it('tells unknown, available, cleared and sealed apart without text', () => {
    expect(model('furnaceYard').kind).toBe('undiscovered');
    expect(model('furnaceYard').label).toBe('Unexplored area');
    expect(model('emberRoad').kind).toBe('available');
    expect(model('cinderCrossing').kind).toBe('cleared');
    expect(model('sealedReliquary').kind).toBe('sealedLocked');
    expect(model('sealedReliquary', ctx({ keys: new Set(['reliquaryKey']) })).kind).toBe('sealedKeyed');
    expect(model('gildedVault', ctx({ keys: new Set(['reliquaryKey']) })).kind).toBe('sealedLocked');
  });

  it('reports the slotted map against each ceiling: fits, at the ceiling, or too shallow with a reason', () => {
    const fits = model('emberRoad', ctx({ tier: 2 }));
    expect(fits.fits).toBe(true);
    expect(fits.tooShallow).toBe(false);
    expect(fits.blocker).toBeNull();
    expect(model('emberRoad', ctx({ tier: 3 })).atCeiling).toBe(true);
    const shallow = model('cinderCrossing', ctx({ tier: 4 }));
    expect(shallow.tooShallow).toBe(true);
    expect(shallow.blocker).toMatch(/needs an area accepting T4/);
    expect(shallow.status).toBe('Too shallow for T4');
    expect(model('emberRoad').fits).toBe(false);
  });

  it('flags a newly revealed node until it is inspected, and never leaks anything for unknown ones', () => {
    expect(model('emberRoad', ctx({ fresh: new Set(['emberRoad']) })).isNew).toBe(true);
    expect(model('emberRoad').isNew).toBe(false);
    const hidden = model('furnaceYard', ctx({ fresh: new Set(['furnaceYard']) }));
    expect(hidden.isNew).toBe(false);
    expect(hidden.known).toBe(false);
  });

  it('models every area and counts the charted ones', () => {
    expect(allNodeModels(ctx())).toHaveLength(ATLAS_AREAS.length);
    expect(chartedCount(ctx().discovered)).toBe(5);
  });
});

describe('Atlas keyboard order', () => {
  it('walks discovered nodes in graph order and moves focus toward the nearest node in a direction', () => {
    const disc = new Set(['cinderCrossing', 'emberRoad', 'boneApproach', 'furnaceYard']);
    expect(keyboardOrder(disc)[0]).toBe('cinderCrossing');
    expect(keyboardOrder(disc)).toHaveLength(4);
    expect(nearestInDirection('cinderCrossing', 'up', disc)).toBe('emberRoad');
    expect(nearestInDirection('cinderCrossing', 'down', disc)).toBe('boneApproach');
    expect(nearestInDirection('emberRoad', 'right', disc)).toBe('furnaceYard');
    expect(nearestInDirection('furnaceYard', 'up', disc)).toBeNull();
  });
});

describe('Atlas fog reveal', () => {
  const at = (r: { alpha: Uint8Array }, x: number, y: number) => r.alpha[y * 640 + x];
  it('reveals round a disc, leaves everything else under fog, and rims the edge', () => {
    const r = computeReveal({ discs: [{ x: 100, y: 100, r: 60 }], trail: [] });
    expect(at(r, 100, 100)).toBe(255);
    expect(at(r, 500, 300)).toBe(0);
    expect(at(r, 100, 250)).toBe(0);
    let rim = 0;
    for (let i = 0; i < r.rim.length; i++) { if (r.rim[i]) { rim++; expect(r.alpha[i]).toBe(255); } }
    expect(rim).toBeGreaterThan(200);
    expect(computeReveal({ discs: [], trail: [] }).alpha.every((v) => v === 0)).toBe(true);
  });
  it('is deterministic, and a growing disc only ever adds ground', () => {
    const a = computeReveal({ discs: [{ x: 200, y: 120, r: 30 }], trail: [] });
    const b = computeReveal({ discs: [{ x: 200, y: 120, r: 30 }], trail: [] });
    expect(a.alpha).toEqual(b.alpha);
    const big = computeReveal({ discs: [{ x: 200, y: 120, r: 60 }], trail: [] });
    for (let i = 0; i < a.alpha.length; i++) if (a.alpha[i]) expect(big.alpha[i]).toBe(255);
  });
  it('a road trail joins two discs', () => {
    const trail = Array.from({ length: 12 }, (_, i) => ({ x: 100 + i * 8, y: 100, r: 22 }));
    const r = computeReveal({ discs: [{ x: 100, y: 100, r: 30 }, { x: 196, y: 100, r: 30 }], trail });
    expect(at(r, 148, 100)).toBe(255);
  });
});

describe('Atlas particles', () => {
  it('stays inside its cap, is deterministic, and clears when motion is off', () => {
    const run = (): number[] => {
      const f = new ParticleField(60);
      const out: number[] = [];
      for (let i = 0; i < 200; i++) { f.step(0.05, [{ x: 100, y: 200, kind: 'lava' }, { x: 300, y: 100, kind: 'frost' }], () => true, false); out.push(f.list.length); }
      expect(Math.max(...out)).toBeLessThanOrEqual(60);
      return out;
    };
    expect(run()).toEqual(run());
    const f = new ParticleField();
    f.step(1, [{ x: 10, y: 10, kind: 'brazier' }], () => true, false);
    expect(f.list.length).toBeGreaterThan(0);
    f.step(0.1, [], () => true, true);
    expect(f.list).toHaveLength(0);
  });
});
