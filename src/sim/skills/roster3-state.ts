// State of the power rework's roster batch 3 (SK4) that the core systems read: Tempest Surge's buff (player.ts reads its cast speed,
// combat.ts its lightning resistance and Lightning Skin's bonus on shocked enemies), Blizzard's brittle cold (combat.ts: chilled
// enemies in the storm take more cold damage) and Event Horizon's points. A leaf module (type imports and data only), so the core
// systems can read it without an import cycle. Like the flagship augments' state (primitives/state.ts) it lives in WeakMaps keyed by
// the World / PlayerState object: a world where nobody casts these skills carries none, and every read returns the neutral value
// (×1, +0), so the determinism goldens are untouched.
import { DAMAGE_TYPES } from '../../contracts/content';
import type { SkillRuntimeDef } from '../../contracts/sim';
import { SKILL_TIMING } from '../../data/progression/skill-timing';
import type { PlayerState, World } from '../world';

const COLD = DAMAGE_TYPES.indexOf('cold');
const LIGHTNING = DAMAGE_TYPES.indexOf('lightning');

/** Tempest Surge while it lasts: its cast speed, its pulse (the def's hit on every enemy in `radius`) and Lightning Skin. */
export interface SurgeState {
  time: number;
  castSpeed: number;
  radius: number;
  damage: number;
  critChance: number;
  critMultiplier: number;
  ailmentChance: number;
  pulse: number;
  pulseTimer: number;
  /** Lightning Skin: added lightning resistance (fraction) and the bonus of her hits on shocked enemies. */
  resist: number;
  shockedTaken: number;
}

/** One Event Horizon: pulling toward (x, y) until `age` reaches `duration`, then detonating. */
export interface Horizon {
  x: number;
  y: number;
  age: number;
  duration: number;
  pullRadius: number;
  pull: number;
  /** The detonation's radius. */
  radius: number;
  def: SkillRuntimeDef;
  /** Void Feast: Focus per enemy that dies while it pulls (0 = none), and the ids inside on the last tick. */
  feast: number;
  inside: number[];
  echo: boolean;
}

interface R3Player {
  surge: SurgeState;
  horizons: Horizon[];
}

interface R3World {
  /** Blizzard: monster id → until (world time) and the bonus its storm gives chilled enemies against cold damage. */
  brittle: Map<number, { until: number; bonus: number }>;
  pruneAt: number;
}

const PLAYERS = new WeakMap<PlayerState, R3Player>();
const WORLDS = new WeakMap<World, R3World>();

export function roster3Player(p: PlayerState): R3Player {
  let s = PLAYERS.get(p);
  if (!s) {
    s = {
      surge: {
        time: 0, castSpeed: 0, radius: 0, damage: 0, critChance: 0, critMultiplier: 1.5, ailmentChance: 0, pulse: 0, pulseTimer: 0, resist: 0,
        shockedTaken: 0,
      },
      horizons: [],
    };
    PLAYERS.set(p, s);
  }
  return s;
}

export function peekRoster3(p: PlayerState): R3Player | undefined {
  return PLAYERS.get(p);
}

/** She died: the surge ends and her horizons collapse without detonating (like the zones of roster batch 2). */
export function clearRoster3(p: PlayerState): void {
  const s = PLAYERS.get(p);
  if (!s) return;
  s.surge.time = 0;
  s.horizons.length = 0;
}

/** Cast progress factor of Tempest Surge's cast speed (1 when it is not running). */
export function surgeCastRate(p: PlayerState): number {
  const s = PLAYERS.get(p);
  return s && s.surge.time > 0 ? 1 + s.surge.castSpeed : 1;
}

/** Lightning Skin's added lightning resistance against a hit of `dtype` (0 when none); combat.ts caps the total. */
export function surgeResist(p: PlayerState, dtype: number): number {
  if (dtype !== LIGHTNING) return 0;
  const s = PLAYERS.get(p);
  return s && s.surge.time > 0 ? s.surge.resist : 0;
}

/** Blizzard's brittle cold on monster id `id` for a storm tick: lasts until `until` (the strongest storm's bonus counts). */
export function markBrittle(w: World, id: number, bonus: number, until: number): void {
  let s = WORLDS.get(w);
  if (!s) {
    s = { brittle: new Map(), pruneAt: 0 };
    WORLDS.set(w, s);
  }
  const e = s.brittle.get(id);
  if (e && e.until > w.time) {
    e.until = Math.max(e.until, until);
    e.bonus = Math.max(e.bonus, bonus);
  } else s.brittle.set(id, { until, bonus });
}

/** The brittle cold a zone def gives chilled enemies inside (Blizzard, Brittle Cold); 0 for other zones. */
export function brittleOf(def: SkillRuntimeDef): number {
  if (def.id !== 'blizzard') return 0;
  return SKILL_TIMING.blizzardBrittle + (def.flags.includes('brittleCold') ? SKILL_TIMING.brittleCold : 0);
}

/** Drop expired brittle entries (at most once a second). */
export function pruneBrittle(w: World): void {
  const s = WORLDS.get(w);
  if (!s || w.time < s.pruneAt) return;
  s.pruneAt = w.time + 1;
  for (const [id, e] of s.brittle) if (e.until <= w.time) s.brittle.delete(id);
}

/**
 * Damage factor of a hit of `dtype` from player `source` on monster slot `i`: Blizzard's brittle cold (a chilled enemy in a storm takes
 * more cold damage from everyone) and Lightning Skin (her hits on a shocked enemy while her surge lasts). Exactly 1 when neither applies.
 */
export function roster3Taken(w: World, i: number, dtype: number, source: number): number {
  let f = 1;
  if (dtype === COLD) {
    const s = WORLDS.get(w);
    if (s && s.brittle.size > 0 && w.monsters.chillTime[i] > 0) {
      const e = s.brittle.get(w.monsters.id[i]);
      if (e && e.until > w.time) f *= 1 + e.bonus;
    }
  }
  if (source > 0) {
    const p = w.playerById[source];
    const s = p ? PLAYERS.get(p) : undefined;
    if (s && s.surge.time > 0 && s.surge.shockedTaken > 0 && w.monsters.shockTime[i] > 0) f *= 1 + s.surge.shockedTaken;
  }
  return f;
}
