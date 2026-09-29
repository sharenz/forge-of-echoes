// Monster update: target selection (the nearest living player, with hysteresis), staggered
// pack-level thinking, boids-style separation through the grid, per-kind brains for the regular
// roster, and integration (knockback, props, arena, player bodies).
import { MONSTER_KINDS } from '../contracts/content';
import { AILMENT_BIT } from '../contracts/sim';
import { BEHAVIOUR, ELITE, KIND_INDEX } from './archetypes';
import {
  MONSTER_ANIM as ANIM, MSTATE, extraProjectiles, empowerMult, faceTarget, fireHostile, meleeHit, moveAlong, muzzleOffset, setAnim,
  steer, stop, toChase, wander,
} from './behaviour';
import { brainHerald, brainMatriarch } from './bosses';
import { spawnArea } from './areas';
import { tickIgnite } from './combat';
import {
  AGGRO_RADIUS, CHILL_SLOW, DT, EMPOWER_BONUS, KNOCKBACK_RATE, LARGE_BODY_RADIUS, MEMBER_AGGRO_RADIUS, MONSTER_HIT_FLASH_DECAY,
  PACK_THINK_INTERVAL, PLAYER_RADIUS, RETARGET_RATIO, SEPARATION_MAX_STEP, SEPARATION_RELAX, SLEEP_RADIUS, SPIT_FLIGHT,
  WARDED_ALLY_RADIUS,
} from './constants';
import { resolveProps } from './grid';
import { DAMAGE_INDEX, TAU } from './math';
import { PROJ } from './projectiles';
import { MFLAG } from './stores';
import type { PlayerState, World } from './world';

const ASHLING = KIND_INDEX.ashling;
const SKITTER = KIND_INDEX.emberSkitter;
const SPITTER = KIND_INDEX.cinderSpitter;
const STALKER = KIND_INDEX.riftStalker;
const BRUTE = KIND_INDEX.ironhideBrute;
const HERALD = KIND_INDEX.ashboundHerald;
const MATRIARCH = KIND_INDEX.cinderMatriarch;
const DUMMY = KIND_INDEX.trainingDummy;

const RETARGET2 = RETARGET_RATIO * RETARGET_RATIO;

/** Squared distance to the nearest *present* player from the last pickTarget call (sleep check). */
let nearestPresentD2 = Infinity;

/**
 * The player monster `i` chases: the nearest living player, but the current target is kept until
 * someone is RETARGET_RATIO times closer (no flicker between two players). When nobody is alive
 * the previous target's body is still returned (in-progress attacks finish on the corpse, which
 * takes no damage); null once that player has left too.
 */
function pickTarget(w: World, i: number): PlayerState | null {
  const m = w.monsters;
  const x = m.x[i];
  const y = m.y[i];
  const players = w.players;
  let near: PlayerState | null = null;
  let nearD2 = Infinity;
  let presentD2 = Infinity;
  for (let k = 0; k < players.length; k++) {
    const p = players[k];
    const dx = p.x - x;
    const dy = p.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < presentD2) presentD2 = d2;
    if (!p.dead && d2 < nearD2) {
      nearD2 = d2;
      near = p;
    }
  }
  nearestPresentD2 = presentD2;
  const cur = m.target[i] > 0 ? w.playerById[m.target[i]] : undefined;
  if (!near) return cur ?? null;
  if (cur && cur !== near && !cur.dead) {
    const dx = cur.x - x;
    const dy = cur.y - y;
    if (dx * dx + dy * dy <= nearD2 * RETARGET2) return cur;
  }
  m.target[i] = near.id;
  return near;
}

