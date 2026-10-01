// RIVAL CROWNS (event id 'secondCrown'). At the boss wave a rival claimant arrives from the far rim 20 s after the map's boss:
// the boss of a different roster, 60% life, 80% damage, phase-1 kit only. Whoever falls first, the survivor is empowered (heals
// 20%, +30% damage and speed, a visible glow). Both must die. docs/atlas-rework/C-map-events.md 6.5.
//
// Wave 2: the Feud (while both live, their minions fight each other in skirmishes: kinds of the map's roster against kinds of the
// rival's, uncredited, never the boss bodies), the combined telegraph budget (at most two large boss telegraphs at once: the RIVAL's
// next cast waits, never the first boss's), the exclusive unique roll (each boss rolls its own theme's uniques: lootBonus rival),
// the rival's timers run 1.5 s behind and from 240 s both bosses enrage (+2% damage every 10 s).
import type { MonsterKind } from '../../contracts/content';
import type { MapEventGrade } from '../../contracts/map-events';
import { THEME_ROSTER } from '../../contracts/bestiary';
import {
  RIVAL_ARRIVAL_SECONDS, RIVAL_BUDGET_LARGE, RIVAL_BUDGET_MAX_HOLD, RIVAL_CLEARANCE, RIVAL_DAMAGE, RIVAL_ENRAGE_BONUS,
  RIVAL_ENRAGE_SECONDS, RIVAL_ENRAGE_STEP, RIVAL_FEUD_DAMAGE, RIVAL_FEUD_INTERVAL, RIVAL_FEUD_REACH, RIVAL_GRADE_SECONDS, RIVAL_SKIN_PACE, RIVAL_LIFE,
  RIVAL_OFFSET_SECONDS, RIVAL_SHIMMER_SECONDS, RIVAL_SPOILS_HEAL,
} from '../../data/progression/map-events';
import { stop } from '../behaviour';
import { KIND_BY_INDEX } from '../archetypes';
import { killMonster } from '../combat';
import { bossRuntime, startBoss } from '../bosses';
import { DT } from '../constants';
import { MSTATE } from '../stores';
import type { PlayerState } from '../world';
import { monsterDef } from '../rosters';
import { allocPack, spawnMonster } from '../spawn';
import { MFLAG } from '../stores';
import type { World } from '../world';
import { beat, eventArea, finish, hasRoom, lootBonus, mods, pickSite, skinOf } from './kit';
import type { EventInstance, EventKill, EventScript } from './types';

interface RivalState {
  a: number;
  b: number;
  stage: 'wait' | 'shimmer' | 'fight' | 'done';
  countdown: number;
  site: { x: number; y: number };
  kind: MonsterKind;
  /** Seconds since the rival arrived. */
  fight: number;
  fallen: number;
  spoils: boolean;
  /** Seconds the rival still stands back after arriving (its timers run behind the first boss's). */
  offset: number;
  /** Continuous seconds the rival's current cast has been held by the telegraph budget. */
  held: number;
  feudT: number;
  /** Enrage steps applied so far. */
  enraged: number;
  /** Skirmish kills so far (tests, telemetry). */
  feudKills: number;
}

const state = (e: EventInstance) => e.s as RivalState;

/** The rival is the boss of a different roster, chosen from the plan (deterministic). */
export function rivalKind(w: World, variant: number): MonsterKind {
  const skin = skinOf(w);
  const pool: MonsterKind[] = (['cinderMatriarch', 'hollowWarden', 'varkus'] as MonsterKind[]).filter((k, n) => ['ashen', 'ossuary', 'coliseum'][n] !== skin);
  return pool[variant % pool.length];
}

/** Grade by the fight's length; timer scale and grade ease stretch both thresholds. */
export function rivalGrade(seconds: number, scale = 1): MapEventGrade {
  return seconds <= RIVAL_GRADE_SECONDS[0] * scale ? 3 : seconds <= RIVAL_GRADE_SECONDS[1] * scale ? 2 : 1;
}

const scaleOf = (w: World) => (mods(w).timerScale ?? 1) * (1 + (mods(w).gradeEase ?? 0)) * RIVAL_SKIN_PACE[skinOf(w)];

