// Player debuff overlays (GAME_SPEC §13): 'fx/debuff/<PLAYER_DEBUFFS>'.
//
// Every overlay is designed to sit ON the sorceress (≈18x26 px of body inside her 32x32 frame, feet at (16,30)).
// Frames are 32x36 and the anchor (16,33) is the FEET pivot, exactly like the player: draw the overlay at the
// player's (x, y), one sortY step in front of her, with the same flipX (east-facing art: "+x" is the side she faces).
// Overlay pixel (x, y) lies over sorceress pixel (x, y - 3). Everything is colour-baked with emissive masks (normal
// alpha blending, not additive) — no runtime tint is needed; the sources of `rooted` are separate frame ranges.
//
// Readability rules used throughout: nothing covers her face (overlay x 12..20, y 8..16); marks that must stay put
// sit on pixels that are body in EVERY pose (the charcoal skirt, overlay x 13..19, y 23..31); blood/fire never
// relies on hue alone against her burgundy hood — it is brighter, outlined or emissive.
//
//   id        frames              fps  what it shows
//   chilled   6 (loop)             8   rime crust at the feet, crystal clusters on the hem, frost patches on the
//                                      skirt, flakes drifting up beside her (never across the face)
//   frozen    4 (loop)             6   a semi-transparent faceted ice block encasing her, a glint sweeping across
//   rooted    4 × 4 sources        6   frames ROOTED_VARIANTS[source] + k (source = what holds her):
//                                      0–3 bone (default): segmented skeletal fingers burst from a cracked floor
//                                        ring on both sides and hook their talons over her feet
//                                      4–7 web (Frost Weaver): frost-silk strands from her legs out to the floor,
//                                        wraps round the skirt, sticky clumps, dew beads
//                                      8–11 chain (Chain Thrall / Chainmaster): the chain wound twice round her
//                                        legs, its loose end pulled across the floor to the hook bitten in
//                                      12–15 tar (tar pools): a glossy black puddle and a coat of tar on the hem
//                                        creeping up, long reflections, a drip, strings
//                                      each loop: relax → tighten → STRAIN (tugs down / taut) → ease
//   burning   6 (loop)            12   five discrete flame tongues (hem corners, hip, shoulder, hood) that grow,
//                                      lick and detach in turn, embers rising
//   bleeding  6 × 3 stacks        10   frames (stacks-1)*6 + k: 1–3 wounds on the skirt dripping 2x3 outlined drops
//                                      into a pool that grows with the stacks, one arterial spurt per loop
//   shocked   4 (loop)            16   crackling arcs jumping along her silhouette (emissive)
//   withered  6 × 3 stacks         8   frames (stacks-1)*6 + k: violet decay wisps (2 / 4 / 5 ribbons), motes, miasma
//
// Use `debuffOverlayFrame(debuff, seconds, { stacks, source })` to pick the frame. `DEBUFF_PLAYER_TINT` lists the
// multiply tint the presenter should put on the sorceress herself while chilled/frozen (the standard ARPG
// "she's cold" read; tint channels are u8, so ≤ 1).
import type { SpriteDef } from '../../contracts/art';
import type { PlayerDebuff } from '../../contracts/bestiary';
import { Frame } from '../frame';
import { C, type Color } from '../palette';
import { hash2 } from '../shade';
import { TAU, clamp01, glowMax, put, soft, sprite, walk } from './fxKit';

export const DEBUFF_W = 32;
export const DEBUFF_H = 36;
/** Feet pivot of every debuff overlay (overlay pixel = sorceress pixel + (0, 3)). */
export const DEBUFF_ANCHOR_X = 16;
export const DEBUFF_ANCHOR_Y = 33;

/** Loop length in frames and playback rate of each overlay (multi-range sprites hold several such loops). */
export const DEBUFF_LOOP: Readonly<Record<PlayerDebuff, { readonly frames: number; readonly fps: number }>> = {
  chilled: { frames: 6, fps: 8 },
  frozen: { frames: 4, fps: 6 },
  rooted: { frames: 4, fps: 6 },
  burning: { frames: 6, fps: 12 },
  bleeding: { frames: 6, fps: 10 },
  shocked: { frames: 4, fps: 16 },
  withered: { frames: 6, fps: 8 },
};

/** What holds a rooted player: Frost Weaver web → 'web', Chain Thrall / Chainmaster hook → 'chain', tar pool → 'tar'. */
export type RootSource = 'bone' | 'web' | 'chain' | 'tar';
/** First frame of each rooted source's 4-frame loop inside 'fx/debuff/rooted'. */
export const ROOTED_VARIANTS: Readonly<Record<RootSource, number>> = { bone: 0, web: 4, chain: 8, tar: 12 };
/** Debuffs whose sprite holds one loop per stack count (1..3), in order. */
export const DEBUFF_STACK_LOOPS: Readonly<Partial<Record<PlayerDebuff, number>>> = { bleeding: 3, withered: 3 };

/** Multiply tint for the sorceress sprite itself while the debuff is on her (channels ≤ 1). */
export const DEBUFF_PLAYER_TINT: Readonly<Partial<Record<PlayerDebuff, readonly [number, number, number]>>> = {
  chilled: [0.76, 0.88, 1],
  frozen: [0.6, 0.78, 1],
};

/**
 * Frame index into 'fx/debuff/<debuff>' at time `seconds` (any clock; the loop wraps). `stacks` (1..3) selects the
 * bleeding / withered loop, `source` the rooted variant (default 'bone').
 */
export function debuffOverlayFrame(debuff: PlayerDebuff, seconds: number, opts: { stacks?: number; source?: RootSource } = {}): number {
  const { frames, fps } = DEBUFF_LOOP[debuff];
  const k = ((Math.floor(seconds * fps) % frames) + frames) % frames;
  if (debuff === 'rooted') return ROOTED_VARIANTS[opts.source ?? 'bone'] + k;
  const loops = DEBUFF_STACK_LOOPS[debuff];
  if (loops) return (Math.max(1, Math.min(loops, Math.round(opts.stacks ?? 1))) - 1) * frames + k;
  return k;
}

const W = DEBUFF_W;
const H = DEBUFF_H;
const FEET = DEBUFF_ANCHOR_Y;

type Pt = readonly [number, number];

