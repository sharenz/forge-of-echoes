// Emitters of the power rework's roster batch 3 (SK4, docs/power-rework/skills.md 3 and 6): Meteor Rain (telegraphed meteors one after
// another around the cursor), Storm Step (the strikes of a lightning blink), Tempest Surge (cast speed and lightning pulses around
// her), Event Horizon (a pull toward a point, then a detonation). Blizzard is a zone of roster batch 2 (its brittle cold is read
// through roster3-state.ts). Every number is the resolved runtime def's (or SKILL_TIMING's, which the tooltips read too); randomness
// only from w.combatRng (the meteors' points) and damageMonster's own roll. The state lives in roster3-state.ts (WeakMaps): a world
// where nobody casts these skills carries none.
import type { SkillRuntimeDef } from '../../contracts/sim';
import { spawnArea } from '../areas';
import { damageMonster, isHittable } from '../combat';
import { DT, MUZZLE_OFFSET } from '../constants';
import { DAMAGE_INDEX, TAU } from '../math';
import { SKILL_TIMING } from '../../data/progression/skill-timing';
import type { PlayerState, World } from '../world';
import { hasFlag } from './projectile-mods';
import { prim, schedule, spawnTrail } from './primitives';
import { nextLink } from './primitives/chain';
import { blastAt, queueStrike } from './roster';
import { inside, landing, pullMonster } from './roster2';
import { peekRoster3, pruneBrittle, roster3Player, type Horizon, type SurgeState } from './roster3-state';
import type { DashBehaviour, HorizonBehaviour, MeteorsBehaviour, SurgeBehaviour } from './types';

const DT_LIGHTNING = DAMAGE_INDEX.lightning;
/** At most this many arcs are drawn per surge pulse (the hits themselves are not limited). */
const SURGE_ARCS = 3;

// --- Meteor Rain ---------------------------------------------------------------------------------------------------------------

/**
 * Meteor Rain: `projectiles` meteors at random points within the def's range of the cursor, one after another over the def's duration
 * (meteor k's circle appears k × duration / count after the cast); each lands `telegraph` s after its circle appears. The points are
 * drawn at the cast, so the rain is fixed the moment it is called.
 */
export function emitMeteors(w: World, p: PlayerState, def: SkillRuntimeDef, b: MeteorsBehaviour, aimX: number, aimY: number): void {
  const count = Math.max(1, Math.floor(def.projectiles));
  const at = landing(w, p, aimX, aimY, b.reach);
  const scatter = def.range > 0 ? def.range : b.scatter;
  const radius = def.radius > 0 ? def.radius : b.radius;
  const duration = def.duration > 0 ? def.duration : b.duration;
  const step = duration / count;
  const lim = Math.max(0, w.arenaRadius - 8);
  const rng = w.combatRng;
  const telegraph = b.telegraph;
  for (let k = 0; k < count; k++) {
    const r = scatter * Math.sqrt(rng.next());
    const a = rng.next() * TAU;
    let x = at.x + Math.cos(a) * r;
    let y = at.y + Math.sin(a) * r;
    const d2 = x * x + y * y;
    if (d2 > lim * lim) {
      const d = Math.sqrt(d2);
      x = (x / d) * lim;
      y = (y / d) * lim;
    }
    const delay = k * step;
    if (delay <= 1e-9) queueStrike(w, p, 'meteorRain', x, y, radius, telegraph, w.time + telegraph, def, null);
    else schedule(p, w.time + delay, (ww, pp) => queueStrike(ww, pp, 'meteorRain', x, y, radius, telegraph, ww.time + telegraph, def, null));
  }
}

// --- Storm Step ----------------------------------------------------------------------------------------------------------------

/**
 * Storm Step's lightning after the blink from (fx, fy) to (tx, ty): a strike at the origin (Third Strike: and halfway) and at the
 * landing, each the def's hit in its radius; an enemy is struck once per blink. Forking Step forks from the landing to `branches` more
 * enemies within `jump`; Static Cloud leaves its shocking ground at the origin.
 */
