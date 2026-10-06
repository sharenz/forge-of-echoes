// The Orrery's live rules in the sim (PT4, docs/power-rework/passive-tree.md 3 and 6). The rules resolve every number into
// PlayerCombatStats.passives (src/game/progression/passive-rules.ts); this module applies the parts that need the world: the hit's
// conditional damage, kill triggers (Wildfire, Cinder Attunement's burst, Shatterpoint, Last Whisper, Focus and life on kill), Soul
// Tithe's leech, Last Ember's free ward, Unending Vigil's low-life regeneration and the flask riders. Every entry point is reached
// only through a player whose `stats.passives` is present, so a world without passives never runs any of it (and never draws RNG).
import type { PassiveRuntime } from '../contracts/sim';
import { IGNITE_DURATION, IGNITE_EVENT_INTERVAL } from './constants';
import { DAMAGE_INDEX } from './math';
import { noteAilment, passivePlayer } from './passives-state';
import { burstAt, augmentCue } from './skills/primitives/burst';
import { takeTrigger } from './skills/primitives/onkill';
import { emitWard } from './skills/buffs';
import { SKILL_BEHAVIOURS } from './skills/behaviours';
import type { WardBehaviour } from './skills/types';
import { isHittable } from './combat';
import type { PlayerState, World } from './world';

const DT_FIRE = DAMAGE_INDEX.fire;
const DT_COLD = DAMAGE_INDEX.cold;
const DT_VOID = DAMAGE_INDEX.void;

/** Pyroclasm: Burning enemies within this distance of the player, and how many it needs. */
export const NEAR_BURNING_RADIUS = 120;
export const NEAR_BURNING_COUNT = 3;
/** Wildfire: a dying ignited enemy passes its burn on within this distance. */
export const IGNITE_SPREAD_RADIUS = 100;
/** Last Whisper: the radius of a Decayed enemy's explosion. */
export const DECAYED_EXPLODE_RADIUS = 60;

let QUERY = new Int32Array(0);

/** Burning enemies within NEAR_BURNING_RADIUS of the player (counted once per tick). */
function nearBurning(w: World, p: PlayerState): number {
  const s = passivePlayer(p);
  if (s.nearTick === w.tick) return s.nearBurning;
  const m = w.monsters;
  if (QUERY.length < m.capacity) QUERY = new Int32Array(m.capacity);
  const r = NEAR_BURNING_RADIUS;
  const n = w.grid.query(p.x - r, p.y - r, p.x + r, p.y + r, QUERY);
  let count = 0;
  for (let k = 0; k < n && count < NEAR_BURNING_COUNT; k++) {
    const i = QUERY[k];
    if (!m.alive[i] || !(m.igniteTime[i] > 0)) continue;
    const dx = m.x[i] - p.x;
    const dy = m.y[i] - p.y;
    if (dx * dx + dy * dy <= r * r) count++;
  }
  s.nearTick = w.tick;
  s.nearBurning = count;
  return count;
}

/**
 * The damage factor of one hit of `dtype` on monster slot `i` from a player with passives (after the crit roll): Pyroclasm and
 * Absolute Zero's `more` (together at most `moreRoom`), the `increased` lines against Burning / Chilled enemies, Absolute Zero's
 * `less` on the unchilled and Gambler's Edge's `less` on non-critical hits.
 */
export function passiveHitFactor(w: World, pr: PassiveRuntime, p: PlayerState | undefined, i: number, dtype: number, crit: boolean): number {
  const m = w.monsters;
  const chilled = m.chillTime[i] > 0;
  let more = 1;
  if (pr.moreNearBurning[dtype] > 0 && p && nearBurning(w, p) >= NEAR_BURNING_COUNT) more *= 1 + pr.moreNearBurning[dtype];
  if (chilled && pr.moreVsChilled > 0) more *= 1 + pr.moreVsChilled;
  if (more > pr.moreRoom) more = Math.max(1, pr.moreRoom);
  let f = more;
  if (pr.vsBurning[dtype] > 0 && m.igniteTime[i] > 0) f *= 1 + pr.vsBurning[dtype];
  if (pr.vsChilled[dtype] > 0 && chilled) f *= 1 + pr.vsChilled[dtype];
  if (pr.lessVsUnchilled > 0 && !chilled) f *= 1 - pr.lessVsUnchilled;
  if (pr.nonCritLess > 0 && !crit) f *= 1 - pr.nonCritLess;
  return f;
}

