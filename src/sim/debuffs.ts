// Player debuffs (GAME_SPEC §13): chilled, frozen, rooted, burning, bleeding, shocked, withered.
//
//   applyDebuff(w, p, id, hit?, source?, duration?)   apply / refresh one (monster hits do it through
//                                                     damagePlayer's rider; see combat.ts)
//   tickDebuffs(w, p, moved)                          timers + damage over time, once per tick per player
//   cleanseDebuffs(w, p, ids)                         flasks (life: burning + bleeding; focus: withered)
//   cleanseAll(w, p)                                  the map was cleared (the boss fell)
//   clearDebuffs(w, p)                                death
//   restoreDebuffs(p, carried)                        a re-join resumes them (SimPlayerJoin.debuffs)
//
// Rules:
//  - chilled   −30% move and cast speed (PLAYER_CHILL_SLOW), 2 s; refreshes, doesn't stack.
//  - frozen    can't move or act (skills don't start, a cast in progress holds; flasks still work),
//              0.8 s, then 3 s of freeze immunity (FREEZE_IMMUNITY, counted from the freeze): a freeze
//              meanwhile becomes a chill. Sources must be telegraphed (prison, wisp burst at point blank).
//  - rooted    can't move (a chain hook's pull included), can still cast; Rift Step breaks it. The
//              RootSource of the latest root is shown (bone / web / chain / tar). 1.4 s. Roots don't
//              chain: while rooted and for ROOT_GRACE (3 s) after it ends or breaks, new roots are
//              ignored (a chain hook still drags).
//  - burning   40% of the triggering hit as fire damage over 3 s; a re-application refreshes the
//              duration and keeps the stronger burn. Needs a hit that dealt damage.
//  - bleeding  20% of the hit over 4 s, ×2 on ticks the player moved; up to 3 stacks (independent
//              timers; a 4th replaces the one closest to running out).
//  - shocked   +20% damage taken, 2 s; refreshes.
//  - withered  −12% to every resistance but physical per stack, up to 3; one shared 4 s timer that
//              every application refreshes.
//  - Durations of the elemental ones (chilled/frozen: cold, burning: fire, shocked: lightning) are
//    scaled by (1 − res/2) with the player's matching resistance at application (withered included in
//    that resistance). Void's withered and physical's rooted / bleeding are not scaled.
//  - While Cinder Ward is up, every debuff runs out WARD_DEBUFF_RATE (2)× as fast — its durations are
//    halved, and so is what's left of a burn or a bleed.
//  - Damage over time was already mitigated by the hit that caused it: it ignores armour, resistances,
//    the ward's reduction, evasion and invulnerability. It is reported as one 'hit' (target 'player')
//    per damage type every PLAYER_DOT_EVENT_INTERVAL, and it can kill.
//  - 'debuff' fires when a debuff starts or its stacks change, and at most once per
//    DEBUFF_EVENT_REPEAT while an unchanged one keeps being refreshed (standing in a fire pool).
//  - 'cleanse' fires when flasks, Rift Step (rooted), the map's clear or death remove active debuffs.
//  - A map clear lifts them all (a burn must not kill a player walking to the chest); a re-join resumes
//    the ones the player left with (SimPlayerJoin.debuffs), so reconnecting is never a free cleanse.
import { PLAYER_DEBUFFS, type PlayerDebuff } from '../contracts/bestiary';
import type { DamageType } from '../contracts/content';
import type { PlayerDebuffView, RootSource } from '../contracts/sim';
import { killPlayer } from './combat';
import {
  BLEED_DURATION, BLEED_FRACTION, BLEED_MAX_STACKS, BLEED_MOVING_MULT, BURN_DURATION, BURN_FRACTION, DEBUFF_EVENT_REPEAT, DT,
  FREEZE_DURATION, FREEZE_IMMUNITY, PLAYER_CHILL_DURATION, PLAYER_CHILL_SLOW, PLAYER_DOT_EVENT_INTERVAL, PLAYER_SHOCK_BONUS,
  PLAYER_SHOCK_DURATION, RESIST_CAP, ROOT_DURATION, ROOT_GRACE, WARD_DEBUFF_RATE, WITHER_DURATION, WITHER_MAX_STACKS, WITHER_RES_PER_STACK,
} from './constants';
import { debuffMoveSlow } from './movement';
import type { PlayerState, World } from './world';