export function updateMonsters(w: World): void {
  thinkPacks(w);
  computeSeparation(w);
  const m = w.monsters;
  // m.hwm is re-read every iteration: summons spawned mid-loop still act this tick.
  for (let i = 0; i < m.hwm; i++) {
    if (!m.alive[i]) continue;
    m.animTime[i] += DT;
    if (m.hitFlash[i] > 0) {
      const f = m.hitFlash[i] - DT * MONSTER_HIT_FLASH_DECAY;
      m.hitFlash[i] = f > 0 ? f : 0;
    }
    if (m.attackCd[i] > 0) m.attackCd[i] -= DT;
    if (m.chillTime[i] > 0) m.chillTime[i] -= DT;
    if (m.shockTime[i] > 0) m.shockTime[i] -= DT;
    if (m.empowerTime[i] > 0) m.empowerTime[i] -= DT;
    if (m.groundCd[i] > 0) m.groundCd[i] -= DT;
    // Burning (a phase-immune boss lets the burn run out harmlessly; see tickIgnite).
    if (m.igniteTime[i] > 0 && tickIgnite(w, i, DT)) continue;

    let bits = 0;
    if (m.igniteTime[i] > 0) bits |= AILMENT_BIT.burning;
    if (m.chillTime[i] > 0) bits |= AILMENT_BIT.chilled;
    if (m.shockTime[i] > 0) bits |= AILMENT_BIT.shocked;
    if (m.flags[i] & MFLAG.shielded) bits |= AILMENT_BIT.shielded;
    if (m.empowerTime[i] > 0) bits |= AILMENT_BIT.empowered;
    m.ailments[i] = bits;

    if (m.spawnTime[i] > 0) {
      m.spawnTime[i] -= DT;
      if (m.spawnTime[i] <= 0) {
        m.spawnTime[i] = 0;
        setAnim(w, i, ANIM.idle);
      }
      stop(w, i);
      integrate(w, i);
      continue;
    }

    const kind = m.kind[i];
    const t = pickTarget(w, i);
    if (kind === DUMMY) {
      brainDummy(w, i, t);
      integrate(w, i); // rooted, but still a solid body players bump into
      continue;
    }
    let dx = 0;
    let dy = 0;
    let d = 1e9;
    if (t) {
      dx = t.x - m.x[i];
      dy = t.y - m.y[i];
      d = Math.sqrt(dx * dx + dy * dy) || 1e-6;
    }
    const hunting = t !== null && !t.dead && isHunting(w, i, d);
    if (!hunting && m.state[i] === MSTATE.chase && nearestPresentD2 > SLEEP_RADIUS * SLEEP_RADIUS) {
      // Asleep: far from every player and not hunting. No movement work at all.
      stop(w, i);
      setAnim(w, i, ANIM.idle);
      continue;
    }
    if (m.mods[i] & ELITE.warded && (w.tick + i) % 10 === 0) updateWarded(w, i);
    switch (kind) {
      case ASHLING: brainAshling(w, i, t, dx, dy, d, hunting); break;
      case SKITTER: brainSkitter(w, i, t, dx, dy, d, hunting); break;
      case SPITTER: brainSpitter(w, i, t, dx, dy, d, hunting); break;
      case STALKER: brainStalker(w, i, t, dx, dy, d, hunting); break;
      case BRUTE: brainBrute(w, i, t, dx, dy, d, hunting); break;
      case HERALD: brainHerald(w, i, t, dx, dy, d, hunting); break;
      case MATRIARCH: brainMatriarch(w, i, t, dx, dy, d, hunting); break;
    }
    if (m.alive[i]) integrate(w, i);
  }
}

function isHunting(w: World, i: number, d: number): boolean {
  const pk = w.monsters.pack[i];
  if (pk < 0) return true;
  const pack = w.packs[pk];
  if (!pack.aggro && d < MEMBER_AGGRO_RADIUS) pack.aggro = true;
  return pack.aggro;
}

/** Pack-level decisions, one pack per tick slot (staggered so the cost is flat). */
function thinkPacks(w: World): void {
  const packs = w.packs;
  const living = w.living;
  const dir = w.director;
  const finalWave = dir.wave > 0 && dir.wave >= w.config.waves.count;
  for (let k = 0; k < packs.length; k++) {
    const pack = packs[k];
    if (pack.active && pack.alive <= 0) pack.active = false; // e.g. every member failed to spawn
    if (!pack.active || pack.aggro) continue;
    if ((k + w.tick) % PACK_THINK_INTERVAL !== 0) continue;
    // Wake when any living player comes near; stragglers of older waves (and everyone in the
    // final wave) hunt the party so there is never a long cleanup. Nobody alive: keep milling.
    let near = false;
    for (let q = 0; q < living.length && !near; q++) {
      const dx = living[q].x - pack.homeX;
      const dy = living[q].y - pack.homeY;
      near = dx * dx + dy * dy < AGGRO_RADIUS * AGGRO_RADIUS;
    }
    const straggler = pack.wave < dir.wave && dir.waveTime > 10;
    if (living.length > 0 && (near || straggler || finalWave)) {
      pack.aggro = true;
      continue;
    }
    if (w.worldRng.next() < 0.25) {
      const a = w.worldRng.range(0, TAU);
      const r = w.worldRng.range(0, 50);
      pack.goalX = pack.homeX + Math.cos(a) * r;
      pack.goalY = pack.homeY + Math.sin(a) * r;
    }
  }
}

