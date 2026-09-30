// Currency, flask and map icons. Every crafting material must be recognisable at a glance and distinct from its
// siblings: the five essences share one crystal-in-a-cage shape and differ only by colour, everything else has its
// own silhouette.
import type { PixelImage } from '../../contracts/art';
import { SCARABS } from '../../data/scarabs';
import type { Frame } from '../frame';
import { C, RAMPS, type Color, type Ramp } from '../palette';
import { Sculpt, hash2, type PrimStyle } from '../shade';
import { finishIcon, flaskShape, gem, line, newIcon, onBody, px, sparkle } from './kit';

const hashXY = (x: number, y: number): number => hash2(x, y, 911);

const style = (ramp: Ramp, bias = 0.2, extra: Partial<PrimStyle> = {}): PrimStyle => ({ ramp, bias, dither: 0.06, ...extra });
const EMBER: Ramp = [C.lavaDeep, C.lavaDark, C.ember, C.flame, C.hot, C.white];

/** A tall faceted crystal shard, pointing up-right. */
function crystalShard(f: Frame, x0: number, y0: number, len: number, w: number, ramp: Ramp, tilt = 0.6): void {
  const s = new Sculpt();
  const dx = Math.sin(tilt);
  const dy = -Math.cos(tilt);
  const nx = -dy;
  const ny = dx;
  const tip: [number, number] = [x0 + dx * len, y0 + dy * len];
  const mid: [number, number] = [x0 + dx * len * 0.7, y0 + dy * len * 0.7];
  s.poly(
    [
      [x0 - nx * w, y0 - ny * w],
      [x0 + nx * w, y0 + ny * w],
      [mid[0] + nx * w, mid[1] + ny * w],
      tip,
      [mid[0] - nx * w, mid[1] - ny * w],
    ],
    style(ramp, 0.4, { round: 0.6 }),
    1,
    -0.2,
    -0.2,
  );
  s.render(f.c, f.e);
  // central facet line
  line(f, x0, y0, tip[0] - dx, tip[1] - dy, ramp[ramp.length - 2]);
  px(f, tip[0], tip[1], C.white);
}

function kindling(): Frame {
  const f = newIcon();
  // a bundle of three glowing ember shards bound with twine
  crystalShard(f, 10, 27, 17, 2.4, EMBER, 0.25);
  crystalShard(f, 15, 27, 20, 2.8, EMBER, 0.55);
  crystalShard(f, 18, 27, 14, 2.2, EMBER, 0.9);
  line(f, 8, 22, 21, 24, C.woodDark);
  line(f, 8, 23, 21, 25, C.wood);
  sparkle(f, 26, 5, C.hot, 1);
  return f;
}

function scrap(): Frame {
  const f = newIcon();
  const s = new Sculpt();
  const iron = style(RAMPS.metal, 0.4);
  // bent plates and a bolt, stacked
  s.poly([[4, 20], [16, 16], [18, 22], [6, 27]], iron, 1.2, -0.3, -0.4);
  s.poly([[12, 12], [24, 8], [27, 14], [15, 19]], style(RAMPS.metal, 0.1), 1.2, 0.2, -0.3);
  s.poly([[17, 22], [27, 19], [28, 25], [19, 28]], style(RAMPS.rust, 0.2), 1.2);
  s.render(f.c, f.e);
  for (const [x, y] of [[8, 21], [14, 19], [16, 12], [23, 11], [21, 23]]) {
    px(f, x, y, C.metalHi);
    px(f, x + 1, y + 1, C.metalDark);
  }
  // bent nail
  line(f, 5, 10, 10, 13, C.metalLight);
  line(f, 10, 13, 11, 16, C.metalMid);
  px(f, 4, 9, C.metalHi);
  return f;
}

function reforge(): Frame {
  const f = newIcon();
  // iron tongs gripping a molten ember
  line(f, 3, 29, 13, 17, C.metalLight);
  line(f, 4, 29, 14, 17, C.metal);
  line(f, 6, 30, 16, 19, C.metalMid);
  line(f, 7, 30, 17, 19, C.metalDark);
  const s = new Sculpt();
  s.ell(19.5, 13, 6, 5.5, style(EMBER, 0.9, { round: 0.9 }));
  s.render(f.c, f.e);
  // crust and cracks on the ember
  for (const [x, y] of [[16, 10], [17, 16], [22, 17], [24, 12], [21, 9]]) px(f, x, y, C.lavaDark);
  line(f, 17, 12, 21, 14, C.hot);
  // flames licking up
  for (const [x, h] of [[17, 5], [20, 7], [23, 4]] as const) {
    for (let i = 0; i < h; i++) px(f, x + Math.round(Math.sin(i) * 0.6), 8 - i, i > h - 2 ? C.ember : C.flame);
  }
  return f;
}

