// Rimeshade — the Ossuary hunter. A drifting wraith of rime: a deep hood with two ice-white eyes in the dark, a
// shroud that tapers into a ragged tail streaming behind it, thin grasping arms with icicle claws and a cold cyan
// core burning in its chest. It has no legs; it glides a few pixels above the floor (the anchor is the ground point
// under it, so the presenter's shadow sits beneath the hover).
//
// It is semi-transparent: the shroud is baked with falling alpha (hood ~88%, body ~70%, tail tips ~25%) and an
// alpha-aware outline, so the floor shows through while the eyes and core stay fully bright. The upper body stays
// above 50% coverage so the renderer's runtime rarity outline still wraps it.
import type { SpriteDef } from '../../contracts/art';
import { Frame } from '../frame';
import { C, type Ramp } from '../palette';
import { ca, luma } from '../raster';
import { Sculpt, type PrimStyle } from '../shade';
import { anim, monsterSprites } from '../monsters/common';
import { COLD_WHITE, fade, ghostOutline, rimeify } from './ossuaryKit';

const W = 24;
const H = 22;
const GROUND = 20;

const GHOST: Ramp = [C.frostDeep, C.frostDark, C.frostMid, C.ossLight, C.ossPale, C.ossFrost, C.ice];
const shroud: PrimStyle = { ramp: GHOST, bias: -1.1, dither: 0.1 };
const hoodStyle: PrimStyle = { ramp: GHOST, bias: 0.4, dither: 0.08 };
const voidStyle: PrimStyle = { ramp: [C.ink, C.frostDeep, C.frostDark], bias: -0.6, dither: 0, ao: false };
const armStyle: PrimStyle = { ramp: GHOST, bias: -0.4, dither: 0 };
const armFar: PrimStyle = { ramp: GHOST, bias: -1.4, dither: 0 };

type Pt = [number, number];
interface P {
  x: number; // hood centre x
  y: number; // hood centre y
  lean: number; // + = head forward of the body
  trail: number; // tail length
  wave: number; // tail ripple phase 0..1
  handN: Pt;
  handF: Pt;
  core: number; // 0..1.3
  wail: number; // 0..1 mouth opening in the hood
}
const base: P = { x: 14, y: 6, lean: 0.5, trail: 0, wave: 0, handN: [19, 12], handF: [20, 11], core: 0.8, wail: 0 };
const pose = (p: Partial<P>): P => ({ ...base, ...p });

