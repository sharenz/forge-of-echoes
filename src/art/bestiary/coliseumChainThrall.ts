// Chain Thrall — hunter. A gaunt, hunched prisoner of the pits: sallow skin stretched over ribs and a curved spine,
// a filthy loincloth, iron manacles and a heavy iron collar with a broken chain end. A branded ember mark smoulders on
// its chest and an ember pinprick burns in a hollow eye socket. Its weapon is on a chain: a barbed iron hook
// dangling from the near hand, the rest of the chain wound round the far forearm.
//
// windup: the hook whirls overhead on a short length of chain (the telegraph; loops). throw: the arm whips forward
// and the hook is gone — only the first links pay out of the fist, blurred; the chainHook projectile and fx/chain draw
// the real line in its true direction. attack: a short melee rake with the hook.
import type { SpriteDef } from '../../contracts/art';
import { Frame } from '../frame';
import { C } from '../palette';
import { Sculpt, type PrimStyle } from '../shade';
import { anim, ashify, finish, monsterSprites, squash, stamp, type Ink } from '../monsters/common';
import { RAG, SALLOW, chain, dust, limb, on, put, sagPt, smear, type Pt } from './coliseumKit';

const W = 30;
const H = 25;
const FEET = 21; // poses are authored with the feet on row 21; the frame adds OY rows of headroom above
const OY = 2;
const AX = 11;

const skin: PrimStyle = { ramp: SALLOW, bias: -0.7, dither: 0.05 };
const leg: PrimStyle = { ramp: SALLOW, bias: -0.35, dither: 0 };
const skinLit: PrimStyle = { ramp: SALLOW, bias: -0.55, dither: 0.05 };
const skinFar: PrimStyle = { ramp: SALLOW, bias: -1.7, dither: 0 };
const rag: PrimStyle = { ramp: RAG, bias: -0.4, dither: 0.06 };

// Bald, gaunt head, 5x5, facing east: lit crown top-left, a hollow socket with an ember pinprick, a sunken cheek
// and a narrow jaw.
const HEAD = ['.LLl.', 'LLlls', 'lsKEs', '.sdsd', '..dd.'];
const HEAD_SNARL = ['.LLl.', 'LLlls', 'lsKEs', '.sdKK', '..dK.'];

function legend(glow: number): Record<string, Ink> {
  return {
    L: C.bone,
    l: C.ashGrey,
    s: C.skinShadow,
    d: C.skinDeep,
    K: C.rustDeep,
    E: { c: glow > 0.95 ? C.hot : C.flame, glow: 150 + 105 * Math.min(1, glow) },
  };
}

// Whirl radius of the hook over the head (x, y)
const WR = 6.2;
const WRY = 2.1;

// Barbed hook, hanging: shank down from the chain, the point curling up to the east.
const HOOK = ['M..', 'm..', 'm.h', 'mmd'];
// Hook swung forward / in flight: shank pointing east, the barb curling back.
const HOOK_FLY = ['..h', 'Mmm', '..d'];
const hookInk: Record<string, Ink> = { M: C.metalHi, m: C.metalLight, h: C.metalHi, d: C.metalMid };

interface P {
  bob: number;
  lean: number; // + = forward
  footN: Pt; // absolute
  footF: Pt;
  handN: Pt; // near hand (holds the hook chain)
  handF: Pt; // far hand
  hook: Pt | null; // top of the hook (where the chain attaches); null = thrown
  hookFly: boolean;
  line: Pt | null; // thrown chain end (past the frame edge)
  swing: number; // broken collar chain swing (-1..1)
  whirl: number | null; // hook angle while whirling (draws the chain blur behind it)
  glow: number;
  snarl: boolean;
  dust: boolean;
}

const down = (q: Pt): Pt => [q[0], q[1] + OY];

