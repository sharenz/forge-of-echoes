// Glacial Wisp — the Ossuary fast unit. A jagged shard of glacier ice, a hexagonal crystal with two smaller shards
// splintered off its flanks, floating at chest height and slowly spinning; a cold core burns inside it and two frost
// motes orbit it. The anchor is the ground point under it (the presenter's shadow sits beneath the hover); a faint
// pool of its cold light lies on the floor row there, and a rushing wisp leaves a broken, unoutlined frost streak.
//
// The crystal is rendered facet by facet as the shard spins (a true hexagonal bipyramid: every facet takes one flat
// normal, lit from the top-left), so the idle turn loops seamlessly every 60°.
//
// windup is the 0.7 s pulse telegraph: the shard swells a third larger, the core throbs bright-dim-bright, cracks of
// light run across it and a second pair of motes spirals in.
// burst is the detonation: cracks blaze, a white flash, then the shard flies apart into spinning fragments.
import type { SpriteDef } from '../../contracts/art';
import { Frame, rotFrame } from '../frame';
import { C, type Color } from '../palette';
import { hash2, lambert } from '../shade';
import { anim, finish, monsterSprites, squash } from '../monsters/common';
import { COLD_WHITE, rimeify } from './ossuaryKit';

const W = 24;
const H = 26;
const GROUND = 24;
const CX = 12;
const CY = 11; // equator of the floating shard

const ICE_RAMP: Color[] = [C.frostDeep, C.frostDark, C.frostMid, C.mana, C.frost, C.ice, COLD_WHITE];

interface P {
  x: number;
  y: number; // equator y
  spin: number; // radians
  size: number; // 1 = normal
  core: number; // 0..1.4
  crack: number; // 0..1 cracks of light across the facets
  motes: number; // orbit phase 0..1
  moteR: number; // orbit radius (shrinks while gathering)
  tilt: number; // lean towards east (radians)
  trail: number; // frost streak behind (move)
  pairs: number; // mote pairs orbiting (the windup gathers a second pair)
}
const base: P = { x: CX, y: CY, spin: 0, size: 1, core: 0.8, crack: 0, motes: 0, moteR: 7, tilt: 0, trail: 0, pairs: 1 };
const pose = (p: Partial<P>): P => ({ ...base, ...p });

const SIXTY = Math.PI / 3;

/** Render one hexagonal bipyramid facet-by-facet into f. Returns nothing; writes colour + glow. */
function crystal(f: Frame, cx: number, cy: number, R: number, up: number, down: number, spin: number, glow: number, crack: number, seed: number): void {
  const x0 = Math.floor(cx - R - 1);
  const x1 = Math.ceil(cx + R + 1);
  for (let y = Math.floor(cy - up); y <= Math.ceil(cy + down); y++) {
    const dy = y + 0.5 - cy;
    const k = dy < 0 ? 1 + dy / up : 1 - dy / down; // 0 at the tips, 1 at the equator
    if (k <= 0) continue;
    // the hexagon's projected half-width at this spin
    let hw = 0;
    for (let v = 0; v < 6; v++) hw = Math.max(hw, Math.abs(Math.sin(spin + v * SIXTY)));
    const half = R * k * hw;
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      if (Math.abs(dx) > half) continue;
      // angle around the vertical axis of the visible front surface
      const u = Math.max(-1, Math.min(1, dx / Math.max(0.01, R * k)));
      const th = Math.asin(u);
      // nearest facet normal (facets are centred between vertices)
      const rel = th - spin - SIXTY / 2;
      const idx = Math.round(rel / SIXTY);
      const a = spin + SIXTY / 2 + idx * SIXTY;
      const slope = dy < 0 ? -R / up : R / down; // facet tilt up (top half) or down (bottom half)
      const nx = Math.sin(a);
      const nz = Math.cos(a);
      const ny = slope * 0.55;
      const l = Math.hypot(nx, ny, nz);
      let b = lambert(nx / l, ny / l, nz / l, 0.22, 0.05);
      // ridges between facets catch a highlight
      const ridge = Math.abs(rel / SIXTY - idx) > 0.4;
      if (ridge && b > 0.45) b += 0.22;
      let v = b * (ICE_RAMP.length - 1.5);
      if (Math.abs(dy) < 0.6 && nx < 0.2) v += 0.6; // equator girdle
      const i = Math.max(0, Math.min(ICE_RAMP.length - 1, Math.round(v)));
      const col = ICE_RAMP[i];
      f.c.set(x, y, col);
      f.e.set(x, y, (col & 0xffffff00) | Math.round(glow * (0.45 + i * 0.1)));
      // cracks of light
      if (crack > 0) {
        const n = Math.sin((dx * 2.1 + dy * 1.3 + seed) * 1.7) + Math.sin((dx * -1.4 + dy * 2.2 + seed * 2) * 1.3);
        if (Math.abs(n) < 0.16 * crack) f.glow(x, y, crack > 0.7 ? COLD_WHITE : C.ice, 255);
      }
    }
  }
}

