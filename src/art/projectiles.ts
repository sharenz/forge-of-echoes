// Projectiles: centre-anchored, pointing east (the renderer rotates them). Everything that burns is emissive.
import type { SpriteDef } from '../contracts/art';
import { Frame, toSprite } from './frame';
import { C, type Color } from './palette';
import { hash2 } from './shade';

const centre = (f: Frame, fps: number) => ({ anchorX: Math.floor(f.w / 2), anchorY: Math.floor(f.h / 2), fps, loop: true });

/** Ember Lance: a long bolt, white-hot at the head, burning down to a flickering ember tail. */
function emberLance(): Frame[] {
  return [0, 1, 2].map((k) => {
    const f = new Frame(20, 7);
    const ramp: Color[] = [C.lavaDark, C.ember, C.flame, C.hot, C.white];
    for (let x = 1; x <= 18; x++) {
      const t = x / 18; // 0 tail → 1 head
      const flick = hash2(x, k, 91) > 0.7 ? -1 : 0;
      const core = Math.min(4, Math.floor(t * 5) + flick);
      if (core >= 0) f.glow(x, 3, ramp[Math.max(0, core)], 150 + 105 * t);
      // body thickens towards the head, tail flickers
      if (t > 0.3 + (hash2(x, k, 5) > 0.6 ? 0.1 : 0)) {
        const c = ramp[Math.max(0, Math.min(3, Math.floor(t * 4) - 1))];
        f.glow(x, 2, c, 120 + 110 * t);
        f.glow(x, 4, c, 110 + 100 * t);
      }
      if (t > 0.75) {
        f.glowSoft(x, 1, C.ember, 0.55, 150);
        f.glowSoft(x, 5, C.ember, 0.45, 140);
      }
    }
    f.glow(19, 3, C.hot, 255);
    f.glow(18, 3, C.white, 255);
    // stray sparks shed from the tail
    f.glowSoft(k * 2 + 1, k % 2 === 0 ? 1 : 5, C.flame, 0.8, 200);
    return f;
  });
}

/** Ember Nova flame: a small teardrop of fire trailing behind its hot head. */
function novaFlame(): Frame[] {
  return [0, 1, 2].map((k) => {
    const f = new Frame(12, 10);
    const cx = 7.5;
    const cy = 5;
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 12; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        // teardrop: round head, tapering tail to the west
        const r = dx > 0 ? Math.hypot(dx, dy) / 3.2 : Math.hypot(dx / (3 + k * 0.6), dy / (3.2 + dx * 0.35));
        if (r > 1) continue;
        const flick = hash2(x, y, 7 + k) * 0.25;
        const v = 1 - r + flick;
        const c = v > 0.85 ? C.white : v > 0.62 ? C.hot : v > 0.4 ? C.flame : v > 0.2 ? C.ember : C.lavaDark;
        f.glowSoft(x, y, c, r > 0.85 ? 0.6 : 1, 150 + 105 * Math.min(1, v));
      }
    }
    return f;
  });
}

/** Flame Wave: a tall crescent of fire bulging forward, hot on its leading edge. */
function flameWave(): Frame[] {
  return [0, 1, 2].map((k) => {
    const f = new Frame(14, 24);
    const cy = 12;
    for (let y = 1; y < 23; y++) {
      const u = (y + 0.5 - cy) / 11; // -1..1
      const bulge = Math.sqrt(Math.max(0, 1 - u * u));
      const front = 3 + bulge * 8.5;
      const thick = 1 + bulge * 3.2 + (hash2(y, k, 17) > 0.6 ? 0.8 : 0);
      for (let x = 0; x < 14; x++) {
        const d = front - (x + 0.5);
        if (d < -0.5 || d > thick) continue;
        const t = d / thick; // 0 leading edge → 1 trailing
        const c = t < 0.2 ? C.hot : t < 0.45 ? C.flame : t < 0.75 ? C.ember : C.lavaDark;
        f.glowSoft(x, y, c, t > 0.8 ? 0.6 : 1, 255 - t * 110);
      }
    }
    // licks of flame trailing behind
    for (let i = 0; i < 4; i++) {
      const y = 4 + i * 5 + k;
      if (y > 21) continue;
      const u = (y + 0.5 - cy) / 11;
      const x = Math.round(3 + Math.sqrt(Math.max(0, 1 - u * u)) * 8.5 - 5);
      f.glowSoft(x, y, C.ember, 0.7, 170);
    }
    return f;
  });
}

