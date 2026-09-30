// THE LADEN CARAVAN (event id 'vaultbreakers'). A treasure wagon crosses the arena on a marked road under escort. The wagon is
// invulnerable; three Locks ride on it (Coffer: currency, Reliquary: an equipment roll, Cartographer's Tube: a map), each with its
// own life. Every lock broken pays at once; the wagon leaves at the far rim and takes the unbroken ones with it.
// docs/atlas-rework/C-map-events.md 6.3.
//
// Wave 2: two wheel hardpoints (destructible fixtures; each broken one slows the wagon 30%, pays nothing), the shield line (each lock
// is guarded by an escort group, left / right / rear, and is invulnerable while more than one of them lives), and the trample lane
// knocks whoever it catches sideways out of it. Ashen: a broken crucible spills a fire pool; Ossuary: the Reliquary lock releases a
// Rimeshade.
import type { MapEventGrade } from '../../contracts/map-events';
import { ELITE_BIT } from '../../contracts/sim';
import {
  CARAVAN_ESCORT_LEASH, CARAVAN_ESCORTS, CARAVAN_LANE, CARAVAN_LANE_DAMAGE, CARAVAN_LANE_KNOCK, CARAVAN_LANE_SECONDS, CARAVAN_LOCKS,
  CARAVAN_LOCK_LIFE, CARAVAN_REINFORCEMENTS, CARAVAN_SHIELD_KEEP, CARAVAN_SPEED, CARAVAN_SPILL_DAMAGE, CARAVAN_SPILL_RADIUS,
  CARAVAN_SPILL_SECONDS, CARAVAN_WHEELS, CARAVAN_WHEEL_LIFE, CARAVAN_WHEEL_RADIUS, CARAVAN_WHEEL_SLOW, MAP_EVENT_WARNING_SECONDS,
} from '../../data/progression/map-events';
import { registerAreaEffect } from '../effects';
import { monsterDef } from '../rosters';

/** A bruiser's base life: the unit locks and wheels are measured in. */
const REF_LIFE = 115;
import { inChargeLine } from '../area-geometry';
import { knockPlayer } from '../player';
import { moveAlong, MONSTER_ANIM as ANIM, setAnim, stop } from '../behaviour';
import { DT } from '../constants';
import { DAMAGE_INDEX } from '../math';
import { ELITE_BIT as ELITE } from '../../contracts/sim';
import { MFLAG } from '../stores';
import type { Area, PlayerState, World } from '../world';
import {
  beat, canOnset, dismissMember, eventArea, eventDamage, eventFixture, eventMonster, familyKind, finish, fixtureLife, hasRoom, markOnset,
  mods, nearestLivingDist, pay, pickSite, skinOf, placeAt } from './kit';
import type { EventInstance, EventKill, EventScript } from './types';

interface CaravanState {
  road: { x: number; y: number }[];
  length: number;
  /** Distance travelled along the road. */
  along: number;
  wagon: number;
  /** Lock monster ids by lock number (0 coffer, 1 reliquary, 2 tube); 0 once broken or lost. */
  locks: number[];
  broken: boolean[];
  /** Escort id -> its formation slot. */
  escorts: Map<number, number>;
  reinforced: boolean;
  laneAt: number;
  double: boolean;
  heading: number;
  gone: boolean;
  /** Escort ids alive per shield group: 0 left (guards lock 0), 1 right (lock 1), 2 rear (lock 2). */
  groups: [Set<number>, Set<number>, Set<number>];
  /** Wheel fixture ids (0 once broken) and how many are broken. */
  wheels: number[];
  wheelsBroken: number;
  shielded: boolean[];
}

/** Trample lane landing: whoever is caught in it is knocked sideways out of it. */
const LANE = registerAreaEffect({
  onResolve(w: World, a: Area): void {
    const ux = Math.cos(a.angle), uy = Math.sin(a.angle);
    for (const p of w.living) {
      if (!inChargeLine(a, p.x, p.y, 7)) continue;
      const side = (p.x - a.x) * -uy + (p.y - a.y) * ux;
      const sg = side >= 0 ? 1 : -1;
      knockPlayer(w, p, -uy * sg, ux * sg, CARAVAN_LANE_KNOCK);
    }
  },
});

const state = (e: EventInstance) => e.s as CaravanState;

function polyLength(pts: { x: number; y: number }[]): number {
  let l = 0;
  for (let k = 1; k < pts.length; k++) l += Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
  return l;
}

