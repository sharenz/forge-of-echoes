// Training dummy — hideout only. A straw-stuffed burlap figure lashed to a wooden post and crossbar, stitched
// X eyes, standing on a small stone base. 'attack' is the wobble it does when struck.
import type { SpriteDef } from '../../contracts/art';
import { Frame, rotFrame } from '../frame';
import { C, RAMPS } from '../palette';
import { Sculpt, hash2, type PrimStyle } from '../shade';
import { anim, finish, monsterSprites, onBody, px } from './common';

const W = 24;
const H = 32;
const FEET = 30;

const wood: PrimStyle = { ramp: RAMPS.wood, bias: 0.2, dither: 0.08 };
const straw: PrimStyle = { ramp: RAMPS.straw, bias: -0.3, dither: 0.1, tex: (x, y) => (hash2(x, y, 3) > 0.8 ? -0.8 : hash2(x, y, 4) > 0.85 ? 0.6 : 0) };
const burlap: PrimStyle = { ramp: [C.strawDark, C.straw, C.strawLight, C.strawHi], bias: -0.1, dither: 0.08 };
const stone: PrimStyle = { ramp: RAMPS.stone, bias: 0.3, dither: 0.08 };

function draw(tuft: number): Frame {
  const f = new Frame(W, H);
  const s = new Sculpt();
  const cx = 12;
  // stone footing and the post
  s.ell(cx, FEET - 1, 5, 2.2, stone);
  s.poly([[cx - 1.2, 7], [cx + 1.2, 7], [cx + 1.2, FEET - 1], [cx - 1.2, FEET - 1]], { ...wood, cyl: 1 }, 1);
  // crossbar arms
  s.poly([[cx - 8, 11.5], [cx + 8, 11.5], [cx + 8, 13.5], [cx - 8, 13.5]], wood, 1, 0, -0.3);
  // straw body sack
  s.ell(cx, 16.5, 5, 6.2, straw);
  // burlap head
  s.ell(cx, 7.5, 3.6, 3.8, burlap);
  s.render(f.c, f.e);

  // rope lashings (waist, neck, arm ends)
  for (let x = cx - 5; x <= cx + 4; x++) onBody(f, x, 19, (x & 1) === 0 ? C.woodDark : C.wood);
  for (let x = cx - 3; x <= cx + 2; x++) onBody(f, x, 11, (x & 1) === 0 ? C.woodDark : C.wood);
  for (const x of [cx - 7, cx + 6]) {
    px(f, x, 11, C.woodDark);
    px(f, x, 14, C.woodDark);
  }
  // straw tufts poking out at the arm ends, neck and hem
  const tufts: [number, number][] = [[cx - 9, 12], [cx - 9, 13], [cx + 9, 12], [cx + 9, 14], [cx - 4, 23], [cx + 3, 23], [cx, 23]];
  for (const [x, y] of tufts) px(f, x + (tuft && x < cx ? -1 : 0), y + (tuft && y > 20 ? 1 : 0), y > 20 ? C.strawLight : C.strawHi);
  px(f, cx - 5, 22, C.straw);
  px(f, cx + 4, 22, C.straw);
  // stitched X eyes and a mouth seam
  for (const ex of [cx - 2, cx + 1]) {
    px(f, ex, 6, C.woodDeep);
    px(f, ex + 1, 7, C.woodDeep);
    px(f, ex + 1, 6, C.woodDark);
    px(f, ex, 7, C.woodDark);
  }
  for (let x = cx - 1; x <= cx + 1; x++) px(f, x, 9, (x & 1) === 0 ? C.woodDark : C.strawDark);
  // a patch on the body
  px(f, cx + 2, 15, C.burgundy);
  px(f, cx + 3, 15, C.wineMid);
  px(f, cx + 2, 16, C.wineDark);
  px(f, cx + 3, 16, C.burgundy);
  return finish(f);
}

export function trainingDummySprites(): SpriteDef[] {
  const rest = draw(0);
  const idle = [rest, draw(1)];
  // struck: rock back, overshoot, settle (pivot at the footing)
  const attack = [0.22, -0.14, 0.08, -0.03].map((a) => rotFrame(rest, a, 12, FEET - 1));
  return monsterSprites({
    id: 'trainingDummy',
    anchorX: 12,
    anchorY: FEET + 1,
    anims: {
      idle: anim(idle, 2, true),
      attack: anim(attack, 12, false),
    },
  });
}
