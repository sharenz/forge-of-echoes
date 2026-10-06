// Monster update: target selection (the nearest living player, with hysteresis), staggered
// pack-level thinking, boids-style separation through the grid, the per-kind brains of the rosters
// (src/sim/rosters; bosses through the phase driver in bosses.ts), and integration (knockback,
// props, arena, player bodies).
import { AILMENT_BIT } from '../contracts/sim';
import { ELITE, STRIKE_MASK } from './archetypes';
import { MONSTER_ANIM as ANIM, MSTATE, setAnim, stop, turnToward } from './behaviour';
import { driveBoss } from './bosses';
import { driveEventMonster, eventAilments } from './map-events';
import { tickDecay, tickExposure, tickIgnite } from './combat';
import {
  AGGRO_RADIUS, CHILL_SLOW, DT, EMPOWER_BONUS, HASTE_BONUS, KNOCKBACK_RATE, LARGE_BODY_RADIUS, MEMBER_AGGRO_RADIUS,
  MONSTER_HIT_FLASH_DECAY, PACK_THINK_INTERVAL, PLAYER_RADIUS, PROP_SIDE_MEMORY, PROP_SLIDE_TIME, PROP_STUCK_PROGRESS, PROP_STUCK_TIME,
  RETARGET_RATIO,
  SEPARATION_MAX_STEP, SEPARATION_RELAX, SLEEP_RADIUS, WARDED_ALLY_RADIUS,
  ELITE_STRIKE_DAMAGE, ELITE_STRIKE_PERIOD, ELITE_STRIKE_RANGE, ELITE_STRIKE_WINDUP,
} from './constants';
import { resolveProps } from './grid';
import { DAMAGE_INDEX, TAU } from './math';
import { spawnArea } from './areas';
import { monsterDefs } from './rosters';
import { navBeginTick, navDrift, navSteer } from './nav';
import { FLOW_AIR, FLOW_BOSS, FLOW_HEAVY, FLOW_MONSTER, flowOut, flowVelocity } from '../data/layouts/flow';
import { MFLAG } from './stores';
import { augmentStatusBits } from './skills/primitives/state';
import type { PlayerState, World } from './world';

