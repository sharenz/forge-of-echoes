// BELLWATCH (event id 'bellwatch'). A great bell tolls over the arena and four Cantors keep it ringing. Every few seconds the bell
// swings (a telegraph) and sends an expanding ring with three gaps across the field; each toll adds a Dirge stack that speeds
// every monster. The two outer Cantors can be cut at once; the two inner ones are shielded while an outer Cantor lives. Every
// Cantor that falls removes a Dirge stack and slows the bell. docs/atlas-rework/C-map-events.md 7.7.
import type { MonsterKind } from '../../contracts/content';
import type { MapEventGrade } from '../../contracts/map-events';
import { ELITE_BIT } from '../../contracts/sim';
import { MAP_EVENT_WARNING_SECONDS } from '../../data/progression/map-events';
import {
  BELL_AFTERMATH_SECONDS, BELL_CANTORS, BELL_CANTOR_LIFE, BELL_CLEARANCE, BELL_DIRGE_MAX, BELL_DIRGE_SPEED, BELL_FIRST_TOLL,
  BELL_GOLD_TOLL, BELL_INNER_RADIUS, BELL_OUTER_RADIUS, BELL_RING_DAMAGE, BELL_RING_END, BELL_RING_GAPS, BELL_RING_SECONDS,
  BELL_RING_START, BELL_SWING_SECONDS, BELL_TOLLS, BELL_TOLL_SECONDS, BELL_TOLL_SLOWING,
} from '../../data/progression/events/bellwatch';
import { spawnArea } from '../areas';
import { moveAlong, MONSTER_ANIM as ANIM, setAnim, stop } from '../behaviour';
import { DT } from '../constants';
import { DAMAGE_INDEX, TAU } from '../math';
import { MFLAG } from '../stores';
import type { Area, PlayerState, World } from '../world';
import {
  beat, canOnset, dismissMember, eventArea, eventDamage, eventMonster, familyKind, finish, hasRoom, markOnset, mods, nearestLivingDist,
  pay, pickSite, placeAt, releaseMembers, skinOf,
} from './kit';
import type { EventInstance, EventKill, EventScript } from './types';

interface Cantor { id: number; inner: boolean; x: number; y: number; dead: boolean }

interface BellState {
  bell: { x: number; y: number };
  cantors: Cantor[];
  spawned: boolean;
  /** Seconds since the onset. */
  t: number;
  tolls: number;
  /** Event seconds of the next toll (the bell swings BELL_SWING_SECONDS before its ring leaves). */
  nextToll: number;
  lastToll: number;
  /** Seconds until the pending ring leaves the bell (-1 = none). */
  ring: number;
  ringAngle: number;
  dirge: number;
  fallen: number;
  fallenBeforeGold: number;
  /** Event seconds at which each Cantor fell (telemetry for calibration). */
  fallenAt: number[];
  /** Event seconds when the tolls ended (-1 while they go on). */
  silentAt: number;
  warn: Area | null;
  waited: number;
  done: boolean;
}

const state = (e: EventInstance) => e.s as BellState;

/** Gold: all four before toll 4 rings; Silver: three (or all four later); Bronze: two; else nothing. */
export function bellGrade(fallen: number, beforeGold: number): MapEventGrade {
  if (beforeGold >= BELL_CANTORS) return 3;
  return fallen >= BELL_CANTORS - 1 ? 2 : fallen >= 2 ? 1 : 0;
}

export const tollEvery = (w: World, fallen: number) => BELL_TOLL_SECONDS * (mods(w).tollScale ?? 1) * (1 + BELL_TOLL_SLOWING * fallen);

function reveal(w: World, e: EventInstance): boolean {
  if (!canOnset(w) || !hasRoom(w, BELL_CANTORS)) return false;
  const bell = pickSite(w, e.plan.angle, { minPlayer: BELL_CLEARANCE, rim: BELL_OUTER_RADIUS + 50, from: 0, to: 0.65 });
  e.s = { bell, cantors: [], spawned: false, t: 0, tolls: 0, nextToll: BELL_FIRST_TOLL, lastToll: 0, ring: -1, ringAngle: 0, dirge: 0, fallen: 0,
    fallenBeforeGold: 0, fallenAt: [], silentAt: -1, warn: null, waited: 0, done: false } satisfies BellState;
  e.phase = 'warning';
  e.timer = MAP_EVENT_WARNING_SECONDS;
  markOnset(w);
  beat(w, e, 'omen', bell.x, bell.y);
  return true;
}

function cantorKind(w: World): MonsterKind {
  return familyKind(w, 'artillery', 'hunter', 'fast');
}

