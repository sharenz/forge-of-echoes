// THE STALKER (event id 'hunted'). Something has circled the party since the first wave. It pounces on the party's
// straggler from a telegraphed disc that locks 0.4 s before impact; a landing on a player feeds it (Hunt stacks), a
// landing on empty ground (or into a pillar) leaves it Exposed. Whiffs are the trophy: 0 Bronze, 1-2 Silver, 3+ Gold.
// docs/atlas-rework/C-map-events.md 6.1.
import type { MapEventGrade } from '../../contracts/map-events';
import { AILMENT_BIT, ELITE_BIT, MONSTER_ANIM as ANIM, type MonsterRarity } from '../../contracts/sim';
import { DAMAGE_INDEX } from '../math';
import {
  MAP_EVENT_WARNING_SECONDS, STALKER_DAMAGE_MULT, STALKER_DISC_RADIUS, STALKER_DISC_SECONDS, STALKER_EXPOSED_SECONDS,
  STALKER_EXPOSED_TAKEN, STALKER_FLIGHT, STALKER_FRENZY_BONUS, STALKER_FRENZY_SECONDS, STALKER_GRADE_WHIFFS, STALKER_HEAL, STALKER_LIFE,
  STALKER_HUNT_BONUS, STALKER_HUNT_MAX, STALKER_IGNORE_SECONDS, STALKER_LEAP_MAX, STALKER_LOCK_BEFORE_IMPACT, STALKER_ORBIT,
  STALKER_POUNCE_SECONDS, STALKER_POUNCE_SECONDS_HUNTED, STALKER_ROGUE_SECONDS, STALKER_SPAWN_CLEARANCE,
  STALKER_STUN_SECONDS, STALKER_WHIFF_RECOVERY,
} from '../../data/progression/map-events';
import { setAnim, stop } from '../behaviour';
import { DT } from '../constants';
import { hitPlayer } from '../combat';
import { spawnArea } from '../areas';
import { isHeld } from '../rosters/pressure';
import { MFLAG } from '../stores';
import type { Area, PlayerState, World } from '../world';
import {
  anchorSite, beat, canOnset, eventArea, eventMonster, finish, hasRoom, hunterKind, livingCentroid, markOnset, mods, pickSite, segmentBlocked,
  skinOf, straggler, placeAt } from './kit';
import type { EventInstance, EventKill, EventScript } from './types';

interface Pounce {
  /** Seconds since the disc appeared. */
  t: number;
  target: number;
  disc: Area;
  /** Where it will land (set at flight start). */
  lx: number;
  ly: number;
  fromX: number;
  fromY: number;
  flying: boolean;
  blocked: boolean;
  locked: boolean;
}

interface StalkerState {
  site: { x: number; y: number };
  id: number;
  spawnedAt: number;
  hunt: number;
  whiffs: number;
  nextPounce: number;
  pounce: Pounce | null;
  recover: number;
  frenzy: boolean;
  rogue: boolean;
  ghost: boolean;
  /** Last known position (the view keeps pointing at it). */
  x: number;
  y: number;
}

const state = (e: EventInstance) => e.s as StalkerState;

/** The whiff tally the grade is decided from: whiffs (Hunter's Patience doubles them) plus danger mods. */
export function stalkerTally(w: World, whiffs: number): number {
  const md = mods(w);
  return Math.round(whiffs * (md.whiffMultiplier ?? 1)) + (md.tally ?? 0);
}

export function stalkerGrade(tally: number): MapEventGrade {
  return tally >= STALKER_GRADE_WHIFFS[1] ? 3 : tally >= STALKER_GRADE_WHIFFS[0] ? 2 : 1;
}

function rider(w: World): 'burning' | 'chilled' | 'bleeding' {
  const skin = skinOf(w);
  return skin === 'ashen' ? 'burning' : skin === 'ossuary' ? 'chilled' : 'bleeding';
}

function reveal(w: World, e: EventInstance): boolean {
  if (!hasRoom(w, 1) || !canOnset(w)) return false;
  // A layout's perch (E1: cover between it and the landing is validated), else the radial rule: the rim band.
  const rule = { minPlayer: STALKER_SPAWN_CLEARANCE, rim: 50 };
  const at = anchorSite(w, e, 'perch', rule) ?? pickSite(w, e.plan.angle, { ...rule, from: 0.93, to: 1 });
  const site = { x: at.x, y: at.y };
  const s: StalkerState = { site, id: 0, spawnedAt: 0, hunt: 0, whiffs: 0, nextPounce: 0, pounce: null, recover: 0,
    frenzy: false, rogue: false, ghost: false, x: site.x, y: site.y };
  e.s = s;
  e.phase = 'warning';
  e.timer = MAP_EVENT_WARNING_SECONDS;
  markOnset(w);
  beat(w, e, 'omen', site.x, site.y);
  return true;
}

