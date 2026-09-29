// Physical drops (bounce out of corpses/chests, magnetise, auto-pickup through hooks.tryPickup;
// click pickups and floor drops through the SimRun API).
//
// Loot is INSTANCED: every monster/chest drop belongs to one player (spec.owner) and only that
// player can magnetise or pick it up. Items a player puts on the floor are PUBLIC (owner 0): anyone
// in the instance may click them. Only `spec.autoPickup` drops of a living owner are collected by
// walking over them; equipment and public drops wait for a click (requestPickup). Kill XP is awarded
// immediately and shared with every living player in the instance.
import { hashU32 } from '../core/rng';
import { PICKUP_REACH, type DropSpec, type PickupResult } from '../contracts/sim';
import {
  DROP_EDGE_MARGIN, DROP_GRAVITY, DROP_PICKUP_DELAY, DROP_PROP_RADIUS, DROP_TOUCH_RADIUS, DT, FLOOR_TOSS_ANGLE_MAX,
  FLOOR_TOSS_ANGLE_MIN, FLOOR_TOSS_LIFT_MAX, FLOOR_TOSS_LIFT_MIN, FLOOR_TOSS_SPEED_MAX, FLOOR_TOSS_SPEED_MIN, MAX_PLAYER_ID,
} from './constants';
import { resolveProps } from './grid';
import { tryPickup } from './hooks';
import { TAU, finiteOr, lerp } from './math';
import type { Drop, PlayerState, World } from './world';

const DROP_MAGNET_MAX_SPEED = 420;
const DROP_MAGNET_ACCEL = 900;

/** A new drop leaving (x, y) with the given launch velocity; it lands (and may bounce) on its own. */
function airborneDrop(w: World, spec: DropSpec, x: number, y: number, vx: number, vy: number, vz: number): Drop {
  return {
    id: w.nextDropId++,
    spec,
    x,
    y,
    prevX: x,
    prevY: y,
    z: 0,
    age: 0,
    blocked: false,
    vx,
    vy,
    vz,
    bounces: 0,
    landed: false,
    touching: false,
    magnet: false,
    speed: 0,
  };
}

/**
 * Spawn drops at a point. `fountain` = big spray (bosses, rares, chests). Each owner's drops are
 * spread evenly around the corpse on their own, so every player sees a tidy ring of their loot.
 */
export function spawnDrops(w: World, specs: readonly DropSpec[], x: number, y: number, fountain: boolean): void {
  const rng = w.worldRng;
  const owners: number[] = [];
  for (const spec of specs) if (!owners.includes(spec.owner)) owners.push(spec.owner);
  for (const owner of owners) {
    let n = 0;
    for (const spec of specs) if (spec.owner === owner) n++;
    const base = rng.range(0, TAU);
    let k = 0;
    for (const spec of specs) {
      if (spec.owner !== owner) continue;
      const ang = n > 1 ? base + (k / n) * TAU + rng.range(-0.35, 0.35) : base;
      k++;
      const speed = fountain ? rng.range(45, 100) : rng.range(22, 55);
      const vx = Math.cos(ang) * speed;
      const vy = Math.sin(ang) * speed;
      const vz = fountain ? rng.range(170, 230) : rng.range(110, 150);
      w.drops.push(airborneDrop(w, spec, x, y, vx, vy, vz));
      w.events.push({ t: 'dropSpawn', owner: spec.owner, tone: spec.tone, x, y, label: spec.label });
    }
  }
}

/** Scratch result of `groundPoint`. */
const ground = { x: 0, y: 0 };

/** Pull (x, y) inside the arena (DROP_EDGE_MARGIN from the edge). */
function clampToArena(w: World, x: number, y: number): typeof ground {
  const lim = w.arenaRadius - DROP_EDGE_MARGIN;
  const r2 = x * x + y * y;
  if (r2 > lim * lim) {
    const s = lim / Math.sqrt(r2);
    x *= s;
    y *= s;
  }
  ground.x = x;
  ground.y = y;
  return ground;
}

/**
 * The nearest spot to (x, y) where an item may lie: inside the arena and out of every solid prop
 * (a few relaxation passes for props that touch each other), never back outside the arena.
 */
function groundPoint(w: World, x: number, y: number): typeof ground {
  let o = clampToArena(w, x, y);
  for (let pass = 0; pass < 3; pass++) {
    const r = resolveProps(w.propGrid, o.x, o.y, DROP_PROP_RADIUS);
    o = clampToArena(w, r.x, r.y);
    if (!r.hit) break;
  }
  return o;
}

/**
 * Why `spec` can't be put on the floor, or null. Its owner must be 0 (public) or a player present
 * in the instance: a drop owned by anyone else could never be seen or picked up.
 */
