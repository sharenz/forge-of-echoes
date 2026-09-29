// Persistence: round-trips, garbage, migration and field-by-field normalisation.
import { describe, expect, it } from 'vitest';
import type { CharacterSave, EquipmentItem, Item, MapItem, SaveGame } from '../../src/contracts/items';
import { createRng } from '../../src/core/rng';
import { rules } from '../../src/game';
import { normalizeCharacter } from '../../src/game/progression';
import { SAVE_VERSION } from '../../src/data/progression';
import { expectOk, map } from './fixtures';

function allUids(ch: CharacterSave): string[] {
  return [
    ...ch.backpack.entries.map((e) => e.item.uid),
    ...ch.stash.flatMap((t) => t.grid.entries.map((e) => e.item.uid)),
    ...Object.values(ch.equipment).map((e) => e!.uid),
    ...(ch.mapDevice ? [ch.mapDevice.uid] : []),
  ];
}

/** A lived-in character: levels, points, skills, crafted gear (a bench-crafted affix too), stash, device. */
function livedIn(): CharacterSave {
  let ch = rules.createCharacter('Vessa', 9);
  ch = rules.grantXp(ch, 20_000).character;
  ch = expectOk(rules.allocateAttribute(ch, 'int'));
  ch = expectOk(rules.rankUpSkill(ch, 'emberNova'));
  const kindling = ch.backpack.entries.find((e) => e.item.kind === 'currency' && e.item.currencyId === 'kindling')!.item;
  ch = expectOk(rules.applyCurrency(ch, kindling.uid, ch.equipment.chest!.uid)).character;
  ch = expectOk(rules.applyBenchRecipe(ch, ch.equipment.mainHand!.uid, 'bench:critChance')).character;
  expect(ch.equipment.mainHand!.affixes.some((a) => a.crafted)).toBe(true);
  const aMap = ch.backpack.entries.find((e) => e.item.kind === 'map')!.item;
  ch = expectOk(rules.moveItem(ch, aMap.uid, { kind: 'mapDevice' }));
  const other = ch.backpack.entries.find((e) => e.item.kind === 'map')!.item;
  ch = expectOk(rules.moveItem(ch, other.uid, { kind: 'stash', tab: 1, x: 3, y: 2 }));
  return { ...ch, createdAt: 1700000000000, updatedAt: 1700000100000 };
}

describe('newSave / serializeSave / parseSave', () => {
  it('creates an empty current-version save', () => {
    expect(rules.newSave()).toEqual({
      version: SAVE_VERSION, characters: [], lastCharacterId: null,
      settings: { masterVolume: 0.8, musicVolume: 0.6, sfxVolume: 0.8, screenShake: 0.7, showFps: false, autoAttack: false },
    });
  });

  it('round-trips a lived-in save exactly', () => {
    const ch = livedIn();
    const save: SaveGame = { ...rules.newSave(), characters: [ch, rules.createCharacter('Other', 10)], lastCharacterId: ch.id };
    const parsed = rules.parseSave(rules.serializeSave(save));
    expect(parsed).toEqual(save);
    expect(rules.parseSave(rules.serializeSave(parsed))).toEqual(save);
  });

  it('never throws on garbage and returns a fresh save', () => {
    const fresh = rules.newSave();
    for (const input of [null, '', '   ', '{', 'null', '42', '"text"', '[]', '[1,2]', '{"characters": 5}', 'undefined', '\u0000']) {
      expect(rules.parseSave(input), String(input)).toEqual(fresh);
    }
  });

  it('survives random structural damage', () => {
    const json = rules.serializeSave({ ...rules.newSave(), characters: [livedIn()] });
    const rng = createRng(2024);
    for (let i = 0; i < 300; i++) {
      const chars = json.split('');
      const edits = rng.int(1, 6);
      for (let k = 0; k < edits; k++) chars[rng.int(0, chars.length - 1)] = rng.pick(['"', '{', '}', ',', '0', '-', 'x', ':', '[', ']']);
      const out = rules.parseSave(chars.join(''));
      expect(out.version).toBe(SAVE_VERSION);
      for (const c of out.characters) expect(new Set(allUids(c)).size).toBe(allUids(c).length);
    }
  });

  it('keeps lastCharacterId only when it points at a character', () => {
    const ch = rules.createCharacter('A', 1);
    expect(rules.parseSave(JSON.stringify({ version: 1, characters: [ch], lastCharacterId: 'nope' })).lastCharacterId).toBeNull();
    expect(rules.parseSave(JSON.stringify({ version: 1, characters: [ch], lastCharacterId: ch.id })).lastCharacterId).toBe(ch.id);
  });

  it('clamps settings and migrates unversioned saves', () => {
    const out = rules.parseSave(JSON.stringify({ settings: { masterVolume: 3, musicVolume: -1, sfxVolume: 'x', showFps: 'yes', autoAttack: true } }));
    expect(out.version).toBe(SAVE_VERSION);
    expect(out.settings).toEqual({ masterVolume: 1, musicVolume: 0, sfxVolume: 0.8, screenShake: 0.7, showFps: false, autoAttack: true });
  });

  it('de-duplicates character ids', () => {
    const ch = rules.createCharacter('A', 1);
    const out = rules.parseSave(JSON.stringify({ version: 1, characters: [ch, ch] }));
    expect(out.characters.map((c) => c.id)).toEqual([ch.id, `${ch.id}-2`]);
  });
});

