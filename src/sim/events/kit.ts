// Shared pieces of the event scripts: the primitives of Event Director v2 (sites, escorts, zones, dwell, the fairness
// wrappers) and the payout/finish path every event ends through. No script state lives here.
import type { MonsterKind } from '../../contracts/content';
import type { EventRewardContext, MapEventBeat, MapEventGrade, MapEventView } from '../../contracts/map-events';
import { MONSTER_ANIM, type MonsterRarity } from '../../contracts/sim';
import {
  EVENT_LARGE_RADIUS, EVENT_MIN_TELEGRAPH, EVENT_MIN_TELEGRAPH_LARGE, EVENT_ONSET_GAP, EVENT_RESULT_SECONDS,
} from '../../data/progression/map-events';
import { spawnArea, type AreaOptions } from '../areas';
import { killMonster, livingIds } from '../combat';
import { DT, WAVE_DAMAGE_GROWTH } from '../constants';
import { rollEventRewardSpecs } from '../hooks';
import { spawnDrops } from '../loot';
import { DAMAGE_INDEX, GOLDEN_ANGLE, TAU } from '../math';
import { resolvePlayerAt } from '../movement';
import { monsterDef } from '../rosters';
import { spawnMonster } from '../spawn';
import { MFLAG } from '../stores';
import type { Area, PlayerState, World } from '../world';
import type { EventInstance } from './types';

/** Which of the three rosters a theme belongs to (the six themes share three skins for every event). */
export type RosterSkin = 'ashen' | 'ossuary' | 'coliseum';
export function skinOf(w: World): RosterSkin {
  switch (w.config.theme) {
    case 'rimedOssuary': case 'choralCrypt': return 'ossuary';
    case 'ironColiseum': case 'chainworks': return 'coliseum';
    default: return 'ashen';
  }
}

export function blankView(uid: number, kind: EventInstance['kind']): MapEventView {
  return { uid, kind, phase: 'available', x: 0, y: 0, grade: 0, hint: 0, objectives: [], timers: [], zones: [], markers: [] };
}

/** Cosmetic beat for the presenter (announcement, sound, effect). */
export function beat(w: World, e: EventInstance, what: MapEventBeat, x: number, y: number, n = 0): void {
  w.events.push({ t: 'mapEvent', kind: e.kind, beat: what, x, y, n });
}

export function mods(w: World) {
  return w.config.eventModifiers ?? {};
}

/** The family member of a role (the hunter by default), never a role the roster lacks. */
export function familyKind(w: World, ...roles: string[]): MonsterKind {
  const family = w.roster.family;
  for (const role of roles) {
    const k = family.find(f => monsterDef(f).role === role);
    if (k) return k;
  }
  return family[0];
}

export function hunterKind(w: World): MonsterKind {
  return familyKind(w, 'hunter', 'fast');
}

/** Distance from (x, y) to the nearest living player (Infinity when nobody lives). */
export function nearestLivingDist(w: World, x: number, y: number): number {
  let best = Infinity;
  for (const p of w.living) best = Math.min(best, Math.hypot(p.x - x, p.y - y));
  return best;
}

export function livingCentroid(w: World): { x: number; y: number } {
  let x = 0, y = 0;
  for (const p of w.living) { x += p.x; y += p.y; }
  const n = Math.max(1, w.living.length);
  return { x: x / n, y: y / n };
}

/**
 * The living player furthest from the rest of the party (ties: lowest id): the Stalker's bait. A lone player is their own straggler.
 */
export function straggler(w: World): PlayerState | null {
  const living = w.living;
  if (living.length === 0) return null;
  if (living.length === 1) return living[0];
  let best: PlayerState | null = null, bestD = -1;
  for (const p of living) {
    let sum = 0;
    for (const q of living) if (q !== p) sum += Math.hypot(p.x - q.x, p.y - q.y);
    const d = sum / (living.length - 1);
    if (d > bestD + 1e-6 || (Math.abs(d - bestD) <= 1e-6 && best && p.id < best.id)) { best = p; bestD = d; }
  }
  return best;
}

