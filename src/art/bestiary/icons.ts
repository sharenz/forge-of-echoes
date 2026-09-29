// HUD icons for player debuffs: 'icon/debuff/<PLAYER_DEBUFFS>' (DEBUFF_ICON_IDS).
//
// 32x32 sources (one inventory cell, like every other icon) in the same frame as the skill icons: an element-tinted
// plate with a lit top-left bevel and a crisp ink border, so debuffs sit naturally next to the hotbar. The glyph on
// each plate is one bold silhouette with its own ink outline and a warm rim light — built to stay recognisable when
// the 32 px source is shown at 24 px in the HUD (no detail thinner than 2 px carries the meaning):
//   chilled  snowflake        frozen   ice block        rooted   skeletal hand clawing out of the floor
//   burning  flame            bleeding blood drop       shocked  lightning bolt      withered  rotting skull oozing violet
import type { PixelImage } from '../../contracts/art';
import { DEBUFF_ICON_IDS } from '../../contracts/bestiary';
import { Frame } from '../frame';
import { C, RAMPS, type Color, type Ramp } from '../palette';
import { ca, lineCells, mix } from '../raster';
import { Sculpt, type PrimStyle } from '../shade';

const S = 32;

/** Every icon id this module draws (= DEBUFF_ICON_IDS). */
export const bestiaryIconIds: readonly string[] = DEBUFF_ICON_IDS;

const px = (f: Frame, x: number, y: number, c: Color): void => f.c.set(Math.round(x), Math.round(y), c);
const line = (f: Frame, x0: number, y0: number, x1: number, y1: number, c: Color): void => lineCells(x0, y0, x1, y1, (x, y) => px(f, x, y, c));

// ---------------------------------------------------------------------------------------------------------------
// Plate + finishing (mirrors the skill icon plate so HUD icons share one frame)
// ---------------------------------------------------------------------------------------------------------------
function plate(tint: Ramp): Frame {
  const f = new Frame(S, S);
  for (let y = 1; y < S - 1; y++) {
    for (let x = 1; x < S - 1; x++) {
      const corner = (x === 1 || x === S - 2) && (y === 1 || y === S - 2);
      if (corner) continue;
      const v = y / S;
      let c = v < 0.35 ? tint[1] : v < 0.75 ? tint[0] : C.ink;
      const d = Math.hypot(x + 0.5 - 16, y + 0.5 - 16) / 16;
      if (d < 0.55 && (x + y) % 2 === 0) c = tint[1];
      if (d < 0.35) c = tint[2];
      px(f, x, y, c);
    }
  }
  for (let i = 2; i < S - 2; i++) {
    px(f, i, 1, tint[3]);
    px(f, 1, i, tint[2]);
    px(f, i, S - 2, C.ink);
    px(f, S - 2, i, C.ink);
  }
  return f;
}

function border(f: Frame): PixelImage {
  for (let i = 0; i < S; i++) {
    for (const [x, y] of [[i, 0], [i, S - 1], [0, i], [S - 1, i]]) {
      const corner = (x === 0 || x === S - 1) && (y === 0 || y === S - 1);
      if (!corner) px(f, x, y, C.ink);
    }
  }
  return f.c.toImage();
}

/** Warm rim on the glyph's upper-right silhouette, then a 1 px ink outline (same treatment as item icons). */
function finishGlyph(g: Frame, rim: Color, strength = 0.35): Frame {
  const r = g.c;
  const lit: [number, number, Color][] = [];
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      const c = r.get(x, y);
      if (ca(c) < 200) continue;
      if (!r.opaque(x + 1, y - 1) && (!r.opaque(x + 1, y) || !r.opaque(x, y - 1))) lit.push([x, y, (mix(c, rim, strength) & 0xffffff00) | ca(c)]);
    }
  }
  for (const [x, y, c] of lit) r.set(x, y, c);
  g.outline({ color: C.ink });
  return g;
}

function compose(tint: Ramp, glyph: Frame): PixelImage {
  const f = plate(tint);
  f.c.blit(glyph.c, 0, 0);
  return border(f);
}

const COLD_PLATE: Ramp = [C.frostDeep, C.frostDark, C.frostMid, C.mana];
const ICE_PLATE: Ramp = [C.frostDeep, C.frostDark, C.frostMid, C.frost];
const IRON_PLATE: Ramp = [C.coal, C.char, C.iron, C.stone];
const FIRE_PLATE: Ramp = [C.lavaDeep, C.wineDark, C.wineMid, C.lavaDark];
const BLOOD_PLATE: Ramp = [C.wineDeep, C.coal, C.char, C.iron];
const STORM_PLATE: Ramp = [C.frostDeep, C.frostDark, C.stormMid, C.storm];
const VOID_PLATE: Ramp = [C.voidDeep, C.voidDark, C.voidMid, C.void];

