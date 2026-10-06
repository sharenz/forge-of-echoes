// Stat derivation (GAME_SPEC §3): attributes, resources, defences, the skill resolution, breakdowns and
// Alt-compare deltas — checked against hand-computed examples.
import { describe, expect, it } from 'vitest';
import type { CharacterSave, MapItem } from '../../src/contracts/items';
import { rules } from '../../src/game';
import { MONSTER_LEVEL_SCALING, SORCERESS } from '../../src/data/progression';
import { deriveRunStats } from '../../src/game';
import { bareCharacter, equip, expectOk, map, setupFor, unique } from './fixtures';

/** Spell power at level 1 and per level above 1 (GAME_SPEC §3). */
const SP = SORCERESS.spellPower.base;
const SP_LEVEL = SORCERESS.spellPower.perLevel;

const runtime = (ch: CharacterSave, id: string) => rules.playerRuntime(ch, null).skills.find((s) => s.id === id)!;

describe('level-based defences', () => {
  it('combines level and crafted-map resistance penalties in both the sheet and runtime, clearing them at home', () => {
    const ch = bareCharacter({ equipment: { ring1: equip({ baseId: 'emberRing', itemLevel: 1, rarity: 'normal', implicitValues: [15] }) } });
    for (const [tier, penalty] of [[1, 0], [2, 0], [3, 3], [4, 6], [15, 39]]) {
      const setup = setupFor(map('ashenForge', tier, { mods: [{ modId: 'hexed', value: 100 }] }));
      const d = rules.deriveStats(ch, setup);
      expect(d.combat.resist.fire).toBeCloseTo((15 - 20 - penalty) / 100);
      expect(rules.playerRuntime(ch, setup).stats.resist).toEqual(d.combat.resist);
      if (penalty) expect(d.breakdowns.fireRes?.sources.some((m) => m.source === `Monster level ${setup.monsterLevel}` && m.value === -penalty)).toBe(true);
    }
    expect(rules.deriveStats(ch).combat.resist.fire).toBe(0.15);
  });

  it('keeps armour as a rating and explains larger level-scaled hits instead of penalising it twice', () => {
    const ch = bareCharacter({ equipment: { helmet: equip({ baseId: 'ironVisor', itemLevel: 20, rarity: 'normal', implicitValues: [25] }) } });
    const low = rules.deriveStats(ch, setupFor(map('ashenForge', 1)));
    const high = rules.deriveStats(ch, setupFor(map('ashenForge', 15)));
    expect(low.combat.armor).toBe(45);
    expect(high.combat.armor).toBe(45);
    expect(high.combat.evasion).toBeLessThan(low.combat.evasion);
    const armour = high.sections.flatMap((s) => s.lines).find((l) => l.label === 'Armour')!;
    expect(armour.breakdown).toContain('Example hit at monster level 88; larger hits receive less reduction');
  });
});

describe('deriveStats: a naked level 1 Sorceress', () => {
  const d = rules.deriveStats(bareCharacter());

  it('has the class attributes', () => {
    expect(d.attributes).toEqual({ str: 10, dex: 14, int: 30 });
  });

  it('resolves resources from base, level and attributes', () => {
    // Life (70 + 10 str) × 1.01 → 80; Focus 40 + 30 int; regen 3 + 2% of 70.
    expect(d.combat.maxLife).toBe(80);
    expect(d.combat.maxFocus).toBe(70);
    expect(d.combat.focusRegen).toBeCloseTo(4.4, 10);
    expect(d.combat.lifeRegen).toBe(0);
  });

  it('turns the evasion rating into a capped chance', () => {
    // Rating (20 + 2 × 14 dex) × 1.02 → 48; chance 48 / (48 + 30 per monster level × the reference level 10).
    expect(d.combat.evasion).toBeCloseTo(48 / (48 + SORCERESS.evasionPerMonsterLevel * MONSTER_LEVEL_SCALING.referenceLevel), 10);
    expect(d.combat).toMatchObject({
      armor: 0, damageTaken: 1, moveSpeed: 110, pickupRadius: 90, flaskEffect: 1, lifeOnKill: 0, focusOnKill: 0, flags: [],
      resist: { physical: 0, fire: 0, cold: 0, lightning: 0, void: 0 },
    });
    expect(d.itemQuantity).toBe(0);
    expect(d.itemRarity).toBe(0);
  });

  it('explains every line', () => {
    const titles = d.sections.map((s) => s.title);
    expect(titles).toEqual(['Attributes', 'Resources', 'Defence', 'Offence', 'Skills', 'Luck', 'Utility']);
    const life = d.sections.find((s) => s.title === 'Resources')!.lines.find((l) => l.label === 'Maximum Life')!;
    expect(life.value).toBe('80');
    expect(life.breakdown).toEqual(['Base 70', '+10 from Strength', '1% increased from Strength']);
    for (const s of d.sections) for (const l of s.lines) expect(l.breakdown.length, `${s.title}/${l.label}`).toBeGreaterThan(0);
    expect(d.breakdowns.maxLife?.value).toBeCloseTo(80.8, 10);
    expect(d.breakdowns.int?.value).toBe(30);
  });
});

