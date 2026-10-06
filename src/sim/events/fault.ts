// THE FAULT (event id 'wound'). The floor is splitting. A field of four numbered wedges spawns guardians on the cracks between
// them and, each pulse, marks one wedge to erupt: everything inside takes damage (players a hit, monsters a share of their life).
// The party lures the guardians into the marked wedge and steps out. Sealing sooner pays more. docs/atlas-rework/C-map-events.md 6.4.
import type { MonsterKind } from '../../contracts/content';
import type { MapEventGrade } from '../../contracts/map-events';
import { ELITE_BIT } from '../../contracts/sim';
import {
  FAULT_CLEARANCE, FAULT_CRUST_SECONDS, FAULT_DAMAGE, FAULT_ERUPT_TELEGRAPH, FAULT_GRADE_SECONDS, FAULT_GUARDIANS, FAULT_HOT_DELAY,
  FAULT_MONSTER_FRAC, FAULT_OVERFLOW_INTERVAL, FAULT_OVERFLOW_MONSTERS, FAULT_OVERFLOW_SECONDS, FAULT_PULSES, FAULT_PULSE_SECONDS,
  FAULT_RADIUS, FAULT_REACH, MAP_EVENT_WARNING_SECONDS,
} from '../../data/progression/map-events';
import { spawnArea } from '../areas';
import { DT } from '../constants';
import { registerAreaEffect } from '../effects';
import { DAMAGE_INDEX, TAU } from '../math';
import { monsterDef } from '../rosters';
import { isHeld } from '../rosters/pressure';
import type { Area, World } from '../world';
import type { RosterSkin } from './kit';
import {
  anchorSite, beat, canOnset, eventArea, eventDamage, eventMonster, familyKind, finish, hasRoom, markOnset, mods, nearestLivingDist, pickSite, skinOf,
  placeAt } from './kit';
import type { EventInstance, EventKill, EventScript } from './types';

interface FaultState {
  center: { x: number; y: number };
  base: number;
  /** Seconds since the field opened. */
  t: number;
  pulses: number;
  nextPulseAt: number;
  marked: boolean;
  guardians: Set<number>;
  bornId: number;
  /** Planned hot wedges, next first (the HUD shows the first two). */
  queue: number[];
  /** Seconds until the next eruption telegraph starts (-1 = none pending). */
  hotIn: number;
  hotArea: Area | null;
  hotWedge: number;
  overflowAt: number;
  sealed: boolean;
}

const state = (e: EventInstance) => e.s as FaultState;

/** Centre heading of wedge `k` (wedges are numbered I to IV from the base angle). */
export const wedgeAngle = (base: number, k: number) => base + Math.PI / 4 + k * Math.PI / 2;

function riderFor(w: World): 'burning' | 'chilled' | 'bleeding' {
  const skin = skinOf(w);
  return skin === 'ashen' ? 'burning' : skin === 'ossuary' ? 'chilled' : 'bleeding';
}

/** What an eruption leaves behind: cinders (ashen), rime (ossuary) or nothing but the wound (coliseum spikes). */
const ERUPTION = registerAreaEffect({
  onResolve(w: World, a: Area): void {
    const skin = skinOf(w);
    const cx = a.x + Math.cos(a.angle) * 130, cy = a.y + Math.sin(a.angle) * 130;
    w.events.push({ t: 'areaResolve', kind: 'faultWedge', x: cx, y: cy, radius: 60 });
    if (skin === 'ashen') {
      spawnArea(w, 'firePool', cx, cy, 60, FAULT_CRUST_SECONDS, {
        damage: a.damage * 0.25, dtype: DAMAGE_INDEX.fire, hurts: 'player', tickInterval: 0.5, firstTick: 1.0,
      });
    } else if (skin === 'ossuary') {
      // Rime: monsters chilled in the wedge are slowed, and the crust chills anyone who lingers.
      const m = w.monsters;
      const reach = a.radius + w.grid.maxRadius;
      const out = w.scratch2;
      const n = w.grid.query(a.x - reach, a.y - reach, a.x + reach, a.y + reach, out);
      for (let k = 0; k < n; k++) {
        const i = out[k];
        if (Math.hypot(m.x[i] - cx, m.y[i] - cy) <= 150) m.chillTime[i] = Math.max(m.chillTime[i], 3);
      }
      spawnArea(w, 'blizzard', cx, cy, 55, FAULT_CRUST_SECONDS, {
        damage: a.damage * 0.15, dtype: DAMAGE_INDEX.cold, hurts: 'player', tickInterval: 0.5, firstTick: 1.0,
      });
    }
  },
});

