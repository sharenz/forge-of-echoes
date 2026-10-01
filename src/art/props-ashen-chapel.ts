// Ashen Forge / Cinder Chapel signature props (D-territory.md 10.6, slice L1): the refined `vat`, `bellows`, `altar` and
// `statue` drawings that replace the placeholders of src/art/props-kit.ts (same sizes, anchors and frame convention: fps 0,
// frame = PropView.variant % frames; frame 0 = lit / molten / sword down, frame 1 = cold / cooled / raised). The statue is
// shared with the Iron Coliseum (statueSprite below: frames 0-1 champion, 2-3 this pack's crowned figure).
// Drawn with the same Sculpt primitives and the shared palette as the rest of the props: selective outline, ember and gold
// kept for small emissive focal points (slag, coals, candle flames, eye slits).
//
//   vat      slag vat 64x50: iron drum, riveted bands, pour spout with a running drip, a flanged pipe stub; molten pool (0) or a
//            cooled crust with glowing cracks (1)
//   bellows  forge bellows 40x34: pleated leather between boards, a long lever, an iron nozzle into a coal hearth (0 glowing, 1 cold)
//   altar    chapel altar 40x32: stepped stone, a wine cloth with gold trim, a coal bowl; two lit candles (0) or snuffed, with
//            ember glyphs and glowing coals (1)
//   statue   armoured, crowned stone figure 32x56 on a plinth, eyes of ember: sword point-down (0) or raised (1)
import type { SpriteDef } from '../contracts/art';
import { Frame, toSprite } from './frame';
import { C, RAMPS, type Color } from './palette';
import { lineCells } from './raster';
import { Sculpt, hash2, valueNoise, type PrimStyle } from './shade';

const px = (f: Frame, x: number, y: number, c: Color): void => f.c.set(Math.round(x), Math.round(y), c);
const onBody = (f: Frame, x: number, y: number, c: Color): void => {
  if (f.c.opaque(Math.round(x), Math.round(y))) px(f, x, y, c);
};
const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y1], [x1, y1], [x1, y0], [x0, y0]];
const stoneTex = (seed: number) => (x: number, y: number): number => (valueNoise(x, y, 3, seed) - 0.5) * 1.2 + (hash2(x, y, seed) > 0.92 ? -1 : 0);
const stone: PrimStyle = { ramp: RAMPS.stone, bias: 0.2, dither: 0.08, tex: stoneTex(5) };
const iron: PrimStyle = { ramp: RAMPS.metal, bias: 0.3, dither: 0.08 };
const wood: PrimStyle = { ramp: RAMPS.wood, bias: 0.3, dither: 0.08 };
const rust: PrimStyle = { ramp: RAMPS.rust, bias: 0.1, dither: 0.08 };
const cloth: PrimStyle = { ramp: RAMPS.wine, bias: 0.1, dither: 0.06 };

