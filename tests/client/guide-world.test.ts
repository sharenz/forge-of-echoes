// The guide's window on the world (src/client/guide-world.ts): which props get an anchor, in CSS px, scaled by the projection.
import { describe, expect, it } from 'vitest';
import type { PropView } from '../../src/contracts/sim';
import { ANCHOR_SIZES, HIDEOUT_CAMERA_BIAS_Y, buildAnchors, hideoutCameraBias } from '../../src/client/guide-world';
import { HIDEOUT_ARENA_RADIUS } from '../../src/data/progression/maps';

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

// A model of the hideout at a 1024x600 window (dpr 1: 2 CSS px per world unit, a 512x300 world view) with the player at the spawn
// and the cursor on them (no look-ahead). Props from sim/props.ts layoutHideout; the HUD from tokens.css / hud.css at the short tier
// (Life globe 92 px plus an 8 px rim, 8 px off the bottom, its left edge 340 px left of the centre: measured on the e2e screenshot).
describe('hideout framing at 1024x600', () => {
  const R = HIDEOUT_ARENA_RADIUS;
  const W = 1024, H = 600, S = 2;
  const bias = hideoutCameraBias(H);
  const cam = { x: 0 + bias.x, y: R * 0.12 - 6 + bias.y };
  const css = (x: number, y: number) => ({ x: W / 2 + (x - cam.x) * S, y: H / 2 + (y - cam.y) * S });
  const globe = { cx: W / 2 - 340 + 54, cy: H - 8 - 46, r: 54 };

  it('keeps the whole Map Device (and its marker) on screen', () => {
    const base = css(0, -R * 0.5);
    expect(base.y - ANCHOR_SIZES.mapDevice!.height * S).toBeGreaterThan(8);
  });
  it('keeps the anvil (the Crafting Bench) clear of the Life globe and above the deck', () => {
    const base = css(-R * 0.5, R * 0.22);
    // the anvil sprite: about 40 px either side of its base, 70 px tall, its foot 8 px below the base
    const rect = { l: base.x - 40, r: base.x + 40, t: base.y - 70, b: base.y + 8 };
    const nx = Math.max(rect.l, Math.min(globe.cx, rect.r)), ny = Math.max(rect.t, Math.min(globe.cy, rect.b));
    expect(Math.hypot(nx - globe.cx, ny - globe.cy)).toBeGreaterThan(globe.r);
    expect(rect.l).toBeGreaterThan(0);
  });
  it('keeps Rook, the stash and their name plates inside the window', () => {
    for (const [x, y] of [[R * 0.6, 0], [-R * 0.6, 0]]) {
      const p = css(x, y);
      expect(p.x - 60).toBeGreaterThan(0);
      expect(p.x + 60).toBeLessThan(W);
    }
  });
  it('leans only north in a tall window', () => {
    expect(hideoutCameraBias(720)).toEqual({ x: 0, y: HIDEOUT_CAMERA_BIAS_Y });
  });
});
