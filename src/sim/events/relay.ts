// EMBER RELAY (event id 'blackout'). The lights are going out. Three cold braziers stand in a triangle; a Wickbearer drops an
// Ember that a player carries to a brazier and lights by standing at it. The Ember's wick burns down (and every hit the
// carrier takes shortens it); the dark hunts the flame. docs/atlas-rework/C-map-events.md 7.1.
//
// The carrier moves 12% slower (PlayerState.eventSlow, on the wire as PlayerView.eventSlow so the client predicts it).
import type { MapEventGrade } from '../../contracts/map-events';
import { ELITE_BIT } from '../../contracts/sim';
import {
  MAP_EVENT_WARNING_SECONDS, RELAY_BEARER_INTERVAL, RELAY_BRAZIERS, RELAY_DWELL, RELAY_DWELL_RADIUS, RELAY_LIT_RADIUS, RELAY_MAX_LOST,
  RELAY_CARRY_SLOW, RELAY_GOLD_SECONDS, RELAY_PICKUP_RADIUS, RELAY_SPACING, RELAY_WICK_HIT, RELAY_WICK_SECONDS,
} from '../../data/progression/map-events';
import { DT } from '../constants';
import { TAU } from '../math';
import type { PlayerState, World } from '../world';
import { EVENT_ANCHOR_RIM } from '../../data/progression/events/anchors';
import { layoutAnchors } from '../layout';
import { anchorRng, anchorSpot, beat, canOnset, eventMonster, familyKind, finish, hasRoom, markOnset, mods, pickSite, placeAt } from './kit';
import type { EventInstance, EventKill, EventScript } from './types';

interface Brazier { x: number; y: number; lit: boolean; progress: number }
interface Ember { x: number; y: number; carrier: number; wick: number }

interface RelayState {
  braziers: Brazier[];
  lit: number;
  lost: number;
  ember: Ember | null;
  /** Live Wickbearers (Keeper of the Flame's price is a second one). */
  bearers: number[];
  nextBearer: number;
}

const state = (e: EventInstance) => e.s as RelayState;

/**
 * Braziers lit, Embers lost and the pace: three lit with no Ember lost and inside the Gold pace is Gold, the same clean run but slower
 * (or one lost) Silver, anything else that lights all three Bronze; two lit when it ends Bronze.
 */
export function relayGrade(lit: number, lost: number, seconds = 0, scale = 1): MapEventGrade {
  if (lit < RELAY_BRAZIERS) return lit >= 2 ? 1 : 0;
  if (lost === 0) return seconds <= RELAY_GOLD_SECONDS * scale ? 3 : 2;
  return lost <= 1 ? 2 : 1;
}

const paceScale = (w: World) => (mods(w).timerScale ?? 1) * (1 + (mods(w).gradeEase ?? 0));

/** Braziers keep this far inside the rim (the radial triangle's own margin). */
const RELAY_RIM = EVENT_ANCHOR_RIM.relay;

/**
 * E1: three of the layout's relay anchors, at least RELAY_SPACING apart (the validator keeps every authored relay that far from the
 * others), taken in a seeded order; null when the area has no layout or fewer than three fit (the radial triangle stands in).
 */
function layoutTriad(w: World, e: EventInstance): { x: number; y: number }[] | null {
  if (!w.layout) return null;
  const R = w.arenaRadius;
  const fits: { id: string; x: number; y: number }[] = [];
  for (const a of layoutAnchors(w, 'relay')) {
    const p = anchorSpot(w, 'relay', a, { minPlayer: 0 });
    if (p) fits.push({ id: a.id, x: p.x, y: p.y });
  }
  if (fits.length < RELAY_BRAZIERS) return null;
  const pick: typeof fits = [];
  for (const a of anchorRng(w, e, 'relay').shuffle(fits)) {
    if (pick.every(b => Math.hypot(a.x - b.x, a.y - b.y) >= RELAY_SPACING)) pick.push(a);
    if (pick.length === RELAY_BRAZIERS) break;
  }
  if (pick.length < RELAY_BRAZIERS) return null;
  e.anchors = pick.map(a => a.id);
  return pick.map(a => placeAt(a.x, a.y, R, w.props));
}

