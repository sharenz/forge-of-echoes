// Per-event ground art of the wave-2 events (Event Director v2). Each art module draws every zone and marker of one view of its
// kind; the MapEventPainter (../map-events.ts) dispatches here for the kinds listed. Same rules as the painter: decal layer or a
// thin additive line, never above a telegraph, never over a monster silhouette or a drop, no full-screen flashes.
import type { MapEventBeat, MapEventKind, MapEventView } from '../../contracts/map-events';
import type { RGB } from '../../contracts/render';
import type { FrameCtx } from '../context';
import type { Pen } from '../pen';
import { orchardArt } from './orchard';
import { pactArt } from './pact';
import { breachArt } from './breach';
import { anvilArt } from './anvil';
import { bellwatchArt } from './bellwatch';

export interface EventArt {
  /** Draw the ground zones and world markers of one live view of this kind (not while it shows its result). */
  draw(pen: Pen, f: FrameCtx, e: MapEventView, col: RGB): void;
  /** The mark a beat leaves on the ground for the rest of the map (radius in world units), or null for none. */
  residue?(beat: MapEventBeat, n: number): { r: number } | null;
}

import { hostArt } from './host';
import { ringArt } from './ring';

export const EVENT_ART: Partial<Record<MapEventKind, EventArt>> = {
  pactAltar: pactArt,
  orchard: orchardArt,
  ring: ringArt,
  voidBreach: breachArt,
  host: hostArt,
  anvil: anvilArt,
  bellwatch: bellwatchArt,
};
