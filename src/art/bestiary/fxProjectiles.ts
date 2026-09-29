// Bestiary projectiles (wave 5): centre-anchored, pointing east (the renderer rotates them), colour-baked like
// src/art/projectiles.ts. Hostile shots always carry a little emissive (a glint, a cold sheen, a streak) so they stay
// readable in the dark arena: "a debuff never comes from an invisible source" (GAME_SPEC §13).
//
//   proj/webShot      14x10 · 4f @10 loop — sticky white-blue wad of frost-silk, netted, trailing strands (Frost Weaver)
//   proj/frostShard   16x11 · 3f @10 loop — serrated wedge of dark ice with swept-back barbs (Warden / Golem)
//   proj/crossbowBolt 24x5  · 2f @20 loop — iron broadhead, blood-red fletching and a pale motion streak
//   proj/chainHook    17x17 · 2f @8  loop — iron grapnel in profile: ring at the back for fx/chain, two flukes curling back
//   proj/tarGlob      12x11 · 3f @8  loop — glossy black tar glob, dripping (lobbed; shadow comes from the presenter)
//   proj/boneShard    11x11 · 8f @20 loop — bone splinter tumbling a full turn (re-sculpted per 45° step), rime glint
import type { SpriteDef } from '../../contracts/art';
import { Frame } from '../frame';
import { C, RAMPS } from '../palette';
import { Sculpt, hash2, type PrimStyle } from '../shade';
import { TAU, centred, clamp01, put, soft } from './fxKit';

