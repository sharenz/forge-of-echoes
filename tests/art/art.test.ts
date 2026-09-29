import { beforeAll, describe, expect, it } from 'vitest';
import { REQUIRED_SPRITES, type ArtBundle, type PixelImage, type SpriteDef } from '../../src/contracts/art';
import { ALL_ICON_IDS } from '../../src/contracts/content';
import { CAST_RELEASE_FRAME, generateArt, generateSprites, iconFootprint, iconPixels, portraitPixels } from '../../src/art';
import { PALETTE } from '../../src/art/palette';
import { PORT_X, PORT_Y } from '../../src/art/tiles';

let art: ArtBundle;
let byId: Map<string, SpriteDef>;

beforeAll(() => {
  art = generateArt();
  byId = new Map(art.sprites.map((s) => [s.id, s]));
});

const opaqueCount = (img: PixelImage): number => {
  let n = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 0) n++;
  return n;
};

function hashBytes(data: Uint8ClampedArray): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i++) {
    h ^= data[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

/** FNV-1a over every byte of every frame (and emissive mask). */
function digest(sprites: SpriteDef[]): number {
  let h = 0x811c9dc5;
  const mixIn = (v: number): void => {
    h ^= v;
    h = Math.imul(h, 0x01000193) >>> 0;
  };
  for (const s of sprites) {
    for (const ch of s.id) mixIn(ch.charCodeAt(0));
    for (const f of [...s.frames, ...(s.emissive ?? [])]) for (let i = 0; i < f.data.length; i++) mixIn(f.data[i]);
  }
  return h;
}

describe('sprite set', () => {
  it('provides every required sprite id', () => {
    const missing = REQUIRED_SPRITES.filter((id) => !byId.has(id));
    expect(missing).toEqual([]);
  });

  it('has unique ids', () => {
    expect(byId.size).toBe(art.sprites.length);
  });

  it('includes the extra sets the presenter may use', () => {
    expect(byId.has('monster/riftStalker/leap')).toBe(true);
    expect(byId.has('monster/trainingDummy/idle')).toBe(true);
    expect(byId.has('monster/trainingDummy/attack')).toBe(true);
  });

  it('keeps every frame the declared size with valid RGBA buffers', () => {
    for (const s of art.sprites) {
      expect(s.frames.length, s.id).toBeGreaterThan(0);
      for (const f of s.frames) {
        expect([f.width, f.height], s.id).toEqual([s.width, s.height]);
        expect(f.data.length, s.id).toBe(s.width * s.height * 4);
        expect(f.data).toBeInstanceOf(Uint8ClampedArray);
      }
    }
  });

  it('places anchors inside the frame', () => {
    for (const s of art.sprites) {
      expect(s.anchorX, s.id).toBeGreaterThanOrEqual(0);
      expect(s.anchorX, s.id).toBeLessThanOrEqual(s.width);
      expect(s.anchorY, s.id).toBeGreaterThanOrEqual(0);
      expect(s.anchorY, s.id).toBeLessThanOrEqual(s.height);
    }
  });

  it('never ships an empty frame', () => {
    for (const s of art.sprites) s.frames.forEach((f, i) => expect(opaqueCount(f), `${s.id}#${i}`).toBeGreaterThan(0));
  });

  it('matches emissive masks to frames, glowing only on visible pixels', () => {
    let glowing = 0;
    for (const s of art.sprites) {
      if (!s.emissive) continue;
      glowing++;
      expect(s.emissive.length, s.id).toBe(s.frames.length);
      s.emissive.forEach((e, i) => {
        expect([e.width, e.height], s.id).toEqual([s.width, s.height]);
        expect(e.data.length, s.id).toBe(s.width * s.height * 4);
        const c = s.frames[i].data;
        for (let p = 3; p < e.data.length; p += 4) if (e.data[p] > 0) expect(c[p], `${s.id}#${i} glow on empty pixel`).toBeGreaterThan(0);
      });
    }
    expect(glowing).toBeGreaterThan(30);
  });

  it('gives glowing parts to the sprites that need them', () => {
    for (const id of ['sorceress/idle/south', 'proj/emberLance', 'prop/brazier', 'prop/portal', 'prop/mapDevice', 'prop/crystal', 'monster/ashling/idle', 'monster/cinderMatriarch/idle', 'tile/ashenForge/detail']) {
      expect(byId.get(id)?.emissive, id).toBeDefined();
    }
  });

  it('uses sensible playback settings', () => {
    for (const s of art.sprites) {
      expect(s.fps, s.id).toBeGreaterThanOrEqual(0);
      if (s.loop) expect(s.fps, `${s.id} loops but has fps 0`).toBeGreaterThan(0);
    }
  });

  it('keeps one frame size and foot anchor for every sorceress animation', () => {
    const sorc = art.sprites.filter((s) => s.id.startsWith('sorceress/'));
    expect(sorc.length).toBe(16);
    for (const s of sorc) {
      expect([s.width, s.height, s.anchorX, s.anchorY], s.id).toEqual([32, 32, 16, 30]);
    }
    for (const dir of ['south', 'north', 'east']) {
      expect(byId.get(`sorceress/idle/${dir}`)!.frames.length).toBe(4);
      expect(byId.get(`sorceress/run/${dir}`)!.frames.length).toBe(6);
      expect(byId.get(`sorceress/cast/${dir}`)!.frames.length).toBe(5);
      expect(byId.get(`sorceress/dash/${dir}`)!.frames.length).toBe(3);
      expect(byId.get(`sorceress/hit/${dir}`)!.frames.length).toBe(2);
    }
    expect(byId.get('sorceress/death/south')!.frames.length).toBe(6);
    expect(CAST_RELEASE_FRAME).toBeLessThan(5);
  });

  it('shares a frame size and anchor across each monster set', () => {
    const kinds = new Set(art.sprites.filter((s) => s.id.startsWith('monster/')).map((s) => s.id.split('/')[1]));
    for (const k of kinds) {
      const set = art.sprites.filter((s) => s.id.startsWith(`monster/${k}/`));
      const first = set[0];
      for (const s of set) expect([s.width, s.height, s.anchorX, s.anchorY], s.id).toEqual([first.width, first.height, first.anchorX, first.anchorY]);
    }
  });

  it('keeps monster feet on the anchor row (bottom-centre anchoring)', () => {
    for (const s of art.sprites.filter((x) => x.id.startsWith('monster/') && !x.id.endsWith('/leap'))) {
      const f = s.frames[0];
      let lowest = -1;
      for (let y = f.height - 1; y >= 0 && lowest < 0; y--) {
        for (let x = 0; x < f.width; x++) if (f.data[(y * f.width + x) * 4 + 3] > 0) lowest = y;
      }
      // the outline may sit one row below the feet
      expect(Math.abs(lowest + 1 - s.anchorY), s.id).toBeLessThanOrEqual(2);
    }
  });

  it('stands every east-facing figure on its anchor so the mirrored west view does not jump', () => {
    // The renderer mirrors west about anchorX, so the ground contact must be centred on it. Measured as the mean
    // x of the opaque pixels in the lowest four rows, averaged over the idle/move (run, cast) frames.
    const groundX = (f: PixelImage, rows = 4, maxX = f.width): number => {
      let lowest = -1;
      for (let y = f.height - 1; y >= 0 && lowest < 0; y--) for (let x = 0; x < maxX; x++) if (f.data[(y * f.width + x) * 4 + 3] > 0) lowest = y;
      let sum = 0;
      let n = 0;
      for (let y = lowest; y > lowest - rows; y--) {
        for (let x = 0; x < maxX; x++) {
          if (f.data[(y * f.width + x) * 4 + 3] === 0) continue;
          sum += x + 0.5;
          n++;
        }
      }
      return sum / n;
    };
    const ids = [
      'sorceress/idle/east', 'sorceress/run/east', 'sorceress/cast/east',
      ...['ashling', 'emberSkitter', 'cinderSpitter', 'riftStalker', 'ironhideBrute', 'ashboundHerald', 'cinderMatriarch'].flatMap((m) => [`monster/${m}/idle`, `monster/${m}/move`]),
    ];
    for (const id of ids) {
      const s = byId.get(id)!;
      // the Herald plants its staff well ahead of its robe; only the robe hem is its footing
      const maxX = id.includes('ashboundHerald') ? 29 : s.width;
      const avg = s.frames.reduce((a, f) => a + groundX(f, 4, maxX), 0) / s.frames.length;
      expect(Math.abs(avg - s.anchorX), `${id}: ground centre ${avg.toFixed(2)} vs anchor ${s.anchorX}`).toBeLessThanOrEqual(0.75);
    }
  });

  it('draws every frame of a move cycle differently (no hitching duplicate poses)', () => {
    for (const s of art.sprites.filter((x) => /\/(move|run)\//.test(`${x.id}/`))) {
      for (let i = 0; i < s.frames.length; i++) {
        const a = s.frames[i].data;
        const b = s.frames[(i + 1) % s.frames.length].data;
        expect(hashBytes(a) === hashBytes(b), `${s.id} frames ${i} and ${(i + 1) % s.frames.length} are identical`).toBe(false);
      }
    }
  });

  it('makes world tiles 16x16 with several variants', () => {
    for (const s of art.sprites.filter((x) => x.id.startsWith('tile/'))) {
      expect([s.width, s.height], s.id).toEqual([16, 16]);
      expect(s.frames.length, s.id).toBeGreaterThanOrEqual(4);
      expect(s.frames.length, s.id).toBeLessThanOrEqual(8);
    }
  });

  it('keeps floor tiles fully opaque so the ground has no holes', () => {
    for (const s of art.sprites.filter((x) => x.id.endsWith('/floor'))) {
      for (const f of s.frames) expect(opaqueCount(f), s.id).toBe(16 * 16);
    }
  });

  it('lets any floor variant sit next to any other without a visible seam', () => {
    // Mean luminance step across every variant pairing's shared border, compared with the mean step between
    // neighbouring pixels inside a tile. Grout or seams along the tile edge (the old graph-paper look) push the
    // ratio well above 1; Wang-port joints keep it low.
    const lum = (d: Uint8ClampedArray, i: number): number => (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) / 255;
    for (const s of art.sprites.filter((x) => x.id.endsWith('/floor'))) {
      let border = 0;
      let nb = 0;
      for (const a of s.frames) {
        for (const b of s.frames) {
          for (let k = 0; k < 16; k++) {
            border += Math.abs(lum(a.data, (k * 16 + 15) * 4) - lum(b.data, k * 16 * 4));
            border += Math.abs(lum(a.data, (15 * 16 + k) * 4) - lum(b.data, k * 4));
            nb += 2;
          }
        }
      }
      let inner = 0;
      let ni = 0;
      for (const a of s.frames) {
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 15; x++) {
            inner += Math.abs(lum(a.data, (y * 16 + x) * 4) - lum(a.data, (y * 16 + x + 1) * 4));
            inner += Math.abs(lum(a.data, (x * 16 + y) * 4) - lum(a.data, ((x + 1) * 16 + y) * 4));
            ni += 2;
          }
        }
      }
      expect(border / nb / (inner / ni), s.id).toBeLessThan(0.8);
    }
  });

  it('crosses tile borders with basalt fissures only at the shared ports', () => {
    const fissure = PALETTE.basaltDeep;
    const hex = (d: Uint8ClampedArray, i: number): string => `#${[d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    for (const f of byId.get('tile/ashenForge/floor')!.frames) {
      for (let k = 0; k < 16; k++) {
        expect(hex(f.data, k * 4) === fissure, `top edge x=${k}`).toBe(PORT_X.includes(k));
        expect(hex(f.data, (15 * 16 + k) * 4) === fissure, `bottom edge x=${k}`).toBe(PORT_X.includes(k));
        expect(hex(f.data, k * 16 * 4) === fissure, `left edge y=${k}`).toBe(PORT_Y.includes(k));
        expect(hex(f.data, (k * 16 + 15) * 4) === fissure, `right edge y=${k}`).toBe(PORT_Y.includes(k));
      }
    }
  });

  it('keeps ember glow off the floors and sparse, dim lava veins in the forge decals', () => {
    for (const s of art.sprites.filter((x) => x.id.endsWith('/floor'))) expect(s.emissive, s.id).toBeUndefined();
    const veins = byId.get('tile/ashenForge/detail')!;
    let lit = 0;
    for (const e of veins.emissive!) for (let i = 3; i < e.data.length; i += 4) if (e.data[i] > 0) {
      lit++;
      expect(e.data[i], 'vein glow stays below monster-eye strength').toBeLessThanOrEqual(180);
    }
    expect(lit).toBeGreaterThan(40);
  });

  it('gives the map device and chest their two states', () => {
    expect(byId.get('prop/mapDevice')!.frames.length).toBe(2);
    expect(byId.get('prop/chest')!.frames.length).toBe(2);
  });
});

describe('icons and portrait', () => {
  it('provides pixels for every icon id the UI uses', () => {
    const missing = ALL_ICON_IDS.filter((id) => !iconPixels(id));
    expect(missing).toEqual([]);
    for (const id of ALL_ICON_IDS) {
      const img = iconPixels(id)!;
      const [w, h] = iconFootprint(id);
      expect([img.width, img.height], id).toEqual([32 * w, 32 * h]);
      expect(opaqueCount(img), id).toBeGreaterThan(40 * w * h);
    }
  });

  it('draws equipment icons at their inventory footprint (32 px per cell)', () => {
    expect(iconFootprint('icon/base/ashwoodWand')).toEqual([1, 3]);
    expect(iconFootprint('icon/base/emberSceptre')).toEqual([2, 3]);
    expect(iconFootprint('icon/base/ashenRobe')).toEqual([2, 3]);
    expect(iconFootprint('icon/base/ironVisor')).toEqual([2, 2]);
    expect(iconFootprint('icon/base/chainBelt')).toEqual([2, 1]);
    expect(iconFootprint('icon/base/emberRing')).toEqual([1, 1]);
    expect(iconFootprint('icon/unique/thePatientSpark')).toEqual([1, 3]);
    expect(iconFootprint('icon/unique/cinderwalkers')).toEqual([2, 2]);
    expect(iconFootprint('icon/currency/kindling')).toEqual([1, 1]);
    expect(iconFootprint('icon/map/ashenForge')).toEqual([1, 1]);
  });

  it('gives the five essences and three map bases clearly different colours', () => {
    // mean colour of the opaque pixels; siblings must be far apart so they are told apart at a glance
    const mean = (id: string): [number, number, number] => {
      const d = iconPixels(id)!.data;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        r += d[i];
        g += d[i + 1];
        b += d[i + 2];
        n++;
      }
      return [r / n, g / n, b / n];
    };
    for (const group of [
      ['essenceEmber', 'essenceRime', 'essenceStorm', 'essenceVital', 'essenceSwift'].map((e) => `icon/currency/${e}`),
      ['ashenForge', 'rimedOssuary', 'ironColiseum'].map((m) => `icon/map/${m}`),
    ]) {
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = mean(group[i]);
          const b = mean(group[j]);
          expect(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), `${group[i]} vs ${group[j]}`).toBeGreaterThan(20);
        }
      }
    }
  });

  it('returns null for unknown icons and never throws in Node for DOM helpers', () => {
    expect(iconPixels('icon/base/nope')).toBeNull();
    expect(art.icon('icon/base/ashwoodWand')).toBe('');
    expect(art.portrait()).toBe('');
  });

  it('draws distinct icons (no two share the same pixels)', () => {
    const seen = new Map<number, string>();
    for (const id of ALL_ICON_IDS) {
      const key = hashBytes(iconPixels(id)!.data);
      expect(seen.get(key), `${id} duplicates ${seen.get(key)}`).toBeUndefined();
      seen.set(key, id);
    }
  });

  it('draws a 64x64 opaque portrait', () => {
    const p = portraitPixels();
    expect([p.width, p.height]).toEqual([64, 64]);
    expect(opaqueCount(p)).toBe(64 * 64);
  });
});

describe('determinism and palette', () => {
  it('generates identical pixels every time', () => {
    const a = digest(generateSprites());
    const b = digest(generateSprites());
    expect(a).toBe(b);
    expect(hashBytes(iconPixels('icon/skill/emberNova')!.data)).toBe(hashBytes(iconPixels('icon/skill/emberNova')!.data));
  });

  it('exposes the palette as CSS hex strings', () => {
    expect(art.palette.ember).toBe('#e8662a');
    for (const [name, hex] of Object.entries(art.palette)) expect(hex, name).toMatch(/^#[0-9a-f]{6}$/);
    expect(Object.keys(art.palette).length).toBe(Object.keys(PALETTE).length);
  });

  it('does not use wall-clock time or Math.random in generation code', () => {
    const sources = import.meta.glob('../../src/art/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    const files = Object.entries(sources);
    expect(files.length).toBeGreaterThan(10);
    for (const [file, src] of files) expect(/Math\.random|Date\.now|performance\.now/.test(src), file).toBe(false);
  });

  it('generates quickly', () => {
    const t0 = performance.now();
    generateSprites();
    expect(performance.now() - t0).toBeLessThan(1500);
  });
});
