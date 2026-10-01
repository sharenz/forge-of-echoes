import { describe, expect, it } from 'vitest';
import { gainedKinds, panelHotkey, pointEntries, pointLabel, totalPoints, type PointsInput } from '../../src/ui/lib/points';
import { PANEL_KEYS } from '../../src/ui/lib/keys';

const base: PointsInput = { attribute: 0, skill: 0, atlas: 0, inHideout: true };

describe('unspent point badges', () => {
  it('shows nothing at zero (the badge disappears)', () => {
    expect(pointEntries(base)).toEqual([]);
    expect(totalPoints(base)).toBe(0);
  });

  it('lists attribute then skill then Atlas, only non-zero ones, with the real hotkeys', () => {
    const e = pointEntries({ attribute: 3, skill: 1, atlas: 2, inHideout: true });
    expect(e.map((x) => [x.kind, x.count, x.panel, x.key])).toEqual([
      ['attribute', 3, 'character', 'C'],
      ['skill', 1, 'skills', 'K'],
      ['atlas', 2, 'mapDevice', null],
    ]);
    expect(pointEntries({ ...base, skill: 4 }).map((x) => x.kind)).toEqual(['skill']);
    expect(totalPoints({ attribute: 3, skill: 1, atlas: 2, inHideout: true })).toBe(6);
  });

  it('writes the tooltip from the actual key bindings', () => {
    expect(pointLabel('attribute', 6)).toBe('6 attribute points to spend (C)');
    expect(pointLabel('skill', 1)).toBe('1 skill point to spend (K)');
    expect(pointLabel('atlas', 3)).toBe('3 Atlas tree points to spend at the Cartography Table');
    expect(panelHotkey('character')).toBe(Object.keys(PANEL_KEYS).find((k) => PANEL_KEYS[k] === 'character')?.toUpperCase());
    expect(panelHotkey('stash')).toBeNull();
  });

  it('hides Atlas points away from the hideout', () => {
    expect(pointEntries({ attribute: 0, skill: 0, atlas: 5, inHideout: false })).toEqual([]);
  });

  it('survives junk counts', () => {
    expect(pointEntries({ attribute: -2, skill: Number.NaN, atlas: 2.9, inHideout: true }).map((x) => [x.kind, x.count])).toEqual([['atlas', 2]]);
  });

  it('flourishes only when a count rises after the first look', () => {
    const a: PointsInput = { attribute: 0, skill: 0, atlas: 0, inHideout: true };
    expect(gainedKinds(null, { ...a, attribute: 3, skill: 1 })).toEqual([]); // loading a character / reconnecting
    expect(gainedKinds(a, { ...a, attribute: 3, skill: 1 })).toEqual(['attribute', 'skill']); // level-up
    expect(gainedKinds({ ...a, attribute: 3, skill: 1 }, { ...a, attribute: 2, skill: 1 })).toEqual([]); // spending
    expect(gainedKinds(a, { ...a, atlas: 1 })).toEqual(['atlas']);
  });
});
