// Character creation (starting kit), experience, levels and attribute points.
import { describe, expect, it } from 'vitest';
import type { CurrencyStack, EquipmentItem, MapItem } from '../../src/contracts/items';
import { recordDeath, rules, validateCharacterName } from '../../src/game';
import { getAffix } from '../../src/data/items';
import { bareCharacter, expectErr, expectOk } from './fixtures';

describe('createCharacter', () => {
  const ch = rules.createCharacter('  Ilsa   the  Pale ', 42);

  it('starts a level 1 Sorceress with the spec numbers', () => {
    expect(ch).toMatchObject({
      name: 'Ilsa the Pale', classId: 'sorceress', level: 1, xp: 0, unspentAttributePoints: 0,
      allocated: { str: 0, dex: 0, int: 0 }, unspentSkillPoints: 1, mapDevice: null, createdAt: 0, updatedAt: 0,
    });
    expect(ch.skillRanks).toEqual({ emberLance: 1, emberNova: 0, flameWave: 0, rimeShards: 0, arcChain: 0, riftStep: 0, cinderWard: 0 });
    expect(ch.loadout).toEqual(['emberLance', null, null, null, null, null]);
    expect(ch.stash.length).toBeGreaterThanOrEqual(1);
  });

  it('equips a magic item level 1 Ashwood Wand with a fire affix and a normal Ashen Robe', () => {
    const wand = ch.equipment.mainHand as EquipmentItem;
    expect(wand).toMatchObject({ baseId: 'ashwoodWand', itemLevel: 1, rarity: 'magic', stability: 8, maxStability: 8 });
    expect(wand.affixes).toHaveLength(1);
    expect(getAffix(wand.affixes[0].affixId)?.tags).toContain('fire');
    expect(wand.history.length).toBe(1);
    const robe = ch.equipment.chest as EquipmentItem;
    expect(robe).toMatchObject({ baseId: 'ashenRobe', rarity: 'normal', affixes: [] });
  });

  it('packs the exact starting currency and maps', () => {
    const currency: Record<string, number> = {};
    const maps: MapItem[] = [];
    for (const e of ch.backpack.entries) {
      if (e.item.kind === 'currency') currency[e.item.currencyId] = (currency[e.item.currencyId] ?? 0) + (e.item as CurrencyStack).count;
      if (e.item.kind === 'map') maps.push(e.item);
    }
    expect(currency).toEqual({ scrap: 10, kindling: 4, essenceEmber: 2, reforge: 1, solvent: 1, seal: 1, mapDust: 3, threatGlyph: 2 });
    // nobody has a second area at creation: the kit is three Tier 1 Cinder Crossing maps
    expect(maps.map((m) => [m.areaId, m.baseId, m.tier, m.rarity])).toEqual(Array(3).fill(['cinderCrossing', 'ashenForge', 1, 'normal']));
  });

  it('loads two Life Flask slots and one Focus Flask slot with 3 charges each', () => {
    expect(ch.belt).toEqual([
      { flaskId: 'lifeFlask', count: 3 }, { flaskId: 'lifeFlask', count: 3 }, { flaskId: 'focusFlask', count: 3 }, null,
    ]);
  });

  it('mints unique uids and keeps nextUid ahead of them', () => {
    const uids = [...ch.backpack.entries.map((e) => e.item.uid), ch.equipment.mainHand!.uid, ch.equipment.chest!.uid];
    expect(new Set(uids).size).toBe(uids.length);
    for (const u of uids) expect(parseInt(u.slice(1), 36)).toBeLessThan(ch.nextUid);
  });

  it('is deterministic in (name, seed)', () => {
    expect(rules.createCharacter('  Ilsa   the  Pale ', 42)).toEqual(ch);
    const other = rules.createCharacter('Ilsa the Pale', 43);
    expect(other.id).not.toBe(ch.id);
    expect(other.rngState).not.toBe(ch.rngState);
  });

  it('falls back to a default name (lenient: old saves), cut to 16 characters', () => {
    expect(rules.createCharacter('   ', 1).name).toBe('Sorceress');
    expect(rules.createCharacter('x'.repeat(50), 1).name).toHaveLength(16);
  });
});

describe('validateCharacterName (new characters, server-wide names of 3–16 characters)', () => {
  it('accepts ASCII names that start with a letter', () => {
    for (const name of ['Ilsa', 'Ilsa the Pale', 'Kael-9', "O'Rourke", 'ash_walker', 'Abc', 'A'.repeat(16), '  Ilsa   Pale  ']) {
      expect(validateCharacterName(name), name).toBeNull();
    }
  });

  it('explains what is wrong', () => {
    expect(validateCharacterName('Al')).toBe('Character names need at least 3 characters.');
    expect(validateCharacterName('   A  ')).toBe('Character names need at least 3 characters.');
    expect(validateCharacterName('A'.repeat(17))).toBe('Character names can be at most 16 characters.');
    expect(validateCharacterName('9lives')).toBe('Character names must start with a letter.');
    expect(validateCharacterName(' _Ilsa')).toBe('Character names must start with a letter.');
    expect(validateCharacterName('Ilsa!')).toBe('Use only letters A-Z, digits, spaces, hyphens, apostrophes and underscores.');
    expect(validateCharacterName('Ílsa')).toBe('Use only letters A-Z, digits, spaces, hyphens, apostrophes and underscores.');
    expect(validateCharacterName('Ilsa\u0000Pale')).toBeNull(); // control characters are dropped, like the stored name
    for (const bad of [null, undefined, 42, {}, []]) expect(validateCharacterName(bad)).toBe('Choose a name for your character.');
  });

  it('validates exactly the form createCharacter stores', () => {
    const name = '  Ilsa   the  Pale ';
    expect(validateCharacterName(name)).toBeNull();
    expect(rules.createCharacter(name, 1).name).toBe('Ilsa the Pale');
    expect(validateCharacterName(rules.createCharacter(name, 1).name)).toBeNull();
  });
});

