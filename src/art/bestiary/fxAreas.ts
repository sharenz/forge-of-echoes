// Bestiary area visuals (wave 5). Ground decals are round in world space, like the sim's areas and the renderer's
// circle telegraphs: each lists its native radius R so the presenter can scale it with `scale = area.radius / R`.
//
//   fx/iceSpike        18x30 · 8f @14 once — anchor (9,26) = the ground point. 0 rime crack (hold while telegraphing),
//                      1–3 erupting, 4 full, 5 fracturing, 6 shattered, 7 stumps. Glacial Spikes / Warden.
//   fx/icePrisonShard  17x22 · 28f (fps 0) — anchor (8,19) = the shard's ground point. ONE prison shard; draw
//                      ICE_PRISON_SHARDS of them on the ring's CURRENT radius at scale 1 (angle i+0.5 / N of a turn),
//                      frame = icePrisonShardFrame(angle, close, i, seconds). Each is y-sorted like a prop, so the far
//                      half of the ring stands behind the player and the near half in front; the shards keep their
//                      size while the ring tightens and lean harder inward as it closes.
//   fx/icePrison       50x60 · 7f @8 loop  — anchor (25,36) = ring centre on the ground, R = 20. The same ring baked
//                      whole (glints running round it) for a static full-radius telegraph; don't scale it down to
//                      show the closing — use the shards.
//   fx/blizzard        64x64 · 12f @12 loop — centre anchored, R = 30. Wind-driven snow (towards BLIZZARD_WIND, with
//                      a curl): turbulent cold haze with a lumpy broken edge, snow streaks and flakes blowing across
//                      it and re-entering upwind. Deliberately NOT a vortex (the portal sigil is a spiral).
//   fx/tarPool         40x40 · 3 variants (fps 0) — centre anchored, R = 18. Glossy black tar with emissive speculars.
//   fx/web             40x40 · 2 variants (fps 0) — centre anchored, R = 18. Frost-silk web with glinting dew beads.
//   fx/chain           8x6   · 1f — anchor (4,3), pointing east. ONE CHAIN_PERIOD of chain (a face-on oval link with
//                      an open hole, the edge-on link between): draw it every CHAIN_PERIOD px along the thrower→hook
//                      line, rotated to the line's angle, WITHOUT a per-sprite outline (ink is baked above/below).
//   fx/arenaSpike      16x28 · 8f @12 once — anchor (8,20) = centre of the 16x16 floor footprint. 0 dormant grate,
//                      1 telegraph (holes glow; hold while warning), 2–4 spikes shoot up, 5–6 retract, 7 dormant.
//   fx/executionMark   48x48 · 8f @10 loop — centre anchored, R = 22. Blood-red sigil: rotating tick ring, inward
//                      teeth, a dashed counter-rotating inner ring and a crossed-blades mark (emissive red).
//   fx/shieldArc       24x32 · 4f @18 once — anchor (4,16) = the bearer's centre, pointing east: a translucent
//                      ±60° frontal arc flashing where a projectile was blocked. Pale bone-gold, so it also tints.
import type { SpriteDef } from '../../contracts/art';
import { Frame } from '../frame';
import { C, RAMPS, type Color } from '../palette';
import { Sculpt, hash2, valueNoise, type PrimStyle } from '../shade';
import { TAU, centred, clamp01, disc, glowMax, pick, soft, sprite, walk } from './fxKit';

const ICE: PrimStyle = { ramp: [C.frostDeep, C.frostDark, C.frostMid, C.mana, C.frost, C.ice, C.white], bias: 0.4, dither: 0, glow: 150, round: 1.4 };

// ---------------------------------------------------------------------------------------------------------------
// Ice spike
// ---------------------------------------------------------------------------------------------------------------
const SPIKE_W = 18;
const SPIKE_H = 30;
const SX = 9;
const SY = 26; // ground point

/** Frosted ground patch with radiating cracks under the spike; `heat` 0..1 = how bright the cracks glow. */
function rimePatch(f: Frame, heat: number, size = 1): void {
  for (let y = SY - 3; y <= SY + 3; y++) {
    for (let x = 0; x < SPIKE_W; x++) {
      const d = Math.hypot((x + 0.5 - SX) / (7.5 * size), (y + 0.5 - (SY + 0.5)) / (2.4 * size)) + hash2(x, y, 3) * 0.2;
      if (d > 1) continue;
      soft(f, x, y, d < 0.55 ? C.ossFrost : C.ossPale, 0.8 * (1 - d * 0.5));
    }
  }
  if (heat <= 0) return;
  const rays: [number, number][] = [[-7, 1], [-5, -2], [6, -2], [8, 1], [-3, 3], [4, 3], [0, -3]];
  for (const [dx, dy] of rays) {
    walk(SX, SY, SX + dx * size, SY + dy * size * 0.8, (t, x, y) => {
      const a = heat * (1 - t * 0.6);
      f.glowSoft(x, y, t < 0.4 ? C.white : C.frost, a, 220 * a);
    });
  }
}

