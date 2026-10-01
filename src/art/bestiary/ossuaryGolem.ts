// Ossuary Golem — the Ossuary bruiser. A hulking knuckle-walker of fused bone and glacier ice: a great hump of bone
// crowned with a ridge of ice crystals, short stacked-bone hind legs on ice-crusted feet, and long arms planted on two
// fists of raw ice in front. Its flank is an open barrel ribcage with a cold blue heart beating inside — the one focal
// light. The skull juts forward below the hump on a dark collar, frost-lit sockets staring ahead. Top-heavy and
// weaponless, so it never reads like the Ironhide Brute; the gap between hind legs and planted fists keeps the
// quadruped stance readable at 1x.
//
// The slam telegraph rears back on the hind legs and hauls both fists together high above the skull while the heart
// flares; the attack drives them into the ground in front and a burst of ice spits up where they land.
import type { SpriteDef } from '../../contracts/art';
import { Frame } from '../frame';
import { C, type Ramp } from '../palette';
import { Sculpt, type PrimStyle } from '../shade';
import { anim, finish, monsterSprites, onBody, px, squash } from '../monsters/common';
import { BONE_FAR, COLD_WHITE, iceStyle, rimeify, seam } from './ossuaryKit';

const W = 48;
const H = 48;
const FEET = 45;

// Big planes of bone need a ramp whose neighbouring steps differ in value, not just hue (the family BONE ramp's
// lavender/beige pair would break a large mass into patches).
const GBONE: Ramp = [C.ossDark, C.ossMid, C.hairShadow, C.ashGrey, C.bone, C.parchment];
const bone: PrimStyle = { ramp: GBONE, bias: -1.45, dither: 0 };
const armBone: PrimStyle = { ramp: GBONE, bias: -0.75, dither: 0 };
const boneLit: PrimStyle = { ramp: GBONE, bias: 0.1, dither: 0 };
const boneFar: PrimStyle = { ramp: BONE_FAR, bias: -0.3, dither: 0 };
const CAVITY: Ramp = [C.ink, C.frostDeep, C.ossDeep, C.frostDark];
const cavity: PrimStyle = { ramp: CAVITY, bias: -0.4, dither: 0, ao: false };
const collar: PrimStyle = { ramp: CAVITY, bias: 0.3, dither: 0, ao: false };
const rib: PrimStyle = { ramp: GBONE, bias: 0.8, dither: 0 };
// Glacier ice, not gem ice: the fists are big masses, so they sit in the rimed stone-blue values with only the lit
// facets reaching frost/ice (saturated mana-blue over this much area read as toy mittens next to the other rosters).
const fistIce: PrimStyle = { ramp: [C.frostDeep, C.frostDark, C.frostMid, C.ossLight, C.ossPale, C.frost, C.ice], bias: -1, glow: 20, ao: false, dither: 0 };
const fistIceFar: PrimStyle = { ramp: [C.ink, C.frostDeep, C.frostDark, C.frostMid, C.ossLight], bias: 0, glow: 10, ao: false, dither: 0 };
const crystal = iceStyle(80, 0.5);

type Pt = [number, number];
interface P {
  bob: number;
  lean: number; // + = forward (onto the fists), - = rearing back
  fistN: Pt;
  fistF: Pt;
  footN: [number, number]; // x, lift
  footF: [number, number];
  heart: number; // 0..1.3
  impact: number; // 0..1 ice spitting up where the fists land
}

const BX = 21;
const BY = 28;
const base: P = {
  bob: 0,
  lean: 0,
  fistN: [BX + 10, FEET - 4],
  fistF: [BX + 17, FEET - 6],
  footN: [BX - 3, 0],
  footF: [BX - 9, 0],
  heart: 0.8,
  impact: 0,
};
const pose = (p: Partial<P>): P => ({ ...base, ...p });

/** A chunky block of ice around a fist, oriented along the forearm. */
function iceFist(s: Sculpt, at: Pt, from: Pt, style: PrimStyle, size = 1): void {
  const a = Math.atan2(at[1] - from[1], at[0] - from[0]);
  const c = Math.cos(a);
  const sn = Math.sin(a);
  const P = (u: number, v: number): Pt => [at[0] + (c * u - sn * v) * size, at[1] + (sn * u + c * v) * size];
  s.poly([P(-2.5, -3.2), P(1.5, -3.6), P(3.8, -1.5), P(3.8, 1.8), P(1.5, 3.6), P(-2.2, 3.2), P(-3.4, 0)], style, 1.6, -0.3, -0.3);
}