/** Value noise that is periodic in y only (period = `period` lattice cells), for seamlessly looping scrolls. */
function noiseY(x: number, y: number, scale: number, seed: number, period: number): number {
  const fx = x / scale;
  const fy = y / scale;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const tx = fx - ix;
  const ty = fy - iy;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const wy = (v: number): number => ((v % period) + period) % period;
  const a = hash2(ix, wy(iy), seed);
  const b = hash2(ix + 1, wy(iy), seed);
  const c = hash2(ix, wy(iy + 1), seed);
  const d = hash2(ix + 1, wy(iy + 1), seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** Quadratic Bézier sampled to a polyline. */
function curve(a: Pt, b: Pt, c: Pt, n = 6): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * b[0] + t * t * c[0], u * u * a[1] + 2 * u * t * b[1] + t * t * c[1]]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Chilled: a rime crust on the floor round her feet, irregular crystal clusters growing on the hem joined by a
// glaze of ice, frost patches on the skirt and capelet, a few crystals on the floor beside her and flakes drifting
// up on both sides (x 7..10 and 22..25, clear of the face).
// ---------------------------------------------------------------------------------------------------------------
/** A crystal: a 2 px spike leaning `lean` px per row, with diagonal side branches [row, dir, length]. */
function crystal(f: Frame, x: number, by: number, h: number, lean: number, branches: readonly (readonly [number, number, number])[], twinkle: boolean): void {
  for (const [j, dir, len] of branches) {
    if (j >= h - 1) continue;
    const bx = x + lean * j;
    for (let s = 1; s <= len; s++) {
      const tip = s === len;
      f.glow(Math.round(bx + dir * s), by - j - s, tip ? C.white : C.ice, tip ? 220 : 150);
    }
  }
  for (let j = 0; j < h; j++) {
    const cx = Math.round(x + lean * j);
    const y = by - j;
    const tip = j === h - 1;
    f.glow(cx, y, tip ? C.white : j === 0 ? C.frost : C.ice, tip ? (twinkle ? 255 : 210) : 150);
    if (!tip && j < h - 2) f.glow(cx + 1, y, j === 0 ? C.frostDark : C.frostMid, 90);
  }
  if (twinkle) {
    const tx = Math.round(x + lean * (h - 1));
    f.glowSoft(tx, by - h, C.ice, 0.7, 200);
    f.glowSoft(tx - 1, by - h + 1, C.ice, 0.45, 150);
    f.glowSoft(tx + 1, by - h + 1, C.ice, 0.45, 150);
  }
}

function chilled(k: number): Frame {
  const f = new Frame(W, H);
  const n = 6;
  const ph = (k / n) * TAU;
  // rime crust: a ragged band on the floor round her feet (behind her only at the sides)
  for (let y = FEET - 2; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (x + 0.5 - 16) / 12;
      const dy = (y + 0.5 - (FEET + 0.7)) / 2.5;
      const edge = 1 + (hash2(x, 0, 101) - 0.5) * 0.3;
      const d = Math.hypot(dx, dy);
      if (d > edge || d < 0.45) continue;
      if (y < FEET && Math.abs(x + 0.5 - 16) < 9.5) continue;
      const rim = d > edge - 0.2;
      const c = rim ? (hash2(x, y, 7) > 0.5 ? C.frost : C.frostMid) : hash2(x, y, 8) > 0.72 ? C.white : y <= FEET ? C.ice : C.ossFrost;
      f.glowSoft(x, y, c, rim ? 0.72 : 0.9, rim ? 80 : 115);
    }
  }
  // glaze: a 1 px skin of ice following the hem line (with breaks)
  for (let x = 11; x <= 21; x++) {
    if (hash2(x, 3, 17) > 0.8) continue;
    f.glowSoft(x, 31, x < 16 ? C.ice : C.frost, 0.62, 90);
  }
  // crystal clusters on the hem: irregular heights, leaning out, diagonal branches, asymmetric spacing
  const g = (i: number): number => (Math.sin(ph + i * 2.3) > 0.35 ? 1 : 0); // slow creeping growth, 1 px
  crystal(f, 12, 31, 4 + g(0), -0.28, [[1, -1, 2]], k === 1);
  crystal(f, 14.6, 31, 2, 0, [], false);
  crystal(f, 18, 31, 5 + g(1), 0.22, [[2, 1, 2], [1, -1, 1]], k === 4);
  crystal(f, 20.4, 30, 3, 0.4, [[0, 1, 1]], false);
  // frost flowers on the skirt (body in every pose) and on the capelet edge: a rime star with a glinting heart
  const flower = (x: number, y: number, big: boolean, lit: boolean): void => {
    f.glow(x, y, lit ? C.white : C.ice, lit ? 230 : 150);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) f.glowSoft(x + dx, y + dy, C.ice, big ? 0.62 : 0.45, 90);
    if (big) for (const [dx, dy] of [[1, 1], [-1, -1], [2, 0], [0, -2]]) f.glowSoft(x + dx, y + dy, C.frost, 0.35, 60);
  };
  flower(15, 26, true, k % 3 === 0);
  flower(18, 23, false, k % 3 === 1);
  flower(12, 21, false, k % 3 === 2);
  // crystals on the floor beside her
  crystal(f, 5, FEET + 1, 4, -0.2, [[1, -1, 1]], k === 2);
  crystal(f, 3, FEET + 1, 2, 0, [], false);
  crystal(f, 26, FEET + 1, 3, 0.3, [[0, 1, 1]], k === 5);
  crystal(f, 28, FEET + 2, 2, 0, [], false);
  // flakes drifting up beside her (x 7..10 and 22..25 only)
  for (let i = 0; i < 4; i++) {
    const u = ((k + i * 1.5) % n) / n; // 0 at the hem → 1 high up
    const x = [8.5, 23.5, 9, 23][i] + Math.round(Math.sin(u * TAU + i) * 1.2);
    const y = Math.round([29, 27, 22, 20][i] - u * 14);
    const a = u > 0.66 ? (1 - u) / 0.34 : 1;
    f.glowSoft(x, y, C.white, a, 255 * a);
    if (i < 2) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) f.glowSoft(x + dx, y + dy, C.frost, 0.55 * a, 140 * a);
  }
  return f;
}

