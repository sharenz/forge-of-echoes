import { describe, expect, it } from 'vitest';
import { DamageNumbers, NUM_STYLE_PLAYER_HURT } from '../../src/present/fx';
import { Pen } from '../../src/present/pen';
import { RecordingRenderer, textBox, type TextCall } from './helpers';

const camera = { x: 0, y: 0, zoom: 1 };

function setup() {
  const r = new RecordingRenderer();
  const pen = new Pen(r);
  const nums = new DamageNumbers((s, k) => r.measureText(s, k));
  /** One presenter-like frame: update, then draw; returns the drawn numbers. */
  const frame = (dt = 1 / 60): TextCall[] => {
    nums.update(dt);
    r.beginFrame({ camera, ambient: [0.2, 0.2, 0.2], time: 0 });
    nums.draw(pen);
    return r.frameTexts;
  };
  return { r, nums, frame };
}

function assertNoOverlap(texts: TextCall[], measure: (s: string, k: number) => number, label: string): void {
  const boxes = texts.map((t) => textBox(t, measure));
  for (let a = 0; a < boxes.length; a++) {
    for (let b = a + 1; b < boxes.length; b++) {
      const A = boxes[a];
      const B = boxes[b];
      const hit = A.x0 < B.x1 && B.x0 < A.x1 && A.y0 < B.y1 && B.y0 < A.y1;
      if (hit) throw new Error(`${label}: "${texts[a].text}" and "${texts[b].text}" overlap (${JSON.stringify(A)} vs ${JSON.stringify(B)})`);
    }
  }
}

describe('damage numbers', () => {
  it('stacks 12 numbers spawned on one spot in one frame without any overlap, for their whole life', () => {
    const { r, nums, frame } = setup();
    const measure = (s: string, k: number) => r.measureText(s, k);
    nums.beginFrame();
    for (let k = 0; k < 12; k++) {
      const amount = [7, 48, 1234, 96, 5388, 13][k % 6] + k;
      nums.spawn(0, 0, amount, k % 5, k % 4 === 0, k % 3 !== 2);
    }
    let maxShown = 0;
    for (let f = 0; f < 90; f++) {
      const texts = frame();
      maxShown = Math.max(maxShown, texts.length);
      assertNoOverlap(texts, measure, `frame ${f}`);
    }
    // Twelve different styles at once: the column keeps its newest five (a full stack drops its topmost number).
    expect(maxShown).toBeGreaterThanOrEqual(3);
    expect(maxShown).toBeLessThanOrEqual(5);
  });

  it('never overlaps under sustained mixed fire on one target, and the column stays short', () => {
    const { r, nums, frame } = setup();
    const measure = (s: string, k: number) => r.measureText(s, k);
    let tallest = 0;
    for (let f = 0; f < 240; f++) {
      nums.beginFrame();
      // Four players on the training dummy: several hits every frame, mixed types, crits and owners.
      for (let h = 0; h < 3; h++) {
        const k = f * 3 + h;
        nums.spawn((k % 3) - 1, (k % 2) * 2, 20 + (k * 37) % 400, k % 5, k % 7 === 0, k % 4 !== 3);
      }
      const texts = frame();
      assertNoOverlap(texts, measure, `frame ${f}`);
      for (const t of texts) tallest = Math.max(tallest, -t.y);
    }
    // The stack is bounded by merging: it never climbs more than ~100 units above the target.
    expect(tallest).toBeLessThan(110);
  });

  it('accumulates repeated hits into a running total instead of growing the column', () => {
    const { nums, frame } = setup();
    let texts: TextCall[] = [];
    for (let f = 0; f < 12; f++) {
      nums.beginFrame();
      nums.spawn(0, 0, 10, 1, false, true);
      texts = frame();
    }
    // 12 hits of 10 within 0.2 s: a handful of numbers, together still worth 120.
    expect(texts.length).toBeLessThanOrEqual(4);
    expect(texts.reduce((s, t) => s + Number(t.text), 0)).toBe(120);
  });

  it('keeps hits on the local player separate from hits on monsters', () => {
    const { nums, frame } = setup();
    nums.beginFrame();
    for (let k = 0; k < 4; k++) nums.spawn(0, 0, 10, NUM_STYLE_PLAYER_HURT, false, true);
    for (let k = 0; k < 4; k++) nums.spawn(0, 0, 10, 1, false, true);
    const texts = frame();
    // Merges only ever combine the same style: both totals survive.
    expect(texts.length).toBeGreaterThanOrEqual(2);
    expect(texts.reduce((s, t) => s + Number(t.text), 0)).toBe(80);
  });
});
