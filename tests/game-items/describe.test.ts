import { describe, expect, it } from 'vitest';
import { resolveStat } from '../../src/core/modifiers';
import { createRng } from '../../src/core/rng';
import { BASES, STAT_TEXT, getAffix } from '../../src/data/items';
import type { ModLineDef } from '../../src/data/items';
import { BASE_IDS, CURRENCY_IDS, EQUIPMENT_CURRENCY_IDS, FLASK_IDS, UNIQUE_IDS } from '../../src/contracts/content';
import type { EquipmentItem } from '../../src/contracts/items';
import {
  BASE_INFO, CURRENCY_INFO, FLASK_INFO, UNIQUE_INFO, affixChoices, applyBenchRecipe, beltUid, benchRecipes, canEquip,
  clearCraftedAffix, craftEquipment, craftPreview,
  currencyStack, describeCurrency, describeEquipment, describeFlask, equipmentCraftError, equipmentCraftPreview,
  flaskRecovery, flaskStack, formatDistribution, formatLine, formatRange, generateEquipment, generateUnique,
  itemDisplayName, itemLabel, itemModifiers, itemProperties, itemTone, moveItem, quickMove, renameStashTab,
} from '../../src/game/items';
import { currency, equip, flask, makeCharacter, map } from './fixtures';

const line = (stat: ModLineDef['stats'][number], mode: ModLineDef['mode'], text?: string): ModLineDef =>
  ({ stats: [stat], mode, ...(text ? { text } : {}) });

describe('text formatting', () => {
  it('renders polished, consistent modifier lines', () => {
    expect(formatLine(line('maxLife', 'flat'), 24)).toBe('+24 to maximum Life');
    expect(formatLine(line('fireDamage', 'increased'), 18)).toBe('18% increased Fire Damage');
    expect(formatLine(line('maxLife', 'increased'), -8)).toBe('8% reduced maximum Life');
    expect(formatLine(line('fireRes', 'flat'), -8)).toBe('−8% to Fire Resistance');
    expect(formatLine(line('fireRes', 'flat'), 27)).toBe('+27% to Fire Resistance');
    expect(formatLine(line('damageTaken', 'increased'), 12)).toBe('12% increased Damage taken');
    expect(formatLine(line('extraProjectiles', 'flat'), 1)).toBe('Skills fire 1 additional Projectile');
    expect(formatLine(line('extraProjectiles', 'flat'), 2)).toBe('Skills fire 2 additional Projectiles');
    expect(formatLine(line('addedSpellDamage', 'flat'), 7)).toBe('Adds 7 Spell Damage');
    expect(formatLine(line('critChance', 'flat'), 5)).toBe('+5% to Critical Strike Chance');
    expect(formatLine(line('spellDamage', 'more'), -10)).toBe('10% less Spell Damage');
    expect(formatLine({ stats: ['str', 'dex', 'int'], mode: 'flat', text: '{+v} to all Attributes' }, 9)).toBe('+9 to all Attributes');
  });

  it('has a template for every stat', () => {
    for (const [stat, t] of Object.entries(STAT_TEXT)) expect(Object.keys(t).length, stat).toBeGreaterThan(0);
  });

  it('formats roll ranges with an en dash and omits fixed values', () => {
    expect(formatRange(12, 16)).toBe('(12–16)');
    expect(formatRange(-15, -15)).toBeUndefined();
    expect(formatRange(-10, -6)).toBe('(6–10)');
  });

  it('formats distributions that always add up to exactly 100%', () => {
    // "<0.1%" marks a vanishing outcome that was rounded to zero steps.
    const parse = (s: string[]) => s.reduce((sum, x) => {
      const m = / (<?)([\d.]+)%$/.exec(x);
      return sum + (m && !m[1] ? Number(m[2]) : 0);
    }, 0);
    expect(formatDistribution([{ label: 'a', chance: 1 }, { label: 'b', chance: 1 }, { label: 'c', chance: 1 }]))
      .toEqual(['a 34%', 'b 33%', 'c 33%']);
    const rng = createRng(4);
    for (let i = 0; i < 300; i++) {
      const items = Array.from({ length: 1 + rng.int(0, 12) }, (_, k) => ({ label: `x${k}`, chance: rng.range(0.001, 5) }));
      expect(parse(formatDistribution(items))).toBeCloseTo(100, 6);
    }
    const tiny = formatDistribution([{ label: 'a', chance: 0.9999 }, { label: 'b', chance: 0.00001 }]);
    expect(tiny[1]).toBe('b <0.1%');
  });
});