/** Index of each debuff in PLAYER_DEBUFFS (the DebuffState arrays and the view order). */
export const DEBUFF = Object.fromEntries(PLAYER_DEBUFFS.map((d, i) => [d, i])) as Record<PlayerDebuff, number>;
const N = PLAYER_DEBUFFS.length;
const CHILLED = DEBUFF.chilled;
const FROZEN = DEBUFF.frozen;
const ROOTED = DEBUFF.rooted;
const BURNING = DEBUFF.burning;
const BLEEDING = DEBUFF.bleeding;
const SHOCKED = DEBUFF.shocked;
const WITHERED = DEBUFF.withered;

/** Timers within this of zero have run out (float residue of DT countdowns). */
const TIMER_EPSILON = 1e-9;

/** Root sources in a fixed order (ProjectileStore.rootSrc / Area options index into it). */
export const ROOT_SOURCES: readonly RootSource[] = ['bone', 'web', 'chain', 'tar'];

/**
 * A debuff entry as the sim writes it into PlayerView.debuffs: the contract's fields plus `dps`, the
 * damage per second a burn (the strongest) or all bleed stacks together deal — what a re-join needs to
 * resume them (SimPlayerJoin.debuffs). The net codec sends only the contract's fields.
 */
export type SimDebuffView = PlayerDebuffView & { dps: number };

/** What a re-join may carry per debuff (a copy of a SimDebuffView; `dps` needed for burning / bleeding). */
export type DebuffCarry = PlayerDebuffView & { dps?: number };

/** Longest remaining time a carried debuff may resume with (seconds). */
const CARRY_MAX = 10;

/** Which resistance shortens an elemental debuff (null: not elemental). */
const ELEMENT: readonly (DamageType | null)[] = PLAYER_DEBUFFS.map((d) =>
  d === 'chilled' || d === 'frozen' ? 'cold' : d === 'burning' ? 'fire' : d === 'shocked' ? 'lightning' : null,
);

/** One player's debuffs. Plain numbers in fixed arrays: no allocation while ticking. */
export class DebuffState {
  /** Seconds left per debuff (≤ 0 = inactive); bleeding: the longest stack. */
  readonly remaining = new Float64Array(N);
  /** Full duration of the current application (for the HUD's timer). */
  readonly duration = new Float64Array(N);
  readonly stacks = new Uint8Array(N);
  burnDps = 0;
  readonly bleedRemaining = new Float64Array(BLEED_MAX_STACKS);
  readonly bleedDuration = new Float64Array(BLEED_MAX_STACKS);
  readonly bleedDps = new Float64Array(BLEED_MAX_STACKS);
  rootSource: RootSource = 'bone';
  /** Seconds until the player can be frozen again. */
  freezeImmune = 0;
  /** Seconds until the player can be rooted again (the current root + ROOT_GRACE). */
  rootImmune = 0;
  /** Sim time of the last 'debuff' event per debuff. */
  readonly lastEvent = new Float64Array(N).fill(-1e9);
  /** Damage over time not reported yet (fire, physical) and the report timer. */
  fireAccum = 0;
  physAccum = 0;
  dotTimer = 0;
  /** Pooled view entries (PLAYER_DEBUFFS order). */
  readonly views: SimDebuffView[] = PLAYER_DEBUFFS.map((id) => ({ id, remaining: 0, duration: 0, stacks: 0, source: null, dps: 0 }));
}

export function isActive(p: PlayerState, id: PlayerDebuff): boolean {
  return p.debuffs.remaining[DEBUFF[id]] > 0;
}

export function isFrozen(p: PlayerState): boolean {
  return p.debuffs.remaining[FROZEN] > 0;
}

