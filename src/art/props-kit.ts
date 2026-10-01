// The layout art kit: fourteen props for the hand-crafted areas (docs/atlas-rework/D-territory.md 10.5 and 10.6),
// bottom-centre anchored, drawn in the existing pixel style (Sculpt primitives, the shared palette, selective
// outline). Placeholder quality by design: legible silhouettes, one recolour each; the layout packs refine them.
//
// Frame convention: fps 0, frame = PropView.variant % frames. Frame 0 is the default look, frame 1 the theme
// recolour or alternate state the layouts can pick with `variant` (see KIT_FRAMES in src/present/props.ts for which
// theme prefers which). Solid radii and default footprints live in src/data/layouts/schema.ts (LAYOUT_PROP_RADIUS).
//
//   vat            slag vat: iron drum of molten slag (0) / cooled crust (1)                      64x50
//   bellows        wooden forge bellows with a glowing nozzle (0) / cold (1)                       40x34
//   altar          stone altar with two candles (0) / carved with ember glyphs (1)                 40x32
//   sarcophagus    stone coffin with a carved lid (0) / violet-runed (1)                           48x30
//   choirStall     high-backed wooden stall (0) / bone-white (1)                                   30x40
//   ribArch        a great bone rib curving right (0) / left (1): two rows make an arch            44x60
//   iceColumn      frozen column of cold stone and crystal (0) / broken (1)                        22x52
//   crate          iron-strapped crate (0) / stacked pair (1)                                      28x34
//   chainPost      iron post hung with chain loops (0) / bare (1)                                  16x36
//   hoist          gantry hoist with a hanging hook (0) / loaded (1)                               44x60
//   gate           iron-barred gatepost, bars down (0) / raised (1)                                40x58
//   weaponRack     wooden rack of spears and blades (0) / empty (1)                                32x32
//   obelisk        slim glyph obelisk, ember (0) / gold trophy (1)                                 20x52
//   statue         champion statue on a plinth, sword down (0) / raised (1)                        32x56
import type { SpriteDef } from '../contracts/art';
import { Frame, toSprite } from './frame';
import { C, RAMPS, type Color } from './palette';
import { lineCells } from './raster';
import { Sculpt, hash2, valueNoise, type PrimStyle } from './shade';
import * as ossuaryCrypt from './props-ossuary-crypt';
import * as chainworksColiseum from './props-chainworks-coliseum';
import * as ashenChapel from './props-ashen-chapel';

const px = (f: Frame, x: number, y: number, c: Color): void => f.c.set(Math.round(x), Math.round(y), c);
const onBody = (f: Frame, x: number, y: number, c: Color): void => {
  if (f.c.opaque(Math.round(x), Math.round(y))) px(f, x, y, c);
};
const stoneTex = (seed: number) => (x: number, y: number): number => (valueNoise(x, y, 3, seed) - 0.5) * 1.2 + (hash2(x, y, seed) > 0.92 ? -1 : 0);
const stone: PrimStyle = { ramp: RAMPS.stone, bias: 0.2, dither: 0.08, tex: stoneTex(5) };
const iron: PrimStyle = { ramp: RAMPS.metal, bias: 0.3, dither: 0.08 };
const wood: PrimStyle = { ramp: RAMPS.wood, bias: 0.3, dither: 0.08 };
const bone: PrimStyle = { ramp: RAMPS.bone, bias: 0.2, dither: 0.08, tex: stoneTex(11) };
const ice: PrimStyle = { ramp: RAMPS.oss, bias: 0.4, dither: 0.08, tex: stoneTex(13) };
const rust: PrimStyle = { ramp: RAMPS.rust, bias: 0.1, dither: 0.08 };

const spec = (f: Frame) => ({ anchorX: Math.floor(f.w / 2), anchorY: f.h - 1, fps: 0, loop: false });
const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y1], [x1, y1], [x1, y0], [x0, y0]];

