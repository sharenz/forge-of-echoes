import { describe, expect, it } from 'vitest';
import { ATLAS_AREA_IDS, ATLAS_TREE_VERSION } from '../../src/contracts/atlas';
import { MAP_TREE_POINTS } from '../../src/data/progression/map-tree';
import { rules, restoreRunSetup, withItemLocks } from '../../src/game';
import { createRng } from '../../src/core/rng';
import { atlasCreditFor, creditEventCompletion, discoverAfterBoss, newAtlas, normalizeAtlas, territoryEntryFee } from '../../src/game/progression/atlas';
import { resolveAtlasRules } from '../../src/game/progression/atlas-rules';
import { mapTreeBreakdown, mapTreeFreePoints, mapTreePoints, normalizeMapTree, refundCost, restoreExpeditionTree } from '../../src/game/progression/map-tree';
import { mapEventOdds } from '../../src/game/progression/map-events';
import { categoryChances, currencyWeightsFor } from '../../src/game/progression/loot';
import { keystoneRewards } from '../../src/game/progression/keystones';
import { currencyOnHand } from '../../src/game/progression/merchant';
import { UNIQUES } from '../../src/data/items';
import type { CharacterSave } from '../../src/contracts/items';
import { bareCharacter, currency, expectOk, kill, map, withBackpack } from './fixtures';
import { fullProgress, pathTo, treeCharacter } from './atlas-tree-helpers';

const setup = (nodes: string[] = [], tier = 10, base: Parameters<typeof map>[0] = 'ashenForge', area: Parameters<typeof rules.openMap>[1] = 'heartOfForge') =>
  expectOk(rules.openMap(treeCharacter(nodes, {}, tier, base), area)).setup;
const hooks = {} as Parameters<typeof rules.buildRunConfig>[1];
const allocate = (ch: ReturnType<typeof treeCharacter>, ids: string[]) => ids.reduce((c, id) => expectOk(rules.setMapTreeNode(c, id, true)), ch);

describe('atlas points: 60 first-time credits, a pure function of account progress', () => {
  it('awards areas, tiers, encounters, bosses and milestones exactly once', () => {
    expect(MAP_TREE_POINTS.total).toBe(60);
    expect(mapTreePoints(newAtlas())).toBe(0);
    let progress = discoverAfterBoss(newAtlas(), 'cinderCrossing', false, { tier: 1, boss: 'cinderMatriarch' }).progress;
    expect(mapTreeBreakdown(progress)).toMatchObject({ areas: 1, tiers: 0, bosses: 1, total: 2 }); // tier 1 earns nothing
    progress = discoverAfterBoss(progress, 'cinderCrossing', false, { tier: 2, boss: 'cinderMatriarch' }).progress;
    expect(mapTreeBreakdown(progress)).toMatchObject({ areas: 1, tiers: 1, bosses: 1, total: 3 });
    progress = discoverAfterBoss(progress, 'cinderCrossing', false, { tier: 2, boss: 'cinderMatriarch' }).progress;
    expect(mapTreePoints(progress)).toBe(3);
    expect(mapTreePoints(creditEventCompletion(creditEventCompletion(progress, 'stalker'), 'stalker'))).toBe(4);
    expect(mapTreePoints(creditEventCompletion(progress, 'notAnEvent'))).toBe(3);
    for (const id of ATLAS_AREA_IDS) progress = discoverAfterBoss(progress, id, false).progress;
    expect(mapTreeBreakdown(progress)).toMatchObject({ areas: 25, milestones: 3 });
    expect(mapTreePoints(fullProgress())).toBe(60);
  });

  it('credits the cleared tier and the area boss from a receipt, and nothing for a bossless area', () => {
    expect(atlasCreditFor('cinderCrossing', 4, 0.5)).toEqual({ revealRoll: 0.5, tier: 4, boss: 'cinderMatriarch' });
    expect(atlasCreditFor('shrineField', 3, 0.5)).toEqual({ revealRoll: 0.5, tier: 3 });
    expect(atlasCreditFor('cinderCrossing', 0, 0.5)).toEqual({ revealRoll: 0.5, boss: 'cinderMatriarch' }); // pre-tier receipts credit no tier
    const progress = discoverAfterBoss(newAtlas(), 'cinderCrossing', false, atlasCreditFor('cinderCrossing', 4, 0)).progress;
    expect(progress.tiersCleared).toEqual([4]); expect(progress.bossesSeen).toEqual(['cinderMatriarch']);
  });

  it('places the 50%, 75% and 100% milestones on 13, 19 and 25 areas', () => {
    const at = (n: number) => mapTreeBreakdown({ discovered: [], completed: ATLAS_AREA_IDS.slice(0, n), clears: n }).milestones;
    expect([at(12), at(13), at(18), at(19), at(24), at(25)]).toEqual([0, 1, 1, 2, 2, 3]);
  });
});

