// Layout art kit 3 (D-territory.md 10.6, slice L3): refined sprites for the Chainworks (rust-iron, hazard yellow) and Iron
// Coliseum (sand-stone, gold) themes. Same ids, frame counts, sizes and anchors as the placeholders in props-kit.ts, so
// solid radii, shadows and the layout compiler need no change; props-kit.ts builds the sprites from these makers (`two('crate', ...)`).
//
// Frame 0 is the default look, frame 1 the layout-selectable alternate (variant 1):
//   crate        iron-bound cargo crate, rust straps (0) / stacked pair, the top one hazard-striped (1)        28x34
//   chainPost    iron post, hazard collar, chain loops (0) / bare, hazard top (1)                              16x36
//   hoist        gantry hoist, hazard-striped beam, trolley and hook (0) / carrying a crate (1)                44x60
//   gate         sandstone gate with iron grille and gold finials, bars down (0) / raised (1)                  40x58
//   weaponRack   iron-shod rack of spears and blades (0) / empty with a hung shield (1)                        32x32
//   obelisk      sandstone obelisk, ember glyphs (0) / gold trophy mark (1)                                    20x52
//   statue       champion in sand-stone plate on a plinth, sword down (0) / raised (1)                         32x56
import { Frame } from './frame';
import { C, RAMPS, type Color } from './palette';
import { lineCells } from './raster';
import { Sculpt, hash2, valueNoise, type PrimStyle } from './shade';

const px = (f: Frame, x: number, y: number, c: Color): void => f.c.set(Math.round(x), Math.round(y), c);
const onBody = (f: Frame, x: number, y: number, c: Color): void => {
  if (f.c.opaque(Math.round(x), Math.round(y))) px(f, x, y, c);
};
const grain = (seed: number, k = 1.2) => (x: number, y: number): number => (valueNoise(x, y, 3, seed) - 0.5) * k + (hash2(x, y, seed) > 0.93 ? -1 : 0);

const sandstone = (seed: number): PrimStyle => ({ ramp: RAMPS.sand, bias: 0.9, dither: 0.08, tex: grain(seed, 1.1) });
const sandstoneDark = (seed: number): PrimStyle => ({ ramp: RAMPS.sand, bias: 0.3, dither: 0.08, tex: grain(seed, 1.1) });
const iron: PrimStyle = { ramp: RAMPS.metal, bias: 0.3, dither: 0.08 };
const rustIron: PrimStyle = { ramp: RAMPS.rust, bias: 0.2, dither: 0.08 };
const planks = (seed: number): PrimStyle => ({ ramp: RAMPS.wood, bias: -0.8, dither: 0.08, tex: grain(seed, 1.4) });

const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y1], [x1, y1], [x1, y0], [x0, y0]];

/** Hazard stripes: diagonal gold and coal bands over the body pixels of a rectangle. */
function hazard(f: Frame, x0: number, y0: number, x1: number, y1: number): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) onBody(f, x, y, ((x + y) >> 1) % 2 === 0 ? C.ochre : C.coal);
}
const sideShade = (f: Frame, x: number, y0: number, y1: number, c: Color): void => {
  for (let y = y0; y <= y1; y++) onBody(f, x, y, c);
};