describe('deriveStats: level growth and allocation', () => {
  const ch = bareCharacter({ level: 10, allocated: { str: 5, dex: 0, int: 10 } });
  const d = rules.deriveStats(ch);

  it('floors automatic growth and adds allocated points', () => {
    // str 10 + floor(0.3 × 9) + 5; dex 14 + floor(0.5 × 9); int 30 + floor(1.2 × 9) + 10.
    expect(d.attributes).toEqual({ str: 17, dex: 18, int: 50 });
  });

  it('adds per-level and per-attribute modifiers', () => {
    expect(d.combat.maxLife).toBe(Math.floor((70 + 8 * 9 + 17) * 1.01));
    expect(d.combat.maxFocus).toBe(40 + 2 * 9 + 50);
    expect(d.combat.focusRegen).toBeCloseTo(3 + 0.02 * 108, 10);
    const rating = Math.floor((20 + 3 * 9 + 2 * 18) * 1.03);
    expect(d.combat.evasion).toBeCloseTo(rating / (rating + SORCERESS.evasionPerMonsterLevel * MONSTER_LEVEL_SCALING.referenceLevel), 10);
  });

  it('scales spell power with level and intelligence', () => {
    // (base + 1.6 × 9) × effectiveness 1.0 × (1 + 10% from 50 int).
    expect(runtime(ch, 'emberLance').damage).toBeCloseTo((SP + SP_LEVEL * 9) * 1.1, 10);
  });
});

