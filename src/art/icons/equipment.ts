// Equipment base and unique icons, drawn at their inventory footprint (32 px per grid cell, see CLASS_SIZE in the
// item data): wands 1x3, sceptres and body armour 2x3, foci, helmets, gloves and boots 2x2, belts 2x1, amulets and
// rings 1x1. `ICON_FOOTPRINT` records the size of every id so the UI and tests can rely on it.
import type { PixelImage } from '../../contracts/art';
import type { Frame } from '../frame';
import { C, RAMPS, type Color, type Ramp } from '../palette';
import { Sculpt, hash2, type PrimStyle } from '../shade';
import { finishIcon, gem, line, line2, lineOn, newIcon, onBody, px, ringBand, sparkle } from './kit';

const EMBER: Ramp = [C.lavaDeep, C.lavaDark, C.ember, C.flame, C.hot, C.white];
const FROST: Ramp = [C.frostDeep, C.frostDark, C.mana, C.frost, C.ice, C.white];
const STORM: Ramp = [C.voidDark, C.voidMid, C.mana, C.storm, C.lightning, C.white];
const VOID: Ramp = [C.voidDeep, C.voidDark, C.voidMid, C.void, C.voidLight, C.voidGlow, C.voidHi];
const ASHWOOD: Ramp = [C.woodDeep, C.woodDark, C.wood, C.woodLight, C.woodHi];
const BONE: Ramp = [C.stone, C.stoneLight, C.ashGrey, C.bone, C.parchment];
const LEATHER: Ramp = [C.woodDeep, C.woodDark, C.rustDark, C.wood, C.woodLight, C.woodHi];
const ASHCLOTH: Ramp = [C.ink, C.coal, C.char, C.iron, C.stone, C.stoneLight];
const SILK: Ramp = [C.stone, C.ashGrey, C.bone, C.parchment, C.white];

const style = (ramp: Ramp, bias = 0.2, extra: Partial<PrimStyle> = {}): PrimStyle => ({ ramp, bias, dither: 0.06, ...extra });

type Pt = [number, number];

/** Grid footprint (cells) of each equipment icon; everything not listed here is 1x1. */
export const ICON_FOOTPRINT: Readonly<Record<string, readonly [number, number]>> = {
  'icon/base/ashwoodWand': [1, 3],
  'icon/base/glassboneWand': [1, 3],
  'icon/base/ironrootWand': [1, 3],
  'icon/base/emberSceptre': [2, 3],
  'icon/base/cinderOrb': [2, 2],
  'icon/base/runedTome': [2, 2],
  'icon/base/ritualCirclet': [2, 2],
  'icon/base/ironVisor': [2, 2],
  'icon/base/ashenRobe': [2, 3],
  'icon/base/rivetedCoat': [2, 3],
  'icon/base/silkWraps': [2, 2],
  'icon/base/graspingGauntlets': [2, 2],
  'icon/base/pathfinderBoots': [2, 2],
  'icon/base/ashenSandals': [2, 2],
  'icon/base/chainBelt': [2, 1],
  'icon/base/runedSash': [2, 1],
  'icon/base/emberheartWand': [1, 3],
  'icon/base/stormglassSceptre': [2, 3],
  'icon/base/echoingFocus': [2, 2],
  'icon/base/bastionHelm': [2, 2],
  'icon/base/duskweaveRobe': [2, 3],
  'icon/base/forgemasterGloves': [2, 2],
  'icon/base/wayfarerGreaves': [2, 2],
  'icon/base/ironweaveGirdle': [2, 1],
  'icon/unique/thePatientSpark': [1, 3],
  'icon/unique/cinderwalkers': [2, 2],
};

/** A licking flame rising from (x, y): `h` px tall, `wide` px half-width at its base. */
function flame(f: Frame, x: number, y: number, h: number, wide = 1): void {
  for (let i = 0; i < h; i++) {
    const u = i / h;
    const w = Math.round((1 - u) * wide);
    const sway = Math.round(Math.sin(i * 1.3) * 0.6);
    for (let dx = -w; dx <= w; dx++) px(f, x + dx + sway, y - i, u > 0.75 ? C.ember : Math.abs(dx) === w && w > 0 ? C.flame : u < 0.3 ? C.hot : C.flame);
  }
}

/** A large faceted gem: `gem()` plus a two-pixel highlight and a dark lower facet so it reads at bigger sizes. */
function bigGem(f: Frame, cx: number, cy: number, rx: number, ry: number, ramp: Ramp): void {
  gem(f, cx, cy, rx, ry, ramp);
  const n = ramp.length;
  lineOn(f, cx - rx * 0.5, cy + ry * 0.1, cx + rx * 0.1, cy - ry * 0.55, ramp[n - 2]);
  lineOn(f, cx - rx * 0.1, cy + ry * 0.6, cx + rx * 0.6, cy + ry * 0.05, ramp[1]);
  px(f, cx - rx * 0.4 + 1, cy - ry * 0.4 + 1, ramp[n - 1]);
}

// ---------------------------------------------------------------------------
// Wands (1x3): nearly upright, a slight lean to the right
// ---------------------------------------------------------------------------

const WAND_BASE: Pt = [13, 84];
const WAND_TOP: Pt = [19.5, 24];
const wandAt = (t: number): Pt => [WAND_BASE[0] + (WAND_TOP[0] - WAND_BASE[0]) * t, WAND_BASE[1] + (WAND_TOP[1] - WAND_BASE[1]) * t];

interface WandOpts {
  shaft: Ramp;
  grip: Color;
  gripDark: Color;
  twist?: boolean;
  knots?: boolean;
  segments?: boolean;
  tip: (f: Frame, x: number, y: number) => void;
}

