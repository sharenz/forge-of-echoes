// Rift Stalker — the hunter. A gaunt void-purple quadruped with a long narrow skull, a ridge of rift spines
// and a whip tail. Its eyes and spines flare violet during the leap telegraph.
import type { SpriteDef } from '../../contracts/art';
import { Frame } from '../frame';
import { C, type Ramp } from '../palette';
import { Sculpt, type PrimStyle } from '../shade';
import { anim, ashify, finish, monsterSprites, onBody, px, squash } from './common';

const W = 32;
const H = 24;
const FEET = 21;

const HIDE: Ramp = [C.ink, C.voidDeep, C.voidDark, C.voidMid, C.void];
const hide: PrimStyle = { ramp: HIDE, bias: -0.3, dither: 0.08 };
const far: PrimStyle = { ramp: HIDE, bias: -1.5, dither: 0 };
const spine: PrimStyle = { ramp: [C.ink, C.voidDeep, C.voidDark, C.voidMid, C.void], bias: 0.2, dither: 0 };

type Pt = [number, number];
interface Leg {
  hip: Pt;
  knee: Pt;
  foot: Pt;
}
interface P {
  body: Pt; // centre of the torso
  tilt: number; // torso rotation (+ = nose down)
  head: Pt; // head centre offset from the chest
  headRot: number;
  jaw: number;
  tail: Pt; // tail tip offset from the hip
  fl: [Pt, Pt]; // near front leg: knee, foot (absolute)
  hl: [Pt, Pt]; // near hind leg: knee, foot
  ffl: [Pt, Pt]; // far front
  fhl: [Pt, Pt]; // far hind
  glow: number;
}

function draw(p: P): Frame {
  const f = new Frame(W, H);
  const s = new Sculpt();
  const [bx, by] = p.body;
  const cos = Math.cos(p.tilt);
  const sin = Math.sin(p.tilt);
  const along = (d: number, up = 0): Pt => [bx + cos * d - sin * up, by + sin * d + cos * up];
  const hip = along(-5, 0.6);
  const chest = along(4.5, 0.4);
  const legCaps = (leg: Leg, style: PrimStyle, r: number): void => {
    s.cap(leg.hip[0], leg.hip[1], leg.knee[0], leg.knee[1], r, r * 0.7, style);
    s.cap(leg.knee[0], leg.knee[1], leg.foot[0], leg.foot[1] - 0.4, r * 0.7, r * 0.55, style);
  };
  // whip tail rising behind
  const tailMid: Pt = [hip[0] - 4, hip[1] - 2 + p.tail[1] * 0.4];
  const tailTip: Pt = [hip[0] + p.tail[0], hip[1] + p.tail[1]];
  s.cap(hip[0] - 1, hip[1] - 0.5, tailMid[0], tailMid[1], 1.1, 0.8, { ...hide, bias: -0.6 });
  s.cap(tailMid[0], tailMid[1], tailTip[0], tailTip[1], 0.8, 0.4, { ...hide, bias: -0.6 });
  // far legs
  legCaps({ hip: along(-4.5, 1.5), knee: p.fhl[0], foot: p.fhl[1] }, far, 1.4);
  legCaps({ hip: along(4, 1.8), knee: p.ffl[0], foot: p.ffl[1] }, far, 1.3);
  // spines along the arched back (drawn before the torso so only their tips stick out)
  for (let i = 0; i < 5; i++) {
    const [sx, sy] = along(-4.5 + i * 2.3, -2.4 - (i === 2 ? 0.4 : 0));
    const h = i === 1 || i === 2 ? 3.4 : 2.4;
    s.poly([[sx - 1.1, sy + 1], [sx + 1, sy + 1], [sx - 0.8, sy - h]], spine, 0.8);
  }
  // lean torso: haunch, waist, deep chest
  s.ell(hip[0], hip[1], 3.6, 3.0, hide, p.tilt);
  s.ell(bx, by, 5.5, 2.5, hide, p.tilt);
  s.ell(chest[0], chest[1], 3.6, 3.4, { ...hide, bias: 0 }, p.tilt);
  // neck and long skull
  const neck = along(7.2, 0.2);
  const hx = neck[0] + p.head[0];
  const hy = neck[1] + p.head[1];
  s.cap(chest[0] + 1, chest[1] - 1, hx - 1.5, hy, 1.9, 1.5, { ...hide, bias: 0.1 });
  if (p.jaw > 0) s.cap(hx - 1, hy + 1, hx + 3.2 * Math.cos(p.headRot + 0.5 * p.jaw), hy + 1 + 3.2 * Math.sin(p.headRot + 0.5 * p.jaw), 0.9, 0.6, { ...hide, bias: -0.3 });
  s.ell(hx + 1.2, hy, 3.9, 1.8, { ...hide, bias: 0.5 }, p.headRot);
  // near legs
  legCaps({ hip: along(-5, 1.4), knee: p.hl[0], foot: p.hl[1] }, { ...hide, bias: -0.1 }, 1.6);
  legCaps({ hip: along(4.5, 1.6), knee: p.fl[0], foot: p.fl[1] }, { ...hide, bias: 0.1 }, 1.5);
  s.render(f.c, f.e);

  // claws
  for (const foot of [p.fl[1], p.hl[1]]) {
    px(f, foot[0] + 1, foot[1], C.stoneLight);
    px(f, foot[0], foot[1], C.voidMid);
  }
  const g = 150 + 105 * p.glow;
  // spine tips and rift seams on the flank glow violet
  for (let i = 0; i < 5; i++) {
    const [sx, sy] = along(-4.5 + i * 2.3, -2.4 - (i === 2 ? 0.4 : 0));
    const h = i === 1 || i === 2 ? 3.4 : 2.4;
    const tx = Math.round(sx - 0.8);
    const ty = Math.round(sy - h + 0.6);
    if (f.c.opaque(tx, ty)) f.glow(tx, ty, p.glow > 0.9 ? C.voidHi : C.voidGlow, g * (0.6 + 0.4 * p.glow));
  }
  for (const [dx, up] of [[-2, 0.8], [-1, 1.2], [1, 0.6]] as const) {
    const [cx, cy] = along(dx, up);
    if (f.c.opaque(Math.round(cx), Math.round(cy))) f.glow(Math.round(cx), Math.round(cy), C.voidLight, g * 0.55);
  }
  // eyes: two violet slits along the skull
  const ex = Math.round(hx + 1.6 * Math.cos(p.headRot) + 0.5);
  const ey = Math.round(hy - 0.6 + 1.6 * Math.sin(p.headRot));
  f.glow(ex, ey, p.glow > 0.9 ? C.voidHi : C.voidGlow, g);
  f.glow(ex + 1, ey, C.voidGlow, g * 0.8);
  // teeth
  const mx = Math.round(hx + 3.5 * Math.cos(p.headRot));
  const my = Math.round(hy + 1 + 3.5 * Math.sin(p.headRot));
  onBody(f, mx, my, C.bone);
  onBody(f, mx - 2, my, C.bone);
  if (p.jaw > 0.5) {
    f.glow(mx - 1, my + 1, C.voidGlow, g * 0.8);
  }
  return finish(f);
}

