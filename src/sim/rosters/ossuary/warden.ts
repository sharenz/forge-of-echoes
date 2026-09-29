// The Hollow Warden (Rimed Ossuary boss, final wave): a crowned rime-lich with a frozen lantern. Three phases
// at 100 / 66 / 33 % life (each change roars: immune, telegraphs cancelled, 'bossPhase').
//
//   all phases   Frost Nova — a disc telegraph around her (she channels it, 1.2 s); at the burst it chills
//                and hits everyone inside, and a ring of frost shards flies out from her body (gaps between
//                the shards) — slow enough that whoever stepped out of the disc sees it coming.
//                Shard volleys — a fan of frost shards at her player. Summons Rimeshades (they rise as her
//                0.6 s cast ends). A chilling lantern swing when someone stands in reach.
//   phase 2+     Glacial Spikes — a line of spikes toward every player in reach (up to four lines), erupting
//                one after another from her feet outward (chill + heavy damage); in phase 3 her own player
//                gets a fan of three.
//                Ice Prison — a ring closing on a player: walk out before it closes, or be Frozen.
//   phase 3      Blizzard — three frost storms drifting across the fight (chill + a little damage per 0.5 s),
//                renewed as they blow out.
//
// Only one big cast at a time, with a short breather between them, so the patterns stay readable; the
// volleys fill the gaps. Every freeze is the Ice Prison closing — a ring shown for its whole 2 s.
import {
  DAMAGE_INDEX, DT, MONSTER_ANIM as ANIM, MSTATE, PLAYER_RADIUS, PROJ, TAU, areaAngle, areaLine, attackEvent, bossState, clamp,
  clampToArena, extraProjectiles, faceTarget, fieldFull, fireHostile, fireHostileFrom, meleeHit, monsterDamage, moveAlong, nearestLiving,
  registerAreaEffect, setAnim, spawnArea, steer, stop, summonAt, toChase, type Area, type AreaOptions, type BossScript, type PlayerState, type World,
} from '../api';
import { WARDEN as W } from './tuning';

const CAST_NONE = 0;
const CAST_NOVA = 1;
const CAST_VOLLEY = 2;
const CAST_SPIKES = 3;
const CAST_PRISON = 4;
const CAST_SUMMON = 5;
const CAST_BLIZZARD = 6;

/** Her encounter state (BossScript state; one boss per run). */
export interface WardenState {
  novaCd: number;
  volleyCd: number;
  spikesCd: number;
  prisonCd: number;
  summonCd: number;
  blizzardCd: number;
  /** Seconds before the next big cast may start. */
  gap: number;
  /** The cast in progress (CAST_*). */
  cast: number;
}

export const WARDEN_SCRIPT: BossScript<WardenState> = {
  phases: [0.66, 0.33],
  roar: W.roar,
  init: () => ({
    novaCd: W.nova.first, volleyCd: W.volley.first, spikesCd: W.spikes.cd[1], prisonCd: W.prison.cd[1], summonCd: W.summon.first,
    blizzardCd: 0, gap: 0, cast: CAST_NONE,
  }),
  onPhase: (_w, _i, s) => {
    s.cast = CAST_NONE;
  },
  // A new phase opens with its signature: the prison (phase 2) or the storms (phase 3), then the spikes.
  // (The phase-2 timers ran down unused through phase 1, so they are set, not merely shortened.)
  onRoarEnd: (_w, _i, s, phase) => {
    s.gap = 0;
    if (phase === 2) {
      s.prisonCd = 0.5;
      s.spikesCd = 3.5;
    } else if (phase >= 3) {
      s.blizzardCd = 0;
      s.spikesCd = Math.min(s.spikesCd, 3.5);
      s.prisonCd = Math.min(s.prisonCd, 6);
    }
  },
};

/** 0-based index of the current phase into the per-phase tables. */
function phaseIndex(w: World): number {
  return clamp(w.boss.phase, 1, 3) - 1;
}

/**
 * The Frost Nova bursts (its telegraph resolved — the core has just hit and chilled everyone inside): a
 * ring of frost shards leaves from just outside her body (W.nova.shardStart of the disc's radius), evenly
 * spaced from the turn rolled when the cast began (the telegraph's angle). They need 0.65–0.85 s to reach
 * the disc's edge: a player who stepped out of the disc has time to see them and walk on or sidestep into
 * a gap. 'nova' marks the burst. Cancelled with the telegraph when she roars or dies.
 */
