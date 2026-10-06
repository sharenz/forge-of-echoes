// Per-world and per-player state of the Orrery's live rules (PT4, docs/power-rework/passive-tree.md). A leaf module (type imports
// only), so the core systems (combat's damage-taken factor, ai's chill slow, behaviour's monster damage, player's flasks) can read
// it without an import cycle. As with the SK5 augment state, everything lives in WeakMaps keyed by the World / PlayerState object:
// a world in which no player carries passives (PlayerCombatStats.passives absent) has none, so the determinism goldens are untouched.
// Every container is iterated in insertion order (deterministic).
import type { PassiveRuntime } from '../contracts/sim';
import type { PlayerState, World } from './world';

/** A shock or chill a passive player inflicted: its strength (shock: damage taken bonus; chill: slow) and until when it holds. */
export interface PassiveAilment {
  effect: number;
  /** Chill only: the damage the chilled monster loses (Permafrost). */
  weaken: number;
  until: number;
}

export interface PassiveWorld {
  /** Monster id → the shock / chill of a passive player (the strongest still running wins). */
  shocks: Map<number, PassiveAilment>;
  chills: Map<number, PassiveAilment>;
  pruneAt: number;
}

export interface PassivePlayer {
  /** Kills counted for Pulse of Life. */
  kills: number;
  /** World time Last Ember may fire again. */
  wardReady: number;
  /** Soul Tithe: Focus that may still be leeched (refills at focusLeechMax per second, holds at most one second's worth). */
  leechBudget: number;
  leechTime: number;
  /** Bloodied Resolve: world time the life flask's guard ends. */
  guardUntil: number;
  /** Pyroclasm's count of Burning enemies near the player, cached per tick. */
  nearTick: number;
  nearBurning: number;
}

const WORLDS = new WeakMap<World, PassiveWorld>();
const PLAYERS = new WeakMap<PlayerState, PassivePlayer>();

export function passiveWorld(w: World): PassiveWorld {
  let s = WORLDS.get(w);
  if (!s) {
    s = { shocks: new Map(), chills: new Map(), pruneAt: 0 };
    WORLDS.set(w, s);
  }
  return s;
}

export function passivePlayer(p: PlayerState): PassivePlayer {
  let s = PLAYERS.get(p);
  if (!s) {
    s = { kills: 0, wardReady: 0, leechBudget: 0, leechTime: -1, guardUntil: -1, nearTick: -1, nearBurning: 0 };
    PLAYERS.set(p, s);
  }
  return s;
}

/** The passive rules of the player with id `source` (undefined for nobody, a player without passives, or one who left). */
export function passivesOf(w: World, source: number): PassiveRuntime | undefined {
  return source > 0 ? w.playerById[source]?.stats.passives : undefined;
}

/** Drop finished shocks and chills now and then (the maps are keyed by monster id, so a reused slot is never confused). */
function prune(w: World, s: PassiveWorld): void {
  if (w.time < s.pruneAt) return;
  s.pruneAt = w.time + 2;
  for (const [id, a] of s.shocks) if (a.until < w.time) s.shocks.delete(id);
  for (const [id, a] of s.chills) if (a.until < w.time) s.chills.delete(id);
}

/** Remember a shock or chill of a passive player on monster `id` for `duration` seconds (the stronger one wins while both run). */
export function noteAilment(w: World, kind: 'shock' | 'chill', id: number, effect: number, weaken: number, duration: number): void {
  const s = passiveWorld(w);
  prune(w, s);
  const map = kind === 'shock' ? s.shocks : s.chills;
  const have = map.get(id);
  const until = w.time + duration;
  if (have && have.until >= w.time) {
    if (effect > have.effect) have.effect = effect;
    if (weaken > have.weaken) have.weaken = weaken;
    if (until > have.until) have.until = until;
    return;
  }
  map.set(id, { effect, weaken, until });
}

// --- Reads for the core systems ---------------------------------------------------------------------------------------------

/** The shock bonus (damage taken, fraction) on monster slot `i`: a passive player's stronger shock, else `fallback`. */
export function shockBonusOf(w: World, i: number, fallback: number): number {
  const s = WORLDS.get(w);
  if (!s || s.shocks.size === 0) return fallback;
  const a = s.shocks.get(w.monsters.id[i]);
  return a && a.until >= w.time && a.effect > fallback ? a.effect : fallback;
}

/** The chill slow on monster slot `i` (a passive player's chill, else `fallback`). */
export function chillSlowOf(w: World, i: number, fallback: number): number {
  const s = WORLDS.get(w);
  if (!s || s.chills.size === 0) return fallback;
  const a = s.chills.get(w.monsters.id[i]);
  return a && a.until >= w.time && a.effect > fallback ? a.effect : fallback;
}

/** The damage factor of a chilled monster (Permafrost: enemies chilled by you deal less); 1 when none applies. */
export function chillWeakenOf(w: World, i: number): number {
  const s = WORLDS.get(w);
  if (!s || s.chills.size === 0 || !(w.monsters.chillTime[i] > 0)) return 1;
  const a = s.chills.get(w.monsters.id[i]);
  return a && a.until >= w.time && a.weaken > 0 ? 1 - a.weaken : 1;
}

/** Bloodied Resolve's guard on player `p` (less damage taken while it lasts; 0 when none). */
export function flaskGuardOf(w: World, p: PlayerState): number {
  const pr = p.stats.passives;
  if (!pr || !(pr.flaskGuard > 0)) return 0;
  const s = PLAYERS.get(p);
  return s && s.guardUntil > w.time ? pr.flaskGuard : 0;
}