// ---------------------------------------------------------------------------------------------------------------
// Glyphs
// ---------------------------------------------------------------------------------------------------------------
function snowflake(): Frame {
  const g = new Frame(S, S);
  const cx = 15.5;
  const cy = 15.5;
  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 2 - Math.PI / 2;
    const ux = Math.cos(t);
    const uy = Math.sin(t);
    // arm: 2 px thick, white core on the lit side
    for (let r = 0; r <= 11.5; r += 0.25) {
      const x = cx + ux * r;
      const y = cy + uy * r;
      px(g, x, y, r > 10 ? C.frost : C.white);
      px(g, x + (uy > 0.3 ? -1 : 0) + (Math.abs(uy) <= 0.3 ? 0 : 0), y + (Math.abs(uy) <= 0.3 ? 1 : 0), r > 9 ? C.frost : C.ice);
    }
    // two V branches along the arm
    for (const [r0, len] of [[5, 3.6], [8.5, 2.6]] as [number, number][]) {
      for (const s of [-1, 1]) {
        const bt = t + s * 0.9;
        const bx = cx + ux * r0;
        const by = cy + uy * r0;
        for (let q = 0; q <= len; q += 0.25) px(g, bx + Math.cos(bt) * q, by + Math.sin(bt) * q, q > len - 1 ? C.frost : C.ice);
      }
    }
  }
  // hexagonal heart
  for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) if (Math.abs(x) + Math.abs(y) <= 3) px(g, cx + x, cy + y, Math.abs(x) + Math.abs(y) <= 1 ? C.white : C.ice);
  px(g, cx, cy, C.frost);
  return finishGlyph(g, C.white, 0.2);
}

function iceBlock(): Frame {
  const g = new Frame(S, S);
  // a cube in three-quarter view: top face, front face, right face
  const top: [number, number][] = [[6, 10], [18, 6], [26, 9], [14, 13]];
  const front: [number, number][] = [[6, 10], [14, 13], [14, 27], [6, 24]];
  const side: [number, number][] = [[14, 13], [26, 9], [26, 23], [14, 27]];
  const s = new Sculpt();
  const ice = (bias: number): PrimStyle => ({ ramp: [C.frostDark, C.frostMid, C.mana, C.frost, C.ice, C.white], bias, dither: 0, round: 0.4 });
  s.poly(side, ice(-0.6), 1.2, 0.5, 0.2);
  s.poly(front, ice(0.5), 1.2, -0.4, 0);
  s.poly(top, ice(1.4), 1.2, 0, -0.7);
  s.render(g.c, g.e);
  // crisp lit edges
  line(g, 6, 10, 18, 6, C.white);
  line(g, 6, 10, 14, 13, C.white);
  line(g, 14, 13, 26, 9, C.ice);
  line(g, 14, 14, 14, 26, C.ice);
  line(g, 6, 11, 6, 23, C.ice);
  // glint across the front face and a crack in the side
  line(g, 8, 20, 12, 15, C.white);
  line(g, 9, 21, 12, 17, C.ice);
  line(g, 21, 12, 19, 16, C.frostDark);
  line(g, 19, 16, 22, 19, C.frostDark);
  // rime crystals on top
  px(g, 17, 5, C.white);
  px(g, 17, 4, C.ice);
  px(g, 23, 7, C.white);
  return finishGlyph(g, C.white, 0.25);
}