function spawn(w: World, e: EventInstance): boolean {
  const s = state(e);
  if (!hasRoom(w, 1)) return false;
  const skin = skinOf(w);
  const proof = mods(w).stalkerProof ? (skin === 'ashen' ? ELITE_BIT.fireProof : skin === 'ossuary' ? ELITE_BIT.coldProof : ELITE_BIT.lightningProof) : 0;
  const rarity: MonsterRarity = 'rare';
  const i = eventMonster(w, e, hunterKind(w), s.site.x, s.site.y, { rarity, mods: ELITE_BIT.swift | ELITE_BIT.fierce | proof, spectral: true });
  if (i < 0) return false;
  const m = w.monsters;
  m.radius[i] *= 1.2;
  // A rare dies in seconds to a matched build: the Stalker is tuned to a 40 to 60 s hunt (docs/atlas-rework/C-map-events.md 6.1).
  const lens = STALKER_LIFE * (mods(w).stalkerLife ?? 1);
  m.maxLife[i] *= lens; m.life[i] = m.maxLife[i];
  if (skin === 'ossuary') { m.flags[i] |= MFLAG.ghost; s.ghost = true; }
  w.mapEvent!.spectral.add(m.id[i]);
  s.id = m.id[i];
  s.spawnedAt = w.time;
  s.nextPounce = w.time + 6;
  e.phase = 'active';
  return true;
}

function tick(w: World, e: EventInstance): void {
  const s = state(e);
  if (e.phase === 'warning') {
    e.timer -= DT;
    if (e.timer <= 0 && spawn(w, e)) beat(w, e, 'onset', s.site.x, s.site.y);
    return;
  }
  if (e.phase !== 'active') return;
  const i = w.monsters.slotOf(s.id);
  if (i < 0) return;
  s.x = w.monsters.x[i];
  s.y = w.monsters.y[i];
  // Ignoring it is a cost: past 120 s or at the boss wave it turns rogue (pounces every 5 s, pays nothing).
  const bossWave = w.config.waves.bossWave;
  if (w.time - s.spawnedAt >= STALKER_IGNORE_SECONDS * (mods(w).timerScale ?? 1) || (bossWave > 0 && w.director.wave >= bossWave)) {
    s.rogue = true;
    finish(w, e, 0, { pay: false, lost: true, x: s.x, y: s.y });
  }
}

function startPounce(w: World, e: EventInstance, i: number): void {
  const s = state(e), m = w.monsters;
  const t = straggler(w);
  if (!t || isHeld(t)) { s.nextPounce = w.time + 0.5; return; }
  // Never a second pounce on the same player: one Stalker, one disc.
  const disc = eventArea(w, 'leapWarning', t.x, t.y, STALKER_DISC_RADIUS, STALKER_DISC_SECONDS, {
    followPlayer: t.id, lockAt: STALKER_DISC_SECONDS - STALKER_LOCK_BEFORE_IMPACT, hurts: 'none', debuff: null, owner: m.id[i],
  });
  s.pounce = { t: 0, target: t.id, disc, lx: t.x, ly: t.y, fromX: m.x[i], fromY: m.y[i], flying: false, blocked: false, locked: false };
  setAnim(w, i, ANIM.windup);
  stop(w, i);
  m.facing[i] = t.x >= m.x[i] ? 1 : -1;
  if (!s.rogue) beat(w, e, 'pulse', t.x, t.y, s.hunt);
}

function abortPounce(w: World, s: StalkerState, delay: number): void {
  if (s.pounce) s.pounce.disc.dead = true;
  s.pounce = null;
  s.nextPounce = w.time + delay;
}