describe('deriveStats: gear', () => {
  it('adds flat life before the Strength bonus multiplies it', () => {
    const belt = equip({ baseId: 'chainBelt', itemLevel: 10, rarity: 'normal', implicitValues: [20] });
    const d = rules.deriveStats(bareCharacter({ equipment: { belt } }));
    expect(d.combat.maxLife).toBe(Math.floor((70 + 10 + 20) * 1.01));
    const life = d.sections.find((s) => s.title === 'Resources')!.lines.find((l) => l.label === 'Maximum Life')!;
    expect(life.breakdown).toContain('+20 from Chain Belt (implicit)');
  });

  it('caps displayed resistance at 75% (the sim gets it uncapped, with the cap as maxResist) and applies all-resistances to each element', () => {
    const ring1 = equip({
      baseId: 'emberRing', itemLevel: 84, rarity: 'rare', name: 'Kiln Heart', implicitValues: [20],
      affixes: [{ affixId: 'fireResistance', tier: 1, value: 36 }, { affixId: 'allResistances', tier: 1, value: 13 }],
    });
    const ring2 = equip({ baseId: 'emberRing', itemLevel: 1, rarity: 'normal', implicitValues: [15] });
    const d = rules.deriveStats(bareCharacter({ level: 30, equipment: { ring1, ring2 } }));
    // Uncapped in combat: the buffer rule lets the sim subtract the map penalty and Withered before capping at maxResist.
    expect(d.combat.resist.fire).toBeCloseTo(0.84, 10);
    expect(d.combat.maxResist).toBe(75);
    expect(d.combat.resist.cold).toBeCloseTo(0.13, 10);
    expect(d.combat.resist.lightning).toBeCloseTo(0.13, 10);
    expect(d.combat.resist.void).toBeCloseTo(0.13, 10);
    const fire = d.sections.find((s) => s.title === 'Defence')!.lines.find((l) => l.label === 'Fire Resistance')!;
    expect(fire.value).toBe('75%');
    expect(fire.breakdown.join(' ')).toContain('84% uncapped');
  });

  it('applies local armour and evasion properties', () => {
    const coat = equip({ baseId: 'rivetedCoat', itemLevel: 20, rarity: 'normal', implicitValues: [50] });
    const d = rules.deriveStats(bareCharacter({ level: 12, equipment: { chest: coat } }));
    // Armour property floor(18 + 1 × 20) + implicit 50 = 88.
    expect(d.combat.armor).toBe(88);
  });

  it('caps the chance to evade at 75%', () => {
    const d = rules.deriveStats(bareCharacter({ level: 60, allocated: { str: 0, dex: 2000, int: 0 } }));
    expect(d.combat.evasion).toBe(0.75);
  });

  it('resolves cast speed, projectile speed and critical strike chance into the skill runtime', () => {
    const tome = equip({ baseId: 'runedTome', itemLevel: 10, rarity: 'normal', implicitValues: [10] });
    const wand = equip({
      baseId: 'glassboneWand', itemLevel: 40, rarity: 'magic', implicitValues: [10, 3],
      affixes: [{ affixId: 'critChance', tier: 5, value: 30 }],
    });
    const ch = bareCharacter({ level: 12, equipment: { mainHand: wand, offHand: tome } });
    const lance = runtime(ch, 'emberLance');
    expect(lance.castTime).toBeCloseTo(0.42 / 1.1, 10);
    expect(lance.projectileSpeed).toBeCloseTo(420 * 1.1, 10);
    expect(lance.critChance).toBeCloseTo((6 * 1.3) / 100, 10);
    expect(lance.critMultiplier).toBe(1.5);
  });

  it('adds flat critical strike chance before increases (Cinder Orb)', () => {
    const orb = equip({ baseId: 'cinderOrb', itemLevel: 20, rarity: 'normal', implicitValues: [5] });
    const lance = runtime(bareCharacter({ level: 12, equipment: { offHand: orb } }), 'emberLance');
    expect(lance.critChance).toBeCloseTo(0.11, 10);
  });

  it('computes skill damage with the GAME_SPEC §4 formula', () => {
    // Level 20, int 30 + floor(1.2 × 19) = 52 → 10% spell damage. Sceptre +20% spell damage; ring +10 added.
    const sceptre = equip({ baseId: 'emberSceptre', itemLevel: 30, rarity: 'normal', implicitValues: [20] });
    const ring = equip({
      baseId: 'stormLoop', itemLevel: 40, rarity: 'magic', implicitValues: [15],
      affixes: [{ affixId: 'addedSpellDamage', tier: 5, value: 10 }, { affixId: 'lightningResistance', tier: 10, value: 6 }],
    });
    const ch = bareCharacter({ level: 20, equipment: { mainHand: sceptre, ring1: ring } });
    const sceptreSpell = Math.floor(2 + 0.09 * 30);
    const power = SP + SP_LEVEL * 19 + 10 + sceptreSpell;
    const inc = 1 + (10 + 20) / 100;
    const nova = rules.skillSheet({ ...ch, skillRanks: { ...ch.skillRanks, emberNova: 1 } }, 'emberNova');
    expect(nova.runtime.damage).toBeCloseTo(power * 1.0 * inc, 8); // Nova rank 1 effectiveness 1.0
    expect(runtime(ch, 'emberLance').damage).toBeCloseTo(power * 1.0 * inc, 8);
  });

  it('adds element damage and elemental damage only to matching skills', () => {
    const amulet = equip({
      baseId: 'cinderPendant', itemLevel: 48, rarity: 'magic', implicitValues: [12],
      affixes: [{ affixId: 'coldDamage', tier: 4, value: 35 }],
    });
    const ring = equip({
      baseId: 'emberRing', itemLevel: 56, rarity: 'magic', implicitValues: [15],
      affixes: [{ affixId: 'elementalDamage', tier: 3, value: 20 }],
    });
    const ch = bareCharacter({ equipment: { amulet, ring1: ring }, skillRanks: {
      emberLance: 1, emberNova: 3, flameWave: 0, rimeShards: 1, arcChain: 0, riftStep: 0, cinderWard: 0,
    } });
    const shards = rules.skillSheet(ch, 'rimeShards').runtime;
    const lance = rules.skillSheet(ch, 'emberLance').runtime;
    expect(shards.damage).toBeCloseTo(SP * 0.55 * (1 + (6 + 35 + 20) / 100), 10);
    expect(lance.damage).toBeCloseTo(SP * 1.0 * (1 + (6 + 20) / 100), 10);
  });

  it('grants unique flags to the player and to the matching skill', () => {
    const spark = unique('thePatientSpark');
    const echo = unique('echoOfTheMatriarch');
    const walkers = unique('cinderwalkers');
    const ch = bareCharacter({
      level: 30, equipment: { mainHand: spark, amulet: echo, boots: walkers },
      skillRanks: { emberLance: 1, emberNova: 1, flameWave: 0, rimeShards: 0, arcChain: 0, riftStep: 0, cinderWard: 0 },
    });
    const rt = rules.playerRuntime(ch, null);
    expect([...rt.stats.flags].sort()).toEqual(['fireTrail', 'lancePierceAll', 'novaEcho']);
    expect(rt.skills.find((s) => s.id === 'emberLance')!.flags).toEqual(['pierceAll']);
    expect(rt.skills.find((s) => s.id === 'emberNova')!.flags).toEqual(['echo']);
    // Patient Spark: 15% reduced cast speed.
    expect(rt.skills.find((s) => s.id === 'emberLance')!.castTime).toBeCloseTo(0.42 / 0.85, 10);
    const d = rules.deriveStats(ch);
    expect(d.sections.at(-1)!.title).toBe('Unique Effects');
    expect(rules.skillSheet(ch, 'emberLance').lines).toContain('Pierces every enemy in its path (The Patient Spark)');
  });

  it('Ruinheart Band adds a projectile and increases damage taken', () => {
    const band = unique('ruinheartBand');
    const ch = bareCharacter({
      level: 30, equipment: { ring1: band },
      skillRanks: { emberLance: 1, emberNova: 1, flameWave: 0, rimeShards: 0, arcChain: 0, riftStep: 0, cinderWard: 0 },
    });
    const rt = rules.playerRuntime(ch, null);
    expect(rt.stats.damageTaken).toBeCloseTo(1.12, 10);
    expect(rt.skills.find((s) => s.id === 'emberNova')!.projectiles).toBe(13);
    expect(rt.skills.find((s) => s.id === 'emberLance')!.projectiles).toBe(2);
  });

  it('reports gear luck', () => {
    const amulet = equip({
      baseId: 'cinderPendant', itemLevel: 68, rarity: 'magic', implicitValues: [12],
      affixes: [{ affixId: 'itemRarity', tier: 2, value: 20 }, { affixId: 'itemQuantity', tier: 3, value: 10 }],
    });
    const d = rules.deriveStats(bareCharacter({ equipment: { amulet } }));
    expect(d.itemRarity).toBe(20);
    expect(d.itemQuantity).toBe(10);
  });
});

