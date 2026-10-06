// Emitters of the power rework's roster batch 2 (SK3, docs/power-rework/skills.md 3): Gravity Well, Entropy Hex and Wither Field
// (zones at the cursor), Immolation Sigil (a delayed pillar), Voltaic Pulse (an expanding ring), Concussive Blast (a cone) and
// Static Lash (a beam). Their ground effects live in PlayerState.skillAreas and tick here before the monsters act; what a zone does
// to a monster is written into its store columns (pull, zone slow, Crushing, Hex weakening, Withered) and read by ai.ts and the
// damage pipeline. Every number is the resolved runtime def's (or SKILL_TIMING, WITHER); randomness only through damageMonster.
import type { SkillRuntimeDef } from '../../contracts/sim';
import { spawnArea } from '../areas';
import { applyDecay, damageMonster, exposeMonster, isHittable } from '../combat';
import { DT, MUZZLE_OFFSET } from '../constants';
import { coverBlocked, coverClip } from '../cover';
import { DAMAGE_INDEX } from '../math';
import { MFLAG } from '../stores';
import { WITHER } from '../../data/progression/combat';
import { SKILL_TIMING } from '../../data/progression/skill-timing';
import type { PlayerState, SkillArea, World } from '../world';
import { blastAt } from './roster';
import { tickDefence } from './defence';
import { augmentOf, hasFlag } from './projectile-mods';
import type { ConeBehaviour, LashBehaviour, PillarBehaviour, PulseBehaviour, ZoneBehaviour } from './types';

const DT_FIRE = DAMAGE_INDEX.fire;
const DT_VOID = DAMAGE_INDEX.void;
/** Hex exposure covers every type but physical. */
const HEX_TYPES = [DAMAGE_INDEX.fire, DAMAGE_INDEX.cold, DAMAGE_INDEX.lightning, DAMAGE_INDEX.void];
/** A pull never moves a monster past the zone's centre (it stops this close). */
const PULL_STOP = 4;

let cand = new Int32Array(0);

/** Hittable monsters within `radius` (plus their body) of (x, y), copied out of the grid query (in grid order). */
function inside(w: World, x: number, y: number, radius: number): number[] {
  if (cand.length < w.scratch.length) cand = new Int32Array(w.scratch.length);
  const m = w.monsters;
  const reach = radius + w.grid.maxRadius;
  const n = w.grid.query(x - reach, y - reach, x + reach, y + reach, cand);
  const out: number[] = [];
  for (let k = 0; k < n; k++) {
    const i = cand[k];
    if (!isHittable(w, i)) continue;
    const dx = m.x[i] - x;
    const dy = m.y[i] - y;
    const r = radius + m.radius[i];
    if (dx * dx + dy * dy <= r * r) out.push(i);
  }
  return out;
}

/** The cursor clamped to `reach` from the caster and inside the arena. */
function landing(w: World, p: PlayerState, aimX: number, aimY: number, reach: number): { x: number; y: number } {
  let x = aimX;
  let y = aimY;
  const d = Math.hypot(x - p.x, y - p.y);
  if (d > reach) {
    x = p.x + ((x - p.x) / d) * reach;
    y = p.y + ((y - p.y) / d) * reach;
  }
  const lim = Math.max(0, w.arenaRadius - 8);
  const d2 = x * x + y * y;
  if (d2 > lim * lim) {
    const l = Math.sqrt(d2);
    x = (x / l) * lim;
    y = (y / l) * lim;
  }
  return { x, y };
}

function addArea(p: PlayerState, kind: SkillArea['kind'], x: number, y: number, radius: number, duration: number, timer: number, speed: number, def: SkillRuntimeDef): void {
  p.skillAreas.push({ kind, x, y, radius, age: 0, duration, timer, speed, def, group: [] });
}

// --- Zones ---------------------------------------------------------------------------------------------------------------------

/** Gravity Well, Entropy Hex, Wither Field: a zone at the cursor for the def's duration and radius. */
export function emitZone(w: World, p: PlayerState, def: SkillRuntimeDef, b: ZoneBehaviour, aimX: number, aimY: number): void {
  const z = augmentOf(def, 'zone');
  if (!z) return;
  const at = landing(w, p, aimX, aimY, b.reach);
  const radius = def.radius > 0 ? def.radius : b.radius;
  const duration = def.duration > 0 ? def.duration : b.duration;
  spawnArea(w, b.area, at.x, at.y, radius, duration, { hurts: 'none', debuff: null, source: p.id });
  addArea(p, 'zone', at.x, at.y, radius, duration, z.interval, 0, def);
}

