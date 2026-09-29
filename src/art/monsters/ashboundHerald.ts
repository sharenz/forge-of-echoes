// Ashbound Herald — the lieutenant. A tall gliding figure in ash-grey robes and a burgundy mantle, faceless
// behind a bone mask with ember eye slits. It bears a banner staff crowned with the ember-spiral sigil, and
// burning runes orbit it (its empowering aura).
import type { SpriteDef } from '../../contracts/art';
import { Frame } from '../frame';
import { C, RAMPS, type Color, type Ramp } from '../palette';
import { lineCells } from '../raster';
import { Sculpt, type PrimStyle } from '../shade';
import { anim, ashify, finish, monsterSprites, onBody, px, squash } from './common';

const W = 44;
const H = 46;
const FEET = 43;

const ROBE: Ramp = [C.ink, C.coal, C.char, C.iron, C.stone, C.stoneLight];
const robe: PrimStyle = { ramp: ROBE, bias: -0.1, dither: 0.08 };
const mantle: PrimStyle = { ramp: [C.wineDeep, C.wineDark, C.burgundy, C.wineMid, C.wineLight], bias: -0.2, dither: 0.06 };
const mask: PrimStyle = { ramp: [C.stone, C.stoneLight, C.ashGrey, C.bone, C.parchment], bias: 0.3, dither: 0 };

type Pt = [number, number];
interface P {
  bob: number;
  lean: number; // + = forward
  staff: Pt; // top of the staff
  staffBase: Pt;
  wave: number; // banner flutter phase 0..1
  trail: number; // robe trailing back
  runes: number; // orbit phase 0..1
  runeGlow: number;
  runeGather: number; // 0 = orbit, 1 = gathered at the staff head
  glow: number;
  flare: number; // attack flare radius at the sigil
}

const base: P = { bob: 0, lean: 0, staff: [31, 7], staffBase: [31, FEET], wave: 0, trail: 0, runes: 0, runeGlow: 0.7, runeGather: 0, glow: 0.8, flare: 0 };
const P = (p: Partial<P>): P => ({ ...base, ...p });

// three tiny glyphs for the orbiting aura
const GLYPHS: string[][] = [
  ['.#.', '#.#', '.#.'],
  ['##.', '.#.', '.##'],
  ['#.#', '.#.', '#.#'],
];

