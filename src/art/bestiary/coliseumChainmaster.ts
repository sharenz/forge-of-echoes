// The Chainmaster — lieutenant. The arena's overseer: a heavy, broad-backed brute in a black executioner's hood with
// a riveted iron face mask (two ember slits and a grille), a black leather jerkin with a harness crossed over the
// chest and a bronze ring, bare scarred arms with studded bracers, a crimson overseer's sash, a belt heavy with bronze
// keys and iron-shod boots. In each fist a long iron chain ends in a barbed hook; at rest they hang in loops to the sand.
//
// The hook heads are kept red-hot (the brazier-fed irons of the pit), and an old ember brand smoulders on his chest.
//
// windup: both arms rise and the chains swing out, hooks lifting off the ground. attack: the near chain cracks out
// east — only its first links leave the fist, blurred as they pay out; the chainHook projectile / fx/chain line draw
// the real throw in its true direction. whirl (loops): arms out, both chains spin round him in a ring at waist height
// — hot hooks on opposite sides, motion-blurred arcs behind them.
import type { SpriteDef } from '../../contracts/art';
import { Frame } from '../frame';
import { C, RAMPS, type Color } from '../palette';
import { lineCells } from '../raster';
import { Sculpt, type PrimStyle } from '../shade';
import { anim, ashify, finish, monsterSprites, squash } from '../monsters/common';
import { CRIMSON, IRON, LEATHER, TAN, chain, dust, limb, sole, on, pitted, put, smear, stroke, type Pt } from './coliseumKit';

const W = 66;
const H = 50;
const FEET = 46;
const OX = 3; // poses are authored on a 60 px frame; the frame is 6 px wider so the swung hooks never clip
const AX = 29 + OX;

const skin: PrimStyle = { ramp: TAN, bias: -0.6, dither: 0.06 };
const skinFar: PrimStyle = { ramp: TAN, bias: -1.6, dither: 0 };
const hood: PrimStyle = { ramp: RAMPS.robe, bias: 0.2, dither: 0.06 };
const leather: PrimStyle = { ramp: LEATHER, bias: 0.1, dither: 0.06 };
const leatherFar: PrimStyle = { ramp: LEATHER, bias: -1.2, dither: 0 };
const trousers: PrimStyle = { ramp: [C.ink, C.coal, C.char, C.iron, C.stone], bias: -0.3, dither: 0.05 };
const trousersFar: PrimStyle = { ramp: [C.ink, C.coal, C.char, C.iron], bias: -1.3, dither: 0 };
const jerkin: PrimStyle = { ramp: [C.ink, C.coal, C.char, C.iron, C.stone, C.stoneLight], bias: -0.6, dither: 0.06 };
const mask: PrimStyle = { ramp: IRON, bias: 0.9, dither: 0.06, tex: pitted(23, 0.88) };
const bracer: PrimStyle = { ramp: LEATHER, bias: 0.5, dither: 0 };
const sash: PrimStyle = { ramp: CRIMSON, bias: -0.2, dither: 0.08 };

interface P {
  bob: number;
  lean: number;
  footN: Pt;
  footF: Pt;
  handN: Pt;
  handF: Pt;
  // chain from each hand: a path to the hook (control point for the curve, hook position)
  ctrlN: Pt;
  hookN: Pt;
  ctrlF: Pt;
  hookF: Pt;
  lash: Pt | null; // near chain cracking out: only its first links leave the fist, towards this point
  heat: number; // hook heat (1 = red-hot; corpses cool)
  whirl: number | null; // ring angle of the near hook while whirling
  glow: number;
  dust: boolean;
}

/** A barbed iron hook: shank from `at` along `dir`, then a J curling back, with a barb on the tip. The curl and
 * the barb are red-hot (emissive). */