// ---------------------------------------------------------------------------------------------------------------
// Frozen: a faceted block of clear ice encasing her. The faces are semi-transparent (she shows through, blued),
// the edges and ridges are crisp and lit from the top-left, crystal points crown it, and a glint sweeps across
// every loop.
// ---------------------------------------------------------------------------------------------------------------
const BLOCK: readonly Pt[] = [
  [4, 34], [3, 23], [4, 12], [7, 7], [10, 7.5], [13, 2], [17, 5], [20, 2.5], [24, 7], [28, 12], [29, 23], [28, 34],
];

function insidePoly(pts: readonly Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function frozen(k: number): Frame {
  const f = new Frame(W, H);
  // frost crust on the floor, wider than the block
  for (let y = FEET - 2; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot((x + 0.5 - 16) / 15.5, (y + 0.5 - (FEET + 0.8)) / 2.6);
      if (d > 1) continue;
      const nn = hash2(x, y, 41);
      if (d > 0.8 && nn > 0.55) continue;
      f.glowSoft(x, y, d < 0.6 ? C.ice : nn > 0.5 ? C.ossFrost : C.frost, 0.9, 100);
    }
  }
  // faces: left | front | right, and the top facets above the slanted top line
  const ridgeL = (y: number): number => 9 + (y - 34) * 0.06;
  const ridgeR = (y: number): number => 22 + (y - 34) * -0.05;
  const topLine = (x: number): number => (x < 16 ? 12 - (x - 4) * 0.25 : 9 + (x - 16) * 0.25);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      if (!insidePoly(BLOCK, cx, cy)) continue;
      let col: Color;
      let a: number;
      if (cy < topLine(cx)) {
        col = C.ice;
        a = 0.66;
      } else if (cx < ridgeL(cy)) {
        col = C.ice;
        a = 0.46;
      } else if (cx > ridgeR(cy)) {
        col = C.mana;
        a = 0.5;
      } else {
        col = C.frost;
        a = 0.34;
      }
      a += clamp01((cy - 20) / 14) * 0.12; // denser ice towards the floor
      f.glowSoft(x, y, col, a, 30);
    }
  }
  // ridges between the faces
  for (let y = 12; y <= 33; y++) {
    f.glowSoft(Math.round(ridgeL(y)), y, C.white, 0.5, 110);
    f.glowSoft(Math.round(ridgeR(y)), y, C.frost, 0.55, 90);
  }
  for (let x = 5; x <= 27; x++) {
    const y = Math.round(topLine(x + 0.5) - 0.5);
    if (insidePoly(BLOCK, x + 0.5, y + 0.5)) f.glowSoft(x, y, C.white, 0.55, 120);
  }
  // silhouette edge: bright on the lit (top-left) side, deep blue on the shadow side
  for (let i = 0; i < BLOCK.length; i++) {
    const [x0, y0] = BLOCK[i];
    const [x1, y1] = BLOCK[(i + 1) % BLOCK.length];
    if (y0 === 34 && y1 === 34) continue;
    const nx = y1 - y0;
    const ny = -(x1 - x0);
    const lit = nx * -0.6 + ny * -0.8 < 0;
    walk(x0, y0, x1, y1, (_t, x, y) => {
      const xx = Math.min(W - 1, Math.max(0, x - (x > 16 ? 1 : 0)));
      f.glow(xx, y, lit ? C.ice : C.frostMid, lit ? 170 : 110);
    });
  }
  // crown points: bright tips
  for (const [x, y] of [[13, 2], [20, 3], [7, 7]]) f.glow(x, y, C.white, 255);
  // bottom rim sitting in the crust
  for (let x = 4; x <= 27; x++) f.glowSoft(x, 34, x < 16 ? C.ice : C.frost, 0.9, 110);
  // internal fractures
  const cracks: Pt[][] = [
    [[6, 15], [8, 18], [7, 21], [9, 25]],
    [[25, 28], [23, 25], [25, 21]],
    [[14, 31], [16, 29], [15, 27]],
  ];
  for (const c of cracks) {
    for (let i = 0; i + 1 < c.length; i++) walk(c[i][0], c[i][1], c[i + 1][0], c[i + 1][1], (_t, x, y) => f.glowSoft(x, y, C.white, 0.5, 130));
  }
  // chunky crystal spurs growing out of the flanks: 2 px wide wedges, lit on top, white point
  const spur = (x0: number, y0: number, dx: number, dy: number, len: number): void => {
    for (let j = 0; j < len; j++) {
      const x = Math.round(x0 + dx * j);
      const y = Math.round(y0 + dy * j);
      const tip = j === len - 1;
      f.glow(x, y, tip ? C.white : C.ice, tip ? 255 : 190);
      if (!tip) f.glow(x, y + 1, C.frostMid, 120);
    }
  };
  spur(4, 20, -0.8, -0.6, 4);
  spur(3, 27, -0.9, -0.3, 3);
  spur(28, 18, 0.8, -0.6, 4);
  spur(28, 26, 0.9, -0.35, 3);
  // sweeping glint: a diagonal band crossing the block, left to right across the loop
  const gx = -6 + k * 11;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!insidePoly(BLOCK, x + 0.5, y + 0.5)) continue;
      const d = x + y * 0.6 - (gx + 12);
      if (d >= 0 && d < 2) f.glowSoft(x, y, C.white, d < 1 ? 0.5 : 0.28, 180);
    }
  }
  // twinkle
  f.glow(10 + (k & 1) * 12, 10 + (k >> 1) * 12, C.white, 255);
  return f;
}

// ---------------------------------------------------------------------------------------------------------------
// Rooted: four restraints, one per source, each a 4-frame loop relax → tighten → strain (tugs down) → ease.
// ---------------------------------------------------------------------------------------------------------------
/** Grip tension per loop frame (frame 2 is the strain frame). */
const GRIP = [0, 0.55, 1, 0.4] as const;

/** Sample a quadratic curve into unique pixel cells with their parameter t (0 at `a`, 1 at `c`). */
function curveCells(a: Pt, b: Pt, c: Pt): [number, number, number][] {
  const pts = curve(a, b, c, 14);
  const out: [number, number, number][] = [];
  const seen = new Set<number>();
  for (let i = 0; i + 1 < pts.length; i++) {
    walk(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], (u, x, y) => {
      const key = y * 64 + x;
      if (seen.has(key)) return;
      seen.add(key);
      out.push([x, y, (i + u) / (pts.length - 1)]);
    });
  }
  return out;
}