function wand(o: WandOpts): Frame {
  const f = newIcon(1, 3);
  const s = new Sculpt();
  if (o.twist) {
    // two iron strands twisting around each other
    const w = (t: number): number => Math.sin(t * Math.PI * 7) * 1.4;
    for (let i = 0; i < 20; i++) {
      const ta = i / 20;
      const tb = (i + 1) / 20;
      const [ax, ay] = wandAt(ta);
      const [bx, by] = wandAt(tb);
      s.cap(ax + w(ta), ay, bx + w(tb), by, 1.5, 1.5, style(o.shaft, -0.3));
    }
    for (let i = 0; i < 20; i++) {
      const ta = i / 20;
      const tb = (i + 1) / 20;
      const [ax, ay] = wandAt(ta);
      const [bx, by] = wandAt(tb);
      if (Math.cos(ta * Math.PI * 7) > -0.2) s.cap(ax - w(ta), ay, bx - w(tb), by, 1.4, 1.4, style(o.shaft, 0.5));
    }
  } else {
    s.cap(WAND_BASE[0], WAND_BASE[1], WAND_TOP[0], WAND_TOP[1], 2.6, 1.8, style(o.shaft, 0.2));
  }
  s.ell(WAND_BASE[0] - 0.3, WAND_BASE[1] + 3.2, 2.9, 2.7, style(RAMPS.gold, 0.2));
  s.render(f.c, f.e);
  // grip wrap: bands across the shaft over its lower quarter
  for (let i = 0; i < 8; i++) {
    const [cx, cy] = wandAt(0.04 + i * 0.03);
    lineOn(f, cx - 3, cy + 0.6, cx + 3, cy - 0.6, i % 2 ? o.gripDark : o.grip);
  }
  if (o.knots) {
    for (const t of [0.45, 0.63, 0.8]) {
      const [x, y] = wandAt(t);
      onBody(f, x, y, C.woodDeep);
      onBody(f, x, y + 1, C.woodDark);
      onBody(f, x - 1, y - 1, C.woodHi);
    }
  }
  if (o.segments) {
    for (let t = 0.38; t < 0.95; t += 0.09) {
      const [x, y] = wandAt(t);
      lineOn(f, x - 3, y + 0.5, x + 3, y - 0.5, C.stone);
    }
  }
  // gold collar below the tip
  const [cx, cy] = wandAt(0.97);
  line(f, cx - 2.5, cy + 0.3, cx + 2.5, cy - 0.3, C.goldHi);
  line(f, cx - 2.5, cy + 1.3, cx + 2.5, cy + 0.7, C.ochre);
  const [tx, ty] = wandAt(1.09);
  o.tip(f, tx, ty);
  return f;
}

function ashwoodWand(): Frame {
  return wand({
    shaft: ASHWOOD,
    grip: C.wineMid,
    gripDark: C.wineDark,
    knots: true,
    tip: (f, x, y) => {
      bigGem(f, x, y, 3.6, 4, EMBER);
      flame(f, Math.round(x), Math.round(y - 4), 8, 2);
      sparkle(f, Math.round(x + 6), Math.round(y - 9), C.hot, 1);
    },
  });
}

function glassboneWand(): Frame {
  return wand({
    shaft: BONE,
    grip: C.char,
    gripDark: C.coal,
    segments: true,
    tip: (f, x, y) => {
      // a long frost crystal, pointed
      const s = new Sculpt();
      s.poly([[x, y - 11], [x + 3.4, y - 3], [x + 2.5, y + 2.5], [x - 2.5, y + 2.5], [x - 3.4, y - 3]], style(FROST, 0.3, { round: 0.6 }), 1.5, -0.2, -0.2);
      s.render(f.c, f.e);
      lineOn(f, x - 1, y + 1, x - 0.5, y - 8, C.ice);
      px(f, x, y - 11, C.white);
      sparkle(f, Math.round(x + 6), Math.round(y - 12), C.white, 1);
      // glass beads set into the shaft
      for (const t of [0.52, 0.72]) {
        const [bx, by] = wandAt(t);
        gem(f, bx, by, 2, 2, FROST);
      }
    },
  });
}

function ironrootWand(): Frame {
  const f = wand({
    shaft: RAMPS.metal,
    grip: C.rustDark,
    gripDark: C.rustDeep,
    twist: true,
    tip: (f, x, y) => {
      bigGem(f, x, y + 1, 3, 3.4, [C.lavaDeep, C.blood, C.lavaDark, C.rust, C.ember, C.flame]);
      // iron prongs gripping the stone
      for (const [dx, dy] of [[-4, -1], [4, -1], [0, -5]] as const) {
        line(f, x + dx * 0.6, y + 2, x + dx, y + dy, C.metalLight);
        px(f, x + dx, y + dy - 1, C.metalHi);
      }
    },
  });
  // root tendrils curling off the base
  const [bx, by] = WAND_BASE;
  line(f, bx - 1, by + 3, bx - 6, by + 8, C.metal);
  line(f, bx - 6, by + 8, bx - 8, by + 7, C.metalDark);
  line(f, bx + 1, by + 4, bx + 5, by + 9, C.metalMid);
  line(f, bx + 5, by + 9, bx + 8, by + 9, C.metalDark);
  line(f, bx - 2, by + 1, bx - 7, by + 1, C.metalMid);
  line(f, bx - 7, by + 1, bx - 9, by - 1, C.metalDark);
  return f;
}

// ---------------------------------------------------------------------------
// Sceptre (2x3)
// ---------------------------------------------------------------------------

