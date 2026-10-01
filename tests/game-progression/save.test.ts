// Persistence: round-trips, garbage, migration and field-by-field normalisation.
import { describe, expect, it } from 'vitest';
import type { CharacterSave, EquipmentItem, Item, MapItem, SaveGame } from '../../src/contracts/items';
import { CURRENCY_STASH_MAX, MAP_STASH_CAPACITY, MAX_STASH_TABS, STASH_TAB_SIZE } from '../../src/contracts/items';
import { createRng } from '../../src/core/rng';
import { rules } from '../../src/game';
import { normalizeCharacter, normalizeCharacterReport } from '../../src/game/progression';
import { SAVE_VERSION } from '../../src/data/progression';
import { expectOk, map } from './fixtures';

function allUids(ch: CharacterSave): string[] {
  return [
    ...ch.backpack.entries.map((e) => e.item.uid),
    ...ch.stash.flatMap((t) => t.grid.entries.map((e) => e.item.uid)),
    ...Object.values(ch.equipment).map((e) => e!.uid),
    ...(ch.mapDevice ? [ch.mapDevice.uid] : []),
    ...ch.mapStash.map((m) => m.uid),
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
  // The special stash tabs: a deposited stack, a withdrawn one, and a filed map.
  const scrap = ch.backpack.entries.find((e) => e.item.kind === 'currency' && e.item.currencyId === 'scrap')!.item;
  ch = expectOk(rules.moveItem(ch, scrap.uid, { kind: 'currencyStash' }));
  ch = expectOk(rules.quickMove(ch, 'cstash:scrap', { stashTab: 'currency', count: 2 }));
  ch = expectOk(rules.moveItem(ch, other.uid, { kind: 'mapStash' }));
  expect(ch.currencyStash.scrap).toBeGreaterThan(0);
  expect(ch.mapStash).toHaveLength(1);
  return { ...ch, createdAt: 1700000000000, updatedAt: 1700000100000 };
}

describe('newSave / serializeSave / parseSave', () => {
  it('migrates old equipment once, preserving roll quality, identity and craft protections', () => {
    const ch = rules.createCharacter('Legacy', 42);
    const old: EquipmentItem = {
      kind: 'equipment', uid: 'legacy-ring', baseId: 'emberRing', itemLevel: 40, rarity: 'rare', name: 'Old Flame',
      implicitValues: [18], stability: 3, maxStability: 7, scars: [{ scarId: 'frail', value: 6 }], history: ['A favourite ring'],
      affixes: [
        { affixId: 'life', tier: 4, value: 40, sealed: true },
        { affixId: 'fireResistance', tier: 7, value: 11, fractured: true },
        { affixId: 'castSpeed', tier: 5, value: 10, crafted: true },
      ],
    };
    ch.equipment.ring1 = old;
    ch.stash[0].grid.entries.push({ item: { ...old, uid: 'stored-ring' }, x: 0, y: 0 });
    const migrated = normalizeCharacter(ch)!;
    const ring = migrated.equipment.ring1!;
    expect(ring).toMatchObject({ uid: old.uid, name: old.name, affixVersion: 2, stability: 3, scars: old.scars, history: old.history });
    expect(ring.affixes).toEqual([
      { affixId: 'life', tier: 6, value: 27, sealed: true },
      { affixId: 'castSpeed', tier: 7, value: 7, crafted: true },
      { affixId: 'fireResistance', tier: 9, value: 11, fractured: true },
    ]);
    const stored = migrated.stash[0].grid.entries.find((e) => e.item.uid === 'stored-ring')!.item as EquipmentItem;
    expect(stored.affixes).toEqual(ring.affixes);
    expect(normalizeCharacter(JSON.parse(JSON.stringify(migrated)))).toEqual(migrated);
  });

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
  it('preserves an intentionally empty skill bar after saving and loading', () => {
    const ch = expectOk(rules.setLoadoutSlot(rules.createCharacter('Empty', 42), 0, null));
    const save = { ...rules.newSave(), characters: [ch] };
    expect(rules.parseSave(rules.serializeSave(save)).characters[0].loadout).toEqual([null, null, null, null, null, null]);
  });

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
    expect(ch.loadout).toEqual(['emberNova', null, null, 'riftStep', null, null]);
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
    expect(w.affixes).toEqual([{ affixId: 'fireDamage', tier: 10, value: 12, sealed: true }]);
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
      kind: 'equipment', affixVersion: 2, uid: 'r', baseId: 'emberRing', itemLevel: 60, rarity: 'rare', name: 'Grave Coil',
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

  it('gives a save from before the special stash tabs an empty Crafting Stash and Map Stash', () => {
    const old = JSON.parse(JSON.stringify(rules.createCharacter('Old', 3))) as Record<string, unknown>;
    delete old.currencyStash;
    delete old.mapStash;
    const ch = normalizeCharacter(old)!;
    expect(ch.currencyStash).toEqual({});
    expect(ch.mapStash).toEqual([]);
    expect(normalizeCharacter({ name: 'Bare' })).toMatchObject({ currencyStash: {}, mapStash: [] });
    const parsed = rules.parseSave(JSON.stringify({ version: 1, characters: [old], lastCharacterId: null }));
    expect(parsed.characters[0]).toMatchObject({ currencyStash: {}, mapStash: [] });
    for (const junk of [null, 7, 'x', [1, 2]]) {
      expect(normalizeCharacter({ name: 'J', currencyStash: junk, mapStash: junk })).toMatchObject({ currencyStash: {}, mapStash: [] });
    }
  });

  it('clamps Crafting Stash counts and drops unknown or empty slots', () => {
    const ch = normalizeCharacter({
      name: 'C',
      currencyStash: {
        scrap: 99999, kindling: 12.9, seal: -4, reforge: 0, voidNeedle: '7', mapDust: Number.NaN, gold: 50, constructor: 3,
        ['__proto__' as string]: 9, fractureCore: 1,
      },
    })!;
    expect(ch.currencyStash).toEqual({ scrap: CURRENCY_STASH_MAX, kindling: 12, fractureCore: 1 });
    expect(Object.getPrototypeOf(ch.currencyStash)).toBe(Object.prototype);
  });

  it('normalises the Map Stash: repairs maps, keeps uids unique, re-homes overflow and non-maps', () => {
    const maps = Array.from({ length: MAP_STASH_CAPACITY + 2 }, (_, i) => map('rimedOssuary', 2, { uid: `ms${i}` }));
    const raw = {
      name: 'M', nextUid: 2,
      backpack: { w: 12, h: 5, entries: [{ item: map('ashenForge', 1, { uid: 'ms0' }), x: 0, y: 0 }] },
      mapStash: [
        ...maps,
        { kind: 'currency', uid: 'cash', currencyId: 'scrap', count: 5 },
        { kind: 'map', uid: 'i9', baseId: 'ironColiseum', tier: 99, rarity: 'unique', mods: [], quality: -3, corrupted: false },
        { kind: 'map', uid: 'cstash:scrap', baseId: 'ashenForge', tier: 1, rarity: 'normal', mods: [], quality: 0, corrupted: false },
        { kind: 'map', baseId: 'nowhere', tier: 1 },
        'garbage',
      ],
    };
    const ch = normalizeCharacter(JSON.parse(JSON.stringify(raw)))!;
    expect(ch.mapStash).toHaveLength(MAP_STASH_CAPACITY);
    const uids = allUids(ch);
    expect(new Set(uids).size).toBe(uids.length);
    expect(uids.some((u) => u.startsWith('cstash:'))).toBe(false);
    // The backpack claimed "ms0" first, so the stash copy was re-minted; the map beyond the cap and the stray
    // currency moved to the backpack; the corrupt map (tier 99, bad rarity) was repaired, the unknown one dropped.
    expect(ch.mapStash[0].uid).not.toBe('ms0');
    expect(ch.mapStash.every((m) => m.kind === 'map')).toBe(true);
    const loose = ch.backpack.entries.map((e) => e.item);
    expect(loose.some((i) => i.kind === 'currency' && i.count === 5)).toBe(true);
    const repaired = [...ch.mapStash, ...loose].find((i) => i.uid === 'i9') as MapItem;
    expect(repaired).toMatchObject({ tier: 15, rarity: 'normal', quality: 0 });
    expect(ch.nextUid).toBeGreaterThan(9);
  });

  it('re-homes what lost its place into the special tabs and Recovered tabs, and reports only what fits nowhere', () => {
    // Every grid full of maps, plus stray items (outside the backpack) that need a new home.
    const fullGrid = (w: number, h: number, prefix: string) => ({
      w, h, entries: Array.from({ length: w * h }, (_, i) => ({ item: map('ashenForge', 1, { uid: `${prefix}${i}` }), x: i % w, y: Math.floor(i / w) })),
    });
    const stray = (item: Item) => ({ item, x: 40, y: 40 });
    const tabs = (n: number) => Array.from({ length: n }, (_, t) => ({ name: `T${t}`, grid: fullGrid(STASH_TAB_SIZE.w, STASH_TAB_SIZE.h, `t${t}-`) }));
    const straysOf = [
      stray({ kind: 'currency', uid: 'sc', currencyId: 'scrap', count: 30 }),
      stray({ kind: 'currency', uid: 'kn', currencyId: 'kindling', count: 12 }),
      stray(map('rimedOssuary', 4, { uid: 'm-stray' })),
    ];
    const raw = (tabCount: number, extra: Record<string, unknown> = {}) => JSON.parse(JSON.stringify({
      name: 'Full', nextUid: 1,
      backpack: { ...fullGrid(12, 5, 'b'), entries: [...fullGrid(12, 5, 'b').entries, ...straysOf] },
      stash: tabs(tabCount),
      ...extra,
    }));

    // Grids full: currency files into its Crafting Stash slot (as far as it has room), maps into the Map Stash.
    const a = normalizeCharacterReport(raw(2, { currencyStash: { scrap: CURRENCY_STASH_MAX - 10 } }))!;
    expect(a.lost).toEqual([]);
    expect(a.character.currencyStash).toEqual({ scrap: CURRENCY_STASH_MAX, kindling: 12 });
    expect(a.character.mapStash.map((m) => m.uid)).toEqual(['m-stray']);
    // The 20 Forge Scrap the full slot could not take opened a Recovered tab.
    expect(a.character.stash.map((t) => t.name)).toEqual(['T0', 'T1', 'Recovered']);
    expect(a.character.stash[2].grid.entries.map((e) => e.item)).toEqual([{ kind: 'currency', uid: 'sc', currencyId: 'scrap', count: 20 }]);

    // Everything full, every tab in use, a full Map Stash and full slots: only then is an item lost, and reported.
    const maps = Array.from({ length: MAP_STASH_CAPACITY }, (_, i) => map('ironColiseum', 2, { uid: `ms${i}` }));
    const b = normalizeCharacterReport(raw(MAX_STASH_TABS, { mapStash: maps, currencyStash: { scrap: CURRENCY_STASH_MAX } }))!;
    expect(b.character.stash).toHaveLength(MAX_STASH_TABS);
    expect(b.character.currencyStash).toEqual({ scrap: CURRENCY_STASH_MAX, kindling: 12 });
    expect(b.lost.map((i) => i.uid).sort()).toEqual(['m-stray', 'sc']);
    expect(normalizeCharacter(raw(MAX_STASH_TABS))).toEqual(normalizeCharacterReport(raw(MAX_STASH_TABS))!.character);
    // A normal save loses nothing.
    expect(normalizeCharacterReport(JSON.parse(JSON.stringify(livedIn())))!.lost).toEqual([]);
    expect(normalizeCharacterReport('not a character')).toBeNull();
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

  it("keeps Rook's wares state (optional, repaired field by field) and reads an older save without it", () => {
    const ch = rules.createCharacter('Wara', 9);
    expect('wares' in normalizeCharacter(ch)!).toBe(false);
    const wares = { rotation: 480, level: 9, rerolls: 2, sold: [3, 1, 3, 40, -2, 'x', 1.5], tier: 4, areas: ['cinderCrossing', 'nowhere', 'emberRoad', 'emberRoad'] };
    expect(normalizeCharacter({ ...ch, wares })!.wares).toEqual({ rotation: 480, level: 9, rerolls: 2, sold: [1, 3], tier: 4, areas: ['cinderCrossing', 'emberRoad'] });
    for (const broken of [null, 5, 'x', { rotation: 'soon', areas: ['cinderCrossing'] }, { rotation: 5, areas: [] }, { rotation: 5, areas: ['nowhere'] }]) {
      expect('wares' in normalizeCharacter({ ...ch, wares: broken })!).toBe(false);
    }
    expect(normalizeCharacter({ ...ch, wares: { ...wares, level: 9999, rerolls: -4, tier: 99 } })!.wares).toMatchObject({ rerolls: 0, tier: 15 });
    const again = normalizeCharacter(JSON.parse(JSON.stringify(normalizeCharacter({ ...ch, wares })!)))!;
    expect(again.wares).toEqual(normalizeCharacter({ ...ch, wares })!.wares);
  });
});
