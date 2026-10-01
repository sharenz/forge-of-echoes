// The chart's baked terrain (brief A, sections 3-4 and 9.2). Two 640x360 layers are generated once:
//   unknown  charred vellum: coal/char mottling, a dotted dead-reckoning grid, faint contour lines
//   known    the same chart painted in biome colours, built from the game's OWN floor tiles (tile/<theme>/floor and
//            detail), lifted a little so a drawn map reads brighter than a lit floor, with lava and ice rivers,
//            tar pools, arena rings, torn "tears" round the sealed areas, pinned margin inserts, rope-line region
//            borders and the game's props scattered between the roads.
// A live glow layer (lava veins) and a list of animated props (braziers, banners) are returned separately.
// Runs in Node and the browser and is deterministic. `bakeChartSteps` yields between phases so the browser can
// bake without blocking input.
import type { SpriteDef } from '../../contracts/art';
import { ATLAS_AREAS, findAtlasArea } from '../../data/progression/atlas';
import { C, type Color } from '../palette';
import { Raster, ca, cb, cg, cr, mix, rgba } from '../raster';
import { chamfer, hash2, valueNoise } from '../shade';
import { CHART_H, CHART_W, ATLAS_EDGES, ATLAS_POS, PLATE_R, regionOf, roadPoints, type RegionId } from './geometry';
import { tearMask } from './plates';

export const REGION_INDEX: Record<RegionId, number> = { reach: 0, deep: 1, marches: 2, verge: 3, tears: 4 };
const REGION_THEMES: Record<number, [string, string]> = {
  0: ['ashenForge', 'ashenForge'],
  1: ['rimedOssuary', 'choralCrypt'],
  2: ['ironColiseum', 'chainworks'],
  3: ['cinderChapel', 'cinderChapel'],
};

export interface PropPlacement { id: string; x: number; y: number; frame: number }
export interface AnimatedProp { id: string; x: number; y: number; phase: number }
export interface ChartLayers {
  unknown: Raster;
  known: Raster;
  /** Lava-vein glow (colour, alpha = intensity), pulsed additively at runtime. */
  glow: Raster;
  /** Cold glints on the frozen river (colour, alpha = intensity). */
  glint: Raster;
  /** Region index per pixel (0..3; 255 outside). */
  region: Uint8Array;
  frame: Raster;
  animated: AnimatedProp[];
  /** Positions of ember emitters (lava, braziers), art px. */
  emitters: { x: number; y: number; kind: 'lava' | 'brazier' | 'frost' | 'torch' }[];
}

const W = CHART_W;
const H = CHART_H;

class TileBank {
  private frames = new Map<string, Raster[]>();
  constructor(private sprites: readonly SpriteDef[]) {}
  get(id: string): Raster[] {
    let list = this.frames.get(id);
    if (!list) {
      const def = this.sprites.find((s) => s.id === id);
      list = def ? def.frames.map((im) => new Raster(im.width, im.height, new Uint8ClampedArray(im.data))) : [];
      this.frames.set(id, list);
    }
    return list;
  }
  sprite(id: string): SpriteDef | undefined {
    return this.sprites.find((s) => s.id === id);
  }
}

const REGION_TINT: Record<number, Color> = {
  0: rgba(78, 56, 50, 255), // charred brown
  1: rgba(58, 68, 88, 255), // slate
  2: rgba(104, 84, 64, 255), // muted sand
  3: rgba(88, 72, 66, 255), // scorched stone
};

function lift(c: Color, x: number, y: number, k: number, warm: number, tint: Color = 0): Color {
  // brightness lift + warm cast, a light hillshade from smooth noise so the ground has relief, and a pull toward
  // the region's tint so the tile joints calm down at map scale
  const h = valueNoise(x, y, 44, 5) * 0.65 + valueNoise(x, y, 17, 6) * 0.35;
  const hx = valueNoise(x + 2, y + 2, 44, 5) * 0.65 + valueNoise(x + 2, y + 2, 17, 6) * 0.35;
  const shade = 1 + (h - hx) * 3.2;
  let r = cr(c) * k + 8 + warm * 8;
  let g = cg(c) * k + 6 + warm * 3;
  let b = cb(c) * k + 6 - warm * 2;
  if (tint) {
    r += (cr(tint) - r) * 0.34;
    g += (cg(tint) - g) * 0.34;
    b += (cb(tint) - b) * 0.34;
  }
  // vignette toward the chart edge
  const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
  const v = edge < 46 ? 0.72 + 0.28 * (edge / 46) : 1;
  return rgba(r * shade * v, g * shade * v, b * shade * v, 255);
}