function graspingHand(): Frame {
  const g = new Frame(S, S);
  // a skeletal hand clawing up out of a cracked floor, fingers hooked to grab — the same bony grip the rooted
  // overlay shows at the player's feet
  const bone = (x0: number, y0: number, x1: number, y1: number): void => {
    line(g, x0 + 1, y0, x1 + 1, y1, C.ashGrey); // shadow side
    line(g, x0, y0, x1, y1, C.bone);
    line(g, x0 - 1, y0, x1 - 1, y1, C.parchment); // lit side
  };
  const joint = (x: number, y: number): void => {
    px(g, x, y, C.parchment);
    px(g, x + 1, y, C.bone);
  };
  // wrist: radius and ulna rising out of the floor
  bone(13, 30, 13, 23);
  bone(18, 30, 18, 23);
  // palm: four metacarpals fanning out from the wrist
  const knuckles: [number, number][] = [[7, 15], [12, 13], [17, 13], [22, 15]];
  for (const [kx, ky] of knuckles) bone(15 + (kx - 15) * 0.4, 22, kx, ky);
  line(g, 10, 21, 20, 21, C.bone); // carpals
  line(g, 10, 22, 20, 22, C.ashGrey);
  // fingers: two phalanges up, the last one hooked forward and down like a claw
  const fingers: [number, number, number, number, number][] = [
    // knuckle x, knuckle y, tip-lean, length, hook direction
    [7, 15, -2, 6, 1], [12, 13, -1, 8, 1], [17, 13, 1, 8, -1], [22, 15, 2, 7, -1],
  ];
  for (const [kx, ky, lean, len, hook] of fingers) {
    const mx = kx + lean * 0.6;
    const my = ky - Math.round(len * 0.55);
    const tx = kx + lean;
    const ty = ky - len;
    joint(kx, ky);
    bone(kx, ky, mx, my);
    joint(Math.round(mx), my);
    bone(mx, my, tx, ty);
    joint(Math.round(tx), ty);
    // claw tip curling over
    px(g, tx + hook, ty + 1, C.bone);
    px(g, tx + hook * 2, ty + 2, C.ashGrey);
  }
  // thumb reaching in from the side
  bone(9, 22, 5, 20);
  joint(4, 20);
  bone(4, 20, 3, 17);
  px(g, 4, 16, C.parchment);
  // the broken floor it burst through, with flung chips
  for (let x = 3; x <= 28; x++) {
    const hump = Math.abs(x - 15.5) < 5 ? 1 : 0; // the floor heaves up where it broke
    if (!g.c.opaque(x, 27 - hump)) px(g, x, 27 - hump, (x * 7) % 5 === 0 ? C.stoneLight : C.stone);
    px(g, x, 28, (x * 3) % 4 === 0 ? C.iron : C.char);
    px(g, x, 29, C.coal);
  }
  for (const [x, y] of [[4, 25], [26, 24], [27, 26], [8, 25]]) px(g, x, y, C.stoneLight);
  return finishGlyph(g, C.flame, 0.3);
}

function flame(): Frame {
  const g = new Frame(S, S);
  // outline of three tongues: height of the flame at each column
  const ramp: Color[] = [C.lavaDark, C.ember, C.flame, C.hot, C.white];
  for (let y = 2; y < 30; y++) {
    for (let x = 4; x < 28; x++) {
      const cx = x + 0.5;
      const cy = y + 0.5;
      // round base
      const base = Math.hypot((cx - 16) / 10, (cy - 21) / 8);
      // tongues: centre tall, sides shorter and leaning out
      const tongue = (tx: number, ty: number, w: number, lean: number): number => {
        const h = 21 - ty;
        const u = (21 - cy) / h; // 0 at base line → 1 at the tip
        if (u < 0 || u > 1) return 2;
        const xc = tx + lean * u * u;
        return Math.abs(cx - xc) / (w * (1 - u) + 0.3);
      };
      const d = Math.min(base, tongue(16, 2, 7.5, 1.5), tongue(9.5, 9, 4, -2.2), tongue(22.5, 11, 3.6, 2));
      if (d > 1) continue;
      // hotter towards the lower centre
      const heat = 1 - Math.hypot((cx - 16) / 9, (cy - 23) / 13);
      const v = (1 - d) * 0.55 + heat * 0.65;
      const i = Math.max(0, Math.min(4, Math.round(v * 4.2)));
      px(g, x, y, ramp[i]);
    }
  }
  return finishGlyph(g, C.hot, 0.2);
}

function bloodDrop(): Frame {
  const g = new Frame(S, S);
  const s = new Sculpt();
  const blood: PrimStyle = { ramp: RAMPS.life, bias: 0.5, dither: 0.05, round: 1 };
  s.poly([[14.5, 3], [21.5, 16], [7.5, 16]], blood, 3, 0, 0);
  s.ell(14.5, 19.5, 8, 8, blood);
  s.ell(25, 25.5, 3.2, 3.4, blood);
  s.render(g.c, g.e);
  // glossy highlights
  line(g, 10, 17, 11, 14, C.lifeLight);
  px(g, 10, 18, C.lifeLight);
  px(g, 11, 13, C.white);
  px(g, 10, 15, C.white);
  px(g, 24, 24, C.white);
  // a darker core low-right for weight
  for (const [x, y] of [[18, 24], [19, 23], [17, 25], [20, 22]]) px(g, x, y, C.lifeDark);
  return finishGlyph(g, C.hot, 0.25);
}

