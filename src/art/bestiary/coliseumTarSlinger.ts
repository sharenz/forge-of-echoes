// Tar Slinger — support. A hunched arena labourer in a greasy leather cowl, face wrapped in rags with two ember eyes
// glinting through, a tar-black apron and forearms black with tar to the elbow. It lugs a dark-staved, iron-hooped
// bucket brimming with tar: a glossy black bulge over the rim, black runs down the staves, each catching one cold
// highlight, and a slow black drip. Its sling hangs from the near hand.
//
// windup: the sling dips into the bucket and comes up loaded, then whirls overhead — a pale blur ring with the black
// glob at its head (loops over the frames). attack: the lob — released forward-up, the arm following through.
// corpse: it pitches over, the bucket tips and the tar spreads into a black pool.
import type { SpriteDef } from '../../contracts/art';
import { Frame } from '../frame';
import { C, type Color, type Ramp } from '../palette';
import { Sculpt, type PrimStyle } from '../shade';
import { anim, ashify, finish, monsterSprites, squash, stamp, type Ink } from '../monsters/common';
import { LEATHER, TAR, limb, sole, on, put, smear, stroke, type Pt } from './coliseumKit';

const W = 26;
const H = 25;
const FEET = 21; // poses are authored with the feet on row 21; the frame adds OY rows of headroom for the whirl
const OY = 2;
const AX = 11;

const cowl: PrimStyle = { ramp: [C.ink, C.coal, C.woodDeep, C.woodDark, C.wood, C.woodLight], bias: 0.65, dither: 0.06 };
const skin: PrimStyle = { ramp: [C.ink, C.rustDeep, C.skinDeep, C.skinShadow], bias: -0.2, dither: 0.04 };
const skinFar: PrimStyle = { ramp: [C.ink, C.rustDeep, C.skinDeep, C.skinShadow], bias: -1.1, dither: 0 };
const tar: PrimStyle = { ramp: TAR, bias: 0.7, dither: 0.06 };
const tarArm: PrimStyle = { ramp: TAR, bias: 0.7, dither: 0 };
const tarArmFar: PrimStyle = { ramp: TAR, bias: -0.6, dither: 0 };
const legs: PrimStyle = { ramp: LEATHER, bias: 0.1, dither: 0 };
const legsFar: PrimStyle = { ramp: LEATHER, bias: -1.5, dither: 0 };
// dark tarred staves: no light or ochre wood tones (a lit bucket reads as a lantern)
const STAVE: Ramp = [C.woodDeep, C.woodDark, C.wood];
const wood: PrimStyle = { ramp: STAVE, bias: -0.1, dither: 0.04, cyl: 0.9 };
const tarTop: PrimStyle = { ramp: [C.ink, C.coal, C.metalDeep], bias: 0.2, dither: 0, ao: false };

// The upright bucket, 7x8, hand-placed so it reads at 1x: a glossy black tar bulge over the rim (one cold highlight),
// the rim with its iron hoop ends, dark staves (lit left, no ochre), two iron hoops, and two black tar runs down the
// staves, each catching one cold highlight at the lip.
const BUCKET = ['...kk..', '..kAkk.', 'mttttTm', '.WAwwB.', '.haHHb.', '.Wawdd.', '.Wwddd.', '.hHHHH.'];
const bucketInk: Record<string, Ink> = {
  k: C.ink,
  A: C.metalHi,
  B: C.metalLight,
  m: C.metalMid,
  t: C.ink,
  T: C.coal,
  W: C.wood,
  w: C.woodDark,
  d: C.woodDeep,
  a: C.ink,
  b: C.ink,
  h: C.metalMid,
  H: C.metal,
};

// Rag-wrapped face under the cowl lip, 4x3, facing east: two ember eyes through the slit.
const FACE = ['kkkk', 'rEkE', 'rrrk'];
function faceInk(glow: number): Record<string, Ink> {
  const g = 150 + 105 * Math.min(1, glow);
  return { k: C.coal, r: C.sandMid, E: { c: glow > 0.95 ? C.hot : C.flame, glow: g } };
}

