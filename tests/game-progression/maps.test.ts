// Maps (GAME_SPEC §6–§7): map currency semantics, monster scaling, luck, waves, summary and tooltips.
import { describe, expect, it } from 'vitest';
import type { CharacterSave, MapItem, RolledMapMod } from '../../src/contracts/items';
import type { CurrencyId } from '../../src/contracts/content';
import { createRng } from '../../src/core/rng';
import { partyScalingLines, rules } from '../../src/game';
import { MONSTER_LEVEL_SCALING, PARTY_SCALING, getMapMod } from '../../src/data/progression';
import {
  craftMap, dangerModCount, mapCraftError, mapLuck, mapModName, monsterScaling, partyScaling, voidOutcomes, waveConfig,
} from '../../src/game/progression';
import { PARTY_BUDGET_PER_PLAYER, PARTY_ELITE_PER_PLAYER, PARTY_LIFE_PER_PLAYER } from '../../src/sim/constants';
import { bareCharacter, currency, equip, expectErr, expectOk, map, withBackpack } from './fixtures';

const dangerOf = (m: MapItem) => m.mods.filter((x) => getMapMod(x.modId)?.kind === 'danger');
const mod = (modId: string, value = 100): RolledMapMod => ({ modId, value });

/** A character with the map at (0,0) and one stack of each map currency. */
function workshop(m: MapItem, rngState = 777): CharacterSave {
  return withBackpack(bareCharacter({ rngState }), [
    [m, 0, 0],
    [currency('mapDust', 10, 'dust'), 1, 0],
    [currency('threatGlyph', 10, 'glyph'), 2, 0],
    [currency('rewardInk', 10, 'ink'), 3, 0],
    [currency('voidNeedle', 10, 'needle'), 4, 0],
    [currency('scrap', 10, 'scrap'), 5, 0],
  ]);
}

function craftAll(m: MapItem, id: CurrencyId, n: number): MapItem[] {
  const rng = createRng(99);
  const out: MapItem[] = [];
  for (let i = 0; i < n; i++) out.push(craftMap(m, id, rng).map);
  return out;
}

describe('Map Dust', () => {
  it('turns a Normal map Magic with 1–2 danger mods', () => {
    const results = craftAll(map(), 'mapDust', 400);
    const counts = results.map((m) => dangerOf(m).length);
    expect(results.every((m) => m.rarity === 'magic')).toBe(true);
    expect(new Set(counts)).toEqual(new Set([1, 2]));
    const twos = counts.filter((c) => c === 2).length / counts.length;
    expect(twos).toBeGreaterThan(0.4);
    expect(twos).toBeLessThan(0.6);
    for (const m of results) expect(new Set(m.mods.map((x) => x.modId)).size).toBe(m.mods.length);
  });

  it('rerolls a Magic map within the Magic band and a Rare map within the Rare band, keeping the reward mod', () => {
    const magic = map('ashenForge', 3, { mods: [mod('teeming'), mod('gilded')] });
    for (const m of craftAll(magic, 'mapDust', 100)) {
      expect(m.rarity).toBe('magic');
      expect([1, 2]).toContain(dangerOf(m).length);
      expect(m.mods.some((x) => x.modId === 'gilded')).toBe(true);
    }
    const rare = map('ashenForge', 3, { mods: [mod('teeming'), mod('hexed'), mod('volcanic')] });
    for (const m of craftAll(rare, 'mapDust', 100)) {
      expect(m.rarity).toBe('rare');
      expect([3, 4]).toContain(dangerOf(m).length);
    }
  });
});