/** Two outer Cantors on the far ring, two inner ones in the gaps' heart; each spot is turned until it clears every player (F4). */
function spawnCantors(w: World, e: EventInstance): boolean {
  const s = state(e);
  if (!hasRoom(w, BELL_CANTORS)) return false;
  const base = e.plan.angle;
  const sites: { x: number; y: number; inner: boolean }[] = [];
  for (let k = 0; k < BELL_CANTORS; k++) {
    const inner = k >= 2;
    const r = inner ? BELL_INNER_RADIUS : BELL_OUTER_RADIUS;
    let best = { x: 0, y: 0 }, bestD = -1;
    for (let q = 0; q < 12; q++) {
      const a = base + (inner ? Math.PI / 2 : 0) + (k % 2) * Math.PI + (q % 2 === 0 ? 1 : -1) * Math.floor((q + 1) / 2) * (TAU / 24);
      const p = placeAt(s.bell.x + Math.cos(a) * r, s.bell.y + Math.sin(a) * r, w.arenaRadius, w.props);
      const d = nearestLivingDist(w, p.x, p.y);
      if (d > bestD) { best = p; bestD = d; }
      if (d >= 250) break;
    }
    sites.push({ ...best, inner });
  }
  // Wait (up to 20 s) for players to leave a spawn; then go ahead (the shimmer still gives a second of warning).
  if (s.waited < 20 && sites.some(p => nearestLivingDist(w, p.x, p.y) < 250)) { s.waited += DT; return false; }
  const life = BELL_CANTOR_LIFE * (mods(w).cantorLife ?? 1);
  for (const p of sites) {
    const i = eventMonster(w, e, cantorKind(w), p.x, p.y, { rarity: 'rare', mods: ELITE_BIT.fierce, shimmer: 1 });
    if (i < 0) continue;
    const m = w.monsters;
    m.maxLife[i] *= life; m.life[i] = m.maxLife[i];
    m.flags[i] |= MFLAG.unpushable;
    s.cantors.push({ id: m.id[i], inner: p.inner, x: p.x, y: p.y, dead: false });
  }
  s.spawned = true;
  return true;
}

function riderOf(w: World): 'burning' | 'chilled' | 'bleeding' {
  const skin = skinOf(w);
  return skin === 'ashen' ? 'burning' : skin === 'ossuary' ? 'chilled' : 'bleeding';
}

/** Linked shields: an inner Cantor is shielded (and cannot be hurt) while an outer Cantor lives. */
function linkShields(w: World, s: BellState): void {
  const outerAlive = s.cantors.some(c => !c.dead && !c.inner);
  for (const c of s.cantors) {
    if (c.dead) continue;
    const i = w.monsters.slotOf(c.id);
    if (i < 0) continue;
    const shield = c.inner && outerAlive;
    if (shield) w.monsters.flags[i] |= MFLAG.shielded | MFLAG.immune;
    else w.monsters.flags[i] &= ~(MFLAG.shielded | MFLAG.immune);
  }
}

function setDirge(w: World, s: BellState, n: number): void {
  s.dirge = Math.max(0, Math.min(BELL_DIRGE_MAX, n));
  w.mapEvent!.monsterSpeed = 1 + BELL_DIRGE_SPEED * s.dirge;
}

function tick(w: World, e: EventInstance): void {
  const s = state(e);
  if (e.phase === 'warning') {
    e.timer -= DT;
    if (e.timer <= 0) { e.phase = 'active'; e.age = 0; beat(w, e, 'onset', s.bell.x, s.bell.y); }
    return;
  }
  if (e.phase !== 'active') return;
  const bossWave = w.config.waves.bossWave;
  if (bossWave > 0 && w.director.wave >= bossWave && !e.plan.required) return end(w, e);
  if (!s.spawned) {
    if (!spawnCantors(w, e)) return;
    s.lastToll = 0;
  }
  s.t += DT;
  linkShields(w, s);
  // The swing: a harmless telegraph at the bell, then the ring leaves it.
  if (s.tolls < BELL_TOLLS && s.ring < 0 && s.t >= s.nextToll) {
    s.tolls++;
    s.lastToll = s.t;
    s.ring = BELL_SWING_SECONDS;
    s.ringAngle = e.plan.angle + s.tolls * 2.399963;
    s.warn = spawnArea(w, 'slamWarning', s.bell.x, s.bell.y, 52, BELL_SWING_SECONDS, { hurts: 'none', debuff: null });
    setDirge(w, s, s.dirge + 1);
    beat(w, e, 'toll', s.bell.x, s.bell.y, s.dirge);
    s.nextToll = s.t + tollEvery(w, s.fallen);
  }
  if (s.ring >= 0) {
    s.ring -= DT;
    if (s.ring <= 0) {
      s.ring = -1;
      const skin = skinOf(w);
      eventArea(w, 'choirWave', s.bell.x, s.bell.y, BELL_RING_START, BELL_RING_SECONDS, {
        endRadius: BELL_RING_END, angle: s.ringAngle, variant: BELL_RING_GAPS - 1, hurts: 'player', damage: eventDamage(w, BELL_RING_DAMAGE),
        dtype: skin === 'ashen' ? DAMAGE_INDEX.fire : skin === 'ossuary' ? DAMAGE_INDEX.cold : DAMAGE_INDEX.physical, debuff: riderOf(w),
      });
    }
  }
  if (s.silentAt < 0 && s.tolls >= BELL_TOLLS && s.ring < 0) s.silentAt = s.t;
  if (s.silentAt >= 0 && s.t - s.silentAt >= BELL_AFTERMATH_SECONDS) end(w, e);
}

