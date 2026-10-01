// Refined sprites for the Rimed Ossuary and Choral Crypt layout props (D-territory.md 10.6): ribArch, iceColumn,
// sarcophagus, choirStall. Same pixel pipeline as the rest of the kit (Sculpt primitives, the shared palette, selective
// outline), bottom-centre anchored, 2 frames each (frame 0 default, frame 1 the recolour or alternate state the layouts
// pick with `variant`). Sizes are unchanged from the placeholders (src/art/props-kit.ts), so solid radii, the presenter's
// scale table and the layouts stay valid. Look: frost-pale bone and ice (Ossuary), violet-shadowed stone with cold highlights
// (Crypt). props-kit.ts registers these four in place of its placeholders.
//
//   ribArch      a bone rib rising and curving over, vertebra base, frost rime (0 curves right) / mirrored (1)   44x60
//   iceColumn    fluted ice-stone column, faceted crystal cap and icicles, inner glow (0) / snapped, jagged (1)    22x52
//   sarcophagus  violet-grey stone coffin, carved effigy lid (0) / violet-runed and glowing (1)                    48x30
//   choirStall   high-backed dark stall with bone finials (0) / bone-white with a violet candle (1)                30x40
import { Frame } from './frame';
import { C, RAMPS, type Color } from './palette';
import { Sculpt, hash2, valueNoise, type PrimStyle } from './shade';

const px = (f: Frame, x: number, y: number, c: Color): void => f.c.set(Math.round(x), Math.round(y), c);
const onBody = (f: Frame, x: number, y: number, c: Color): void => {
  if (f.c.opaque(Math.round(x), Math.round(y))) px(f, x, y, c);
};
const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y1], [x1, y1], [x1, y0], [x0, y0]];
const grain = (seed: number) => (x: number, y: number): number => (valueNoise(x, y, 3, seed) - 0.5) * 1.2 + (hash2(x, y, seed) > 0.92 ? -1 : 0);

/** Violet-shadowed stone with cold highlights: the Crypt's masonry. */
const CRYPT = [C.voidDeep, C.voidDark, C.voidMid, C.ossLight, C.ossPale, C.ossFrost];
const crypt = (seed: number): PrimStyle => ({ ramp: CRYPT, bias: 0.1, dither: 0.1, tex: grain(seed) });
const bone = (seed: number): PrimStyle => ({ ramp: RAMPS.bone, bias: 0.25, dither: 0.08, tex: grain(seed) });
const ice = (seed: number): PrimStyle => ({ ramp: RAMPS.frost, bias: -0.2, dither: 0.1, tex: grain(seed) });

/** Rib arch: a single great rib, ridged along its length, tapering to a point, on a vertebra with a frost-rimed foot. */
export function ribArch(v: number): Frame {
  const f = new Frame(44, 60);
  const s = new Sculpt();
  const dir = v === 0 ? 1 : -1;
  const cx = 22;
  // the foot: a vertebra and a small mound of bone shards
  s.ell(cx, 55, 10, 4.2, { ...bone(11), bias: -0.3 });
  s.ell(cx - dir * 5, 53, 4, 3, { ...bone(12), bias: 0.2 });
  s.ell(cx + dir * 4, 52, 5, 4.5, { ...bone(13), bias: 0.35, round: 1.2 });
  // the rib: a curve that rises, bends over and tapers
  const pts: [number, number][] = [];
  const n = 18;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    pts.push([cx + dir * 19 * Math.sin(t * 1.38), 52 - 50 * Math.sin(t * 1.5) * (1 - t * 0.12)]);
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    s.cap(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], 4.6 * (1 - t0 * 0.8), 4.6 * (1 - t1 * 0.8), bone(14 + i));
  }
  s.render(f.c, f.e);
  // ridges along the rib and frost rime on the lit (upper) side
  for (let i = 1; i < pts.length - 2; i++) {
    const [x, y] = pts[i];
    if (i % 3 === 0) onBody(f, x - dir, y + 1, C.stoneLight);
    if (i % 2 === 1) onBody(f, x + dir * 0.6, y - 2, C.ossFrost);
    if (i % 4 === 2) f.glow(x + dir, y - 1, C.ice, 120);
  }
  for (const [x, y] of [[cx - 7, 54], [cx + 8, 55], [cx + 1, 56]] as const) onBody(f, x, y, C.ossFrost);
  f.outline({ selective: true });
  return f;
}

