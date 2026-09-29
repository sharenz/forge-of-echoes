// Player-facing text: every string the progression rules produce uses glyphs the UI fonts cover, and
// drop labels (drawn with the in-world pixel font) are plain ASCII.
import { describe, expect, it } from 'vitest';
import type { CharacterSave, Item, MapItem } from '../../src/contracts/items';
import { SKILL_IDS } from '../../src/contracts/content';
import { createRng } from '../../src/core/rng';
import { lootLuckLines, rules } from '../../src/game';
import { CORRUPTED_MODS, DANGER_MODS, REWARD_MODS } from '../../src/data/progression';
import { craftMap } from '../../src/game/progression';
import { bareCharacter, currency, map, setupFor, unique, withBackpack, kill } from './fixtures';

// Latin subset of the bundled @fontsource fonts (Alegreya Sans, Cinzel) — same table as the items suite.
const COVERED: readonly [number, number][] = [
  [0x20, 0x7e], [0xa0, 0xff], [0x131, 0x131], [0x152, 0x153], [0x2bb, 0x2bc], [0x2c6, 0x2c6], [0x2da, 0x2da],
  [0x2dc, 0x2dc], [0x2000, 0x206f], [0x20ac, 0x20ac], [0x2122, 0x2122], [0x2191, 0x2191], [0x2193, 0x2193],
  [0x2212, 0x2212], [0x2215, 0x2215],
];
const covered = (code: number) => COVERED.some(([a, b]) => code >= a && code <= b);

function collect(v: unknown, out: string[]): void {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach((x) => collect(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => collect(x, out));
}

function geared(): CharacterSave {
  const ch = bareCharacter({
    level: 30, unspentSkillPoints: 0,
    equipment: { mainHand: unique('thePatientSpark'), amulet: unique('echoOfTheMatriarch'), boots: unique('cinderwalkers'), ring1: unique('ruinheartBand') },
    skillRanks: { emberLance: 8, emberNova: 6, flameWave: 3, rimeShards: 5, arcChain: 2, riftStep: 4, cinderWard: 3 },
    loadout: ['emberLance', 'emberNova', 'rimeShards', 'arcChain', 'riftStep', 'cinderWard'],
    belt: [{ flaskId: 'lifeFlask', count: 2 }, { flaskId: 'focusFlask', count: 0 }, null, null],
  });
  return ch;
}

describe('text coverage', () => {
  it('uses only glyphs the UI fonts cover', () => {
    const texts: string[] = [];
    const ch = geared();
    collect(rules.content, texts);
    collect(rules.deriveStats(ch), texts);
    collect(rules.deriveStats(bareCharacter()), texts);
    for (const id of SKILL_IDS) for (const r of [undefined, 1, 10, 20]) collect(rules.skillSheet(ch, id, r), texts);
    for (const id of SKILL_IDS) collect(rules.skillSheet(bareCharacter(), id), texts);

    const maps: MapItem[] = [];
    const rng = createRng(8);
    for (const base of ['ashenForge', 'rimedOssuary', 'ironColiseum'] as const) {
      let m = map(base, 7, { quality: 9 });
      maps.push(m);
      for (const cur of ['mapDust', 'threatGlyph', 'threatGlyph', 'rewardInk', 'voidNeedle'] as const) {
        const res = craftMap(m, cur, rng);
        texts.push(res.message);
        m = res.map;
        maps.push(m);
      }
    }
    for (const mods of [DANGER_MODS, REWARD_MODS, CORRUPTED_MODS]) {
      for (const d of mods) maps.push({ ...map('ashenForge', 3), mods: [{ modId: d.id, value: 105 }], corrupted: d.kind === 'corrupted' });
    }
    maps.push({ ...map(), corrupted: true, mods: [{ modId: 'echo', value: 100, corrupted: true }] });
    for (const m of maps) {
      collect(rules.describeItem(m, ch), texts);
      collect(rules.mapSummary(ch, m), texts);
      const w = withBackpack(bareCharacter(), [[m, 0, 0], [currency('mapDust', 1, 'a'), 1, 0], [currency('threatGlyph', 1, 'b'), 2, 0],
        [currency('rewardInk', 1, 'c'), 3, 0], [currency('voidNeedle', 1, 'd'), 4, 0], [currency('kindling', 1, 'e'), 5, 0]]);
      for (const cu of ['a', 'b', 'c', 'd', 'e']) {
        texts.push(...rules.craftPreview(w, cu, m.uid));
        const err = rules.craftingTargetError(w, cu, m.uid);
        if (err) texts.push(err);
      }
    }
    collect(rules.merchantOffers(withBackpack(bareCharacter({ level: 25 }), [[currency('scrap', 3), 0, 0]])), texts);
    const setup = setupFor(map('ashenForge', 6, { mods: [{ modId: 'hexed', value: 100 }, { modId: 'exhausting', value: 100 }] }));
    const items: Item[] = [...rules.rollChestLoot(setup, createRng(2), ch),
      ...rules.rollKillLoot(setup, kill({ kind: 'cinderMatriarch', isBoss: true }), createRng(3), ch)];
    for (const i of items) {
      collect(rules.describeItem(i, ch), texts);
      collect(rules.dropSpec(i, 1, 1), texts);
    }
    collect(rules.deriveStats(ch, setup), texts);
    collect(lootLuckLines(setup, ch), texts);
    collect(lootLuckLines(setup, bareCharacter()), texts);
    collect(rules.compareWithEquipped(bareCharacter({ level: 30 }), unique('ruinheartBand')), texts);
    collect([rules.canRankUpSkill(bareCharacter(), 'arcChain'), rules.setLoadoutSlot(bareCharacter(), 0, 'emberNova'),
      rules.openMap(bareCharacter()), rules.buyOffer(bareCharacter(), 'gamble-wand'), rules.allocateAttribute(bareCharacter(), 'str')], texts);

    const bad = texts.flatMap((t) => [...t]
      .filter((c) => !covered(c.codePointAt(0)!))
      .map((c) => `${c} (U+${c.codePointAt(0)!.toString(16).toUpperCase()}) in "${t}"`));
    expect(texts.length).toBeGreaterThan(1500);
    expect([...new Set(bad)]).toEqual([]);
  });

  it('keeps drop labels ASCII', () => {
    const setup = setupFor(map('rimedOssuary', 9));
    const rng = createRng(77);
    for (let i = 0; i < 200; i++) {
      for (const item of rules.rollChestLoot(setup, rng, bareCharacter())) expect(rules.dropSpec(item, i, 1).label).toMatch(/^[\x20-\x7e]+$/);
    }
    expect(rules.dropSpec(unique('echoOfTheMatriarch'), 1, 1).label).toBe('Echo of the Matriarch');
  });
});
