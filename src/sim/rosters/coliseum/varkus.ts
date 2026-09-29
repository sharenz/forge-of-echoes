// Varkus, the Iron Champion (Iron Coliseum boss, final wave; GAME_SPEC §14). Three phases at 100 / 66 / 33 %
// life (the core roars between them and cancels his pending telegraphs).
//
//   Cleave            (all phases) a player within cleaveRange: the greatsword climbs (windup) while a slam
//                     telegraph shows the sand ahead of him; the strike lands where it showed ('slam').
//   Charge            (all phases) a lane (chargeLine variant CHARGE_VARIANT) from him toward his target shows
//                     for the whole cast; at the launch ('charge') he dashes exactly along it — a pillar in the
//                     lane stops him and the lane goes. Its contact is exactly the drawn width: knockback and
//                     Bleeding. He skids to a halt afterwards (chargeRelease: an opening).
//   Execution Mark    (all phases) he raises the blade ('mark', the cast start) and marks the farthest player
//                     within markRange markCast s later: the mark follows them for markLock s, then stays put; for its last leapFlight s he is airborne ('leap',
//                     MONSTER_ANIM.leap) and lands on it exactly as it strikes (areaResolve 'executionMark').
//                     He recovers for leapRecover s after landing. A marked player who is rooted or dragged
//                     around the lock pauses the mark's clock (AreaView.age stands still): the walk out
//                     is never taken away by a root.
//   Whirlwind         (phase 2+) a harmless ring for the cast ('whirl'), then spinning blades that follow him
//                     for whirlChannel s as he walks at his target, bleeding whoever they touch.
//   Crowd's Favour    (phase 3) he raises the sword to the crowd ('spikes'): arenaSpikes tiles rise in a pattern
//                     round every living player near him — rings, a cross or a checkerboard in two waves —
//                     each tile telegraphed for at least SPIKE_WARN s. Players standing close together share
//                     one pattern (two overlapping ones could cover each other's safe spots). Never while a
//                     mark is pending; while his tiles are pending he neither charges, cleaves nor marks (no
//                     lane, circle or mark across a pattern — only the whirl's blades and summons fill the gap).
//   Summons           Pit Hounds ('summon'): 3 per call, every 15 s in phase 1 and every 12 s from phase 2, while
//                     fewer than summonCap hounds are near him and the field isn't saturated (SUMMON_FIELD_CAP).
//
// Fairness (tests/sim/skeletons.test.ts and tests/sim-coliseum): the lane is drawn from the start of the cast
// until the dash ends, he never leaves it while it shows, and it hits exactly its width. While a mark is
// pending he starts nothing that would still be going when he has to leap (no charge, no whirl: `free`), and
// a leap never starts while he casts, dashes, roars or a lane of his is still shown — then only the mark's
// strike lands. Everything he does is telegraphed; he has no untelegraphed contact damage.
// Roots (a thrall's hook, tar) never take a dodge away: no charge, cleave, whirl or Crowd's Favour starts on a
// held player, and a telegraph a held player stands in — his lane or cleave circle (the cast waits with it:
// holdGate) or a spike tile (spikeTick) — never gets closer than VARKUS.walkOut to landing until they are free.
// A whirl already turning doesn't walk its blades into a held target (he stands and spins).
// During a locked cast (the lane, the cleave) he faces where it goes, not where his target walks.
import { MONSTER_KINDS } from '../../../contracts/content';
import { commanderBrain } from '../kit';
import {
  CHARGE_LINE_HALF_WIDTH, DAMAGE_INDEX, DT, MFLAG, MONSTER_ANIM as ANIM, MSTATE, PLAYER_RADIUS, TAU, areaById, areaContains, attackEvent,
  bossState, clamp, farthestLiving, fieldFull, hitPlayersIn, knockPlayer, monsterDamage, moveAlong, phaseOf, registerAreaEffect, setAnim,
  spawnArea, stop, summon, type Area, type Brain, type BossScript, type PlayerState, type World,
} from '../api';
import { chainWhirl } from './chainmaster';
import { held } from './common';
import { VARKUS as V } from './tuning';

const VARKUS_KIND = MONSTER_KINDS.indexOf('varkus');
const PIT_HOUND = MONSTER_KINDS.indexOf('pitHound');