/** Slag vat: a riveted iron drum with a molten pool (0) or a cooled, cracked crust (1). */
export function vat(v: number): Frame {
  const f = new Frame(64, 50);
  const s = new Sculpt();
  const cx = 32;
  // feet, body, pipe stub with its flange, pour spout, then the thick lip on top
  s.poly(rect(11, 44, 19, 49), { ...iron, bias: -0.5 }, 1);
  s.poly(rect(45, 44, 53, 49), { ...iron, bias: -0.5 }, 1);
  s.poly(rect(54, 33, 63, 40), { ...iron, cyl: 1, bias: 0.1 }, 0.8);
  s.poly(rect(8, 26, 56, 45), { ...iron, cyl: 1, bias: 0.1 }, 2);
  s.ell(cx, 45, 24, 4.5, { ...iron, bias: -0.6 });
  s.poly(rect(8, 39, 56, 45), { ...iron, cyl: 1, bias: -0.6 }, 1);
  s.poly(rect(52, 30, 56, 43), { ...iron, bias: 0.5 }, 0.8);
  s.poly([[2, 23], [13, 24], [12, 31], [4, 32]], { ...iron, bias: 0.35, cyl: 0.3 }, 1);
  s.ell(cx, 26, 25.5, 12, { ...iron, bias: 0.55, round: 0.5 });
  s.render(f.c, f.e);
  // riveted bands, a seam down the drum and heat stains
  for (const y of [33, 41]) for (let x = 9; x <= 55; x++) onBody(f, x, y, x % 5 === 0 ? C.metalHi : C.metalDark);
  for (let k = 0; k < 10; k++) {
    onBody(f, 12 + k * 4.6, 31, C.metalHi);
    onBody(f, 12 + k * 4.6, 37, C.metalLight);
  }
  for (let y = 34; y <= 44; y++) for (let x = 9; x <= 55; x++) if (valueNoise(x, y, 5, 90) > 0.8) onBody(f, x, y, valueNoise(x, y, 2, 91) > 0.55 ? C.rustLight : C.rustDark);
  for (const y of [35, 38]) px(f, 58, y, C.metalHi);
  // the pool inside the lip: hot core, ember ring, a dark skin of crust round the edge
  for (let y = 16; y <= 36; y++) {
    for (let x = 10; x <= 54; x++) {
      const dx = (x - cx) / 20.5;
      const dy = (y - 26) / 8.8;
      const d = dx * dx + dy * dy;
      if (d > 1) continue;
      const n = valueNoise(x, y, 4, 70 + v);
      if (v === 0) {
        const edge = d > 0.78 && n < 0.62;
        if (edge) px(f, x, y, n < 0.34 ? C.char : C.lavaDeep);
        else f.glow(x, y, n + (1 - d) * 0.5 > 1.02 ? C.hot : n + (1 - d) * 0.5 > 0.72 ? C.flame : n > 0.3 ? C.ember : C.lavaDark, 150 + (1 - d) * 100);
      } else {
        const crack = Math.abs(valueNoise(x, y, 6, 12) - 0.5) < 0.035 && d < 0.92;
        if (crack) f.glow(x, y, d < 0.5 ? C.flame : C.ember, 190);
        else px(f, x, y, n > 0.84 ? C.lavaDeep : n > 0.5 ? C.char : C.coal);
      }
    }
  }
  // the pour spout runs: a bright thread down the drum (0) or a cold black tongue (1)
  for (let y = 24; y <= 41; y++) {
    const x = 6 + Math.round(Math.sin(y * 0.7) * 0.6) + (y > 33 ? 1 : 0);
    if (v === 0) f.glow(x, y, y < 29 ? C.hot : y < 35 ? C.flame : C.ember, 230 - (y - 24) * 4);
    else onBody(f, x, y, y % 4 === 0 ? C.lavaDark : C.coal);
  }
  if (v === 0) for (const [x, y] of [[8, 41], [6, 43]]) f.glow(x, y, C.lavaDark, 160);
  if (v === 1) for (const [x, y] of [[24, 24], [38, 29], [44, 23]]) f.glow(x, y, C.ember, 150);
  f.outline({ selective: true });
  return f;
}

/** Forge bellows: pleated leather between two dark boards, a long lever with a grip, an iron nozzle aimed into a coal hearth. */
export function bellows(v: number): Frame {
  const f = new Frame(40, 34);
  const s = new Sculpt();
  const board: PrimStyle = { ...wood, bias: -0.1, cyl: 0.2 };
  const leather: PrimStyle = { ramp: RAMPS.rust, bias: 0.5, dither: 0.1, cyl: 0.1 };
  // hearth block, rear stand, lower board, leather bag, upper board, lever, nozzle
  s.poly(rect(0, 21, 13, 33), { ...stone, bias: -0.1 }, 1.2, 0, -0.2);
  s.poly(rect(31, 26, 36, 33), { ...wood, bias: -0.4 }, 0.8);
  s.poly([[13, 28], [38, 28], [39, 25], [13, 25]], board, 1);
  s.poly([[13, 25], [39, 25], [39, 14], [13, 20]], leather, 1.2);
  s.poly([[11, 20], [20, 17], [39, 10], [40, 14], [39, 16], [13, 22]], { ...board, bias: 0.3 }, 1);
  s.poly(rect(30, 0, 34, 12), { ...wood, bias: 0.5, cyl: 1 }, 0.8);
  s.ell(32, 1.4, 3.2, 2, { ...wood, bias: 0.8 });
  s.cap(13, 22, 6, 25, 2.6, 1.8, iron);
  s.render(f.c, f.e);
  // pleats: dark troughs and bright crests across the leather
  for (let k = 0; k < 5; k++) {
    const t = (k + 0.6) / 5.4;
    const x = 14 + t * 24;
    lineCells(x, 24, x, 19 - t * 7, (px2, py2) => onBody(f, px2, py2, k % 2 ? C.rustDeep : C.ochre));
  }
  for (let x = 14; x <= 38; x += 3) onBody(f, x, 26, C.metalHi);
  for (let x = 14; x <= 38; x += 5) onBody(f, x, 28, C.woodHi);
  for (const [x, y] of [[13, 21], [38, 11], [38, 25], [14, 27]]) px(f, x, y, C.metalHi);
  px(f, 31, 4, C.woodHi);
  px(f, 32, 8, C.woodHi);
  // coals in the hearth mouth and the nozzle's glow
  for (let y = 23; y <= 29; y++) for (let x = 1; x <= 6; x++) {
    const n = valueNoise(x, y, 2, 40);
    if (v === 0) f.glow(x, y, n > 0.7 ? C.hot : n > 0.4 ? C.flame : C.ember, 200);
    else px(f, x, y, n > 0.6 ? C.char : C.coal);
  }
  if (v === 0) {
    f.glow(7, 25, C.hot, 255);
    f.glow(8, 24, C.flame, 220);
  } else f.glow(7, 25, C.lavaDark, 120);
  f.outline({ selective: true });
  return f;
}