/** The spike cluster at height `h` (0..1 of full), optionally with fracture lines. */
function spikeCluster(f: Frame, h: number, fracture: boolean): void {
  if (h <= 0) return;
  const s = new Sculpt();
  const main = 22 * h;
  const shards: [number, number, number, number][] = [
    // base x, base y, half width, height
    [SX - 4.5, SY + 0.5, 2.1, main * 0.5],
    [SX + 4.5, SY + 0.5, 2.2, main * 0.62],
    [SX, SY + 1, 3.3, main],
  ];
  for (const [x, base, w, hh] of shards) {
    if (hh < 1) continue;
    const lean = (x - SX) * 0.28;
    s.poly([[x - w, base], [x + w, base], [x + w * 0.75 + lean, base - hh * 0.72], [x + lean * 1.35, base - hh], [x - w * 0.75 + lean, base - hh * 0.72]], ICE, 1, 0, 0);
  }
  s.render(f.c, f.e);
  for (const [x, base, , hh] of shards) {
    if (hh < 2) continue;
    const lean = (x - SX) * 0.28;
    walk(x - 0.5, base - 1, x + lean * 1.35 - 0.5, base - hh + 1, (_t, lx, ly) => {
      if (f.c.opaque(lx, ly)) f.glow(lx, ly, C.ice, 190);
    });
    f.glow(Math.round(x + lean * 1.35 - 0.5), Math.round(base - hh), C.white, 255);
  }
  if (fracture) {
    const lines: [number, number, number, number][] = [[SX - 3, SY - 14, SX + 2, SY - 10], [SX + 2, SY - 10, SX - 1, SY - 6], [SX + 3, SY - 6, SX + 6, SY - 9]];
    for (const [x0, y0, x1, y1] of lines) walk(x0, y0, x1, y1, (_t, x, y) => {
      if (f.c.opaque(x, y)) f.glow(x, y, C.white, 255);
    });
  }
  f.outline({ selective: true });
}

/** Ice chips flung out of the eruption: `t` 0..1 = flight progress. */
function chips(f: Frame, t: number, seed: number): void {
  for (let i = 0; i < 6; i++) {
    const dir = (i % 2 ? 1 : -1) * (0.4 + hash2(i, seed, 7) * 0.9);
    const up = 4 + hash2(i, seed, 8) * 6;
    const x = SX + dir * t * 8;
    const y = SY - 4 - up * t + 14 * t * t;
    const a = 1 - t * 0.7;
    f.glow(Math.round(x), Math.round(y), i % 3 === 0 ? C.white : C.ice, 230 * a);
    if (i % 2 === 0) f.glowSoft(Math.round(x - dir), Math.round(y + 1), C.frost, 0.6 * a, 150 * a);
  }
}

function iceSpike(k: number): Frame {
  const f = new Frame(SPIKE_W, SPIKE_H);
  switch (k) {
    case 0:
      rimePatch(f, 0.55, 0.85);
      break;
    case 1:
      rimePatch(f, 1);
      spikeCluster(f, 0.22, false);
      chips(f, 0.25, 1);
      break;
    case 2:
      rimePatch(f, 0.8);
      spikeCluster(f, 0.62, false);
      chips(f, 0.55, 1);
      break;
    case 3:
      rimePatch(f, 0.5);
      spikeCluster(f, 1, false);
      chips(f, 0.85, 1);
      break;
    case 4:
      rimePatch(f, 0.2);
      spikeCluster(f, 1, false);
      break;
    case 5:
      rimePatch(f, 0.1);
      spikeCluster(f, 1, true);
      break;
    case 6: {
      rimePatch(f, 0);
      spikeCluster(f, 0.42, false);
      // falling fragments
      for (let i = 0; i < 7; i++) {
        const x = SX - 7 + Math.round(hash2(i, 6, 11) * 14);
        const y = SY - 6 - Math.round(hash2(i, 6, 12) * 12);
        f.glow(x, y, i % 2 ? C.ice : C.frost, 200);
        if (i % 3 === 0) f.glow(x + 1, y + 1, C.white, 230);
      }
      break;
    }
    default: {
      rimePatch(f, 0);
      spikeCluster(f, 0.18, false);
      for (let i = 0; i < 6; i++) {
        const x = SX - 7 + Math.round(hash2(i, 7, 11) * 14);
        const y = SY - 1 + Math.round(hash2(i, 7, 12) * 3);
        f.glowSoft(x, y, C.ice, 0.8, 140);
      }
    }
  }
  return f;
}

// ---------------------------------------------------------------------------------------------------------------
// Ice prison: a ring of shards around the target, leaning in like closing jaws
// ---------------------------------------------------------------------------------------------------------------
const PR_W = 50;
const PR_H = 60;
const PCX = 25;
const PCY = 36;
const PR = 20;

function icePrisonBase(): { f: Frame; tips: [number, number][] } {
  const f = new Frame(PR_W, PR_H);
  // frozen ground line along the ring
  for (let a = 0; a < 360; a += 2) {
    const t = (a * Math.PI) / 180;
    const x = PCX + Math.cos(t) * PR;
    const y = PCY + Math.sin(t) * PR;
    f.glowSoft(Math.round(x), Math.round(y), hash2(a, 0, 5) > 0.5 ? C.ice : C.ossFrost, 0.7, 110);
    f.glowSoft(Math.round(x + Math.cos(t) * 1.4), Math.round(y + Math.sin(t) * 1.4), C.frost, 0.3, 60);
  }
  const s = new Sculpt();
  const n = 14;
  const shards: { x: number; y: number; h: number; w: number; t: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = ((i + 0.5) / n) * TAU;
    const h = 9 + (i % 2) * 4 + Math.round(hash2(i, 1, 21) * 3);
    shards.push({ x: PCX + Math.cos(t) * PR, y: PCY + Math.sin(t) * PR, h, w: 2.2 + (i % 2) * 0.6, t });
  }
  shards.sort((a, b) => a.y - b.y);
  const tips: [number, number][] = [];
  for (const sh of shards) {
    const back = Math.sin(sh.t) < -0.2;
    // lean inward (towards the centre) — mostly visible sideways
    const lean = -Math.cos(sh.t) * 2.2;
    const st: PrimStyle = { ...ICE, bias: back ? -0.2 : 0.4 };
    s.poly([[sh.x - sh.w, sh.y + 1], [sh.x + sh.w, sh.y + 1], [sh.x + sh.w * 0.7 + lean * 0.6, sh.y - sh.h * 0.7], [sh.x + lean, sh.y - sh.h], [sh.x - sh.w * 0.7 + lean * 0.6, sh.y - sh.h * 0.7]], st, 1, 0, 0);
    tips.push([Math.round(sh.x + lean - 0.5), Math.round(sh.y - sh.h)]);
  }
  s.render(f.c, f.e);
  for (const sh of shards) {
    const lean = -Math.cos(sh.t) * 2.2;
    walk(sh.x - 0.5, sh.y - 1, sh.x + lean - 0.5, sh.y - sh.h + 1, (_t, x, y) => {
      if (f.c.opaque(x, y)) f.glow(x, y, C.ice, 180);
    });
  }
  f.outline({ selective: true });
  return { f, tips };
}