interface P {
  bob: number;
  lean: number;
  footN: Pt;
  footF: Pt;
  handN: Pt; // sling hand
  pouch: Pt | null; // sling pouch (null = hanging slack below the hand)
  loaded: boolean; // tar glob in the pouch
  whirl: number | null; // angle of the pouch while whirling (draws the blur)
  bucket: Pt; // bucket rim centre
  bucketTip: number; // radians the bucket is tipped forward
  drip: number; // 0..1 drip progress under the bucket
  glow: number;
  pool: number; // spilled tar pool half width (corpse)
}

/** A glossy black glob of tar: 2x2 ink with one cold highlight. */
function glob(f: Frame, x: number, y: number): void {
  const X = Math.round(x);
  const Y = Math.round(y);
  put(f, X, Y, C.metalHi);
  put(f, X + 1, Y, C.ink);
  put(f, X, Y + 1, C.coal);
  put(f, X + 1, Y + 1, C.ink);
}

const down = (q: Pt): Pt => [q[0], q[1] + OY];

function draw(p0: P): Frame {
  const p: P = { ...p0, footN: down(p0.footN), footF: down(p0.footF), handN: down(p0.handN), pouch: p0.pouch && down(p0.pouch), bucket: down(p0.bucket) };
  const f = new Frame(W, H);
  const s = new Sculpt();
  const lean = p.lean;
  const ground = FEET + OY;
  const hip: Pt = [10.2 + lean * 0.3, OY + 14.2 + p.bob];
  const back: Pt = [10.8 + lean * 1.2, OY + 10.6 + p.bob + lean * 0.3];
  const head: Pt = [13.6 + lean * 1.6, OY + 6.4 + p.bob + lean * 0.9];
  const shN: Pt = [back[0] + 1.4, back[1] - 1];
  const shF: Pt = [back[0] + 0.2, back[1] - 1.4];
  const [bx, by] = p.bucket;

  // spilled tar pool on the ground (corpse)
  if (p.pool > 0) s.ell(bx + 1, ground - 0.2, p.pool, Math.max(0.8, p.pool * 0.28), { ...tar, bias: 0.4, ao: false });
  // far arm gripping the bucket's rim (tar-black forearm), far leg
  const handle: Pt = [bx - 2.4 * Math.cos(p.bucketTip), by - 0.8 - 2.4 * Math.sin(p.bucketTip)];
  limb(s, shF, handle, -1, 0.9, 0.8, 0.7, skinFar, tarArmFar);
  limb(s, [hip[0] - 0.8, hip[1] + 0.8], sole(p.footF, 0.9), 1.3, 1.3, 1, 0.9, legsFar);
  // near leg
  limb(s, [hip[0] + 0.6, hip[1] + 1], sole(p.footN, 1), 1.4, 1.4, 1.1, 1, legs);
  // hunched body in the cowl's cape, tar-black apron over the front
  s.ell((hip[0] + back[0]) / 2, (hip[1] + back[1]) / 2 + 0.4, 2.8, 3, cowl, 0.3);
  s.ell(back[0] - 0.3, back[1], 3.4, 2.8, { ...cowl, bias: 0.1 }, 0.5);
  s.poly([[back[0] + 0.6, back[1] - 0.6], [back[0] + 3, back[1] + 0.6], [hip[0] + 3.2, hip[1] + 2.6], [hip[0] + 0.4, hip[1] + 3.2], [hip[0] - 0.4, hip[1]]], tar, 1);
  // hood: rounded crown, a peak trailing back, a lip over the face
  s.poly([[head[0] - 2.8, head[1] - 0.6], [head[0] - 4.6, head[1] - 1.8], [head[0] - 2.4, head[1] + 2.4]], { ...cowl, bias: -0.1 }, 1);
  s.ell(head[0], head[1], 3.2, 3, { ...cowl, bias: 0.5 });
  // bucket: upright it is the hand-placed map (stamped below); tipped over (corpse) it is shaded staves
  const tipped = Math.abs(p.bucketTip) > 0.4;
  const cos = Math.cos(p.bucketTip);
  const sin = Math.sin(p.bucketTip);
  const bp = (u: number, v: number): Pt => [bx + u * cos - v * sin, by + u * sin + v * cos];
  const bucketIdx = s.size;
  if (tipped) {
    s.poly([bp(-3, 0), bp(3, 0), bp(2.4, 5.4), bp(-2.4, 5.4)], wood, 1.2);
    s.ell(bx, by + 0.2, 2.7, 1.1, tarTop, p.bucketTip);
  }
  // near arm (the sling hand): tar-black forearm
  const eN = limb(s, shN, p.handN, -1.2, 1, 0.85, 0.8, skin, tarArm);
  const owner = s.render(f.c, f.e);
  const own = (x: number, y: number): number => (x < 0 || y < 0 || x >= W || y >= H ? -1 : owner[Math.round(y) * W + Math.round(x)]);

  const bx0 = Math.round(bx) - 3 + (p.bucketTip > 0.07 ? 1 : p.bucketTip < -0.07 ? -1 : 0);
  const by0 = Math.round(by) - 2;
  if (!tipped) stamp(f, BUCKET, bucketInk, bx0, by0);
  else {
    // tipped: an iron hoop round the staves, tar spilling from the mouth
    for (let u = -2.8; u <= 2.8; u += 0.5) {
      const [x, y] = bp(u, 3.6);
      if (own(x, y) === bucketIdx) put(f, x, y, u < -2 ? C.metalMid : C.metal);
    }
    const [mx, my] = bp(0, -0.4);
    put(f, mx, my, C.metalHi);
  }
  // sheen on the apron, a cold highlight on each tarred forearm
  on(f, back[0] + 1.8, back[1] + 1.2, C.metalMid);
  const fa: Pt = [(eN[0] + p.handN[0]) / 2, (eN[1] + p.handN[1]) / 2 - 0.4];
  if (own(fa[0], fa[1]) >= 0) put(f, fa[0], fa[1], C.metalLight);
  // feet wrapped in dark rags
  put(f, p.footN[0] + 1, p.footN[1], C.woodDeep);
  put(f, p.footF[0] + 1, p.footF[1], C.coal);
  // face
  stamp(f, FACE, faceInk(p.glow), Math.round(head[0] - 0.4), Math.round(head[1]));
  on(f, head[0] - 1.6, head[1] - 2, C.woodHi);

  // the sling: two leather cords from the hand to the pouch
  const pouch: Pt = p.pouch ?? [p.handN[0] + 0.4, p.handN[1] + 3.6];
  stroke(f, p.handN, pouch, () => C.woodDark);
  if (p.loaded) glob(f, pouch[0], pouch[1]);
  else put(f, pouch[0], pouch[1], C.wood);
  put(f, p.handN[0], p.handN[1], C.metal);

  const out = finish(f);
  // a 2 px drop of tar falling from the bucket's foot (after the outline: it's a free drop)
  if (p.drip > 0 && !tipped) {
    const dx = bx0 + 2;
    const dy = by0 + 8;
    const y = Math.round(dy + p.drip * (ground - dy - 2));
    const col: Color[] = [C.metalLight, C.ink];
    for (let i = 0; i < 2; i++) if (y + i < ground) out.c.set(Math.round(dx), y + i, col[i]);
  }
  if (p.whirl !== null) {
    // the sling's blur ring over the head (pale, so it reads against the dark cowl and the sand alike)
    smear(out, p.handN[0], p.handN[1] - 0.6, 5.2, 2.1, p.whirl - 2.7, p.whirl - 0.35, C.metalLight, 0.95, 0, 2);
    if (p.loaded && p.pouch) glob(out, pouch[0], pouch[1]);
  }
  return out;
}

