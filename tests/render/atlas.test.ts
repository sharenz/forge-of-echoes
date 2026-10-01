import { describe, expect, it } from 'vitest';
import { AtlasStore, SkylinePacker } from '../../src/render/atlas';

function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Placed {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlaps(a: Placed, b: Placed, pad: number): boolean {
  // Padded rectangles must not intersect: frames keep `pad` transparent pixels on each side.
  return a.x - pad < b.x + b.w + pad && b.x - pad < a.x + a.w + pad && a.y - pad < b.y + b.h + pad && b.y - pad < a.y + a.h + pad;
}

describe('SkylinePacker', () => {
  it('packs many rectangles without overlap and inside the page', () => {
    const packer = new SkylinePacker(256, 256, 1);
    const rnd = prng(7);
    const placed: Placed[] = [];
    for (let i = 0; i < 400; i++) {
      const w = 2 + Math.floor(rnd() * 24);
      const h = 2 + Math.floor(rnd() * 30);
      const r = packer.insert(w, h);
      if (!r) continue;
      placed.push({ x: r.x, y: r.y, w, h });
    }
    expect(placed.length).toBeGreaterThan(80);
    for (const p of placed) {
      expect(p.x).toBeGreaterThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(1);
      expect(p.x + p.w + 1).toBeLessThanOrEqual(256);
      expect(p.y + p.h + 1).toBeLessThanOrEqual(256);
    }
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        // Padded boxes (1px each side) may touch but never overlap.
        expect(overlaps(placed[i], placed[j], 1)).toBe(false);
      }
    }
  });

  it('keeps at least 2px between neighbouring frames (1px padding each)', () => {
    const packer = new SkylinePacker(64, 64, 1);
    const a = packer.insert(10, 10)!;
    const b = packer.insert(10, 10)!;
    const gapX = Math.abs(b.x - a.x) - 10;
    const gapY = Math.abs(b.y - a.y) - 10;
    expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(2);
  });

  it('rejects rectangles that cannot fit and reports occupancy', () => {
    const packer = new SkylinePacker(32, 32, 1);
    expect(packer.insert(31, 4)).toBeNull();
    expect(packer.insert(30, 30)).not.toBeNull();
    expect(packer.insert(4, 4)).toBeNull();
    expect(packer.occupancy).toBeGreaterThan(0.99);
  });

  it('fills a page densely with equal tiles', () => {
    const packer = new SkylinePacker(128, 128, 1);
    let n = 0;
    while (packer.insert(16, 16)) n++;
    // 18px padded cells: 7 x 7 = 49 fit in 128px.
    expect(n).toBe(49);
  });
});

describe('AtlasStore', () => {
  const img = (w: number, h: number, v: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4).fill(v) });

  it('opens a new page when the current one is full', () => {
    const atlas = new AtlasStore(64, 1);
    const slots = [];
    for (let i = 0; i < 5; i++) slots.push(atlas.allocate(30, 30));
    expect(atlas.pages.length).toBe(2);
    expect(slots.slice(0, 4).every((s) => s.page === 0)).toBe(true);
    expect(slots[4].page).toBe(1);
  });

  it('throws for frames larger than a page', () => {
    const atlas = new AtlasStore(64, 1);
    expect(() => atlas.allocate(80, 8)).toThrow(/exceeds/);
  });

  it('blits albedo and emissive into aligned positions of separate layers', () => {
    const atlas = new AtlasStore(32, 1);
    const slot = atlas.allocate(3, 2);
    atlas.blit(slot, img(3, 2, 200), 'albedo');
    atlas.blit(slot, img(3, 2, 90), 'emissive');
    const page = atlas.pages[0];
    const at = (buf: Uint8Array, x: number, y: number) => buf[((slot.y + y) * 32 + slot.x + x) * 4];
    expect(at(page.albedo, 0, 0)).toBe(200);
    expect(at(page.albedo, 2, 1)).toBe(200);
    expect(at(page.emissive, 1, 1)).toBe(90);
    // Padding stays transparent.
    expect(page.albedo[((slot.y - 1) * 32 + slot.x) * 4 + 3]).toBe(0);
    expect(page.albedo[((slot.y + 2) * 32 + slot.x) * 4 + 3]).toBe(0);
    expect(page.dirty).toBe(true);
  });

  it('reports which frame sizes fit on a page', () => {
    const atlas = new AtlasStore(64, 1);
    expect(atlas.fits(62, 62)).toBe(true);
    expect(atlas.fits(63, 8)).toBe(false);
    expect(atlas.fits(0, 8)).toBe(false);
  });

  it('recycles released slots for frames of exactly the same size, cleared', () => {
    const atlas = new AtlasStore(64, 1);
    const a = atlas.allocate(10, 12);
    atlas.blit(a, img(10, 12, 200), 'albedo');
    atlas.blit(a, img(10, 12, 90), 'emissive');
    atlas.release(a, 10, 12);
    expect(atlas.freeSlots).toBe(1);
    const page = atlas.pages[0];
    const at = (buf: Uint8Array, x: number, y: number) => buf[((a.y + y) * 64 + a.x + x) * 4 + 3];
    expect(at(page.albedo, 3, 3)).toBe(0);
    expect(at(page.emissive, 9, 11)).toBe(0);
    // A different size does not take the slot; the same size does.
    const other = atlas.allocate(12, 10);
    expect(other.x !== a.x || other.y !== a.y).toBe(true);
    expect(atlas.freeSlots).toBe(1);
    const again = atlas.allocate(10, 12);
    expect(again).toEqual(a);
    expect(atlas.freeSlots).toBe(0);
  });

  it('does not grow when the same sprites are registered again and again', () => {
    // Mirrors the renderer's re-registration path: release old slots, then allocate the new frames.
    const atlas = new AtlasStore(128, 1);
    let slots = Array.from({ length: 20 }, () => atlas.allocate(16, 16));
    for (let round = 0; round < 50; round++) {
      for (const s of slots) atlas.release(s, 16, 16);
      slots = slots.map(() => atlas.allocate(16, 16));
    }
    expect(atlas.pages.length).toBe(1);
    expect(atlas.freeSlots).toBe(0);
  });

  it('clears one layer of a region', () => {
    const atlas = new AtlasStore(32, 1);
    const slot = atlas.allocate(4, 4);
    atlas.blit(slot, img(4, 4, 77), 'emissive');
    atlas.clear(slot, 4, 4, 'emissive');
    const page = atlas.pages[0];
    expect(page.emissive.some((v) => v !== 0)).toBe(false);
  });
});