function validFloorSpec(w: World, spec: DropSpec): string | null {
  if (!spec || typeof spec !== 'object') return 'spec must be a DropSpec object';
  if (!Number.isFinite(spec.token)) return `spec.token must be a finite number (got ${String(spec.token)})`;
  if (typeof spec.autoPickup !== 'boolean') return 'spec.autoPickup must be a boolean';
  if (typeof spec.label !== 'string' || typeof spec.tone !== 'string' || typeof spec.sprite !== 'string' || typeof spec.iconId !== 'string') {
    return 'spec.label / tone / sprite / iconId must be strings';
  }
  const owner = spec.owner;
  if (owner === 0) return null;
  if (!Number.isInteger(owner) || owner < 1 || owner > MAX_PLAYER_ID || !w.playerById[owner]) {
    return `spec.owner must be 0 (public) or a player in this instance (got ${String(owner)})`;
  }
  return null;
}

const U32 = 4294967296;

/**
 * SimRun.spawnDrop: put an item on the floor near (x, y) — a player dropping something at their
 * feet. It is tossed a short hop (z arc + one small bounce) in front of the point (towards the
 * camera, FLOOR_TOSS_ANGLE_MIN..MAX) in a direction hashed from its id and the tick, so it never
 * draws from (or perturbs) the world rng stream, and it starts from — and lands on — open ground
 * inside the arena. Emits 'dropSpawn' (owner = spec.owner, 0 = everyone nearby). Throws on a
 * malformed spec or an owner that isn't 0 / a present player, BEFORE changing anything, so the
 * server can keep the item where it was.
 */
export function spawnFloorDrop(w: World, spec: DropSpec, x: number, y: number): number {
  const problem = validFloorSpec(w, spec);
  if (problem) throw new TypeError(`sim.spawnDrop: ${problem}`);
  const at = groundPoint(w, finiteOr(x, 0), finiteOr(y, 0));
  const id = w.nextDropId;
  const h1 = hashU32((Math.imul(id, 0x9e3779b1) ^ hashU32(w.tick >>> 0)) >>> 0);
  const h2 = hashU32((h1 ^ 0x68e31da4) >>> 0);
  const h3 = hashU32((h2 ^ 0x1b56c4e9) >>> 0);
  const ang = lerp(FLOOR_TOSS_ANGLE_MIN, FLOOR_TOSS_ANGLE_MAX, h1 / U32);
  const speed = lerp(FLOOR_TOSS_SPEED_MIN, FLOOR_TOSS_SPEED_MAX, h2 / U32);
  const lift = lerp(FLOOR_TOSS_LIFT_MIN, FLOOR_TOSS_LIFT_MAX, h3 / U32);
  const drop = airborneDrop(w, spec, at.x, at.y, Math.cos(ang) * speed, Math.sin(ang) * speed, lift);
  w.drops.push(drop);
  w.events.push({ t: 'dropSpawn', owner: spec.owner, tone: spec.tone, x: drop.x, y: drop.y, label: spec.label });
  return drop.id;
}

/** Remove a player's un-picked own drops (they left the instance). Public drops (owner 0) stay. */
export function removePlayerDrops(w: World, playerId: number): void {
  const drops = w.drops;
  let write = 0;
  for (let k = 0; k < drops.length; k++) if (drops[k].spec.owner !== playerId) drops[write++] = drops[k];
  drops.length = write;
}

function dropIndex(w: World, dropId: number): number {
  const drops = w.drops;
  for (let k = 0; k < drops.length; k++) if (drops[k].id === dropId) return k;
  return -1;
}

/** SimRun.removeDrop: the drop vanishes without anyone picking it up (expiry). Unknown ids are ignored. */
export function removeDrop(w: World, dropId: number): void {
  const k = dropIndex(w, dropId);
  if (k >= 0) w.drops.splice(k, 1);
}

/** Take a drop off the ground for `p`: remove it, then the 'pickup' cue and outcome. */
function collect(w: World, d: Drop, p: PlayerState): void {
  const k = w.drops.indexOf(d);
  if (k >= 0) w.drops.splice(k, 1);
  w.events.push({ t: 'pickup', owner: d.spec.owner, playerId: p.id, tone: d.spec.tone, x: d.x, y: d.y, label: d.spec.label });
  w.outcomes.push({ t: 'pickup', playerId: p.id, token: d.spec.token });
}

/** The hook refused (inventory full): the drop stays, flagged, and stops flying toward anyone. */
function refuse(d: Drop): void {
  d.blocked = true;
  d.magnet = false;
  d.speed = 0;
}