// --- poses -------------------------------------------------------------------------------------------------------

const REST: P = {
  bob: 0,
  lean: 0,
  footN: [12, FEET],
  footF: [8.5, FEET],
  handN: [12.6, 12.8],
  pouch: null,
  loaded: false,
  whirl: null,
  bucket: [17.4, 12],
  bucketTip: 0,
  drip: 0,
  glow: 0.7,
  pool: 0,
};
const pose = (o: Partial<P>): P => ({ ...REST, ...o });

export function tarSlingerSprites(): SpriteDef[] {
  const idle = [0, 1, 2, 3].map((i) => {
    const b = [0, 0.4, 0.8, 0.4][i];
    return draw(pose({ bob: b, bucket: [17.4, 12 + b * 0.5], bucketTip: [0, 0.05, 0, -0.05][i], handN: [12.6, 12.8 + b], drip: [0.1, 0.4, 0.7, 1][i], glow: [0.6, 0.7, 0.85, 0.7][i] }));
  });
  // a hunched waddle, the bucket swinging: each foot slides back planted and swings forward lifted (6 distinct poses)
  const move = [0, 1, 2, 3, 4, 5].map((i) => {
    const ph = (i / 6) * Math.PI * 2;
    const c = Math.cos(ph);
    const s = Math.sin(ph);
    const b = Math.abs(c) * 0.8 - 0.2;
    return draw(
      pose({
        bob: b,
        lean: 0.5,
        footN: [10.5 + c * 3.2, FEET - Math.max(0, -s) * 2],
        footF: [10 - c * 3.2, FEET - Math.max(0, s) * 2],
        bucket: [17.6 - c * 0.5, 12.2 + b * 0.6],
        bucketTip: -Math.sin(ph - 0.8) * 0.14,
        handN: [12.8 - c * 1.2, 13 + b],
        drip: ((i / 6) * 2) % 1,
        glow: 0.75,
      }),
    );
  });
  // windup: dip the sling in the bucket, then whirl it overhead, loaded
  const spin = (a: number, glow: number): P => {
    const hand: Pt = [13, 3];
    return pose({ lean: -0.2, bob: -0.3, handN: hand, pouch: [hand[0] + Math.cos(a) * 5, hand[1] - 0.6 + Math.sin(a) * 2], loaded: true, whirl: a, glow });
  };
  const windup = [
    draw(pose({ lean: 0.8, bob: 0.6, handN: [16.4, 12.4], pouch: [17, 12.4], loaded: true, glow: 0.8 })),
    draw(spin(Math.PI, 0.9)),
    draw(spin(Math.PI * 1.5, 1)),
    draw(spin(0, 1)),
    draw(spin(Math.PI * 0.5, 1)),
  ];
  // the lob: released forward-up, follow through
  const attack = [
    draw(pose({ lean: 0.9, handN: [17.5, 5.5], pouch: [21, 2.5], loaded: false, glow: 1 })),
    draw(pose({ lean: 1.2, handN: [18, 9], pouch: [20.5, 12], loaded: false, glow: 0.9 })),
    draw(pose({ lean: 0.8, handN: [16, 12], pouch: [17, 15.5], loaded: false, glow: 0.8 })),
  ];
  // corpse: pitches forward, the bucket tips and the tar spreads
  const fallen = pose({ bob: 5.5, lean: 2, footN: [11, FEET], footF: [7.5, FEET], handN: [18, FEET - 1], bucket: [19, FEET - 3.5], bucketTip: 1.35, glow: 0.2, pool: 5 });
  const fell = draw(fallen);
  const corpse = [
    draw(pose({ bob: 3, lean: 1.5, footN: [11.5, FEET], footF: [8, FEET], handN: [17, FEET - 3], bucket: [18, FEET - 5], bucketTip: 0.8, glow: 0.45, pool: 2.5 })),
    ashify(squash(fell, 0.75, FEET + OY), 0.4, 0.4),
    ashify(squash(fell, 0.55, FEET + OY), 0.85, 0.15),
  ];
  return monsterSprites({
    id: 'tarSlinger',
    anchorX: AX,
    anchorY: FEET + OY + 1,
    anims: {
      idle: anim(idle, 5, true),
      move: anim(move, 9, true),
      windup: anim(windup, 9, false),
      attack: anim(attack, 12, false),
      corpse: anim(corpse, 7, false),
    },
  });
}