/** Slag vat: a squat iron drum under a ring of rivets; the top is a pool of slag (0) or a cooled crust (1). */
function vat(v: number): Frame {
  const f = new Frame(64, 50);
  const s = new Sculpt();
  const cx = 32;
  s.poly(rect(8, 26, 56, 46), { ...iron, cyl: 1, bias: 0.1 }, 2);
  s.ell(cx, 46, 24, 4.5, { ...iron, bias: -0.6 });
  s.poly(rect(8, 26, 56, 30), { ...rust, cyl: 1, bias: 0.3 }, 1);
  s.ell(cx, 26, 24, 11, { ...iron, bias: 0.5, round: 0.5 });
  s.render(f.c, f.e);
  for (const y of [34, 41]) for (let x = 9; x <= 55; x++) onBody(f, x, y, x % 6 === 0 ? C.metalHi : C.metalDark);
  for (let k = 0; k < 9; k++) onBody(f, 12 + k * 5.2, 31, C.metalHi);
  // the pool inside the rim
  for (let y = 18; y <= 33; y++) {
    for (let x = 12; x <= 52; x++) {
      const dx = (x - cx) / 19;
      const dy = (y - 26) / 8;
      const d = dx * dx + dy * dy;
      if (d > 1) continue;
      const n = valueNoise(x, y, 4, 70 + v);
      if (v === 0) f.glow(x, y, n > 0.78 ? C.hot : n > 0.5 ? C.flame : n > 0.25 ? C.ember : C.lavaDark, 150 + n * 100);
      else px(f, x, y, n > 0.82 ? C.lavaDark : n > 0.45 ? C.char : C.coal);
    }
  }
  if (v === 1) for (const [x, y] of [[24, 25], [34, 28], [40, 24]]) f.glow(x, y, C.ember, 170);
  f.outline({ selective: true });
  return f;
}

/** Forge bellows: a pleated leather bag between two wooden boards, iron nozzle aimed down-left. */
function bellows(v: number): Frame {
  const f = new Frame(40, 34);
  const s = new Sculpt();
  s.poly(rect(4, 28, 36, 32), { ...stone, bias: -0.2 }, 1);
  s.poly([[6, 27], [30, 27], [34, 12], [10, 8]], { ...wood, bias: 0.1, cyl: 0.3 }, 1.2);
  s.poly([[8, 26], [28, 26], [31, 14], [12, 11]], { ramp: RAMPS.rust, bias: -0.2, dither: 0.1 }, 1);
  s.poly(rect(5, 6, 15, 9), { ...wood, bias: 0.5 }, 1);
  s.cap(8, 23, 1, 28, 2.2, 1.4, iron);
  s.render(f.c, f.e);
  for (let k = 0; k < 4; k++) {
    const t = k / 4;
    lineCells(8 + t * 4, 26 - t * 14, 28 + t * 3, 25 - t * 13, (x, y) => onBody(f, x, y, k % 2 ? C.rustDark : C.rustLight));
  }
  f.glow(1, 28, v === 0 ? C.hot : C.lavaDark, v === 0 ? 255 : 120);
  if (v === 0) {
    f.glow(0, 29, C.flame, 220);
    f.glow(2, 29, C.ember, 200);
  }
  f.outline({ selective: true });
  return f;
}

/** Altar: a stepped stone block with a slab top; two candles (0) or ember glyphs (1). */
function altar(v: number): Frame {
  const f = new Frame(40, 32);
  const s = new Sculpt();
  s.poly(rect(3, 25, 37, 31), { ...stone, bias: -0.1 }, 1.2, 0, -0.2);
  s.poly(rect(6, 15, 34, 25), { ...stone, cyl: 0.2, bias: 0.2, tex: stoneTex(21) }, 1.2);
  s.poly(rect(4, 11, 36, 15), { ...stone, bias: 0.6 }, 1, 0, -0.35);
  s.render(f.c, f.e);
  for (const x of v === 0 ? [12, 20, 28] : []) for (let y = 17; y <= 22; y++) onBody(f, x, y, C.coal);
  if (v === 1) {
    for (let i = 0; i < 3; i++) for (let k = 0; k < 4; k++) f.glow(11 + i * 9, 17 + k * 1.6, k % 2 ? C.lavaDark : C.ember, 170);
  }
  for (const x of [11, 29]) {
    for (let y = 5; y <= 10; y++) px(f, x, y, y > 6 ? C.parchment : C.bone);
    f.glow(x, 3, C.hot, 255);
    f.glow(x, 4, C.flame, 230);
  }
  f.outline({ selective: true });
  return f;
}