function icePrison(): Frame[] {
  const { f: base, tips } = icePrisonBase();
  const n = 7; // 14 shards, glint steps 2 per frame: one full lap per loop
  // tips sorted by angle so glints run round the ring
  const byAngle = [...tips].sort((a, b) => Math.atan2(a[1] + 10 - PCY, a[0] - PCX) - Math.atan2(b[1] + 10 - PCY, b[0] - PCX));
  return Array.from({ length: n }, (_, k) => {
    const f = base.clone();
    byAngle.forEach(([x, y], i) => {
      const lit = (i - k * 2 + byAngle.length * 4) % byAngle.length;
      if (lit < 3) {
        const s = lit === 0 ? 255 : lit === 1 ? 200 : 150;
        f.glow(x, y, C.white, s);
        if (f.c.opaque(x, y + 1)) f.glow(x, y + 1, C.white, s * 0.8);
        if (lit === 0) {
          f.glowSoft(x - 1, y, C.ice, 0.8, 200);
          f.glowSoft(x + 1, y, C.ice, 0.8, 200);
          f.glowSoft(x, y - 1, C.ice, 0.8, 200);
        }
      }
    });
    // cold mist drifting round inside the ring
    for (let i = 0; i < 5; i++) {
      const t = (i / 5) * TAU + (k / n) * (TAU / 5);
      const x = PCX + Math.cos(t) * (PR - 5);
      const y = PCY + Math.sin(t) * (PR - 5);
      disc(f, x, y, 3, C.ice, (d) => (1 - d) * 0.22, 40);
    }
    return f;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Ice prison shard: ONE upright shard of the prison, for the presenter to place ICE_PRISON_SHARDS copies on the
// ring's CURRENT radius at 1:1 scale (so the shards keep their size while the ring tightens, and y-sorting puts the
// far half behind the player and the near half in front). Frames: glint × size × lean —
//   index = glint * 14 + size * 7 + (lean + 3), size 0 = tall (14 px) / 1 = short (10 px), lean -3..3 = the tip
//   leaning 1.4 px per step west (-) or east (+). icePrisonShardFrame() picks it from the shard's angle.
// ---------------------------------------------------------------------------------------------------------------
export const ICE_PRISON_SHARDS = 14;
const SH_W = 17;
const SH_H = 22;
const SH_X = 8; // ground point
const SH_Y = 19;

function prisonShard(size: number, lean: number, glint: boolean): Frame {
  const f = new Frame(SH_W, SH_H);
  const h = size === 0 ? 14 : 10;
  const w = size === 0 ? 2.8 : 2.3;
  const L = lean * 1.4;
  const x = SH_X + 0.5;
  const base = SH_Y + 0.5;
  // rime where it bursts from the floor
  for (let dx = -4; dx <= 4; dx++) {
    const a = 0.75 - Math.abs(dx) * 0.14;
    if (hash2(dx, size, 5) > 0.85) continue;
    f.glowSoft(SH_X + dx, SH_Y + 1, Math.abs(dx) < 2 ? C.ice : C.ossFrost, a, 100);
  }
  const s = new Sculpt();
  s.poly([[x - w, base + 0.5], [x + w, base + 0.5], [x + w * 0.72 + L * 0.6, base - h * 0.68], [x + L, base - h], [x - w * 0.72 + L * 0.6, base - h * 0.68]], ICE, 1, 0, 0);
  // a small side crystal at the foot, leaning the other way
  const sx = x + (lean >= 0 ? -w - 0.3 : w + 0.3);
  const sd = lean >= 0 ? -1 : 1;
  s.poly([[sx - 1.3, base + 0.5], [sx + 1.3, base + 0.5], [sx + sd * 1.6, base - h * 0.34]], { ...ICE, bias: 0.1 }, 1, 0, 0);
  s.render(f.c, f.e);
  // the lit spine and the white point
  walk(x - 0.5, base - 1, x + L - 0.5, base - h + 1, (_t, lx, ly) => {
    if (f.c.opaque(lx, ly)) f.glow(lx, ly, C.ice, 180);
  });
  f.outline({ selective: true });
  const tx = Math.round(x + L - 0.5);
  const ty = Math.round(base - h);
  f.glow(tx, ty, C.white, glint ? 255 : 200);
  if (glint) {
    if (f.c.opaque(tx, ty + 1)) f.glow(tx, ty + 1, C.white, 220);
    f.glowSoft(tx - 1, ty, C.ice, 0.85, 220);
    f.glowSoft(tx + 1, ty, C.ice, 0.85, 220);
    f.glowSoft(tx, ty - 1, C.ice, 0.85, 220);
    f.glowSoft(tx, ty - 2, C.white, 0.5, 200);
  }
  return f;
}

/**
 * Frame of 'fx/icePrisonShard' for shard `index` (0..ICE_PRISON_SHARDS-1) standing at `angle` (radians, screen space,
 * 0 = east, +y down) on a ring that is `close` (0 = just cast, 1 = snapping shut) closed, at time `seconds`: the tip
 * leans towards the centre, harder as the ring tightens; tall and short shards alternate; a glint runs round.
 */
export function icePrisonShardFrame(angle: number, close: number, index: number, seconds = 0): number {
  const lean = Math.max(-3, Math.min(3, Math.round((-Math.cos(angle) * (1.2 + 2.3 * clamp01(close))) / 1.1)));
  const lap = Math.floor(seconds * 16) % ICE_PRISON_SHARDS;
  const glint = (((index - lap) % ICE_PRISON_SHARDS) + ICE_PRISON_SHARDS) % ICE_PRISON_SHARDS < 2 ? 1 : 0;
  return glint * 14 + (index & 1) * 7 + lean + 3;
}

function icePrisonShards(): Frame[] {
  const out: Frame[] = [];
  for (const g of [false, true]) for (const size of [0, 1]) for (let l = -3; l <= 3; l++) out.push(prisonShard(size, l, g));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Blizzard: wind-driven snow, not a vortex (a spiral would read as the portal sigil). One dominant wind (towards
// BLIZZARD_WIND, a slight curl in it) blows a lumpy, turbulent cold haze, snow streaks and flakes across a patch with
// a broken edge; everything that leaves the patch re-enters upwind, so the storm reads as contained. Seamless: the
// haze scrolls one noise period and every flake one lane period per loop.
// ---------------------------------------------------------------------------------------------------------------
const BZ = 64;
const BZ_N = 12;
const BZ_ANGLE = 0.32; // radians below east
/** Unit vector the blizzard's snow travels along (screen space, +y down). */
export const BLIZZARD_WIND = { x: Math.cos(BZ_ANGLE), y: Math.sin(BZ_ANGLE) } as const;

/** Value noise periodic in u with `period` px (lattice step `scale`). */
function noiseU(u: number, v: number, scale: number, seed: number, period: number): number {
  const cells = Math.round(period / scale);
  const fu = u / scale;
  const fv = v / scale;
  const iu = Math.floor(fu);
  const iv = Math.floor(fv);
  const tu = fu - iu;
  const tv = fv - iv;
  const su = tu * tu * (3 - 2 * tu);
  const sv = tv * tv * (3 - 2 * tv);
  const w = (i: number): number => ((i % cells) + cells) % cells;
  const a = hash2(w(iu), iv, seed);
  const b = hash2(w(iu + 1), iv, seed);
  const c = hash2(w(iu), iv + 1, seed);
  const d = hash2(w(iu + 1), iv + 1, seed);
  return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv;
}

function blizzard(): Frame[] {
  const S = BZ;
  const c = S / 2;
  const R = 30;
  const cos = Math.cos(BZ_ANGLE);
  const sin = Math.sin(BZ_ANGLE);
  const toUV = (x: number, y: number): [number, number] => [(x - c) * cos + (y - c) * sin, -(x - c) * sin + (y - c) * cos];
  const toXY = (u: number, v: number): [number, number] => [c + u * cos - v * sin, c + u * sin + v * cos];
  /** The wind curls: lanes bow across the wind, periodic along it (so scrolling stays seamless). */
  const curl = (u: number, v: number): number => 2.6 * Math.sin((u / 48) * TAU + v * 0.09);
  // lumpy, broken edge: radius varies with the angle, static across the loop
  const edgeR = (a: number): number => R * (0.8 + 0.1 * Math.sin(3 * a + 1.3) + 0.07 * Math.sin(5 * a + 0.4) + 0.05 * Math.sin(8 * a + 2.2));
  const inside = (x: number, y: number): number => {
    const dx = x - c;
    const dy = y - c;
    const r = Math.hypot(dx, dy);
    const e = edgeR(Math.atan2(dy, dx));
    return clamp01((e - r) / 6);
  };
  const HAZE_P = 48; // haze period along the wind: 4 px per frame
  const flakes = Array.from({ length: 46 }, (_, i) => ({
    v: -R + hash2(i, 0, 91) * 2 * R,
    u0: hash2(i, 1, 91) * 64,
    fast: i % 3 !== 0,
    streak: i % 3 === 0 ? 4 + Math.floor(hash2(i, 2, 91) * 3) : i % 3 === 1 ? 3 : 0,
    wob: hash2(i, 3, 91) * TAU,
  }));
  return Array.from({ length: BZ_N }, (_, k) => {
    const f = new Frame(S, S);
    const drift = (k / BZ_N) * HAZE_P;
    // cold haze: turbulent density blown along the wind, frost-blue shadow lobes, pale where it is thick
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const m = inside(x + 0.5, y + 0.5);
        if (m <= 0) continue;
        const [u, v] = toUV(x + 0.5, y + 0.5);
        const uu = u - drift;
        const vv = v - curl(uu, v);
        const n = 0.65 * noiseU(uu, vv * 2.4, 12, 57, HAZE_P) + 0.35 * noiseU(uu, vv * 1.6, 6, 58, HAZE_P);
        const dens = clamp01((n - 0.34) / 0.5) * m;
        if (dens < 0.06) {
          // a faint cold floor over the whole zone, so its (lumpy) boundary still reads between the gusts
          f.glowSoft(x, y, C.frostMid, 0.16 * m, 70);
          continue;
        }
        const col = dens > 0.68 ? C.ice : dens > 0.38 ? C.frost : C.frostMid;
        const a = Math.min(0.62, (dens > 0.38 ? 0.18 : 0.16) + dens * 0.46);
        f.glowSoft(x, y, col, a, 100 + 30 * dens);
      }
    }
    // snow: flakes and streaks travelling downwind along bowed lanes, 64 px per loop (fast) or 32 (slow, 2 per lane)
    for (const fl of flakes) {
      const period = fl.fast ? 64 : 32;
      const u = ((((fl.u0 + (k / BZ_N) * period) % period) + period) % period) - 32;
      const copies = fl.fast ? [0] : [0, 32];
      for (const off of copies) {
        const uu = u + off - (fl.fast ? 0 : 16);
        const wob = Math.sin((k / BZ_N) * TAU * 2 + fl.wob) * 0.7;
        const lane = (uq: number): number => fl.v + curl(uq - drift, fl.v) + wob;
        const vv = lane(uu);
        const len = fl.streak;
        for (let s = len; s >= 0; s--) {
          const [x, y] = toXY(uu - s * 1.05, lane(uu - s * 1.05));
          const m = inside(x, y);
          if (m <= 0.05) continue;
          const head = s === 0;
          const a = m * (head ? 1 : 1 - s / (len + 1));
          glowMax(f, Math.floor(x), Math.floor(y), head ? C.white : s < 2 ? C.ice : C.frost, (head ? 240 : 170 - s * 14) * a);
        }
        if (!len && !fl.fast) {
          const [x, y] = toXY(uu, vv);
          if (inside(x, y) > 0.3) f.glowSoft(Math.floor(x) + 1, Math.floor(y), C.ice, 0.6 * inside(x, y), 150);
        }
      }
    }
    return f;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Tar pool: a flat puddle of glossy black tar (variants). Near-black body with a faint oily sheen, a thin bright
// meniscus broken along the lit (top-left) rim, a bounce-lit lower rim, sharp emissive reflections and a bubble or two.
// ---------------------------------------------------------------------------------------------------------------
function tarPool(v: number): Frame {
  const S = 40;
  const c = S / 2;
  const f = new Frame(S, S);
  const edgeR = (a: number): number => 15.2 + 1.4 * Math.sin(3 * a + v * 1.7) + 0.9 * Math.sin(5 * a + v * 2.9 + 1) + 0.5 * Math.sin(9 * a + v);
  const depthAt = (x: number, y: number): number => {
    const dx = x - c;
    const dy = y - c;
    return 1 - Math.hypot(dx, dy) / edgeR(Math.atan2(dy, dx));
  };
  // satellite splashes
  const drops: [number, number, number][] = [];
  for (let i = 0; i < 3; i++) {
    const a = hash2(i, v, 33) * TAU;
    const rr = edgeR(a) + 2.4 + hash2(i, v, 34) * 1.2;
    drops.push([c + Math.cos(a) * rr, c + Math.sin(a) * rr, 1.1 + hash2(i, v, 35) * 0.7]);
  }
  const at = (px: number, py: number): number => {
    let d = depthAt(px, py);
    for (const [dx, dy, r] of drops) d = Math.max(d, (1 - Math.hypot(px - dx, py - dy) / r) * 0.12);
    return d;
  };
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const d = at(px, py);
      if (d < -0.1) continue;
      if (d < 0) {
        soft(f, x, y, C.ink, 0.4 * (1 + d / 0.1)); // stain soaking into the floor
        continue;
      }
      // the rim: which way does the edge face? (+ = towards the top-left light)
      const gx = at(px + 1, py) - at(px - 1, py);
      const gy = at(px, py + 1) - at(px, py - 1);
      const facing = (gx + gy) / (Math.hypot(gx, gy) * Math.SQRT2 || 1);
      const n = valueNoise(x, y, 4, 70 + v);
      // near-black body; a faint cool sheen band across the upper-left interior (reflected ambient)
      let col: Color = C.ink;
      if (d > 0.12 && d < 0.4 && facing > 0.35 && n > 0.35) col = C.voidDeep;
      else if (d > 0.45 && n > 0.72) col = C.coal;
      // a thin wet rim all round, catching a little more light on the far (lower-right) side
      if (d < 0.06) col = facing < -0.3 ? C.char : C.coal;
      f.c.set(x, y, col);
    }
  }
  // reflections: a sharp streak of the arena's light in the upper left, two smaller glints
  const refl: [number, number, number][] = [[c - 8 + v, c - 6, 4], [c - 4 + v, c - 9, 2], [c + 5 - v, c + 2 + v, 1]];
  refl.forEach(([x, y, len], i) => {
    for (let j = 0; j < len; j++) {
      const xi = Math.round(x) + j;
      const yi = Math.round(y) - (i === 0 && j >= 2 ? 1 : 0);
      if (!f.c.opaque(xi, yi)) continue;
      const hot = j === (i === 0 ? 1 : 0);
      f.glow(xi, yi, hot ? C.white : j === 0 ? C.ashGrey : C.bone, hot ? 230 : 140);
    }
    if (i === 0) f.glow(Math.round(x) + 1, Math.round(y) + 1, C.stone, 90);
  });
  // bubbles: a raised ring with its highlight on the lit side (placed on a diagonal, never side by side)
  const bubbles = ([[c + 3 + v, c - 1 - v], [c - 2 - v, c + 6]] as [number, number][]).slice(0, 1 + (v % 2 === 0 ? 1 : 0));
  for (const [bx, by] of bubbles) {
    const x = Math.round(bx);
    const y = Math.round(by);
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) if (f.c.opaque(x + dx, y + dy)) f.c.set(x + dx, y + dy, C.char);
    f.glow(x - 1, y - 1, C.ashGrey, 140);
  }
  return f;
}

// ---------------------------------------------------------------------------------------------------------------
// Web: frost-silk spokes and a sagging spiral, with dew beads that glint
// ---------------------------------------------------------------------------------------------------------------
function web(v: number): Frame {
  const S = 40;
  const f = new Frame(S, S);
  const cx = 20 + (v ? 1 : -1);
  const cy = 20 + (v ? -1 : 0);
  const spokes = 9;
  const ends: [number, number, number][] = [];
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * TAU + (hash2(i, v, 1) - 0.5) * 0.35 + v * 0.3;
    const len = 15 + hash2(i, v, 2) * 3.2;
    ends.push([a, len, 0]);
    walk(cx, cy, cx + Math.cos(a) * len, cy + Math.sin(a) * len, (t, x, y) => {
      f.glowSoft(x, y, C.ossFrost, 0.8 - t * 0.25, 90);
    });
    // anchor tuft at the end
    f.glowSoft(Math.round(cx + Math.cos(a) * len), Math.round(cy + Math.sin(a) * len), C.ice, 0.8, 110);
  }
  // spiral threads between neighbouring spokes, sagging towards the centre
  const rings = [3.5, 6, 8.5, 11, 13.5];
  rings.forEach((r0, j) => {
    for (let i = 0; i < spokes; i++) {
      if (hash2(i, j, 7 + v) > 0.88) continue; // torn
      const [a0, l0] = ends[i];
      const [a1, l1] = ends[(i + 1) % spokes];
      const r = Math.min(r0 + i * 0.28, l0 - 1, l1 - 1);
      const x0 = cx + Math.cos(a0) * r;
      const y0 = cy + Math.sin(a0) * r;
      const x1 = cx + Math.cos(a1) * r;
      const y1 = cy + Math.sin(a1) * r;
      const mx = (x0 + x1) / 2;
      const my = (y0 + y1) / 2;
      const sag = 0.8;
      const qx = mx + (cx - mx) * (sag / Math.max(1, r)) * 1.2;
      const qy = my + (cy - my) * (sag / Math.max(1, r)) * 1.2;
      walk(x0, y0, qx, qy, (_t, x, y) => f.glowSoft(x, y, C.ice, 0.62, 70));
      walk(qx, qy, x1, y1, (_t, x, y) => f.glowSoft(x, y, C.ice, 0.62, 70));
      // dew beads at some crossings
      if (hash2(i, j, 9 + v) > 0.72) f.glow(Math.round(x0), Math.round(y0), C.white, 230);
    }
  });
  // dense hub
  for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]) f.glow(cx + dx, cy + dy, dx === 0 && dy === 0 ? C.white : C.ice, 200);
  // a strand of frost-silk clumped on one spoke
  const [ca, cl] = ends[v * 3 + 1];
  f.glow(Math.round(cx + Math.cos(ca) * cl * 0.6), Math.round(cy + Math.sin(ca) * cl * 0.6), C.white, 220);
  return f;
}

