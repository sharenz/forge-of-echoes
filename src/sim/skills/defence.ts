// Defensive buffs of the power rework's roster batch 2 (SK3): Rime Bulwark's barrier, Static Aegis' retaliation, Echo Sigil's
// charges. The barrier soaks damage after armour, resistances and every reduction (combat.ts hitPlayer calls absorbBarrier); an
// enemy's hit (not a burn) chills attackers near a barrier and wakes the aegis (onStruck). Numbers come from the runtime def's
// primitives (rules: game/progression/skills-roster2.ts). No RNG here beyond damageMonster's own roll.
import type { SkillRuntimeDef } from '../../contracts/sim';
import { STAT_CAPS } from '../../data/progression/combat';
import { damageMonster, isHittable } from '../combat';
import { CHILL_DURATION, DT, MUZZLE_OFFSET } from '../constants';
import { effectiveResist } from '../debuffs';
import { DAMAGE_INDEX } from '../math';
import type { PlayerState, World } from '../world';
import { augmentOf } from './projectile-mods';
import type { AegisBehaviour, BarrierBehaviour, EchoSigilBehaviour } from './types';

const DT_LIGHTNING = DAMAGE_INDEX.lightning;
const DT_COLD = DAMAGE_INDEX.cold;
/** At most this many retaliation arcs are drawn per strike (the hits themselves are not limited). */
const ARC_EVENTS = 4;

/** Rime Bulwark: a barrier of `share` × maximum life for the duration (a recast replaces it). */
export function emitBarrier(w: World, p: PlayerState, def: SkillRuntimeDef, b: BarrierBehaviour): void {
  const a = augmentOf(def, 'barrier');
  const duration = def.duration > 0 ? def.duration : b.duration;
  const size = a ? Math.max(0, a.share) * p.stats.maxLife : 0;
  const s = p.barrier;
  s.amount = size;
  s.max = size;
  s.time = size > 0 ? duration : 0;
  s.chillRadius = a ? a.chillRadius : 0;
  s.regen = a ? a.regen : 0;
  s.retort = a ? a.retort : 0;
  s.retortRadius = a ? a.retortRadius : 0;
  w.events.push({ t: 'buff', playerId: p.id, skill: def.id, x: p.x, y: p.y, duration });
}

/** Static Aegis: damage reduction and retaliation for the duration. */
export function emitAegis(w: World, p: PlayerState, def: SkillRuntimeDef, b: AegisBehaviour): void {
  const a = augmentOf(def, 'aegis');
  const duration = def.duration > 0 ? def.duration : b.duration;
  const s = p.aegis;
  s.time = duration;
  s.reduction = Math.min(0.9, Math.max(0, def.damageReduction));
  s.radius = def.radius > 0 ? def.radius : b.radius;
  s.damage = def.damage;
  s.critChance = def.critChance;
  s.critMultiplier = def.critMultiplier;
  s.ailmentChance = def.ailmentChance;
  s.gap = a ? a.gap : 0.25;
  s.cooldown = 0;
  s.resist = a ? a.resist : 0;
  s.pulse = a ? a.pulse : 0;
  s.pulseTimer = s.pulse;
  w.events.push({ t: 'buff', playerId: p.id, skill: def.id, x: p.x, y: p.y, duration });
}

/** Echo Sigil: the next casts echo (executor.ts spends the charges). */
export function emitEchoSigil(w: World, p: PlayerState, def: SkillRuntimeDef, b: EchoSigilBehaviour): void {
  const a = augmentOf(def, 'echoSigil');
  const duration = def.duration > 0 ? def.duration : b.duration;
  const s = p.echoSigil;
  s.casts = a ? a.casts : 0;
  s.time = duration;
  s.delay = a ? a.delay : 0.4;
  s.damage = a ? a.damage : 0.7;
  s.refund = a ? a.refund : 0;
  w.events.push({ t: 'buff', playerId: p.id, skill: def.id, x: p.x, y: p.y, duration });
}

/** Upkeep of the three (one tick): timers, the barrier's Resolute regeneration, Conduction Field's pulses. */
export function tickDefence(w: World, p: PlayerState): void {
  const b = p.barrier;
  if (b.time > 0) {
    b.time -= DT;
    if (b.time <= 0) {
      b.time = 0;
      b.amount = 0;
    } else if (b.regen > 0 && p.vx === 0 && p.vy === 0 && b.amount < b.max) {
      b.amount = Math.min(b.max, b.amount + b.regen * b.max * DT);
    }
  }
  const a = p.aegis;
  if (a.time > 0) {
    a.time -= DT;
    if (a.cooldown > 0) a.cooldown -= DT;
    if (a.time <= 0) a.time = 0;
    else if (a.pulse > 0) {
      a.pulseTimer -= DT;
      if (a.pulseTimer <= 1e-9) {
        a.pulseTimer += a.pulse;
        retaliate(w, p);
      }
    }
  }
  const e = p.echoSigil;
  if (e.time > 0) {
    e.time -= DT;
    if (e.time <= 0) {
      e.time = 0;
      e.casts = 0;
    }
  }
}