/** Cracked floor ring the claws burst through: ink crack, stone-light lip, chips (front half + sides only). */
function crackRing(f: Frame, rx: number, ry: number): void {
  const cx = 16;
  const cy = FEET + 0.6;
  for (let a = 0; a < 360; a += 3) {
    const t = (a * Math.PI) / 180;
    const x = Math.round(cx + Math.cos(t) * rx - 0.5);
    const y = Math.round(cy + Math.sin(t) * ry - 0.5);
    if (y < FEET - 1 || (y < FEET && Math.abs(x + 0.5 - cx) < 8)) continue; // the back half hides behind her
    f.c.set(x, y, C.ink);
    const ly = Math.sin(t) >= 0 ? y + 1 : y - 1; // lip on the outside
    if (ly < H && !f.c.opaque(x, ly)) f.c.set(x, ly, Math.sin(t) >= 0 ? C.stoneLight : C.stone);
  }
  for (const [x0, y0, x1, y1] of [[5, 34, 2, 35], [27, 34, 30, 35]] as [number, number, number, number][]) walk(x0, y0, x1, y1, (_t, x, y) => f.c.set(x, y, C.ink));
  for (const [x, y] of [[2, 33], [30, 33], [8, 35], [24, 35]]) f.c.set(x, y, C.stoneLight);
}

/**
 * A bony finger: 2 px at the root, 1 px towards the point, segmented into phalanges (a crease with a lit knuckle
 * before it), lit on its top-left, and ending in a talon that hooks down over what it grips (`hook`).
 */
function claw(f: Frame, a: Pt, b: Pt, c: Pt, hook: Pt): void {
  const cells = curveCells(a, b, c);
  const body = new Set(cells.map(([x, y]) => y * 64 + x));
  for (const [x, y, t] of cells) {
    if (t > 0.58) continue;
    // shadow side: below on flat runs, right on steep ones
    const [nx, ny] = cells.find(([, , u]) => u > t + 0.05) ?? [x, y - 1];
    const steep = Math.abs(ny - y) >= Math.abs(nx - x);
    const sx = steep ? x + 1 : x;
    const sy = steep ? y : y + 1;
    if (!body.has(sy * 64 + sx)) put(f, sx, sy, C.ashGrey);
  }
  const joints = [0.34, 0.68];
  cells.forEach(([x, y, t], i) => {
    const crease = joints.some((j) => Math.abs(t - j) < 0.035);
    const knuckle = !crease && cells[i + 1] && joints.some((j) => Math.abs(cells[i + 1][2] - j) < 0.035);
    put(f, x, y, crease ? C.stoneLight : knuckle ? C.parchment : t > 0.86 ? C.parchment : C.bone);
  });
  // the talon: a short hooked point curling down past the tip
  const [tx, ty] = cells[cells.length - 1];
  walk(tx, ty, hook[0], hook[1], (u, x, y) => put(f, x, y, u > 0.5 ? C.white : C.parchment));
}

/** Bone: a buried skeletal hand's claws burst from a cracked ring round her feet and close over them. */
function rootedBone(k: number): Frame {
  const f = new Frame(W, H);
  crackRing(f, 10.5, 2.6);
  const clawSet = (t: number, right: boolean): void => {
    const c = t * 1.6;
    const tug = t > 0.9 ? 1 : 0;
    const X = (x: number): number => (right ? 32 - x : x);
    const t1: Pt = [X(11.5 + c), 24.5 + c * 0.7 + tug];
    const t2: Pt = [X(13.6 + c * 0.6), 28.6 + c * 0.5 + tug];
    const dir = right ? -1 : 1;
    claw(f, [X(7.5), 34.5], [X(5), 26.5], t1, [t1[0] + dir * 1.2, t1[1] + 1.6]);
    claw(f, [X(11), 35.5], [X(9.2), 30.5], t2, [t2[0] + dir * 1, t2[1] + 1.4]);
  };
  // the right claws lag a frame behind the left, so the grip ripples
  clawSet(GRIP[(k + 3) % 4], true);
  clawSet(GRIP[k], false);
  f.outline({ selective: true });
  // cold glints on the points so the grip reads on dark floors
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (f.c.get(x, y) === C.white) f.emit(x, y, C.ossFrost, 120);
  return f;
}

/** Frost-silk: strands stretched from her legs to the floor on both sides, wraps round the skirt, sticky clumps. */
function rootedWeb(k: number): Frame {
  const f = new Frame(W, H);
  const t = GRIP[k];
  const tug = t > 0.9 ? 1 : 0;
  const silk = (x: number, y: number, bright: boolean): void => {
    f.glow(x, y, bright ? C.white : C.ice, bright ? 150 : 110);
    if (!f.c.opaque(x, y + 1)) f.glowSoft(x, y + 1, C.frostMid, 0.55, 50);
  };
  // anchor strands: from the body out to the floor, slack when she relaxes, taut when she strains
  const anchors: [number, number, number, number][] = [
    [11, 26, 1, 32], [12, 30, 3, 35], [14, 32, 9, 35.5],
    [21, 25, 31, 31], [20, 30, 29, 35], [18, 32, 23, 35.5],
  ];
  anchors.forEach(([x0, y0, x1, y1], i) => {
    const sag = (1 - t) * 1.6;
    const cells = curveCells([x0, y0 + tug], [(x0 + x1) / 2, (y0 + y1) / 2 + sag], [x1, y1]);
    for (const [x, y, u] of cells) silk(x, y, u < 0.3 || (i + k) % 3 === 0);
    // a tuft where the strand is glued to the floor
    f.glowSoft(Math.round(x1) + (x1 < 16 ? -1 : 1), Math.round(y1), C.ice, 0.7, 90);
  });
  // wraps round the lower skirt: wavy bands that cinch tighter (lower, straighter) with the grip
  const wraps = [26.5, 29, 31.2];
  wraps.forEach((wy, i) => {
    for (let x = 11; x <= 21; x++) {
      const y = Math.round(wy + tug + Math.sin(x * 0.9 + i * 1.7) * (0.9 - t * 0.6) + (x - 16) * (i === 1 ? -0.18 : 0.12));
      if (hash2(x, i, 404) > 0.9) continue;
      silk(x, y, (x + i) % 4 !== 1);
    }
  });
  // sticky clumps where the anchors meet the body
  for (const [cx, cy] of [[11, 26], [12, 30], [20, 25], [20, 30]] as Pt[]) {
    for (const [dx, dy, c, s] of [[0, 0, C.white, 200], [1, 0, C.ice, 140], [0, 1, C.ice, 130], [1, 1, C.frost, 100]] as [number, number, Color, number][]) f.glow(cx + dx, cy + dy + tug, c, s);
  }
  // dew beads running along the strands
  const beads: Pt[] = [[6, 29], [26, 28], [7, 33], [25, 33]];
  const [bx, by] = beads[k];
  f.glow(bx, by, C.white, 255);
  f.glowSoft(bx + 1, by, C.ice, 0.7, 180);
  f.glowSoft(bx, by - 1, C.ice, 0.5, 160);
  return f;
}

