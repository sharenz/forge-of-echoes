// The guide's world layer logic (src/ui/guide/world.ts): name plates, marker anchors, the off-screen edge arrow.
import { describe, expect, it } from 'vitest';
import type { WorldAnchor } from '../../src/contracts/guide';
import { edgePoint, inside, pickAnchor, platePosition, plateKinds, visibleRect, type PlateInput } from '../../src/ui/guide/geometry';

const base: PlateInput = { active: true, zone: 'hideout', ownHideout: true, used: [], cleared: false, chest: null, marker: null };
const anchor = (kind: WorldAnchor['kind'], x: number, y: number, state = 0, height = 40): WorldAnchor => ({ id: x, kind, x, y, state, radius: 20, height });

describe('plateKinds', () => {
  it('names the four hideout objects for a new player and fades each one once used', () => {
    expect(plateKinds(base)).toEqual(['mapDevice', 'stash', 'anvil', 'merchant']);
    expect(plateKinds({ ...base, used: ['mapDevice', 'anvil'] })).toEqual(['stash', 'merchant']);
  });
  it('shows nothing for a guide that is off, and nothing in somebody else\'s hideout', () => {
    expect(plateKinds({ ...base, active: false })).toEqual([]);
    expect(plateKinds({ ...base, ownHideout: false })).toEqual([]);
  });
  it('labels the reward chest and the return portal on a cleared map, the chest only while closed', () => {
    const map = { ...base, zone: 'map' as const, cleared: true, chest: 'closed' as const };
    expect(plateKinds(map)).toEqual(['chest', 'returnPortal']);
    expect(plateKinds({ ...map, chest: 'open' })).toEqual(['returnPortal']);
    expect(plateKinds({ ...map, cleared: false })).toEqual([]);
  });
  it('the marker\'s own prop always has a plate, even when used or the guide is off (a What-next row)', () => {
    expect(plateKinds({ ...base, active: false, marker: 'anvil' })).toEqual(['anvil']);
    expect(plateKinds({ ...base, used: ['mapDevice'], marker: 'mapDevice' })).toEqual(['stash', 'anvil', 'merchant', 'mapDevice']);
    expect(plateKinds({ ...base, marker: 'portal' })).not.toContain('portal');
  });
});

describe('geometry', () => {
  const rect = visibleRect(1280, 720, 128);
  it('the visible rect leaves the margins and the command deck out', () => {
    expect(rect).toEqual({ left: 12, top: 64, right: 1268, bottom: 592 });
    expect(inside(rect, 640, 300)).toBe(true);
    expect(inside(rect, 640, 650)).toBe(false);
    expect(inside(rect, 5, 300)).toBe(false);
  });
  it('puts the edge arrow on the border towards an off-screen target', () => {
    const up = edgePoint(rect, 640, -400);
    expect(up.y).toBeCloseTo(rect.top, 5);
    expect(up.angle).toBeCloseTo(-Math.PI / 2, 5);
    const right = edgePoint(rect, 3000, 328);
    expect(right.x).toBeCloseTo(rect.right, 5);
    expect(right.angle).toBeCloseTo(0, 5);
    const corner = edgePoint(rect, 3000, 3000);
    expect(corner.x <= rect.right + 1e-6 && corner.y <= rect.bottom + 1e-6).toBe(true);
  });
  it('never clips a name plate at the top edge', () => {
    const p = platePosition({ x: 640, y: 20, height: 50 }, 1280, 120, 24);
    expect(p.y).toBeGreaterThanOrEqual(24);
    const left = platePosition({ x: 2, y: 400, height: 40 }, 1280, 120, 24);
    expect(left.x).toBeGreaterThanOrEqual(24 + 60);
  });
  it('finds the marker\'s anchor (an opened chest is not a target)', () => {
    const list = [anchor('stash', 1, 1), anchor('chest', 2, 2, 1), anchor('chest', 3, 3, 0), anchor('mapDevice', 4, 4)];
    expect(pickAnchor(list, 'chest')?.id).toBe(3);
    expect(pickAnchor(list, 'mapDevice')?.id).toBe(4);
    expect(pickAnchor(list, 'portal')).toBeNull();
  });
});