/** Held in place: frozen, rooted or being dragged by a chain hook. */
export function isHeld(p: PlayerState): boolean {
  const r = p.debuffs.remaining;
  return r[FROZEN] > 0 || r[ROOTED] > 0 || p.pullTime > 0;
}

/** The debuff part of the movement slow (movement.ts debuffMoveSlow). */
export function moveSlowOf(p: PlayerState): number {
  return debuffMoveSlow(p.debuffs.remaining[CHILLED] > 0, isHeld(p));
}

/** Cast progress per tick as a share of SIM_DT: 0 frozen, 0.7 chilled, else 1 (movement.ts castRateOf). */
export function castRate(p: PlayerState): number {
  const r = p.debuffs.remaining;
  if (r[FROZEN] > 0) return 0;
  return r[CHILLED] > 0 ? 1 - PLAYER_CHILL_SLOW : 1;
}

/** Resistance lost to withered (fraction, subtracted from every non-physical resistance). */
export function resistPenalty(p: PlayerState): number {
  const d = p.debuffs;
  return d.remaining[WITHERED] > 0 ? d.stacks[WITHERED] * WITHER_RES_PER_STACK : 0;
}

/** Damage-taken multiplier from shocked. */
export function shockMult(p: PlayerState): number {
  return p.debuffs.remaining[SHOCKED] > 0 ? 1 + PLAYER_SHOCK_BONUS : 1;
}

/** A player's resistance to `type` right now (withered applied, capped). */
export function effectiveResist(p: PlayerState, type: DamageType): number {
  const base = p.stats.resist[type] ?? 0;
  const res = type === 'physical' ? base : base - resistPenalty(p);
  return Math.min(RESIST_CAP, Number.isFinite(res) ? res : 0);
}

/**
 * Apply (or refresh) a debuff on a living player. `hit` is the damage the triggering hit dealt (burning
 * and bleeding scale with it and need it > 0); `source` names what roots them; `duration` overrides the
 * base duration (before resistance scaling). Returns true when something changed.
 */
export function applyDebuff(
  w: World, p: PlayerState, id: PlayerDebuff, hit = 0, source?: RootSource, duration?: number,
): boolean {
  if (p.dead) return false;
  const d = p.debuffs;
  const k = DEBUFF[id];
  const element = ELEMENT[k];
  const scale = element ? 1 - effectiveResist(p, element) / 2 : 1;
  const wasActive = d.remaining[k] > 0;
  const stacksBefore = wasActive ? d.stacks[k] : 0;
  // A new damage-over-time reports its first batch a full interval later.
  if ((k === BURNING || k === BLEEDING) && d.remaining[BURNING] <= 0 && d.remaining[BLEEDING] <= 0) d.dotTimer = PLAYER_DOT_EVENT_INTERVAL;
  switch (id) {
    case 'chilled':
      refresh(d, k, (duration ?? PLAYER_CHILL_DURATION) * scale);
      d.stacks[k] = 1;
      break;
    case 'frozen': {
      // Freeze immunity (from the start of a freeze until FREEZE_IMMUNITY after it): only a chill.
      if (d.freezeImmune > 0) return applyDebuff(w, p, 'chilled', hit);
      const dur = (duration ?? FREEZE_DURATION) * scale;
      refresh(d, k, dur);
      d.stacks[k] = 1;
      d.freezeImmune = Math.max(d.freezeImmune, d.remaining[k] + FREEZE_IMMUNITY);
      break;
    }
    case 'rooted': {
      // Roots don't chain (ROOT_GRACE): not while rooted, nor right after.
      if (d.rootImmune > 0) return false;
      const dur = duration ?? ROOT_DURATION;
      refresh(d, k, dur);
      d.stacks[k] = 1;
      d.rootSource = source ?? d.rootSource;
      d.rootImmune = dur + ROOT_GRACE;
      break;
    }
    case 'burning': {
      if (!(hit > 0)) return false;
      const dps = (BURN_FRACTION * hit) / BURN_DURATION;
      d.burnDps = wasActive ? Math.max(d.burnDps, dps) : dps;
      refresh(d, k, (duration ?? BURN_DURATION) * scale);
      d.stacks[k] = 1;
      break;
    }
    case 'bleeding': {
      if (!(hit > 0)) return false;
      const dur = duration ?? BLEED_DURATION;
      let slot = -1;
      let least = Infinity;
      for (let s = 0; s < BLEED_MAX_STACKS; s++) {
        if (d.bleedRemaining[s] <= 0) {
          slot = s;
          break;
        }
        if (d.bleedRemaining[s] < least) {
          least = d.bleedRemaining[s];
          slot = s;
        }
      }
      d.bleedRemaining[slot] = dur;
      d.bleedDuration[slot] = dur;
      d.bleedDps[slot] = (BLEED_FRACTION * hit) / dur;
      syncBleed(d);
      break;
    }
    case 'shocked':
      refresh(d, k, (duration ?? PLAYER_SHOCK_DURATION) * scale);
      d.stacks[k] = 1;
      break;
    case 'withered': {
      const dur = (duration ?? WITHER_DURATION) * scale;
      d.stacks[k] = Math.min(WITHER_MAX_STACKS, stacksBefore + 1);
      d.remaining[k] = dur;
      d.duration[k] = dur;
      break;
    }
  }
  const changed = !wasActive || d.stacks[k] !== stacksBefore;
  if (changed || w.time - d.lastEvent[k] >= DEBUFF_EVENT_REPEAT) {
    d.lastEvent[k] = w.time;
    w.events.push({ t: 'debuff', playerId: p.id, debuff: id, stacks: d.stacks[k], x: p.x, y: p.y });
  }
  return true;
}