/** Seal time for Gold / Silver by roster (a Coliseum arena is tighter and its guardians sturdier: its bar is lower). */
export function faultSeconds(skin: RosterSkin): readonly [number, number] {
  return FAULT_GRADE_SECONDS[skin];
}

export function faultGrade(seconds: number, bonus = 0, scale = 1, skin: RosterSkin = 'ashen'): MapEventGrade {
  const [gold, silver] = faultSeconds(skin);
  return seconds <= gold * scale + bonus ? 3 : seconds <= silver * scale + bonus ? 2 : 1;
}

const overflowAfter = (w: World) => FAULT_OVERFLOW_SECONDS * (mods(w).timerScale ?? 1);

/** Timer scale (Long Fuse) and grade ease (Quick Study) stretch every timed threshold. */
const faultScale = (w: World) => (mods(w).timerScale ?? 1) * (1 + (mods(w).gradeEase ?? 0));

function reveal(w: World, e: EventInstance): boolean {
  // A layout's fault (E1): the field sits on the authored line and its first crack runs along it (wedge boundaries are base + k x 90
  // degrees). The whole field must fit inside the arena, as with the radial rule.
  const rule = { minPlayer: FAULT_CLEARANCE, rim: FAULT_RADIUS + 20 };
  const at = anchorSite(w, e, 'fault', rule);
  const line = at?.anchor.path;
  const base = line && line.length >= 2 ? Math.atan2(line[line.length - 1].y - line[0].y, line[line.length - 1].x - line[0].x) : e.plan.angle;
  const site = at ?? pickSite(w, e.plan.angle, { ...rule, from: 0.05, to: 0.9 });
  const center = { x: site.x, y: site.y };
  e.s = { center, base, t: 0, pulses: 0, nextPulseAt: 1, marked: false, guardians: new Set(), bornId: 0, queue: [], hotIn: -1,
    hotArea: null, hotWedge: -1, overflowAt: 0, sealed: false } satisfies FaultState;
  e.phase = 'available';
  beat(w, e, 'omen', center.x, center.y);
  return true;
}

function wedgeOf(s: FaultState, x: number, y: number): number {
  let rel = (Math.atan2(y - s.center.y, x - s.center.x) - s.base) % TAU;
  if (rel < 0) rel += TAU;
  return Math.min(3, Math.floor(rel / (Math.PI / 2)));
}

/** Monsters and players per wedge (the lure needs someone to lure). */
function occupancy(w: World, s: FaultState): number[] {
  const occ = [0, 0, 0, 0];
  const m = w.monsters;
  for (let i = 0; i < m.hwm; i++) {
    if (!m.alive[i] || Math.hypot(m.x[i] - s.center.x, m.y[i] - s.center.y) > FAULT_RADIUS) continue;
    occ[wedgeOf(s, m.x[i], m.y[i])]++;
  }
  for (const p of w.living) if (Math.hypot(p.x - s.center.x, p.y - s.center.y) <= FAULT_RADIUS) occ[wedgeOf(s, p.x, p.y)]++;
  return occ;
}

/** Keep two hot wedges planned: the most occupied ones not already queued (ties: lowest wedge). */
function plan(w: World, s: FaultState): void {
  while (s.queue.length < 2) {
    const occ = occupancy(w, s);
    let best = -1;
    for (let k = 0; k < 4; k++) if (!s.queue.includes(k) && k !== s.hotWedge && (best < 0 || occ[k] > occ[best])) best = k;
    if (best < 0) best = (s.queue.length + 1) % 4;
    s.queue.push(best);
  }
}

/** Guardians are Swift and stream into the wedges: never a shield-bearer (its guard would turn the lure into a wall). */
function guardianKind(w: World, k: number): MonsterKind {
  const open = w.roster.family.filter(f => !monsterDef(f).block);
  const family = open.length > 0 ? open : w.roster.family;
  return family[k % family.length];
}

