// ASHSEED ORCHARD (event id 'orchard'). Three pods burst from the ground and ripen over a minute (stage 0..3). Standing at a bloom
// harvests it (dwell 1.5 s): stage 1 pays Scrap, stage 2 a crafting currency of the bloom's kind, stage 3 a rare-eligible ingredient.
// Monsters within 220 u of a bloom that are away from the party turn on the weakest bloom and gnaw it; a destroyed bloom pays
// nothing. Grade: the sum of harvested stages (3 Bronze, 6 Silver, 9 Gold). docs/atlas-rework/C-map-events.md 7.3.
import type { MapEventGrade } from '../../contracts/map-events';
import { MONSTER_ANIM as ANIM } from '../../contracts/sim';
import { MAP_EVENT_WARNING_SECONDS } from '../../data/progression/map-events';
import {
  ORCHARD_BLOOMS, ORCHARD_CLEARANCE, ORCHARD_DIVERT, ORCHARD_DWELL, ORCHARD_GNAW_SECONDS, ORCHARD_GNAW_SHARE,
  ORCHARD_GRADE_POINTS, ORCHARD_HARVEST_RADIUS, ORCHARD_LIFE, ORCHARD_PLAYER_GUARD, ORCHARD_RADIUS, ORCHARD_SPACING,
  ORCHARD_STAGE_SECONDS, ORCHARD_WITHER_SECONDS,
} from '../../data/progression/events/orchard';
import { moveAlong, setAnim, stop } from '../behaviour';
import { DT } from '../constants';
import { GOLDEN_ANGLE } from '../math';
import type { PlayerState, World } from '../world';
import { layoutAnchors } from '../layout';
import {
  anchorSite, anchorSpot, beat, canOnset, damageFixture, dismissMember, dwell, eventFixture, finish, fixtureLife, hasRoom, markOnset, mods, nearestLivingDist,
  pay, pickSite, placeAt,
} from './kit';
import type { EventInstance, EventKill, EventScript } from './types';

interface Bloom {
  x: number;
  y: number;
  /** 0 Essence, 1 Seal, 2 Metal. */
  kind: number;
  id: number;
  stage: number;
  dwell: Map<number, number>;
  /** 'growing' until harvested or destroyed. */
  state: 'growing' | 'harvested' | 'lost';
  gnawAt: number;
  biteBeat: number;
}

interface OrchardState {
  blooms: Bloom[];
  /** Seconds since the pods burst (scaled by the ripening lens). */
  t: number;
  points: number;
  done: boolean;
}

const state = (e: EventInstance) => e.s as OrchardState;

/** Grade from the harvested stage points: Bronze 3, Silver 6, Gold 9 (the gradeEase lens lowers the bars by its share, rounded up). */
export function orchardGrade(points: number, ease = 0): MapEventGrade {
  const need = (g: number) => Math.max(1, Math.ceil(ORCHARD_GRADE_POINTS[g] * (1 - ease)));
  return points >= need(2) ? 3 : points >= need(1) ? 2 : points >= need(0) ? 1 : 0;
}

/** The stage a bloom has ripened to after `t` seconds. */
export function stageAt(t: number): number {
  return t >= ORCHARD_STAGE_SECONDS[2] ? 3 : t >= ORCHARD_STAGE_SECONDS[1] ? 2 : t >= ORCHARD_STAGE_SECONDS[0] ? 1 : 0;
}

/**
 * The bloom sites: the first on a layout orchard anchor (E1) or the radial rule, then each further plot on another orchard anchor that
 * keeps the spacing window to every plot so far and clears the party (authored order), else the golden-angle search round the first.
 */