/** Stamp a '#'-mask glyph centred on (cx, cy) with a one-pixel drop shadow so it reads on any crystal colour. */
function glyph(f: Frame, rows: readonly string[], cx: number, cy: number, ink: Color, shadow: Color): void {
  const x0 = Math.round(cx - rows[0].length / 2);
  const y0 = Math.round(cy - rows.length / 2);
  rows.forEach((row, y) => [...row].forEach((ch, x) => ch === '#' && onBody(f, x0 + x + 1, y0 + y + 1, shadow)));
  rows.forEach((row, y) => [...row].forEach((ch, x) => ch === '#' && px(f, x0 + x, y0 + y, ink)));
}

// Element glyphs for the essences (7x7).
const GLYPH = {
  flame: ['...#...', '...##..', '..####.', '.#####.', '.##.##.', '.##.##.', '..###..'],
  snow: ['...#...', '.#.#.#.', '..###..', '#######', '..###..', '.#.#.#.', '...#...'],
  bolt: ['...###.', '..###..', '.#####.', '...##..', '..##...', '.##....', '.#.....'],
  heart: ['.......', '.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'],
  wing: ['.....##', '...####', '..####.', '.####..', '.###...', '##.....', '#......'],
} as const;

/**
 * Essence: a teardrop crystal of condensed element in an iron cage. The five share the silhouette (they are one
 * family) and differ by a saturated mid-tone body and a bold element glyph in the bulb.
 */
function essence(ramp: Ramp, mark: readonly string[], ink: Color, shadow: Color, spark: Color): Frame {
  const f = newIcon();
  const s = new Sculpt();
  s.poly([[16, 2], [24, 14], [23, 22], [16, 27], [9, 22], [8, 14]], style(ramp, -0.15, { round: 0.8 }), 3);
  s.render(f.c, f.e);
  // lit facet down the upper-left of the crystal
  line(f, 11, 12, 15, 5, ramp[ramp.length - 2]);
  px(f, 14, 6, C.white);
  glyph(f, mark, 16.5, 19, ink, shadow);
  // iron cage band high on the crystal, a cap at the tip and a footed base
  line(f, 9, 11, 23, 11, C.metalLight);
  line(f, 9, 12, 23, 12, C.metal);
  line(f, 16, 2, 16, 4, C.metalHi);
  const b = new Sculpt();
  b.ell(16, 27.5, 5.5, 2, style(RAMPS.metal, 0.3, { round: 0.4 }));
  b.render(f.c, f.e);
  for (const x of [10, 22]) line(f, x, 21, x + (x < 16 ? 1 : -1), 26, C.metalMid);
  sparkle(f, 25, 5, spark, 1);
  return f;
}

function catalyst(): Frame {
  const f = newIcon();
  flaskShape(f, 15, 20, 7.5, [C.goldDark, C.ochre, C.gold, C.goldHi, C.white], 0.7);
  // rising bubbles
  for (const [x, y] of [[13, 18], [17, 16], [15, 13], [22, 8], [24, 5]]) px(f, x, y, C.goldHi);
  px(f, 23, 6, C.white);
  sparkle(f, 25, 4, C.goldHi, 1);
  return f;
}

function solvent(): Frame {
  const f = newIcon();
  const s = new Sculpt();
  const glass: PrimStyle = { ramp: [C.ink, C.coal, C.char, C.iron, C.stoneLight, C.bone], bias: 0.1, round: 0.8 };
  // a tall thin vial, tilted
  s.cap(10, 27, 21, 8, 3.4, 3.2, glass);
  s.render(f.c, f.e);
  // acid filling the lower part
  for (let y = 12; y < 30; y++) {
    for (let x = 5; x < 26; x++) {
      if (!f.c.opaque(x, y)) continue;
      const t = (27 - y) / 19;
      const cxLine = 10 + 11 * t;
      if (Math.abs(x + 0.5 - cxLine) > 2 || y < 15) continue;
      px(f, x, y, x < cxLine - 0.5 ? C.acid : x < cxLine + 0.8 ? C.olive : C.acidDark);
    }
  }
  line(f, 8, 24, 16, 11, C.bone);
  // stopper and a corroded drip
  line(f, 20, 7, 23, 9, C.woodLight);
  line(f, 21, 6, 24, 8, C.wood);
  px(f, 7, 29, C.acid);
  px(f, 6, 30, C.acidDark);
  for (const [x, y] of [[13, 19], [16, 15]]) px(f, x, y, C.hot);
  return f;
}