/** Soul Tithe: `voidDealt` void damage restores a share as Focus, at most focusLeechMax per second (a one-second bucket). */
export function passiveLeech(w: World, p: PlayerState, pr: PassiveRuntime, voidDealt: number): void {
  if (!(pr.focusLeech > 0) || !(voidDealt > 0) || p.dead) return;
  const s = passivePlayer(p);
  if (s.leechTime < 0) s.leechBudget = pr.focusLeechMax;
  else s.leechBudget = Math.min(pr.focusLeechMax, s.leechBudget + (w.time - s.leechTime) * pr.focusLeechMax);
  s.leechTime = w.time;
  const gain = Math.min(s.leechBudget, voidDealt * pr.focusLeech, Math.max(0, p.stats.maxFocus - p.focus));
  if (gain <= 0) return;
  s.leechBudget -= gain;
  p.focus += gain;
}

/** What a dying monster was when it died (captured before its slot is released). */
export interface PassiveVictim {
  id: number;
  x: number;
  y: number;
  maxLife: number;
  igniteDps: number;
  chilled: boolean;
  shocked: boolean;
  decayed: boolean;
}

export function captureVictim(w: World, i: number): PassiveVictim {
  const m = w.monsters;
  return {
    id: m.id[i], x: m.x[i], y: m.y[i], maxLife: m.maxLife[i], igniteDps: m.igniteTime[i] > 0 ? m.igniteDps[i] : 0,
    chilled: m.chillTime[i] > 0, shocked: m.shockTime[i] > 0, decayed: m.decayTime[i] > 0,
  };
}

/** Ignite monster slot `j` at `dps` for `duration` seconds, credited to `source` (the strongest burn wins, as applyAilment). */
function igniteMonster(w: World, j: number, dps: number, duration: number, source: number): void {
  const m = w.monsters;
  const fresh = m.igniteTime[j] <= 0;
  if (fresh || dps >= m.igniteDps[j]) {
    m.igniteDps[j] = dps;
    m.igniteSrc[j] = source;
  }
  if (fresh) m.igniteEventTimer[j] = IGNITE_EVENT_INTERVAL;
  m.igniteTime[j] = Math.max(m.igniteTime[j], duration);
  if (fresh && w.events.lowOpen) w.events.low({ t: 'ailment', ailment: 'burning', x: m.x[j], y: m.y[j] });
}

/** Wildfire: the dying burn passes to the `count` nearest hittable enemies within IGNITE_SPREAD_RADIUS. */
function spreadIgnite(w: World, v: PassiveVictim, count: number, pr: PassiveRuntime, source: number): void {
  if (!(v.igniteDps > 0) || count <= 0) return;
  const m = w.monsters;
  if (QUERY.length < m.capacity) QUERY = new Int32Array(m.capacity);
  const r = IGNITE_SPREAD_RADIUS;
  const n = w.grid.query(v.x - r, v.y - r, v.x + r, v.y + r, QUERY);
  const near: { i: number; d2: number }[] = [];
  for (let k = 0; k < n; k++) {
    const i = QUERY[k];
    if (m.id[i] === v.id || !isHittable(w, i)) continue;
    const dx = m.x[i] - v.x;
    const dy = m.y[i] - v.y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= r * r) near.push({ i, d2 });
  }
  near.sort((a, b) => a.d2 - b.d2 || a.i - b.i);
  const duration = IGNITE_DURATION * (1 + pr.igniteDuration);
  for (let k = 0; k < near.length && k < count; k++) igniteMonster(w, near[k].i, v.igniteDps, duration, source);
}

/**
 * A credited kill (or the death of a monster a passive player ignited): the Orrery's on-kill rules. `killer` is the killing player's
 * id (its rules apply when it has passives), `igniter` the player whose burn was on the victim (Wildfire is theirs).
 */