describe('normalizeCharacter', () => {
  it('rebuilds a minimal character from almost nothing', () => {
    const ch = normalizeCharacter({ name: 'Bare' })!;
    expect(ch).toMatchObject({ name: 'Bare', level: 1, xp: 0, classId: 'sorceress', mapDevice: null });
    expect(ch.skillRanks.emberLance).toBe(1);
    expect(ch.loadout).toEqual(['emberLance', null, null, null, null, null]);
    expect(ch.belt).toEqual([null, null, null, null]);
    expect(ch.stash.length).toBeGreaterThan(0);
    expect(normalizeCharacter('nope')).toBeNull();
    expect(normalizeCharacter([1, 2])).toBeNull();
  });

  it('clamps numbers and repairs the skill loadout', () => {
    const ch = normalizeCharacter({
      name: 'X', level: 999, xp: -5, unspentAttributePoints: -3, allocated: { str: 2.7, dex: 'a', int: 5 },
      skillRanks: { emberLance: 0, emberNova: 50, riftStep: 2, bogus: 3 },
      loadout: ['emberNova', 'emberNova', 'cinderWard', 'riftStep', 'bogus'],
    })!;
    expect(ch.level).toBe(60);
    expect(ch.xp).toBe(0);
    expect(ch.unspentAttributePoints).toBe(0);
    expect(ch.allocated).toEqual({ str: 2, dex: 0, int: 5 });
    expect(ch.skillRanks).toMatchObject({ emberLance: 1, emberNova: 20, riftStep: 2 });
    expect(ch.skillRanks).not.toHaveProperty('bogus');
    expect(ch.loadout).toEqual(['emberLance', 'emberNova', null, 'riftStep', null, null]);
  });

  it('drops unknown items and repairs broken ones', () => {
    const good = livedIn();
    const wand = good.equipment.mainHand!;
    const broken: EquipmentItem = {
      ...wand, uid: 'bad-affixes', rarity: 'normal', itemLevel: 500,
      affixes: [
        { affixId: 'fireDamage', tier: 99, value: 1000, sealed: true },
        { affixId: 'nonsense', tier: 1, value: 1 },
        { affixId: 'life', tier: 1, value: 70 }, // not allowed on wands
      ],
      implicitValues: [999],
      stability: 50,
    };
    const raw = {
      ...good,
      equipment: { mainHand: broken, offHand: { kind: 'equipment', baseId: 'noSuchBase' }, chest: { ...good.equipment.chest!, uid: 'robe' } },
      backpack: { w: 3, h: 1, entries: [
        { item: { kind: 'currency', uid: 'c1', currencyId: 'scrap', count: 500 }, x: 0, y: 0 },
        { item: { kind: 'currency', uid: 'c2', currencyId: 'gold', count: 5 }, x: 1, y: 0 },
        { item: { kind: 'flask', uid: 'f1', flaskId: 'lifeFlask', count: 0 }, x: 2, y: 0 },
        { item: 'junk', x: 3, y: 0 },
      ] },
    };
    const ch = normalizeCharacter(JSON.parse(JSON.stringify(raw)))!;
    const w = ch.equipment.mainHand!;
    expect(w.itemLevel).toBe(100);
    expect(w.affixes).toEqual([{ affixId: 'fireDamage', tier: 8, value: 12, sealed: true }]);
    expect(w.rarity).toBe('magic');
    expect(w.implicitValues).toEqual([16]);
    expect(w.stability).toBe(w.maxStability);
    expect(ch.equipment.offHand).toBeUndefined();
    expect(ch.backpack.w).toBe(12);
    expect(ch.backpack.h).toBe(5);
    const bp = ch.backpack.entries.map((e) => e.item);
    expect(bp.find((i) => i.uid === 'c1')).toMatchObject({ currencyId: 'scrap', count: 40 });
    expect(bp.some((i) => i.uid === 'c2' || i.uid === 'f1')).toBe(false);
  });

  it('keeps at most one crafted affix, never a fractured one, and only a real true flag', () => {
    const good = livedIn();
    const ring = (affixes: unknown[]) => ({
      kind: 'equipment', uid: 'r', baseId: 'emberRing', itemLevel: 60, rarity: 'rare', name: 'Grave Coil',
      implicitValues: [16], affixes, scars: [], stability: 5, maxStability: 7, history: ['Bench: added Hale (T4)'],
    });
    const load = (affixes: unknown[]) => normalizeCharacter(JSON.parse(JSON.stringify({ ...good, equipment: { ring1: ring(affixes) } })))!
      .equipment.ring1!.affixes;
    expect(load([
      { affixId: 'life', tier: 4, value: 35, crafted: true },
      { affixId: 'focus', tier: 5, value: 18, crafted: true },
      { affixId: 'castSpeed', tier: 4, value: 13, crafted: 'yes' },
    ])).toEqual([
      { affixId: 'life', tier: 4, value: 35, crafted: true },
      { affixId: 'focus', tier: 5, value: 18 },
      { affixId: 'castSpeed', tier: 4, value: 13 },
    ]);
    expect(load([
      { affixId: 'life', tier: 4, value: 35, crafted: true, fractured: true },
      { affixId: 'focus', tier: 5, value: 18, crafted: true, sealed: true },
    ])).toEqual([
      { affixId: 'life', tier: 4, value: 35, fractured: true },
      { affixId: 'focus', tier: 5, value: 18, sealed: true, crafted: true },
    ]);
  });

  it('re-places overlapping or out-of-bounds entries and re-mints duplicate uids', () => {
    const m1 = map('ashenForge', 3, { uid: 'dup' });
    const m2 = map('rimedOssuary', 4, { uid: 'dup' });
    const m3 = map('ironColiseum', 5, { uid: 'm3' });
    const raw = {
      name: 'Y', nextUid: 3,
      backpack: { w: 12, h: 5, entries: [{ item: m1, x: 0, y: 0 }, { item: m2, x: 0, y: 0 }, { item: m3, x: 40, y: 40 }] },
      equipment: { ring1: { ...rules.createCharacter('Q', 1).equipment.chest!, uid: 'i7' } },
    };
    const ch = normalizeCharacter(JSON.parse(JSON.stringify(raw)))!;
    const maps = ch.backpack.entries.filter((e) => e.item.kind === 'map');
    expect(maps).toHaveLength(3);
    const uids = allUids(ch);
    expect(new Set(uids).size).toBe(uids.length);
    // The robe could not stay in a ring slot: it moved to the backpack.
    expect(ch.equipment.ring1).toBeUndefined();
    expect(ch.backpack.entries.some((e) => e.item.uid === 'i7')).toBe(true);
    // Fresh uids never collide with existing minted ones.
    expect(ch.nextUid).toBeGreaterThan(7);
    const tiers = maps.map((e) => (e.item as MapItem).tier).sort();
    expect(tiers).toEqual([3, 4, 5]);
  });

  it('normalises maps: rarity from danger mods, limits, corruption', () => {
    const raw = {
      name: 'Z',
      mapDevice: {
        kind: 'map', uid: 'm', baseId: 'ashenForge', tier: 40, rarity: 'normal', quality: 99, corrupted: false,
        mods: [
          { modId: 'teeming', value: 100 }, { modId: 'teeming', value: 100 }, { modId: 'hexed', value: 104 },
          { modId: 'volcanic', value: 100 }, { modId: 'restless', value: 100 }, { modId: 'fortified', value: 100 },
          { modId: 'gilded', value: 100 }, { modId: 'bountiful', value: 100 }, { modId: 'seethingHorde', value: 100 }, { modId: 'wat', value: 1 },
        ],
      },
    };
    const m = normalizeCharacter(raw)!.mapDevice!;
    expect(m.tier).toBe(15);
    expect(m.quality).toBe(20);
    expect(m.rarity).toBe('rare');
    expect(m.mods.map((x) => x.modId)).toEqual(['teeming', 'restless', 'volcanic', 'hexed', 'gilded', 'seethingHorde']);
    expect(m.corrupted).toBe(true);
  });

  it('normalises uniques to their fixed mods', () => {
    const ch = rules.createCharacter('U', 5);
    const spark: Item = {
      kind: 'equipment', uid: 'spark', baseId: 'ashwoodWand', itemLevel: 30, rarity: 'unique', name: 'Whatever',
      uniqueId: 'thePatientSpark', implicitValues: [14], affixes: [{ affixId: 'unique:thePatientSpark:0', tier: 1, value: 999 }],
      scars: [{ scarId: 'frail', value: 5 }], stability: 5, maxStability: 5, history: [],
    };
    const out = normalizeCharacter({ ...ch, equipment: { mainHand: spark } })!.equipment.mainHand!;
    expect(out).toMatchObject({ rarity: 'unique', name: 'The Patient Spark', stability: 0, maxStability: 0, scars: [] });
    expect(out.affixes).toEqual([
      { affixId: 'unique:thePatientSpark:0', tier: 1, value: 45 },
      { affixId: 'unique:thePatientSpark:1', tier: 1, value: -15 },
    ]);
  });
});