function seal(): Frame {
  const f = newIcon();
  const s = new Sculpt();
  // a blob of burgundy wax with an irregular rim, stamped with the spiral
  s.poly([[16, 4], [22, 6], [27, 11], [27, 18], [24, 25], [17, 28], [10, 26], [5, 20], [5, 12], [9, 6]], style(RAMPS.wine, 0.8, { round: 0.7 }), 3);
  s.render(f.c, f.e);
  const cx = 16;
  const cy = 16;
  for (let a = 0; a < 360; a += 6) {
    const t = (a * Math.PI) / 180;
    onBody(f, cx + Math.cos(t) * 7, cy + Math.sin(t) * 7, C.wineDark);
  }
  for (let i = 0; i < 20; i++) {
    const t = i * 0.58;
    const r = 0.6 + i * 0.28;
    onBody(f, cx + Math.cos(t) * r, cy + Math.sin(t) * r, i % 2 ? C.wineDeep : C.wineDark);
  }
  px(f, 12, 9, C.wineHi);
  px(f, 11, 10, C.wineHi);
  // ribbon tails
  line(f, 22, 26, 25, 31, C.gold);
  line(f, 23, 26, 27, 30, C.ochre);
  return f;
}

function fractureCore(): Frame {
  const f = newIcon();
  const s = new Sculpt();
  const core: Ramp = [C.voidDeep, C.voidDark, C.voidMid, C.storm, C.lightning, C.white];
  // an octahedral crystal core
  s.poly([[16, 3], [26, 15], [16, 29], [6, 15]], style(core, 0.6, { round: 0.5 }), 2);
  s.render(f.c, f.e);
  line(f, 6, 15, 26, 15, C.voidMid);
  line(f, 16, 3, 16, 29, C.storm);
  // the fracture: a jagged bright crack
  const crack: [number, number][] = [[11, 7], [14, 12], [12, 16], [17, 19], [15, 24], [19, 27]];
  for (let i = 0; i + 1 < crack.length; i++) line(f, crack[i][0], crack[i][1], crack[i + 1][0], crack[i + 1][1], C.white);
  for (let i = 0; i + 1 < crack.length; i++) line(f, crack[i][0] + 1, crack[i][1], crack[i + 1][0] + 1, crack[i + 1][1], C.voidDeep);
  // a chip breaking away
  px(f, 25, 9, C.lightning);
  px(f, 26, 8, C.storm);
  px(f, 27, 7, C.lightning);
  return f;
}

function mapDust(): Frame {
  const f = newIcon();
  const s = new Sculpt();
  // a small leather pouch spilling silver dust
  s.ell(13, 18, 8, 8.5, style(RAMPS.wood, 0.4));
  s.poly([[8, 11], [18, 11], [20, 7], [6, 7]], style(RAMPS.wood, 0.1), 1.2);
  s.render(f.c, f.e);
  line(f, 7, 11, 19, 11, C.woodDeep);
  line(f, 12, 12, 10, 16, C.gold);
  // spilled dust
  const dust: [number, number][] = [[20, 20], [22, 22], [24, 21], [23, 24], [26, 23], [21, 26], [25, 26], [27, 25], [19, 24], [28, 27]];
  dust.forEach(([x, y], i) => px(f, x, y, i % 3 === 0 ? C.white : i % 2 ? C.rarityMap : C.ossPale));
  sparkle(f, 24, 16, C.white, 1);
  return f;
}

function threatGlyph(): Frame {
  const f = newIcon();
  const s = new Sculpt();
  // a dark stone tablet with a carved, bleeding threat mark (three claw rakes)
  s.poly([[7, 5], [25, 4], [27, 27], [5, 28]], style(RAMPS.stone, 0.1, { tex: (x, y) => ((x * 7 + y * 3) % 11 === 0 ? -1 : 0) }), 2.5);
  s.render(f.c, f.e);
  for (let k = 0; k < 3; k++) {
    line(f, 10 + k * 4, 8, 13 + k * 4, 23, C.blood);
    line(f, 11 + k * 4, 8, 14 + k * 4, 23, C.life);
    px(f, 13 + k * 4, 24, C.blood);
  }
  px(f, 12, 8, C.lifeLight);
  return f;
}

function rewardInk(): Frame {
  const f = newIcon();
  const s = new Sculpt();
  const glass: Ramp = [C.ink, C.coal, C.char, C.iron, C.stone, C.stoneLight];
  // squat, wide inkwell of smoked glass
  s.poly([[6, 19], [26, 19], [27, 27], [24, 29], [8, 29], [5, 27]], style(glass, 0.3, { cyl: 0.7 }), 2);
  s.ell(16, 18.5, 9.5, 3.4, style(RAMPS.gold, 0.1, { round: 0.3 }));
  s.render(f.c, f.e);
  // the mouth: a gold rim around a pool of glowing golden ink
  for (let y = 16; y <= 21; y++) {
    for (let x = 7; x <= 25; x++) {
      const d = Math.hypot((x + 0.5 - 16) / 7.4, (y + 0.5 - 18.5) / 2.3);
      if (d > 1) continue;
      px(f, x, y, d > 0.75 ? C.goldDark : x < 13 && y < 18 ? C.goldHi : d < 0.45 ? C.gold : C.ochre);
    }
  }
  px(f, 12, 17, C.white);
  // a drip of gold down the glass
  line(f, 22, 21, 22, 24, C.gold);
  px(f, 22, 25, C.ochre);
  // the quill stands up out of the ink, vanes on both sides of its shaft
  line(f, 15, 18, 25, 2, C.bone);
  for (let i = 3; i <= 13; i++) {
    const x = Math.round(15 + (10 * i) / 16);
    const y = Math.round(18 - i);
    const w = i < 5 ? 1 : i > 11 ? 1 : 2;
    for (let k = 1; k <= w; k++) {
      px(f, x - k, y - 1 + k, i % 3 === 0 ? C.ashGrey : C.parchment);
      px(f, x + k, y + k, i % 3 === 1 ? C.stoneLight : C.ashGrey);
    }
  }
  px(f, 25, 2, C.white);
  line(f, 15, 18, 16, 17, C.goldHi);
  // glass highlights
  line(f, 7, 22, 7, 26, C.stoneLight);
  px(f, 8, 21, C.ashGrey);
  sparkle(f, 5, 12, C.goldHi, 1);
  return f;
}