export function passiveKill(w: World, v: PassiveVictim, dtype: number, credited: boolean, killer: number, igniter: number): void {
  const ip = igniter > 0 ? w.playerById[igniter]?.stats.passives : undefined;
  if (ip && ip.igniteSpread > 0) spreadIgnite(w, v, ip.igniteSpread, ip, igniter);
  const p = credited && killer > 0 ? w.playerById[killer] : undefined;
  const pr = p?.stats.passives;
  if (!p || !pr || p.dead) return;
  const s = p.stats;
  let focus = 0;
  if (dtype === DT_FIRE) focus += pr.focusOnFireKill;
  if (v.shocked) focus += pr.focusOnShockedKill;
  if (focus > 0) p.focus = Math.min(s.maxFocus, p.focus + focus);
  if (pr.pulseKills > 0) {
    const st = passivePlayer(p);
    st.kills++;
    if (st.kills % pr.pulseKills === 0) p.life = Math.min(s.maxLife, p.life + s.maxLife * pr.pulseLife);
  }
  const rng = w.combatRng;
  if (dtype === DT_FIRE && pr.fireBurstChance > 0 && rng.next() < pr.fireBurstChance && takeTrigger(w, killer)) {
    augmentCue(w, killer, 'explode', v.x, v.y, pr.fireBurstRadius, DT_FIRE);
    burstAt(w, { owner: killer, x: v.x, y: v.y, radius: pr.fireBurstRadius, damage: pr.fireBurstDamage, dtype: DT_FIRE, critChance: 0, critMult: 1.5, ailmentChance: 0, knock: 0.5, skip: v.id });
  }
  if (v.chilled && pr.shatterChance > 0 && rng.next() < pr.shatterChance && takeTrigger(w, killer)) {
    augmentCue(w, killer, 'explode', v.x, v.y, pr.shatterRadius, DT_COLD);
    burstAt(w, { owner: killer, x: v.x, y: v.y, radius: pr.shatterRadius, damage: pr.shatterDamage, dtype: DT_COLD, critChance: 0, critMult: 1.5, ailmentChance: 0, knock: 0.5, skip: v.id });
  }
  if (v.decayed && pr.decayedExplode > 0 && takeTrigger(w, killer)) {
    augmentCue(w, killer, 'explode', v.x, v.y, DECAYED_EXPLODE_RADIUS, DT_VOID);
    burstAt(w, {
      owner: killer, x: v.x, y: v.y, radius: DECAYED_EXPLODE_RADIUS, damage: v.maxLife * pr.decayedExplode, dtype: DT_VOID, critChance: 0,
      critMult: 1.5, ailmentChance: 0, knock: 0.5, skip: v.id,
    });
  }
}

/** Once per tick for a living player with passives (after regeneration): Unending Vigil's low-life regeneration, Last Ember. */
export function tickPassivePlayer(w: World, p: PlayerState, dt: number): void {
  const pr = p.stats.passives;
  if (!pr || p.dead) return;
  const s = p.stats;
  if (pr.regenLowLife > 0 && p.life < s.maxLife * 0.5) p.life = Math.min(s.maxLife, p.life + s.maxLife * pr.regenLowLife * dt);
  if (pr.lowLifeWard > 0 && pr.lowLifeWardDef && p.life < s.maxLife * pr.lowLifeWard) {
    const st = passivePlayer(p);
    if (w.time + 1e-9 >= st.wardReady) {
      st.wardReady = w.time + pr.lowLifeWardCooldown;
      const b = SKILL_BEHAVIOURS.cinderWard as WardBehaviour | undefined;
      if (b) emitWard(w, p, pr.lowLifeWardDef, b);
    }
  }
}

/** A flask was drunk by a player with passives: Bloodied Resolve's guard, Rejuvenating Surge's life. */
export function passiveFlask(w: World, p: PlayerState, pr: PassiveRuntime, flaskId: string): void {
  if (flaskId === 'lifeFlask' && pr.flaskGuard > 0) passivePlayer(p).guardUntil = w.time + pr.flaskGuardTime;
  if (flaskId === 'focusFlask' && pr.focusFlaskLife > 0) p.life = Math.min(p.stats.maxLife, p.life + p.stats.maxLife * pr.focusFlaskLife);
}

/** The shock / chill a player with passives inflicts, remembered on the monster (the sim reads it through passives-state). */
export function notePassiveShock(w: World, i: number, pr: PassiveRuntime, duration: number): void {
  noteAilment(w, 'shock', w.monsters.id[i], pr.shockEffect, 0, duration);
}

export function notePassiveChill(w: World, i: number, pr: PassiveRuntime, duration: number): void {
  noteAilment(w, 'chill', w.monsters.id[i], pr.chillSlow, pr.chilledWeaken, duration);
}