/** Point and heading `along` units down the polyline. */
function pointAt(pts: { x: number; y: number }[], along: number): { x: number; y: number; a: number } {
  let left = along;
  for (let k = 1; k < pts.length; k++) {
    const dx = pts[k].x - pts[k - 1].x, dy = pts[k].y - pts[k - 1].y, l = Math.hypot(dx, dy);
    if (left <= l || k === pts.length - 1) {
      const u = l > 0 ? Math.min(1, left / l) : 0;
      return { x: pts[k - 1].x + dx * u, y: pts[k - 1].y + dy * u, a: Math.atan2(dy, dx) };
    }
    left -= l;
  }
  return { x: pts[0].x, y: pts[0].y, a: 0 };
}

/** The wagon's pace (Restless and the Quick Fingers price both speed it up). */
function caravanSpeed(w: World): number {
  return CARAVAN_SPEED * (mods(w).monsterSpeed ?? 1) * (mods(w).caravanSpeed ?? 1);
}

/** The pace with broken wheels (each one multiplies it by CARAVAN_WHEEL_SLOW). */
function pace(w: World, s: CaravanState): number {
  return caravanSpeed(w) * Math.pow(CARAVAN_WHEEL_SLOW, s.wheelsBroken);
}

export function caravanGrade(broken: number): MapEventGrade {
  return Math.min(3, broken) as MapEventGrade;
}

function reveal(w: World, e: EventInstance): boolean {
  if (!canOnset(w) || !hasRoom(w, CARAVAN_ESCORTS + CARAVAN_LOCKS + 2)) return false;
  const R = w.arenaRadius;
  const start = pickSite(w, e.plan.angle, { minPlayer: 250, rim: 60, from: 0.96, to: 1 });
  const a0 = Math.atan2(start.y, start.x);
  const sign = (e.plan.variant ?? 0) & 1 ? 1 : -1;
  const mid = placeAt(Math.cos(a0 + sign * Math.PI / 2) * R * 0.25, Math.sin(a0 + sign * Math.PI / 2) * R * 0.25, R, w.props);
  const a1 = a0 + Math.PI * 0.9 * sign;
  const end = placeAt(Math.cos(a1) * (R - 60), Math.sin(a1) * (R - 60), R, w.props);
  const road = [start, mid, end];
  e.s = { road, length: polyLength(road), along: 0, wagon: 0, locks: [], broken: [false, false, false], escorts: new Map(),
    reinforced: false, laneAt: 0, double: e.plan.required === true, heading: a0 + Math.PI, gone: false,
    groups: [new Set(), new Set(), new Set()], wheels: [], wheelsBroken: 0, shielded: [true, true, true] } satisfies CaravanState;
  e.phase = 'warning';
  e.timer = MAP_EVENT_WARNING_SECONDS;
  markOnset(w);
  beat(w, e, 'omen', start.x, start.y);
  return true;
}

function slotOffset(k: number, heading: number): { x: number; y: number } {
  // Three groups round the wagon, rotated to its heading: a left column, a right column and a rear guard.
  const row = Math.floor(k / 3), g = k % 3;
  const bx = g === 2 ? -62 - row * 26 : -20 - row * 28;
  const by = g === 0 ? -42 : g === 1 ? 42 : (row % 2 === 0 ? -14 : 14);
  const c = Math.cos(heading), s = Math.sin(heading);
  return { x: bx * c - by * s, y: bx * s + by * c };
}

/** Where lock `k` and wheel `k` ride on the wagon (local x along the heading, y to its side). */
const LOCK_AT = [{ x: -6, y: -20 }, { x: -6, y: 20 }, { x: -24, y: 0 }] as const;
const WHEEL_AT = [{ x: -26, y: -27 }, { x: -26, y: 27 }] as const;

function rideAt(p: { x: number; y: number; a: number }, at: { x: number; y: number }): { x: number; y: number } {
  const c = Math.cos(p.a), sn = Math.sin(p.a);
  return { x: p.x + at.x * c - at.y * sn, y: p.y + at.x * sn + at.y * c };
}

