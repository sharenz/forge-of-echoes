// The guide's window on the world (src/client/guide-world.ts): which props get an anchor, in CSS px, scaled by the projection.
import { describe, expect, it } from 'vitest';
import type { PropView } from '../../src/contracts/sim';
import { ANCHOR_SIZES, HIDEOUT_CAMERA_BIAS_Y, buildAnchors } from '../../src/client/guide-world';

const prop = (id: number, kind: PropView['kind'], x: number, y: number, state = 0): PropView => ({ id, kind, x, y, radius: 10, state, variant: 0, interactive: true });
// 2 px per world unit, origin at (100, 50)
const project = (x: number, y: number) => ({ x: 100 + x * 2, y: 50 + y * 2 });

describe('buildAnchors', () => {
  it('anchors the hideout objects, portals and the chest, ignoring decor', () => {
    const list = buildAnchors([prop(1, 'mapDevice', 0, -130), prop(2, 'pillar', 5, 5), prop(3, 'stash', -150, 0), prop(4, 'chest', 20, 20)], project);
    expect(list.map((a) => a.kind)).toEqual(['mapDevice', 'stash', 'chest']);
    expect(list[0]).toMatchObject({ id: 1, x: 100, y: -210 });
  });
  it('scales the footprint and the sprite height by the projection', () => {
    const [a] = buildAnchors([prop(1, 'mapDevice', 0, 0)], project);
    expect(a.radius).toBeCloseTo(ANCHOR_SIZES.mapDevice!.radius * 2, 5);
    expect(a.height).toBeCloseTo(ANCHOR_SIZES.mapDevice!.height * 2, 5);
  });
  it('skips a closed portal and keeps an open one with its remaining count', () => {
    const list = buildAnchors([prop(1, 'portal', 0, 0, 0), prop(2, 'portal', 10, 0, 7), prop(3, 'returnPortal', 0, 0, 1)], project);
    expect(list.map((a) => [a.id, a.state])).toEqual([[2, 7], [3, 1]]);
  });
  it('reuses the output array (the UI reads it every frame)', () => {
    const out = [] as ReturnType<typeof buildAnchors>;
    expect(buildAnchors([prop(1, 'anvil', 0, 0)], project, out)).toBe(out);
    expect(buildAnchors([], project, out)).toHaveLength(0);
  });
  it('leans the hideout camera north', () => {
    expect(HIDEOUT_CAMERA_BIAS_Y).toBeLessThan(0);
  });
});