function sitesFor(w: World, e: EventInstance): { x: number; y: number }[] {
  const angle = e.plan.angle;
  const rule = { minPlayer: ORCHARD_CLEARANCE, rim: 110 };
  const at = anchorSite(w, e, 'orchard', rule);
  const first = at ? { x: at.x, y: at.y } : pickSite(w, angle, { ...rule, from: 0.1, to: 0.6 });
  const out = [first];
  const [lo, hi] = ORCHARD_SPACING;
  const extra: { id: string; x: number; y: number }[] = [];
  if (at) {
    for (const a of layoutAnchors(w, 'orchard')) {
      const p = a.id !== at.anchor.id ? anchorSpot(w, 'orchard', a, rule) : null;
      if (p) extra.push({ id: a.id, x: p.x, y: p.y });
    }
  }
  for (let b = 1; b < ORCHARD_BLOOMS; b++) {
    const plot = extra.find(a => out.every(o => { const d = Math.hypot(a.x - o.x, a.y - o.y); return d >= lo && d <= hi; }));
    if (plot) {
      out.push(placeAt(plot.x, plot.y, w.arenaRadius, w.props));
      e.anchors!.push(plot.id);
      extra.splice(extra.indexOf(plot), 1);
      continue;
    }
    let best = placeAt(first.x, first.y, w.arenaRadius, w.props), bestScore = -Infinity;
    for (let k = 0; k < 64; k++) {
      const a = angle + k * GOLDEN_ANGLE;
      const dist = lo + (hi - lo) * ((k * 0.61803398875) % 1);
      const c = placeAt(first.x + Math.cos(a) * dist, first.y + Math.sin(a) * dist, w.arenaRadius - 90, w.props);
      if (Math.hypot(c.x, c.y) > w.arenaRadius - 90) continue;
      let score = Math.min(nearestLivingDist(w, c.x, c.y) - ORCHARD_CLEARANCE, 100);
      for (const o of out) {
        const d = Math.hypot(c.x - o.x, c.y - o.y);
        score = Math.min(score, d - lo, hi - d);
      }
      if (score >= 0) { best = c; bestScore = Infinity; break; }
      if (score > bestScore) { bestScore = score; best = c; }
    }
    out.push(best);
  }
  return out;
}

function reveal(w: World, e: EventInstance): boolean {
  if (!canOnset(w) || !hasRoom(w, ORCHARD_BLOOMS)) return false;
  const sites = sitesFor(w, e);
  const blooms: Bloom[] = [];
  for (let k = 0; k < ORCHARD_BLOOMS; k++) {
    const i = eventFixture(w, e, sites[k].x, sites[k].y, ORCHARD_LIFE, ORCHARD_RADIUS);
    if (i < 0) break;
    blooms.push({ x: sites[k].x, y: sites[k].y, kind: k, id: w.monsters.id[i], stage: 0, dwell: new Map(), state: 'growing', gnawAt: 0, biteBeat: 0 });
  }
  if (blooms.length < ORCHARD_BLOOMS) { for (const b of blooms) dismissMember(w, e, b.id); return false; }
  e.s = { blooms, t: 0, points: 0, done: false } satisfies OrchardState;
  e.phase = 'warning';
  e.timer = MAP_EVENT_WARNING_SECONDS;
  markOnset(w);
  beat(w, e, 'omen', blooms[0].x, blooms[0].y);
  return true;
}

function growing(s: OrchardState): Bloom[] {
  return s.blooms.filter(b => b.state === 'growing');
}

function tick(w: World, e: EventInstance): void {
  const s = state(e);
  if (e.phase === 'warning') {
    e.timer -= DT;
    if (e.timer <= 0) { e.phase = 'active'; beat(w, e, 'onset', s.blooms[1].x, s.blooms[1].y); }
    return;
  }
  if (e.phase !== 'active') return;
  const bossWave = w.config.waves.bossWave;
  if (bossWave > 0 && w.director.wave >= bossWave && !e.plan.required) return end(w, e);
  s.t += DT * (mods(w).bloomRipen ?? 1);
  // Unharvested blooms wither a while after they ripen, so the orchard never holds the waves up for long.
  if (s.t >= ORCHARD_WITHER_SECONDS) return end(w, e);
  for (const b of growing(s)) {
    if (w.monsters.slotOf(b.id) < 0) { lose(w, e, b); continue; }
    const st = stageAt(s.t);
    if (st > b.stage) { b.stage = st; beat(w, e, 'step', b.x, b.y, st + b.kind); }
    // Harvest: stand at a bloom with something to give.
    if (b.stage >= 1) {
      if (dwell(w, b.dwell, b.x, b.y, ORCHARD_HARVEST_RADIUS, DT, 2) >= ORCHARD_DWELL) harvest(w, e, b);
    } else b.dwell.clear();
  }
  if (growing(s).length === 0) end(w, e);
}

function harvest(w: World, e: EventInstance, b: Bloom): void {
  const s = state(e);
  b.state = 'harvested';
  s.points += b.stage;
  e.tally = s.points;
  beat(w, e, 'harvest', b.x, b.y, b.stage);
  pay(w, e, 1, b.kind * 4 + b.stage, b.x, b.y);
  dismissMember(w, e, b.id);
}

function lose(w: World, e: EventInstance, b: Bloom): void {
  b.state = 'lost';
  e.members.delete(b.id);
  w.mapEvent!.members.delete(b.id);
  beat(w, e, 'lost', b.x, b.y, 0);
}