describe('describeEquipment', () => {
  it('describes a normal base plainly', () => {
    const item = equip({ baseId: 'rivetedCoat', itemLevel: 20, rarity: 'normal', implicitValues: [50] });
    const d = describeEquipment(item);
    expect(d.title).toBe('Riveted Coat');
    expect(d.subtitle).toBeNull();
    expect(d.tone).toBe('normal');
    expect(d.iconId).toBe('icon/base/rivetedCoat');
    expect(d.classLabel).toBe('Body Armour');
    expect(d.size).toEqual({ w: 2, h: 3 });
    expect(d.headerLines).toEqual(['Item Level 20']);
    expect(d.implicits).toEqual([{ text: '+50 to Armour', kind: 'implicit', range: '(45–60)' }]);
    // 18 + 1.0 × 20 = 38 base, + 50 local implicit armour
    expect(d.properties).toEqual([{ label: 'Armour', value: '88' }]);
    expect(d.stability).toEqual({ current: 9, max: 9 });
    expect(d.requirements).toBe('Requires Level 12');
    expect(d.hint).toMatch(/Normal base/);
    expect(d.history).toBeUndefined();
  });

  it('names magic items from their affixes and rare items with a subtitle', () => {
    const magic = equip({
      baseId: 'ashwoodWand', itemLevel: 40, rarity: 'magic',
      affixes: [{ affixId: 'fireDamage', tier: 4, value: 33 }, { affixId: 'castSpeed', tier: 5, value: 10 }],
    });
    expect(itemDisplayName(magic)).toBe('Blazing Ashwood Wand of Haste');
    const dm = describeEquipment(magic);
    expect(dm.title).toBe('Blazing Ashwood Wand of Haste');
    expect(dm.subtitle).toBeNull();
    expect(dm.description).toMatch(/Ashwood/);

    const rare = equip({
      baseId: 'emberRing', itemLevel: 60, rarity: 'rare', name: 'Ember Bite',
      affixes: [{ affixId: 'life', tier: 4, value: 38 }, { affixId: 'coldResistance', tier: 3, value: 33 }],
    });
    const dr = describeEquipment(rare);
    expect(dr.title).toBe('Ember Bite');
    expect(dr.subtitle).toBe('Ember Ring');
    expect(dr.tone).toBe('rare');
  });

  it('describes affixes with tier, range, name, tags and craft marks — index-aligned with item.affixes', () => {
    const item = equip({
      baseId: 'ironVisor', itemLevel: 70, rarity: 'rare', name: 'Grave Coil',
      affixes: [
        { affixId: 'coldResistance', tier: 4, value: 28, fractured: true },
        { affixId: 'life', tier: 2, value: 55, sealed: true },
        { affixId: 'armourPercent', tier: 2, value: 60 },
      ],
      scars: [{ scarId: 'frail', value: 7 }],
      stability: 3,
      history: ['Dropped in Rimed Ossuary (T8)'],
    });
    const d = describeEquipment(item);
    expect(d.affixes).toHaveLength(item.affixes.length);
    item.affixes.forEach((a, i) => expect(d.affixes[i].affixName).toBe(getAffix(a.affixId)!.name));
    const life = d.affixes[item.affixes.findIndex((a) => a.affixId === 'life')];
    expect(life).toEqual({
      text: '+55 to maximum Life', kind: 'prefix', tier: 2, affixName: 'Hale', tags: ['Life'], range: '(51–62)', sealed: true,
    });
    const res = d.affixes[item.affixes.findIndex((a) => a.affixId === 'coldResistance')];
    expect(res.kind).toBe('suffix');
    expect(res.fractured).toBe(true);
    expect(res.tags).toEqual(['Cold', 'Resistance']);
    expect(d.scars).toEqual([{ text: 'Frail: 7% reduced maximum Life', kind: 'scar', negative: true, range: '(5–10)' }]);
    expect(d.stability).toEqual({ current: 3, max: 9 });
    expect(d.history).toEqual(['Dropped in Rimed Ossuary (T8)']);
    // Local armour: floor((10 + 0.5×70 + implicit) × 1.6)
    const implicit = item.implicitValues[0];
    expect(d.properties).toEqual([{ label: 'Armour', value: String(Math.floor((45 + implicit) * 1.6)) }]);
  });

  it('marks finished items and spells out unmet level requirements', () => {
    const item = equip({ baseId: 'voidSignet', itemLevel: 30, rarity: 'magic', affixes: [{ affixId: 'life', tier: 6 }], stability: 0 });
    const d = describeEquipment(item, { characterLevel: 9 });
    expect(d.headerLines).toContain('Finished');
    expect(d.hint).toMatch(/Finished/);
    expect(d.requirements).toBe('Requires Level 16 (you are level 9)');
  });

  it('describes uniques with fixed mods, flag lines and flavour', () => {
    const item = generateUnique('thePatientSpark', createRng(2));
    const d = describeEquipment(item);
    expect(d.title).toBe('The Patient Spark');
    expect(d.subtitle).toBe('Ashwood Wand');
    expect(d.tone).toBe('unique');
    expect(d.iconId).toBe('icon/unique/thePatientSpark');
    expect(d.stability).toBeUndefined();
    expect(d.flavor).toBe('It waits for the whole line.');
    expect(d.affixes.map((l) => l.kind)).toEqual(['unique', 'unique', 'unique']);
    expect(d.affixes[0].text).toMatch(/^\d+% increased Fire Damage$/);
    expect(d.affixes[0].range).toBe('(30–45)');
    expect(d.affixes[1]).toMatchObject({ text: '15% reduced Cast Speed', negative: true });
    expect(d.affixes[2].text).toBe('Ember Lance pierces all targets');
    expect(d.hint).toMatch(/cannot be crafted/);
  });
});