function land(w: World, e: EventInstance, i: number): void {
  const s = state(e), m = w.monsters, p = s.pounce!;
  const d = w.mapEvent!;
  s.pounce = null;
  m.flags[i] &= ~MFLAG.unpushable;
  const land = p.blocked ? { x: p.lx, y: p.ly } : placeAt(p.lx, p.ly, w.arenaRadius, w.props);
  m.x[i] = land.x; m.y[i] = land.y;
  let hits = 0;
  if (!p.blocked) {
    const dmg = m.damage[i] * STALKER_DAMAGE_MULT * (1 + STALKER_HUNT_BONUS * s.hunt) * (s.frenzy ? 1 + STALKER_FRENZY_BONUS : 1);
    for (const t of [...w.living]) {
      if (Math.hypot(t.x - land.x, t.y - land.y) > STALKER_DISC_RADIUS + 3) continue;
      if (hitPlayer(w, t, dmg, m.dtype[i], 'area', rider(w)) >= 0) hits++;
    }
    if (skinOf(w) === 'ashen') {
      spawnArea(w, 'firePool', land.x, land.y, STALKER_DISC_RADIUS, 3, {
        damage: m.damage[i] * 0.25, dtype: DAMAGE_INDEX.fire, hurts: 'player', tickInterval: 0.5, firstTick: 1.0,
      });
    }
  }
  w.events.push({ t: 'areaResolve', kind: 'leapWarning', x: land.x, y: land.y, radius: STALKER_DISC_RADIUS });
  if (hits > 0) {
    s.hunt = Math.min(STALKER_HUNT_MAX, s.hunt + 1);
    m.life[i] = Math.min(m.maxLife[i], m.life[i] + m.maxLife[i] * STALKER_HEAL);
    s.frenzy = s.hunt >= STALKER_HUNT_MAX;
    s.nextPounce = w.time + (s.frenzy ? STALKER_FRENZY_SECONDS : s.hunt >= 2 ? STALKER_POUNCE_SECONDS_HUNTED : STALKER_POUNCE_SECONDS);
    setAnim(w, i, ANIM.attack);
    if (s.rogue) s.nextPounce = w.time + STALKER_ROGUE_SECONDS; else beat(w, e, 'hit', land.x, land.y, s.hunt);
    return;
  }
  // A whiff: the Stalker is Exposed and stands stunned or winded; it is the tally that pays.
  s.whiffs++;
  s.recover = p.blocked ? STALKER_STUN_SECONDS : STALKER_WHIFF_RECOVERY;
  d.exposed.set(m.id[i], w.time + STALKER_EXPOSED_SECONDS);
  if (s.ghost) m.flags[i] &= ~MFLAG.ghost; // Exposed: it turns solid
  s.nextPounce = w.time + (s.frenzy ? STALKER_FRENZY_SECONDS : STALKER_POUNCE_SECONDS_HUNTED) + s.recover;
  setAnim(w, i, ANIM.idle);
  if (s.rogue) s.nextPounce = w.time + STALKER_ROGUE_SECONDS; else beat(w, e, 'whiff', land.x, land.y, s.whiffs);
}

/** The Stalker's whole brain: orbit at 260-340 u, pounce on the straggler, recover. Returns true (it owns the monster). */
function drive(w: World, e: EventInstance, i: number, t: PlayerState | null): boolean {
  const s = state(e), m = w.monsters, d = w.mapEvent!;
  if (s.ghost && (d.exposed.get(m.id[i]) ?? 0) <= w.time && !(m.flags[i] & MFLAG.ghost)) m.flags[i] |= MFLAG.ghost;
  if (s.recover > 0) { s.recover -= DT; stop(w, i); return true; }
  const p = s.pounce;
  if (p) {
    const target = w.playerById[p.target];
    if (!target || target.dead) { abortPounce(w, s, 2); return true; }
    p.t += DT;
    stop(w, i);
    if (!p.locked && p.t >= STALKER_DISC_SECONDS - STALKER_LOCK_BEFORE_IMPACT) {
      p.locked = true;
      if (!s.rogue) beat(w, e, 'lock', p.disc.x, p.disc.y, s.hunt);
    }
    if (!p.flying) {
      const start = STALKER_DISC_SECONDS - STALKER_FLIGHT;
      if (p.t >= start) {
        // The disc has been locked for 0.15 s: nobody held is ever pounced on, and a prop in the line takes the leap.
        if (isHeld(target)) { abortPounce(w, s, 2); return true; }
        p.lx = p.disc.x; p.ly = p.disc.y;
        p.fromX = m.x[i]; p.fromY = m.y[i];
        const hit = segmentBlocked(w, p.fromX, p.fromY, p.lx, p.ly, m.radius[i] * 0.5);
        if (hit) { p.blocked = true; p.lx = hit.x; p.ly = hit.y; }
        p.flying = true;
        m.flags[i] |= MFLAG.unpushable;
        setAnim(w, i, ANIM.leap);
        w.events.push({ t: 'monsterAttack', kind: 'riftStalker', x: p.fromX, y: p.fromY, attack: 'leap' });
      }
      return true;
    }
    const u = Math.min(1, (p.t - (STALKER_DISC_SECONDS - STALKER_FLIGHT)) / STALKER_FLIGHT);
    m.x[i] = p.fromX + (p.lx - p.fromX) * u;
    m.y[i] = p.fromY + (p.ly - p.fromY) * u;
    if (p.t >= STALKER_DISC_SECONDS) land(w, e, i);
    return true;
  }
  // Stalk (or, in frenzy, hunt). A pounce that is due needs its straggler inside leap range: it closes in on them first.
  const c = livingCentroid(w);
  const ax = m.x[i] - c.x, ay = m.y[i] - c.y;
  const dist = Math.hypot(ax, ay) || 1;
  const speed = 1 + STALKER_HUNT_BONUS * s.hunt;
  const due = w.time >= s.nextPounce;
  const bait = due || s.frenzy ? straggler(w) : null;
  const bx = bait ? bait.x - m.x[i] : 0, by = bait ? bait.y - m.y[i] : 0, bd = Math.hypot(bx, by);
  if (bait && due && bd <= STALKER_LEAP_MAX) {
    startPounce(w, e, i);
    return true;
  }
  if (bait && (s.frenzy || (due && bd > STALKER_LEAP_MAX))) {
    const l = bd || 1;
    m.vx[i] = bx / l * m.speed[i] * speed; m.vy[i] = by / l * m.speed[i] * speed;
  } else {
    const mid = (STALKER_ORBIT[0] + STALKER_ORBIT[1]) / 2;
    const sign = (e.plan.variant ?? 0) & 1 ? 1 : -1;
    // Tangent round the party, with the radial correction that keeps it inside the band.
    const tx = -ay / dist * sign, ty = ax / dist * sign;
    const radial = dist < STALKER_ORBIT[0] ? 1 : dist > STALKER_ORBIT[1] ? -1 : (mid - dist) / mid * 2;
    const vx = tx + ax / dist * radial, vy = ty + ay / dist * radial;
    const l = Math.hypot(vx, vy) || 1;
    m.vx[i] = vx / l * m.speed[i] * speed * 0.9; m.vy[i] = vy / l * m.speed[i] * speed * 0.9;
  }
  m.facing[i] = m.vx[i] >= 0 ? 1 : -1;
  setAnim(w, i, ANIM.move);
  return true;
}