/**
 * Chain: the thrower's chain wound twice round her legs (segmented links, bright tops, dark gaps) and its loose end
 * pulled away across the floor to the hook bitten into the ground — it cinches and yanks with the grip.
 */
function rootedChain(k: number): Frame {
  const f = new Frame(W, H);
  const t = GRIP[k];
  const tug = t > 0.9 ? 1 : 0;
  const glints: Pt[] = [];
  /** Links along a path: two lit cells per link, then a dark gap; `phase` shifts the pattern (the chain slides). */
  const links = (cells: [number, number, number][], phase: number): void => {
    cells.forEach(([x, y], i) => {
      const p = (i + phase) % 3;
      if (p === 2) {
        put(f, x, y, C.metalDark);
        put(f, x, y + 1, C.ink);
        return;
      }
      put(f, x, y, p === 0 ? C.metalHi : C.metalLight);
      put(f, x, y + 1, p === 0 ? C.metalMid : C.metal);
      if (p === 0 && i % 2 === 0) glints.push([x, y]);
    });
  };
  const squeeze = t * 0.8;
  // the loose end first (it runs behind the coils where they overlap): down-right across the floor to the hook
  const sag = (1 - t) * 2;
  links(curveCells([21, 31 + tug], [26, 34 + sag * 0.5], [29 + tug, 33]), k);
  // coils round the skirt, lower one first; each ends in a short turn where it wraps round her silhouette
  links(curveCells([10.5, 29.5 + tug], [16, 32.5 + squeeze + tug], [21.5, 30 + tug]), k);
  links(curveCells([10.5, 25.5 + squeeze + tug], [16, 29 + squeeze + tug], [21.5, 26.5 + squeeze + tug]), k + 1);
  for (const y of [25.5 + squeeze, 29.5]) {
    put(f, 10, Math.round(y + 0.5 + tug), C.metalMid);
    put(f, 22, Math.round(y + tug), C.metal);
  }
  // the hook bitten into the floor at the end of the chain: a ring and one fluke sticking up out of the ground
  const hx = 29 + tug;
  for (const [x, y, c] of [
    [hx, 32, C.metalHi], [hx + 1, 32, C.metalLight], [hx + 2, 31, C.metalHi], [hx + 2, 30, C.white], [hx + 1, 33, C.metal], [hx + 2, 33, C.metalDark],
  ] as [number, number, Color][]) put(f, x, y, c);
  glints.push([hx + 2, 30]);
  f.outline({ selective: false, color: C.ink });
  for (const [x, y] of glints) f.emit(x, y, C.metalHi, 140);
  // the strain frame rattles a link bright
  if (tug) f.glow(25, 34, C.white, 220);
  return f;
}

/**
 * Tar: a black puddle round her feet and a wet coat of it clinging to the hem, creeping up as the grip tightens;
 * long sharp reflections (never spots), a drip sliding off the coat and strings stretching out across the floor.
 */
function rootedTar(k: number): Frame {
  const f = new Frame(W, H);
  const t = GRIP[k];
  const rise = t * 1.6;
  const coatTop = (x: number): number => {
    const edge = Math.max(0, Math.abs(x - 16) - 4.5); // the coat's ends roll down at her sides
    return 29.6 - rise + 0.7 * Math.sin(x * 1.25 + 0.6) + edge * edge * 0.35;
  };
  const inCoat = (x: number, y: number): boolean => x > 9.6 && x < 22.4 && y >= coatTop(x) && y <= 33.6;
  const inPool = (x: number, y: number): boolean => Math.hypot((x - 16) / 11.5, (y - 34.3) / 1.9) <= 1;
  const tar = (x: number, y: number): boolean => inCoat(x, y) || inPool(x, y);
  for (let y = 22; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      if (!tar(cx, cy)) continue;
      const top = !tar(cx, cy - 1);
      const lowRight = !tar(cx + 1, cy + 1) && !tar(cx, cy + 1);
      put(f, x, y, top ? C.char : lowRight ? C.rustDeep : hash2(x, y, 919) > 0.8 ? C.coal : C.ink);
    }
  }
  // strings stretching from the puddle across the floor (thin and broken on the strain frame)
  for (const [x0, y0, x1, y1] of [[5, 34, 1, 35], [27, 34, 31, 35]] as [number, number, number, number][]) {
    walk(x0, y0, x1 + (t > 0.9 ? (x1 < 16 ? -1 : 1) : 0), y1, (u, x, y) => {
      if (t > 0.9 && u > 0.35 && u < 0.7 && (x & 1)) return;
      put(f, x, y, C.coal);
    });
  }
  // a drip sliding off the coat's right end into the puddle
  const dripY = [31, 32, 33, 34][k];
  put(f, 22, dripY, C.coal);
  if (k < 3) put(f, 22, dripY - 1, C.ink);
  f.outline({ selective: false, color: C.ink });
  // reflections: a long streak across the coat, one on the puddle, a pin-point — sharp and emissive
  const spec = (x: number, y: number, c: Color, s: number): void => {
    const cur = f.c.get(x, y);
    if (cur === C.ink || cur === C.coal || cur === C.char || cur === C.rustDeep) f.glow(x, y, c, s);
  };
  const sy = Math.round(coatTop(13) + 1.2);
  spec(11, sy + 1, C.stone, 100);
  spec(12, sy, C.ashGrey, 150);
  spec(13, sy, C.bone, 200);
  spec(14, sy, C.white, 240);
  spec(15, sy, C.ashGrey, 130);
  spec(19, Math.round(coatTop(19) + 1.4), C.bone, 170);
  spec(20, Math.round(coatTop(20) + 1.4), C.ashGrey, 120);
  spec(7, 34, C.stone, 100);
  spec(8, 34, C.ashGrey, 140);
  spec(9, 34, C.bone, 180);
  spec(24, 35, C.stone, 100);
  // a bubble swelling and popping across the loop
  const b = [0, 1, 2, -1][k];
  if (b >= 0) {
    f.c.set(25, 34, C.char);
    if (b > 0) f.c.set(26, 34, C.char);
    f.glow(25, 34 - (b === 2 ? 1 : 0), C.stone, 120);
  }
  return f;
}