describe('Threat Glyph', () => {
  it('adds one danger mod; the map becomes Rare at 3 and holds at most 4', () => {
    const rng = createRng(5);
    let m = map();
    const rarities: string[] = [];
    for (let i = 0; i < 4; i++) {
      m = craftMap(m, 'threatGlyph', rng).map;
      rarities.push(m.rarity);
    }
    expect(rarities).toEqual(['magic', 'magic', 'rare', 'rare']);
    expect(dangerModCount(m)).toBe(4);
    expect(new Set(m.mods.map((x) => x.modId)).size).toBe(4);
    expect(mapCraftError(m, 'threatGlyph')).toBe('This map already has 4 danger mods, the most it can hold.');
  });

  it('rolls values that scale slightly with tier', () => {
    const rng = createRng(1);
    const low = Array.from({ length: 50 }, () => craftMap(map('ashenForge', 1), 'threatGlyph', rng).map.mods[0].value);
    const high = Array.from({ length: 50 }, () => craftMap(map('ashenForge', 15), 'threatGlyph', rng).map.mods[0].value);
    expect(Math.min(...low)).toBeGreaterThanOrEqual(100);
    expect(Math.max(...low)).toBeLessThanOrEqual(110);
    expect(Math.min(...high)).toBeGreaterThanOrEqual(142);
    expect(Math.max(...high)).toBeLessThanOrEqual(152);
  });
});

describe('Reward Ink', () => {
  it('adds one reward-only mod without changing rarity, at most one per map', () => {
    const m = craftAll(map(), 'rewardInk', 1)[0];
    expect(m.rarity).toBe('normal');
    expect(m.mods).toHaveLength(1);
    expect(getMapMod(m.mods[0].modId)?.kind).toBe('reward');
    expect(mapCraftError(m, 'rewardInk')).toMatch(/Reward Ink adds at most one reward mod/);
  });
});

describe('Void Needle', () => {
  it('corrupts with the GAME_SPEC odds (30/20/20/15/15)', () => {
    const base = map('ashenForge', 5, { mods: [mod('teeming')] });
    const n = 6000;
    const tally = { corruptedMod: 0, tierUp: 0, rareFour: 0, echoWave: 0, nothing: 0 };
    for (const m of craftAll(base, 'voidNeedle', n)) {
      expect(m.corrupted).toBe(true);
      if (m.tier === 6) tally.tierUp++;
      else if (m.mods.some((x) => x.modId === 'echo')) tally.echoWave++;
      else if (m.mods.some((x) => getMapMod(x.modId)?.kind === 'corrupted')) tally.corruptedMod++;
      else if (dangerOf(m).length === 4) tally.rareFour++;
      else tally.nothing++;
    }
    const expectRate = (count: number, p: number) => {
      const sigma = Math.sqrt((p * (1 - p)) / n);
      expect(Math.abs(count / n - p)).toBeLessThan(4 * sigma);
    };
    expectRate(tally.corruptedMod, 0.3);
    expectRate(tally.tierUp, 0.2);
    expectRate(tally.rareFour, 0.2);
    expectRate(tally.echoWave, 0.15);
    expectRate(tally.nothing, 0.15);
  });

  it('never raises a tier-15 map', () => {
    expect(voidOutcomes(map('ashenForge', 15)).map((o) => o.id)).not.toContain('tierUp');
    for (const m of craftAll(map('ashenForge', 15), 'voidNeedle', 300)) expect(m.tier).toBe(15);
  });

  it('locks the map: no map currency works on a corrupted map', () => {
    const m = craftAll(map(), 'voidNeedle', 1)[0];
    for (const id of ['mapDust', 'threatGlyph', 'rewardInk', 'voidNeedle'] as const) {
      expect(mapCraftError(m, id)).toBe('Corrupted maps cannot be modified.');
    }
  });

  it('adds an Echo wave: 7 waves with the boss on 6', () => {
    const echo: MapItem = { ...map(), corrupted: true, mods: [{ modId: 'echo', value: 100, corrupted: true }] };
    expect(waveConfig(echo)).toMatchObject({ count: 7, bossWave: 6, lieutenantWave: 3 });
    expect(waveConfig(map())).toMatchObject({ count: 6, bossWave: 6, lieutenantWave: 3, baseMonsters: 40, monstersPerWave: 18, waveDuration: 60, tellDuration: 3 });
  });
});