describe('itemModifiers', () => {
  it('folds local armour lines into the property and labels every source', () => {
    const item = equip({
      baseId: 'ironVisor', itemLevel: 40, rarity: 'rare', name: 'Rust Crown', implicitValues: [25],
      affixes: [
        { affixId: 'armourFlat', tier: 5, value: 40 },
        { affixId: 'armourPercent', tier: 4, value: 40 },
        { affixId: 'life', tier: 5, value: 30 },
        { affixId: 'fireResistance', tier: 6, value: 20 },
      ],
      scars: [{ scarId: 'brittle', value: 20 }],
    });
    const mods = itemModifiers(item);
    const armour = mods.filter((m) => m.stat === 'armor');
    // (10 + 0.5×40) + 25 + 40 = 95; × (1 + (40 − 20)/100) = 114
    expect(armour).toEqual([{ stat: 'armor', mode: 'flat', value: 114, source: 'Rust Crown (Armour)', label: 'Armour: 114' }]);
    expect(itemProperties(item)[0]).toMatchObject({ base: 30, flat: 65, increased: 20, value: 114 });
    expect(mods).toContainEqual({ stat: 'maxLife', mode: 'flat', value: 30, source: 'Rust Crown (Hale T5)', label: '+30 to maximum Life' });
    expect(mods).toContainEqual({ stat: 'fireRes', mode: 'flat', value: 20, source: 'Rust Crown (of the Kiln T6)', label: '+20% to Fire Resistance' });
    expect(resolveStat(0, armour)).toBe(114);
  });

  it('emits multi-stat implicits, scars as negatives, weapon spell damage as one property total', () => {
    const talisman = equip({ baseId: 'boneTalisman', itemLevel: 20, rarity: 'normal', implicitValues: [10], scars: [{ scarId: 'smouldering', value: 9 }] });
    const mods = itemModifiers(talisman);
    expect(mods.filter((m) => ['str', 'dex', 'int'].includes(m.stat)).map((m) => m.value)).toEqual([10, 10, 10]);
    expect(mods.find((m) => m.stat === 'fireRes')).toMatchObject({ value: -9, source: 'Bone Talisman (scar: Smouldering)' });

    const wand = equip({
      baseId: 'ironrootWand', itemLevel: 50, rarity: 'magic', implicitValues: [4],
      affixes: [{ affixId: 'addedSpellDamage', tier: 4, value: 11 }],
    });
    const spell = itemModifiers(wand).filter((m) => m.stat === 'addedSpellDamage');
    // floor(1 + 0.06 × 50) = 4 base + 4 implicit + 11 affix
    expect(spell).toHaveLength(1);
    expect(spell[0].value).toBe(19);
  });

  it('matches the tooltip for every generated item', () => {
    const rng = createRng(6);
    for (let i = 0; i < 400; i++) {
      const baseIds = Object.keys(BASES) as (keyof typeof BASES)[];
      const item = generateEquipment(baseIds[i % baseIds.length], 1 + (i % 100), 'rare', rng);
      const mods = itemModifiers(item);
      const d = describeEquipment(item);
      for (const p of d.properties) {
        const stat = itemProperties(item).find((x) => x.label === p.label)!.stat;
        const total = mods.filter((m) => m.stat === stat).reduce((s, m) => s + m.value, 0);
        expect(String(total)).toBe(p.value);
      }
      for (const m of mods) expect(m.source.length).toBeGreaterThan(0);
    }
  });
});