function rooted(v: RootSource, k: number): Frame {
  if (v === 'web') return rootedWeb(k);
  if (v === 'chain') return rootedChain(k);
  if (v === 'tar') return rootedTar(k);
  return rootedBone(k);
}

// ---------------------------------------------------------------------------------------------------------------
// Burning: five discrete flame tongues rooted on her silhouette (both hem corners, a hip, a shoulder, the back of
// the hood). Each is a teardrop that tapers to a 1 px tip and runs a grow → lick → detach cycle; the cycles are
// offset so three or four are always alight. White core at the base, flame body, ember edge, lava-dark tip.
// ---------------------------------------------------------------------------------------------------------------
interface Tongue {
  x: number;
  y: number;
  /** Full height (px) and base width. */
  h: number;
  w: number;
  /** Lean of the tip (px, + = east). */
  lean: number;
  /** Loop phase offset (frames). */
  off: number;
}

const TONGUES: readonly Tongue[] = [
  { x: 11.5, y: 32.5, h: 9, w: 4.6, lean: -1.4, off: 0 }, // left hem corner
  { x: 21, y: 32.5, h: 8, w: 4.4, lean: 1.3, off: 3 }, // right hem corner
  { x: 12.5, y: 26, h: 7, w: 3.6, lean: -1, off: 2 }, // hip
  { x: 21, y: 21.5, h: 7, w: 3.4, lean: 0.9, off: 5 }, // shoulder
  { x: 11, y: 13, h: 6, w: 3, lean: -1.6, off: 1 }, // back of the hood
];

/** Height factor and detach state of a tongue over its 6-frame cycle. */
const LICK = [0.5, 0.8, 1, 1.12, 0.62, 0.38] as const;

function flameTongue(f: Frame, tg: Tongue, p: number): void {
  const hf = LICK[p];
  const h = tg.h * hf;
  const sway = Math.sin((p / 6) * TAU + tg.off) * 0.8;
  const FIRE = [C.lavaDark, C.ember, C.flame, C.hot];
  const x0 = Math.floor(tg.x - tg.w);
  const x1 = Math.ceil(tg.x + tg.w + Math.abs(tg.lean) + 1);
  const yTop = Math.floor(tg.y - h - 1);
  const yBot = Math.ceil(tg.y + tg.w * 0.35);
  for (let y = yTop; y <= yBot; y++) {
    for (let x = x0; x <= x1; x++) {
      const cy = y + 0.5;
      const u = (tg.y - cy) / h; // 0 at the base line, 1 at the tip; negative = the rounded bottom
      let half: number;
      if (u < 0) {
        const b = -u / (tg.w * 0.35 / h);
        if (b > 1) continue;
        half = (tg.w / 2) * Math.sqrt(1 - b * b);
      } else {
        if (u > 1) continue;
        half = (tg.w / 2) * Math.pow(1 - u, 1.15) + 0.35;
      }
      const cxu = tg.x + (tg.lean * u + sway * u * u);
      const dx = Math.abs(x + 0.5 - cxu);
      if (dx > half) continue;
      const edge = dx > half - 0.9;
      // colour by height (distance from the base), cooler at the rim
      let heat = 1 - clamp01(u) * 0.95 - (edge ? 0.35 : 0);
      if (u > 0.78) heat = Math.min(heat, 0.05);
      const col = FIRE[Math.max(0, Math.min(3, Math.round(heat * 3)))];
      f.glow(x, y, col, 150 + 105 * clamp01(heat));
    }
  }
  // white-hot core at the base
  f.glow(Math.round(tg.x - 0.5), Math.round(tg.y - 1.5), C.white, 255);
  if (p === 2 || p === 3) f.glow(Math.round(tg.x - 0.5), Math.round(tg.y - 2.5), C.hot, 255);
  // detached tip: a flame blob breaking off and rising
  if (p >= 3) {
    const rise = p === 3 ? 1.5 : p === 4 ? 4 : 6.5;
    const bx = Math.round(tg.x + tg.lean * 1.1 + sway - 0.5);
    const by = Math.round(tg.y - tg.h * 1.05 - rise);
    const hot = p === 3;
    glowMax(f, bx, by, hot ? C.flame : C.ember, hot ? 240 : 200);
    if (p <= 4) glowMax(f, bx, by + 1, p === 3 ? C.ember : C.lavaDark, 190);
  }
}

function burning(k: number): Frame {
  const f = new Frame(W, H);
  // a ragged strip of fire along the hem (2–3 px, flickering)
  for (let x = 11; x <= 21; x++) {
    const n = hash2(x, k, 1311);
    if (n < 0.22) continue; // broken, so it never reads as a solid bar
    const hgt = 1 + Math.floor(n * 2.4);
    for (let j = 0; j < hgt; j++) {
      const y = 32 - j;
      const top = j === hgt - 1;
      f.glow(x, y, top ? (hgt === 1 ? C.ember : C.lavaDark) : j === 0 ? C.flame : C.ember, top ? 170 : 220);
    }
  }
  // tongues, back to front (the higher ones first so the hem flames overlap them)
  const order = [...TONGUES].sort((a, b) => a.y - b.y);
  for (const tg of order) flameTongue(f, tg, (k + tg.off) % 6);
  // embers drifting up, clear of the face
  for (let i = 0; i < 3; i++) {
    const u = ((k + i * 2) % 6) / 6;
    const x = Math.round([8, 24, 22][i] + Math.sin(u * TAU + i) * 1.2);
    const y = Math.round([26, 24, 14][i] - u * 11);
    glowMax(f, x, y, u < 0.4 ? C.hot : C.flame, 230 * (1 - u * 0.7));
  }
  return f;
}

