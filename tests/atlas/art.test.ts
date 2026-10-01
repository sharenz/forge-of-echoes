import { beforeAll, describe, expect, it } from 'vitest';
import type { SpriteDef } from '../../src/contracts/art';
import { generateSprites } from '../../src/art';
import { bakeChart, bakeChartSteps, REGION_INDEX, type ChartLayers } from '../../src/art/atlas/ground';
import { ATLAS_POS, CHART_H, CHART_W, KEY_COLOUR, MATERIALS, THEMES, regionOf } from '../../src/art/atlas/geometry';
import { crownFrame, doorFrame, haloRaster, lanternFrame, newFlagFrame, nodeFrame, pipFrame, plateFrame, plumeFrame, sealFrame, tearMask } from '../../src/art/atlas/plates';
import { emblem } from '../../src/art/atlas/emblems';
import { paintRoad, octagonPixels } from '../../src/art/atlas/roads';
import { roadPoints } from '../../src/art/atlas/geometry';
import { hexToColor } from '../../src/art/palette';
import { Raster } from '../../src/art/raster';
import { ATLAS_AREAS } from '../../src/data/progression/atlas';

const hash = (d: Uint8ClampedArray): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
};
const themes = Object.keys(THEMES) as (keyof typeof THEMES)[];

describe('Atlas plates, emblems and furniture', () => {
  it('draws a plate for every material x theme, deterministically, with a visible silhouette', () => {
    const seen = new Set<number>();
    for (const m of MATERIALS) for (const t of themes) {
      const a = nodeFrame(m, 2, t), b = nodeFrame(m, 2, t);
      expect(hash(a.c.data)).toBe(hash(b.c.data));
      expect(a.c.isEmpty()).toBe(false);
      seen.add(hash(a.c.data));
    }
    expect(seen.size).toBe(MATERIALS.length * themes.length);
  });

  it('fills an octagonal plate inside its 42 px canvas and leaves the corners clear', () => {
    const f = plateFrame('gilt', 1, 'ashenForge');
    expect(f.w).toBe(42);
    expect(f.c.opaque(21, 21)).toBe(true);
    expect(f.c.opaque(1, 1)).toBe(false);
    expect(f.c.opaque(40, 40)).toBe(false);
  });

  it('gives the ember and void plates emissive fissures, and iron and bronze none', () => {
    expect(plateFrame('ember', 1, 'ashenForge').e.isEmpty()).toBe(false);
    expect(plateFrame('void', 1, 'ashenForge').e.isEmpty()).toBe(false);
    // studs never glow on the cold materials
    expect(plateFrame('iron', 1, 'ashenForge').e.opaque(21, 5)).toBe(true); // tier rivet glint only
  });

  it('one rivet more per tier inside a band', () => {
    const count = (n: number): number => { const f = plateFrame('iron', n, 'ashenForge'); let k = 0; for (let x = 12; x < 30; x++) if (f.e.opaque(x, 5)) k++; return k; };
    expect(count(3)).toBeGreaterThan(count(1));
  });

  it('paints six distinct 24x24 theme emblems', () => {
    const hashes = new Set<number>();
    for (const t of themes) {
      const e = emblem(t);
      expect([e.w, e.h]).toEqual([24, 24]);
      let opaque = 0;
      for (let i = 3; i < e.c.data.length; i += 4) if (e.c.data[i]) opaque++;
      expect(opaque, t).toBeGreaterThan(140);
      hashes.add(hash(e.c.data));
    }
    expect(hashes.size).toBe(6);
  });

  it('draws a locked and an ajar door per key colour, and small furniture that is never empty', () => {
    for (const col of Object.values(KEY_COLOUR)) {
      const locked = doorFrame(hexToColor(col), false), ajar = doorFrame(hexToColor(col), true);
      expect([locked.w, locked.h]).toEqual([40, 48]);
      expect(hash(locked.c.data)).not.toBe(hash(ajar.c.data));
      expect(ajar.e.isEmpty()).toBe(false);
    }
    for (const f of [crownFrame(), pipFrame(true, 'gilt'), pipFrame(false, 'iron'), sealFrame(), newFlagFrame(), plumeFrame(0), plumeFrame(3), lanternFrame(0), lanternFrame(1)]) expect(f.c.isEmpty()).toBe(false);
    expect(haloRaster(hexToColor('#e8662a')).isEmpty()).toBe(false);
    const tear = tearMask(52, 76, 3);
    expect(tear.mask.reduce((a, b) => a + b, 0)).toBeGreaterThan(900);
  });

  it('paints roads as bands and outlines octagons for rings', () => {
    const r = new Raster(CHART_W, CHART_H);
    paintRoad(r, roadPoints('emberRoad', 'furnaceYard'), 'walked');
    expect(r.isEmpty()).toBe(false);
    const dotted = new Raster(CHART_W, CHART_H);
    paintRoad(dotted, roadPoints('emberRoad', 'furnaceYard'), 'hidden');
    expect(dotted.isEmpty()).toBe(true);
    const ring = octagonPixels(23.5);
    expect(ring.length).toBeGreaterThan(120);
    expect(new Set(ring.map(([x, y]) => `${x},${y}`)).size).toBe(ring.length);
  });
});