function end(w: World, e: EventInstance): void {
  const s = state(e);
  if (s.done) return;
  s.done = true;
  setDirge(w, s, 0);
  w.mapEvent!.monsterSpeed = 1;
  e.tally = s.fallen;
  const g = bellGrade(s.fallen, s.fallenBeforeGold);
  // Cantors still standing rejoin the horde, unshielded.
  for (const c of s.cantors) {
    const i = c.dead ? -1 : w.monsters.slotOf(c.id);
    if (i >= 0) w.monsters.flags[i] &= ~(MFLAG.shielded | MFLAG.immune);
  }
  releaseMembers(w, e);
  finish(w, e, g, { pay: g >= 1, lost: g === 0, choice: 4, x: s.bell.x, y: s.bell.y });
}

function drive(w: World, e: EventInstance, i: number, t: PlayerState | null): boolean {
  const s = state(e), m = w.monsters;
  const c = s.cantors.find(q => q.id === m.id[i]);
  if (!c) return false;
  // A cantor holds its post and sings; it fights like any monster once a player is near.
  if (t && nearestLivingDist(w, m.x[i], m.y[i]) <= 130) return false;
  const dx = c.x - m.x[i], dy = c.y - m.y[i];
  if (Math.hypot(dx, dy) < 12) { stop(w, i); setAnim(w, i, ANIM.idle); return true; }
  moveAlong(w, i, dx, dy, 1);
  m.facing[i] = dx >= 0 ? 1 : -1;
  setAnim(w, i, ANIM.move);
  return true;
}

function onKill(w: World, e: EventInstance, k: EventKill): void {
  const s = state(e);
  const c = s.cantors.find(q => q.id === k.id);
  if (!c || c.dead) return;
  c.dead = true;
  if (!k.credited) return;
  s.fallen++;
  s.fallenAt.push(Math.round(s.t * 10) / 10);
  if (s.tolls < BELL_GOLD_TOLL) s.fallenBeforeGold++;
  setDirge(w, s, s.dirge - 1);
  beat(w, e, 'crack', k.x, k.y, s.fallen);
  pay(w, e, 1, s.fallen - 1, k.x, k.y);
  linkShields(w, s);
  if (s.fallen >= BELL_CANTORS) end(w, e);
}

function view(w: World, e: EventInstance): void {
  const s = state(e), v = e.view;
  v.objectives.length = 0; v.timers.length = 0; v.zones.length = 0; v.markers.length = 0;
  v.x = s.bell.x; v.y = s.bell.y;
  const every = tollEvery(w, s.fallen);
  const since = s.t - s.lastToll;
  v.markers.push({ icon: 'bell', x: s.bell.x, y: s.bell.y, v: s.dirge, w: s.tolls >= BELL_TOLLS ? 0 : Math.round(Math.min(1, Math.max(0, 1 - (s.nextToll - s.t) / every)) * 100) });
  if (e.phase !== 'active') { v.hint = 0; v.grade = e.grade; return; }
  void since;
  for (const c of s.cantors) {
    if (c.dead) continue;
    const i = w.monsters.slotOf(c.id);
    if (i < 0) continue;
    const shielded = (w.monsters.flags[i] & MFLAG.shielded) !== 0;
    v.markers.push({ icon: 'cantor', x: w.monsters.x[i], y: w.monsters.y[i], v: shielded ? 1 : 0, w: Math.round(Math.max(0, w.monsters.life[i] / w.monsters.maxLife[i]) * 100) });
  }
  v.objectives.push({ id: 0, cur: s.fallen, max: BELL_CANTORS }, { id: 1, cur: s.dirge, max: BELL_DIRGE_MAX }, { id: 2, cur: s.tolls, max: BELL_TOLLS });
  v.grade = bellGrade(s.fallen, s.fallenBeforeGold);
  if (s.silentAt < 0) v.timers.push({ id: 0, seconds: Math.max(0, s.nextToll - s.t), total: every });
  else v.timers.push({ id: 1, seconds: Math.max(0, BELL_AFTERMATH_SECONDS - (s.t - s.silentAt)), total: BELL_AFTERMATH_SECONDS });
  v.hint = s.silentAt >= 0 ? 2 : s.tolls >= BELL_GOLD_TOLL - 1 ? 3 : s.fallen === 0 ? 0 : 1;
}

function cancel(w: World, e: EventInstance): void {
  const s = state(e);
  if (s.warn) s.warn.dead = true;
  w.mapEvent!.monsterSpeed = 1;
  for (const c of s.cantors) if (!c.dead) dismissMember(w, e, c.id);
}

export const bellwatchScript: EventScript = { kind: 'bellwatch', reveal, tick, drive, onKill, view, cancel };