// ---------------------------------------------------------------------------------------------------------------
// Bleeding: 1–3 wounds on the charcoal skirt (never on the burgundy hood/capelet, whose hue blood would vanish
// into). Every wound drips outlined 2x3 drops (white-hot specular, arterial core, dark rim) that fall 3 px a frame
// to the floor and splash into a pool whose size grows with the stacks; once per loop the first wound spurts an
// arc of drops out past her silhouette on the side she faces.
// ---------------------------------------------------------------------------------------------------------------
const WOUNDS: readonly Pt[] = [[19, 26], [14, 24], [15, 29]];

function bleeding(k: number, stacks: number): Frame {
  const f = new Frame(W, H);
  const n = 6;
  const ph = (k / n) * TAU;
  // pool at the feet: lifeDark rim, life body, darker blood inside, one glint; it swells a touch with each drop
  const rx = [5, 5.8, 6.8][stacks - 1] + 0.35 * Math.sin(ph);
  const ry = 1.35 + stacks * 0.2;
  const pcx = 16.5;
  const pcy = FEET + 1.2;
  for (let y = FEET - 1; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot((x + 0.5 - pcx) / rx, (y + 0.5 - pcy) / ry) + (hash2(x, y, 51) - 0.5) * 0.18;
      if (d > 1) continue;
      put(f, x, y, d > 0.74 ? C.lifeDark : d < 0.42 && y >= pcy ? C.blood : C.life);
    }
  }
  f.glow(Math.round(pcx - rx * 0.45), Math.round(pcy - 0.6), C.lifeLight, 120);
  // spatter on the floor where the spurts land (persistent, so the arc always ends somewhere)
  const spatter: Pt[] = [[26, FEET + 1], [27, FEET], [28, FEET + 1]];
  if (stacks > 2) spatter.push([5, FEET + 1], [4, FEET]);
  for (const [x, y] of spatter) put(f, x, y, C.life);
  put(f, 27, FEET + 1, C.lifeDark);
  // wounds: a dark gash with a bright, pulsing core
  const wounds = WOUNDS.slice(0, stacks);
  wounds.forEach(([wx, wy], i) => {
    const beat = (k + i * 2) % 3 === 0;
    put(f, wx - 1, wy, C.lifeDark);
    put(f, wx + 1, wy - 1, C.lifeDark);
    put(f, wx + 1, wy, C.life);
    f.glow(wx, wy, C.lifeLight, beat ? 220 : 150);
    put(f, wx, wy + 1, C.life);
    put(f, wx - 1, wy + 1, C.lifeDark);
    // blood running from the wound down the skirt to the hem
    for (let y = wy + 2; y <= 31; y++) soft(f, wx, y, y === wy + 2 ? C.life : C.blood, y === wy + 2 ? 1 : 0.85);
  });
  // drops: drawn on their own layer, outlined in ink so they separate from the robe and floor
  const drops = new Frame(W, H);
  const drop = (x: number, y: number, falling: boolean): void => {
    if (falling) put(drops, x + 1, y - 1, C.life); // the tail above a falling drop
    put(drops, x, y, C.hot);
    put(drops, x + 1, y, C.lifeLight);
    put(drops, x, y + 1, C.lifeLight);
    put(drops, x + 1, y + 1, C.life);
  };
  const splash: Pt[] = [];
  wounds.forEach(([wx, wy], i) => {
    // three drops per loop per wound, 2 frames apart (so one is always falling): bead at the wound → falling →
    // falling/landing → splash
    for (const off of [0, 2, 4]) {
      const p = (k + off + i) % 6;
      if (p === 0) drop(wx - 1, wy + 1, false);
      else if (p < 3) {
        const y = wy + 1 + p * 3.5;
        if (y + 1 >= FEET) splash.push([wx, FEET + 1]);
        else drop(wx - 1, Math.round(y), true);
      } else if (p === 3) splash.push([wx, FEET + 1]);
    }
  });
  // the arterial spurt: out of the first wound, towards the facing side, over frames 0..2
  const [ax, ay] = WOUNDS[0];
  const spurt: Pt[][] = [
    [[ax + 3, ay - 2], [ax + 5, ay - 3]],
    [[ax + 6, ay - 1], [ax + 8, ay + 1], [ax + 4, ay - 1]],
    [[ax + 8, ay + 5]],
  ];
  const sp = k % 6;
  if (sp < 3) for (const [x, y] of spurt[sp]) drop(x, y, false);
  if (stacks === 3 && k === 3) {
    const [bx, by] = WOUNDS[1];
    drop(bx - 4, by - 2, false);
    drop(bx - 7, by, false);
  }
  drops.outline({ selective: false, color: C.ink });
  f.draw(drops, 0, 0);
  // splashes feeding the pool: a 3 px crown of bright blood
  for (const [x, y] of splash) {
    f.glow(x, y - 1, C.lifeLight, 140);
    put(f, x - 1, y, C.lifeLight);
    put(f, x + 1, y, C.lifeLight);
    put(f, x, y, C.life);
  }
  // emissive only on the arterial cores
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = f.c.get(x, y);
    if (c === C.lifeLight && (f.e.get(x, y) & 255) === 0) f.emit(x, y, C.lifeLight, 150);
    else if (c === C.hot) f.emit(x, y, C.hot, 190);
  }
  return f;
}

// ---------------------------------------------------------------------------------------------------------------
// Shocked: jagged arcs crawl along her silhouette (never across the face), with sparks where they earth.
// ---------------------------------------------------------------------------------------------------------------
function arc(f: Frame, x0: number, y0: number, x1: number, y1: number, seed: number, amp: number): void {
  // midpoint displacement
  let pts: [number, number][] = [[x0, y0], [x1, y1]];
  let a = amp;
  for (let level = 0; level < 3; level++) {
    const next: [number, number][] = [pts[0]];
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, ay] = pts[i];
      const [bx, by] = pts[i + 1];
      const dx = bx - ax;
      const dy = by - ay;
      const l = Math.hypot(dx, dy) || 1;
      const o = (hash2(i, level, seed) - 0.5) * 2 * a;
      next.push([(ax + bx) / 2 + (-dy / l) * o, (ay + by) / 2 + (dx / l) * o], pts[i + 1]);
    }
    pts = next;
    a *= 0.55;
  }
  for (let i = 0; i + 1 < pts.length; i++) {
    walk(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], (_t, x, y) => {
      f.glowSoft(x - 1, y, C.storm, 0.55, 170);
      f.glowSoft(x + 1, y, C.stormMid, 0.5, 150);
      f.glowSoft(x, y - 1, C.lightning, 0.5, 190);
    });
  }
  for (let i = 0; i + 1 < pts.length; i++) walk(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], (_t, x, y) => f.glow(x, y, C.white, 255));
}

