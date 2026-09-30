// VOID BREACH (event id 'voidBreach'). A tear in the air near the arena's heart. Once it opens (someone walks up, or by itself after
// 20 s) a TIDE OF VOID eats the arena from the rim in four steps: every band from the current safe radius out past the rim
// telegraphs 2.2 s and then hurts everything inside (players a hit, monsters a share of their life), and is re-fired every 6 s so the
// safe zone stays shrunk (100% -> 72% -> 50% -> 34% of the field). The party and the horde are squeezed toward the Void Heart,
// which is warded until the three Voidcallers (one per step, steps 1 to 3) are slain; once the ward is down it fires a telegraphed
// nova at the player nearest it. Breaking the Heart seals the breach: Gold <= 70 s, Silver <= 100 s from the opening. Past 130 s it
// overflows (surges of monsters and a faster tide, Bronze at best). Voidtouched Atlas adds percent to the tide and the pay.
import type { MapEventGrade } from '../../contracts/map-events';
import { ELITE_BIT } from '../../contracts/sim';
import {
  BREACH_AUTO_OPEN, BREACH_CALLERS, BREACH_CALLER_SHIMMER, BREACH_CLEARANCE, BREACH_DAMAGE, BREACH_FIELD, BREACH_GRADE_SECONDS, BREACH_SKIN_PACE,
  BREACH_HEART_LIFE, BREACH_HEART_RADIUS, BREACH_MONSTER_FRAC, BREACH_NOVA_DAMAGE, BREACH_NOVA_RADIUS, BREACH_NOVA_SECONDS,
  BREACH_OVERFLOW_SECONDS, BREACH_PULSE_OVERFLOW, BREACH_PULSE_SECONDS, BREACH_REACH, BREACH_SAFE, BREACH_STEP_SECONDS,
  BREACH_SURGE_MONSTERS, BREACH_SURGE_SECONDS, BREACH_TELEGRAPH,
} from '../../data/progression/events/void-breach';
import { MAP_EVENT_WARNING_SECONDS } from '../../data/progression/map-events';
import { livingIds } from '../combat';
import { DT } from '../constants';
import { rollEventRewardSpecs } from '../hooks';
import { spawnDrops } from '../loot';
import { DAMAGE_INDEX, TAU } from '../math';
import { isHeld } from '../rosters/pressure';
import { MFLAG } from '../stores';
import type { Area, World } from '../world';
import {
  beat, canOnset, dismissMember, eventArea, eventDamage, eventFixture, eventMonster, familyKind, finish, fixtureLife, hasRoom, markOnset, mods,
  nearestLivingDist, pickSite, placeAt, releaseMembers, skinOf,
} from './kit';
import type { EventInstance, EventKill, EventScript } from './types';

interface Pending { x: number; y: number; at: number }

interface BreachState {
  center: { x: number; y: number };
  /** The field the tide starts from. */
  field: number;
  /** Outer radius of every tide band (past the rim). */
  outer: number;
  /** Safe radius after each step, in the exact (quantised) units the band uses. */
  safe: number[];
  /** Area angle byte of each step's band (inner = outer * byte / 256). */
  bytes: number[];
  /** Seconds since the breach opened. */
  t: number;
  /** Steps fired so far (0 before the opening; the current safe level is step - 1). */
  step: number;
  pulseAt: number;
  heart: number;
  callers: Set<number>;
  callersSpawned: number;
  slain: number;
  pending: Pending[];
  warded: boolean;
  novaAt: number;
  nova: Area | null;
  tide: Area[];
  overflow: boolean;
  surgeAt: number;
  sealed: boolean;
  gone: boolean;
}

const state = (e: EventInstance) => e.s as BreachState;

/** Timer scale (Long Fuse) and grade ease (Quick Study) stretch every timed threshold, like the Fault. */
const scaleOf = (w: World) => (mods(w).timerScale ?? 1) * (1 + (mods(w).gradeEase ?? 0)) * BREACH_SKIN_PACE[skinOf(w)];
const strengthOf = (w: World) => 1 + Math.max(0, mods(w).voidStrength ?? 0) / 100;
const overflowAfter = (w: World) => BREACH_OVERFLOW_SECONDS * (mods(w).timerScale ?? 1);

export function breachGrade(seconds: number, bonus = 0, scale = 1, overflowed = false): MapEventGrade {
  if (overflowed) return 1;
  return seconds <= BREACH_GRADE_SECONDS[0] * scale + bonus ? 3 : seconds <= BREACH_GRADE_SECONDS[1] * scale + bonus ? 2 : 1;
}

function riderFor(w: World): 'burning' | 'chilled' | 'bleeding' {
  const skin = skinOf(w);
  return skin === 'ashen' ? 'burning' : skin === 'ossuary' ? 'chilled' : 'bleeding';
}