const px = (r: Raster, x: number, y: number, c: Color): void => r.set(x, y, c);

export function* bakeChartSteps(sprites: readonly SpriteDef[]): Generator<void, ChartLayers> {
  const tiles = new TileBank(sprites);
  const unknown = new Raster(W, H);
  const known = new Raster(W, H);
  const glow = new Raster(W, H);
  const glint = new Raster(W, H);
  const frame = new Raster(W, H);
  const region = new Uint8Array(W * H).fill(255);
  const animated: AnimatedProp[] = [];
  const emitters: ChartLayers['emitters'] = [];

  // ---- region assignment: nearest site with a noise-warped metric -----------------------------------------
  const sites = ATLAS_AREAS.filter((a) => !a.sealed).map((a) => ({ x: ATLAS_POS[a.id].x, y: ATLAS_POS[a.id].y, r: REGION_INDEX[regionOf(a)], w: regionOf(a) === 'verge' ? 0.78 : 1 }));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const wx = x + (valueNoise(x, y, 38, 1) - 0.5) * 44 + (valueNoise(x, y, 12, 2) - 0.5) * 12;
      const wy = y + (valueNoise(x, y, 38, 3) - 0.5) * 44 + (valueNoise(x, y, 12, 4) - 0.5) * 12;
      let best = 1e9;
      let bi = 0;
      for (const s of sites) {
        const d = Math.hypot(wx - s.x, (wy - s.y) * 1.08) / s.w / (s.r === 0 ? 1.14 : s.r === 1 ? 0.94 : 1);
        if (d < best) { best = d; bi = s.r; }
      }
      region[y * W + x] = bi;
    }
    if (y % 40 === 39) yield;
  }
  const regionAt = (x: number, y: number): number => (x < 0 || y < 0 || x >= W || y >= H ? 255 : region[y * W + x]);

  // ---- unknown ground: charred vellum ----------------------------------------------------------------------
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const blot = valueNoise(x, y, 70, 31) * 0.55 + valueNoise(x, y, 26, 32) * 0.3 + valueNoise(x, y, 7, 33) * 0.15;
      let c = mix(C.coal, C.iron, Math.min(1, blot * 1.15) * 0.62);
      // soot stains toward the edges
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
      if (edge < 30) c = mix(c, C.ink, (1 - edge / 30) * 0.6);
      // fibre speckle
      const sp = hash2(x, y, 34);
      if (sp > 0.987) c = mix(c, C.stone, 0.5);
      else if (sp < 0.008) c = mix(c, C.ink, 0.6);
      // contour lines of a slow height field, like a surveyor's hachure on burnt paper
      const hgt = valueNoise(x, y, 90, 35) * 0.7 + valueNoise(x, y, 40, 36) * 0.3;
      const fr = (hgt * 9) % 1;
      if (Math.abs(fr - 0.5) < 0.028) c = mix(c, C.iron, 0.55);
      // dotted dead-reckoning grid every 32 px with small crosses at the crossings
      const gx = x % 32, gy = y % 32;
      if ((gx === 0 && gy % 4 < 2) || (gy === 0 && gx % 4 < 2)) c = mix(c, C.iron, 0.9);
      if (gx === 0 && gy === 0) c = C.stone;
      if ((gx === 0 && (gy === 1 || gy === 31)) || (gy === 0 && (gx === 1 || gx === 31))) c = mix(c, C.iron, 0.9);
      px(unknown, x, y, c);
    }
    if (y % 60 === 59) yield;
  }

  // ---- known ground: the game's own floors ------------------------------------------------------------------
  const floors: Record<string, Raster[]> = {};
  const details: Record<string, Raster[]> = {};
  for (const t of ['ashenForge', 'rimedOssuary', 'choralCrypt', 'ironColiseum', 'chainworks', 'cinderChapel']) {
    floors[t] = tiles.get(`tile/${t}/floor`);
    details[t] = tiles.get(`tile/${t}/detail`);
  }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const r = region[y * W + x];
      const [a, b] = REGION_THEMES[r] ?? REGION_THEMES[0];
      const patch = valueNoise(x, y, 52, 77 + r) > 0.6;
      const theme = patch ? b : a;
      const cx = (x / 16) | 0, cy = (y / 16) | 0;
      const list = floors[theme];
      const v = Math.floor(hash2(cx, cy, 90 + r) * list.length);
      let c = list[v].get(x % 16, y % 16);
      // warmer and brighter toward the east: "deeper = closer to the Heart"
      const east = x / W;
      c = lift(c, x, y, r === 2 ? 1.1 : 1.45, east * 0.9 + (r === 0 ? 0.6 : 0), REGION_TINT[r] ?? 0);
      px(known, x, y, c);
    }
    if (y % 40 === 39) yield;
  }
  // sparse detail decals from the same themes (cracks, bones, plates)
  for (let cy = 0; cy < Math.ceil(H / 16); cy++) for (let cx = 0; cx < Math.ceil(W / 16); cx++) {
    if (hash2(cx, cy, 401) > 0.16) continue;
    const r = regionAt(cx * 16 + 8, cy * 16 + 8);
    if (r > 3) continue;
    const [a, b] = REGION_THEMES[r];
    const theme = valueNoise(cx * 16, cy * 16, 52, 77 + r) > 0.6 ? b : a;
    const list = details[theme];
    const d = list[Math.floor(hash2(cx, cy, 402) * list.length)];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const c = d.get(x, y);
      if (ca(c) === 0) continue;
      const X = cx * 16 + x, Y = cy * 16 + y;
      if (regionAt(X, Y) !== r) continue;
      known.plot(X, Y, lift(c, X, Y, 1.5, (X / W) * 0.9, REGION_TINT[r] ?? 0), 0.8);
    }
  }
  yield;

  // ---- rivers, pools and rings ------------------------------------------------------------------------------
  // lava river through the Cinder Reach
  const lavaY = (x: number): number => 117 + 6 * Math.sin(x / 47) + 3.5 * Math.sin(x / 19 + 2) + (valueNoise(x, 0, 26, 12) - 0.5) * 7;
  const lavaW = (x: number): number => 3.6 + 2.6 * valueNoise(x, 5, 32, 13) + 0.6 * Math.sin(x / 11);
  const lavaRamp: Color[] = [C.lavaDeep, C.lavaDark, C.ember, C.flame, C.hot];
  for (let x = 0; x < W; x++) {
    const cy0 = lavaY(x), w = lavaW(x);
    for (let y = Math.floor(cy0 - w - 4); y <= Math.ceil(cy0 + w + 4); y++) {
      if (regionAt(x, y) !== 0) continue;
      const d = Math.abs(y + 0.5 - cy0);
      if (d < w) {
        const t = d / w;
        let i = t < 0.2 ? 4 : t < 0.45 ? 3 : t < 0.75 ? 2 : 1;
        // dark crust drifting on the surface
        const crust = valueNoise(x + y * 0.4, y, 5, 14);
        if (crust > 0.72 && t > 0.3) i = Math.max(1, i - 2);
        else if (crust > 0.62 && t > 0.3) i -= 1;
        px(known, x, y, lavaRamp[Math.max(0, Math.min(4, i))]);
        glow.set(x, y, rgba(cr(lavaRamp[i]), cg(lavaRamp[i]), cb(lavaRamp[i]), Math.max(0, Math.min(255, 250 - t * 150))));
      } else if (d < w + 1.5) {
        px(known, x, y, hash2(x, y, 15) > 0.5 ? C.basaltDark : C.basaltDeep);
      } else if (d < w + 4) {
        // heat-scorched bank: the ground darkens and picks up a faint orange rim
        const c = known.get(x, y);
        px(known, x, y, mix(c, C.lavaDark, 0.16 * (1 - (d - w - 1.5) / 2.5)));
      }
    }
    if (x % 3 === 0 && hash2(x, 0, 16) > 0.86) emitters.push({ x, y: cy0, kind: 'lava' });
  }
  // a few lava pools and cracked ridges in the north
  for (const [px0, py0, rr] of [[214, 26, 8], [432, 24, 7], [30, 60, 6], [590, 84, 7], [166, 128, 5]] as const) {
    for (let y = py0 - rr - 3; y <= py0 + rr + 3; y++) for (let x = px0 - rr - 3; x <= px0 + rr + 3; x++) {
      if (regionAt(x, y) !== 0) continue;
      const wob = (valueNoise(x, y, 4, 17) - 0.5) * 3;
      const d = Math.hypot((x - px0) * 1.3, y - py0) + wob;
      if (d < rr) {
        const t = d / rr;
        const i = t < 0.35 ? 4 : t < 0.6 ? 3 : t < 0.85 ? 2 : 1;
        px(known, x, y, lavaRamp[i]);
        glow.set(x, y, rgba(cr(lavaRamp[i]), cg(lavaRamp[i]), cb(lavaRamp[i]), 240 - t * 120));
      } else if (d < rr + 1.6) px(known, x, y, C.basaltDeep);
    }
    emitters.push({ x: px0, y: py0, kind: 'lava' });
  }
  yield;

  // frozen river through the Rimed Deep
  const iceY = (x: number): number => 296 + 6 * Math.sin(x / 36 + 1) + 3 * Math.sin(x / 15) + (valueNoise(x, 0, 24, 21) - 0.5) * 6;
  const iceW = (x: number): number => 4 + 2.2 * valueNoise(x, 9, 30, 22);
  const iceRamp: Color[] = [C.frostDeep, C.frostDark, C.frostMid, C.frost, C.ice];
  for (let x = 120; x < W; x++) {
    const cy0 = iceY(x), w = iceW(x);
    for (let y = Math.floor(cy0 - w - 3); y <= Math.ceil(cy0 + w + 3); y++) {
      if (regionAt(x, y) !== 1) continue;
      const d = Math.abs(y + 0.5 - cy0);
      if (d < w) {
        const t = d / w;
        let i = t < 0.35 ? 3 : t < 0.7 ? 2 : 1;
        const crackN = valueNoise(x * 0.8 + y, y * 1.3, 6, 23);
        if (Math.abs(crackN - 0.5) < 0.03) i = 4;
        else if (valueNoise(x, y, 3, 24) > 0.8) i = Math.min(4, i + 1);
        px(known, x, y, iceRamp[i]);
        if (hash2(x, y, 25) > 0.965) glint.set(x, y, rgba(212, 241, 255, 255));
      } else if (d < w + 1.5) px(known, x, y, C.ossMid);
    }
    if (hash2(x, 3, 26) > 0.97) emitters.push({ x, y: cy0, kind: 'frost' });
  }
  // frosted lake on the western Deep
  for (let y = 205; y < 250; y++) for (let x = 44; x < 118; x++) {
    if (regionAt(x, y) !== 1) continue;
    const d = Math.hypot((x - 80) / 30, (y - 228) / 15) + (valueNoise(x, y, 6, 27) - 0.5) * 0.35;
    if (d > 1) continue;
    px(known, x, y, d < 0.4 ? C.frostMid : d < 0.8 ? C.frostDark : C.ossMid);
    if (hash2(x, y, 28) > 0.97) glint.set(x, y, rgba(212, 241, 255, 255));
  }
  yield;

  // tar pools and arena rings in the Iron Marches
  for (const [tx, ty, trx, tr_y] of [[330, 340, 20, 8], [470, 322, 16, 7], [600, 334, 14, 7], [70, 328, 14, 6]] as const) {
    for (let y = ty - tr_y - 3; y <= ty + tr_y + 3; y++) for (let x = tx - trx - 3; x <= tx + trx + 3; x++) {
      if (regionAt(x, y) !== 2 || y >= H - 8) continue;
      const d = Math.hypot((x - tx) / trx, (y - ty) / tr_y) + (valueNoise(x, y, 5, 41) - 0.5) * 0.4;
      if (d < 1) {
        let c = d < 0.55 ? C.basaltDeep : C.basaltDark;
        if (d > 0.3 && (x + y * 2) % 11 === 0 && y < ty) c = C.metalMid; // oily sheen
        px(known, x, y, c);
      } else if (d < 1.15) px(known, x, y, C.sandDeep);
    }
  }
  for (const a of ATLAS_AREAS) {
    if (a.sealed || regionOf(a) !== 'marches') continue;
    const { x: ax, y: ay } = ATLAS_POS[a.id];
    for (let y = ay - 36; y <= ay + 36; y++) for (let x = ax - 40; x <= ax + 40; x++) {
      if (regionAt(x, y) !== 2 || x < 9 || y < 9 || y > H - 10) continue;
      const d = Math.hypot((x - ax) / 1.15, y - ay);
      const c = known.get(x, y);
      if (d > 29 && d < 31.5) px(known, x, y, mix(c, C.sandLight, 0.45));
      else if (d > 31.5 && d < 32.5) px(known, x, y, mix(c, C.ink, 0.5));
      else if (d < 29) px(known, x, y, mix(c, C.sand, 0.22));
    }
  }
  // the Verge compass: a sigil ring in the ground round Cinder Crossing, and a dotted ring round the Shrine Field
  const ring = (cxr: number, cyr: number, rr: number, col: Color): void => {
    for (let y = cyr - rr - 2; y <= cyr + rr + 2; y++) for (let x = cxr - rr - 2; x <= cxr + rr + 2; x++) {
      if (x < 9 || y < 9 || x >= W - 9 || y >= H - 9) continue;
      const d = Math.hypot(x + 0.5 - cxr, y + 0.5 - cyr);
      if (Math.abs(d - rr) < 0.75 && (Math.floor((Math.atan2(y - cyr, x - cxr) + Math.PI) * rr / 2.2) & 1) === 0) known.plot(x, y, col, 0.95);
    }
  };
  const cc = ATLAS_POS.cinderCrossing;
  ring(cc.x, cc.y, 34, C.bone); ring(cc.x, cc.y, 29, C.ochre);
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) for (let k = 30; k < 41; k++) {
    const X = cc.x + dx * k, Y = cc.y + dy * k;
    if (X > 9 && Y > 9 && X < W - 9 && Y < H - 9) known.plot(X, Y, k > 37 ? C.parchment : C.bone, 0.9);
  }
  const sf = ATLAS_POS.shrineField;
  ring(sf.x, sf.y, 28, C.ochre);
  yield;

  // ---- tears round the sealed areas -----------------------------------------------------------------------
  let tearSeed = 3;
  for (const a of ATLAS_AREAS.filter((z) => z.sealed)) {
    const { x: ax, y: ay } = ATLAS_POS[a.id];
    const { mask, w: tw, h: th } = tearMask(52, 76, tearSeed++);
    const ox = ax - tw / 2, oy = ay - th / 2 + 2;
    const dist = chamfer(mask, tw, th);
    const outer = new Uint8Array(tw * th);
    for (let i = 0; i < mask.length; i++) outer[i] = mask[i] ? 0 : 1;
    for (let ty = -2; ty < th + 2; ty++) for (let tx = -2; tx < tw + 2; tx++) {
      const inside = tx >= 0 && ty >= 0 && tx < tw && ty < th && mask[ty * tw + tx] === 1;
      const d = inside ? dist[ty * tw + tx] : 0;
      const X = Math.round(ox + tx), Y = Math.round(oy + ty);
      if (X < 9 || Y < 9 || X >= W - 9 || Y >= H - 9) continue;
      if (!inside) {
        // outside neighbour: a torn-paper shadow line
        let near = false;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = tx + dx, ny = ty + dy;
          if (nx >= 0 && ny >= 0 && nx < tw && ny < th && mask[ny * tw + nx]) near = true;
        }
        if (near) px(known, X, Y, mix(known.get(X, Y), C.ink, 0.65));
        continue;
      }
      if (d <= 1.6) { px(known, X, Y, hash2(X, Y, 51) > 0.35 ? C.parchment : C.bone); continue; }
      if (d <= 2.6) { px(known, X, Y, C.voidLight); glow.set(X, Y, rgba(192, 123, 255, 140)); continue; }
      // the void behind the chart: deep violet with mist and tiny stars
      const mist = valueNoise(X * 1.3, Y, 9, 52);
      let c = mix(C.voidDeep, C.voidDark, 0.25 + mist * 0.9);
      if (d < 5) c = mix(c, C.voidMid, 0.5 * (1 - (d - 2.6) / 2.4));
      if (hash2(X, Y, 53) > 0.992) c = C.voidHi;
      px(known, X, Y, c);
    }
  }
  yield;

  // ---- margin inserts: dead ends pinned to the chart as side notes ----------------------------------------
  for (const a of ATLAS_AREAS.filter((z) => z.deadEnd)) {
    const { x: ax, y: ay } = ATLAS_POS[a.id];
    const cw = 64, ch = 56;
    const x0 = Math.max(10, Math.min(W - 10 - cw, Math.round(ax - cw / 2)));
    const y0 = Math.max(10, Math.min(H - 10 - ch, Math.round(ay - ch / 2)));
    const theme = a.type === 'crypt' ? 'rimedOssuary' : a.type === 'arena' ? 'ironColiseum' : a.type === 'frontier' ? 'cinderChapel' : 'ashenForge';
    for (let y = -2; y < ch + 2; y++) for (let x = -2; x < cw + 2; x++) {
      const X = x0 + x, Y = y0 + y;
      // torn edge
      const jag = (valueNoise(X, Y, 3.5, 61) - 0.5) * 3.4;
      const dxe = Math.min(x, cw - 1 - x) + jag, dye = Math.min(y, ch - 1 - y) + jag;
      const de = Math.min(dxe, dye);
      if (de < -1) continue;
      if (de < 0.6) { px(known, X, Y, mix(known.get(X, Y), C.ink, 0.6)); continue; }
      if (de < 2.4) { px(known, X, Y, hash2(X, Y, 62) > 0.3 ? C.parchment : C.bone); continue; }
      // sepia wash of the destination's floor
      const list = floors[theme];
      const c0 = list[Math.floor(hash2((X / 16) | 0, (Y / 16) | 0, 63) * list.length)].get(X % 16, Y % 16);
      const wash = lift(c0, X, Y, 1.3, 0.5, rgba(90, 76, 62, 255));
      const grey = (cr(wash) + cg(wash) + cb(wash)) / 3;
      // ink-and-wash: the destination's floor in sepia, with faint horizontal hachure like a surveyor's shading
      const hatch = (Y % 4 === 0 && hash2(X, Y, 64) > 0.3) ? 0.82 : 1;
      const g = (28 + (grey - 40) * 1.5) * hatch;
      px(known, X, Y, rgba(g * 1.25 + 20, g * 1.02 + 13, g * 0.72 + 5, 255));
    }
    // pin
    const pxp = x0 + 6, pyp = y0 + 5;
    px(known, pxp + 1, pyp + 2, C.ink);
    for (const [dx, dy, c] of [[0, 0, C.metalHi], [1, 0, C.metalLight], [0, 1, C.metalMid], [1, 1, C.metalDark]] as const) px(known, pxp + dx, pyp + dy, c);
  }
  yield;

  // ---- props ----------------------------------------------------------------------------------------------
  const roadPts = ATLAS_EDGES.flatMap((e) => roadPoints(e.a, e.b, 4));
  const nodePts = ATLAS_AREAS.map((a) => ATLAS_POS[a.id]);
  const placed: { x: number; y: number }[] = [];
  const nearestRoad = (x: number, y: number): number => roadPts.reduce((m, p) => Math.min(m, Math.hypot(p.x - x, p.y - y)), 1e9);
  const nearestNode = (x: number, y: number): number => nodePts.reduce((m, p) => Math.min(m, Math.max(Math.abs(p.x - x) - 6, Math.abs(p.y - y) - 6)), 1e9);
  const regionsFor: { id: string; r: number; n: number; animated?: boolean; gap: number; roadGap?: number }[] = [
    { id: 'brazier', r: 0, n: 6, animated: true, gap: 44 }, { id: 'rubble', r: 0, n: 7, gap: 18 },
    { id: 'bones', r: 1, n: 9, gap: 16 }, { id: 'crystal', r: 1, n: 7, gap: 24 }, { id: 'ruinWall', r: 1, n: 3, gap: 34 }, { id: 'rubble', r: 1, n: 4, gap: 18 },
    { id: 'banner', r: 2, n: 5, animated: true, gap: 40 }, { id: 'rubble', r: 2, n: 4, gap: 18 }, { id: 'bones', r: 2, n: 3, gap: 20 }, { id: 'ruinWall', r: 2, n: 2, gap: 34 },
    { id: 'standingStone', r: 3, n: 10, gap: 20 }, { id: 'rubble', r: 3, n: 3, gap: 20 }, { id: 'brazier', r: 3, n: 2, animated: true, gap: 40 },
  ];
  const shadow = (cx: number, cy: number, rx: number): void => {
    for (let y = cy - 3; y <= cy + 3; y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / 2.5) ** 2;
      if (d < 1) known.plot(x, y, rgba(6, 4, 6, 255), 0.4 * (1 - d * 0.5));
    }
  };
  let salt = 0;
  for (const spec of regionsFor) {
    const sprite = tiles.sprite(`prop/${spec.id}`);
    if (!sprite) continue;
    let count = 0;
    for (let tries = 0; tries < 600 && count < spec.n; tries++) {
      salt++;
      const x = 14 + Math.floor(hash2(salt, 1, 700) * (W - 28));
      const y = 22 + Math.floor(hash2(salt, 2, 701) * (H - 34));
      if (regionAt(x, y) !== spec.r) continue;
      if (spec.id === 'crystal' || spec.id === 'ruinWall') { /* bulky: keep them clear of everything */ }
      if (nearestNode(x, y - sprite.height / 2) < (spec.animated ? 40 : 30) + (sprite.height > 30 ? 6 : 0) || nearestRoad(x, y - 8) < 13) continue;
      if (placed.some((p) => Math.hypot(p.x - x, (p.y - y) * 1.4) < spec.gap)) continue;
      // keep off water and lava: only on plain ground
      const c = known.get(x, y);
      if (ca(c) === 0 || (cr(c) > 200 && cg(c) < 160 && cb(c) < 100) || glow.alpha(x, y) > 0 || glint.alpha(x, y) > 0) continue;
      if (Math.abs(y - lavaY(x)) < 16 && spec.r === 0) continue;
      // avoid tears, cards and the compass ring
      if (ATLAS_AREAS.some((a) => (a.sealed || a.deadEnd) && Math.abs(ATLAS_POS[a.id].x - x) < 40 && Math.abs(ATLAS_POS[a.id].y - y) < (a.sealed ? 46 : 38))) continue;
      placed.push({ x, y });
      count++;
      if (spec.animated) { animated.push({ id: spec.id, x, y, phase: salt }); if (spec.id === 'brazier') emitters.push({ x, y: y - 20, kind: 'brazier' }); else emitters.push({ x, y: y - 30, kind: 'torch' }); shadow(x, y, 8); continue; }
      shadow(x, y - 1, sprite.width * 0.42);
      const fr = sprite.frames[Math.floor(hash2(salt, 3, 702) * sprite.frames.length)];
      const src = new Raster(fr.width, fr.height, new Uint8ClampedArray(fr.data));
      const brighten = src.clone().map((col, xx, yy) => lift(col, x + xx, y + yy, 1.32, (x / W) * 0.6, 0));
      known.blit(brighten, x - sprite.anchorX, y - sprite.anchorY);
    }
    yield;
  }
  // chimney stacks by the lava (drawn as small custom towers)
  for (const [sx, sy] of [[64, 104], [244, 112], [500, 112], [396, 106]] as const) {
    if (regionAt(sx, sy) !== 0) continue;
    for (let y = 0; y < 26; y++) for (let x = -5; x <= 5; x++) {
      const half = 5 - Math.floor(y / 8) * 0.0 - (y < 3 ? 1 : 0);
      if (Math.abs(x) > half - (y > 22 ? -1 : 0)) continue;
      const lit = x < -1 ? 1 : x > 2 ? -1 : 0;
      const brick = ((y >> 2) + ((x + 6) >> 2)) & 1;
      const col = [C.rustDeep, C.rustDark, C.rust, C.rustLight][Math.max(0, Math.min(3, 1 + lit + (brick ? 0 : -1)))];
      px(known, sx + x, sy - 26 + y, col);
    }
    for (let x = -5; x <= 5; x++) { px(known, sx + x, sy - 26, C.metalLight); px(known, sx + x, sy - 25, C.metalDark); }
    px(known, sx - 1, sy - 27, C.ember); px(known, sx, sy - 27, C.flame); px(known, sx + 1, sy - 27, C.ember);
    emitters.push({ x: sx, y: sy - 28, kind: 'lava' });
    shadow(sx + 3, sy + 1, 8);
  }
  yield;

  // ---- rope-line region borders ----------------------------------------------------------------------------
  const isEdge = (x: number, y: number): boolean => {
    const r = regionAt(x, y);
    return r < 4 && (regionAt(x + 1, y) !== r || regionAt(x, y + 1) !== r) && regionAt(x + 1, y) < 4 && regionAt(x, y + 1) < 4;
  };
  const rope: [number, number, Color][] = [];
  for (let y = 9; y < H - 9; y++) for (let x = 9; x < W - 9; x++) {
    if (!isEdge(x, y)) continue;
    const near = ATLAS_AREAS.some((a) => a.sealed && Math.abs(ATLAS_POS[a.id].x - x) < 30 && Math.abs(ATLAS_POS[a.id].y - y) < 42);
    if (near) continue;
    const k = ((x + y) >> 1) & 1;
    rope.push([x, y, k ? C.bone : C.iron]);
    rope.push([x + 1, y, k ? C.ashGrey : C.metalDark]);
    rope.push([x, y - 1, C.ink]);
  }
  for (const [x, y, c] of rope) known.plot(x, y, c, x % 2 === 0 || c !== C.ink ? 0.8 : 0.5);
  yield;

  // ---- chart frame: double rule, degree ticks and corner rosettes ---------------------------------------
  const rule = (x: number, y: number, c: Color, a = 1): void => frame.plot(x, y, c, a);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const e = Math.min(x, y, W - 1 - x, H - 1 - y);
    if (e < 7) {
      frame.set(x, y, e < 2 ? C.ink : mix(C.ink, C.coal, 0.4));
    }
  }
  for (let x = 4; x < W - 4; x++) { rule(x, 3, C.stone, 0.9); rule(x, H - 4, C.stone, 0.9); rule(x, 6, C.iron, 0.9); rule(x, H - 7, C.iron, 0.9); if (x % 8 === 0) { for (let k = 3; k < 7; k++) { rule(x, k, C.ashGrey, 0.9); rule(x, H - 1 - k, C.ashGrey, 0.9); } } if (x % 40 === 0) for (let k = 2; k < 7; k++) { rule(x, k, C.parchment); rule(x, H - 1 - k, C.parchment); } }
  for (let y = 4; y < H - 4; y++) { rule(3, y, C.stone, 0.9); rule(W - 4, y, C.stone, 0.9); rule(6, y, C.iron, 0.9); rule(W - 7, y, C.iron, 0.9); if (y % 8 === 0) { for (let k = 3; k < 7; k++) { rule(k, y, C.ashGrey, 0.9); rule(W - 1 - k, y, C.ashGrey, 0.9); } } if (y % 40 === 0) for (let k = 2; k < 7; k++) { rule(k, y, C.parchment); rule(W - 1 - k, y, C.parchment); } }
  for (const [cx, cy, sx, sy] of [[10, 10, 1, 1], [W - 11, 10, -1, 1], [10, H - 11, 1, -1], [W - 11, H - 11, -1, -1]] as const) {
    for (let k = 0; k < 9; k++) { frame.set(cx + sx * k, cy, k < 2 ? C.gold : C.ochre); frame.set(cx, cy + sy * k, k < 2 ? C.gold : C.ochre); }
    for (const [dx, dy] of [[0, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) frame.set(cx + dx * 2 * sx * 0 + dx, cy + dy, C.goldHi);
    frame.set(cx + sx * 3, cy + sy * 3, C.ochre); frame.set(cx + sx * 4, cy + sy * 4, C.gold);
  }
  yield;

  return { unknown, known, glow, glint, region, frame, animated, emitters };
}

export function bakeChart(sprites: readonly SpriteDef[]): ChartLayers {
  const it = bakeChartSteps(sprites);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/** Which region index a chart pixel belongs to (255 = outside), for particles and ambience. */
export function regionIndexAt(layers: ChartLayers, x: number, y: number): number {
  x = Math.floor(x);
  y = Math.floor(y);
  return x < 0 || y < 0 || x >= W || y >= H ? 255 : layers.region[y * W + x];
}

/** Sanity: every area has a region. Exported for tests. */
export const AREA_REGION_INDEX = (id: string): number => REGION_INDEX[regionOf(findAtlasArea(id)!)];
export const PLATE_HALF = PLATE_R;