function voidNeedle(): Frame {
  const f = newIcon();
  // a long black needle, glowing violet along its eye and tip
  line(f, 5, 28, 26, 5, C.basaltHi);
  line(f, 6, 28, 27, 5, C.basalt);
  line(f, 6, 29, 27, 6, C.voidDeep);
  // eye of the needle
  px(f, 24, 7, C.voidGlow);
  px(f, 25, 6, C.voidHi);
  // void aura
  for (const [x, y] of [[4, 26], [3, 29], [8, 27], [10, 22], [16, 19], [20, 12], [27, 8]]) px(f, x, y, C.voidLight);
  sparkle(f, 5, 28, C.voidHi, 1);
  px(f, 28, 3, C.voidGlow);
  return f;
}

function flask(liquid: Ramp): Frame {
  const f = newIcon();
  flaskShape(f, 15.5, 19, 8, liquid, 0.62);
  return f;
}

interface MapTheme {
  paper: Ramp; // dark → light
  roll: Ramp;
  /** Colour for paper pixels near the long edges (burnt, frosted, stained...), or null to keep the paper. */
  edge: (x: number, y: number, d: number) => Color | null;
  cap: Ramp | null; // end caps on the rollers
  seal: Ramp;
  ribbon: [Color, Color];
  emblem: (f: Frame) => void;
  deco?: (f: Frame) => void;
}

/**
 * Map item: an unrolled scroll on the icon diagonal. Each map base has its own paper, edge treatment, roller caps,
 * a bold central emblem and a big wax seal with ribbon tails, so bases are told apart at a glance in the stash.
 */
function mapIcon(t: MapTheme): Frame {
  const f = newIcon();
  const s = new Sculpt();
  const band: [number, number][] = [[3, 21], [20, 4], [28, 12], [11, 29]];
  s.poly(band, style(t.paper, 0.35), 1, -0.2, -0.3);
  s.cap(2, 20, 11, 29, 2.5, 2.5, style(t.roll, 0.1));
  s.cap(19, 3, 28, 12, 2.5, 2.5, style(t.roll, 0.35));
  s.render(f.c, f.e);
  // edge treatment on the paper: distance to the two long edges of the band
  const nx = Math.SQRT1_2;
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      if (!f.c.opaque(x, y)) continue;
      const u = (x + 0.5 + y + 0.5) * nx; // along the diagonal normal
      const d = Math.min(Math.abs(u - (3 + 21) * nx), Math.abs(u - (28 + 12) * nx));
      const along = (x - y) * nx;
      if (Math.abs(along) > 11) continue; // leave the rollers alone
      const c = t.edge(x, y, d);
      if (c !== null) px(f, x, y, c);
    }
  }
  if (t.cap) {
    for (const [x, y] of [[2, 20], [3, 19], [28, 12], [27, 13]] as const) px(f, x, y, t.cap[2]);
    px(f, 1, 21, t.cap[1]);
    px(f, 29, 11, t.cap[1]);
    px(f, 11, 29, t.cap[1]);
    px(f, 19, 3, t.cap[3]);
  }
  t.deco?.(f);
  t.emblem(f);
  // a short notched ribbon pressed under a big wax seal
  for (let i = 0; i < 6; i++) {
    px(f, 18 + i, 24 + (i >> 1), t.ribbon[i % 2]);
    px(f, 18 + i, 25 + (i >> 1), t.ribbon[1]);
  }
  px(f, 18, 26, t.ribbon[0]);
  gem(f, 22, 21.5, 4, 3.6, t.seal);
  // the stamped mark in the wax
  px(f, 22, 21, t.seal[1]);
  px(f, 23, 22, t.seal[1]);
  px(f, 21, 22, t.seal[1]);
  px(f, 22, 23, t.seal[2]);
  return f;
}