export function stormStepStrikes(
  w: World, p: PlayerState, def: SkillRuntimeDef, b: DashBehaviour, fx: number, fy: number, tx: number, ty: number,
): void {
  const s = b.strikes;
  if (!s) return;
  const radius = def.radius > 0 ? def.radius : s.radius;
  const dtype = DAMAGE_INDEX[def.damageType];
  const group: number[] = [];
  const points: number[] = [fx, fy];
  if (hasFlag(p, def, s.third)) points.push((fx + tx) / 2, (fy + ty) / 2);
  points.push(tx, ty);
  for (let k = 0; k < points.length; k += 2) {
    const x = points[k];
    const y = points[k + 1];
    w.events.push({ t: 'nova', playerId: p.id, skill: def.id, x, y, radius });
    blastAt(w, x, y, radius, def.damage, dtype, def.critChance, def.critMultiplier, def.ailmentChance, p.id, 0.5, group);
  }
  if (!def.augments) return;
  const fork = prim(def, 'fork');
  if (fork && def.damage > 0) {
    const m = w.monsters;
    const hit = [...group];
    for (let n = 0; n < fork.branches; n++) {
      let cx = tx;
      let cy = ty;
      for (let l = 0; l < fork.links; l++) {
        const i = nextLink(w, cx, cy, fork.jump, hit);
        if (i < 0) break;
        hit.push(m.id[i]);
        const nx = m.x[i];
        const ny = m.y[i];
        w.events.push({ t: 'chain', playerId: p.id, points: [cx, cy - 8, nx, ny], damageType: def.damageType });
        damageMonster(w, i, def.damage * fork.share, dtype, def.critChance, def.critMultiplier, def.ailmentChance, nx - cx, ny - cy, 0.5, true, p.id);
        cx = nx;
        cy = ny;
      }
    }
  }
  const trail = prim(def, 'trail');
  if (trail && trail.at === 'origin') spawnTrail(w, p.id, trail, fx, fy, radius);
}

// --- Tempest Surge -------------------------------------------------------------------------------------------------------------

/** Tempest Surge: cast speed and the pulses for the def's duration (a recast refreshes it). */
export function emitSurge(w: World, p: PlayerState, def: SkillRuntimeDef, b: SurgeBehaviour): void {
  const s = roster3Player(p).surge;
  const duration = def.duration > 0 ? def.duration : b.duration;
  const skin = hasFlag(p, def, b.skin);
  s.time = duration;
  s.castSpeed = b.castSpeed + (hasFlag(p, def, b.tempo) ? SKILL_TIMING.tempoCastSpeed : 0);
  s.radius = def.radius > 0 ? def.radius : b.radius;
  s.damage = def.damage;
  s.critChance = def.critChance;
  s.critMultiplier = def.critMultiplier;
  s.ailmentChance = def.ailmentChance;
  s.pulse = b.pulse;
  s.pulseTimer = b.pulse;
  s.resist = skin ? SKILL_TIMING.skinResist : 0;
  s.shockedTaken = skin ? SKILL_TIMING.skinShockedTaken : 0;
  w.events.push({ t: 'buff', playerId: p.id, skill: def.id, x: p.x, y: p.y, duration });
}

/** One tick of the surge: a pulse every `pulse` s (the last one on the tick it runs out), then the timer. */
function tickSurge(w: World, p: PlayerState, s: SurgeState): void {
  if (s.time <= 0) return;
  s.time -= DT;
  if (s.pulse > 0) {
    s.pulseTimer -= DT;
    if (s.pulseTimer <= 1e-9) {
      s.pulseTimer += s.pulse;
      surgePulse(w, p, s);
    }
  }
  if (s.time <= 1e-9) s.time = 0;
}

