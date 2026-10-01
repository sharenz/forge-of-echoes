import { describe, expect, it } from 'vitest';
import {
  choosePixelScale, computeViewport, resolveCamera, screenToWorld, snapRotatedPivot, snapRotation, snapToPixel,
  worldToScreen,
} from '../../src/render/viewport';

describe('pixel scale and virtual resolution', () => {
  it('picks the integer scale whose virtual height is closest to 360', () => {
    expect(choosePixelScale(720)).toBe(2);
    expect(choosePixelScale(1080)).toBe(3);
    expect(choosePixelScale(1440)).toBe(4);
    expect(choosePixelScale(2160)).toBe(6);
    expect(choosePixelScale(900)).toBe(3); // 300 is closer (in ratio) than 450
    expect(choosePixelScale(800)).toBe(2);
    expect(choosePixelScale(360)).toBe(1);
    expect(choosePixelScale(200)).toBe(1);
    expect(choosePixelScale(0)).toBe(1);
  });

  it('computes 640x360 at 1280x720 and 1920x1080', () => {
    const a = computeViewport(1280, 720, 1);
    expect([a.pixelScale, a.viewWidth, a.viewHeight, a.offsetX, a.offsetY]).toEqual([2, 640, 360, 0, 0]);
    expect([a.targetWidth, a.targetHeight]).toEqual([641, 361]);
    const b = computeViewport(1920, 1080, 1);
    expect([b.pixelScale, b.viewWidth, b.viewHeight]).toEqual([3, 640, 360]);
  });

  it('accounts for devicePixelRatio', () => {
    const v = computeViewport(1280, 720, 2);
    expect([v.deviceWidth, v.deviceHeight, v.pixelScale, v.viewWidth, v.viewHeight, v.dpr]).toEqual([2560, 1440, 4, 640, 360, 2]);
    const f = computeViewport(1000, 700, 1.25);
    expect(f.deviceWidth).toBe(1250);
    expect(f.deviceHeight).toBe(875);
    expect(f.dpr).toBeCloseTo(1.25);
  });

  it('covers odd sizes with a centred overhang smaller than one virtual pixel', () => {
    const v = computeViewport(1001, 721, 1);
    expect(v.pixelScale).toBe(2);
    expect(v.viewWidth * v.pixelScale).toBeGreaterThanOrEqual(1001);
    expect(v.viewHeight * v.pixelScale).toBeGreaterThanOrEqual(721);
    expect(v.offsetX).toBeLessThanOrEqual(0);
    expect(v.offsetX).toBeGreaterThan(-v.pixelScale);
    expect(v.offsetY).toBeLessThanOrEqual(0);
  });

  it('guards against degenerate input', () => {
    const v = computeViewport(0, -5, NaN);
    expect(v.deviceWidth).toBeGreaterThanOrEqual(1);
    expect(v.pixelScale).toBe(1);
    expect(v.dpr).toBe(1);
  });
});