/** Static Aegis, Grounded: lightning resistance it adds to a hit of `dtype` (never above the hard resistance ceiling). */
export function aegisResist(p: PlayerState, dtype: number): number {
  const a = p.aegis;
  if (dtype !== DT_LIGHTNING || a.time <= 0 || a.resist <= 0) return 0;
  return Math.max(0, Math.min(a.resist, STAT_CAPS.maxResistHard / 100 - effectiveResist(p, 'lightning')));
}

/** The barrier soaks what it can of `dmg` (after every reduction) and returns the rest; breaking it ends it (Brittle Retort's nova). */
export function absorbBarrier(w: World, p: PlayerState, dmg: number): number {
  const b = p.barrier;
  if (b.time <= 0 || b.amount <= 0) return dmg;
  const soaked = Math.min(b.amount, dmg);
  b.amount -= soaked;
  if (b.amount <= 1e-6) {
    b.amount = 0;
    b.time = 0;
    // A zero-length buff ends the barrier's aura on every client.
    w.events.push({ t: 'buff', playerId: p.id, skill: 'rimeBulwark', x: p.x, y: p.y, duration: 0 });
    if (b.retort > 0 && b.retortRadius > 0) {
      w.events.push({ t: 'nova', playerId: p.id, skill: 'rimeBulwark', x: p.x, y: p.y, radius: b.retortRadius });
      eachNear(w, p.x, p.y, b.retortRadius, (i, dx, dy) => {
        damageMonster(w, i, b.retort, DT_COLD, 0, 1.5, 1, dx, dy, 0.5, true, p.id);
      });
    }
  }
  return dmg - soaked;
}

/** An enemy's hit connected (or was soaked): the barrier chills attackers nearby; the aegis strikes back (at most every `gap` s). */
export function onStruck(w: World, p: PlayerState): void {
  const b = p.barrier;
  if (b.time > 0 && b.chillRadius > 0) {
    const m = w.monsters;
    eachNear(w, p.x, p.y, b.chillRadius, (i) => {
      const fresh = m.chillTime[i] <= 0;
      m.chillTime[i] = Math.max(m.chillTime[i], CHILL_DURATION);
      if (fresh && w.events.lowOpen) w.events.low({ t: 'ailment', ailment: 'chilled', x: m.x[i], y: m.y[i] });
    });
  }
  const a = p.aegis;
  if (a.time > 0 && a.cooldown <= 0) {
    a.cooldown = a.gap;
    retaliate(w, p);
  }
}

/** Every enemy within the aegis' radius takes its hit (shock rider); a few arcs show where. */
function retaliate(w: World, p: PlayerState): void {
  const a = p.aegis;
  if (!(a.damage > 0)) return;
  const m = w.monsters;
  let arcs = 0;
  eachNear(w, p.x, p.y, a.radius, (i, dx, dy) => {
    if (arcs < ARC_EVENTS) {
      arcs++;
      const l = Math.hypot(dx, dy) || 1;
      w.events.push({
        t: 'chain', playerId: p.id, damageType: 'lightning',
        points: [p.x + (dx / l) * MUZZLE_OFFSET, p.y + (dy / l) * MUZZLE_OFFSET, m.x[i], m.y[i]],
      });
    }
    damageMonster(w, i, a.damage, DT_LIGHTNING, a.critChance, a.critMultiplier, a.ailmentChance, dx, dy, 0.5, true, p.id);
  });
}

let cand = new Int32Array(0);

/** Calls `fn` for every hittable monster within `radius` (plus its body) of (x, y), in grid order. */
function eachNear(w: World, x: number, y: number, radius: number, fn: (i: number, dx: number, dy: number) => void): void {
  const m = w.monsters;
  // Its own buffer: hitPlayer (which calls this) may run inside a loop over the world's scratch buffers.
  if (cand.length < w.scratch.length) cand = new Int32Array(w.scratch.length);
  const reach = radius + w.grid.maxRadius;
  const n = w.grid.query(x - reach, y - reach, x + reach, y + reach, cand);
  // Copy first: a kill or a hit can re-enter the query.
  const hits: number[] = [];
  for (let k = 0; k < n; k++) {
    const i = cand[k];
    if (!isHittable(w, i)) continue;
    const dx = m.x[i] - x;
    const dy = m.y[i] - y;
    const r = radius + m.radius[i];
    if (dx * dx + dy * dy <= r * r) hits.push(i);
  }
  for (const i of hits) {
    if (!isHittable(w, i)) continue;
    fn(i, m.x[i] - x, m.y[i] - y);
  }
}
