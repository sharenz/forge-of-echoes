import { describe, expect, it } from 'vitest';
import { LabelStacker } from '../../src/present/labels';

interface Box { x: number; y: number; w: number; h: number }

function solve(boxes: Box[], gap = 1): { top: number[]; st: LabelStacker } {
  const st = new LabelStacker(64);
  boxes.forEach((b, i) => st.add(b.x, b.y, b.w, b.h, i));
  st.solve(gap);
  return { top: boxes.map((_, i) => st.top(i)), st };
}

function overlapping(boxes: Box[], tops: number[], gap: number): [number, number] | null {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const hx = a.x + a.w / 2 > b.x - b.w / 2 && b.x + b.w / 2 > a.x - a.w / 2;
      const vy = tops[i] < tops[j] + b.h + gap - 1e-6 && tops[j] < tops[i] + a.h + gap - 1e-6;
      if (hx && vy) return [i, j];
    }
  }
  return null;
}

describe('LabelStacker', () => {
  it('leaves non-overlapping labels where they want to be', () => {
    const boxes = [
      { x: 0, y: 0, w: 40, h: 13 },
      { x: 100, y: 0, w: 40, h: 13 },
      { x: 0, y: 50, w: 40, h: 13 },
    ];
    const { top } = solve(boxes);
    expect(top).toEqual([0, 0, 50]);
  });

  it('stacks a pile of loot into a column with no overlaps', () => {
    const boxes: Box[] = [];
    for (let i = 0; i < 20; i++) boxes.push({ x: (i % 3) * 6, y: 100 + (i % 5), w: 60 + (i % 4) * 10, h: 13 });
    const { top } = solve(boxes, 1);
    expect(overlapping(boxes, top, 1)).toBeNull();
    // Labels only ever move up.
    top.forEach((t, i) => expect(t).toBeLessThanOrEqual(boxes[i].y));
  });

  it('keeps the label nearest the camera (lowest on screen) in place', () => {
    const boxes = [
      { x: 0, y: 90, w: 50, h: 13 },
      { x: 5, y: 100, w: 50, h: 13 }, // lowest: stays
      { x: -5, y: 95, w: 50, h: 13 },
    ];
    const { top } = solve(boxes);
    expect(top[1]).toBe(100);
    expect(overlapping(boxes, top, 1)).toBeNull();
  });

  it('is stable: identical input gives an identical layout (no frame-to-frame reshuffle)', () => {
    const boxes: Box[] = [];
    for (let i = 0; i < 12; i++) boxes.push({ x: 0, y: 50, w: 50, h: 13 });
    const a = solve(boxes).top;
    const b = solve(boxes).top;
    expect(a).toEqual(b);
    // Equal desired positions: ordered by key, so key 0 keeps the spot.
    expect(a[0]).toBe(50);
  });

  it('handles taller (blocked) labels and respects capacity', () => {
    const boxes = [
      { x: 0, y: 100, w: 70, h: 24 },
      { x: 0, y: 100, w: 70, h: 13 },
      { x: 20, y: 98, w: 70, h: 13 },
    ];
    const { top } = solve(boxes, 2);
    expect(overlapping(boxes, top, 2)).toBeNull();
    const st = new LabelStacker(2);
    expect(st.add(0, 0, 1, 1, 0)).toBe(0);
    expect(st.add(0, 0, 1, 1, 1)).toBe(1);
    expect(st.add(0, 0, 1, 1, 2)).toBe(-1);
  });
});