const MAP_FORGE: MapTheme = {
  paper: [C.iron, C.stone, C.stoneLight, C.ashGrey],
  roll: [C.coal, C.char, C.iron, C.stone],
  edge: (x, y, d) => (d < 1.2 ? (hashXY(x, y) > 0.55 ? C.coal : C.char) : d < 2.2 && hashXY(x, y) > 0.5 ? C.woodDark : d < 2.2 && hashXY(x, y) > 0.35 ? C.ember : null),
  cap: null,
  seal: [C.lavaDeep, C.blood, C.lavaDark, C.ember, C.flame],
  ribbon: [C.wineMid, C.burgundy],
  emblem: (f) => {
    // a brazier: iron bowl on a stem, a tall flame
    for (let x = 11; x <= 19; x++) px(f, x, 19, x < 14 ? C.metalLight : C.metalMid);
    for (let x = 12; x <= 18; x++) px(f, x, 20, C.metal);
    px(f, 15, 21, C.metalMid);
    px(f, 15, 22, C.metal);
    for (let x = 13; x <= 17; x++) px(f, x, 23, C.metalDark);
    const flame = ['..#..', '..##.', '.###.', '.####', '#####', '##+##', '.###.'];
    flame.forEach((row, y) => [...row].forEach((ch, x) => ch !== '.' && px(f, 13 + x, 12 + y, ch === '+' ? C.hot : y < 2 ? C.ember : y > 4 ? C.flame : C.flame)));
    px(f, 15, 16, C.hot);
    px(f, 15, 17, C.white);
  },
};

const MAP_OSSUARY: MapTheme = {
  paper: [C.ossLight, C.ossPale, C.ossFrost, C.ice],
  roll: [C.ossDark, C.ossMid, C.ossPale, C.ossFrost],
  edge: (x, y, d) => (d < 1.3 && hashXY(x, y) > 0.4 ? C.white : d < 2.4 && hashXY(x, y) > 0.7 ? C.ice : null),
  cap: [C.frostDeep, C.frostMid, C.ice, C.white],
  seal: [C.frostDeep, C.frostDark, C.mana, C.frost, C.ice],
  ribbon: [C.frostMid, C.frostDark],
  emblem: (f) => {
    // a skull, rimed with frost
    const sk = ['.#####.', '#######', '#.o#o.#', '#######', '.##.##.', '.#.#.#.'];
    sk.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch === '.') return;
        px(f, 12 + x, 12 + y, ch === 'o' ? C.frostDeep : y === 0 || x === 0 ? C.white : y > 3 ? C.ashGrey : C.bone);
      }),
    );
    px(f, 14, 14, C.frostDeep);
    px(f, 16, 14, C.frostDeep);
    for (const [x, y] of [[11, 12], [19, 11], [12, 10]] as const) px(f, x, y, C.ice);
  },
  deco: (f) => {
    // rime crystals on the rollers
    for (const [x, y] of [[4, 22], [8, 26], [21, 5], [25, 9], [6, 25]] as const) px(f, x, y, C.white);
  },
};

const MAP_COLISEUM: MapTheme = {
  paper: [C.sandMid, C.sand, C.bone, C.parchment],
  roll: [C.rustDeep, C.rustDark, C.rust, C.rustLight],
  edge: (x, y, d) => {
    const n = hashXY(x >> 1, y >> 1);
    return d < 1.1 ? C.rustDark : d < 3 && n > 0.62 ? C.rustLight : d < 3 && n > 0.52 ? C.rust : null;
  },
  cap: [C.metalDeep, C.metalMid, C.metalLight, C.metalHi],
  seal: [C.rustDeep, C.blood, C.rust, C.rustLight, C.ochre],
  ribbon: [C.metalMid, C.metal],
  emblem: (f) => {
    // two crossed blades over a round shield boss
    line(f, 10, 11, 20, 21, C.metalHi);
    line(f, 11, 11, 20, 20, C.metalLight);
    line(f, 20, 11, 10, 21, C.metalLight);
    line(f, 19, 11, 10, 20, C.metalMid);
    for (const [x, y] of [[9, 20], [11, 22], [21, 20], [19, 22]] as const) px(f, x, y, C.goldDark);
    px(f, 9, 22, C.wood);
    px(f, 21, 22, C.wood);
    for (let y = 14; y <= 18; y++) for (let x = 13; x <= 17; x++) if (Math.hypot(x - 15, y - 16) < 2.4) px(f, x, y, x + y < 31 ? C.metalHi : C.metalMid);
    px(f, 15, 16, C.rust);
  },
};