function draw(p: P): Frame {
  const f = new Frame(W, H);
  const s = new Sculpt();
  const hx = p.x;
  const hy = p.y;
  const bx = hx - 1 - p.lean; // body centre
  const by = hy + 6;
  const w = (k: number): number => Math.sin((p.wave + k) * Math.PI * 2);

  // far arm, behind everything
  const shF: Pt = [bx + 2.5, by - 2];
  const eF: Pt = [(shF[0] + p.handF[0]) / 2, (shF[1] + p.handF[1]) / 2 + 1];
  s.cap(shF[0], shF[1], eF[0], eF[1], 1.1, 0.8, armFar);
  s.cap(eF[0], eF[1], p.handF[0], p.handF[1], 0.8, 0.6, armFar);
  // shroud: shoulders → ragged tail streaming back and down
  const tipX = bx - 9 - p.trail;
  const tipY = by + 6 + w(0) * 1.2;
  const shroudPts: Pt[] = [
    [bx - 3.5, by - 4],
    [bx + 2, by - 4.6],
    [bx + 4.2, by - 1.5],
    [bx + 3.4, by + 2 + w(0.25) * 0.5],
    [bx + 1, by + 4.8],
    [bx - 2, by + 6.8 + w(0.5) * 0.8],
    [(bx + tipX) / 2 - 1, by + 7.4 + w(0.1)],
    [tipX, tipY],
    [(bx + tipX) / 2, by + 4 + w(0.6) * 0.8],
    [bx - 4.8, by + 0.5],
  ];
  s.poly(shroudPts, { ...shroud, cyl: 0.4 }, 2);
  // ragged tatters trailing under and behind the tail
  s.cap(bx - 1, by + 5, bx - 5 - p.trail * 0.6, by + 9 + w(0.35) * 1.2, 1.3, 0.4, { ...shroud, bias: -0.8 });
  s.cap(bx - 5, by + 4, tipX - 2, tipY - 3 + w(0.7), 1, 0.4, { ...shroud, bias: -0.8 });
  // hood with its peak streaming back, the dark void where a face should be
  s.poly([[hx - 1.5, hy - 3.8], [hx - 7 - p.trail * 0.4, hy + 0.2 + w(0.8) * 0.7], [hx - 2.5, hy + 2]], hoodStyle, 1.2);
  s.ell(hx, hy, 3.9, 4, hoodStyle);
  s.ell(hx + 1.7, hy + 0.8, 2, 2.6 + p.wail * 0.8, voidStyle);
  // near arm on top
  const shN: Pt = [bx + 1.5, by - 1.5];
  const eN: Pt = [(shN[0] + p.handN[0]) / 2 - 0.5, (shN[1] + p.handN[1]) / 2 + 1.5];
  s.cap(shN[0], shN[1], eN[0], eN[1], 1.1, 0.7, armStyle);
  s.cap(eN[0], eN[1], p.handN[0], p.handN[1], 0.7, 0.5, armStyle);
  // the core: a cold cyan light in the chest
  const heat = Math.min(1.3, p.core);
  const cx = bx + 1.2;
  const cy = by - 0.5;
  s.ell(cx, cy, 0.9 + heat * 0.5, 1.1 + heat * 0.5, { ramp: [C.frostMid, C.mana, C.frost, C.ice], bias: 0.2 + heat * 1.1, glow: 200 + 55 * Math.min(1, heat), ao: false, dither: 0.1 });
  const owner = s.render(f.c, f.e);

  // translucency: hood and chest most solid, fading down and back along the tail
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!f.c.opaque(x, y) || f.e.opaque(x, y)) continue;
      const down = Math.max(0, y - (by - 1));
      const back = Math.max(0, bx - 2 - x);
      let a = 205 - down * 15 - back * 10;
      if (owner[y * W + x] === 0 || owner[y * W + x] === 1) a -= 40; // far arm
      a = Math.max(48, Math.min(205, a));
      const c = f.c.get(x, y);
      f.c.set(x, y, (c & 0xffffff00) | a);
      // faint spectral self-light: the pale parts of the shroud glow a little in the dark
      const l = luma(c);
      if (l > 0.35) f.e.set(x, y, (C.frost & 0xffffff00) | Math.round(Math.min(95, (l - 0.28) * 190) * (a / 205)));
    }
  }
  // icicle claws
  for (const [hand, near] of [[p.handN, true], [p.handF, false]] as const) {
    const X = Math.round(hand[0]);
    const Y = Math.round(hand[1]);
    const col = near ? C.ice : C.frost;
    f.glow(X + 1, Y, col, near ? 150 : 100);
    f.glow(X + 1, Y + 1, near ? C.frost : C.frostMid, near ? 120 : 80);
    f.glow(X, Y + 1, near ? C.frost : C.frostMid, near ? 110 : 70);
  }
  if (heat > 0.9) f.glow(Math.round(cx), Math.round(cy), heat > 1.1 ? COLD_WHITE : C.ice, 255);
  // halo around the core, soft light through the shroud
  for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]] as const) {
    const X = Math.round(cx) + dx;
    const Y = Math.round(cy) + dy;
    if (f.c.opaque(X, Y) && !f.e.opaque(X, Y)) f.emit(X, Y, C.frost, 110 * Math.min(1, heat));
  }
  // eyes in the hood void
  const ex = Math.round(hx + 1);
  const ey = Math.round(hy);
  const bright = p.core > 0.95;
  f.glow(ex, ey, bright ? COLD_WHITE : C.ice, 255);
  f.glow(ex + 2, ey, bright ? C.ice : C.frost, 235);
  if (p.wail > 0.5) f.glow(ex + 1, ey + 3, C.frost, 200);
  // spectral rim: the hood, the shoulders and the top of the tail catch a thin line of cold light, so the wraith
  // reads against the floor outside the light pools
  const rim: [number, number][] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!f.c.opaque(x, y) || f.e.opaque(x, y) || ca(f.c.get(x, y)) < 90) continue;
      const up = !f.c.opaque(x, y - 1);
      const side = !f.c.opaque(x - 1, y) || !f.c.opaque(x + 1, y);
      if (up || (side && y <= by + 1)) rim.push([x, y]);
    }
  }
  for (const [x, y] of rim) {
    const a = ca(f.c.get(x, y));
    f.c.set(x, y, (C.ossFrost & 0xffffff00) | Math.min(255, a + 30));
    f.e.set(x, y, (C.frost & 0xffffff00) | Math.round(Math.min(120, 60 + a * 0.3)));
  }
  ghostOutline(f, C.frostDeep, 0.95);
  return f;
}

