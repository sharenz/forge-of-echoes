// Built-in proportional 5x7 bitmap font (printable ASCII 32..126).
//
// Every glyph lives in a 5x9 cell: rows 0..6 are the ascent (capitals and digits are 7 px tall, lowercase has a
// 5 px x-height on rows 2..6) and rows 7..8 hold descenders (g j p q y , ; _). Glyphs are left-aligned in the
// cell; `width` is the inked width used for the advance (width + 1 px letter spacing). Digits are all 5 px wide
// so damage numbers do not jitter while they count.
import type { PixelImage } from '../contracts/art';

export const GLYPH_CELL_W = 5;
export const GLYPH_CELL_H = 9;
/** Height of capitals/digits; text is vertically centred on this band. */
export const GLYPH_ASCENT = 7;
export const FIRST_CHAR = 32;
export const LAST_CHAR = 126;
export const GLYPH_COUNT = LAST_CHAR - FIRST_CHAR + 1;
/** Pixels between glyphs at scale 1. */
export const LETTER_SPACING = 1;

export interface Glyph {
  char: string;
  /** Inked width in pixels (0 for nothing but the space advance). */
  width: number;
  /** GLYPH_CELL_H rows of `width` characters: '#' = ink, '.' = empty. */
  rows: string[];
  /** Uses the descender rows 7..8. */
  descender: boolean;
}