describe('applyCurrency on maps', () => {
  it('consumes one currency, advances the rng and records the craft', () => {
    const m = map();
    const ch = workshop(m);
    const out = expectOk(rules.applyCurrency(ch, 'glyph', m.uid));
    expect(out.kind).toBe('success');
    expect(out.message).toMatch(/^Threat Glyph added /);
    expect(out.targetUid).toBe(m.uid);
    const after = rules.findItem(out.character, m.uid)!.item as MapItem;
    expect(after.rarity).toBe('magic');
    expect((rules.findItem(out.character, 'glyph')!.item as { count: number }).count).toBe(9);
    expect(out.character.rngState).not.toBe(ch.rngState);
    expect(out.character.stats.itemsCrafted).toBe(1);
  });

  it('rejects without consuming anything', () => {
    const m: MapItem = { ...map(), corrupted: true };
    const ch = workshop(m);
    expect(rules.craftingTargetError(ch, 'dust', m.uid)).toBe('Corrupted maps cannot be modified.');
    expect(expectErr(rules.applyCurrency(ch, 'dust', m.uid))).toBe('Corrupted maps cannot be modified.');
    expect(rules.craftPreview(ch, 'dust', m.uid)).toEqual(['Corrupted maps cannot be modified.']);
  });

  it('crafts a map sitting in the map device', () => {
    const m = map();
    const ch = expectOk(rules.moveItem(workshop(m), m.uid, { kind: 'mapDevice' }));
    const out = expectOk(rules.applyCurrency(ch, 'needle', m.uid));
    expect(out.kind).toBe('corrupted');
    expect(out.character.mapDevice?.corrupted).toBe(true);
  });

  it('keeps equipment currencies and map currencies apart', () => {
    const m = map();
    const wand = equip({ baseId: 'ashwoodWand', itemLevel: 5, rarity: 'normal' });
    const ch = withBackpack(workshop(m), [[wand, 7, 0]]);
    expect(rules.craftingTargetError(ch, 'scrap', m.uid)).toBe('Forge Scrap can only be applied to equipment.');
    expect(rules.craftingTargetError(ch, 'dust', wand.uid)).toBe('Map Dust can only be applied to maps.');
  });

  it('previews exact odds', () => {
    const m = map();
    const ch = workshop(m);
    const dust = rules.craftPreview(ch, 'dust', m.uid);
    expect(dust[0]).toBe('Awakens a Magic map with 1 mod 50% · 2 mods 50%.');
    expect(dust[1]).toMatch(/^Chance for each mod: /);
    const glyph = rules.craftPreview(ch, 'glyph', m.uid);
    expect(glyph[0]).toMatch(/^Adds one of 10 danger mods: Teeming \d+%/);
    const pct = [...glyph[0].matchAll(/(\d+)%/g)].reduce((s, x) => s + Number(x[1]), 0);
    expect(pct).toBe(100);
    expect(rules.craftPreview(ch, 'needle', m.uid)[0])
      .toBe('Corrupts the map: Corrupted mod 30% · +1 Tier 20% · Rare with 4 danger mods 20% · Echo wave 15% · Only corruption 15%');
    expect(rules.craftPreview(ch, 'ink', m.uid)[0]).toBe("Inscribes one of 4 reward mods: Gilded 25% · Bountiful 25% · Cartographer's 25% · Essence-laden 25%");
  });

  it('inclusion odds of Map Dust match what it rolls', () => {
    const m = map();
    const line = rules.craftPreview(workshop(m), 'dust', m.uid)[1];
    const shown = new Map([...line.matchAll(/([A-Za-z-]+) (\d+(?:\.\d)?)%/g)].map((x) => [x[1], Number(x[2]) / 100]));
    const n = 8000;
    const hits = new Map<string, number>();
    for (const r of craftAll(m, 'mapDust', n)) for (const x of r.mods) {
      const name = getMapMod(x.modId)!.name;
      hits.set(name, (hits.get(name) ?? 0) + 1);
    }
    for (const [name, p] of shown) {
      const observed = (hits.get(name) ?? 0) / n;
      expect(Math.abs(observed - p), name).toBeLessThan(0.02);
    }
  });
});