function reveal(w: World, e: EventInstance): boolean {
  if (!canOnset(w)) return false;
  // The layout's relay triad, else a triangle around the arena's heart, at least RELAY_SPACING apart.
  const R = w.arenaRadius;
  const radius = Math.max(RELAY_SPACING / Math.sqrt(3) + 10, Math.min(R * 0.55, R - RELAY_RIM));
  const braziers: Brazier[] = [];
  const triad = layoutTriad(w, e);
  for (let k = 0; k < RELAY_BRAZIERS; k++) {
    const a = e.plan.angle + k * TAU / RELAY_BRAZIERS;
    const p = triad ? triad[k] : placeAt(Math.cos(a) * radius, Math.sin(a) * radius, R, w.props);
    braziers.push({ x: p.x, y: p.y, lit: false, progress: 0 });
  }
  e.s = { braziers, lit: 0, lost: 0, ember: null, bearers: [], nextBearer: 4 } satisfies RelayState;
  e.phase = 'warning';
  e.timer = MAP_EVENT_WARNING_SECONDS;
  markOnset(w);
  beat(w, e, 'omen', 0, 0);
  return true;
}

function scheduleBearer(e: EventInstance, delay: number): void {
  state(e).nextBearer = e.age + delay;
}

function isLit(s: RelayState, x: number, y: number): boolean {
  for (const b of s.braziers) if (b.lit && Math.hypot(b.x - x, b.y - y) <= RELAY_LIT_RADIUS) return true;
  return false;
}

/** The carrier of the Ember (and only the carrier) is slowed. */
function applyCarry(w: World, s: RelayState): void {
  const carrier = s.ember ? s.ember.carrier : 0;
  for (const p of w.players) p.eventSlow = carrier !== 0 && p.id === carrier && !p.dead ? RELAY_CARRY_SLOW : 0;
}

function tick(w: World, e: EventInstance): void {
  const s = state(e);
  if (e.phase === 'active') applyCarry(w, s);
  else if (e.phase !== 'warning') for (const p of w.players) p.eventSlow = 0;
  if (e.phase === 'warning') {
    e.timer -= DT;
    if (e.timer <= 0) { e.phase = 'active'; e.age = 0; beat(w, e, 'onset', 0, 0); }
    return;
  }
  if (e.phase !== 'active') return;
  const bossWave = w.config.waves.bossWave;
  if (bossWave > 0 && w.director.wave >= bossWave && !e.plan.required) {
    end(w, e);
    return;
  }
  // The Wickbearer: a rare that carries the Ember, one at a time.
  const wanted = 1 + (mods(w).relayBearers ?? 0);
  s.bearers = s.bearers.filter(id => w.monsters.slotOf(id) >= 0);
  if (!s.ember && s.bearers.length < wanted && e.age >= s.nextBearer && hasRoom(w, 1)) {
    const site = pickSite(w, e.plan.angle + e.age, { minPlayer: 250, rim: 60, from: 0.9, to: 1 });
    const i = eventMonster(w, e, familyKind(w, 'hunter', 'bruiser'), site.x, site.y, { rarity: 'rare', mods: ELITE_BIT.fierce | ELITE_BIT.swift, shimmer: 1 });
    if (i >= 0) { s.bearers.push(w.monsters.id[i]); beat(w, e, 'arrive', site.x, site.y); }
  }
  const em = s.ember;
  if (em) {
    if (em.carrier === 0) {
      for (const p of w.living) if (Math.hypot(p.x - em.x, p.y - em.y) <= RELAY_PICKUP_RADIUS) { em.carrier = p.id; beat(w, e, 'step', em.x, em.y, 0); break; }
    } else {
      const p = w.playerById[em.carrier];
      if (!p || p.dead) { em.carrier = 0; if (p) { em.x = p.x; em.y = p.y; } }
      else {
        em.x = p.x; em.y = p.y;
        em.wick -= DT / (mods(w).timerScale ?? 1);
        if (em.wick <= 0) return lose(w, e);
        // The dark hunts the flame: shrouded monsters near the carrier run faster.
        if (w.tick % 6 === 0) {
          const m = w.monsters;
          for (let i = 0; i < m.hwm; i++) {
            if (!m.alive[i]) continue;
            if (Math.hypot(m.x[i] - p.x, m.y[i] - p.y) <= 260 && !isLit(s, m.x[i], m.y[i])) m.hasteTime[i] = Math.max(m.hasteTime[i], 0.3);
          }
        }
        // Dwell at an unlit brazier to light it.
        for (const b of s.braziers) {
          if (b.lit) continue;
          if (Math.hypot(p.x - b.x, p.y - b.y) <= RELAY_DWELL_RADIUS) {
            b.progress += DT;
            if (b.progress >= RELAY_DWELL) {
              b.lit = true; s.lit++; s.ember = null;
              beat(w, e, 'lit', b.x, b.y, s.lit);
              scheduleBearer(e, 6);
              if (s.lit >= RELAY_BRAZIERS) return end(w, e);
              break;
            }
          } else b.progress = Math.max(0, b.progress - DT);
        }
      }
    }
  }
}