/**
 * SimRun.requestPickup: player `playerId` clicked drop `dropId`. In order:
 *   'missing'  — no such drop (already taken / expired), or the player isn't in this instance;
 *   'notYours' — someone else's instanced loot (public drops, owner 0, are everyone's);
 *   'tooFar'   — the player lies dead, or their feet are more than PICKUP_REACH from the drop;
 *   'full'     — hooks.tryPickup refused (or threw): the drop stays and is flagged `blocked`;
 *   'ok'       — removed, 'pickup' event (owner + playerId) and outcome emitted.
 * Works for auto-pickup drops too, and on a drop that is still bouncing.
 */
export function requestPickup(w: World, playerId: number, dropId: number): PickupResult {
  const k = dropIndex(w, dropId);
  if (k < 0) return 'missing';
  const p = Number.isInteger(playerId) && playerId >= 1 && playerId <= MAX_PLAYER_ID ? w.playerById[playerId] : undefined;
  if (!p) return 'missing';
  const d = w.drops[k];
  const owner = d.spec.owner;
  if (owner !== 0 && owner !== p.id) return 'notYours';
  if (p.dead) return 'tooFar';
  const dx = d.x - p.x;
  const dy = d.y - p.y;
  if (dx * dx + dy * dy > PICKUP_REACH * PICKUP_REACH) return 'tooFar';
  if (!tryPickup(w, p.id, d.spec.token)) {
    refuse(d);
    return 'full';
  }
  collect(w, d, p);
  return 'ok';
}

export function updateDrops(w: World): void {
  const drops = w.drops;
  if (drops.length === 0) return;
  let removed = false;
  for (let k = 0; k < drops.length; k++) {
    const d = drops[k];
    d.age += DT;
    if (!d.landed) {
      d.x += d.vx * DT;
      d.y += d.vy * DT;
      d.vz -= DROP_GRAVITY * DT;
      d.z += d.vz * DT;
      if (d.z <= 0) {
        d.z = 0;
        if (d.bounces < 1 && d.vz < -60) {
          d.vz = -d.vz * 0.35;
          d.vx *= 0.5;
          d.vy *= 0.5;
          d.bounces++;
        } else {
          d.landed = true;
          d.vz = 0;
          d.vx = 0;
          d.vy = 0;
        }
      }
      let g = clampToArena(w, d.x, d.y);
      if (d.landed) {
        // Never leave loot inside a pillar (nor pushed out of one past the arena edge).
        const o = resolveProps(w.propGrid, g.x, g.y, DROP_PROP_RADIUS);
        g = clampToArena(w, o.x, o.y);
      }
      d.x = g.x;
      d.y = g.y;
    }
    // Walk-over collection is for the owner's own auto-pickup loot only (currency, flasks, maps),
    // and only while they are alive. Equipment and public floor items (owner 0 — no player has that
    // id) lie still until someone clicks them (requestPickup).
    if (!d.landed || !d.spec.autoPickup) continue;
    const p = w.playerById[d.spec.owner];
    if (!p || p.dead) continue;
    let dx = p.x - d.x;
    let dy = p.y - d.y;
    let dist = Math.hypot(dx, dy);
    if (!d.blocked && d.age >= DROP_PICKUP_DELAY && dist < Math.max(0, p.stats.pickupRadius)) d.magnet = true;
    if (d.magnet && !d.blocked && dist > 1e-3) {
      d.speed = Math.min(DROP_MAGNET_MAX_SPEED, d.speed + DROP_MAGNET_ACCEL * DT);
      const step = Math.min(dist, d.speed * DT);
      d.x += (dx / dist) * step;
      d.y += (dy / dist) * step;
      dx = p.x - d.x;
      dy = p.y - d.y;
      dist = Math.hypot(dx, dy);
    }
    const touch = dist <= DROP_TOUCH_RADIUS;
    if (touch && !d.touching && d.age >= DROP_PICKUP_DELAY) {
      d.touching = true;
      if (tryPickup(w, p.id, d.spec.token)) {
        w.events.push({ t: 'pickup', owner: p.id, playerId: p.id, tone: d.spec.tone, x: d.x, y: d.y, label: d.spec.label });
        w.outcomes.push({ t: 'pickup', playerId: p.id, token: d.spec.token });
        d.age = -1; // marker: remove
        removed = true;
      } else {
        // Inventory full (or the hook failed): the drop stays where it is until its owner walks
        // over it again (or clicks it).
        refuse(d);
      }
    } else if (!touch && dist > DROP_TOUCH_RADIUS + 12) {
      d.touching = false;
    }
  }
  if (removed) {
    let write = 0;
    for (let k = 0; k < drops.length; k++) if (drops[k].age >= 0) drops[write++] = drops[k];
    drops.length = write;
  }
}

/** Shared XP: one whole-number outcome for the whole instance; fractional XP carries over. */
export function grantXp(w: World, amount: number): void {
  const total = w.xpCarry + amount;
  const whole = Math.floor(total + 1e-6);
  w.xpCarry = total - whole;
  if (whole > 0) w.outcomes.push({ t: 'xp', amount: whole });
}