/** Monster stats follow the monster level: compounding per level around the reference level (GAME_SPEC §7). */
const lifeAt = (level: number) => MONSTER_LEVEL_SCALING.life ** (level - MONSTER_LEVEL_SCALING.referenceLevel);
const damageAt = (level: number) => MONSTER_LEVEL_SCALING.damage ** (level - MONSTER_LEVEL_SCALING.referenceLevel);

describe('monster scaling', () => {
  it('Tier 1 Ashen Forge: monster level 4, so its monsters are weaker than the base table', () => {
    const s = monsterScaling(map('ashenForge', 1));
    expect(s).toMatchObject({
      level: 4, speedMultiplier: 1, countMultiplier: 1,
      magicPackChance: 0.1, rarePackChance: 0.03, resistBonus: 0.1, xpMultiplier: 1, extraProjectiles: 0, hazards: false,
    });
    expect(s.lifeMultiplier).toBeCloseTo(lifeAt(4), 10);
    expect(s.damageMultiplier).toBeCloseTo(damageAt(4), 10);
    expect(s.lifeMultiplier).toBeLessThan(1);
  });

  it('scales life and damage with the monster level (6 per tier minus 2), not with the tier', () => {
    const tiers = [1, 2, 3, 4, 5, 6];
    const scaling = tiers.map((t) => monsterScaling(map('ashenForge', t)));
    const life = scaling.map((s) => s.lifeMultiplier);
    const damage = scaling.map((s) => s.damageMultiplier);
    tiers.forEach((t, i) => {
      expect(scaling[i].level, `Tier ${t} level`).toBe(6 * t - 2);
      expect(life[i], `Tier ${t} life`).toBeCloseTo(lifeAt(6 * t - 2), 10);
      expect(damage[i], `Tier ${t} damage`).toBeCloseTo(damageAt(6 * t - 2), 10);
    });
    // Every tier is harder than the one before.
    for (let i = 1; i < life.length; i++) {
      expect(life[i]).toBeGreaterThan(life[i - 1]);
      expect(damage[i]).toBeGreaterThan(damage[i - 1]);
    }
  });

  it('follows the monster level and adds the base implicit', () => {
    const s = monsterScaling(map('rimedOssuary', 5));
    expect(s.level).toBe(28);
    expect(s.lifeMultiplier).toBeCloseTo(lifeAt(28) * 1.2, 10);
    expect(s.damageMultiplier).toBeCloseTo(damageAt(28), 10);
    expect(s.xpMultiplier).toBeCloseTo(1.28 ** 4, 10);
    expect(monsterScaling(map('ironColiseum', 15)).level).toBe(88);
    expect(monsterScaling(map('ironColiseum', 1)).countMultiplier).toBeCloseTo(1.25, 10);
  });

  it('applies danger mods with their rolled values', () => {
    const m = map('rimedOssuary', 1, {
      mods: [mod('fortified'), mod('twinCrowned'), mod('teeming', 110), mod('commanded'), mod('splitting'), mod('volcanic')],
    });
    const s = monsterScaling({ ...m, mods: m.mods });
    expect(s.lifeMultiplier).toBeCloseTo((1 + 0.2 + 0.4) * 1.25 * lifeAt(4), 10);
    expect(s.countMultiplier).toBeCloseTo(1.39, 10); // round(35 × 1.10) = 39
    expect(s.magicPackChance).toBeCloseTo(0.16, 10);
    expect(s.rarePackChance).toBeCloseTo(0.048, 10);
    expect(s.extraProjectiles).toBe(1);
    expect(s.hazards).toBe(true);
    expect(s.speedMultiplier).toBe(1);
  });
});

