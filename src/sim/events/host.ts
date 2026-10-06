// STASIS HOST (event id 'host'). A frozen legion (24 statues on two rings) stands round a Time Prism. The thaw bar fills with
// every kill on the map and with time; each 1/24 of it wakes the next statue in ring order. Shatter the prism and the shockwave
// (telegraphed) thaws every remaining statue at once and the payout doubles; leave it and they wake in streams. Statues are
// invulnerable and inert until thawed. Kill time grades it. docs/atlas-rework/C-map-events.md 7.5.
import type { MapEventGrade } from '../../contracts/map-events';
import { ELITE_BIT, type MonsterRarity } from '../../contracts/sim';
import { MAP_EVENT_WARNING_SECONDS } from '../../data/progression/map-events';
import {
  HOST_CLEARANCE, HOST_GRADE_SECONDS, HOST_INNER_RADIUS, HOST_LOOT_QUANTITY, HOST_OUTER_RADIUS, HOST_PARTIAL_SHARE, HOST_SKIN_PACE, HOST_PRISM_LIFE,
  HOST_PRISM_RADIUS, HOST_SHOCK_DAMAGE, HOST_SHOCK_RADIUS, HOST_SHOCK_SECONDS, HOST_STATUES, HOST_THAW_PER_KILL, HOST_THAW_PER_SECOND,
  HOST_THAW_SHIMMER,
} from '../../data/progression/events/host';
import { DT } from '../constants';
import { DAMAGE_INDEX } from '../math';
import { monsterDef } from '../rosters';
import { MFLAG } from '../stores';
import type { World } from '../world';
import {
  anchorSite, beat, canOnset, dismissMember, eventArea, eventDamage, eventFixture, eventMonster, familyKind, finish, fixtureLife, hasRoom, lootBonus,
  markOnset, mods, pickSite, placeAt, releaseMembers, skinOf, thawStatue,
} from './kit';
import type { EventInstance, EventKill, EventScript } from './types';

interface HostState {
  center: { x: number; y: number };
  prism: number;
  /** Statue ids in thaw order; `thawed` of them have been woken. */
  order: number[];
  alive: Set<number>;
  total: number;
  thawed: number;
  /** Thaw bar, percent 0..100. */
  bar: number;
  /** Seconds since the onset. */
  t: number;
  lastKills: number;
  shattered: boolean;
  /** Seconds until the shockwave lands (-1 = none). */
  shock: number;
  hint: number;
}

const state = (e: EventInstance) => e.s as HostState;

const scaleOf = (w: World) => (mods(w).timerScale ?? 1) * (1 + (mods(w).gradeEase ?? 0)) * HOST_SKIN_PACE[skinOf(w)];

export function hostGrade(seconds: number, scale = 1): MapEventGrade {
  return seconds <= HOST_GRADE_SECONDS[0] * scale ? 3 : seconds <= HOST_GRADE_SECONDS[1] * scale ? 2 : 1;
}

const count = (w: World) => Math.max(8, Math.round(HOST_STATUES * (mods(w).hostCount ?? 1)));

