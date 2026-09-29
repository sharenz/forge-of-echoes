// An end-to-end pass through the core loop, using only the public GameRulesApi:
// create → learn a skill → craft a map → open it → build the instance → instanced party loot → pick up →
// level → run end → bench-craft a found item → save.
import { describe, expect, it } from 'vitest';
import type { CharacterSave, CurrencyStack, EquipmentItem, Item, MapItem } from '../../src/contracts/items';
import type { DropSpec, RunHooks } from '../../src/contracts/sim';
import { createRng } from '../../src/core/rng';
import { rules } from '../../src/game';
import { expectOk } from './fixtures';

function find(ch: CharacterSave, pred: (i: Item) => boolean): Item {
  const hit = ch.backpack.entries.find((e) => pred(e.item));
  if (!hit) throw new Error('item not found');
  return hit.item;
}

describe('journey through the core loop', () => {
  it('plays one map from hideout to hideout', () => {
    let ch = rules.createCharacter('Journey', 314);

    // Spend the banked point: Ember Nova goes straight onto Space.
    ch = expectOk(rules.rankUpSkill(ch, 'emberNova'));
    expect(ch.loadout[1]).toBe('emberNova');

    // Craft a map: Map Dust, then a Threat Glyph.
    const m = find(ch, (i) => i.kind === 'map') as MapItem;
    const dust = find(ch, (i) => i.kind === 'currency' && i.currencyId === 'mapDust');
    const glyph = find(ch, (i) => i.kind === 'currency' && i.currencyId === 'threatGlyph');
    ch = expectOk(rules.applyCurrency(ch, dust.uid, m.uid)).character;
    ch = expectOk(rules.applyCurrency(ch, glyph.uid, m.uid)).character;
    const crafted = rules.findItem(ch, m.uid)!.item as MapItem;
    expect(crafted.rarity).not.toBe('normal');
    expect(crafted.mods.length).toBeGreaterThanOrEqual(2);

    // Device → open → run config.
    ch = expectOk(rules.moveItem(ch, m.uid, { kind: 'mapDevice' }));
    const summary = rules.mapSummary(ch, ch.mapDevice!);
    expect(summary.find((l) => l.label === 'Map Item Quantity')).toBeDefined();
    const opened = expectOk(rules.openMap(ch));
    ch = opened.character;
    const setup = opened.setup;

    // The server's side of the instance: a party of two (the owner is sim player 1, a friend is 2).
    // Loot is instanced — each player gets their own roll with their own luck, tagged with them as owner.
    let friend = rules.createCharacter('Friend', 2718);
    const party = (): [number, CharacterSave][] => [[1, ch], [2, friend]];
    const tokens = new Map<number, { owner: number; item: Item }>();
    let nextToken = 1;
    const specs = (owner: number, items: Item[]): DropSpec[] => items.map((item) => {
      const token = nextToken++;
      tokens.set(token, { owner, item });
      return rules.dropSpec(item, token, owner);
    });
    const looter = (id: number) => party().find(([pid]) => pid === id)![1];
    const hooks: RunHooks = {
      rollKillLoot: (ctx, ids, rng) => ids.flatMap((id) => specs(id, rules.rollKillLoot(setup, ctx, rng, looter(id)))),
      rollChestLoot: (ids, rng) => ids.flatMap((id) => specs(id, rules.rollChestLoot(setup, rng, looter(id)))),
      tryPickup: (playerId, token) => {
        const drop = tokens.get(token);
        if (!drop || drop.owner !== playerId) return false;
        const r = rules.addToBackpack(looter(playerId), drop.item);
        if (!r.ok) return false;
        if (playerId === 1) ch = r.value;
        else friend = r.value;
        tokens.delete(token);
        return true;
      },
    };
    const cfg = rules.buildRunConfig(setup, hooks);
    expect(cfg.mode).toBe('map');
    const joinOwner = rules.playerRuntime(ch, setup);
    expect(joinOwner.loadout).toEqual(['emberLance', 'emberNova', null, null, null, null]);

    // Simulate the loot side of a run: kills across the waves, the boss, the chest.
    const loot = createRng(setup.seed).fork(0x10070);
    const drops: DropSpec[] = [];
    const ids = [1, 2] as const;
    for (let wave = 1; wave <= cfg.waves.count; wave++) {
      for (let k = 0; k < 60; k++) {
        drops.push(...cfg.hooks.rollKillLoot({ kind: 'ashling', summoned: false, rarity: k % 20 === 0 ? 'magic' : 'normal', isLieutenant: false, isBoss: false, wave, x: 0, y: 0 }, ids, loot));
      }
    }
    // Summoned minions never drop.
    expect(cfg.hooks.rollKillLoot({ kind: 'ashling', summoned: true, rarity: 'normal', isLieutenant: false, isBoss: false, wave: 3, x: 0, y: 0 }, ids, loot)).toEqual([]);
    drops.push(...cfg.hooks.rollKillLoot({ kind: 'cinderMatriarch', summoned: false, rarity: 'normal', isLieutenant: false, isBoss: true, wave: 6, x: 0, y: 0 }, ids, loot));
    // Everyone present gets their own completion chest, with a same-tier map or a one-tier upgrade.
    const chest = cfg.hooks.rollChestLoot(ids, loot);
    for (const id of ids) {
      const maps = chest.filter((d) => d.owner === id && d.tone === 'map');
      expect(maps.length).toBeGreaterThanOrEqual(1);
      expect(maps.length).toBeLessThanOrEqual(2);
      expect([setup.map.tier, setup.map.tier + 1].some((tier) => maps[0].label.endsWith(`(T${tier})`))).toBe(true);
    }
    drops.unshift(...chest); // picked up first below
    expect(drops.some((d) => d.tone === 'rare' && d.owner === 1)).toBe(true);
    expect(drops.some((d) => d.tone === 'rare' && d.owner === 2)).toBe(true);
    // Nobody can take someone else's drop.
    const foreign = drops.find((d) => d.owner === 2)!;
    expect(cfg.hooks.tryPickup(1, foreign.token)).toBe(false);
    const before = ch.backpack.entries.length;
    let picked = 0;
    for (const d of drops) if (d.owner === 1 && cfg.hooks.tryPickup(1, d.token)) picked++;
    for (const d of drops) if (d.owner === 2) cfg.hooks.tryPickup(2, d.token);
    expect(picked).toBeGreaterThan(0);
    expect(ch.backpack.entries.length).toBeGreaterThan(before);
    expect(friend.backpack.entries.some((e) => e.item.isNew)).toBe(true);

    // XP and a level-up refresh the live player.
    const lvl = rules.grantXp(ch, 1200);
    ch = lvl.character;
    expect(lvl.levelsGained).toBeGreaterThan(0);
    const live = rules.playerRuntime(ch, setup);
    expect(live.stats.maxLife).toBeGreaterThan(joinOwner.stats.maxLife);

    // A flask was drunk.
    ch = rules.consumeFlask(ch, 0);
    expect(rules.playerRuntime(ch, setup).flasks[0]!.count).toBeLessThanOrEqual(5);

    ch = rules.applyRunEnd(ch, { result: 'cleared', tier: setup.map.tier, kills: 362, seconds: 540, raresFound: 2, uniquesFound: 0 });
    expect(ch.stats.mapsCompleted).toBe(1);
    ch = rules.clearNewFlags(ch);
    expect(ch.backpack.entries.every((e) => !e.item.isNew)).toBe(true);

    // A usable map is available for the next expedition; an upgrade is a chance, not a guarantee.
    const nextMaps = ch.backpack.entries.map((e) => e.item).filter((i): i is MapItem => i.kind === 'map' && i.tier >= setup.map.tier);
    expect(nextMaps.length).toBeGreaterThan(0);

    // Scrap buys something; everything survives a save round-trip.
    const scrap = ch.backpack.entries.filter((e) => e.item.kind === 'currency' && e.item.currencyId === 'scrap')
      .reduce((s, e) => s + (e.item as CurrencyStack).count, 0);
    expect(scrap).toBeGreaterThan(0);
    ch = expectOk(rules.buyOffer(ch, 'flask-life')).character;

    // The Crafting Bench: a chosen affix on a found item, marked crafted in its tooltip.
    const benchable = ch.backpack.entries.flatMap((e) => (e.item.kind === 'equipment'
      ? rules.benchRecipes(ch, e.item.uid).filter((r) => r.available).map((r) => ({ uid: e.item.uid, recipe: r }))
      : []));
    expect(benchable.length).toBeGreaterThan(0);
    const { uid: benchUid, recipe } = benchable[0];
    ch = expectOk(rules.applyBenchRecipe(ch, benchUid, recipe.id)).character;
    const benched = rules.findItem(ch, benchUid)!.item as EquipmentItem;
    expect(benched.affixes.filter((a) => a.crafted)).toEqual([expect.objectContaining({ affixId: recipe.affixId, tier: recipe.tier })]);
    expect(benched.history.at(-1)).toMatch(/^Bench: added .+ \(T\d+\)$/);
    expect(rules.describeItem(benched, ch).affixes.filter((l) => l.crafted)).toHaveLength(1);

    const save = { ...rules.newSave(), characters: [ch], lastCharacterId: ch.id };
    expect(rules.parseSave(rules.serializeSave(save))).toEqual(save);
  });
});