describe('luck', () => {
  it('adds quality, reward mods, tier rarity and gear', () => {
    const m = map('rimedOssuary', 3, { quality: 10, mods: [mod('bountiful'), mod('teeming')] });
    const luck = mapLuck(m, { itemQuantity: 12, itemRarity: 30 });
    expect(luck.quantity.value).toBeCloseTo(100 * (1 + (10 + 25 + 20 + 12) / 100), 10);
    expect(luck.rarity.value).toBeCloseTo(100 * (1 + (10 + 15 + 30) / 100), 10);
  });

  it('shows every source of the map in the map device summary (map-side luck: gear is personal)', () => {
    const amulet = equip({
      baseId: 'cinderPendant', itemLevel: 54, rarity: 'magic', implicitValues: [12],
      affixes: [{ affixId: 'itemQuantity', tier: 3, value: 10 }],
    });
    const ch = bareCharacter({ equipment: { amulet } });
    const m = map('ashenForge', 4, { quality: 6, mods: [mod('teeming'), mod('hexed')] });
    const lines = rules.mapSummary(ch, m);
    expect(rules.mapSummary(bareCharacter(), m)).toEqual(lines);
    const byLabel = new Map(lines.map((l) => [l.label, l]));
    expect(byLabel.get('Monster Level')!.value).toBe('22');
    const q = byLabel.get('Map Item Quantity')!;
    expect(q.value).toBe('+26%');
    expect(q.breakdown).toEqual([
      '+6% Quality', '+20% Teeming', 'Total 126% of the base rate',
      "Map only: each player adds their own gear's Item Quantity to their own drops",
    ]);
    expect(byLabel.get('Map Item Rarity')!.breakdown[0]).toBe('+15% Tier 4');
    expect(byLabel.has('Item Quantity')).toBe(false);
    const pct = (m: number) => `${Math.round((m - 1) * 1000) / 10}%`;
    expect(byLabel.get('Monster Life')!.breakdown).toEqual([`${pct(lifeAt(22))} more from Monster level 22`]);
    expect(byLabel.get('Monster Life')!.value).toBe(`+${Math.round((lifeAt(22) - 1) * 100)}%`);
    expect(byLabel.get('Monster Damage')!.breakdown).toEqual([`${pct(damageAt(22))} more from Monster level 22`]);
    expect(byLabel.get('Your Resistances')!.value).toBe('−26%');
    expect(byLabel.get('Waves')!.value).toBe('6');
  });

  it('shows the experience multiplier the tier gives', () => {
    const at = (tier: number) => rules.mapSummary(bareCharacter(), map('ashenForge', tier)).find((l) => l.label === 'Experience')!;
    expect(at(1)).toEqual({
      label: 'Experience',
      value: '1x',
      breakdown: ['Tier 1 is the base rate; each tier above it multiplies experience by 1.28', 'Magic monsters give 2x the experience, rare monsters 6x'],
    });
    expect(at(5).value).toBe('2.7x');
    expect(at(5).breakdown[0]).toBe('1.28x per tier above 1 (Tier 5: 2.7x)');
    expect(at(15).value).toBe('31.7x');
    // The summary sits right after the waves, and the tooltip lists it too.
    const labels = rules.mapSummary(bareCharacter(), map('ashenForge', 3)).map((l) => l.label);
    expect(labels.indexOf('Experience')).toBe(labels.indexOf('Waves') + 1);
    expect(rules.describeItem(map('ashenForge', 3)).properties).toContainEqual({ label: 'Experience', value: '1.6x' });
  });
});