function tickZone(w: World, p: PlayerState, a: SkillArea): void {
  const z = augmentOf(a.def, 'zone');
  if (!z) return;
  const m = w.monsters;
  const def = a.def;
  const list = inside(w, a.x, a.y, a.radius);
  const linger = SKILL_TIMING.zoneLinger;
  // Continuous: the pull, the slow, Crushing, the Hex.
  for (const i of list) {
    if (z.pull > 0 && !(m.flags[i] & (MFLAG.unpushable | MFLAG.fixture | MFLAG.frozen))) {
      const dx = a.x - m.x[i];
      const dy = a.y - m.y[i];
      const d = Math.hypot(dx, dy);
      if (d > PULL_STOP) {
        const speed = Math.min(z.pull * (m.flags[i] & (MFLAG.boss | MFLAG.heavy) ? 0.5 : 1), (d - PULL_STOP) / DT);
        const fresh = m.pullTick[i] !== w.tick;
        m.pullVX[i] = (fresh ? 0 : m.pullVX[i]) + (dx / d) * speed;
        m.pullVY[i] = (fresh ? 0 : m.pullVY[i]) + (dy / d) * speed;
        m.pullTick[i] = w.tick;
      }
    }
    if (z.slow > 0) {
      m.zoneSlow[i] = m.zoneSlowTime[i] > 0 ? Math.max(m.zoneSlow[i], z.slow) : z.slow;
      m.zoneSlowTime[i] = linger;
    }
    if (z.taken > 0) {
      m.vulnBonus[i] = m.vulnTime[i] > 0 ? Math.max(m.vulnBonus[i], z.taken) : z.taken;
      m.vulnTime[i] = linger;
    }
    if (z.weaken > 0) {
      m.hexWeaken[i] = m.hexTime[i] > 0 ? Math.max(m.hexWeaken[i], z.weaken) : z.weaken;
      m.hexTime[i] = linger;
    }
    if (z.exposure > 0) for (const t of HEX_TYPES) exposeMonster(w, i, t, z.exposure);
  }
  // Every interval: the tick's damage (or Decay stack) and Withered.
  a.timer -= DT;
  if (a.timer > 1e-9 || a.age > a.duration + 1e-9) return;
  a.timer += z.interval;
  const dtype = DAMAGE_INDEX[def.damageType];
  for (const i of list) {
    if (!isHittable(w, i)) continue;
    if (z.withered > 0) {
      const live = m.witherTime[i] > 0 ? m.witherStacks[i] : 0;
      m.witherStacks[i] = Math.min(WITHER.maxStacks, live + z.withered);
      m.witherTime[i] = Math.max(m.witherTime[i], z.linger);
    }
    if (!(def.damage > 0)) continue;
    if (z.decay) applyDecay(w, i, def.damage, 1, p.id);
    else damageMonster(w, i, def.damage, dtype, def.critChance, def.critMultiplier, def.ailmentChance, 0, 0, 0, false, p.id);
  }
}

/** A zone ran out: Singularity's collapse. */
function endZone(w: World, p: PlayerState, a: SkillArea): void {
  const z = augmentOf(a.def, 'zone');
  if (!z || !(z.collapse > 0) || !(z.collapseRadius > 0)) return;
  w.events.push({ t: 'nova', playerId: p.id, skill: a.def.id, x: a.x, y: a.y, radius: z.collapseRadius });
  blastAt(w, a.x, a.y, z.collapseRadius, z.collapse, DT_VOID, a.def.critChance, a.def.critMultiplier, 0, p.id, 0.5);
}

// --- Immolation Sigil ----------------------------------------------------------------------------------------------------------

