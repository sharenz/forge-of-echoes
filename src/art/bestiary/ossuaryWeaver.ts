// Frost Weaver — the Ossuary artillery. A spindly bone spider: eight long pale legs rising to knees high above a
// small skull-like cephalothorax, and a ribbed bone abdomen studded with translucent ice sacs that glow frost-blue
// from inside. Much taller and more open than the Ember Skitter (a harvestman, not a crab), so the two spiders never
// read alike.
//
// The web shot is telegraphed by the whole body — the web-spinner pose: the abdomen swings up and over the back
// until its spinnerets aim forward over the head, the front legs lift and the ice sacs flare; the attack jerks the
// abdomen forward and the spinnerets flash as the web strand leaves.
import type { SpriteDef } from '../../contracts/art';
import { Frame } from '../frame';
import { C, type Color } from '../palette';
import { Sculpt, type PrimStyle } from '../shade';
import { anim, finish, monsterSprites, onBody, squash, strokeLine } from '../monsters/common';
import { BONE, COLD_WHITE, rimeify } from './ossuaryKit';

const W = 40;
const H = 28;
const FEET = 26;
const BX = 21;
const BY = 18;

const shell: PrimStyle = { ramp: BONE, bias: -0.3, dither: 0.08 };
const headStyle: PrimStyle = { ramp: BONE, bias: 0.7, dither: 0 };
const abdo: PrimStyle = { ramp: BONE, bias: -0.35, dither: 0 };
const sacStyle = (k: number): PrimStyle => ({ ramp: [C.frostMid, C.mana, C.frost, C.ice, COLD_WHITE], bias: 0.1 + k * 0.9, glow: 130 + 110 * Math.min(1, k), ao: false, dither: 0.1 });

type Pt = [number, number];
interface Leg {
  at: Pt; // on the cephalothorax, relative to its centre
  knee: Pt; // relative to the cephalothorax centre
  foot: Pt; // rest position: x relative to the cephalothorax centre, y absolute
  front: number; // 0 = rearmost … 3 = front pair
  far: boolean;
  groupA: boolean;
}

// Near legs (the far set reuses them pulled in and higher). Knees arch well above the body.
const NEAR: Omit<Leg, 'far' | 'groupA'>[] = [
  { at: [-1.5, 1], knee: [-10.5, -8.5], foot: [-19, FEET], front: 0 },
  { at: [-0.5, 1.5], knee: [-5.5, -10], foot: [-10.5, FEET], front: 1 },
  { at: [1, 1.5], knee: [6.5, -10], foot: [9, FEET], front: 2 },
  { at: [2, 1], knee: [12, -8.5], foot: [18, FEET], front: 3 },
];
const LEGS: Leg[] = [
  ...NEAR.map((l, i) => ({ ...l, far: true, groupA: i % 2 === 1 })),
  ...NEAR.map((l, i) => ({ ...l, far: false, groupA: i % 2 === 0 })),
];

interface P {
  body: Pt; // cephalothorax centre
  abd: number; // abdomen angle around the pedicel (radians, 0 = east, y down); rest ≈ π + 0.3
  step: number; // gait phase 0..1, -1 = standing
  rear: number; // front legs lift (windup)
  sac: number; // ice sac glow 0..1.3
  flash: number; // spinneret flash 0..1 (attack)
  strand: number; // web strand length leaving the spinnerets
  curl: number; // corpse: legs fold in
}
const REST = Math.PI + 0.3;
const base: P = { body: [BX, BY], abd: REST, step: -1, rear: 0, sac: 0.8, flash: 0, strand: 0, curl: 0 };
const pose = (p: Partial<P>): P => ({ ...base, ...p });