/** Restart a refreshing debuff's timer if the new application lasts longer than what is left. */
function refresh(d: DebuffState, k: number, dur: number): void {
  if (!(dur > 0)) return;
  if (d.remaining[k] <= 0 || dur > d.remaining[k]) {
    d.remaining[k] = dur;
    d.duration[k] = dur;
  }
}

/** Bleeding's view numbers from its stacks: the count, and the longest stack's timer. */
function syncBleed(d: DebuffState): void {
  let n = 0;
  let best = -1;
  for (let s = 0; s < BLEED_MAX_STACKS; s++) {
    if (d.bleedRemaining[s] <= 0) continue;
    n++;
    if (best < 0 || d.bleedRemaining[s] > d.bleedRemaining[best]) best = s;
  }
  d.stacks[BLEEDING] = n;
  d.remaining[BLEEDING] = best >= 0 ? d.bleedRemaining[best] : 0;
  d.duration[BLEEDING] = best >= 0 ? d.bleedDuration[best] : 0;
}

/**
 * One tick of a living player's debuffs, after they moved: damage over time (bleeding doubled when
 * `moved`), then the timers.
 */
export function tickDebuffs(w: World, p: PlayerState, moved: boolean): void {
  const d = p.debuffs;
  if (d.freezeImmune > 0) d.freezeImmune = d.freezeImmune - DT > TIMER_EPSILON ? d.freezeImmune - DT : 0;
  if (d.rootImmune > 0) d.rootImmune = d.rootImmune - DT > TIMER_EPSILON ? d.rootImmune - DT : 0;
  const r = d.remaining;
  let any = false;
  for (let k = 0; k < N; k++) if (r[k] > 0) any = true;
  if (!any) return;
  const rate = p.ward.time > 0 ? WARD_DEBUFF_RATE : 1;
  // Damage over time for the real time each debuff still covers this tick (with the ward up a 3 s burn
  // lasts 1.5 s and deals half).
  let fire = 0;
  let phys = 0;
  if (r[BURNING] > 0) fire = d.burnDps * Math.min(DT, r[BURNING] / rate);
  if (r[BLEEDING] > 0) {
    const mult = moved ? BLEED_MOVING_MULT : 1;
    for (let s = 0; s < BLEED_MAX_STACKS; s++) {
      if (d.bleedRemaining[s] > 0) phys += d.bleedDps[s] * Math.min(DT, d.bleedRemaining[s] / rate) * mult;
    }
  }
  const step = DT * rate;
  // A whole-tick duration counted down in DT steps can leave a ±1e-15 residue: anything within
  // TIMER_EPSILON of zero has run out, so durations end on their exact tick.
  for (let k = 0; k < N; k++) {
    if (r[k] <= 0 || k === BLEEDING) continue;
    r[k] -= step;
    if (r[k] <= TIMER_EPSILON) expire(d, k);
  }
  if (r[BLEEDING] > 0) {
    for (let s = 0; s < BLEED_MAX_STACKS; s++) {
      if (d.bleedRemaining[s] <= 0) continue;
      d.bleedRemaining[s] -= step;
      if (d.bleedRemaining[s] <= TIMER_EPSILON) {
        d.bleedRemaining[s] = 0;
        d.bleedDps[s] = 0;
      }
    }
    syncBleed(d);
  }
  if (fire > 0 || phys > 0) dotDamage(w, p, fire, phys);
}

