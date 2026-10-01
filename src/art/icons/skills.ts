// Skill icons: bold effect silhouettes on a dark, element-tinted plate (they sit on the hotbar at small size).
import type { PixelImage } from '../../contracts/art';
import type { Frame } from '../frame';
import { C, type Color, type Ramp } from '../palette';
import { ICON, line, newIcon, px, sparkle } from './kit';

/** Rounded plate: dark gradient tinted by the element, a lit top-left bevel and a soft centre glow. */
function plate(tint: Ramp): Frame {
  const f = newIcon();
  for (let y = 1; y < ICON - 1; y++) {
    for (let x = 1; x < ICON - 1; x++) {
      const corner = (x === 1 || x === ICON - 2) && (y === 1 || y === ICON - 2);
      if (corner) continue;
      const v = y / ICON;
      let c = v < 0.35 ? tint[1] : v < 0.75 ? tint[0] : C.ink;
      const d = Math.hypot(x + 0.5 - 16, y + 0.5 - 16) / 16;
      if (d < 0.55 && (x + y) % 2 === 0) c = tint[1];
      if (d < 0.35) c = tint[2];
      px(f, x, y, c);
    }
  }
  // bevel: lit top/left, dark bottom/right
  for (let i = 2; i < ICON - 2; i++) {
    px(f, i, 1, tint[3]);
    px(f, 1, i, tint[2]);
    px(f, i, ICON - 2, C.ink);
    px(f, ICON - 2, i, C.ink);
  }
  return f;
}

function finish(f: Frame): PixelImage {
  // crisp dark frame so plates separate from any UI background
  for (let i = 0; i < ICON; i++) {
    for (const [x, y] of [[i, 0], [i, ICON - 1], [0, i], [ICON - 1, i]]) {
      const corner = (x === 0 || x === ICON - 1) && (y === 0 || y === ICON - 1);
      if (!corner) px(f, x, y, C.ink);
    }
  }
  return f.c.toImage();
}

const FIRE_PLATE: Ramp = [C.lavaDeep, C.wineDark, C.wineMid, C.lavaDark];
const COLD_PLATE: Ramp = [C.frostDeep, C.frostDark, C.frostMid, C.mana];
const STORM_PLATE: Ramp = [C.voidDeep, C.voidDark, C.voidMid, C.void];
const VOID_PLATE: Ramp = [C.voidDeep, C.voidDark, C.voidMid, C.voidLight];
const WARD_PLATE: Ramp = [C.rustDeep, C.rustDark, C.rust, C.ochre];

/** Thick glowing stroke: hot core with coloured edges. */
function stroke(f: Frame, x0: number, y0: number, x1: number, y1: number, core: Color, edge: Color, width = 1): void {
  for (let o = -width; o <= width; o++) {
    const c = o === 0 ? core : edge;
    line(f, x0 + (o > 0 ? o : 0), y0 + (o < 0 ? -o : 0), x1 + (o > 0 ? o : 0), y1 + (o < 0 ? -o : 0), c);
  }
}

function emberLance(): Frame {
  const f = plate(FIRE_PLATE);
  // trailing flame, thickening towards the white-hot head
  for (let i = 0; i < 20; i++) {
    const t = i / 19;
    const x = 5 + t * 20;
    const y = 27 - t * 20;
    const w = Math.round(t * 2.2);
    for (let o = -w; o <= w; o++) {
      const c = o === 0 ? (t > 0.6 ? C.white : C.hot) : Math.abs(o) === w ? C.ember : C.flame;
      px(f, x + o * 0.7, y + o * 0.7, c);
    }
  }
  sparkle(f, 26, 6, C.white, 2);
  for (const [x, y] of [[6, 21], [10, 26], [4, 25]]) px(f, x, y, C.flame);
  return f;
}

function emberNova(): Frame {
  const f = plate(FIRE_PLATE);
  for (let i = 0; i < 8; i++) {
    const t = (i / 8) * Math.PI * 2;
    // flame teardrops bursting outward
    for (let r = 5; r <= 12; r++) {
      const k = (r - 5) / 7;
      const x = 16 + Math.cos(t) * r;
      const y = 16 + Math.sin(t) * r;
      px(f, x, y, k > 0.75 ? C.hot : k > 0.4 ? C.flame : C.ember);
      if (k > 0.5 && k < 0.95) {
        px(f, x - Math.sin(t), y + Math.cos(t), C.ember);
        px(f, x + Math.sin(t), y - Math.cos(t), C.ember);
      }
    }
  }
  for (let y = 13; y <= 19; y++) for (let x = 13; x <= 19; x++) if (Math.hypot(x - 16, y - 16) < 3) px(f, x, y, Math.hypot(x - 16, y - 16) < 1.5 ? C.white : C.hot);
  return f;
}

function flameWave(): Frame {
  const f = plate(FIRE_PLATE);
  for (let k = 0; k < 3; k++) {
    const cx = 8 + k * 6;
    const cy = 24 - k * 6;
    for (let a = -1.3; a <= 1.3; a += 0.05) {
      const r = 8;
      const x = cx + Math.cos(a - 0.785) * r;
      const y = cy + Math.sin(a - 0.785) * r;
      const edge = Math.abs(a) > 1.05;
      px(f, x, y, edge ? C.ember : k === 2 ? C.hot : C.flame);
      px(f, x - 1, y + 1, edge ? C.lavaDark : C.ember);
    }
  }
  return f;
}

