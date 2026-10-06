// SK5 flagship augments on the rules side (docs/power-rework/skills.md 5): every augment SK5 turned on can be picked through the
// real rules, resolves into the primitive the sim executes with the numbers its text quotes, and no combination of augments breaks
// the global `more` cap.
import { describe, expect, it } from 'vitest';
import type { SkillId } from '../../src/contracts/content';
import { SKILL_IDS } from '../../src/contracts/content';
import type { AugmentRuntime } from '../../src/contracts/sim';
import { MORE_CAP, SKILLS, augmentAvailable } from '../../src/data/progression';
import type { AugmentDef } from '../../src/data/progression';
import { rules } from '../../src/game';
import { buildPlayerModel } from '../../src/game/progression/model';
import { resolveSkill } from '../../src/game/progression/skills';
import { bareCharacter } from './fixtures';

const model = buildPlayerModel(bareCharacter({ level: 40 }));

function primOf<P extends AugmentRuntime['p']>(skill: SkillId, aug: string, p: P): Extract<AugmentRuntime, { p: P }> {
  const r = resolveSkill(model, skill, 10, [aug]).runtime;
  const a = r.augments?.find((x) => x.p === p);
  if (!a) throw new Error(`${skill}.${aug} has no ${p}`);
  return a as Extract<AugmentRuntime, { p: P }>;
}