describe('allocation, exclusions and respec', () => {
  it('needs a connected path, charges keystones two points and refuses excluded and not-yet-live nodes', () => {
    let ch = treeCharacter();
    expect(rules.setMapTreeNode(ch, 'farHorizon', true).ok).toBe(false); // not connected
    expect(rules.setMapTreeNode(ch, 'origin', true).ok).toBe(false);
    expect(rules.setMapTreeNode(ch, 'no-such-node', true).ok).toBe(false);
    ch = allocate(ch, pathTo('emptyHalls'));
    const spent = ch.atlas!.nodes!.length;
    expect(ch.atlas!.nodes).toContain('emptyHalls');
    expect(mapTreePoints(ch.atlas) - mapTreeFreePoints(ch.atlas)).toBe(spent + 1); // keystone costs 2
    expect(rules.setMapTreeNode(ch, 'overrunDoctrine', true).ok).toBe(false); // excluded pair
    const excluded = rules.setMapTreeNode(allocate(treeCharacter(), pathTo('thrillOfTheHex')), 'emptyHalls', true);
    expect(excluded.ok).toBe(false);
    const pending = allocate(treeCharacter(), pathTo('wardedHunts').slice(0, -1));
    const refused = rules.setMapTreeNode(pending, 'wardedHunts', true); // a node whose engine is not built yet (sim)
    expect(refused.ok ? '' : refused.error).toMatch(/cannot be allocated yet/);
    // The encounter engine is live: a built encounter's lens allocates like any other notable.
    expect(allocate(treeCharacter(), pathTo('hunterPatience')).atlas!.nodes).toContain('hunterPatience');
    expect(rules.setMapTreeNode(treeCharacter(pathTo('waypoint')), 'waypoint', true).ok).toBe(false);
  });

  it('respects the point budget', () => {
    const ch = treeCharacter([], { atlas: { ...fullProgress(), completed: ['cinderCrossing'], tiersCleared: [], eventsSeen: [], bossesSeen: [] } });
    expect(mapTreePoints(ch.atlas)).toBe(1);
    const one = allocate(ch, ['waypoint']);
    expect(rules.setMapTreeNode(one, 'milestone', true).ok).toBe(false);
    expect(normalizeMapTree(pathTo('chartKeeper'), 2)).toEqual(['waypoint', 'milestone']);
  });

  it('refunds only nodes whose removal keeps the rest connected, and never touches character power', () => {
    let ch = allocate(treeCharacter(), pathTo('chartKeeper'));
    const stats = rules.deriveStats(ch), skills = ch.unspentSkillPoints;
    expect(rules.setMapTreeNode(ch, 'waypoint', false).ok).toBe(false); // milestone hangs on it
    ch = expectOk(rules.setMapTreeNode(ch, 'chartKeeper', false));
    expect(ch.atlas!.nodes).toEqual(['waypoint', 'milestone', 'cairn']);
    expect(rules.deriveStats(ch)).toEqual(stats); expect(ch.unspentSkillPoints).toBe(skills);
  });

  it('makes the first six refunds free, then charges by class and caps a session at 120 Scrap', () => {
    const path = pathTo('emptyHalls');
    const reverse = [...path].reverse();
    let ch = allocate(treeCharacter(), path);
    const scrap = () => currencyOnHand(ch, 'scrap');
    for (const id of reverse.slice(0, 6)) ch = expectOk(rules.setMapTreeNode(ch, id, false));
    expect(ch.atlas!.refunds).toBe(6);
    expect(scrap()).toBe(1000); // the keystone, a notable and four smalls were free
    ch = expectOk(rules.setMapTreeNode(ch, reverse[6], false));
    expect(scrap()).toBe(995); // seventh refund: small = 5
    expect(ch.atlas!.respecSpent).toBe(5);
    // rebuild, then refund keystone 40 and notable 15
    ch = allocate(ch, pathTo('emptyHalls').filter(id => !ch.atlas!.nodes!.includes(id)));
    const before = scrap();
    ch = expectOk(rules.setMapTreeNode(ch, 'emptyHalls', false));
    expect(before - scrap()).toBe(40);
    for (const id of ['cullersLedger', 'bonePile', 'packLeaders']) ch = expectOk(rules.setMapTreeNode(ch, id, false));
    expect(before - scrap()).toBe(55);
    ch = expectOk(rules.setMapTreeNode(ch, 'rareBlood', false));
    expect(before - scrap()).toBe(70);
    // a session never costs more than 120
    ch = { ...ch, atlas: { ...ch.atlas!, respecSpent: 110 } };
    const start = scrap();
    ch = expectOk(rules.setMapTreeNode(ch, 'ironHides', false));
    expect(start - scrap()).toBe(5);
    expect(ch.atlas!.respecSpent).toBe(115);
    ch = allocate(ch, ['ironHides']);
    ch = { ...ch, atlas: { ...ch.atlas!, respecSpent: 110 } };
    ch = allocate(ch, ['rareBlood']);
    ch = expectOk(rules.setMapTreeNode(ch, 'rareBlood', false)); // notable 15, only 10 left in the session
    expect(ch.atlas!.respecSpent).toBe(120);
    const free = scrap();
    ch = expectOk(rules.setMapTreeNode(ch, 'ironHides', false));
    expect(scrap()).toBe(free); // cap reached: free
    // opening a map ends the session
    const opened = expectOk(rules.openMap({ ...ch, mapDevice: map('ashenForge', 1) }, 'cinderCrossing')).character;
    expect(opened.atlas!.respecSpent).toBe(0);
  });

  it('never spends locked Scrap, refuses unaffordable refunds and preserves allocations on failed payment', () => {
    const base = treeCharacter(pathTo('waypoint'), { currencyStash: {} });
    let ch: CharacterSave = { ...base, atlas: { ...base.atlas!, refunds: 6 } };
    ch = withBackpack(ch, [[currency('scrap', 5), 0, 0]]);
    const uid = ch.backpack.entries[0].item.uid;
    const locked = withItemLocks(rules, () => new Set([uid]));
    expect(locked.setMapTreeNode(ch, 'waypoint', false).ok).toBe(false);
    expect(ch.atlas!.nodes).toEqual(['waypoint']); expect(currencyOnHand(ch, 'scrap')).toBe(5);
    const paid = expectOk(rules.setMapTreeNode(ch, 'waypoint', false));
    expect(currencyOnHand(paid, 'scrap')).toBe(0); expect(paid.atlas!.nodes).toEqual([]);
    expect(rules.setMapTreeNode({ ...paid, atlas: ch.atlas }, 'waypoint', false).ok).toBe(false); // no Scrap left to pay with
  });
});