describe('camera', () => {
  const vp = computeViewport(1280, 720, 1); // scale 2, view 640x360

  it('splits the camera into an integer origin and a device-quantised fraction', () => {
    const c = resolveCamera({ x: 100.3, y: -50.8, zoom: 1 }, vp);
    expect(Number.isInteger(c.originX)).toBe(true);
    expect(Number.isInteger(c.originY)).toBe(true);
    expect(c.fracX).toBeGreaterThanOrEqual(0);
    expect(c.fracX).toBeLessThan(1);
    expect((c.fracX * vp.pixelScale) % 1).toBe(0);
    expect(c.originX + c.fracX).toBeCloseTo(100.3 - 320, 0);
    // Carry: 0.8 at scale 2 rounds to a full pixel.
    const k = resolveCamera({ x: 0.8, y: 0, zoom: 1 }, vp);
    expect(k.fracX).toBe(0);
    expect(k.originX).toBe(1 - 320);
  });

  it('includes shake and zoom', () => {
    const a = resolveCamera({ x: 10, y: 10, zoom: 1, shakeX: 3, shakeY: -2 }, vp);
    expect(a.originX + a.fracX).toBeCloseTo(13 - 320);
    expect(a.originY + a.fracY).toBeCloseTo(8 - 180);
    const z = resolveCamera({ x: 10, y: 10, zoom: 2 }, vp);
    expect(z.zoom).toBe(2);
    expect(z.originX + z.fracX).toBeCloseTo(20 - 320);
  });

  it('maps the camera centre to the canvas centre', () => {
    const cam = { x: 123.4, y: -77.7, zoom: 1 };
    const s = worldToScreen(vp, cam, cam.x, cam.y);
    expect(s.x).toBeCloseTo(640, 0);
    expect(s.y).toBeCloseTo(360, 0);
  });

  it('round-trips screen ↔ world', () => {
    for (const cam of [
      { x: 0, y: 0, zoom: 1 },
      { x: 311.37, y: -92.5, zoom: 1 },
      { x: -40.1, y: 5.9, zoom: 2 },
    ]) {
      for (const [sx, sy] of [[0, 0], [640, 360], [1279, 719], [17.5, 402.25]]) {
        const w = screenToWorld(vp, cam, sx, sy);
        const back = worldToScreen(vp, cam, w.x, w.y);
        expect(back.x).toBeCloseTo(sx, 6);
        expect(back.y).toBeCloseTo(sy, 6);
      }
    }
  });

  it('agrees with dpr scaling', () => {
    const hi = computeViewport(1280, 720, 2);
    const cam = { x: 50, y: 50, zoom: 1 };
    const a = worldToScreen(vp, cam, 80, 20);
    const b = worldToScreen(hi, cam, 80, 20);
    expect(b.x).toBeCloseTo(a.x, 0);
    expect(b.y).toBeCloseTo(a.y, 0);
  });

  it('keeps one world pixel exactly pixelScale device pixels wide', () => {
    const cam = { x: 10.25, y: 3.5, zoom: 1 };
    const a = worldToScreen(vp, cam, 100, 0);
    const b = worldToScreen(vp, cam, 101, 0);
    expect((b.x - a.x) * vp.dpr).toBeCloseTo(vp.pixelScale, 9);
    // Pixel edges land on whole device pixels (the sub-pixel camera shift is quantised to device pixels).
    expect(Math.abs(a.x * vp.dpr - Math.round(a.x * vp.dpr))).toBeLessThan(1e-9);
  });
});

describe('exact device box', () => {
  it('uses the reported device-pixel box instead of rounding css × dpr', () => {
    // 1001 × 1.25 = 1251.25 → the estimate is 1251, but the laid-out box may really be 1252 px.
    const est = computeViewport(1001, 701, 1.25);
    expect([est.deviceWidth, est.deviceHeight]).toEqual([1251, 876]);
    const exact = computeViewport(1001, 701, 1.25, undefined, { width: 1252, height: 877 });
    expect([exact.deviceWidth, exact.deviceHeight]).toEqual([1252, 877]);
    expect(exact.dpr).toBeCloseTo(1252 / 1001, 9);
    expect(exact.viewWidth * exact.pixelScale).toBeGreaterThanOrEqual(1252);
  });
});

describe('snapToPixel (follow camera)', () => {
  it('returns the position where the renderer draws a sprite pivot', () => {
    expect(snapToPixel(10.4)).toBe(10);
    expect(snapToPixel(10.6)).toBe(11);
    expect(snapToPixel(-3.2)).toBe(-3);
    expect(snapToPixel(10.3, 2)).toBe(10.5); // zoom 2: half-unit world grid
    // Fractional anchors snap the quad corner: pivot = round(v − a) + a.
    expect(snapToPixel(10.2, 1, 4.5)).toBe(10.5);
    expect(snapToPixel(10.9, 1, 4.5)).toBe(10.5);
  });

  it('keeps a followed sprite fixed on screen while it moves at any speed', () => {
    // The sprite's on-screen x = snappedCorner − cameraOrigin. With camera = snapToPixel(p) + lag (lag fixed),
    // the difference must stay constant for every sub-pixel position of the player.
    const vp = computeViewport(1280, 720, 1);
    const lag = 3.37;
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const p = 100 + i * 0.137; // ~8 px/frame at 60 fps, irregular sub-pixel phase
      const cam = resolveCamera({ x: snapToPixel(p) + lag, y: 0, zoom: 1 }, vp);
      const corner = Math.round(p * cam.zoom - cam.originX); // what sprite() writes (integer anchor)
      seen.add(Math.round((corner - cam.fracX) * 1000));
    }
    expect(seen.size).toBe(1);
  });

  it('would jitter by a whole pixel with a camera on the raw position (the pitfall it prevents)', () => {
    const vp = computeViewport(1280, 720, 1);
    const offsets = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const p = 100 + i * 0.137;
      const cam = resolveCamera({ x: p + 3.37, y: 0, zoom: 1 }, vp);
      offsets.add(Math.round((Math.round(p - cam.originX) - cam.fracX) * 1000));
    }
    expect(offsets.size).toBeGreaterThan(1);
  });
});