function textOf(skill: SkillId, aug: string): string {
  const a = SKILLS[skill].augmentDefs.find((x) => x.id === aug);
  if (!a) throw new Error(`${skill}.${aug}`);
  return a.text;
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

describe('SK5 augments through the rules', () => {
  it('every live augment of a playable skill can be picked at its tier rank with points to spare (canPickAugment)', () => {
    for (const id of SKILL_IDS.filter((s) => SKILLS[s].available)) {
      for (const a of SKILLS[id].augmentDefs) {
        const ch = bareCharacter({ level: 60, skillRanks: { emberLance: 1, [id]: 10 }, unspentSkillPoints: 20 });
        const check = rules.canPickAugment(ch, id, a.id);
        expect(check.ok, `${id}.${a.id}: ${check.reason ?? ''}`).toBe(augmentAvailable(a));
        if (check.ok) {
          const sheet = rules.skillSheet({ ...ch, augments: { [id]: [a.id] } }, id, 10);
          expect(sheet.augmentLines).toContain(`${a.name}: ${a.text}`);
        }
      }
    }
  });

  it('the primitives carry exactly the numbers the augment texts quote', () => {
    const lodge = primOf('emberLance', 'lodgeEmber', 'lodge');
    const t = textOf('emberLance', 'lodgeEmber');
    expect(t).toContain(`${lodge.fuse} seconds`);
    expect(t).toContain(pct(lodge.share));
    expect(t).toContain(`radius of ${lodge.radius}`);
    expect(t).toContain(`at most ${lodge.max} lodged`);

    const ice = primOf('rimeShards', 'lodgedIce', 'lodge');
    expect(textOf('rimeShards', 'lodgedIce')).toContain(`${ice.burst} lodged shards (or ${ice.fuse} second) detonate for ${pct(ice.share)}`);
    const soul = primOf('umbralBolt', 'soulbindLodge', 'lodge');
    expect(textOf('umbralBolt', 'soulbindLodge')).toContain(`${soul.fuse} seconds`);
    expect(textOf('umbralBolt', 'soulbindLodge')).toContain(`${pct(soul.share)} in a radius of ${soul.radius}`);

    const frag = primOf('emberLance', 'cinderFragments', 'split');
    expect(textOf('emberLance', 'cinderFragments')).toBe(`Kills release ${frag.count} fragments dealing ${pct(frag.share)} damage that seek the nearest enemy within ${frag.seek}`);
    const splint = primOf('rimeShards', 'splintering', 'split');
    expect(textOf('rimeShards', 'splintering')).toContain(`${splint.count} splinters dealing ${pct(splint.share)} damage (range ${splint.range})`);
    const ent = primOf('umbralBolt', 'entropicSplit', 'split');
    expect(textOf('umbralBolt', 'entropicSplit')).toContain(`${ent.count} bolts at ±${Math.round((ent.arc / 2) * 180 / Math.PI)}°, each dealing ${pct(ent.share)}`);
    const cluster = primOf('cinderMortar', 'clusterShell', 'split');
    expect(textOf('cinderMortar', 'clusterShell')).toBe(`Splits into ${cluster.count} bomblets landing within ${cluster.range} units, each dealing ${pct(cluster.share)} damage in ${pct(cluster.seek)} of the radius`);

    const fork = primOf('arcChain', 'forkingArc', 'fork');
    expect(textOf('arcChain', 'forkingArc')).toContain(`${fork.branches} branches of ${fork.links} links at ${pct(fork.share)}`);
    const cond = primOf('stormCall', 'conduction', 'fork');
    expect(textOf('stormCall', 'conduction')).toContain(`${cond.links} enemy within ${cond.jump} units at ${pct(cond.share)}`);
    expect(pct(primOf('arcChain', 'stormReturn', 'return').share)).toBe('80%');
    expect(pct(primOf('flameWave', 'tideReturns', 'return').share)).toBe('60%');
    const ramp = primOf('arcChain', 'overcharge', 'ramp');
    expect(textOf('arcChain', 'overcharge')).toBe(`Each jump deals ${pct(ramp.step)} more than the last, starting ${pct(-ramp.start)} lower`);
    const mark = primOf('arcChain', 'conductiveMark', 'mark');
    expect(textOf('arcChain', 'conductiveMark')).toBe(`The first target is marked for ${mark.seconds} seconds: it takes ${pct(mark.taken)} more damage and +${pct(mark.shock)} shock chance`);
    const pin = primOf('kineticLance', 'pinning', 'mark');
    expect(textOf('kineticLance', 'pinning')).toContain(`${pin.seconds} seconds`);
    expect(textOf('kineticLance', 'pinning')).toContain(`${pct(pin.taken)} more damage`);

    const sr = primOf('kineticLance', 'shatterRounds', 'onKill');
    expect(textOf('kineticLance', 'shatterRounds')).toContain(`${pct(sr.share)} of the dead enemy’s maximum life as physical damage in a radius of ${sr.radius} (at most ${sr.depth} deep)`);
    const sd = primOf('arcChain', 'staticDischarge', 'onKill');
    expect(textOf('arcChain', 'staticDischarge')).toContain(`${pct(sd.share)} of the hit as lightning in a radius of ${sd.radius} (at most ${sd.depth} deep)`);
    const gs = primOf('glacialNova', 'shatter', 'onKill');
    expect(textOf('glacialNova', 'shatter')).toContain(`${pct(gs.share)} of their life as cold in a radius of ${gs.radius}`);
    const cs = primOf('concussiveBlast', 'shatter', 'onKill');
    expect(textOf('concussiveBlast', 'shatter')).toContain(`${pct(cs.share)} of the dead enemy’s maximum life as physical damage in a radius of ${cs.radius}`);

    const core = primOf('glacialNova', 'freezingCore', 'core');
    expect(textOf('glacialNova', 'freezingCore')).toBe(`Enemies within ${core.radius} units of you take ${pct(core.more)} more damage from it`);
    const rings = primOf('emberNova', 'tripleRing', 'rings');
    expect(textOf('emberNova', 'tripleRing')).toContain(`of ${rings.flames} flames, ${rings.gap} seconds apart`);
    const fuse = primOf('cinderMortar', 'delayedFuse', 'fuse');
    expect(textOf('cinderMortar', 'delayedFuse')).toBe(`The shell lies for ${fuse.delay} seconds, then explodes for ${pct(fuse.more)} more damage in a ${fuse.radiusPct}% larger radius`);
    const skip = primOf('cinderMortar', 'skipShot', 'skip');
    expect(textOf('cinderMortar', 'skipShot')).toBe(`Bounces twice more toward the cursor, ${skip.gap} units apart, each blast dealing ${pct(skip.share)} damage`);
    expect(skip.count).toBe(2);
    const rain = primOf('cinderMortar', 'rainOfShells', 'scatter');
    expect(textOf('cinderMortar', 'rainOfShells')).toContain(`${rain.count} shells land at random points within ${rain.radius} units`);
    const heart = primOf('emberNova', 'heartfire', 'refund');
    expect(textOf('emberNova', 'heartfire')).toContain(`${heart.hits} or more enemies refunds ${pct(heart.focus)} of the Focus and ${heart.cooldown} second of cooldown`);
    const cheap = primOf('arcaneReprieve', 'chargedReprieve', 'cheapCasts');
    expect(textOf('arcaneReprieve', 'chargedReprieve')).toBe(`Your next ${cheap.casts} skill casts cost ${pct(cheap.pct)} less Focus`);
    expect(primOf('flameWave', 'overheat', 'ignite').more).toBe(0.5);
    const tide = primOf('flameWave', 'slowTide', 'rehit');
    expect(textOf('flameWave', 'slowTide')).toContain(`every ${tide.interval} seconds, up to ${tide.max} times`);
    expect(textOf('umbralBolt', 'hollowShell')).toContain(`${pct(1 - primOf('umbralBolt', 'hollowShell', 'falloff').share)} less`);
    expect(primOf('riftStep', 'riftEcho', 'freeCast')).toEqual({ p: 'freeCast', nth: 3, window: 4 });
    expect(textOf('riftStep', 'riftEcho')).toContain('a third blink within 4 seconds costs no Focus');
    const weave = primOf('riftStep', 'phaseWeave', 'weave');
    expect(textOf('riftStep', 'phaseWeave')).toContain(`${pct(weave.speed)} more movement speed for ${weave.seconds} seconds`);
    expect(primOf('cinderWard', 'hardenedEmber', 'wardCap').cap).toBe(0.7);
  });

  it('bursts and ground scale with spell power and the skill’s modifiers (an effectiveness, not a fixed number)', () => {
    const low = buildPlayerModel(bareCharacter({ level: 10 }));
    const at = (m: typeof model, skill: SkillId, aug: string) => {
      const r = resolveSkill(m, skill, 10, [aug]).runtime.augments?.find((x) => x.p === 'blast');
      return r?.p === 'blast' ? r.damage : 0;
    };
    for (const [skill, aug] of [['riftStep', 'afterimage'], ['riftStep', 'staticArrival'], ['cinderWard', 'pyreBurst'], ['frostOrb', 'shatter'],
      ['stormCall', 'eyeOfTheStorm'], ['glacialSpikes', 'shatteringRows']] as const) {
      expect(at(model, skill, aug), `${skill}.${aug}`).toBeGreaterThan(at(low, skill, aug));
      expect(at(low, skill, aug)).toBeGreaterThan(0);
    }
    // Eye of the Storm's 3× effectiveness vs the strike's own hit: exactly 3 / the skill's effectiveness.
    const storm = resolveSkill(model, 'stormCall', 10, ['eyeOfTheStorm']);
    const b = storm.runtime.augments?.find((x) => x.p === 'blast');
    expect(b?.p === 'blast' ? b.damage : 0).toBeCloseTo((storm.runtime.damage * 3) / storm.effectiveness, 6);
    const wake = resolveSkill(model, 'flameWave', 10, ['burningWake']);
    const tr = wake.runtime.augments?.find((x) => x.p === 'trail');
    expect(tr?.p === 'trail' ? tr.damage : 0).toBeCloseTo((wake.runtime.damage * 0.35) / wake.effectiveness, 6);
  });

  it('tooltips follow the behaviour: Inverted Heat ignites, Static Frost shocks, Void Convert has no elemental ailment, Hollow Shell pierces all', () => {
    const lines = (skill: SkillId, aug: string) => rules.skillSheet(bareCharacter({ level: 40, skillRanks: { [skill]: 10 }, augments: { [skill]: [aug] } }), skill, 10).lines;
    expect(lines('rimeShards', 'invertedHeat').some((l) => /chance to Ignite/.test(l))).toBe(true);
    expect(lines('rimeShards', 'invertedHeat').some((l) => /chance to Chill/.test(l))).toBe(false);
    expect(lines('frostOrb', 'staticFrost').some((l) => /chance to Shock/.test(l))).toBe(true);
    expect(lines('umbralBolt', 'hollowShell')).toContain('Pierces every enemy in its path');
    expect(lines('emberNova', 'tripleRing').some((l) => /Bursts 8 flames/.test(l))).toBe(true);
  });

  it(`no pickable combination of augments takes a skill past the more cap (×${MORE_CAP})`, () => {
    for (const id of SKILL_IDS.filter((s) => SKILLS[s].available)) {
      const tree = SKILLS[id].augmentDefs.filter(augmentAvailable);
      const combos: AugmentDef[][] = [[]];
      for (const a of tree) {
        const n = combos.length;
        for (let k = 0; k < n; k++) {
          const c = combos[k];
          if (c.length >= 5) continue;
          if (c.some((b) => (b.excludes ?? []).includes(a.id) || (a.excludes ?? []).includes(b.id))) continue;
          combos.push([...c, a]);
        }
      }
      for (const c of combos) {
        const r = resolveSkill(model, id, 10, c.map((a) => a.id));
        expect(r.moreMultiplier, `${id}: ${c.map((a) => a.id).join('+')}`).toBeLessThanOrEqual(MORE_CAP);
        expect(Number.isFinite(r.runtime.damage)).toBe(true);
        for (const p of r.runtime.augments ?? []) if (p.p === 'blast' || p.p === 'trail') expect(Number.isFinite(p.damage)).toBe(true);
      }
    }
  });
});
