// Keyboard/mouse state → InputMessage: movement normalisation, the held-slot mask, latched taps, the flask queue,
// and which inputs are worth sending.
import { describe, expect, it } from 'vitest';
import type { InputMessage } from '../../src/contracts/net';
import {
  IDLE_KEEPALIVE_TICKS, InputState, heldMaskFrom, isGameCode, moveFromCodes, shouldSendInput, toInputMessage,
} from '../../src/client/input';

const codes = (...c: string[]) => new Set(c);

function msg(p: Partial<InputMessage> = {}): InputMessage {
  return { t: 'input', seq: 1, moveX: 0, moveY: 0, aimX: 0, aimY: 0, held: 0, flask: -1, ...p };
}

describe('movement', () => {
  it('maps WASD and arrows to a unit vector (y down = south)', () => {
    expect(moveFromCodes(codes('KeyD'))).toEqual({ x: 1, y: 0 });
    expect(moveFromCodes(codes('ArrowUp'))).toEqual({ x: 0, y: -1 });
    expect(moveFromCodes(codes('KeyS'))).toEqual({ x: 0, y: 1 });
    const diag = moveFromCodes(codes('KeyW', 'KeyA'));
    expect(diag.x).toBeCloseTo(-Math.SQRT1_2);
    expect(diag.y).toBeCloseTo(-Math.SQRT1_2);
    expect(Math.hypot(diag.x, diag.y)).toBeCloseTo(1);
  });

  it('cancels opposite keys and treats WASD + arrows as the same direction', () => {
    expect(moveFromCodes(codes('KeyA', 'KeyD'))).toEqual({ x: 0, y: 0 });
    expect(moveFromCodes(codes('KeyD', 'ArrowRight'))).toEqual({ x: 1, y: 0 });
    expect(moveFromCodes(codes())).toEqual({ x: 0, y: 0 });
  });
});

describe('held mask', () => {
  it('LMB and RMB are slots 0 and 1; Q E R F are slots 2..5', () => {
    expect(heldMaskFrom(1, codes())).toBe(0b1);
    expect(heldMaskFrom(2, codes())).toBe(0b10);
    expect(heldMaskFrom(0, codes('KeyQ', 'KeyF'))).toBe(0b100100);
    expect(heldMaskFrom(3, codes('KeyQ', 'KeyE', 'KeyR', 'KeyF'))).toBe(0b111111);
    expect(heldMaskFrom(0, codes('Space', 'KeyZ'))).toBe(0b11000000);
    expect(heldMaskFrom(0, codes('KeyW', 'Digit1'))).toBe(0);
  });

  it('knows which keys belong to the game (the UI keeps I C K P, Enter, Esc)', () => {
    for (const c of ['KeyW', 'ArrowLeft', 'KeyQ', 'KeyF', 'Space', 'KeyZ', 'Digit3', 'KeyT']) expect(isGameCode(c)).toBe(true);
    for (const c of ['KeyI', 'KeyC', 'KeyK', 'KeyP', 'Enter', 'Escape', 'Digit5']) expect(isGameCode(c)).toBe(false);
  });
});