/** Iron-bound cargo crate: dark planks, rust straps with rivets, a stencilled tag; two stacked in frame 1 (top one hazard-striped). */
export function crate(v: number): Frame {
  const f = new Frame(28, 34);
  const s = new Sculpt();
  const box = (x0: number, y0: number, x1: number, y1: number, seed: number): void => {
    s.poly(rect(x0, y0, x1, y1), planks(seed), 1.2);
    s.poly([[x0 - 1, y0 + 1], [x1 + 1, y0 + 1], [x1 - 2, y0 - 5], [x0 + 2, y0 - 5]], { ...planks(seed + 1), bias: -0.1 }, 1, 0, -0.4);
  };
  box(3, 20, 25, 32, 3);
  if (v === 1) box(5, 8, 23, 20, 9);
  s.render(f.c, f.e);
  const crateDetail = (x0: number, y0: number, x1: number, y1: number): void => {
    for (let y = y0 + 3; y < y1; y += 4) for (let x = x0 + 1; x < x1; x++) if (x % 5 !== 0) onBody(f, x, y, C.woodDeep);
    for (const x of [x0 + 3, x1 - 3]) {
      for (let y = y0; y <= y1; y++) onBody(f, x, y, y === y0 ? C.rustLight : C.rust);
      onBody(f, x + 1, y0 + 1, C.rustDark);
      px(f, x, y0 + 2, C.metalHi);
      px(f, x, y1 - 2, C.metalHi);
    }
    for (const y of [y0, y1 - 1]) for (let x = x0; x <= x1; x++) onBody(f, x, y, y === y0 ? C.metalLight : C.metalDark);
  };
  crateDetail(3, 21, 25, 32);
  for (let x = 12; x <= 16; x++) onBody(f, x, 26, C.strawLight); // stencil tag
  px(f, 13, 27, C.coal);
  px(f, 15, 27, C.coal);
  if (v === 1) {
    crateDetail(5, 9, 23, 20);
    hazard(f, 6, 12, 22, 14);
  }
  sideShade(f, 25, 21, 32, C.woodDeep);
  f.outline({ selective: true });
  return f;
}

/** Chain post: a stone-footed iron post, hazard collar, chain loops (0) or bare (1). */
export function chainPost(v: number): Frame {
  const f = new Frame(16, 36);
  const s = new Sculpt();
  s.poly(rect(3, 31, 13, 35), { ...sandstoneDark(7), bias: 0 }, 1);
  s.poly(rect(6, 8, 10, 32), { ...iron, cyl: 1 }, 0.8);
  s.ell(8, 7, 3.6, 2.4, { ...rustIron, bias: 0.9 });
  s.render(f.c, f.e);
  hazard(f, 6, 24, 10, 27);
  if (v === 0) {
    for (let k = 0; k < 7; k++) {
      const x = 8 + Math.sin(k * 0.9) * 3.5 + k * 0.6;
      const y = 10 + k * 2.6;
      px(f, x, y, k % 2 ? C.metalHi : C.metalLight);
      px(f, x, y + 1, C.metalDark);
    }
  } else {
    hazard(f, 6, 9, 10, 11);
  }
  px(f, 7, 6, C.metalHi);
  f.outline({ selective: true });
  return f;
}

/** Hoist: a rust-iron gantry with a hazard-striped beam, a trolley and a chain with a hook (0) or a hung crate (1). */
export function hoist(v: number): Frame {
  const f = new Frame(44, 60);
  const s = new Sculpt();
  s.poly(rect(4, 52, 40, 58), { ...sandstoneDark(21), bias: -0.2 }, 1.2, 0, -0.2);
  s.poly(rect(6, 8, 12, 54), { ...iron, cyl: 1 }, 1);
  s.poly(rect(32, 8, 38, 54), { ...iron, cyl: 1 }, 1);
  s.poly(rect(4, 3, 40, 10), { ...rustIron, bias: 0.6 }, 1, 0, -0.3);
  s.poly([[6, 40], [12, 30], [12, 34], [6, 46]], { ...iron, bias: -0.3 }, 0.6);
  s.poly([[38, 40], [32, 30], [32, 34], [38, 46]], { ...iron, bias: -0.3 }, 0.6);
  s.poly(rect(17, 10, 27, 14), { ...iron, bias: 0.4 }, 0.8);
  s.render(f.c, f.e);
  hazard(f, 5, 5, 11, 9);
  hazard(f, 33, 5, 39, 9);
  for (let x = 13; x <= 31; x++) onBody(f, x, 9, x % 3 === 0 ? C.metalHi : C.rustLight);
  for (let y = 15; y < 34; y++) if (y % 2 === 0) onBody(f, 22 + (y % 4 === 0 ? 1 : 0), y, C.metalHi);
  px(f, 22, 34, C.metalLight);
  for (const [x, y] of [[21, 35], [20, 36], [20, 37], [21, 38], [22, 38], [23, 37]]) px(f, x, y, C.metalHi);
  if (v === 1) {
    const cs = new Sculpt();
    cs.poly(rect(14, 40, 30, 52), planks(33), 1);
    cs.poly(rect(14, 38, 30, 40), { ...rustIron, bias: 0.4 }, 0.6);
    cs.render(f.c, f.e);
    for (const x of [18, 26]) for (let y = 40; y <= 52; y++) onBody(f, x, y, C.rust);
    for (let y = 35; y < 39; y++) onBody(f, 22, y, C.metalHi);
  }
  for (let y = 12; y < 52; y += 6) onBody(f, 9, y, C.metalHi);
  f.outline({ selective: true });
  return f;
}