/** Elbow of a two-bone arm: bent outwards (away from the body) so the arm never folds across the torso. */
function elbow(sh: Pt, fist: Pt, bend: number): Pt {
  const mx = (sh[0] + fist[0]) / 2;
  const my = (sh[1] + fist[1]) / 2;
  const dx = fist[0] - sh[0];
  const dy = fist[1] - sh[1];
  const l = Math.hypot(dx, dy) || 1;
  // perpendicular pointing forward/right of the arm's direction
  return [mx + (-dy / l) * -bend, my + (dx / l) * -bend];
}

function draw(p: P): Frame {
  const f = new Frame(W, H);
  const s = new Sculpt();
  const bx = BX + p.lean * 1.5;
  const by = BY + p.bob + Math.abs(p.lean) * 0.3;
  const hipY = by + 7;
  const shN: Pt = [bx + 5 + p.lean * 0.8, by - 5 + p.lean * 0.4];
  const shF: Pt = [bx + 8.5 + p.lean * 0.8, by - 7 + p.lean * 0.4];
  const hx = bx + 11 + p.lean * 1.4;
  const hy = by - 8.5 + p.lean * 1.3;
  const footY = (lift: number): number => FEET - 3 - Math.max(0, lift);

  // ice crystal ridge erupting from the hump (behind the body)
  const ridge: [Pt, Pt, number][] = [
    [[bx - 8, by - 2], [bx - 13.5, by - 7.5], 1.6],
    [[bx - 5.5, by - 5.5], [bx - 9, by - 14.5], 2.1],
    [[bx - 1.5, by - 7.5], [bx - 2, by - 18.5], 2.3],
    [[bx + 2, by - 7.5], [bx + 4.5, by - 14.5], 1.7],
  ];
  for (const [a, t, w] of ridge) {
    const nx = -(t[1] - a[1]);
    const ny = t[0] - a[0];
    const l = Math.hypot(nx, ny) || 1;
    s.poly([[a[0] - (nx / l) * w, a[1] - (ny / l) * w], [a[0] + (nx / l) * w, a[1] + (ny / l) * w], t], crystal, 1.2, -0.4, -0.2);
  }
  // far arm and fist (behind the body)
  const eF = elbow(shF, p.fistF, p.fistF[1] < shF[1] ? -2 : 3.5);
  s.cap(shF[0], shF[1], eF[0], eF[1], 2.6, 2.3, boneFar);
  s.cap(eF[0], eF[1], p.fistF[0], p.fistF[1], 2.3, 2.3, boneFar);
  iceFist(s, p.fistF, eF, fistIceFar, 0.95);
  // far hind leg
  s.cap(bx - 9, hipY - 2, p.footF[0], footY(p.footF[1]), 3, 2.6, boneFar);
  // one mass of fused bone: rump, great hump and barrel chest as a single bevelled plate (clean planes), tipping
  // forward onto the fists or rearing back about the hips
  const tilt = p.lean * 0.1;
  const piv: Pt = [bx - 5, by + 6];
  const T = (dx: number, dy: number): Pt => {
    const x = bx + dx - piv[0];
    const y = by + dy - piv[1];
    return [piv[0] + x * Math.cos(tilt) - y * Math.sin(tilt), piv[1] + x * Math.sin(tilt) + y * Math.cos(tilt)];
  };
  const torso: Pt[] = [[-9, 6.5], [-10.2, 2.5], [-9.5, -2.5], [-6.4, -7.2], [-1.5, -9.2], [3.6, -8.8], [7, -5.8], [8.4, -1.8], [8, 3.2], [5.6, 6], [1, 7], [-3.4, 7.8]].map(([x, y]) => T(x, y));
  const torsoIx = s.size;
  s.poly(torso, bone, 3, -0.1, -0.25);
  // near hind leg: thigh and shin, stacked bone columns
  const kneeN: Pt = [p.footN[0] + 1, footY(p.footN[1]) - 4.5];
  const legIx = s.size;
  s.cap(bx - 6.5, by + 4.5, kneeN[0], kneeN[1], 3.2, 2.8, armBone);
  s.cap(kneeN[0], kneeN[1], p.footN[0], footY(p.footN[1]), 2.8, 2.7, armBone);
  // the open ribcage on the flank: a dark window, the heart inside, three rib bars arcing across it
  const [hcx, hcy] = T(-1.8, 0.5);
  s.ell(hcx, hcy, 5, 4.8, cavity, 0.15 + tilt);
  const heat = Math.min(1.3, p.heart);
  s.ell(hcx + 0.4, hcy + 0.3, 2.7 + heat * 0.5, 2.9 + heat * 0.5, { ramp: [C.frostDark, C.mana, C.frost, C.ice], bias: -0.3 + heat * 0.8, glow: 200 + 55 * Math.min(1, heat), ao: false, dither: 0 });
  for (let i = 0; i < 3; i++) {
    const a = T(-5.5 + i * 3.4, -4);
    const m = T(-4.6 + i * 3.4, 0.8);
    const b = T(-3.2 + i * 3.4, 4.8);
    s.cap(a[0], a[1], m[0], m[1], 0.95, 0.95, rib);
    s.cap(m[0], m[1], b[0], b[1], 0.95, 0.7, rib);
  }
  const sp0 = T(-7, -4.6);
  const sp1 = T(3.5, -5);
  s.cap(sp0[0], sp0[1], sp1[0], sp1[1], 1.1, 1.1, boneLit); // spine over the cage
  // the dark collar the skull juts from, then the near shoulder cap with ice growing through it
  s.ell(hx - 3, hy + 2.2, 4.2, 3.4, collar);
  const armIx = s.size;
  s.ell(shN[0] - 0.3, shN[1] - 0.5, 4.3, 3.7, armBone, -0.3);
  s.ell(shN[0] - 1, shN[1] - 2, 2.8, 1.7, boneLit, -0.3);
  s.poly([[shN[0] - 4, shN[1] - 2.5], [shN[0] - 1, shN[1] - 4], [shN[0] - 5.5, shN[1] - 9]], crystal, 1);
  // near arm: heavy bone upper arm, thick forearm, the ice fist planted ahead of the near leg
  const eN = elbow(shN, p.fistN, p.fistN[1] < shN[1] ? -2.5 : 0.8);
  s.cap(shN[0], shN[1] + 1.5, eN[0], eN[1], 2.8, 2.4, armBone);
  s.cap(eN[0], eN[1], p.fistN[0], p.fistN[1], 2.4, 2.6, armBone);
  iceFist(s, p.fistN, eN, fistIce, 1.05);
  const armEnd = s.size;
  // skull, jutting forward over the collar
  s.ell(hx, hy, 3.6, 3.3, boneLit);
  s.ell(hx + 1.5, hy + 2.8, 2.4, 1.3, { ...boneLit, bias: -0.3 }); // jaw
  const owner = s.render(f.c, f.e);
  // inner contours: the near arm and near leg stay crisp against the bone mass behind them
  seam(f, owner, (i) => i >= armIx && i < armEnd, (i) => i < armIx, 0.6);
  seam(f, owner, (i) => i >= legIx && i < legIx + 2, (i) => i >= torsoIx && i < legIx, 0.5);

  // ice-crusted feet, never below the ground line
  for (const [x, lift, near] of [[p.footF[0], p.footF[1], false], [p.footN[0], p.footN[1], true]] as const) {
    const fx = Math.round(x);
    const fy = Math.min(FEET, Math.round(FEET - Math.max(0, lift)));
    for (let i = -3; i <= 3; i++) px(f, fx + i, fy, near ? (i < 0 ? C.frostMid : C.frostDark) : C.frostDeep);
    for (let i = -3; i <= 2; i++) px(f, fx + i, fy - 1, near ? (i < 0 ? C.ice : C.frost) : C.frostMid);
    if (near) f.glow(fx - 2, fy - 1, C.ice, 70);
  }
  // rime flecks on the bone (cold highlights on the top-left of the masses)
  for (const [x, y] of [[shN[0] - 3, shN[1] - 3], [shN[0] - 1, shN[1] - 3.5], [bx - 7, by - 7], [bx - 4, by - 9], [hx - 2, hy - 2]] as const) onBody(f, x, y, C.ossFrost);
  // skull: brow, deep sockets with frost-lit eyes, nasal hollow, teeth
  const ex = Math.round(hx + 1);
  const ey = Math.round(hy);
  for (const [dx, dy] of [[-1, 0], [-1, -1], [0, -1], [2, -1], [2, 0], [1, 1]] as const) onBody(f, ex + dx, ey + dy, C.ossDeep);
  onBody(f, ex - 2, ey - 2, C.parchment);
  onBody(f, ex - 1, ey - 2, C.parchment);
  f.glow(ex, ey, p.heart > 0.95 ? COLD_WHITE : C.ice, 255);
  f.glow(ex + 2, ey, C.frost, 210);
  for (let x = ex - 1; x <= ex + 2; x++) onBody(f, x, ey + 2, x % 2 ? C.ossDeep : C.bone);
  // the heart's hot core, showing between the bars
  const cx = Math.round(hcx + 0.4);
  const cy = Math.round(hcy + 0.3);
  if (heat > 0.7) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) if (f.e.opaque(cx + dx, cy + dy)) f.glow(cx + dx, cy + dy, heat > 1.1 ? COLD_WHITE : C.ice, 255);
  if (p.impact > 0) {
    // ice spitting up where the fists land
    const ix = Math.round((p.fistN[0] + p.fistF[0]) / 2) + 1;
    const k = p.impact;
    for (const [dx, dy, c] of [[-7, 0, C.frostMid], [-5, -1, C.frost], [-4, -3, C.ice], [-2, 0, C.frost], [-1, -4, COLD_WHITE], [1, -2, C.ice], [3, -1, C.frost], [4, -4, C.ice], [5, 0, C.frost], [7, -1, C.frostMid], [0, -1, C.ice], [2, -5, C.frost], [-3, -5, C.frost]] as const) {
      const y = FEET + Math.round(dy * k);
      f.glow(ix + Math.round(dx * (0.6 + 0.4 * k)), y, c, 235);
    }
  }
  return finish(f);
}