describe('the Skills section', () => {
  it('headlines sustained DPS, adds the per-cast total for multi-hit skills, and explains both', () => {
    const ch = bareCharacter({
      unspentSkillPoints: 0,
      skillRanks: { emberLance: 1, emberNova: 3, flameWave: 0, rimeShards: 1, arcChain: 0, riftStep: 0, cinderWard: 0 },
      loadout: ['emberLance', 'emberNova', 'rimeShards', null, null, null],
    });
    const skills = rules.deriveStats(ch).sections.find((s) => s.title === 'Skills')!.lines;
    const byName = new Map(skills.map((l) => [l.label, l]));
    const lance = rules.skillSheet(ch, 'emberLance');
    expect(byName.get('Ember Lance (rank 1)')!.value).toBe(`${Math.round(lance.dps!)} DPS`);

    const nova = byName.get('Ember Nova (rank 3)')!;
    const novaSheet = rules.skillSheet(ch, 'emberNova');
    const rt = novaSheet.runtime;
    const perCast = rt.damage * (1 + rt.critChance * (rt.critMultiplier - 1)) * 12;
    expect(nova.value).toBe(`${novaSheet.dps!.toFixed(1)} DPS · ${Math.round(perCast)} per cast`);
    expect(nova.breakdown).toContain(`${Math.round(perCast)} damage per cast if all 12 flames hit`);
    expect(nova.breakdown.some((l) => l.startsWith('Against a single target:') && l.endsWith('(one hit per cast reaches it)'))).toBe(true);

    // Rime Shards costs more Focus than regeneration returns: the headline is the sustained number.
    const shards = byName.get('Rime Shards (rank 1)')!;
    const shardSheet = rules.skillSheet(ch, 'rimeShards');
    const sustained = shardSheet.dps! * Math.min(1, (4.4 * 0.34) / 8);
    expect(shards.value).toBe(`${sustained.toFixed(1)} DPS · ${Math.round(shardSheet.runtime.damage * (1 + 0.08 * 0.5) * 3)} per cast`);
    expect(shards.breakdown.some((l) => l.startsWith('Your 4.4 Focus per second sustains 19%'))).toBe(true);
  });
});