/** Gate: a sandstone gate with an iron grille and gold finials; bars lowered (0) or raised into the lintel (1). */
export function gate(v: number): Frame {
  const f = new Frame(40, 58);
  const s = new Sculpt();
  s.poly(rect(2, 48, 38, 56), { ...sandstoneDark(41), bias: 0 }, 1.2, 0, -0.2);
  s.poly(rect(4, 6, 36, 14), { ...sandstone(43), bias: 1.1 }, 1.2, 0, -0.3);
  s.poly(rect(4, 12, 11, 50), { ...sandstone(45), cyl: 1 }, 1);
  s.poly(rect(29, 12, 36, 50), { ...sandstone(47), cyl: 1 }, 1);
  s.render(f.c, f.e);
  const bottom = v === 0 ? 48 : 22;
  for (let x = 13; x <= 27; x += 3) {
    for (let y = 13; y <= bottom; y++) px(f, x, y, y % 8 === 0 ? C.rustLight : x < 20 ? C.metalMid : C.metalDark);
    if (v === 0) {
      px(f, x, bottom + 1, C.metalHi);
      px(f, x, bottom - 1, C.metalLight);
    }
  }
  for (const y of [20, 34]) if (y < bottom) for (let x = 12; x <= 28; x++) onBody(f, x, y, C.rustLight);
  // masonry courses and the gold finials / lintel inlay
  for (const y of [20, 28, 36, 44]) {
    for (let x = 5; x <= 10; x++) onBody(f, x, y, C.sandDark);
    for (let x = 30; x <= 35; x++) onBody(f, x, y, C.sandDark);
  }
  for (let x = 6; x <= 34; x += 4) px(f, x, 5, C.sandLight);
  for (let x = 8; x <= 32; x++) if (x % 2 === 0) onBody(f, x, 10, C.gold);
  for (const x of [7, 33]) {
    px(f, x, 4, C.goldHi);
    px(f, x, 3, C.gold);
    px(f, x, 2, C.ochre);
  }
  f.outline({ selective: true });
  return f;
}

/** Weapon rack: an iron-shod wooden rack of spears and blades (0), or empty with a hung round shield (1). */
export function weaponRack(v: number): Frame {
  const f = new Frame(32, 32);
  const s = new Sculpt();
  s.poly(rect(2, 26, 30, 30), { ...planks(53), bias: -0.3 }, 1);
  s.poly(rect(3, 8, 7, 28), { ...planks(55), cyl: 1, bias: 0.2 }, 0.8);
  s.poly(rect(25, 8, 29, 28), { ...planks(57), cyl: 1, bias: 0.2 }, 0.8);
  s.poly(rect(2, 10, 30, 13), { ...planks(59), bias: 0.6 }, 0.8);
  s.poly(rect(3, 19, 29, 21), { ...planks(61), bias: 0.4 }, 0.6);
  s.render(f.c, f.e);
  for (const x of [4, 5, 26, 27]) onBody(f, x, 27, C.metalLight); // iron feet
  for (const x of [3, 28]) onBody(f, x, 11, C.metalHi);
  if (v === 0) {
    for (const [x, h, k] of [[10, 22, 0], [14, 26, 1], [18, 20, 0], [22, 24, 1]] as const) {
      for (let y = 26 - h; y < 26; y++) onBody(f, x, y, C.woodHi);
      px(f, x, 26 - h - 2, C.metalHi);
      px(f, x, 26 - h - 1, C.metalHi);
      px(f, x, 26 - h, C.metalLight);
      px(f, x - 1, 26 - h + 1, C.metalMid);
      px(f, x + 1, 26 - h + 1, C.metalMid);
      if (k) px(f, x + 1, 26 - h + 3, C.metalMid);
    }
  } else {
    const sh = new Sculpt();
    sh.ell(16, 18, 6, 6, { ramp: RAMPS.metal, bias: 0.4, round: 1.2 });
    sh.render(f.c, f.e);
    for (let a = 0; a < 8; a++) px(f, 16 + Math.cos(a * 0.785) * 5, 18 + Math.sin(a * 0.785) * 5, C.rustLight);
    px(f, 16, 18, C.gold);
  }
  f.outline({ selective: true });
  return f;
}