/** Lane width of his charge: the drawn half-width is exactly the dash's contact radius. */
export const CHARGE_VARIANT = 2;
const CHARGE_HALF_WIDTH = CHARGE_LINE_HALF_WIDTH[CHARGE_VARIANT];
/** Pushed further than this off the lane (a pillar in the way): the charge ends where he stands. */
const CHARGE_BLOCKED = 3;
/** Every spike tile shows at least this long before it bursts. */
export const SPIKE_WARN = 1.3;
/** He lands this far short of the mark's centre (along his flight). */
const LEAP_SHORT = 2;
/** Players closer than this to one who already got a Crowd's Favour pattern share it. */
const CROWD_SHARE = 170;
/** A held player pauses their mark from this long before it locks… */
const MARK_HOLD_LEAD = 0.25;
/** …for at most this long in all. */
export const MARK_MAX_PAUSE = 2.5;

/** His encounter state (BossScript state; bossState<VarkusState>(w)). */
export interface VarkusState {
  /** The current charge: lane start, heading, length, dash speed, distance covered, the lane's area id. */
  startX: number;
  startY: number;
  dirX: number;
  dirY: number;
  len: number;
  speed: number;
  travelled: number;
  laneId: number;
  /** Players the current charge has already hit. */
  hit: number[];
  /** Sim time until which a charge (lane cast + dash + the lane fading) may be in progress. */
  chargeUntil: number;
  /** Sim time the pending Execution Mark strikes (≤ w.time: none pending). */
  markStrikeAt: number;
  /** Seconds the pending mark's clock has stood still for its held player (see markTick). */
  markPaused: number;
  /** Crowd's Favour: the next pattern (cycles through the three). */
  pattern: number;
  /** Crowd's Favour: centres (x, y pairs) of the patterns of the current call. */
  centres: number[];
  /** The telegraph the current cast lands with (his lane or his cleave's circle; -1 none): see holdGate. */
  gateId: number;
  /** Seconds that telegraph has been held for a held player (at most VARKUS.maxHold). */
  held: number;
  /** Facing locked for the current cast (1 / -1; 0: he faces his target). */
  castFace: number;
  /** Crowd's Favour: seconds its tiles have been held for held players this call, and the last tick counted. */
  spikeHold: number;
  spikeHoldTick: number;
}

export const VARKUS_SCRIPT: BossScript<VarkusState> = {
  phases: [0.66, 0.33],
  roar: V.roar,
  init: (w) => ({
    startX: 0, startY: 0, dirX: 1, dirY: 0, len: 0, speed: 0, travelled: 0, laneId: -1, hit: [], chargeUntil: 0, markStrikeAt: 0,
    markPaused: 0, pattern: w.worldRng.int(0, 2), centres: [], gateId: -1, held: 0, castFace: 0, spikeHold: 0, spikeHoldTick: -1,
  }),
  // The roar cancels his telegraphs (a mark, a lane, spikes) and any charge: nothing is pending any more.
  onPhase: (_w, _i, s) => {
    s.chargeUntil = 0;
    s.markStrikeAt = 0;
    s.gateId = -1;
    s.castFace = 0;
  },
};

// --- roots never take a dodge away ------------------------------------------------------------------------------

/** A held living player whose body touches area `a`. */
function heldIn(w: World, a: Area): boolean {
  const living = w.living;
  for (let k = 0; k < living.length; k++) {
    const p = living[k];
    if (held(p) && areaContains(a, p.x, p.y, PLAYER_RADIUS)) return true;
  }
  return false;
}

/** A held living player within `r` of monster `i`. */
function heldNear(w: World, i: number, r: number): boolean {
  const m = w.monsters;
  const living = w.living;
  for (let k = 0; k < living.length; k++) {
    const p = living[k];
    if (held(p) && Math.hypot(p.x - m.x[i], p.y - m.y[i]) <= r) return true;
  }
  return false;
}

/**
 * Before the commander's tick of a locked cast (the lane, the cleave): while a held player stands in its
 * telegraph, the cast and the telegraph wait together so that at least walkOut s are left once this tick is
 * done — the fill the presenter draws stands still (or steps back to walkOut left), the strike never lands
 * on someone who couldn't move. At most maxHold s per cast.
 */