describe('map tooltip', () => {
  it('describes a Normal map', () => {
    const d = rules.describeItem(map('ironColiseum', 2));
    expect(d).toMatchObject({ title: 'Iron Coliseum', subtitle: null, tone: 'map', classLabel: 'Map', iconId: 'icon/map/ironColiseum' });
    expect(d.headerLines).toEqual(['Tier 2 Map']);
    expect(d.implicits.map((l) => l.text)).toEqual(['25% increased number of Monsters', 'Armour bases drop with +2 Stability', 'Small arena']);
    expect(d.properties).toContainEqual({ label: 'Monster Level', value: '10' });
  });

  it('labels its luck as the map\'s own (each player adds their gear to their own drops)', () => {
    const d = rules.describeItem(map('rimedOssuary', 3, { quality: 10, mods: [mod('teeming')] }));
    expect(d.properties).toContainEqual({ label: 'Map Item Quantity', value: '+30%' });
    expect(d.properties).toContainEqual({ label: 'Map Item Rarity', value: '+25%' });
    expect(d.properties.some((p) => p.label === 'Item Quantity' || p.label === 'Item Rarity')).toBe(false);
  });

  it('names Magic maps after their first mod and Rare maps stably', () => {
    const magic = rules.describeItem(map('ashenForge', 3, { mods: [mod('teeming')] }));
    expect(magic.title).toBe('Teeming Ashen Forge');
    expect(magic.tone).toBe('magic');
    const rare = map('ashenForge', 3, { uid: 'fixed-uid', mods: [mod('teeming'), mod('hexed'), mod('restless')] });
    const d = rules.describeItem(rare);
    expect(d.tone).toBe('rare');
    expect(d.subtitle).toBe('Ashen Forge');
    expect(d.title).toBe(rules.describeItem({ ...rare }).title);
    expect(d.title.split(' ')).toHaveLength(2);
  });

  it('lists danger and reward lines, with Alt ranges', () => {
    const d = rules.describeItem(map('ashenForge', 1, { mods: [mod('ferocious', 104), mod('gilded', 100)] }));
    expect(d.affixes).toEqual([
      { text: '26% increased Monster Damage', kind: 'mapMod', affixName: 'Ferocious', tags: ['Danger'], range: '(25–28)', negative: true },
      { text: '23% increased Quantity of Items found', kind: 'mapMod', affixName: 'Ferocious', tags: ['Danger'], range: '(22–24)' },
      { text: '30% increased Rarity of Items found', kind: 'mapMod', affixName: 'Gilded', tags: ['Reward'], range: '(30–33)' },
    ]);
  });

  it('marks corruption', () => {
    const m: MapItem = { ...map(), corrupted: true, mods: [{ modId: 'seethingHorde', value: 100, corrupted: true }] };
    const d = rules.describeItem(m);
    expect(d.corrupted).toBe(true);
    expect(d.headerLines).toContain('Corrupted');
    expect(d.affixes[0]).toMatchObject({ kind: 'corrupted', affixName: 'Seething Horde', negative: true });
  });

  it("names the corrupted Wrath after the map's own boss; the saved mod id stays the same on every base", () => {
    const names = { ashenForge: "Matriarch's Wrath", rimedOssuary: "The Warden's Wrath", ironColiseum: "Varkus's Wrath" } as const;
    for (const [base, name] of Object.entries(names) as [keyof typeof names, string][]) {
      const wrath: RolledMapMod = { modId: 'matriarchsWrath', value: 100, corrupted: true };
      const m: MapItem = { ...map(base, 4), corrupted: true, mods: [wrath] };
      // Tooltip line, readout breakdown source, and the stored id.
      expect(rules.describeItem(m).affixes[0], base).toMatchObject({ kind: 'corrupted', affixName: name, text: '40% increased Monster Damage' });
      expect(mapModName(getMapMod('matriarchsWrath')!, base)).toBe(name);
      expect(rules.mapSummary(bareCharacter(), m).flatMap((l) => l.breakdown ?? []).some((b) => b.includes(name)), base).toBe(true);
      expect(m.mods[0].modId).toBe('matriarchsWrath');
      // A Void Needle's odds and outcome speak of this base's boss too; no other base's name leaks in.
      const plain = map(base, 4);
      const preview = rules.craftPreview(workshop(plain), 'needle', plain.uid).join(' ');
      expect(preview, base).toContain(name);
      for (const other of Object.values(names)) if (other !== name) expect(preview, base).not.toContain(other);
    }
    // A mod without base names, or an unknown base, keeps the mod's own name.
    expect(mapModName(getMapMod('seethingHorde')!, 'ironColiseum')).toBe('Seething Horde');
    expect(mapModName(getMapMod('matriarchsWrath')!, 'constructor')).toBe("Matriarch's Wrath");
    expect(mapModName(getMapMod('matriarchsWrath')!)).toBe("Matriarch's Wrath");
  });

  it('a Void Needle that rolls the Wrath says so by the base name', () => {
    const rng = createRng(5);
    for (let k = 0; k < 400; k++) {
      const out = craftMap(map('ironColiseum', 3), 'voidNeedle', rng);
      if (!out.map.mods.some((r) => r.modId === 'matriarchsWrath')) continue;
      expect(out.message).toBe("Void Needle corrupted the map with Varkus's Wrath");
      return;
    }
    throw new Error('no Wrath in 400 Void Needles');
  });
});