function expire(d: DebuffState, k: number): void {
  d.remaining[k] = 0;
  d.duration[k] = 0;
  d.stacks[k] = 0;
  if (k === BURNING) d.burnDps = 0;
}

/** Life lost to burning / bleeding this tick (already mitigated), reported in batches. */
function dotDamage(w: World, p: PlayerState, fire: number, phys: number): void {
  const d = p.debuffs;
  d.fireAccum += fire;
  d.physAccum += phys;
  p.life -= fire + phys;
  if (p.life <= 0) {
    reportDot(w, p, true);
    killPlayer(w, p);
    return;
  }
  d.dotTimer -= DT;
  if (d.dotTimer <= 0 || (d.remaining[BURNING] <= 0 && d.remaining[BLEEDING] <= 0)) reportDot(w, p, false);
}

/** Report the accumulated damage over time as 'hit' events (one per damage type) and restart the timer. */
function reportDot(w: World, p: PlayerState, killed: boolean): void {
  const d = p.debuffs;
  if (d.fireAccum > 0) {
    w.events.push({
      t: 'hit', playerId: p.id, x: p.x, y: p.y, amount: d.fireAccum, damageType: 'fire', crit: false, target: 'player',
      killed: killed && !(d.physAccum > 0),
    });
  }
  if (d.physAccum > 0) {
    w.events.push({
      t: 'hit', playerId: p.id, x: p.x, y: p.y, amount: d.physAccum, damageType: 'physical', crit: false, target: 'player', killed,
    });
  }
  d.fireAccum = 0;
  d.physAccum = 0;
  d.dotTimer = PLAYER_DOT_EVENT_INTERVAL;
}

/** Remove the listed debuffs (the active ones) and emit 'cleanse' when any were active. */
export function cleanseDebuffs(w: World, p: PlayerState, ids: readonly PlayerDebuff[]): void {
  const d = p.debuffs;
  let removed: PlayerDebuff[] | null = null;
  for (const id of ids) {
    const k = DEBUFF[id];
    if (d.remaining[k] <= 0) continue;
    (removed ??= []).push(id);
    clearOne(d, k);
    if (k === ROOTED) {
      p.pullTime = 0;
      d.rootImmune = ROOT_GRACE;
    }
  }
  if (!removed) return;
  // What the cleansed burn / bleed dealt since the last report still shows.
  if (d.fireAccum > 0 || d.physAccum > 0) reportDot(w, p, false);
  w.events.push({ t: 'cleanse', playerId: p.id, debuffs: removed, x: p.x, y: p.y });
}

function clearOne(d: DebuffState, k: number): void {
  expire(d, k);
  if (k === BLEEDING) {
    d.bleedRemaining.fill(0);
    d.bleedDps.fill(0);
    d.bleedDuration.fill(0);
  }
}

/**
 * The map was cleared: every debuff goes (with a 'cleanse' when any were active) and a drag stops —
 * a burn or three bleed stacks must not kill a player after the boss fell. Not a death: the freeze
 * immunity and root grace stay.
 */
export function cleanseAll(w: World, p: PlayerState): void {
  if (p.dead) return;
  cleanseDebuffs(w, p, PLAYER_DEBUFFS);
  p.pullTime = 0;
}