/** A two-tone ice spike from `base` to `tip` (lit left/top half, shaded right half, white tip). */
function spike(f: Frame, base: [number, number], tip: [number, number], w: number, glow: number): void {
  const dx = tip[0] - base[0];
  const dy = tip[1] - base[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const x0 = Math.floor(Math.min(base[0], tip[0]) - w - 1);
  const x1 = Math.ceil(Math.max(base[0], tip[0]) + w + 1);
  const y0 = Math.floor(Math.min(base[1], tip[1]) - w - 1);
  const y1 = Math.ceil(Math.max(base[1], tip[1]) + w + 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5 - base[0];
      const py = y + 0.5 - base[1];
      const t = px * ux + py * uy; // along
      const q = -px * uy + py * ux; // across (+ = right of the axis when pointing up)
      if (t < -0.3 || t > len) continue;
      const half = w * (1 - t / len);
      if (Math.abs(q) > half + 0.15) continue;
      // lit side: the half facing the top-left light
      const litSide = q * (uy - ux) > 0;
      const col = t > len - 1.2 ? COLD_WHITE : litSide ? (t > len * 0.45 ? C.ice : C.frost) : t > len * 0.5 ? C.frost : C.mana;
      f.c.set(x, y, col);
      f.e.set(x, y, (col & 0xffffff00) | glow);
    }
  }
}

