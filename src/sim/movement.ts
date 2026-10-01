// Pure player movement, shared by the authoritative sim and client-side prediction (src/net).
//
// Both sides run exactly this code with the same inputs, so a predicted step lands on the same
// position the server computes (bit for bit, as long as the inputs match). What the client cannot
// know — knockback from heavy bodies, the crowd slow of a horde in front, pushes from allies — is
// applied by the sim *outside* this function and reaches the client as a correction.
//
// The `slow` the sim passes is `playerSlow(castSlow, debuffSlow, groundSlow)`:
//   castSlow   CAST_SLOW while a timed active (not Ember Lance) is being cast, else 0;
//   debuffSlow `debuffSlowOf(view.debuffs)`: 1 while frozen or rooted (a chain hook's pull included),
//              PLAYER_CHILL_SLOW while chilled, else 0;
//   groundSlow `areaSlowAt(view.areas, x, y)` at the feet before the step: TAR_SLOW inside a tarPool.
// A client that computes the same three from its latest snapshot predicts the step exactly; a debuff
// that starts or ends between snapshots arrives as a small correction. `predictionSlow(view)` is the
// first two combined. Casting also slows while chilled: a cast progresses `castRateOf(debuffs)` × SIM_DT
// per tick (0 while frozen).
import { PICKUP_REACH, type MovePlayer, type PlayerDebuffView, type PlayerView, type PropView } from '../contracts/sim';
import { FLOW_PLAYER, flowOut, flowVelocity, type FlowField } from '../data/layouts/flow';
import { areaSlowAt } from './area-geometry';
import { CAST_MOVE_FACTOR, PLAYER_CHILL_SLOW, PLAYER_RADIUS } from './constants';
import { clamp, finiteOr } from './math';

export { areaSlowAt };
export { PLAYER_CHILL_SLOW };

/**
 * `params.slow` of a player casting a timed active skill (not the basic attack): a fraction of
 * speed removed, so the effective factor is CAST_MOVE_FACTOR.
 */
export const CAST_SLOW = 1 - CAST_MOVE_FACTOR;

/**
 * How close (world units, feet to drop) a client should walk its PREDICTED player before sending a
 * click pickup. The server measures PICKUP_REACH (72) on its own position, which trails the
 * prediction by the inputs still queued there (≈ 1–2 ticks normally, up to 6 after a burst: at
 * 110–150 units/s that is 2–15 units). Stopping at PICKUP_REACH itself would therefore come back
 * 'tooFar' most of the time; this 16-unit cushion makes the first click succeed. A drop already
 * inside this distance is picked up at once — standing still, the two positions agree.
 */
export const PICKUP_APPROACH = PICKUP_REACH - 16;

/**
 * Two slows (fractions of speed removed) applied together: 1 − (1 − a)(1 − b). Exact when either is 0
 * (the other comes back unchanged) or 1 (rooted stays rooted), so a lone cast slow is still CAST_SLOW.
 */
export function combineSlow(a: number, b: number): number {
  if (!(b > 0)) return a;
  if (!(a > 0)) return b;
  if (a >= 1 || b >= 1) return 1;
  return 1 - (1 - a) * (1 - b);
}

/** Movement slow from debuffs: 1 when held in place (frozen, rooted, being pulled), the chill slow when chilled. */
export function debuffMoveSlow(chilled: boolean, held: boolean): number {
  return held ? 1 : chilled ? PLAYER_CHILL_SLOW : 0;
}

/** `debuffMoveSlow` from a PlayerView's debuff list (a debuff counts while its remaining time is > 0). */
export function debuffSlowOf(debuffs: readonly PlayerDebuffView[] | undefined): number {
  if (!debuffs || debuffs.length === 0) return 0;
  let chilled = false;
  let held = false;
  for (let k = 0; k < debuffs.length; k++) {
    const d = debuffs[k];
    if (!(d.remaining > 0)) continue;
    if (d.id === 'frozen' || d.id === 'rooted') held = true;
    else if (d.id === 'chilled') chilled = true;
  }
  return debuffMoveSlow(chilled, held);
}

/** Cast progress per second of cast time from debuffs: 0 frozen, 1 − PLAYER_CHILL_SLOW chilled, else 1. */
export function castRateOf(debuffs: readonly PlayerDebuffView[] | undefined): number {
  if (!debuffs || debuffs.length === 0) return 1;
  let rate = 1;
  for (let k = 0; k < debuffs.length; k++) {
    const d = debuffs[k];
    if (!(d.remaining > 0)) continue;
    if (d.id === 'frozen') return 0;
    if (d.id === 'chilled') rate = 1 - PLAYER_CHILL_SLOW;
  }
  return rate;
}

/** The slow the sim passes to movePlayer (see the header): cast, then debuffs, then the ground. */
export function playerSlow(castSlow: number, debuffSlow: number, groundSlow: number): number {
  return combineSlow(combineSlow(castSlow, debuffSlow), groundSlow);
}

/**
 * The `slow` a client should pass when predicting `player` from its latest server view: the cast
 * slow while a timed active (anything but Ember Lance) is being cast, combined
 * with the debuff slow (`debuffSlowOf`). The ground slow needs the areas: combine it with
 * `areaSlowAt(areas, x, y)` via `playerSlow` (or `combineSlow`).
 */
