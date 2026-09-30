// Node plates for the Ember Chart (brief A, section 5.1): one parametric octagonal plate in five tier materials
// (forged iron, bronze, gilt, ember-cracked, void-etched) with a recessed well for the theme emblem, tier rivets,
// and the small state furniture (crown pips, tier pips, wax seal, halo, sealed doors, tears, plume, lantern).
// Everything is generated from the shared palette, deterministic, and runs in Node and the browser.
import type { MapBaseId } from '../../contracts/content';
import { Frame } from '../frame';
import { C, RAMPS, type Color, type Ramp } from '../palette';
import { CLEAR, Raster, ca, mix, rgba } from '../raster';
import { hash2, valueNoise } from '../shade';
import { emblem } from './emblems';
import type { Material } from './geometry';

export const PLATE = 42;
const CX = 21;
const CY = 21;
const HALF = 19.5;

interface MaterialSpec { ramp: Ramp; rim: Color; seed: number }
const MATERIAL: Record<Material, MaterialSpec> = {
  iron: { ramp: [C.metalDeep, C.metalDark, C.metal, C.metalMid, C.metalLight, C.metalHi], rim: C.metalHi, seed: 11 },
  bronze: { ramp: [C.rustDeep, C.rustDark, C.rust, C.rustLight, C.ochre, C.strawLight], rim: C.strawHi, seed: 23 },
  gilt: { ramp: [C.goldDark, C.ochre, C.gold, C.goldHi, C.hot, C.white], rim: C.white, seed: 37 },
  ember: { ramp: [C.ink, C.coal, C.char, C.rustDeep, C.iron, C.stone], rim: C.stone, seed: 41 },
  void: { ramp: [C.voidDeep, C.voidDark, C.voidMid, C.void, C.voidLight, C.voidHi], rim: C.voidHi, seed: 53 },
};

/** Well ramps (deep to light) per theme: the emblem sits on a tinted recess. */
const WELL: Record<MapBaseId, [Color, Color, Color]> = {
  ashenForge: [C.ink, 0x2a0e10ff, 0x561a14ff],
  cinderChapel: [C.ink, 0x231a12ff, 0x4a3520ff],
  rimedOssuary: [C.ossDeep, C.frostDeep, 0x1f3050ff],
  choralCrypt: [C.voidDeep, C.voidDark, 0x3a1c58ff],
  ironColiseum: [C.sandDeep, 0x2e1a12ff, 0x503322ff],
  chainworks: [C.metalDeep, C.metalDark, 0x2c2731ff],
};

/** Octagonal plate metric: 0 at the centre, 1 on the rim, with 6 px chamfered corners. */
function metric(px: number, py: number): number {
  const ax = Math.abs(px);
  const ay = Math.abs(py);
  return Math.max(ax, ay, (ax + ay) * 0.72) / HALF;
}
/** Outward normal of whichever octagon face limits the pixel. */
function faceNormal(px: number, py: number): [number, number] {
  const ax = Math.abs(px);
  const ay = Math.abs(py);
  const d = (ax + ay) * 0.72;
  if (d >= ax && d >= ay) return [Math.sign(px) * 0.7071, Math.sign(py) * 0.7071];
  return ax >= ay ? [Math.sign(px), 0] : [0, Math.sign(py)];
}
const LIGHT: [number, number] = [-0.6, -0.8];

