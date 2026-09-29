// Pit Hound — fast. A lean, scarred arena hound: a long low body with a deep chest and a tucked waist, a wedge
// skull carried low and forward with one ear laid back, a thin whip tail. Dark rust hide with a lit ridge along the
// back, pale healed scars on the flank, a spiked iron collar, an ember eye and a blood-wet jaw. Much longer than
// tall, so it never reads as the upright humanoids of the family; at a gallop the whole body stretches and gathers.
//
// At ~13 px tall the head is a hand-authored pixel map (like the Ashling's) so the eye, ear, fangs and blood stay
// crisp; the body and legs are shaded Sculpt shapes posed per frame.
import type { SpriteDef } from '../../contracts/art';
import { Frame } from '../frame';
import { C, type Ramp } from '../palette';
import { Sculpt, type PrimStyle } from '../shade';
import { anim, ashify, finish, monsterSprites, squash, stamp, type Ink } from '../monsters/common';
import { blood, on, put, type Pt } from './coliseumKit';

const W = 34;
const H = 19;
const FEET = 16; // poses are authored with the paws on row 16; the frame adds OX columns behind and OY rows above
const OX = 3;
const OY = 1;
const GROUND = FEET + OY; // the lowest (outline) row of the standing paws: the anchor

const HIDE: Ramp = [C.ink, C.coal, C.rustDeep, C.rustDark, C.rust, C.rustLight];
const hide: PrimStyle = { ramp: HIDE, bias: -0.45, dither: 0.04 };
const hideLit: PrimStyle = { ramp: HIDE, bias: -0.15, dither: 0.04 };
const leg: PrimStyle = { ramp: HIDE, bias: -0.2, dither: 0 };
const far: PrimStyle = { ramp: HIDE, bias: -1.6, dither: 0 };

// Head maps, 9 wide, origin = top-left. a/l lit hide, r mid, d dark, k deep; E eye (glow); n nose;
// T fang; B/b blood; R open maw.
const HEAD = [
  '.a.......',
  'arl......',
  'rlllr....',
  'drrElrla.',
  'kddrrrrdn',
  '.kkbBbk..',
];
const HEAD_OPEN = [
  '.a.......',
  'arl......',
  'rlllr....',
  'drrElrla.',
  'kddrrrrTn',
  '.kkbRRR..',
  '..kdddT..',
];
const HEAD_WIDE = [
  '.a.......',
  'arl......',
  'rlllrla..',
  'drrElrrTn',
  'kddrRRR..',
  '.kbRRR...',
  '..kddT...',
  '...kd....',
];

function legend(glow: number): Record<string, Ink> {
  const g = 150 + 105 * Math.min(1, glow);
  return {
    a: C.rustLight,
    l: C.rust,
    r: C.rustDark,
    d: C.rustDeep,
    k: C.coal,
    n: C.ink,
    E: { c: glow > 0.95 ? C.hot : C.flame, glow: g },
    T: C.bone,
    B: C.life,
    b: C.blood,
    R: C.lifeDark,
  };
}

interface P {
  body: Pt; // waist centre
  stretch: number; // + = extended (hip and chest further apart)
  tilt: number; // + = nose down
  head: Pt; // head map origin offset from the neck top
  jaw: 0 | 1 | 2;
  tail: Pt; // tail tip offset from the rump
  fl: Pt; // near front paw (absolute)
  ffl: Pt;
  hl: Pt; // near hind paw
  fhl: Pt;
  glow: number;
  drip: number; // blood drip length under the jaw
}

const sh = (q: Pt): Pt => [q[0] + OX, q[1] + OY];

