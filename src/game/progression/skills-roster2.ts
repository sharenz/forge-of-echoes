// Rules of the power rework's roster batch 2 (SK3; docs/power-rework/skills.md 3, 5.13, 6): Gravity Well, Rime Bulwark, Immolation
// Sigil, Static Aegis, Voltaic Pulse, Entropy Hex, Concussive Blast, Static Lash, Echo Sigil and Wither Field. Resolves their
// behaviour primitives (zone, barrier, aegis, echoSigil) from SkillDef.primitives and the picked augments' `tune` effects, counts
// their hits for the estimates, and writes their tooltip lines. Every number here is a runtime-def number or a SKILL_TIMING /
// DECAY / WITHER / EXPOSURE constant the sim reads too, so the text is what the sim does.
import type { AugmentRuntime, SkillRuntimeDef } from '../../contracts/sim';
import { DECAY, DOT_RESIST_FACTOR, EXPOSURE, SKILL_TIMING, WITHER } from '../../data/progression';
import type { AugmentEffect, SkillDef, TuneKey } from '../../data/progression';
import type { ResolvedSkill } from './skills';
import { damageRange } from './skills';
import { percent, rankValue, seconds } from './util';

function tuned(effects: readonly AugmentEffect[], key: TuneKey): number {
  return effects.reduce((s, e) => s + (e.k === 'tune' && e.key === key ? e.add : 0), 0);
}

/**
 * The batch's executor primitives. `power` is the skill's damage per point of effectiveness (spell power, added damage, increased and
 * more of its damage type), so effects with their own effectiveness (Singularity, Brittle Retort) scale like the hit.
 */
export function roster2Runtimes(def: SkillDef, effects: readonly AugmentEffect[], rank: number, power: number): AugmentRuntime[] {
  const prim = def.primitives ?? {};
  const out: AugmentRuntime[] = [];
  const z = prim.zone;
  if (z) {
    const exposure = z.exposure ? z.exposure + tuned(effects, 'hexExposure') : 0;
    const withered = z.withered ?? 0;
    const collapse = (z.collapse ?? 0) + tuned(effects, 'zoneCollapse');
    out.push({
      p: 'zone',
      interval: z.interval,
      pull: Math.max(0, (z.pull ?? 0) * (1 + tuned(effects, 'zonePullPct') / 100)),
      slow: Math.min(0.9, Math.max(0, (z.slow ?? 0) + tuned(effects, 'zoneSlow'))),
      taken: Math.max(0, (z.taken ?? 0) + tuned(effects, 'zoneTaken')),
      exposure: Math.min(EXPOSURE.max, exposure),
      weaken: Math.min(0.9, Math.max(0, (z.weaken ?? 0) + tuned(effects, 'hexWeaken'))),
      withered,
      linger: withered > 0 ? (z.linger ?? WITHER.linger) + tuned(effects, 'witherLinger') : 0,
      decay: !!z.decay,
      collapse: collapse > 0 ? power * collapse : 0,
      collapseRadius: collapse > 0 ? (z.collapseRadius ?? 90) : 0,
    });
  }
  if (prim.barrier) {
    const retort = tuned(effects, 'barrierRetort');
    out.push({
      p: 'barrier',
      share: rankValue(prim.barrier.share, rank, def.maxRank) * (1 + tuned(effects, 'barrierPct') / 100),
      chillRadius: prim.barrier.chillRadius,
      regen: tuned(effects, 'barrierRegen'),
      retort: retort > 0 ? power * retort : 0,
      retortRadius: prim.barrier.retortRadius,
    });
  }
  if (prim.aegis) out.push({ p: 'aegis', gap: prim.aegis.gap, resist: tuned(effects, 'aegisResist'), pulse: tuned(effects, 'aegisPulse') });
  if (prim.echoSigil) {
    const e = prim.echoSigil;
    out.push({
      p: 'echoSigil',
      casts: Math.max(1, Math.floor(e.casts + tuned(effects, 'echoCasts'))),
      delay: Math.max(0.05, e.delay + tuned(effects, 'echoDelay')),
      damage: Math.max(0, e.damage + tuned(effects, 'echoDamage')),
      refund: Math.max(0, tuned(effects, 'echoRefund')),
    });
  }
  return out;
}

function prim<P extends AugmentRuntime['p']>(rt: SkillRuntimeDef, p: P): Extract<AugmentRuntime, { p: P }> | undefined {
  return rt.augments?.find((a): a is Extract<AugmentRuntime, { p: P }> => a.p === p);
}

/** Ticks a zone deals over its duration (the first one interval after it lands). */
export function zoneTicks(rt: SkillRuntimeDef): number {
  const z = prim(rt, 'zone');
  if (!z || !(z.interval > 0)) return 0;
  return Math.max(0, Math.floor(rt.duration / z.interval + 1e-9));
}

