// THE ECHOING (event id 'echoRift'). The rift replays what the party killed: every notable kill returns as an Echo at
// the spot it died and walks home to the anchor. Echoes that arrive add Resonance; six of them make the rift erupt.
// The party's own clear speed sets the difficulty. docs/atlas-rework/C-map-events.md 6.2.
import type { MonsterKind } from '../../contracts/content';
import type { MapEventGrade } from '../../contracts/map-events';
import { ELITE_BIT, type MonsterRarity } from '../../contracts/sim';
import {
  ECHO_ANCHOR_CLEARANCE, ECHO_ANCHOR_RIM, ECHO_DISENGAGE_RADIUS, ECHO_ENGAGE_RADIUS, ECHO_ERUPT_RADIUS, ECHO_ERUPT_RETURNS,
  ECHO_ERUPT_SECONDS, ECHO_FIRST_DELAY, ECHO_GATE_RADIUS, ECHO_GATE_WEIGHT, ECHO_GRADE_SHARE, ECHO_HOME_RADIUS, ECHO_INTERVAL, ECHO_LIFE, ECHO_LOG_MIN, ECHO_MAX,
  ECHO_REACH, ECHO_SHIMMER, ECHO_SPEED, ECHO_WARDEN_LIFE, MAP_EVENT_WARNING_SECONDS,
} from '../../data/progression/map-events';
import { KIND_BY_INDEX } from '../archetypes';
import { spawnArea } from '../areas';
import { MONSTER_ANIM as ANIM, moveAlong, setAnim, toChase } from '../behaviour';
import { DT } from '../constants';
import { DAMAGE_INDEX, GOLDEN_ANGLE } from '../math';
import { MFLAG } from '../stores';
import type { PlayerState, World } from '../world';
import {
  anchorSite, beat, canOnset, dismissMember, eventArea, eventDamage, eventMonster, familyKind, finish, hasRoom, markOnset, mods, nearestLivingDist,
  pickSite, skinOf, placeAt } from './kit';
import type { EventInstance, EventKill, EventScript, KillRecord } from './types';

interface Echo {
  x: number;
  y: number;
  kind: MonsterKind;
  rarity: MonsterRarity;
  mods: number;
  wave: number;
  /** Event seconds at which the echo appears (its ground marker shows ECHO_SHIMMER earlier). */
  at: number;
  marked: boolean;
  spawned: boolean;
  id: number;
}

interface EchoState {
  anchor: { x: number; y: number };
  queue: Echo[];
  /** Event seconds since the recall began. */
  t: number;
  resonance: number;
  intercepted: number;
  /** The grade's measure: an echo cut off on the way counts 1, one caught at the door (inside ECHO_GATE_RADIUS of the anchor) counts ECHO_GATE_WEIGHT. */
  weighted: number;
  returned: number;
  total: number;
  /** Echo id -> the rare flag (for markers). */
  echoes: Map<number, boolean>;
  engaged: Set<number>;
  /** Coliseum chained pairs: id -> partner id. */
  pairs: Map<number, number>;
  stage: 'available' | 'recall' | 'erupt' | 'warden' | 'done';
  erupt: number;
  wardenId: number;
  wardenWait: number;
  eruptArea: { x: number; y: number } | null;
}

const state = (e: EventInstance) => e.s as EchoState;

/** Grade from the intercepted share (Bronze at half, Silver at three quarters, Gold at nearly all cut off on the way). */
export function echoGrade(intercepted: number, total: number, ease = 0): MapEventGrade {
  const share = (total > 0 ? intercepted / total : 0) + ease;
  return share >= ECHO_GRADE_SHARE[2] ? 3 : share >= ECHO_GRADE_SHARE[1] ? 2 : share >= ECHO_GRADE_SHARE[0] ? 1 : 0;
}

function reveal(w: World, e: EventInstance): boolean {
  const rule = { minPlayer: ECHO_ANCHOR_CLEARANCE, rim: ECHO_ANCHOR_RIM };
  const at = anchorSite(w, e, 'echo', rule) ?? pickSite(w, e.plan.angle, { ...rule, from: 0.1, to: 0.8 });
  const anchor = { x: at.x, y: at.y };
  e.s = { anchor, queue: [], t: 0, resonance: 0, intercepted: 0, weighted: 0, returned: 0, total: 0, echoes: new Map(), engaged: new Set(),
    pairs: new Map(), stage: 'available', erupt: 0, wardenId: 0, wardenWait: 0, eruptArea: null } satisfies EchoState;
  e.phase = 'available';
  beat(w, e, 'omen', anchor.x, anchor.y);
  return true;
}