function hook(f: Frame, at: Pt, dir: number, size = 3.4, onlyEmpty = false, heat = 1): void {
  const c = Math.cos(dir);
  const s = Math.sin(dir);
  const end: Pt = [at[0] + c * size, at[1] + s * size];
  const px = (x: number, y: number, col: Color): void => {
    const X = Math.round(x);
    const Y = Math.round(y);
    if (onlyEmpty && f.c.opaque(X, Y)) return;
    put(f, X, Y, col);
  };
  lineCells(at[0], at[1], end[0], end[1], (x, y) => px(x, y, C.metalLight));
  // the curl: half circle of radius 1.6 turning towards the +perpendicular (screen down when pointing east)
  const cx = end[0] - s * 1.6;
  const cy = end[1] + c * 1.6;
  const hot = (x: number, y: number, col: Color, g: number): void => {
    const X = Math.round(x);
    const Y = Math.round(y);
    if (onlyEmpty && f.c.opaque(X, Y)) return;
    if (heat > 0) f.glow(X, Y, col, g * heat);
    else put(f, X, Y, col === C.hot ? C.metalHi : C.metalMid);
  };
  for (let k = 0; k <= 6; k++) {
    const a = dir - Math.PI / 2 + (k / 6) * Math.PI;
    hot(cx + Math.cos(a) * 1.6, cy + Math.sin(a) * 1.6, k < 2 ? C.flame : k < 5 ? C.ember : C.lavaDark, k < 2 ? 200 : 170);
  }
  // barb tip pointing back up the shank
  hot(cx - c * 1.2 - s * 0.6, cy - s * 1.2 + c * 0.6, C.hot, 190);
}

const shift = (q: Pt): Pt => [q[0] + OX, q[1]];

