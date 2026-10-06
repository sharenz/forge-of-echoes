// Power rework P1 on the rules side: penetration and maximum resistance in the derived stats, the tag stats, the
// 'more' cap, the anti-degeneracy caps (power-curve.md section 11), conversion keeping both types' modifiers, the
// character sheet lines and the skill tooltip's "Penetrates" line.
import { describe, expect, it } from 'vitest';
import type { StatId, StatModifier } from '../../src/contracts/items';
import type { SkillId } from '../../src/contracts/content';
import { MORE_CAP, PEN_CAP, SORCERESS, STAT_CAPS } from '../../src/data/progression';
import { deriveFromModel } from '../../src/game/progression/stats';
import { buildPlayerModel } from '../../src/game/progression/model';
import { damageStatsFor, resolveSkill, skillLines } from '../../src/game/progression/skills';
import { bareCharacter } from './fixtures';

const mod = (stat: StatId, value: number, mode: StatModifier['mode'] = 'flat'): StatModifier => ({ stat, mode, value, source: 'Test' });
const ch = bareCharacter({ level: 20 });
const modelOf = (...extra: StatModifier[]) => buildPlayerModel(ch, extra);
const derive = (...extra: StatModifier[]) => deriveFromModel(ch, modelOf(...extra));
const skill = (id: SkillId, ...extra: StatModifier[]) => resolveSkill(modelOf(...extra), id, 5);

describe('penetration in the derived stats', () => {
  it('is zero without sources and resolves per type, with elementalPen on fire, cold and lightning only', () => {
    expect(derive().combat.pen).toEqual({ physical: 0, fire: 0, cold: 0, lightning: 0, void: 0 });
    const pen = derive(mod('firePen', 12), mod('elementalPen', 5), mod('voidPen', 7), mod('physicalPen', 3)).combat.pen;
    expect(pen).toEqual({ physical: 3, fire: 17, cold: 5, lightning: 5, void: 7 });
  });

  it('caps every type at PEN_CAP (all sources summed first)', () => {
    expect(PEN_CAP).toBe(40);
    const d = derive(mod('firePen', 30), mod('firePen', 20), mod('elementalPen', 15), mod('coldPen', 100));
    expect(d.combat.pen.fire).toBe(40);
    expect(d.combat.pen.cold).toBe(40);
    expect(d.combat.pen.lightning).toBe(15);
  });

  it('shows a Penetration section with sources and the cap only once something grants it', () => {
    expect(derive().sections.some((s) => s.title === 'Penetration')).toBe(false);
    const section = derive(mod('firePen', 30), mod('elementalPen', 20)).sections.find((s) => s.title === 'Penetration')!;
    const fire = section.lines.find((l) => l.label === 'Fire Penetration')!;
    expect(fire.value).toBe('40%');
    expect(fire.breakdown.join(' ')).toContain('Capped at 40% (50% uncapped)');
    expect(fire.breakdown.join(' ')).toContain('from Test');
    expect(section.lines.find((l) => l.label === 'Cold Penetration')!.value).toBe('20%');
    expect(section.lines.some((l) => l.label === 'Void Penetration')).toBe(false);
  });
});

describe('maximum resistance and the uncapped resistance handed to the sim', () => {
  it('defaults to the class cap and rises with Maximum Resistances up to the hard ceiling', () => {
    expect(derive().combat.maxResist).toBe(SORCERESS.resistCap);
    expect(derive(mod('maxResistance', 4)).combat.maxResist).toBe(SORCERESS.resistCap + 4);
    expect(derive(mod('maxResistance', 30)).combat.maxResist).toBe(STAT_CAPS.maxResistHard);
    const line = derive(mod('maxResistance', 4)).sections.find((s) => s.title === 'Defence')!.lines.find((l) => l.label === 'Maximum Resistances')!;
    expect(line.value).toBe('79%');
  });

  it('keeps resistance uncapped in combat (the sim caps it after Withered); the sheet shows the capped value', () => {
    const d = derive(mod('fireRes', 90), mod('coldRes', 20));
    expect(d.combat.resist.fire).toBeCloseTo(0.9, 10);
    expect(d.combat.resist.cold).toBeCloseTo(0.2, 10);
    const fire = d.sections.find((s) => s.title === 'Defence')!.lines.find((l) => l.label === 'Fire Resistance')!;
    expect(fire.value).toBe('75%');
    expect(fire.breakdown.join(' ')).toContain('90% uncapped');
    const raised = derive(mod('fireRes', 90), mod('maxResistance', 10)).sections.find((s) => s.title === 'Defence')!.lines.find((l) => l.label === 'Fire Resistance')!;
    expect(raised.value).toBe('85%');
  });
});

