// E1, anchor-aware events (docs/atlas-rework/D-territory.md 8 and 10.5a): how far inside the arena edge each event keeps the
// centre of its footprint. One table for both sides: the event scripts place on a layout anchor (and on the radial fallback) with
// these margins, and the layout validator (check 10) proves every authored anchor can seat its event.
import type { EventAnchorKind } from '../../layouts/schema';
import { ECHO_ANCHOR_RIM, FAULT_RADIUS } from '../map-events';
import { BELL_OUTER_RADIUS } from './bellwatch';
import { HOST_OUTER_RADIUS } from './host';
import { PACT_RIM } from './pact-altar';
import { RING_RADIUS } from './ring';

/** Minimum distance (u) from an event's centre to the arena edge, per anchor kind (the radial rules' own `rim`). */
export const EVENT_ANCHOR_RIM: Readonly<Record<EventAnchorKind, number>> = {
  perch: 50,
  echo: ECHO_ANCHOR_RIM,
  road: 0,
  fault: FAULT_RADIUS + 20,
  relay: 130,
  altar: PACT_RIM,
  orchard: 110,
  ring: RING_RADIUS + 30,
  host: HOST_OUTER_RADIUS + 25,
  anvil: 140,
  bell: BELL_OUTER_RADIUS + 50,
};

/**
 * An anchor whose footprint would cross the rim is SEATED: slid straight towards the arena centre until it fits, by at most this
 * many units (it still reads as the same landmark). Further than that, the anchor is blocked and the event takes its radial site;
 * the validator refuses such an anchor.
 */
export const ANCHOR_SEAT = 100;

/** Where an event centred on (x, y) sits after seating in an arena of radius R, or null when it would move more than ANCHOR_SEAT. */
export function seatAnchor(kind: EventAnchorKind, x: number, y: number, R: number): { x: number; y: number; moved: number } | null {
  const lim = R - EVENT_ANCHOR_RIM[kind];
  const d = Math.hypot(x, y);
  if (d <= lim) return { x, y, moved: 0 };
  if (lim <= 0 || d - lim > ANCHOR_SEAT) return null;
  const k = lim / d;
  return { x: x * k, y: y * k, moved: d - lim };
}