/** Immolation Sigil: `projectiles` sigils at the cursor (across the aim, `offset` either side of it), erupting after the telegraph. */
export function emitPillar(w: World, p: PlayerState, def: SkillRuntimeDef, b: PillarBehaviour, aimX: number, aimY: number, angle: number): void {
  const n = Math.max(1, Math.floor(def.projectiles));
  const at = landing(w, p, aimX, aimY, b.reach);
  const radius = def.radius > 0 ? def.radius : b.radius;
  const px = -Math.sin(angle);
  const py = Math.cos(angle);
  for (let k = 0; k < n; k++) {
    const o = n === 1 ? 0 : (k - (n - 1) / 2) * b.offset * 2;
    const x = at.x + px * o;
    const y = at.y + py * o;
    spawnArea(w, 'immolationSigil', x, y, radius, b.telegraph, { hurts: 'none', debuff: null, source: p.id });
    addArea(p, 'pillar', x, y, radius, b.telegraph, 0, 0, def);
  }
}

function erupt(w: World, p: PlayerState, a: SkillArea): void {
  const def = a.def;
  const group: number[] = [];
  blastAt(w, a.x, a.y, a.radius, def.damage, DAMAGE_INDEX[def.damageType], def.critChance, def.critMultiplier, def.ailmentChance, p.id, 0.5, group);
  if (def.flags.includes('brand')) {
    const m = w.monsters;
    for (const id of group) {
      const i = m.slotOf(id);
      if (i >= 0) exposeMonster(w, i, DT_FIRE, SKILL_TIMING.brandExposure);
    }
  }
  const g = augmentOf(def, 'ground');
  if (g && g.duration > 0 && g.damage > 0 && g.interval > 0) {
    spawnArea(w, 'fireTrail', a.x, a.y, g.radius, g.duration, {
      damage: g.damage, dtype: DT_FIRE, hurts: 'monsters', tickInterval: g.interval, firstTick: g.interval, source: p.id,
    });
  }
}

// --- Voltaic Pulse -------------------------------------------------------------------------------------------------------------

/** Voltaic Pulse: a ring grows from the caster at `speed` to the def's radius; each monster it reaches is struck once. */
export function emitPulse(w: World, p: PlayerState, def: SkillRuntimeDef, b: PulseBehaviour): void {
  const radius = def.radius > 0 ? def.radius : b.radius;
  w.events.push({ t: 'nova', playerId: p.id, skill: def.id, x: p.x, y: p.y, radius });
  addArea(p, 'pulse', p.x, p.y, radius, radius / b.speed, 0, b.speed, def);
}

function tickPulse(w: World, p: PlayerState, a: SkillArea): void {
  const def = a.def;
  const r = Math.min(a.radius, a.age * a.speed);
  const m = w.monsters;
  const dtype = DAMAGE_INDEX[def.damageType];
  for (const i of inside(w, a.x, a.y, r)) {
    if (a.group.includes(m.id[i])) continue;
    a.group.push(m.id[i]);
    damageMonster(w, i, def.damage, dtype, def.critChance, def.critMultiplier, def.ailmentChance, m.x[i] - a.x, m.y[i] - a.y, 0.5, true, p.id);
  }
}

// --- Concussive Blast ----------------------------------------------------------------------------------------------------------

/** Concussive Blast: every monster in the cone (the def's range and spread, toward the aim) takes the hit and is hurled back. */
export function emitCone(w: World, p: PlayerState, def: SkillRuntimeDef, b: ConeBehaviour, angle: number): void {
  const m = w.monsters;
  const half = def.spread / 2;
  const dtype = DAMAGE_INDEX[def.damageType];
  for (const i of inside(w, p.x, p.y, def.range)) {
    const dx = m.x[i] - p.x;
    const dy = m.y[i] - p.y;
    const d = Math.hypot(dx, dy);
    if (d > m.radius[i]) {
      let diff = Math.atan2(dy, dx) - angle;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      if (Math.abs(diff) > half + Math.asin(Math.min(1, m.radius[i] / d))) continue;
    }
    damageMonster(w, i, def.damage, dtype, def.critChance, def.critMultiplier, def.ailmentChance, dx, dy, b.knock, true, p.id);
  }
}

// --- Static Lash ---------------------------------------------------------------------------------------------------------------

