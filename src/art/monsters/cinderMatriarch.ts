// Cinder Matriarch — the boss. A towering brood queen: an obsidian queen's torso with a molten heart rises from a
// spider's cephalothorax; eight legs radiate from it, each arching to a high knee and landing on an angled, pointed
// tarsus. Behind her hangs a clean dark brood sac banded with lava seams, glowing eggs clustered beneath. A crown of
// three great horns with lava-hot tips, a pale mask with burning eyes and long arms ending in bone talons.
//
// The telegraphs are whole-body: in the windup the front of her rears up, both talons rise overhead and the heart
// flares white-hot; the attack drives both talons into the ground in front of her.
import type { SpriteDef } from '../../contracts/art';
import { Frame } from '../frame';
import { C, RAMPS, type Ramp } from '../palette';
import { lineCells } from '../raster';
import { Sculpt, type PrimStyle } from '../shade';
import { anim, ashify, finish, monsterSprites, onBody, px, squash } from './common';

const W = 64;
const H = 66;
const FEET = 62;
const OY = 5; // vertical headroom for the rearing windup

const OBS: Ramp = [C.ink, C.basaltDeep, C.basaltDark, C.basalt, C.basaltLight, C.basaltHi, C.stone];
const shell: PrimStyle = { ramp: OBS, bias: 0.7, dither: 0.08 };
const shellFar: PrimStyle = { ramp: OBS, bias: -1.2, dither: 0 };
const talonStyle: PrimStyle = { ramp: [C.stone, C.stoneLight, C.ashGrey, C.bone, C.parchment], bias: 0.5, dither: 0 };
const talonFar: PrimStyle = { ramp: [C.char, C.stone, C.stoneLight, C.ashGrey], bias: 0, dither: 0 };
const sacStyle: PrimStyle = { ramp: OBS, bias: 0.3, dither: 0.08 };
const hornStyle: PrimStyle = { ramp: OBS, bias: 1.3, dither: 0.06 };
const maskStyle: PrimStyle = { ramp: [C.char, C.stone, C.stoneLight, C.ashGrey, C.bone], bias: 0.5, dither: 0 };
const veilStyle: PrimStyle = { ramp: [C.ink, C.coal, C.char, C.iron, C.stone], bias: 0.1, dither: 0.06, cyl: 0.4 };
const egg: PrimStyle = { ramp: RAMPS.ember.slice(1, 6), bias: 0.3, glow: 180, ao: false, dither: 0.1 };

type Pt = [number, number];
interface P {
  bob: number; // whole-body bob
  rear: number; // 0..1: the front rears up (windup)
  lean: number; // torso tilt, + = forward
  clawN: Pt;
  clawF: Pt;
  gait: number; // 0..1 leg cycle, -1 = standing still
  core: number; // heart glow 0..1 (> 1 = white-hot flare)
  crown: number; // horn tip glow 0..1
  collapse: number; // 0..1 legs buckle (corpse)
  slam: boolean; // impact burst under the talons
}
const base: P = { bob: 0, rear: 0, lean: 0.1, clawN: [50, 44 + OY], clawF: [54, 41 + OY], gait: -1, core: 0.8, crown: 0.7, collapse: 0, slam: false };
const pose = (p: Partial<P>): P => ({ ...base, ...p });

// Leg rest layout (near side, back → front): coxa on the cephalothorax, high knee, ankle, pointed foot.
// Far legs reuse it, pulled in and up (further from the camera).
const LEGS: { at: Pt; knee: Pt; ankle: Pt; foot: Pt }[] = [
  { at: [27, 41], knee: [12, 13], ankle: [3, 34], foot: [3, 57] },
  { at: [30, 42], knee: [21, 10], ankle: [14, 33], foot: [15, 57] },
  { at: [34, 42], knee: [44, 10], ankle: [51, 33], foot: [50, 57] },
  { at: [37, 41], knee: [53, 13], ankle: [61, 34], foot: [61, 57] },
];

