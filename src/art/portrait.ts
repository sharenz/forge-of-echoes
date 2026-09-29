// The Sorceress portrait: a 64x64 bust for the character select and sheet. Framed in a dark vignette, her face
// is lit from below-right by the ember at the tip of her wand.
import type { PixelImage } from '../contracts/art';
import { Frame } from './frame';
import { C, type Color, type Ramp } from './palette';
import { ca, lineCells, mix } from './raster';
import { Sculpt, hash2, type PrimStyle } from './shade';

export const PORTRAIT_SIZE = 64;

const HOOD: Ramp = [C.wineDeep, C.wineDark, C.burgundy, C.wineMid, C.wineLight];
const SKIN: Ramp = [C.skinDeep, C.skinShadow, C.skin, C.skinLight];
const HAIR: Ramp = [C.hairShadow, C.hairMid, C.bone, C.parchment];

export function drawPortrait(): PixelImage {
  const N = PORTRAIT_SIZE;
  const bg = new Frame(N, N);
  // background: charcoal vignette warming towards the wand's ember in the lower right
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const d = Math.hypot((x - 32) / 34, (y - 26) / 36);
      const warm = Math.max(0, 1 - Math.hypot(x - 56, y - 46) / 22);
      let c: Color = d > 0.95 ? C.ink : d > 0.7 ? C.coal : C.char;
      if (warm > 0.5) c = C.wineDark;
      else if (warm > 0.25 && (x + y) % 2 === 0) c = C.wineDark;
      if (hash2(x, y, 5) > 0.985) c = C.iron;
      bg.c.set(x, y, c);
    }
  }

  // the figure is drawn on its own layer so lighting only touches her
  const f = new Frame(N, N);
  const px = (x: number, y: number, c: Color): void => f.c.set(Math.round(x), Math.round(y), c);
  const hood: PrimStyle = { ramp: HOOD, bias: -0.1, dither: 0.08 };
  const hair: PrimStyle = { ramp: HAIR, bias: 0, dither: 0.06 };

  const body = new Sculpt();
  // capelet over the shoulders
  body.ell(31, 63, 28, 15, { ...hood, bias: -0.25 });
  // hood; its long tip droops back over her left shoulder
  body.poly([[18, 16], [24, 8], [14, 14], [9, 24]], { ...hood, bias: 0.3 }, 3);
  body.ell(31, 27, 16, 19, hood);
  body.render(f.c, f.e);
  // deep opening of the hood
  const inner = new Sculpt();
  inner.ell(32, 32, 10.5, 14, { ramp: [C.ink, C.wineDeep, C.wineDark], bias: -0.6, dither: 0.1 });
  inner.render(f.c, f.e);
  // hair behind the face
  const back = new Sculpt();
  back.cap(23.5, 24, 21, 50, 3, 2.4, hair);
  back.cap(40.5, 24, 43, 48, 2.6, 2.1, { ...hair, bias: -0.6 });
  back.render(f.c, f.e);
  // neck in shadow, then the face
  const face = new Sculpt();
  face.cap(32, 37, 32, 45, 3.6, 4.2, { ramp: SKIN, bias: -1.1, dither: 0.06 });
  face.ell(32, 30.5, 7.2, 8.6, { ramp: SKIN, bias: 0.55, dither: 0.08 });
  face.render(f.c, f.e);
  // front strands of hair framing the face
  const front = new Sculpt();
  front.cap(25.5, 22, 23.5, 44, 1.8, 1.4, { ...hair, bias: 0.5 });
  front.cap(39, 22, 40.5, 42, 1.7, 1.3, { ...hair, bias: -0.2 });
  front.cap(28, 21, 25.5, 29, 1.6, 1.2, { ...hair, bias: 0.7 });
  front.render(f.c, f.e);

  // strands: streak the hair so it reads as fine locks, not a flat curtain
  const hairCols = new Set<number>([C.bone, C.parchment, C.hairMid]);
  for (let y = 18; y < 52; y++) {
    for (let x = 16; x < 48; x++) {
      const c = f.c.get(x, y);
      if (!hairCols.has(c)) continue;
      const streak = (x * 3 + Math.floor(y / 7)) % 3 === 0 && hash2(x, y >> 2, 11) > 0.25;
      if (streak) px(x, y, c === C.parchment ? C.bone : c === C.bone ? C.hairMid : C.hairShadow);
    }
  }
  // hood shadow across the brow
  for (let x = 25; x <= 39; x++) {
    const y = Math.round(22 + Math.abs(x - 32) * 0.25);
    if (!f.c.opaque(x, y)) continue;
    px(x, y, C.wineDeep);
    px(x, y + 1, mix(f.c.get(x, y + 1), C.skinDeep, 0.55));
  }
  // brows
  for (const [x, y] of [[27, 26], [28, 25], [29, 25], [30, 26], [34, 26], [35, 25], [36, 25], [37, 26]]) px(x, y, C.hairShadow);
  // eyes: dark lids, irises catching the ember light
  const eye = (x: number): void => {
    px(x, 27, C.coal);
    px(x + 1, 27, C.coal);
    px(x + 2, 27, C.coal);
    px(x, 28, C.skinLight);
    px(x + 1, 28, C.ember);
    px(x + 2, 28, C.coal);
    px(x + 1, 29, C.skinShadow);
  };
  eye(27);
  eye(34);
  px(35, 28, C.hot);
  // nose
  lineCells(33, 28, 33, 32, (x, y) => px(x, y, C.skinShadow));
  px(32, 33, C.skinDeep);
  px(34, 33, C.skinShadow);
  px(32, 32, C.skinLight);
  // closed lips: a soft line with a hint of colour beneath
  for (let x = 31; x <= 34; x++) px(x, 36, x === 31 || x === 34 ? C.skinShadow : C.skinDeep);
  px(32, 37, C.wineLight);
  px(33, 37, C.skinShadow);
  // a faint flush on the cheeks
  px(28, 32, C.wineLight);
  px(36, 32, C.skinShadow);
  // cheek and jaw shading
  for (let y = 30; y <= 36; y++) px(25.5 + (y > 34 ? 1 : 0), y, C.skinShadow);
  for (let x = 30; x <= 35; x++) px(x, 40, C.skinDeep);
  // capelet clasp and folds
  for (const [x, y] of [[31, 50], [32, 50], [31, 51], [32, 51]]) px(x, y, C.gold);
  px(31, 50, C.goldHi);
  px(32, 51, C.goldDark);
  for (const [x0, y0, x1, y1] of [[19, 55, 15, 63], [44, 55, 48, 63], [25, 53, 23, 63]]) {
    lineCells(x0, y0, x1, y1, (x, y) => {
      if (f.c.opaque(x, y)) px(x, y, C.wineDark);
    });
  }

  // the wand rising in the lower right with its ember tip
  lineCells(47, 63, 55, 47, (x, y) => px(x, y, C.woodDark));
  lineCells(48, 63, 56, 47, (x, y) => px(x, y, C.woodLight));
  lineCells(54, 49, 56, 47, (x, y) => px(x, y, C.goldDark));

  // warm under-light from the ember on the figure's surfaces that face it
  const tx = 57;
  const ty = 45;
  const snapshot = f.c.clone();
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const c = snapshot.get(x, y);
      if (ca(c) === 0) continue;
      const k = Math.max(0, 1 - Math.hypot(x - tx, y - ty) / 30) * 0.5;
      if (k <= 0.03) continue;
      // surfaces turned to the light: edges whose right or lower neighbour is a different form
      const edge = snapshot.get(x + 1, y) === 0 || snapshot.get(x + 1, y - 1) === 0;
      f.c.set(x, y, (mix(c, C.flame, edge ? Math.min(0.6, k * 1.6) : k * 0.45) & 0xffffff00) | 255);
    }
  }
  // ember tip on top of the light pass
  for (let y = ty - 3; y <= ty + 3; y++) {
    for (let x = tx - 3; x <= tx + 3; x++) {
      const d = Math.hypot(x - tx, y - ty);
      if (d > 3.2) continue;
      px(x, y, d < 1 ? C.white : d < 1.8 ? C.hot : d < 2.6 ? C.flame : C.ember);
    }
  }
  for (const [x, y] of [[57, 40], [56, 39], [60, 42], [54, 41]]) px(x, y, C.flame);

  f.outline({ selective: true });
  bg.c.blit(f.c, 0, 0);
  // thin frame
  for (let i = 0; i < N; i++) {
    bg.c.set(i, 0, C.ink);
    bg.c.set(i, N - 1, C.ink);
    bg.c.set(0, i, C.ink);
    bg.c.set(N - 1, i, C.ink);
  }
  return bg.c.toImage();
}
