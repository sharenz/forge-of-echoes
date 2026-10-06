// Rules of the power rework's roster batch 3 (SK4; docs/power-rework/skills.md 3 and 6): Meteor Rain, Storm Step, Tempest Surge,
// Blizzard and Event Horizon. Counts their hits for the estimates and writes their tooltip lines. Their behaviour needs no primitive
// of its own: Blizzard is a `zone` (skills-roster2.ts resolves it), the augments are flags, `trail`, `fork` and stat effects, and the
// behaviour numbers are SKILL_TIMING constants the sim reads too, so the text is what the sim does.
import type { AugmentRuntime, SkillRuntimeDef } from '../../contracts/sim';
import { SKILL_TIMING } from '../../data/progression';
import type { SkillDef } from '../../data/progression';
import type { ResolvedSkill } from './skills';
import { STRIKE_BODY, damageRange } from './skills';
import { zoneTicks } from './skills-roster2';
import { percent, seconds } from './util';

function prim<P extends AugmentRuntime['p']>(rt: SkillRuntimeDef, p: P): Extract<AugmentRuntime, { p: P }> | undefined {
  return rt.augments?.find((a): a is Extract<AugmentRuntime, { p: P }> => a.p === p);
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/** Tempest Surge's pulses over its duration (the last one on the tick it runs out). */
export function surgePulses(rt: SkillRuntimeDef): number {
  return Math.max(0, Math.floor(rt.duration / SKILL_TIMING.surgePulse + 1e-9));
}

/** Tempest Surge's cast speed (a fraction): the base, plus Overcharged Tempo's. */
export function surgeCastSpeed(rt: SkillRuntimeDef): number {
  return SKILL_TIMING.surgeCastSpeed + (rt.flags.includes('overchargedTempo') ? SKILL_TIMING.tempoCastSpeed : 0);
}

/** Blizzard's bonus cold damage on chilled enemies in the storm (Brittle Cold adds to it). */
export function blizzardBrittle(rt: SkillRuntimeDef): number {
  return SKILL_TIMING.blizzardBrittle + (rt.flags.includes('brittleCold') ? SKILL_TIMING.brittleCold : 0);
}

/** Event Horizon's pull speed (Heavy Collapse pulls harder). */
export function horizonPull(rt: SkillRuntimeDef): number {
  return SKILL_TIMING.horizonPull * (rt.flags.includes('heavyCollapse') ? SKILL_TIMING.heavyCollapsePull : 1);
}

/**
 * Hits of one cast (`once`) and on one enemy (`single`), or null for skills outside this batch. Meteor Rain scatters its meteors
 * uniformly over its circle like Storm Call, so an enemy at the cursor expects `meteors × ((radius + body) / circle)²` of them; Storm
 * Step strikes an enemy once per blink; every surge pulse and storm tick lands on an enemy standing in it; Echo Collapse adds half a
 * detonation.
 */
export function roster3HitCounts(def: SkillDef, rt: SkillRuntimeDef): { once: number; single: number } | null {
  switch (def.id) {
    case 'meteorRain': {
      const n = Math.max(1, Math.floor(rt.projectiles));
      const share = rt.range > 0 ? Math.min(1, ((rt.radius + STRIKE_BODY) / rt.range) ** 2) : 1;
      return { once: n, single: n * share };
    }
    case 'stormStep': {
      const fork = prim(rt, 'fork');
      return { once: (rt.flags.includes('thirdStrike') ? 3 : 2) + (fork ? fork.branches * fork.links : 0), single: 1 };
    }
    case 'tempestSurge':
      return { once: surgePulses(rt), single: surgePulses(rt) };
    case 'blizzard':
      return { once: zoneTicks(rt), single: zoneTicks(rt) };
    case 'eventHorizon':
      return { once: 1, single: 1 + (rt.flags.includes('echoCollapse') ? SKILL_TIMING.echoCollapseShare : 0) };
    default:
      return null;
  }
}

/** Tooltip lines of the batch's skills (null for other skills). */
export function roster3Lines(r: ResolvedSkill): string[] | null {
  const { def, runtime: rt } = r;
  const dmg = (v: number, type: string) => `${damageRange(v)} ${type} damage`;
  switch (def.id) {
    case 'meteorRain': {
      const n = Math.max(1, Math.floor(rt.projectiles));
      const lines = [
        `${count(n, 'meteor')} fall one after another over ${seconds(rt.duration)} at random points within ${Math.round(rt.range)} units of the `
          + `cursor; each lands ${seconds(SKILL_TIMING.meteorTelegraph)} after its circle appears`,
        `Each meteor deals ${dmg(rt.damage, 'Fire')} in a radius of ${Math.round(rt.radius)}: ground damage, it ignores cover and shields`,
      ];
      const t = prim(rt, 'trail');
      if (t && t.at === 'strike') {
        lines.push(`Each meteor leaves burning ground for ${seconds(t.duration)}: ${dmg(t.damage, 'Fire')} every ${seconds(t.interval)}`);
      }
      return lines;
    }
    case 'stormStep': {
      const invuln = prim(rt, 'invulnerable');
      const lines = [
        `Blinks up to ${Math.round(rt.distance)} units toward the cursor; invulnerable for ${seconds(invuln ? invuln.seconds : 0.2)}`,
        `Lightning strikes where you leave${rt.flags.includes('thirdStrike') ? ', halfway along' : ''} and where you land: `
          + `${dmg(rt.damage, 'Lightning')} in a radius of ${Math.round(rt.radius)}; an enemy is struck once per blink`,
      ];
      const fork = prim(rt, 'fork');
      if (fork) {
        lines.push(`Lightning forks from the landing to ${fork.branches} more enemies within ${Math.round(fork.jump)} units for ${percent(fork.share)} damage`);
      }
      const t = prim(rt, 'trail');
      if (t && t.at === 'origin') {
        lines.push(`Leaves a shocking cloud (radius ${Math.round(t.radius > 0 ? t.radius : rt.radius)}) where you left for ${seconds(t.duration)}: `
          + `${dmg(t.damage, 'Lightning')} every ${seconds(t.interval)}`);
      }
      return lines;
    }
    case 'tempestSurge': {
      const lines = [
        `For ${seconds(rt.duration)}: ${percent(surgeCastSpeed(rt))} more cast speed`,
        `Every ${seconds(SKILL_TIMING.surgePulse)} every enemy within ${Math.round(rt.radius)} units of you takes ${dmg(rt.damage, 'Lightning')} `
          + `(${count(surgePulses(rt), 'pulse')})`,
      ];
      if (rt.flags.includes('lightningSkin')) {
        lines.push(`+${percent(SKILL_TIMING.skinResist)} lightning resistance while it lasts; your hits deal ${percent(SKILL_TIMING.skinShockedTaken)} `
          + 'more damage to shocked enemies');
      }
      return lines;
    }
    case 'blizzard': {
      const z = prim(rt, 'zone');
      const lines = [
        `A storm at the cursor (radius ${Math.round(rt.radius)}) for ${seconds(rt.duration)}: every ${seconds(z ? z.interval : 0.5)} it deals `
          + `${dmg(rt.damage, 'Cold')} to enemies inside`,
        `Chilled enemies in the storm take ${percent(blizzardBrittle(rt))} more Cold damage from every source`,
      ];
      if (z && z.slow > 0) lines.push(`Enemies in the storm are slowed by ${percent(z.slow)}`);
      return lines;
    }
    case 'eventHorizon': {
      const lines = [
        `For ${seconds(rt.duration)} a point at the cursor pulls every enemy within ${Math.round(rt.range)} units toward it at `
          + `${Math.round(horizonPull(rt))} units per second (bosses and heavy enemies half)`,
        `Then it detonates for ${dmg(rt.damage, 'Void')} in a radius of ${Math.round(rt.radius)}`,
      ];
      if (rt.flags.includes('echoCollapse')) {
        lines.push(`${seconds(SKILL_TIMING.echoCollapseDelay)} later it detonates again for ${dmg(rt.damage * SKILL_TIMING.echoCollapseShare, 'Void')}`);
      }
      if (rt.flags.includes('voidFeast')) lines.push(`Each enemy that dies while it pulls refunds ${SKILL_TIMING.voidFeastFocus} Focus`);
      return lines;
    }
    default:
      return null;
  }
}