function launch(w: World, e: EventInstance): boolean {
  const s = state(e);
  const start = s.road[0];
  const skin = skinOf(w);
  const wagonKind = familyKind(w, 'bruiser', 'hunter');
  const wi = eventMonster(w, e, wagonKind, start.x, start.y, { rarity: 'normal', shimmer: 0.5, summoned: true });
  if (wi < 0) return false;
  const m = w.monsters;
  m.flags[wi] |= MFLAG.immune | MFLAG.heavy | MFLAG.unpushable;
  m.flags[wi] &= ~MFLAG.guard;
  m.radius[wi] = 30;
  m.maxLife[wi] = 1e9; m.life[wi] = 1e9;
  s.wagon = m.id[wi];
  const lockKind = familyKind(w, 'bruiser', 'hunter');
  for (let k = 0; k < CARAVAN_LOCKS; k++) {
    const li = eventMonster(w, e, lockKind, start.x, start.y, { rarity: 'magic', mods: ELITE_BIT.stout, shimmer: 0.5, summoned: true });
    if (li < 0) { s.locks.push(0); continue; }
    m.flags[li] |= MFLAG.unpushable;
    m.flags[li] &= ~MFLAG.guard; // a Coliseum lock must not turn a shieldbearer's block on the players' shots
    // Lock life is measured in bruisers whatever the roster's lock kind is (a Chapel has no bruiser: a hunter stands in).
    m.maxLife[li] *= CARAVAN_LOCK_LIFE * (mods(w).lockLife ?? 1) * REF_LIFE / monsterDef(lockKind).life; m.life[li] = m.maxLife[li];
    m.radius[li] = 12;
    s.locks.push(m.id[li]);
  }
  const count = Math.round(CARAVAN_ESCORTS * (s.double ? 2 : 1) * (mods(w).monsterCount ?? 1));
  for (let k = 0; k < count && hasRoom(w, 1); k++) {
    const kind = k % 3 === 2 ? familyKind(w, 'bruiser', 'hunter') : k % 3 === 1 ? familyKind(w, 'hunter', 'fast') : familyKind(w, 'swarmer', 'fast');
    const off = slotOffset(k, s.heading);
    const p = placeAt(start.x + off.x, start.y + off.y, w.arenaRadius, w.props);
    const ei = eventMonster(w, e, kind, p.x, p.y, { rarity: 'normal', summoned: true });
    if (ei >= 0) { s.escorts.set(m.id[ei], k); s.groups[k % 3].add(m.id[ei]); }
  }
  for (let k = 0; k < CARAVAN_WHEELS; k++) {
    const wi2 = eventFixture(w, e, start.x, start.y, CARAVAN_WHEEL_LIFE * REF_LIFE / monsterDef(wagonKind).life, CARAVAN_WHEEL_RADIUS, wagonKind);
    if (wi2 >= 0) m.flags[wi2] &= ~MFLAG.guard;
    s.wheels.push(wi2 >= 0 ? m.id[wi2] : 0);
  }
  void skin;
  return true;
}

function tick(w: World, e: EventInstance): void {
  const s = state(e);
  if (e.phase === 'warning') {
    e.timer -= DT;
    if (e.timer <= 0 && launch(w, e)) { e.phase = 'active'; beat(w, e, 'onset', s.road[0].x, s.road[0].y); }
    return;
  }
  if (e.phase !== 'active') return;
  const wi = w.monsters.slotOf(s.wagon);
  if (wi < 0) return;
  const m = w.monsters;
  const speed = pace(w, s);
  s.along = Math.min(s.length, s.along + speed * DT);
  const p = pointAt(s.road, s.along);
  s.heading = p.a;
  m.x[wi] = p.x; m.y[wi] = p.y; m.facing[wi] = Math.cos(p.a) >= 0 ? 1 : -1;
  stop(w, wi);
  setAnim(w, wi, ANIM.move);
  // Locks ride on the wagon.
  for (let k = 0; k < s.locks.length; k++) {
    const li = s.locks[k] ? m.slotOf(s.locks[k]) : -1;
    if (li < 0) continue;
    const at = rideAt(p, LOCK_AT[k]);
    m.x[li] = at.x; m.y[li] = at.y;
    stop(w, li);
    // The shield line: the lock is invulnerable while more than CARAVAN_SHIELD_KEEP of its escort group live.
    const up = s.groups[k].size > CARAVAN_SHIELD_KEEP;
    if (up) m.flags[li] |= MFLAG.immune | MFLAG.shielded; else m.flags[li] &= ~(MFLAG.immune | MFLAG.shielded);
    if (s.shielded[k] && !up) { beat(w, e, 'crack', m.x[li], m.y[li], 1); }
    s.shielded[k] = up;
  }
  // The wheels ride the rear axle.
  for (let k = 0; k < s.wheels.length; k++) {
    const hi = s.wheels[k] ? m.slotOf(s.wheels[k]) : -1;
    if (hi < 0) continue;
    const at = rideAt(p, WHEEL_AT[k]);
    m.x[hi] = at.x; m.y[hi] = at.y;
    stop(w, hi);
  }
  // The trample lane: the next stretch of road is a telegraphed lane that hurts whoever stands in it.
  s.laneAt -= DT;
  if (s.laneAt <= 0) {
    s.laneAt = CARAVAN_LANE_SECONDS * 0.6;
    eventArea(w, 'chargeLine', p.x + Math.cos(p.a) * 30, p.y + Math.sin(p.a) * 30, CARAVAN_LANE, CARAVAN_LANE_SECONDS, {
      angle: p.a, variant: 2, damage: eventDamage(w, CARAVAN_LANE_DAMAGE), dtype: DAMAGE_INDEX.physical, hurts: 'player', debuff: null, owner: s.wagon,
      effect: LANE,
    });
  }
  // Reinforcements drop from the rim at 45% of the route.
  if (!s.reinforced && s.along >= s.length * 0.45) {
    s.reinforced = true;
    beat(w, e, 'arrive', p.x, p.y);
    const n = Math.round(CARAVAN_REINFORCEMENTS * (mods(w).monsterCount ?? 1));
    for (let k = 0; k < n && hasRoom(w, 1); k++) {
      const site = pickSite(w, e.plan.angle + 2 + k * 1.3, { minPlayer: 250, rim: 60, from: 0.92, to: 1 });
      eventArea(w, 'echoMark', site.x, site.y, 26, 1.4);
      const ri = eventMonster(w, e, familyKind(w, 'hunter', 'fast'), site.x, site.y, { rarity: 'normal', shimmer: 1, summoned: true });
      if (ri >= 0) {
        // Reinforcements join the group of the nearest lock.
        let g = 0, best = Infinity;
        for (let q = 0; q < s.locks.length; q++) {
          const lj = s.locks[q] ? m.slotOf(s.locks[q]) : -1;
          const d = lj >= 0 ? Math.hypot(m.x[lj] - site.x, m.y[lj] - site.y) : Infinity;
          if (d < best) { best = d; g = q; }
        }
        s.groups[g].add(m.id[ri]);
      }
    }
  }
  if (s.along >= s.length) leave(w, e);
}