/** Hits of one cast (`once`) and on one enemy (`single`), or null for skills outside this batch. */
export function roster2HitCounts(def: SkillDef, rt: SkillRuntimeDef): { once: number; single: number } | null {
  switch (def.id) {
    case 'gravityWell':
      return { once: zoneTicks(rt), single: zoneTicks(rt) };
    case 'witherField':
      // Its ticks are Decay stacks: counted as damage over time (roster2Dot), not as hits.
      return { once: 0, single: 0 };
    case 'immolationSigil': {
      const n = Math.max(1, Math.floor(rt.projectiles));
      // Twin sigils stand 80 apart with radius 50 or more: an enemy at the cursor is inside both pillars.
      return { once: n, single: n };
    }
    case 'staticAegis': {
      const a = prim(rt, 'aegis');
      const pulses = a && a.pulse > 0 ? Math.floor(rt.duration / a.pulse + 1e-9) : 0;
      return { once: pulses, single: pulses };
    }
    case 'staticLash':
      return { once: 1 + (rt.flags.includes('arcLash') ? 1 : 0) + Math.max(0, Math.floor(rt.chains)), single: 1 };
    default:
      return null;
  }
}

/**
 * Damage over time one cast leaves on an enemy standing in it (Wither Field: a Decay stack per tick, stacks running together up to
 * DECAY.maxStacks, each refreshing the timer), against no resistance but the field's own Withered. Null when the skill leaves none.
 */
export function roster2Dot(def: SkillDef, rt: SkillRuntimeDef, interval: number): { perCast: number; dps: number } | null {
  const z = prim(rt, 'zone');
  if (!z || !z.decay || !(rt.damage > 0)) return null;
  const ticks = zoneTicks(rt);
  // Each tick first adds its Withered stack, then a Decay stack that sees the lowered void resistance (DOT_RESIST_FACTOR of it);
  // the monster takes the strongest stack's rate times the stacks.
  let stacks = 0;
  let rate = 0;
  let left = 0;
  let total = 0;
  let t = 0;
  for (let k = 1; k <= ticks; k++) {
    const at = k * z.interval;
    const span = Math.max(0, Math.min(at - t, left));
    total += stacks * rate * span;
    left -= at - t;
    if (left <= 0) {
      stacks = 0;
      rate = 0;
      left = 0;
    }
    t = at;
    const withered = Math.min(WITHER.maxStacks, k * z.withered);
    const res = -(withered * WITHER.points) / 100;
    rate = Math.max(rate, (rt.damage * (1 - DOT_RESIST_FACTOR * res)) / DECAY.duration);
    stacks = Math.min(DECAY.maxStacks, stacks + 1);
    left = DECAY.duration;
  }
  total += stacks * rate * left;
  return { perCast: total, dps: interval > 0 ? total / interval : 0 };
}

const SHOCK_TEXT = 'is shocked';

