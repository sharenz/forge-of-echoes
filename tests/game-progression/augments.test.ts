// Augments, skill points, respec and loadout presets (docs/power-rework/skills.md 4 and 9; game/progression/skills.ts).
import { describe, expect, it } from 'vitest';
import type { SkillId } from '../../src/contracts/content';
import { SKILL_IDS } from '../../src/contracts/content';
import type { CharacterSave } from '../../src/contracts/items';
import { AUGMENT_PRIMITIVES } from '../../src/contracts/sim';
import { AUGMENT_RULES, MAX_SKILL_RANK, RESPEC, SKILLS, augmentAvailable } from '../../src/data/progression';
import { rules } from '../../src/game';
import { normalizeCharacter } from '../../src/game/progression/save';
import { amount, augmentSlots, resolveSkill, skillPointsSpent } from '../../src/game/progression/skills';
import { buildPlayerModel } from '../../src/game/progression/model';
import { bareCharacter, currency, expectErr, expectOk, unique } from './fixtures';

function withSkills(ranks: Partial<Record<SkillId, number>>, extra: Partial<CharacterSave> = {}): CharacterSave {
  const base = bareCharacter({ level: 30, ...extra });
  return { ...base, skillRanks: { ...base.skillRanks, ...ranks } };
}

const model = buildPlayerModel(bareCharacter({ level: 30 }));
const rt = (id: SkillId, rank: number, augs: string[] = []) => resolveSkill(model, id, rank, augs);

/** The augments SK5 turned on (flagship primitives), in tree order per skill. */
const SK5_LIVE = [
  'emberLance.lodgeEmber', 'emberLance.cinderFragments', 'emberLance.frostfireCore', 'emberLance.searingBrand',
  'emberNova.spiralArms', 'emberNova.kilnRing', 'emberNova.tripleRing', 'emberNova.heartfire',
  'flameWave.burningWake', 'flameWave.tideReturns', 'flameWave.overheat', 'flameWave.slowTide',
  'rimeShards.brittleShards', 'rimeShards.splintering', 'rimeShards.lodgedIce', 'rimeShards.invertedHeat',
  'arcChain.forkingArc', 'arcChain.conductiveMark', 'arcChain.overcharge', 'arcChain.stormReturn', 'arcChain.staticDischarge',
  'riftStep.afterimage', 'riftStep.riftEcho', 'riftStep.staticArrival', 'riftStep.phaseWeave',
  'cinderWard.pyreBurst', 'cinderWard.hardenedEmber',
  'glacialNova.freezingCore', 'glacialNova.shatter',
  'cinderMortar.clusterShell', 'cinderMortar.delayedFuse', 'cinderMortar.skipShot', 'cinderMortar.magmaCore', 'cinderMortar.rainOfShells',
  'arcaneReprieve.chargedReprieve',
  'umbralBolt.hollowShell', 'umbralBolt.entropicSplit', 'umbralBolt.voidExposure', 'umbralBolt.soulbindLodge',
  'kineticLance.shatterRounds', 'kineticLance.voidConvert', 'kineticLance.pinning',
  'frostOrb.shatter', 'frostOrb.frozenHeart', 'frostOrb.staticFrost',
  'stormCall.thunderMark', 'stormCall.eyeOfTheStorm', 'stormCall.conduction',
  'glacialSpikes.frostComb', 'glacialSpikes.shatteringRows',
];

/** Position of `skill.augment` in SKILL_IDS order, then tree order (how the live list is enumerated). */
function order(key: string): number {
  const [skill, aug] = key.split('.');
  const id = skill as (typeof SKILL_IDS)[number];
  return SKILL_IDS.indexOf(id) * 100 + SKILLS[id].augmentDefs.findIndex((a) => a.id === aug);
}

describe('skill points', () => {
  it('total 1 + 2 (L − 1): L10 19, L20 39, L40 79, L80 159', () => {
    expect([1, 10, 20, 40, 80].map((l) => rules.skillPointsTotal(l))).toEqual([1, 19, 39, 79, 159]);
  });

  it('count ranks beyond Ember Lance’s innate one and augment costs', () => {
    const ch = withSkills({ emberLance: 4, emberNova: 2 }, { augments: { emberLance: ['piercingFlame'] } });
    expect(skillPointsSpent(ch)).toBe(3 + 2 + 1);
  });
});