/** Static Lash: the nearest enemy in sight within the def's range (Arc Lash: and the second-nearest); chains jump from the first. */
export function emitLash(w: World, p: PlayerState, def: SkillRuntimeDef, b: LashBehaviour, dirX: number, dirY: number): void {
  const m = w.monsters;
  let best = -1;
  let bestD = Infinity;
  let next = -1;
  let nextD = Infinity;
  for (const i of inside(w, p.x, p.y, def.range)) {
    if (coverBlocked(w, p.x, p.y, m.x[i], m.y[i], 0)) continue;
    const d = Math.hypot(m.x[i] - p.x, m.y[i] - p.y);
    if (d < bestD) {
      next = best;
      nextD = bestD;
      best = i;
      bestD = d;
    } else if (d < nextD) {
      next = i;
      nextD = d;
    }
  }
  const mx = p.x + dirX * MUZZLE_OFFSET;
  const my = p.y + dirY * MUZZLE_OFFSET;
  const dtype = DAMAGE_INDEX[def.damageType];
  if (best < 0) {
    const reach = Math.min(def.range * 0.5, 80);
    const fork = coverClip(w, p.x, p.y, Math.atan2(dirY, dirX), reach, 0);
    w.events.push({ t: 'chain', playerId: p.id, points: [mx, my, p.x + dirX * fork, p.y + dirY * fork], damageType: def.damageType });
    return;
  }
  const second = hasFlag(p, def, b.arc) ? next : -1;
  const secondId = second >= 0 ? m.id[second] : -1;
  // The first target and its chain.
  const points = [mx, my, m.x[best], m.y[best]];
  const hit = [m.id[best]];
  let cur = best;
  let fx = m.x[best];
  let fy = m.y[best];
  damageMonster(w, best, def.damage, dtype, def.critChance, def.critMultiplier, def.ailmentChance, fx - p.x, fy - p.y, 0.5, true, p.id);
  for (let c = 0; c < Math.floor(def.chains); c++) {
    let to = -1;
    let toD = Infinity;
    for (const i of inside(w, fx, fy, b.jump)) {
      if (i === cur || hit.includes(m.id[i]) || m.id[i] === secondId) continue;
      const d = Math.hypot(m.x[i] - fx, m.y[i] - fy);
      if (d < toD && !coverBlocked(w, fx, fy, m.x[i], m.y[i], 0)) {
        toD = d;
        to = i;
      }
    }
    if (to < 0) break;
    hit.push(m.id[to]);
    points.push(m.x[to], m.y[to]);
    damageMonster(w, to, def.damage * b.chainShare, dtype, def.critChance, def.critMultiplier, def.ailmentChance, m.x[to] - fx, m.y[to] - fy, 0.5, true, p.id);
    cur = to;
    fx = m.x[to];
    fy = m.y[to];
  }
  w.events.push({ t: 'chain', playerId: p.id, points, damageType: def.damageType });
  if (second >= 0 && isHittable(w, second)) {
    w.events.push({ t: 'chain', playerId: p.id, points: [mx, my, m.x[second], m.y[second]], damageType: def.damageType });
    damageMonster(w, second, def.damage * b.second, dtype, def.critChance, def.critMultiplier, def.ailmentChance, m.x[second] - p.x, m.y[second] - p.y, 0.5, true, p.id);
  }
}

// --- Upkeep --------------------------------------------------------------------------------------------------------------------

/** Zones, pillars and pulses (one tick, in the order they were cast). Dropped when she dies (combat.ts killPlayer). */
export function tickSkillAreas(w: World, p: PlayerState): void {
  const list = p.skillAreas;
  if (list.length === 0) return;
  let write = 0;
  for (let k = 0; k < list.length; k++) {
    const a = list[k];
    a.age += DT;
    let done = a.age >= a.duration - 1e-9;
    switch (a.kind) {
      case 'zone':
        tickZone(w, p, a);
        if (done) endZone(w, p, a);
        break;
      case 'pillar':
        if (done) erupt(w, p, a);
        break;
      case 'pulse':
        tickPulse(w, p, a);
        done = a.age * a.speed >= a.radius - 1e-9;
        break;
    }
    if (!done) list[write++] = a;
  }
  list.length = write;
}

/** Roster batch 2 upkeep for one player (one tick): the barrier, aegis and echo buffs, then the ground effects. */
export function tickRoster2(w: World, p: PlayerState): void {
  tickDefence(w, p);
  tickSkillAreas(w, p);
}
