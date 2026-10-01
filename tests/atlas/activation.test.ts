import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PortalInfo } from '../../src/contracts/net';
import { isNewActivation, portalOpen, portalSig } from '../../src/ui/atlas/activation';
import { MOTION_LABEL, isCalm, nextPref, readMotionPref, writeMotionPref } from '../../src/ui/atlas/motion';
import { CHART_H, CHART_W } from '../../src/art/atlas/geometry';
import { fillZoom } from '../../src/ui/atlas/model';

const portal = (over: Partial<PortalInfo> = {}): PortalInfo => ({ ownerCharacterId: 'c1', ownerName: 'Me', mapName: 'Weeping Crypt', tier: 4, remaining: 8, total: 8, cleared: false, ...over });

describe('Activation detection', () => {
  it('treats a fresh portal as a new activation, and a part-used one as not', () => {
    expect(isNewActivation(null, portal())).toBe(true);
    expect(isNewActivation(null, portal({ remaining: 7 }))).toBe(false);
    expect(isNewActivation(null, null)).toBe(false);
    expect(isNewActivation(portal(), null)).toBe(false);
  });
  it('sees another map or a refilled counter, but not a portal being used', () => {
    expect(isNewActivation(portal({ remaining: 3 }), portal())).toBe(true);
    expect(isNewActivation(portal(), portal({ mapName: 'Bone Halls' }))).toBe(true);
    expect(isNewActivation(portal(), portal({ tier: 5 }))).toBe(true);
    expect(isNewActivation(portal(), portal({ remaining: 7 }))).toBe(false);
    expect(isNewActivation(portal(), portal({ remaining: 0, cleared: true }))).toBe(false);
  });
  it('knows an open portal from a spent one and gives it a stable identity', () => {
    expect(portalOpen(portal())).toBe(true);
    expect(portalOpen(portal({ remaining: 0 }))).toBe(false);
    expect(portalOpen(portal({ cleared: true }))).toBe(false);
    expect(portalOpen(null)).toBe(false);
    expect(portalSig(portal())).toBe(portalSig(portal({ remaining: 2 })));
    expect(portalSig(portal())).not.toBe(portalSig(portal({ tier: 9 })));
  });
});

describe('Calm motion setting', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
  });
  afterEach(() => vi.unstubAllGlobals());
  it('follows the system unless the viewer chooses', () => {
    expect(readMotionPref()).toBe('auto');
    expect(isCalm('auto', true)).toBe(true);
    expect(isCalm('auto', false)).toBe(false);
    expect(isCalm('calm', false)).toBe(true);
    expect(isCalm('full', true)).toBe(false);
  });
  it('remembers the choice and cycles system, calm, full', () => {
    writeMotionPref('calm');
    expect(readMotionPref()).toBe('calm');
    writeMotionPref('full');
    expect(readMotionPref()).toBe('full');
    writeMotionPref('auto');
    expect(store.has('foe.atlas.motion.v1')).toBe(false);
    expect([nextPref('auto'), nextPref('calm'), nextPref('full')]).toEqual(['calm', 'full', 'auto']);
    expect(Object.keys(MOTION_LABEL)).toEqual(['auto', 'calm', 'full']);
  });
  it('survives storage that throws', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } });
    expect(readMotionPref()).toBe('auto');
    expect(() => writeMotionPref('calm')).not.toThrow();
  });
});

describe('Chart fills the viewport (no black void)', () => {
  it('picks the smallest whole zoom that covers the view', () => {
    expect(fillZoom(CHART_W, CHART_H)).toBe(1);
    expect(fillZoom(500, 300)).toBe(1);
    // the 1280x720 and 1024x600 table viewports: the chart at 1x (640x360) would float, so 2x
    expect(fillZoom(934, 514)).toBe(2);
    // beside the inventory: the chart viewport at 1280x720 and at 1024x600 (the table is 100vw - panel - 36 px wide)
    expect(fillZoom(768, 480)).toBe(2);
    expect(fillZoom(560, 440)).toBe(2);
    expect(fillZoom(1000, 424)).toBe(2);
    expect(fillZoom(1280, 720)).toBe(2);
    expect(fillZoom(1281, 720)).toBe(3);
    expect(fillZoom(1900, 1000)).toBe(3);
    expect(fillZoom(4000, 2000)).toBe(3);
  });
  it('always returns a zoom whose chart covers the view, up to the 3x limit', () => {
    for (let w = 320; w <= 1920; w += 160) for (let h = 240; h <= 1080; h += 120) {
      const z = fillZoom(w, h);
      if (z < 3) expect(CHART_W * z >= w && CHART_H * z >= h).toBe(true);
    }
  });
});