/** Chapel altar: stepped stone, a wine cloth with gold trim and a coal bowl; two candles (0) or glyphs and live coals (1). */
export function altar(v: number): Frame {
  const f = new Frame(40, 32);
  const s = new Sculpt();
  s.poly(rect(1, 27, 39, 31), { ...stone, bias: -0.2 }, 1.2, 0, -0.2);
  s.poly(rect(4, 23, 36, 28), { ...stone, bias: 0 }, 1.2, 0, -0.2);
  s.poly(rect(8, 13, 32, 24), { ...stone, cyl: 0.2, bias: 0.2, tex: stoneTex(21) }, 1.2);
  s.poly(rect(5, 9, 35, 13), { ...stone, bias: 0.65 }, 1, 0, -0.35);
  s.ell(20, 8, 5, 2.4, { ...iron, bias: 0.4 });
  s.render(f.c, f.e);
  // the cloth hanging over the front of the pedestal, hem scalloped, gold trim along the slab
  const hem = (x: number): number => 21 + ((x + (v ? 1 : 0)) % 4 < 2 ? 2 : 0) + (x % 7 === 0 ? 1 : 0);
  for (let x = 12; x <= 28; x++) {
    for (let y = 13; y <= hem(x); y++) {
      const u = (x - 12) / 16;
      const idx = Math.max(0, Math.min(RAMPS.wine.length - 1, Math.round(1.6 + u * 1.6 - (y - 13) * 0.08 + (valueNoise(x, y, 3, 8) - 0.5))));
      px(f, x, y, RAMPS.wine[idx]);
    }
    px(f, x, 13, C.gold);
  }
  for (const [x, y] of [[20, 16], [19, 17], [21, 17], [20, 18]]) px(f, x, y, C.goldHi);
  px(f, 12, 21, C.gold);
  px(f, 28, 21, C.gold);
  if (v === 1) {
    // ember glyphs carved into the steps and the coal bowl alight
    for (let k = 0; k < 4; k++) for (const x of [9, 31]) f.glow(x, 15 + k * 2, k % 2 ? C.lavaDark : C.ember, 170);
    for (let x = 6; x <= 34; x += 4) f.glow(x, 29, C.lavaDark, 140);
    for (let x = 17; x <= 23; x++) f.glow(x, 7, valueNoise(x, 7, 2, 3) > 0.5 ? C.flame : C.ember, 220);
    f.glow(20, 6, C.hot, 240);
  } else for (let x = 17; x <= 23; x++) px(f, x, 7, C.coal);
  // candles at the ends of the slab: wax column, a drip down the pedestal, flame (0) or a cold wick (1)
  for (const x of [8, 32]) {
    for (let y = 3; y <= 9; y++) px(f, x, y, y > 5 ? C.parchment : C.bone);
    px(f, x, 9, C.ashGrey);
    px(f, x + (x < 20 ? 1 : -1), 8, C.bone);
    if (v === 0) {
      f.glow(x, 2, C.hot, 255);
      f.glow(x, 1, C.flame, 235);
      f.glow(x, 0, C.ember, 170);
    } else px(f, x, 2, C.coal);
  }
  f.outline({ selective: true });
  return f;
}