function draw(p0: P): Frame {
  const p: P = { ...p0, body: sh(p0.body), fl: sh(p0.fl), ffl: sh(p0.ffl), hl: sh(p0.hl), fhl: sh(p0.fhl) };
  const f = new Frame(W, H);
  const s = new Sculpt();
  const [bx, by] = p.body;
  const cos = Math.cos(p.tilt);
  const sin = Math.sin(p.tilt);
  const along = (d: number, up = 0): Pt => [bx + cos * d - sin * up, by + sin * d + cos * up];
  const hip = along(-4.2 - p.stretch * 0.6, -0.3);
  const chest = along(3.4 + p.stretch * 0.6, 0.5);
  const withers = along(4.4 + p.stretch * 0.6, -2.4);
  const hx = withers[0] + 1.6 + p.head[0];
  const hy = withers[1] - 3.6 + p.head[1];

  const frontLeg = (paw: Pt, root: Pt, st: PrimStyle, r: number): void => {
    const elbow: Pt = [root[0] - 0.3 + (paw[0] - root[0]) * 0.35, Math.min(root[1] + 2.3, paw[1] - 1.6)]; // never below the paw
    s.cap(root[0], root[1], elbow[0], elbow[1], r * 1.35, r * 0.85, st);
    s.cap(elbow[0], elbow[1], paw[0], paw[1] - 0.4, r * 0.85, r * 0.7, st);
  };
  const hindLeg = (paw: Pt, root: Pt, st: PrimStyle, r: number): void => {
    // stifle forward, hock back: the dog's zig-zag hind leg
    const stifle: Pt = [root[0] + 1.1 + (paw[0] - root[0]) * 0.35, root[1] + 2.2];
    const hock: Pt = [paw[0] - 1.1 + (stifle[0] - paw[0]) * 0.15, paw[1] - 2.3];
    s.cap(root[0], root[1], stifle[0], stifle[1], r * 1.5, r * 1, st);
    s.cap(stifle[0], stifle[1], hock[0], hock[1], r * 1, r * 0.7, st);
    s.cap(hock[0], hock[1], paw[0], paw[1] - 0.4, r * 0.7, r * 0.65, st);
  };

  // whip tail behind everything
  const rump = along(-6.6 - p.stretch * 0.6, -1.4);
  const tailMid: Pt = [rump[0] - 2.2, rump[1] + 0.8 + p.tail[1] * 0.35];
  const tip: Pt = [rump[0] + p.tail[0], rump[1] + p.tail[1]];
  s.cap(rump[0] + 0.5, rump[1], tailMid[0], tailMid[1], 0.9, 0.7, { ...hide, bias: -0.4 });
  s.cap(tailMid[0], tailMid[1], tip[0], tip[1], 0.7, 0.45, { ...hide, bias: -0.4 });
  // far legs
  hindLeg(p.fhl, along(-4.2 - p.stretch * 0.6, 1.2), far, 1);
  frontLeg(p.ffl, along(3.2 + p.stretch * 0.6, 2), far, 0.95);
  // body: haunch, tucked waist, deep chest, neck rising to the head
  s.ell(hip[0], hip[1], 3.3, 2.8, hide, p.tilt - 0.1);
  s.ell(bx, by - 0.4, 4.4, 1.9, hide, p.tilt);
  s.ell(chest[0], chest[1], 3.3, 3.5, hideLit, p.tilt + 0.1);
  s.cap(withers[0] - 0.5, withers[1] + 1.4, hx + 1.2, hy + 3.2, 2.1, 1.8, hideLit);
  // near legs over the body
  hindLeg(p.hl, along(-4.6 - p.stretch * 0.6, 1), leg, 1.05);
  frontLeg(p.fl, along(3.8 + p.stretch * 0.6, 2.2), { ...leg, bias: 0 }, 1);
  s.render(f.c, f.e);

  // head map on top
  stamp(f, p.jaw === 2 ? HEAD_WIDE : p.jaw === 1 ? HEAD_OPEN : HEAD, legend(p.glow), Math.round(hx), Math.round(hy));
  // two raked scars across the flank (pale healed skin)
  for (const [d, up] of [[-2.5, -0.6], [-1.5, 0.4], [-0.5, 1.4]] as const) on(f, ...along(d, up), C.skinShadow);
  for (const [d, up] of [[-1, -0.8], [0, 0.2]] as const) on(f, ...along(d, up), C.skin);
  // spiked iron collar round the neck: a cool band with a spike standing off the nape
  const c0: Pt = [Math.round(hx) + 0.2, Math.round(hy) + 4];
  for (let i = 0; i < 3; i++) on(f, c0[0] - i * 0.4, c0[1] + i, i === 0 ? C.metalHi : i === 1 ? C.metalLight : C.metalMid);
  put(f, c0[0] - 1, c0[1] - 1, C.metalLight);
  // paws: a pale claw tip on the near feet
  if (f.c.opaque(Math.round(p.fl[0]), Math.round(p.fl[1]))) put(f, p.fl[0] + 1, p.fl[1], C.ashGrey);
  if (f.c.opaque(Math.round(p.hl[0]), Math.round(p.hl[1]))) put(f, p.hl[0] + 1, p.hl[1], C.stone);
  const out = finish(f);
  const dy = Math.round(hy) + (p.jaw === 2 ? 8 : p.jaw === 1 ? 7 : 6);
  const drip = Math.min(p.drip, GROUND - 1 - dy); // never drips below the paws' ground line
  if (drip > 0) blood(out, Math.round(hx) + 4, dy, drip);
  return out;
}

// --- poses -------------------------------------------------------------------------------------------------------

const REST: P = {
  body: [11, 9.6],
  stretch: 0,
  tilt: 0.02,
  head: [0, 0],
  jaw: 0,
  tail: [-4.5, 2.6],
  fl: [16, FEET],
  ffl: [14.5, FEET - 1],
  hl: [6.5, FEET],
  fhl: [8, FEET - 1],
  glow: 0.7,
  drip: 1,
};
const pose = (o: Partial<P>): P => ({ ...REST, ...o });

/**
 * Rotary gallop, 6 frames. Each paw follows the same loop — plant, sweep back along the ground, lift and reach
 * forward — offset per leg; the spine stretches when the front reaches and the hind pushes, and gathers when
 * the paws pass under the belly.
 */
