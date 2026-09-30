// The wave director: tell → fight, pack placement (the "hunt" part), off-screen streaming (the
// "survive" part), lieutenant and boss arrivals, volcanic hazards, and the map clear. The monsters
// come from the map's roster (w.roster, by RunConfig.theme: contracts/bestiary.ts THEME_ROSTER).
// Budgets and elite chances scale with the living party; the whole director holds still while
// nobody in the instance is alive (an empty or wiped map is frozen until someone comes through a
// portal).
import type { MonsterKind } from '../contracts/content';
import type { MonsterRarity } from '../contracts/sim';
import { KIND_INDEX, MAGIC_MODS, RARE_MODS, packWeight } from './archetypes';
import { removeHostileAreas, spawnArea } from './areas';
import { startBoss } from './bosses';
import { DT_FIRE, killMonster } from './combat';
import { cleanseAll } from './debuffs';
import {
  DT, HAZARD_MAX_INTERVAL, HAZARD_MIN_INTERVAL, INTRO_DELAY, MAX_LIVE_MONSTERS, PACK_MIN_DISTANCE,
  PACK_SHARE, PARTY_BUDGET_PER_PLAYER, PARTY_ELITE_PER_PLAYER, PRESSURE_BASE, PRESSURE_CHECK_TICKS, PRESSURE_PER_WAVE,
  PRESSURE_RADIUS, STREAM_ARC, STREAM_DEPTH, STREAM_FIRST_DELAY, STREAM_GROUP_AVG, STREAM_MARGIN, STREAM_MIN_GAP,
  STREAM_WINDOW, VIEW_HALF_H, VIEW_HALF_W, WAVE_DAMAGE_GROWTH,
} from './constants';
import { DAMAGE_INDEX, GOLDEN_ANGLE, TAU } from './math';
import { requiredEventPending } from './map-events';
import { monsterDef, monsterDefs } from './rosters';
import { nearestLiving } from './player';
import { clearHostileProjectiles } from './projectiles';
import { spawnClearRewards } from './props';
import { allocPack, partySize, spawnGroup, spawnMonster } from './spawn';
import type { Director, PlannedPack, PlayerState, WavePlan, World } from './world';

/** Wave budget for `wave` with `players` living players: base × countMultiplier × (1 + 0.25·(n−1)). */
export function waveBudget(w: World, wave: number, players: number): number {
  const cfg = w.config.waves;
  const party = 1 + PARTY_BUDGET_PER_PLAYER * (Math.max(1, players) - 1);
  return Math.max(0, Math.round((cfg.baseMonsters + cfg.monstersPerWave * (wave - 1)) * Math.max(0, w.config.monsters.countMultiplier) * party));
}

export function createDirector(mode: 'hideout' | 'map'): Director {
  return {
    phase: mode === 'hideout' ? 'hideout' : 'tell',
    wave: 0,
    waveTime: 0,
    intro: mode === 'hideout' ? 0 : INTRO_DELAY,
    tellWave: 0,
    tellTimer: 0,
    plan: null,
    planPlayers: 1,
    stream: { wave: 0, remaining: 0, timer: 0, interval: 1, sinceLast: 0, weights: [] },
    hazardTimer: 3,
    bossId: -1,
    lieutenantId: -1,
    bossSpawned: false,
    bossDefeated: false,
    bossDeathX: 0,
    bossDeathY: 0,
    cleared: false,
  };
}