export function rimeshadeSprites(): SpriteDef[] {
  const idle = [0, 1, 2, 3, 4, 5].map((i) => {
    const b = [0, 0, 1, 1, 1, 0][i];
    return draw(pose({ y: 6 + b, wave: i / 6, core: [0.7, 0.8, 0.95, 1, 0.9, 0.8][i], handN: [19, 12 + b], handF: [20, 11 + b] }));
  });
  // glide: leaning into the chase, tail stretched out and rippling, claws reaching
  const move = [0, 1, 2, 3, 4, 5].map((i) => {
    const b = [0, -1, -1, 0, 0, 0][i];
    return draw(pose({ x: 15, y: 6 + b, lean: 1.5, trail: 2 + (i % 2), wave: i / 6, core: 0.9, handN: [21, 11 + b], handF: [22, 10 + b] }));
  });
  // rear up and back, claws spread high, the core flares
  const windup = [
    draw(pose({ x: 13, y: 4, lean: -0.5, trail: 0, wave: 0.2, handN: [18, 5], handF: [20, 3], core: 1, wail: 0.3 })),
    draw(pose({ x: 12, y: 3, lean: -1, trail: 0, wave: 0.35, handN: [17, 1], handF: [19, 0], core: 1.2, wail: 1 })),
    draw(pose({ x: 12, y: 3, lean: -1, trail: 0, wave: 0.5, handN: [17, 1], handF: [19, 0], core: 1.3, wail: 1 })),
  ];
  // lunge through the target, claws raking down, tail stretched behind
  const attack = [
    draw(pose({ x: 17, y: 6, lean: 2.5, trail: 3, wave: 0.6, handN: [23, 9], handF: [23, 7], core: 1.2, wail: 1 })),
    draw(pose({ x: 17, y: 7, lean: 2.5, trail: 3, wave: 0.75, handN: [22, 15], handF: [23, 14], core: 1, wail: 0.6 })),
    draw(pose({ x: 15, y: 6, lean: 1.5, trail: 2, wave: 0.9, handN: [20, 13], handF: [21, 12], core: 0.9 })),
  ];
  // the wraith convulses, rises and comes apart into rime; a frost stain is left on the floor
  const rise = draw(pose({ x: 13, y: 4, lean: 0, trail: 1, wave: 0.3, handN: [17, 3], handF: [19, 2], core: 1.1, wail: 1 }));
  const corpse = [
    rise,
    fade(rimeify(draw(pose({ x: 13, y: 3, lean: 0, trail: 2, wave: 0.5, handN: [17, 2], handF: [19, 1], core: 0.6, wail: 1 })), 0.3, 0.8), 0.6),
    withStain(fade(rimeify(draw(pose({ x: 13, y: 2, lean: 0, trail: 3, wave: 0.7, handN: [17, 1], handF: [19, 0], core: 0.3, wail: 1 })), 0.6, 0.5), 0.25), 0.5),
    withStain(new Frame(W, H), 1),
  ];
  return monsterSprites({
    id: 'rimeshade',
    anchorX: 12,
    anchorY: GROUND + 1,
    anims: {
      idle: anim(idle, 6, true),
      move: anim(move, 10, true),
      windup: anim(windup, 7, false),
      attack: anim(attack, 12, false),
      corpse: anim(corpse, 6, false),
    },
  });
}

/** A faint rime stain on the floor under where the shade came apart. */
function withStain(f: Frame, k: number): Frame {
  const pts: [number, number, number][] = [
    [8, GROUND, 0.5], [9, GROUND, 0.7], [10, GROUND, 0.8], [11, GROUND, 0.9], [12, GROUND, 0.9], [13, GROUND, 0.8], [14, GROUND, 0.6], [15, GROUND, 0.4],
    [10, GROUND - 1, 0.4], [12, GROUND - 1, 0.6], [13, GROUND - 1, 0.3],
  ];
  for (const [x, y, a] of pts) f.c.plot(x, y, (C.ossFrost & 0xffffff00) | Math.round(170 * a * k));
  f.glowSoft(12, GROUND - 1, C.ice, 0.8 * k, 150);
  f.glowSoft(9, GROUND - 2, C.frost, 0.6 * k, 110);
  return f;
}