describe('rotated sprite placement', () => {
  /**
   * Simulate the sprite shader: a pixel centre c maps to quad-local texel coordinates
   * local = R⁻¹(c − pivot) + anchor. Returns how often each texel is sampled and the worst distance of a
   * sample from its texel centre.
   */
  function sample(w: number, h: number, ax: number, ay: number, rot: number, px: number, py: number) {
    const p = snapRotatedPivot(px, py, ax, ay, rot, { x: 0, y: 0 });
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const hits = new Uint32Array(w * h);
    let worst = 0;
    const r = Math.ceil(Math.hypot(w, h)) + 2;
    for (let n = Math.floor(p.y) - r; n <= Math.floor(p.y) + r; n++) {
      for (let m = Math.floor(p.x) - r; m <= Math.floor(p.x) + r; m++) {
        const dx = m + 0.5 - p.x;
        const dy = n + 0.5 - p.y;
        const lx = c * dx + s * dy + ax;
        const ly = -s * dx + c * dy + ay;
        if (lx < 0 || ly < 0 || lx >= w || ly >= h) continue;
        hits[Math.floor(ly) * w + Math.floor(lx)]++;
        worst = Math.max(worst, Math.abs((lx % 1) - 0.5), Math.abs((ly % 1) - 0.5));
      }
    }
    return { hits, worst };
  }

  it('maps every pixel centre onto a texel centre at quarter turns (no dropped or doubled rows)', () => {
    const sizes: [number, number, number, number][] = [
      [9, 9, 4.5, 4.5], // odd, centred half-pixel anchor (the reviewer's orb)
      [9, 9, 4, 4], // odd, integer anchor (generated art: floor(w / 2))
      [14, 5, 10, 2.5],
      [24, 23, 12, 22],
      [8, 6, 4, 3],
    ];
    for (const [w, h, ax, ay] of sizes) {
      for (const rot of [0, Math.PI / 2, Math.PI, -Math.PI / 2, (3 * Math.PI) / 2]) {
        for (const [px, py] of [[50, 50], [50.3, 49.7], [50.5, 50.5], [50.49, 50.51], [49.77, 50.12]]) {
          const { hits, worst } = sample(w, h, ax, ay, rot, px, py);
          expect(worst).toBeLessThan(1e-6);
          expect(Array.from(hits).every((k) => k === 1)).toBe(true);
        }
      }
    }
  });

  it('matches the unrotated placement for angles a hair off zero', () => {
    const out = { x: 0, y: 0 };
    for (const [px, py, ax, ay] of [[50.49, 50.51, 4.5, 4.5], [10.2, 7.7, 4, 4], [3.5, 3.5, 10, 2.5]]) {
      snapRotatedPivot(px, py, ax, ay, 1e-6, out);
      expect(out.x).toBeCloseTo(Math.round(px - ax) + ax, 4);
      expect(out.y).toBeCloseTo(Math.round(py - ay) + ay, 4);
    }
  });

  it('quantises rotation to the angular pixel resolution, keeping quarter turns exact', () => {
    expect(snapRotation(1e-4, 10)).toBe(0);
    expect(snapRotation(Math.PI / 2 + 0.01, 10)).toBe(Math.PI / 2);
    expect(snapRotation(-Math.PI / 2, 10)).toBe(Math.PI * 1.5);
    expect(snapRotation(Math.PI * 2 - 1e-3, 10)).toBe(0);
    expect(snapRotation(Number.NaN, 10)).toBe(0);
    // Step ≈ 1/radius: the farthest pixel moves about one pixel per step.
    const r = 20;
    const a = snapRotation(0.3, r);
    const b = snapRotation(0.3 + 1.2 / r, r);
    expect(b - a).toBeGreaterThan(0);
    expect((b - a) * r).toBeLessThan(2.1);
    expect(Math.abs(a - 0.3) * r).toBeLessThanOrEqual(0.5 + 1e-9);
    // Tiny sprites are left alone.
    expect(snapRotation(0.123, 0.4)).toBe(0.123);
  });
});
