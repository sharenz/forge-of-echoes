import { describe, expect, it } from 'vitest';
import { GLYPHS, GLYPH_IDS, glyphMask } from '../../src/art/codex/glyphs';
import { PLATE_CLASSES, PLATE_R, PLATE_SIZE, TONES, BRANCH_TONES } from '../../src/art/codex/tones';
import { cachedPlate, plateFrame, padlockBadge, excludeBadge, type PlateState } from '../../src/art/codex/plates';
import { boardRaster, slateTile, paintThread, CODEX_C, CODEX_W, ringRadius, toWorld } from '../../src/art/codex/board';
import { CX_NODES } from '../../src/ui/codex/model';
import { Raster } from '../../src/art/raster';

const hash = (d: Uint8ClampedArray): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < d.length; i++) { h ^= d[i]; h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
};
const STATES: PlateState[] = ['locked', 'ready', 'on', 'gated'];
const opaque = (r: Raster): number => { let n = 0; for (let i = 3; i < r.data.length; i += 4) if (r.data[i]) n++; return n; };

describe('Codex glyphs', () => {
  it('draws every glyph as a visible, distinct mask at both sizes', () => {
    const seen = new Set<string>();
    for (const id of GLYPH_IDS) for (const n of [9, 11, 13]) {
      const m = glyphMask(id, n);
      const on = m.reduce((a, b) => a + b, 0);
      expect(on, `${id}@${n}`).toBeGreaterThan(n * 1.2);
      expect(on, `${id}@${n}`).toBeLessThan(n * n * 0.95);
      if (n === 11) seen.add(m.join(''));
    }
    expect(seen.size).toBe(GLYPH_IDS.length);
    expect(GLYPH_IDS.length).toBeGreaterThanOrEqual(40);
  });
  it('assigns a known glyph to every node of the tree', () => {
    for (const n of CX_NODES) expect(GLYPHS, n.id).toHaveProperty(n.glyph);
  });
});

describe('Codex plates', () => {
  it('draws every node in every state inside its frame, with a visible silhouette', () => {
    for (const n of CX_NODES) for (const state of STATES) {
      const f = cachedPlate({ cls: n.cls, tone: n.tone, ...(n.tone2 ? { tone2: n.tone2 } : {}), glyph: n.glyph, state });
      const side = PLATE_SIZE[n.cls];
      expect([f.w, f.h]).toEqual([side, side]);
      const c = (side - 1) / 2;
      expect(f.c.opaque(c, c), `${n.id}/${state}`).toBe(true);
      expect(f.c.opaque(0, 0)).toBe(false);
      // nothing glows where there is no colour
      for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) if (f.e.opaque(x, y)) expect(f.c.opaque(x, y)).toBe(true);
    }
  });
  it('is deterministic and gives every state its own look', () => {
    for (const cls of PLATE_CLASSES) {
      const tone = cls === 'seal' ? 'ashenForge' : 'foundry';
      const hashes = STATES.map((state) => hash(plateFrame({ cls, tone, glyph: 'flame', state }).c.data));
      expect(new Set(hashes).size, cls).toBe(STATES.length);
      expect(hash(plateFrame({ cls, tone, glyph: 'flame', state: 'on' }).c.data)).toBe(hashes[2]);
    }
  });
  it('lights allocated plates (emissive) and leaves locked ones cold', () => {
    for (const cls of PLATE_CLASSES) {
      const tone = cls === 'seal' ? 'chainworks' : 'echoes';
      expect(plateFrame({ cls, tone, glyph: 'eye', state: 'on' }).e.isEmpty(), cls).toBe(false);
      expect(plateFrame({ cls, tone, glyph: 'eye', state: 'locked' }).e.isEmpty(), cls).toBe(true);
    }
  });
  it('gives each branch its own colour identity on allocated plates', () => {
    const hashes = BRANCH_TONES.map((tone) => hash(plateFrame({ cls: 'notable', tone, glyph: 'star', state: 'on' }).c.data));
    expect(new Set(hashes).size).toBe(BRANCH_TONES.length);
    for (const t of BRANCH_TONES) expect(TONES[t].css).toMatch(/^#[0-9a-f]{6}$/);
  });
  it('keeps neighbouring plates from overlapping at the Codex scale', () => {
    let worst = Infinity;
    for (const a of CX_NODES) for (const b of CX_NODES) {
      if (a.i >= b.i) continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y) - (PLATE_R[a.cls] + PLATE_R[b.cls]);
      worst = Math.min(worst, d);
    }
    expect(worst).toBeGreaterThan(0.5);
  });
  it('draws the padlock and exclusion badges', () => {
    expect(padlockBadge().c.isEmpty()).toBe(false);
    expect(excludeBadge().c.isEmpty()).toBe(false);
  });
});

describe('Codex board', () => {
  it('lays the tree out inside the 800 px world', () => {
    for (const n of CX_NODES) { expect(n.x).toBeGreaterThan(20); expect(n.x).toBeLessThan(CODEX_W - 20); expect(n.y).toBeGreaterThan(20); expect(n.y).toBeLessThan(CODEX_W - 20); }
    expect(toWorld({ x: 256, y: 256 })).toEqual({ x: CODEX_C, y: CODEX_C });
    expect(ringRadius(3)).toBeGreaterThan(ringRadius(2));
  });
  it('etches rings, ticks and sectors deterministically', () => {
    const a = boardRaster(), b = boardRaster();
    expect(hash(a.data)).toBe(hash(b.data));
    expect(opaque(a)).toBeGreaterThan(20000);
    expect(slateTile().isEmpty()).toBe(false);
  });
  it('paints dim, reach and lit threads, and a glow for lit ones', () => {
    const r = new Raster(64, 64), g = new Raster(64, 64);
    paintThread(r, 4, 4, 60, 40, 'dim');
    const dim = opaque(r);
    paintThread(r, 4, 50, 60, 50, 'lit', 0xff9a3cff, g);
    expect(opaque(r)).toBeGreaterThan(dim);
    expect(opaque(g)).toBeGreaterThan(200);
  });
});
