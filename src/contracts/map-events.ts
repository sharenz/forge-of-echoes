export const MAP_EVENT_KINDS = ['hunted', 'echoRift', 'blackout', 'vaultbreakers', 'secondCrown', 'wound'] as const;
export type MapEventKind = typeof MAP_EVENT_KINDS[number];

/** Server-only creation roll. Never sent in ZoneInfo or a map tooltip. */
export interface MapEventPlan {
  kind: MapEventKind;
  wave: number;
  angle: number;
  /** Guaranteed area encounters remain available through the boss and must resolve before the map clears. */
  required?: boolean;
  /** Fixed creation sequence: up to three area encounters plus a commissioned Bounty hunter. */
  next?: MapEventPlan;
}

export const MAP_EVENT_PHASES = ['available', 'warning', 'active', 'complete', 'failed'] as const;
export interface MapEventView {
  kind: MapEventKind;
  phase: typeof MAP_EVENT_PHASES[number];
  x: number;
  y: number;
  remaining: number;
  total: number;
  /** Remaining seconds for the fleeing carriers; omitted on untimed encounters. */
  seconds?: number;
}