describe('augment data', () => {
  it('has 32 skills with unlock levels from the roster table, seven of them playable', () => {
    expect(SKILL_IDS).toHaveLength(32);
    const unlock = Object.fromEntries(SKILL_IDS.map((id) => [id, SKILLS[id].unlockLevel]));
    expect(unlock).toMatchObject({
      emberLance: 1, emberNova: 1, riftStep: 1, cinderWard: 2, rimeShards: 3, phaseStride: 5, arcChain: 6, glacialNova: 7, spark: 8,
      cinderMortar: 9, arcaneReprieve: 10, umbralBolt: 11, flameWave: 12, kineticLance: 13, frostOrb: 14, stormCall: 16, glacialSpikes: 18,
      gravityWell: 20, rimeBulwark: 22, immolationSigil: 24, staticAegis: 26, voltaicPulse: 28, entropyHex: 30, concussiveBlast: 32,
      staticLash: 34, echoSigil: 36, witherField: 40, meteorRain: 44, stormStep: 48, tempestSurge: 52, blizzard: 56, eventHorizon: 62,
    });
    for (const id of SKILL_IDS) expect(SKILLS[id].maxRank).toBe(MAX_SKILL_RANK);
  });

  it('gives every playable flagship skill a 6 or 7 augment tree (the others 3) with unique ids and symmetric exclusions', () => {
    // skills.md 5 (13 flagships) and 6 (the other 19: one augment per tier).
    const THREE: readonly SkillId[] = ['glacialNova', 'spark', 'phaseStride', 'arcaneReprieve', 'glacialSpikes'];
    for (const id of SKILL_IDS.filter((s) => SKILLS[s].available)) {
      const tree = SKILLS[id].augmentDefs;
      if (THREE.includes(id)) expect(tree.map((a) => a.tier), id).toEqual([1, 2, 3]);
      else {
        expect(tree.length, id).toBeGreaterThanOrEqual(6);
        expect(tree.length, id).toBeLessThanOrEqual(7);
      }
      expect(new Set(tree.map((a) => a.id)).size).toBe(tree.length);
      for (const tier of [1, 2, 3] as const) expect(tree.some((a) => a.tier === tier), `${id} T${tier}`).toBe(true);
      for (const a of tree) {
        for (const ex of a.excludes ?? []) {
          const other = tree.find((b) => b.id === ex);
          expect(other, `${id}.${a.id} excludes unknown ${ex}`).toBeDefined();
          expect(other!.excludes ?? [], `${id}: ${ex} must exclude ${a.id} back`).toContain(a.id);
        }
      }
    }
  });

  it('exposes tier, cost and rank gate to the UI, and only primitives the executor handles become runtime augments', () => {
    const info = rules.content.skills.emberLance.augments;
    expect(info.find((a) => a.id === 'piercingFlame')).toMatchObject({ tier: 1, cost: 1, rankRequired: 2, available: true });
    expect(info.find((a) => a.id === 'searingBrand')).toMatchObject({ tier: 3, cost: 2, rankRequired: 8, available: true });
    expect(rules.content.skills.kineticLance.augments.find((a) => a.id === 'heavyImpact')).toMatchObject({ tier: 1, available: false });
    expect(AUGMENT_RULES.tierRank).toEqual({ 1: 2, 2: 5, 3: 8 });
    for (const id of SKILL_IDS) {
      for (const a of SKILLS[id].augmentDefs.filter(augmentAvailable)) {
        const r = rt(id, MAX_SKILL_RANK, [a.id]).runtime;
        for (const prim of r.augments ?? []) expect(AUGMENT_PRIMITIVES).toContain(prim.p);
      }
    }
  });

  it('has 84 augments live (17 of SK0, 17 of the SK2 roster, 50 of SK5); the rest wait for their primitives', () => {
    const live = SKILL_IDS.flatMap((id) => SKILLS[id].augmentDefs.filter(augmentAvailable).map((a) => `${id}.${a.id}`));
    expect(live).toEqual([
      'emberLance.piercingFlame', 'emberLance.twinStrand', 'emberLance.rapidSpark',
      'emberNova.widerRing', 'emberNova.echoingRing', 'emberNova.emberFan',
      'flameWave.wideFront', 'flameWave.ringOfWaves',
      'rimeShards.hoarfrostSpread', 'rimeShards.glacialEcho',
      'arcChain.longReach',
      'riftStep.longerStride', 'riftStep.chillingLanding',
      'cinderWard.bankedEmbers', 'cinderWard.frozenHearth', 'cinderWard.vigil', 'cinderWard.resoluteFlame',
      // SK2 roster batch 1
      'phaseStride.longStride', 'phaseStride.slipstream', 'phaseStride.cleansingStride',
      'glacialNova.wideChill',
      'spark.moreSparks', 'spark.ricochetStorm', 'spark.charged',
      'cinderMortar.napalm',
      'arcaneReprieve.deepWell', 'arcaneReprieve.secondWind',
      'umbralBolt.witheringTouch',
      'kineticLance.ricochet',
      'frostOrb.twinOrbs',
      'stormCall.wideSkies', 'stormCall.stormCell', 'stormCall.tetheredStrikes',
      'glacialSpikes.twinLines',
    ].concat(SK5_LIVE).sort((a, b) => order(a) - order(b)));
  });

  it('keeps only the five augments whose primitive is still missing planned (knockback, armour, chill effect, orbit, pull)', () => {
    const planned = SKILL_IDS.flatMap((id) => SKILLS[id].augmentDefs.filter((a) => !augmentAvailable(a)).map((a) => `${id}.${a.id}`));
    expect(planned.sort()).toEqual([
      'frostOrb.heavyChill', 'frostOrb.orbit', 'kineticLance.armourPiercing', 'kineticLance.heavyImpact',
      'umbralBolt.gravitySeed',
    ]);
  });
});