describe('save migration', () => {
  it('drops the old 15-node allocation once, free, and keeps every point earned', () => {
    const legacy = { discovered: ['cinderCrossing'], completed: ['cinderCrossing', 'emberRoad'], clears: 2, nodes: ['trailblazer', 'chartKeeper'] };
    const migrated = normalizeAtlas(legacy);
    expect(migrated.treeVersion).toBe(ATLAS_TREE_VERSION);
    expect(migrated.nodes).toEqual([]);
    expect(migrated.redrawn).toBe(true);
    expect(mapTreePoints(migrated)).toBe(mapTreePoints(normalizeAtlas({ ...legacy, nodes: undefined })));
    expect(mapTreeFreePoints(migrated)).toBe(2);
    expect(normalizeAtlas(migrated)).toEqual(migrated); // idempotent: not refunded again
    const again = normalizeAtlas({ ...migrated, nodes: ['waypoint'] });
    expect(again.nodes).toEqual(['waypoint']);
    expect(normalizeAtlas({ completed: [], nodes: ['trailblazer'] }).nodes).toEqual([]);
    expect(normalizeAtlas({ ...migrated, nodes: ['waypoint', 'farHorizon', 'unknown', 'emptyHalls'] }).nodes).toEqual(['waypoint']);
    expect(normalizeAtlas(newAtlas())).toEqual(newAtlas());
  });

  it('normalises credits and never trusts hostile fields', () => {
    const atlas = normalizeAtlas({ ...newAtlas(), tiersCleared: [1, 2, 2, 99, 'x', 15], eventsSeen: ['stalker', 'bogus', 'stalker'], bossesSeen: ['varkus', 'nobody'], refunds: -4, respecSpent: 'lots' });
    expect(atlas.tiersCleared).toEqual([2, 15]);
    expect(atlas.eventsSeen).toEqual(['stalker']);
    expect(atlas.bossesSeen).toEqual(['varkus']);
    expect(atlas.refunds).toBeUndefined(); expect(atlas.respecSpent).toBeUndefined();
  });

  it('survives a save round trip', () => {
    const ch = allocate(treeCharacter(), pathTo('farHorizon'));
    const save = { ...rules.newSave(), characters: [ch], lastCharacterId: ch.id };
    const back = rules.parseSave(rules.serializeSave(save)).characters[0].atlas!;
    expect(back.nodes).toEqual(ch.atlas!.nodes);
    expect(back.treeVersion).toBe(ATLAS_TREE_VERSION);
  });

  it('keeps expeditions frozen before the redraw on their legacy numbers', () => {
    expect(restoreExpeditionTree(['scavenger', 'crownedChallenge'], undefined)).toEqual(['legacy:scavenger', 'legacy:crownedChallenge']);
    expect(restoreExpeditionTree(['legacy:scavenger', 'junk'], undefined)).toEqual(['legacy:scavenger']);
    expect(restoreExpeditionTree(['scavenger', 'legacy:deepSeams'], ATLAS_TREE_VERSION)).toEqual(['scavenger', 'legacy:deepSeams']);
    const restored = restoreRunSetup({ map: map('ashenForge', 10), atlasAreaId: 'heartOfForge', mapTree: ['scavenger', 'discerningEye', 'crownedChallenge'] }, 7)!;
    expect(restored.mapTree).toEqual(['legacy:scavenger', 'legacy:discerningEye', 'legacy:crownedChallenge']);
    expect(restored.itemQuantity).toBe(105); expect(restored.itemRarity).toBe(160);
    expect(rules.buildRunConfig(restored, hooks).bossLifeMultiplier).toBe(1.25);
    // and persisting a restored old run keeps it legacy (ids carry the prefix)
    expect(restoreRunSetup(JSON.stringify(restored), restored.seed)!.mapTree).toEqual(restored.mapTree);
  });
});