describe('describeCurrency & describeFlask', () => {
  it('describes currency stacks', () => {
    const d = describeCurrency(currency('fractureCore', 3));
    expect(d.title).toBe('Fracture Core');
    expect(d.tone).toBe('currency');
    expect(d.iconId).toBe('icon/currency/fractureCore');
    expect(d.headerLines).toEqual(['Stack 3 / 20']);
    expect(d.properties).toEqual([{ label: 'Family', value: 'Transform' }, { label: 'Stability Cost', value: '3' }]);
    expect(d.description).toMatch(/^Fractures a chosen affix/);
    expect(d.hint).toMatch(/choose an affix/);
    const seal = describeCurrency(currency('seal', 1));
    expect(seal.properties[1]).toEqual({ label: 'Stability Cost', value: 'None' });
    const dust = describeCurrency(currency('mapDust', 12));
    expect(dust.classLabel).toBe('Map Currency');
    expect(dust.headerLines).toEqual(['Stack 12 / 40']);
    expect(dust.hint).toMatch(/map/);
  });

  it('describes flasks in grids and on the belt', () => {
    expect(flaskRecovery('lifeFlask', 10)).toBe(120);
    expect(flaskRecovery('lifeFlask', 10, 1.5)).toBe(180);
    const d = describeFlask(flask('lifeFlask', 7), { characterLevel: 10 });
    expect(d.title).toBe('Life Flask');
    expect(d.tone).toBe('flask');
    expect(d.headerLines).toEqual(['Stack 7 / 20']);
    expect(d.properties).toEqual([{ label: 'Recovers', value: '120 Life' }, { label: 'Duration', value: '3 seconds' }]);
    const onBelt = describeFlask({ kind: 'flask', uid: beltUid(1), flaskId: 'focusFlask', count: 2 });
    expect(onBelt.headerLines).toEqual(['Belt Charges 2 / 5']);
    expect(onBelt.properties[0].value).toBe('30 Focus + 4 per level');
    expect(onBelt.hint).toBe('Press 2 during a map to drink.');
    expect(d.hint).toBe('Ctrl+click to load into the belt.');
    const empty = describeFlask({ kind: 'flask', uid: beltUid(3), flaskId: 'lifeFlask', count: 0 });
    expect(empty.headerLines).toEqual(['Belt Charges 0 / 5']);
    expect(empty.hint).toBe('Empty. Flask pickups refill this slot first.');
  });
});