/** Ice column: a fluted shaft of blue-tinted ice-stone with a faceted crystal cap and icicles (0), or snapped (1). */
export function iceColumn(v: number): Frame {
  const f = new Frame(22, 52);
  const s = new Sculpt();
  const top = v === 0 ? 7 : 24;
  s.poly(rect(1, 45, 21, 51), { ...ice(21), bias: -0.5 }, 1.2, 0, -0.2);
  s.poly(rect(3, 41, 19, 46), { ...ice(22), bias: 0.1 }, 1, 0, -0.3);
  s.poly(rect(5, top, 17, 43), { ...ice(23), cyl: 1, glow: 28, bias: 0.1 }, 1);
  if (v === 0) {
    s.poly(rect(3, 4, 19, top + 1), { ...ice(24), bias: 0.6 }, 1, 0, -0.3);
    s.poly([[5, 4], [11, -2], [17, 4]], { ...ice(25), bias: 1.1, glow: 90 }, 0.8, 0, -0.4);
  } else {
    s.poly([[5, top], [7, top - 6], [10, top - 2], [13, top - 9], [16, top - 3], [17, top]], { ...ice(26), bias: 1, glow: 100 }, 0.8);
  }
  s.render(f.c, f.e);
  // flutes, a bright facet line and drifting inner glints
  for (const x of [8, 11, 14]) for (let y = top + 3; y < 41; y++) onBody(f, x, y, (x + y) % 5 === 0 ? C.ossFrost : x === 11 ? C.frostMid : C.frostDark);
  for (const [x, y] of [[9, top + 6], [13, top + 14], [10, top + 22], [14, top + 28]] as const) f.glow(x, y, C.ice, 190);
  f.glow(7, top + 2, C.white, 220);
  if (v === 0) {
    // icicles under the cap
    for (const [x, len] of [[5, 5], [8, 3], [14, 4], [17, 6]] as const) for (let k = 0; k < len; k++) px(f, x, 8 + k, k === len - 1 ? C.ossFrost : C.ice);
  } else {
    for (const [x, y] of [[8, 46], [13, 47], [16, 45], [5, 46]] as const) px(f, x, y, C.ossFrost);
  }
  f.outline({ selective: true });
  return f;
}

/** Sarcophagus: a violet-shadowed stone coffin with a stepped lid and a carved effigy (0), runes lit violet (1). */
export function sarcophagus(v: number): Frame {
  const f = new Frame(48, 30);
  const s = new Sculpt();
  s.poly(rect(4, 15, 44, 28), { ...crypt(31), cyl: 0.1, bias: -0.2 }, 1.5);
  s.poly(rect(2, 25, 46, 29), { ...crypt(32), bias: -0.5 }, 1, 0, -0.2);
  s.poly([[2, 16], [46, 16], [42, 6], [8, 6]], { ...crypt(33), bias: 0.5 }, 1.5, 0, -0.35);
  s.poly([[9, 12], [39, 12], [36, 8], [12, 8]], { ...crypt(34), bias: 0.9 }, 1);
  s.render(f.c, f.e);
  // the effigy: head, shoulders and folded hands, down the lid
  for (const [x, y] of [[13, 10], [14, 10], [13, 9], [14, 9], [12, 10]] as const) onBody(f, x, y, C.ossFrost);
  for (let x = 17; x <= 35; x += 2) onBody(f, x, 10, C.voidDark);
  for (const x of [22, 27]) onBody(f, x, 9, C.ossPale);
  // carved panels along the front, runes lit in frame 1
  for (let x = 6; x <= 42; x += 9) for (let y = 19; y <= 24; y++) onBody(f, x, y, C.voidDeep);
  for (let k = 0; k < 4; k++) {
    const x = 11 + k * 9;
    if (v === 1) {
      f.glow(x, 20, k % 2 ? C.voidLight : C.voidGlow, 200);
      f.glow(x, 22, C.voidGlow, 170);
    } else {
      onBody(f, x, 20, C.ossMid);
    }
  }
  if (v === 1) for (let x = 17; x <= 35; x += 3) f.glow(x, 9, C.voidGlow, 160);
  // frost on the lid's upper edge
  for (let x = 10; x <= 38; x += 4) onBody(f, x, 7, C.ossFrost);
  f.outline({ selective: true });
  return f;
}

/** Choir stall: a high-backed stall with a bone-white finial each side; dark wood (0) or bone-white with a violet candle (1). */
export function choirStall(v: number): Frame {
  const f = new Frame(30, 40);
  const s = new Sculpt();
  const body: PrimStyle = v === 0 ? { ramp: RAMPS.wood, bias: -0.5, dither: 0.08, tex: grain(41) } : { ...bone(42), bias: -0.2 };
  s.poly(rect(3, 4, 27, 28), { ...body, cyl: 0.15 }, 1.5);
  s.poly(rect(2, 26, 28, 34), { ...body, bias: (body.bias ?? 0) + 0.3 }, 1.2);
  s.poly(rect(5, 33, 25, 38), { ...body, bias: (body.bias ?? 0) - 0.5 }, 1);
  s.poly([[3, 4], [27, 4], [24, 0], [15, -1], [6, 0]], { ...body, bias: (body.bias ?? 0) + 0.6 }, 1);
  s.render(f.c, f.e);
  // carved arcade of three panels on the back
  for (const x of [8, 15, 22]) {
    for (let y = 7; y <= 22; y++) onBody(f, x, y, y % 5 === 0 ? C.voidMid : C.voidDark);
    for (let y = 7; y <= 8; y++) onBody(f, x + 1, y, v === 0 ? C.woodLight : C.ossFrost);
  }
  // bone finials
  for (const x of [3, 26]) {
    for (let y = 2; y <= 3; y++) px(f, x, y, C.ossFrost);
    px(f, x, 1, C.bone);
  }
  if (v === 1) {
    // a violet candle on the ledge
    for (let y = 22; y <= 25; y++) px(f, 15, y, C.parchment);
    f.glow(15, 21, C.voidGlow, 255);
    f.glow(15, 20, C.voidHi, 200);
  } else {
    for (let x = 5; x <= 25; x += 4) onBody(f, x, 30, C.ossPale);
  }
  f.outline({ selective: true });
  return f;
}