function holdGate(w: World, i: number, s: VarkusState): void {
  const a = areaById(w, s.gateId);
  if (!a || s.held >= V.maxHold || !heldIn(w, a)) return;
  const m = w.monsters;
  const r = Math.min(V.maxHold - s.held, V.walkOut + DT - m.stateTime[i]);
  if (r <= 0) return;
  m.stateTime[i] += r;
  a.age -= r;
  s.held += r;
  if (a.id === s.laneId) s.chargeUntil += r;
}

/**
 * Every tick of a spike tile: while a held player stands on it, it never gets closer than walkOut s to bursting
 * (at most maxHold s per Crowd's Favour call, however many tiles wait).
 */
function spikeTick(w: World, a: Area): void {
  const floor = a.duration - V.walkOut;
  if (a.age <= floor) return;
  const s = w.boss.state as VarkusState | null;
  if (!s || s.spikeHold >= V.maxHold || !heldIn(w, a)) return;
  a.age = floor;
  if (s.spikeHoldTick !== w.tick) {
    s.spikeHoldTick = w.tick;
    s.spikeHold += DT;
  }
}

/** Whether tiles of his Crowd's Favour are still waiting to burst. */
function spikesPending(w: World, i: number): boolean {
  const id = w.monsters.id[i];
  const areas = w.areas;
  for (let k = 0; k < areas.length; k++) {
    const a = areas[k];
    if (!a.dead && a.kind === 'arenaSpikes' && a.owner === id) return true;
  }
  return false;
}

/**
 * Nothing he starts now would still be going when a pending mark makes him leap: `dur` seconds from now end
 * before the leap (with a little slack), or no mark is pending.
 */
function free(w: World, dur: number): boolean {
  const s = bossState<VarkusState>(w);
  return s.markStrikeAt <= w.time || w.time + dur <= s.markStrikeAt - V.leapFlight - 0.1;
}

// --- Execution Mark and the leap -----------------------------------------------------------------------------

/** Handles of the mark's and the spike tiles' effects (registered once, by registerVarkusEffects). */
let markEffect = 0;
let spikeEffect = 0;

/**
 * Register the Execution Mark's effect (markTick) and the spike tiles' (spikeTick). Called when the roster
 * table is built (after every sim module has loaded); idempotent.
 */
export function registerVarkusEffects(): void {
  if (markEffect === 0) markEffect = registerAreaEffect({ onTick: markTick });
  if (spikeEffect === 0) spikeEffect = registerAreaEffect({ onTick: spikeTick });
}

/**
 * Every tick of a mark:
 *  - Held: while its player is rooted or being dragged (a hook, tar) from just before the lock until Varkus
 *    would leap, the mark's clock stands still (at most MARK_MAX_PAUSE in all) — they always get the full
 *    markTime − markLock after the lock to walk out of it. The presenter sees the countdown pause.
 *  - The leap: as the mark enters its last leapFlight seconds Varkus leaps onto it — if he stands (walking
 *    or recovering) and no lane of his is shown; otherwise only the strike lands. Marks without a living
 *    Varkus as owner just strike.
 */
function markTick(w: World, a: Area): void {
  const start = a.duration - V.leapFlight;
  const s = w.boss.state as VarkusState | null;
  const p = a.followPlayer > 0 ? w.playerById[a.followPlayer] : undefined;
  if (
    p && !p.dead && a.age - DT < start && a.age >= a.lockAt - MARK_HOLD_LEAD && held(p) &&
    s !== null && s.markPaused < MARK_MAX_PAUSE
  ) {
    a.age -= DT;
    s.markPaused += DT;
    if (s.markStrikeAt > w.time) s.markStrikeAt += DT;
    return;
  }
  if (!(a.age >= start && a.age - DT < start)) return;
  const m = w.monsters;
  const slot = a.owner >= 0 ? m.slotOf(a.owner) : -1;
  if (slot < 0 || m.kind[slot] !== VARKUS_KIND) return;
  const st = m.state[slot];
  if (st !== MSTATE.chase && st !== MSTATE.attack) return;
  if (s && w.time < s.chargeUntil) return;
  const flight = Math.max(DT, a.duration - a.age);
  m.state[slot] = MSTATE.leap;
  m.stateTime[slot] = flight;
  m.timerC[slot] = flight;
  m.sx[slot] = m.x[slot];
  m.sy[slot] = m.y[slot];
  // Onto the mark, a hair short along the flight: a player still standing on its centre must not end up
  // exactly inside his centre (bodies that coincide exactly can't be pushed apart).
  const fx = a.x - m.x[slot];
  const fy = a.y - m.y[slot];
  const fl = Math.hypot(fx, fy);
  const short = fl > LEAP_SHORT ? LEAP_SHORT / fl : 0;
  m.tx[slot] = a.x - fx * short;
  m.ty[slot] = a.y - fy * short;
  m.flags[slot] |= MFLAG.unpushable;
  m.facing[slot] = a.x >= m.x[slot] ? 1 : -1;
  stop(w, slot);
  setAnim(w, slot, ANIM.leap);
  attackEvent(w, slot, 'leap');
}

