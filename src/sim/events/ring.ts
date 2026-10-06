// CHAMPION'S RING (event id 'ring'). An altar offers three vows on dwell stones (Bare Hands, Iron Pride, Crowd's Favour); the
// vow taken, a chain wall (radius 160) rises and keeps the horde OUT while one Champion fights inside with two telegraphed
// moves (a lane charge and a slam). Players may leave the ring (forfeiting the vow's reward multiplier only). Kill time grades it;
// at 60 s the ring closes and the Champion joins the horde. docs/atlas-rework/C-map-events.md 7.4.
import type { MonsterKind } from '../../contracts/content';
import type { MapEventGrade } from '../../contracts/map-events';
import { ELITE_BIT, MONSTER_ANIM as ANIM } from '../../contracts/sim';
import {
  MAP_EVENT_WARNING_SECONDS,
} from '../../data/progression/map-events';
import {
  RING_CHAMPION_CLEARANCE, RING_CHAMPION_LIFE, RING_GRADE_SECONDS, RING_IRON_LIFE, RING_LANE_DAMAGE, RING_LANE_DASH, RING_LANE_LENGTH,
  RING_LANE_SECONDS, RING_LEAVE_SECONDS, RING_MOVE_SECONDS, RING_RADIUS, RING_RISE_SECONDS, RING_SITE_CLEARANCE, RING_SLAM_DAMAGE,
  RING_SLAM_RADIUS, RING_SKIN_LIFE, RING_SLAM_SECONDS, RING_SPIKE_DAMAGE, RING_SPIKE_RADIUS, RING_SPIKE_SECONDS, RING_SPIKE_TELEGRAPH,
  RING_STONE_RADIUS, RING_STONE_SPACING, RING_TIMEOUT, RING_VOW_SECONDS,
} from '../../data/progression/events/ring';
import { setAnim, stop } from '../behaviour';
import { DT } from '../constants';
import { DAMAGE_INDEX } from '../math';
import { isHeld } from '../rosters/pressure';
import { monsterDef } from '../rosters';
import { MFLAG } from '../stores';
import type { Area, PlayerState, World } from '../world';
import {
  anchorSite, beat, canOnset, eventArea, eventDamage, eventMonster, finish, hasRoom, makeStone, markOnset, mods, nearestLivingDist,
  pickSite, placeAt, releaseMembers, ringPoints, skinOf, stoneZones, tickStones, type Stone,
} from './kit';
import type { EventInstance, EventKill, EventScript } from './types';

interface Move {
  kind: 'lane' | 'slam';
  t: number;
  x: number;
  y: number;
  /** Lane: unit direction and length. */
  ux: number;
  uy: number;
  len: number;
  area: Area;
}

interface RingState {
  center: { x: number; y: number };
  stones: Stone[];
  /** Vow index, -1 until chosen. */
  vow: number;
  champion: number;
  /** Seconds since the chains stood. */
  t: number;
  /** Seconds until the champion's next move. */
  next: number;
  nextKind: 'lane' | 'slam';
  move: Move | null;
  /** Seconds each player has spent outside the ring. */
  outside: Map<number, number>;
  left: boolean;
  spikeAt: number;
  hint: number;
}

const state = (e: EventInstance) => e.s as RingState;

/** Timer scale (Long Fuse) and grade ease (Quick Study, Ringmaster) stretch the thresholds and the closing time. */
const scaleOf = (w: World) => (mods(w).timerScale ?? 1) * (1 + (mods(w).gradeEase ?? 0));

export function ringGrade(seconds: number, scale = 1): MapEventGrade {
  return seconds <= RING_GRADE_SECONDS[0] * scale ? 3 : seconds <= RING_GRADE_SECONDS[1] * scale ? 2 : 1;
}

const timeout = (w: World) => RING_TIMEOUT * (mods(w).timerScale ?? 1);

function rider(w: World): { debuff: 'burning' | 'chilled' | 'bleeding'; dtype: number } {
  const skin = skinOf(w);
  return skin === 'ashen' ? { debuff: 'burning', dtype: DAMAGE_INDEX.fire } : skin === 'ossuary' ? { debuff: 'chilled', dtype: DAMAGE_INDEX.cold }
    : { debuff: 'bleeding', dtype: DAMAGE_INDEX.physical };
}

/**
 * The Champion's life multiplier: RING_CHAMPION_LIFE times the roster's average family member in EFFECTIVE life (armour counted),
 * so the duel takes about as long on every roster whatever bruiser it fields.
 */