describe('map penalties apply only inside the map', () => {
  it('uses the current map level for evasion in both the runtime and sheet, returning to the hideout reference afterwards', () => {
    const ch = bareCharacter();
    const home = rules.deriveStats(ch);
    // The same naked character has rating 48 in every map; only the opposing monster level changes.
    let previous = 1;
    for (const [tier, monsterLevel] of [[1, 4], [2, 10], [15, 88]]) {
      const setup = setupFor(map('ashenForge', tier), ch);
      const sheet = rules.deriveStats(ch, setup);
      const runtime = rules.playerRuntime(ch, setup);
      expect(setup.monsterLevel).toBe(monsterLevel);
      expect(runtime.stats.evasion).toBeCloseTo(48 / (48 + 30 * monsterLevel), 10);
      expect(sheet.combat.evasion).toBe(runtime.stats.evasion);
      expect(runtime.stats.evasion).toBeLessThan(previous);
      const evasion = sheet.sections.find((s) => s.title === 'Defence')!.lines.find((l) => l.label === 'Chance to Evade')!;
      expect(evasion.breakdown).toContain(`Against monster level ${monsterLevel}: 30 per monster level`);
      previous = runtime.stats.evasion;
    }
    expect(rules.deriveStats(ch)).toEqual(home);
    expect(rules.playerRuntime(ch, null).stats.evasion).toBeCloseTo(48 / (48 + 300), 10);
  });

  it('deriveStats(ch, setup) shows the in-map sheet the sim actually uses', () => {
    const ch = bareCharacter();
    const m = map('ashenForge', 1, { mods: [{ modId: 'hexed', value: 100 }, { modId: 'exhausting', value: 100 }] });
    const setup = setupFor(m, ch);
    const inMap = rules.deriveStats(ch, setup);
    expect(inMap.combat).toEqual(rules.playerRuntime(ch, setup).stats);
    const fire = inMap.sections.find((s) => s.title === 'Defence')!.lines.find((l) => l.label === 'Fire Resistance')!;
    expect(fire.value).toBe('−20%');
    expect(fire.breakdown[0]).toBe('−20% from Hexed (map)');
    const regen = inMap.sections.find((s) => s.title === 'Resources')!.lines.find((l) => l.label === 'Focus Regeneration')!;
    expect(regen.breakdown).toContain('40% reduced from Exhausting (map)');
    // No setup (or null) is the hideout sheet; the deprecated alias agrees.
    expect(rules.deriveStats(ch, null)).toEqual(rules.deriveStats(ch));
    expect(deriveRunStats(ch, setup)).toEqual(inMap);
    expect(deriveRunStats(ch, null)).toEqual(rules.deriveStats(ch));
  });

  it('Hexed lowers resistances and Exhausting lowers focus regeneration', () => {
    const ch = bareCharacter();
    const m = map('ashenForge', 1, { mods: [{ modId: 'hexed', value: 100 }, { modId: 'exhausting', value: 100 }] });
    const setup = setupFor(m, ch);
    const inMap = rules.playerRuntime(ch, setup).stats;
    const home = rules.playerRuntime(ch, null).stats;
    expect(inMap.resist.fire).toBeCloseTo(-0.2, 10);
    expect(inMap.resist.void).toBeCloseTo(-0.2, 10);
    expect(inMap.focusRegen).toBeCloseTo(home.focusRegen * 0.6, 10);
    expect(rules.deriveStats(ch).combat.resist.fire).toBe(0);
  });

  it('Unravelling (corruption) stacks with Hexed and the penalty survives gear resistances', () => {
    const ring1 = equip({ baseId: 'emberRing', itemLevel: 10, rarity: 'normal', implicitValues: [18] });
    const ch = bareCharacter({ equipment: { ring1 } });
    const m: MapItem = { ...map('ashenForge', 2), corrupted: true, mods: [{ modId: 'hexed', value: 100 }, { modId: 'unravelling', value: 100, corrupted: true }] };
    const d = rules.deriveStats(ch, setupFor(m, ch));
    expect(d.combat.resist.fire).toBeCloseTo(0.18 - 0.5, 10);
    expect(d.combat.resist.cold).toBeCloseTo(-0.5, 10);
  });

  it('adds your personal luck in that map to the Luck section; itemQuantity / itemRarity stay gear-only', () => {
    const amulet = equip({
      baseId: 'cinderPendant', itemLevel: 68, rarity: 'magic', implicitValues: [12],
      affixes: [{ affixId: 'itemRarity', tier: 2, value: 20 }, { affixId: 'itemQuantity', tier: 3, value: 10 }],
    });
    const ch = bareCharacter({ equipment: { amulet } });
    const setup = setupFor(map('rimedOssuary', 3, { quality: 8 }), ch);
    const home = rules.deriveStats(ch);
    const inMap = rules.deriveStats(ch, setup);
    expect([inMap.itemQuantity, inMap.itemRarity]).toEqual([10, 20]);
    expect([home.itemQuantity, home.itemRarity]).toEqual([10, 20]);
    const luck = inMap.sections.find((s) => s.title === 'Luck')!.lines;
    // In a map the personal luck leads; the gear-only lines say so, so a +0% never reads as "your luck".
    expect(luck.map((l) => l.label)).toEqual(['Item Quantity in this Map', 'Item Rarity in this Map', 'Item Quantity from Gear', 'Item Rarity from Gear']);
    const personal = rules.lootLuck(setup, ch);
    // Rimed Ossuary: +15% rarity implicit, Tier 3 +10%, quality 8 quantity; gear +10 / +20.
    expect(personal).toEqual({ itemQuantity: 118, itemRarity: 145 });
    expect(luck[0].value).toBe('+18%');
    expect(luck[1].value).toBe('+45%');
    expect(luck[1].breakdown).toContain('Total 145% of the base rate');
    expect(luck[2].value).toBe('+10%');
    expect(luck[3].value).toBe('+20%');
    const homeLuck = home.sections.find((s) => s.title === 'Luck')!.lines;
    expect(homeLuck.map((l) => l.label)).toEqual(['Item Quantity from Gear', 'Item Rarity from Gear']);
  });
});