function spark(f: Frame, x: number, y: number): void {
  f.glow(x, y, C.white, 255);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) f.glowSoft(x + dx, y + dy, C.lightning, 0.8, 200);
  for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) f.glowSoft(x + dx, y + dy, C.storm, 0.45, 150);
}

function shocked(k: number): Frame {
  const f = new Frame(W, H);
  // pairs of silhouette points (left edge, right edge, hem) per frame
  const sets: [number, number, number, number][][] = [
    [[8, 14, 6, 26], [23, 10, 26, 20], [21, 31, 26, 34]],
    [[24, 15, 25, 28], [10, 9, 7, 19], [6, 31, 11, 34]],
    [[7, 20, 9, 32], [22, 8, 24, 17], [25, 25, 28, 33]],
    [[9, 12, 5, 22], [24, 20, 23, 32], [12, 33, 19, 34]],
  ];
  sets[k].forEach(([x0, y0, x1, y1], i) => arc(f, x0, y0, x1, y1, 900 + k * 7 + i, 2.6));
  // sparks at a couple of ends, and a stray crackle
  const [a, b] = sets[k];
  spark(f, a[2], a[3]);
  spark(f, b[0], b[1]);
  f.glow([15, 18, 13, 20][k], [3, 5, 4, 2][k], C.lightning, 220);
  return f;
}

// ---------------------------------------------------------------------------------------------------------------
// Withered: purple decay — ribbons of void smoke curl up off her shoulders and hem, dark motes drift up, and a low
// miasma pools at her feet. More stacks, more ribbons and a denser miasma.
// ---------------------------------------------------------------------------------------------------------------
function withered(k: number, stacks: number): Frame {
  const f = new Frame(W, H);
  const n = 6;
  const ph = (k / n) * TAU;
  const dens = [0.62, 0.82, 1][stacks - 1];
  // miasma at the feet
  for (let y = FEET - 3; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const d = Math.hypot((x + 0.5 - 16) / (10 + stacks), (y + 0.5 - (FEET + 0.5)) / 3);
      if (d > 1) continue;
      const nn = noiseY(x * 1.3, y * 2 + k * 2, 2, 707, 6); // drifts 2 px/frame, 12 px period = seamless
      const a = (1 - d) * (0.45 + 0.6 * nn) * dens;
      if (a < 0.1) continue;
      f.glowSoft(x, y, nn > 0.62 ? C.voidLight : nn > 0.35 ? C.void : C.voidMid, clamp01(a), 110 * a);
    }
  }
  // wisps: ribbons rising along a sine, a bright section travelling up each ribbon
  const wisps: [number, number, number, number][] = [
    // base x, base y, height, phase — ordered so the first ones read best alone (1 stack = the shoulders)
    [9, 18, 13, 0], [23, 19, 14, 2.1], [8, 30, 12, 4.2], [24, 31, 13, 1.1], [16, 27, 9, 3.3],
  ];
  wisps.slice(0, [2, 4, 5][stacks - 1]).forEach(([bx, by, hgt, p0], i) => {
    const side = i % 2 ? -1 : 1;
    for (let j = 0; j <= hgt; j++) {
      const u = j / hgt; // 0 base → 1 top
      const x = Math.round(bx + Math.sin(u * 5 + ph + p0) * (0.8 + u * 1.8) * side);
      const y = by - j;
      // brightness wave moving upward along the ribbon (loops with ph)
      const wave = 0.5 + 0.5 * Math.sin(u * 7 - ph - p0);
      const a = clamp01((1 - u * 0.85) * (0.45 + 0.55 * wave));
      if (a < 0.15) continue;
      const col = wave > 0.78 ? C.voidHi : wave > 0.5 ? C.voidGlow : wave > 0.25 ? C.voidLight : C.void;
      f.glowSoft(x, y, col, a, 120 + 120 * wave * (1 - u));
      // the ribbon is 2 px thick near its base, with a dark rotten edge
      if (u < 0.6) f.glowSoft(x - side, y, wave > 0.5 ? C.voidLight : C.void, a * 0.8, 110);
      if (u < 0.35) soft(f, x + side, y, C.voidDark, a * 0.6);
    }
  });
  // motes: glowing violet specks with a dark rind, drifting up
  for (let i = 0; i < 1 + stacks; i++) {
    const u = ((k + i * 1.5) % n) / n;
    const x = Math.round([12, 20, 6, 27][i] + Math.sin(u * TAU + i * 2) * 1.2);
    const y = Math.round([26, 24, 22, 20][i] - u * 16);
    const a = u > 0.7 ? (1 - u) / 0.3 : 1;
    f.glowSoft(x, y, C.voidGlow, a, 220 * a);
    soft(f, x + 1, y, C.voidDark, 0.8 * a);
    soft(f, x, y + 1, C.voidDeep, 0.7 * a);
  }
  return f;
}

export function debuffOverlaySprites(): SpriteDef[] {
  const loop = (d: PlayerDebuff, fn: (k: number) => Frame): Frame[] => Array.from({ length: DEBUFF_LOOP[d].frames }, (_, k) => fn(k));
  const stacked = (d: PlayerDebuff, fn: (k: number, stacks: number) => Frame): Frame[] => [1, 2, 3].flatMap((s) => loop(d, (k) => fn(k, s)));
  const def = (d: PlayerDebuff, frames: Frame[]): SpriteDef => sprite(`fx/debuff/${d}`, frames, DEBUFF_ANCHOR_X, DEBUFF_ANCHOR_Y, DEBUFF_LOOP[d].fps, true);
  const roots = (Object.keys(ROOTED_VARIANTS) as RootSource[]).sort((a, b) => ROOTED_VARIANTS[a] - ROOTED_VARIANTS[b]);
  return [
    def('chilled', loop('chilled', chilled)),
    def('frozen', loop('frozen', frozen)),
    def('rooted', roots.flatMap((v) => loop('rooted', (k) => rooted(v, k)))),
    def('burning', loop('burning', burning)),
    def('bleeding', stacked('bleeding', bleeding)),
    def('shocked', loop('shocked', shocked)),
    def('withered', stacked('withered', withered)),
  ];
}