export function plateFrame(material: Material, rivets: number, theme: MapBaseId): Frame {
  const f = new Frame(PLATE, PLATE);
  const spec = MATERIAL[material];
  const ramp = spec.ramp;
  const well = WELL[theme] ?? WELL.ashenForge;
  const R = ramp.length - 1;
  for (let y = 0; y < PLATE; y++) {
    for (let x = 0; x < PLATE; x++) {
      const px = x + 0.5 - CX;
      const py = y + 0.5 - CY;
      const m = metric(px, py);
      if (m > 1) continue;
      const [nx, ny] = faceNormal(px, py);
      const lit = nx * LIGHT[0] + ny * LIGHT[1]; // -1 (facing away) .. 1 (facing the light)
      const grain = hash2(x, y, spec.seed);
      let idx: number;
      if (m > 0.9) {
        idx = 3 + Math.round(lit * 2.2);
        if (m > 0.965) idx = lit > 0.2 ? R : Math.max(0, idx - 1); // polished outer lip / dark lower lip
      } else if (m > 0.75) {
        // hammered face: flat mid-tone with light pitting and a few long scratches
        idx = 2 + (grain > 0.93 ? 1 : 0) - (grain < 0.06 ? 1 : 0);
        if (hash2(y * 3, Math.floor(x / 5), spec.seed + 5) > 0.965) idx += 1;
        const bevelLift = 0.9 - m < 0.02 ? 1 : 0; // fine highlight line under the outer bevel
        idx += bevelLift;
      } else if (m > 0.66) {
        // inner bevel: reversed light so the well reads as recessed
        idx = 3 - Math.round(lit * 2);
        if (m > 0.735) idx -= 1;
      } else {
        idx = -1;
      }
      if (idx >= 0) {
        idx = Math.max(0, Math.min(R, idx));
        f.c.set(x, y, ramp[idx]);
        continue;
      }
      // the well: three dithered steps from a lit centre to a shadowed rim, darker under the upper-left bevel
      const wr = m / 0.66;
      let v = (1 - wr) * 2.4 + (px + py > 0 ? 0.35 : -0.15) * (wr > 0.6 ? 1 : 0);
      v += (((x + y) & 1) === 0 ? 0.18 : -0.18) * (Math.abs(v - Math.round(v)) > 0.3 ? 1 : 0);
      f.c.set(x, y, well[Math.max(0, Math.min(2, Math.round(v)))]);
    }
  }
  // material specific etching
  if (material === 'ember') {
    for (let y = 0; y < PLATE; y++) {
      for (let x = 0; x < PLATE; x++) {
        const px = x + 0.5 - CX;
        const py = y + 0.5 - CY;
        const m = metric(px, py);
        if (m > 0.985 || m < 0.69) continue;
        const a = valueNoise(x, y, 9, 91);
        const b = valueNoise(x + 40, y - 13, 6, 17);
        const da = Math.abs(a - 0.5);
        const db = Math.abs(b - 0.5);
        const crack = da < 0.026 || (db < 0.017 && da < 0.16);
        if (!crack) continue;
        const d = Math.min(da, db * 1.5);
        f.glow(x, y, d < 0.009 ? C.hot : d < 0.017 ? C.flame : C.ember, d < 0.009 ? 255 : 235);
      }
    }
  } else if (material === 'void') {
    // a hot-white seam around the well and four etched compass ticks in the frame
    for (let y = 0; y < PLATE; y++) {
      for (let x = 0; x < PLATE; x++) {
        const px = x + 0.5 - CX;
        const py = y + 0.5 - CY;
        const m = metric(px, py);
        if (m > 0.665 && m < 0.72 && f.c.opaque(x, y) && m < 0.7) f.glow(x, y, m < 0.685 ? C.white : C.voidHi, 255);
      }
    }
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      for (let k = 0; k < 3; k++) {
        const x = CX + dx * (15.5 + k * 1.1) + (dx === 0 ? -0.5 : 0);
        const y = CY + dy * (15.5 + k * 1.1) + (dy === 0 ? -0.5 : 0);
        f.glow(Math.floor(x), Math.floor(y), k === 0 ? C.voidGlow : C.voidLight, 200);
      }
    }
  }
  // corner studs: 3x3 domes on the chamfers
  const stud = (cx: number, cy: number, light: Color, mid: Color, dark: Color, glowy = false): void => {
    f.c.set(cx, cy, mid);
    f.c.set(cx - 1, cy - 1, light);
    f.c.set(cx, cy - 1, light);
    f.c.set(cx - 1, cy, light);
    f.c.set(cx + 1, cy, dark);
    f.c.set(cx, cy + 1, dark);
    f.c.set(cx + 1, cy + 1, dark);
    if (glowy) f.emit(cx - 1, cy - 1, light, 200);
  };
  const [sl, sm, sd] = material === 'iron' ? [C.metalHi, C.metalLight, C.metalDark] : material === 'bronze' ? [C.strawHi, C.ochre, C.rustDark] : material === 'gilt' ? [C.white, C.goldHi, C.goldDark] : material === 'ember' ? [C.hot, C.flame, C.lavaDark] : [C.white, C.voidGlow, C.voidMid];
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) stud(CX + sx * 11 - (sx > 0 ? 0 : 0), CY + sy * 11, sl, sm, sd, material === 'ember' || material === 'void');
  // tier rivets along the top of the frame: 1 to 3 bright dots
  for (let i = 0; i < rivets; i++) {
    const rx = CX - ((rivets - 1) * 5) / 2 + i * 5;
    const ry = CY - 16;
    f.c.set(Math.round(rx), ry, C.white);
    f.c.set(Math.round(rx) + 1, ry, sm);
    f.c.set(Math.round(rx), ry + 1, sm);
    f.c.set(Math.round(rx) + 1, ry + 1, sd);
    f.emit(Math.round(rx), ry, C.white, 160);
  }
  f.outline({ color: C.ink });
  return f;
}