const NOVA_BURST = registerAreaEffect({
  onResolve(w: World, a: Area): void {
    const m = w.monsters;
    const slot = a.owner >= 0 ? m.slotOf(a.owner) : -1;
    if (slot < 0) return;
    attackEvent(w, slot, 'nova', a.x, a.y);
    const n = W.nova.shards[phaseIndex(w)] + extraProjectiles(w);
    const dmg = monsterDamage(w, slot) * W.nova.shardMult;
    const turn = areaAngle(a);
    const r0 = a.radius * W.nova.shardStart;
    for (let k = 0; k < n; k++) {
      const ang = turn + (k / n) * TAU;
      fireHostileFrom(
        w, slot, PROJ.frostShard, a.x + Math.cos(ang) * r0, a.y + Math.sin(ang) * r0, ang, W.nova.shardSpeed,
        W.nova.shardRange - r0, W.nova.shardRadius, dmg, DAMAGE_INDEX.cold,
      );
    }
  },
});

/**
 * Floats at 70–110 from her player (WARDEN.keepNear / keepFar), circling; casts one big pattern at a time
 * (see the header) with the volleys in between; swings her lantern at anyone in reach.
 */
export function brainWarden(w: World, i: number, t: PlayerState | null, dx: number, dy: number, d: number, hunting: boolean): void {
  const m = w.monsters;
  const s = bossState<WardenState>(w);
  s.novaCd -= DT;
  s.volleyCd -= DT;
  s.spikesCd -= DT;
  s.prisonCd -= DT;
  s.summonCd -= DT;
  s.blizzardCd -= DT;
  if (s.gap > 0) s.gap -= DT;

  switch (m.state[i]) {
    case MSTATE.cast:
      stop(w, i);
      faceTarget(w, i, t);
      m.stateTime[i] -= DT;
      if (m.stateTime[i] <= 0) release(w, i, s, t);
      return;
    case MSTATE.attack:
      stop(w, i);
      m.stateTime[i] -= DT;
      if (m.stateTime[i] <= 0) toChase(w, i);
      return;
  }
  if (!hunting || !t) {
    stop(w, i);
    return;
  }
  if (d > W.keepFar) steer(w, i, dx, dy, d, 1);
  else if (d < W.keepNear) moveAlong(w, i, -dx, -dy, 0.7);
  else moveAlong(w, i, -dy, dx, 0.35);
  if (m.attackCd[i] <= 0 && d <= m.radius[i] + PLAYER_RADIUS + W.meleeReach) {
    meleeHit(w, i, t, 1, 'chilled');
    m.attackCd[i] = W.meleeCd;
  }

  const p = phaseIndex(w);
  const phase = p + 1;
  if (s.gap <= 0) {
    if (phase >= 3 && s.blizzardCd <= 0) {
      s.blizzardCd = W.blizzard.cd;
      blizzards(w, i, t);
      begin(w, i, s, CAST_BLIZZARD, W.blizzard.cast);
      return;
    }
    if (phase >= 2 && s.prisonCd <= 0) {
      const victim = prisonVictim(w, i, t);
      if (victim) {
        s.prisonCd = W.prison.cd[p];
        icePrison(w, i, victim);
        begin(w, i, s, CAST_PRISON, W.prison.cast);
        return;
      }
    }
    if (phase >= 2 && s.spikesCd <= 0 && d <= W.spikes.range) {
      s.spikesCd = W.spikes.cd[p];
      glacialSpikes(w, i, t);
      begin(w, i, s, CAST_SPIKES, W.spikes.cast);
      return;
    }
    if (s.novaCd <= 0 && d <= W.nova.range) {
      s.novaCd = W.nova.cd[p];
      // The shard ring's turn is rolled now and carried as the telegraph's angle (NOVA_BURST reads it back).
      spawnArea(w, 'frostNovaWarning', m.x[i], m.y[i], W.nova.radius[p], W.nova.telegraph, {
        owner: m.id[i], hurts: 'player', damage: monsterDamage(w, i) * W.nova.mult, dtype: DAMAGE_INDEX.cold, effect: NOVA_BURST,
        angle: w.worldRng.range(0, TAU),
      });
      // She channels the nova for its whole telegraph (the windup pose); the burst is NOVA_BURST.
      begin(w, i, s, CAST_NOVA, W.nova.telegraph);
      return;
    }
    if (s.summonCd <= 0 && !fieldFull(w)) {
      // The call first: the shades rise as the cast ends (release → summonShades).
      s.summonCd = W.summon.cd[p];
      attackEvent(w, i, 'summon');
      begin(w, i, s, CAST_SUMMON, W.summon.cast);
      return;
    }
  }
  if (s.volleyCd <= 0 && d <= W.volley.range) {
    s.volleyCd = W.volley.cd[p];
    begin(w, i, s, CAST_VOLLEY, W.volley.cast);
  }
}