function draw(p: P): Frame {
  const f = new Frame(W, H);
  const s = p.size;
  const g = 100 + 50 * Math.min(1, p.core);
  // jagged splinters fixed to the body (the spin reads through the facet highlights moving across the crystal)
  const spikes: { base: [number, number]; tip: [number, number]; w: number; back: boolean }[] = [
    { base: [p.x - 0.5 * s, p.y - 1.5 * s], tip: [p.x - 4.5 * s, p.y - 5.5 * s], w: 1.4 * s, back: true },
    { base: [p.x + 0.5 * s, p.y + 1.5 * s], tip: [p.x + 4 * s, p.y + 5 * s], w: 1.2 * s, back: false },
  ];
  for (const sp of spikes) if (sp.back) spike(f, sp.base, sp.tip, sp.w, Math.round(g * 0.8));
  crystal(f, p.x, p.y, 3 * s, 7.5 * s, 5.5 * s, p.spin, g, p.crack, 3);
  for (const sp of spikes) if (!sp.back) spike(f, sp.base, sp.tip, sp.w, Math.round(g * 0.9));

  // the core: a small cold light inside the ice, bleeding through the facets
  const heat = Math.min(1.4, p.core);
  const cr = 0.9 + heat * 0.9;
  for (let y = Math.floor(p.y - cr - 1); y <= Math.ceil(p.y + cr); y++) {
    for (let x = Math.floor(p.x - cr - 1); x <= Math.ceil(p.x + cr); x++) {
      if (!f.c.opaque(x, y)) continue;
      const d = Math.hypot(x + 0.5 - p.x, y + 0.5 - (p.y - 0.5)) / cr;
      if (d > 1) continue;
      const col = d < 0.45 ? (heat > 1 ? COLD_WHITE : C.ice) : d < 0.8 ? C.ice : C.frost;
      f.glow(x, y, col, 255 * (1.1 - d * 0.4));
    }
  }
  const out = p.tilt !== 0 ? rotFrame(f, p.tilt, p.x, p.y) : f;
  finish(out);
  // its cold light pooled faintly on the floor below (grounds the hover over the presenter's shadow)
  for (let dx = -3; dx <= 3; dx++) {
    const k = 1 - Math.abs(dx) / 4;
    out.glowSoft(Math.round(p.x) + dx, GROUND, dx === 0 ? C.frost : C.frostMid, 0.22 * k * Math.min(1.2, p.core), 50 * k);
  }
  // frost streak trailing behind a rushing wisp: soft unoutlined glow, thinning out and fading
  for (let i = 1; i <= p.trail; i++) {
    if (i > 2 && (i % 2 === 1 || hash2(i, Math.round(p.motes * 12), 5) < 0.25)) continue;
    const X = Math.round(p.x - 3 - i * 1.6);
    const Y = Math.round(p.y + 1 + i * 0.4 + (i % 2) * 0.5);
    if (out.c.opaque(X, Y)) continue;
    const k = Math.max(0.25, 1 - i * 0.15);
    out.glowSoft(X, Y, i < 2 ? C.ice : i < 4 ? C.frost : C.mana, k, Math.max(60, 220 - i * 28));
  }
  // orbiting motes (after the outline: tiny unoutlined sparks); the windup pulls in a second pair
  const total = p.moteR > 0 ? 2 * p.pairs : 0;
  for (let m = 0; m < total; m++) {
    const second = m >= 2;
    const a = (p.motes + (m % 2) / 2 + (second ? 0.25 : 0)) * Math.PI * 2 * (second ? -1 : 1);
    const r = p.moteR * (second ? 0.75 : 1);
    const X = Math.round(p.x + Math.cos(a) * r * s);
    const Y = Math.round(p.y + 1 + Math.sin(a) * r * (second ? 0.9 : 0.4) * s);
    if (Math.sin(a) < 0 && out.c.opaque(X, Y)) continue; // behind the shard
    out.glow(X, Y, Math.sin(a) > 0 ? C.ice : C.frost, second ? 200 : 220);
  }
  return out;
}

/** Flying fragments of a shattered wisp at radius r (0..1 fade). */
function shatter(r: number, k: number, flash: number): Frame {
  const f = new Frame(W, H);
  if (flash > 0) {
    // crisp rings, not a soft blur: white core, ice ring, broken frost rim
    const R = 1.5 + flash * 4.5;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const d = Math.hypot(x + 0.5 - CX, (y + 0.5 - CY) * 1.15);
        if (flash > 0.8 && d < R * 0.45) f.glow(x, y, COLD_WHITE, 255);
        else if (flash > 0.8 && d < R * 0.75) f.glow(x, y, C.ice, 245);
        else if (Math.abs(d - R) < 0.7 && (x + y) % 3 !== 0) f.glow(x, y, flash > 0.5 ? C.ice : C.frost, 230 * Math.min(1, flash + 0.3));
      }
    }
  }
  const N = 8;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + 0.3 + (i % 2) * 0.25;
    const rr = r * (0.8 + (i % 3) * 0.15);
    const x = CX + Math.cos(a) * rr;
    const y = CY + Math.sin(a) * rr * 0.8;
    // each fragment: a 2-3 px sliver along its flight direction
    const len = i % 3 === 0 ? 2 : 1;
    for (let j = 0; j <= len; j++) {
      const X = Math.round(x - Math.cos(a + 0.6) * j);
      const Y = Math.round(y - Math.sin(a + 0.6) * j);
      if (k > 0.35) f.glow(X, Y, j === 0 ? (k > 0.7 ? C.ice : C.frost) : k > 0.7 ? C.frost : C.mana, 255 * k);
      else if (j === 0) f.glow(X, Y, C.mana, 200 * k + 60);
    }
  }
  return f;
}

