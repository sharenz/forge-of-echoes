import { describe, expect, it } from 'vitest';
import { ATLAS_AREA_IDS, MAP_TREE_NODE_IDS, type MapTreeNodeId } from '../../src/contracts/atlas';
import { MAP_TREE } from '../../src/data/progression/map-tree';
import { rules, restoreRunSetup, withItemLocks } from '../../src/game';
import { createRng } from '../../src/core/rng';
import { discoverAfterBoss, newAtlas, normalizeAtlas } from '../../src/game/progression/atlas';
import { mapTreePoints } from '../../src/game/progression/map-tree';
import { mapEventOdds } from '../../src/game/progression/map-events';
import { categoryChances, currencyWeightsFor } from '../../src/game/progression/loot';
import { keystoneRewards } from '../../src/game/progression/keystones';
import { currencyOnHand } from '../../src/game/progression/merchant';
import { getBase, UNIQUES } from '../../src/data/items';
import { bareCharacter, currency, expectOk, kill, map, withBackpack } from './fixtures';

const completed = [...ATLAS_AREA_IDS];
function character(nodes: MapTreeNodeId[] = []) {
  return bareCharacter({ atlas: { discovered: completed, completed, clears: 50, nodes }, currencyStash: { scrap: 100 }, mapDevice: map('ashenForge', 10) });
}
const setup = (nodes: MapTreeNodeId[] = []) => expectOk(rules.openMap(character(nodes), 'heartOfForge')).setup;
const hooks = {} as Parameters<typeof rules.buildRunConfig>[1];

describe('map tree progression and payments', () => {
  it('has fifteen connected nodes and awards points only for distinct first completions, capped at ten', () => {
    expect(MAP_TREE.map(n => n.id)).toEqual(MAP_TREE_NODE_IDS);
    expect(new Set(MAP_TREE.map(n => n.id)).size).toBe(15);
    let progress = newAtlas();
    expect(mapTreePoints(progress)).toBe(0);
    progress = discoverAfterBoss(progress, 'cinderCrossing', false).progress;
    expect(mapTreePoints(progress)).toBe(1);
    progress = discoverAfterBoss(progress, 'cinderCrossing', false).progress;
    expect(mapTreePoints(progress)).toBe(1);
    for (const id of completed) progress = discoverAfterBoss(progress, id, false).progress;
    expect(mapTreePoints(progress)).toBe(10);
  });

  it('enforces prerequisites, the point budget and leaf refunds without touching character power', () => {
    let ch = character(); const stats = rules.deriveStats(ch), skills = ch.unspentSkillPoints;
    expect(rules.setMapTreeNode(ch, 'farHorizon', true).ok).toBe(false);
    for (const id of MAP_TREE_NODE_IDS.slice(0, 10)) ch = expectOk(rules.setMapTreeNode(ch, id, true));
    expect(rules.setMapTreeNode(ch, 'discerningEye', true).ok).toBe(false);
    expect(rules.setMapTreeNode(ch, 'trailblazer', false).ok).toBe(false);
    const before = currencyOnHand(ch, 'scrap');
    ch = expectOk(rules.setMapTreeNode(ch, 'farHorizon', false));
    expect(currencyOnHand(ch, 'scrap')).toBe(before - 5);
    ch = expectOk(rules.setMapTreeNode(ch, 'discerningEye', true));
    expect(ch.atlas!.nodes).toHaveLength(10);
    expect(rules.deriveStats(ch)).toEqual(stats); expect(ch.unspentSkillPoints).toBe(skills);
    expect(rules.setMapTreeNode(ch, 'discerningEye', true).ok).toBe(false);
    expect(rules.setMapTreeNode(ch, 'farHorizon', false).ok).toBe(false);
  });

  it('never spends locked Scrap, refuses unaffordable refunds and preserves allocations on failed payment', () => {
    const ch = withBackpack({ ...character(['trailblazer']), currencyStash: {} }, [[currency('scrap', 5), 0, 0]]);
    const uid = ch.backpack.entries[0].item.uid;
    const locked = withItemLocks(rules, () => new Set([uid]));
    expect(locked.setMapTreeNode(ch, 'trailblazer', false).ok).toBe(false);
    expect(ch.atlas!.nodes).toEqual(['trailblazer']); expect(currencyOnHand(ch, 'scrap')).toBe(5);
    const paid = expectOk(rules.setMapTreeNode(ch, 'trailblazer', false));
    expect(currencyOnHand(paid, 'scrap')).toBe(0); expect(paid.atlas!.nodes).toEqual([]);
    expect(rules.setMapTreeNode({ ...paid, atlas: ch.atlas }, 'trailblazer', false).ok).toBe(false);
  });

  it('normalizes legacy/invalid allocations and preserves valid choices on further Atlas credit and reload', () => {
    expect(normalizeAtlas({ completed: ['cinderCrossing'], nodes: ['farHorizon', 'trailblazer', 'chartKeeper', 'unknown'] }).nodes).toEqual(['trailblazer']);
    expect(normalizeAtlas({ completed: [], nodes: ['trailblazer'] }).nodes).toEqual([]);
    expect(normalizeAtlas({ completed, nodes: MAP_TREE_NODE_IDS }).nodes).toHaveLength(10);
    expect(normalizeAtlas(newAtlas())).toEqual(newAtlas());
    const ch = character(['trailblazer', 'chartKeeper']);
    expect(discoverAfterBoss(ch.atlas!, 'heartOfForge', false).progress.nodes).toEqual(ch.atlas!.nodes);
    const save = { ...rules.newSave(), characters: [ch], lastCharacterId: ch.id };
    expect(rules.parseSave(rules.serializeSave(save)).characters[0].atlas!.nodes).toEqual(ch.atlas!.nodes);
  });
});