describe('labels, tones and stack constructors', () => {
  it('labels and tones every item kind', () => {
    const rare = equip({ baseId: 'emberRing', itemLevel: 20, rarity: 'rare', name: 'Ash Song', affixes: [{ affixId: 'life', tier: 6 }] });
    expect(itemLabel(rare)).toBe('Ash Song');
    expect(itemTone(rare)).toBe('rare');
    expect(itemLabel(currency('scrap', 3))).toBe('Forge Scrap \u00d73');
    expect(itemLabel(currency('catalyst', 1))).toBe('Tempering Catalyst');
    expect(itemTone(currency('catalyst', 1))).toBe('currency');
    expect(itemLabel(flask('focusFlask', 1))).toBe('Focus Flask');
    expect(itemTone(flask('focusFlask', 1))).toBe('flask');
    expect(itemTone(map())).toBe('map');
    expect(itemLabel(generateUnique('cinderwalkers', createRng(1)))).toBe('Cinderwalkers');
  });

  it('builds clamped currency and flask stacks', () => {
    expect(currencyStack('voidNeedle', 99, 'u1')).toEqual({ kind: 'currency', uid: 'u1', currencyId: 'voidNeedle', count: 20 });
    expect(currencyStack('scrap', 0, 'u2', true)).toEqual({ kind: 'currency', uid: 'u2', currencyId: 'scrap', count: 1, isNew: true });
    expect(flaskStack('lifeFlask', 30, 'u3')).toEqual({ kind: 'flask', uid: 'u3', flaskId: 'lifeFlask', count: 20 });
  });
});