describe('the tree changes the opening account’s expedition', () => {
  it('freezes choices through respec, restarts and party play; legacy runs gain no nodes', () => {
    let ch = allocate(treeCharacter(), pathTo('crownedChallenge'));
    const opened = expectOk(rules.openMap(ch, 'heartOfForge')).setup;
    ch = expectOk(rules.setMapTreeNode(ch, 'crownedChallenge', false));
    expect(opened.mapTree).toContain('crownedChallenge');
    expect(opened.mapTreeV).toBe(ATLAS_TREE_VERSION);
    expect(restoreRunSetup(JSON.stringify(opened), opened.seed)).toEqual(opened);
    expect(restoreRunSetup({ map: map() }, 1)!.mapTree).toBeUndefined();
    expect(rules.lootLuck(opened, treeCharacter(pathTo('scavenger')))).toEqual(rules.lootLuck(opened, treeCharacter()));
    expect(rules.playerRuntime(ch, opened)).toEqual(rules.playerRuntime({ ...ch, atlas: undefined }, opened));
    const base = rules.buildRunConfig(setup(), hooks), empowered = rules.buildRunConfig(opened, hooks);
    expect(base.bossLifeMultiplier ?? 1).toBe(1); expect(empowered.bossLifeMultiplier).toBe(1.25);
    const line = opened.summary.find(l => l.label === 'Map Item Quantity')!.breakdown;
    expect(line).toContain('+3% Atlas: Scavenger');
    expect(opened.summary.find(l => l.label === 'Atlas tree')!.value).toMatch(/nodes$/);
  });

  it('adds tree quantity and rarity to the map luck with honest sources, capped', () => {
    const nodes = pathTo('gilder');
    const run = setup(nodes);
    // scavenger 3 + gemEyed 3 quantity; discerningEye 4 + gilder 4 rarity; tier 10 gives 145% rarity
    expect(run.itemQuantity).toBe(106); expect(run.itemRarity).toBe(153);
    const summary = run.summary.find(l => l.label === 'Map Item Rarity')!.breakdown;
    expect(summary).toContain('+4% Atlas: Discerning Eye');
  });

  it('changes actual map drops and chest advancement, retaining Compass guarantees and the tier cap', () => {
    const chosen = setup(pathTo('farHorizon')), plain = setup();
    // waypoint 8 + milestone 8 + chartKeeper 22 (+ trailmark not on path) = 38% increased map drop chance
    expect(categoryChances(chosen, kill()).map / categoryChances(plain, kill()).map).toBeCloseTo(1.38);
    const count = (run: typeof plain) => {
      let upgrades = 0;
      for (let seed = 1; seed <= 1000; seed++) {
        const drops = rules.rollChestLoot(run, createRng(seed), bareCharacter());
        const first = drops.find(i => i.kind === 'map')!;
        if (first.kind === 'map' && first.tier > run.map.tier) upgrades++;
      }
      return upgrades / 1000;
    };
    expect(count(plain)).toBeCloseTo(0.25, 1); expect(count(chosen)).toBeCloseTo(0.35, 1);
    expect(count({ ...chosen, map: { ...chosen.map, charted: true } })).toBe(1);
    const cap = setup(pathTo('farHorizon'), 15);
    expect(count(cap)).toBe(0);
  });

  it('pays the boosted boss-exclusive chance', () => {
    const chosen = setup(pathTo('crownedChallenge'));
    let exclusive = 0;
    for (let seed = 1; seed <= 1200; seed++) {
      exclusive += rules.rollKillLoot(chosen, kill({ kind: 'cinderMatriarch', isBoss: true }), createRng(seed), bareCharacter())
        .filter(i => i.kind === 'equipment' && i.uniqueId && UNIQUES[i.uniqueId].bossSource).length;
    }
    const chance = keystoneRewards('heartOfForge', 10, chosen.itemRarity, chosen.mapTree)!.chance;
    expect(exclusive / 1200).toBeCloseTo(chance, 1);
    expect(chance).toBeCloseTo(0.12 * chosen.itemRarity / 100 * 1.5, 5);
  });

  it('reweights essences and currencies, raises armour Stability and adds monster life through run and loot rules', () => {
    const nodes = pathTo('deepSeams', 'soundFoundations', 'scrapper');
    const plain = setup(), chosen = setup(nodes);
    const before = currencyWeightsFor(plain.map), after = currencyWeightsFor(chosen.map, nodes);
    // essenceSeeker 8% increased, then Deep Seams 40% more
    expect(after.find(d => d.currencyId === 'essenceStorm')!.weight / before.find(d => d.currencyId === 'essenceStorm')!.weight).toBeCloseTo(1.08 * 1.4);
    expect(after.find(d => d.currencyId === 'scrap')!.weight / before.find(d => d.currencyId === 'scrap')!.weight).toBeCloseTo(1.08); // Scrapper
    expect(rules.buildRunConfig(chosen, hooks).monsters.lifeMultiplier / rules.buildRunConfig(plain, hooks).monsters.lifeMultiplier).toBeCloseTo(1.05);
    let checked = 0;
    for (let seed = 0; seed < 100; seed++) for (const item of rules.rollChestLoot(chosen, createRng(seed), bareCharacter())) {
      if (item.kind !== 'equipment' || item.rarity === 'unique') continue;
      checked++;
      expect(item.maxStability).toBeGreaterThanOrEqual(1);
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('applies each structural keystone through the real rules', () => {
    const plain = setup();
    const a = rules.buildRunConfig(plain, hooks);
    // Early Crown: boss on wave 3
    const early = rules.buildRunConfig(setup(pathTo('earlyCrown')), hooks);
    expect(a.waves.bossWave).toBe(6); expect(early.waves.bossWave).toBe(3);
    // Overrun Doctrine: waves 30% shorter, never below 25 s even with Haste
    const over = rules.buildRunConfig(setup(pathTo('overrunDoctrine')), hooks);
    expect(a.waves.waveDuration).toBe(60); expect(over.waves.waveDuration).toBeCloseTo(42);
    // Rare or Nothing: no magic packs, rare packs x3
    const ron = rules.buildRunConfig(setup(pathTo('rareOrNothing')), hooks).monsters;
    expect(ron.magicPackChance).toBe(0); expect(ron.rarePackChance / a.monsters.rarePackChance).toBeGreaterThan(3);
    // Empty Halls: half the monsters, harder, each worth more
    const halls = setup(pathTo('emptyHalls')), h = rules.buildRunConfig(halls, hooks).monsters;
    expect(h.countMultiplier / a.monsters.countMultiplier).toBeCloseTo(0.53);
    expect(h.lifeMultiplier / a.monsters.lifeMultiplier).toBeGreaterThan(1.6);
    // Blank Slate: every equipment drop is Normal
    const blank = setup(pathTo('blankSlate'));
    let normal = 0, other = 0;
    for (let seed = 0; seed < 200; seed++) for (const item of [...rules.rollChestLoot(blank, createRng(seed), bareCharacter()), ...rules.rollKillLoot(blank, kill({ kind: 'cinderMatriarch', isBoss: true, rarity: 'rare' }), createRng(seed), bareCharacter())]) {
      if (item.kind === 'equipment' && item.rarity !== 'unique') { if (item.rarity === 'normal') normal++; else other++; }
    }
    expect(other).toBe(0); expect(normal).toBeGreaterThan(200);
    // Kingslayer's Tithe: double boss and chest currency
    const tithe = setup(pathTo('kingslayersTithe'));
    const currencyOf = (run: typeof plain, chest: boolean) => {
      let n = 0;
      for (let seed = 0; seed < 100; seed++) n += (chest ? rules.rollChestLoot(run, createRng(seed), bareCharacter())
        : rules.rollKillLoot(run, kill({ kind: 'cinderMatriarch', isBoss: true }), createRng(seed), bareCharacter())).filter(i => i.kind === 'currency').length;
      return n;
    };
    expect(currencyOf(tithe, true) / currencyOf(plain, true)).toBeGreaterThan(1.8);
    expect(currencyOf(tithe, false) / currencyOf(plain, false)).toBeGreaterThan(1.6);
  });

  it('applies Thrill of the Hex to both sides of danger mods and caps the tree', () => {
    const dangerous = { ...map('ashenForge', 10), mods: [{ modId: 'teeming', value: 100 }], rarity: 'magic' as const };
    const withNodes = (nodes: string[]) => expectOk(rules.openMap({ ...treeCharacter(nodes), mapDevice: dangerous }, 'heartOfForge')).setup;
    const plain = withNodes([]), hex = withNodes(pathTo('thrillOfTheHex'));
    const cfg = (s: typeof plain) => rules.buildRunConfig(s, hooks).monsters.countMultiplier;
    expect(cfg(hex) / cfg(plain)).toBeGreaterThan(1.1);
    expect(hex.itemQuantity).toBeGreaterThan(plain.itemQuantity + 8); // reward side strengthened too
  });

  it('applies conditional effects: dead ends versus through routes, and theme seals only on their base', () => {
    const dead = setup(pathTo('deadEndDevotee'), 3, 'ashenForge', 'emberVault');
    const through = setup(pathTo('deadEndDevotee'), 5, 'ashenForge', 'heartOfForge');
    const noDevotee = (area: Parameters<typeof rules.openMap>[1]) => setup([], area === 'emberVault' ? 3 : 5, 'ashenForge', area);
    expect(dead.itemQuantity / noDevotee('emberVault').itemQuantity).toBeCloseTo(1.24, 2);
    expect(through.itemQuantity / noDevotee('heartOfForge').itemQuantity).toBeCloseTo(0.75, 2);
    const seal = pathTo('emberwrightsDue');
    const on = resolveAtlasRules(seal, { tier: 5, baseId: 'ashenForge', corrupted: false }).modifiers.filter(m => m.source === "Atlas: Emberwright's Due");
    const off = resolveAtlasRules(seal, { tier: 5, baseId: 'cinderChapel', corrupted: false }).modifiers.filter(m => m.source === "Atlas: Emberwright's Due");
    expect(on.map(m => m.stat).sort()).toEqual(['emberEssenceChance', 'monsterResist']);
    expect(off).toEqual([]);
    // the essence weight really moves in the loot table on the seal's own theme
    const ember = (base: 'ashenForge' | 'cinderChapel', nodes: string[]) => currencyWeightsFor(map(base, 5), nodes, {}).find(d => d.currencyId === 'essenceEmber')!.weight;
    expect(ember('ashenForge', seal) / ember('ashenForge', seal.filter(id => id !== 'emberwrightsDue'))).toBeCloseTo(1.35, 5);
    expect(ember('cinderChapel', seal)).toBeCloseTo(ember('cinderChapel', seal.filter(id => id !== 'emberwrightsDue')), 10);
  });

  it('scales tier-bonus nodes with the opened map tier', () => {
    const nodes = pathTo('risingStakes');
    const low = setup(nodes, 3), high = setup(nodes, 12);
    expect(high.itemQuantity - low.itemQuantity).toBeCloseTo(0.6 * 9, 5);
  });

  it('adds encounter probability without replacing fixed chains, capped at 12 percentage points', () => {
    const plain = setup();
    const nodes = pathTo('strangeSigns', 'omenReader', 'faintSignal', 'whisper');
    const old = mapEventOdds(plain.map, 'heartOfForge'), odds = mapEventOdds(plain.map, 'heartOfForge', nodes);
    const total = (v: typeof odds) => Object.values(v).reduce((a, b) => a + b, 0);
    expect(total(odds)).toBeCloseTo(total(old) + 0.02 * 4 + 0, 5);
    expect(mapEventOdds({ ...plain.map, bounty: true }, 'heartOfForge', nodes).hunted).toBe(1);
    const many = mapEventOdds(plain.map, 'heartOfForge', [...nodes, ...pathTo('omenGold', 'fatedSpoils', 'dreadOmen')]);
    expect(total(many)).toBeLessThanOrEqual(total(old) + 0.12 + 1e-9);
  });

  it('gives Ledgerline a cheaper territory fee (never below zero) and Master Surveyor extra reveals', () => {
    expect(territoryEntryFee(10, 'heartOfForge')).toBe(3);
    expect(territoryEntryFee(10, 'heartOfForge', ['ledgerline'])).toBe(2);
    expect(territoryEntryFee(2, 'heartOfForge', ['ledgerline'])).toBe(0);
    const start = { ...newAtlas(), nodes: pathTo('masterSurveyor') };
    const revealed = (roll: number) => discoverAfterBoss(start, 'cinderCrossing', false, { revealRoll: roll }).revealed.length;
    expect(revealed(0.9)).toBe(2); expect(revealed(0.1)).toBe(2); // cinderCrossing has only two neighbours
    const four = { ...newAtlas(), discovered: ['cinderCrossing'] as never, nodes: pathTo('masterSurveyor') };
    expect(discoverAfterBoss(four, 'emberVault', false, { revealRoll: 0.1 }).revealed.length).toBeGreaterThanOrEqual(1);
    const devotee = { ...newAtlas(), nodes: pathTo('deadEndDevotee') };
    expect(discoverAfterBoss(devotee, 'cinderCrossing', false).revealed.length).toBe(2 - 1 + 1 - 1 + 1 - 0 > 0 ? 1 : 0);
  });
});