function lose(w: World, e: EventInstance): void {
  const s = state(e);
  const em = s.ember!;
  s.lost++;
  s.ember = null;
  beat(w, e, 'lost', em.x, em.y, s.lost);
  if (s.lost >= RELAY_MAX_LOST) return end(w, e);
  scheduleBearer(e, 6);
}

function end(w: World, e: EventInstance): void {
  const s = state(e);
  for (const p of w.players) p.eventSlow = 0;
  e.tally = s.lit;
  const g = relayGrade(s.lit, s.lost, e.age, paceScale(w));
  finish(w, e, g, { pay: g >= 1, x: s.braziers[0].x, y: s.braziers[0].y });
}

function onKill(w: World, e: EventInstance, k: EventKill): void {
  const s = state(e);
  if (!s.bearers.includes(k.id)) return;
  s.bearers = s.bearers.filter(id => id !== k.id);
  if (k.credited && e.phase === 'active' && !s.ember) {
    s.ember = { x: k.x, y: k.y, carrier: 0, wick: RELAY_WICK_SECONDS * (mods(w).relayWick ?? 1) };
    beat(w, e, 'step', k.x, k.y, 1);
  } else scheduleBearer(e, 3);
}

function onPlayerHit(_w: World, e: EventInstance, p: PlayerState, amount: number): void {
  const s = state(e);
  if (amount > 0 && s.ember && s.ember.carrier === p.id) s.ember.wick -= RELAY_WICK_HIT;
}

function view(w: World, e: EventInstance): void {
  const s = state(e), v = e.view;
  v.objectives.length = 0; v.timers.length = 0; v.zones.length = 0; v.markers.length = 0;
  let focus = s.braziers[0];
  for (const b of s.braziers) {
    v.zones.push({ kind: 'brazier', x: b.x, y: b.y, r: RELAY_LIT_RADIUS, a: 0, v: b.lit ? 255 : Math.round(Math.min(1, b.progress / RELAY_DWELL) * 100) });
    if (!b.lit && (focus.lit || !s.ember || Math.hypot(b.x - s.ember.x, b.y - s.ember.y) < Math.hypot(focus.x - s.ember.x, focus.y - s.ember.y))) focus = b;
  }
  v.x = s.ember ? s.ember.x : focus.x; v.y = s.ember ? s.ember.y : focus.y;
  if (e.phase !== 'active') { v.hint = 0; v.grade = e.grade; return; }
  v.objectives.push({ id: 0, cur: s.lit, max: RELAY_BRAZIERS }, { id: 1, cur: s.lost, max: RELAY_MAX_LOST });
  v.grade = relayGrade(RELAY_BRAZIERS, s.lost, e.age, paceScale(w));
  if (s.ember) {
    v.markers.push({ icon: 'ember', x: s.ember.x, y: s.ember.y, v: s.ember.carrier ? 1 : 0 });
    if (s.ember.carrier) v.timers.push({ id: 0, seconds: Math.max(0, s.ember.wick), total: RELAY_WICK_SECONDS * (mods(w).relayWick ?? 1) });
    v.hint = s.ember.carrier ? 2 : 1;
  } else {
    const j = s.bearers.length ? w.monsters.slotOf(s.bearers[0]) : -1;
    if (j >= 0) { v.markers.push({ icon: 'guardian', x: w.monsters.x[j], y: w.monsters.y[j], v: 0 }); v.x = w.monsters.x[j]; v.y = w.monsters.y[j]; }
    else v.timers.push({ id: 1, seconds: Math.max(0, s.nextBearer - e.age), total: RELAY_BEARER_INTERVAL });
    v.hint = 0;
  }
  if (s.lost === 0) v.timers.push({ id: 2, seconds: Math.max(0, RELAY_GOLD_SECONDS * paceScale(w) - e.age), total: RELAY_GOLD_SECONDS * paceScale(w) });
}

function cancel(w: World): void {
  for (const p of w.players) p.eventSlow = 0;
}

export const relayScript: EventScript = { kind: 'blackout', reveal, tick, onKill, onPlayerHit, view, cancel };
