// Validator check 9 (flow zones, D-territory.md 10.3 / 10.5a): both shipped belt layouts pass it, and each rule can fail on a broken copy.
import { describe, expect, it } from 'vitest';
import { layoutFor } from '../../src/data/layouts';
import { SLAG_YARD } from '../../src/data/layouts/fixtures';
import type { AreaLayout, LayoutFlow } from '../../src/data/layouts/schema';
import { validateLayout } from '../../src/sim/layout-validate';

const check9 = (l: AreaLayout): string[] => validateLayout(l).issues.filter((i) => i.check === 9).map((i) => i.message);

/** SLAG_YARD with a 90 u wide walled belt channel in the south-east quarter (a flat dead end when `capped`). */
function channel(over: { capped: boolean; speed?: number; reverse?: LayoutFlow['reverse']; sense?: LayoutFlow['sense']; path?: LayoutFlow['path'] }): AreaLayout {
  const l = structuredClone(SLAG_YARD);
  l.walls.push(
    { id: 'ch-n', path: [[0.1, 0.46], [0.62, 0.46]], thickness: 24, prop: 'crate' },
    { id: 'ch-s', path: [[0.1, 0.58], [0.62, 0.58]], thickness: 24, prop: 'crate' },
  );
  if (over.capped) l.walls.push({ id: 'ch-cap', path: [[0.62, 0.46], [0.62, 0.58]], thickness: 24, prop: 'crate' });
  l.flows = [{
    id: 'chan', shape: 'band', path: over.path ?? [[0.1, 0.52], [0.6, 0.52]], width: 90, speed: over.speed ?? 50, sense: over.sense ?? 1,
    ...(over.reverse ? { reverse: over.reverse } : {}),
  }];
  return l;
}

describe('check 9: flow zones', () => {
  it('Iron March and Last Kiln pass for both directions of every zone and through a reversal', () => {
    for (const id of ['ironMarch', 'lastKiln'] as const) {
      const l = layoutFor(id)!;
      expect(l.flows?.length).toBeGreaterThan(0);
      expect(check9(l), id).toEqual([]);
    }
  });

  it('a layout without flows has nothing to check', () => {
    expect(check9(SLAG_YARD)).toEqual([]);
  });

  it('control: an open-ended belt channel passes', () => {
    expect(check9(channel({ capped: false }))).toEqual([]);
  });

  it('a belt that carries a body into a dead end it cannot leave against the flow within 3 s fails (both directions are tried)', () => {
    const east = check9(channel({ capped: true }));
    expect(east.some((m) => m.includes('chan') && m.includes('from ground off the belt'))).toBe(true);
    // Run the other way the same channel is a dead end at the west end only if capped there: authored west, the cap is upstream and the open end is the exit.
    const west = check9(channel({ capped: true, sense: -1 }));
    expect(west.length).toBeGreaterThan(0); // the reversed direction (and every scale of the reversal) is tested whatever `sense` says
  });

  it('a belt faster than 66 u/s (it could stop the player) fails', () => {
    expect(check9(channel({ capped: false, speed: 100 })).some((m) => m.includes('speed'))).toBe(true);
  });

  it('a belt outside 0.92 R fails', () => {
    expect(check9(channel({ capped: false, path: [[0.1, 0.9], [0.6, 0.9]] })).some((m) => m.includes('leaves'))).toBe(true);
  });

  it('a belt over the landing fails', () => {
    const l = channel({ capped: false, path: [[-0.2, 0], [0.2, 0]] });
    expect(check9(l).some((m) => m.includes('start clearing'))).toBe(true);
  });

  it('a reversal without room for its telegraph and ramp fails', () => {
    const msgs = check9(channel({ capped: false, reverse: { mode: 'pingpong', every: [5, 8] } }));
    expect(msgs.some((m) => m.includes('telegraph'))).toBe(true);
  });
});