/**
 * Cheap boids separation: each overlapping pair (found through the grid, every pair once) is
 * pushed apart, with the push shared by size so small monsters flow around big ones.
 * Regular bodies use the half-neighbourhood of each cell (exact while radii sum to ≤ one cell);
 * bodies above LARGE_BODY_RADIUS are handled in a separate pass against everything near them.
 * This is the hottest loop in the sim, so it works on local typed arrays with early rejects.
 */
function computeSeparation(w: World): void {
  const m = w.monsters;
  const g = w.grid;
  const sepX = m.sepX;
  const sepY = m.sepY;
  sepX.fill(0, 0, m.hwm);
  sepY.fill(0, 0, m.hwm);
  if (m.count < 2) return; // nobody to separate (an idle hideout, a map between waves)
  const xs = m.x;
  const ys = m.y;
  const rs = m.radius;
  const alive = m.alive;
  const cols = g.cols;
  const start = g.cellStart;
  const items = g.items;
  const neigh = NEIGHBOURS;
  let large = 0;
  for (let r = 0; r < cols; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = r * cols + c;
      const s0 = start[cell];
      const e0 = start[cell + 1];
      if (s0 === e0) continue;
      // Forward half-neighbourhood: E, SW, S, SE.
      let nn = 0;
      if (c + 1 < cols) neigh[nn++] = cell + 1;
      if (r + 1 < cols) {
        if (c > 0) neigh[nn++] = cell + cols - 1;
        neigh[nn++] = cell + cols;
        if (c + 1 < cols) neigh[nn++] = cell + cols + 1;
      }
      for (let a = s0; a < e0; a++) {
        const i = items[a];
        if (!alive[i]) continue;
        const ri = rs[i];
        if (ri > LARGE_BODY_RADIUS) {
          large++;
          continue;
        }
        const xi = xs[i];
        const yi = ys[i];
        for (let q = -1; q < nn; q++) {
          const b0 = q < 0 ? a + 1 : start[neigh[q]];
          const b1 = q < 0 ? e0 : start[neigh[q] + 1];
          for (let b = b0; b < b1; b++) {
            const j = items[b];
            const rj = rs[j];
            if (rj > LARGE_BODY_RADIUS) continue;
            const rr = ri + rj;
            const dx = xs[j] - xi;
            if (dx > rr || dx < -rr) continue;
            const dy = ys[j] - yi;
            if (dy > rr || dy < -rr) continue;
            const d2 = dx * dx + dy * dy;
            if (d2 >= rr * rr || !alive[j]) continue;
            pushApart(m, i, j, dx, dy, d2, rr);
          }
        }
      }
    }
  }
  if (large > 0) separateLarge(w);
}

const NEIGHBOURS = new Int32Array(4);

/** Pairs involving an oversized body (the boss): checked against every monster in reach. */
function separateLarge(w: World): void {
  const m = w.monsters;
  const cand = w.scratch2;
  for (let i = 0; i < m.hwm; i++) {
    if (!m.alive[i] || m.radius[i] <= LARGE_BODY_RADIUS) continue;
    const reach = m.radius[i] + w.grid.maxRadius;
    const n = w.grid.query(m.x[i] - reach, m.y[i] - reach, m.x[i] + reach, m.y[i] + reach, cand);
    for (let k = 0; k < n; k++) {
      const j = cand[k];
      if (j === i || !m.alive[j]) continue;
      // Two large bodies: handle the pair once, from the lower slot.
      if (m.radius[j] > LARGE_BODY_RADIUS && j < i) continue;
      const dx = m.x[j] - m.x[i];
      const dy = m.y[j] - m.y[i];
      const rr = m.radius[i] + m.radius[j];
      const d2 = dx * dx + dy * dy;
      if (d2 < rr * rr) pushApart(m, i, j, dx, dy, d2, rr);
    }
  }
}