/**
 * Three long bone talons fanning out from a hand, each curling down at its tip. They point along the forearm
 * (elbow → hand), so raised hands hold their claws up and a slam drives them into the ground.
 */
function talons(s: Sculpt, hand: Pt, elbow: Pt, style: PrimStyle): void {
  const a = Math.atan2(hand[1] - elbow[1], hand[0] - elbow[0]);
  for (const spread of [-0.55, 0, 0.55]) {
    const d = a + spread;
    const mid: Pt = [hand[0] + Math.cos(d) * 3.4, hand[1] + Math.sin(d) * 3.4];
    const curl = d + 0.9;
    const tip: Pt = [mid[0] + Math.cos(curl) * 2.6, mid[1] + Math.sin(curl) * 2.6];
    s.cap(hand[0], hand[1], mid[0], mid[1], 1.1, 0.8, style);
    s.cap(mid[0], mid[1], tip[0], tip[1], 0.8, 0.3, { ...style, bias: (style.bias ?? 0) + 0.4 });
  }
}

function draw(p: P): Frame {
  const f = new Frame(W, H);
  const s = new Sculpt();
  const by = p.bob + p.collapse * 10;
  const rear = p.rear;

  const legPose = (i: number, far: boolean): { at: Pt; knee: Pt; ankle: Pt; foot: Pt } => {
    const L = LEGS[i];
    const group = (i + (far ? 1 : 0)) % 2 === 0;
    const ph = p.gait < 0 ? 0 : ((p.gait + (group ? 0 : 0.5)) % 1) * Math.PI * 2;
    const swing = p.gait < 0 ? 0 : Math.sin(ph) * 2.5;
    const lift = p.gait < 0 ? 0 : Math.max(0, Math.cos(ph)) * 3;
    const front = i >= 2;
    // rearing lifts the front legs off the ground and raises every knee at the front
    const rise = front ? rear * (i === 3 ? 9 : 5) : rear * 1.5;
    const pull = far ? 0.82 : 1; // far legs spread less and sit higher
    const cx = 32;
    const sx = (x: number): number => cx + (x - cx) * pull;
    const at: Pt = [sx(L.at[0]), L.at[1] + OY + by - (front ? rear * 3 : rear) - (far ? 2 : 0)];
    const knee: Pt = [sx(L.knee[0]) + swing * 0.6, L.knee[1] + OY + by * 0.6 - lift * 0.4 - rise - (far ? 3 : 0)];
    const ankle: Pt = [sx(L.ankle[0]) + swing * 0.9, L.ankle[1] + OY + by * 0.4 - lift - rise * 0.8 - (far ? 3 : 0)];
    const foot: Pt = [sx(L.foot[0]) + swing + (front ? rear * 3 : 0), FEET - 0.5 - (far ? 3 : 0) - lift - rise];
    if (p.collapse > 0) {
      const k = p.collapse;
      knee[1] += k * 20;
      ankle[1] += k * 10;
      knee[0] += (at[0] - knee[0]) * 0.15 * k;
    }
    return { at, knee, ankle, foot };
  };
  const leg = (i: number, far: boolean, style: PrimStyle): void => {
    const { at, knee, ankle, foot } = legPose(i, far);
    s.cap(at[0], at[1], knee[0], knee[1], 2.5, 1.9, style);
    s.cap(knee[0], knee[1], ankle[0], ankle[1], 1.9, 1.3, style);
    s.cap(ankle[0], ankle[1], foot[0], foot[1], 1.3, 0.5, { ...style, bias: (style.bias ?? 0) + 0.3 });
  };

  // far legs, then the near back legs (the sac hides their roots)
  for (let i = 0; i < 4; i++) leg(i, true, shellFar);
  leg(0, false, { ...shell, bias: 0.3 });
  leg(1, false, { ...shell, bias: 0.4 });

  // brood sac: one clean dark oval behind, eggs clustered beneath its rear
  const sx = 19;
  const sy = 36 + OY + by + rear * 1.5;
  s.ell(sx, sy, 13.5, 10.5, sacStyle, -0.12 - rear * 0.08);
  s.ell(sx - 7, sy + 9.5, 3, 2.5, egg);
  s.ell(sx - 2.2, sy + 10.6, 2.8, 2.3, { ...egg, bias: 0.5 });
  s.ell(sx + 2.6, sy + 10, 2.3, 2, egg);
  // cephalothorax: the hub every leg radiates from
  const cx = 32;
  const cy = 41 + OY + by - rear * 2;
  s.ell(cx, cy, 8, 5.6, { ...shell, bias: 0.4 }, -rear * 0.2);
  // near front legs pass behind the queen's torso
  leg(2, false, { ...shell, bias: 0.6 });
  leg(3, false, { ...shell, bias: 0.8 });

  // the queen: torso rising from the front of the cephalothorax
  const tx = 36.5 + p.lean * 4 - rear * 1;
  const ty = 28 + OY + by - rear * 6;
  const hx = tx + 3.5 + p.lean * 3;
  const hy = ty - 15 - rear * 0.5;
  // ash veil falling from the crown down her back
  s.poly([[hx - 5, hy - 1], [hx - 1, hy - 3.5], [tx - 3, ty - 4], [tx - 8, ty + 4], [tx - 9.5, ty + 10], [tx - 5, ty + 7]], veilStyle, 1.5);
  // far arm (behind the torso)
  const shF: Pt = [tx + 3.5, ty - 7.5];
  const eF: Pt = [(shF[0] + p.clawF[0]) / 2 + 3, (shF[1] + p.clawF[1]) / 2 - 1];
  s.cap(shF[0], shF[1], eF[0], eF[1], 2.4, 1.8, shellFar);
  s.cap(eF[0], eF[1], p.clawF[0], p.clawF[1], 1.8, 1.5, shellFar);
  talons(s, p.clawF, eF, talonFar);
  s.ell(tx, ty, 6.8, 10.5, { ...shell, bias: 1 }, p.lean * 0.6 - rear * 0.15);
  // molten heart (emissive)
  const hcx = tx + 1.2;
  const hcy = ty - 1;
  const heat = Math.min(1.3, p.core);
  s.ell(hcx, hcy, 3 + heat * 0.6, 3.8 + heat * 0.6, { ramp: RAMPS.ember.slice(1, 7), bias: 0.2 + heat * 1.1, glow: 170 + 85 * Math.min(1, heat), ao: false, dither: 0.14 });
  // neck, crown of three great horns, head and mask
  s.cap(tx + 1.2, ty - 8.5, hx - 0.5, hy + 3, 2.6, 2.3, shell);
  const horns: [Pt, Pt, Pt][] = [
    [[hx - 3.5, hy - 2], [hx - 10, hy - 6.5], [hx - 13.5, hy - 13]],
    [[hx - 0.8, hy - 4.2], [hx - 3.2, hy - 11], [hx - 2.2, hy - 17.5]],
    [[hx + 2.4, hy - 3.4], [hx + 5.2, hy - 9], [hx + 4.4, hy - 13.5]],
  ];
  for (const [a, b, c] of horns) {
    s.cap(a[0], a[1], b[0], b[1], 2.6, 1.7, hornStyle);
    s.cap(b[0], b[1], c[0], c[1], 1.7, 0.5, hornStyle);
  }
  s.ell(hx, hy, 4.8, 5.4, { ...shell, bias: 0.6 }, 0.2);
  s.ell(hx + 1.8, hy + 0.8, 3.3, 4.4, maskStyle, 0.15);
  // shoulder plate with a spur, near arm with its talon hand
  const shN: Pt = [tx - 1.5, ty - 7];
  s.ell(shN[0], shN[1], 4.4, 3.2, { ...shell, bias: 0.9 }, -0.3);
  s.poly([[shN[0] - 4, shN[1] - 1], [shN[0] - 1.5, shN[1] - 2.5], [shN[0] - 5, shN[1] - 7]], hornStyle, 1);
  const eN: Pt = [(shN[0] + p.clawN[0]) / 2 + 2.5, (shN[1] + p.clawN[1]) / 2 + 1.5];
  s.cap(shN[0] + 1, shN[1] + 1, eN[0], eN[1], 2.5, 2, shell);
  s.cap(eN[0], eN[1], p.clawN[0], p.clawN[1], 2, 1.7, { ...shell, bias: 1 });
  talons(s, p.clawN, eN, talonStyle);
  s.render(f.c, f.e);

  const g = (k: number): number => 120 + 135 * Math.min(1, k);
  // lava seams banding the sac (curved with its surface), hottest at the middle band
  for (let band = 0; band < 3; band++) {
    const off = [-4.5, 0.5, 5.2][band];
    for (let x = Math.round(sx - 11); x <= Math.round(sx + 10); x++) {
      const u = (x - sx) / 13.5;
      const y = Math.round(sy + off + u * u * (band === 1 ? 1 : band === 0 ? -3 : 3) - u * 1.5);
      if (!f.c.opaque(x, y) || f.e.opaque(x, y) || Math.abs(u) > 0.92 - Math.abs(off) * 0.03) continue;
      const k = (x * 3 + band) % 7;
      f.glow(x, y, band === 1 && k < 2 ? C.flame : k < 4 ? C.ember : C.lavaDark, g(p.core) * (band === 1 ? 0.95 : 0.75));
    }
  }
  // cracks radiating from the heart over the torso
  const rays: Pt[] = [[-5, -6], [4, -7], [-5, 4], [2, 8], [5, 1], [-2, 9]];
  for (const [dx, dy] of rays) {
    lineCells(hcx, hcy, hcx + dx, hcy + dy, (x, y) => {
      if (!f.c.opaque(x, y) || f.e.opaque(x, y)) return;
      const d = Math.hypot(x - hcx, y - hcy);
      f.glow(x, y, d < 5 ? C.ember : C.lavaDark, g(p.core) * (1.1 - d / 10));
    });
  }
  // gold circlet where the horns meet the brow
  for (let dx = -4; dx <= 2; dx++) onBody(f, Math.round(hx + dx), Math.round(hy - 3.4 + Math.abs(dx + 1) * 0.25), dx < -1 ? C.gold : C.ochre);
  onBody(f, Math.round(hx - 1), Math.round(hy - 4.5), C.goldHi);
  onBody(f, Math.round(hx - 2), Math.round(hy - 4.2), C.gold);
  // burning eyes and mouth on the mask
  const ex = Math.round(hx + 2);
  const ey = Math.round(hy);
  f.glow(ex, ey, p.core > 0.95 ? C.white : C.hot, 255);
  f.glow(ex + 1, ey, C.flame, 240);
  f.glow(ex - 1, ey, C.ember, 210);
  f.glow(ex + 3, ey - 1, C.flame, 200);
  onBody(f, ex - 1, ey + 1, C.stone);
  for (let x = ex; x <= ex + 2; x++) f.glow(x, ey + 3, x === ex + 1 ? C.ember : C.lavaDark, g(p.core) * 0.85);
  // lava veins and hot tips on the horns
  for (const [, b, c] of horns) {
    const x = Math.round(c[0]);
    const y = Math.round(c[1]);
    f.glow(x, y, p.crown > 0.9 ? C.hot : C.flame, g(p.crown));
    lineCells(b[0], b[1], c[0], c[1], (lx, ly) => {
      if ((lx === x && ly === y) || !f.c.opaque(lx, ly)) return;
      const t = Math.hypot(lx - b[0], ly - b[1]) / Math.max(1, Math.hypot(c[0] - b[0], c[1] - b[1]));
      if (t > 0.4) f.glow(lx, ly, t > 0.72 ? C.ember : C.lavaDark, g(p.crown) * t);
    });
  }
  // knee spurs with a lava joint on the near legs
  for (let i = 0; i < 4; i++) {
    const { knee } = legPose(i, false);
    const x = Math.round(knee[0]);
    const y = Math.round(knee[1]) - 2;
    if (!f.c.opaque(x, y + 1)) continue;
    px(f, x, y, C.stone);
    px(f, x, y - 1, C.ashGrey);
    f.glow(x, y + 2, C.lavaDark, 150);
  }
  if (p.slam) {
    for (const claw of [p.clawN, p.clawF]) {
      const x = Math.round(claw[0]) + 2;
      for (const [dx, dy, c] of [[-5, 0, C.lavaDark], [-4, 0, C.ember], [-3, -1, C.flame], [-1, -2, C.hot], [1, -2, C.hot], [3, -1, C.flame], [4, 0, C.ember], [5, 0, C.lavaDark]] as const) {
        f.glow(x + dx, FEET + dy, c, 235);
      }
    }
  }
  return finish(f);
}