export interface SiteOptions {
  /** Keep at least this far from every living player. */
  minPlayer: number;
  /** Keep this far inside the arena edge. */
  rim: number;
  /** Smallest / largest share of the usable radius (0 = centre, 1 = the rim band). */
  from?: number;
  to?: number;
  /** Keep away from these points. */
  avoid?: { x: number; y: number; d: number }[];
}

/**
 * A deterministic site search (no rng): candidates spiral round from `angle`, are pushed out of solid props and must
 * clear every living player (fairness F4). When nothing qualifies the farthest candidate wins.
 */
export function pickSite(w: World, angle: number, o: SiteOptions): { x: number; y: number } {
  const R = w.arenaRadius - o.rim;
  const from = o.from ?? 0.35, to = o.to ?? 1;
  let best = { x: 0, y: 0 }, bestScore = -Infinity;
  for (let k = 0; k < 40; k++) {
    const a = angle + k * GOLDEN_ANGLE;
    const u = from + (to - from) * ((k * 0.61803398875) % 1);
    const p = placeAt(Math.cos(a) * R * u, Math.sin(a) * R * u, w.arenaRadius, w.props);
    let score = nearestLivingDist(w, p.x, p.y);
    if (w.living.length === 0) score = 1e6;
    for (const av of o.avoid ?? []) score = Math.min(score, Math.hypot(p.x - av.x, p.y - av.y) - av.d + o.minPlayer);
    if (score >= o.minPlayer) return p;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}

/** resolvePlayerAt with a fresh result (the movement helper returns one shared scratch object). */
export function placeAt(x: number, y: number, arenaRadius: number, props: World['props']): { x: number; y: number } {
  const p = resolvePlayerAt(x, y, arenaRadius, props);
  return { x: p.x, y: p.y };
}

/** Whether `count` more monsters fit (F5: an event that cannot spawn waits). */
export function hasRoom(w: World, count: number): boolean {
  return w.monsters.capacity - w.monsters.count >= count;
}

export interface EventMonsterOptions {
  rarity?: MonsterRarity;
  mods?: number;
  wave?: number;
  /** Seconds of shimmer (invulnerable, still) before it can act. */
  shimmer?: number;
  /** No loot, half XP (echoes, escorts of a wagon). */
  summoned?: boolean;
  /** Translucent on the client. */
  spectral?: boolean;
  /** No spawn animation: the body stands there from the first tick (statues, fixtures). */
  still?: boolean;
  /** A frozen statue of the Stasis Host: invulnerable and inert until thawed (MFLAG.frozen). Keeps loot and XP. */
  frozen?: boolean;
  /** A destructible fixture (bloom, prism, wheel): inert, hittable, no loot, no XP. `life` multiplies the kind's scaled life; `radius` overrides it. */
  fixture?: { life: number; radius: number };
}

/** Spawn a monster owned by `e`: kills of it are reported to the script; no pack (it hunts from the start). */
export function eventMonster(w: World, e: EventInstance, kind: MonsterKind, x: number, y: number, o: EventMonsterOptions = {}): number {
  const d = w.mapEvent!;
  const i = spawnMonster(w, kind, x, y, { rarity: o.rarity ?? 'normal', mods: o.mods ?? 0, wave: o.wave ?? Math.max(1, w.director.wave), lifeFloor: false,
    ...(o.still || o.frozen || o.fixture ? { animate: false } : {}) });
  if (i < 0) return -1;
  const m = w.monsters;
  if (o.shimmer && o.shimmer > 0) m.spawnTime[i] = o.shimmer;
  if (o.summoned) { m.flags[i] |= MFLAG.summoned; m.xp[i] *= 0.5; }
  if (o.frozen) m.flags[i] |= MFLAG.frozen | MFLAG.unpushable | MFLAG.heavy;
  if (o.fixture) {
    m.flags[i] |= MFLAG.fixture | MFLAG.unpushable | MFLAG.heavy | MFLAG.summoned;
    m.xp[i] = 0; m.damage[i] = 0; m.speed[i] = 0;
    m.radius[i] = o.fixture.radius;
    m.maxLife[i] *= o.fixture.life; m.life[i] = m.maxLife[i];
  }
  const speed = mods(w).monsterSpeed;
  if (speed && speed !== 1) m.speed[i] *= speed;
  e.members.add(m.id[i]);
  d.members.set(m.id[i], e);
  return i;
}

/** Take a monster out of an event without a kill: no corpse, XP or loot (an echo that reached home). */
export function dismissMember(w: World, e: EventInstance, id: number): void {
  const d = w.mapEvent!;
  e.members.delete(id);
  d.members.delete(id);
  const i = w.monsters.slotOf(id);
  if (i < 0) return;
  const pack = w.monsters.pack[i] >= 0 ? w.packs[w.monsters.pack[i]] : undefined;
  if (pack && --pack.alive <= 0) pack.active = false;
  w.memory.delete(id);
  for (const a of w.areas) if (a.owner === id || a.follow === id) a.dead = true;
  w.monsters.release(i);
}

/** Let every remaining member go back to being an ordinary monster of the horde. */
export function releaseMembers(w: World, e: EventInstance): void {
  const d = w.mapEvent!;
  for (const id of e.members) d.members.delete(id);
  e.members.clear();
}

/**
 * A hostile event area. F1: anything that can hurt a player waits at least EVENT_MIN_TELEGRAPH (1.8 s above
 * EVENT_LARGE_RADIUS) before its first damage; harmless shimmers are unrestricted.
 */
export function eventArea(w: World, kind: Area['kind'], x: number, y: number, r: number, seconds: number, opts: AreaOptions = {}): Area {
  const hostile = opts.hurts !== undefined && opts.hurts !== 'none';
  const min = r > EVENT_LARGE_RADIUS ? EVENT_MIN_TELEGRAPH_LARGE : EVENT_MIN_TELEGRAPH;
  const a = spawnArea(w, kind, x, y, r, hostile ? Math.max(seconds, min) : seconds, opts);
  if (hostile && (opts.tickInterval ?? 0) > 0 && a.tickTimer < min) a.tickTimer = min;
  return a;
}

/** Where the segment (x0, y0) to (x1, y1) first runs into a solid prop, or null when the line is clear. */
export function segmentBlocked(w: World, x0: number, y0: number, x1: number, y1: number, pad = 0): { x: number; y: number } | null {
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-6) return null;
  let bestT = Infinity;
  for (const p of w.props) {
    if (p.radius <= 0 || p.kind === 'chest' || p.kind === 'portal' || p.kind === 'returnPortal') continue;
    const r = p.radius + pad;
    let t = ((p.x - x0) * dx + (p.y - y0) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const cx = x0 + dx * t - p.x, cy = y0 + dy * t - p.y;
    if (cx * cx + cy * cy > r * r) continue;
    // Entry point of the line into the circle.
    const fx = x0 - p.x, fy = y0 - p.y;
    const b = fx * dx + fy * dy, c = fx * fx + fy * fy - r * r;
    const disc = b * b - len2 * c;
    const te = disc >= 0 ? (-b - Math.sqrt(disc)) / len2 : t;
    bestT = Math.min(bestT, Math.max(0, Math.min(1, te)));
  }
  return bestT === Infinity ? null : { x: x0 + dx * bestT, y: y0 + dy * bestT };
}

/**
 * Dwell tracking for an interactive spot: per-player seconds inside `r` of (x, y). Returns the largest dwell among the
 * living players (choices resolve by the most-occupied spot, ties by the lowest index at the call site).
 */
export function dwell(w: World, dwellMap: Map<number, number>, x: number, y: number, r: number, dt: number, decay = 1): number {
  let best = 0;
  for (const p of w.living) {
    const inside = Math.hypot(p.x - x, p.y - y) <= r;
    const cur = dwellMap.get(p.id) ?? 0;
    const next = inside ? cur + dt : Math.max(0, cur - dt * decay);
    if (next > 0) dwellMap.set(p.id, next); else dwellMap.delete(p.id);
    best = Math.max(best, next);
  }
  for (const id of [...dwellMap.keys()]) if (!w.playerById[id] || w.playerById[id]!.dead) dwellMap.delete(id);
  return best;
}

/** Roll and drop one payout at (x, y) for every living player. Grades shift up with the tree's gradeShift. */
export function pay(w: World, e: EventInstance, grade: MapEventGrade, choice: number, x: number, y: number): void {
  if (w.living.length === 0) return;
  const md = mods(w);
  const ctx: EventRewardContext = {
    kind: e.kind, grade, choice, tally: e.tally, x, y, wave: Math.max(1, w.director.wave),
    ingredientBonus: md.ingredientChance ?? 0, multiplier: md.rewardMultiplier ?? 1,
  };
  const specs = rollEventRewardSpecs(w, ctx, livingIds(w));
  if (specs.length > 0) spawnDrops(w, specs, x, y, true);
}

export function shiftGrade(w: World, grade: MapEventGrade): MapEventGrade {
  const shift = Math.max(0, Math.min(2, Math.floor(mods(w).gradeShift ?? 0)));
  return grade >= 1 ? Math.min(3, grade + shift) as MapEventGrade : grade;
}

export interface FinishOptions {
  /** Pay the classic payout for `grade` (default: whenever grade >= 1). */
  pay?: boolean;
  choice?: number;
  x?: number;
  y?: number;
  /** Show 'failed' instead of 'complete' even though something paid. */
  lost?: boolean;
}

/** End an event: the result stays on the HUD for EVENT_RESULT_SECONDS, then the director drops it. */
export function finish(w: World, e: EventInstance, grade: MapEventGrade, o: FinishOptions = {}): void {
  if (e.phase === 'complete' || e.phase === 'failed') return;
  const g = shiftGrade(w, grade);
  e.grade = g;
  e.phase = g > 0 && !o.lost ? 'complete' : 'failed';
  e.timer = EVENT_RESULT_SECONDS;
  const x = o.x ?? e.view.x, y = o.y ?? e.view.y;
  if (o.pay ?? g >= 1) pay(w, e, g, o.choice ?? 0, x, y);
  w.mapEvent!.results.push({ kind: e.kind, grade: g, tally: e.tally });
  if (e.phase === 'complete') w.outcomes.push({ t: 'eventComplete', kind: e.kind, grade: g });
  beat(w, e, e.phase === 'complete' ? 'complete' : 'failed', x, y, g);
}

export { TAU };

/** Two events never begin within EVENT_ONSET_GAP of each other (budget rule). */
export function canOnset(w: World): boolean {
  return w.time - w.mapEvent!.lastOnset >= EVENT_ONSET_GAP;
}

export function markOnset(w: World): void {
  w.mapEvent!.lastOnset = w.time;
}

/** A hostile event hit: `base` x the map's monster damage x the per-wave growth. */
export function eventDamage(w: World, base: number): number {
  return base * w.config.monsters.damageMultiplier * (1 + WAVE_DAMAGE_GROWTH * (Math.max(1, w.director.wave) - 1));
}


// --- Wave 2 primitives: fixtures, statues, dwell stones, boons ----------------------------------------------------------------

/** A destructible fixture of an event (a bloom, the Time Prism, a wheel): a hittable, inert monster the presenter draws as a prop. */
export function eventFixture(w: World, e: EventInstance, x: number, y: number, life: number, radius: number, kind?: MonsterKind): number {
  return eventMonster(w, e, kind ?? familyKind(w, 'bruiser', 'hunter'), x, y, { fixture: { life, radius } });
}

/**
 * Damage a fixture from the monsters' side (a bite, an eruption): it flashes and, when it runs out, dies uncredited. Returns true
 * when it was destroyed. Player damage reaches it through the ordinary hit path.
 */
export function damageFixture(w: World, i: number, amount: number): boolean {
  const m = w.monsters;
  if (!m.alive[i] || amount <= 0) return false;
  m.life[i] -= amount;
  m.hitFlash[i] = 1;
  if (m.life[i] > 0) return false;
  m.life[i] = 0;
  killMonster(w, i, DAMAGE_INDEX.physical, false);
  return true;
}

/** Life of a fixture as a share 0..1 (0 when it is gone). */
export function fixtureLife(w: World, id: number): number {
  const i = w.monsters.slotOf(id); // (monster id 0 is the first slot's first generation: a real id)
  return i < 0 ? 0 : Math.max(0, Math.min(1, w.monsters.life[i] / Math.max(1, w.monsters.maxLife[i])));
}

/** Thaw a statue: it wakes after a short shimmer (invulnerable and still, like a spawn) and hunts like any monster. */
export function thawStatue(w: World, id: number, shimmer = 0.9): boolean {
  const i = w.monsters.slotOf(id);
  if (i < 0 || !(w.monsters.flags[i] & MFLAG.frozen)) return false;
  w.monsters.flags[i] &= ~(MFLAG.frozen | MFLAG.unpushable);
  w.monsters.spawnTime[i] = shimmer;
  w.monsters.anim[i] = MONSTER_ANIM.spawn;
  const pk = w.monsters.pack[i];
  if (pk >= 0) w.packs[pk].aggro = true;
  return true;
}

/** Give a monster's loot extra quantity / rarity percent (Stasis Host statues), and mark a rival boss's exclusive unique roll. */
export function lootBonus(w: World, id: number, quantity: number, rarity = 0, rival?: number): void {
  w.mapEvent!.lootBonus.set(id, { quantity, rarity, ...(rival !== undefined ? { rival } : {}) });
}

/** A stone of a dwell choice: stand on it for `need` seconds. */
export interface Stone {
  x: number;
  y: number;
  r: number;
  /** Which choice it stands for (pact id, vow, boon: an index the presenter and the HUD text read). */
  n: number;
  /** Seconds each player has stood on it (decays when they step off). */
  dwell: Map<number, number>;
  /** 0 open, 1 chosen, 2 spent. */
  state: 0 | 1 | 2;
}

export function makeStone(x: number, y: number, r: number, n: number): Stone {
  return { x, y, r, n, dwell: new Map(), state: 0 };
}

/**
 * Choice by dwell: every living player's time on every open stone. A stone completes when one player has stood on it for `need`
 * seconds; the choice that resolves is the MOST-OCCUPIED stone at that moment (ties: the longest dwell, then the lowest index).
 * Returns the chosen index (its state becomes 1, the others 2) or -1 while nobody has decided. Deterministic: players are visited
 * in id order.
 */
export function tickStones(w: World, stones: Stone[], need: number): number {
  let ready = false;
  for (const s of stones) {
    if (s.state !== 0) continue;
    if (dwell(w, s.dwell, s.x, s.y, s.r, DT, 1) >= need) ready = true;
  }
  if (!ready) return -1;
  let best = -1, bestCount = -1, bestDwell = -1;
  stones.forEach((s, k) => {
    if (s.state !== 0) return;
    let count = 0, longest = 0;
    for (const p of w.living) if (Math.hypot(p.x - s.x, p.y - s.y) <= s.r) count++;
    for (const t of s.dwell.values()) longest = Math.max(longest, t);
    if (longest <= 0) return;
    if (count > bestCount || (count === bestCount && longest > bestDwell + 1e-9)) { best = k; bestCount = count; bestDwell = longest; }
  });
  if (best < 0) return -1;
  stones.forEach((s, k) => { s.state = k === best ? 1 : 2; s.dwell.clear(); });
  return best;
}

/** The ground views of a stone set: v = dwell percent of the most-standing player (255 chosen, 254 spent), n = the choice. */
export function stoneZones(stones: readonly Stone[], need: number, out: MapEventView['zones']): void {
  for (const s of stones) {
    let longest = 0;
    for (const t of s.dwell.values()) longest = Math.max(longest, t);
    out.push({ kind: 'stone', x: s.x, y: s.y, r: s.r, a: 0, v: s.state === 1 ? 255 : s.state === 2 ? 254 : Math.min(100, Math.round(longest / need * 100)), n: s.n });
  }
}

/** `count` points on a circle round (cx, cy), pushed out of solid props; the first at `angle`. */
export function ringPoints(w: World, cx: number, cy: number, r: number, count: number, angle: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let k = 0; k < count; k++) {
    const a = angle + k * TAU / count;
    out.push(placeAt(cx + Math.cos(a) * r, cy + Math.sin(a) * r, w.arenaRadius, w.props));
  }
  return out;
}