const MAP_CHAPEL: MapTheme = { ...MAP_FORGE,
  seal: [C.voidDeep, C.voidDark, C.voidMid, C.voidLight, C.voidHi],
  emblem: f => {
    line(f, 10, 21, 10, 14, C.gold); line(f, 20, 21, 20, 14, C.gold);
    line(f, 10, 14, 15, 9, C.goldHi); line(f, 15, 9, 20, 14, C.goldHi);
    line(f, 11, 21, 19, 21, C.metalLight); gem(f, 15, 16, 2, 3, RAMPS.void);
  },
};
const MAP_CRYPT: MapTheme = { ...MAP_OSSUARY,
  ribbon: [C.voidMid, C.voidLight],
  emblem: f => {
    for (let y = 12; y <= 20; y += 4) line(f, 9, y, 21, y, C.ossDark);
    for (let k = 0; k < 3; k++) { const x = 11 + k * 4; line(f, x, 11, x, 19 - k, C.bone); gem(f, x - 1, 20 - k, 1, 1, RAMPS.bone); }
  },
};
const MAP_WORKS: MapTheme = { ...MAP_COLISEUM,
  paper: [C.metalDark, C.metalMid, C.metalLight, C.metalHi],
  emblem: f => {
    for (let k = 0; k < 3; k++) { const x = 9 + 4 * k, y = 11 + 3 * k;
      line(f, x, y, x + 4, y, C.goldHi); line(f, x, y + 3, x + 4, y + 3, C.rustLight);
      line(f, x, y, x, y + 3, C.gold); line(f, x + 4, y, x + 4, y + 3, C.rust);
    }
  },
};

function reliquaryKey(): Frame {
  const f = newIcon();
  const s = new Sculpt();
  s.ell(10, 10, 6, 6, style(RAMPS.gold, 0.3));
  s.render(f.c, f.e);
  gem(f, 10, 10, 2, 2, RAMPS.frost);
  for (let n = 0; n < 3; n++) line(f, 13 + n, 13, 26 + n, 26, n === 0 ? C.goldHi : C.gold);
  line(f, 21, 23, 18, 26, C.gold);
  line(f, 25, 27, 22, 30, C.goldHi);
  sparkle(f, 8, 5, C.goldHi, 1);
  return f;
}

/** Distinct bows and teeth identify each sealed destination even without its colour. */
function atlasKey(kind: 'gilded' | 'black' | 'hunting' | 'rift'): Frame {
  const f = newIcon(), s = new Sculpt();
  const ramp = kind === 'gilded' ? RAMPS.gold : kind === 'rift' ? RAMPS.frost : RAMPS.metal;
  if (kind === 'gilded') s.poly([[4, 9], [9, 3], [16, 7], [14, 15], [7, 17]], style(ramp, 0.5));
  else if (kind === 'black') s.poly([[3, 6], [15, 5], [16, 17], [4, 16]], style(ramp));
  else if (kind === 'hunting') s.poly([[4, 15], [5, 3], [10, 10], [16, 4], [15, 17]], style(ramp, 0.4));
  else s.ell(9, 10, 6, 8, style(ramp, 0.4));
  s.render(f.c, f.e);
  const glow = kind === 'black' ? C.ember : kind === 'rift' ? C.voidGlow : C.goldHi;
  gem(f, 9, 10, 2, 2, kind === 'black' ? EMBER : RAMPS.frost);
  for (let n = 0; n < 3; n++) line(f, 11 + n, 13, 24 + n, 27, ramp[3 + (n % 2)]);
  for (let n = 0; n < (kind === 'hunting' ? 3 : kind === 'rift' ? 1 : 2); n++) {
    line(f, 19 + n * 3, 21 + n * 3, 16 + n * 3, 24 + n * 3, glow);
  }
  sparkle(f, 8, 5, glow, 1);
  return f;
}

/** Matched stone tablets; the luminous bracket identifies which half is reforged. */
function affixRune(prefix: boolean): Frame {
  const f = newIcon();
  const s = new Sculpt();
  s.poly([[9, 3], [24, 5], [26, 24], [20, 29], [6, 26], [5, 10]], style(RAMPS.basalt, 0.6), 2);
  s.render(f.c, f.e);
  line(f, 9, 6, 22, 8, C.metalLight);
  line(f, 8, 25, 20, 27, C.metal);
  glyph(f, prefix ? ['#####..', '##.....', '##.##..', '##.....', '#####..']
    : ['..#####', '.....##', '..##.##', '.....##', '..#####'], 16, 17,
    prefix ? C.goldHi : C.voidGlow, C.ink);
  gem(f, prefix ? 10 : 22, 9, 1.5, 1.5, prefix ? RAMPS.gold : RAMPS.void);
  return f;
}