/** The emblem sits on the well; drawn 24x24 centred on the plate. */
export function nodeFrame(material: Material, rivets: number, theme: MapBaseId): Frame {
  const f = plateFrame(material, rivets, theme);
  const e = emblem(theme);
  f.draw(e, CX - 12, CY - 12);
  return f;
}

// ---- small furniture -------------------------------------------------------------------------------------
/** A crown pip: 12x7, gold with a hot glint. */
export function crownFrame(): Frame {
  const f = new Frame(12, 8);
  const rows = ['.#..#..#..#.', '.##.##.##.##', '.##########.', '.#hhhhhhhh#.', '.##########.'];
  const col = (ch: string, x: number, y: number): Color | null => (ch === '#' ? (y >= 3 ? C.ochre : x < 6 ? C.gold : C.ochre) : ch === 'h' ? C.goldHi : null);
  rows.forEach((row, y) => [...row].forEach((ch, x) => { const c = col(ch, x, y); if (c !== null) f.c.set(x, y + 1, c); }));
  // simplified: three points with gems
  for (const x of [1, 5, 6, 10]) f.c.set(x, 0, C.goldHi);
  f.glow(5, 3, C.flame, 220);
  f.glow(6, 3, C.flame, 220);
  f.outline({ color: C.ink });
  return f;
}
/** One tier pip: an 8x8 diamond; lit or cold. */
export function pipFrame(lit: boolean, material: Material): Frame {
  const f = new Frame(9, 9);
  const on: Ramp = material === 'void' ? [C.voidMid, C.voidGlow, C.voidHi] : material === 'ember' ? [C.lavaDark, C.ember, C.hot] : material === 'gilt' ? [C.ochre, C.gold, C.hot] : material === 'bronze' ? [C.rust, C.ochre, C.strawHi] : [C.metalMid, C.metalLight, C.metalHi];
  const off: Ramp = [C.metalDeep, C.metalDark, C.metal];
  const r = lit ? on : off;
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
    const d = Math.abs(x - 4) + Math.abs(y - 4);
    if (d > 3) continue;
    f.c.set(x, y, d === 3 ? r[0] : x + y < 8 && d <= 1 ? r[2] : r[1]);
  }
  if (lit) f.emit(4, 4, on[2], 180);
  f.outline({ color: C.ink });
  return f;
}
/** Wax seal (cleared): a red wax disc with an impressed sigil. 14x14. */
export function sealFrame(): Frame {
  const f = new Frame(14, 14);
  const wax: Ramp = [C.wineDeep, C.wineDark, C.burgundy, C.wineMid, C.wineLight, C.wineHi];
  for (let y = 0; y < 14; y++) for (let x = 0; x < 14; x++) {
    const dx = x + 0.5 - 7, dy = y + 0.5 - 7;
    const r = Math.hypot(dx * (1 + 0.06 * Math.sin(Math.atan2(dy, dx) * 5)), dy);
    if (r > 6.3) continue;
    const lit = -(dx + dy) / 9.9;
    const rim = r > 5 ? 1 : 0;
    const idx = 3 + Math.round(lit * 1.6) + (rim ? (lit > 0 ? 1 : -1) : 0);
    f.c.set(x, y, wax[Math.max(0, Math.min(5, idx))]);
  }
  // impressed spiral
  const spiral: [number, number][] = [[7, 7], [8, 7], [8, 6], [7, 5], [6, 5], [5, 6], [5, 8], [6, 9], [8, 9], [9, 8]];
  spiral.forEach(([x, y]) => f.c.set(x, y, wax[1]));
  spiral.slice(0, 3).forEach(([x, y]) => f.c.set(x + 0, y, wax[2]));
  f.c.set(7, 8, wax[0]);
  f.outline({ color: C.ink });
  return f;
}
/** Small first-clear point gem, 8x8. */
export function gemFrame(): Frame {
  const f = new Frame(8, 8);
  const r: Ramp = [C.frostDark, C.mana, C.frost, C.ice, C.white];
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const d = Math.abs(x - 3.5) + Math.abs(y - 3.5);
    if (d > 4) continue;
    f.c.set(x, y, d > 3 ? r[0] : x + y < 7 ? (d < 2 ? r[3] : r[2]) : r[1]);
  }
  f.glow(3, 3, C.white, 200);
  f.outline({ color: C.ink });
  return f;
}
/** "New" flag: a small ember pennant with a white star, 16x10. */
export function newFlagFrame(): Frame {
  const f = new Frame(16, 10);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 15 - Math.abs(y - 3.5) * 1.6; x++) f.c.set(x, y, y < 3 ? C.flame : C.ember);
  for (const [x, y] of [[5, 2], [5, 3], [5, 4], [4, 3], [6, 3], [5, 3]] as const) f.c.set(x, y, C.white);
  for (let x = 0; x < 10; x++) f.emit(x, 0, C.hot, 140);
  f.outline({ color: C.ink });
  return f;
}
/** Chain glyph for "too shallow", 14x14. */
export function chainFrame(): Frame {
  const f = new Frame(15, 15);
  const link = (cx: number, cy: number, horizontal: boolean): void => {
    for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) {
      const dx = (x + 0.5 - cx) / (horizontal ? 4.4 : 2.6);
      const dy = (y + 0.5 - cy) / (horizontal ? 2.6 : 4.4);
      const d = dx * dx + dy * dy;
      if (d <= 1 && d > 0.38) f.c.set(x, y, x + y < cx + cy ? C.metalHi : C.metalMid);
    }
  };
  link(4.5, 4.5, true); link(9, 9, false); link(11.5, 11.5, true);
  f.outline({ color: C.ink });
  return f;
}
/** Keyhole glyph, 9x12. */
export function keyholeFrame(col: Color): Frame {
  const f = new Frame(9, 12);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 9; x++) {
    const dx = x + 0.5 - 4.5, dy = y + 0.5 - 4.2;
    if (dx * dx + dy * dy <= 7.2 || (y >= 5 && y <= 10 && Math.abs(dx) <= 1.2 + (y - 5) * 0.28)) f.c.set(x, y, C.ink);
  }
  f.outline({ color: mix(col, C.white, 0.2) });
  f.c.map((c) => (ca(c) ? c : c));
  return f;
}