const RETARGET2 = RETARGET_RATIO * RETARGET_RATIO;
const GHOST = MFLAG.ghost;
/** A belt never carries a monster faster than this share of its own speed (a slow walker can always gain ground against it). */
const FLOW_MONSTER_CAP = 0.6;

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
  const defs = monsterDefs();
  const nav = navBeginTick(w); // null outside hand-crafted layouts: no navigation work at all
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
    if (m.exposeTime[i] > 0) tickExposure(w, i, DT);
    if (m.empowerTime[i] > 0) m.empowerTime[i] -= DT;
    if (m.hasteTime[i] > 0) m.hasteTime[i] -= DT;
    if (m.groundCd[i] > 0) m.groundCd[i] -= DT;
    // Burning (a phase-immune boss lets the burn run out harmlessly; see tickIgnite).
    if (m.igniteTime[i] > 0 && tickIgnite(w, i, DT)) continue;
    if (m.decayTime[i] > 0 && tickDecay(w, i, DT)) continue;

    let bits = 0;
    if (m.igniteTime[i] > 0) bits |= AILMENT_BIT.burning;
    if (m.chillTime[i] > 0) bits |= AILMENT_BIT.chilled;
    if (m.shockTime[i] > 0) bits |= AILMENT_BIT.shocked;
    if (m.flags[i] & MFLAG.shielded) bits |= AILMENT_BIT.shielded;
    if (m.empowerTime[i] > 0) bits |= AILMENT_BIT.empowered;
    if (m.flags[i] & MFLAG.frozen) bits |= AILMENT_BIT.frozen;
    if (m.flags[i] & MFLAG.fixture) bits |= AILMENT_BIT.fixture;
    if (m.decayTime[i] > 0) bits |= AILMENT_BIT.decayed;
    bits |= augmentStatusBits(w, i); // power rework SK5: lodged / marked
    if (w.mapEvent && (w.mapEvent.members.size > 0 || w.mapEvent.exposed.size > 0)) bits |= eventAilments(w, m.id[i]);
    m.ailments[i] = bits;

    // Statues and fixtures are inert bodies: no brain, no movement, no attacks (they only stand there and can be pressed against).
    if (m.flags[i] & (MFLAG.frozen | MFLAG.fixture)) {
      stop(w, i);
      integrate(w, i);
      continue;
    }

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

    const def = defs[m.kind[i]];
    const t = pickTarget(w, i);
    if (def.role === 'dummy') {
      def.brain(w, i, t, 0, 0, 1e9, false);
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
    if (m.mods[i] & STRIKE_MASK && hunting && t && !t.dead) eliteStrikes(w, i, t, d);
    let owned = false;
    if (driveEventMonster(w, i, t)) owned = true; // An event script owns this monster; normal integration still follows below.
    else if (def.boss) driveBoss(w, i, def, t, dx, dy, d, hunting);
    else def.brain(w, i, t, dx, dy, d, hunting);
    // Layout arenas: when a wall stands between a walking monster and its target, follow the flow field round it (src/sim/nav.ts).
    if (nav && t && m.alive[i]) navSteer(w, nav, i, t, dx, dy, d, hunting, owned);
    // A guarding shield turns toward its target at its own pace (flanking is the counterplay); the
    // presenter shows it through `facing`, and a block through the 'blocked' event.
    if (def.block && m.flags[i] & MFLAG.guard && t && m.alive[i]) turnToward(w, i, dx, dy, def.block.turnRate);
    if (m.alive[i]) integrate(w, i, hunting);
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
  const flags = m.flags;
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
        if (!alive[i] || flags[i] & GHOST) continue;
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
            if (d2 >= rr * rr || !alive[j] || flags[j] & GHOST) continue;
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
    if (!m.alive[i] || m.radius[i] <= LARGE_BODY_RADIUS || m.flags[i] & GHOST) continue;
    const reach = m.radius[i] + w.grid.maxRadius;
    const n = w.grid.query(m.x[i] - reach, m.y[i] - reach, m.x[i] + reach, m.y[i] + reach, cand);
    for (let k = 0; k < n; k++) {
      const j = cand[k];
      if (j === i || !m.alive[j] || m.flags[j] & GHOST) continue;
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

/**
 * Apply desired velocity, separation, knockback, props, arena and the player bodies.
 *
 * Heavy bodies walking (MSTATE.chase) can't squeeze through a gap between props narrower than they
 * are, and props push straight back, so a boss steering at a player behind two standing stones would
 * wedge there for good. When one makes (almost) no headway into props for PROP_STUCK_TIME it slides
 * sideways — to the freer side — for PROP_SLIDE_TIME, which walks it around the obstacle (see
 * slideStep / trackStuck). Only heavy bodies that are `hunting` do this: small monsters fit through
 * every gap the layout leaves and the crowd jostles them loose, and an idle pack milling against a
 * stone is harmless (it never fires in open ground or while milling: no drift of old paths).
 */
function integrate(w: World, i: number, hunting = false): void {
  const m = w.monsters;
  let vx = m.vx[i];
  let vy = m.vy[i];
  const slider = hunting && (m.flags[i] & (MFLAG.heavy | GHOST)) === MFLAG.heavy && m.state[i] === MSTATE.chase;
  const wishX = vx;
  const wishY = vy;
  if (slider && m.slide[i] !== 0) {
    slideStep(w, i, vx, vy);
    vx = slideOut.x;
    vy = slideOut.y;
  }
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
  if (m.hasteTime[i] > 0) f *= 1 + HASTE_BONUS;
  if (w.mapEvent && w.mapEvent.monsterSpeed !== 1) f *= w.mapEvent.monsterSpeed;
  const x0 = m.x[i];
  const y0 = m.y[i];
  let nx = x0 + vx * f * DT + sx;
  let ny = y0 + vy * f * DT + sy;
  // Conveyor belts (D 10.5a): the ground carries every body but fixtures, ghosts and the dummy (heavy ones and bosses half), on top
  // of whatever the brain did (a leap or charge keeps its own velocity). Scenery below still stops the sum. Never more than 60% of
  // the monster's own speed, so a slow walker can always make headway against a belt.
  let fdx = 0;
  let fdy = 0;
  const flows = w.layout?.flows;
  if (flows && !(m.flags[i] & (MFLAG.unpushable | MFLAG.fixture | MFLAG.frozen))) {
    const fl = m.flags[i];
    const cls = fl & GHOST ? FLOW_AIR : fl & MFLAG.boss ? FLOW_BOSS : fl & MFLAG.heavy ? FLOW_HEAVY : FLOW_MONSTER;
    if (flowVelocity(flows, x0, y0, cls)) {
      let fvx = flowOut.vx;
      let fvy = flowOut.vy;
      const fl2 = fvx * fvx + fvy * fvy;
      const cap = m.speed[i] * FLOW_MONSTER_CAP;
      if (fl2 > cap * cap && cap > 0) {
        const k = cap / Math.sqrt(fl2);
        fvx *= k;
        fvy *= k;
      }
      fdx = fvx * DT;
      fdy = fvy * DT;
      nx += fdx;
      ny += fdy;
      navDrift(w, i, fdx, fdy);
    }
  }

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
  if ((m.flags[i] & GHOST) === 0) {
    const o = resolveProps(w.propGrid, nx, ny, r);
    nx = o.x;
    ny = o.y;
    if (slider) trackStuck(w, i, o.hit, x0 + fdx, y0 + fdy, nx, ny, wishX * f, wishY * f);
  }
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
  // A guarding shield faces where it aims (turnShield), not where it walks.
  if ((m.flags[i] & MFLAG.guard) === 0) {
    if (vx > 1) m.facing[i] = 1;
    else if (vx < -1) m.facing[i] = -1;
  }
  if (m.state[i] === MSTATE.chase) setAnim(w, i, vx * vx + vy * vy > 4 ? ANIM.move : ANIM.idle);
}

const slideOut = { x: 0, y: 0 };

/** While sliding along props, this share of the step leans off their surface (so gaps don't catch it). */
const SLIDE_LEAN = 0.25;
/** Props within this of touching count for a sliding body's surface normal. */
const SLIDE_CONTACT_PAD = 3;

/**
 * The velocity of a sliding heavy body (into `slideOut`), at its wish's speed: along the surface of
 * the props it touches (perpendicular to their combined normal, leaning slightly off them), toward the
 * side the sign of m.slide names — or sideways to its wish when it touches none. Counts the slide down.
 * Side +1 is the wish turned a quarter anticlockwise (−y first for a wish along −x).
 */
function slideStep(w: World, i: number, vx: number, vy: number): void {
  const m = w.monsters;
  const side = m.slide[i] > 0 ? 1 : -1;
  const left = Math.abs(m.slide[i]) - DT;
  m.slide[i] = left > 1e-6 ? side * left : 0;
  const l = Math.sqrt(vx * vx + vy * vy);
  if (l < 1) {
    slideOut.x = vx;
    slideOut.y = vy;
    return;
  }
  // Combined outward normal of the props it (nearly) touches.
  const x = m.x[i];
  const y = m.y[i];
  const r = m.radius[i];
  let nx = 0;
  let ny = 0;
  const near = w.propGrid.near(x, y);
  for (let k = 0; k < near.length; k++) {
    const p = near[k];
    const dx = x - p.x;
    const dy = y - p.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-4 || d > p.radius + r + SLIDE_CONTACT_PAD) continue;
    nx += dx / d;
    ny += dy / d;
  }
  const nl = Math.sqrt(nx * nx + ny * ny);
  let tx: number;
  let ty: number;
  if (nl > 1e-3) {
    nx /= nl;
    ny /= nl;
    // Along the surface, on the side that matches "the wish turned by `side`".
    tx = ny;
    ty = -nx;
    if ((-vy * side) * tx + (vx * side) * ty < 0) {
      tx = -tx;
      ty = -ty;
    }
    tx += nx * SLIDE_LEAN;
    ty += ny * SLIDE_LEAN;
  } else {
    tx = -vy * side;
    ty = vx * side;
  }
  const tl = Math.sqrt(tx * tx + ty * ty);
  slideOut.x = (tx / tl) * l;
  slideOut.y = (ty / tl) * l;
}

/**
 * After the props resolved a heavy walker's step: count how long it has been walking into props
 * without headway along its wish (wx, wy: the brain's velocity, already speed-scaled), and start a
 * slide once that reaches PROP_STUCK_TIME. The first slide of an episode goes to the side where a
 * probe step moves more freely; later ones keep that side until the body has been clear of props for
 * PROP_SIDE_MEMORY, so it follows a wall to its end.
 */
function trackStuck(w: World, i: number, hit: boolean, x0: number, y0: number, nx: number, ny: number, wx: number, wy: number): void {
  const m = w.monsters;
  if (m.slide[i] !== 0) return;
  if (!hit) {
    // Clear of props: count the free time (negative) and forget the side after a while.
    const t = Math.min(m.stuckTime[i], 0) - DT;
    m.stuckTime[i] = t;
    if (t <= -PROP_SIDE_MEMORY) {
      m.stuckTime[i] = -PROP_SIDE_MEMORY;
      m.slideSide[i] = 0;
    }
    return;
  }
  const wl = Math.sqrt(wx * wx + wy * wy);
  const step = wl * DT;
  if (step < 0.05 || ((nx - x0) * wx + (ny - y0) * wy) / wl >= PROP_STUCK_PROGRESS * step) {
    // Against a prop but getting along (sliding off it): not stuck, and not clear of it either.
    m.stuckTime[i] = 0;
    return;
  }
  const t = Math.max(m.stuckTime[i], 0) + DT;
  if (t < PROP_STUCK_TIME) {
    m.stuckTime[i] = t;
    return;
  }
  m.stuckTime[i] = 0;
  let side = m.slideSide[i];
  if (side === 0) {
    // Probe a few steps to each side and slide where the props let it go further.
    const r = m.radius[i];
    const probe = Math.max(step * 6, r * 0.5);
    const ux = wx / wl;
    const uy = wy / wl;
    let o = resolveProps(w.propGrid, nx - uy * probe, ny + ux * probe, r);
    const plus = Math.hypot(o.x - nx, o.y - ny);
    o = resolveProps(w.propGrid, nx + uy * probe, ny - ux * probe, r);
    const minus = Math.hypot(o.x - nx, o.y - ny);
    side = plus > minus + 1e-3 ? 1 : minus > plus + 1e-3 ? -1 : m.offsetAngle[i] < Math.PI ? 1 : -1;
    m.slideSide[i] = side;
  }
  m.slide[i] = side * PROP_SLIDE_TIME;
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

/**
 * Stormcalled and Rending rares periodically mark the ground under their target (a stormStrike telegraph that
 * shocks, a rendStrike that bleeds). Both are ordinary areas: the warning circle is the counterplay, and armour /
 * resistance / evasion decide how much a hit that lands hurts. Staggered by slot; a rare with both alternates.
 */
function eliteStrikes(w: World, i: number, t: PlayerState, d: number): void {
  const m = w.monsters;
  const mods = m.mods[i];
  if (d > ELITE_STRIKE_RANGE || m.spawnTime[i] > 0) return;
  const phase = (w.tick + i * 41) % ELITE_STRIKE_PERIOD;
  const storm = (mods & ELITE.stormcalled) !== 0;
  const rend = (mods & ELITE.rending) !== 0;
  let lightning: boolean;
  if (storm && rend) {
    if (phase !== 0 && phase !== ELITE_STRIKE_PERIOD / 2) return;
    lightning = phase === 0;
  } else {
    if (phase !== 0) return;
    lightning = storm;
  }
  spawnArea(w, lightning ? 'stormStrike' : 'rendStrike', t.x, t.y, lightning ? 30 : 26, ELITE_STRIKE_WINDUP, {
    damage: m.damage[i] * ELITE_STRIKE_DAMAGE, dtype: lightning ? DAMAGE_INDEX.lightning : DAMAGE_INDEX.physical,
    hurts: 'player', owner: m.id[i], debuff: lightning ? 'shocked' : 'bleeding',
  });
}