function crackPoints(w: World, s: FaultState, count: number, offset: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let k = 0; k < count; k++) {
    const ray = s.base + ((k + offset) % 4) * Math.PI / 2;
    const r = k % 2 === 0 ? 85 : 170;
    let p = placeAt(s.center.x + Math.cos(ray) * r, s.center.y + Math.sin(ray) * r, w.arenaRadius, w.props);
    // Not on top of a player: the far ring of the same crack when they stand at the near one.
    if (nearestLivingDist(w, p.x, p.y) < 60) p = placeAt(s.center.x + Math.cos(ray) * (r + 60), s.center.y + Math.sin(ray) * (r + 60), w.arenaRadius, w.props);
    out.push(p);
  }
  return out;
}

function spawnPulse(w: World, e: EventInstance, count: number, withBorn: boolean): boolean {
  const s = state(e);
  if (!hasRoom(w, count)) return false;
  const skin = skinOf(w);
  const points = crackPoints(w, s, count, s.pulses);
  for (let k = 0; k < count; k++) {
    const born = withBorn && k === 0;
    const proof = skin === 'ashen' ? ELITE_BIT.fireProof : skin === 'ossuary' ? ELITE_BIT.coldProof : ELITE_BIT.stout;
    const i = eventMonster(w, e, guardianKind(w, k + s.pulses), points[k].x, points[k].y, born
      ? { rarity: 'rare', mods: ELITE_BIT.fierce | proof }
      : { rarity: 'magic', mods: ELITE_BIT.swift });
    if (i < 0) continue;
    const id = w.monsters.id[i];
    s.guardians.add(id);
    if (born) s.bornId = id;
  }
  return true;
}

function count(w: World, base: number): number {
  return Math.max(1, Math.round(base * (mods(w).monsterCount ?? 1)));
}

function startEruption(w: World, e: EventInstance): void {
  const s = state(e);
  if (w.living.some(isHeld)) { s.hotIn = 0.25; return; } // never begin on a held player
  plan(w, s);
  const wedge = s.queue.shift()!;
  s.hotWedge = wedge;
  s.hotArea = eventArea(w, 'faultWedge', s.center.x, s.center.y, FAULT_RADIUS, FAULT_ERUPT_TELEGRAPH, {
    angle: wedgeAngle(s.base, wedge), hurts: 'all', damage: eventDamage(w, FAULT_DAMAGE), damageFrac: FAULT_MONSTER_FRAC * (mods(w).faultMonsterDamage ?? 1),
    dtype: skinOf(w) === 'ashen' ? DAMAGE_INDEX.fire : skinOf(w) === 'ossuary' ? DAMAGE_INDEX.cold : DAMAGE_INDEX.physical,
    debuff: riderFor(w), effect: ERUPTION,
  });
  plan(w, s);
  s.hotIn = -1;
  beat(w, e, 'pulse', s.center.x + Math.cos(wedgeAngle(s.base, wedge)) * 130, s.center.y + Math.sin(wedgeAngle(s.base, wedge)) * 130, wedge);
}