describe('experience', () => {
  it('follows floor(90 × L^1.75)', () => {
    expect(rules.xpToNext(1)).toBe(90);
    expect(rules.xpToNext(2)).toBe(Math.floor(90 * 2 ** 1.75));
    expect(rules.xpToNext(10)).toBe(5061);
    expect(rules.xpToNext(30)).toBeGreaterThan(34000);
    expect(rules.xpToNext(30)).toBeLessThan(35000);
  });

  it('levels up with +3 attribute points and +1 skill point per level, carrying XP over', () => {
    const ch = bareCharacter({ level: 1, xp: 50 });
    const need = rules.xpToNext(1) - 50 + rules.xpToNext(2) + 7;
    const { character, levelsGained } = rules.grantXp(ch, need);
    expect(levelsGained).toBe(2);
    expect(character.level).toBe(3);
    expect(character.xp).toBe(7);
    expect(character.unspentAttributePoints).toBe(6);
    expect(character.unspentSkillPoints).toBe(2);
    expect(ch.level).toBe(1); // input untouched
  });

  it('accumulates without levelling below the threshold', () => {
    const r = rules.grantXp(bareCharacter(), 10);
    expect(r.levelsGained).toBe(0);
    expect(r.character.xp).toBe(10);
  });

  it('stops at the level cap (80)', () => {
    const r = rules.grantXp(bareCharacter({ level: 79, xp: 0 }), 1e12);
    expect(r.character.level).toBe(80);
    expect(r.levelsGained).toBe(1);
    expect(r.character.xp).toBe(0);
    const again = rules.grantXp(r.character, 5000);
    expect(again.levelsGained).toBe(0);
    expect(again.character.level).toBe(80);
    expect(again.character.xp).toBe(0);
  });

  it('ignores non-positive and non-finite amounts', () => {
    const ch = bareCharacter({ xp: 5 });
    for (const v of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(rules.grantXp(ch, v)).toEqual({ character: ch, levelsGained: 0 });
    }
  });
});

describe('attributes', () => {
  it('spends one point', () => {
    const ch = bareCharacter({ unspentAttributePoints: 2 });
    const next = expectOk(rules.allocateAttribute(ch, 'int'));
    expect(next.allocated).toEqual({ str: 0, dex: 0, int: 1 });
    expect(next.unspentAttributePoints).toBe(1);
    expect(rules.deriveStats(next).attributes.int).toBe(rules.deriveStats(ch).attributes.int + 1);
  });

  it('refuses without points', () => {
    expect(expectErr(rules.allocateAttribute(bareCharacter(), 'str'))).toMatch(/No attribute points/);
  });
});

describe('run log and flasks', () => {
  it('records cleared and failed runs (deaths are logged per death, not per map)', () => {
    let ch = bareCharacter();
    ch = rules.applyRunEnd(ch, { result: 'cleared', tier: 4, kills: 300, seconds: 600, raresFound: 2, uniquesFound: 1 });
    ch = rules.applyRunEnd(ch, { result: 'failed', tier: 6, kills: 100, seconds: 120.5, raresFound: 0, uniquesFound: 0 });
    ch = rules.applyRunEnd(ch, { result: 'abandoned', tier: 2, kills: 0, seconds: 10, raresFound: 0, uniquesFound: 0 });
    expect(ch.stats).toEqual({
      mapsCompleted: 1, mapsFailed: 2, highestTierCompleted: 4, kills: 400, deaths: 0,
      raresFound: 2, uniquesFound: 1, itemsCrafted: 0, playSeconds: 730.5,
    });
  });

  it('logs every death: online a player can die, walk back in and die again in one map', () => {
    const start = bareCharacter();
    let ch = recordDeath(start);
    ch = recordDeath(ch);
    expect(ch.stats.deaths).toBe(2);
    expect(start.stats.deaths).toBe(0);
    ch = rules.applyRunEnd(ch, { result: 'cleared', tier: 1, kills: 40, seconds: 500, raresFound: 0, uniquesFound: 0 });
    expect(ch.stats).toMatchObject({ deaths: 2, mapsCompleted: 1 });
  });

  it('consumes one flask charge and keeps the slot assigned at 0', () => {
    let ch = bareCharacter({ belt: [{ flaskId: 'lifeFlask', count: 1 }, null, null, null] });
    ch = rules.consumeFlask(ch, 0);
    expect(ch.belt[0]).toEqual({ flaskId: 'lifeFlask', count: 0 });
    expect(rules.consumeFlask(ch, 0)).toBe(ch);
    expect(rules.consumeFlask(ch, 3)).toBe(ch);
    expect(rules.consumeFlask(ch, 9)).toBe(ch);
  });
});