describe('picking augments', () => {
  it('gates tiers by rank, slots by floor(rank / 2), and costs points', () => {
    expect([0, 1, 2, 3, 4, 9, 10].map(augmentSlots)).toEqual([0, 0, 1, 1, 2, 4, 5]);
    const r1 = withSkills({}, { unspentSkillPoints: 5 });
    expect(rules.canPickAugment(r1, 'emberLance', 'piercingFlame').reason).toBe('Piercing Flame needs Ember Lance rank 2 (currently 1).');
    const r2 = withSkills({ emberLance: 2 }, { unspentSkillPoints: 5 });
    const one = expectOk(rules.pickAugment(r2, 'emberLance', 'piercingFlame'));
    expect(one.augments?.emberLance).toEqual(['piercingFlame']);
    expect(one.unspentSkillPoints).toBe(4);
    expect(rules.canPickAugment(one, 'emberLance', 'piercingFlame').reason).toMatch(/already chosen/);
    expect(rules.canPickAugment(one, 'emberLance', 'rapidSpark').reason).toMatch(/1 augment slot at rank 2/);
    const r4 = { ...one, skillRanks: { ...one.skillRanks, emberLance: 4 } };
    expect(rules.canPickAugment(r4, 'emberLance', 'rapidSpark').ok).toBe(true);
    expect(rules.canPickAugment({ ...r4, unspentSkillPoints: 0 }, 'emberLance', 'rapidSpark').reason).toMatch(/costs 1 skill point/);
  });

  it('refuses excluded pairs both ways, unknown ids and augments whose primitive has not shipped', () => {
    const ch = withSkills({ emberLance: 10 }, { unspentSkillPoints: 9, augments: { emberLance: ['twinStrand'] } });
    expect(rules.canPickAugment(ch, 'emberLance', 'rapidSpark').reason).toBe('Rapid Spark cannot be combined with Twin Strand.');
    expect(rules.canPickAugment(ch, 'emberLance', 'nope').reason).toBe('Ember Lance has no such augment.');
    expect(rules.canPickAugment(ch, 'kineticLance', 'heavyImpact').reason).toBe('Heavy Impact arrives in a later update.');
    expect(expectErr(rules.pickAugment(ch, 'umbralBolt', 'gravitySeed'))).toMatch(/later update/);
  });

  it('keeps picks in tree order', () => {
    const ch = withSkills({ emberNova: 10 }, { unspentSkillPoints: 9 });
    const a = expectOk(rules.pickAugment(ch, 'emberNova', 'emberFan'));
    const b = expectOk(rules.pickAugment(a, 'emberNova', 'echoingRing'));
    expect(b.augments?.emberNova).toEqual(['echoingRing', 'emberFan']);
  });
});

