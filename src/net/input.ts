// Wire input ↔ sim intent conversion and held-slot bitmask helpers.
import { BELT_SLOTS, LOADOUT_SLOTS } from '../contracts/items';
import type { HeldMask, InputMessage } from '../contracts/net';
import type { PlayerIntent } from '../contracts/sim';

/** Bitmask with one bit per loadout slot (all slots held). */
export const HELD_MASK_ALL: HeldMask = (1 << LOADOUT_SLOTS) - 1;

/** Pack held loadout slots into a bitmask (bit i = slot i). Extra entries beyond LOADOUT_SLOTS are ignored. */
export function heldToMask(held: readonly boolean[]): HeldMask {
  let mask = 0;
  const n = Math.min(held.length, LOADOUT_SLOTS);
  for (let k = 0; k < n; k++) if (held[k]) mask |= 1 << k;
  return mask;
}

/** Unpack a held bitmask into LOADOUT_SLOTS booleans (writes into `out` when given). */
export function maskToHeld(mask: HeldMask, out?: boolean[]): boolean[] {
  const held = out ?? new Array<boolean>(LOADOUT_SLOTS);
  held.length = LOADOUT_SLOTS;
  for (let k = 0; k < LOADOUT_SLOTS; k++) held[k] = (mask & (1 << k)) !== 0;
  return held;
}

export function isSlotHeld(mask: HeldMask, slot: number): boolean {
  return slot >= 0 && slot < LOADOUT_SLOTS && (mask & (1 << slot)) !== 0;
}

export function setSlotHeld(mask: HeldMask, slot: number, held: boolean): HeldMask {
  if (slot < 0 || slot >= LOADOUT_SLOTS) return mask;
  return held ? mask | (1 << slot) : mask & ~(1 << slot) & HELD_MASK_ALL;
}

function finite(v: number, fallback: number): number {
  return Number.isFinite(v) ? v : fallback;
}

function unit(v: number): number {
  const f = finite(v, 0);
  return f < -1 ? -1 : f > 1 ? 1 : f;
}

function flaskSlot(v: number): number {
  return Number.isInteger(v) && v >= 0 && v < BELT_SLOTS ? v : -1;
}

/**
 * The sim intent for one wire input (sanitised: movement clamped to [-1, 1], non-finite aim → 0, unknown flask → -1).
 * Pass `out` to reuse an intent object on the server's hot path (its `held` array is reused too).
 */
export function intentFromInput(input: InputMessage, out?: PlayerIntent): PlayerIntent {
  const intent: PlayerIntent = out ?? { moveX: 0, moveY: 0, aimX: 0, aimY: 0, held: [], flask: -1 };
  intent.moveX = unit(input.moveX);
  intent.moveY = unit(input.moveY);
  intent.aimX = finite(input.aimX, 0);
  intent.aimY = finite(input.aimY, 0);
  intent.held = maskToHeld(input.held | 0, out ? intent.held : undefined);
  intent.flask = flaskSlot(input.flask);
  return intent;
}

/** The wire input for a sim intent (used by bots, tests and the client input sampler). */
export function inputFromIntent(intent: PlayerIntent, seq: number): InputMessage {
  return {
    t: 'input',
    seq: seq >>> 0,
    moveX: unit(intent.moveX),
    moveY: unit(intent.moveY),
    aimX: finite(intent.aimX, 0),
    aimY: finite(intent.aimY, 0),
    held: heldToMask(intent.held),
    flask: flaskSlot(intent.flask),
  };
}

export interface MoveVector {
  x: number;
  y: number;
  len: number;
}

/** Normalised movement direction of an input (length ≤ 1, as the sim applies it). Pass `out` to avoid allocating. */
export function moveVector(input: { moveX: number; moveY: number }, out?: MoveVector): MoveVector {
  let x = unit(input.moveX);
  let y = unit(input.moveY);
  let len = Math.hypot(x, y);
  if (len > 1) {
    x /= len;
    y /= len;
    len = 1;
  }
  const o = out ?? { x: 0, y: 0, len: 0 };
  o.x = x;
  o.y = y;
  o.len = len;
  return o;
}