// --- pose tables -------------------------------------------------------------

const BODY: Pt = [15, 12.5];

function stand(o: Partial<P> = {}): P {
  return {
    body: BODY,
    tilt: 0.05,
    head: [0.5, 1.4],
    headRot: 0.3,
    jaw: 0,
    tail: [-9, -6],
    fl: [[20, 16.5], [21, FEET]],
    hl: [[12, 16.5], [9.5, FEET]],
    ffl: [[18.5, 16.5], [18.5, FEET - 1]],
    fhl: [[10.5, 16.5], [11.5, FEET - 1]],
    glow: 0.7,
    ...o,
  };
}

export function riftStalkerSprites(): SpriteDef[] {
  const idle = [0, 1, 2, 1].map((i) =>
    draw(stand({ body: [15, 12.5 + (i === 2 ? 0.5 : 0)], tail: [-9 - i * 0.3, -6 + i * 0.6], glow: [0.6, 0.75, 0.9, 0.75][i] })),
  );
  // prowling gallop: gather → extend
  const gallop: [Pt, Pt, Pt, Pt, Pt, Pt, Pt, Pt, number][] = [
    // fl knee, fl foot, hl knee, hl foot, ffl knee, ffl foot, fhl knee, fhl foot, bob
    [[22, 15.5], [24, FEET - 1], [9, 16], [6, FEET], [20.5, 16], [22, FEET - 1], [10, 16.5], [8, FEET], 0],
    [[21, 16], [22, FEET], [10, 16.5], [8, FEET], [21.5, 16], [23, FEET - 1], [11, 16.5], [10, FEET], 0.5],
    [[19, 16.5], [18.5, FEET], [12.5, 15.5], [13, FEET - 1], [20, 16.5], [20, FEET], [12, 16], [12, FEET - 1], 1],
    [[18, 16], [16.5, FEET - 1], [13, 15.5], [15, FEET - 1], [18.5, 16.5], [18, FEET], [13, 15.5], [14, FEET - 1], 0],
    [[19.5, 15.5], [20, FEET - 1], [11, 15.5], [11, FEET], [18, 16], [17, FEET - 1], [12.5, 16], [13, FEET], -0.5],
    [[21, 15.5], [22.5, FEET - 1], [9.5, 16], [7.5, FEET], [19.5, 16], [20, FEET - 1], [11, 16.5], [10, FEET], 0],
  ];
  const move = gallop.map(([a, b, c, d, e, f2, g, h, bob], i) =>
    draw(stand({ body: [15, 12.5 + bob], tilt: [0.08, 0.04, 0, 0.02, 0.06, 0.08][i], fl: [a, b], hl: [c, d], ffl: [e, f2], fhl: [g, h], tail: [-10, -4 + bob], glow: 0.75 })),
  );
  // crouch, coiled: rear up, head low, everything glowing
  const crouch = (k: number, glow: number): P =>
    stand({
      body: [14.5 - k, 13.5 + k * 1.5],
      tilt: 0.12 + k * 0.06,
      head: [0.5, 1.8 + k * 0.5],
      headRot: 0.35,
      fl: [[19.5 - k, 17.5], [21, FEET]],
      hl: [[11.5 - k, 17 + k * 0.5], [9 - k, FEET]],
      ffl: [[18 - k, 17.5], [18.5, FEET - 1]],
      fhl: [[10 - k, 17.5], [11 - k, FEET - 1]],
      tail: [-9, -9 - k],
      glow,
    });
  const windup = [draw(crouch(0.5, 0.85)), draw(crouch(1, 1)), draw(crouch(1.2, 1))];
  const attack = [
    draw(stand({ body: [17, 12], tilt: 0.12, head: [1.5, 1.5], headRot: 0.35, jaw: 1, fl: [[24, 15], [26, FEET - 1]], ffl: [[23, 15.5], [25, FEET - 1]], hl: [[12, 16.5], [10, FEET]], glow: 1 })),
    draw(stand({ body: [17.5, 12.5], tilt: 0.16, head: [1.5, 2], headRot: 0.5, jaw: 0.6, fl: [[23.5, 16], [25, FEET]], ffl: [[22.5, 16], [24, FEET]], hl: [[13, 16.5], [11, FEET]], glow: 1 })),
    draw(stand({ body: [16, 12.5], head: [0.8, 1.5], jaw: 0.2, glow: 0.8 })),
  ];
  // leap: take-off → full stretch → reach for the landing
  const leap = [
    draw(stand({ body: [15, 11.5], tilt: -0.15, head: [0.5, 0.5], headRot: 0.1, fl: [[21.5, 13], [23.5, 14]], ffl: [[20.5, 13.5], [22.5, 15]], hl: [[10, 16], [6, FEET]], fhl: [[11, 16], [7.5, FEET - 1]], tail: [-11, -3], glow: 1 })),
    draw(stand({ body: [15, 9], tilt: -0.05, head: [1, 0.5], headRot: 0.15, jaw: 0.6, fl: [[23, 9.5], [27, 10.5]], ffl: [[22, 10], [26, 11.5]], hl: [[8.5, 12], [4, 14]], fhl: [[9, 12.5], [5, 15]], tail: [-12, 0], glow: 1 })),
    draw(stand({ body: [15, 9], tilt: 0.05, head: [1, 1], headRot: 0.3, jaw: 1, fl: [[23, 11], [26, 13.5]], ffl: [[22, 11.5], [25, 14]], hl: [[9, 12], [5, 13]], fhl: [[9.5, 12.5], [6, 14]], tail: [-12, -1], glow: 1 })),
    draw(stand({ body: [16, 11.5], tilt: 0.2, head: [1, 2], headRot: 0.5, jaw: 0.5, fl: [[22, 15], [23.5, FEET]], ffl: [[21, 15.5], [22, FEET]], hl: [[11, 13], [8, 15]], fhl: [[11.5, 13.5], [9, 16]], tail: [-11, -5], glow: 0.9 })),
  ];
  const dead = stand({ body: [15, 17], tilt: 0.05, head: [0.5, 2.5], headRot: 0.4, fl: [[21, 19], [24, FEET]], hl: [[11, 19], [7, FEET]], ffl: [[19, 19], [21, FEET]], fhl: [[10, 19], [8, FEET]], tail: [-10, 2], glow: 0.3 });
  const corpseBase = draw(dead);
  const corpse = [
    draw({ ...dead, body: [15, 15], glow: 0.5 }),
    ashify(squash(corpseBase, 0.85, FEET), 0.5, 0.4),
    ashify(squash(corpseBase, 0.7, FEET), 1, 0.2),
  ];
  return monsterSprites({
    id: 'riftStalker',
    anchorX: 16,
    anchorY: FEET + 1,
    anims: {
      idle: anim(idle, 5, true),
      move: anim(move, 12, true),
      windup: anim(windup, 6, false),
      attack: anim(attack, 12, false),
      leap: anim(leap, 10, false),
      corpse: anim(corpse, 8, false),
    },
  });
}