/** Clay balm pot, with a broad green wax lid. */
function scarBalm(): Frame {
  const f = newIcon(), s = new Sculpt();
  s.ell(16, 21, 10, 9, style(RAMPS.bone, -0.4));
  s.ell(16, 12, 9, 4, style([C.vitalDeep, C.vitalMid, C.vitalGreen, C.vitalLight, C.bone], 0.2));
  s.render(f.c, f.e);
  glyph(f, ['..#..', '.###.', '#####', '.###.', '..#..'], 16, 22, C.vitalDeep, C.bone);
  return f;
}
function anneal(): Frame {
  const f = newIcon(), s = new Sculpt();
  s.cap(8, 7, 7, 24, 3, 4, style(RAMPS.metal, 0.3));
  s.cap(7, 24, 24, 24, 4, 3, style(RAMPS.metal, 0.1));
  s.cap(24, 24, 24, 7, 3, 3, style(RAMPS.metal, 0.3));
  s.cap(16, 6, 16, 22, 2, 2, style(EMBER, 0.7)); s.render(f.c, f.e);
  sparkle(f, 15, 4, C.hot, 2); return f;
}
function graft(): Frame {
  const f = newIcon(), s = new Sculpt();
  s.cap(7, 25, 16, 16, 4, 3, style(RAMPS.bone, 0.2));
  s.cap(16, 16, 25, 6, 3, 4, style(RAMPS.rust, 0.4)); s.render(f.c, f.e);
  for (let n = -2; n <= 2; n++) line(f, 11 + n * 2, 14 - n * 2, 18 + n * 2, 21 - n * 2, C.vitalLight);
  gem(f, 16, 16, 2, 2, RAMPS.void); return f;
}
function transmute(): Frame {
  const f = newIcon();
  gem(f, 10, 13, 6, 8, RAMPS.metal); gem(f, 22, 20, 6, 8, RAMPS.gold);
  line(f, 16, 5, 25, 8, C.voidGlow); line(f, 25, 8, 24, 12, C.voidGlow);
  line(f, 25, 8, 21, 9, C.voidGlow); line(f, 16, 28, 7, 25, C.voidLight);
  line(f, 7, 25, 8, 21, C.voidLight); return f;
}
function echoShard(): Frame {
  const f = newIcon();
  crystalShard(f, 8, 27, 20, 3.8, RAMPS.frost, 0.3);
  crystalShard(f, 19, 27, 25, 4.2, RAMPS.void, 0.15);
  line(f, 12, 18, 19, 18, C.ice); sparkle(f, 6, 6, C.voidGlow, 1); return f;
}
function crownFragment(): Frame {
  const f = newIcon(), s = new Sculpt();
  s.poly([[5, 25], [4, 8], [12, 15], [17, 3], [22, 14], [28, 7], [25, 23], [17, 27], [13, 23], [11, 28]], style(RAMPS.gold, 0.3), 2);
  s.render(f.c, f.e); gem(f, 17, 18, 3, 4, [C.lifeDark, C.blood, C.life, C.lifeLight, C.hot]);
  line(f, 12, 27, 16, 22, C.ink); sparkle(f, 18, 3, C.goldHi, 1); return f;
}
function compass(): Frame {
  const f = newIcon(), s = new Sculpt();
  s.ell(16, 17, 12, 12, style(RAMPS.gold, 0.2));
  s.ell(16, 17, 9, 9, style(RAMPS.basalt, 0.3)); s.render(f.c, f.e);
  gem(f, 16, 17, 3, 10, RAMPS.frost); line(f, 8, 17, 24, 17, C.metalLight);
  gem(f, 16, 17, 2, 2, RAMPS.gold); return f;
}
function twinInk(): Frame {
  const f = newIcon();
  flaskShape(f, 10, 22, 6, RAMPS.gold, 0.6); flaskShape(f, 23, 16, 6, RAMPS.void, 0.6);
  line(f, 9, 14, 22, 25, C.bone); line(f, 10, 14, 23, 25, C.wood); return f;
}
function voidSplinter(): Frame {
  const f = newIcon(); crystalShard(f, 10, 29, 29, 3.2, RAMPS.void, 0.35);
  line(f, 13, 20, 20, 18, C.ink); line(f, 15, 12, 21, 10, C.ink);
  sparkle(f, 7, 15, C.voidGlow, 2); sparkle(f, 25, 20, C.voidLight, 1); return f;
}

function scarab(haste: boolean, tier: number): Frame {
  const f = newIcon(), s = new Sculpt();
  const shell = haste ? RAMPS.frost : RAMPS.void;
  for (const side of [-1, 1]) for (let leg = 0; leg < 3; leg++) {
    line(f, 16 + side * 6, 12 + leg * 5, 16 + side * 12, 9 + leg * 7, C.gold);
    line(f, 16 + side * 12, 9 + leg * 7, 16 + side * 13, 12 + leg * 7, C.goldHi);
  }
  s.ell(16, 18, 8, 10, style(shell, 0.3));
  s.ell(16, 7, 4, 4, style(RAMPS.gold, 0.25));
  s.render(f.c, f.e);
  line(f, 16, 10, 16, 26, C.ink);
  for (let n = 0; n < tier; n++) gem(f, 16 + (n - (tier - 1) / 2) * 5, 29, 1, 1, RAMPS.gold);
  if (haste) { line(f, 12, 15, 14, 12, C.ice); line(f, 14, 12, 14, 21, C.ice); }
  else { gem(f, 12, 17, 2, 3, RAMPS.gold); gem(f, 20, 17, 2, 3, RAMPS.gold); }
  if (tier === 4) sparkle(f, 21, 10, C.goldHi, 1);
  return f;
}

