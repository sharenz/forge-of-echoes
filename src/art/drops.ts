// Ground drops, bottom-centre anchored and untinted (rarity is a runtime treatment: beams, labels, outlines).
// Each loops a small glint so items on the ground catch the eye.
import type { SpriteDef } from '../contracts/art';
import { Frame, toSprite } from './frame';
import { C, RAMPS, type Color } from './palette';
import { lineCells } from './raster';
import { Sculpt, type PrimStyle } from './shade';

const GLINT_FRAMES = 6;

/** A four-point glint travelling along a path; frames without a glint keep the item calm. */
function glint(f: Frame, k: number, path: [number, number][]): void {
  if (k >= path.length) return;
  const [x, y] = path[k];
  if (!f.c.opaque(x, y)) return;
  f.glow(x, y, C.white, 255);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (f.c.opaque(x + dx, y + dy)) f.glow(x + dx, y + dy, C.parchment, 170);
}

function finish(f: Frame): Frame {
  f.outline({ selective: true });
  return f;
}

/** Equipment: a dark cloth bundle bound with twine, a sword hilt jutting out of it. */
function equipment(k: number): Frame {
  const f = new Frame(18, 14);
  const s = new Sculpt();
  const cloth: PrimStyle = { ramp: [C.coal, C.char, C.iron, C.stone, C.stoneLight], bias: 0.1, dither: 0.06 };
  // hilt: grip, cross-guard, pommel (drawn behind the bundle's top edge)
  s.cap(10, 6, 14.5, 1.8, 0.8, 0.8, { ramp: RAMPS.wood, bias: 0.3 });
  s.cap(8.2, 5.5, 12.6, 8.6, 0.9, 0.9, { ramp: RAMPS.gold, bias: 0.2 });
  s.ell(15, 1.6, 1.3, 1.3, { ramp: RAMPS.gold, bias: 0.4 });
  s.ell(8, 9.5, 6.4, 3.4, cloth, -0.2);
  s.render(f.c, f.e);
  // twine and a knotted corner
  lineCells(5, 7, 7, 12, (x, y) => f.c.opaque(x, y) && f.c.set(x, y, C.strawDark));
  lineCells(9, 7, 11, 12, (x, y) => f.c.opaque(x, y) && f.c.set(x, y, C.strawDark));
  f.c.set(2, 9, C.stoneLight);
  f.c.set(1, 10, C.stone);
  glint(f, k, [[15, 1], [12, 7], [9, 6]]);
  return finish(f);
}

/** Currency: a leaning amber crystal shard with a smaller one fallen beside it. */
function currency(k: number): Frame {
  const f = new Frame(14, 12);
  const facet = (pts: [number, number][], ramp: Color[]): void => {
    const s = new Sculpt();
    s.poly(pts, { ramp, bias: 0.3, dither: 0, round: 0.2 }, 0.5);
    s.render(f.c, f.e);
  };
  const lit = [C.ochre, C.gold, C.goldHi];
  const shade = [C.goldDark, C.ochre, C.gold];
  // big shard leaning right: a lit left face and a shaded right face meeting at the ridge
  facet([[3, 11], [6.5, 11], [10, 2]], lit);
  facet([[6.5, 11], [9.5, 11], [10, 2]], shade);
  // small shard lying on its side
  facet([[9, 11.5], [13, 11.5], [12.5, 8.5]], shade);
  lineCells(6, 10, 9, 4, (x, y) => f.c.opaque(x, y) && f.c.set(x, y, C.goldHi));
  glint(f, k, [[9, 4], [7, 8], [12, 9]]);
  return finish(f);
}

/** Map: a rolled parchment with a wax seal. */
function map(k: number): Frame {
  const f = new Frame(16, 10);
  const s = new Sculpt();
  s.cap(2.5, 6.5, 13.5, 3.5, 2.4, 2.4, { ramp: RAMPS.parchment, bias: 0.1, dither: 0.08 });
  s.render(f.c, f.e);
  // rolled ends and the seal
  for (const [x, y] of [[2, 6], [3, 7], [13, 3], [14, 4]]) f.c.set(x, y, C.ochre);
  f.c.set(2, 5, C.goldDark);
  f.c.set(13, 2, C.goldDark);
  for (const [x, y, c] of [[7, 5, C.burgundy], [8, 5, C.wineMid], [7, 6, C.wineDark], [8, 6, C.burgundy], [8, 4, C.wineLight]] as [number, number, Color][]) f.c.set(x, y, c);
  lineCells(4, 5, 11, 3, (x, y) => f.c.opaque(x, y) && (x < 7 || x > 8) && f.c.set(x, y, C.bone));
  glint(f, k, [[11, 2], [10, 3], [5, 5]]);
  return finish(f);
}

/** Flask: a small corked vial of amber liquid. */
function flask(k: number): Frame {
  const f = new Frame(10, 14);
  const s = new Sculpt();
  const glass: PrimStyle = { ramp: [C.ink, C.coal, C.iron, C.stoneLight, C.bone], bias: 0.2, round: 0.7 };
  s.ell(5, 9.5, 3.6, 3.4, glass);
  s.poly([[3.8, 7], [6.2, 7], [6.2, 3], [3.8, 3]], { ...glass, cyl: 1 }, 0.8);
  s.render(f.c, f.e);
  // liquid inside the bulb
  for (let y = 9; y <= 12; y++) for (let x = 2; x <= 8; x++) if (f.c.opaque(x, y) && Math.hypot(x + 0.5 - 5, y + 0.5 - 9.5) < 2.9) f.c.set(x, y, y === 9 ? C.goldHi : x < 5 ? C.gold : C.ochre);
  // cork
  f.c.set(4, 2, C.woodLight);
  f.c.set(5, 2, C.wood);
  f.c.set(4, 1, C.wood);
  f.c.set(5, 1, C.woodDark);
  f.c.set(3, 8, C.white);
  glint(f, k, [[3, 9], [4, 5], [6, 11]]);
  return finish(f);
}

export function dropSprites(): SpriteDef[] {
  const frames = (fn: (k: number) => Frame): Frame[] => [...Array(GLINT_FRAMES).keys()].map(fn);
  const spec = (f: Frame) => ({ anchorX: Math.floor(f.w / 2), anchorY: f.h - 1, fps: 8, loop: true });
  const defs: [string, Frame[]][] = [
    ['equipment', frames(equipment)],
    ['currency', frames(currency)],
    ['map', frames(map)],
    ['flask', frames(flask)],
  ];
  return defs.map(([id, fr]) => toSprite(`drop/${id}`, fr, spec(fr[0])));
}
