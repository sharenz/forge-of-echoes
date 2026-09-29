// Keyboard/mouse state → the 60 Hz InputMessage (contracts/net.ts). DOM-free: the DOM layer (dom-input.ts) feeds
// KeyboardEvent.code values and pointer state in; every input tick consumes one sample.
//
// Keys use KeyboardEvent.code (physical position), so WASD stays under the left hand on AZERTY/QWERTZ layouts.
// Presses are latched until the next input tick, so a tap shorter than one tick (16.7 ms) still reaches the server
// ("held skills fire as soon as usable" — a tap holds the slot for at least one tick). Flask presses queue and
// are released one per tick, so two quick presses on different flasks both arrive.
import { BELT_SLOTS, LOADOUT_SLOTS } from '../contracts/items';
import type { HeldMask, InputMessage } from '../contracts/net';

/** Loadout slots 1..5 (Space, Q, E, R, F); slot 0 is the left mouse button. */
export const SLOT_CODES: Readonly<Record<string, number>> = {
  Space: 1,
  KeyQ: 2,
  KeyE: 3,
  KeyR: 4,
  KeyF: 5,
};

export const FLASK_CODES: Readonly<Record<string, number>> = {
  Digit1: 0,
  Digit2: 1,
  Digit3: 2,
  Digit4: 3,
  Numpad1: 0,
  Numpad2: 1,
  Numpad3: 2,
  Numpad4: 3,
};

const MOVE_UP = ['KeyW', 'ArrowUp'];
const MOVE_DOWN = ['KeyS', 'ArrowDown'];
const MOVE_LEFT = ['KeyA', 'ArrowLeft'];
const MOVE_RIGHT = ['KeyD', 'ArrowRight'];
const MOVE_CODES = new Set([...MOVE_UP, ...MOVE_DOWN, ...MOVE_LEFT, ...MOVE_RIGHT]);

/** Toggles auto-attack. */
export const AUTO_ATTACK_CODE = 'KeyT';

/** Every key the game (not the UI) owns. The DOM layer prevents their browser defaults (Space scrolls…). */
export function isGameCode(code: string): boolean {
  return MOVE_CODES.has(code) || code in SLOT_CODES || code in FLASK_CODES || code === AUTO_ATTACK_CODE;
}

export interface MoveDir {
  x: number;
  y: number;
}

/** Normalised movement direction from the held keys (diagonals are length 1, opposite keys cancel). */
export function moveFromCodes(down: ReadonlySet<string>, out: MoveDir = { x: 0, y: 0 }): MoveDir {
  const any = (codes: readonly string[]): boolean => codes.some((c) => down.has(c));
  const x = (any(MOVE_RIGHT) ? 1 : 0) - (any(MOVE_LEFT) ? 1 : 0);
  const y = (any(MOVE_DOWN) ? 1 : 0) - (any(MOVE_UP) ? 1 : 0);
  const len = Math.hypot(x, y);
  out.x = len > 0 ? x / len : 0;
  out.y = len > 0 ? y / len : 0;
  return out;
}

/** Held loadout slots as the wire bitmask (bit i = slot i). */
export function heldMaskFrom(mouseHeld: boolean, codes: ReadonlySet<string>): HeldMask {
  let mask = mouseHeld ? 1 : 0;
  for (const code of codes) {
    const slot = SLOT_CODES[code];
    if (slot !== undefined && slot < LOADOUT_SLOTS) mask |= 1 << slot;
  }
  return mask;
}

/** One tick's worth of sampled input (before aim / auto-attack are applied). */
export interface InputSample {
  moveX: number;
  moveY: number;
  held: HeldMask;
  flask: number;
}

/**
 * The client's live input state. Feed it key/mouse transitions; `sample()` once per 60 Hz input tick.
 * `blockKeys()` drops the keyboard state (chat opened, window lost focus) without touching the mouse.
 */
export class InputState {
  private readonly down = new Set<string>();
  /** Keys pressed since the last sample (kept even if already released). */
  private readonly latched = new Set<string>();
  private readonly flaskQueue: number[] = [];
  private mouseHeld = false;
  private mouseLatched = false;
  private readonly scratch = new Set<string>();
  private readonly dir: MoveDir = { x: 0, y: 0 };

