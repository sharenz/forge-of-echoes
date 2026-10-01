// Shared materials and helpers for the Rimed Ossuary family (GAME_SPEC §14).
//
// The family reads as one set: cool bone (cream lights, violet-grey shadows), rimed stone-blue cloth, faceted ice
// and cold emissive focal points (ice-white cores with frost-blue halos) in place of the Ashen Forge's embers.
// Everything is built with the same tools as src/art/monsters/* (Sculpt shading from the top-left, selective dark
// outline, stamped pixel maps for tiny features), so the rosters look like one game.
//
// Corpses "rime over" instead of burning to ash: colours slide onto the cold ossuary stone ramp by luminance and
// the glow gutters out — the cold twin of `ashify`.
import { Frame } from '../frame';
import { C, type Color, type Ramp } from '../palette';
import { ca, luma, mix } from '../raster';
import type { PrimStyle } from '../shade';

// ---------------------------------------------------------------------------------------------------------------
// Ramps
// ---------------------------------------------------------------------------------------------------------------

/** Cool bone: violet-grey shadows, cream lights. */
export const BONE: Ramp = [C.ossDark, C.hairShadow, C.hairMid, C.ashGrey, C.bone, C.parchment];
/** Bone on the far side of a body (never reaches the cream highlight). */
export const BONE_FAR: Ramp = [C.ink, C.ossDeep, C.ossDark, C.hairShadow, C.hairMid];
/** Deep frost-navy robe. */
export const ROBE: Ramp = [C.ink, C.frostDeep, C.ossDeep, C.ossDark, C.ossMid, C.ossLight];

/**
 * The family's white: a cold lavender-white. The palette's `white` is the warm cream the forge uses for hot cores —
 * on ice it reads as tan dust or bone candles, so ossuary ice and cold cores top out here instead.
 */
export const COLD_WHITE: Color = C.lightning;
/** Faceted ice from deep blue to the cold white. */
export const ICE: Ramp = [C.frostDark, C.frostMid, C.mana, C.frost, C.ice, COLD_WHITE];

/** Solid ice with a faint self-glow (crystals catch the cold light even in the dark). */
export const iceStyle = (glow = 70, bias = 0.4): PrimStyle => ({ ramp: ICE, bias, glow, ao: false, dither: 0.06 });

// ---------------------------------------------------------------------------------------------------------------
// Corpse treatment
// ---------------------------------------------------------------------------------------------------------------

// Tops out at ossPale (the value of the forge's ashGrey), so a rimed corpse settles into the same dark, low-contrast
// range as the Ashen Forge and Iron Coliseum ash corpses instead of staying as bright as the living bone.
const RIME_STEPS: Color[] = [C.ink, C.ossDeep, C.ossDark, C.ossMid, C.ossLight, C.ossPale];

/**
 * Rime a frame over: colours move onto the cold ossuary ramp by luminance (t = 0..1) and the glow fades to
 * `glowLeft` of its strength. The cold counterpart of `ashify` (same value range: t = 1 ends as dark as ash).
 */
export function rimeify(src: Frame, t: number, glowLeft: number): Frame {
  const f = src.clone();
  f.c.map((c) => {
    const l = luma(c);
    const g = RIME_STEPS[Math.max(0, Math.min(RIME_STEPS.length - 1, Math.round(l * (RIME_STEPS.length - 1) * 1.05)))];
    return (mix(c, g, t) & 0xffffff00) | ca(c);
  });
  f.e.map((c) => (c & 0xffffff00) | Math.round(ca(c) * glowLeft));
  return f;
}

/** Scale every pixel's alpha (both layers) by k: fading ghosts. */
export function fade(src: Frame, k: number): Frame {
  const f = src.clone();
  f.c.map((c) => (c & 0xffffff00) | Math.round(ca(c) * k));
  f.e.map((c) => (c & 0xffffff00) | Math.round(ca(c) * k));
  return f;
}

// ---------------------------------------------------------------------------------------------------------------
// Outlines
// ---------------------------------------------------------------------------------------------------------------

/**
 * Outline for translucent bodies: like the selective outline, but each outline pixel inherits (a fraction of) the
 * alpha of the body pixel it borders, so a ghost's fading tail keeps a soft edge instead of a hard ink rim.
 */
export function ghostOutline(f: Frame, ink: Color = C.frostDeep, k = 0.9): void {
  const r = f.c;
  const out: [number, number, Color][] = [];
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      if (r.alpha(x, y) > 0) continue;
      let best = 0;
      let lit = false;
      let n: Color = 0;
      for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]] as const) {
        const a = r.alpha(x + dx, y + dy);
        if (a > best) {
          best = a;
          n = r.get(x + dx, y + dy);
          lit = dx > 0 || dy > 0; // the body is right/below: this pixel is on the lit top-left side
        }
      }
      if (best <= 20) continue;
      const col = lit ? mix(n, ink, 0.7) : ink;
      out.push([x, y, (col & 0xffffff00) | Math.round(Math.min(255, best * k))]);
    }
  }
  for (const [x, y, c] of out) r.set(x, y, c);
}

/**
 * Internal contour: where a front primitive overlaps a back one, darken the back pixels bordering it, so a limb
 * crossing a body of the same material keeps a crisp edge (the classic hand-drawn inner line). `owner` is the
 * buffer returned by Sculpt.render.
 */
export function seam(f: Frame, owner: Int16Array, front: (i: number) => boolean, back: (i: number) => boolean, k = 0.55, ink: Color = C.ink): void {
  const W = f.w;
  const H = f.h;
  const hits: [number, number][] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = owner[y * W + x];
      if (o < 0 || !back(o)) continue;
      let near = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const X = x + dx;
        const Y = y + dy;
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const n = owner[Y * W + X];
        if (n >= 0 && front(n)) near = true;
      }
      if (near) hits.push([x, y]);
    }
  }
  for (const [x, y] of hits) f.c.set(x, y, (mix(f.c.get(x, y), ink, k) & 0xffffff00) | 0xff);
}

// ---------------------------------------------------------------------------------------------------------------
// Runes
// ---------------------------------------------------------------------------------------------------------------

/** 3x3 rune glyphs (frost script) shared by the Chorister's song and the Warden's sigils. */
const RUNES: readonly (readonly string[])[] = [
  ['#.#', '.#.', '.#.'],
  ['##.', '.#.', '.##'],
  ['.#.', '###', '.#.'],
  ['#..', '##.', '#.#'],
  ['.##', '#..', '.##'],
];

/** Stamp a rune glyph centred on (x, y). `behind` skips pixels already covered by the figure. */
export function rune(f: Frame, i: number, x: number, y: number, col: Color, strength: number, behind = false): void {
  const g = RUNES[((i % RUNES.length) + RUNES.length) % RUNES.length];
  g.forEach((row, gy) =>
    [...row].forEach((ch, gx) => {
      if (ch !== '#') return;
      const X = Math.round(x) + gx - 1;
      const Y = Math.round(y) + gy - 1;
      if (behind && f.c.opaque(X, Y)) return;
      f.glow(X, Y, col, strength);
    }),
  );
}