describe('glyph coverage', () => {
  // Latin subset of the bundled @fontsource fonts (Alegreya Sans, Cinzel). Any other glyph (→ U+2192,
  // ≈, ≤ …) would be drawn from a system fallback font in the middle of a tooltip line.
  const COVERED: readonly [number, number][] = [
    [0x20, 0x7e], [0xa0, 0xff], [0x131, 0x131], [0x152, 0x153], [0x2bb, 0x2bc], [0x2c6, 0x2c6], [0x2da, 0x2da],
    [0x2dc, 0x2dc], [0x2000, 0x206f], [0x20ac, 0x20ac], [0x2122, 0x2122], [0x2191, 0x2191], [0x2193, 0x2193],
    [0x2212, 0x2212], [0x2215, 0x2215],
  ];
  const covered = (code: number) => COVERED.some(([a, b]) => code >= a && code <= b);
  const collect = (v: unknown, out: string[]): void => {
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach((x) => collect(x, out));
    else if (v && typeof v === 'object') Object.values(v).forEach((x) => collect(x, out));
  };

  it('uses only glyphs the UI fonts cover in every player-facing string', () => {
    const texts: string[] = [];
    const rng = createRng(11);
    const items: EquipmentItem[] = [];
    for (const baseId of BASE_IDS) {
      for (const [ilvl, rarity] of [[1, 'normal'], [40, 'magic'], [85, 'rare']] as const) {
        items.push(generateEquipment(baseId, ilvl, rarity, rng, { origin: 'Dropped in the Ashen Forge (T4)' }));
      }
    }
    for (const id of UNIQUE_IDS) items.push(generateUnique(id, rng));
    items.push(equip({
      baseId: 'rivetedCoat', itemLevel: 80, rarity: 'rare', name: 'Iron Vow', stability: 3,
      affixes: [{ affixId: 'life', tier: 3, sealed: true }, { affixId: 'armourPercent', tier: 2, fractured: true }, { affixId: 'strength', tier: 5 }],
      scars: [{ scarId: 'brittle', value: 20 }, { scarId: 'exposed', value: 4 }],
    }));
    // A bench-crafted affix (sealed) next to a plain one, so previews and errors mention it.
    items.push(equip({
      baseId: 'emberRing', itemLevel: 60, rarity: 'rare', name: 'Grave Coil', stability: 4,
      affixes: [{ affixId: 'life', tier: 4, crafted: true }, { affixId: 'focus', tier: 5 }, { affixId: 'coldResistance', tier: 4 }],
    }));
    for (const item of items) {
      collect(describeEquipment(item, { characterLevel: 1 }), texts);
      for (const cur of EQUIPMENT_CURRENCY_IDS) {
        const err = equipmentCraftError(item, cur);
        if (err) {
          texts.push(err);
          continue;
        }
        texts.push(...equipmentCraftPreview(item, cur).lines);
        const index = affixChoices(item, cur).find((c) => !c.error)?.index;
        const res = craftEquipment(item, cur, rng, index);
        if (!res.ok) texts.push(res.error);
        else {
          texts.push(res.value.message);
          collect(describeEquipment(res.value.item), texts);
        }
        for (const c of affixChoices(item, cur)) if (c.error) texts.push(c.error);
      }
    }
    for (const id of CURRENCY_IDS) collect(describeCurrency(currencyStack(id, 3, 'c')), texts);
    for (const id of FLASK_IDS) {
      collect(describeFlask(flaskStack(id, 4, 'f'), { characterLevel: 12, flaskEffect: 1.2 }), texts);
      collect(describeFlask({ kind: 'flask', uid: beltUid(0), flaskId: id, count: 0 }), texts);
    }
    collect([BASE_INFO, CURRENCY_INFO, FLASK_INFO, UNIQUE_INFO], texts);
    for (const item of items) texts.push(itemLabel(item));
    texts.push(itemLabel(currencyStack('scrap', 3, 'x')), itemLabel(map('m')));

    // Character-level crafting and inventory messages.
    const ch = { ...makeCharacter({ level: 2 }), belt: [{ flaskId: 'lifeFlask' as const, count: 0 }, null, null, null] };
    const withStuff = { ...ch, backpack: { ...ch.backpack, entries: [
      { item: items[items.length - 1], x: 0, y: 0 }, { item: currencyStack('mapDust', 2, 'dust'), x: 11, y: 0 },
      { item: map('mp'), x: 10, y: 0 },
    ] } };
    texts.push(...craftPreview(withStuff, 'dust', items[items.length - 1].uid), ...craftPreview(withStuff, 'dust', 'mp'));
    const errs = [
      canEquip(withStuff, items[items.length - 1], 'chest').reason, canEquip(withStuff, items[items.length - 1], 'boots').reason,
      moveItem(withStuff, 'dust', { kind: 'mapDevice' }), moveItem(withStuff, beltUid(0), { kind: 'backpack', x: 5, y: 4 }),
      quickMove(withStuff, 'dust', { stashTab: null }), renameStashTab(withStuff, 0, 'x'.repeat(30)),
    ];
    collect(errs, texts);

    // Crafting Bench: every recipe list (labels, costs, reasons), a craft and a clear on every item.
    for (const it of items) {
      const benchCh = { ...ch, backpack: { ...ch.backpack, entries: [
        { item: it, x: 0, y: 0 }, { item: currencyStack('scrap', 3, 'scrap'), x: 11, y: 0 },
      ] } };
      const recipes = benchRecipes(benchCh, it.uid);
      collect(recipes, texts);
      for (const r of recipes) {
        const res = applyBenchRecipe(benchCh, it.uid, r.id);
        texts.push(res.ok ? res.value.message : res.error);
      }
      const cleared = clearCraftedAffix(benchCh, it.uid);
      texts.push(cleared.ok ? cleared.value.message : cleared.error);
    }

    const bad = texts.flatMap((t) => [...t]
      .filter((c) => !covered(c.codePointAt(0)!))
      .map((c) => `${c} (U+${c.codePointAt(0)!.toString(16).toUpperCase()}) in "${t}"`));
    expect(texts.length).toBeGreaterThan(2000);
    expect([...new Set(bad)]).toEqual([]);
  });
});