function championLife(w: World, kind: MonsterKind): number {
  const eff = (k: MonsterKind) => { const d = monsterDef(k); return d.life / Math.max(0.2, 1 - (d.hitReduction ?? 0)); };
  const family = w.roster.family;
  const avg = family.reduce((sum, k) => sum + eff(k), 0) / family.length;
  return RING_CHAMPION_LIFE * RING_SKIN_LIFE[skinOf(w)] * avg / eff(kind);
}

/** The Champion's body: a bruiser of the roster that does not block shots (a shield would turn the duel into a wall). */
function championKind(w: World): MonsterKind {
  const open = w.roster.family.filter(k => !monsterDef(k).block);
  const pool = open.length > 0 ? open : w.roster.family;
  return pool.find(k => monsterDef(k).role === 'bruiser') ?? pool.find(k => monsterDef(k).role === 'hunter') ?? pool[0];
}

function reveal(w: World, e: EventInstance): boolean {
  const rule = { minPlayer: RING_SITE_CLEARANCE, rim: RING_RADIUS + 30 };
  const at = anchorSite(w, e, 'ring', rule) ?? pickSite(w, e.plan.angle, { ...rule, from: 0.1, to: 0.85 });
  const center = { x: at.x, y: at.y };
  const stones = ringPoints(w, center.x, center.y, RING_STONE_SPACING, 3, e.plan.angle).map((p, k) => makeStone(p.x, p.y, RING_STONE_RADIUS, k));
  e.s = { center, stones, vow: -1, champion: 0, t: 0, next: 2.5, nextKind: 'lane', move: null, outside: new Map(), left: false, spikeAt: 3, hint: 0 } satisfies RingState;
  e.phase = 'available';
  beat(w, e, 'omen', center.x, center.y);
  return true;
}

function championSite(w: World, s: RingState, angle: number): { x: number; y: number } {
  let best = s.center, bestD = -1;
  for (let k = 0; k < 8; k++) {
    const a = angle + Math.PI + k * Math.PI / 4;
    const p = placeAt(s.center.x + Math.cos(a) * 90, s.center.y + Math.sin(a) * 90, w.arenaRadius, w.props);
    const d = nearestLivingDist(w, p.x, p.y);
    if (d >= RING_CHAMPION_CLEARANCE) return p;
    if (d > bestD) { bestD = d; best = p; }
  }
  return best;
}

function clearFlags(w: World): void {
  for (const p of w.players) p.noFlasks = false;
}