function reveal(w: World, e: EventInstance): boolean {
  const field = Math.min(w.arenaRadius - 40, BREACH_FIELD);
  const outer = w.arenaRadius + 60;
  const center = pickSite(w, e.plan.angle, { minPlayer: 90, rim: w.arenaRadius - 90, from: 0, to: 0.18 });
  const bytes: number[] = [], safe: number[] = [];
  for (const share of BREACH_SAFE) {
    // Round the band's inner edge UP to the next 1/256 of the outer radius: the ring the HUD shows is never inside the band.
    const byte = Math.min(255, Math.ceil(field * share / outer * 256));
    bytes.push(byte); safe.push(outer * byte / 256);
  }
  e.s = { center, field, outer, safe, bytes, t: 0, step: 0, pulseAt: 0, heart: -1, callers: new Set(), callersSpawned: 0, slain: 0, pending: [],
    warded: true, novaAt: 0, nova: null, tide: [], overflow: false, surgeAt: 0, sealed: false, gone: false } satisfies BreachState;
  e.phase = 'available';
  beat(w, e, 'omen', center.x, center.y);
  return true;
}

/** A point on the ring inside the current safe zone, at least BREACH_CLEARANCE from every player when one exists (else the farthest). */
function callerSite(w: World, e: EventInstance, s: BreachState, level: number): { x: number; y: number } {
  const rng = w.mapEvent!.rng;
  const a0 = rng.range(0, TAU);
  const r = s.safe[Math.max(0, Math.min(3, level))] * 0.88;
  let best = { x: s.center.x, y: s.center.y }, bestD = -1;
  for (let k = 0; k < 12; k++) {
    const a = a0 + k * TAU / 12;
    const p = placeAt(s.center.x + Math.cos(a) * r, s.center.y + Math.sin(a) * r, w.arenaRadius, w.props);
    const d = w.living.length === 0 ? 1e6 : nearestLivingDist(w, p.x, p.y);
    if (d >= BREACH_CLEARANCE) return p;
    if (d > bestD) { bestD = d; best = p; }
  }
  void e;
  return best;
}

function fireBand(w: World, e: EventInstance, level: number): void {
  const s = state(e);
  const a = eventArea(w, 'voidTide', s.center.x, s.center.y, s.outer, BREACH_TELEGRAPH, {
    angle: s.bytes[level] * TAU / 256, hurts: 'all', damage: eventDamage(w, BREACH_DAMAGE) * strengthOf(w),
    damageFrac: BREACH_MONSTER_FRAC, dtype: DAMAGE_INDEX.void, debuff: riderFor(w),
  });
  s.tide.push(a);
  s.pulseAt = s.t + (s.overflow ? BREACH_PULSE_OVERFLOW : BREACH_PULSE_SECONDS);
}

function fireStep(w: World, e: EventInstance): void {
  const s = state(e);
  const level = s.step;
  s.step++;
  fireBand(w, e, level);
  beat(w, e, 'tide', s.center.x, s.center.y, level);
  if (level >= 1 && level <= BREACH_CALLERS && s.callersSpawned + s.pending.length < BREACH_CALLERS) markCaller(w, e, level);
}

function markCaller(w: World, e: EventInstance, level: number): void {
  const s = state(e);
  const p = callerSite(w, e, s, level);
  eventArea(w, 'echoMark', p.x, p.y, 26, BREACH_CALLER_SHIMMER + 0.4);
  s.pending.push({ x: p.x, y: p.y, at: s.t + BREACH_CALLER_SHIMMER });
}

function spawnCaller(w: World, e: EventInstance, x: number, y: number): boolean {
  const s = state(e);
  const skin = skinOf(w);
  const proof = skin === 'ashen' ? ELITE_BIT.fireProof : skin === 'ossuary' ? ELITE_BIT.coldProof : ELITE_BIT.stout;
  const i = eventMonster(w, e, familyKind(w, 'artillery', 'hunter'), x, y, { rarity: 'rare', mods: ELITE_BIT.fierce | proof, shimmer: BREACH_CALLER_SHIMMER });
  if (i < 0) return false;
  s.callers.add(w.monsters.id[i]);
  s.callersSpawned++;
  return true;
}

function setWard(w: World, s: BreachState, on: boolean): void {
  const i = s.heart >= 0 ? w.monsters.slotOf(s.heart) : -1;
  if (i < 0) return;
  if (on) w.monsters.flags[i] |= MFLAG.immune | MFLAG.shielded;
  else w.monsters.flags[i] &= ~(MFLAG.immune | MFLAG.shielded);
}