function draw(p: P): Frame {
  const f = new Frame(W, H);
  const [bx, by] = p.body;

  const legPts = (leg: Leg): { a: Pt; k: Pt; ft: Pt } => {
    const pull = leg.far ? 0.72 : 1;
    const ph = p.step < 0 ? 0 : leg.groupA ? p.step : (p.step + 0.5) % 1;
    const stride = p.step < 0 ? 0 : 2;
    const along = ph < 0.5 ? stride - ph * 4 * stride : -stride + (ph - 0.5) * 4 * stride;
    const lift = p.step < 0 || ph < 0.5 ? 0 : Math.sin((ph - 0.5) * 2 * Math.PI) * 2.5;
    const up = leg.front === 3 ? p.rear * 8 : leg.front === 2 ? p.rear * 3.5 : 0;
    const fwd = leg.front === 3 ? p.rear * 2 : 0;
    const a: Pt = [bx + leg.at[0], by + leg.at[1] - (leg.far ? 1 : 0)];
    let k: Pt = [bx + leg.knee[0] * pull + along * 0.4 + fwd * 0.6, by + leg.knee[1] * pull - (leg.far ? 1.5 : 0) - lift * 0.5 - up * 0.7];
    let ft: Pt = [bx + leg.foot[0] * pull + along + fwd, leg.foot[1] - (leg.far ? 2 : 0) - lift - up];
    if (p.curl > 0) {
      ft = [a[0] + (ft[0] - a[0]) * (1 - p.curl * 0.7), Math.min(FEET, a[1] + 2 + (1 - p.curl) * 6)];
      k = [a[0] + (k[0] - a[0]) * 0.55, a[1] - 4 * p.curl];
    }
    return { a, k, ft };
  };
  const drawLeg = (leg: Leg): void => {
    const { a, k, ft } = legPts(leg);
    const upper: Color = leg.far ? C.ossMid : C.ashGrey;
    const lower: Color = leg.far ? C.ossDark : C.hairMid;
    strokeLine(f, a, k, () => upper);
    strokeLine(f, k, ft, (t) => (t > 0.85 ? (leg.far ? C.ossMid : C.bone) : lower));
    f.c.set(Math.round(k[0]), Math.round(k[1]), leg.far ? C.hairShadow : C.parchment);
  };

  // far legs, then the body, then the near legs on top
  for (const leg of LEGS) if (leg.far) drawLeg(leg);

  const body = new Frame(W, H);
  const s = new Sculpt();
  // abdomen swinging around the pedicel; ice sacs ride on it
  const pedX = bx - 2.6;
  const pedY = by - 0.6;
  const R = 6.4;
  const ax = pedX + Math.cos(p.abd) * R;
  const ay = pedY + Math.sin(p.abd) * R;
  const rot = p.abd - Math.PI; // 0 at rest (pointing back)
  const local = (u: number, v: number): Pt => {
    // u along the abdomen (+ = towards the spinnerets), v across (+ = its underside)
    const c = Math.cos(p.abd);
    const sn = Math.sin(p.abd);
    return [ax + c * u - sn * v, ay + sn * u + c * v];
  };
  s.ell(ax, ay, 5.8, 4.4, abdo, rot);
  const sacs: [number, number, number][] = [[-1.4, -1.3, 2.4], [2.6, -0.9, 1.8]];
  for (const [u, v, r] of sacs) {
    const [sx, sy] = local(u, -v);
    s.ell(sx, sy, r, r * 0.9, sacStyle(p.sac));
  }
  // cephalothorax and the skull-like head
  s.ell(bx, by, 3.4, 2.6, shell);
  s.render(body.c, body.e);
  // segment bands: three ink rings across the abdomen between the sacs, and a vertebra ridge along its back
  for (const u of [-4, -0.1, 3.9]) {
    for (let v = -4.5; v <= 4.5; v += 0.4) {
      const [x, y] = local(u + v * 0.12, v);
      const X = Math.round(x);
      const Y = Math.round(y);
      if (body.c.opaque(X, Y) && !body.e.opaque(X, Y)) body.c.set(X, Y, C.ossDeep);
    }
  }
  for (let u = -4.8; u <= 4.6; u += 1.2) {
    const [x, y] = local(u, 3.7);
    const X = Math.round(x);
    const Y = Math.round(y);
    if (body.c.opaque(X, Y) && !body.e.opaque(X, Y)) body.c.set(X, Y, Math.round((u + 4.8) / 1.2) % 2 ? C.hairShadow : C.parchment);
  }
  // spinnerets at the abdomen tip
  const [tx, ty] = local(6.1, 0);
  const tipGlow = 150 + 105 * Math.min(1, p.flash + p.sac * 0.3);
  body.glow(Math.round(tx), Math.round(ty), p.flash > 0.5 ? COLD_WHITE : C.frost, tipGlow);
  f.draw(body, 0, 0);

  for (const leg of LEGS) if (!leg.far) drawLeg(leg);
  // the skull-like head sits over the roots of the front legs
  const head = new Frame(W, H);
  new Sculpt().ell(bx + 4.2, by + 0.3, 3, 2.5, headStyle).render(head.c, head.e);
  f.draw(head, 0, 0);

  // skull face: a brow ridge, two ink sockets with ice glints, a nasal hollow and a notched jaw with bone fangs
  const hx = Math.round(bx + 5);
  const hy = Math.round(by);
  const bright = p.sac > 0.95;
  for (const [dx, dy] of [[-1, -1], [-1, 0], [0, 0], [2, -1], [2, 0], [1, 1]] as const) onBody(f, hx + dx, hy + dy, C.ink);
  onBody(f, hx - 1, hy - 2, C.parchment);
  onBody(f, hx, hy - 2, C.parchment);
  onBody(f, hx + 1, hy - 2, C.bone);
  f.glow(hx, hy - 1, bright ? COLD_WHITE : C.ice, 255);
  f.glow(hx + 2, hy - 1, C.frost, 220);
  onBody(f, hx + 2, hy + 1, C.ink); // jaw notch
  f.c.set(hx + 3, hy + 2, C.bone);
  f.c.set(hx + 3, hy + 1, C.ashGrey);
  f.c.set(hx + 1, hy + 2, C.bone);
  f.c.set(hx + 1, hy + 3, C.ashGrey);
  // the web strand leaving the spinnerets
  if (p.strand > 0) {
    const dx = 1;
    const dy = -0.35;
    for (let i = 1; i <= p.strand; i++) {
      const X = Math.round(tx + dx * i);
      const Y = Math.round(ty + dy * i);
      f.glow(X, Y, i < 2 ? COLD_WHITE : i < p.strand - 1 ? C.ice : C.frost, 255 - i * 12);
    }
  }
  if (p.flash > 0) {
    for (const [dx, dy, c] of [[1, 0, C.ice], [-1, 0, C.frost], [0, -1, C.ice], [0, 1, C.frost], [1, -1, C.frost]] as const) {
      f.glow(Math.round(tx) + dx, Math.round(ty) + dy, c, 230 * p.flash);
    }
  }
  return finish(f);
}