/** Death: every debuff goes (with a 'cleanse' when any were active), freeze immunity and pulls too. */
export function clearDebuffs(w: World, p: PlayerState): void {
  const d = p.debuffs;
  let removed: PlayerDebuff[] | null = null;
  for (let k = 0; k < N; k++) {
    if (d.remaining[k] <= 0) continue;
    (removed ??= []).push(PLAYER_DEBUFFS[k]);
    clearOne(d, k);
  }
  d.freezeImmune = 0;
  d.rootImmune = 0;
  d.fireAccum = 0;
  d.physAccum = 0;
  d.dotTimer = PLAYER_DOT_EVENT_INTERVAL;
  p.pullTime = 0;
  p.kbX = 0;
  p.kbY = 0;
  if (removed) w.events.push({ t: 'cleanse', playerId: p.id, debuffs: removed, x: p.x, y: p.y });
}

/** Write the active debuffs into the player's view (pooled SimDebuffView entries, PLAYER_DEBUFFS order). */
export function writeDebuffViews(p: PlayerState): void {
  const d = p.debuffs;
  const out = p.view.debuffs;
  let n = 0;
  for (let k = 0; k < N; k++) {
    if (d.remaining[k] <= 0) continue;
    const v = d.views[k];
    v.remaining = d.remaining[k];
    v.duration = d.duration[k];
    v.stacks = Math.max(1, d.stacks[k]);
    v.source = k === ROOTED ? d.rootSource : null;
    v.dps = k === BURNING ? d.burnDps : k === BLEEDING ? d.bleedDps[0] + d.bleedDps[1] + d.bleedDps[2] : 0;
    out[n++] = v;
  }
  out.length = n;
}

/**
 * Resume carried debuffs on a (re-)joining player — the entries of their last PlayerView.debuffs,
 * copied when they left (SimPlayerJoin.debuffs). Each resumes with its remaining time (capped at
 * CARRY_MAX); a freeze brings its immunity, a root its grace; burning and bleeding need `dps` (bleed
 * stacks share it evenly and all resume with the longest stack's timer). Malformed entries are skipped.
 * No events: the joining player's first snapshot shows them.
 */
export function restoreDebuffs(p: PlayerState, carried: readonly DebuffCarry[]): void {
  const d = p.debuffs;
  for (const e of carried) {
    if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !Object.hasOwn(DEBUFF, e.id)) continue;
    const k = DEBUFF[e.id];
    const left = Math.min(CARRY_MAX, finite(e.remaining));
    if (!(left > 0)) continue;
    const dur = Math.max(left, Math.min(CARRY_MAX, finite(e.duration)));
    const stacks = Math.floor(finite(e.stacks));
    const dps = finite(e.dps);
    switch (k) {
      case BURNING:
        if (!(dps > 0)) continue;
        d.burnDps = dps;
        break;
      case BLEEDING: {
        if (!(dps > 0)) continue;
        const n = Math.max(1, Math.min(BLEED_MAX_STACKS, stacks));
        for (let s = 0; s < BLEED_MAX_STACKS; s++) {
          d.bleedRemaining[s] = s < n ? left : 0;
          d.bleedDuration[s] = s < n ? dur : 0;
          d.bleedDps[s] = s < n ? dps / n : 0;
        }
        syncBleed(d);
        continue;
      }
      case FROZEN:
        d.freezeImmune = Math.max(d.freezeImmune, left + FREEZE_IMMUNITY);
        break;
      case ROOTED:
        d.rootSource = ROOT_SOURCES.includes(e.source as RootSource) ? (e.source as RootSource) : 'bone';
        d.rootImmune = Math.max(d.rootImmune, left + ROOT_GRACE);
        break;
    }
    d.remaining[k] = left;
    d.duration[k] = dur;
    d.stacks[k] = k === WITHERED ? Math.max(1, Math.min(WITHER_MAX_STACKS, stacks)) : 1;
  }
  if (d.remaining[BURNING] > 0 || d.remaining[BLEEDING] > 0) d.dotTimer = PLAYER_DOT_EVENT_INTERVAL;
}

function finite(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
