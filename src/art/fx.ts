// FX sprites, centre-anchored. Particle-style sprites (spark, glow, ring, smoke, ash, frost, beam, shadow) are
// drawn near-white/neutral so the renderer's multiply tint gives them their colour; the others are colour-baked
// with white-hot cores so they still read when tinted.
import type { SpriteDef } from '../contracts/art';
import { Frame, toSprite } from './frame';
import { C, type Color } from './palette';
import { rgba } from './raster';
import { hash2, valueNoise } from './shade';

const WHITE = C.white;
const spec = (f: Frame, fps: number, loop: boolean) => ({ anchorX: Math.floor(f.w / 2), anchorY: Math.floor(f.h / 2), fps, loop });

/** Radial soft disc: alpha(d) in 0..1 for d = distance/radius. */
function disc(f: Frame, cx: number, cy: number, r: number, col: Color, alpha: (d: number) => number, glow = 0): void {
  for (let y = 0; y < f.h; y++) {
    for (let x = 0; x < f.w; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
      if (d > 1) continue;
      const a = alpha(d);
      if (a <= 0.02) continue;
      if (glow > 0) f.glowSoft(x, y, col, a, glow);
      else f.c.plot(x, y, col, a);
    }
  }
}

function spark(): Frame {
  const f = new Frame(5, 5);
  f.glow(2, 2, WHITE, 255);
  for (const [x, y] of [[1, 2], [3, 2], [2, 1], [2, 3]]) f.glow(x, y, C.hot, 220);
  for (const [x, y] of [[0, 2], [4, 2], [2, 0], [2, 4]]) f.glowSoft(x, y, C.parchment, 0.5, 150);
  return f;
}

function ember(): Frame {
  const f = new Frame(3, 3);
  f.glow(1, 1, C.hot, 255);
  for (const [x, y] of [[0, 1], [2, 1], [1, 0], [1, 2]]) f.glowSoft(x, y, C.flame, 0.75, 200);
  return f;
}

function smoke(): Frame {
  const f = new Frame(14, 14);
  disc(f, 7, 7, 6.8, C.ashGrey, (d) => {
    return Math.max(0, (1 - d * d) * 0.75);
  });
  // lumpy, lighter top-left
  f.c.map((c, x, y) => {
    const n = valueNoise(x, y, 3, 77);
    const a = (c & 255) / 255;
    const k = Math.max(0, Math.min(1, a * (0.7 + n * 0.6)));
    const lit = x + y < 12 ? C.bone : C.ashGrey;
    return (lit & 0xffffff00) | Math.round(k * 255);
  });
  return f;
}

function ash(): Frame {
  const f = new Frame(3, 3);
  f.c.set(1, 1, C.ashGrey);
  f.c.set(0, 1, C.stoneLight);
  f.c.plot(2, 0, C.ashGrey, 0.7);
  return f;
}

function frost(): Frame {
  const f = new Frame(7, 7);
  f.glow(3, 3, WHITE, 255);
  for (let i = 1; i <= 3; i++) {
    const c = i === 3 ? C.frost : C.ice;
    const s = i === 3 ? 150 : 210;
    f.glow(3, 3 - i, c, s);
    f.glow(3, 3 + i, c, s);
    if (i < 3) {
      f.glow(3 - i, 3 - i, c, s);
      f.glow(3 + i, 3 + i, c, s);
      f.glow(3 + i, 3 - i, c, s);
      f.glow(3 - i, 3 + i, c, s);
    }
  }
  return f;
}

/** Lightning segment: a jagged white-violet bolt across the frame (stretched along its length at runtime). */
function bolt(k: number): Frame {
  const f = new Frame(24, 9);
  let y = 4;
  for (let x = 0; x < 24; x++) {
    const r = hash2(x, k, 311);
    if (x > 0 && x < 23) y = Math.max(1, Math.min(7, y + (r < 0.3 ? -1 : r > 0.7 ? 1 : 0)));
    else y = 4;
    f.glow(x, y, WHITE, 255);
    f.glowSoft(x, y - 1, C.lightning, 0.8, 220);
    f.glowSoft(x, y + 1, C.storm, 0.7, 200);
    if (hash2(x, k, 5) > 0.8) f.glowSoft(x, y + (r > 0.5 ? 2 : -2), C.storm, 0.5, 170);
  }
  return f;
}

function ring(): Frame {
  const f = new Frame(32, 32);
  disc(f, 16, 16, 15.5, WHITE, (d) => {
    const e = Math.abs(d - 0.9) / 0.1;
    return e > 1 ? 0 : 1 - e * e * 0.7;
  }, 230);
  return f;
}