export function glacialWispSprites(): SpriteDef[] {
  const idle = [0, 1, 2, 3, 4, 5].map((i) =>
    draw(pose({ y: CY + [0, 0, -1, -1, -1, 0][i], spin: (i / 6) * SIXTY, motes: i / 6, core: [0.75, 0.85, 0.95, 1, 0.9, 0.8][i] })),
  );
  const move = [0, 1, 2, 3, 4, 5].map((i) =>
    draw(pose({ x: CX + 1, y: CY + [0, -1, -1, 0, -1, -1][i], spin: (i / 6) * SIXTY * 2, motes: i / 4, moteR: 6, tilt: 0.45, trail: 5 + (i % 2), core: 0.95 })),
  );
  // the pulse: the core swells, the shard shivers and cracks of light spread
  const windup = [
    draw(pose({ spin: 0.1, core: 1.3, crack: 0.25, motes: 0.1, moteR: 7, size: 1, pairs: 2 })),
    draw(pose({ x: CX + 1, spin: 0.2, core: 0.65, crack: 0.5, motes: 0.25, moteR: 5.5, size: 1.12, pairs: 2 })),
    draw(pose({ x: CX - 1, spin: 0.3, core: 1.4, crack: 0.75, motes: 0.4, moteR: 4.2, size: 1.25, pairs: 2 })),
    draw(pose({ x: CX + 1, spin: 0.4, core: 1.4, crack: 1, motes: 0.55, moteR: 3.2, size: 1.35, pairs: 2 })),
  ];
  // a flaring ram at the target
  const attack = [
    draw(pose({ x: CX + 3, spin: 0.5, tilt: 0.7, core: 1.3, trail: 6, motes: 0.2 })),
    draw(pose({ x: CX + 4, spin: 0.8, tilt: 0.8, core: 1.1, trail: 4, motes: 0.3 })),
    draw(pose({ x: CX + 2, spin: 1, tilt: 0.4, core: 0.9, trail: 2, motes: 0.4 })),
  ];
  // detonation: blazing cracks → white flash → fragments flying out and fading
  const burst = [
    draw(pose({ spin: 0.45, core: 1.4, crack: 1, size: 1.4, moteR: 2.5, pairs: 2 })),
    overlay(draw(pose({ spin: 0.5, core: 1.4, crack: 1, size: 1.45, moteR: 1.5 })), shatter(3, 0.6, 1)),
    shatter(5, 1, 0.7),
    shatter(8, 0.8, 0.25),
    shatter(10.5, 0.5, 0),
    shatter(12, 0.2, 0),
  ];
  // shot down: the shard drops, cracks and lies in splinters on the floor
  const fallen = draw(pose({ y: GROUND - 4, spin: 0.3, tilt: 1.35, core: 0.3, crack: 0.3, moteR: 0 }));
  const corpse = [
    draw(pose({ y: CY + 6, spin: 0.2, tilt: 0.8, core: 0.6, crack: 0.5, moteR: 0 })),
    rimeify(squash(fallen, 0.85, GROUND), 0.4, 0.4),
    rimeify(squash(fallen, 0.65, GROUND), 0.85, 0.12),
  ];
  return monsterSprites({
    id: 'glacialWisp',
    anchorX: CX,
    anchorY: GROUND + 1,
    anims: {
      idle: anim(idle, 8, true),
      move: anim(move, 14, true),
      windup: anim(windup, 6, false),
      attack: anim(attack, 12, false),
      burst: anim(burst, 14, false),
      corpse: anim(corpse, 8, false),
    },
  });
}

function overlay(a: Frame, b: Frame): Frame {
  a.draw(b, 0, 0);
  return a;
}