/** Resolve one overlapping pair into the separation accumulators. */
function pushApart(m: World['monsters'], i: number, j: number, dx: number, dy: number, d2: number, rr: number): void {
  let nx: number;
  let ny: number;
  let d = Math.sqrt(d2);
  if (d < 1e-4) {
    // Exactly stacked: split along a deterministic per-pair direction.
    const a = ((i * 73 + j * 151) % 360) * (TAU / 360);
    nx = Math.cos(a);
    ny = Math.sin(a);
    d = 0;
  } else {
    nx = dx / d;
    ny = dy / d;
  }
  const overlap = rr - d;
  const fi = m.flags[i];
  const fj = m.flags[j];
  const ri = m.radius[i];
  const rj = m.radius[j];
  // Share of the push each side takes: by size, none for immovable bodies, and a monster already
  // touching the player is anchored so the ones queuing behind it give way.
  const wi = fi & MFLAG.unpushable ? 0 : rj * rj * (fi & MFLAG.touching ? 0.2 : 1);
  const wj = fj & MFLAG.unpushable ? 0 : ri * ri * (fj & MFLAG.touching ? 0.2 : 1);
  const tot = wi + wj;
  if (tot <= 0) return;
  const pi = (overlap * wi) / tot;
  const pj = (overlap * wj) / tot;
  m.sepX[i] -= nx * pi;
  m.sepY[i] -= ny * pi;
  m.sepX[j] += nx * pj;
  m.sepY[j] += ny * pj;
}

/** Apply desired velocity, separation, knockback, props, arena and the player bodies. */
function integrate(w: World, i: number): void {
  const m = w.monsters;
  let vx = m.vx[i];
  let vy = m.vy[i];
  const pushable = !(m.flags[i] & MFLAG.unpushable);
  let sx = 0;
  let sy = 0;
  if (pushable) {
    sx = m.sepX[i];
    sy = m.sepY[i];
    const sl = Math.sqrt(sx * sx + sy * sy);
    if (sl > 1e-3) {
      // Don't drive into neighbours: drop the part of the desired velocity that fights the
      // separation push, so a blocked monster slides around the crowd instead of compressing it.
      const ux = sx / sl;
      const uy = sy / sl;
      const into = vx * ux + vy * uy;
      if (into < 0) {
        vx -= into * ux;
        vy -= into * uy;
      }
      sx *= SEPARATION_RELAX;
      sy *= SEPARATION_RELAX;
      const step = sl * SEPARATION_RELAX;
      if (step > SEPARATION_MAX_STEP) {
        sx *= SEPARATION_MAX_STEP / step;
        sy *= SEPARATION_MAX_STEP / step;
      }
    }
  }
  let f = 1;
  if (m.chillTime[i] > 0) f *= 1 - CHILL_SLOW;
  if (m.empowerTime[i] > 0) f *= 1 + EMPOWER_BONUS;
  let nx = m.x[i] + vx * f * DT + sx;
  let ny = m.y[i] + vy * f * DT + sy;

  if (pushable) {
    const kx = m.kbX[i];
    const ky = m.kbY[i];
    if (kx !== 0 || ky !== 0) {
      const stx = kx * KNOCKBACK_RATE;
      const sty = ky * KNOCKBACK_RATE;
      nx += stx;
      ny += sty;
      const rx = kx - stx;
      const ry = ky - sty;
      if (Math.abs(rx) + Math.abs(ry) < 0.02) {
        m.kbX[i] = 0;
        m.kbY[i] = 0;
      } else {
        m.kbX[i] = rx;
        m.kbY[i] = ry;
      }
    }
  }

  const r = m.radius[i];
  const o = resolveProps(w.propGrid, nx, ny, r);
  nx = o.x;
  ny = o.y;
  const lim = w.arenaRadius - r;
  const d2 = nx * nx + ny * ny;
  if (d2 > lim * lim) {
    const s = lim / Math.sqrt(d2);
    nx *= s;
    ny *= s;
  }

  let touching = false;
  if (m.state[i] !== MSTATE.leap) {
    const living = w.living;
    const rr = r + PLAYER_RADIUS;
    const heavy = (m.flags[i] & (MFLAG.unpushable | MFLAG.heavy)) !== 0;
    for (let k = 0; k < living.length; k++) {
      const p = living[k];
      if (p.dead) continue;
      const bx = nx - p.x;
      const by = ny - p.y;
      if (bx > rr || bx < -rr || by > rr || by < -rr) continue;
      const b2 = bx * bx + by * by;
      if (b2 >= rr * rr || b2 <= 1e-8) continue;
      const bd = Math.sqrt(b2);
      const ov = rr - bd;
      const ux = bx / bd;
      const uy = by / bd;
      if (heavy) {
        // Heavy and immovable bodies (boss, herald, brutes, dummy) hold their ground and push
        // the player out instead: a sorceress can't bulldoze an armoured bruiser.
        p.pushX -= ux * ov;
        p.pushY -= uy * ov;
      } else {
        // Regular monsters give way (a horde in her path slows her instead; see crowdFactor).
        nx += ux * ov;
        ny += uy * ov;
        touching = true;
      }
    }
  }
  if (touching) m.flags[i] |= MFLAG.touching;
  else m.flags[i] &= ~MFLAG.touching;

  m.x[i] = nx;
  m.y[i] = ny;
  if (vx > 1) m.facing[i] = 1;
  else if (vx < -1) m.facing[i] = -1;
  if (m.state[i] === MSTATE.chase) setAnim(w, i, vx * vx + vy * vy > 4 ? ANIM.move : ANIM.idle);
}