function emberSceptre(storm = false): Frame {
  const f = newIcon(2, 3);
  const s = new Sculpt();
  const b: Pt = [22, 88];
  const t: Pt = [39, 34];
  s.cap(b[0], b[1], t[0], t[1], 2.6, 2.3, style(RAMPS.wood, 0.1));
  s.ell(b[0] - 0.5, b[1] + 2.5, 3.4, 3.2, style(RAMPS.gold, 0.2));
  // crown cage around the ember heart
  s.ell(42, 24, 11, 10.5, style(RAMPS.gold, -0.4));
  s.render(f.c, f.e);
  // hollow the cage: dark interior with the gem inside
  for (let y = 14; y <= 34; y++) {
    for (let x = 32; x <= 52; x++) {
      const d = Math.hypot((x + 0.5 - 42) / 8.2, (y + 0.5 - 24) / 7.8);
      if (d < 1) px(f, x, y, d > 0.85 ? C.goldDark : C.coal);
    }
  }
  bigGem(f, 42, 24, 6, 6, storm ? STORM : EMBER);
  // gold bands up the haft
  for (const k of [0.18, 0.45, 0.72, 0.95]) {
    const x = b[0] + (t[0] - b[0]) * k;
    const y = b[1] + (t[1] - b[1]) * k;
    line2(f, x - 3, y + 1, x + 3, y - 1, C.goldHi, C.ochre);
  }
  // crown prongs curling up around the heart
  for (const [x, y] of [[31, 15], [37, 9], [44, 7], [50, 10], [54, 17]] as const) {
    line2(f, 42 + (x - 42) * 0.62, 24 + (y - 24) * 0.62, x, y, C.gold, C.ochre);
    px(f, x, y - 1, C.goldHi);
  }
  if (storm) {
    line(f, 43, 7, 38, 16, C.lightning);
    line(f, 38, 16, 43, 15, C.lightning);
    line(f, 43, 15, 39, 24, C.storm);
    for (const y of [45, 57, 69]) bigGem(f, 39 - (y - 34) / 3, y, 2, 3, STORM);
  } else flame(f, 42, 17, 9, 2);
  sparkle(f, 55, 6, C.hot, 1);
  sparkle(f, 29, 30, C.goldHi, 1);
  return f;
}

// ---------------------------------------------------------------------------
// Off-hand foci (2x2)
// ---------------------------------------------------------------------------

function cinderOrb(): Frame {
  const f = newIcon(2, 2);
  const s = new Sculpt();
  // iron claw stand
  s.cap(21, 56, 29, 45, 2, 1.6, style(RAMPS.metal, 0));
  s.cap(43, 56, 35, 45, 2, 1.6, style(RAMPS.metal, -0.3));
  s.ell(32, 57, 11, 3, style(RAMPS.metal, 0.2, { round: 0.4 }));
  s.ell(32, 27, 18, 18, style(RAMPS.basalt, 0.6, { round: 1 }));
  s.render(f.c, f.e);
  // lava cracks branching over the orb
  const cracks: Pt[][] = [
    [[20, 17], [26, 23], [24, 31], [30, 37], [29, 42]],
    [[38, 13], [36, 21], [42, 27], [47, 26]],
    [[26, 23], [36, 21]],
    [[42, 27], [40, 35], [44, 40]],
  ];
  for (const path of cracks) {
    for (let i = 0; i + 1 < path.length; i++) {
      lineOn(f, path[i][0], path[i][1], path[i + 1][0], path[i + 1][1], C.ember);
      lineOn(f, path[i][0] + 1, path[i][1], path[i + 1][0] + 1, path[i + 1][1], i === 1 ? C.flame : C.lavaDark);
    }
  }
  for (const [x, y] of [[26, 23], [36, 21], [42, 27]] as const) {
    px(f, x, y, C.hot);
    px(f, x + 1, y, C.flame);
  }
  // claws over the orb and a cold glint top-left
  for (const [x, y] of [[17, 40], [47, 40], [32, 45]] as const) {
    line(f, x, y, x + (x < 32 ? 2 : x > 32 ? -2 : 0), y - 4, C.metalLight);
    px(f, x, y + 1, C.metalMid);
  }
  for (const [x, y] of [[23, 15], [22, 16], [24, 14]] as const) px(f, x, y, C.stone);
  px(f, 23, 15, C.stoneLight);
  return f;
}

function runedTome(): Frame {
  const f = newIcon(2, 2);
  const s = new Sculpt();
  // page block, then the cover in 3/4
  s.poly([[12, 24], [44, 12], [54, 36], [22, 50]], style(RAMPS.parchment, 0.3), 1.5);
  s.poly([[10, 20], [42, 8], [52, 32], [20, 46]], style(RAMPS.wine, 0.5, { tex: (x, y) => ((x + y) % 9 === 0 ? -0.6 : 0) }), 2.5, -0.2, -0.3);
  s.render(f.c, f.e);
  // page edges and spine
  for (let i = 0; i < 9; i++) line(f, 21 + i * 3.6, 48.5 - i * 1.45, 22 + i * 3.6, 50.5 - i * 1.45, C.bone);
  line2(f, 20, 47, 52, 33, C.ochre, C.goldDark);
  // iron corners
  for (const [x, y, dx, dy] of [[10, 20, 1, 1], [42, 8, -1, 1], [52, 32, -1, -1], [20, 46, 1, -1]] as const) {
    px(f, x, y, C.metalHi);
    px(f, x + dx, y, C.metalLight);
    px(f, x, y + dy, C.metalLight);
    px(f, x + dx, y + dy, C.metal);
  }
  // the ember spiral burnt into the cover, two pixels wide
  const cx = 31;
  const cy = 27;
  for (let i = 0; i < 70; i++) {
    const a = i * 0.16;
    const r = 0.8 + i * 0.13;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * 0.8;
    const c = i > 50 ? C.ember : i > 22 ? C.flame : C.hot;
    onBody(f, x, y, c);
    onBody(f, x + 1, y, i > 50 ? C.lavaDark : C.ember);
  }
  // clasp and a ribbon bookmark
  for (let y = 24; y <= 28; y++) px(f, 51, y, y === 24 ? C.goldHi : C.gold);
  px(f, 52, 26, C.ochre);
  line2(f, 36, 44, 34, 55, C.gold, C.ochre);
  px(f, 33, 56, C.goldDark);
  return f;
}

// ---------------------------------------------------------------------------
// Helmets (2x2)
// ---------------------------------------------------------------------------