function draw(p0: P): Frame {
  const p: P = {
    ...p0,
    footN: shift(p0.footN),
    footF: shift(p0.footF),
    handN: shift(p0.handN),
    handF: shift(p0.handF),
    ctrlN: shift(p0.ctrlN),
    hookN: shift(p0.hookN),
    ctrlF: shift(p0.ctrlF),
    hookF: shift(p0.hookF),
    lash: p0.lash && shift(p0.lash),
  };
  const f = new Frame(W, H);
  const s = new Sculpt();
  const lean = p.lean;
  const hip: Pt = [OX + 28.6 + lean * 0.6, 33 + p.bob];
  const chest: Pt = [OX + 29.4 + lean * 1.6, 24.6 + p.bob + Math.abs(lean) * 0.3];
  const head: Pt = [OX + 31.6 + lean * 2.4, 12.6 + p.bob + lean * 1.1];
  const shN: Pt = [chest[0] + 2.6, chest[1] - 5];
  const shF: Pt = [chest[0] - 3.6, chest[1] - 5.4];
  const whirling = p.whirl !== null;

  // far arm and far leg
  limb(s, shF, p.handF, whirling ? 2 : -1.6, 2.6, 2.2, 2.2, skinFar);
  s.ell(p.handF[0], p.handF[1], 2.4, 2.3, { ...leatherFar, bias: -0.6 });
  limb(s, [hip[0] - 2.4, hip[1] + 1.4], sole(p.footF, 2.2), 2, 3, 2.5, 2.2, trousersFar);
  // near leg
  limb(s, [hip[0] + 1.8, hip[1] + 1.4], sole(p.footN, 2.4), 2.2, 3.2, 2.7, 2.4, trousers);
  // heavy torso: broad back, barrel chest, a gut over the belt
  s.ell(chest[0], chest[1], 7.4, 7.6, jerkin, lean * 0.1);
  s.ell(chest[0] + 1.6, chest[1] + 4.6, 5.8, 4.4, { ...jerkin, bias: -0.3 });
  // belt and crimson sash hanging in front
  s.poly([[hip[0] - 6.4, hip[1] - 3], [hip[0] + 6.6, hip[1] - 3.6], [hip[0] + 6.8, hip[1] - 0.8], [hip[0] - 6.4, hip[1] - 0.2]], { ...leather, bias: -0.4 }, 1);
  const hem = (y: number): number => Math.min(y, FEET - 0.5); // the sash lies on the sand when he falls
  s.poly([[hip[0] + 1.6, hip[1] - 1], [hip[0] + 5.6, hip[1] - 1.4], [hip[0] + 6.6 + lean, hem(hip[1] + 7.4)], [hip[0] + 4.4 + lean, hem(hip[1] + 8.4)], [hip[0] + 2.8, hem(hip[1] + 6.6)]], sash, 1.4);
  // hood: a heavy cowl on the shoulders, the rounded head, a pointed crown falling back
  s.ell(chest[0] + 0.8, chest[1] - 6.4, 5.6, 2.8, { ...hood, bias: -0.2 }, -0.1);
  s.poly([[head[0] - 3.6, head[1] - 2], [head[0] - 1, head[1] - 4.8], [head[0] - 7.6, head[1] - 3.4]], { ...hood, bias: 0.1 }, 1.2);
  s.ell(head[0], head[1], 5, 5.4, hood);
  // iron face mask
  s.ell(head[0] + 2.4, head[1] + 1, 3, 4, mask, 0.12);
  // near arm: bare upper arm, studded bracer, fist
  const eN = limb(s, [shN[0], shN[1] + 1], p.handN, whirling ? -2 : -2, 2.9, 2.5, 2.4, skin, { ...bracer });
  s.ell(p.handN[0], p.handN[1], 2.5, 2.4, { ...skin, bias: 0.4 });
  s.render(f.c, f.e);

  // harness straps crossing the chest, bronze ring where they meet
  const ring: Pt = [chest[0] + 2.6, chest[1] - 0.4];
  stroke(f, [chest[0] - 4, chest[1] - 6], ring, (t) => (t < 0.1 ? null : C.woodDark), true);
  stroke(f, ring, [hip[0] + 5.6, hip[1] - 3.2], (t) => (t > 0.92 ? null : C.woodDark), true);
  stroke(f, [chest[0] + 5, chest[1] - 6], ring, () => C.wood, true);
  for (const [dx, dy, c] of [[0, -1, C.gold], [1, 0, C.goldDark], [0, 1, C.ochre], [-1, 0, C.goldHi]] as const) on(f, ring[0] + dx, ring[1] + dy, c);
  // an old ember brand on the chest, between the straps
  const br: Pt = [Math.round(chest[0] - 1), Math.round(chest[1] - 2.4)];
  const bg = 120 + 70 * Math.min(1, p.glow) * Math.max(0.3, p.heat);
  f.glow(br[0], br[1], C.flame, bg);
  f.glow(br[0] - 1, br[1] + 1, C.ember, bg * 0.85);
  f.glow(br[0] + 1, br[1] + 1, C.ember, bg * 0.85);
  // jerkin seams and studs
  for (let i = 0; i < 3; i++) on(f, chest[0] - 4.6 + i * 0.4, chest[1] - 2 + i * 2.4, C.stoneLight);
  on(f, chest[0] + 5.4, chest[1] + 3, C.metalHi);
  // bronze studs on the bracer
  const bs: Pt = [(eN[0] + p.handN[0]) / 2, (eN[1] + p.handN[1]) / 2];
  on(f, bs[0], bs[1], C.gold);
  on(f, bs[0] - (p.handN[0] - eN[0]) * 0.25, bs[1] - (p.handN[1] - eN[1]) * 0.25, C.ochre);
  // belt buckle and the ring of keys
  on(f, hip[0] + 1, hip[1] - 2, C.goldHi);
  on(f, hip[0] + 2, hip[1] - 2, C.gold);
  const keys: Pt = [hip[0] - 3.4, hip[1] + 0.6];
  for (const [dx, dy, c] of [[0, 0, C.ochre], [1, 1, C.goldDark], [-1, 1, C.goldDark], [0, 2, C.rustDark], [-1, 3, C.ochre], [1, 3, C.goldDark]] as const) put(f, keys[0] + dx, keys[1] + dy, c);
  // boots
  for (const [x, y] of [p.footF, p.footN]) {
    for (let i = -3; i <= 3; i++) put(f, x + i, y, i < 0 ? C.woodDark : C.woodDeep);
    for (let i = -2; i <= 2; i++) on(f, x + i, y - 1, i < 0 ? C.wood : C.woodDark);
    on(f, x - 2, y - 3, C.metalMid);
  }
  // mask: rivets, ember eye slits, breathing grille
  const mx = Math.round(head[0] + 2.2);
  const my = Math.round(head[1]);
  const g = 150 + 105 * Math.min(1, p.glow);
  f.glow(mx + 1, my, p.glow > 0.95 ? C.hot : C.flame, g);
  f.glow(mx + 2, my, C.ember, g * 0.85);
  f.glow(mx - 1, my, C.ember, g * 0.7);
  for (let i = 0; i < 3; i++) on(f, mx + i, my + 3, i % 2 ? C.metalDark : C.metalDeep);
  for (let i = 0; i < 2; i++) on(f, mx + 0.5 + i, my + 2, C.metalDark);
  on(f, mx - 1, my - 2, C.metalHi);
  on(f, mx + 2, my - 2, C.metalLight);
  on(f, mx - 1, my + 3, C.metalLight);

  // chains: hand → hook (or a straight lash off the frame)
  const drawChain = (hand: Pt, ctrl: Pt, end: Pt, behind: boolean, phase: number): void => {
    const path = (t: number): Pt => [
      (1 - t) * (1 - t) * hand[0] + 2 * (1 - t) * t * ctrl[0] + t * t * end[0],
      (1 - t) * (1 - t) * hand[1] + 2 * (1 - t) * t * ctrl[1] + t * t * end[1],
    ];
    chain(f, path, phase, C.metalHi, C.metalLight, C.metalMid, behind);
  };
  const hookDir = (end: Pt, ctrl: Pt): number => Math.atan2(end[1] - ctrl[1], end[0] - ctrl[0]);
  if (p.whirl !== null) {
    // ring hooks: the far one is behind the body when on the far side of the ring
    const behindN = Math.sin(p.whirl) < 0;
    drawChain(p.handF, p.ctrlF, p.hookF, !behindN, 1);
    hook(f, p.hookF, hookDir(p.hookF, p.ctrlF) + Math.PI / 2, 3.2, !behindN, p.heat);
    drawChain(p.handN, p.ctrlN, p.hookN, behindN, 0);
    hook(f, p.hookN, hookDir(p.hookN, p.ctrlN) + Math.PI / 2, 3.2, behindN, p.heat);
  } else {
    drawChain(p.handF, p.ctrlF, p.hookF, true, 1);
    hook(f, p.hookF, hookDir(p.hookF, p.ctrlF), 3, true, p.heat);
    if (p.lash) {
      // only the first links leave the fist: the thrown line itself is fx/chain + the chainHook projectile
      drawChain(p.handN, [(p.handN[0] + p.lash[0]) / 2, (p.handN[1] + p.lash[1]) / 2 + 0.5], p.lash, false, 0);
    } else {
      drawChain(p.handN, p.ctrlN, p.hookN, false, 0);
      hook(f, p.hookN, hookDir(p.hookN, p.ctrlN), 3.4, false, p.heat);
    }
  }
  // knuckles over the chain
  put(f, p.handN[0] + 0.6, p.handN[1] - 0.6, C.rustLight);
  put(f, p.handN[0] + 1.4, p.handN[1], C.rust);

  const out = finish(f);
  if (p.lash) {
    // the chain paying out of the fist: a short bright smear past the last link
    const [lx, ly] = p.lash;
    const dx = lx - p.handN[0];
    const dy = ly - p.handN[1];
    const n = Math.hypot(dx, dy) || 1;
    for (let i = 1; i <= 4; i++) out.c.plot(Math.round(lx + (dx / n) * i), Math.round(ly + (dy / n) * i), C.metalHi, 0.8 - i * 0.16);
  }
  if (p.dust) dust(out, p.footN[0] + 2, FEET, 5);
  if (p.whirl !== null) {
    // motion arcs trailing each hook round the ring
    const cx = 29 + OX;
    const cy = 31 + p.bob;
    for (const a of [p.whirl, p.whirl + Math.PI]) {
      smear(out, cx, cy, 26, 8.4, a - 2.1, a - 0.25, C.metalHi, 0.85, 0, 2);
      smear(out, cx, cy, 22.5, 7.2, a - 1.5, a - 0.3, C.stoneLight, 0.55);
    }
  }
  return out;
}