function tick(w: World, e: EventInstance): void {
  const s = state(e);
  if (e.phase === 'available') {
    if (!canOnset(w)) return;
    const pick = tickStones(w, s.stones, RING_VOW_SECONDS);
    if (pick < 0) return;
    s.vow = pick;
    e.phase = 'warning';
    e.timer = Math.max(RING_RISE_SECONDS, MAP_EVENT_WARNING_SECONDS);
    markOnset(w);
    beat(w, e, 'pick', s.center.x, s.center.y, pick);
    return;
  }
  if (e.phase === 'warning') {
    e.timer -= DT;
    if (e.timer > 0 || !hasRoom(w, 1)) return;
    const site = championSite(w, s, e.plan.angle);
    const kind = championKind(w);
    const i = eventMonster(w, e, kind, site.x, site.y, { rarity: 'rare', mods: ELITE_BIT.fierce, shimmer: 1 });
    if (i < 0) return;
    const m = w.monsters;
    m.maxLife[i] *= championLife(w, kind) * (mods(w).championLife ?? 1) * (s.vow === 1 ? RING_IRON_LIFE : 1);
    m.life[i] = m.maxLife[i];
    s.champion = m.id[i];
    e.phase = 'active';
    beat(w, e, 'onset', s.center.x, s.center.y);
    beat(w, e, 'crack', s.center.x, s.center.y, 1);
    return;
  }
  if (e.phase !== 'active') return;
  const bossWave = w.config.waves.bossWave;
  if (bossWave > 0 && w.director.wave >= bossWave && !e.plan.required) return lose(w, e);
  s.t += DT;
  if (s.t >= timeout(w)) return lose(w, e);
  const m = w.monsters;
  const R = RING_RADIUS;
  // The chain wall: the horde is pushed back out (never a player, never the champion, who is kept in).
  for (let i = 0; i < m.hwm; i++) {
    if (!m.alive[i] || (m.flags[i] & (MFLAG.frozen | MFLAG.fixture))) continue;
    const dx = m.x[i] - s.center.x, dy = m.y[i] - s.center.y;
    const d = Math.hypot(dx, dy);
    const isChampion = m.id[i] === s.champion;
    if (isChampion) {
      if (d > R - 14) { const u = (R - 14) / d; m.x[i] = s.center.x + dx * u; m.y[i] = s.center.y + dy * u; }
    } else if (d < R - 4 && d > 0.001 && !w.mapEvent!.members.has(m.id[i])) {
      const u = R / d;
      m.x[i] = m.prevX[i] = s.center.x + dx * u;
      m.y[i] = m.prevY[i] = s.center.y + dy * u;
    }
  }
  // Iron Pride: nothing ranged gets in.
  if (s.vow === 1) {
    const pr = w.projectiles;
    for (let i = 0; i < pr.hwm; i++) {
      if (!pr.alive[i] || !pr.hostile[i]) continue;
      if (Math.hypot(pr.x[i] - s.center.x, pr.y[i] - s.center.y) < R) pr.release(i);
    }
  }
  // Players: who has left, and Bare Hands (no flasks inside).
  for (const p of w.players) {
    const inside = !p.dead && Math.hypot(p.x - s.center.x, p.y - s.center.y) <= R;
    p.noFlasks = s.vow === 0 && inside;
    if (p.dead) continue;
    const out = inside ? 0 : (s.outside.get(p.id) ?? 0) + DT;
    s.outside.set(p.id, out);
    if (out >= RING_LEAVE_SECONDS) s.left = true;
  }
  // Crowd's Favour: spikes over a spot of the ring.
  if (s.vow === 2 && s.t >= s.spikeAt) {
    s.spikeAt = s.t + RING_SPIKE_SECONDS;
    const a = w.mapEvent!.rng.range(0, Math.PI * 2), r = Math.sqrt(w.mapEvent!.rng.next()) * (R - 50);
    const { debuff } = rider(w);
    eventArea(w, 'arenaSpikes', s.center.x + Math.cos(a) * r, s.center.y + Math.sin(a) * r, RING_SPIKE_RADIUS, RING_SPIKE_TELEGRAPH, {
      damage: eventDamage(w, RING_SPIKE_DAMAGE), dtype: DAMAGE_INDEX.physical, hurts: 'player', debuff: debuff === 'bleeding' ? 'bleeding' : debuff,
    });
  }
  if (m.slotOf(s.champion) < 0) return lose(w, e);
}

function startMove(w: World, e: EventInstance, i: number): boolean {
  const s = state(e), m = w.monsters;
  let target: PlayerState | null = null, bestD = Infinity;
  for (const p of w.living) {
    if (Math.hypot(p.x - s.center.x, p.y - s.center.y) > RING_RADIUS + 40) continue;
    const d = Math.hypot(p.x - m.x[i], p.y - m.y[i]);
    if (d < bestD) { bestD = d; target = p; }
  }
  if (!target) return false;
  // Never begin on a held player.
  if (isHeld(target)) return false;
  const { debuff, dtype } = rider(w);
  stop(w, i);
  const x = m.x[i], y = m.y[i];
  if (s.nextKind === 'lane') {
    const dx = target.x - x, dy = target.y - y, l = Math.hypot(dx, dy) || 1;
    const ux = dx / l, uy = dy / l;
    // The lane ends at the wall.
    const fx = x - s.center.x, fy = y - s.center.y;
    const b = fx * ux + fy * uy, c = fx * fx + fy * fy - (RING_RADIUS - 14) ** 2;
    const exit = -b + Math.sqrt(Math.max(0, b * b - c));
    const len = Math.max(60, Math.min(RING_LANE_LENGTH, exit));
    const area = eventArea(w, 'chargeLine', x, y, len, RING_LANE_SECONDS, {
      angle: Math.atan2(uy, ux), variant: 1, damage: eventDamage(w, RING_LANE_DAMAGE), dtype, hurts: 'player', debuff, owner: m.id[i],
    });
    s.move = { kind: 'lane', t: 0, x, y, ux, uy, len, area };
    s.hint = 2;
  } else {
    const area = eventArea(w, 'slamWarning', x, y, RING_SLAM_RADIUS, RING_SLAM_SECONDS, {
      damage: eventDamage(w, RING_SLAM_DAMAGE), dtype: DAMAGE_INDEX.physical, hurts: 'player', debuff: null, owner: m.id[i],
    });
    s.move = { kind: 'slam', t: 0, x, y, ux: 0, uy: 0, len: 0, area };
    s.hint = 3;
  }
  setAnim(w, i, ANIM.windup);
  beat(w, e, 'lock', x, y, s.nextKind === 'lane' ? 0 : 1);
  return true;
}