export function predictionSlow(player: Pick<PlayerView, 'castSkill' | 'slots'> & { debuffs?: readonly PlayerDebuffView[] }): number {
  const cast = player.castSkill;
  const castSlow = cast && cast !== 'emberLance' ? CAST_SLOW : 0;
  return combineSlow(castSlow, debuffSlowOf(player.debuffs));
}

/** Normalised move direction (length ≤ 1) written here to avoid allocating in the sim's hot path. */
export const moveDir = { x: 0, y: 0, len: 0 };

/**
 * Clamp a stick/WASD input to the unit disc (non-finite components count as 0). Uses Math.sqrt,
 * never Math.hypot: sqrt is correctly rounded in every engine, hypot is not, and the server (V8)
 * and a predicting browser (possibly SpiderMonkey/JSC) must agree to the last bit.
 */
export function readMove(moveX: number, moveY: number): typeof moveDir {
  let mx = clamp(finiteOr(moveX, 0), -1, 1);
  let my = clamp(finiteOr(moveY, 0), -1, 1);
  const ml = Math.sqrt(mx * mx + my * my);
  if (ml > 1) {
    mx /= ml;
    my /= ml;
  }
  moveDir.x = mx;
  moveDir.y = my;
  moveDir.len = ml > 1 ? 1 : ml;
  return moveDir;
}

/** Effective speed for a base move speed and a `slow` fraction (0 = full speed, 1 = rooted). */
export function slowedSpeed(speed: number, slow: number): number {
  return Math.max(0, finiteOr(speed, 0)) * (1 - clamp(finiteOr(slow, 0), 0, 1));
}

/** Scratch result of `resolvePlayerAt` (no allocation in the sim). */
const placed = { x: 0, y: 0 };

/**
 * Put a player body at (x, y): pushed out of every solid prop (in `props` order), then clamped
 * inside the arena circle. The one place player positions are resolved, so the sim and the
 * client's prediction can never disagree about walls.
 */
export function resolvePlayerAt(x: number, y: number, arenaRadius: number, props: readonly PropView[]): typeof placed {
  let px = x;
  let py = y;
  for (let k = 0; k < props.length; k++) {
    const p = props[k];
    const pr = p.radius;
    if (!(pr > 0)) continue;
    const dx = px - p.x;
    const dy = py - p.y;
    const rr = pr + PLAYER_RADIUS;
    // Cheap box reject first: most props are nowhere near the player.
    if (dx > rr || dx < -rr || dy > rr || dy < -rr) continue;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr) continue;
    const d = Math.sqrt(d2);
    if (d < 1e-4) {
      px = p.x + rr;
      continue;
    }
    const push = (rr - d) / d;
    px += dx * push;
    py += dy * push;
  }
  const lim = arenaRadius - PLAYER_RADIUS;
  const d2 = px * px + py * py;
  if (d2 > lim * lim) {
    const s = lim / Math.sqrt(d2);
    px *= s;
    py *= s;
  }
  placed.x = px;
  placed.y = py;
  return placed;
}

/**
 * One movement step (contract `MovePlayer`): speed × (1 − slow) along the clamped input, then
 * solid props and the arena edge. Pure — returns a fresh object and never mutates its arguments.
 */
export const movePlayer: MovePlayer = (state, input, params, dt) => movePlayerDrifted(state, input, params, dt, 0, 0);

/** The ground drift (flow zone: a conveyor belt) under a player's feet: scratch written by `playerFlowDrift`. */
export const flowDrift = { x: 0, y: 0 };

/**
 * The drift velocity (u/s) the layout's flow zones give a player standing at (x, y), written to `flowDrift` (0, 0 when there is no
 * field or she stands off every zone). The field must already be fixed at the tick's time (flowStep). The sim's player update and
 * client prediction both call this at the feet BEFORE the step, exactly like the ground slow.
 */
export function playerFlowDrift(field: FlowField | null | undefined, x: number, y: number): typeof flowDrift {
  if (field && field.any && flowVelocity(field, x, y, FLOW_PLAYER)) {
    flowDrift.x = flowOut.vx;
    flowDrift.y = flowOut.vy;
  } else {
    flowDrift.x = 0;
    flowDrift.y = 0;
  }
  return flowDrift;
}

/**
 * `movePlayer` plus a ground drift (fx, fy in u/s) that is added to her own velocity AFTER the slow: a belt carries a rooted or
 * frozen body too, and her own speed is untouched by it (the sim's `vx`/`vy`, and so the client's learned base speed, exclude the
 * drift). Solids and the arena edge still apply to the sum, so a belt pushing her into a rail slides her along it. With (0, 0)
 * this is bit-for-bit `movePlayer`.
 */
export function movePlayerDrifted(
  state: { x: number; y: number }, input: { moveX: number; moveY: number },
  params: { speed: number; arenaRadius: number; props: readonly PropView[]; slow: number }, dt: number, fx: number, fy: number,
): { x: number; y: number } {
  const dir = readMove(input.moveX, input.moveY);
  const speed = slowedSpeed(params.speed, params.slow);
  const step = finiteOr(dt, 0);
  const vx = dir.x * speed;
  const vy = dir.y * speed;
  const o = resolvePlayerAt(state.x + (vx + fx) * step, state.y + (vy + fy) * step, params.arenaRadius, params.props);
  return { x: o.x, y: o.y };
}