// ---------------------------------------------------------------------------------------------------------------
// Chain: one CHAIN_PERIOD px period, tiling along +x: a face-on oval link (6x4, an open ink hole above the bar that
// threads it) and the edge-on link between neighbours (2 px bar, bright tip). Ink only above and below, so copies
// butt together cleanly; the presenter draws the links WITHOUT a per-sprite outline (or one pass over the line).
// ---------------------------------------------------------------------------------------------------------------
/** Tile period of fx/chain along its length, in px: draw one copy every CHAIN_PERIOD units. */
export const CHAIN_PERIOD = 8;

function chain(): Frame {
  const f = new Frame(CHAIN_PERIOD, 6);
  const P = (x: number, y: number, c: Color): void => f.c.set(x, y, c);
  // face-on link A: walls 2 px thick at the sides, 1 px top and bottom
  for (const [x, y, c] of [
    [1, 1, C.metalHi], [2, 1, C.white], [3, 1, C.metalHi], [4, 1, C.metalLight],
    [0, 2, C.metalLight], [1, 2, C.metalMid], [4, 2, C.metalMid], [5, 2, C.metal],
    [0, 3, C.metalMid], [1, 3, C.metal], [4, 3, C.metal], [5, 3, C.metalDark],
    [1, 4, C.metal], [2, 4, C.metalDark], [3, 4, C.metalDark], [4, 4, C.rustDark],
  ] as [number, number, Color][]) P(x, y, c);
  // the hole (open, dark) over the edge-on link threading it
  P(2, 2, C.ink);
  P(3, 2, C.ink);
  P(2, 3, C.metalLight);
  P(3, 3, C.metalMid);
  // edge-on link B between the face-on ones: a 2 px bar with a bright tip where it turns into the next hole
  P(6, 2, C.metalLight);
  P(7, 2, C.metalHi);
  P(6, 3, C.metal);
  P(7, 3, C.metalMid);
  // ink above and below each column only
  for (let x = 0; x < CHAIN_PERIOD; x++) {
    let top = -1;
    let bot = -1;
    for (let y = 0; y < 6; y++) if (f.c.opaque(x, y)) {
      if (top < 0) top = y;
      bot = y;
    }
    if (top > 0) P(x, top - 1, C.ink);
    if (bot >= 0 && bot < 5) P(x, bot + 1, C.ink);
  }
  f.emit(2, 1, C.white, 150);
  f.emit(1, 1, C.metalHi, 110);
  f.emit(7, 2, C.metalHi, 120);
  return f;
}