function rimeShards(): Frame {
  const f = plate(COLD_PLATE);
  const shard = (angle: number, len: number): void => {
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    for (let i = 0; i <= len; i++) {
      const t = i / len;
      const w = t < 0.7 ? 1.6 * (t / 0.7) : 1.6 * (1 - (t - 0.7) / 0.3);
      const x = 6 + dx * i;
      const y = 26 + dy * i;
      for (let o = -Math.round(w); o <= Math.round(w); o++) {
        const c = o < 0 ? C.ice : o === 0 ? C.white : C.frost;
        px(f, x - dy * o, y + dx * o, c);
      }
    }
    px(f, 6 + dx * (len + 1), 26 + dy * (len + 1), C.white);
  };
  shard(-0.35, 21);
  shard(-0.785, 23);
  shard(-1.22, 21);
  sparkle(f, 26, 5, C.white, 1);
  return f;
}

function arcChain(): Frame {
  const f = plate(STORM_PLATE);
  const nodes: [number, number][] = [[6, 25], [15, 14], [25, 20], [22, 6]];
  const bolt = (a: [number, number], b: [number, number], seed: number): void => {
    const steps = 6;
    let px0 = a[0];
    let py0 = a[1];
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const jitter = i === steps ? 0 : ((seed * 7 + i * 13) % 5) - 2;
      const x = a[0] + (b[0] - a[0]) * t + jitter * 0.8;
      const y = a[1] + (b[1] - a[1]) * t - jitter * 0.6;
      stroke(f, px0, py0, x, y, C.white, C.storm, 1);
      px0 = x;
      py0 = y;
    }
  };
  bolt(nodes[0], nodes[1], 1);
  bolt(nodes[1], nodes[2], 2);
  bolt(nodes[2], nodes[3], 3);
  for (const [x, y] of nodes) sparkle(f, x, y, C.lightning, 2);
  return f;
}

function riftStep(): Frame {
  const f = plate(VOID_PLATE);
  // a hooded silhouette leaving violet afterimages as she blinks
  const figure = (ox: number, oy: number, cols: [Color, Color]): void => {
    const [body, rim] = cols;
    for (let y = 0; y < 14; y++) {
      const hw = y < 4 ? 2 - Math.abs(y - 2) * 0.5 + 1 : 1.5 + (y - 4) * 0.35;
      for (let x = -Math.round(hw); x <= Math.round(hw); x++) px(f, ox + x, oy + y, x === -Math.round(hw) || y === 0 ? rim : body);
    }
    px(f, ox + 1, oy - 1, rim);
  };
  figure(8, 13, [C.voidDark, C.voidMid]);
  figure(14, 11, [C.voidMid, C.void]);
  figure(21, 8, [C.coal, C.voidGlow]);
  // destination swirl
  for (let i = 0; i < 24; i++) {
    const t = i * 0.5;
    const r = 1 + i * 0.25;
    px(f, 21 + Math.cos(t) * r * 1.3, 25 + Math.sin(t) * r * 0.5, i > 16 ? C.voidLight : C.voidGlow);
  }
  sparkle(f, 26, 5, C.voidHi, 1);
  return f;
}

function cinderWard(): Frame {
  const f = plate(WARD_PLATE);
  // a ring of ember shards orbiting a hot core
  for (let i = 0; i < 8; i++) {
    const t = (i / 8) * Math.PI * 2 + 0.2;
    const x = 16 + Math.cos(t) * 10;
    const y = 16 + Math.sin(t) * 10;
    const tx = -Math.sin(t);
    const ty = Math.cos(t);
    for (let j = -2; j <= 2; j++) px(f, x + tx * j, y + ty * j, j === 0 ? C.hot : Math.abs(j) === 1 ? C.flame : C.ember);
    px(f, x - Math.cos(t), y - Math.sin(t), C.gold);
  }
  // faint dome ring
  for (let a = 0; a < 360; a += 4) {
    const t = (a * Math.PI) / 180;
    if ((a / 4) % 3 === 0) px(f, 16 + Math.cos(t) * 13, 16 + Math.sin(t) * 13, C.ochre);
  }
  for (let y = 12; y <= 20; y++) for (let x = 12; x <= 20; x++) {
    const d = Math.hypot(x - 16, y - 16);
    if (d < 4) px(f, x, y, d < 1.5 ? C.white : d < 2.8 ? C.hot : C.flame);
  }
  return f;
}

export const SKILL_ICONS: Record<string, () => PixelImage> = {
  'icon/skill/emberLance': () => finish(emberLance()),
  'icon/skill/emberNova': () => finish(emberNova()),
  'icon/skill/flameWave': () => finish(flameWave()),
  'icon/skill/rimeShards': () => finish(rimeShards()),
  'icon/skill/arcChain': () => finish(arcChain()),
  'icon/skill/riftStep': () => finish(riftStep()),
  'icon/skill/cinderWard': () => finish(cinderWard()),
};