function reveal(w: World, e: EventInstance): boolean {
  const n = count(w);
  if (!canOnset(w) || !hasRoom(w, n + 1)) return false;
  const rule = { minPlayer: HOST_CLEARANCE, rim: HOST_OUTER_RADIUS + 25 };
  const at = anchorSite(w, e, 'host', rule) ?? pickSite(w, e.plan.angle, { ...rule, from: 0.05, to: 0.9 });
  const center = { x: at.x, y: at.y };
  const s: HostState = { center, prism: -1, order: [], alive: new Set(), total: 0, thawed: 0, bar: 0, t: 0, lastKills: w.kills, shattered: false, shock: -1, hint: 0 };
  e.s = s;
  const pi = eventFixture(w, e, center.x, center.y, HOST_PRISM_LIFE, HOST_PRISM_RADIUS, familyKind(w, 'bruiser', 'hunter'));
  if (pi < 0) return false;
  s.prism = w.monsters.id[pi];
  const rng = w.mapEvent!.rng;
  const inner = Math.round(n * 0.42);
  // A legion of melee bodies: a frozen crowd of archers and slingers thawing at once would be a wall of unreadable projectiles.
  const melee = w.roster.family.filter(k => { const r = monsterDef(k).role; return r !== 'artillery' && r !== 'support'; });
  const family = melee.length > 0 ? melee : w.roster.family;
  const plan: { r: number; a: number }[] = [];
  for (let k = 0; k < n; k++) {
    const ring = k < inner ? 0 : 1;
    const per = ring === 0 ? inner : n - inner, idx = ring === 0 ? k : k - inner;
    plan.push({ r: ring === 0 ? HOST_INNER_RADIUS : HOST_OUTER_RADIUS, a: e.plan.angle + (idx / per) * Math.PI * 2 + ring * 0.2 });
  }
  const skin = skinOf(w);
  for (let k = 0; k < n; k++) {
    const p = placeAt(center.x + Math.cos(plan[k].a) * plan[k].r, center.y + Math.sin(plan[k].a) * plan[k].r, w.arenaRadius, w.props);
    const rare = k % 6 === 3, magic = !rare && k % 4 === 1;
    const rarity: MonsterRarity = rare ? 'rare' : magic ? 'magic' : 'normal';
    const proof = skin === 'ashen' ? ELITE_BIT.fireProof : skin === 'ossuary' ? ELITE_BIT.coldProof : ELITE_BIT.stout;
    const mod = rare ? ELITE_BIT.fierce | proof : magic ? (rng.chance(0.5) ? ELITE_BIT.swift : ELITE_BIT.stout) : 0;
    const i = eventMonster(w, e, family[k % family.length], p.x, p.y, { rarity, mods: mod, frozen: true });
    if (i < 0) continue;
    const id = w.monsters.id[i];
    lootBonus(w, id, HOST_LOOT_QUANTITY);
    w.monsters.facing[i] = p.x >= center.x ? 1 : -1;
    s.order.push(id);
    s.alive.add(id);
  }
  s.total = s.order.length;
  e.phase = 'warning';
  e.timer = MAP_EVENT_WARNING_SECONDS;
  markOnset(w);
  beat(w, e, 'omen', center.x, center.y);
  return true;
}

function wake(w: World, e: EventInstance, upTo: number): void {
  const s = state(e);
  while (s.thawed < Math.min(upTo, s.total)) {
    const id = s.order[s.thawed++];
    const i = w.monsters.slotOf(id);
    if (i < 0) continue;
    if (thawStatue(w, id, HOST_THAW_SHIMMER)) beat(w, e, 'thaw', w.monsters.x[i], w.monsters.y[i], s.thawed);
  }
}

function tick(w: World, e: EventInstance): void {
  const s = state(e);
  if (e.phase === 'warning') {
    e.timer -= DT;
    if (e.timer <= 0) { e.phase = 'active'; s.lastKills = w.kills; beat(w, e, 'onset', s.center.x, s.center.y); }
    return;
  }
  if (e.phase !== 'active') return;
  const bossWave = w.config.waves.bossWave;
  if (bossWave > 0 && w.director.wave >= bossWave && !e.plan.required) return release(w, e);
  s.t += DT;
  const rate = mods(w).thawRate ?? 1;
  const kills = Math.max(0, w.kills - s.lastKills);
  s.lastKills = w.kills;
  s.bar = Math.min(100, s.bar + (HOST_THAW_PER_SECOND * DT + HOST_THAW_PER_KILL * kills) * rate);
  wake(w, e, s.shock >= 0 ? s.thawed : s.bar >= 100 ? s.total : Math.floor(s.bar / (100 / s.total)));
  if (s.shock >= 0) {
    s.shock -= DT;
    if (s.shock <= 0) {
      s.shock = -1;
      beat(w, e, 'crack', s.center.x, s.center.y, 1);
      wake(w, e, s.total);
      s.hint = 3;
    }
  }
  if (s.prism >= 0 && w.monsters.slotOf(s.prism) < 0) s.prism = -1;
  if (s.alive.size === 0) done(w, e);
}