// ---------------------------------------------------------------------------------------------------------------
// Arena spike tile: an iron grate that shoots spikes
// ---------------------------------------------------------------------------------------------------------------
const AS_W = 16;
const AS_H = 28;
const AS_TOP = 12; // footprint rows 12..27
const HOLES: [number, number][] = [[4, 16], [12, 16], [8, 20], [4, 24], [12, 24]];

function grate(f: Frame, warn: number): void {
  const T = AS_TOP;
  // plate x 1..14, y T+1..T+14: bevelled iron rim, darker recessed floor, rust speckles
  for (let y = T + 1; y <= T + 14; y++) {
    for (let x = 1; x <= 14; x++) {
      const rim = x <= 2 || x >= 13 || y <= T + 2 || y >= T + 13;
      let c: Color;
      if (rim) {
        const lit = x <= 2 || y <= T + 2;
        const outer = x === 1 || x === 14 || y === T + 1 || y === T + 14;
        c = lit ? (outer ? C.metalLight : C.metalMid) : outer ? C.metalDeep : C.metalDark;
        if (x >= 13 && y <= T + 2) c = C.metal;
        if (x <= 2 && y >= T + 13) c = C.metal;
      } else {
        c = hash2(x, y, 61) > 0.82 ? C.rustDark : (x + y) % 4 === 0 ? C.metal : C.metalDark;
      }
      f.c.set(x, y, c);
    }
  }
  // rivets on the rim
  for (const [x, y] of [[2, T + 2], [13, T + 2], [2, T + 13], [13, T + 13], [8, T + 2], [8, T + 13]]) f.c.set(x, y, C.metalHi);
  // holes: 2x2 pits with a lit lower lip; glowing ember-red when the trap arms
  for (const [hx, hy] of HOLES) {
    for (const [dx, dy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) f.c.set(hx + dx, hy + dy, C.ink);
    f.c.set(hx - 1, hy + 1, C.metalMid);
    f.c.set(hx, hy + 1, C.metalLight);
    if (warn > 0) {
      f.glow(hx - 1, hy, C.ember, 220 * warn);
      f.glow(hx, hy, C.flame, 240 * warn);
      f.glow(hx - 1, hy - 1, C.lavaDark, 180 * warn);
      f.glow(hx, hy - 1, C.ember, 200 * warn);
    }
  }
  // sand grit blown over the edges
  for (const [x, y] of [[0, T + 5], [15, T + 9], [6, T + 15], [0, T + 12], [11, T]]) f.c.set(x, y, C.sandMid);
}

function spikes(f: Frame, h: number, bloody: boolean): void {
  if (h <= 0) return;
  const s = new Sculpt();
  const iron: PrimStyle = { ramp: RAMPS.metal, bias: 0.9, dither: 0.05, round: 1.3 };
  // back row first
  for (const [hx, hy] of [...HOLES].sort((a, b) => a[1] - b[1])) {
    const x = hx - 0.5;
    s.poly([[x - 2, hy + 0.5], [x + 2, hy + 0.5], [x + 0.9, hy - h * 0.55], [x, hy - h]], iron, 0.9, -0.2, -0.1);
  }
  s.render(f.c, f.e);
  for (const [hx, hy] of HOLES) {
    const tipY = Math.round(hy - h);
    // a lit edge up the left flank and a hot glint at the point
    walk(hx - 2, hy - 1, hx - 1, tipY + 1, (_t, x, y) => {
      if (f.c.opaque(x, y)) f.c.set(x, y, C.metalHi);
    });
    if (bloody && h > 6) {
      f.c.set(hx - 1, tipY + 1, C.lifeLight);
      f.c.set(hx - 1, tipY + 2, C.life);
      f.c.set(hx, tipY + 3, C.blood);
    }
    f.glow(hx - 1, tipY, C.white, 200);
  }
}

function dust(f: Frame, t: number): void {
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + 0.3;
    const r = 5 + t * 5;
    const x = 8 + Math.cos(a) * r * 1.1;
    const y = AS_TOP + 8 + Math.sin(a) * r * 0.55 - t * 3;
    const al = (1 - t) * 0.7;
    soft(f, Math.round(x), Math.round(y), i % 2 ? C.sandLight : C.sand, al);
    soft(f, Math.round(x) + 1, Math.round(y), C.sandMid, al * 0.6);
  }
}