/** The kill log as a queue of echoes (oldest first, at most ECHO_MAX, padded to ECHO_LOG_MIN with ordinary family members). */
function buildQueue(w: World, e: EventInstance): Echo[] {
  const log = w.mapEvent!.killLog;
  const records: KillRecord[] = log.slice(-ECHO_MAX);
  const family = w.roster.family;
  const out: Echo[] = [];
  for (const r of records) {
    out.push({ x: r.x, y: r.y, kind: KIND_BY_INDEX[r.kind], rarity: r.rarity >= 2 ? 'rare' : r.rarity === 1 ? 'magic' : 'normal',
      mods: r.mods, wave: r.wave, at: 0, marked: false, spawned: false, id: 0 });
  }
  for (let k = 0; out.length < ECHO_LOG_MIN; k++) {
    // A deterministic pad: the current wave's family at spread-out points, never rares.
    const a = e.plan.angle + k * GOLDEN_ANGLE;
    const r = w.arenaRadius * (0.35 + 0.4 * ((k * 0.618) % 1));
    const p = placeAt(Math.cos(a) * r, Math.sin(a) * r, w.arenaRadius, w.props);
    out.unshift({ x: p.x, y: p.y, kind: family[k % family.length], rarity: 'normal', mods: 0, wave: Math.max(1, w.director.wave), at: 0, marked: false, spawned: false, id: 0 });
  }
  const coliseum = skinOf(w) === 'coliseum';
  out.forEach((echo, k) => { echo.at = ECHO_FIRST_DELAY + (coliseum ? Math.floor(k / 2) * ECHO_INTERVAL * 2 : k * ECHO_INTERVAL); });
  return out;
}

function tick(w: World, e: EventInstance): void {
  const s = state(e);
  if (e.phase === 'available') {
    if (!canOnset(w)) return;
    if (!w.living.some(p => Math.hypot(p.x - s.anchor.x, p.y - s.anchor.y) <= ECHO_REACH)) return;
    e.phase = 'warning';
    e.timer = MAP_EVENT_WARNING_SECONDS;
    markOnset(w);
    beat(w, e, 'onset', s.anchor.x, s.anchor.y);
    return;
  }
  if (e.phase === 'warning') {
    e.timer -= DT;
    if (e.timer > 0) return;
    s.queue = buildQueue(w, e);
    s.total = s.queue.length;
    s.stage = 'recall';
    e.phase = 'active';
    return;
  }
  if (e.phase !== 'active') return;
  if (s.stage === 'recall') return recall(w, e);
  if (s.stage === 'erupt') return erupt(w, e);
  if (s.stage === 'warden') return warden(w, e);
}

function recall(w: World, e: EventInstance): void {
  const s = state(e);
  s.t += DT;
  const skin = skinOf(w);
  for (const echo of s.queue) {
    if (echo.spawned) continue;
    // The ground marks its spot a second before the echo can act (ashen: a firePool that stays as the lure marker).
    if (!echo.marked && s.t >= echo.at - ECHO_SHIMMER) {
      echo.marked = true;
      eventArea(w, 'echoMark', echo.x, echo.y, 26, ECHO_SHIMMER + 0.4);
      if (skin === 'ashen') {
        eventArea(w, 'firePool', echo.x, echo.y, 22, 4, { damage: eventDamage(w, 6), dtype: DAMAGE_INDEX.fire, hurts: 'player', tickInterval: 0.5, firstTick: 1.0 });
      }
    }
    if (s.t < echo.at || !hasRoom(w, 1)) continue;
    spawnEcho(w, e, echo);
  }
  const alive = [...s.echoes.keys()].length;
  if (s.queue.every(q => q.spawned) && alive === 0) verdict(w, e);
}

function awayFromPlayers(w: World, x: number, y: number): { x: number; y: number } {
  const near = nearestLivingDist(w, x, y);
  if (near >= 120 || w.living.length === 0) return { x, y };
  // Never spawn on top of a player: push out along the line from the nearest one.
  let best = w.living[0];
  for (const p of w.living) if (Math.hypot(p.x - x, p.y - y) < Math.hypot(best.x - x, best.y - y)) best = p;
  const dx = x - best.x, dy = y - best.y, l = Math.hypot(dx, dy) || 1;
  return placeAt(best.x + dx / l * 120, best.y + dy / l * 120, w.arenaRadius, w.props);
}