/** Sarcophagus: a stone coffin seen from the front-left, a carved ridge down the lid. */
function sarcophagus(v: number): Frame {
  const f = new Frame(48, 30);
  const s = new Sculpt();
  s.poly(rect(4, 15, 44, 28), { ...stone, cyl: 0.1, bias: -0.1, tex: stoneTex(31) }, 1.5);
  s.poly([[2, 16], [46, 16], [42, 6], [8, 6]], { ...stone, bias: 0.5, tex: stoneTex(33) }, 1.5, 0, -0.35);
  s.poly([[10, 11], [38, 11], [36, 8], [12, 8]], { ...stone, bias: 0.8 }, 1);
  s.render(f.c, f.e);
  // the carved figure: a head and folded hands
  for (const [x, y] of [[13, 10], [14, 10], [13, 9], [14, 9]]) onBody(f, x, y, C.stoneLight);
  for (let x = 20; x <= 34; x += 2) onBody(f, x, 10, C.coal);
  for (let x = 6; x <= 42; x += 8) onBody(f, x, 21, C.coal);
  for (let k = 0; k < 4; k++) {
    const x = 11 + k * 8;
    if (v === 1) f.glow(x, 21, k % 2 ? C.voidLight : C.voidGlow, 190);
  }
  if (v === 1) for (let x = 20; x <= 34; x += 3) f.glow(x, 9, C.voidGlow, 170);
  f.outline({ selective: true });
  return f;
}

/** Choir stall: a high-backed wooden stall, carved finials. */
function choirStall(v: number): Frame {
  const f = new Frame(30, 40);
  const s = new Sculpt();
  const body: PrimStyle = v === 0 ? { ...wood, bias: 0 } : { ramp: RAMPS.bone, bias: -0.2, dither: 0.08 };
  s.poly(rect(3, 4, 27, 28), { ...body, cyl: 0.15 }, 1.5);
  s.poly(rect(2, 26, 28, 34), { ...body, bias: 0.3 }, 1.2);
  s.poly(rect(5, 33, 25, 38), { ...body, bias: -0.5 }, 1);
  s.poly([[3, 4], [27, 4], [24, 0], [15, -1], [6, 0]], { ...body, bias: 0.6 }, 1);
  s.render(f.c, f.e);
  for (const x of [8, 15, 22]) for (let y = 7; y <= 22; y++) onBody(f, x, y, y % 5 === 0 ? C.metalDark : C.woodDeep);
  for (const x of [3, 26]) {
    px(f, x, 2, C.goldHi);
    px(f, x, 3, C.gold);
  }
  f.outline({ selective: true });
  return f;
}

/** Rib arch: one great rib rising and curving over (right in frame 0, left in frame 1) with a vertebra base. */
function ribArch(v: number): Frame {
  const f = new Frame(44, 60);
  const s = new Sculpt();
  const dir = v === 0 ? 1 : -1;
  s.ell(22, 55, 9, 4, { ...bone, bias: -0.2 });
  const pts: [number, number][] = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    pts.push([22 + dir * 17 * Math.sin(t * 1.35), 54 - 52 * Math.sin(t * 1.5) * (1 - t * 0.15)]);
  }
  for (let i = 0; i < pts.length - 1; i++) s.cap(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 4.4 * (1 - i / 22), 4.4 * (1 - (i + 1) / 22), bone);
  s.render(f.c, f.e);
  for (let i = 1; i < pts.length - 2; i += 3) onBody(f, pts[i][0] - dir, pts[i][1], C.ashGrey);
  f.outline({ selective: true });
  return f;
}