export function cinderMatriarchSprites(): SpriteDef[] {
  const breathe = [0, 0.5, 1, 0.5];
  const idle = [0, 1, 2, 3].map((i) =>
    draw(
      pose({
        bob: breathe[i],
        core: [0.7, 0.85, 1, 0.85][i],
        crown: [0.6, 0.75, 0.9, 0.75][i],
        clawN: [50, 44 + OY + breathe[i]],
        clawF: [54, 41 + OY + breathe[i]],
      }),
    ),
  );
  const move = [0, 1, 2, 3, 4, 5].map((i) => {
    const sw = Math.sin(((i + 0.5) / 6) * Math.PI * 2) * 1.5;
    return draw(pose({ gait: i / 6, bob: [0, 1, 0.5, 0, 1, 0.5][i], lean: 0.18, core: 0.85, crown: 0.75, clawN: [51 + sw, 45 + OY], clawF: [55 - sw, 42 + OY] }));
  });
  // rear up: the front lifts, both talons rise overhead, the heart flares
  const windup = [
    draw(pose({ rear: 0.4, lean: 0, clawN: [46, 26 + OY], clawF: [52, 22 + OY], core: 1, crown: 0.9 })),
    draw(pose({ rear: 0.85, lean: -0.1, clawN: [36, 6 + OY], clawF: [47, 2 + OY], core: 1.15, crown: 1, bob: -1 })),
    draw(pose({ rear: 1, lean: -0.15, clawN: [34, 3 + OY], clawF: [45, -1 + OY], core: 1.3, crown: 1, bob: -1 })),
    draw(pose({ rear: 1, lean: -0.15, clawN: [34, 3.5 + OY], clawF: [45, -0.5 + OY], core: 1.25, crown: 1, bob: -0.5 })),
  ];
  // slam: the whole front crashes down, talons driven into the ground ahead
  const attack = [
    draw(pose({ rear: 0.3, lean: 0.4, clawN: [55, 40 + OY], clawF: [58, 36 + OY], core: 1.1, crown: 1 })),
    draw(pose({ rear: -0.2, lean: 0.6, bob: 1.5, clawN: [56, FEET - 4], clawF: [59, FEET - 6], core: 1, crown: 0.9, slam: true })),
    draw(pose({ lean: 0.5, bob: 1, clawN: [55, FEET - 4], clawF: [58, FEET - 6], core: 0.9, crown: 0.8 })),
  ];
  const down = draw(pose({ collapse: 1, lean: 0.6, clawN: [54, FEET - 3], clawF: [58, FEET - 4], core: 0.35, crown: 0.3 }));
  const corpse = [
    draw(pose({ collapse: 0.5, lean: 0.45, clawN: [54, FEET - 6], clawF: [58, FEET - 8], core: 0.6, crown: 0.5 })),
    ashify(down, 0.4, 0.5),
    ashify(squash(down, 0.8, FEET), 0.85, 0.25),
  ];
  return monsterSprites({
    id: 'cinderMatriarch',
    anchorX: 32,
    anchorY: FEET + 1,
    anims: {
      idle: anim(idle, 4, true),
      move: anim(move, 7, true),
      windup: anim(windup, 5, false),
      attack: anim(attack, 9, false),
      corpse: anim(corpse, 5, false),
    },
  });
}