/** The map is not won while the rival is still to come. */
export function rivalPending(e: EventInstance): boolean {
  const s = e.s as RivalState | undefined;
  return !!s && (s.stage === 'wait' || s.stage === 'shimmer');
}

function reveal(w: World, e: EventInstance): boolean {
  const a = w.director.bossId;
  const site = pickSite(w, e.plan.angle, { minPlayer: RIVAL_CLEARANCE, rim: 90, from: 0.85, to: 1 });
  e.s = { a, b: 0, stage: 'wait', countdown: RIVAL_ARRIVAL_SECONDS, site, kind: rivalKind(w, e.plan.variant ?? 0), fight: 0, fallen: 0, spoils: false,
    offset: 0, held: 0, feudT: 0, enraged: 0, feudKills: 0 } satisfies RivalState;
  const i = a >= 0 ? w.monsters.slotOf(a) : -1;
  if (i >= 0) { e.members.add(a); w.mapEvent!.members.set(a, e); lootBonus(w, a, 0, 0, mods(w).rivalUnique ?? 1); }
  e.phase = 'warning';
  e.hold = 8;
  beat(w, e, 'omen', site.x, site.y);
  return true;
}

function tick(w: World, e: EventInstance): void {
  const s = state(e);
  if (e.phase !== 'warning' && e.phase !== 'active') return;
  if (s.stage === 'wait') {
    s.countdown -= DT;
    if (s.countdown <= 0) {
      s.stage = 'shimmer';
      s.countdown = RIVAL_SHIMMER_SECONDS;
      eventArea(w, 'echoMark', s.site.x, s.site.y, 60, RIVAL_SHIMMER_SECONDS);
      beat(w, e, 'onset', s.site.x, s.site.y);
    }
    return;
  }
  if (s.stage === 'shimmer') {
    s.countdown -= DT;
    if (s.countdown <= 0 && hasRoom(w, 1)) arrive(w, e);
    return;
  }
  if (s.stage === 'fight') {
    s.fight += DT;
    feud(w, s);
    enrage(w, s);
  }
  e.hold = 0;
}

function arrive(w: World, e: EventInstance): void {
  const s = state(e), m = w.monsters;
  const def = monsterDef(s.kind);
  const pk = allocPack(w, s.site.x, s.site.y, w.director.wave, false, 'normal', true);
  const i = spawnMonster(w, s.kind, s.site.x, s.site.y, { rarity: 'normal', pack: pk, wave: w.director.wave, boss: true });
  if (i < 0) return;
  m.maxLife[i] *= RIVAL_LIFE * (mods(w).rivalLife ?? 1); m.life[i] = m.maxLife[i];
  m.damage[i] *= RIVAL_DAMAGE;
  startBoss(w, i, def);
  bossRuntime(w, i).lockPhase = 1;
  s.b = m.id[i];
  s.stage = 'fight';
  e.phase = 'active';
  e.hold = 0;
  e.members.add(s.b); w.mapEvent!.members.set(s.b, e);
  lootBonus(w, s.b, 0, 0, mods(w).rivalUnique ?? 1);
  s.offset = RIVAL_OFFSET_SECONDS;
  m.attackCd[i] = Math.max(m.attackCd[i], RIVAL_OFFSET_SECONDS);
  if (w.monsters.slotOf(w.director.bossId) < 0) { w.director.bossId = s.b; w.boss = w.bossStates.get(s.b)!; }
  w.director.bossDefeated = false;
  w.events.push({ t: 'bossSpawn', x: s.site.x, y: s.site.y });
  def.onSpawn?.(w, i, pk, s.site.x, s.site.y);
  beat(w, e, 'arrive', s.site.x, s.site.y);
}

/** Which side a monster fights for in the Feud: 1 the map's roster, 2 the rival's, 0 neither (bosses, shared kinds). */
function faction(sides: { a: Set<string>; b: Set<string> }, kind: string): 0 | 1 | 2 {
  const ia = sides.a.has(kind), ib = sides.b.has(kind);
  return ia === ib ? 0 : ia ? 1 : 2;
}

