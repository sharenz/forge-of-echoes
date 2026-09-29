// Online integration helpers (src/game/online.ts): the character rng must stay a server secret. The client
// runs the same pure rules for display, so every display rule must give identical output without
// rngState / RunSetup.seed (the server redacts both), and outcomes must hinge on server entropy that the
// client cannot see — otherwise a client can preview and steer every craft, gamble and map seed.
import { describe, expect, it } from 'vitest';
import type { CharacterSave, EquipmentItem, Item } from '../../src/contracts/items';
import type { RunHooks } from '../../src/contracts/sim';
import {
  RNG_COMMANDS, hideoutSeed, lootLuckLines, redactForClient, redactSetupForClient, reseedCharacter, rules, withServerEntropy,
} from '../../src/game';
import { HIDEOUT_SEED } from '../../src/data/progression';
import { bareCharacter, currency, equip, expectOk, luckyAmulet, map, withBackpack } from './fixtures';

/** A character with a bit of everything: currencies, a normal and a rare base, a map in the device, luck gear. */
function workshop(rngState = 0x1234abcd): CharacterSave {
  const rare: EquipmentItem = equip({
    baseId: 'ironrootWand', itemLevel: 40, rarity: 'rare', uid: 'rare-wand',
    affixes: [{ affixId: 'fireDamage', tier: 4 }, { affixId: 'castSpeed', tier: 4 }, { affixId: 'intelligence', tier: 5 }],
  });
  const normal = equip({ baseId: 'silkWraps', itemLevel: 30, rarity: 'normal', uid: 'gloves' });
  const bag: [Item, number, number][] = [
    [currency('scrap', 30, 'scrap'), 0, 0], [currency('reforge', 5, 'reforge'), 1, 0], [currency('kindling', 5, 'kindling'), 2, 0],
    [currency('essenceEmber', 3, 'ember'), 3, 0], [currency('seal', 2, 'seal'), 4, 0], [currency('catalyst', 2, 'catalyst'), 5, 0],
    [currency('fractureCore', 2, 'core'), 6, 0], [currency('solvent', 2, 'solvent'), 7, 0], [currency('mapDust', 5, 'dust'), 8, 0],
    [currency('threatGlyph', 5, 'glyph'), 9, 0], [currency('voidNeedle', 2, 'needle'), 10, 0], [currency('rewardInk', 2, 'ink'), 11, 0],
    [rare, 0, 1], [normal, 2, 1], [map('rimedOssuary', 3, { uid: 'spare-map', quality: 6 }), 4, 1],
  ];
  return withBackpack(
    bareCharacter({ level: 30, rngState, equipment: { amulet: luckyAmulet(25, 12) }, mapDevice: map('ashenForge', 4, { uid: 'device-map', quality: 8 }) }),
    bag,
  );
}

const CURRENCIES = ['scrap', 'reforge', 'kindling', 'ember', 'seal', 'catalyst', 'core', 'solvent', 'dust', 'glyph', 'needle', 'ink'];
const TARGETS = ['rare-wand', 'gloves', 'spare-map', 'device-map'];

describe('display rules never read the character rng (the server redacts it)', () => {
  const ch = workshop();
  const redacted = redactForClient(ch);

  it('redactForClient zeroes rngState and nothing else', () => {
    expect(redacted.rngState).toBe(0);
    expect({ ...redacted, rngState: ch.rngState }).toEqual(ch);
    expect(redactForClient(redacted)).toBe(redacted);
  });

  it('craft previews and targeting errors are identical', () => {
    for (const c of CURRENCIES) {
      for (const t of TARGETS) {
        expect(rules.craftPreview(redacted, c, t), `${c} on ${t}`).toEqual(rules.craftPreview(ch, c, t));
        expect(rules.craftingTargetError(redacted, c, t), `${c} on ${t}`).toEqual(rules.craftingTargetError(ch, c, t));
      }
    }
  });

  it('tooltips, the sheet, skills, compare and the merchant are identical', () => {
    for (const e of ch.backpack.entries) {
      expect(rules.describeItem(e.item, redacted)).toEqual(rules.describeItem(e.item, ch));
      expect(rules.compareWithEquipped(redacted, e.item)).toEqual(rules.compareWithEquipped(ch, e.item));
    }
    expect(rules.deriveStats(redacted)).toEqual(rules.deriveStats(ch));
    expect(rules.skillSheet(redacted, 'emberLance')).toEqual(rules.skillSheet(ch, 'emberLance'));
    expect(rules.merchantOffers(redacted)).toEqual(rules.merchantOffers(ch));
    expect(rules.mapSummary(redacted, ch.mapDevice!)).toEqual(rules.mapSummary(ch, ch.mapDevice!));
    for (const t of TARGETS) expect(rules.benchRecipes(redacted, t), t).toEqual(rules.benchRecipes(ch, t));
  });

  it('the map device preview (openMap + lootLuck) shows the same luck and readout', () => {
    const real = expectOk(rules.openMap(ch)).setup;
    const preview = expectOk(rules.openMap(redacted)).setup;
    expect(preview.seed).not.toBe(real.seed);
    expect(rules.lootLuck(preview, redacted)).toEqual(rules.lootLuck(real, ch));
    expect(lootLuckLines(preview, redacted)).toEqual(lootLuckLines(real, ch));
    expect({ ...preview, seed: 0 }).toEqual({ ...real, seed: 0 });
  });
});