export function frostWeaverSprites(): SpriteDef[] {
  const idle = [0, 1, 2, 3].map((i) =>
    draw(pose({ body: [BX, BY + (i === 2 ? 1 : 0)], abd: REST + [0, 0.05, 0.1, 0.05][i], sac: [0.65, 0.8, 1, 0.8][i] })),
  );
  const move = [0, 1, 2, 3, 4, 5].map((i) => draw(pose({ step: i / 6, body: [BX, BY + [0, 1, 0, 0, 1, 0][i]], abd: REST + [0, 0.08, 0.04, 0, 0.08, 0.04][i], sac: 0.85 })));
  // web-spinner pose: the abdomen swings up over the back until the spinnerets aim forward, front legs lift
  const windup = [
    draw(pose({ body: [20, 19], abd: -Math.PI * 0.85, rear: 0.4, sac: 0.95 })),
    draw(pose({ body: [19, 19], abd: -Math.PI * 0.62, rear: 0.9, sac: 1.15 })),
    draw(pose({ body: [19, 19], abd: -Math.PI * 0.56, rear: 1, sac: 1.3, flash: 0.3 })),
  ];
  const attack = [
    draw(pose({ body: [20, 18], abd: -Math.PI * 0.4, rear: 0.7, sac: 1.2, flash: 1, strand: 7 })),
    draw(pose({ body: [20, 18], abd: -Math.PI * 0.5, rear: 0.5, sac: 1, flash: 0.4, strand: 3 })),
    draw(pose({ body: [21, 18], abd: -Math.PI * 0.8, rear: 0.2, sac: 0.85 })),
  ];
  const dead = draw(pose({ body: [20, 22], abd: REST + 0.25, curl: 1, sac: 0.25 }));
  const corpse = [
    draw(pose({ body: [20, 19], abd: REST + 0.15, curl: 0.5, sac: 0.5 })),
    // legs fold and the husk sinks flat into the rime (as low as the forge corpses)
    rimeify(squash(dead, 0.8, FEET), 0.45, 0.45),
    rimeify(squash(dead, 0.55, FEET), 0.95, 0.15),
  ];
  return monsterSprites({
    id: 'frostWeaver',
    anchorX: BX - 1,
    anchorY: FEET + 1,
    anims: {
      idle: anim(idle, 5, true),
      move: anim(move, 12, true),
      windup: anim(windup, 6, false),
      attack: anim(attack, 12, false),
      corpse: anim(corpse, 8, false),
    },
  });
}