export function ossuaryGolemSprites(): SpriteDef[] {
  const idle = [0, 1, 2, 1].map((i) => {
    const b = [0, 0.5, 1, 0.5][i];
    return draw(pose({ bob: b, heart: [0.7, 0.85, 1, 0.85][i] }));
  });
  // lumbering knuckle-walk: each fist swings opposite to the foot on its side, so the legs always show through
  const move = [0, 1, 2, 3, 4, 5].map((i) => {
    const ph = ((i + 0.5) / 6) * Math.PI * 2;
    const step = Math.sin(ph);
    return draw(
      pose({
        bob: Math.abs(Math.cos(ph)) * 1.2,
        lean: 0.3,
        footN: [BX - 3 + step * 3, Math.max(0, step) * 2],
        footF: [BX - 9 - step * 3, Math.max(0, -step) * 2],
        fistN: [BX + 10 - step * 2, FEET - 4 - Math.max(0, -step) * 2],
        fistF: [BX + 17 + step * 2, FEET - 6 - Math.max(0, step) * 1.5],
        heart: 0.85,
      }),
    );
  });
  // the telegraph: rearing back on the hind legs, both fists hauled together high above the skull, the heart flares
  const windup = [
    draw(pose({ lean: -0.5, bob: -1, fistN: [BX + 14, BY - 4], fistF: [BX + 18, BY - 6], footN: [BX - 1, 0], heart: 0.95 })),
    draw(pose({ lean: -1.1, bob: -2.5, fistN: [BX + 8, BY - 19], fistF: [BX + 12, BY - 21], footN: [BX, 0], heart: 1.15 })),
    draw(pose({ lean: -1.4, bob: -3, fistN: [BX + 6, BY - 21], fistF: [BX + 10, BY - 23], footN: [BX, 0], heart: 1.3 })),
    draw(pose({ lean: -1.4, bob: -2.5, fistN: [BX + 6, BY - 20.5], fistF: [BX + 10, BY - 22.5], footN: [BX, 0], heart: 1.25 })),
  ];
  const attack = [
    draw(pose({ lean: 1, bob: -0.5, fistN: [BX + 17, BY - 6], fistF: [BX + 20, BY - 8], heart: 1.2, footN: [BX - 1, 0] })),
    draw(pose({ lean: 1.8, bob: 2, fistN: [BX + 18, FEET - 4], fistF: [BX + 21, FEET - 6], heart: 1.05, footN: [BX - 1, 0], impact: 1 })),
    draw(pose({ lean: 1.5, bob: 1.5, fistN: [BX + 17, FEET - 4], fistF: [BX + 20, FEET - 6], heart: 0.9, footN: [BX - 1, 0], impact: 0.5 })),
  ];
  const fallen = draw(pose({ lean: 1.6, bob: 7, fistN: [BX + 16, FEET - 3], fistF: [BX + 21, FEET - 4], footN: [BX - 1, 0], footF: [BX - 10, 0], heart: 0.3 }));
  const corpse = [
    draw(pose({ lean: 1.3, bob: 4, fistN: [BX + 15, FEET - 4], fistF: [BX + 20, FEET - 5], footN: [BX - 2, 0], heart: 0.6 })),
    rimeify(squash(fallen, 0.8, FEET), 0.4, 0.4),
    rimeify(squash(fallen, 0.65, FEET), 0.8, 0.15),
  ];
  return monsterSprites({
    id: 'ossuaryGolem',
    anchorX: BX - 1, // the centre of the four-point footing (hind feet + planted fists), so the west mirror doesn't jump
    anchorY: FEET + 1,
    anims: {
      idle: anim(idle, 4, true),
      move: anim(move, 7, true),
      windup: anim(windup, 5, false),
      attack: anim(attack, 10, false),
      corpse: anim(corpse, 6, false),
    },
  });
}