function tick(w: World, e: EventInstance): void {
  const s = state(e);
  if (e.phase === 'available') {
    const near = w.living.some(p => Math.hypot(p.x - s.center.x, p.y - s.center.y) <= BREACH_REACH);
    if ((near || e.age >= BREACH_AUTO_OPEN) && canOnset(w)) {
      e.phase = 'warning';
      e.timer = MAP_EVENT_WARNING_SECONDS;
      markOnset(w);
      beat(w, e, 'onset', s.center.x, s.center.y);
    }
    return;
  }
  if (e.phase === 'warning') {
    e.timer -= DT;
    if (e.timer > 0 || !hasRoom(w, 1)) return;
    const i = eventFixture(w, e, s.center.x, s.center.y, BREACH_HEART_LIFE, BREACH_HEART_RADIUS);
    if (i < 0) return;
    s.heart = w.monsters.id[i];
    setWard(w, s, true);
    e.phase = 'active';
    s.t = 0;
    fireStep(w, e);
    return;
  }
  if (e.phase !== 'active') return;
  s.t += DT;
  const bossWave = w.config.waves.bossWave;
  if (bossWave > 0 && w.director.wave >= bossWave && !e.plan.required) {
    e.tally = Math.round(s.t);
    return end(w, e, 0);
  }
  s.tide = s.tide.filter(a => !a.dead);
  // The next step, and the pulses that keep the shrunk field shrunk.
  if (s.step < BREACH_SAFE.length && s.t >= s.step * BREACH_STEP_SECONDS) fireStep(w, e);
  else if (s.t >= s.pulseAt) fireBand(w, e, s.step - 1);
  if (!s.overflow && s.t >= overflowAfter(w)) { s.overflow = true; s.surgeAt = s.t; beat(w, e, 'arrive', s.center.x, s.center.y); }
  if (s.overflow && s.t >= s.surgeAt + BREACH_SURGE_SECONDS) surge(w, e);
  // Voidcallers appear a second after their ground mark.
  for (let k = s.pending.length - 1; k >= 0; k--) {
    const p = s.pending[k];
    if (s.t >= p.at && hasRoom(w, 1) && spawnCaller(w, e, p.x, p.y)) s.pending.splice(k, 1);
  }
  // With the ward down the Heart cannot be face-tanked: a telegraphed nova on whoever stands nearest it.
  if (s.nova && s.nova.dead) s.nova = null;
  if (!s.warded && !s.nova && s.t >= s.novaAt) {
    let target = null as (typeof w.living)[number] | null, bd = Infinity;
    for (const p of w.living) {
      if (isHeld(p)) continue;
      const d = Math.hypot(p.x - s.center.x, p.y - s.center.y);
      if (d < bd) { bd = d; target = p; }
    }
    if (target) {
      s.nova = eventArea(w, 'slamWarning', target.x, target.y, BREACH_NOVA_RADIUS, 1.8, {
        hurts: 'player', damage: eventDamage(w, BREACH_NOVA_DAMAGE) * strengthOf(w), dtype: DAMAGE_INDEX.void, debuff: null,
      });
      s.novaAt = s.t + BREACH_NOVA_SECONDS;
    }
  }
}

function surge(w: World, e: EventInstance): void {
  const s = state(e);
  s.surgeAt = s.t;
  if (!hasRoom(w, BREACH_SURGE_MONSTERS + 1)) return;
  const count = Math.max(1, Math.round(BREACH_SURGE_MONSTERS * (mods(w).monsterCount ?? 1)));
  const level = Math.max(0, s.step - 1);
  for (let k = 0; k < count; k++) {
    const p = callerSite(w, e, s, level);
    eventArea(w, 'echoMark', p.x, p.y, 24, 1.4);
    eventMonster(w, e, familyKind(w, 'hunter', 'fast'), p.x, p.y, { rarity: 'magic', mods: ELITE_BIT.swift, shimmer: 1 });
  }
  if (s.callers.size + s.pending.length < BREACH_CALLERS && s.slain >= BREACH_CALLERS) markCaller(w, e, level);
  beat(w, e, 'arrive', s.center.x, s.center.y);
}

function onKill(w: World, e: EventInstance, k: EventKill): void {
  const s = state(e);
  if (k.id === s.heart) {
    s.heart = -1;
    if (e.phase === 'active') { e.tally = Math.round(s.t); beat(w, e, 'crack', k.x, k.y); end(w, e, breachGrade(s.t, mods(w).timeBonus ?? 0, scaleOf(w), s.overflow)); }
    return;
  }
  if (!s.callers.delete(k.id)) return;
  s.slain++;
  if (s.warded && s.slain >= BREACH_CALLERS) {
    s.warded = false;
    setWard(w, s, false);
    s.novaAt = s.t + 3;
    beat(w, e, 'crack', s.center.x, s.center.y);
  }
}

