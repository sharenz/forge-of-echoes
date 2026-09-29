// Auto-attack (T): while enabled, the basic attack is held and aimed at the monster nearest to the cursor among
// those within reach of the player. Pure: works on the replicated MonsterStoreView.
import { MONSTER_KINDS } from '../contracts/content';
import { SNAPSHOT_EVERY } from '../contracts/net';
import { SIM_DT } from '../contracts/sim';
import type { MonsterStoreView } from '../contracts/sim';

/** Monsters farther than this from the player are ignored (Ember Lance flies 320). */
export const AUTO_ATTACK_RANGE = 260;

const DUMMY_KIND = MONSTER_KINDS.indexOf('trainingDummy');

export interface Point {
  x: number;
  y: number;
}

/**
 * Index of the monster to shoot at, or -1. Candidates: alive, not the hideout training dummy, within `range` of the
 * player (at their interpolated render position, `alpha` between prev and current). Among them the one closest to
 * the cursor wins, so the player steers the target with the mouse.
 */
export function pickAutoTarget(
  m: MonsterStoreView,
  alpha: number,
  player: Point,
  cursor: Point,
  range = AUTO_ATTACK_RANGE,
): number {
  let best = -1;
  let bestD = Infinity;
  const r2 = range * range;
  const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  const n = Math.min(m.capacity, m.alive.length);
  for (let i = 0; i < n; i++) {
    if (!m.alive[i] || m.kind[i] === DUMMY_KIND) continue;
    const x = m.prevX[i] + (m.x[i] - m.prevX[i]) * a;
    const y = m.prevY[i] + (m.y[i] - m.prevY[i]) * a;
    const px = x - player.x;
    const py = y - player.y;
    if (px * px + py * py > r2) continue;
    const cx = x - cursor.x;
    const cy = y - cursor.y;
    const d = cx * cx + cy * cy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Render-time position of monster `i` (written into `out`). */
export function monsterPosition(m: MonsterStoreView, i: number, alpha: number, out: Point): Point {
  const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  out.x = m.prevX[i] + (m.x[i] - m.prevX[i]) * a;
  out.y = m.prevY[i] + (m.y[i] - m.prevY[i]) * a;
  return out;
}

/** Seconds between the two snapshots a monster's prev/current positions come from. */
const SNAPSHOT_INTERVAL_S = SNAPSHOT_EVERY * SIM_DT;
/** The lead never moves the aim further than this from where the monster is drawn (world units). */
export const MAX_AIM_LEAD = 60;
/** Longest look-ahead (s): beyond it a chaser has turned anyway. */
const MAX_LEAD_SECONDS = 1;

/**
 * Where to aim so a projectile meets monster `i` (written into `out`). What the player sees is the past: remote
 * monsters are drawn `interpDelay` behind the newest snapshot, which itself is half a round trip old, and the
 * input takes another half round trip to reach the server. So the monster's snapshot velocity is extrapolated over
 * `delaySeconds` (rtt + interpolation delay) plus the projectile's flight time from `from`, capped at MAX_AIM_LEAD.
 * `projectileSpeed` 0 (non-projectile skills) leads by the delay only.
 */
export function leadAim(
  m: MonsterStoreView,
  i: number,
  alpha: number,
  from: Point,
  delaySeconds: number,
  projectileSpeed: number,
  out: Point,
): Point {
  monsterPosition(m, i, alpha, out);
  const vx = (m.x[i] - m.prevX[i]) / SNAPSHOT_INTERVAL_S;
  const vy = (m.y[i] - m.prevY[i]) / SNAPSHOT_INTERVAL_S;
  if (vx === 0 && vy === 0) return out;
  const flight = projectileSpeed > 0 ? Math.hypot(out.x - from.x, out.y - from.y) / projectileSpeed : 0;
  const t = Math.min(MAX_LEAD_SECONDS, Math.max(0, delaySeconds) + flight);
  let lx = vx * t;
  let ly = vy * t;
  const l = Math.hypot(lx, ly);
  if (l > MAX_AIM_LEAD) {
    lx *= MAX_AIM_LEAD / l;
    ly *= MAX_AIM_LEAD / l;
  }
  out.x += lx;
  out.y += ly;
  return out;
}