/**
 * The ember-spiral sigil: the game's motif, shared by portals, the map device and spell circles.
 * An outer rune ring, an inner ring, and a three-armed spiral winding into a hot centre.
 */
export function drawSigil(f: Frame, cx: number, cy: number, R: number, phase: number, strength = 1): void {
  const s = (v: number): number => Math.round(v * strength);
  // outer ring with notched rune marks
  for (let a = 0; a < 360; a += 1) {
    const t = (a * Math.PI) / 180;
    const x = Math.floor(cx + Math.cos(t) * R);
    const y = Math.floor(cy + Math.sin(t) * R * 0.999);
    f.glow(x, y, C.ember, s(190));
  }
  const runes = 8;
  for (let i = 0; i < runes; i++) {
    const t = ((i + phase) / runes) * Math.PI * 2;
    const lit = (i + Math.floor(phase * runes)) % 3 === 0;
    for (let r = R - 3; r <= R - 1; r++) {
      const x = Math.floor(cx + Math.cos(t) * r);
      const y = Math.floor(cy + Math.sin(t) * r);
      f.glow(x, y, lit ? C.hot : C.flame, s(lit ? 255 : 200));
    }
    const t2 = t + 0.12;
    f.glow(Math.floor(cx + Math.cos(t2) * (R - 2)), Math.floor(cy + Math.sin(t2) * (R - 2)), C.ember, s(170));
  }
  // inner ring
  const r2 = R * 0.62;
  for (let a = 0; a < 360; a += 2) {
    const t = (a * Math.PI) / 180;
    f.glow(Math.floor(cx + Math.cos(t) * r2), Math.floor(cy + Math.sin(t) * r2), C.lavaDark, s(170));
  }
  // three-armed spiral into the centre
  for (let arm = 0; arm < 3; arm++) {
    for (let i = 0; i <= 40; i++) {
      const u = i / 40;
      const t = phase * Math.PI * 2 + (arm * Math.PI * 2) / 3 + u * 4.2;
      const r = r2 * (1 - u) * 0.95;
      const c = u > 0.8 ? C.hot : u > 0.45 ? C.flame : C.ember;
      f.glow(Math.floor(cx + Math.cos(t) * r), Math.floor(cy + Math.sin(t) * r), c, s(160 + 95 * u));
    }
  }
  f.glow(Math.floor(cx), Math.floor(cy), C.white, s(255));
}

function sigil(k: number): Frame {
  const f = new Frame(32, 32);
  drawSigil(f, 16, 16, 15, k / 8);
  return f;
}

function slash(k: number): Frame {
  // a crescent swipe sweeping clockwise and fading
  const f = new Frame(24, 24);
  const start = -2.2 + k * 0.5;
  const end = start + 1.6 + Math.min(k, 1) * 0.6;
  const fade = k < 2 ? 1 : k === 2 ? 0.7 : 0.35;
  for (let y = 0; y < 24; y++) {
    for (let x = 0; x < 24; x++) {
      const dx = x + 0.5 - 12;
      const dy = y + 0.5 - 12;
      const r = Math.hypot(dx, dy);
      const a = Math.atan2(dy, dx);
      if (a < start || a > end) continue;
      const u = (a - start) / (end - start); // 0 tail → 1 head
      const thick = 1 + u * 2.4;
      const d = Math.abs(r - 9.5);
      if (d > thick) continue;
      const c = d < thick * 0.35 && u > 0.5 ? WHITE : u > 0.3 ? C.parchment : C.ashGrey;
      f.glowSoft(x, y, c, fade * (0.35 + 0.65 * u) * (1 - d / (thick + 0.5)), 200 * fade);
    }
  }
  return f;
}

function glow(): Frame {
  const f = new Frame(32, 32);
  disc(f, 16, 16, 16, WHITE, (d) => Math.pow(1 - d, 2.2), 255);
  return f;
}

function shadow(): Frame {
  const f = new Frame(16, 6);
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 16; x++) {
      const dx = (x + 0.5 - 8) / 8;
      const dy = (y + 0.5 - 3) / 3;
      const d = dx * dx + dy * dy;
      if (d > 1) continue;
      f.c.set(x, y, rgba(13, 11, 14, Math.round((d < 0.55 ? 0.55 : 0.55 * (1 - (d - 0.55) / 0.45)) * 255)));
    }
  }
  return f;
}

