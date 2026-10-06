// WAYSIDE ANVIL (event id 'anvil'). A roadside anvil charges with the kills made around it (the party fights around it, the
// horde comes to them). Once charged it offers boons on dwell stones; a boon changes only the completion chest's equipment
// (Tempered +1 Stability, Keen best implicits, Attuned a chosen class, Recast rolled twice). Charged within 45 s earns a second
// boon. Nothing here is hostile. docs/atlas-rework/C-map-events.md 7.6.
import { ITEM_CLASSES } from '../../contracts/content';
import type { ChestBoons, MapEventGrade } from '../../contracts/map-events';
import { MAP_EVENT_WARNING_SECONDS } from '../../data/progression/map-events';
import {
  ANVIL_BOONS, ANVIL_CHARGE, ANVIL_CLEARANCE, ANVIL_DWELL, ANVIL_GOLD_SECONDS, ANVIL_RADIUS, ANVIL_SILVER_SECONDS, ANVIL_STONES,
  ANVIL_STONE_RADIUS, ANVIL_STONE_RING, ANVIL_WEIGHT_MAGIC, ANVIL_WEIGHT_RARE, type AnvilBoon,
} from '../../data/progression/events/anvil';
import { DT } from '../constants';
import type { World } from '../world';
import { anchorSite, beat, canOnset, finish, makeStone, markOnset, mods, pickSite, ringPoints, stoneZones, tickStones, type Stone } from './kit';
import type { EventInstance, EventKill, EventScript } from './types';

interface AnvilState {
  site: { x: number; y: number };
  /** Weighted kills counted so far. */
  charge: number;
  need: number;
  /** Seconds since the onset. */
  t: number;
  stage: 'charge' | 'pick' | 'done';
  round: number;
  stones: Stone[];
  /** Boons the stones stand for (same order as stones). */
  offered: AnvilBoon[];
  taken: AnvilBoon[];
  chargedAt: number;
  grade: MapEventGrade;
  /** Seconds since the last charge tick (the sparks). */
  lastStep: number;
}

const state = (e: EventInstance) => e.s as AnvilState;

/** The grade the charge time earns: Gold <= 45 s (two boons), Silver <= 90 s, else Bronze. Timer scale and grade ease stretch it. */
export function anvilGrade(seconds: number, scale = 1): MapEventGrade {
  return seconds <= ANVIL_GOLD_SECONDS * scale ? 3 : seconds <= ANVIL_SILVER_SECONDS * scale ? 2 : 1;
}

const scaleOf = (w: World) => (mods(w).timerScale ?? 1) * (1 + (mods(w).gradeEase ?? 0));
export const anvilNeed = (w: World) => Math.max(1, Math.round(ANVIL_CHARGE * (mods(w).anvilCost ?? 1)));

function reveal(w: World, e: EventInstance): boolean {
  if (!canOnset(w)) return false;
  const rule = { minPlayer: ANVIL_CLEARANCE, rim: 140 };
  const at = anchorSite(w, e, 'anvil', rule) ?? pickSite(w, e.plan.angle, { ...rule, from: 0.1, to: 0.5 });
  const site = { x: at.x, y: at.y };
  e.s = { site, charge: 0, need: anvilNeed(w), t: 0, stage: 'charge', round: 0, stones: [], offered: [], taken: [], chargedAt: 0, grade: 1, lastStep: 0 } satisfies AnvilState;
  e.phase = 'warning';
  e.timer = MAP_EVENT_WARNING_SECONDS;
  markOnset(w);
  beat(w, e, 'omen', site.x, site.y);
  return true;
}

/** Stone n = boon * 16 + class index (the class only matters for Attuned). */
const stoneId = (boon: AnvilBoon, cls: number) => ANVIL_BOONS.indexOf(boon) * 16 + (boon === 'attuned' ? cls : 0);
export const boonOfStone = (n: number): { boon: AnvilBoon; itemClass: string | null } => {
  const boon = ANVIL_BOONS[n >> 4] ?? 'tempered';
  return { boon, itemClass: boon === 'attuned' ? ITEM_CLASSES[n & 15] ?? null : null };
};

function openStones(w: World, e: EventInstance): void {
  const s = state(e);
  const rng = w.mapEvent!.rng;
  const count = ANVIL_STONES + Math.max(0, Math.floor(mods(w).anvilBoons ?? 0));
  const pool = ANVIL_BOONS.filter(b => !s.taken.includes(b));
  const picks: AnvilBoon[] = rng.shuffle([...pool]).slice(0, Math.min(count, pool.length));
  const cls = rng.int(0, ITEM_CLASSES.length - 1);
  s.offered = picks;
  const pts = ringPoints(w, s.site.x, s.site.y, ANVIL_STONE_RING, picks.length, e.plan.angle + s.round);
  s.stones = picks.map((b, k) => makeStone(pts[k].x, pts[k].y, ANVIL_STONE_RADIUS, stoneId(b, cls)));
  s.stage = 'pick';
}