function ritualCirclet(): Frame {
  const f = newIcon(2, 2);
  ringBand(f, 32, 38, 25, 12, 4, RAMPS.gold);
  // spikes rising from the band (front ones taller)
  for (const [x, h] of [[12, 6], [20, 9], [32, 12], [44, 9], [52, 6]] as const) {
    const base = 38 - Math.sqrt(Math.max(0, 1 - ((x - 32) / 25) ** 2)) * 12 + 2;
    line2(f, x, base, x, base - h, C.gold, C.ochre);
    px(f, x, base - h - 1, C.goldHi);
  }
  // front gem in a claw setting, small gems along the band
  bigGem(f, 32, 47, 4.4, 4.4, [C.voidDeep, C.blood, C.life, C.lifeLight, C.hot]);
  for (const [x, y] of [[27, 46], [37, 46], [32, 42]] as const) px(f, x, y, C.goldHi);
  for (const [x, y] of [[16, 45], [48, 45]] as const) gem(f, x, y, 1.8, 1.8, EMBER);
  sparkle(f, 32, 20, C.ember, 2);
  return f;
}

function ironVisor(): Frame {
  const f = newIcon(2, 2);
  const s = new Sculpt();
  s.ell(32, 29, 19, 20, style(RAMPS.metal, 0.4));
  // cheek guards
  s.poly([[14, 31], [24, 31], [24, 55], [18, 52]], style(RAMPS.metal, 0.1), 2);
  s.poly([[40, 31], [50, 31], [46, 52], [40, 55]], style(RAMPS.metal, -0.2), 2);
  s.render(f.c, f.e);
  // visor slit and breathing holes
  line2(f, 17, 33, 47, 33, C.ink, C.metalDeep);
  for (let y = 41; y <= 49; y += 4) for (let x = 27; x <= 37; x += 3) px(f, x, y, C.ink);
  // crest ridge, rivets, a rust bloom
  line2(f, 32, 9, 32, 30, C.metalHi, C.metal);
  for (const [x, y] of [[18, 24], [46, 24], [20, 44], [44, 44], [25, 14], [39, 14]] as const) {
    px(f, x, y, C.metalHi);
    px(f, x + 1, y + 1, C.metalDark);
  }
  for (let i = 0; i < 14; i++) {
    const x = 39 + Math.round(hash2(i, 1, 51) * 7);
    const y = 18 + Math.round(hash2(i, 2, 51) * 7);
    onBody(f, x, y, i % 3 === 0 ? C.rustLight : i % 2 ? C.rust : C.rustDark);
  }
  return f;
}

// ---------------------------------------------------------------------------
// Body armour (2x3)
// ---------------------------------------------------------------------------

function ashenRobe(): Frame {
  const f = newIcon(2, 3);
  const s = new Sculpt();
  // robe body flaring to a ragged hem
  const hem: Pt[] = [];
  for (let i = 0; i <= 10; i++) hem.push([54 - i * 4.4, 88 - (i % 2 ? 3 : 0)]);
  s.poly([[20, 24], [44, 24], [54, 88], ...hem.slice(1, -1), [10, 88]], style(ASHCLOTH, 0.45, { cyl: 0.8, dither: 0.02 }), 3);
  // sleeves
  s.poly([[9, 32], [20, 22], [23, 32], [15, 58], [7, 56]], style(ASHCLOTH, 0.3), 2);
  s.poly([[55, 32], [44, 22], [41, 32], [49, 58], [57, 56]], style(ASHCLOTH, 0), 2);
  // hood
  s.ell(32, 17, 11, 10, style(ASHCLOTH, 0.6));
  s.poly([[24, 12], [32, 4], [40, 12]], style(ASHCLOTH, 0.7), 2);
  s.render(f.c, f.e);
  // hood opening in shadow
  for (let y = 15; y <= 24; y++) {
    const w = Math.round(5.5 - Math.abs(y - 19.5) * 0.7);
    for (let x = 32 - w; x <= 32 + w; x++) px(f, x, y, y < 18 ? C.ink : C.coal);
  }
  // burgundy mantle trim, sash with a gold knot, folds
  for (let x = 16; x <= 48; x++) onBody(f, x, 44, x < 32 ? C.wineMid : C.burgundy);
  for (let x = 16; x <= 48; x++) onBody(f, x, 45, C.wineDark);
  px(f, 31, 44, C.gold);
  px(f, 32, 44, C.goldHi);
  line2(f, 31, 46, 29, 58, C.wineMid, C.wineDark);
  for (const [x0, x1] of [[26, 22], [38, 42], [32, 32]] as const) lineOn(f, x0, 48, x1, 86, C.coal);
  for (const [x0, x1] of [[25, 21], [37, 41]] as const) lineOn(f, x0, 52, x1, 86, C.iron);
  // a few ember-scorched pixels along the hem
  for (let x = 12; x <= 52; x += 5) onBody(f, x, 86, x % 2 ? C.lavaDark : C.coal);
  return f;
}

function rivetedCoat(): Frame {
  const f = newIcon(2, 3);
  const s = new Sculpt();
  s.poly([[18, 16], [46, 16], [50, 86], [14, 86]], style(LEATHER, 0.4, { cyl: 0.7 }), 3);
  // sleeves
  s.poly([[8, 26], [18, 16], [22, 26], [16, 62], [8, 62]], style(LEATHER, 0.2), 2);
  s.poly([[56, 26], [46, 16], [42, 26], [48, 62], [56, 62]], style(LEATHER, -0.1), 2);
  // high collar
  s.poly([[21, 8], [43, 8], [41, 20], [23, 20]], style(LEATHER, 0.7), 2);
  s.render(f.c, f.e);
  // front opening and lapels
  line2(f, 32, 20, 32, 86, C.woodDeep, C.woodDark);
  lineOn(f, 24, 20, 31, 36, C.woodHi);
  lineOn(f, 40, 20, 33, 36, C.woodDark);
  // rivet rows down both panels and around the cuffs
  for (let y = 24; y <= 82; y += 6) {
    for (const x of [27, 37]) {
      px(f, x, y, C.metalHi);
      px(f, x + 1, y + 1, C.metal);
    }
  }
  for (const [x, y] of [[11, 56], [14, 56], [50, 56], [53, 56], [12, 34], [52, 34]] as const) px(f, x, y, C.metalLight);
  // belt with a buckle
  line2(f, 15, 58, 49, 58, C.metal, C.metalDark);
  for (let y = 57; y <= 60; y++) for (let x = 30; x <= 34; x++) px(f, x, y, x === 30 || x === 34 || y === 57 || y === 60 ? C.goldHi : C.coal);
  // scuffs
  for (const [x, y] of [[20, 70], [43, 48], [22, 40]] as const) onBody(f, x, y, C.woodLight);
  return f;
}