/** One tick of the leap (sx, sy → tx, ty over timerC s); he lands as the mark strikes and recovers. */
function leapTick(w: World, i: number): void {
  const m = w.monsters;
  stop(w, i);
  m.stateTime[i] -= DT;
  const u = clamp(1 - m.stateTime[i] / m.timerC[i], 0, 1);
  m.x[i] = m.sx[i] + (m.tx[i] - m.sx[i]) * u;
  m.y[i] = m.sy[i] + (m.ty[i] - m.sy[i]) * u;
  if (m.stateTime[i] > 0) return;
  m.flags[i] &= ~MFLAG.unpushable;
  m.state[i] = MSTATE.attack;
  m.stateTime[i] = V.leapRecover;
  setAnim(w, i, ANIM.attack);
}

/** The mark's victim: the farthest living player within markRange (the leap closes the gap). */
function markTarget(w: World, i: number): PlayerState | null {
  return farthestLiving(w, w.monsters.x[i], w.monsters.y[i], V.markRange);
}

function executionMark(w: World, i: number): void {
  const m = w.monsters;
  const p = markTarget(w, i);
  if (!p) return;
  spawnArea(w, 'executionMark', p.x, p.y, V.markRadius, V.markTime, {
    followPlayer: p.id, lockAt: V.markLock, owner: m.id[i], hurts: 'player', damage: monsterDamage(w, i) * V.markMult,
    dtype: DAMAGE_INDEX.physical, effect: markEffect,
  });
  const s = bossState<VarkusState>(w);
  s.markStrikeAt = w.time + V.markTime;
  s.markPaused = 0;
}

// --- Charge ----------------------------------------------------------------------------------------------------

/**
 * The charge lane (cast start): from him toward his target (a little past it), inside the arena, shown for
 * the cast and the dash. The dash follows exactly this (id-quantised) lane.
 */
function chargeTelegraph(w: World, i: number, _t: PlayerState, dx: number, dy: number, d: number): void {
  const m = w.monsters;
  const s = bossState<VarkusState>(w);
  const ux = dx / d;
  const uy = dy / d;
  const lim = w.arenaRadius - m.radius[i] - 4;
  let len = clamp(d + 60, 150, 380);
  while (len > 60 && Math.hypot(m.x[i] + ux * len, m.y[i] + uy * len) > lim) len -= 10;
  // A hair longer than cast + dash (the dash's last tick lands after chargeDash); endCharge removes it.
  const lane = spawnArea(w, 'chargeLine', m.x[i], m.y[i], len, V.chargeCast + V.chargeDash + 0.1, {
    angle: Math.atan2(uy, ux), variant: CHARGE_VARIANT, owner: m.id[i], hurts: 'none', debuff: null,
  });
  s.startX = lane.x;
  s.startY = lane.y;
  s.dirX = Math.cos(lane.angle);
  s.dirY = Math.sin(lane.angle);
  s.len = len;
  s.speed = len / V.chargeDash;
  s.travelled = 0;
  s.laneId = lane.id;
  s.hit.length = 0;
  s.chargeUntil = w.time + V.chargeCast + V.chargeChannel + 0.1;
  s.gateId = lane.id;
  s.held = 0;
  s.castFace = s.dirX >= 0 ? 1 : -1;
}