// ---- halo ------------------------------------------------------------------------------------------------
/** Soft additive halo as four dithered bands, `size` x `size`, coloured; drawn with globalCompositeOperation lighter. */
export function haloRaster(col: Color, size = 64): Raster {
  const r = new Raster(size, size);
  const c = size / 2;
  const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x + 0.5 - c, y + 0.5 - c) / c;
    if (d >= 1) continue;
    const k = (1 - d) * (1 - d) * 4.2; // 0..4.2 steps
    const b = (bayer[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
    const level = Math.floor(k) + (k - Math.floor(k) > b ? 1 : 0);
    if (level <= 0) continue;
    r.set(x, y, rgba((col >>> 24) & 255, (col >>> 16) & 255, (col >>> 8) & 255, Math.min(210, level * 34)));
  }
  return r;
}

// ---- sealed doors and tears ------------------------------------------------------------------------------
/** A stone gateway in a key's colour: 40x48. Locked shows the banded door; `ajar` swings it open and spills light. */
export function doorFrame(key: Color, ajar: boolean): Frame {
  const f = new Frame(40, 48);
  const stone = RAMPS.stone;
  const keyRamp: Ramp = [mix(key, C.ink, 0.8), mix(key, C.ink, 0.6), mix(key, C.ink, 0.35), key, mix(key, C.white, 0.35), mix(key, C.white, 0.7)];
  const inArch = (x: number, y: number, inset: number): boolean => {
    const dx = x + 0.5 - 20;
    const top = 17;
    if (y + 0.5 < top) return dx * dx + (y + 0.5 - top) * (y + 0.5 - top) <= (17 - inset) * (17 - inset);
    return Math.abs(dx) <= 17 - inset && y < 47;
  };
  for (let y = 0; y < 48; y++) for (let x = 0; x < 40; x++) {
    if (!inArch(x, y, 0)) continue;
    const dx = x + 0.5 - 20;
    if (!inArch(x, y, 3)) {
      const light = -(dx + (y - 20) * 0.5) / 20;
      const brick = ((x >> 2) + (y >> 2)) & 1;
      f.c.set(x, y, stone[Math.max(1, Math.min(5, 3 + Math.round(light * 1.5) + (brick ? 0 : -1)))]);
      continue;
    }
    if (ajar) {
      // the dark room beyond with a bar of light on the floor rising into a soft cone
      const cone = Math.max(0, 1 - Math.abs(dx) / (4 + (y - 8) * 0.28)) * Math.min(1, (y - 6) / 22);
      const v = cone * 3.2 + (((x + y) & 1) === 0 ? 0.25 : -0.25);
      f.c.set(x, y, keyRamp[Math.max(0, Math.min(5, Math.round(v)))]);
      if (v > 1.4) f.emit(x, y, key, Math.min(230, v * 70));
    } else {
      const plank = Math.floor((x + 1) / 5);
      const light = -(dx + (y - 20) * 0.4) / 22;
      const base = 1 + ((plank + (y > 30 ? 1 : 0)) % 2);
      f.c.set(x, y, keyRamp[Math.max(0, Math.min(3, base + (light > 0.25 ? 1 : 0) - (light < -0.4 ? 1 : 0)))]);
      if ((x + 1) % 5 === 0) f.c.set(x, y, keyRamp[0]);
    }
  }
  if (!ajar) {
    for (const y of [22, 36]) for (let x = 4; x < 36; x++) if (f.c.opaque(x, y)) { f.c.set(x, y, x % 6 === 0 ? C.metalHi : C.metalMid); f.c.set(x, y + 1, C.metalDark); }
    for (let y = 21; y < 33; y++) for (let x = 14; x < 26; x++) if (Math.hypot(x - 19.5, y - 27) < 5.4) f.c.set(x, y, Math.hypot(x - 19.5, y - 27) < 4.4 ? (x + y < 46 ? C.goldHi : C.gold) : C.goldDark);
    for (const [x, y] of [[19, 25], [20, 25], [19, 26], [20, 26], [19, 27], [20, 27], [19, 28], [20, 28], [19, 29]] as const) f.c.set(x, y, C.ink);
    f.emit(19, 25, key, 190); f.emit(20, 25, key, 190);
    // two hanging chains across the leaf
    for (let i = 0; i < 12; i++) { f.c.set(6 + i, 12 + Math.round(i * 1.3) + (i & 1), C.metalHi); f.c.set(33 - i, 12 + Math.round(i * 1.3) + (i & 1), C.metalMid); }
  } else {
    // the leaf swung open: a foreshortened plank standing at the left
    for (let y = 18; y < 47; y++) for (let x = 6; x < 11; x++) if (inArch(x, y, 3)) f.c.set(x, y, keyRamp[Math.max(0, Math.min(3, 2 - (x - 6) % 2 + (y % 9 === 0 ? -1 : 0)))]);
    for (let x = 13; x < 30; x++) for (let k = 0; k < 2; k++) f.glowSoft(x, 46 - k, key, 0.8 - k * 0.3, 210);
  }
  f.outline({ color: C.ink });
  return f;
}