/** Rime Shard: a faceted ice splinter with a cold glint travelling along it. */
function rimeShard(): Frame[] {
  return [0, 1].map((k) => {
    const f = new Frame(16, 7);
    // a kite: tail at x=1, widest at x=10, point at x=15
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 16; x++) {
        // point-in-kite
        const cx = x + 0.5;
        const cy = y + 0.5;
        const halfH = cx < 10 ? ((cx - 1) / 9) * 2.1 : ((15 - cx) / 5) * 2.1;
        if (halfH <= 0 || Math.abs(cy - 3.5) > halfH) continue;
        const top = cy < 3.5;
        let c = top ? (cx > 8 ? C.ice : C.frost) : cx > 8 ? C.frost : C.mana;
        if (Math.abs(cy - 3.5) > halfH - 0.8) c = top ? C.frost : C.frostMid;
        f.glow(x, y, c, top ? 150 : 110);
      }
    }
    // glint
    f.glow(9 + k * 3, 2, C.white, 255);
    f.glow(14, 3, C.white, 230);
    // frost trail
    f.glowSoft(0, 3, C.frost, 0.5, 120);
    return f;
  });
}

/** Cinder Spit: a molten glob with a dark crust and a dripping tail. */
function cinderSpit(): Frame[] {
  return [0, 1].map((k) => {
    const f = new Frame(12, 10);
    const cx = 7;
    const cy = 5;
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 12; x++) {
        const dx = (x + 0.5 - cx) / (3.3 - k * 0.3);
        const dy = (y + 0.5 - cy) / (3 + k * 0.3);
        const r = Math.hypot(dx, dy);
        if (r > 1) continue;
        const crust = hash2(x, y, 23) > 0.55 && r > 0.55;
        if (crust) f.c.set(x, y, r > 0.8 ? C.lavaDeep : C.rustDeep);
        else f.glow(x, y, r < 0.35 ? C.hot : r < 0.6 ? C.flame : C.ember, 230 - r * 80);
      }
    }
    // drip tail
    f.glow(2, 5, C.ember, 200);
    f.glow(1, 5 + k, C.lavaDark, 170);
    f.glow(3, 4, C.lavaDark, 160);
    f.c.set(2, 6 - k, C.lavaDeep);
    return f;
  });
}

/** Swirling orb: dark core ringed by bright arcs that rotate across the frames. */
function orb(size: number, ramp: readonly Color[], frames: number, arms: number, coreDark: boolean): Frame[] {
  const out: Frame[] = [];
  const c = size / 2;
  const R = size / 2 - 1;
  for (let k = 0; k < frames; k++) {
    const f = new Frame(size, size);
    const rot = (k / frames) * Math.PI * 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x + 0.5 - c;
        const dy = y + 0.5 - c;
        const r = Math.hypot(dx, dy) / R;
        if (r > 1) continue;
        const a = Math.atan2(dy, dx);
        // spiral arms
        const arm = Math.cos(arms * (a - rot) + r * 5) * 0.5 + 0.5;
        let v = coreDark ? (r < 0.35 ? 0.1 : 0.35 + arm * 0.5 * r + (1 - r) * 0.2) : 1 - r * 0.8 + arm * 0.35 * r;
        if (r > 0.82) v = Math.max(v, coreDark ? 0.75 : 0.45);
        const i = Math.max(0, Math.min(ramp.length - 1, Math.round(v * (ramp.length - 1))));
        f.glowSoft(x, y, ramp[i], r > 0.92 ? 0.7 : 1, 120 + 135 * v);
      }
    }
    if (coreDark) {
      f.glow(Math.round(c - 1), Math.round(c - 1), ramp[ramp.length - 1], 255);
    } else {
      f.glow(Math.floor(c), Math.floor(c), C.white, 255);
      f.glow(Math.floor(c) - 1, Math.floor(c), C.white, 255);
    }
    out.push(f);
  }
  return out;
}

// --- power rework SK2 roster batch 1 --------------------------------------------------------------------------------

/** Spark: a crackling knot of lightning with jagged filaments that flicker frame to frame. */
function spark(): Frame[] {
  return [0, 1, 2, 3].map((k) => {
    const f = new Frame(11, 11);
    f.glow(5, 5, C.white, 255);
    f.glow(4, 5, C.lightning, 240);
    f.glow(6, 5, C.lightning, 240);
    f.glow(5, 4, C.lightning, 230);
    f.glow(5, 6, C.lightning, 230);
    // four jagged arms, rotated per frame
    for (let a = 0; a < 4; a++) {
      const ang = (a / 4) * Math.PI * 2 + k * 0.7 + hash2(a, k, 3) * 0.6;
      let x = 5.5;
      let y = 5.5;
      for (let s = 0; s < 4; s++) {
        x += Math.cos(ang + (hash2(a, s + k * 7, 11) - 0.5) * 1.4) * 1.2;
        y += Math.sin(ang + (hash2(a, s + k * 7, 13) - 0.5) * 1.4) * 1.2;
        const px = Math.floor(x);
        const py = Math.floor(y);
        if (px < 0 || py < 0 || px > 10 || py > 10) break;
        f.glowSoft(px, py, s < 2 ? C.lightning : C.storm, s < 2 ? 1 : 0.7, 230 - s * 35);
      }
    }
    return f;
  });
}