/** Ice column: a fluted column of frost-pale stone with a crystal cap (0) or snapped short (1). */
function iceColumn(v: number): Frame {
  const f = new Frame(22, 52);
  const s = new Sculpt();
  const top = v === 0 ? 5 : 22;
  s.poly(rect(2, 44, 20, 51), { ...ice, bias: -0.1 }, 1.2, 0, -0.2);
  s.poly(rect(5, top, 17, 46), { ...ice, cyl: 1, glow: 20 }, 1);
  if (v === 0) s.poly(rect(3, 2, 19, top + 1), { ...ice, bias: 0.8 }, 1, 0, -0.3);
  else s.poly([[5, top], [8, top - 4], [11, top - 1], [14, top - 6], [17, top]], { ...ice, bias: 0.9, glow: 90 }, 0.8);
  s.render(f.c, f.e);
  for (const x of [8, 11, 14]) for (let y = top + 3; y < 43; y++) onBody(f, x, y, (x + y) % 6 === 0 ? C.ossFrost : C.ossMid);
  for (const [x, y] of [[9, top + 8], [13, top + 16], [10, top + 24]]) f.glow(x, y, C.ice, 160);
  f.outline({ selective: true });
  return f;
}

/** Crate: a strapped wooden crate (0) or two stacked (1). */
function crate(v: number): Frame {
  const f = new Frame(28, 34);
  const s = new Sculpt();
  const box = (x0: number, y0: number, x1: number, y1: number): void => {
    s.poly(rect(x0, y0, x1, y1), { ...wood, bias: 0 }, 1.2);
    s.poly([[x0 - 1, y0 + 1], [x1 + 1, y0 + 1], [x1 - 2, y0 - 5], [x0 + 2, y0 - 5]], { ...wood, bias: 0.6 }, 1, 0, -0.4);
  };
  box(3, 20, 25, 32);
  if (v === 1) box(6, 8, 22, 20);
  s.render(f.c, f.e);
  const strap = (x: number, y0: number, y1: number): void => {
    for (let y = y0; y <= y1; y++) onBody(f, x, y, y === y0 ? C.metalHi : C.metalMid);
    onBody(f, x + 1, y0 + 1, C.metalDark);
  };
  strap(8, 21, 32);
  strap(20, 21, 32);
  if (v === 1) {
    strap(10, 9, 20);
    strap(18, 9, 20);
  }
  for (let x = 4; x <= 24; x++) onBody(f, x, 26, C.woodDeep);
  f.outline({ selective: true });
  return f;
}

/** Chain post: a short iron post with a ring, chain loops hanging (0) or bare (1). */
function chainPost(v: number): Frame {
  const f = new Frame(16, 36);
  const s = new Sculpt();
  s.poly(rect(3, 31, 13, 35), { ...stone, bias: -0.2 }, 1);
  s.poly(rect(6, 8, 10, 32), { ...iron, cyl: 1 }, 0.8);
  s.ell(8, 7, 3.6, 2.4, { ...iron, bias: 0.6 });
  s.render(f.c, f.e);
  if (v === 0) {
    for (let k = 0; k < 7; k++) {
      const x = 8 + Math.sin(k * 0.9) * 3.5 + k * 0.6;
      const y = 10 + k * 2.6;
      px(f, x, y, k % 2 ? C.metalHi : C.metalLight);
      px(f, x, y + 1, C.metalDark);
    }
  }
  px(f, 7, 6, C.metalHi);
  f.outline({ selective: true });
  return f;
}