function bolt(): Frame {
  const g = new Frame(S, S);
  const pts: [number, number][] = [[20, 2], [8, 17], [15, 17], [10, 30], [25, 12], [18, 12], [24, 2]];
  const s = new Sculpt();
  s.poly(pts, { ramp: RAMPS.storm, bias: 1.2, dither: 0, round: 0.5 }, 1.5);
  s.render(g.c, g.e);
  // white-hot core stroke down the middle of the bolt
  line(g, 20, 4, 12, 15, C.white);
  line(g, 13, 16, 16, 16, C.white);
  line(g, 16, 16, 13, 25, C.white);
  line(g, 21, 11, 16, 17, C.lightning);
  // crackles
  for (const [x, y] of [[5, 9], [27, 20], [6, 25]]) {
    px(g, x, y, C.lightning);
    px(g, x + 1, y, C.storm);
    px(g, x, y + 1, C.storm);
  }
  return finishGlyph(g, C.white, 0.2);
}

function rotSkull(): Frame {
  const g = new Frame(S, S);
  const BONE: Ramp = [C.voidDark, C.voidMid, C.hairMid, C.bone, C.parchment];
  const s = new Sculpt();
  const bone: PrimStyle = { ramp: BONE, bias: 0.3, dither: 0.06, round: 1 };
  s.ell(16, 13, 9, 8, bone);
  s.poly([[10, 17], [22, 17], [21, 24], [11, 24]], { ...bone, bias: 0 }, 2);
  s.render(g.c, g.e);
  // eye sockets burning with violet decay
  for (const ex of [11, 18]) {
    for (let y = 13; y <= 17; y++) for (let x = ex; x <= ex + 3; x++) {
      const corner = (y === 13 || y === 17) && (x === ex || x === ex + 3);
      if (!corner) px(g, x, y, C.voidDeep);
    }
    px(g, ex + 1, 15, C.voidHi);
    px(g, ex + 2, 15, C.voidGlow);
    px(g, ex + 1, 16, C.voidLight);
  }
  // nose and teeth
  px(g, 15, 19, C.voidDeep);
  px(g, 16, 19, C.voidDeep);
  line(g, 11, 21, 21, 21, C.voidDark);
  for (let x = 12; x <= 20; x += 2) line(g, x, 22, x, 24, C.voidDark);
  // rotting crack across the crown, seeping violet
  line(g, 20, 5, 18, 8, C.voidDark);
  line(g, 18, 8, 20, 11, C.voidDark);
  px(g, 19, 8, C.voidGlow);
  // decay oozing from the sockets and dripping off the jaw
  line(g, 12, 18, 12, 20, C.voidLight);
  line(g, 20, 18, 20, 19, C.voidLight);
  px(g, 12, 21, C.voidGlow);
  line(g, 15, 25, 15, 26, C.voidLight);
  px(g, 15, 27, C.voidGlow);
  return finishGlyph(g, C.voidHi, 0.2);
}

const GLYPHS: Record<string, [Ramp, () => Frame]> = {
  chilled: [COLD_PLATE, snowflake],
  frozen: [ICE_PLATE, iceBlock],
  rooted: [IRON_PLATE, graspingHand],
  burning: [FIRE_PLATE, flame],
  bleeding: [BLOOD_PLATE, bloodDrop],
  shocked: [STORM_PLATE, bolt],
  withered: [VOID_PLATE, rotSkull],
};

const cache = new Map<string, PixelImage>();

/**
 * Raw RGBA pixels (32x32) of a debuff HUD icon. Accepts the full icon id ('icon/debuff/chilled') or the bare debuff
 * id ('chilled'). Throws on an unknown id.
 */
export function debuffIconPixels(id: string): PixelImage {
  const key = id.startsWith('icon/debuff/') ? id.slice('icon/debuff/'.length) : id;
  const hit = cache.get(key);
  if (hit) return hit;
  const entry = GLYPHS[key];
  if (!entry) throw new Error(`debuffIconPixels: unknown debuff icon '${id}'`);
  const img = compose(entry[0], entry[1]());
  cache.set(key, img);
  return img;
}

/** Registry entries in the shape of src/art/icons (id → generator), for merging into its GENERATORS table. */
export const BESTIARY_ICONS: Record<string, () => PixelImage> = Object.fromEntries(bestiaryIconIds.map((id) => [id, () => debuffIconPixels(id)]));