/** Tooltip lines of the batch's skills (null for other skills). */
export function roster2Lines(r: ResolvedSkill): string[] | null {
  const { def, runtime: rt } = r;
  const dmg = (v: number, type: string) => `${damageRange(v)} ${type} damage`;
  switch (def.id) {
    case 'gravityWell': {
      const z = prim(rt, 'zone')!;
      const lines = [
        `A vortex at the cursor (radius ${Math.round(rt.radius)}) for ${seconds(rt.duration)}: pulls enemies toward its centre at `
          + `${Math.round(z.pull)} units per second (bosses and heavy enemies half) and slows them by ${percent(z.slow)}`,
        `Every ${seconds(z.interval)} it deals ${dmg(rt.damage, 'Void')} to enemies inside`,
      ];
      if (z.taken > 0) lines.push(`Enemies inside take ${percent(z.taken)} more damage`);
      if (z.collapse > 0) lines.push(`When it ends it collapses for ${dmg(z.collapse, 'Void')} in a radius of ${Math.round(z.collapseRadius)}`);
      return lines;
    }
    case 'entropyHex': {
      const z = prim(rt, 'zone')!;
      return [
        `Curses a circle at the cursor (radius ${Math.round(rt.radius)}) for ${seconds(rt.duration)}`,
        `Enemies inside are exposed to Fire, Cold, Lightning and Void by ${Math.round(z.exposure)} points (bosses half) for ${seconds(EXPOSURE.duration)}`,
        `Enemies inside deal ${percent(z.weaken)} less damage${z.slow > 0 ? ` and move ${percent(z.slow)} slower` : ''}`,
      ];
    }
    case 'witherField': {
      const z = prim(rt, 'zone')!;
      return [
        `A rotting field at the cursor (radius ${Math.round(rt.radius)}) for ${seconds(rt.duration)}`,
        `Every ${seconds(z.interval)} enemies inside gain a Decay stack of ${dmg(rt.damage, 'Void')} over ${seconds(DECAY.duration)} `
          + `(up to ${DECAY.maxStacks} at once)`,
        `…and a Withered stack: −${WITHER.points} points to every resistance, up to ${WITHER.maxStacks} (−${WITHER.points * WITHER.maxStacks}); `
          + `it lasts ${seconds(z.linger)} after an enemy leaves`,
      ];
    }
    case 'rimeBulwark': {
      const b = prim(rt, 'barrier')!;
      const lines = [
        `A barrier absorbs ${percent(b.share)} of your maximum life in damage for ${seconds(rt.duration)}`,
        `Enemies within ${Math.round(b.chillRadius)} units that hit you are chilled`,
      ];
      if (b.regen > 0) lines.push(`Regenerates ${percent(b.regen)} of its size per second while you stand still`);
      if (b.retort > 0) lines.push(`When it breaks a nova deals ${dmg(b.retort, 'Cold')} within ${Math.round(b.retortRadius)} units and chills`);
      return lines;
    }
    case 'immolationSigil': {
      const n = Math.max(1, Math.floor(rt.projectiles));
      const g = prim(rt, 'ground');
      const lines = [
        `${n > 1 ? `Brands ${n} sigils ${SKILL_TIMING.sigilTwinOffset * 2} units apart at the cursor` : 'Brands the ground at the cursor'}; `
          + `after ${seconds(SKILL_TIMING.sigilTelegraph)} a pillar of fire erupts: ${dmg(rt.damage, 'Fire')} in a radius of ${Math.round(rt.radius)}`,
      ];
      if (g && g.duration > 0) lines.push(`The pillar burns on for ${seconds(g.duration)}: ${dmg(g.damage, 'Fire')} every ${seconds(g.interval)}`);
      if (rt.flags.includes('brand')) lines.push(`The pillar exposes Fire by ${SKILL_TIMING.brandExposure} points for ${seconds(EXPOSURE.duration)}`);
      return lines;
    }
    case 'staticAegis': {
      const a = prim(rt, 'aegis')!;
      const lines = [
        `For ${seconds(rt.duration)}: you take ${percent(rt.damageReduction)} less damage`,
        `When an enemy hits you, every enemy within ${Math.round(rt.radius)} units takes ${dmg(rt.damage, 'Lightning')} and ${SHOCK_TEXT} `
          + `(at most every ${seconds(a.gap)})`,
      ];
      if (a.resist > 0) lines.push(`+${percent(a.resist)} lightning resistance while it lasts`);
      if (a.pulse > 0) lines.push(`Enemies within ${Math.round(rt.radius)} units also take it every ${seconds(a.pulse)}`);
      return lines;
    }
    case 'voltaicPulse':
      return [
        `A ring of lightning expands from you to ${Math.round(rt.radius)} units (${SKILL_TIMING.pulseSpeed} units per second), `
          + `striking each enemy once for ${dmg(rt.damage, 'Lightning')}`,
        'Not a projectile: it passes cover and shields',
      ];
    case 'concussiveBlast':
      return [
        `Deals ${dmg(rt.damage, 'Physical')} in a ${Math.round((rt.spread * 180) / Math.PI)}° cone reaching ${Math.round(rt.range)} units`,
        `Knocks enemies back ${SKILL_TIMING.coneKnockback}× as far`,
      ];
    case 'staticLash': {
      const lines = [`Lashes the nearest enemy in sight within ${Math.round(rt.range)} units for ${dmg(rt.damage, 'Lightning')}`];
      if (rt.flags.includes('arcLash')) lines.push(`Also lashes the second-nearest for ${percent(SKILL_TIMING.lashSecondShare)}`);
      const chains = Math.max(0, Math.floor(rt.chains));
      if (chains > 0) {
        lines.push(`Then jumps to ${chains} more ${chains === 1 ? 'enemy' : 'enemies'} within ${SKILL_TIMING.lashJump} units for ${percent(SKILL_TIMING.lashChainShare)} each`);
      }
      return lines;
    }
    case 'echoSigil': {
      const e = prim(rt, 'echoSigil')!;
      const lines = [
        `Your next ${e.casts} damaging skill casts within ${seconds(rt.duration)} echo once after ${seconds(e.delay)} at `
          + `${percent(e.damage)} damage, at no Focus (not Ember Lance)`,
      ];
      if (e.refund > 0) lines.push(`Each echoed skill refunds ${percent(e.refund)} of its Focus cost`);
      return lines;
    }
    default:
      return null;
  }
}