describe('resolving augments', () => {
  it('folds stat augments into the numbers: pierce, count, spread, cast time, less damage', () => {
    const base = rt('emberLance', 5).runtime;
    expect(rt('emberLance', 5, ['piercingFlame']).runtime.pierce).toBe(2);
    const twin = rt('emberLance', 5, ['twinStrand']).runtime;
    expect(twin.projectiles).toBe(2);
    expect(twin.spread).toBeCloseTo((12 * Math.PI) / 180, 10);
    expect(twin.damage).toBeCloseTo(base.damage * 0.75, 10);
    const rapid = rt('emberLance', 5, ['rapidSpark']).runtime;
    expect(rapid.castTime).toBeCloseTo(base.castTime * 0.82, 10);
    expect(rapid.damage).toBeCloseTo(base.damage * 0.92, 10);
    // An augment that was not picked, or an unknown id, changes nothing.
    expect(rt('emberLance', 5, ['heavyImpact', 'bogus']).runtime).toEqual(base);
  });

  it('Ember Nova: Wider Ring, Ember Fan (a 120° fan the sim reads) and Echoing Ring (70%, counted in the estimates)', () => {
    const base = rt('emberNova', 6);
    const wide = rt('emberNova', 6, ['widerRing']).runtime;
    expect(wide.projectiles).toBe(base.runtime.projectiles + 4);
    expect(wide.range).toBeCloseTo(base.runtime.range * 1.3, 10);
    const fan = rt('emberNova', 6, ['emberFan']);
    expect(fan.runtime.augments).toEqual([{ p: 'fan', arc: (120 * Math.PI) / 180 }]);
    expect(fan.runtime.damage).toBeCloseTo(base.runtime.damage * 1.6, 10);
    expect(fan.runtime.spread).toBeCloseTo((120 * Math.PI) / 180, 10);
    const echo = rt('emberNova', 6, ['echoingRing']);
    expect(echo.runtime.augments).toEqual([{ p: 'echo', delay: 0.4, damage: 0.7 }]);
    expect(echo.dps).toBeCloseTo(base.dps! * 1.7, 10);
    expect(echo.perCast).toBeCloseTo(base.perCast! * 1.7, 10);
  });

  it('applies the better of an item-granted and a picked echo, never both', () => {
    const amulet = unique('echoOfTheMatriarch');
    const ch = withSkills({ emberNova: 6 }, { equipment: { amulet }, augments: { emberNova: ['echoingRing'] } });
    const sheet = rules.skillSheet(ch, 'emberNova');
    expect(sheet.runtime.flags).toContain('echo');
    expect(sheet.runtime.augments).toEqual([{ p: 'echo', delay: 0.4, damage: 1 }]);
    const plain = rules.skillSheet(withSkills({ emberNova: 6 }), 'emberNova');
    expect(sheet.dps).toBeCloseTo(plain.dps! * 2, 10);
  });

  it('Ring of Waves turns the fan into a doubled full circle; Long Reach chains further; Longer Stride; ward flags', () => {
    const ring = rt('flameWave', 5, ['ringOfWaves']).runtime;
    const wave = rt('flameWave', 5).runtime;
    expect(ring.flags).toContain('circle');
    expect(ring.projectiles).toBe(wave.projectiles * 2);
    expect(ring.spread).toBeCloseTo((Math.PI * 2 * (ring.projectiles - 1)) / ring.projectiles, 10);
    const arc = rt('arcChain', 4, ['longReach']).runtime;
    expect(arc.chains).toBe(rt('arcChain', 4).runtime.chains + 2);
    expect(arc.radius).toBeCloseTo(135, 10);
    const step = rt('riftStep', 4, ['longerStride']).runtime;
    expect(step.augments).toEqual([{ p: 'invulnerable', seconds: 0.3 }]);
    expect(step.focusCost).toBe(10);
    expect(step.distance).toBeCloseTo(rt('riftStep', 4).runtime.distance * 1.3, 10);
    expect(rt('riftStep', 5, ['chillingLanding']).runtime.flags).toContain('chillLanding');
    const cold = rt('cinderWard', 5, ['frozenHearth']).runtime;
    expect(cold).toMatchObject({ damageType: 'cold', ailmentChance: 1 });
    expect(rt('cinderWard', 5, ['vigil']).runtime.damage).toBe(0);
    expect(rt('cinderWard', 5, ['bankedEmbers']).runtime.radius).toBe(80);
  });

  it('lists picked augments on the tooltip and hands the sim the same runtime', () => {
    const ch = withSkills({ emberNova: 6 }, { augments: { emberNova: ['widerRing', 'echoingRing'] } });
    const sheet = rules.skillSheet(ch, 'emberNova');
    expect(sheet.augmentLines).toEqual([
      'Wider Ring: 30% more range and 4 more flames, 8% less damage',
      'Echoing Ring: Repeats after 0.4 seconds at 70% damage, at no Focus cost',
    ]);
    expect(sheet.lines.slice(-2)).toEqual(sheet.augmentLines);
    expect(rules.playerRuntime(ch, null).skills.find((s) => s.id === 'emberNova')).toEqual(sheet.runtime);
  });
});