function gallop(i: number): P {
  const ph = i / 6;
  const foot = (restX: number, off: number, y0: number, reach: number): Pt => {
    const t = (ph + off) % 1;
    if (t < 0.5) return [restX + reach - (t / 0.5) * 2 * reach, y0];
    const u = (t - 0.5) / 0.5;
    return [restX - reach + u * 2 * reach, y0 - Math.sin(u * Math.PI) * 2.6];
  };
  const stretch = Math.cos(ph * Math.PI * 2) * 1.1;
  const bob = [-0.6, 0, 0.8, 0.4, -0.4, -0.8][i];
  return pose({
    body: [11, 9.6 + bob],
    stretch,
    tilt: [0, 0.03, 0.07, 0.08, 0.04, -0.02][i],
    head: [0.5, Math.round(bob * 0.5) + 1],
    fl: foot(16.5, 0, FEET, 3.2),
    ffl: foot(15, 0.1, FEET - 1, 3.2),
    hl: foot(6.5, 0.55, FEET, 3),
    fhl: foot(8, 0.65, FEET - 1, 3),
    tail: [-5, 1.2 + bob],
    glow: 0.8,
    drip: 0,
  });
}

export function pitHoundSprites(): SpriteDef[] {
  const idle = [0, 1, 2, 3].map((i) =>
    draw(
      pose({
        body: [11, 9.6 + [0, 0.3, 0.6, 0.3][i]],
        head: [0, [0, 0, 1, 0][i]],
        jaw: i === 0 ? 0 : 1, // panting
        tail: [-4.5 + [0, 0.4, 0.8, 0.4][i], 2.6 - [0, 0.5, 1, 0.5][i]],
        glow: [0.65, 0.75, 0.85, 0.75][i],
        drip: [1, 1, 2, 2][i],
      }),
    ),
  );
  const move = [0, 1, 2, 3, 4, 5].map((i) => draw(gallop(i)));
  // crouch: haunches drop, head sinks to the shoulders, jaws part, eye flares
  const crouch = (k: number, glow: number, jaw: 0 | 1 | 2): P =>
    pose({
      body: [10.5 - k * 0.6, 10 + k * 0.75],
      stretch: -0.4 * k,
      tilt: 0.06 + k * 0.06,
      head: [0.5, 1 + Math.round(k * 1.2)],
      jaw,
      fl: [16.5, FEET],
      ffl: [15, FEET - 1],
      hl: [6 - k * 0.5, FEET],
      fhl: [7.5 - k * 0.5, FEET - 1],
      tail: [-4, 3],
      glow,
      drip: 1,
    });
  const windup = [draw(crouch(0.5, 0.9, 1)), draw(crouch(1, 1, 2)), draw(crouch(1.1, 1, 2))];
  // lunge-bite: launched forward and up, jaws wide, then the snap and a bloody shake
  const attack = [
    draw(pose({ body: [12.5, 8.8], stretch: 1.4, tilt: -0.1, head: [1, -1], jaw: 2, fl: [21, FEET - 3], ffl: [20, FEET - 3.5], hl: [5, FEET], fhl: [6.5, FEET - 1], tail: [-5.5, 0], glow: 1, drip: 0 })),
    draw(pose({ body: [13, 9.6], stretch: 1, tilt: 0.06, head: [1, 1], jaw: 0, fl: [20, FEET], ffl: [19, FEET - 1], hl: [7, FEET], fhl: [8, FEET - 1], tail: [-5, 1], glow: 1, drip: 2 })),
    draw(pose({ body: [12.5, 9.8], stretch: 0.4, tilt: 0.05, head: [0.5, 1], jaw: 1, fl: [18, FEET], ffl: [16.5, FEET - 1], hl: [7, FEET], fhl: [8.5, FEET - 1], tail: [-4.5, 2], glow: 0.9, drip: 3 })),
  ];
  // collapse onto its side
  const lying = pose({ body: [11, 13.2], stretch: 0.6, tilt: 0.02, head: [1, 4], jaw: 1, fl: [18.5, FEET], ffl: [17, FEET], hl: [4.5, FEET], fhl: [6, FEET], tail: [-5, 2.5], glow: 0.25, drip: 0 });
  const down = draw(lying);
  const corpse = [
    draw(pose({ ...lying, body: [11, 11.2], head: [1, 1], glow: 0.45 })),
    ashify(squash(down, 0.8, GROUND - 1), 0.45, 0.4),
    ashify(squash(down, 0.62, GROUND - 1), 0.95, 0.15),
  ];
  return monsterSprites({
    id: 'pitHound',
    anchorX: 11 + OX,
    anchorY: GROUND,
    anims: {
      idle: anim(idle, 6, true),
      move: anim(move, 14, true),
      windup: anim(windup, 8, false),
      attack: anim(attack, 14, false),
      corpse: anim(corpse, 8, false),
    },
  });
}