describe('Atlas ground bake', () => {
  let sprites: SpriteDef[];
  let layers: ChartLayers;
  beforeAll(() => { sprites = generateSprites(); layers = bakeChart(sprites); }, 60_000);

  it('bakes two full-size layers and yields between phases so the browser never blocks', () => {
    expect([layers.known.w, layers.known.h, layers.unknown.w, layers.unknown.h]).toEqual([CHART_W, CHART_H, CHART_W, CHART_H]);
    let yields = 0;
    const it = bakeChartSteps(sprites);
    for (;;) { const r = it.next(); if (r.done) break; yields++; }
    expect(yields).toBeGreaterThan(12);
  }, 60_000);

  it('is deterministic', () => {
    const again = bakeChart(sprites);
    expect(hash(again.known.data)).toBe(hash(layers.known.data));
    expect(hash(again.unknown.data)).toBe(hash(layers.unknown.data));
  }, 60_000);

  it('paints ground on every pixel and keeps the unknown vellum different from the painted chart', () => {
    let diff = 0;
    for (let i = 0; i < layers.known.data.length; i += 4 * 97) {
      expect(layers.known.data[i + 3], 'known ground is opaque').toBe(255);
      expect(layers.unknown.data[i + 3]).toBe(255);
      if (layers.known.data[i] !== layers.unknown.data[i]) diff++;
    }
    expect(diff).toBeGreaterThan(1000);
  });

  it('puts each node on the region of its area type (the Tears sit in the sealed band)', () => {
    for (const a of ATLAS_AREAS) {
      if (a.sealed) continue;
      const p = ATLAS_POS[a.id];
      expect(layers.region[Math.round(p.y) * CHART_W + Math.round(p.x)], a.id).toBe(REGION_INDEX[regionOf(a)]);
    }
  });

  it('opens a void tear behind each sealed door and glows the lava', () => {
    for (const a of ATLAS_AREAS.filter((z) => z.sealed)) {
      const p = ATLAS_POS[a.id];
      const i = (Math.round(p.y) * CHART_W + Math.round(p.x)) * 4;
      const [r, g, b] = [layers.known.data[i], layers.known.data[i + 1], layers.known.data[i + 2]];
      expect(b, `${a.id} tear is violet`).toBeGreaterThan(g);
      expect(r + g + b, a.id).toBeLessThan(260);
    }
    let lit = 0;
    for (let i = 3; i < layers.glow.data.length; i += 4) if (layers.glow.data[i] > 100) lit++;
    expect(lit).toBeGreaterThan(1500);
    expect(layers.animated.length).toBeGreaterThan(10);
    expect(layers.emitters.length).toBeGreaterThan(10);
  });
});