describe('tag stats', () => {
  it('Projectile, Area and Duration skills take projectileDamage, areaDamage and damageOverTime', () => {
    expect(damageStatsFor('fire')).toEqual(['spellDamage', 'fireDamage', 'elementalDamage']);
    expect(damageStatsFor('fire', ['Spell', 'Projectile', 'Area'])).toEqual(['spellDamage', 'fireDamage', 'elementalDamage', 'projectileDamage', 'areaDamage']);
    expect(damageStatsFor('void', ['Duration'])).toEqual(['spellDamage', 'voidDamage', 'damageOverTime']);
  });

  it('raise the hit of matching skills only', () => {
    const base = (id: SkillId) => skill(id);
    const gain = (id: SkillId, extra: number) => (1 + (base(id).increased + extra) / 100) / (1 + base(id).increased / 100);
    // Ember Lance: Projectile. Arc Chain: Chaining (no tag stat). Ember Nova: Projectile + Area.
    expect(skill('emberLance', mod('projectileDamage', 50, 'increased')).runtime.damage).toBeCloseTo(base('emberLance').runtime.damage * gain('emberLance', 50), 5);
    expect(skill('arcChain', mod('projectileDamage', 50, 'increased')).runtime.damage).toBeCloseTo(base('arcChain').runtime.damage, 8);
    expect(skill('emberNova', mod('areaDamage', 100, 'increased')).runtime.damage).toBeCloseTo(base('emberNova').runtime.damage * gain('emberNova', 100), 5);
    expect(skill('emberLance', mod('areaDamage', 100, 'increased')).runtime.damage).toBeCloseTo(base('emberLance').runtime.damage, 8);
  });
});

describe('converted damage keeps the modifiers of the type it came from', () => {
  it('a cold share converted from fire takes the cold pool and the fire pool', () => {
    const cold = damageStatsFor('cold', ['Projectile'], ['fire']);
    expect(cold).toEqual(['spellDamage', 'coldDamage', 'elementalDamage', 'fireDamage', 'projectileDamage']);
    const model = modelOf(mod('fireDamage', 40, 'increased'), mod('coldDamage', 30, 'increased'), mod('elementalDamage', 10, 'increased'));
    const pool = (stats: StatId[]) => model.of(...stats.filter((st) => st !== 'spellDamage')).filter((m) => m.mode === 'increased').reduce((s, m) => s + m.value, 0);
    expect(pool(damageStatsFor('cold'))).toBe(40); // cold + elemental
    expect(pool(cold)).toBe(80); // + fire, elemental counted once
    expect(pool(damageStatsFor('fire'))).toBe(50);
  });
});

describe('the more cap', () => {
  it('limits the multiplicative pool to MORE_CAP and flags it', () => {
    expect(MORE_CAP).toBe(3.5);
    const lance = skill('emberLance');
    const two = skill('emberLance', mod('spellDamage', 100, 'more'), mod('fireDamage', 50, 'more'));
    expect(two.moreMultiplier).toBeCloseTo(3, 10);
    expect(two.moreCapped).toBe(false);
    expect(two.runtime.damage).toBeCloseTo(lance.runtime.damage * 3, 5);
    const over = skill('emberLance', mod('spellDamage', 100, 'more'), mod('fireDamage', 100, 'more'), mod('elementalDamage', 50, 'more'));
    expect(over.moreMultiplier).toBe(3.5);
    expect(over.moreCapped).toBe(true);
    expect(over.runtime.damage).toBeCloseTo(lance.runtime.damage * 3.5, 5);
  });

  it('leaves gear increased additive (no cap on the additive pool)', () => {
    const base = skill('emberLance');
    const r = skill('emberLance', mod('spellDamage', 900, 'increased'));
    expect(r.moreMultiplier).toBe(1);
    expect(r.runtime.damage).toBeCloseTo(base.runtime.damage * (1 + (base.increased + 900) / 100) / (1 + base.increased / 100), 4);
  });
});