/** Start a cast: she stops and holds her windup pose for `time` seconds. */
function begin(w: World, i: number, s: WardenState, cast: number, time: number): void {
  const m = w.monsters;
  s.cast = cast;
  m.state[i] = MSTATE.cast;
  m.stateTime[i] = time;
  setAnim(w, i, ANIM.windup);
  stop(w, i);
  if (cast !== CAST_VOLLEY) s.gap = time + W.release + W.gap;
}

/**
 * The cast ends: the volley leaves and the summoned shades rise now (the others acted when their cast
 * began); the release pose follows.
 */
function release(w: World, i: number, s: WardenState, t: PlayerState | null): void {
  const m = w.monsters;
  if (s.cast === CAST_VOLLEY && t && !t.dead) shardVolley(w, i, t);
  else if (s.cast === CAST_SUMMON) summonShades(w, i);
  s.cast = CAST_NONE;
  m.state[i] = MSTATE.attack;
  m.stateTime[i] = W.release;
  setAnim(w, i, ANIM.attack);
}

/** A fan of frost shards at where her player is heading (partial lead: walking across it dodges). */
function shardVolley(w: World, i: number, t: PlayerState): void {
  const m = w.monsters;
  const V = W.volley;
  const n = V.count[phaseIndex(w)] + extraProjectiles(w);
  const base = Math.atan2(t.y + t.vy * V.lead - m.y[i], t.x + t.vx * V.lead - m.x[i]);
  const dmg = monsterDamage(w, i) * V.mult;
  for (let k = 0; k < n; k++) {
    fireHostile(w, i, PROJ.frostShard, base + (k - (n - 1) / 2) * V.spread, V.speed, V.range, V.radius, dmg, DAMAGE_INDEX.cold);
  }
  attackEvent(w, i, 'orb');
}

/** The Rimeshades rise in a ring around her (world rng; none if the field filled up during the cast). */
function summonShades(w: World, i: number): void {
  const m = w.monsters;
  const S = W.summon;
  const count = S.count[phaseIndex(w)];
  if (fieldFull(w)) return;
  const base = w.worldRng.range(0, TAU);
  for (let k = 0; k < count; k++) {
    const a = base + (k / count) * TAU;
    const r = w.worldRng.range(S.rMin, S.rMax);
    const p = clampToArena(w, m.x[i] + Math.cos(a) * r, m.y[i] + Math.sin(a) * r, 16);
    summonAt(w, i, 'rimeshade', p.x, p.y);
  }
}

/** Fan offsets (in W.spikes.fan steps) of a player's spike lines, the straight line first. */
const FAN = [0, -1, 1] as const;

/**
 * Glacial Spikes: lines from her feet reaching a little past her player — a fan of three in phase 3 —
 * then one toward every other living player within reach, up to W.spikes.maxLines in all; the spikes of a
 * line erupt one after another outward.
 */
function glacialSpikes(w: World, i: number, t: PlayerState): void {
  const m = w.monsters;
  const S = W.spikes;
  const opts: AreaOptions = { owner: m.id[i], hurts: 'player', damage: monsterDamage(w, i) * S.mult, dtype: DAMAGE_INDEX.cold };
  let lines = spikeLines(w, i, t, w.boss.phase >= 3 ? FAN.length : 1, S.maxLines, opts);
  for (const p of w.living) {
    if (lines >= S.maxLines) break;
    if (p === t || Math.hypot(p.x - m.x[i], p.y - m.y[i]) > S.range) continue;
    lines += spikeLines(w, i, p, 1, S.maxLines - lines, opts);
  }
  attackEvent(w, i, 'spikes');
}