describe('the map seed stays on the server (ZoneInfo.setup is redacted)', () => {
  const ch = workshop();
  const setup = expectOk(rules.openMap(ch)).setup;
  const shown = redactSetupForClient(setup);

  it('zeroes the seed and nothing else', () => {
    expect(setup.seed).not.toBe(0);
    expect(shown.seed).toBe(0);
    expect({ ...shown, seed: setup.seed }).toEqual(setup);
  });

  it('personal luck, its lines and the in-map sheet are identical', () => {
    expect(rules.lootLuck(shown, ch)).toEqual(rules.lootLuck(setup, ch));
    expect(lootLuckLines(shown, ch)).toEqual(lootLuckLines(setup, ch));
    expect(rules.deriveStats(ch, shown)).toEqual(rules.deriveStats(ch, setup));
    expect(rules.playerRuntime(ch, shown)).toEqual(rules.playerRuntime(ch, setup));
  });
});

describe('server entropy decides every rng outcome', () => {
  it('reseedCharacter is pure and only touches rngState', () => {
    const ch = workshop();
    const a = reseedCharacter(ch, 7);
    expect(reseedCharacter(ch, 7)).toEqual(a);
    expect(a.rngState).not.toBe(ch.rngState);
    expect({ ...a, rngState: ch.rngState }).toEqual(ch);
    const states = new Set(Array.from({ length: 64 }, (_, i) => reseedCharacter(ch, i).rngState));
    expect(states.size).toBe(64);
    // The previous state still matters: the same entropy on another stream gives another state.
    expect(reseedCharacter(workshop(1), 7).rngState).not.toBe(reseedCharacter(workshop(2), 7).rngState);
    // Garbage entropy is treated as 0, never NaN.
    expect(Number.isInteger(reseedCharacter(ch, Number.NaN).rngState)).toBe(true);
  });

  it('a client that knows rngState cannot predict a craft: the outcome follows the server entropy', () => {
    const ch = workshop();
    const outcome = (c: CharacterSave) => {
      const r = expectOk(rules.applyCurrency(c, 'reforge', 'rare-wand'));
      return JSON.stringify((rules.findItem(r.character, 'rare-wand')!.item as EquipmentItem).affixes);
    };
    const predicted = outcome(ch);
    let entropy = 1000;
    const server = withServerEntropy(rules, () => entropy);
    const results = new Set<string>();
    for (let i = 0; i < 40; i++) {
      entropy = 1000 + i * 7919;
      const r = expectOk(server.applyCurrency(ch, 'reforge', 'rare-wand'));
      const got = JSON.stringify((rules.findItem(r.character, 'rare-wand')!.item as EquipmentItem).affixes);
      results.add(got);
      // Exactly the base rules on the reseeded character.
      expect(r).toEqual(expectOk(rules.applyCurrency(reseedCharacter(ch, entropy), 'reforge', 'rare-wand')));
    }
    expect(results.size).toBeGreaterThan(30);
    expect([...results].filter((x) => x === predicted).length).toBeLessThanOrEqual(1);
  });

  it('gambles and map seeds follow the server entropy too; everything else is the plain rules', () => {
    const ch = { ...workshop(), level: 30 };
    let calls = 0;
    const server = withServerEntropy(rules, () => { calls++; return 424242; });
    const gamble = expectOk(server.buyOffer(ch, 'gamble-ring'));
    expect(gamble).toEqual(expectOk(rules.buyOffer(reseedCharacter(ch, 424242), 'gamble-ring')));
    const opened = expectOk(server.openMap(ch));
    expect(opened.setup.seed).toBe(expectOk(rules.openMap(reseedCharacter(ch, 424242))).setup.seed);
    expect(opened.setup.seed).not.toBe(expectOk(rules.openMap(ch)).setup.seed);
    expect(calls).toBe(2);
    expect(server.moveItem).toBe(rules.moveItem);
    expect(server.craftPreview).toBe(rules.craftPreview);
    expect(server.lootLuck).toBe(rules.lootLuck);
    expect(calls).toBe(2);
  });

  it('a bench craft rolls its value from server entropy; clearing needs none', () => {
    const ch = workshop();
    let entropy = 0;
    let calls = 0;
    const server = withServerEntropy(rules, () => { calls++; return entropy; });
    const values = new Set<number>();
    for (let i = 0; i < 40; i++) {
      entropy = 77 + i * 104729;
      const r = expectOk(server.applyBenchRecipe(ch, 'gloves', 'bench:fireResistance'));
      expect(r).toEqual(expectOk(rules.applyBenchRecipe(reseedCharacter(ch, entropy), 'gloves', 'bench:fireResistance')));
      values.add((rules.findItem(r.character, 'gloves')!.item as EquipmentItem).affixes[0].value);
    }
    expect(calls).toBe(40);
    expect(values.size).toBe(5); // every value of T5 of the Kiln (21–25)
    expect(server.clearCraftedAffix).toBe(rules.clearCraftedAffix);
    expect(server.benchRecipes).toBe(rules.benchRecipes);
  });

  it('names exactly the commands that draw from the character rng', () => {
    expect([...RNG_COMMANDS].sort()).toEqual(['activateMapDevice', 'applyCurrency', 'benchCraft', 'buyOffer']);
  });
});

describe('hideoutSeed', () => {
  const hooks: RunHooks = { rollKillLoot: () => [], rollChestLoot: () => [], tryPickup: () => true };

  it('gives every owner a stable hideout of their own', () => {
    const a = hideoutSeed('ch-alice');
    expect(hideoutSeed('ch-alice')).toBe(a);
    expect(hideoutSeed('ch-bob')).not.toBe(a);
    expect(Number.isInteger(a) && a >= 0 && a < 2 ** 32).toBe(true);
    expect(a).not.toBe(HIDEOUT_SEED);
    const cfg = { ...rules.buildRunConfig(null, hooks), seed: a };
    expect(cfg).toMatchObject({ mode: 'hideout', seed: a });
  });
});