function draw(p0: P): Frame {
  const p: P = { ...p0, footN: down(p0.footN), footF: down(p0.footF), handN: down(p0.handN), handF: down(p0.handF), hook: p0.hook && down(p0.hook), line: p0.line && down(p0.line) };
  const f = new Frame(W, H);
  const s = new Sculpt();
  const lean = p.lean;
  const hip: Pt = [10.4 + lean * 0.3, OY + 13.4 + p.bob];
  const back: Pt = [11.2 + lean * 1.1, OY + 9.6 + p.bob + lean * 0.3];
  const head: Pt = [14.6 + lean * 1.6, OY + 4 + p.bob + lean * 0.9];
  const shN: Pt = [back[0] + 1.6, back[1] - 0.6];
  const shF: Pt = [back[0] + 0.2, back[1] - 1];

  // far arm and far leg (dark, behind)
  limb(s, shF, p.handF, -1.3, 0.9, 0.75, 0.7, skinFar);
  limb(s, [hip[0] - 0.6, hip[1] + 0.6], p.footF, 1.3, 1.1, 0.8, 0.7, skinFar);
  // near leg, knees bent
  limb(s, [hip[0] + 0.6, hip[1] + 0.8], p.footN, 1.5, 1.2, 0.85, 0.75, leg);
  // hunched torso: pinched waist, curved back, hump of the shoulders thrust forward
  s.ell((hip[0] + back[0]) / 2 + 0.2, (hip[1] + back[1]) / 2, 1.9, 2.6, skin, 0.35 + lean * 0.1);
  s.ell(back[0], back[1], 2.6, 2.1, skinLit, 0.5 + lean * 0.15);
  // loincloth, ragged hem
  s.poly(
    [
      [hip[0] - 2.2, hip[1] - 1],
      [hip[0] + 2.2, hip[1] - 1.2],
      [hip[0] + 2.4, hip[1] + 2],
      [hip[0] + 1.2, hip[1] + 3],
      [hip[0] + 0.2, hip[1] + 2.2],
      [hip[0] - 1, hip[1] + 3.2],
      [hip[0] - 2.4, hip[1] + 1.8],
    ],
    rag,
    1,
  );
  // neck thrust forward
  s.cap(back[0] + 1.4, back[1] - 1.2, head[0] - 0.4, head[1] + 3.4, 0.9, 0.8, skin);
  // near arm over the body
  limb(s, shN, p.handN, -1.5, 1, 0.8, 0.75, skinLit);
  s.render(f.c, f.e);

  // ribs and spine knuckles
  for (let i = 0; i < 2; i++) on(f, back[0] + 0.6, back[1] + 1 + i * 1.3, C.skinDeep);
  on(f, back[0] - 1.6, back[1] - 0.2, C.ashGrey);
  on(f, back[0] - 1.9, back[1] + 1, C.skinShadow);
  // iron manacles: the near wrist, and chain wound round the far forearm
  const at = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const wN = at(shN, p.handN, 0.8);
  on(f, wN[0], wN[1], C.metalHi);
  on(f, wN[0] - 1, wN[1], C.metalMid);
  const wF = at(shF, p.handF, 0.8);
  on(f, wF[0], wF[1], C.metalMid);
  on(f, p.footN[0], p.footN[1] - 2, C.metalMid);
  // feet: dark soles
  put(f, p.footN[0] + 1, p.footN[1], C.skinDeep);
  put(f, p.footF[0] + 1, p.footF[1], C.rustDeep);

  // head and heavy iron collar
  const hx = Math.round(head[0] - 2.5);
  const hy = Math.round(head[1]);
  stamp(f, p.snarl ? HEAD_SNARL : HEAD, legend(p.glow), hx, hy);
  // a heavy iron collar round the base of the neck: a 3 px lit band over a dark underside, a broken chain stub
  // hanging from its ring at the nape
  const nb: Pt = [Math.round(back[0] + 1.4 + (head[0] - 0.4 - back[0] - 1.4) * 0.45), Math.round(back[1] - 1.2 + (head[1] + 3.4 - back[1] + 1.2) * 0.45)];
  // (blackened iron, so it reads against the pale sallow skin: a dark band, one lit rivet, a lit top edge)
  put(f, nb[0] - 1, nb[1] - 1, C.metalMid);
  put(f, nb[0], nb[1] - 1, C.metalLight);
  put(f, nb[0] + 1, nb[1] - 1, C.metalMid);
  put(f, nb[0] - 2, nb[1], C.metalDark);
  put(f, nb[0] - 1, nb[1], C.metal);
  put(f, nb[0], nb[1], C.metalHi);
  put(f, nb[0] + 1, nb[1], C.metalDark);
  put(f, nb[0] + 2, nb[1], C.metalDeep);
  put(f, nb[0] - 1, nb[1] + 1, C.metalDeep);
  put(f, nb[0], nb[1] + 1, C.metalDark);
  put(f, nb[0] + 1, nb[1] + 1, C.metalDeep);
  const sw = Math.round(p.swing * 0.8);
  put(f, nb[0] - 3, nb[1] + 1, C.metalLight);
  put(f, nb[0] - 3 + (sw < 0 ? -1 : 0), nb[1] + 2, C.metalDark);
  put(f, nb[0] - 3 + sw, nb[1] + 3, C.metalMid);

  // the branded ember mark on the chest (drawn last on the torso, so it never drops out)
  f.glow(Math.round(back[0] + 0.6), Math.round(back[1] + 1.6), C.ember, 150 + 80 * p.glow);
  // the coil of spare chain in the far hand, hanging behind the body
  const [cx, cy] = p.handF;
  chain(f, (t) => [cx - Math.sin(t * Math.PI) * 1.4 + t * 0.6, cy + Math.sin(t * Math.PI * 0.5) * 3.2], 0, C.metalLight, C.metalMid, C.metalDark, true);
  chain(f, (t) => [cx + 0.4 + Math.sin(t * Math.PI) * 1.2, cy + 0.6 + t * 2.4], 2, C.metalMid, C.metalLight, C.metalDark, true);
  if (p.line) chain(f, (t) => sagPt(p.handN, p.line as Pt, 0.3, t), 0, C.metalHi, C.metalLight, C.metalMid);
  if (p.hook) {
    const k = p.hook;
    chain(f, (t) => [p.handN[0] + (k[0] - p.handN[0]) * t, p.handN[1] + (k[1] - p.handN[1]) * t], 0, C.metalHi, C.metalLight, C.metalMid);
    if (p.hookFly) stamp(f, HOOK_FLY, hookInk, Math.round(k[0]) - 1, Math.round(k[1]) - 1);
    else stamp(f, HOOK, hookInk, Math.round(k[0]), Math.round(k[1]));
  }
  // knuckles over the chain
  put(f, p.handN[0], p.handN[1], C.ashGrey);
  const out = finish(f);
  if (p.line) {
    // the chain paying out of the fist: a short bright smear past the last link
    const [lx, ly] = p.line;
    const dx = lx - p.handN[0];
    const dy = ly - p.handN[1];
    const n = Math.hypot(dx, dy) || 1;
    for (let i = 1; i <= 4; i++) out.c.plot(Math.round(lx + (dx / n) * i), Math.round(ly + (dy / n) * i), C.metalHi, 0.85 - i * 0.17);
  }
  if (p.dust) dust(out, p.footN[0] + 1, FEET + OY, 3);
  if (p.whirl !== null) {
    // the blur of the spinning chain around the raised hand
    const [wx, wy] = p.handN;
    smear(out, wx, wy - 0.5, WR + 0.8, WRY + 0.4, p.whirl - 2.6, p.whirl - 0.25, C.metalHi, 1, 0, 2);
  }
  return out;
}