/** Obelisk: a slim, tapering sandstone shaft; ember glyphs (0) or a gold trophy mark (1). */
export function obelisk(v: number): Frame {
  const f = new Frame(20, 52);
  const s = new Sculpt();
  s.poly(rect(2, 46, 18, 51), { ...sandstoneDark(71), bias: 0.2 }, 1, 0, -0.2);
  s.poly(rect(4, 42, 16, 47), { ...sandstone(73), bias: 0.6 }, 1, 0, -0.3);
  s.poly([[5, 43], [15, 43], [13, 8], [10, 2], [7, 8]], { ...sandstone(75), cyl: 0.8, bias: 0.3 }, 1.2);
  s.render(f.c, f.e);
  const col = v === 0 ? C.ember : C.gold;
  const dim = v === 0 ? C.lavaDark : C.ochre;
  for (let k = 0; k < 4; k++) {
    const y = 14 + k * 7;
    f.glow(10, y, col, 190);
    f.glow(9, y + 2, dim, 150);
    f.glow(11, y + 2, dim, 150);
    f.glow(10, y + 4, k % 2 ? dim : col, 170);
  }
  if (v === 1) {
    for (let x = 6; x <= 14; x++) onBody(f, x, 44, x % 2 ? C.gold : C.ochre);
    for (let x = 7; x <= 13; x++) onBody(f, x, 18 - (Math.abs(x - 10) > 2 ? 0 : 1), C.goldHi);
  }
  f.glow(10, 3, v === 0 ? C.hot : C.goldHi, 255);
  f.outline({ selective: true });
  return f;
}

/** Statue: a champion in sand-stone plate on a plinth with a crested helm and a shield, sword down (0) or raised (1). */
export function statue(v: number): Frame {
  const f = new Frame(32, 56);
  const s = new Sculpt();
  s.poly(rect(3, 46, 29, 55), { ...sandstoneDark(81), bias: 0.4 }, 1.2, 0, -0.2);
  s.poly(rect(6, 40, 26, 47), { ...sandstone(83), bias: 0.7 }, 1, 0, -0.3);
  s.poly([[10, 40], [22, 40], [23, 24], [9, 24]], { ...sandstone(85), cyl: 0.7, bias: 0.4 }, 1.2);
  s.ell(16, 20, 6, 5, { ...sandstone(87), bias: 0.8, round: 1.2 });
  s.poly([[7, 25], [25, 25], [22, 22], [10, 22]], { ...sandstone(89), bias: 1 }, 0.8);
  s.poly([[14, 14], [18, 14], [17, 8], [15, 8]], { ...sandstone(91), bias: 0.9 }, 0.6); // helm crest
  s.render(f.c, f.e);
  const blade = (x: number, y0: number, y1: number): void => {
    for (let y = y0; y <= y1; y++) px(f, x, y, y === y0 ? C.metalHi : C.metalLight);
  };
  if (v === 0) {
    blade(16, 30, 44);
    for (let x = 13; x <= 19; x++) px(f, x, 30, C.gold);
  } else {
    blade(26, 4, 22);
    for (let x = 23; x <= 29; x++) px(f, x, 22, C.gold);
  }
  // a round shield on the off arm
  const shield = new Sculpt();
  shield.ell(11, 31, 3.4, 4, { ramp: RAMPS.sand, bias: 1.2, round: 1.2 });
  shield.render(f.c, f.e);
  px(f, 11, 31, C.gold);
  for (const x of [14, 18]) onBody(f, x, 19, C.coal);
  for (let y = 41; y <= 45; y += 2) for (let x = 8; x <= 24; x += 4) onBody(f, x, y, C.sandDeep);
  lineCells(8, 47, 24, 47, (x, y) => onBody(f, x, y, C.gold));
  f.outline({ selective: true });
  return f;
}