/** The dash begins: he can't be shoved off the lane, and starts from exactly its start. */
function chargeRelease(w: World, i: number): void {
  const m = w.monsters;
  const s = bossState<VarkusState>(w);
  m.flags[i] |= MFLAG.unpushable;
  m.x[i] = s.startX;
  m.y[i] = s.startY;
  m.facing[i] = s.dirX >= 0 ? 1 : -1;
}

/** One tick of the dash along the lane; true when it is over (lane covered, or a prop stopped him). */
function chargeTick(w: World, i: number): boolean {
  const m = w.monsters;
  const s = bossState<VarkusState>(w);
  // Where the lane says he is: a prop that pushed him off it ends the charge where he stands.
  const ex = s.startX + s.dirX * s.travelled;
  const ey = s.startY + s.dirY * s.travelled;
  if (Math.hypot(m.x[i] - ex, m.y[i] - ey) > CHARGE_BLOCKED) return endCharge(w, s, true);
  s.travelled = Math.min(s.len, s.travelled + s.speed * DT);
  m.x[i] = s.startX + s.dirX * s.travelled;
  m.y[i] = s.startY + s.dirY * s.travelled;
  m.vx[i] = 0;
  m.vy[i] = 0;
  // Contact is exactly the drawn lane: a player whose body touches it where he passes.
  dash.w = w;
  dash.x = m.x[i];
  dash.y = m.y[i];
  dash.dirX = s.dirX;
  dash.dirY = s.dirY;
  hitPlayersIn(w, m.x[i], m.y[i], CHARGE_HALF_WIDTH, monsterDamage(w, i) * V.chargeMult, DAMAGE_INDEX.physical, 'bleeding', s.hit, knockFromDash);
  dash.w = null;
  return s.travelled >= s.len - 1e-6 ? endCharge(w, s, false) : false;
}

/** The dash being resolved (set around hitPlayersIn, synchronously: one callback for every dash tick). */
const dash: { w: World | null; x: number; y: number; dirX: number; dirY: number } = { w: null, x: 0, y: 0, dirX: 0, dirY: 0 };

/** A charge that connects shoves its victim out of his way, forward along the lane. */
function knockFromDash(p: PlayerState): void {
  if (dash.w) knockPlayer(dash.w, p, p.x - dash.x + dash.dirX * 10, p.y - dash.y + dash.dirY * 10, V.chargeKnockback);
}

/**
 * The charge is over. Run to the end, its lane fades out by itself a moment later (a mark may leap again
 * once it has); stopped by a prop, the lane goes at once.
 */
function endCharge(w: World, s: VarkusState, blocked: boolean): true {
  const lane = areaById(w, s.laneId);
  if (blocked && lane) lane.dead = true;
  s.chargeUntil = blocked || !lane ? w.time : w.time + (lane.duration - lane.age) + DT;
  return true;
}

// --- Cleave --------------------------------------------------------------------------------------------------

/** Cleave cast start: the slam telegraph on the sand ahead of him (the strike lands exactly there). */
function cleaveTelegraph(w: World, i: number, _t: PlayerState, dx: number, dy: number, d: number): void {
  const m = w.monsters;
  const off = m.radius[i] + V.cleaveOffset;
  m.tx[i] = m.x[i] + (dx / d) * off;
  m.ty[i] = m.y[i] + (dy / d) * off;
  m.facing[i] = dx >= 0 ? 1 : -1;
  const slam = spawnArea(w, 'slamWarning', m.tx[i], m.ty[i], V.cleaveRadius, V.cleaveCast, {
    owner: m.id[i], hurts: 'player', damage: monsterDamage(w, i) * V.cleaveMult, dtype: DAMAGE_INDEX.physical,
  });
  const s = bossState<VarkusState>(w);
  s.gateId = slam.id;
  s.held = 0;
  s.castFace = m.facing[i];
}

// --- Crowd's Favour --------------------------------------------------------------------------------------------

/** One spike tile at (x, y) if it is inside the arena. */
function spike(w: World, i: number, x: number, y: number, delay: number, damage: number): void {
  const lim = w.arenaRadius - V.spikeRadius;
  if (x * x + y * y > lim * lim) return;
  spawnArea(w, 'arenaSpikes', x, y, V.spikeRadius, delay, {
    owner: w.monsters.id[i], hurts: 'player', damage, dtype: DAMAGE_INDEX.physical, effect: spikeEffect,
  });
}