// --- poses -------------------------------------------------------------------------------------------------------

const REST: P = {
  bob: 0,
  lean: 0,
  footN: [32.5, FEET],
  footF: [25, FEET],
  handN: [38.5, 30],
  handF: [22, 29],
  ctrlN: [42, 41],
  hookN: [43, FEET - 7],
  ctrlF: [17, 40],
  hookF: [15, FEET - 8],
  lash: null,
  heat: 1,
  whirl: null,
  glow: 0.7,
  dust: false,
};
const pose = (o: Partial<P>): P => ({ ...REST, ...o });

/** Whirl pose: arms out, the near hook at ring angle `a`, the far hook opposite. */
function whirlPose(a: number, bob: number, glow: number): P {
  const cx = 29;
  const cy = 31 + bob;
  const ring = (ang: number): Pt => [cx + Math.cos(ang) * 25, cy + Math.sin(ang) * 8];
  const lagCtrl = (hand: Pt, ang: number): Pt => {
    const r = ring(ang - 0.5);
    return [(hand[0] + r[0]) / 2, (hand[1] + r[1]) / 2];
  };
  const handN: Pt = [38 + Math.cos(a) * 2, 25 + bob + Math.sin(a) * 1.5];
  const handF: Pt = [21 - Math.cos(a) * 2, 24 + bob - Math.sin(a) * 1.5];
  return pose({
    bob,
    lean: -0.2,
    handN,
    handF,
    hookN: ring(a),
    ctrlN: lagCtrl(handN, a),
    hookF: ring(a + Math.PI),
    ctrlF: lagCtrl(handF, a + Math.PI),
    whirl: a,
    glow,
    footN: [34, FEET],
    footF: [24.5, FEET],
  });
}

