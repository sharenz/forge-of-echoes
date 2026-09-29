// Per-frame budget for the cosmetic events handed to the presenter. Normal play stays far below it (a packed
// 4-player late wave is a few dozen per frame); it only bites after a stall — a GPU hang, a throttled window — when
// a backlog would otherwise play as one wall of hit numbers, bursts and sounds.
import type { SimEvent } from '../contracts/sim';
import { isImmediateEvent } from '../net';

/** Most events one frame hands to the presenter. */
export const MAX_FRAME_EVENTS = 400;

/**
 * Trim `events` in place to at most `max` (order kept). Events about the local player or the run state the HUD
 * shows (the EventTimeline's "immediate" set: her casts, hits, pickups, portals, chest, clear, wave tells) always
 * stay; among the rest the newest win. Returns `events`.
 */
export function capEvents(events: SimEvent[], max: number, localPlayerId: number): SimEvent[] {
  const n = events.length;
  if (n <= max) return events;
  let pinned = 0;
  for (let i = 0; i < n; i++) if (isImmediateEvent(events[i], localPlayerId)) pinned++;
  let budget = Math.max(0, max - pinned);
  const keep = new Uint8Array(n);
  for (let i = n - 1; i >= 0; i--) {
    if (isImmediateEvent(events[i], localPlayerId)) keep[i] = 1;
    else if (budget > 0) {
      keep[i] = 1;
      budget--;
    }
  }
  let w = 0;
  for (let i = 0; i < n; i++) if (keep[i]) events[w++] = events[i];
  events.length = w;
  return events;
}