function sidesOf(w: World, rivalKind: MonsterKind): { a: Set<string>; b: Set<string> } {
  const theme = (Object.keys(THEME_ROSTER) as (keyof typeof THEME_ROSTER)[]).find(t => THEME_ROSTER[t].boss === rivalKind);
  return { a: new Set<string>(w.roster.family), b: new Set<string>(theme ? THEME_ROSTER[theme].family : []) };
}

/** Direct, uncredited damage between two minions (no loot, no XP, never a boss body). */
function feudHit(w: World, i: number, amount: number): boolean {
  const m = w.monsters;
  m.life[i] -= amount;
  m.hitFlash[i] = 1;
  if (m.life[i] > 0) return false;
  m.life[i] = 0;
  m.xp[i] = 0;
  killMonster(w, i, m.dtype[i], false);
  return true;
}

/**
 * The Feud: every RIVAL_FEUD_INTERVAL seconds, while both bosses live, each minion of one side within reach of a minion of the other
 * trades a share of its damage with its nearest foe. Deterministic (slot order) and uncredited.
 */
function feud(w: World, s: RivalState): void {
  s.feudT -= DT;
  if (s.feudT > 0) return;
  s.feudT = RIVAL_FEUD_INTERVAL;
  const m = w.monsters;
  if (w.monsters.slotOf(s.a) < 0 || w.monsters.slotOf(s.b) < 0) return;
  const sides = sidesOf(w, s.kind);
  const one: number[] = [], two: number[] = [];
  for (let i = 0; i < m.hwm; i++) {
    if (!m.alive[i] || m.spawnTime[i] > 0 || (m.flags[i] & (MFLAG.boss | MFLAG.fixture | MFLAG.frozen | MFLAG.immune))) continue;
    const f = faction(sides, KIND_BY_INDEX[m.kind[i]]);
    if (f === 1) one.push(i); else if (f === 2) two.push(i);
  }
  if (one.length === 0 || two.length === 0) return;
  const hits = new Map<number, number>();
  const pick = (from: number[], to: number[]) => {
    for (const i of from) {
      let best = -1, bd = RIVAL_FEUD_REACH * RIVAL_FEUD_REACH;
      for (const j of to) {
        const d = (m.x[i] - m.x[j]) ** 2 + (m.y[i] - m.y[j]) ** 2;
        if (d < bd) { bd = d; best = j; }
      }
      if (best >= 0) hits.set(best, (hits.get(best) ?? 0) + m.damage[i] * RIVAL_FEUD_DAMAGE);
    }
  };
  pick(one, two);
  pick(two, one);
  // Ids first: a kill frees its slot, so apply by id.
  const ids = [...hits.keys()].map(j => ({ id: m.id[j], dmg: hits.get(j)! }));
  for (const h of ids) {
    const j = m.slotOf(h.id);
    if (j >= 0 && feudHit(w, j, h.dmg)) s.feudKills++;
  }
}

/** Hostile boss telegraphs larger than 60 units that are still warning. */
function largeTelegraphs(w: World, s: RivalState): number {
  let n = 0;
  for (const a of w.areas) {
    if (a.dead || a.hurts === 'none' || !(a.radius > 60) || a.age >= a.duration) continue;
    if (a.owner === s.a || a.owner === s.b) n++;
  }
  return n;
}

/** From RIVAL_ENRAGE_SECONDS after the rival arrives both bosses gain +2% damage every 10 s. */
function enrage(w: World, s: RivalState): void {
  if (s.fight < RIVAL_ENRAGE_SECONDS) return;
  const due = 1 + Math.floor((s.fight - RIVAL_ENRAGE_SECONDS) / RIVAL_ENRAGE_STEP);
  while (s.enraged < due) {
    s.enraged++;
    for (const id of [s.a, s.b]) {
      const i = id >= 0 ? w.monsters.slotOf(id) : -1;
      if (i >= 0) w.monsters.damage[i] *= 1 + RIVAL_ENRAGE_BONUS;
    }
  }
}