function tick(w: World, e: EventInstance): void {
  const s = state(e);
  if (e.phase === 'available') {
    if (!canOnset(w)) return;
    if (!w.living.some(p => Math.hypot(p.x - s.center.x, p.y - s.center.y) <= FAULT_REACH)) return;
    e.phase = 'warning';
    e.timer = MAP_EVENT_WARNING_SECONDS;
    markOnset(w);
    beat(w, e, 'onset', s.center.x, s.center.y);
    return;
  }
  if (e.phase === 'warning') {
    e.timer -= DT;
    if (e.timer <= 0) { e.phase = 'active'; plan(w, s); }
    return;
  }
  if (e.phase !== 'active') return;
  s.t += DT;
  const bossWave = w.config.waves.bossWave;
  if (bossWave > 0 && w.director.wave >= bossWave && !e.plan.required) {
    e.tally = Math.round(s.t);
    finish(w, e, 0, { pay: true, lost: true, x: s.center.x, y: s.center.y });
    return;
  }
  if (s.hotArea && s.hotArea.dead) s.hotArea = null;
  if (s.hotIn >= 0) { s.hotIn -= DT; if (s.hotIn <= 0) startEruption(w, e); }
  // Pulses: a second's warning on the cracks, then the guardians. The next one comes sooner when the field is clear.
  if (s.pulses < FAULT_PULSES) {
    if (s.guardians.size === 0 && s.marked === false && s.nextPulseAt - s.t > 2.5 && s.pulses > 0) s.nextPulseAt = s.t + 2.5;
    if (!s.marked && s.t >= s.nextPulseAt - 1) {
      s.marked = true;
      for (const p of crackPoints(w, s, count(w, FAULT_GUARDIANS), s.pulses)) eventArea(w, 'echoMark', p.x, p.y, 24, 1.4);
    }
    if (s.marked && s.t >= s.nextPulseAt && spawnPulse(w, e, count(w, FAULT_GUARDIANS), s.pulses === FAULT_PULSES - 1)) {
      s.pulses++;
      s.marked = false;
      s.nextPulseAt = s.t + FAULT_PULSE_SECONDS;
      s.hotIn = FAULT_HOT_DELAY;
      beat(w, e, 'step', s.center.x, s.center.y, s.pulses);
    }
  } else if (s.t >= overflowAfter(w) && s.guardians.size > 0) {
    // Overflow: the field keeps erupting and adding monsters until it is cleared (Bronze at best).
    if (s.overflowAt === 0) s.overflowAt = s.t;
    if (s.t - s.overflowAt >= FAULT_OVERFLOW_INTERVAL) {
      s.overflowAt = s.t;
      if (hasRoom(w, FAULT_OVERFLOW_MONSTERS)) spawnPulse(w, e, count(w, FAULT_OVERFLOW_MONSTERS), false);
      if (s.hotIn < 0 && !s.hotArea) s.hotIn = FAULT_HOT_DELAY;
    }
  }
  if (s.pulses >= FAULT_PULSES && s.guardians.size === 0 && !s.sealed) {
    s.sealed = true;
    e.tally = Math.round(s.t);
    beat(w, e, 'seal', s.center.x, s.center.y, e.tally);
    finish(w, e, faultGrade(s.t, mods(w).timeBonus ?? 0, faultScale(w), skinOf(w)), { x: s.center.x, y: s.center.y });
  }
}

function onKill(w: World, e: EventInstance, k: EventKill): void {
  const s = state(e);
  s.guardians.delete(k.id);
  if (k.id === s.bornId) s.bornId = 0;
}

function view(w: World, e: EventInstance): void {
  const s = state(e), v = e.view;
  v.x = s.center.x; v.y = s.center.y;
  v.objectives.length = 0; v.timers.length = 0; v.zones.length = 0; v.markers.length = 0;
  if (e.phase === 'available' || e.phase === 'warning') {
    v.zones.push({ kind: 'crack', x: s.center.x, y: s.center.y, r: 48, a: s.base, v: 0 });
    v.hint = 0; v.grade = 0;
    return;
  }
  v.zones.push({ kind: 'field', x: s.center.x, y: s.center.y, r: FAULT_RADIUS, a: s.base, v: e.phase === 'active' ? 1 : 0 });
  const bonus = mods(w).timeBonus ?? 0;
  v.grade = e.phase === 'active' ? faultGrade(s.t, bonus, faultScale(w), skinOf(w)) : e.grade;
  if (e.phase !== 'active') { v.hint = e.phase === 'complete' ? 1 : 3; return; }
  s.queue.slice(0, mods(w).faultPreview ?? 2).forEach((wedge, k) => v.zones.push({ kind: 'wedgePlan', x: s.center.x, y: s.center.y, r: FAULT_RADIUS, a: wedgeAngle(s.base, wedge), v: k + 1 }));
  v.objectives.push({ id: 0, cur: Math.min(s.pulses, FAULT_PULSES), max: FAULT_PULSES }, { id: 1, cur: s.guardians.size, max: Math.max(1, s.guardians.size) });
  v.timers.push({ id: 0, seconds: Math.max(0, faultSeconds(skinOf(w))[0] * faultScale(w) + bonus - s.t), total: faultSeconds(skinOf(w))[0] * faultScale(w) + bonus });
  if (s.t >= overflowAfter(w) - 15) v.timers.push({ id: 1, seconds: Math.max(0, overflowAfter(w) - s.t), total: overflowAfter(w) });
  const j = s.bornId ? w.monsters.slotOf(s.bornId) : -1;
  if (j >= 0) v.markers.push({ icon: 'guardian', x: w.monsters.x[j], y: w.monsters.y[j], v: 1 });
  v.hint = s.t >= overflowAfter(w) ? 3 : s.hotArea ? 1 : 2;
}

function cancel(w: World, e: EventInstance): void {
  const s = state(e);
  if (s.hotArea) s.hotArea.dead = true;
}

export const faultScript: EventScript = { kind: 'wound', reveal, tick, onKill, view, cancel };