function draw(p: P): Frame {
  const f = new Frame(W, H);
  const s = new Sculpt();
  const bx = 19 + p.lean;
  const by = p.bob;
  const [tx, ty] = p.staff;
  const [sx0, sy0] = p.staffBase;

  // banner hanging from a crossbar centred on the staff, in front of the robe
  const banner = new Frame(W, H);
  drawBanner(banner, tx, ty + 3, p.wave);

  // robe: tall, flaring to a ragged hem that trails behind when gliding
  const hem = FEET - 0.5;
  const pts: [number, number][] = [
    [bx - 3.6, 17 + by],
    [bx + 3.8, 17 + by],
    [bx + 6.4, hem - 6],
    [bx + 7.4, hem],
  ];
  // ragged hem, right to left
  for (let i = 0; i <= 8; i++) {
    const x = bx + 7.4 - i * (15.6 + p.trail) / 8;
    pts.push([x - p.trail * (i / 8) * 0.3, hem - (i % 2 === 0 ? 0 : 1.6) - (i / 8) * p.trail * 0.4]);
  }
  pts.push([bx - 7 - p.trail, hem - 6]);
  s.poly(pts, { ...robe, cyl: 0.8 }, 2);
  // mantle over the shoulders
  s.poly(
    [
      [bx - 5.4 - p.trail * 0.4, 21 + by],
      [bx - 4, 14.5 + by],
      [bx + 4, 14.5 + by],
      [bx + 5.4, 19 + by],
      [bx + 3, 23.5 + by],
      [bx - 1, 22.5 + by],
      [bx - 4.6 - p.trail * 0.6, 26 + by],
    ],
    { ...mantle, cyl: 0.5 },
    2,
    0,
    -0.2,
  );
  // hood
  s.ell(bx + 0.6, 11 + by, 4.2, 4.6, robe);
  s.poly([[bx - 2.8, 9 + by], [bx + 2, 7.2 + by], [bx - 3.2 - p.trail * 0.3, 4.4 + by]], { ...robe, bias: 0.2 }, 1.2);
  // bone mask in the hood opening
  s.ell(bx + 2.6, 11.6 + by, 2.2, 3.1, mask);
  // near arm holding the staff
  const hand: Pt = [tx - 0.5, Math.min(sy0 - 6, ty + 16)];
  s.cap(bx + 2, 17 + by, (bx + 2 + hand[0]) / 2 + 0.5, (17 + by + hand[1]) / 2 + 2.5, 1.8, 1.6, { ...robe, bias: -0.3 });
  s.cap((bx + 2 + hand[0]) / 2 + 0.5, (17 + by + hand[1]) / 2 + 2.5, hand[0], hand[1], 1.6, 1.9, { ...mantle, bias: -0.3 });
  const body = new Frame(W, H);
  s.render(body.c, body.e);

  // the staff: dark wood, iron bands; the banner and staff are in front of the body
  f.draw(body, 0, 0);
  f.draw(banner, 0, 0);
  lineCells(sx0, sy0, tx, ty, (x, y) => {
    if (y > hand[1] + 1 || y < hand[1] - 2) px(f, x, y, (x + y) % 5 === 0 ? C.metalLight : C.wood);
  });
  // gauntleted hand over the staff
  px(f, hand[0], hand[1], C.metalMid);
  px(f, hand[0] + 1, hand[1], C.metal);
  px(f, hand[0], hand[1] - 1, C.metalLight);

  // mask details: ember eye slits, dark mouth seam
  const g = 150 + 105 * p.glow;
  const mx = Math.round(bx + 2.6);
  const my = Math.round(11 + by);
  f.glow(mx, my, p.glow > 0.9 ? C.hot : C.flame, g);
  f.glow(mx + 1, my, C.ember, g * 0.85);
  onBody(f, mx - 1, my - 2, C.parchment);
  onBody(f, mx + 1, my + 2, C.stone);
  onBody(f, mx, my + 3, C.iron);
  // hood shadow over the mask's back edge
  for (let y = my - 3; y <= my + 3; y++) onBody(f, mx - 2, y, C.coal);

  // sigil head of the staff: iron ring with an ember spiral
  sigilHead(f, tx, ty, p.glow, p.flare);
  // ember seams along the robe hem
  for (let x = Math.round(bx - 6); x <= Math.round(bx + 6); x += 3) {
    const y = FEET - 2 - (x % 2);
    if (f.c.opaque(x, y)) f.glow(x, y, C.lavaDark, 120 + 60 * p.glow);
  }
  // orbiting aura runes
  for (let i = 0; i < 3; i++) {
    const a = (p.runes + i / 3) * Math.PI * 2;
    const ox = bx + Math.cos(a) * 12;
    const oy = 25 + by + Math.sin(a) * 4;
    const rx = Math.round(ox + (tx - ox) * p.runeGather);
    const ry = Math.round(oy + (ty - 5 - oy) * p.runeGather + (i - 1) * 3 * p.runeGather);
    // runes behind the body are dimmer and hidden where the body covers them
    const behind = Math.sin(a) < 0 && p.runeGather < 0.5;
    const col: Color = p.runeGlow > 0.9 ? C.hot : C.flame;
    GLYPHS[i].forEach((row, gy) =>
      [...row].forEach((ch, gx) => {
        if (ch !== '#') return;
        const x = rx + gx - 1;
        const y = ry + gy - 1;
        if (behind && f.c.opaque(x, y)) return;
        f.glow(x, y, behind ? C.ember : col, (behind ? 150 : 230) * (0.6 + 0.4 * p.runeGlow));
      }),
    );
  }
  return finish(f);
}

function drawBanner(f: Frame, tx: number, ty: number, wave: number): void {
  // crossbar with iron finials
  for (let x = tx - 5; x <= tx + 5; x++) px(f, x, ty, Math.abs(x - tx) === 5 ? C.metalLight : C.woodDark);
  // tattered cloth hanging from the crossbar, rippling
  const ramp = RAMPS.wine;
  for (let x = tx - 4; x <= tx + 4; x++) {
    const u = (x - (tx - 4)) / 8;
    const ripple = Math.sin((u * 1.6 + wave) * Math.PI * 2);
    // swallow-tailed, ragged lower edge
    const len = 14 + Math.round(ripple * 1.1) - (Math.abs(x - tx) <= 1 ? 3 : 0) - ((x * 7) % 3 === 0 ? 1 : 0);
    for (let y = 1; y <= len; y++) {
      const shade = 2.7 + ripple * 0.9 - (y / len) * 0.9 - u * 0.6;
      const c = ramp[Math.max(0, Math.min(ramp.length - 1, Math.round(shade)))];
      px(f, x + Math.round(ripple * 0.6 * (y / len)), ty + y, c);
    }
  }
  // a gold spiral stitched on the cloth
  const cx = tx;
  const cy = ty + 6;
  const spiral: Pt[] = [[0, 0], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1], [2, -1], [2, 0], [2, 1], [2, 2]];
  const r = Math.round(Math.sin((0.3 + wave) * Math.PI * 2) * 0.5);
  for (const [dx, dy] of spiral) if (f.c.opaque(cx + dx + r, cy + dy)) px(f, cx + dx + r, cy + dy, dx === 0 && dy === 0 ? C.goldHi : C.gold);
}