function tick(w: World, e: EventInstance): void {
  const s = state(e);
  if (e.phase === 'warning') {
    e.timer -= DT;
    if (e.timer <= 0) { e.phase = 'active'; e.age = 0; beat(w, e, 'onset', s.site.x, s.site.y); }
    return;
  }
  if (e.phase !== 'active') return;
  const bossWave = w.config.waves.bossWave;
  if (bossWave > 0 && w.director.wave >= bossWave && !e.plan.required) {
    // The anvil goes cold: nothing forged (a charged but unchosen anvil pays nothing either).
    e.tally = Math.round(s.charge);
    finish(w, e, 0, { pay: false, lost: true, x: s.site.x, y: s.site.y });
    return;
  }
  s.t += DT;
  if (s.stage !== 'pick') return;
  const k = tickStones(w, s.stones, ANVIL_DWELL);
  if (k < 0) return;
  const { boon, itemClass } = boonOfStone(s.stones[k].n);
  forge(w, e, boon, itemClass);
}

function forge(w: World, e: EventInstance, boon: AnvilBoon, itemClass: string | null): void {
  const s = state(e), d = w.mapEvent!;
  const b: ChestBoons = d.boons ?? { stability: 0, keen: false, recast: false, itemClass: null };
  if (boon === 'tempered') b.stability += 1;
  else if (boon === 'keen') b.keen = true;
  else if (boon === 'recast') b.recast = true;
  else b.itemClass = itemClass;
  d.boons = b;
  s.taken.push(boon);
  beat(w, e, 'forge', s.site.x, s.site.y, s.taken.length);
  const want = s.grade >= 3 ? 2 : 1;
  if (s.taken.length < want) {
    s.round++;
    openStones(w, e);
    return;
  }
  s.stage = 'done';
  e.tally = Math.round(s.chargedAt);
  finish(w, e, s.grade, { choice: s.taken.length, x: s.site.x, y: s.site.y });
}

function onAnyKill(w: World, e: EventInstance, k: EventKill): void {
  const s = state(e);
  if (e.phase !== 'active' || s.stage !== 'charge') return;
  if (Math.hypot(k.x - s.site.x, k.y - s.site.y) > ANVIL_RADIUS) return;
  s.charge += k.isBoss || k.rarity >= 2 ? ANVIL_WEIGHT_RARE : k.rarity === 1 ? ANVIL_WEIGHT_MAGIC : 1;
  const step = Math.min(9, Math.floor(Math.min(1, s.charge / s.need) * 9));
  beat(w, e, 'step', s.site.x, s.site.y, step);
  if (s.charge < s.need) return;
  s.charge = s.need;
  s.chargedAt = s.t;
  s.grade = anvilGrade(s.t, scaleOf(w));
  beat(w, e, 'seal', s.site.x, s.site.y, s.grade);
  openStones(w, e);
}

function view(w: World, e: EventInstance): void {
  const s = state(e), v = e.view;
  v.objectives.length = 0; v.timers.length = 0; v.zones.length = 0; v.markers.length = 0;
  v.x = s.site.x; v.y = s.site.y;
  const pct = Math.round(Math.min(1, s.charge / s.need) * 100);
  v.zones.push({ kind: 'altar', x: s.site.x, y: s.site.y, r: ANVIL_RADIUS, a: 0, v: pct, n: e.phase === 'active' ? 1 : 0 });
  v.markers.push({ icon: 'anvil', x: s.site.x, y: s.site.y, v: pct, w: s.stage === 'pick' ? 1 : 0 });
  v.grade = e.phase === 'active' ? (s.stage === 'charge' ? anvilGrade(s.t, scaleOf(w)) : s.grade) : e.grade;
  if (e.phase !== 'active') { v.hint = 0; return; }
  if (s.stage === 'charge') {
    v.objectives.push({ id: 0, cur: Math.min(s.need, Math.round(s.charge)), max: s.need });
    const gold = ANVIL_GOLD_SECONDS * scaleOf(w);
    v.timers.push({ id: 0, seconds: Math.max(0, gold - s.t), total: gold });
    v.hint = 0;
  } else if (s.stage === 'pick') {
    v.objectives.push({ id: 1, cur: s.taken.length, max: s.grade >= 3 ? 2 : 1 });
    stoneZones(s.stones, ANVIL_DWELL, v.zones);
    v.hint = s.round === 0 ? 1 : 2;
  }
}

export const anvilScript: EventScript = { kind: 'anvil', reveal, tick, onAnyKill, view };