// ---------------------------------------------------------------------------------------------------------------
// Web shot: a sticky, wobbling wad of frost-silk — pale glob netted with darker threads, whiskers of silk flaring
// off it and three strands trailing behind.
// ---------------------------------------------------------------------------------------------------------------
function webShot(): Frame[] {
  const SILK = [C.frostMid, C.frost, C.ossFrost, C.ice, C.white];
  return [0, 1, 2, 3].map((k) => {
    const f = new Frame(14, 10);
    const ph = (k / 4) * TAU;
    // trailing strands first (behind the glob): they wave with a travelling sine
    for (let s = 0; s < 3; s++) {
      const oy = (s - 1) * 1.7;
      for (let x = 0; x <= 7; x++) {
        const u = x / 7; // 0 tail end → 1 at the glob
        const y = 5 + oy * (0.4 + 0.6 * (1 - u)) + Math.sin(ph + x * 0.9 + s * 2.1) * (1 - u) * 1.1;
        if (hash2(x, s, 60 + k) > 0.8 && u < 0.5) continue; // broken, sticky threads
        f.glowSoft(x, Math.round(y), s === 1 ? C.white : C.ice, 0.55 + 0.45 * u, 90 + 90 * u);
      }
    }
    // glob: squashes and stretches as it flies
    const cx = 9.6;
    const cy = 5;
    const rx = 3.3 + Math.sin(ph) * 0.35;
    const ry = 3.2 - Math.sin(ph) * 0.35;
    for (let y = 0; y < 10; y++) {
      for (let x = 5; x < 14; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const r = Math.hypot(dx, dy) - hash2(x, y, 31) * 0.18;
        if (r > 1) continue;
        const lit = 0.62 - dx * 0.28 - dy * 0.36 - r * 0.18;
        const c = SILK[Math.max(0, Math.min(4, Math.round(lit * 4.6)))];
        f.glow(x, y, r > 0.82 && lit < 0.5 ? C.frostMid : c, 120 + 90 * clamp01(lit));
      }
    }
    // netting: two threads wrapped round the glob (they rotate a little as it tumbles)
    const t0 = ph * 0.5; // the threads pass through the centre, so half a turn per loop is seamless
    for (let i = 0; i < 2; i++) {
      const a = t0 + i * 1.7;
      for (let s = -3; s <= 3; s++) {
        const x = Math.round(cx + Math.cos(a) * s * 0.9 + Math.sin(a) * 0.4);
        const y = Math.round(cy + Math.sin(a) * s * 0.9);
        if (f.c.opaque(x, y) && Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < 2.9) f.glow(x, y, C.frost, 130);
      }
    }
    // whiskers of silk flaring off the glob
    for (const [x, y] of k % 2 ? [[13, 2], [12, 8], [8, 0]] : [[13, 7], [12, 1], [8, 9]]) f.glowSoft(x, y, C.ice, 0.75, 140);
    // wet highlight
    f.glow(8, 3, C.white, 255);
    f.glow(9, 3, C.white, 235);
    return f;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Frost shard (hostile): heavier and more jagged than the player's smooth Rime Shard — a serrated wedge of dark ice
// with barbs swept back like a harpoon, a deep blue heart, a white spine and a white point.
// ---------------------------------------------------------------------------------------------------------------
function frostShard(): Frame[] {
  return [0, 1, 2].map((k) => {
    const f = new Frame(16, 11);
    const s = new Sculpt();
    const ice: PrimStyle = { ramp: [C.frostDeep, C.frostDark, C.frostMid, C.mana, C.frost, C.ice, C.white], bias: 0.1, dither: 0, glow: 140, round: 1.3 };
    // barbs (behind), then the main wedge
    s.poly([[5, 4.6], [8.5, 4.4], [3, 1]], { ...ice, bias: 0 }, 1);
    s.poly([[5, 6.4], [8.5, 6.6], [3, 10]], { ...ice, bias: -0.8 }, 1);
    s.poly([[1.2, 5.5], [4, 3.2], [10, 3.4], [15.4, 5.5], [10, 7.6], [4, 7.8]], ice, 1.4, 0, -0.2);
    s.render(f.c, f.e);
    // serrations: notches bitten out of both edges
    for (const [x, y] of [[6, 3], [9, 3], [7, 7], [10, 7]]) if (f.c.opaque(x, y)) f.erase(x, y);
    // white spine on the upper face, dark heart beneath it
    for (let x = 3; x <= 13; x++) {
      if (f.c.opaque(x, 5)) f.glow(x, 5, x > 9 ? C.white : C.ice, 200);
      if (f.c.opaque(x, 6) && x > 3 && x < 12) f.glow(x, 6, C.frostDark, 90);
    }
    f.outline({ selective: true });
    // travelling glint and the white point
    const gx = Math.round(4 + k * 3.5);
    f.glow(gx, 4, C.white, 255);
    f.glow(15, 5, C.white, 255);
    // rime crumbs shed behind
    f.glowSoft(0, 3 + (k % 2) * 4, C.frost, 0.8, 140);
    if (k === 1) f.glowSoft(1, 8, C.ice, 0.6, 120);
    return f;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Crossbow bolt: fast — a long pale streak, a blood-red fletched shaft and an iron broadhead that catches the light.
// ---------------------------------------------------------------------------------------------------------------
function crossbowBolt(): Frame[] {
  return [0, 1].map((k) => {
    const f = new Frame(24, 5);
    // motion streak (behind): widest right behind the fletching, fading to the tail
    for (let x = 0; x <= 8; x++) {
      const u = x / 8;
      const flick = hash2(x, k, 71) > 0.75 ? 0.2 : 0;
      f.glowSoft(x, 2, u > 0.6 ? C.white : C.parchment, clamp01(0.2 + 0.75 * u - flick), 90 + 130 * u);
      if (u > 0.4) {
        f.glowSoft(x, 1, C.bone, 0.3 * u, 70);
        f.glowSoft(x, 3, C.bone, 0.3 * u, 70);
      }
    }
    // shaft
    for (let x = 7; x <= 18; x++) {
      put(f, x, 2, x % 4 === 0 ? C.woodLight : C.wood);
      put(f, x, 3, C.woodDeep);
    }
    // fletching: two blood-red vanes swept back
    const vane: [number, number, number][] = [
      [6, 1, C.lifeDark], [7, 1, C.blood], [8, 1, C.life], [9, 1, C.life], [10, 1, C.lifeLight],
      [7, 0, C.lifeDark], [8, 0, C.blood],
      [6, 3, C.lifeDark], [7, 3, C.blood], [8, 3, C.blood], [9, 3, C.life], [10, 3, C.life],
      [7, 4, C.lifeDark], [8, 4, C.lifeDark],
    ];
    for (const [x, y, c] of vane) put(f, x, y, c);
    // nock
    put(f, 6, 2, C.bone);
    // broadhead: an iron leaf, lit on top
    const head: [number, number, number][] = [
      [19, 1, C.metalLight], [20, 1, C.metalHi], [21, 1, C.metalLight],
      [19, 2, C.metalMid], [20, 2, C.metalLight], [21, 2, C.metalHi], [22, 2, C.metalHi],
      [19, 3, C.metalDark], [20, 3, C.metal], [21, 3, C.metalMid],
      [18, 0, C.metal], [18, 4, C.metalDark],
    ];
    for (const [x, y, c] of head) put(f, x, y, c);
    f.outline({ selective: true });
    // the tip glints (so the fast bolt is visible in the dark)
    f.glow(23, 2, C.white, 255);
    f.glow(22, 2, C.hot, 170 + k * 60);
    f.emit(21, 1, C.metalHi, 120);
    return f;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Chain hook: a grapnel in profile — a small ring for the chain (fx/chain links) at the back, a 2 px shank, a spear
// point at the front and two flukes that sweep out and curl BACK towards the ring, each ending in a barbed point.
// Upper fluke lit, lower in shadow; the points glint cold.
// ---------------------------------------------------------------------------------------------------------------
const HOOK_W = 17;
const HOOK_H = 17;

function chainHook(): Frame[] {
  return [0, 1].map((k) => {
    const f = new Frame(HOOK_W, HOOK_H);
    const P = (x: number, y: number, c: number): void => f.c.set(x, y, c);
    const mirror = (y: number): number => HOOK_H - 1 - y;
    // upper fluke, drawn as [x, y, lit colour, shadow colour]; the lower one mirrors it in shadow tones
    const fluke: [number, number, number, number][] = [
      [12, 7, C.metalLight, C.metalMid], [13, 7, C.metalMid, C.metal],
      [12, 6, C.metalHi, C.metal], [13, 6, C.metalMid, C.metalDark],
      [12, 5, C.metalHi, C.metalMid], [13, 5, C.metal, C.metalDark],
      [11, 4, C.metalHi, C.metalMid], [12, 4, C.metalMid, C.metalDark],
      [10, 3, C.metalHi, C.metalMid], [11, 3, C.metalLight, C.metal],
      [9, 3, C.metalLight, C.metal], [8, 3, C.metalLight, C.metal],
      [7, 4, C.metalMid, C.metalDark], // the point curling back down towards the shank
      [8, 2, C.metalHi, C.metalMid], // barb, flaring forward and out
    ];
    for (const [x, y, lit, dark] of fluke) {
      P(x, y, lit);
      P(x, mirror(y), dark);
    }
    // shank (2 px, lit on top) with a rust-dark collar where the flukes are forged on
    for (let x = 3; x <= 13; x++) {
      P(x, 8, x % 4 === 1 ? C.metalHi : C.metalLight);
      P(x, 9, x === 11 ? C.rustDark : C.metal);
    }
    // spear point
    P(14, 8, C.metalHi);
    P(15, 8, C.white);
    P(14, 9, C.metalMid);
    // ring for the chain: 3x3 with an open eye
    for (const [x, y, c] of [[0, 7, C.metalLight], [1, 7, C.metalHi], [2, 7, C.metalMid], [0, 8, C.metalMid], [2, 8, C.metal], [0, 9, C.metal], [1, 9, C.metalDark], [2, 9, C.metalDark]] as [number, number, number][]) P(x, y, c);
    f.outline({ selective: true });
    // cold gleams: the spear point, and a glint that moves between the two fluke points
    f.glow(15, 8, C.white, 230);
    f.glow(14, 8, C.metalHi, 160);
    if (k === 0) f.glow(8, 2, C.white, 200);
    else f.glow(7, mirror(4), C.metalHi, 170);
    f.emit(11, 4, C.metalHi, 110);
    return f;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Tar glob: an oily black glob wobbling in flight, a glossy highlight (emissive so it reads on dark floors) and a
// stringy drip trailing behind.
// ---------------------------------------------------------------------------------------------------------------
function tarGlob(): Frame[] {
  const TAR = [C.ink, C.coal, C.rustDeep, C.char, C.iron];
  return [0, 1, 2].map((k) => {
    const f = new Frame(12, 11);
    const ph = (k / 3) * TAU;
    const cx = 7;
    const cy = 5.2;
    const rx = 3.6 + Math.sin(ph) * 0.4;
    const ry = 3.4 - Math.sin(ph) * 0.35;
    for (let y = 0; y < 11; y++) {
      for (let x = 1; x < 12; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const r = Math.hypot(dx, dy) - hash2(x, y, 5 + k) * 0.12;
        if (r > 1) continue;
        // mostly black: only a narrow lit band towards the top-left, a faint warm bounce low-right
        const lit = 0.35 - dx * 0.3 - dy * 0.35;
        let c = TAR[Math.max(0, Math.min(2, Math.round(lit * 3)))];
        if (r > 0.78 && dx + dy > 0.6) c = C.char; // rim picked out by bounce light
        put(f, x, y, c);
      }
    }
    // drip tail: a stringy strand with a drop at the end
    const tail: [number, number][] = [[3, 6], [2, 6], [1, 7]];
    tail.forEach(([x, y], i) => put(f, x, y + (i > 0 && k === 1 ? 1 : 0), i < 2 ? C.coal : C.ink));
    put(f, 0, k === 2 ? 6 : 8, C.coal);
    put(f, 4, 8 + (k & 1), C.coal);
    f.outline({ selective: true, color: C.ink });
    // gloss: a curved specular arc and a pin-point; bubble on the surface
    for (const [x, y, c, s] of [[4, 4, C.ashGrey, 140], [5, 3, C.bone, 190], [6, 2, C.parchment, 220], [7, 2, C.bone, 170], [8, 2, C.stoneLight, 120]] as [number, number, number, number][]) f.glow(x, y, c, s);
    f.glow(5, 2, C.white, 255);
    // faint reflected light on the lower-right belly
    if (f.c.opaque(9, 7)) f.glow(9, 7, C.stone, 80);
    if (k === 1) f.glow(9, 6, C.stone, 90);
    else soft(f, 9, 7 - (k >> 1), C.iron, 0.9);
    return f;
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Bone shard: a splintered bone fragment tumbling end over end. Each frame re-sculpts the same bone at a new angle
// (the light stays top-left), so the fragment keeps its identity while it spins.
// ---------------------------------------------------------------------------------------------------------------
function boneShard(): Frame[] {
  const frames: Frame[] = [];
  // one full turn in 8 steps of 45°, so the loop seam is just another step (no flip of the asymmetric bone)
  for (let k = 0; k < 8; k++) {
    const f = new Frame(11, 11);
    const a = (k * Math.PI) / 4;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    const R = (x: number, y: number): [number, number] => [5.5 + x * cos - y * sin, 5.5 + x * sin + y * cos];
    const bone: PrimStyle = { ramp: RAMPS.bone, bias: 0.5, dither: 0.05, round: 1.1 };
    const s = new Sculpt();
    // shaft from the knuckle (-x) to the splintered end (+x)
    const [k0x, k0y] = R(-3.2, 0);
    const [k1x, k1y] = R(-3.9, -1.1);
    const [e0x, e0y] = R(2.2, 0);
    s.cap(k0x, k0y, e0x, e0y, 1.3, 0.95, bone);
    s.ell(k0x, k0y, 1.6, 1.6, bone);
    s.ell(k1x, k1y, 1.1, 1.1, { ...bone, bias: 0.2 });
    s.poly([R(1.6, -1.1), R(4.6, -0.6), R(2.6, 0.2), R(3.6, 1.2), R(1.6, 1)], bone, 0.8);
    s.render(f.c, f.e);
    // marrow fleck and a crack along the shaft
    const [mx, my] = R(0.4, 0.3);
    if (f.c.opaque(Math.round(mx), Math.round(my))) f.c.set(Math.round(mx), Math.round(my), C.stone);
    f.outline({ selective: true });
    // rime glint on the uppermost bone pixel
    const b = f.c.bounds();
    if (b) {
      for (let x = b.x0; x <= b.x1; x++) {
        const c = f.c.get(x, b.y0 + 1);
        if ((c & 255) && c !== C.ink) {
          f.glow(x, b.y0 + 1, C.ossFrost, 160);
          break;
        }
      }
    }
    frames.push(f);
  }
  return frames;
}

export function bestiaryProjectileSprites(): SpriteDef[] {
  return [
    centred('proj/webShot', webShot(), 10, true),
    centred('proj/frostShard', frostShard(), 10, true),
    centred('proj/crossbowBolt', crossbowBolt(), 20, true),
    centred('proj/chainHook', chainHook(), 8, true),
    centred('proj/tarGlob', tarGlob(), 8, true),
    centred('proj/boneShard', boneShard(), 20, true),
  ];
}