function sigilHead(f: Frame, x: number, y: number, glow: number, flare: number): void {
  const g = 150 + 105 * glow;
  // iron ring
  const ring: Pt[] = [
    [-1, -4], [0, -4], [1, -4], [2, -3], [3, -2], [3, -1], [3, 0], [2, 1], [1, 2], [0, 2], [-1, 2], [-2, 1], [-3, 0], [-3, -1], [-3, -2], [-2, -3],
  ];
  for (const [dx, dy] of ring) px(f, x + dx, y + dy, dy < -1 && dx <= 1 ? C.metalHi : dx < 0 ? C.metalLight : C.metal);
  // two iron prongs curling off the ring
  px(f, x - 3, y - 4, C.metalLight);
  px(f, x + 3, y - 4, C.metalMid);
  // ember core
  f.glow(x, y - 1, glow > 0.9 ? C.white : C.hot, g);
  f.glow(x - 1, y - 1, C.flame, g * 0.9);
  f.glow(x, y - 2, C.ember, g * 0.9);
  f.glow(x + 1, y - 1, C.ember, g * 0.8);
  f.glow(x, y, C.lavaDark, g * 0.7);
  if (flare > 0) {
    for (let r = 3; r <= 3 + flare; r++) {
      const k = 1 - (r - 3) / (flare + 1);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) f.glow(x + dx * r, y - 1 + dy * r, r < 4 ? C.flame : C.ember, 255 * k);
      if (r < 3 + flare * 0.6) for (const [dx, dy] of [[1, 1], [-1, -1], [1, -1], [-1, 1]] as const) f.glow(x + dx * (r - 1), y - 1 + dy * (r - 1), C.ember, 200 * k);
    }
  }
}

export function ashboundHeraldSprites(): SpriteDef[] {
  const idle = [0, 1, 2, 3, 4, 5].map((i) =>
    draw(P({ bob: [0, 0, 1, 1, 1, 0][i], wave: i / 6, runes: i / 18, runeGlow: 0.6 + 0.3 * Math.sin((i / 6) * Math.PI * 2), trail: 0.5 })),
  );
  const move = [0, 1, 2, 3, 4, 5].map((i) =>
    draw(P({ bob: [0, -1, -1, 0, -1, -1][i], lean: 1, wave: i / 6, runes: i / 12, runeGlow: 0.8, trail: 2.5 + (i % 3) * 0.5, staff: [32, 7], staffBase: [33, FEET - 1] })),
  );
  const windup = [
    draw(P({ staff: [30, 4], staffBase: [31, FEET - 3], runes: 0.1, runeGlow: 0.9, runeGather: 0.3, glow: 0.9, lean: -0.5 })),
    draw(P({ staff: [29, 5], staffBase: [30, FEET - 6], runes: 0.15, runeGlow: 1, runeGather: 0.65, glow: 1, lean: -1, bob: -1 })),
    draw(P({ staff: [29, 5], staffBase: [30, FEET - 6], runes: 0.2, runeGlow: 1, runeGather: 0.9, glow: 1, lean: -1, bob: -1 })),
    draw(P({ staff: [29, 5], staffBase: [30, FEET - 6], runes: 0.25, runeGlow: 1, runeGather: 1, glow: 1, lean: -1, bob: -1, flare: 1 })),
  ];
  const attack = [
    draw(P({ staff: [37, 9], staffBase: [26, FEET - 3], lean: 1.5, runes: 0.3, runeGlow: 1, glow: 1, flare: 4, wave: 0.3, trail: 2 })),
    draw(P({ staff: [36, 10], staffBase: [27, FEET - 2], lean: 1.2, runes: 0.35, runeGlow: 0.8, glow: 1, flare: 2, wave: 0.5, trail: 1.5 })),
    draw(P({ staff: [32, 7], staffBase: [31, FEET - 1], lean: 0.5, runes: 0.4, runeGlow: 0.7, glow: 0.8, wave: 0.7, trail: 1 })),
  ];
  const slump = draw(P({ bob: 10, staff: [36, 36], staffBase: [14, FEET], glow: 0.3, runeGlow: 0, runes: 0, trail: 3 }));
  const corpse = [
    draw(P({ bob: 5, staff: [34, 20], staffBase: [22, FEET], glow: 0.5, runeGlow: 0.3, trail: 2 })),
    ashify(squash(slump, 0.7, FEET), 0.5, 0.4),
    ashify(squash(slump, 0.45, FEET), 1, 0.2),
  ];
  return monsterSprites({
    id: 'ashboundHerald',
    anchorX: 19,
    anchorY: FEET + 1,
    anims: {
      idle: anim(idle, 6, true),
      move: anim(move, 8, true),
      windup: anim(windup, 6, false),
      attack: anim(attack, 10, false),
      corpse: anim(corpse, 6, false),
    },
  });
}