/**
 * The crowd's pattern round (x, y) — `rot` turns it:
 *  0 rings       6 tiles at 40 and 11 at 84 (offset): the centre and the band between the rings are safe.
 *  1 cross       four arms of tiles from the centre out, rising from the centre outward: the quadrants are safe.
 *  2 checkerboard a 5×5 lattice: the dark squares rise first, the light ones 0.8 s later — step off, then back.
 */
function spikePattern(w: World, i: number, pattern: number, x: number, y: number, rot: number, damage: number): void {
  const W = SPIKE_WARN;
  if (pattern === 0) {
    for (let k = 0; k < 6; k++) {
      const a = rot + (k / 6) * TAU;
      spike(w, i, x + Math.cos(a) * 40, y + Math.sin(a) * 40, W + 0.1, damage);
    }
    for (let k = 0; k < 11; k++) {
      const a = rot + ((k + 0.5) / 11) * TAU;
      spike(w, i, x + Math.cos(a) * 84, y + Math.sin(a) * 84, W + 0.4, damage);
    }
  } else if (pattern === 1) {
    spike(w, i, x, y, W, damage);
    for (let arm = 0; arm < 4; arm++) {
      const a = rot + (arm * TAU) / 4;
      for (let k = 1; k <= 5; k++) spike(w, i, x + Math.cos(a) * 28 * k, y + Math.sin(a) * 28 * k, W + 0.1 * k, damage);
    }
  } else {
    const c = Math.cos(rot);
    const sn = Math.sin(rot);
    for (let gx = -2; gx <= 2; gx++) {
      for (let gy = -2; gy <= 2; gy++) {
        const lx = gx * 34;
        const ly = gy * 34;
        spike(w, i, x + lx * c - ly * sn, y + lx * sn + ly * c, (gx + gy) % 2 === 0 ? W + 0.1 : W + 0.9, damage);
      }
    }
  }
}

/**
 * Crowd's Favour: the next pattern round his target and every other living player near him — except players
 * within CROWD_SHARE of one who already has a pattern this call (they share it).
 */
function crowdsFavour(w: World, i: number, t: PlayerState): void {
  const m = w.monsters;
  const s = bossState<VarkusState>(w);
  const damage = monsterDamage(w, i) * V.spikeMult;
  const pattern = s.pattern;
  s.pattern = (s.pattern + 1) % 3;
  const rot = w.worldRng.range(0, TAU);
  s.spikeHold = 0;
  const c = s.centres;
  c.length = 0;
  spikePattern(w, i, pattern, t.x, t.y, rot, damage);
  c.push(t.x, t.y);
  const reach2 = V.crowdReach * V.crowdReach;
  const living = w.living;
  for (let k = 0; k < living.length; k++) {
    const p = living[k];
    const dx = p.x - m.x[i];
    const dy = p.y - m.y[i];
    if (p === t || dx * dx + dy * dy > reach2) continue;
    let shared = false;
    for (let q = 0; q < c.length && !shared; q += 2) shared = Math.hypot(p.x - c[q], p.y - c[q + 1]) < CROWD_SHARE;
    if (shared) continue;
    spikePattern(w, i, pattern, p.x, p.y, rot, damage);
    c.push(p.x, p.y);
  }
}

// --- Summons ---------------------------------------------------------------------------------------------------

function houndsNear(w: World, i: number, r: number): number {
  const m = w.monsters;
  const cand = w.scratch2;
  const n = w.grid.query(m.x[i] - r, m.y[i] - r, m.x[i] + r, m.y[i] + r, cand);
  let c = 0;
  for (let k = 0; k < n; k++) {
    const j = cand[k];
    if (!m.alive[j] || m.kind[j] !== PIT_HOUND) continue;
    const dx = m.x[j] - m.x[i];
    const dy = m.y[j] - m.y[i];
    if (dx * dx + dy * dy <= r * r) c++;
  }
  return c;
}

const canSummon = (w: World, i: number): boolean =>
  !fieldFull(w) && free(w, V.summonCast + 0.3) && houndsNear(w, i, V.summonCountRadius) < V.summonCap;

// --- the brain ---------------------------------------------------------------------------------------------------