/** Warded rares: 40% less damage taken while at least two allies stand close. */
function updateWarded(w: World, i: number): void {
  const m = w.monsters;
  const cand = w.scratch2;
  const R = WARDED_ALLY_RADIUS;
  const n = w.grid.query(m.x[i] - R, m.y[i] - R, m.x[i] + R, m.y[i] + R, cand);
  let allies = 0;
  for (let k = 0; k < n && allies < 2; k++) {
    const j = cand[k];
    if (j === i || !m.alive[j]) continue;
    const dx = m.x[j] - m.x[i];
    const dy = m.y[j] - m.y[i];
    if (dx * dx + dy * dy <= R * R) allies++;
  }
  if (allies >= 2) m.flags[i] |= MFLAG.shielded;
  else m.flags[i] &= ~MFLAG.shielded;
}

// --- brains --------------------------------------------------------------------------------------

function brainDummy(w: World, i: number, t: PlayerState | null): void {
  const m = w.monsters;
  stop(w, i);
  if (m.stateTime[i] > 0) {
    m.stateTime[i] -= DT;
    if (m.stateTime[i] <= 0) setAnim(w, i, ANIM.idle);
  }
  faceTarget(w, i, t);
}

/** Ashling: walks at its player; a short windup, then a lunge-bite. */
function brainAshling(w: World, i: number, t: PlayerState | null, dx: number, dy: number, d: number, hunting: boolean): void {
  const m = w.monsters;
  const B = BEHAVIOUR.ashling;
  const st = m.state[i];
  if (st === MSTATE.windup) {
    stop(w, i);
    if (!t) {
      toChase(w, i);
      return;
    }
    faceTarget(w, i, t);
    m.stateTime[i] -= DT;
    if (m.stateTime[i] <= 0) {
      m.state[i] = MSTATE.attack;
      m.stateTime[i] = B.lungeTime;
      setAnim(w, i, ANIM.attack);
      // The lunge carries the ashling forward a few units.
      m.kbX[i] += (dx / d) * B.lungeSpeed * B.lungeTime * 0.5;
      m.kbY[i] += (dy / d) * B.lungeSpeed * B.lungeTime * 0.5;
      if (d <= m.radius[i] + PLAYER_RADIUS + B.reach + 4) meleeHit(w, i, t);
      m.attackCd[i] = B.cooldown;
    }
    return;
  }
  if (st === MSTATE.attack) {
    stop(w, i);
    m.stateTime[i] -= DT;
    if (m.stateTime[i] <= 0) toChase(w, i);
    return;
  }
  if (!hunting) {
    wander(w, i);
    return;
  }
  steer(w, i, dx, dy, d, 1);
  if (m.attackCd[i] <= 0 && d <= m.radius[i] + PLAYER_RADIUS + B.reach) {
    m.state[i] = MSTATE.windup;
    m.stateTime[i] = B.windup;
    setAnim(w, i, ANIM.windup);
    stop(w, i);
  }
}

