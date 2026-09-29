// Server-side per-connection input queue: turns the client's 60 Hz input stream (which arrives in TCP bursts and
// with clock skew) into exactly one PlayerIntent per sim tick, plus the ackSeq to put into that viewer's snapshots.
//
// Policy (the client's prediction is built around it):
//  • One input per tick, in seq order; stale or duplicate seqs are ignored.
//  • Backlog: when a stall delivers a burst (more than INPUT_BACKLOG_MAX queued), skip ahead to the newest
//    INPUT_BACKLOG_KEEP — otherwise the backlog would delay every later cast for good. Skipped inputs are acked with
//    the kept one and COALESCED into it (coalesceInputs): a flask press or a short skill tap inside the skipped span
//    is never lost — exactly when a player at low life needs that flask after a lag spike. Their movement is not
//    replayed; prediction blends the resulting position difference out.
//  • Starvation: with no input, the last intent repeats (held skills keep firing, movement continues through
//    ordinary jitter), but its flask press is not repeated, and after INPUT_STARVE_TICKS (250 ms) of silence the
//    movement stops — a client hitch or a hidden tab must never run the character into the horde.
//  • No payback of repeated ticks: a repeat leaves the late input queued, and that one-input cushion is what absorbs
//    the next jitter spike. The queue thereby settles at the depth the uplink jitter needs (≈ 1 input at 30 ms,
//    ≈ 2 at 60 ms) and starvation — hence correction — stops after the first few. Merging inputs to "repay" repeats
//    was measured to be far worse (60–170 corrections per 8 s instead of 0): it drains the cushion every time.
//
// Server loop per tick, per connected player:
//   run.setIntent(id, queue.next(intent));  run.step();  …  encoder.encode(run.view, id, queue.ackSeq)
// (always pass the same `intent` object for a player: it is the repeated intent while starved).
import type { InputMessage } from '../contracts/net';
import type { PlayerIntent } from '../contracts/sim';
import { HELD_MASK_ALL, intentFromInput } from './input';

/** More queued inputs than this at a tick means a burst: skip ahead. */
export const INPUT_BACKLOG_MAX = 6;
/** Inputs kept (applied one per tick) after skipping a burst. */
export const INPUT_BACKLOG_KEEP = 2;
/** Ticks without any input after which the repeated intent stops moving (250 ms). */
export const INPUT_STARVE_TICKS = 15;
/** Hard cap on queued inputs (a flooding client): older ones are coalesced away immediately. */
const INPUT_QUEUE_CAP = 120;

/**
 * Fold skipped inputs into the input that replaces them, so their one-tick edges survive:
 *  • flask: the kept input's press wins; otherwise the last press among the skipped ones;
 *  • held: slots PRESSED inside the skipped span (held there but not in `prevHeld`, the mask applied before the span)
 *    are held on the kept input for its tick — a tap is never swallowed, while a key that was already held and got
 *    released is not revived.
 * `into` is modified in place; its seq/move/aim are kept.
 */
export function coalesceInputs(skipped: readonly InputMessage[], into: InputMessage, prevHeld = 0): void {
  let pressed = 0;
  let before = prevHeld;
  let flask = -1;
  for (const s of skipped) {
    pressed |= s.held & ~before;
    before = s.held;
    if (s.flask !== -1) flask = s.flask;
  }
  into.held = (into.held | pressed) & HELD_MASK_ALL;
  if (into.flask === -1) into.flask = flask;
}

export interface InputQueue {
  /** Queue a validated input (parseClientMessage). Returns false for a stale or duplicate seq. */
  push(input: InputMessage): boolean;
  /**
   * The intent for the next sim tick, written into `out` (and returned): the next queued input, or the repeated
   * previous intent while starved. Call exactly once per tick, before run.step().
   */
  next(out: PlayerIntent): PlayerIntent;
  /** Seq of the last input applied (put it into this viewer's snapshots). */
  readonly ackSeq: number;
  /** Inputs waiting. */
  readonly length: number;
  /** Consecutive ticks without a new input. */
  readonly starved: number;
  /** Inputs skipped (coalesced) because of bursts, for diagnostics. */
  readonly skipped: number;
  /** Forget queued inputs (e.g. on disconnect). The seq/ack continue — seqs are per connection. */
  clear(): void;
}

export function createInputQueue(): InputQueue {
  const queue: InputMessage[] = [];
  let lastSeq = -1;
  let ackSeq = 0;
  let lastHeld = 0;
  let starved = 0;
  let skipped = 0;

  /** Coalesce everything but the newest `keep` inputs into the first kept one. */
  function skipTo(keep: number): void {
    const drop = queue.length - keep;
    if (drop <= 0) return;
    const gone = queue.splice(0, drop);
    coalesceInputs(gone, queue[0], lastHeld);
    skipped += drop;
  }

  return {
    push(input) {
      if (!(input.seq > lastSeq)) return false;
      lastSeq = input.seq;
      // A copy: coalescing edits queued inputs, and the caller may reuse its message object.
      queue.push({ ...input });
      if (queue.length > INPUT_QUEUE_CAP) skipTo(INPUT_BACKLOG_KEEP);
      return true;
    },
    next(out) {
      if (queue.length > INPUT_BACKLOG_MAX) skipTo(INPUT_BACKLOG_KEEP);
      const m = queue.shift();
      if (m) {
        intentFromInput(m, out);
        ackSeq = m.seq;
        lastHeld = m.held;
        starved = 0;
        return out;
      }
      starved++;
      out.flask = -1; // an edge: never repeated
      if (starved > INPUT_STARVE_TICKS) {
        out.moveX = 0;
        out.moveY = 0;
      }
      return out;
    },
    get ackSeq() {
      return ackSeq;
    },
    get length() {
      return queue.length;
    },
    get starved() {
      return starved;
    },
    get skipped() {
      return skipped;
    },
    clear() {
      queue.length = 0;
      starved = 0;
    },
  };
}