// ---------------------------------------------------------------------------
// Gloves (2x2)
// ---------------------------------------------------------------------------

function silkWraps(): Frame {
  const f = newIcon(2, 2);
  const s = new Sculpt();
  const cloth = style(SILK, 0.1);
  // wrapped forearm and hand, rising to the upper right
  s.cap(14, 55, 30, 36, 7.2, 6.6, cloth);
  s.ell(36, 28, 10, 9, cloth, -0.7);
  for (const [x0, y0, x1, y1] of [[40, 20, 48, 12], [43, 24, 52, 18], [44, 29, 53, 25]] as const) s.cap(x0, y0, x1, y1, 2.6, 2.1, cloth);
  s.cap(30, 24, 31, 15, 2.6, 2.1, cloth);
  s.render(f.c, f.e);
  // spiral wrapping bands
  for (let i = 0; i < 9; i++) {
    const x = 9 + i * 3.6;
    const y = 50 - i * 4;
    lineOn(f, x, y, x + 9, y + 8, i % 2 ? C.ashGrey : C.stoneLight);
  }
  for (const [x0, y0, x1, y1] of [[41, 21, 47, 14], [44, 25, 51, 19]] as const) lineOn(f, x0 + 2, y0, x1 - 1, y1 + 2, C.ashGrey);
  // a trailing loose end and a burgundy binding
  line2(f, 10, 60, 4, 63, C.bone, C.ashGrey);
  line2(f, 22, 42, 31, 49, C.wineMid, C.wineDark);
  return f;
}

function graspingGauntlets(): Frame {
  const f = newIcon(2, 2);
  const s = new Sculpt();
  const iron = style(RAMPS.metal, 0.3);
  s.cap(12, 55, 26, 38, 8.2, 7.4, iron);
  s.ell(34, 29, 11, 10, iron, -0.7);
  // curled clawed fingers
  const fingers: [number, number, number, number][] = [[40, 18, 48, 10], [44, 22, 54, 16], [46, 28, 56, 24], [44, 34, 52, 36]];
  for (const [x0, y0, x1, y1] of fingers) s.cap(x0, y0, x1, y1, 3, 2.2, style(RAMPS.metal, 0.5));
  s.render(f.c, f.e);
  // bone claw tips
  for (const [, , x1, y1] of fingers) {
    line2(f, x1 + 1, y1 - 1, x1 + 4, y1 - 2, C.bone, C.ashGrey);
    px(f, x1 + 5, y1 - 2, C.parchment);
  }
  // articulated plates on the forearm, a flared cuff
  for (let i = 0; i < 4; i++) lineOn(f, 12 + i * 4.5, 44 - i * 5, 22 + i * 4.5, 52 - i * 5, C.metalDark);
  line2(f, 4, 50, 16, 62, C.metalHi, C.metalLight);
  // knuckle rivets and a rust spot
  for (const [x, y] of [[31, 23], [37, 31], [18, 48], [27, 40]] as const) {
    px(f, x, y, C.metalHi);
    px(f, x + 1, y + 1, C.metalDark);
  }
  for (const [x, y] of [[26, 30], [27, 31], [25, 31]] as const) onBody(f, x, y, C.rust);
  return f;
}

// ---------------------------------------------------------------------------
// Boots (2x2)
// ---------------------------------------------------------------------------

function pathfinderBoots(): Frame {
  const f = newIcon(2, 2);
  const s = new Sculpt();
  s.poly([[18, 8], [36, 8], [38, 40], [54, 44], [56, 54], [16, 54]], style(LEATHER, 0.3, { cyl: 0.3 }), 3);
  s.render(f.c, f.e);
  // folded cuff
  for (let x = 18; x <= 36; x++) {
    px(f, x, 9, x < 26 ? C.woodHi : C.woodLight);
    px(f, x, 10, x < 26 ? C.woodLight : C.wood);
    px(f, x, 12, C.woodDark);
  }
  // straps with iron buckles
  for (const y of [22, 32]) {
    line2(f, 18, y, 37, y, C.woodDeep, C.woodDark);
    for (let yy = y - 1; yy <= y + 2; yy++) for (let x = 29; x <= 32; x++) px(f, x, yy, x === 29 || x === 32 || yy === y - 1 || yy === y + 2 ? C.metalHi : C.metalDark);
  }
  // sole and hobnails
  for (let x = 16; x <= 56; x++) px(f, x, 54, C.coal);
  for (let x = 17; x <= 55; x++) px(f, x, 53, x % 4 === 0 ? C.metalLight : C.woodDeep);
  lineOn(f, 38, 42, 52, 46, C.woodHi);
  lineOn(f, 22, 14, 21, 48, C.woodLight);
  return f;
}