export function updateDirector(w: World): void {
  const d = w.director;
  const cfg = w.config.waves;
  if (w.config.mode === 'hideout' || d.phase === 'cleared') return;
  // Nobody alive in the instance: the map holds its breath (no timers, no spawns).
  if (w.living.length === 0) return;
  if (cfg.count <= 0) {
    clearRun(w);
    return;
  }
  if (d.intro > 0) {
    d.intro -= DT;
    if (d.intro <= 0) beginTell(w, 1);
    refreshPhase(w);
    return;
  }
  const eventHolding = (w.mapEvent?.grace ?? 0) > 0 && (w.mapEvent?.view?.phase === 'warning' || w.mapEvent?.view?.phase === 'active');
  if (d.tellWave > 0 && !eventHolding) {
    d.tellTimer -= DT;
    if (d.tellTimer <= 0) startWave(w, d.tellWave);
  }
  if (d.wave > 0) {
    if (!eventHolding) {
      d.waveTime += DT;
      updateStream(w);
    }
    updateHazards(w);
    if (d.tellWave === 0 && !eventHolding) {
      const cleared = waveCleared(w);
      if (d.wave < cfg.count) {
        // The boss wave holds until the boss falls; other waves advance on clear or on time.
        const bossHolding = d.wave === cfg.bossWave && !d.bossDefeated;
        if (!bossHolding && (cleared || d.waveTime >= cfg.waveDuration - cfg.tellDuration)) beginTell(w, d.wave + 1);
      } else {
        const hasBoss = cfg.bossWave > 0 && cfg.bossWave <= cfg.count;
        const done = hasBoss ? d.bossDefeated && (cfg.bossWave === cfg.count || cleared) : cleared;
        if (done && !requiredEventPending(w)) {
          clearRun(w);
          return;
        }
      }
    }
  }
  refreshPhase(w);
}

function refreshPhase(w: World): void {
  const d = w.director;
  if (d.phase === 'cleared' || d.phase === 'hideout') return;
  if (d.tellWave > 0 || d.intro > 0) d.phase = 'tell';
  else if (d.bossId >= 0 && w.monsters.slotOf(d.bossId) >= 0) d.phase = 'boss';
  else d.phase = 'fight';
}

function waveCleared(w: World): boolean {
  return w.monsters.count === 0 && w.director.stream.remaining <= 0;
}

function beginTell(w: World, wave: number): void {
  const d = w.director;
  const plan = planWave(w, wave);
  d.plan = plan;
  d.planPlayers = partySize(w);
  d.tellWave = wave;
  d.tellTimer = Math.max(0, w.config.waves.tellDuration);
  w.events.push({ t: 'waveTell', wave, families: plan.families, lieutenant: plan.lieutenant, boss: plan.boss });
}

/**
 * Decide a wave's composition (at tell time, so the preview names exactly what will come), for
 * the party alive right now. A party change before the wave starts is absorbed by the stream.
 */
export function planWave(w: World, wave: number): WavePlan {
  const cfg = w.config.waves;
  const s = w.config.monsters;
  const rng = w.worldRng;
  const boss = wave === cfg.bossWave;
  const lieutenant = wave === cfg.lieutenantWave;
  const n = partySize(w);
  // The full budget every wave (the boss wave too: her summons ride on top of a real horde).
  const budget = waveBudget(w, wave, n);
  const elite = 1 + PARTY_ELITE_PER_PLAYER * (n - 1);

  const defs = monsterDefs();
  const family = w.roster.family;
  const weights = family.map((kind) => ({ kind, weight: packWeight(defs[KIND_INDEX[kind]], wave) })).filter((e) => e.weight > 0);
  if (weights.length === 0) weights.push({ kind: family[0], weight: 1 });
  const packBudget = Math.round(budget * PACK_SHARE);
  const streamCount = budget - packBudget;

  const packs: PlannedPack[] = [];
  const perPack = new Map<MonsterKind, number>();
  let left = packBudget;
  while (left > 0) {
    const size = groupSize(left, rng);
    // 1–3 archetypes per pack.
    const pool = weights.slice();
    const types: { kind: MonsterKind; weight: number }[] = [];
    const nTypes = Math.min(pool.length, rng.int(1, 3));
    for (let t = 0; t < nTypes; t++) {
      const pick = rng.weighted(pool, (e) => e.weight);
      if (!pick) break;
      types.push(pick);
      pool.splice(pool.indexOf(pick), 1);
    }
    const members: MonsterKind[] = [];
    perPack.clear();
    for (let k = 0; k < size; k++) {
      let kind = (rng.weighted(types, (e) => e.weight) ?? types[0]).kind;
      // Kinds capped per pack (heavy bruisers) overflow into the family's first member.
      const cap = defs[KIND_INDEX[kind]].maxPerPack;
      if (cap !== undefined) {
        const n = (perPack.get(kind) ?? 0) + 1;
        perPack.set(kind, n);
        if (n > cap) kind = family[0];
      }
      members.push(kind);
    }
    // Heaviest first: a rare pack's leader is its most imposing member.
    members.sort((a, b) => defs[KIND_INDEX[b]].life - defs[KIND_INDEX[a]].life);
    let rarity: MonsterRarity = 'normal';
    let mods = 0;
    if (rng.next() < s.rarePackChance * elite) {
      rarity = 'rare';
      const two = rng.shuffle(RARE_MODS).slice(0, 2);
      mods = two[0] | two[1];
    } else if (rng.next() < s.magicPackChance * elite) {
      rarity = 'magic';
      mods = rng.pick(MAGIC_MODS);
    }
    packs.push({ members, rarity, mods });
    left -= size;
  }

  // Heavy hitters arrive in the stream at a reduced rate (MonsterDef.streamWeight).
  const streamWeights = weights.map((e) => ({ kind: e.kind, weight: e.weight * (defs[KIND_INDEX[e.kind]].streamWeight ?? 1) }));
  const present = new Set<MonsterKind>();
  for (const pk of packs) for (const k of pk.members) present.add(k);
  if (streamCount > 0) for (const e of streamWeights) present.add(e.kind);
  const families = family.filter((k) => present.has(k));
  return { wave, packs, streamCount, streamWeights, families, lieutenant, boss };
}