describe('map tree affects the opening account’s expedition', () => {
  it('freezes choices through respec, party participation and server restart; legacy maps gain no nodes', () => {
    let ch = character(['scavenger', 'discerningEye', 'crownedChallenge']);
    const opened = expectOk(rules.openMap(ch, 'heartOfForge')).setup;
    ch = expectOk(rules.setMapTreeNode(ch, 'crownedChallenge', false));
    expect(opened.mapTree).toContain('crownedChallenge');
    expect(restoreRunSetup(JSON.stringify(opened), opened.seed)).toEqual(opened);
    expect(restoreRunSetup({ map: map() }, 1)!.mapTree).toBeUndefined();
    expect(rules.lootLuck(opened, character(['trailblazer']))).toEqual(rules.lootLuck(opened, character()));
    expect(rules.playerRuntime(ch, opened)).toEqual(rules.playerRuntime({ ...ch, atlas: undefined }, opened));
    const base = rules.buildRunConfig(setup(), hooks), empowered = rules.buildRunConfig(opened, hooks);
    expect(base.bossLifeMultiplier ?? 1).toBe(1); expect(empowered.bossLifeMultiplier).toBe(1.25);
    expect(opened.itemQuantity).toBe(105); expect(opened.itemRarity).toBe(160);
    expect(opened.summary.find(l => l.label === 'Map Item Quantity')!.breakdown).toContain('+5% Map tree: Scavenger');
    expect(keystoneRewards('heartOfForge', 10, opened.itemRarity, opened.mapTree)!.chance).toBeCloseTo(0.288);
  });

  it('changes actual map drops and chest advancement, retaining Compass guarantees and the tier cap', () => {
    const plain = setup(), chosen = setup(['trailblazer', 'chartKeeper', 'farHorizon']);
    expect(categoryChances(chosen, kill()).map / categoryChances(plain, kill()).map).toBeCloseTo(1.5);
    const count = (run: typeof plain) => {
      let upgrades = 0;
      for (let seed = 1; seed <= 1000; seed++) {
        const drops = rules.rollChestLoot(run, createRng(seed), bareCharacter());
        const first = drops.find(i => i.kind === 'map')!;
        if (first.kind === 'map' && first.tier > run.map.tier) upgrades++;
      }
      return upgrades / 1000;
    };
    expect(count(plain)).toBeCloseTo(0.25, 1); expect(count(chosen)).toBeCloseTo(0.4, 1);
    expect(count({ ...chosen, map: { ...chosen.map, charted: true } })).toBe(1);
    const cap = expectOk(rules.openMap({ ...character(chosen.mapTree), mapDevice: map('ashenForge', 15) }, 'heartOfForge')).setup;
    expect(count(cap)).toBe(0);
  });

  it('pays the boosted boss-exclusive chance and uses the encounter bonus in actual creation rolls', () => {
    const chosen = setup(['scavenger', 'discerningEye', 'crownedChallenge']);
    let exclusive = 0;
    for (let seed = 1; seed <= 1200; seed++) {
      exclusive += rules.rollKillLoot(chosen, kill({ kind: 'cinderMatriarch', isBoss: true }), createRng(seed), bareCharacter())
        .filter(i => i.kind === 'equipment' && i.uniqueId && UNIQUES[i.uniqueId].bossSource).length;
    }
    expect(exclusive / 1200).toBeCloseTo(keystoneRewards('heartOfForge', 10, chosen.itemRarity, chosen.mapTree)!.chance, 1);
    let plainEvents = 0, boostedEvents = 0;
    const plain = character(), boosted = character(['strangeSigns', 'echoCompass', 'beyondTheVeil']);
    for (let seed = 1; seed <= 1200; seed++) {
      plainEvents += expectOk(rules.openMap({ ...plain, rngState: seed }, 'heartOfForge')).setup.event ? 1 : 0;
      boostedEvents += expectOk(rules.openMap({ ...boosted, rngState: seed }, 'heartOfForge')).setup.event ? 1 : 0;
    }
    expect((boostedEvents - plainEvents) / 1200).toBeCloseTo(0.2, 1);
  });

  it('changes currency weights, armour Stability and monster difficulty through real run and loot rules', () => {
    const nodes: MapTreeNodeId[] = ['essenceSeeker', 'soundFoundations', 'deepSeams'];
    const plain = setup(), chosen = setup(nodes);
    const before = currencyWeightsFor(plain.map), after = currencyWeightsFor(chosen.map, nodes);
    expect(after.find(d => d.currencyId === 'essenceStorm')!.weight / before.find(d => d.currencyId === 'essenceStorm')!.weight).toBeCloseTo(1.875);
    expect(after.find(d => d.currencyId === 'scrap')!.weight).toBe(before.find(d => d.currencyId === 'scrap')!.weight);
    expect(rules.buildRunConfig(chosen, hooks).monsters.lifeMultiplier / rules.buildRunConfig(plain, hooks).monsters.lifeMultiplier).toBeCloseTo(1.1);
    let checked = 0;
    for (let seed = 0; seed < 100; seed++) for (const item of rules.rollChestLoot(chosen, createRng(seed), bareCharacter())) {
      if (item.kind !== 'equipment' || item.rarity === 'unique' || !['helmet', 'chest', 'gloves', 'boots'].includes(getBase(item.baseId).itemClass)) continue;
      expect(item.maxStability).toBe(getBase(item.baseId).maxStability + 1); checked++;
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('changes pack rarity, density and rewards, and adds encounter probability without replacing fixed chains', () => {
    const plain = setup(), chosen = setup(['markedPrey', 'crowdedGrounds', 'apexHunt']);
    const a = rules.buildRunConfig(plain, hooks).monsters, b = rules.buildRunConfig(chosen, hooks).monsters;
    expect(b.magicPackChance / a.magicPackChance).toBeCloseTo(1.6);
    expect(b.rarePackChance / a.rarePackChance).toBeCloseTo(1.6);
    expect(b.countMultiplier / a.countMultiplier).toBeCloseTo(1.1);
    expect(b.damageMultiplier / a.damageMultiplier).toBeCloseTo(1.05);
    expect(chosen.itemQuantity).toBe(105); expect(chosen.itemRarity).toBe(160);
    const nodes: MapTreeNodeId[] = ['strangeSigns', 'echoCompass', 'beyondTheVeil'];
    const eventRun = setup(nodes), old = mapEventOdds(plain.map, 'heartOfForge'), odds = mapEventOdds(plain.map, 'heartOfForge', nodes);
    const total = (v: typeof odds) => Object.values(v).reduce((a,b) => a+b, 0);
    expect(total(odds)).toBeCloseTo(total(old) + 0.2);
    for (const key of Object.keys(old) as (keyof typeof old)[]) expect(odds[key] / total(odds)).toBeCloseTo(old[key] / total(old));
    expect(rules.buildRunConfig(eventRun, hooks).monsters.lifeMultiplier / a.lifeMultiplier).toBeCloseTo(1.1);
    expect(eventRun.itemQuantity).toBe(105);
    expect(mapEventOdds({ ...plain.map, bounty: true }, 'heartOfForge', nodes).hunted).toBe(1);
    expect(mapEventOdds(plain.map, 'riftNexus', nodes)).toEqual(mapEventOdds(plain.map, 'riftNexus'));
    expect(total(mapEventOdds(plain.map, 'shrineField', nodes))).toBeLessThanOrEqual(1);
  });
});