/** A sandal seen from above: footprint-shaped sole (round heel, narrow arch, broad ball) with thin straps. */
function ashenSandals(): Frame {
  const f = newIcon(2, 2);
  const ux = 0.6;
  const uy = -0.8; // heel → toe
  const at = (u: number, v = 0): Pt => [14 + ux * u * 46 - uy * v, 54 + uy * u * 46 + ux * v];
  const sole = (grow: number, st: PrimStyle): void => {
    const s = new Sculpt();
    const heel = at(0.1);
    const arch = at(0.38);
    const ball = at(0.66);
    const toe = at(0.86);
    s.cap(heel[0], heel[1], arch[0], arch[1], 5.6 + grow, 4.4 + grow, st);
    s.cap(arch[0], arch[1], ball[0], ball[1], 4.4 + grow, 8.8 + grow, st);
    s.cap(ball[0], ball[1], toe[0], toe[1], 8.8 + grow, 6.8 + grow, st);
    s.render(f.c, f.e);
  };
  sole(0, style([C.woodDeep, C.woodDark, C.wood], 0.2, { round: 0.3 }));
  sole(-2.2, style([C.wood, C.woodLight, C.woodHi], 0.6, { round: 0.3 }));
  // thin ash-grey straps: an X over the instep, a toe thong, laces trailing from the heel
  const strap = (a: Pt, b: Pt, c: Color, c2: Color): void => line2(f, a[0], a[1], b[0], b[1], c, c2);
  strap(at(0.32, -7), at(0.56, 8), C.stoneLight, C.stone);
  strap(at(0.32, 7), at(0.56, -8), C.ashGrey, C.stone);
  strap(at(0.45, 0), at(0.8, -1.6), C.stoneLight, C.stone);
  const heelL = at(0.12, -6);
  strap(heelL, [heelL[0] - 6, heelL[1] - 14], C.stoneLight, C.stone);
  strap([heelL[0] - 6, heelL[1] - 14], [heelL[0] - 2, heelL[1] - 20], C.stone, C.iron);
  const heelR = at(0.12, 6);
  strap(heelR, [heelR[0] + 8, heelR[1] + 4], C.stone, C.iron);
  const knot = at(0.45, 0);
  px(f, knot[0], knot[1], C.bone);
  px(f, knot[0] + 1, knot[1], C.parchment);
  return f;
}

// ---------------------------------------------------------------------------
// Belts (2x1)
// ---------------------------------------------------------------------------

function chainBelt(): Frame {
  const f = newIcon(2, 1);
  const s = new Sculpt();
  // heavy iron links running across, alternating flat and edge-on
  for (let i = 0; i < 9; i++) {
    const x = 4 + i * 6.6;
    const y = 16 + Math.sin(i * 0.9) * 0.6;
    if (i % 2 === 0) s.ell(x, y, 4, 3, style(RAMPS.metal, 0.4));
    else s.cap(x - 3.2, y, x + 3.2, y, 1.6, 1.6, style(RAMPS.metal, 0.1));
  }
  s.render(f.c, f.e);
  for (let i = 0; i < 9; i += 2) {
    const x = Math.round(4 + i * 6.6);
    px(f, x, 16, C.ink);
    px(f, x + 1, 16, C.metalDeep);
    px(f, x - 1, 15, C.metalHi);
  }
  // gold buckle at the centre
  const b = new Sculpt();
  b.poly([[25, 7], [39, 7], [39, 25], [25, 25]], style(RAMPS.gold, 0.2), 1.5);
  b.render(f.c, f.e);
  for (let y = 10; y <= 22; y++) for (let x = 28; x <= 36; x++) px(f, x, y, y === 10 ? C.coal : C.ink);
  line2(f, 28, 15, 38, 15, C.goldHi, C.gold);
  px(f, 26, 8, C.goldHi);
  // a length of chain hanging from the end
  for (let i = 0; i < 3; i++) {
    px(f, 58 + (i % 2), 20 + i * 3, C.metalLight);
    px(f, 58 + (i % 2), 21 + i * 3, C.metal);
  }
  return f;
}

function runedSash(): Frame {
  const f = newIcon(2, 1);
  const s = new Sculpt();
  const cloth = style(RAMPS.wine, 0.6, { tex: (x, y) => ((x - y) % 7 === 0 ? -0.7 : 0) });
  // a cloth band across, knotted on the right with two tails falling
  s.poly([[2, 11], [42, 9], [44, 20], [3, 22]], cloth, 2, -0.1, -0.3);
  s.ell(46, 15, 5.5, 5, style(RAMPS.wine, 0.3));
  s.poly([[43, 18], [48, 18], [45, 31], [40, 30]], style(RAMPS.wine, 0.1), 1.5);
  s.poly([[48, 18], [53, 17], [58, 29], [53, 31]], style(RAMPS.wine, -0.2), 1.5);
  s.render(f.c, f.e);
  // gold runes woven along the band
  const runes = ['#.#', '.#.', '#.#'];
  for (let k = 0; k < 5; k++) {
    const x0 = 6 + k * 7;
    runes.forEach((row, y) => [...row].forEach((ch, x) => ch === '#' && onBody(f, x0 + x, 13 + y - Math.round(k * 0.3), (k + x + y) % 2 ? C.gold : C.goldHi)));
  }
  lineOn(f, 3, 21, 43, 19, C.wineDark);
  lineOn(f, 3, 12, 41, 10, C.wineHi);
  // tassels
  for (const x of [41, 43, 54, 56]) {
    px(f, x, 30, C.gold);
    px(f, x, 31, C.ochre);
  }
  return f;
}

// ---------------------------------------------------------------------------
// Jewellery (1x1)
// ---------------------------------------------------------------------------

function pendant(stoneRamp: Ramp, frameRamp: Ramp, horns = false): Frame {
  const f = newIcon();
  // chain hanging in a V
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const c = i % 2 ? C.goldHi : C.ochre;
    px(f, 5 + t * 9, 3 + t * 12, c);
    px(f, 27 - t * 9, 3 + t * 12, c);
  }
  const s = new Sculpt();
  s.ell(16, 21, 6, 6.5, style(frameRamp, 0.2));
  s.render(f.c, f.e);
  if (horns) {
    // a crown of dark horns around the setting
    for (const [x0, y0, x1, y1] of [[11, 17, 7, 10], [14, 15, 13, 8], [18, 15, 19, 8], [21, 17, 25, 10]]) {
      line(f, x0, y0, x1, y1, C.basaltHi);
      line(f, x0 + 1, y0, x1 + 1, y1 + 1, C.basalt);
      px(f, x1, y1, C.flame);
    }
  }
  gem(f, 16, 21.5, 4, 4.5, stoneRamp);
  px(f, 16, 14, C.goldHi);
  px(f, 16, 15, C.gold);
  return f;
}