/** Cinder Ward: a ring of ember shards orbiting the player. */
function ward(k: number): Frame {
  const f = new Frame(32, 32);
  const rot = (k / 6) * Math.PI * 2 / 6;
  // faint dome ring
  disc(f, 16, 16, 15, C.flame, (d) => (d > 0.86 ? 0.35 * (1 - Math.abs(d - 0.93) / 0.07) : 0), 140);
  for (let i = 0; i < 6; i++) {
    const t = rot + (i / 6) * Math.PI * 2;
    const x = 16 + Math.cos(t) * 12.5;
    const y = 16 + Math.sin(t) * 12.5;
    // small diamond shard, tangent to the ring
    const tx = -Math.sin(t);
    const ty = Math.cos(t);
    for (let j = -2; j <= 2; j++) {
      const px = Math.round(x + tx * j);
      const py = Math.round(y + ty * j);
      f.glow(px, py, Math.abs(j) === 0 ? C.hot : Math.abs(j) === 1 ? C.flame : C.ember, 230 - Math.abs(j) * 30);
    }
    f.glow(Math.round(x - Math.cos(t)), Math.round(y - Math.sin(t)), C.gold, 200);
  }
  return f;
}

/** Drop beam: a vertical shaft of light, brightest at the base, fading upwards and to the sides. */
function beam(): Frame {
  const f = new Frame(10, 72);
  for (let y = 0; y < 72; y++) {
    const v = y / 71; // 0 top → 1 base
    const vert = Math.pow(v, 1.6);
    for (let x = 0; x < 10; x++) {
      const u = Math.abs(x + 0.5 - 5) / 5;
      const core = u < 0.2 ? 1 : u < 0.45 ? 0.6 : 0.25 * (1 - u);
      const a = core * vert;
      if (a <= 0.02) continue;
      f.glowSoft(x, y, u < 0.2 ? WHITE : C.parchment, a, 255 * a);
    }
  }
  return f;
}

/** Echo mote (XP orb): a pale violet-white orb with a bright core, pulsing. */
function mote(k: number): Frame {
  const f = new Frame(9, 9);
  const r = 3.2 + (k === 1 || k === 2 ? 0.5 : 0);
  disc(f, 4.5, 4.5, r + 1.2, C.storm, (d) => (1 - d) * 0.6, 160);
  disc(f, 4.5, 4.5, r, C.lightning, (d) => (d < 0.8 ? 1 : (1 - d) * 5), 230);
  f.glow(4, 4, WHITE, 255);
  f.glow(3, 3, WHITE, 255);
  return f;
}

function impact(k: number): Frame {
  const f = new Frame(18, 18);
  const r = [3, 6, 8, 8.5][k];
  const fade = [1, 1, 0.65, 0.3][k];
  // burst core
  if (k < 2) disc(f, 9, 9, r * 0.6, WHITE, (d) => 1 - d * 0.3, 255);
  // ring
  disc(f, 9, 9, r, C.hot, (d) => (d > 0.7 ? fade * (1 - Math.abs(d - 0.85) / 0.15) : 0), 230 * fade);
  // rays
  for (let i = 0; i < 8; i++) {
    const t = (i / 8) * Math.PI * 2 + (i % 2) * 0.2;
    const len = r * (i % 2 === 0 ? 1.1 : 0.75);
    for (let s = Math.max(1, r * 0.4); s <= len; s += 0.7) {
      f.glowSoft(Math.floor(9 + Math.cos(t) * s), Math.floor(9 + Math.sin(t) * s), s > len * 0.7 ? C.flame : C.hot, fade, 230 * fade);
    }
  }
  return f;
}