function spawnEcho(w: World, e: EventInstance, echo: Echo): void {
  const s = state(e);
  const at = awayFromPlayers(w, echo.x, echo.y);
  const i = eventMonster(w, e, echo.kind, at.x, at.y, { rarity: echo.rarity, mods: echo.mods, wave: echo.wave, summoned: true, spectral: true });
  if (i < 0) return;
  echo.spawned = true;
  const m = w.monsters;
  m.maxLife[i] *= ECHO_LIFE * (mods(w).echoLife ?? 1);
  m.life[i] = m.maxLife[i];
  m.speed[i] = ECHO_SPEED;
  if (skinOf(w) === 'ossuary') m.flags[i] |= MFLAG.ghost;
  const id = m.id[i];
  w.mapEvent!.spectral.add(id);
  s.echoes.set(id, echo.rarity !== 'normal');
  // Chained phantom pairs (Coliseum): consecutive echoes share a chain.
  echo.id = id;
  if (skinOf(w) === 'coliseum') {
    const mate = s.queue[s.queue.indexOf(echo) ^ 1];
    if (mate && mate.spawned && s.echoes.has(mate.id)) { s.pairs.set(id, mate.id); s.pairs.set(mate.id, id); }
  }
  beat(w, e, 'step', at.x, at.y, s.echoes.size);
}

function verdict(w: World, e: EventInstance): void {
  const s = state(e);
  const tolerance = ECHO_ERUPT_RETURNS + (mods(w).echoTolerance ?? 0);
  if (s.resonance < tolerance) {
    e.tally = Math.round(s.weighted);
    s.stage = 'done';
    beat(w, e, 'seal', s.anchor.x, s.anchor.y, s.resonance);
    finish(w, e, echoGrade(s.weighted, s.total, mods(w).gradeEase ?? 0), { pay: true, x: s.anchor.x, y: s.anchor.y });
    return;
  }
  // The rift erupts: a five second nova, then a Rift Warden.
  s.stage = 'erupt';
  s.erupt = ECHO_ERUPT_SECONDS;
  eventArea(w, 'slamWarning', s.anchor.x, s.anchor.y, ECHO_ERUPT_RADIUS, ECHO_ERUPT_SECONDS, {
    damage: eventDamage(w, 22), dtype: DAMAGE_INDEX.fire, hurts: 'player',
  });
  s.eruptArea = { x: s.anchor.x, y: s.anchor.y };
  beat(w, e, 'erupt', s.anchor.x, s.anchor.y, s.resonance);
}

function erupt(w: World, e: EventInstance): void {
  const s = state(e);
  s.erupt -= DT;
  if (s.erupt > 0) return;
  s.stage = 'warden';
  s.wardenWait = 8;
}

function warden(w: World, e: EventInstance): void {
  const s = state(e);
  if (s.wardenId === 0) {
    // Never within 250 of a living player (F4), but it does not wait forever.
    s.wardenWait -= DT;
    if ((nearestLivingDist(w, s.anchor.x, s.anchor.y) < 250 && s.wardenWait > 0) || !hasRoom(w, 1)) return;
    const kind = familyKind(w, 'bruiser', 'hunter');
    const i = eventMonster(w, e, kind, s.anchor.x, s.anchor.y, { rarity: 'rare', mods: ELITE_BIT.stout | ELITE_BIT.fierce, shimmer: 1.0 });
    if (i < 0) return;
    const m = w.monsters;
    m.maxLife[i] *= ECHO_WARDEN_LIFE; m.life[i] = m.maxLife[i];
    m.radius[i] *= 1.25;
    s.wardenId = m.id[i];
    beat(w, e, 'arrive', s.anchor.x, s.anchor.y);
    return;
  }
  const bossWave = w.config.waves.bossWave;
  if (bossWave > 0 && w.director.wave >= bossWave && !e.plan.required) {
    // It joins the horde; nothing is paid.
    s.stage = 'done';
    w.mapEvent!.members.delete(s.wardenId); e.members.delete(s.wardenId);
    finish(w, e, 0, { pay: false, lost: true, x: s.anchor.x, y: s.anchor.y });
  }
}

