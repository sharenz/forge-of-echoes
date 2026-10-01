// Small UI glyph icons: attributes, lock, stability, scar, seal and fracture markers.
import type { PixelImage } from '../../contracts/art';
import type { Frame } from '../frame';
import { C, RAMPS, type Ramp } from '../palette';
import { Sculpt, type PrimStyle } from '../shade';
import { finishIcon, gem, line, newIcon, onBody, px, sparkle } from './kit';

const style = (ramp: Ramp, bias = 0.2, extra: Partial<PrimStyle> = {}): PrimStyle => ({ ramp, bias, dither: 0.06, ...extra });
const SKIN: Ramp = [C.skinDeep, C.skinShadow, C.skin, C.skinLight];

function strength(): Frame {
  // a clenched fist wrapped in a burgundy band
  const f = newIcon();
  const s = new Sculpt();
  s.cap(9, 28, 13, 20, 4, 4, style(SKIN, 0));
  s.ell(16, 14, 8, 7, style(SKIN, 0.3));
  s.render(f.c, f.e);
  // knuckles and finger creases
  for (let i = 0; i < 4; i++) {
    const x = 11 + i * 3.4;
    px(f, x, 9, C.skinLight);
    line(f, x + 1.6, 9, x + 1.6, 15, C.skinDeep);
  }
  line(f, 10, 16, 22, 16, C.skinShadow);
  // thumb
  line(f, 10, 17, 17, 19, C.skinShadow);
  line(f, 10, 16, 16, 18, C.skin);
  // wrap
  for (let i = 0; i < 3; i++) line(f, 7 + i * 1.5, 25 - i * 2, 15 + i * 1.5, 27 - i * 2, i % 2 ? C.wineDark : C.wineMid);
  return f;
}

function dexterity(): Frame {
  // a feather: quick and light
  const f = newIcon();
  const vane: Ramp = [C.mossDark, C.moss, C.olive, C.oliveLight, C.bone];
  for (let i = 0; i < 22; i++) {
    const t = i / 21;
    const x = 6 + t * 19;
    const y = 27 - t * 22 + Math.sin(t * 3) * 1.5;
    const w = Math.sin(t * Math.PI) * 5;
    for (let o = 1; o <= w; o++) {
      const k = o / Math.max(1, w);
      px(f, x - o * 0.7, y - o * 0.7 + (o % 3 === 0 ? 1 : 0), vane[Math.min(4, Math.round(3 - k * 2))]);
      px(f, x + o * 0.7, y + o * 0.7, vane[Math.min(4, Math.round(2 - k * 2))]);
    }
    px(f, x, y, C.bone);
  }
  line(f, 3, 30, 7, 26, C.woodLight);
  sparkle(f, 26, 5, C.oliveLight, 1);
  return f;
}

function intelligence(): Frame {
  // an eye wreathed in a blue focus flame
  const f = newIcon();
  for (let i = 0; i < 12; i++) {
    const x = 9 + i * 1.3;
    const h = 6 + Math.round(Math.sin(i * 0.9) * 3) + (i > 3 && i < 8 ? 4 : 0);
    for (let k = 0; k < h; k++) px(f, x, 16 - k, k > h - 3 ? C.frostDark : k > h / 2 ? C.mana : C.frost);
  }
  const s = new Sculpt();
  s.ell(16, 18, 9, 5, style([C.frostDark, C.ossPale, C.ossFrost, C.white], 0.5, { round: 0.6 }));
  s.render(f.c, f.e);
  gem(f, 16, 18, 3.2, 3.2, [C.frostDeep, C.frostDark, C.mana, C.frost, C.ice]);
  px(f, 16, 18, C.ink);
  px(f, 17, 18, C.ink);
  line(f, 7, 18, 10, 15, C.frostDark);
  line(f, 25, 18, 22, 15, C.frostDark);
  return f;
}

