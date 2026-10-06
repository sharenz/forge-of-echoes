// Arc Chain's flagship augments (power rework SK5): `ramp` (Overcharge), `mark` on the first target (Conductive Mark), `fork` at
// the last link (Forking Arc), `return` to the first target (Storm Return) and `onKill` (Static Discharge), plus `fork` from a
// Storm Call strike (Conduction: one more link from the strike). The plain chain stays in ../emitters.ts (bit-identical goldens);
// an augmented chain runs here with the same targeting rules: nearest the cursor within reach, then the nearest unhit enemy in
// jump range with a line of sight.
import type { SkillRuntimeDef } from '../../../contracts/sim';
import { damageMonster, isHittable } from '../../combat';
import { ARC_TARGET_RANGE, MUZZLE_OFFSET } from '../../constants';
import { coverBlocked, coverClip } from '../../cover';
import { DAMAGE_INDEX } from '../../math';
import type { PlayerState, World } from '../../world';
import { markMonster, markShock } from './mark';
import { explodeVictim } from './onkill';
import { prim } from './state';

let QUERY = new Int32Array(0);

function query(w: World, x: number, y: number, pad: number): number {
  if (QUERY.length < w.monsters.capacity) QUERY = new Int32Array(w.monsters.capacity);
  return w.grid.query(x - pad, y - pad, x + pad, y + pad, QUERY);
}

/** The nearest hittable monster within `jump` of (x, y) that `hit` does not hold, in line of sight; -1 if none. */
export function nextLink(w: World, x: number, y: number, jump: number, hit: readonly number[], notSlot = -1): number {
  const m = w.monsters;
  const n = query(w, x, y, jump + w.grid.maxRadius);
  let next = -1;
  let nextD = Infinity;
  for (let k = 0; k < n; k++) {
    const i = QUERY[k];
    if (i === notSlot || !isHittable(w, i) || hit.includes(m.id[i])) continue;
    const dx = m.x[i] - x;
    const dy = m.y[i] - y;
    const d2 = dx * dx + dy * dy;
    const r = jump + m.radius[i];
    if (d2 <= r * r && d2 < nextD && !coverBlocked(w, x, y, m.x[i], m.y[i], 0)) {
      nextD = d2;
      next = i;
    }
  }
  return next;
}

interface Link {
  def: SkillRuntimeDef;
  owner: number;
  dtype: number;
}

/** One strike of the chain on slot `i` at `scale` × the hit; on-kill and marks applied. Returns whether it killed. */
function strike(w: World, l: Link, i: number, scale: number, fromX: number, fromY: number, first: boolean): boolean {
  const m = w.monsters;
  const def = l.def;
  const x = m.x[i];
  const y = m.y[i];
  const victim = { id: m.id[i], x, y, maxLife: m.maxLife[i], shocked: m.shockTime[i] > 0, chilled: m.chillTime[i] > 0 };
  const chance = Math.min(1, def.ailmentChance + markShock(w, i, l.owner, def.id));
  const dmg = def.damage * scale;
  const killed = damageMonster(w, i, dmg, l.dtype, def.critChance, def.critMultiplier, chance, x - fromX, y - fromY, 0.5, true, l.owner);
  const mark = prim(def, 'mark');
  if (mark && !killed && (!mark.first || first)) markMonster(w, i, l.owner, def.id, mark);
  const ok = prim(def, 'onKill');
  if (killed && ok) explodeVictim(w, l.owner, ok, victim, dmg);
  return killed;
}