/** The wagon reaches the far rim: unbroken locks are lost, escorts stay as ordinary monsters. */
function leave(w: World, e: EventInstance): void {
  const s = state(e);
  s.gone = true;
  const broken = s.broken.filter(Boolean).length;
  for (const id of s.locks) if (id) dismissMember(w, e, id);
  for (const id of s.wheels) if (id) dismissMember(w, e, id);
  dismissMember(w, e, s.wagon);
  s.locks = [0, 0, 0];
  e.tally = broken;
  finish(w, e, caravanGrade(broken), { pay: false, x: s.road[s.road.length - 1].x, y: s.road[s.road.length - 1].y });
}

function drive(w: World, e: EventInstance, i: number, t: PlayerState | null): boolean {
  const s = state(e), m = w.monsters, id = m.id[i];
  if (id === s.wagon || s.locks.includes(id)) return true; // moved by tick()
  const slot = s.escorts.get(id);
  if (slot === undefined || s.gone) return false;
  // Escorts hold formation until a player comes within their leash, then they fight like any monster.
  if (nearestLivingDist(w, m.x[i], m.y[i]) <= CARAVAN_ESCORT_LEASH) { s.escorts.delete(id); return false; }
  const wi = m.slotOf(s.wagon);
  if (wi < 0) return false;
  const off = slotOffset(slot, s.heading);
  const dx = m.x[wi] + off.x - m.x[i], dy = m.y[wi] + off.y - m.y[i];
  if (Math.hypot(dx, dy) < 6) { stop(w, i); setAnim(w, i, ANIM.idle); return true; }
  moveAlong(w, i, dx, dy, 1.15);
  m.facing[i] = dx >= 0 ? 1 : -1;
  setAnim(w, i, ANIM.move);
  void t;
  return true;
}

function onKill(w: World, e: EventInstance, k: EventKill): void {
  const s = state(e);
  s.escorts.delete(k.id);
  for (const g of s.groups) g.delete(k.id);
  const wheel = s.wheels.indexOf(k.id);
  if (wheel >= 0) {
    s.wheels[wheel] = 0;
    if (k.credited && e.phase === 'active') {
      s.wheelsBroken++;
      beat(w, e, 'crack', k.x, k.y, 0);
    }
    return;
  }
  const lock = s.locks.indexOf(k.id);
  if (lock < 0 || !k.credited || e.phase !== 'active') return;
  s.locks[lock] = 0;
  s.broken[lock] = true;
  const broken = s.broken.filter(Boolean).length;
  e.tally = broken;
  beat(w, e, 'lock', k.x, k.y, lock);
  pay(w, e, 1, lock, k.x, k.y);
  spill(w, e, lock, k.x, k.y);
  if (broken >= CARAVAN_LOCKS) {
    finish(w, e, 3, { pay: false, x: k.x, y: k.y });
    pay(w, e, 3, CARAVAN_LOCKS, k.x, k.y);
    // The empty wagon rolls off without loot.
    s.gone = true;
    for (const id of s.wheels) if (id) dismissMember(w, e, id);
    dismissMember(w, e, s.wagon);
  }
}

