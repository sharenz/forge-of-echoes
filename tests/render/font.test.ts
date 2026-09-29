import { describe, expect, it } from 'vitest';
import {
  FIRST_CHAR, fontImages, GLYPH_CELL_H, GLYPH_CELL_W, GLYPH_COUNT, GLYPHS, glyphIndex, hasDescender, LAST_CHAR, measureText,
  PLATE_PADDING, plateHeight,
} from '../../src/render/font';

describe('bitmap font', () => {
  it('covers every printable ASCII character', () => {
    expect(GLYPH_COUNT).toBe(95);
    expect(GLYPHS).toHaveLength(95);
    for (let code = FIRST_CHAR; code <= LAST_CHAR; code++) {
      const g = GLYPHS[glyphIndex(code)];
      expect(g.char).toBe(String.fromCharCode(code));
    }
  });

  it('has well-formed 5x9 cells', () => {
    for (const g of GLYPHS) {
      expect(g.width).toBeGreaterThanOrEqual(1);
      expect(g.width).toBeLessThanOrEqual(GLYPH_CELL_W);
      expect(g.rows).toHaveLength(GLYPH_CELL_H);
      for (const row of g.rows) {
        expect(row).toHaveLength(g.width);
        expect(row).toMatch(/^[#.]+$/);
      }
      const ink = g.rows.join('').includes('#');
      expect(ink).toBe(g.char !== ' ');
    }
  });

  it('includes the characters the game relies on', () => {
    for (const ch of '0123456789%+-():\'!?.,/ ABCZabcz') {
      const g = GLYPHS[glyphIndex(ch.charCodeAt(0))];
      expect(g.char).toBe(ch);
    }
  });

  it('keeps digits tabular (5px) so counting numbers do not jitter', () => {
    for (const d of '0123456789') expect(GLYPHS[glyphIndex(d.charCodeAt(0))].width).toBe(5);
  });

  it('flags descenders only on glyphs that reach below the baseline', () => {
    for (const ch of 'gjpqy,;_') expect(hasDescender(ch)).toBe(true);
    for (const ch of 'AZaehkt0!') expect(hasDescender(ch)).toBe(false);
    expect(hasDescender('Kindling Shard')).toBe(true);
    expect(hasDescender('Ashwood Wand')).toBe(false);
  });

  it('maps unprintable characters to "?"', () => {
    expect(GLYPHS[glyphIndex(10)].char).toBe('?');
    expect(GLYPHS[glyphIndex(0x2014)].char).toBe('?');
  });

  it('measures proportional text with 1px letter spacing and integer scale', () => {
    expect(measureText('')).toBe(0);
    expect(measureText('A')).toBe(5);
    expect(measureText('AB')).toBe(11);
    expect(measureText('i')).toBe(1);
    expect(measureText('Ai')).toBe(7);
    expect(measureText('AB', 2)).toBe(22);
    expect(measureText('AB', 1.6)).toBe(22); // scale rounds to an integer
    expect(measureText('123')).toBe(17);
  });

  it('rasterises white glyphs whose alpha matches the bitmap', () => {
    const images = fontImages();
    expect(images).toHaveLength(95);
    const a = images[glyphIndex('A'.charCodeAt(0))];
    expect(a.width).toBe(GLYPH_CELL_W);
    expect(a.height).toBe(GLYPH_CELL_H);
    const g = GLYPHS[glyphIndex('A'.charCodeAt(0))];
    for (let y = 0; y < GLYPH_CELL_H; y++) {
      for (let x = 0; x < GLYPH_CELL_W; x++) {
        const inked = x < g.width && g.rows[y][x] === '#';
        const o = (y * GLYPH_CELL_W + x) * 4;
        expect(a.data[o + 3]).toBe(inked ? 255 : 0);
        if (inked) expect([a.data[o], a.data[o + 1], a.data[o + 2]]).toEqual([255, 255, 255]);
      }
    }
  });
});

describe('text plates', () => {
  it('have one uniform height per scale and padding, descenders or not', () => {
    expect(plateHeight()).toBe(GLYPH_CELL_H + 2 * PLATE_PADDING);
    expect(plateHeight(1, 2)).toBe(13);
    expect(plateHeight(2, 3)).toBe(24);
    expect(plateHeight(1.4, 2.4)).toBe(13); // integer scale and padding, like text()
    expect(plateHeight(1, -4)).toBe(GLYPH_CELL_H);
  });
});
