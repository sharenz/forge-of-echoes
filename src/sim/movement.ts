// Pure player movement, shared by the authoritative sim and client-side prediction (src/net).
//
// Both sides run exactly this code with the same inputs, so a predicted step lands on the same
// position the server computes (bit for bit, as long as the inputs match). What the client cannot
// know — knockback from heavy bodies, the crowd slow of a horde in front, pushes from allies — is
// applied by the sim *outside* this function and reaches the client as a correction.
import { PICKUP_REACH, type MovePlayer, type PlayerView, type PropView } from '../contracts/sim';
import { CAST_MOVE_FACTOR, PLAYER_RADIUS } from './constants';
import { clamp, finiteOr } from './math';

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
 * The `slow` a client should pass when predicting `player` from its latest server view: the cast
 * slow while a timed active (anything but the loadout's slot-0 basic attack) is being cast, else 0.
 */
export function predictionSlow(player: Pick<PlayerView, 'castSkill' | 'slots'>): number {
  const cast = player.castSkill;
  if (!cast) return 0;
  const basic = player.slots.length > 0 ? player.slots[0].skillId : null;
  return cast === basic ? 0 : CAST_SLOW;
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
export const movePlayer: MovePlayer = (state, input, params, dt) => {
  const dir = readMove(input.moveX, input.moveY);
  const speed = slowedSpeed(params.speed, params.slow);
  const step = finiteOr(dt, 0);
  const vx = dir.x * speed;
  const vy = dir.y * speed;
  const o = resolvePlayerAt(state.x + vx * step, state.y + vy * step, params.arenaRadius, params.props);
  return { x: o.x, y: o.y };
};