describe('InputState', () => {
  it('latches RMB taps and tracks both mouse buttons independently', () => {
    const s = new InputState();
    s.mouseDown(2);
    s.mouseUp(2);
    expect(s.sample().held).toBe(2);
    expect(s.sample().held).toBe(0);
    s.mouseDown(0);
    s.mouseDown(2);
    expect(s.sample().held).toBe(3);
    s.mouseUp(0);
    expect(s.sample().held).toBe(2);
    s.clear();
    expect(s.sample().held).toBe(0);
    s.mouseDown(1);
    expect(s.sample().held).toBe(0);
  });
  it('a tap shorter than one tick still holds the slot for exactly one tick', () => {
    const s = new InputState();
    s.keyDown('KeyQ', false);
    s.keyUp('KeyQ');
    expect(s.sample().held).toBe(0b100);
    expect(s.sample().held).toBe(0);
  });

  it('a mouse click between ticks fires the basic attack once; a held button keeps it', () => {
    const s = new InputState();
    s.mouseDown();
    s.mouseUp();
    expect(s.sample().held & 1).toBe(1);
    expect(s.sample().held & 1).toBe(0);
    s.mouseDown();
    expect(s.sample().held & 1).toBe(1);
    expect(s.sample().held & 1).toBe(1);
  });

  it('movement follows only keys held now (no drift from a latched tap)', () => {
    const s = new InputState();
    s.keyDown('KeyW', false);
    s.keyUp('KeyW');
    const a = s.sample();
    expect(a.moveX).toBe(0);
    expect(a.moveY).toBe(0);
    s.keyDown('KeyD', false);
    expect(s.sample().moveX).toBe(1);
  });

  it('queues flask presses one per tick and ignores key repeat', () => {
    const s = new InputState();
    s.keyDown('Digit1', false);
    s.keyDown('Digit1', true); // auto-repeat: not another press
    s.keyDown('Digit3', false);
    expect(s.sample().flask).toBe(0);
    expect(s.sample().flask).toBe(2);
    expect(s.sample().flask).toBe(-1);
  });

  it('an auto-repeat restores a key that is still held after the keyboard was dropped (no new tap or flask)', () => {
    const s = new InputState();
    s.keyDown('KeyD', false);
    s.keyDown('Digit2', false);
    s.sample();
    s.blockKeys(); // e.g. ⌘ released on macOS: key-ups during ⌘ were swallowed
    expect(s.sample().moveX).toBe(0);
    s.keyDown('KeyD', true);
    s.keyDown('Digit2', true);
    const out = s.sample();
    expect(out.moveX).toBe(1);
    expect(out.flask).toBe(-1);
  });

  it('blockKeys drops the keyboard (chat opened) but keeps the mouse', () => {
    const s = new InputState();
    s.keyDown('KeyW', false);
    s.keyDown('KeyE', false);
    s.mouseDown();
    s.blockKeys();
    const out = s.sample();
    expect(out.moveY).toBe(0);
    expect(out.held).toBe(1);
    s.clear();
    expect(s.sample().held).toBe(0);
  });

  it('reports non-game keys as unhandled', () => {
    const s = new InputState();
    expect(s.keyDown('KeyI', false)).toBe(false);
    expect(s.keyDown('KeyA', false)).toBe(true);
  });
});

describe('wire messages', () => {
  it('builds the contract shape with a clean aim', () => {
    const m = toInputMessage(7, { moveX: 1, moveY: 0, held: 3, flask: 2 }, 10.123, Number.NaN);
    expect(m).toEqual({ t: 'input', seq: 7, moveX: 1, moveY: 0, aimX: 10.125, aimY: 0, held: 3, flask: 2 });
  });

  it('sends every active tick, and identical idle ticks only as a keepalive', () => {
    const idle = msg();
    expect(shouldSendInput(idle, null, 0)).toBe(true);
    expect(shouldSendInput(msg({ moveX: 1 }), msg({ moveX: 1 }), 1)).toBe(true);
    expect(shouldSendInput(msg({ held: 1 }), msg({ held: 1 }), 1)).toBe(true);
    expect(shouldSendInput(idle, msg({ moveX: 1 }), 1)).toBe(true); // the stop must arrive
    expect(shouldSendInput(idle, idle, 1)).toBe(false);
    expect(shouldSendInput(idle, idle, IDLE_KEEPALIVE_TICKS - 1)).toBe(false);
    expect(shouldSendInput(idle, idle, IDLE_KEEPALIVE_TICKS)).toBe(true);
  });

  it('re-sends an idle input when the aim moved noticeably (facing), at a reduced rate', () => {
    const a = msg({ aimX: 0 });
    const b = msg({ aimX: 40 });
    expect(shouldSendInput(b, a, 1)).toBe(false);
    expect(shouldSendInput(b, a, 2)).toBe(true);
    expect(shouldSendInput(msg({ aimX: 2 }), a, 3)).toBe(false);
  });
});