/** Theme riders of a broken lock: a spilled crucible (ashen) or a released Rimeshade from the Reliquary (ossuary). */
function spill(w: World, e: EventInstance, lock: number, x: number, y: number): void {
  const skin = skinOf(w);
  if (skin === 'ashen') {
    // Telegraphed: the pool is harmless for its first second (F1).
    eventArea(w, 'firePool', x, y, CARAVAN_SPILL_RADIUS, CARAVAN_SPILL_SECONDS, {
      damage: eventDamage(w, CARAVAN_SPILL_DAMAGE), dtype: DAMAGE_INDEX.fire, hurts: 'player', tickInterval: 0.5, firstTick: 1.0,
    });
  } else if (skin === 'ossuary' && lock === 1 && hasRoom(w, 1)) {
    // Released on the lock with a shimmer: an ordinary magic Rimeshade of the horde.
    const kind = w.roster.family.find(f => f === 'rimeshade') ?? familyKind(w, 'hunter', 'fast');
    eventMonster(w, e, kind, x, y, { rarity: 'magic', mods: ELITE.swift, shimmer: 1 });
  }
}

function view(w: World, e: EventInstance): void {
  const s = state(e), v = e.view;
  v.objectives.length = 0; v.timers.length = 0; v.zones.length = 0; v.markers.length = 0;
  const start = s.road[0];
  v.x = start.x; v.y = start.y;
  for (let k = 0; k < s.road.length; k++) {
    const next = s.road[Math.min(s.road.length - 1, k + 1)];
    v.zones.push({ kind: 'road', x: s.road[k].x, y: s.road[k].y, r: 24, a: Math.atan2(next.y - s.road[k].y, next.x - s.road[k].x), v: k === s.road.length - 1 ? 1 : 0 });
  }
  const broken = s.broken.filter(Boolean).length;
  v.grade = e.phase === 'active' ? caravanGrade(broken) : e.grade;
  if (e.phase !== 'active') { v.hint = 0; return; }
  const wi = w.monsters.slotOf(s.wagon);
  if (wi >= 0) {
    v.x = w.monsters.x[wi]; v.y = w.monsters.y[wi];
    v.markers.push({ icon: 'wagon', x: v.x, y: v.y, v: Math.round(s.along / s.length * 100) });
  }
  let anyShield = false;
  s.locks.forEach((id, k) => {
    const li = id ? w.monsters.slotOf(id) : -1;
    if (li < 0) return;
    const up = s.shielded[k];
    anyShield = anyShield || up;
    v.markers.push({ icon: 'lock', x: w.monsters.x[li], y: w.monsters.y[li], v: k, w: up ? 1 : 0 });
    if (up) v.markers.push({ icon: 'shield', x: w.monsters.x[li], y: w.monsters.y[li], v: k, w: Math.min(255, s.groups[k].size) });
  });
  s.wheels.forEach((id, k) => {
    const hi = id ? w.monsters.slotOf(id) : -1;
    if (hi >= 0) v.markers.push({ icon: 'wheel', x: w.monsters.x[hi], y: w.monsters.y[hi], v: k, w: Math.round(fixtureLife(w, id) * 100) });
  });
  v.objectives.push({ id: 0, cur: broken, max: CARAVAN_LOCKS }, { id: 1, cur: Math.round(s.along / s.length * 100), max: 100 });
  const left = Math.max(0, (s.length - s.along) / pace(w, s));
  v.timers.push({ id: 0, seconds: left, total: Math.max(left, s.length / caravanSpeed(w)) });
  v.hint = s.reinforced ? 2 : anyShield ? 0 : s.wheelsBroken === 0 ? 4 : 1;
}

function cancel(w: World, e: EventInstance): void {
  const s = state(e);
  if (s.gone) return;
  for (const id of s.locks) if (id) dismissMember(w, e, id);
  for (const id of s.wheels) if (id) dismissMember(w, e, id);
  if (s.wagon) dismissMember(w, e, s.wagon);
}

export const caravanScript: EventScript = { kind: 'vaultbreakers', reveal, tick, drive, onKill, view, cancel };