/**
 * Next group size (4–8) taken from `left` monsters. The tail is split so no group is left with
 * fewer than 4: ≤ 8 go together, 9–12 split into two halves. Only a total below 4 makes a
 * smaller group.
 */
function groupSize(left: number, rng: World['worldRng']): number {
  if (left <= 8) return left;
  if (left <= 12) return Math.ceil(left / 2);
  return rng.int(4, 8);
}

function startWave(w: World, wave: number): void {
  const d = w.director;
  const cfg = w.config.waves;
  const planned = d.plan && d.plan.wave === wave;
  const plan = planned && d.plan ? d.plan : planWave(w, wave);
  const plannedFor = planned ? d.planPlayers : partySize(w);
  d.plan = null;
  d.tellWave = 0;
  d.wave = wave;
  d.waveTime = 0;
  placePacks(w, plan);
  // The budget is fixed at wave start: players who joined (or fell) since the tell change the
  // stream, so the previewed packs stay exactly what was announced.
  const partyDelta = waveBudget(w, wave, partySize(w)) - waveBudget(w, wave, plannedFor);
  // Unspent stream from the previous wave rolls into this one. Groups of ~6 arrive on a regular
  // cadence across the wave; the pressure floor (updateStream) pulls them forward when the
  // party is clearing faster than they arrive.
  const count = Math.max(0, plan.streamCount + partyDelta) + Math.max(0, d.stream.remaining);
  const groups = Math.max(1, Math.ceil(count / STREAM_GROUP_AVG));
  const interval = Math.max(0.5, (STREAM_WINDOW * Math.max(1, cfg.waveDuration)) / groups);
  d.stream = {
    wave, remaining: count, timer: Math.max(STREAM_FIRST_DELAY, interval * 0.5), interval, sinceLast: 0, weights: plan.streamWeights,
  };
  if (plan.lieutenant) spawnLieutenant(w, wave);
  if (plan.boss) spawnBoss(w, wave);
  d.hazardTimer = Math.max(d.hazardTimer, 2);
  w.events.push({ t: 'waveStart', wave });
  w.outcomes.push({ t: 'waveStart', wave });
}

/** A random living player (the director only runs while someone is alive). */
function anyLiving(w: World): PlayerState {
  return w.living.length === 1 ? w.living[0] : w.worldRng.pick(w.living);
}

/** Squared distance from a point to the nearest living player. */
function nearestLivingD2(w: World, x: number, y: number): number {
  let best = Infinity;
  for (const p of w.living) {
    const dx = p.x - x;
    const dy = p.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < best) best = d2;
  }
  return best;
}

/**
 * A point roughly `dist` from a random living player, inside the arena and at least ~0.8·dist
 * from every other living player (or the arena's far side from the party as a fallback).
 */