/** Every enemy within the surge's radius of her takes its lightning hit; a few arcs show where. */
function surgePulse(w: World, p: PlayerState, s: SurgeState): void {
  if (!(s.damage > 0)) return;
  const m = w.monsters;
  let arcs = 0;
  for (const i of inside(w, p.x, p.y, s.radius)) {
    if (!isHittable(w, i)) continue;
    const dx = m.x[i] - p.x;
    const dy = m.y[i] - p.y;
    if (arcs < SURGE_ARCS) {
      arcs++;
      const l = Math.hypot(dx, dy) || 1;
      w.events.push({
        t: 'chain', playerId: p.id, damageType: 'lightning',
        points: [p.x + (dx / l) * MUZZLE_OFFSET, p.y - 10 + (dy / l) * MUZZLE_OFFSET, m.x[i], m.y[i]],
      });
    }
    damageMonster(w, i, s.damage, DT_LIGHTNING, s.critChance, s.critMultiplier, s.ailmentChance, dx, dy, 0.5, true, p.id);
  }
}

// --- Event Horizon -------------------------------------------------------------------------------------------------------------

/** Event Horizon: a point at the cursor that pulls every enemy within the def's range for the def's duration, then detonates. */
export function emitHorizon(w: World, p: PlayerState, def: SkillRuntimeDef, b: HorizonBehaviour, aimX: number, aimY: number): void {
  const at = landing(w, p, aimX, aimY, b.reach);
  const pullRadius = def.range > 0 ? def.range : b.pullRadius;
  const duration = def.duration > 0 ? def.duration : b.duration;
  spawnArea(w, 'eventHorizon', at.x, at.y, pullRadius, duration, { hurts: 'none', debuff: null, source: p.id });
  roster3Player(p).horizons.push({
    x: at.x, y: at.y, age: 0, duration, pullRadius,
    pull: b.pull * (hasFlag(p, def, b.heavy) ? SKILL_TIMING.heavyCollapsePull : 1),
    radius: def.radius > 0 ? def.radius : b.radius,
    def,
    feast: hasFlag(p, def, b.feast) ? SKILL_TIMING.voidFeastFocus : 0,
    inside: [],
    echo: hasFlag(p, def, b.echo),
  });
}

/** One tick of a horizon; true once it has detonated. */
function tickHorizon(w: World, p: PlayerState, h: Horizon): boolean {
  h.age += DT;
  const m = w.monsters;
  // Void Feast: an enemy that was inside on the last tick and is gone now died during the pull.
  if (h.feast > 0 && h.inside.length > 0) {
    let kills = 0;
    for (const id of h.inside) if (m.slotOf(id) < 0) kills++;
    if (kills > 0) p.focus = Math.min(p.stats.maxFocus, p.focus + kills * h.feast);
  }
  const list = inside(w, h.x, h.y, h.pullRadius);
  if (h.feast > 0) h.inside = list.map((i) => m.id[i]);
  for (const i of list) pullMonster(w, i, h.x, h.y, h.pull);
  if (h.age < h.duration - 1e-9) return false;
  detonate(w, p, h, 1);
  // Echo Collapse: a second detonation at its share (dropped if she dies first).
  if (h.echo) schedule(p, w.time + SKILL_TIMING.echoCollapseDelay, (ww, pp) => detonate(ww, pp, h, SKILL_TIMING.echoCollapseShare));
  return true;
}

function detonate(w: World, p: PlayerState, h: Horizon, share: number): void {
  const def = h.def;
  w.events.push({ t: 'nova', playerId: p.id, skill: def.id, x: h.x, y: h.y, radius: h.radius });
  blastAt(w, h.x, h.y, h.radius, def.damage * share, DAMAGE_INDEX[def.damageType], def.critChance, def.critMultiplier, def.ailmentChance, p.id, 1);
}

// --- Upkeep --------------------------------------------------------------------------------------------------------------------

/** Roster batch 3 upkeep for one player (one tick, after roster batch 2's): the surge, then the horizons in the order cast. */
export function tickRoster3(w: World, p: PlayerState): void {
  pruneBrittle(w);
  const s = peekRoster3(p);
  if (!s) return;
  tickSurge(w, p, s.surge);
  const list = s.horizons;
  if (list.length === 0) return;
  let write = 0;
  for (let k = 0; k < list.length; k++) {
    const h = list[k];
    if (!tickHorizon(w, p, h)) list[write++] = h;
  }
  list.length = write;
}