function done(w: World, e: EventInstance): void {
  const s = state(e);
  e.tally = Math.round(s.t);
  if (s.prism >= 0) dismissMember(w, e, s.prism);
  s.prism = -1;
  finish(w, e, hostGrade(s.t, scaleOf(w)), { choice: s.shattered ? 1 : 0, x: s.center.x, y: s.center.y });
}

/** The boss wave comes: whatever is left is released into the horde. */
function release(w: World, e: EventInstance): void {
  const s = state(e);
  const fallen = s.total - s.alive.size;
  for (const id of s.alive) thawStatue(w, id, HOST_THAW_SHIMMER);
  if (s.prism >= 0) dismissMember(w, e, s.prism);
  s.prism = -1;
  releaseMembers(w, e);
  e.tally = Math.round(s.t);
  const partial = s.total > 0 && fallen / s.total >= HOST_PARTIAL_SHARE;
  finish(w, e, partial ? 1 : 0, { pay: partial, lost: !partial, choice: s.shattered ? 1 : 0, x: s.center.x, y: s.center.y });
}

function onKill(w: World, e: EventInstance, k: EventKill): void {
  const s = state(e);
  if (k.id === s.prism) {
    // The prism breaks: a telegraphed shockwave, then every remaining statue wakes at once.
    s.prism = -1;
    if (!k.credited || e.phase !== 'active') return;
    s.shattered = true;
    s.shock = HOST_SHOCK_SECONDS;
    s.hint = 2;
    const skin = skinOf(w);
    eventArea(w, 'slamWarning', s.center.x, s.center.y, HOST_SHOCK_RADIUS, HOST_SHOCK_SECONDS, {
      damage: eventDamage(w, HOST_SHOCK_DAMAGE), dtype: skin === 'ashen' ? DAMAGE_INDEX.fire : skin === 'ossuary' ? DAMAGE_INDEX.cold : DAMAGE_INDEX.physical,
      hurts: 'player', debuff: skin === 'ashen' ? 'burning' : skin === 'ossuary' ? 'chilled' : null,
    });
    beat(w, e, 'shatter', k.x, k.y, 1);
    return;
  }
  s.alive.delete(k.id);
  if (s.alive.size === 0 && e.phase === 'active') done(w, e);
}

function view(w: World, e: EventInstance): void {
  const s = state(e), v = e.view;
  v.x = s.center.x; v.y = s.center.y;
  v.objectives.length = 0; v.timers.length = 0; v.zones.length = 0; v.markers.length = 0;
  v.zones.push({ kind: 'altar', x: s.center.x, y: s.center.y, r: HOST_OUTER_RADIUS + 15, a: 0, v: Math.round(s.bar), n: s.shattered ? 1 : 0 });
  if (s.prism >= 0) v.markers.push({ icon: 'prism', x: s.center.x, y: s.center.y, v: Math.round(s.bar), w: Math.round(fixtureLife(w, s.prism) * 100) });
  if (e.phase === 'warning' || e.phase === 'available') { v.hint = 0; v.grade = 0; return; }
  if (e.phase !== 'active') { v.grade = e.grade; v.hint = 1; return; }
  const sc = scaleOf(w);
  v.grade = hostGrade(s.t, sc);
  v.objectives.push({ id: 0, cur: Math.round(s.bar), max: 100 }, { id: 1, cur: s.alive.size, max: s.total });
  v.timers.push({ id: 0, seconds: Math.max(0, HOST_GRADE_SECONDS[0] * sc - s.t), total: HOST_GRADE_SECONDS[0] * sc });
  v.hint = s.shock >= 0 ? 2 : s.bar >= 100 ? 3 : s.thawed > 0 ? 1 : 0;
}

function cancel(w: World, e: EventInstance): void {
  // The map is over (or the event dropped): the prism and any still-frozen statue must not linger; thawed ones are ordinary monsters.
  const st = state(e);
  for (const id of [...e.members]) {
    const i = w.monsters.slotOf(id);
    if (i >= 0 && (id === st.prism || (w.monsters.flags[i] & MFLAG.frozen))) dismissMember(w, e, id);
  }
}

export const hostScript: EventScript = { kind: 'host', reveal, tick, onKill, view, cancel };