/** The rival waits behind the first boss's timers and holds its next cast while two large boss telegraphs are up. */
function drive(w: World, e: EventInstance, i: number, _t: PlayerState | null): boolean {
  const s = state(e), m = w.monsters;
  if (m.id[i] !== s.b || s.stage !== 'fight') return false;
  if (m.state[i] !== MSTATE.chase) { s.held = 0; return false; }
  if (s.offset > 0) { s.offset -= DT; stop(w, i); return true; }
  if (s.held < RIVAL_BUDGET_MAX_HOLD && largeTelegraphs(w, s) >= RIVAL_BUDGET_LARGE) {
    s.held += DT;
    stop(w, i);
    return true;
  }
  return false;
}

function onKill(w: World, e: EventInstance, k: EventKill): void {
  const s = state(e);
  if (!k.credited) return;
  s.fallen++;
  const survivor = k.id === s.a ? s.b : s.a;
  const j = s.stage === 'fight' ? w.monsters.slotOf(survivor) : -1;
  if (j >= 0 && s.stage === 'fight' && !s.spoils) {
    // Spoils: the survivor heals and is empowered (its glow is the visible cost of the choice).
    s.spoils = true;
    const m = w.monsters;
    m.life[j] = Math.min(m.maxLife[j], m.life[j] + m.maxLife[j] * RIVAL_SPOILS_HEAL);
    m.empowerTime[j] = 1e6;
    m.flags[j] |= MFLAG.heavy;
    beat(w, e, 'step', m.x[j], m.y[j], 1);
  }
  const bothDead = w.monsters.slotOf(s.a) < 0 && (s.b !== 0 && w.monsters.slotOf(s.b) < 0);
  if (bothDead && s.stage === 'fight') {
    s.stage = 'done';
    e.tally = Math.round(s.fight);
    finish(w, e, rivalGrade(s.fight, scaleOf(w)), { x: k.x, y: k.y });
  }
}

function view(w: World, e: EventInstance): void {
  const s = state(e), v = e.view;
  v.x = s.site.x; v.y = s.site.y;
  v.objectives.length = 0; v.timers.length = 0; v.zones.length = 0; v.markers.length = 0;
  v.grade = e.phase === 'active' ? rivalGrade(s.fight, scaleOf(w)) : e.grade;
  v.objectives.push({ id: 0, cur: s.fallen, max: 2 });
  const bj = s.b ? w.monsters.slotOf(s.b) : -1;
  if (bj >= 0) {
    v.objectives.push({ id: 1, cur: Math.max(0, Math.round(w.monsters.life[bj] / w.monsters.maxLife[bj] * 100)), max: 100 });
    v.markers.push({ icon: 'crown', x: w.monsters.x[bj], y: w.monsters.y[bj], v: 1 + (s.spoils ? 2 : 0), w: Math.round(w.monsters.life[bj] / w.monsters.maxLife[bj] * 100) });
    v.x = w.monsters.x[bj]; v.y = w.monsters.y[bj];
  }
  const aj = s.a >= 0 ? w.monsters.slotOf(s.a) : -1;
  if (aj >= 0) v.markers.push({ icon: 'crown', x: w.monsters.x[aj], y: w.monsters.y[aj], v: s.spoils ? 2 : 0, w: Math.round(w.monsters.life[aj] / w.monsters.maxLife[aj] * 100) });
  if (s.stage === 'wait' || s.stage === 'shimmer') {
    v.timers.push({ id: 0, seconds: Math.max(0, s.countdown + (s.stage === 'wait' ? RIVAL_SHIMMER_SECONDS : 0)), total: RIVAL_ARRIVAL_SECONDS + RIVAL_SHIMMER_SECONDS });
    v.hint = 0;
  } else {
    v.timers.push({ id: 1, seconds: Math.max(0, RIVAL_GRADE_SECONDS[0] * scaleOf(w) - s.fight), total: RIVAL_GRADE_SECONDS[0] * scaleOf(w) });
    v.hint = s.enraged > 0 ? 3 : s.spoils ? 2 : 1;
  }
}

export const rivalScript: EventScript = { kind: 'secondCrown', reveal, tick, drive, onKill, view };