/** Ember Skitter: fast, zig-zagging in bursts; quick bites without windup. */
function brainSkitter(w: World, i: number, t: PlayerState | null, dx: number, dy: number, d: number, hunting: boolean): void {
  const m = w.monsters;
  const B = BEHAVIOUR.skitter;
  if (m.state[i] === MSTATE.attack) {
    stop(w, i);
    m.stateTime[i] -= DT;
    if (m.stateTime[i] <= 0) toChase(w, i);
    return;
  }
  if (!hunting || !t) {
    wander(w, i);
    return;
  }
  const time = w.time;
  const ph = m.phase[i];
  const weave = Math.sin(time * B.zigzagFreq + ph) * B.zigzagAmp * (d > 40 ? 1 : 0.3);
  const burst = 0.55 + 0.9 * Math.max(0, Math.sin(time * B.burstFreq + ph * 1.7));
  const ang = Math.atan2(dy, dx) + weave;
  const v = m.speed[i] * burst;
  m.vx[i] = Math.cos(ang) * v;
  m.vy[i] = Math.sin(ang) * v;
  if (m.attackCd[i] <= 0 && d <= m.radius[i] + PLAYER_RADIUS + B.reach) {
    meleeHit(w, i, t);
    m.attackCd[i] = B.cooldown;
    m.state[i] = MSTATE.attack;
    m.stateTime[i] = B.biteTime;
    setAnim(w, i, ANIM.attack);
    stop(w, i);
  }
}

/**
 * Cinder Spitter: keeps 140–220 away and lobs fire spit every 2.4 s. The spit is a true lob:
 * it flies for exactly SPIT_FLIGHT seconds toward where its player is heading and bursts where
 * it lands (radius SPIT_SPLASH_RADIUS), so its landing spot is readable and dodgeable. The
 * presenter draws its height as 4h·u(1−u) with u = age / life.
 */
function brainSpitter(w: World, i: number, t: PlayerState | null, dx: number, dy: number, d: number, hunting: boolean): void {
  const m = w.monsters;
  const B = BEHAVIOUR.spitter;
  if (m.state[i] === MSTATE.cast) {
    stop(w, i);
    if (!t) {
      toChase(w, i);
      return;
    }
    faceTarget(w, i, t);
    m.stateTime[i] -= DT;
    if (m.stateTime[i] <= 0) {
      const tx = t.x + t.vx * B.lead - m.x[i];
      const ty = t.y + t.vy * B.lead - m.y[i];
      const base = Math.atan2(ty, tx);
      // Ground distance from the muzzle to the landing point; the speed makes it land on time.
      const dist = Math.min(B.range, Math.max(B.minRange, Math.hypot(tx, ty))) - muzzleOffset(w, i);
      const speed = Math.max(0, dist) / SPIT_FLIGHT;
      const count = 1 + extraProjectiles(w);
      const dmg = m.damage[i] * empowerMult(w, i);
      for (let k = 0; k < count; k++) {
        const a = base + (k - (count - 1) / 2) * B.spread;
        fireHostile(w, i, PROJ.cinderSpit, a, speed, dist, B.radius, dmg, DAMAGE_INDEX.fire, SPIT_FLIGHT);
      }
      w.events.push({ t: 'monsterAttack', kind: MONSTER_KINDS[m.kind[i]], x: m.x[i], y: m.y[i], attack: 'spit' });
      setAnim(w, i, ANIM.attack);
      m.state[i] = MSTATE.attack;
      m.stateTime[i] = 0.25;
      m.attackCd[i] = B.cooldown + w.worldRng.range(0, 0.5);
    }
    return;
  }
  if (m.state[i] === MSTATE.attack) {
    stop(w, i);
    m.stateTime[i] -= DT;
    if (m.stateTime[i] <= 0) toChase(w, i);
    return;
  }
  if (!hunting) {
    wander(w, i);
    return;
  }
  if (d < B.near) moveAlong(w, i, -dx, -dy, 1);
  else if (d > B.far) steer(w, i, dx, dy, d, 1);
  else {
    // Strafe around the player while in the comfort band.
    const side = m.offsetAngle[i] > Math.PI ? 1 : -1;
    moveAlong(w, i, -dy * side, dx * side, 0.4);
  }
  if (m.attackCd[i] <= 0 && d < B.fireRange) {
    m.state[i] = MSTATE.cast;
    m.stateTime[i] = B.windup;
    setAnim(w, i, ANIM.windup);
    stop(w, i);
  }
}