describe('party scaling (applied by the sim, explained by the rules)', () => {
  it('mirrors the sim\'s constants exactly', () => {
    expect(PARTY_SCALING.monsterLife / 100).toBe(PARTY_LIFE_PER_PLAYER);
    expect(PARTY_SCALING.waveBudget / 100).toBe(PARTY_BUDGET_PER_PLAYER);
    expect(PARTY_SCALING.packRarity / 100).toBe(PARTY_ELITE_PER_PLAYER);
  });

  it('ends every map readout with what each extra player adds', () => {
    for (const m of [map('ashenForge', 1), map('ironColiseum', 9, { mods: [mod('teeming')] })]) {
      const lines = rules.mapSummary(bareCharacter(), m);
      const party = lines.at(-1)!;
      expect(party).toEqual({
        label: 'Party Scaling',
        value: 'per extra player',
        breakdown: [
          '+50% monster life',
          '+25% monsters per wave',
          '+10% magic and rare pack chance',
          'Counts the living players in the map (a party of 4: 2.5x life, 1.75x monsters, 1.3x elite packs)',
          'Loot is never split: every player rolls their own drops',
        ],
      });
    }
  });

  it('gives the live numbers for a party size (clamped to 1–4)', () => {
    expect(partyScaling(1)).toEqual({ players: 1, monsterLife: 1, waveBudget: 1, packRarity: 1 });
    expect(partyScaling(2)).toEqual({ players: 2, monsterLife: 1.5, waveBudget: 1.25, packRarity: 1.1 });
    const four = partyScaling(4);
    expect(four.monsterLife).toBe(2.5);
    expect(four.waveBudget).toBe(1.75);
    expect(four.packRarity).toBeCloseTo(1.3, 12);
    expect(partyScaling(9)).toEqual(four);
    expect(partyScaling(Number.NaN)).toEqual(partyScaling(1));
    expect(partyScaling(0)).toEqual(partyScaling(1));

    const lines = partyScalingLines(3);
    expect(lines.map((l) => [l.label, l.value])).toEqual([['Monster Life', '2x'], ['Monsters per Wave', '1.5x'], ['Magic / Rare Packs', '1.2x']]);
    expect(partyScalingLines(4).map((l) => l.value)).toEqual(['2.5x', '1.75x', '1.3x']);
    expect(lines[0].breakdown[0]).toBe('+50% per living player beyond the first (party of 3)');
    expect(partyScalingLines(1)[0]).toMatchObject({ value: '1x', breakdown: ['+50% per living player beyond the first (you are alone: no party scaling)', 'Set when a monster spawns'] });
  });
});