function pointAway(w: World, dist: number): { x: number; y: number } {
  const p = anyLiving(w);
  const R = w.arenaRadius;
  const rng = w.worldRng;
  const lim = R - 60;
  const clear2 = dist * 0.8 * (dist * 0.8);
  for (let k = 0; k < 16; k++) {
    const a = rng.range(0, TAU);
    const x = p.x + Math.cos(a) * dist;
    const y = p.y + Math.sin(a) * dist;
    if (x * x + y * y <= lim * lim && nearestLivingD2(w, x, y) >= clear2) return { x, y };
  }
  let cx = 0;
  let cy = 0;
  for (const q of w.living) {
    cx += q.x / w.living.length;
    cy += q.y / w.living.length;
  }
  const l = Math.hypot(cx, cy);
  const ux = l > 1 ? -cx / l : 0;
  const uy = l > 1 ? -cy / l : -1;
  return { x: ux * (R - 80), y: uy * (R - 80) };
}

/** 60% of the wave: packs spread over the arena on a golden-angle spiral, away from every player. */
function placePacks(w: World, plan: WavePlan): void {
  const n = plan.packs.length;
  if (n === 0) return;
  const R = w.arenaRadius;
  const rng = w.worldRng;
  const total = n * 3 + 6;
  const rot = rng.range(0, TAU);
  const pts: { x: number; y: number }[] = [];
  const minD2 = PACK_MIN_DISTANCE * PACK_MIN_DISTANCE;
  for (let k = 0; k < total; k++) {
    const r = (R - 70) * Math.sqrt((k + 0.5) / total);
    const a = k * GOLDEN_ANGLE + rot;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (nearestLivingD2(w, x, y) >= minD2) pts.push({ x, y });
  }
  const chosen = rng.shuffle(pts).slice(0, n);
  while (chosen.length < n) chosen.push(pointAway(w, Math.min(PACK_MIN_DISTANCE, R * 0.6)));
  for (let k = 0; k < n; k++) {
    const planned = plan.packs[k];
    const { x, y } = chosen[k];
    const pack = allocPack(w, x, y, plan.wave, false, planned.rarity, false);
    spawnGroup(w, planned.members, x, y, pack, planned.rarity, planned.mods, plan.wave);
  }
}

/** Distance from a player to the edge of their camera's view box along bearing `a`. */
export function viewEdgeDistance(a: number): number {
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  return Math.min(VIEW_HALF_W / Math.max(1e-3, c), VIEW_HALF_H / Math.max(1e-3, s));
}

/** Whether (x, y) is on screen for any living player other than `except`. */
function inOtherView(w: World, x: number, y: number, except: PlayerState): boolean {
  for (const q of w.living) {
    if (q !== except && Math.abs(x - q.x) < VIEW_HALF_W && Math.abs(y - q.y) < VIEW_HALF_H) return true;
  }
  return false;
}

/** Whether the stream point along bearing `a` (just past p's view edge) is inside the arena and off every other screen. */
function arcPointClear(w: World, p: PlayerState, a: number, lim: number): boolean {
  const r = viewEdgeDistance(a) + STREAM_MARGIN + STREAM_DEPTH * 0.5;
  const x = p.x + Math.cos(a) * r;
  const y = p.y + Math.sin(a) * r;
  return x * x + y * y <= lim * lim && !inOtherView(w, x, y, p);
}

/** Past another player's view edge, a stream member steps further out in these increments. */
const STREAM_PUSH_STEP = 40;
const STREAM_PUSH_MAX = 320;

/**
 * 40% of the wave: groups of 4–8 arrive from just off-screen of a living player, already hunting,
 * spread along an arc of ±STREAM_ARC around one bearing (a line sweeping in rather than a clump).
 * Each member appears just past the edge of that player's view box along its own bearing (the box
 * is wider than tall, so the distance depends on the direction), and the bearing is chosen so the
 * group doesn't pop up in plain sight of another party member either. Points pulled back inside
 * the arena edge can land in view; the spawn animation covers them. On the regular cadence the
 * group goes to a random living player; a pressure pull brings it to the player with the fewest
 * hunters around.
 */