function onKill(w: World, e: EventInstance, k: EventKill): void {
  const s = state(e);
  w.mapEvent!.exposed.delete(k.id);
  w.mapEvent!.spectral.delete(k.id);
  if (s.rogue || e.phase !== 'active' || !k.credited) return;
  e.tally = stalkerTally(w, s.whiffs);
  finish(w, e, stalkerGrade(e.tally), { x: k.x, y: k.y });
}

function view(w: World, e: EventInstance): void {
  const s = state(e), v = e.view;
  v.x = s.x; v.y = s.y;
  v.objectives.length = 0; v.timers.length = 0; v.zones.length = 0; v.markers.length = 0;
  const tally = e.phase === 'complete' || e.phase === 'failed' ? e.tally : stalkerTally(w, s.whiffs);
  v.objectives.push({ id: 0, cur: s.hunt, max: STALKER_HUNT_MAX }, { id: 1, cur: Math.min(tally, STALKER_GRADE_WHIFFS[1]), max: STALKER_GRADE_WHIFFS[1] });
  v.grade = e.phase === 'active' ? stalkerGrade(tally) : e.grade;
  if (e.phase === 'warning') v.zones.push({ kind: 'eye', x: s.site.x, y: s.site.y, r: 26, a: 0, v: 0 });
  if (e.phase !== 'active') { v.hint = e.phase === 'complete' ? 4 : s.rogue ? 3 : 0; return; }
  const i = w.monsters.slotOf(s.id);
  if (i >= 0) {
    v.markers.push({ icon: 'claw', x: s.x, y: s.y, v: s.hunt });
    if (s.pounce) v.markers.push({ icon: 'pounce', x: s.pounce.flying ? s.pounce.lx : s.pounce.disc.x, y: s.pounce.flying ? s.pounce.ly : s.pounce.disc.y, v: s.pounce.t >= STALKER_DISC_SECONDS - STALKER_LOCK_BEFORE_IMPACT ? 1 : 0 });
    else if (!s.rogue) v.timers.push({ id: 0, seconds: Math.max(0, s.nextPounce - w.time), total: s.frenzy ? STALKER_FRENZY_SECONDS : STALKER_POUNCE_SECONDS });
    const ex = (w.mapEvent!.exposed.get(w.monsters.id[i]) ?? 0) - w.time;
    if (ex > 0) v.timers.push({ id: 1, seconds: ex, total: STALKER_EXPOSED_SECONDS });
  }
  v.hint = s.frenzy ? 2 : s.whiffs > 0 ? 4 : s.pounce ? 1 : 0;
}

function cancel(w: World, e: EventInstance): void {
  const s = state(e);
  if (s.pounce) s.pounce.disc.dead = true;
  const d = w.mapEvent!;
  d.exposed.delete(s.id);
  d.spectral.delete(s.id);
}

/** Damage-taken multiplier of an Exposed monster (see combat.ts takenMult). */
export const EXPOSED_TAKEN = STALKER_EXPOSED_TAKEN;
export const EXPOSED_BIT = AILMENT_BIT.exposed;

export const stalkerScript: EventScript = { kind: 'hunted', reveal, tick, drive, onKill, view, cancel };