/** Up to `fan` (≤ `budget`) spike lines at player `p` (FAN order); returns how many were cast. */
function spikeLines(w: World, i: number, p: PlayerState, fan: number, budget: number, opts: AreaOptions): number {
  const m = w.monsters;
  const S = W.spikes;
  const px = p.x - m.x[i];
  const py = p.y - m.y[i];
  const a = Math.atan2(py, px);
  const count = clamp(Math.ceil((Math.hypot(px, py) + S.overshoot) / S.spacing), S.minCount, S.maxCount);
  const n = Math.min(fan, budget);
  for (let k = 0; k < n; k++) {
    areaLine(w, 'glacialSpike', m.x[i], m.y[i], a + FAN[k] * S.fan, count, S.spacing, S.radius, S.first, S.step, opts);
  }
  return n;
}

/** Whom the Ice Prison closes on: her own player alone; in a party, any living player in reach (world rng). */
function prisonVictim(w: World, i: number, t: PlayerState): PlayerState | null {
  const m = w.monsters;
  const living = w.living;
  if (living.length <= 1) return Math.hypot(t.x - m.x[i], t.y - m.y[i]) <= W.prison.range ? t : null;
  let n = 0;
  for (const p of living) if (Math.hypot(p.x - m.x[i], p.y - m.y[i]) <= W.prison.range) n++;
  if (n === 0) return null;
  let pick = w.worldRng.int(0, n - 1);
  for (const p of living) {
    if (Math.hypot(p.x - m.x[i], p.y - m.y[i]) > W.prison.range) continue;
    if (pick-- === 0) return p;
  }
  return null;
}

/** Ice Prison: a ring centred on the player, closing over 2 s; they are Frozen if still inside when it shuts. */
function icePrison(w: World, i: number, p: PlayerState): void {
  const m = w.monsters;
  spawnArea(w, 'icePrison', p.x, p.y, W.prison.radius, W.prison.close, {
    target: p.id, owner: m.id[i], hurts: 'player', damage: monsterDamage(w, i) * W.prison.mult, dtype: DAMAGE_INDEX.cold,
  });
  attackEvent(w, i, 'prison', p.x, p.y);
}

/**
 * Blizzard: three storms around her player, drifting slowly across the fight and bouncing off the arena
 * edge. Never on top of anyone: each starts at least W.blizzard.clear beyond its radius from every living
 * player — a storm that finds no such spot (a party spread all around her player) is pushed out past the
 * nearest player, or not cast at all.
 */
function blizzards(w: World, i: number, t: PlayerState): void {
  const m = w.monsters;
  const B = W.blizzard;
  const rng = w.worldRng;
  const dmg = monsterDamage(w, i) * B.mult;
  const rot = rng.range(0, TAU);
  const keep = B.radius + B.clear;
  for (let k = 0; k < B.count; k++) {
    let x = 0;
    let y = 0;
    let clear = false;
    for (let attempt = 0; attempt < 8 && !clear; attempt++) {
      const a = rot + (k / B.count) * TAU + rng.range(-B.spreadJitter, B.spreadJitter);
      const r = rng.range(B.near, B.far);
      const c = clampToArena(w, t.x + Math.cos(a) * r, t.y + Math.sin(a) * r, B.radius + 10);
      x = c.x;
      y = c.y;
      clear = clearOfPlayers(w, x, y, keep);
    }
    if (!clear) {
      // Out past whoever is nearest the last spot tried, straight away from them.
      const p = nearestLiving(w, x, y);
      if (p) {
        const d = Math.hypot(x - p.x, y - p.y);
        const ux = d > 1e-3 ? (x - p.x) / d : 1;
        const uy = d > 1e-3 ? (y - p.y) / d : 0;
        const c = clampToArena(w, p.x + ux * (keep + 1), p.y + uy * (keep + 1), B.radius + 10);
        x = c.x;
        y = c.y;
        clear = clearOfPlayers(w, x, y, keep);
      }
    }
    if (!clear) continue;
    const heading = Math.atan2(t.y - y, t.x - x) + rng.range(-B.headingJitter, B.headingJitter);
    const speed = rng.range(B.speedMin, B.speedMax);
    spawnArea(w, 'blizzard', x, y, B.radius, B.duration, {
      vx: Math.cos(heading) * speed, vy: Math.sin(heading) * speed, angle: heading, tickInterval: B.tick, firstTick: B.tick,
      hurts: 'player', damage: dmg, dtype: DAMAGE_INDEX.cold, owner: m.id[i],
    });
  }
  attackEvent(w, i, 'blizzard');
}

function clearOfPlayers(w: World, x: number, y: number, r: number): boolean {
  for (const p of w.living) if (Math.hypot(p.x - x, p.y - y) < r) return false;
  return true;
}