  /**
   * A game key went down. Returns true when it is a game key (the caller then prevents the default). An auto-repeat
   * proves the key is still held: it restores the key after the state was dropped under a held key (macOS swallows
   * key-ups while ⌘ is down, so the DOM layer clears the keyboard on ⌘ release), without a new tap or flask press.
   */
  keyDown(code: string, repeat: boolean): boolean {
    if (!isGameCode(code)) return false;
    if (repeat) {
      this.down.add(code);
      return true;
    }
    this.down.add(code);
    this.latched.add(code);
    const flask = FLASK_CODES[code];
    if (flask !== undefined && flask < BELT_SLOTS && this.flaskQueue.length < BELT_SLOTS) this.flaskQueue.push(flask);
    return true;
  }

  keyUp(code: string): void {
    this.down.delete(code);
  }

  mouseDown(): void {
    this.mouseHeld = true;
    this.mouseLatched = true;
  }

  mouseUp(): void {
    this.mouseHeld = false;
  }

  get isMouseHeld(): boolean {
    return this.mouseHeld;
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** Forget the keyboard (chat opened, focus left the window). */
  blockKeys(): void {
    this.down.clear();
    this.latched.clear();
    this.flaskQueue.length = 0;
  }

  /** Forget everything (window blur, zone change, pause). */
  clear(): void {
    this.blockKeys();
    this.mouseHeld = false;
    this.mouseLatched = false;
  }

  /** Consume one input tick: held state plus presses latched since the last tick. */
  sample(out: InputSample = { moveX: 0, moveY: 0, held: 0, flask: -1 }): InputSample {
    const keys = this.scratch;
    keys.clear();
    for (const c of this.down) keys.add(c);
    for (const c of this.latched) keys.add(c);
    // Movement follows only the keys held right now: a latched tap on W must not add a tick of drift.
    moveFromCodes(this.down, this.dir);
    out.moveX = this.dir.x;
    out.moveY = this.dir.y;
    out.held = heldMaskFrom(this.mouseHeld || this.mouseLatched, keys);
    out.flask = this.flaskQueue.length ? (this.flaskQueue.shift() as number) : -1;
    this.latched.clear();
    this.mouseLatched = false;
    return out;
  }
}

/** Build the wire message for one tick. Non-finite aims (no camera yet) fall back to 0. */
export function toInputMessage(seq: number, s: InputSample, aimX: number, aimY: number): InputMessage {
  return {
    t: 'input',
    seq: seq >>> 0,
    moveX: s.moveX,
    moveY: s.moveY,
    aimX: Number.isFinite(aimX) ? Math.round(aimX * 8) / 8 : 0,
    aimY: Number.isFinite(aimY) ? Math.round(aimY * 8) / 8 : 0,
    held: s.held,
    flask: s.flask,
  };
}

/** Idle ticks are re-sent at this interval (in 60 Hz ticks) as a keepalive; ~10 Hz. */
export const IDLE_KEEPALIVE_TICKS = 6;
/** Aim changes smaller than this (world units) don't make an idle input worth sending. */
const IDLE_AIM_EPSILON = 4;

function isIdle(m: InputMessage): boolean {
  return m.moveX === 0 && m.moveY === 0 && m.held === 0 && m.flask === -1;
}

/**
 * Whether this tick's input goes on the wire. Anything active (moving, a held slot, a flask) is sent every tick —
 * the server applies one input per tick and prediction replays them. Identical idle inputs are only re-sent as a
 * ~10 Hz keepalive (the server repeats the last intent while starved, so skipping them changes nothing).
 */
export function shouldSendInput(input: InputMessage, lastSent: InputMessage | null, ticksSinceSend: number): boolean {
  if (!lastSent) return true;
  if (!isIdle(input) || !isIdle(lastSent)) return true;
  if (Math.abs(input.aimX - lastSent.aimX) > IDLE_AIM_EPSILON || Math.abs(input.aimY - lastSent.aimY) > IDLE_AIM_EPSILON) {
    return ticksSinceSend >= 2;
  }
  return ticksSinceSend >= IDLE_KEEPALIVE_TICKS;
}