/** Hoist: a gantry — two iron legs, a cross-beam and a chain with a hook. */
function hoist(v: number): Frame {
  const f = new Frame(44, 60);
  const s = new Sculpt();
  s.poly(rect(4, 52, 40, 58), { ...stone, bias: -0.2 }, 1.2, 0, -0.2);
  s.poly(rect(6, 8, 12, 54), { ...iron, cyl: 1 }, 1);
  s.poly(rect(32, 8, 38, 54), { ...iron, cyl: 1 }, 1);
  s.poly(rect(4, 3, 40, 10), { ...iron, bias: 0.5 }, 1, 0, -0.3);
  s.poly([[6, 40], [12, 30], [12, 34], [6, 46]], { ...iron, bias: -0.3 }, 0.6);
  s.poly([[38, 40], [32, 30], [32, 34], [38, 46]], { ...iron, bias: -0.3 }, 0.6);
  s.render(f.c, f.e);
  for (let y = 11; y < 33; y++) if (y % 2 === 0) onBody(f, 22 + (y % 4 === 0 ? 1 : 0), y, C.metalHi);
  px(f, 22, 33, C.metalLight);
  for (const [x, y] of [[21, 34], [20, 35], [20, 36], [21, 37], [22, 37], [23, 36]]) px(f, x, y, C.metalHi);
  if (v === 1) for (let y = 38; y < 50; y++) for (let x = 15; x < 30; x++) if (y > 40 + Math.abs(x - 22) * 0.4) px(f, x, y, valueNoise(x, y, 3, 8) > 0.5 ? C.wood : C.woodDark);
  for (let x = 6; x < 39; x += 6) onBody(f, x, 6, C.metalHi);
  f.outline({ selective: true });
  return f;
}

/** Gate: a stone gatepost carrying an iron grille; bars lowered (0) or raised into the lintel (1). */
function gate(v: number): Frame {
  const f = new Frame(40, 58);
  const s = new Sculpt();
  s.poly(rect(2, 48, 38, 56), { ...stone, bias: -0.1 }, 1.2, 0, -0.2);
  s.poly(rect(4, 6, 36, 14), { ...stone, bias: 0.4, tex: stoneTex(41) }, 1.2, 0, -0.3);
  s.poly(rect(4, 12, 11, 50), { ...stone, cyl: 1, tex: stoneTex(43) }, 1);
  s.poly(rect(29, 12, 36, 50), { ...stone, cyl: 1, tex: stoneTex(45) }, 1);
  s.render(f.c, f.e);
  const bottom = v === 0 ? 48 : 22;
  for (let x = 13; x <= 27; x += 3) {
    for (let y = 13; y <= bottom; y++) px(f, x, y, y % 8 === 0 ? C.metalHi : x < 20 ? C.metalMid : C.metalDark);
    if (v === 0) px(f, x, bottom + 1, C.metalHi);
  }
  for (const y of [20, 34]) if (y < bottom) for (let x = 12; x <= 28; x++) onBody(f, x, y, C.metalLight);
  for (let x = 4; x <= 36; x += 4) px(f, x, 5, C.stoneLight);
  f.outline({ selective: true });
  return f;
}

/** Weapon rack: a wooden frame holding spears and swords (0) or empty (1). */
function weaponRack(v: number): Frame {
  const f = new Frame(32, 32);
  const s = new Sculpt();
  s.poly(rect(2, 26, 30, 30), { ...wood, bias: -0.3 }, 1);
  s.poly(rect(3, 8, 7, 28), { ...wood, cyl: 1 }, 0.8);
  s.poly(rect(25, 8, 29, 28), { ...wood, cyl: 1 }, 0.8);
  s.poly(rect(2, 10, 30, 13), { ...wood, bias: 0.4 }, 0.8);
  s.poly(rect(3, 19, 29, 21), { ...wood, bias: 0.2 }, 0.6);
  s.render(f.c, f.e);
  if (v === 0) {
    for (const [x, h] of [[10, 22], [14, 26], [18, 20], [22, 24]] as const) {
      for (let y = 26 - h; y < 26; y++) onBody(f, x, y, C.woodLight);
      px(f, x, 26 - h - 1, C.metalHi);
      px(f, x, 26 - h, C.metalLight);
      px(f, x - 1, 26 - h + 1, C.metalMid);
      px(f, x + 1, 26 - h + 1, C.metalMid);
    }
  }
  f.outline({ selective: true });
  return f;
}