/** The torn opening in the chart around a sealed area: ragged void with parchment torn edges. Returns colour + glow. */
export function tearMask(w = 64, h = 76, seed = 7): { mask: Uint8Array; w: number; h: number } {
  const mask = new Uint8Array(w * h);
  const lean = (hash2(seed, 1, 5) - 0.5) * 0.5;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ny = (y + 0.5 - h / 2) / (h / 2);
    const nx = (x + 0.5 - w / 2) / (w / 2) - lean * ny;
    const warp = (valueNoise(x, y, 7, seed) - 0.5) * 0.5 + (valueNoise(x, y, 2.4, seed + 3) - 0.5) * 0.16 + Math.sin(ny * 7 + seed) * 0.07;
    // a rip: broad in the middle, tapering to points, with a shoulder that changes from tear to tear
    const d = Math.sqrt(nx * nx * (1 + Math.abs(ny) * 1.15) + ny * ny * 0.62) + warp;
    if (d < 0.86) mask[y * w + x] = 1;
  }
  return { mask, w, h };
}

// ---- plume, lantern, corner ornament --------------------------------------------------------------------
/** A smoke plume rising from an unrevealed neighbour: 16x40, `frame` 0..3 sways. Ember at its foot. */
export function plumeFrame(frame: number): Frame {
  const f = new Frame(18, 42);
  for (let i = 0; i < 34; i++) {
    const t = i / 34;
    const x = 9 + Math.sin(frame * 1.57 + t * 5.2) * (1 + t * 3.6);
    const y = 38 - i;
    const w = 1 + Math.floor(t * 3.4);
    for (let dx = -w; dx <= w; dx++) {
      const edge = Math.abs(dx) === w;
      const c = edge ? C.char : t > 0.75 ? C.stone : t > 0.45 ? C.iron : C.stone;
      f.c.plot(Math.round(x) + dx, y, edge ? mix(c, C.coal, 0.4) : c, (0.9 - t * 0.7) * (edge ? 0.7 : 1));
    }
  }
  // the ember at the foot and two rising sparks
  f.glow(9, 39, C.hot, 255); f.glow(8, 39, C.flame, 230); f.glow(10, 39, C.flame, 230); f.glow(9, 38, C.ember, 230); f.glow(9, 40, C.ember, 200);
  f.glow(11 + (frame & 1), 33 - frame, C.flame, 220);
  return f;
}

