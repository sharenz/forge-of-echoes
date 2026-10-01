// Cinder Spitter — artillery. A squat cinder toad: wide, low, olive-black hide studded with ember warts,
// bulging eyes, a long mouth line and a glowing throat sac that swells before it spits (the telegraph).
import type { SpriteDef } from '../../contracts/art';
import { Frame } from '../frame';
import { C, RAMPS, type Ramp } from '../palette';
import { Sculpt, type PrimStyle } from '../shade';
import { anim, ashify, finish, monsterSprites, onBody, px, squash } from './common';

const W = 26;
const H = 20;
const FEET = 18;

const HIDE: Ramp = [C.ink, C.mossDeep, C.mossDark, C.moss, C.olive, C.oliveLight];
const hide: PrimStyle = { ramp: HIDE, bias: -0.35, dither: 0.1 };
const far: PrimStyle = { ramp: HIDE, bias: -1, dither: 0 };
const belly: PrimStyle = { ramp: [C.mossDark, C.olive, C.oliveLight, C.bone], bias: -0.4, dither: 0.1 };

interface P {
  bob: number;
  dx: number;
  sac: number; // throat sac size 0.6..1.7
  lean: number; // - = rear back
  mouth: number; // 0..1 gape
  legExt: number; // hop: legs extended
  glow: number;
}
const base: P = { bob: 0, dx: 0, sac: 1, lean: 0, mouth: 0, legExt: 0, glow: 0.8 };
const P = (p: Partial<P>): P => ({ ...base, ...p });

function draw(p: P): Frame {
  const f = new Frame(W, H);
  const s = new Sculpt();
  const bx = 11 + p.dx;
  const by = 12.6 + p.bob;
  const lean = p.lean;
  const hx = bx + 5.6 + lean;
  const hy = by - 0.6 - Math.max(0, -lean) * 0.5;
  // far legs
  s.cap(bx + 4.4, by + 2, bx + 6 + p.legExt, FEET - 0.8, 1.0, 0.8, far);
  s.cap(bx - 4.5, by + 1.5, bx - 7 - p.legExt * 1.5, FEET - 0.8, 1.2, 0.9, far);
  // squat body; the head is the front of the same mass
  s.ell(bx - 0.6, by, 7.4, 4.6, hide, -0.05);
  s.ell(bx + 1.5, by + 3, 4.8, 1.7, belly);
  s.ell(hx, hy, 4.2, 3.2, { ...hide, bias: 0.5 });
  // bulging eyes on top of the head (far one first)
  s.ell(hx + 0.6, hy - 3.4, 1.5, 1.4, { ...hide, bias: -0.3 });
  s.ell(hx - 1.2, hy - 3.2, 1.9, 1.8, { ...hide, bias: 0.5 });
  // lower jaw drops when spitting
  if (p.mouth > 0) s.poly([[hx - 2.5, hy + 0.9], [hx + 4.2, hy + 0.5 + p.mouth * 1.6], [hx + 3.6, hy + 2.4 + p.mouth * 1.6], [hx - 2.5, hy + 2.8]], { ...hide, bias: 0.2 }, 0.8);
  // haunch, back foot, front leg
  s.ell(bx - 4.4, by + 1.6, 3.2, 2.6, { ...hide, bias: 0.2 });
  s.cap(bx - 5.4, by + 3, bx - 7.5 - p.legExt * 1.5, FEET - 0.7, 1.1, 0.9, { ...hide, bias: -0.2 });
  s.cap(bx + 3.8, by + 2.4, bx + 5.4 + p.legExt, FEET - 0.7, 1.1, 0.9, hide);
  // throat sac (emissive), hanging under the jaw
  const sx = hx + 0.4;
  const sy = hy + 2.8 + (p.sac - 1) * 0.8;
  s.ell(sx, sy, 2.3 * p.sac, 1.8 * p.sac, { ramp: RAMPS.ember.slice(1, 6), bias: 0.5 + p.glow * 0.7, glow: 140 + 110 * p.glow, ao: false, dither: 0.1 });
  s.render(f.c, f.e);

  // toes
  for (const x of [bx + 5.4 + p.legExt, bx - 7.5 - p.legExt * 1.5]) {
    px(f, x, FEET, C.coal);
    px(f, x + 1, FEET, C.mossDark);
  }
  // mouth line or glowing maw
  const mx = Math.round(hx);
  const my = Math.round(hy + 0.8);
  if (p.mouth > 0) {
    for (let x = mx - 1; x <= mx + 3; x++) f.glow(x, my + 1, x === mx + 1 ? C.hot : C.flame, 230);
    for (let x = mx; x <= mx + 2; x++) f.glow(x, my + 2, C.ember, 200);
  } else {
    for (let x = mx - 3; x <= mx + 3; x++) onBody(f, x, my + (x > mx + 1 ? -1 : 0), C.ink);
  }
  // ember eyes with a dark slit pupil
  const g = 150 + 105 * p.glow;
  const ex = Math.round(hx - 1);
  const ey = Math.round(hy - 3.6);
  f.glow(ex, ey, C.gold, g);
  f.glow(ex + 1, ey, p.glow > 0.9 ? C.hot : C.goldHi, g);
  px(f, ex, ey + 1, C.ink);
  px(f, ex + 1, ey + 1, C.goldDark);
  // a few smouldering warts along the back
  const warts: [number, number][] = [[bx - 5, by - 2], [bx - 2, by - 3.4], [bx + 1.4, by - 2.6]];
  for (const [wx, wy] of warts) {
    const x = Math.round(wx);
    const y = Math.round(wy);
    if (!f.c.opaque(x, y)) continue;
    f.glow(x, y, p.glow > 0.85 ? C.flame : C.ember, g * 0.85);
    onBody(f, x + 1, y, C.olive);
  }
  return finish(f);
}