/** Arc Chain with its augments (the targeting of emitChain, then fork / return). */
export function emitChainAugmented(
  w: World, p: PlayerState, def: SkillRuntimeDef, jump: number, revisit: boolean, aimX: number, aimY: number, dirX: number, dirY: number,
): void {
  const m = w.monsters;
  const range = ARC_TARGET_RANGE;
  const n = query(w, p.x, p.y, range + w.grid.maxRadius);
  let best = -1;
  let bestD = Infinity;
  for (let k = 0; k < n; k++) {
    const i = QUERY[k];
    if (!isHittable(w, i)) continue;
    const dx = m.x[i] - p.x;
    const dy = m.y[i] - p.y;
    const r = range + m.radius[i];
    if (dx * dx + dy * dy > r * r) continue;
    if (coverBlocked(w, p.x, p.y, m.x[i], m.y[i], 0)) continue;
    const cx = m.x[i] - aimX;
    const cy = m.y[i] - aimY;
    const dc = cx * cx + cy * cy;
    if (dc < bestD) {
      bestD = dc;
      best = i;
    }
  }
  const l: Link = { def, owner: p.id, dtype: DAMAGE_INDEX[def.damageType] };
  const points: number[] = [p.x + dirX * MUZZLE_OFFSET, p.y + dirY * MUZZLE_OFFSET];
  if (best < 0) {
    const reach = Math.min(range * 0.6, Math.hypot(aimX - p.x, aimY - p.y));
    const fork = coverClip(w, p.x, p.y, Math.atan2(dirY, dirX), Math.max(24, reach), 0);
    points.push(p.x + dirX * fork, p.y + dirY * fork);
    w.events.push({ t: 'chain', playerId: p.id, points, damageType: def.damageType });
    return;
  }
  const ramp = prim(def, 'ramp');
  const hitIds: number[] = [];
  let cur = best;
  let fromX = p.x;
  let fromY = p.y;
  let firstId = -1;
  let firstX = 0;
  let firstY = 0;
  let lastX = 0;
  let lastY = 0;
  let lastSlot = -1;
  const total = 1 + Math.max(0, Math.floor(def.chains));
  for (let c = 0; c < total && cur >= 0; c++) {
    const x = m.x[cur];
    const y = m.y[cur];
    hitIds.push(m.id[cur]);
    if (c === 0) {
      firstId = m.id[cur];
      firstX = x;
      firstY = y;
    }
    points.push(x, y);
    const scale = ramp ? Math.max(0, 1 + ramp.start + ramp.step * c) : 1;
    const killed = strike(w, l, cur, scale, fromX, fromY, c === 0);
    fromX = x;
    fromY = y;
    lastX = x;
    lastY = y;
    lastSlot = killed ? -1 : cur;
    if (c + 1 >= total) break;
    cur = revisit ? nextLink(w, x, y, jump, [], cur) : nextLink(w, x, y, jump, hitIds);
  }
  w.events.push({ t: 'chain', playerId: p.id, points, damageType: def.damageType });

  // Forking Arc: from the last link, branches of `links` jumps each, at `share`.
  const fork = prim(def, 'fork');
  if (fork) {
    for (let b = 0; b < fork.branches; b++) {
      const pts: number[] = [lastX, lastY];
      let bx = lastX;
      let by = lastY;
      for (let k = 0; k < fork.links; k++) {
        const next = nextLink(w, bx, by, fork.jump > 0 ? fork.jump : jump, hitIds);
        if (next < 0) break;
        hitIds.push(m.id[next]);
        const nx = m.x[next];
        const ny = m.y[next];
        pts.push(nx, ny);
        strike(w, l, next, fork.share, bx, by, false);
        bx = nx;
        by = ny;
      }
      if (pts.length > 2) w.events.push({ t: 'chain', playerId: p.id, points: pts, damageType: def.damageType });
    }
  }

  // Storm Return: the final link comes back to the first target (if it still stands and is not the last link itself).
  const ret = prim(def, 'return');
  if (ret && firstId >= 0) {
    const slot = m.slotOf(firstId);
    if (slot >= 0 && slot !== lastSlot && isHittable(w, slot) && hitIds.length > 1) {
      w.events.push({ t: 'chain', playerId: p.id, points: [lastX, lastY, m.x[slot], m.y[slot]], damageType: def.damageType });
      strike(w, l, slot, ret.share, lastX, lastY, false);
    } else if (slot >= 0 && hitIds.length === 1 && isHittable(w, slot)) {
      // A lone target: the bolt still returns to it once.
      strike(w, l, slot, ret.share, firstX, firstY, false);
    }
  }
}

/** Conduction: from a strike at (x, y), `fork.links` jumps to the nearest enemies the strike missed (`group`) at `share`. */
export function conductFrom(w: World, p: PlayerState, def: SkillRuntimeDef, x: number, y: number, struck: readonly number[], fork: { links: number; share: number; jump: number }): void {
  // A converted skill whose ailment changed type (Static Frost) chains as the converted type: it shocks instead of chilling.
  const conv = prim(def, 'convert');
  const type = conv && conv.ailment === 'instead' ? conv.to : def.damageType;
  const l: Link = { def, owner: p.id, dtype: DAMAGE_INDEX[type] };
  const hit = [...struck];
  const pts: number[] = [x, y];
  let fx = x;
  let fy = y;
  for (let k = 0; k < fork.links; k++) {
    const next = nextLink(w, fx, fy, fork.jump, hit);
    if (next < 0) break;
    const m = w.monsters;
    hit.push(m.id[next]);
    pts.push(m.x[next], m.y[next]);
    const nx = m.x[next];
    const ny = m.y[next];
    strike(w, l, next, fork.share, fx, fy, false);
    fx = nx;
    fy = ny;
  }
  if (pts.length > 2) w.events.push({ t: 'chain', playerId: p.id, points: pts, damageType: type });
}