/** The lantern on a pole that ends a dead-end road: 10x22, `frame` flickers. */
export function lanternFrame(frame: number): Frame {
  const f = new Frame(12, 24);
  for (let y = 7; y < 23; y++) { f.c.set(5, y, C.woodDark); f.c.set(6, y, C.wood); }
  f.c.set(4, 22, C.woodDeep); f.c.set(7, 22, C.woodDeep);
  for (let x = 2; x < 10; x++) { f.c.set(x, 2, C.metalMid); f.c.set(x, 8, C.metalDark); }
  for (let y = 3; y < 8; y++) { f.c.set(2, y, C.metalMid); f.c.set(9, y, C.metalDark); }
  for (let y = 3; y < 8; y++) for (let x = 3; x < 9; x++) f.glow(x, y, y < 5 + (frame & 1) ? C.hot : C.flame, 230);
  f.c.set(5, 1, C.metalMid); f.c.set(6, 1, C.metalMid); f.c.set(5, 0, C.metalLight);
  f.outline({ color: C.ink });
  return f;
}

// ---- open portal glyph -----------------------------------------------------------------------------------
/**
 * The portal glyph pinned to the target node while its portal is open (brief A, 6.7): a dark well in a flame-lit iron
 * ring with a void-bright arc that chases around it. 19x19, `frame` 0..7 turns the arc.
 */
export function portalFrame(frame: number): Frame {
  const f = new Frame(19, 19);
  const c = 9;
  for (let y = 0; y < 19; y++) for (let x = 0; x < 19; x++) {
    const dx = x - c, dy = y - c, r = Math.hypot(dx, dy);
    if (r > 8.4) continue;
    const lit = -(dx * 0.6 + dy * 0.8) / (r || 1);
    if (r > 6.3) { f.c.set(x, y, lit > 0.25 ? C.metalHi : lit > -0.3 ? C.metalMid : C.metal); continue; }
    if (r > 5.3) { // the lit seat of the ring
      const a = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2);
      const head = ((frame / 8) * Math.PI * 2) % (Math.PI * 2);
      const d = ((a - head + Math.PI * 3) % (Math.PI * 2)) - Math.PI; // -pi..pi around the head
      const k = d <= 0 ? Math.max(0, 1 + d / 1.9) : 0; // a tail behind the head
      const col = k > 0.75 ? C.white : k > 0.4 ? C.voidHi : k > 0.05 ? C.voidGlow : C.voidLight;
      f.glow(x, y, col, 130 + k * 125);
      continue;
    }
    const swirl = Math.sin(Math.atan2(dy, dx) * 2 + r * 1.1 - frame * 0.8) * 0.5 + 0.5;
    f.glow(x, y, mix(C.voidDark, C.voidGlow, swirl * (1 - r / 7)), 70 + swirl * 120 * (1 - r / 7));
  }
  f.outline({ selective: false, color: C.ink });
  return f.clampEmissive();
}