function boneTalisman(): Frame {
  const f = newIcon();
  line(f, 6, 3, 14, 12, C.woodDark);
  line(f, 26, 3, 18, 12, C.woodDark);
  const s = new Sculpt();
  s.ell(16, 20, 7, 7.5, style(BONE, 0.3));
  s.render(f.c, f.e);
  // carved spiral and an ember at its heart
  for (let i = 0; i < 16; i++) {
    const t = i * 0.62;
    const r = 0.5 + i * 0.3;
    px(f, 16 + Math.cos(t) * r, 20 + Math.sin(t) * r, C.stone);
  }
  px(f, 16, 20, C.ember);
  // beads and a feather
  for (const [x, y, c] of [[13, 12, C.wineMid], [19, 12, C.gold], [11, 10, C.bone], [21, 10, C.wineMid]] as [number, number, Color][]) px(f, x, y, c);
  line(f, 22, 25, 27, 30, C.ashGrey);
  line(f, 23, 25, 28, 29, C.stoneLight);
  px(f, 26, 30, C.stone);
  return f;
}

function ring(band: Ramp, stone: Ramp, extra?: (f: Frame) => void): Frame {
  const f = newIcon();
  ringBand(f, 16, 19, 10, 7, 2.6, band);
  const s = new Sculpt();
  s.ell(16, 11, 4.2, 3.2, style(band, 0.3));
  s.render(f.c, f.e);
  gem(f, 16, 10.5, 3.4, 3.4, stone);
  for (const [x, y] of [[12, 13], [20, 13], [13, 7], [19, 7]]) px(f, x, y, band[band.length - 1]);
  extra?.(f);
  return f;
}

// Advanced bases keep the class silhouette, with their own material and focal details.
function emberheartWand(): Frame {
  return wand({ shaft: ASHWOOD, grip: C.goldDark, gripDark: C.woodDeep, twist: true,
    tip: (f, x, y) => {
      bigGem(f, x, y, 6, 8, EMBER);
      ringBand(f, x, y, 9, 4, 2, RAMPS.gold);
      line(f, x - 5, y - 8, x - 8, y + 7, C.ochre);
      line(f, x + 5, y - 8, x + 8, y + 7, C.goldHi);
      sparkle(f, x, y - 9, C.hot, 1);
    },
  });
}

function echoingFocus(): Frame {
  const f = newIcon(2, 2);
  ringBand(f, 32, 34, 23, 15, 3, RAMPS.metal);
  bigGem(f, 32, 30, 9, 19, FROST);
  for (const [x, y] of [[15, 24], [49, 40]] as const) bigGem(f, x, y, 4, 8, STORM);
  line(f, 24, 51, 40, 51, C.metalLight);
  sparkle(f, 31, 8, C.ice, 2);
  return f;
}

function bastionHelm(): Frame {
  const f = ironVisor();
  const s = new Sculpt();
  s.poly([[25, 11], [32, 4], [39, 11], [35, 28], [29, 28]], style(RAMPS.gold), 2);
  s.render(f.c, f.e);
  bigGem(f, 32, 19, 3, 5, EMBER);
  for (const x of [20, 44]) lineOn(f, x, 36, x, 49, C.goldHi);
  return f;
}

function duskweaveRobe(): Frame {
  const f = ashenRobe();
  for (let y = 0; y < f.h; y++) for (let x = 0; x < f.w; x++) {
    const i = ASHCLOTH.indexOf(f.c.get(x, y));
    if (i >= 1) px(f, x, y, VOID[Math.min(4, i - 1)]);
  }
  for (const x of [25, 39]) {
    lineOn(f, x, 27, x, 79, C.voidLight);
    for (const y of [43, 59, 75]) {
      lineOn(f, x - 3, y, x, y - 4, C.voidGlow);
      lineOn(f, x, y - 4, x + 3, y, C.voidLight);
    }
  }
  bigGem(f, 32, 33, 3, 4, VOID);
  return f;
}

function forgemasterGloves(): Frame {
  const f = graspingGauntlets();
  for (const [x, y] of [[24, 26], [41, 40]] as const) {
    lineOn(f, x - 9, y, x + 8, y, C.goldHi);
    lineOn(f, x - 9, y + 5, x + 8, y + 5, C.ochre);
    bigGem(f, x, y + 2, 3, 4, EMBER);
  }
  return f;
}

function wayfarerGreaves(): Frame {
  const f = pathfinderBoots();
  for (const [x, y] of [[25, 22], [43, 34]] as const) {
    for (let i = 0; i < 3; i++) lineOn(f, x - 7, y + i * 4, x + 5, y + i * 4 - 2, C.metalHi);
    bigGem(f, x, y + 4, 2, 3, FROST);
  }
  return f;
}

function ironweaveGirdle(): Frame {
  const f = chainBelt();
  for (const x of [12, 22, 42, 52]) {
    line(f, x - 3, 12, x + 3, 20, C.metalLight);
    line(f, x + 3, 12, x - 3, 20, C.metal);
  }
  bigGem(f, 32, 16, 6, 6, EMBER);
  return f;
}

function prismaticAmulet(): Frame {
  const f = pendant(FROST, RAMPS.gold);
  gem(f, 10, 19, 2.5, 3, EMBER);
  gem(f, 22, 19, 2.5, 3, STORM);
  gem(f, 16, 25, 2, 2.5, VOID);
  return f;
}

function dusksteelRing(): Frame {
  return ring(RAMPS.metal, VOID, f => {
    gem(f, 9, 17, 2, 2, FROST);
    gem(f, 23, 17, 2, 2, FROST);
    lineOn(f, 11, 24, 21, 24, C.voidGlow);
  });
}

// ---------------------------------------------------------------------------
// Uniques: richer, rule-breaking versions of their bases
// ---------------------------------------------------------------------------