// Source bitmaps. 7 rows = no descender; 9 rows = uses the descender band.
const SRC: Record<string, string[]> = {
  ' ': ['...', '...', '...', '...', '...', '...', '...'],
  '!': ['#', '#', '#', '#', '#', '.', '#'],
  '"': ['#.#', '#.#', '...', '...', '...', '...', '...'],
  '#': ['.#.#.', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.#.#.'],
  $: ['..#..', '.####', '#.#..', '.###.', '..#.#', '####.', '..#..'],
  '%': ['##..#', '##..#', '...#.', '..#..', '.#...', '#..##', '#..##'],
  '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
  "'": ['#', '#', '.', '.', '.', '.', '.'],
  '(': ['..#', '.#.', '#..', '#..', '#..', '.#.', '..#'],
  ')': ['#..', '.#.', '..#', '..#', '..#', '.#.', '#..'],
  '*': ['.....', '..#..', '#.#.#', '.###.', '#.#.#', '..#..', '.....'],
  '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  ',': ['..', '..', '..', '..', '..', '..', '.#', '.#', '#.'],
  '-': ['....', '....', '....', '####', '....', '....', '....'],
  '.': ['.', '.', '.', '.', '.', '.', '#'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '3': ['.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ':': ['.', '.', '#', '.', '.', '.', '#'],
  ';': ['..', '..', '.#', '..', '..', '..', '.#', '.#', '#.'],
  '<': ['...#', '..#.', '.#..', '#...', '.#..', '..#.', '...#'],
  '=': ['....', '....', '####', '....', '####', '....', '....'],
  '>': ['#...', '.#..', '..#.', '...#', '..#.', '.#..', '#...'],
  '?': ['.###.', '#...#', '....#', '...#.', '..#..', '.....', '..#..'],
  '@': ['.###.', '#...#', '#.###', '#.#.#', '#.###', '#....', '.###.'],
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.####'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '#.#.#', '.#.#.'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  '[': ['###', '#..', '#..', '#..', '#..', '#..', '###'],
  '\\': ['#....', '#....', '.#...', '..#..', '...#.', '....#', '....#'],
  ']': ['###', '..#', '..#', '..#', '..#', '..#', '###'],
  '^': ['..#..', '.#.#.', '#...#', '.....', '.....', '.....', '.....'],
  _: ['.....', '.....', '.....', '.....', '.....', '.....', '.....', '#####', '.....'],
  '`': ['#.', '.#', '..', '..', '..', '..', '..'],
  a: ['....', '....', '.##.', '...#', '.###', '#..#', '.###'],
  b: ['#...', '#...', '###.', '#..#', '#..#', '#..#', '###.'],
  c: ['....', '....', '.###', '#...', '#...', '#...', '.###'],
  d: ['...#', '...#', '.###', '#..#', '#..#', '#..#', '.###'],
  e: ['....', '....', '.##.', '#..#', '####', '#...', '.###'],
  f: ['..##', '.#..', '####', '.#..', '.#..', '.#..', '.#..'],
  g: ['....', '....', '.###', '#..#', '#..#', '#..#', '.###', '...#', '.##.'],
  h: ['#...', '#...', '###.', '#..#', '#..#', '#..#', '#..#'],
  i: ['#', '.', '#', '#', '#', '#', '#'],
  j: ['..#', '...', '..#', '..#', '..#', '..#', '..#', '#.#', '.#.'],
  k: ['#...', '#...', '#..#', '#.#.', '##..', '#.#.', '#..#'],
  l: ['#.', '#.', '#.', '#.', '#.', '#.', '.#'],
  m: ['.....', '.....', '##.#.', '#.#.#', '#.#.#', '#.#.#', '#.#.#'],
  n: ['....', '....', '###.', '#..#', '#..#', '#..#', '#..#'],
  o: ['....', '....', '.##.', '#..#', '#..#', '#..#', '.##.'],
  p: ['....', '....', '###.', '#..#', '#..#', '#..#', '###.', '#...', '#...'],
  q: ['....', '....', '.###', '#..#', '#..#', '#..#', '.###', '...#', '...#'],
  r: ['....', '....', '#.##', '##..', '#...', '#...', '#...'],
  s: ['....', '....', '.###', '#...', '.##.', '...#', '###.'],
  t: ['.#.', '.#.', '###', '.#.', '.#.', '.#.', '..#'],
  u: ['....', '....', '#..#', '#..#', '#..#', '#..#', '.###'],
  v: ['.....', '.....', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  w: ['.....', '.....', '#...#', '#...#', '#.#.#', '#.#.#', '.#.#.'],
  x: ['.....', '.....', '#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  y: ['....', '....', '#..#', '#..#', '#..#', '#..#', '.###', '...#', '.##.'],
  z: ['....', '....', '####', '...#', '.##.', '#...', '####'],
  '{': ['..##', '.#..', '.#..', '#...', '.#..', '.#..', '..##'],
  '|': ['#', '#', '#', '#', '#', '#', '#'],
  '}': ['##..', '..#.', '..#.', '...#', '..#.', '..#.', '##..'],
  '~': ['.....', '.....', '.#...', '#.#.#', '...#.', '.....', '.....'],
};

function buildGlyphs(): Glyph[] {
  const out: Glyph[] = [];
  for (let code = FIRST_CHAR; code <= LAST_CHAR; code++) {
    const char = String.fromCharCode(code);
    const src = SRC[char];
    if (!src) throw new Error(`font: missing glyph for ${JSON.stringify(char)}`);
    const width = src[0].length;
    const rows = src.slice();
    while (rows.length < GLYPH_CELL_H) rows.push('.'.repeat(width));
    const descender = src.length > GLYPH_ASCENT && src.slice(GLYPH_ASCENT).some((r) => r.includes('#'));
    // The space has no ink but still advances; keep its declared width as the advance.
    out.push({ char, width, rows, descender });
  }
  return out;
}

export const GLYPHS: readonly Glyph[] = buildGlyphs();

const QUESTION = '?'.charCodeAt(0) - FIRST_CHAR;

/** Glyph index (0..GLYPH_COUNT-1) for a UTF-16 code unit; anything unprintable renders as '?'. */
export function glyphIndex(code: number): number {
  if (code >= FIRST_CHAR && code <= LAST_CHAR) return code - FIRST_CHAR;
  return QUESTION;
}

/** Horizontal advance of one glyph in pixels at scale 1 (inked width + letter spacing). */
export function glyphAdvance(index: number): number {
  return GLYPHS[index].width + LETTER_SPACING;
}

/** Width in pixels of `str` at an integer `scale` (no trailing letter spacing). */
export function measureText(str: string, scale = 1): number {
  const s = Math.max(1, Math.round(scale));
  if (str.length === 0) return 0;
  let w = 0;
  for (let i = 0; i < str.length; i++) w += glyphAdvance(glyphIndex(str.charCodeAt(i)));
  return (w - LETTER_SPACING) * s;
}

/** Default `box.padding` of text plates (pixels at scale 1 of the view). */
export const PLATE_PADDING = 2;

/**
 * Height in virtual pixels of a text plate (`text(..., { box })`). Every plate reserves the descender rows, so
 * labels have one uniform height whatever their letters, and stacked drop labels line up. The plate's top edge
 * is `padding` pixels above the capitals, i.e. at y − (GLYPH_ASCENT × scale) / 2 − padding (text y is the
 * vertical middle of capitals). Its width is measureText(str, scale) + 2 × padding.
 */
export function plateHeight(scale = 1, padding = PLATE_PADDING): number {
  return GLYPH_CELL_H * Math.max(1, Math.round(scale)) + 2 * Math.max(0, Math.round(padding));
}

/** True if any glyph of `str` reaches into the descender rows. */
export function hasDescender(str: string): boolean {
  for (let i = 0; i < str.length; i++) if (GLYPHS[glyphIndex(str.charCodeAt(i))].descender) return true;
  return false;
}

/** One white-on-transparent 5x9 PixelImage per glyph, in glyph-index order (for atlas upload). */
export function fontImages(): PixelImage[] {
  return GLYPHS.map((g) => {
    const data = new Uint8ClampedArray(GLYPH_CELL_W * GLYPH_CELL_H * 4);
    for (let y = 0; y < GLYPH_CELL_H; y++) {
      const row = g.rows[y];
      for (let x = 0; x < g.width; x++) {
        if (row[x] !== '#') continue;
        const o = (y * GLYPH_CELL_W + x) * 4;
        data[o] = data[o + 1] = data[o + 2] = data[o + 3] = 255;
      }
    }
    return { width: GLYPH_CELL_W, height: GLYPH_CELL_H, data };
  });
}