describe('compareWithEquipped', () => {
  it('compares against an empty slot first and signs deltas so that positive is better', () => {
    const ring1 = equip({ baseId: 'emberRing', itemLevel: 10, rarity: 'normal', implicitValues: [15] });
    const ch = bareCharacter({ equipment: { ring1 } });
    const candidate = equip({ baseId: 'rimeBand', itemLevel: 10, rarity: 'normal', implicitValues: [18] });
    const res = rules.compareWithEquipped(ch, candidate);
    expect(res).toHaveLength(1);
    expect(res[0].slot).toBe('ring2');
    expect(res[0].lines).toEqual([{ label: 'Cold Resistance', from: '0%', to: '18%', delta: 18 }]);
  });

  it('returns one entry per occupied slot it would replace', () => {
    const ring1 = equip({ baseId: 'emberRing', itemLevel: 10, rarity: 'normal', implicitValues: [15] });
    const ring2 = equip({ baseId: 'stormLoop', itemLevel: 10, rarity: 'normal', implicitValues: [16] });
    const ch = bareCharacter({ level: 30, equipment: { ring1, ring2 } });
    const res = rules.compareWithEquipped(ch, unique('ruinheartBand'));
    expect(res.map((r) => r.slot)).toEqual(['ring1', 'ring2']);
    const lines = res[0].lines;
    expect(lines.find((l) => l.label === 'Fire Resistance')!.delta).toBe(-15);
    const taken = lines.find((l) => l.label === 'Damage Taken')!;
    expect(taken).toMatchObject({ from: '100%', to: '112%' });
    expect(taken.delta).toBeLessThan(0);
    expect(lines.find((l) => l.label === 'Ember Lance DPS')).toBeUndefined(); // single-target: +1 projectile is not more single-target damage
    expect(lines.find((l) => l.label === 'Ember Lance Projectiles')).toMatchObject({ from: 'None', to: '2' });
  });

  it('shows offence changes the skill lines alone would hide', () => {
    const ch = bareCharacter({ level: 10 });
    const tome = equip({ baseId: 'runedTome', itemLevel: 20, rarity: 'normal', implicitValues: [8] });
    const lines = rules.compareWithEquipped(ch, tome)[0].lines;
    expect(lines.find((l) => l.label === 'Cast Speed')).toEqual({ label: 'Cast Speed', from: '+0%', to: '+8%', delta: 8 });
    expect(lines.find((l) => l.label === 'Ember Lance DPS')!.delta).toBeGreaterThan(0);

    const amulet = equip({
      baseId: 'cinderPendant', itemLevel: 60, rarity: 'rare', implicitValues: [12],
      affixes: [{ affixId: 'area', tier: 3, value: 18 }, { affixId: 'cooldownRecovery', tier: 3, value: 11 }],
    });
    const byLabel = new Map(rules.compareWithEquipped(ch, amulet)[0].lines.map((l) => [l.label, l]));
    expect(byLabel.get('Area of Effect')).toMatchObject({ from: '+0%', to: '+18%', delta: 18 });
    expect(byLabel.get('Cooldown Recovery')).toMatchObject({ from: '+0%', to: '+11%', delta: 11 });
    expect(byLabel.get('Maximum Focus')!.delta).toBe(12);

    const ring = equip({
      baseId: 'emberRing', itemLevel: 56, rarity: 'rare', implicitValues: [15],
      affixes: [{ affixId: 'addedSpellDamage', tier: 5, value: 10 }, { affixId: 'elementalDamage', tier: 3, value: 20 }],
    });
    const ringLines = new Map(rules.compareWithEquipped(ch, ring)[0].lines.map((l) => [l.label, l]));
    const power = SP + SP_LEVEL * 9;
    expect(ringLines.get('Spell Power')).toMatchObject({ delta: 10 });
    expect(ringLines.get('Spell Power')!.to).toBe(String(power + 10).replace(/\.0$/, ''));
    expect(ringLines.get('Cold Skill Damage')).toMatchObject({ delta: 20 });
    // Unchanged numbers never show.
    expect(ringLines.has('Cast Speed')).toBe(false);
  });

  it('shows DPS and unique effects changes', () => {
    const ch = bareCharacter({ level: 20 });
    const res = rules.compareWithEquipped(ch, unique('thePatientSpark', 20));
    const labels = res[0].lines.map((l) => l.label);
    expect(labels).toContain('Ember Lance DPS');
    expect(res[0].lines.find((l) => l.label === 'Ember Lance pierces all targets')).toMatchObject({ from: 'No', to: 'Yes', delta: 1 });
  });

  it('ignores non-equipment and already-equipped items', () => {
    const ch = rules.createCharacter('A', 1);
    expect(rules.compareWithEquipped(ch, ch.equipment.mainHand!)).toEqual([]);
    expect(rules.compareWithEquipped(ch, ch.backpack.entries[0].item)).toEqual([]);
  });

  it('never mutates the character', () => {
    const ch = rules.createCharacter('A', 1);
    const snapshot = JSON.stringify(ch);
    rules.compareWithEquipped(ch, unique('cinderwalkers'));
    rules.deriveStats(ch);
    expect(JSON.stringify(ch)).toBe(snapshot);
    void expectOk;
  });
});