// --- poses -------------------------------------------------------------------------------------------------------

const REST: P = {
  bob: 0,
  lean: 0,
  footN: [12.5, FEET],
  footF: [8.5, FEET],
  handN: [16, 13],
  handF: [8, 14],
  hook: [16, 14],
  hookFly: false,
  line: null,
  swing: 0,
  whirl: null,
  glow: 0.7,
  snarl: false,
  dust: false,
};
const pose = (o: Partial<P>): P => ({ ...REST, ...o });

export function chainThrallSprites(): SpriteDef[] {
  // idle: shallow ragged breathing, the hook swaying on its chain
  const idle = [0, 1, 2, 3].map((i) => {
    const b = [0, 0.4, 0.8, 0.4][i];
    const sway = [0, 0.7, 0, -0.7][i];
    return draw(pose({ bob: b, handN: [16, 13 + b], handF: [8, 14 + b], hook: [16 + sway, 14 + b * 0.5], swing: sway * 0.6, glow: [0.6, 0.7, 0.85, 0.7][i] }));
  });
  // move: a quick hunched lope
  // a quick hunched lope: each foot slides back while planted and swings forward lifted, so all six poses differ
  const move = [0, 1, 2, 3, 4, 5].map((i) => {
    const ph = (i / 6) * Math.PI * 2;
    const c = Math.cos(ph);
    const s = Math.sin(ph);
    const b = Math.abs(c) * 0.9 - 0.3;
    return draw(
      pose({
        bob: b,
        lean: 0.8 + Math.abs(c) * 0.3,
        footN: [11 + c * 3.4, FEET - Math.max(0, -s) * 2],
        footF: [9.5 - c * 3.4, FEET - Math.max(0, s) * 2],
        handN: [16.5 - c * 1.1, 13 + b],
        handF: [8.5 + c * 1.5, 14 + b],
        hook: [15.8 - Math.cos(ph - 0.9) * 1.6, 14.2 + b * 0.5],
        swing: -Math.cos(ph - 0.9),
        glow: 0.75,
      }),
    );
  });
  // windup: the hook whirls overhead on a short chain (one full turn across the frames; loops)
  const whirl = (a: number, glow: number): P => {
    const hand: Pt = [14.5, 3.4];
    return pose({
      lean: -0.3,
      bob: -0.3,
      handN: hand,
      handF: [8, 13.5],
      hook: [hand[0] + Math.cos(a) * WR, hand[1] - 0.5 + Math.sin(a) * WRY],
      hookFly: Math.cos(a) > 0.3,
      whirl: a,
      glow,
      snarl: true,
    });
  };
  const windup = [whirl(Math.PI, 0.9), whirl(Math.PI * 1.5, 1), whirl(0, 1), whirl(Math.PI * 0.5, 1)].map(draw);
  // throw: the arm whips forward, the hook flies east and the chain pays out to the frame edge
  const throwAnim = [
    draw(pose({ lean: 1.2, handN: [18, 6.5], handF: [7.5, 13], hook: [22, 6.5], hookFly: true, glow: 1, snarl: true, footN: [13.5, FEET] })),
    draw(pose({ lean: 1.7, handN: [19.5, 9.5], handF: [7.5, 13], hook: null, line: [26, 9], glow: 1, snarl: true, footN: [14, FEET], dust: true })),
    draw(pose({ lean: 1.6, handN: [19.5, 10.5], handF: [8, 13.5], hook: null, line: [26, 10.5], glow: 0.9, snarl: true, footN: [14, FEET] })),
    draw(pose({ lean: 1.2, handN: [18.5, 11.5], handF: [8, 14], hook: null, line: [24.5, 12.5], glow: 0.85, footN: [13.5, FEET] })),
  ];
  // attack: a short melee rake — hook raised back over the shoulder, swung through, follow-through low
  const attack = [
    draw(pose({ lean: -0.3, handN: [12, 4.5], handF: [8, 13.5], hook: [9.5, 3], glow: 1, snarl: true })),
    draw(pose({ lean: 1.6, handN: [19, 9.5], handF: [7.5, 13], hook: [22, 10.5], hookFly: true, glow: 1, snarl: true, footN: [14, FEET], dust: true })),
    draw(pose({ lean: 1.2, handN: [18, 13.5], handF: [8, 14], hook: [19, 16.5], glow: 0.9, footN: [14, FEET] })),
  ];
  // corpse: crumples forward onto its knees and face
  const slump = pose({ bob: 5.5, lean: 2.2, footN: [12, FEET], footF: [8, FEET], handN: [19.5, FEET - 1], handF: [17, FEET - 1], hook: [21.5, FEET - 3], glow: 0.25 });
  const fell = draw(slump);
  const corpse = [
    draw(pose({ ...slump, bob: 3, lean: 1.6, handN: [18, FEET - 3], hook: [19.5, FEET - 3], glow: 0.5 })),
    ashify(squash(fell, 0.7, FEET + OY), 0.45, 0.4),
    ashify(squash(fell, 0.5, FEET + OY), 0.95, 0.15),
  ];
  return monsterSprites({
    id: 'chainThrall',
    anchorX: AX,
    anchorY: FEET + OY + 1,
    anims: {
      idle: anim(idle, 5, true),
      move: anim(move, 11, true),
      windup: anim(windup, 10, true), // a continuous whirl: loops for as long as the telegraph lasts
      attack: anim(attack, 12, false),
      throw: anim(throwAnim, 12, false),
      corpse: anim(corpse, 8, false),
    },
  });
}
