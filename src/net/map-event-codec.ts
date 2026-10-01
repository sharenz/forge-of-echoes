// The run's map-event views on the wire (Event Director v2): up to MAX_WIRE_EVENTS concurrent events, each with a few
// objective bars, timers, ground zones and markers. Text never travels: the client looks it up by kind and numeric id
// (data/progression/map-events.ts MAP_EVENT_TEXT). Written after the run header when run flag bit 8 is set.
//
//   u8 count · per event { u8 uid · u8 kind · u8 phase · u8 grade · u8 hint · f32 x · f32 y
//     · u8 nBars { u8 id · u16 cur · u16 max } · u8 nTimers { u8 id · u16 tenthsLeft · u16 tenthsTotal }
//     · u8 nZones { u8 kind · f32 x · f32 y · u16 r · u16 angle (turn/65536) · u8 v · u8 n }
//     · u8 nMarkers { u8 icon · f32 x · f32 y · u8 v · u8 w } }
import {
  MAP_EVENT_ICONS, MAP_EVENT_KINDS, MAP_EVENT_PHASES, MAP_EVENT_ZONES, type MapEventGrade, type MapEventView,
} from '../contracts/map-events';
import type { ByteReader, ByteWriter } from './bytes';

/** A deep copy (the sim reuses its arrays in place; a HUD snapshot must not change under the UI). */
export function cloneMapEvents(events: readonly MapEventView[]): MapEventView[] {
  return events.map((e) => ({ ...e, objectives: e.objectives.map((o) => ({ ...o })), timers: e.timers.map((t) => ({ ...t })),
    zones: e.zones.map((z) => ({ ...z })), markers: e.markers.map((m) => ({ ...m })) }));
}

export const MAX_WIRE_EVENTS = 3;
const MAX_BARS = 4, MAX_TIMERS = 3, MAX_ZONES = 10, MAX_MARKERS = 24;
const TAU = Math.PI * 2;

const clamp = (v: number, lo: number, hi: number) => (v > lo ? (v < hi ? Math.round(v) : hi) : lo);

export function writeMapEvents(w: ByteWriter, events: readonly MapEventView[]): void {
  const n = Math.min(events.length, MAX_WIRE_EVENTS);
  w.u8(n);
  for (let k = 0; k < n; k++) {
    const e = events[k];
    w.u8(e.uid & 255);
    w.u8(Math.max(0, MAP_EVENT_KINDS.indexOf(e.kind)));
    w.u8(Math.max(0, MAP_EVENT_PHASES.indexOf(e.phase)));
    w.u8(clamp(e.grade, 0, 3));
    w.u8(clamp(e.hint, 0, 255));
    w.f32(e.x); w.f32(e.y);
    const bars = Math.min(e.objectives.length, MAX_BARS);
    w.u8(bars);
    for (let j = 0; j < bars; j++) { const o = e.objectives[j]; w.u8(clamp(o.id, 0, 255)); w.u16(clamp(o.cur, 0, 65535)); w.u16(clamp(o.max, 0, 65535)); }
    const timers = Math.min(e.timers.length, MAX_TIMERS);
    w.u8(timers);
    for (let j = 0; j < timers; j++) { const t = e.timers[j]; w.u8(clamp(t.id, 0, 255)); w.u16(clamp(t.seconds * 10, 0, 65535)); w.u16(clamp(t.total * 10, 0, 65535)); }
    const zones = Math.min(e.zones.length, MAX_ZONES);
    w.u8(zones);
    for (let j = 0; j < zones; j++) {
      const z = e.zones[j];
      w.u8(Math.max(0, MAP_EVENT_ZONES.indexOf(z.kind)));
      w.f32(z.x); w.f32(z.y);
      w.u16(clamp(z.r * 8, 0, 65535));
      const a = ((z.a % TAU) + TAU) % TAU;
      w.u16(clamp(a / TAU * 65536, 0, 65535));
      w.u8(clamp(z.v, 0, 255));
      w.u8(clamp(z.n ?? 0, 0, 255));
    }
    const markers = Math.min(e.markers.length, MAX_MARKERS);
    w.u8(markers);
    for (let j = 0; j < markers; j++) {
      const m = e.markers[j];
      w.u8(Math.max(0, MAP_EVENT_ICONS.indexOf(m.icon)));
      w.f32(m.x); w.f32(m.y);
      w.u8(clamp(m.v, 0, 255));
      w.u8(clamp(m.w ?? 0, 0, 255));
    }
  }
}

/** Decode into `out` (cleared first); `enumAt` validates an index against its table. */
export function readMapEvents(r: ByteReader, out: MapEventView[], enumAt: <T>(table: readonly T[], i: number, what: string) => T): void {
  out.length = 0;
  const n = r.u8();
  if (n > MAX_WIRE_EVENTS) throw new Error(`map events: ${n} events`);
  for (let k = 0; k < n; k++) {
    const uid = r.u8();
    const kind = enumAt(MAP_EVENT_KINDS, r.u8(), 'map event');
    const phase = enumAt(MAP_EVENT_PHASES, r.u8(), 'map event phase');
    const grade = Math.min(3, r.u8()) as MapEventGrade;
    const hint = r.u8();
    const x = r.f32(), y = r.f32();
    const e: MapEventView = { uid, kind, phase, grade, hint, x, y, objectives: [], timers: [], zones: [], markers: [] };
    for (let j = r.u8(); j > 0; j--) e.objectives.push({ id: r.u8(), cur: r.u16(), max: r.u16() });
    for (let j = r.u8(); j > 0; j--) e.timers.push({ id: r.u8(), seconds: r.u16() / 10, total: r.u16() / 10 });
    for (let j = r.u8(); j > 0; j--) {
      const zk = enumAt(MAP_EVENT_ZONES, r.u8(), 'map event zone');
      const zx = r.f32(), zy = r.f32(), zr = r.u16() / 8, za = r.u16() / 65536 * TAU, zv = r.u8(), zn = r.u8();
      e.zones.push({ kind: zk, x: zx, y: zy, r: zr, a: za, v: zv, n: zn });
    }
    for (let j = r.u8(); j > 0; j--) {
      const icon = enumAt(MAP_EVENT_ICONS, r.u8(), 'map event icon');
      const mx = r.f32(), my = r.f32(), mv = r.u8(), mw = r.u8();
      e.markers.push({ icon, x: mx, y: my, v: mv, w: mw });
    }
    out.push(e);
  }
}