function thePatientSpark(): Frame {
  const f = ashwoodWand();
  // a gold spiral wrapping the shaft
  for (let i = 0; i < 60; i++) {
    const t = 0.3 + (i / 59) * 0.62;
    const [x, y] = wandAt(t);
    const w = Math.sin(t * 60) * 2.2;
    onBody(f, x + w, y, Math.cos(t * 60) > 0 ? C.goldHi : C.ochre);
  }
  // patient sparks waiting beside the wand
  for (const [x, y] of [[6, 60], [25, 46], [8, 34], [26, 22]] as const) {
    px(f, x, y, C.hot);
    px(f, x + 1, y, C.flame);
    px(f, x - 1, y, C.flame);
    px(f, x, y + 1, C.ember);
    px(f, x, y - 1, C.ember);
  }
  const [tx, ty] = wandAt(1.09);
  flame(f, Math.round(tx), Math.round(ty - 6), 11, 3);
  sparkle(f, 27, 4, C.hot, 2);
  return f;
}

function cinderwalkers(): Frame {
  const f = ashenSandals();
  // burning straps and a trail of fire from the heel
  for (const [x, y] of [[20, 48], [24, 44], [30, 40], [36, 36], [40, 32]] as const) {
    onBody(f, x, y, C.ember);
    onBody(f, x + 1, y, C.flame);
  }
  flame(f, 12, 50, 9, 2);
  flame(f, 6, 57, 7, 1);
  flame(f, 18, 60, 5, 1);
  px(f, 3, 44, C.flame);
  px(f, 9, 40, C.ember);
  return f;
}

function echoOfTheMatriarch(): Frame {
  const f = pendant(EMBER, RAMPS.basalt, true);
  sparkle(f, 16, 21, C.white, 1);
  return f;
}

function ruinheartBand(): Frame {
  const f = newIcon();
  ringBand(f, 16, 19, 10, 7, 2.6, [C.ink, C.voidDeep, C.basaltDark, C.basalt, C.basaltHi]);
  // cracks leaking void light
  for (const [x, y] of [[8, 22], [9, 23], [22, 24], [23, 23], [25, 18]]) px(f, x, y, C.voidGlow);
  // heart-shaped void stone
  const heart = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
  heart.forEach((row, dy) =>
    [...row].forEach((ch, dx) => {
      if (ch !== '#') return;
      const v = dy < 2 && dx < 3 ? C.voidHi : dy < 3 ? C.voidGlow : dy < 4 ? C.voidLight : C.void;
      px(f, 13 + dx, 6 + dy, v);
    }),
  );
  px(f, 14, 7, C.white);
  line(f, 16, 7, 17, 10, C.voidDeep);
  sparkle(f, 25, 8, C.voidGlow, 1);
  sparkle(f, 7, 12, C.voidLight, 1);
  return f;
}

export const EQUIPMENT_ICONS: Record<string, () => PixelImage> = {
  'icon/base/ashwoodWand': () => finishIcon(ashwoodWand()),
  'icon/base/glassboneWand': () => finishIcon(glassboneWand(), C.ice),
  'icon/base/ironrootWand': () => finishIcon(ironrootWand()),
  'icon/base/emberSceptre': () => finishIcon(emberSceptre()),
  'icon/base/cinderOrb': () => finishIcon(cinderOrb()),
  'icon/base/runedTome': () => finishIcon(runedTome()),
  'icon/base/ritualCirclet': () => finishIcon(ritualCirclet()),
  'icon/base/ironVisor': () => finishIcon(ironVisor()),
  'icon/base/ashenRobe': () => finishIcon(ashenRobe()),
  'icon/base/rivetedCoat': () => finishIcon(rivetedCoat()),
  'icon/base/silkWraps': () => finishIcon(silkWraps()),
  'icon/base/graspingGauntlets': () => finishIcon(graspingGauntlets()),
  'icon/base/pathfinderBoots': () => finishIcon(pathfinderBoots()),
  'icon/base/ashenSandals': () => finishIcon(ashenSandals()),
  'icon/base/chainBelt': () => finishIcon(chainBelt()),
  'icon/base/runedSash': () => finishIcon(runedSash()),
  'icon/base/cinderPendant': () => finishIcon(pendant(EMBER, RAMPS.metal)),
  'icon/base/boneTalisman': () => finishIcon(boneTalisman()),
  'icon/base/emberRing': () => finishIcon(ring(RAMPS.gold, EMBER)),
  'icon/base/rimeBand': () => finishIcon(ring([C.metalDark, C.metalMid, C.metalLight, C.metalHi, C.ossFrost, C.white], FROST), C.ice),
  'icon/base/stormLoop': () =>
    finishIcon(
      ring(RAMPS.metal, STORM, (f) => {
        sparkle(f, 23, 6, C.lightning, 1);
        px(f, 8, 8, C.storm);
      }),
      C.storm,
    ),
  'icon/base/voidSignet': () => finishIcon(ring([C.ink, C.voidDeep, C.voidDark, C.metal, C.metalLight], VOID), C.voidGlow),
  'icon/base/emberheartWand': () => finishIcon(emberheartWand()),
  'icon/base/stormglassSceptre': () => finishIcon(emberSceptre(true), C.lightning),
  'icon/base/echoingFocus': () => finishIcon(echoingFocus()),
  'icon/base/bastionHelm': () => finishIcon(bastionHelm()),
  'icon/base/duskweaveRobe': () => finishIcon(duskweaveRobe()),
  'icon/base/forgemasterGloves': () => finishIcon(forgemasterGloves()),
  'icon/base/wayfarerGreaves': () => finishIcon(wayfarerGreaves()),
  'icon/base/ironweaveGirdle': () => finishIcon(ironweaveGirdle()),
  'icon/base/prismaticAmulet': () => finishIcon(prismaticAmulet()),
  'icon/base/dusksteelRing': () => finishIcon(dusksteelRing()),
  'icon/unique/thePatientSpark': () => finishIcon(thePatientSpark(), C.hot, 0.5),
  'icon/unique/cinderwalkers': () => finishIcon(cinderwalkers(), C.hot, 0.5),
  'icon/unique/echoOfTheMatriarch': () => finishIcon(echoOfTheMatriarch(), C.hot, 0.5),
  'icon/unique/ruinheartBand': () => finishIcon(ruinheartBand(), C.voidGlow, 0.5),
};