function locked(): Frame {
  const f = newIcon();
  // shackle
  for (let a = 180; a <= 360; a += 4) {
    const t = (a * Math.PI) / 180;
    for (const r of [6, 7]) px(f, 16 + Math.cos(t) * r, 14 + Math.sin(t) * r, r === 7 ? C.metalLight : C.metal);
  }
  for (let y = 14; y <= 16; y++) {
    px(f, 9, y, C.metalLight);
    px(f, 10, y, C.metal);
    px(f, 22, y, C.metal);
    px(f, 23, y, C.metalMid);
  }
  const s = new Sculpt();
  s.poly([[6, 16], [26, 16], [26, 29], [6, 29]], style(RAMPS.metal, 0.4), 2);
  s.render(f.c, f.e);
  // keyhole
  px(f, 16, 21, C.ink);
  px(f, 15, 21, C.ink);
  px(f, 16, 22, C.ink);
  px(f, 15, 22, C.ink);
  line(f, 15, 23, 15, 25, C.ink);
  line(f, 16, 23, 16, 25, C.ink);
  for (const [x, y] of [[8, 18], [24, 18], [8, 27], [24, 27]]) px(f, x, y, C.metalHi);
  return f;
}

function stability(): Frame {
  // a balanced cairn of stones with an ember at its heart
  const f = newIcon();
  const s = new Sculpt();
  s.ell(16, 25, 10, 4.5, style(RAMPS.stone, 0.2));
  s.ell(16, 17.5, 7.5, 3.8, style(RAMPS.stone, 0.4));
  s.ell(16, 11, 5, 3.2, style(RAMPS.stone, 0.6));
  s.ell(16, 5.5, 3, 2.3, style(RAMPS.stone, 0.8));
  s.render(f.c, f.e);
  px(f, 16, 17, C.flame);
  px(f, 17, 17, C.ember);
  for (const [x, y] of [[9, 24], [22, 25], [12, 18]]) onBody(f, x, y, C.moss);
  return f;
}

function scar(): Frame {
  // a jagged burning scar, stitched shut
  const f = newIcon();
  const pts: [number, number][] = [[5, 27], [10, 21], [13, 22], [17, 15], [20, 16], [26, 6]];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    line(f, x0, y0, x1, y1, C.lifeLight);
    line(f, x0 + 1, y0, x1 + 1, y1, C.blood);
    line(f, x0 - 1, y0, x1 - 1, y1, C.life);
  }
  // stitches across
  for (const [x, y] of [[8, 23], [14, 19], [20, 13], [24, 9]]) {
    line(f, x - 2, y - 2, x + 2, y + 2, C.bone);
  }
  px(f, 13, 22, C.hot);
  return f;
}

function sealMark(): Frame {
  // a compact wax seal with the ember spiral: "this affix is protected"
  const f = newIcon();
  const s = new Sculpt();
  s.poly([[16, 5], [23, 8], [27, 15], [24, 23], [16, 27], [8, 24], [5, 16], [8, 8]], style(RAMPS.wine, 0.8, { round: 0.7 }), 3);
  s.render(f.c, f.e);
  for (let i = 0; i < 18; i++) {
    const t = i * 0.6;
    const r = 0.5 + i * 0.3;
    onBody(f, 16 + Math.cos(t) * r, 16 + Math.sin(t) * r, C.wineDeep);
  }
  px(f, 11, 10, C.wineHi);
  return f;
}

function fracture(): Frame {
  // a crystal split by a bright fracture line: "this affix is permanent"
  const f = newIcon();
  const s = new Sculpt();
  s.poly([[16, 3], [25, 14], [16, 29], [7, 14]], style([C.voidDeep, C.voidDark, C.voidMid, C.storm, C.lightning, C.white], 0.5, { round: 0.5 }), 2);
  s.render(f.c, f.e);
  const crack: [number, number][] = [[12, 6], [15, 12], [13, 17], [18, 21], [16, 27]];
  for (let i = 0; i + 1 < crack.length; i++) {
    line(f, crack[i][0], crack[i][1], crack[i + 1][0], crack[i + 1][1], C.white);
    line(f, crack[i][0] + 1, crack[i][1], crack[i + 1][0] + 1, crack[i + 1][1], C.voidDeep);
  }
  return f;
}

export const UI_ICONS: Record<string, () => PixelImage> = {
  'icon/ui/attributeStr': () => finishIcon(strength()),
  'icon/ui/attributeDex': () => finishIcon(dexterity()),
  'icon/ui/attributeInt': () => finishIcon(intelligence(), C.frost),
  'icon/ui/locked': () => finishIcon(locked()),
  'icon/ui/stability': () => finishIcon(stability()),
  'icon/ui/scar': () => finishIcon(scar()),
  'icon/ui/seal': () => finishIcon(sealMark()),
  'icon/ui/fracture': () => finishIcon(fracture(), C.lightning),
};