/** Statue: an armoured, crowned stone figure on a plinth, ember eyes; the sword point-down (0) or raised (1). */
export function statue(v: number): Frame {
  const f = new Frame(32, 56);
  const s = new Sculpt();
  const st: PrimStyle = { ...stone, tex: stoneTex(61) };
  s.poly(rect(2, 48, 30, 55), { ...stone, bias: -0.2 }, 1.2, 0, -0.2);
  s.poly(rect(5, 43, 27, 49), { ...stone, bias: 0.2 }, 1, 0, -0.3);
  // cloak and legs
  s.poly([[8, 43], [24, 43], [25, 27], [7, 27]], { ...st, cyl: 0.85, bias: 0 }, 1.4);
  s.poly([[11, 43], [15, 43], [15, 31], [11, 31]], { ...st, bias: 0.3 }, 0.8);
  // torso, belt, pauldrons, head with a crown
  s.poly([[10, 29], [22, 29], [21, 17], [11, 17]], { ...st, cyl: 0.6, bias: 0.25 }, 1.2);
  s.poly(rect(10, 28, 22, 30), { ...iron, bias: 0.4 }, 0.6);
  s.ell(8, 19, 4.6, 3.6, { ...st, bias: 0.5, round: 1.2 });
  s.ell(24, 19, 4.6, 3.6, { ...st, bias: 0.4, round: 1.2 });
  s.ell(16, 12, 4.6, 5.2, { ...st, bias: 0.5, round: 1.2 });
  // arms: both hands to the hilt (0), or the right arm thrust up with the blade (1)
  if (v === 0) {
    s.cap(8, 21, 14, 29, 2.4, 1.8, { ...st, bias: 0.3 });
    s.cap(24, 21, 18, 29, 2.4, 1.8, { ...st, bias: 0.2 });
  } else {
    s.cap(24, 21, 26, 22, 2.4, 2, { ...st, bias: 0.4 });
    s.cap(8, 21, 11, 30, 2.4, 1.8, { ...st, bias: 0.3 });
  }
  s.poly([[11, 8], [21, 8], [21, 6], [19, 2], [17, 6], [16, 1], [15, 6], [13, 2], [11, 6]], { ...st, bias: 0.8 }, 0.6);
  s.render(f.c, f.e);
  // the sword: both hands on the hilt, point-down in front (0) or the right arm thrust up with the blade raised (1)
  const blade = (x: number, y0: number, y1: number): void => {
    for (let y = y0; y <= y1; y++) {
      px(f, x, y, y === y0 || y === y1 ? C.metalHi : C.metalLight);
      px(f, x + 1, y, C.metalMid);
    }
  };
  if (v === 0) {
    blade(15, 33, 47);
    for (let x = 12; x <= 19; x++) px(f, x, 32, x % 7 === 0 ? C.metalHi : C.metalMid);
    for (const y of [29, 30]) for (const x of [15, 16]) px(f, x, y, C.stoneLight);
    px(f, 16, 31, C.goldHi);
  } else {
    blade(27, 2, 20);
    for (let x = 24; x <= 30; x++) px(f, x, 21, x % 6 === 0 ? C.metalHi : C.metalMid);
    for (const [x, y] of [[23, 20], [22, 19], [21, 18]]) px(f, x, y, C.stone);
    for (const [x, y] of [[25, 21], [26, 21], [25, 22], [26, 22]]) px(f, x, y, C.stoneLight);
    px(f, 27, 22, C.goldHi);
  }
  // visor slit with ember eyes, scorched hem, hairline cracks
  for (let x = 13; x <= 19; x++) onBody(f, x, 12, C.coal);
  f.glow(14, 12, C.ember, 230);
  f.glow(18, 12, C.ember, 230);
  for (let x = 9; x <= 23; x++) for (let y = 38; y <= 43; y++) if (valueNoise(x, y, 3, 17) > 0.62) onBody(f, x, y, C.char);
  for (const [x, y] of [[20, 33], [19, 35], [20, 37], [18, 36]]) onBody(f, x, y, C.coal);
  f.outline({ selective: true });
  return f;
}

/**
 * The shared `statue` sprite: frames 0 and 1 are the Iron Coliseum champion (drawn by the Chainworks / Coliseum pack, passed in),
 * frames 2 and 3 are this pack's crowned, ember-eyed figure for the Crown Foundry (layouts pick it with `variant` 2 or 3).
 */
export function statueSprite(champion: (v: number) => Frame): SpriteDef {
  const frames = [champion(0), champion(1), statue(0), statue(1)];
  return toSprite('prop/statue', frames, { anchorX: Math.floor(frames[0].w / 2), anchorY: frames[0].h - 1, fps: 0, loop: false });
}