/** Rift Stalker: every 4 s marks its player's position (0.6 s) and leaps onto it. */
function brainStalker(w: World, i: number, t: PlayerState | null, dx: number, dy: number, d: number, hunting: boolean): void {
  const m = w.monsters;
  const B = BEHAVIOUR.stalker;
  const st = m.state[i];
  if (st === MSTATE.windup) {
    stop(w, i);
    m.facing[i] = m.tx[i] >= m.x[i] ? 1 : -1;
    m.stateTime[i] -= DT;
    if (m.stateTime[i] <= 0) {
      m.state[i] = MSTATE.leap;
      m.stateTime[i] = B.flight;
      m.sx[i] = m.x[i];
      m.sy[i] = m.y[i];
      m.flags[i] |= MFLAG.unpushable;
      setAnim(w, i, ANIM.leap);
      w.events.push({ t: 'monsterAttack', kind: 'riftStalker', x: m.x[i], y: m.y[i], attack: 'leap' });
    }
    return;
  }
  if (st === MSTATE.leap) {
    stop(w, i);
    m.stateTime[i] -= DT;
    const t = Math.min(1, 1 - m.stateTime[i] / B.flight);
    m.x[i] = m.sx[i] + (m.tx[i] - m.sx[i]) * t;
    m.y[i] = m.sy[i] + (m.ty[i] - m.sy[i]) * t;
    if (m.stateTime[i] <= 0) {
      m.flags[i] &= ~MFLAG.unpushable;
      m.state[i] = MSTATE.attack;
      m.stateTime[i] = B.recover;
      setAnim(w, i, ANIM.attack);
    }
    return;
  }
  if (st === MSTATE.attack) {
    stop(w, i);
    m.stateTime[i] -= DT;
    if (m.stateTime[i] <= 0) {
      toChase(w, i);
      m.attackCd[i] = B.cooldown;
    }
    return;
  }
  if (!hunting || !t) {
    wander(w, i);
    return;
  }
  steer(w, i, dx, dy, d, 1);
  if (m.attackCd[i] <= 0 && d < B.trigger && d > B.minTrigger) {
    let tx = t.x;
    let ty = t.y;
    const lim = w.arenaRadius - m.radius[i];
    const tl = Math.hypot(tx, ty);
    if (tl > lim) {
      tx *= lim / tl;
      ty *= lim / tl;
    }
    m.tx[i] = tx;
    m.ty[i] = ty;
    spawnArea(w, 'leapWarning', tx, ty, B.radius, B.windup + B.flight, {
      damage: m.damage[i] * empowerMult(w, i), dtype: DAMAGE_INDEX.void, hurts: 'player', owner: m.id[i],
    });
    m.state[i] = MSTATE.windup;
    m.stateTime[i] = B.windup;
    setAnim(w, i, ANIM.windup);
    stop(w, i);
  }
}

/** Ironhide Brute: slow and armoured; a 0.9 s telegraphed slam. */
function brainBrute(w: World, i: number, t: PlayerState | null, dx: number, dy: number, d: number, hunting: boolean): void {
  const m = w.monsters;
  const B = BEHAVIOUR.brute;
  const st = m.state[i];
  if (st === MSTATE.windup) {
    stop(w, i);
    m.stateTime[i] -= DT;
    if (m.stateTime[i] <= 0) {
      m.state[i] = MSTATE.attack;
      m.stateTime[i] = B.recover;
      setAnim(w, i, ANIM.attack);
      w.events.push({ t: 'monsterAttack', kind: 'ironhideBrute', x: m.tx[i], y: m.ty[i], attack: 'slam' });
    }
    return;
  }
  if (st === MSTATE.attack) {
    stop(w, i);
    m.stateTime[i] -= DT;
    if (m.stateTime[i] <= 0) {
      toChase(w, i);
      m.attackCd[i] = B.cooldown;
    }
    return;
  }
  if (!hunting) {
    wander(w, i);
    return;
  }
  steer(w, i, dx, dy, d, 1);
  const r = m.radius[i];
  if (m.attackCd[i] <= 0 && d < r + B.radius + PLAYER_RADIUS * 0.5) {
    const ux = dx / d;
    const uy = dy / d;
    const cx = m.x[i] + ux * (r + 12);
    const cy = m.y[i] + uy * (r + 12);
    m.tx[i] = cx;
    m.ty[i] = cy;
    faceTarget(w, i, t);
    spawnArea(w, 'slamWarning', cx, cy, B.radius, B.windup, {
      damage: m.damage[i] * empowerMult(w, i), dtype: DAMAGE_INDEX.physical, hurts: 'player', owner: m.id[i],
    });
    m.state[i] = MSTATE.windup;
    m.stateTime[i] = B.windup;
    setAnim(w, i, ANIM.windup);
    stop(w, i);
  }
}