function arenaSpike(k: number): Frame {
  const f = new Frame(AS_W, AS_H);
  const heights = [0, 0, 5, 13, 13, 8, 3, 0];
  grate(f, k === 1 ? 1 : k === 2 ? 0.6 : 0);
  if (k === 3) dust(f, 0.2);
  if (k === 4) dust(f, 0.6);
  spikes(f, heights[k], k >= 3 && k <= 5);
  f.outline({ selective: true });
  if (k === 2) {
    // sparks where iron scrapes out of the holes
    for (const [hx, hy] of HOLES.slice(0, 3)) f.glow(hx + 1, hy - 3, C.hot, 220);
  }
  return f;
}

// ---------------------------------------------------------------------------------------------------------------
// Execution mark: an ominous blood-red sigil on the floor under the marked player
// ---------------------------------------------------------------------------------------------------------------
function executionMark(k: number): Frame {
  const S = 48;
  const c = S / 2;
  const f = new Frame(S, S);
  const N = 8;
  const ph = (k / N) * TAU;
  const pulse = 0.78 + 0.22 * Math.sin(ph);
  const RED: Color[] = [C.lifeDark, C.blood, C.life, C.lifeLight, C.hot];
  // dark blood haze inside
  disc(f, c, c, 22, C.lifeDark, (d) => 0.18 * (1 - d * d) + (d > 0.9 ? 0.15 : 0), 50);
  // outer ring (2 px) with tick marks rotating clockwise, one tick spacing per loop
  for (let a = 0; a < 360; a += 1) {
    const t = (a * Math.PI) / 180;
    f.glow(Math.floor(c + Math.cos(t) * 21.5), Math.floor(c + Math.sin(t) * 21.5), C.blood, 200 * pulse);
    f.glow(Math.floor(c + Math.cos(t) * 20.5), Math.floor(c + Math.sin(t) * 20.5), C.life, 170 * pulse);
  }
  for (let i = 0; i < 12; i++) {
    const t = (i / 12) * TAU + (k / N) * (TAU / 12);
    for (let r = 17.5; r <= 19.5; r += 0.5) glowMax(f, c + Math.cos(t) * r, c + Math.sin(t) * r, i % 3 === 0 ? C.lifeLight : C.life, 220 * pulse);
  }
  // inward teeth at the four quarters, pressing in with the pulse
  const press = Math.sin(ph) * 1.2;
  for (let q = 0; q < 4; q++) {
    const t = (q / 4) * TAU + TAU / 8;
    const ux = Math.cos(t);
    const uy = Math.sin(t);
    const vx = -uy;
    const vy = ux;
    const tipR = 12.5 - press;
    const baseR = 17;
    for (let r = tipR; r <= baseR; r += 0.5) {
      const w = ((r - tipR) / (baseR - tipR)) * 2.6;
      for (let o = -w; o <= w; o += 0.5) {
        const x = c + ux * r + vx * o;
        const y = c + uy * r + vy * o;
        const core = Math.abs(o) < 0.8;
        glowMax(f, x, y, core ? (r < tipR + 1.5 ? C.hot : C.lifeLight) : C.life, (core ? 255 : 200) * pulse);
      }
    }
  }
  // dashed inner ring counter-rotating
  for (let a = 0; a < 360; a += 1.5) {
    const t = (a * Math.PI) / 180 - (k / N) * (TAU / 8);
    const dash = Math.floor(((a / 360) * 8 * 3) % 3);
    if (dash === 2) continue;
    glowMax(f, c + Math.cos(t) * 10.5, c + Math.sin(t) * 10.5, dash === 0 ? C.life : C.blood, 190 * pulse);
  }
  // crossed blades: an X of two narrow swords, points down-left and down-right, hilts up
  const blade = (x0: number, y0: number, x1: number, y1: number): void => {
    walk(x0, y0, x1, y1, (t, x, y) => {
      glowMax(f, x, y, t > 0.85 ? C.hot : C.lifeLight, 255 * pulse);
      glowMax(f, x + 1, y, C.life, 200 * pulse);
    });
    // crossguard near the hilt end
    const dx = x1 - x0;
    const dy = y1 - y0;
    const l = Math.hypot(dx, dy);
    const gx = x0 + (dx / l) * 2.5;
    const gy = y0 + (dy / l) * 2.5;
    walk(gx - (dy / l) * 2.2, gy + (dx / l) * 2.2, gx + (dy / l) * 2.2, gy - (dx / l) * 2.2, (_t, x, y) => glowMax(f, x, y, C.lifeLight, 240 * pulse));
    glowMax(f, x0 - (dx / l), y0 - (dy / l), C.blood, 220 * pulse);
  };
  blade(c - 6, c - 6, c + 5, c + 5);
  blade(c + 5, c - 6, c - 6, c + 5);
  f.glow(c - 1, c - 1, C.white, 255);
  return f;
}

