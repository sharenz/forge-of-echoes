// The skill executor (GAME_SPEC §4, docs/power-rework/skills.md 4.2). The numbers come pre-resolved in SkillRuntimeDef; the
// skill's behaviour data (./behaviours) names its emitter, and the runtime def's augment primitives (echo, fan, invulnerable)
// modify it. It replaces the per-skill switch: a new skill is a behaviour entry, not new code, unless it needs a new primitive.
import type { SkillRuntimeDef } from '../../contracts/sim';
import { NOVA_ECHO_DELAY } from '../constants';
import type { PlayerState, World } from '../world';
import { SKILL_BEHAVIOURS } from './behaviours';
import { emitRestore, emitStride, emitWard } from './buffs';
import { emitAegis, emitBarrier, emitEchoSigil } from './defence';
import { burstFanArc, emitBurst, emitChain, emitDash, emitProjectiles } from './emitters';
import { emitBlast, emitLob, emitOrb, emitSpikes, emitStrikes } from './roster';
import { emitCone, emitLash, emitPillar, emitPulse, emitZone } from './roster2';
import { emitHorizon, emitMeteors, emitSurge, stormStepStrikes } from './roster3';
import { aimAngle, augmentOf, hasFlag } from './projectile-mods';
import { tickAugments } from './primitives';
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
  if (b.emitter === 'buff') {
    switch (b.buff) {
      case 'ward': emitWard(w, p, def, b); break;
      case 'stride': emitStride(w, p, def, b); break;
      case 'restore': emitRestore(w, p, def, b); break;
      case 'barrier': emitBarrier(w, p, def, b); break;
      case 'aegis': emitAegis(w, p, def, b); break;
      case 'echoSigil': emitEchoSigil(w, p, def, b); break;
      case 'surge': emitSurge(w, p, def, b); break;
    }
  } else if (b.emitter === 'dash') {
    const fromX = p.x;
    const fromY = p.y;
    emitDash(w, p, def, b, aimX, aimY, dirX, dirY);
    // Storm Step (SK4): lightning where she left and where she landed.
    if (b.strikes) stormStepStrikes(w, p, def, b, fromX, fromY, p.x, p.y);
  } else emitAt(w, p, def, b, aimX, aimY, angle);
  queueEcho(w, p, def, b);
  spendEchoSigil(w, p, def, b);
}

/** Every emitter that fires at the world (not a buff or a blink): a cast, an echo of one. */
function emitAt(w: World, p: PlayerState, def: SkillRuntimeDef, b: SkillBehaviour, aimX: number, aimY: number, angle: number): void {
  const dirX = Math.cos(angle);
  const dirY = Math.sin(angle);
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
    case 'blast':
      emitBlast(w, p, def, b);
      break;
    case 'lob':
      emitLob(w, p, def, b, aimX, aimY, angle);
      break;
    case 'orb':
      emitOrb(w, p, def, b, angle, aimX, aimY);
      break;
    case 'strikes':
      emitStrikes(w, p, def, b, aimX, aimY);
      break;
    case 'spikes':
      emitSpikes(w, p, def, b, angle);
      break;
    case 'zone':
      emitZone(w, p, def, b, aimX, aimY);
      break;
    case 'pillar':
      emitPillar(w, p, def, b, aimX, aimY, angle);
      break;
    case 'pulse':
      emitPulse(w, p, def, b);
      break;
    case 'cone':
      emitCone(w, p, def, b, angle);
      break;
    case 'lash':
      emitLash(w, p, def, b, dirX, dirY);
      break;
    case 'meteors':
      emitMeteors(w, p, def, b, aimX, aimY);
      break;
    case 'horizon':
      emitHorizon(w, p, def, b, aimX, aimY);
      break;
    default:
      break;
  }
}

/**
 * Echo Sigil (power rework SK3): a damaging cast of another skill (not the basic attack, a buff or a blink) spends one charge and
 * repeats once after the sigil's delay at its share of the damage, at no Focus; Costless refunds a share of the cast's Focus now.
 */
function spendEchoSigil(w: World, p: PlayerState, def: SkillRuntimeDef, b: SkillBehaviour): void {
  const e = p.echoSigil;
  if (e.casts <= 0 || e.time <= 0 || def.id === 'echoSigil' || def.id === 'emberLance' || !(def.damage > 0)) return;
  if (b.emitter === 'buff' || b.emitter === 'dash') return;
  e.casts--;
  p.pendingNovas.push({ at: w.time + e.delay, def: { ...def, damage: def.damage * e.damage } });
  if (e.refund > 0 && def.focusCost > 0) p.focus = Math.min(p.stats.maxFocus, p.focus + def.focusCost * e.refund);
  // The last charge spent ends the sigil's aura.
  if (e.casts === 0) {
    e.time = 0;
    w.events.push({ t: 'buff', playerId: p.id, skill: 'echoSigil', x: p.x, y: p.y, duration: 0 });
  }
}

/**
 * The `echo` primitive: the cast repeats once, later, at no Focus. An item-granted echo (a unique flag) repeats at full damage;
 * a picked augment's at its share; when both apply the better value counts (no stacking). Echoes never queue echoes.
 */
function queueEcho(w: World, p: PlayerState, def: SkillRuntimeDef, b: SkillBehaviour): void {
  if (b.emitter !== 'projectile' && b.emitter !== 'burst' && b.emitter !== 'pulse') return;
  const aug = augmentOf(def, 'echo');
  const granted = hasFlag(p, def, 'echo' in b ? b.echo : undefined);
  if (!aug && !granted) return;
  const share = Math.max(granted ? 1 : 0, aug ? aug.damage : 0);
  const at = w.time + (aug ? aug.delay : NOVA_ECHO_DELAY);
  p.pendingNovas.push({ at, def: share === 1 ? def : { ...def, damage: def.damage * share } });
}

/** Pending echoes (from wherever the player is when they fire, toward the current aim); echoes never queue echoes. */
export function tickPendingNovas(w: World, p: PlayerState): void {
  // Flagship augment upkeep (SK5): scheduled bursts, lodges, pruning (nothing without augment state).
  tickAugments(w, p);
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
      // Echo Sigil and Twice Struck repeat any other emitter toward the current aim.
      else if (b && b.emitter !== 'buff' && b.emitter !== 'dash') emitAt(w, p, def, b, p.aimX, p.aimY, angle);
    } else list[write++] = e;
  }
  list.length = write;
}