export const CURRENCY_ICONS: Record<string, () => PixelImage> = {
  ...Object.fromEntries(SCARABS.map(s => [`icon/currency/${s.id}`, () => finishIcon(scarab(s.durationLess > 0, s.tier), s.durationLess > 0 ? C.ice : C.voidGlow)])),
  'icon/currency/scarBalm': () => finishIcon(scarBalm()),
  'icon/currency/anneal': () => finishIcon(anneal(), C.hot),
  'icon/currency/graft': () => finishIcon(graft(), C.vitalLight),
  'icon/currency/transmute': () => finishIcon(transmute(), C.voidGlow),
  'icon/currency/echoShard': () => finishIcon(echoShard(), C.ice),
  'icon/currency/crownFragment': () => finishIcon(crownFragment(), C.goldHi),
  'icon/currency/compass': () => finishIcon(compass(), C.ice),
  'icon/currency/twinInk': () => finishIcon(twinInk(), C.voidGlow),
  'icon/currency/voidSplinter': () => finishIcon(voidSplinter(), C.voidGlow),
  'icon/currency/kindling': () => finishIcon(kindling(), C.hot),
  'icon/currency/scrap': () => finishIcon(scrap()),
  'icon/currency/reforge': () => finishIcon(reforge(), C.hot),
  'icon/currency/essenceEmber': () => finishIcon(essence([C.lavaDeep, C.blood, C.lavaDark, C.ember, C.flame, C.hot], GLYPH.flame, C.hot, C.lavaDeep, C.hot)),
  'icon/currency/essenceRime': () => finishIcon(essence([C.frostDeep, C.frostDark, C.frostMid, C.mana, C.frost, C.ice], GLYPH.snow, C.white, C.frostDeep, C.ice), C.ice),
  'icon/currency/essenceStorm': () => finishIcon(essence([C.voidDeep, C.voidDark, C.voidMid, C.stormMid, C.storm, C.lightning], GLYPH.bolt, C.lightning, C.voidDeep, C.lightning), C.lightning),
  'icon/currency/essenceVital': () => finishIcon(essence([C.mossDeep, C.vitalDeep, C.vitalMid, C.vitalGreen, C.vitalLight, C.white], GLYPH.heart, C.lifeLight, C.lifeDark, C.vitalLight), C.vitalLight),
  'icon/currency/essenceSwift': () => finishIcon(essence([C.frostDeep, C.swiftDeep, C.swiftMid, C.swiftTeal, C.swiftLight, C.white], GLYPH.wing, C.white, C.swiftDeep, C.swiftLight), C.swiftLight),
  'icon/currency/catalyst': () => finishIcon(catalyst(), C.goldHi),
  'icon/currency/solvent': () => finishIcon(solvent()),
  'icon/currency/seal': () => finishIcon(seal()),
  'icon/currency/fractureCore': () => finishIcon(fractureCore(), C.lightning),
  'icon/currency/prefixRune': () => finishIcon(affixRune(true), C.goldHi),
  'icon/currency/suffixRune': () => finishIcon(affixRune(false), C.voidGlow),
  'icon/currency/mapDust': () => finishIcon(mapDust(), C.ice),
  'icon/currency/threatGlyph': () => finishIcon(threatGlyph()),
  'icon/currency/rewardInk': () => finishIcon(rewardInk(), C.goldHi),
  'icon/currency/voidNeedle': () => finishIcon(voidNeedle(), C.voidGlow),
  'icon/currency/reliquaryKey': () => finishIcon(reliquaryKey(), C.goldHi),
  'icon/currency/gildedKey': () => finishIcon(atlasKey('gilded'), C.goldHi),
  'icon/currency/blackKey': () => finishIcon(atlasKey('black'), C.ember),
  'icon/currency/huntingKey': () => finishIcon(atlasKey('hunting'), C.goldHi),
  'icon/currency/riftKey': () => finishIcon(atlasKey('rift'), C.voidGlow),
  'icon/flask/lifeFlask': () => finishIcon(flask([C.wineDeep, C.lifeDark, C.blood, C.life, C.lifeLight, C.hot])),
  'icon/flask/focusFlask': () => finishIcon(flask([C.frostDeep, C.frostDark, C.frostMid, C.mana, C.frost, C.ice]), C.frost),
  'icon/map/ashenForge': () => finishIcon(mapIcon(MAP_FORGE), C.hot),
  'icon/map/rimedOssuary': () => finishIcon(mapIcon(MAP_OSSUARY), C.ice),
  'icon/map/ironColiseum': () => finishIcon(mapIcon(MAP_COLISEUM)),
  'icon/map/cinderChapel': () => finishIcon(mapIcon(MAP_CHAPEL), C.voidHi),
  'icon/map/choralCrypt': () => finishIcon(mapIcon(MAP_CRYPT), C.ice),
  'icon/map/chainworks': () => finishIcon(mapIcon(MAP_WORKS)),
};