function updateStream(w: World): void {
  const d = w.director;
  const s = d.stream;
  if (s.remaining <= 0) return;
  s.sinceLast += DT;
  if (w.monsters.count >= MAX_LIVE_MONSTERS) return;
  // Field cleared but more are coming: hurry them along so a strong party isn't kept waiting.
  if (w.monsters.count === 0 && s.timer > 0.6) s.timer = 0.6;
  // Pressure floor: too few hunters near some player → the next group comes now, to them.
  let pulled: PlayerState | null = null;
  if (s.timer > 0 && d.waveTime >= STREAM_FIRST_DELAY && s.sinceLast >= STREAM_MIN_GAP && w.tick % PRESSURE_CHECK_TICKS === 0) {
    pulled = leastPressured(w, PRESSURE_RADIUS, PRESSURE_BASE + PRESSURE_PER_WAVE * d.wave);
    if (pulled) s.timer = 0;
  }
  s.timer -= DT;
  if (s.timer > 0) return;
  s.timer += s.interval;
  if (s.timer < s.interval * 0.5) s.timer = s.interval * 0.5; // a pull restarts the cadence
  s.sinceLast = 0;
  const rng = w.worldRng;
  const count = groupSize(s.remaining, rng);
  s.remaining -= count;
  const p = pulled ?? anyLiving(w);
  const lim = w.arenaRadius - 30;
  // A bearing whose whole arc (centre and both ends) lies inside the arena and off every other
  // player's screen; failing that one whose centre does; else the far side of the arena.
  let bearing = 0;
  let found = false;
  let fallback = Number.NaN;
  for (let k = 0; k < 12 && !found; k++) {
    bearing = rng.range(0, TAU);
    if (!arcPointClear(w, p, bearing, lim)) continue;
    if (Number.isNaN(fallback)) fallback = bearing;
    found = arcPointClear(w, p, bearing - STREAM_ARC, lim) && arcPointClear(w, p, bearing + STREAM_ARC, lim);
  }
  if (!found) bearing = Number.isNaN(fallback) ? Math.atan2(-p.y, -p.x) : fallback;
  const members: MonsterKind[] = [];
  for (let k = 0; k < count; k++) members.push((rng.weighted(s.weights, (e) => e.weight) ?? s.weights[0]).kind);
  const r0 = viewEdgeDistance(bearing) + STREAM_MARGIN + STREAM_DEPTH * 0.5;
  const pack = allocPack(w, p.x + Math.cos(bearing) * r0, p.y + Math.sin(bearing) * r0, s.wave, true, 'normal', true);
  for (let k = 0; k < count; k++) {
    const u = count > 1 ? k / (count - 1) - 0.5 : 0;
    const a = bearing + u * 2 * STREAM_ARC + rng.range(-0.04, 0.04);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    let r = viewEdgeDistance(a) + STREAM_MARGIN + rng.range(0, STREAM_DEPTH);
    // A member that would pop up on another player's screen steps further out along its bearing.
    for (let extra = 0; extra < STREAM_PUSH_MAX && inOtherView(w, p.x + ca * r, p.y + sa * r, p); extra += STREAM_PUSH_STEP) {
      r += STREAM_PUSH_STEP;
    }
    let x = p.x + ca * r;
    let y = p.y + sa * r;
    // Arc points past the arena edge are pulled back inside it.
    const dd = Math.hypot(x, y);
    if (dd > lim) {
      x *= lim / dd;
      y *= lim / dd;
    }
    spawnMonster(w, members[k], x, y, { pack, wave: s.wave });
  }
}

const hunterCounts = new Int32Array(8);

/**
 * The living player with the fewest hunting monsters (stream, aggro packs, summons) within
 * `radius`, if that count is below `floor`; otherwise null. One pass over the monsters.
 */
function leastPressured(w: World, radius: number, floor: number): PlayerState | null {
  const m = w.monsters;
  const living = w.living;
  const n = living.length;
  const r2 = radius * radius;
  hunterCounts.fill(0);
  for (let i = 0; i < m.hwm; i++) {
    if (!m.alive[i]) continue;
    const pk = m.pack[i];
    if (pk >= 0 && !w.packs[pk].aggro) continue;
    const x = m.x[i];
    const y = m.y[i];
    for (let k = 0; k < n; k++) {
      const dx = x - living[k].x;
      const dy = y - living[k].y;
      if (dx * dx + dy * dy <= r2) hunterCounts[k]++;
    }
  }
  let best: PlayerState | null = null;
  let bestCount = floor;
  for (let k = 0; k < n; k++) {
    if (hunterCounts[k] < bestCount) {
      bestCount = hunterCounts[k];
      best = living[k];
    }
  }
  return best;
}