function end(w: World, e: EventInstance): void {
  const s = state(e);
  if (s.done) return;
  s.done = true;
  for (const b of growing(s)) { b.state = 'lost'; dismissMember(w, e, b.id); }
  e.tally = s.points;
  const g = orchardGrade(s.points, mods(w).gradeEase ?? 0);
  // The harvests paid at the blooms; the grade payout on top is small (Gold adds a Void Splinter).
  finish(w, e, g, { x: s.blooms[1].x, y: s.blooms[1].y });
}

/** The horde turns on the weakest bloom when the party is away from it. */
function steer(w: World, e: EventInstance, i: number, _t: PlayerState | null): boolean {
  if (e.phase !== 'active') return false;
  const s = state(e), m = w.monsters;
  const reach = ORCHARD_DIVERT * (mods(w).bloomTarget ?? 1);
  let target: Bloom | null = null, tLife = Infinity;
  for (const b of s.blooms) {
    if (b.state !== 'growing') continue;
    if (Math.hypot(b.x - m.x[i], b.y - m.y[i]) > reach) continue;
    const bi = m.slotOf(b.id);
    if (bi < 0) continue;
    const life = m.life[bi];
    if (life < tLife - 1e-6 || (Math.abs(life - tLife) <= 1e-6 && target && b.id < target.id)) { target = b; tLife = life; }
  }
  if (!target || w.living.length === 0 || nearestLivingDist(w, m.x[i], m.y[i]) <= ORCHARD_PLAYER_GUARD) return false;
  const dx = target.x - m.x[i], dy = target.y - m.y[i], d = Math.hypot(dx, dy);
  m.facing[i] = dx >= 0 ? 1 : -1;
  if (d > ORCHARD_RADIUS + m.radius[i] + 6) {
    moveAlong(w, i, dx, dy, 1);
    setAnim(w, i, ANIM.move);
    return true;
  }
  stop(w, i);
  setAnim(w, i, ANIM.attack);
  if (m.attackCd[i] <= 0) {
    m.attackCd[i] = ORCHARD_GNAW_SECONDS;
    const bi = m.slotOf(target.id);
    if (bi >= 0) {
      if (w.time - target.biteBeat > 0.5) { target.biteBeat = w.time; beat(w, e, 'hit', target.x, target.y, 0); }
      damageFixture(w, bi, Math.max(1, m.damage[i] * ORCHARD_GNAW_SHARE * (mods(w).bloomTarget ?? 1)));
    }
  }
  return true;
}

function onKill(w: World, e: EventInstance, k: EventKill): void {
  const b = state(e).blooms.find(x => x.id === k.id);
  if (b && b.state === 'growing') lose(w, e, b);
}

function view(w: World, e: EventInstance): void {
  const s = state(e), v = e.view;
  v.objectives.length = 0; v.timers.length = 0; v.zones.length = 0; v.markers.length = 0;
  const focus = s.blooms.find(b => b.state === 'growing') ?? s.blooms[1];
  v.x = focus.x; v.y = focus.y;
  for (const b of s.blooms) {
    if (b.state === 'harvested') continue;
    let longest = 0;
    for (const t of b.dwell.values()) longest = Math.max(longest, t);
    const life = b.state === 'lost' ? 0 : Math.round(fixtureLife(w, b.id) * 100);
    v.markers.push({ icon: 'bloom', x: b.x, y: b.y, v: b.state === 'lost' ? 255 : b.stage + b.kind * 4, w: life });
    if (b.state === 'growing' && longest > 0) v.zones.push({ kind: 'stone', x: b.x, y: b.y, r: ORCHARD_HARVEST_RADIUS, a: 0, v: Math.min(100, Math.round(longest / ORCHARD_DWELL * 100)), n: b.kind });
  }
  if (e.phase !== 'active') { v.hint = 0; v.grade = e.grade; return; }
  v.grade = orchardGrade(s.points, mods(w).gradeEase ?? 0);
  v.objectives.push({ id: 0, cur: s.points, max: ORCHARD_GRADE_POINTS[2] }, { id: 1, cur: growing(s).length, max: s.blooms.length });
  const total = ORCHARD_STAGE_SECONDS[2];
  const speed = mods(w).bloomRipen ?? 1;
  v.timers.push({ id: 0, seconds: Math.max(0, (total - s.t) / speed), total: total / speed });
  v.hint = s.t >= total ? 2 : growing(s).some(b => w.monsters.slotOf(b.id) >= 0 && fixtureLife(w, b.id) < 0.75) ? 1 : 0;
}

function cancel(w: World, e: EventInstance): void {
  const s = e.s as OrchardState | undefined;
  if (!s) return;
  for (const b of s.blooms) if (b.state === 'growing' && w.monsters.slotOf(b.id) >= 0) dismissMember(w, e, b.id);
}

export const orchardScript: EventScript = { kind: 'orchard', reveal, tick, steer, onKill, view, cancel };