function drive(w: World, e: EventInstance, i: number): boolean {
  const s = state(e), m = w.monsters;
  if (m.id[i] !== s.champion || e.phase !== 'active') return false;
  const mv = s.move;
  if (mv) {
    mv.t += DT;
    stop(w, i);
    if (mv.kind === 'lane' && mv.t >= RING_LANE_SECONDS - RING_LANE_DASH) {
      const u = Math.min(1, (mv.t - (RING_LANE_SECONDS - RING_LANE_DASH)) / RING_LANE_DASH);
      m.x[i] = mv.x + mv.ux * mv.len * u; m.y[i] = mv.y + mv.uy * mv.len * u;
      m.facing[i] = mv.ux >= 0 ? 1 : -1;
    }
    const dur = mv.kind === 'lane' ? RING_LANE_SECONDS : RING_SLAM_SECONDS;
    if (mv.t >= dur) {
      s.move = null;
      s.next = RING_MOVE_SECONDS;
      s.nextKind = mv.kind === 'lane' ? 'slam' : 'lane';
      s.hint = s.left ? 4 : 1;
      setAnim(w, i, ANIM.idle);
    }
    return true;
  }
  s.next -= DT;
  if (s.next > 0) return false;
  if (!startMove(w, e, i)) { s.next = 0.25; return false; }
  return true;
}

function cleanup(w: World, e: EventInstance): void {
  const s = state(e);
  clearFlags(w);
  if (s.move) s.move.area.dead = true;
  s.move = null;
}

function lose(w: World, e: EventInstance): void {
  const s = state(e);
  cleanup(w, e);
  releaseMembers(w, e);
  e.tally = Math.round(s.t);
  beat(w, e, 'crack', s.center.x, s.center.y, 0);
  finish(w, e, 0, { pay: false, lost: true, x: s.center.x, y: s.center.y });
}

function onKill(w: World, e: EventInstance, k: EventKill): void {
  const s = state(e);
  if (k.id !== s.champion || e.phase !== 'active') return;
  if (!k.credited) return lose(w, e);
  cleanup(w, e);
  e.tally = Math.round(s.t);
  finish(w, e, ringGrade(s.t, scaleOf(w)), { choice: s.left ? 3 : s.vow, x: k.x, y: k.y });
}

function view(w: World, e: EventInstance): void {
  const s = state(e), v = e.view;
  v.x = s.center.x; v.y = s.center.y;
  v.objectives.length = 0; v.timers.length = 0; v.zones.length = 0; v.markers.length = 0;
  v.zones.push({ kind: 'altar', x: s.center.x, y: s.center.y, r: 26, a: 0, v: 0, n: Math.max(0, s.vow) });
  if (e.phase === 'available' || e.phase === 'warning') {
    stoneZones(s.stones, RING_VOW_SECONDS, v.zones);
    v.zones.push({ kind: 'arena', x: s.center.x, y: s.center.y, r: RING_RADIUS, a: 0, v: e.phase === 'warning' ? 2 : 0, n: Math.max(0, s.vow) });
    v.hint = 0; v.grade = 0;
    return;
  }
  if (e.phase !== 'active') { v.grade = e.grade; v.hint = 1; return; }
  const sc = scaleOf(w);
  v.zones.push({ kind: 'arena', x: s.center.x, y: s.center.y, r: RING_RADIUS, a: 0, v: 1, n: s.vow });
  v.grade = ringGrade(s.t, sc);
  const j = w.monsters.slotOf(s.champion);
  if (j >= 0) {
    const pct = Math.round(Math.max(0, w.monsters.life[j]) / Math.max(1, w.monsters.maxLife[j]) * 100);
    v.objectives.push({ id: 0, cur: pct, max: 100 });
    v.markers.push({ icon: 'champion', x: w.monsters.x[j], y: w.monsters.y[j], v: s.vow, w: pct });
    v.x = w.monsters.x[j]; v.y = w.monsters.y[j];
  }
  v.timers.push({ id: 0, seconds: Math.max(0, RING_GRADE_SECONDS[0] * sc - s.t), total: RING_GRADE_SECONDS[0] * sc });
  v.timers.push({ id: 1, seconds: Math.max(0, timeout(w) - s.t), total: timeout(w) });
  v.hint = s.move ? (s.move.kind === 'lane' ? 2 : 3) : s.left ? 4 : timeout(w) - s.t < 8 ? 5 : 1;
}

function cancel(w: World, e: EventInstance): void {
  cleanup(w, e);
  // The champion (if any) goes back to being an ordinary monster: the director clears the membership.
}

export const ringScript: EventScript = { kind: 'ring', reveal, tick, drive, onKill, view, cancel };
