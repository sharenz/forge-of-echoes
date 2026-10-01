import { describe, expect, it } from 'vitest';
import type { InputMessage } from '../../src/contracts/net';
import type { PlayerIntent } from '../../src/contracts/sim';
import {
  INPUT_BACKLOG_KEEP, INPUT_BACKLOG_MAX, INPUT_STARVE_TICKS, coalesceInputs, createInputQueue,
} from '../../src/net';

function input(seq: number, over: Partial<InputMessage> = {}): InputMessage {
  return { t: 'input', seq, moveX: 1, moveY: 0, aimX: 10, aimY: 0, held: 0, flask: -1, ...over };
}

function intent(): PlayerIntent {
  return { moveX: 0, moveY: 0, aimX: 0, aimY: 0, held: [], flask: -1 };
}

describe('coalesceInputs', () => {
  it('keeps a flask press from the skipped span unless the kept input has its own', () => {
    const into = input(10);
    coalesceInputs([input(7), input(8, { flask: 2 }), input(9)], into);
    expect(into.flask).toBe(2);
    const own = input(10, { flask: 0 });
    coalesceInputs([input(8, { flask: 2 })], own);
    expect(own.flask).toBe(0);
    const last = input(10);
    coalesceInputs([input(7, { flask: 1 }), input(8, { flask: 3 })], last);
    expect(last.flask).toBe(3);
  });

  it('holds keys tapped inside the skipped span, but does not revive released ones', () => {
    // Slot 1 was held before the span and released inside it; slot 3 was tapped for two ticks inside it.
    const into = input(10, { held: 1 });
    coalesceInputs([input(6, { held: 1 | 2 }), input(7, { held: 1 | 8 }), input(8, { held: 1 | 8 }), input(9, { held: 1 })], into, 1 | 2);
    expect(into.held).toBe(1 | 8);
    expect(into.seq).toBe(10);
    expect(into.moveX).toBe(1);
  });
});

describe('input queue', () => {
  it('applies one input per tick in seq order and rejects stale seqs', () => {
    const q = createInputQueue();
    const it0 = intent();
    expect(q.push(input(1, { moveX: 0.5 }))).toBe(true);
    expect(q.push(input(2, { moveX: -0.5 }))).toBe(true);
    expect(q.push(input(2))).toBe(false);
    expect(q.push(input(1))).toBe(false);
    expect(q.next(it0).moveX).toBe(0.5);
    expect(q.ackSeq).toBe(1);
    expect(q.next(it0).moveX).toBe(-0.5);
    expect(q.ackSeq).toBe(2);
    expect(q.length).toBe(0);
  });

  it('skips a burst to the newest inputs without losing a flask press or a skill tap', () => {
    const q = createInputQueue();
    const out = intent();
    q.push(input(1));
    q.next(out);
    // A TCP stall delivers 10 inputs at once; a flask press and a 2-tick tap of slot 2 hide in the middle.
    for (let s = 2; s <= 11; s++) q.push(input(s, { flask: s === 5 ? 1 : -1, held: s === 6 || s === 7 ? 4 : 0 }));
    expect(q.length).toBeGreaterThan(INPUT_BACKLOG_MAX);
    q.next(out);
    expect(q.skipped).toBe(10 - INPUT_BACKLOG_KEEP);
    expect(q.ackSeq).toBe(10);
    expect(out.flask).toBe(1);
    expect(out.held[2]).toBe(true);
    // The following tick is the last kept input, as sent.
    q.next(out);
    expect(q.ackSeq).toBe(11);
    expect(out.flask).toBe(-1);
    expect(out.held[2]).toBe(false);
  });

  it('repeats the intent through short gaps, never repeats a flask press, and stops moving when starved', () => {
    const q = createInputQueue();
    const out = intent();
    q.push(input(1, { moveX: 1, flask: 0, held: 1 }));
    q.next(out);
    expect(out.flask).toBe(0);
    for (let k = 1; k <= INPUT_STARVE_TICKS; k++) {
      q.next(out);
      expect(out.flask).toBe(-1);
      expect(out.moveX).toBe(1); // ordinary jitter: keep running
      expect(out.held[0]).toBe(true);
    }
    q.next(out);
    expect(q.starved).toBe(INPUT_STARVE_TICKS + 1);
    expect(out.moveX).toBe(0); // a hitch or a hidden tab: stop
    expect(out.held[0]).toBe(true);
    q.push(input(2, { moveX: -1 }));
    q.next(out);
    expect(out.moveX).toBe(-1);
    expect(q.starved).toBe(0);
  });

  it('does not let a flooding client grow the queue without bound', () => {
    const q = createInputQueue();
    for (let s = 1; s <= 1000; s++) q.push(input(s, { flask: s === 3 ? 2 : -1 }));
    expect(q.length).toBeLessThanOrEqual(120);
    const out = intent();
    q.next(out);
    expect(out.flask).toBe(2);
  });
});

describe('jitter cushion', () => {
  it('keeps late inputs queued after a repeat instead of merging them away', () => {
    const q = createInputQueue();
    const out = intent();
    q.push(input(1));
    q.next(out);
    q.next(out); // a repeat: input 2 is late
    q.push(input(2));
    q.push(input(3));
    q.next(out);
    expect(q.ackSeq).toBe(2);
    expect(q.length).toBe(1); // the cushion that absorbs the next spike
    expect(q.skipped).toBe(0);
  });
});