/** The map's lieutenant (THEME_ROSTER) arrives with its wave, away from the party. */
function spawnLieutenant(w: World, wave: number): void {
  const d = w.director;
  const m = w.monsters;
  const kind = w.roster.lieutenant;
  const pos = pointAway(w, 320);
  const pk = allocPack(w, pos.x, pos.y, wave, false, 'normal', true);
  const i = spawnMonster(w, kind, pos.x, pos.y, { pack: pk, wave, lieutenant: true });
  if (i < 0) return;
  d.lieutenantId = m.id[i];
  monsterDef(kind).onSpawn?.(w, i, pk, pos.x, pos.y);
}

/** The map's boss (THEME_ROSTER) arrives with the final wave. */
function spawnBoss(w: World, wave: number): void {
  const d = w.director;
  const m = w.monsters;
  const kind = w.roster.boss;
  const def = monsterDef(kind);
  const pos = pointAway(w, 210);
  const pk = allocPack(w, pos.x, pos.y, wave, false, 'normal', true);
  const i = spawnMonster(w, kind, pos.x, pos.y, { pack: pk, wave, boss: true });
  if (i < 0) return;
  startBoss(w, i, def);
  d.bossId = m.id[i];
  d.bossSpawned = true;
  w.events.push({ t: 'bossSpawn', x: pos.x, y: pos.y });
  def.onSpawn?.(w, i, pk, pos.x, pos.y);
}

/** Volcanic maps: telegraphed eruptions around (and ahead of) every living player, leaving fire pools. */
function updateHazards(w: World): void {
  const s = w.config.monsters;
  const d = w.director;
  if (!s.hazards) return;
  d.hazardTimer -= DT;
  if (d.hazardTimer > 0) return;
  const rng = w.worldRng;
  d.hazardTimer = rng.range(HAZARD_MIN_INTERVAL, HAZARD_MAX_INTERVAL);
  const dmg = 12 * s.damageMultiplier * (1 + WAVE_DAMAGE_GROWTH * (d.wave - 1));
  const lim = w.arenaRadius - 24;
  for (const p of w.living) eruptAround(w, p, rng.int(1, 3), dmg, lim);
}

function eruptAround(w: World, p: PlayerState, n: number, dmg: number, lim: number): void {
  const rng = w.worldRng;
  for (let k = 0; k < n; k++) {
    let x: number;
    let y: number;
    if (k === 0) {
      x = p.x + p.vx * 0.9 + rng.range(-15, 15);
      y = p.y + p.vy * 0.9 + rng.range(-15, 15);
    } else {
      const a = rng.range(0, TAU);
      const r = rng.range(40, 140);
      x = p.x + Math.cos(a) * r;
      y = p.y + Math.sin(a) * r;
    }
    const dd = Math.hypot(x, y);
    if (dd > lim) {
      x *= lim / dd;
      y *= lim / dd;
    }
    spawnArea(w, 'eruptionWarning', x, y, 30, 1.2, {
      damage: dmg, dtype: DAMAGE_INDEX.fire, hurts: 'player', poolDuration: 3, poolDamage: dmg * 0.2,
    });
  }
}

/**
 * The boss fell (or the last wave is done): everything left crumbles and grants XP, rewards appear,
 * and the survivors' debuffs lift (a burn or a bleed must not kill anyone on the way to the chest).
 */
function clearRun(w: World): void {
  const anchor = clearAnchor(w);
  const d = w.director;
  d.phase = 'cleared';
  d.cleared = true;
  d.tellWave = 0;
  d.stream.remaining = 0;
  const m = w.monsters;
  for (let i = 0; i < m.hwm; i++) if (m.alive[i]) killMonster(w, i, DT_FIRE, false);
  clearHostileProjectiles(w);
  removeHostileAreas(w);
  for (const p of w.living) cleanseAll(w, p);
  w.vacuum = true;
  spawnClearRewards(w, anchor.x, anchor.y);
  w.events.push({ t: 'cleared', x: anchor.x, y: anchor.y });
  w.outcomes.push({ t: 'cleared' });
}

/** Where the rewards appear: by the living player nearest to where the boss fell. */
function clearAnchor(w: World): { x: number; y: number } {
  const d = w.director;
  const bx = d.bossDefeated ? d.bossDeathX : 0;
  const by = d.bossDefeated ? d.bossDeathY : 0;
  const p = nearestLiving(w, bx, by);
  return p ? { x: p.x, y: p.y } : { x: bx, y: by };
}
