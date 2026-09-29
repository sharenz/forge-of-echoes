export const MAP_EVENT_KINDS = ['hunted', 'echoRift'] as const;
export type MapEventKind = typeof MAP_EVENT_KINDS[number];

/** Server-only creation roll. Never sent in ZoneInfo or a map tooltip. */
export interface MapEventPlan {
  kind: MapEventKind;
  wave: number;
  angle: number;
}

export const MAP_EVENT_PHASES = ['available', 'warning', 'active', 'complete'] as const;
export interface MapEventView {
  kind: MapEventKind;
  phase: typeof MAP_EVENT_PHASES[number];
  x: number;
  y: number;
  remaining: number;
  total: number;
}