describe('the character sheet', () => {
  it('counts picked augments in the Skills section', () => {
    const ch = withSkills({ emberNova: 6 }, {
      loadout: ['emberLance', 'emberNova', null, null, null, null, null, null], augments: { emberNova: ['echoingRing'] },
    });
    const line = rules.deriveStats(ch).sections.find((s) => s.title === 'Skills')!.lines.find((l) => l.label.startsWith('Ember Nova'))!;
    const r = resolveSkill(buildPlayerModel(ch), 'emberNova', 6, ['echoingRing']);
    expect(line.value.startsWith(`${amount(r.sustainedDps!)} DPS`)).toBe(true);
    expect(r.echo).toBe(0.7);
  });
});

describe('respec', () => {
  it('is free below level 20, then the first 15 points, then 4 Scrap per point', () => {
    const young = withSkills({ emberNova: 5 }, { level: 19, augments: { emberNova: ['widerRing'] } });
    expect(rules.respecPrice(young, { skillId: 'emberNova' })).toEqual({ points: 6, freePoints: 6, scrap: 0 });
    const old = { ...young, level: 30, respecFreeUsed: 12 };
    expect(rules.respecPrice(old, { skillId: 'emberNova' })).toEqual({ points: 6, freePoints: 3, scrap: 12 });
    expect(rules.respecPrice({ ...old, respecFreeUsed: RESPEC.freePoints }, { skillId: 'emberNova', augmentId: 'widerRing' }))
      .toEqual({ points: 1, freePoints: 0, scrap: 4 });
    expect(rules.respecPrice(old, { all: true }).points).toBe(6);
  });

  it('refunds one augment, paying Scrap from the character in the same value', () => {
    const ch = withSkills({ emberNova: 5 }, {
      augments: { emberNova: ['widerRing', 'echoingRing'] }, respecFreeUsed: RESPEC.freePoints, currencyStash: { scrap: 10 },
    });
    const done = expectOk(rules.refundAugment(ch, 'emberNova', 'echoingRing'));
    expect(done.augments?.emberNova).toEqual(['widerRing']);
    expect(done.unspentSkillPoints).toBe(ch.unspentSkillPoints + 1);
    expect(done.currencyStash.scrap).toBe(6);
    expect(expectErr(rules.refundAugment({ ...ch, currencyStash: {} }, 'emberNova', 'echoingRing'))).toBe('The refund costs 4 Forge Scrap.');
    expect(expectErr(rules.refundAugment(ch, 'emberNova', 'emberFan'))).toBe('That augment is not chosen.');
  });

  it('counts free points used only from level 20', () => {
    const ch = withSkills({ emberNova: 5 }, { level: 25, augments: { emberNova: ['widerRing'] } });
    const done = expectOk(rules.refundAugment(ch, 'emberNova', 'widerRing'));
    expect(done.respecFreeUsed).toBe(1);
    expect(done.augments?.emberNova).toBeUndefined();
    const young = expectOk(rules.refundAugment({ ...ch, level: 10 }, 'emberNova', 'widerRing'));
    expect(young.respecFreeUsed ?? 0).toBe(0);
  });

  it('respecs one skill to unlearned (Ember Lance keeps rank 1) and drops it from the loadout', () => {
    const ch = withSkills({ emberLance: 5, emberNova: 4 }, {
      level: 10, loadout: ['emberLance', 'emberNova', null, null, null, null, null, null], augments: { emberNova: ['widerRing'], emberLance: ['piercingFlame'] },
    });
    const nova = expectOk(rules.respec(ch, 'emberNova', false));
    expect(nova.skillRanks.emberNova).toBe(0);
    expect(nova.augments?.emberNova).toBeUndefined();
    expect(nova.loadout[1]).toBeNull();
    expect(nova.unspentSkillPoints).toBe(ch.unspentSkillPoints + 5);
    const lance = expectOk(rules.respec(ch, 'emberLance', false));
    expect(lance.skillRanks.emberLance).toBe(1);
    expect(lance.loadout[0]).toBe('emberLance');
    expect(lance.unspentSkillPoints).toBe(ch.unspentSkillPoints + 5);
    expect(expectErr(rules.respec(withSkills({}), 'emberNova', false))).toBe('There is nothing to refund.');
  });

  it('a free respec token resets every skill, augment and attribute point at once', () => {
    const ch = withSkills({ emberLance: 3, emberNova: 2 }, {
      respecTokens: 1, allocated: { str: 3, dex: 0, int: 6 }, unspentAttributePoints: 1, augments: { emberLance: ['rapidSpark'] },
    });
    const done = expectOk(rules.respec(ch, null, true));
    expect(done.respecTokens).toBe(0);
    expect(done.allocated).toEqual({ str: 0, dex: 0, int: 0 });
    expect(done.unspentAttributePoints).toBe(10);
    expect(skillPointsSpent(done)).toBe(0);
    expect(done.unspentSkillPoints).toBe(ch.unspentSkillPoints + 2 + 2 + 1);
    expect(expectErr(rules.respec(done, null, true))).toMatch(/nothing to refund|no free respec/);
    expect(expectErr(rules.respec(ch, 'emberNova', true))).toMatch(/every skill at once/);
  });

  it('a full respec without a token is paid in Scrap', () => {
    const ch = withSkills({ emberNova: 10 }, { respecFreeUsed: RESPEC.freePoints });
    expect(expectErr(rules.respec(ch, null, false))).toBe('The refund costs 40 Forge Scrap.');
    const paid = expectOk(rules.respec({ ...ch, backpack: { ...ch.backpack, entries: [{ x: 0, y: 0, item: currency('scrap', 40) }] } }, null, false));
    expect(paid.backpack.entries).toEqual([]);
    expect(paid.skillRanks.emberNova).toBe(0);
  });
});