export function cinderSpitterSprites(): SpriteDef[] {
  const idle = [0, 1, 2, 1].map((i) => draw(P({ bob: i === 2 ? 1 : 0, sac: [0.85, 1, 1.1, 1][i], glow: [0.6, 0.8, 1, 0.8][i] })));
  // hop-crawl: gather, push off, airborne, land
  const move = [
    draw(P({ bob: 1, sac: 0.9 })),
    draw(P({ bob: 0, sac: 0.9, legExt: 1, dx: 0.5 })),
    draw(P({ bob: -2, sac: 0.85, legExt: 2, dx: 1 })),
    draw(P({ bob: -2, sac: 0.85, legExt: 1.5, dx: 1.5 })),
    draw(P({ bob: 0, sac: 0.9, legExt: 0.5, dx: 1 })),
    draw(P({ bob: 1, sac: 0.95, dx: 0.5 })),
  ];
  const windup = [
    draw(P({ lean: -0.5, sac: 1.2, glow: 0.9 })),
    draw(P({ lean: -1, sac: 1.4, glow: 1, bob: -1 })),
    draw(P({ lean: -1.5, sac: 1.6, glow: 1, bob: -1 })),
    draw(P({ lean: -1.5, sac: 1.7, glow: 1 })),
  ];
  const attack = [
    draw(P({ lean: 1, sac: 0.8, mouth: 1, glow: 1 })),
    draw(P({ lean: 0.5, sac: 0.7, mouth: 0.7, glow: 0.9, dx: -0.5 })),
    draw(P({ sac: 0.8, mouth: 0.2, glow: 0.8 })),
  ];
  const flat = draw(P({ sac: 0.6, bob: 2, glow: 0.3 }));
  const corpse = [
    ashify(squash(flat, 0.85, FEET), 0.3, 0.6),
    ashify(squash(flat, 0.65, FEET), 0.7, 0.35),
    ashify(squash(flat, 0.5, FEET), 1, 0.15),
  ];
  return monsterSprites({
    id: 'cinderSpitter',
    anchorX: 11,
    anchorY: FEET + 1,
    anims: {
      idle: anim(idle, 5, true),
      move: anim(move, 10, true),
      windup: anim(windup, 8, false),
      attack: anim(attack, 12, false),
      corpse: anim(corpse, 8, false),
    },
  });
}