describe('anti-degeneracy caps (power-curve.md 11)', () => {
  it('cast speed +150% and cooldown recovery +100%', () => {
    const base = skill('emberLance').runtime.castTime;
    expect(skill('emberLance', mod('castSpeed', 100, 'increased')).runtime.castTime).toBeCloseTo(base / 2, 8);
    expect(skill('emberLance', mod('castSpeed', 400, 'increased')).runtime.castTime).toBeCloseTo(base / 2.5, 8);
    const cd = skill('riftStep').runtime.cooldown;
    expect(skill('riftStep', mod('cooldownRecovery', 500, 'increased')).runtime.cooldown).toBeCloseTo(cd / 2, 8);
  });

  it('crit chance 100% and crit multiplier 500%', () => {
    expect(skill('emberLance', mod('critChance', 900)).runtime.critChance).toBe(1);
    expect(skill('emberLance', mod('critMultiplier', 900, 'flat')).runtime.critMultiplier).toBe(5);
  });

  it('area +100% (radius x1.41)', () => {
    const base = skill('emberNova').runtime.range;
    expect(skill('emberNova', mod('area', 100, 'increased')).runtime.range).toBeCloseTo(base * Math.SQRT2, 8);
    expect(skill('emberNova', mod('area', 900, 'increased')).runtime.range).toBeCloseTo(base * Math.SQRT2, 8);
  });

  it('extra projectiles +6, pierce 8, chains 12 in total', () => {
    const lance = skill('emberLance');
    expect(skill('emberLance', mod('extraProjectiles', 30)).runtime.projectiles).toBe(lance.runtime.projectiles + 6);
    expect(skill('emberLance', mod('pierce', 30)).runtime.pierce).toBe(lance.runtime.pierce + 8);
    const chain = skill('arcChain');
    expect(skill('arcChain', mod('extraChains', 2)).runtime.chains).toBe(chain.runtime.chains + 2);
    expect(skill('arcChain', mod('extraChains', 40)).runtime.chains).toBe(12);
  });

  it('shows the cap on the sheet lines', () => {
    const lines = derive(mod('castSpeed', 400, 'increased'), mod('extraProjectiles', 9), mod('critMultiplier', 800)).sections.find((s) => s.title === 'Offence')!.lines;
    const cast = lines.find((l) => l.label === 'Cast Speed')!;
    expect(cast.value).toBe('+150%');
    expect(cast.breakdown.join(' ')).toContain('Capped at +150%');
    expect(lines.find((l) => l.label === 'Additional Projectiles')!.value).toBe('+6');
    expect(lines.find((l) => l.label === 'Critical Strike Multiplier')!.value).toBe('500%');
  });

  it('shows tag-stat lines on the sheet when something grants them', () => {
    const labels = derive(mod('projectileDamage', 20, 'increased')).sections.find((s) => s.title === 'Offence')!.lines.map((l) => l.label);
    expect(labels).toContain('Projectile Damage');
    expect(derive().sections.find((s) => s.title === 'Offence')!.lines.map((l) => l.label)).not.toContain('Projectile Damage');
  });
});

describe('skill tooltip penetration line', () => {
  it('says "Penetrates N% <Type> resistance" only for the skill\'s type and only with penetration', () => {
    expect(skillLines(skill('emberLance')).some((l) => l.startsWith('Penetrates'))).toBe(false);
    const fire = skillLines(skill('emberLance', mod('firePen', 20), mod('coldPen', 30)));
    expect(fire).toContain('Penetrates 20% Fire resistance (20 of 40 maximum)');
    expect(fire.some((l) => l.includes('Cold resistance'))).toBe(false);
    const elemental = skillLines(skill('rimeShards', mod('elementalPen', 8), mod('coldPen', 5)));
    expect(elemental).toContain('Penetrates 13% Cold resistance (13 of 40 maximum)');
    expect(skillLines(skill('emberLance', mod('firePen', 70)))).toContain('Penetrates 40% Fire resistance (40 of 40 maximum)');
  });
});