describe('loadout presets', () => {
  it('saves, loads and renames three presets; loading drops skills unlearned since', () => {
    const ch = withSkills({ emberNova: 2, riftStep: 1 }, { loadout: ['emberLance', 'emberNova', 'riftStep', null, null, null, null, null] });
    const saved = expectOk(rules.setPreset(ch, 1, 'save'));
    expect(saved.loadoutPresets?.[1].loadout).toEqual(ch.loadout);
    const renamed = expectOk(rules.setPreset(saved, 1, 'rename', '  Pack   clear '));
    expect(renamed.loadoutPresets?.[1].name).toBe('Pack clear');
    const cleared = expectOk(rules.setLoadoutSlot(renamed, 1, null));
    const unlearned = { ...cleared, skillRanks: { ...cleared.skillRanks, riftStep: 0 } };
    expect(expectOk(rules.setPreset(unlearned, 1, 'load')).loadout).toEqual(['emberLance', 'emberNova', null, null, null, null, null, null]);
    expect(expectErr(rules.setPreset(ch, 3, 'save'))).toMatch(/does not exist/);
  });
});

describe('saving augments', () => {
  it('keeps valid picks and drops (refunding) unknown, unavailable, gated, clashing or over-slot ones', () => {
    const ch = withSkills({ emberLance: 2, emberNova: 10 }, {
      unspentSkillPoints: 0,
      augments: { emberLance: ['twinStrand', 'rapidSpark', 'lodgeEmber', 'bogus'], emberNova: ['echoingRing'], flameWave: ['wideFront'] },
    });
    const back = normalizeCharacter(JSON.parse(JSON.stringify(ch)))!;
    expect(back.augments).toEqual({ emberLance: ['twinStrand'], emberNova: ['echoingRing'] });
    // rapidSpark (excluded, 1) + lodgeEmber (unavailable, 1) + flameWave's wideFront (not learned, 1); bogus is not an augment.
    expect(back.unspentSkillPoints).toBe(3);
  });

  it('refunds ranks a hand-edited save put on a roster skill that has not shipped', () => {
    const back = normalizeCharacter({ ...withSkills({}, { unspentSkillPoints: 1 }), skillRanks: { emberLance: 1, gravityWell: 4 } })!;
    expect(back.skillRanks.gravityWell).toBe(0);
    expect(back.unspentSkillPoints).toBe(5);
  });
});