function levelUp(k: number): Frame {
  // a golden ring rises and a pillar of sparkles climbs
  const f = new Frame(32, 40);
  const t = k / 7;
  const ry = 36 - t * 28;
  const fade = k < 6 ? 1 : k === 6 ? 0.6 : 0.3;
  for (let a = 0; a < 360; a += 3) {
    const th = (a * Math.PI) / 180;
    const x = Math.floor(16 + Math.cos(th) * (11 - t * 3));
    const y = Math.floor(ry + Math.sin(th) * (3.5 - t));
    const front = Math.sin(th) > 0;
    f.glowSoft(x, y, front ? C.goldHi : C.gold, fade * (front ? 1 : 0.6), 255 * fade);
  }
  // column glow
  for (let y = Math.floor(ry); y < 40; y++) {
    const v = (y - ry) / Math.max(1, 40 - ry);
    for (let x = 12; x <= 19; x++) {
      const u = Math.abs(x + 0.5 - 16) / 4;
      const a = (1 - u) * (1 - v) * 0.45 * fade;
      if (a > 0.03) f.glowSoft(x, y, C.hot, a, 200 * a);
    }
  }
  // sparkles
  for (let i = 0; i < 7; i++) {
    const sx = 6 + Math.floor(hash2(i, 1, 51) * 20);
    const sy = Math.floor(38 - ((hash2(i, 2, 51) * 30 + k * 4) % 34));
    f.glow(sx, sy, C.white, 255 * fade);
    f.glowSoft(sx - 1, sy, C.goldHi, 0.6 * fade, 180 * fade);
    f.glowSoft(sx + 1, sy, C.goldHi, 0.6 * fade, 180 * fade);
    f.glowSoft(sx, sy - 1, C.goldHi, 0.6 * fade, 180 * fade);
    f.glowSoft(sx, sy + 1, C.goldHi, 0.6 * fade, 180 * fade);
  }
  return f;
}

/** Scorch decal: a burnt patch (perspective-flattened) with a few dying embers. */
function scorch(k: number): Frame {
  const f = new Frame(26, 14);
  for (let y = 0; y < 14; y++) {
    for (let x = 0; x < 26; x++) {
      const dx = (x + 0.5 - 13) / 12.5;
      const dy = (y + 0.5 - 7) / 6.5;
      const n = valueNoise(x, y, 3, 40 + k) * 0.5;
      const d = Math.hypot(dx, dy) + n * 0.5 - 0.1;
      if (d > 1) continue;
      const a = d < 0.55 ? 0.85 : 0.85 * (1 - (d - 0.55) / 0.45);
      f.c.plot(x, y, d < 0.4 ? C.ink : C.coal, a);
    }
  }
  for (let i = 0; i < 4; i++) {
    const x = 7 + Math.floor(hash2(i, k, 9) * 12);
    const y = 4 + Math.floor(hash2(i, k, 10) * 6);
    f.glow(x, y, i === 0 ? C.ember : C.lavaDark, 150);
  }
  return f;
}

/** Ash splatter: where monsters burst into ash. */
function splatter(k: number): Frame {
  const f = new Frame(18, 10);
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 18; x++) {
      const dx = (x + 0.5 - 9) / 7;
      const dy = (y + 0.5 - 5) / 3.6;
      const n = valueNoise(x, y, 2.2, 90 + k);
      const d = Math.hypot(dx, dy) - n * 0.55;
      if (d > 0.62) continue;
      f.c.set(x, y, d < 0.25 ? C.char : n > 0.6 ? C.stone : C.iron);
    }
  }
  // droplets thrown outward
  for (let i = 0; i < 5; i++) {
    const t = hash2(i, k, 13) * Math.PI * 2;
    const x = Math.round(9 + Math.cos(t) * (6 + hash2(i, k, 14) * 2.5));
    const y = Math.round(5 + Math.sin(t) * 3.8);
    f.c.set(x, y, C.iron);
  }
  // a still-warm speck
  f.glow(8 + k, 5, C.lavaDark, 120);
  return f;
}

export function fxSprites(): SpriteDef[] {
  const one = (id: string, f: Frame): SpriteDef => toSprite(`fx/${id}`, [f], spec(f, 0, false));
  const many = (id: string, frames: Frame[], fps: number, loop: boolean): SpriteDef => toSprite(`fx/${id}`, frames, spec(frames[0], fps, loop));
  return [
    one('spark', spark()),
    one('ember', ember()),
    one('smoke', smoke()),
    one('ash', ash()),
    one('frost', frost()),
    many('bolt', [0, 1, 2].map(bolt), 20, true),
    one('ring', ring()),
    many('sigil', [0, 1, 2, 3, 4, 5, 6, 7].map(sigil), 8, true),
    many('slash', [0, 1, 2, 3].map(slash), 18, false),
    one('glow', glow()),
    one('shadow', shadow()),
    many('ward', [0, 1, 2, 3, 4, 5].map(ward), 10, true),
    one('beam', beam()),
    many('mote', [0, 1, 2, 3].map(mote), 8, true),
    many('impact', [0, 1, 2, 3].map(impact), 20, false),
    many('levelUp', [0, 1, 2, 3, 4, 5, 6, 7].map(levelUp), 10, false),
    many('scorch', [0, 1].map(scorch), 0, false),
    many('blood', [0, 1, 2].map(splatter), 0, false),
  ];
}
