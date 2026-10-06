// Per-world and per-player state of the flagship augment primitives (power rework SK5). A leaf module (type imports only), so the
// core systems (combat's damage-taken factor, ai's ailment bits, player's cast cost, the hit pipeline's ward cap) can read it
// without an import cycle. The state lives in WeakMaps keyed by the World / PlayerState object, so a world without augments
// carries none and the determinism goldens are untouched. Every container is iterated in insertion order (deterministic).
import type { SkillId } from '../../../contracts/content';
import type { AugmentRuntime, SkillRuntimeDef } from '../../../contracts/sim';
import type { PlayerState, World } from '../../world';

/** A projectile lodged in a monster, waiting to detonate. */
export interface Lodge {
  owner: number;
  skill: SkillId;
  /** Monster id of the host (its slot may be gone: then it detonates where the host last stood). */
  host: number;
  x: number;
  y: number;
  /** World time it detonates at. */
  at: number;
  damage: number;
  dtype: number;
  radius: number;
  critChance: number;
  critMult: number;
  ailmentChance: number;
}

/** A skill mark on a monster (Conductive Mark, Pinning). */
export interface Mark {
  owner: number;
  until: number;
  /** Damage taken bonus (0.15 = 15% more). */
  taken: number;
  /** Ailment chance the marking skill gains against it. */
  shock: number;
  skill: SkillId;
}

/** The distinct enemies one cast has hit so far (Heartfire). */
export interface CastTally {
  ids: number[];
  done: boolean;
}

/** What one augmented player projectile carries besides its store columns. */
export interface Rider {
  owner: number;
  def: SkillRuntimeDef;
  /** Children (splits, fragments, bomblets) never split, lodge or return again. */
  child: boolean;
  /** Monsters hit (counted for falloff and the rehit cap). */
  hits: number;
  perMonster: Map<number, number> | null;
  returned: boolean;
  startRange: number;
  /** Distance travelled since the last trail drop. */
  trail: number;
  cast: CastTally | null;
  /** Frost Orb hovering at the cursor: world time it fades, and its fire-rate factor. */
  until: number;
  rate: number;
  /** Skip Shot / bomblets: where the shell was thrown from (the skip direction). */
  fromX: number;
  fromY: number;
}

export interface AugWorld {
  riders: Map<number, Rider>;
  lodges: Lodge[];
  marks: Map<number, Mark>;
  /** On-kill triggers per player in the current tick (capped: build-plan risk table, 8 per tick per player). */
  triggerTime: number;
  triggers: Map<number, number>;
  pruneAt: number;
}

export interface Scheduled {
  at: number;
  run: (w: World, p: PlayerState) => void;
}

export interface AugPlayer {
  queue: Scheduled[];
  /** Recent use times per skill (Rift Echo's free third blink). */
  uses: Map<SkillId, number[]>;
  /** Charged Reprieve: casts left at a discount. */
  cheapLeft: number;
  cheapPct: number;
  cheapFrom: SkillId | null;
  /** The ward's raised cap and its end burst (set when the ward is cast). */
  wardCap: number;
  wardBlast: Extract<AugmentRuntime, { p: 'blast' }> | null;
}

const WORLDS = new WeakMap<World, AugWorld>();
const PLAYERS = new WeakMap<PlayerState, AugPlayer>();

export function augWorld(w: World): AugWorld {
  let s = WORLDS.get(w);
  if (!s) {
    s = { riders: new Map(), lodges: [], marks: new Map(), triggerTime: -1, triggers: new Map(), pruneAt: 0 };
    WORLDS.set(w, s);
  }
  return s;
}

export function peekWorld(w: World): AugWorld | undefined {
  return WORLDS.get(w);
}

export function augPlayer(p: PlayerState): AugPlayer {
  let s = PLAYERS.get(p);
  if (!s) {
    s = { queue: [], uses: new Map(), cheapLeft: 0, cheapPct: 0, cheapFrom: null, wardCap: -1, wardBlast: null };
    PLAYERS.set(p, s);
  }
  return s;
}

export function peekPlayer(p: PlayerState): AugPlayer | undefined {
  return PLAYERS.get(p);
}

/** The first primitive of a kind on a runtime def (the rules emit at most one of each). */
export function prim<P extends AugmentRuntime['p']>(def: SkillRuntimeDef, p: P): Extract<AugmentRuntime, { p: P }> | undefined {
  const list = def.augments;
  if (!list) return undefined;
  for (const a of list) if (a.p === p) return a as Extract<AugmentRuntime, { p: P }>;
  return undefined;
}

/** Run `run` for player `p` at world time `at` (from the player's tick; dropped if they die first). */
export function schedule(p: PlayerState, at: number, run: Scheduled['run']): void {
  augPlayer(p).queue.push({ at, run });
}

// --- Reads for the core systems ---------------------------------------------------------------------------------------------

/** Damage-taken factor of a skill mark on monster slot `i` (1 when unmarked). */
export function markTakenMult(w: World, i: number): number {
  const s = WORLDS.get(w);
  if (!s || s.marks.size === 0) return 1;
  const mk = s.marks.get(w.monsters.id[i]);
  return mk && mk.until > w.time ? 1 + mk.taken : 1;
}

/** AILMENT_BIT.marked (16384) / lodged (32768) of monster slot `i` (0 when none). */
export function augmentStatusBits(w: World, i: number): number {
  const s = WORLDS.get(w);
  if (!s) return 0;
  const id = w.monsters.id[i];
  let bits = 0;
  const mk = s.marks.size > 0 ? s.marks.get(id) : undefined;
  if (mk && mk.until > w.time) bits |= 16384;
  for (const l of s.lodges) if (l.host === id) { bits |= 32768; break; }
  return bits;
}

/** The ward's damage reduction cap of player `p` (Hardened Ember raises it, the Orrery's Barrier Study too), else `fallback`. */
export function wardCapOf(p: PlayerState, fallback: number): number {
  const s = PLAYERS.get(p);
  const cap = s && s.wardCap > 0 ? s.wardCap : fallback;
  const pr = p.stats.passives;
  return pr && pr.wardCap !== 1 ? Math.min(1, cap * pr.wardCap) : cap;
}

/** Focus a cast of `def` costs at world time `now` (Rift Echo's free third use, Charged Reprieve's discount). */
export function castCost(p: PlayerState, def: SkillRuntimeDef, now: number): number {
  const base = Math.max(0, def.focusCost);
  const s = PLAYERS.get(p);
  if (!s || base <= 0) return base;
  const free = prim(def, 'freeCast');
  if (free && free.nth > 1) {
    const list = s.uses.get(def.id);
    if (list && list.length >= free.nth - 1 && list[list.length - (free.nth - 1)] >= now - free.window - 1e-9) return 0;
  }
  if (s.cheapLeft > 0 && s.cheapFrom !== def.id) return base * (1 - s.cheapPct);
  return base;
}

/** A cast of `def` that cost `paid` Focus went off at `now`: count it for the free-use and discount rules. */
export function noteCast(p: PlayerState, def: SkillRuntimeDef, paid: number, now: number): void {
  const free = prim(def, 'freeCast');
  const s = free ? augPlayer(p) : PLAYERS.get(p);
  if (!s) return;
  if (free) {
    const list = s.uses.get(def.id) ?? [];
    // A free use starts the count again.
    if (paid <= 0 && def.focusCost > 0) list.length = 0;
    else list.push(now);
    while (list.length > free.nth) list.shift();
    s.uses.set(def.id, list);
  }
  if (s.cheapLeft > 0 && s.cheapFrom !== def.id && def.focusCost > 0) s.cheapLeft--;
}