/** Varkus's brain (built when the roster table is): the leap onto his mark, else his commander (see the header). */
export function varkusBrain(): Brain {
  const commander = commanderBrain({
    keepNear: V.keepNear,
    keepFar: V.keepFar,
    actions: [
      // Priority: the quick calls first (the crowd, the mark, summons), then his signature moves (whirlwind,
      // charge); the cleave fills the gaps whenever a player stands in reach. (Listed last, the summons would
      // never come: from phase 2 something else is always ready when he is free.)
      {
        every: V.crowdEvery, first: V.crowdFirst, cast: V.crowdCast, release: V.crowdRelease, phase: 3, castAttack: 'spikes',
        // Not over a pending mark (its strike and a pattern could cover each other's way out), not round anyone held.
        when: (w, i) => bossState<VarkusState>(w).markStrikeAt <= w.time && !heldNear(w, i, V.crowdReach),
        onCast: crowdsFavour,
        run: () => undefined,
      },
      {
        every: V.markEvery, first: V.markFirst, cast: V.markCast, release: V.markRelease, castAttack: 'mark',
        when: (w, i) =>
          bossState<VarkusState>(w).markStrikeAt <= w.time && w.time >= bossState<VarkusState>(w).chargeUntil && !spikesPending(w, i) &&
          markTarget(w, i) !== null,
        run: executionMark,
      },
      {
        every: V.summonEvery[0], first: V.summonFirst[0], cast: V.summonCast,
        when: (w, i) => phaseOf(w, i) === 1 && canSummon(w, i),
        run: (w, i) => summon(w, i, 'pitHound', V.summonCount[0], 40, 80),
      },
      {
        every: V.summonEvery[1], first: V.summonFirst[1], cast: V.summonCast, phase: 2,
        when: canSummon,
        run: (w, i) => summon(w, i, 'pitHound', V.summonCount[1], 40, 80),
      },
      {
        every: V.whirlEvery, first: V.whirlFirst, cast: V.whirlCast, phase: 2, castAttack: 'whirl', range: V.whirlRange,
        channel: V.whirlChannel, release: V.whirlRelease,
        when: (w, _i, t) => !held(t) && free(w, V.whirlCast + V.whirlChannel + V.whirlRelease),
        onCast: (w, i) => chainWhirl(w, i, V.whirlRadius, V.whirlCast, false, 0, 0),
        run: (w, i) => chainWhirl(w, i, V.whirlRadius, V.whirlChannel, true, V.whirlMult, V.whirlTick),
        // He walks his blades at his target — but never into one who is held (they couldn't step aside).
        tick: (w, i, t, dx, dy) => {
          if (t && !held(t)) moveAlong(w, i, dx, dy, V.whirlSpeed);
          else stop(w, i);
        },
      },
      {
        every: V.chargeEvery, first: V.chargeFirst, cast: V.chargeCast, range: V.chargeRange, attack: 'charge', channel: V.chargeChannel,
        release: V.chargeRelease,
        when: (w, i, t) => !held(t) && !spikesPending(w, i) && free(w, V.chargeCast + V.chargeChannel + V.chargeRelease + 0.2),
        onCast: chargeTelegraph,
        run: chargeRelease,
        tick: chargeTick,
      },
      {
        every: V.cleaveEvery, first: V.cleaveFirst, cast: V.cleaveCast, release: V.cleaveRelease, range: V.cleaveRange,
        when: (w, i, t) => !held(t) && !spikesPending(w, i) && free(w, V.cleaveCast + V.cleaveRelease),
        onCast: cleaveTelegraph,
        run: (w, i) => attackEvent(w, i, 'slam', w.monsters.tx[i], w.monsters.ty[i]),
      },
    ],
  });
  return (w, i, t, dx, dy, d, hunting) => {
    const m = w.monsters;
    if (m.state[i] === MSTATE.leap) {
      leapTick(w, i);
      return;
    }
    const s = bossState<VarkusState>(w);
    if (m.state[i] === MSTATE.cast && s.gateId >= 0) holdGate(w, i, s);
    commander(w, i, t, dx, dy, d, hunting);
    if (m.state[i] !== MSTATE.cast) {
      s.gateId = -1;
      s.castFace = 0;
    } else if (s.castFace !== 0) m.facing[i] = s.castFace;
  };
}