/** Obelisk: a slim, tapering glyph-carved stone; ember glyphs (0) or a gold trophy mark (1). */
function obelisk(v: number): Frame {
  const f = new Frame(20, 52);
  const s = new Sculpt();
  s.poly(rect(2, 46, 18, 51), { ...stone, bias: -0.1 }, 1, 0, -0.2);
  s.poly([[5, 46], [15, 46], [13, 8], [10, 2], [7, 8]], { ...stone, cyl: 0.8, bias: 0.15, tex: stoneTex(51) }, 1.2);
  s.render(f.c, f.e);
  const col = v === 0 ? C.ember : C.gold;
  const dim = v === 0 ? C.lavaDark : C.ochre;
  for (let k = 0; k < 4; k++) {
    const y = 14 + k * 8;
    f.glow(10, y, col, 190);
    f.glow(9, y + 2, dim, 150);
    f.glow(11, y + 2, dim, 150);
    f.glow(10, y + 4, k % 2 ? dim : col, 170);
  }
  if (v === 1) for (let x = 6; x <= 14; x++) onBody(f, x, 44, x % 2 ? C.gold : C.ochre);
  f.glow(10, 3, v === 0 ? C.hot : C.goldHi, 255);
  f.outline({ selective: true });
  return f;
}

/** Statue: a champion in plate on a plinth, sword point-down (0) or raised (1). */
function statue(v: number): Frame {
  const f = new Frame(32, 56);
  const s = new Sculpt();
  s.poly(rect(3, 46, 29, 55), { ...stone, bias: -0.1 }, 1.2, 0, -0.2);
  s.poly(rect(6, 40, 26, 47), { ...stone, bias: 0.3 }, 1, 0, -0.3);
  s.poly([[10, 40], [22, 40], [23, 24], [9, 24]], { ...stone, cyl: 0.7, bias: 0.15, tex: stoneTex(61) }, 1.2);
  s.ell(16, 20, 6, 5, { ...stone, bias: 0.4, round: 1.2 });
  s.poly([[7, 25], [25, 25], [22, 22], [10, 22]], { ...stone, bias: 0.5 }, 0.8);
  s.render(f.c, f.e);
  const blade = (x: number, y0: number, y1: number): void => {
    for (let y = y0; y <= y1; y++) px(f, x, y, y === y0 ? C.metalHi : C.metalLight);
  };
  if (v === 0) {
    blade(16, 30, 44);
    for (let x = 13; x <= 19; x++) px(f, x, 30, C.metalMid);
  } else {
    blade(26, 4, 22);
    for (let x = 23; x <= 29; x++) px(f, x, 22, C.metalMid);
  }
  for (const x of [14, 18]) onBody(f, x, 19, C.coal);
  f.outline({ selective: true });
  return f;
}

/** The kit's sprites, one entry per new PropKind (ids `prop/<kind>`, 2 frames each). */
export function kitPropSprites(): SpriteDef[] {
  const two = (id: string, make: (v: number) => Frame): SpriteDef => {
    const frames = [make(0), make(1)];
    return toSprite(`prop/${id}`, frames, spec(frames[0]));
  };
  return [
    two('vat', ashenChapel.vat), two('bellows', ashenChapel.bellows), two('altar', ashenChapel.altar), two('sarcophagus', ossuaryCrypt.sarcophagus), two('choirStall', ossuaryCrypt.choirStall),
    two('ribArch', ossuaryCrypt.ribArch), two('iceColumn', ossuaryCrypt.iceColumn), two('crate', chainworksColiseum.crate), two('chainPost', chainworksColiseum.chainPost), two('hoist', chainworksColiseum.hoist),
    two('gate', chainworksColiseum.gate), two('weaponRack', chainworksColiseum.weaponRack), two('obelisk', chainworksColiseum.obelisk), ashenChapel.statueSprite(chainworksColiseum.statue),
  ];
}