function drive(w: World, e: EventInstance, i: number, t: PlayerState | null): boolean {
  const s = state(e), m = w.monsters, id = m.id[i];
  if (!s.echoes.has(id)) return false;
  // Echoes ignore the party until a player is within 110 u; then they fight instead of walking home (with hysteresis).
  const near = nearestLivingDist(w, m.x[i], m.y[i]);
  const engaged = s.engaged.has(id);
  if (near <= ECHO_ENGAGE_RADIUS || (engaged && near <= ECHO_DISENGAGE_RADIUS)) {
    s.engaged.add(id);
    return false;
  }
  if (engaged) { s.engaged.delete(id); toChase(w, i); }
  const dx = s.anchor.x - m.x[i], dy = s.anchor.y - m.y[i];
  if (Math.hypot(dx, dy) <= ECHO_HOME_RADIUS) {
    s.resonance++;
    s.returned++;
    s.echoes.delete(id);
    s.pairs.delete(id);
    w.mapEvent!.spectral.delete(id);
    beat(w, e, 'return', s.anchor.x, s.anchor.y, s.resonance);
    dismissMember(w, e, id);
    return true;
  }
  moveAlong(w, i, dx, dy, 1);
  m.facing[i] = dx >= 0 ? 1 : -1;
  setAnim(w, i, ANIM.move);
  void t;
  return true;
}

function onKill(w: World, e: EventInstance, k: EventKill): void {
  const s = state(e);
  w.mapEvent!.spectral.delete(k.id);
  if (s.echoes.has(k.id)) {
    s.echoes.delete(k.id);
    s.engaged.delete(k.id);
    if (k.credited) {
      s.intercepted++;
      s.weighted += Math.hypot(k.x - s.anchor.x, k.y - s.anchor.y) <= ECHO_GATE_RADIUS ? ECHO_GATE_WEIGHT : 1;
      const mate = s.pairs.get(k.id);
      if (mate !== undefined) {
        const j = w.monsters.slotOf(mate);
        if (j >= 0) w.monsters.chillTime[j] = 2; // killing one chained phantom slows its partner
        s.pairs.delete(mate); s.pairs.delete(k.id);
      }
    }
    return;
  }
  if (k.id === s.wardenId && k.credited && e.phase === 'active') {
    s.stage = 'done';
    e.tally = s.intercepted;
    finish(w, e, 1, { pay: true, x: k.x, y: k.y });
  }
}

function view(w: World, e: EventInstance): void {
  const s = state(e), v = e.view;
  v.x = s.anchor.x; v.y = s.anchor.y;
  v.objectives.length = 0; v.timers.length = 0; v.zones.length = 0; v.markers.length = 0;
  const tolerance = ECHO_ERUPT_RETURNS + (mods(w).echoTolerance ?? 0);
  v.zones.push({ kind: 'anchor', x: s.anchor.x, y: s.anchor.y, r: 46, a: 0, v: Math.min(255, Math.round(s.resonance / tolerance * 100)) });
  if (e.phase === 'available' || e.phase === 'warning') { v.hint = 0; return; }
  v.objectives.push({ id: 0, cur: Math.min(s.resonance, tolerance), max: tolerance },
    { id: 1, cur: s.intercepted, max: Math.max(1, s.total) }, { id: 2, cur: s.echoes.size, max: Math.max(1, s.total) });
  v.grade = e.phase === 'active' ? echoGrade(s.weighted + s.echoes.size + s.queue.filter(q => !q.spawned).length, s.total, mods(w).gradeEase ?? 0) : e.grade;
  if (s.stage === 'recall') {
    const next = s.queue.find(q => !q.spawned);
    if (next) v.timers.push({ id: 0, seconds: Math.max(0, next.at - s.t), total: ECHO_INTERVAL });
    v.hint = 1;
    for (const [id, rare] of s.echoes) {
      const j = w.monsters.slotOf(id);
      const mate = s.pairs.get(id);
      if (j >= 0) v.markers.push({ icon: rare ? 'echoRare' : 'echo', x: w.monsters.x[j], y: w.monsters.y[j], v: mate === undefined ? 0 : Math.min(id, mate) % 250 + 1 });
    }
  } else if (s.stage === 'erupt') {
    v.timers.push({ id: 1, seconds: Math.max(0, s.erupt), total: ECHO_ERUPT_SECONDS });
    v.hint = 2;
  } else if (s.stage === 'warden') {
    v.hint = 3;
    const j = w.monsters.slotOf(s.wardenId);
    if (j >= 0) v.markers.push({ icon: 'warden', x: w.monsters.x[j], y: w.monsters.y[j], v: 0 });
  } else if (s.stage === 'done') v.hint = 4;
}

function cancel(w: World, e: EventInstance): void {
  const s = state(e);
  for (const id of [...s.echoes.keys()]) dismissMember(w, e, id);
  s.echoes.clear();
}

export const echoingScript: EventScript = { kind: 'echoRift', reveal, tick, drive, onKill, view, cancel };