// ---------------------------------------------------------------------------------------------------------------
// Shield arc: a translucent frontal pane that flashes when it blocks
// ---------------------------------------------------------------------------------------------------------------
function shieldArc(k: number): Frame {
  const f = new Frame(24, 32);
  const ax = 4.5;
  const ay = 16.5;
  const fade = [1, 0.85, 0.5, 0.22][k];
  const span = (62 * Math.PI) / 180;
  const R = 13 + k * 0.6;
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 24; x++) {
      const dx = x + 0.5 - ax;
      const dy = y + 0.5 - ay;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      if (Math.abs(a) > span) continue;
      const edgeFade = clamp01((span - Math.abs(a)) / 0.35);
      const d = R - r; // 0 on the outer face, + inward
      if (d < -0.5 || d > 5) continue;
      let col: Color;
      let al: number;
      if (d < 0.5) {
        col = C.white;
        al = 0.95;
      } else if (d < 1.5) {
        col = C.parchment;
        al = 0.7;
      } else {
        col = C.goldHi;
        al = 0.46 - (d - 1.5) * 0.08;
      }
      // faint hex facets in the pane
      if (d >= 1.5 && ((Math.round(a * 9) + Math.round(r)) & 3) === 0) al += 0.2;
      al *= fade * edgeFade;
      f.glowSoft(x, y, col, al, 255 * al);
    }
  }
  if (k <= 1) {
    // impact burst where the blow landed (dead ahead)
    const bx = Math.round(ax + R);
    const by = Math.round(ay);
    const L = k === 0 ? 4 : 2;
    for (let i = -L; i <= L; i++) {
      glowMax(f, bx, by + i, pick([C.goldHi, C.white], 1 - Math.abs(i) / L), 255 * fade);
      glowMax(f, bx + Math.round(i * 0.5), by, C.white, 255 * fade);
    }
    for (const [dx, dy] of [[2, -2], [2, 2], [3, 0]]) f.glowSoft(bx + dx * (k + 1), by + dy * (k + 1), C.hot, 0.8 * fade, 220 * fade);
  }
  return f;
}

export function bestiaryAreaSprites(): SpriteDef[] {
  const seq = (n: number, fn: (k: number) => Frame): Frame[] => Array.from({ length: n }, (_, k) => fn(k));
  return [
    sprite('fx/iceSpike', seq(8, iceSpike), SX, SY, 14, false),
    sprite('fx/icePrison', icePrison(), PCX, PCY, 8, true),
    sprite('fx/icePrisonShard', icePrisonShards(), SH_X, SH_Y, 0, false),
    centred('fx/blizzard', blizzard(), 12, true),
    centred('fx/tarPool', seq(3, tarPool), 0, false),
    centred('fx/web', seq(2, web), 0, false),
    sprite('fx/chain', [chain()], 4, 3, 0, false),
    sprite('fx/arenaSpike', seq(8, arenaSpike), 8, AS_TOP + 8, 12, false),
    centred('fx/executionMark', seq(8, executionMark), 10, true),
    sprite('fx/shieldArc', seq(4, shieldArc), 4, 16, 18, false),
  ];
}