export function chainmasterSprites(): SpriteDef[] {
  const idle = [0, 1, 2, 3].map((i) => {
    const b = [0, 0.5, 1, 0.5][i];
    const sw = [0, 0.8, 0, -0.8][i];
    return draw(
      pose({
        bob: b,
        handN: [38.5, 30 + b],
        handF: [22, 29 + b],
        ctrlN: [42 + sw, 41],
        hookN: [43 + sw * 1.4, FEET - 7],
        ctrlF: [17 - sw, 40],
        hookF: [15 - sw, FEET - 8],
        glow: [0.6, 0.7, 0.85, 0.7][i],
      }),
    );
  });
  // a heavy, rolling stride; both chains drag behind on the sand
  const move = [0, 1, 2, 3, 4, 5].map((i) => {
    const ph = ((i + 0.5) / 6) * Math.PI * 2;
    const st = Math.sin(ph);
    const b = Math.abs(Math.cos(ph)) * 1.2;
    return draw(
      pose({
        bob: b,
        lean: 0.5,
        footN: [31.5 + st * 4.5, FEET - Math.max(0, st) * 2.2],
        footF: [26.5 - st * 4.5, FEET - Math.max(0, -st) * 2.2],
        handN: [38 - st * 1.5, 30 + b],
        handF: [22.5 + st * 1.5, 29 + b],
        ctrlN: [34, FEET - 4],
        hookN: [22 - st, FEET - 6],
        ctrlF: [16, FEET - 5],
        hookF: [9 + st, FEET - 7],
        glow: 0.75,
      }),
    );
  });
  // windup: both arms rise, the chains swing out and the hooks leave the ground
  const windup = [
    draw(pose({ bob: 0.5, lean: -0.3, handN: [39, 24], handF: [21, 23], ctrlN: [48, 36], hookN: [50, FEET - 6], ctrlF: [12, 36], hookF: [9, FEET - 7], glow: 0.9 })),
    draw(pose({ bob: 0, lean: -0.5, handN: [40, 20], handF: [20, 19.5], ctrlN: [52, 28], hookN: [55, 36], ctrlF: [8, 28], hookF: [5, 35], glow: 1 })),
    draw(pose({ bob: -0.5, lean: -0.6, handN: [40, 18], handF: [20, 17.5], ctrlN: [54, 22], hookN: [57, 29], ctrlF: [6, 22], hookF: [3, 28], glow: 1 })),
    draw(pose({ bob: -0.5, lean: -0.6, handN: [40, 18], handF: [20, 17.5], ctrlN: [53, 18], hookN: [57, 24], ctrlF: [7, 18], hookF: [3, 23], glow: 1 })),
  ];
  // lash: the near chain cracks out east, straight off the frame
  const attack = [
    draw(pose({ lean: 1.2, handN: [44, 22], handF: [22, 27], lash: [52, 21.5], ctrlF: [18, 42], hookF: [15, FEET - 4], footN: [36, FEET], glow: 1, dust: true })),
    draw(pose({ lean: 1.4, handN: [45, 25], handF: [22.5, 27.5], lash: [52.5, 25], ctrlF: [18, 42], hookF: [15, FEET - 4], footN: [36, FEET], glow: 1 })),
    draw(pose({ lean: 0.8, handN: [42, 28], handF: [22, 28.5], ctrlN: [52, 38], hookN: [56, FEET - 5], footN: [35, FEET], glow: 0.85 })),
  ];
  // whirl: six frames of one full turn
  const whirl = [0, 1, 2, 3, 4, 5].map((i) => draw(whirlPose((i / 6) * Math.PI * 2, [0, 0.5, 1, 0, 0.5, 1][i] * 0.6, 1)));
  // corpse: drops to his knees, then falls forward onto his chains
  const fallen = pose({ bob: 8.5, lean: 1.8, footN: [34, FEET], footF: [25, FEET], handN: [45, FEET - 2], handF: [38, FEET - 2], ctrlN: [50, FEET - 1], hookN: [54, FEET - 4], ctrlF: [20, FEET - 1], hookF: [14, FEET - 4], glow: 0.2, heat: 0.4 });
  const down = draw(fallen);
  const corpse = [
    draw(pose({ bob: 6, lean: 1, footN: [33, FEET], footF: [25, FEET], handN: [41, FEET - 5], handF: [30, FEET - 6], ctrlN: [46, FEET - 1], hookN: [50, FEET - 4], ctrlF: [22, FEET - 1], hookF: [16, FEET - 4], glow: 0.45, heat: 0.7 })),
    ashify(squash(down, 0.8, FEET), 0.45, 0.4),
    ashify(squash(down, 0.6, FEET), 0.9, 0.15),
  ];
  return monsterSprites({
    id: 'chainmaster',
    anchorX: AX,
    anchorY: FEET + 1,
    anims: {
      idle: anim(idle, 4, true),
      move: anim(move, 7, true),
      windup: anim(windup, 6, false),
      attack: anim(attack, 12, false),
      whirl: anim(whirl, 12, true),
      corpse: anim(corpse, 6, false),
    },
  });
}
