// The skill executor (GAME_SPEC §4, docs/power-rework/skills.md 4.2). The numbers come pre-resolved in SkillRuntimeDef; the
// skill's behaviour data (./behaviours) names its emitter, and the runtime def's augment primitives (echo, fan, invulnerable)
// modify it. It replaces the per-skill switch: a new skill is a behaviour entry, not new code, unless it needs a new primitive.
import type { SkillRuntimeDef } from '../../contracts/sim';
import { NOVA_ECHO_DELAY } from '../constants';
import type { PlayerState, World } from '../world';
import { SKILL_BEHAVIOURS } from './behaviours';
import { emitRestore, emitStride, emitWard } from './buffs';
import { burstFanArc, emitBurst, emitChain, emitDash, emitProjectiles } from './emitters';
import { emitBlast, emitLob, emitOrb, emitSpikes, emitStrikes } from './roster';
import { aimAngle, augmentOf, hasFlag } from './projectile-mods';
import type { SkillBehaviour } from './types';

/** Release a skill: the effect happens now, from the player's current position. */
export function releaseSkill(w: World, p: PlayerState, def: SkillRuntimeDef, aimX: number, aimY: number): void {
  const b = SKILL_BEHAVIOURS[def.id];
  if (!b) return;
  const angle = aimAngle(p, aimX, aimY);
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
  // A blink announces itself with its own 'dash' event.
  if (b.emitter !== 'dash') w.events.push({ t: 'cast', playerId: p.id, skill: def.id, x: p.x, y: p.y, dirX, dirY });
  switch (b.emitter) {
    case 'projectile':
      emitProjectiles(w, p, def, b, angle);
      break;
    case 'burst':
      emitBurst(w, p, def, b, angle);
      break;
    case 'chain':
      emitChain(w, p, def, b, aimX, aimY, dirX, dirY);
      break;
    case 'dash':
      emitDash(w, p, def, b, aimX, aimY, dirX, dirY);
      break;
    case 'buff':
      if (b.buff === 'ward') emitWard(w, p, def, b);
      else if (b.buff === 'stride') emitStride(w, p, def, b);
      else emitRestore(w, p, def, b);
      break;
    case 'blast':
      emitBlast(w, p, def, b);
      break;
    case 'lob':
      emitLob(w, p, def, b, aimX, aimY, angle);
      break;
    case 'orb':
      emitOrb(w, p, def, b, angle);
      break;
    case 'strikes':
      emitStrikes(w, p, def, b, aimX, aimY);
      break;
    case 'spikes':
      emitSpikes(w, p, def, b, angle);
      break;
  }
  queueEcho(w, p, def, b);
}

/**
 * The `echo` primitive: the cast repeats once, later, at no Focus. An item-granted echo (a unique flag) repeats at full damage;
 * a picked augment's at its share; when both apply the better value counts (no stacking). Echoes never queue echoes.
 */
function queueEcho(w: World, p: PlayerState, def: SkillRuntimeDef, b: SkillBehaviour): void {
  if (b.emitter !== 'projectile' && b.emitter !== 'burst') return;
  const aug = augmentOf(def, 'echo');
  const granted = hasFlag(p, def, b.echo);
  if (!aug && !granted) return;
  const share = Math.max(granted ? 1 : 0, aug ? aug.damage : 0);
  const at = w.time + (aug ? aug.delay : NOVA_ECHO_DELAY);
  p.pendingNovas.push({ at, def: share === 1 ? def : { ...def, damage: def.damage * share } });
}

/** Pending echoes (from wherever the player is when they fire, toward the current aim); echoes never queue echoes. */
export function tickPendingNovas(w: World, p: PlayerState): void {
  const list = p.pendingNovas;
  if (list.length === 0) return;
  let write = 0;
  for (let k = 0; k < list.length; k++) {
    const e = list[k];
    if (p.dead) continue;
    if (e.at <= w.time + 1e-9) {
      const angle = aimAngle(p, p.aimX, p.aimY), def = e.def;
      const b = SKILL_BEHAVIOURS[def.id];
      if (b?.emitter === 'projectile') emitProjectiles(w, p, def, b, angle);
      // A ring echo is turned half a step so its flames fill the gaps of the first ring; a fan repeats on the aim.
      else if (b?.emitter === 'burst') emitBurst(w, p, def, b, angle + (burstFanArc(p, def, b) !== null ? 0 : Math.PI / Math.max(1, def.projectiles)));
    } else list[write++] = e;
  }
  list.length = write;
}