/** Cinder Mortar shell: an iron-banded fire bomb, glowing seams and a sputtering fuse. */
function cinderShell(): Frame[] {
  return [0, 1].map((k) => {
    const f = new Frame(12, 12);
    const c = 6;
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 12; x++) {
        const r = Math.hypot(x + 0.5 - c, y + 0.5 - c) / 4.6;
        if (r > 1) continue;
        const seam = Math.abs(y + 0.5 - c) < 0.8 || Math.abs(x + 0.5 - c - (k ? 0.5 : 0)) < 0.6;
        if (seam) f.glow(x, y, r < 0.5 ? C.hot : C.flame, 220 - r * 60);
        else f.c.set(x, y, r > 0.8 ? C.rustDeep : r > 0.45 ? C.rustDark : C.rust);
      }
    }
    // highlight and fuse
    f.c.set(4, 3, C.metalLight);
    f.glow(9, 2, k ? C.white : C.hot, 255);
    f.glow(10, 1, C.flame, 200);
    f.glowSoft(11, 0 + k, C.ember, 0.7, 170);
    return f;
  });
}

/** Umbral Bolt: a heavy violet comet, a dark core inside a bright rim, a smoky wake behind. */
function umbralBolt(): Frame[] {
  return [0, 1, 2].map((k) => {
    const f = new Frame(22, 11);
    const hx = 15.5;
    const cy = 5.5;
    for (let y = 0; y < 11; y++) {
      for (let x = 0; x < 22; x++) {
        const dx = x + 0.5 - hx;
        const dy = y + 0.5 - cy;
        const r = dx > 0 ? Math.hypot(dx, dy) / 4.6 : Math.hypot(dx / (13 + k), dy / (4.6 + dx * 0.18));
        if (r > 1) continue;
        const n = hash2(x, y, 31 + k) * 0.25;
        if (dx > -3 && r < 0.45) f.c.set(x, y, r < 0.25 ? C.voidDeep : C.voidDark);
        else {
          const v = 1 - r + n;
          const col = v > 0.75 ? C.voidHi : v > 0.5 ? C.voidGlow : v > 0.3 ? C.voidLight : C.voidMid;
          f.glowSoft(x, y, col, r > 0.85 ? 0.6 : 1, 110 + 140 * Math.min(1, v));
        }
      }
    }
    f.glow(20, 5, C.voidHi, 255);
    return f;
  });
}

/** Kinetic Lance: a slim grey-gold dart of force with a pale shock cone at its tip. */
function kineticLance(): Frame[] {
  return [0, 1].map((k) => {
    const f = new Frame(18, 7);
    for (let x = 2; x <= 15; x++) {
      const t = (x - 2) / 13;
      f.glow(x, 3, t > 0.7 ? C.goldHi : t > 0.35 ? C.gold : C.metalLight, 120 + 120 * t);
      if (t > 0.5) {
        f.c.set(x, 2, C.metalMid);
        f.c.set(x, 4, C.metalDark);
      }
    }
    // shock cone ahead of the tip
    f.glow(16, 3, C.white, 255);
    f.glowSoft(17, 2 + k, C.goldHi, 0.7, 200);
    f.glowSoft(17, 4 - k, C.goldHi, 0.7, 200);
    f.glowSoft(15, 1, C.bone, 0.5, 140);
    f.glowSoft(15, 5, C.bone, 0.5, 140);
    // faint streak
    f.glowSoft(0, 3, C.metalLight, 0.4, 90);
    return f;
  });
}

/** Frost Orb: a slowly turning sphere of rime with a white core and frost arms. */
function frostOrb(): Frame[] {
  return orb(16, [C.frostDeep, C.frostDark, C.frostMid, C.mana, C.frost, C.ice, C.white], 6, 3, false);
}

export function projectileSprites(): SpriteDef[] {
  const defs: [string, Frame[], number][] = [
    ['emberLance', emberLance(), 16],
    ['novaFlame', novaFlame(), 14],
    ['flameWave', flameWave(), 12],
    ['rimeShard', rimeShard(), 8],
    ['cinderSpit', cinderSpit(), 8],
    ['heraldOrb', orb(12, [C.voidDeep, C.voidDark, C.voidMid, C.void, C.voidLight, C.voidGlow, C.voidHi], 4, 2, true), 10],
    ['matriarchOrb', orb(14, [C.lavaDeep, C.lavaDark, C.ember, C.flame, C.hot, C.white], 4, 3, false), 10],
    // power rework SK2 roster batch 1
    ['spark', spark(), 16],
    ['cinderShell', cinderShell(), 8],
    ['umbralBolt', umbralBolt(), 10],
    ['kineticLance', kineticLance(), 12],
    ['frostOrb', frostOrb(), 8],
  ];
  return defs.map(([id, frames, fps]) => toSprite(`proj/${id}`, frames, centre(frames[0], fps)));
}