/** Pay through a context that carries the keystone's strength (percent) in `choice`; grade 0 pays its small consolation too. */
function payBreach(w: World, e: EventInstance, grade: MapEventGrade, x: number, y: number): void {
  if (w.living.length === 0) return;
  const md = mods(w);
  const specs = rollEventRewardSpecs(w, {
    kind: e.kind, grade, choice: Math.round(md.voidStrength ?? 0), tally: e.tally, x, y, wave: Math.max(1, w.director.wave),
    ingredientBonus: md.ingredientChance ?? 0, multiplier: md.rewardMultiplier ?? 1,
  }, livingIds(w));
  if (specs.length > 0) spawnDrops(w, specs, x, y, true);
}

function cleanup(w: World, e: EventInstance): void {
  const s = state(e);
  if (s.gone) return;
  s.gone = true;
  for (const a of s.tide) a.dead = true;
  s.tide.length = 0;
  if (s.nova) s.nova.dead = true;
  if (s.heart >= 0) dismissMember(w, e, s.heart);
  s.heart = -1;
  releaseMembers(w, e);
}

function end(w: World, e: EventInstance, grade: MapEventGrade): void {
  const s = state(e);
  s.sealed = grade > 0;
  finish(w, e, grade, { pay: false, lost: grade === 0, x: s.center.x, y: s.center.y });
  payBreach(w, e, e.grade, s.center.x, s.center.y);
  cleanup(w, e);
}

function view(w: World, e: EventInstance): void {
  const s = state(e), v = e.view;
  v.x = s.center.x; v.y = s.center.y;
  v.objectives.length = 0; v.timers.length = 0; v.zones.length = 0; v.markers.length = 0;
  const bonus = mods(w).timeBonus ?? 0;
  v.zones.push({ kind: 'breach', x: s.center.x, y: s.center.y, r: s.field, a: 0, v: e.phase === 'available' ? 0 : e.phase === 'warning' ? 1 : e.phase === 'active' ? 2 : 3 });
  if (e.phase === 'available' || e.phase === 'warning') { v.hint = 0; v.grade = 0; return; }
  if (e.phase !== 'active') { v.hint = e.phase === 'complete' ? 5 : 6; v.grade = e.grade; return; }
  const level = Math.max(0, s.step - 1);
  v.zones.push({ kind: 'tide', x: s.center.x, y: s.center.y, r: s.safe[level], a: 0, v: level, n: 0 });
  if (level < BREACH_SAFE.length - 1) v.zones.push({ kind: 'tide', x: s.center.x, y: s.center.y, r: s.safe[level + 1], a: 0, v: level + 1, n: 1 });
  v.grade = breachGrade(s.t, bonus, scaleOf(w), s.overflow);
  v.objectives.push({ id: 0, cur: Math.min(BREACH_CALLERS, s.slain), max: BREACH_CALLERS });
  if (s.heart >= 0) v.objectives.push({ id: 1, cur: Math.round(fixtureLife(w, s.heart) * 100), max: 100 });
  const untilNext = s.step < BREACH_SAFE.length ? s.step * BREACH_STEP_SECONDS - s.t : s.pulseAt - s.t;
  v.timers.push({ id: 0, seconds: Math.max(0, untilNext), total: s.step < BREACH_SAFE.length ? BREACH_STEP_SECONDS : BREACH_PULSE_SECONDS });
  const gold = BREACH_GRADE_SECONDS[0] * scaleOf(w) + bonus;
  if (!s.overflow && s.t < gold) v.timers.push({ id: 1, seconds: Math.max(0, gold - s.t), total: gold });
  if (!s.overflow && s.t >= overflowAfter(w) - 25) v.timers.push({ id: 2, seconds: Math.max(0, overflowAfter(w) - s.t), total: overflowAfter(w) });
  const hi = s.heart >= 0 ? w.monsters.slotOf(s.heart) : -1;
  if (hi >= 0) v.markers.push({ icon: 'heart', x: w.monsters.x[hi], y: w.monsters.y[hi], v: s.warded ? 1 : 0, w: Math.round(fixtureLife(w, s.heart) * 100) });
  for (const id of s.callers) {
    const j = w.monsters.slotOf(id);
    if (j >= 0) v.markers.push({ icon: 'guardian', x: w.monsters.x[j], y: w.monsters.y[j], v: 2 });
  }
  v.hint = s.overflow ? 4 : !s.warded ? 3 : s.callers.size > 0 || s.slain > 0 || s.step > 1 ? 2 : 1;
}

function cancel(w: World, e: EventInstance): void {
  cleanup(w, e);
}

export const breachScript: EventScript = { kind: 'voidBreach', reveal, tick, onKill, view, cancel };
