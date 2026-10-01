// The chart lenses and the dock's passage rules (brief D 3, 11): pure view models over the character and the frozen routing table.
import { describe, expect, it } from 'vitest';
import type { AtlasAreaId, AtlasProgress } from '../../src/contracts/atlas';
import type { CharacterSave, MapItem } from '../../src/contracts/items';
import { LENSES, DEFAULT_LENS, formatShare, sourceEdges, stockBand, stockByArea, topSources } from '../../src/ui/atlas/lens';
import { passageOptions, passageRefusal } from '../../src/ui/atlas/passage';
import { allNodeModels, nodeModel } from '../../src/ui/atlas/model';
import { ATLAS_AREAS, findAtlasArea } from '../../src/data/progression/atlas';
import { newAtlas, pinSlotCount } from '../../src/game/progression/atlas';
import { buildRouting, routingBiasFor, routingReadout } from '../../src/game/progression/map-routing';
import { bareCharacter, currency, map, withBackpack } from '../game-progression/fixtures';
import { groupMapStash, areaSortKey } from '../../src/ui/lib/stash';

const atlasOf = (discovered: AtlasAreaId[], extra: Partial<AtlasProgress> = {}): AtlasProgress => ({ ...newAtlas(), discovered, ...extra });

describe('lens model', () => {
  it('defaults to Stock; Territory is a stub that stays hidden until beacons ship', () => {
    expect(DEFAULT_LENS).toBe('stock');
    expect(LENSES.map((l) => [l.id, l.available])).toEqual([['stock', true], ['sources', true], ['territory', false]]);
  });

  it('counts the maps you hold per area across backpack, stash, Map Stash and work slot, not the one in the device', () => {
    const ch: CharacterSave = withBackpack(bareCharacter({
      mapStash: [map('emberRoad', 3, { uid: 's1' }), map('furnaceYard', 7, { uid: 's2' })],
      mapDevice: map('emberRoad', 2, { uid: 'dev' }),
      craftSlot: map('emberRoad', 9, { uid: 'work' }),
    }), [[map('emberRoad', 1, { uid: 'b1' }), 0, 0], [currency('scrap', 3, 'sc'), 1, 0]]);
    const stock = stockByArea(ch);
    expect(stock.get('emberRoad')).toMatchObject({ count: 3, tiers: [1, 3, 9], lowest: 1, highest: 9 });
    expect(stock.get('furnaceYard')).toMatchObject({ count: 1, highest: 7 });
    expect(stock.size).toBe(2);
    expect(stockByArea(null).size).toBe(0);
    expect([1, 5, 6, 10, 11, 15].map(stockBand)).toEqual(['low', 'low', 'mid', 'mid', 'high', 'high']);
  });

  it('puts pins and stock on the node models', () => {
    const stock = stockByArea(withBackpack(bareCharacter(), [[map('emberRoad', 2, { uid: 'x' }), 0, 0]]));
    const ctx = { discovered: new Set(['cinderCrossing', 'emberRoad']), completed: new Set<string>(), tier: null, keys: new Set<string>(), fresh: new Set<string>(), corrupted: false, pins: new Set(['emberRoad', 'furnaceYard']), stock };
    const models = new Map(allNodeModels(ctx).map((m) => [m.id, m]));
    expect(models.get('emberRoad')).toMatchObject({ pinned: true, stock: { count: 1 } });
    expect(models.get('cinderCrossing')).toMatchObject({ pinned: false, stock: null });
    // an undiscovered area never wears a pin (the chart would otherwise leak it)
    expect(models.get('furnaceYard')!.pinned).toBe(false);
    expect(nodeModel(findAtlasArea('emberRoad')!, { ...ctx, pins: undefined, stock: undefined })).toMatchObject({ pinned: false, stock: null });
  });
});

describe('Sources: the readout of the frozen table', () => {
  const atlas = atlasOf(['cinderCrossing', 'emberRoad', 'boneApproach', 'furnaceYard', 'emberVault'], { pins: ['furnaceYard'] });
  const routing = buildRouting({ from: 'emberRoad', atlas, tier: 3, bias: routingBiasFor(atlas) })!;
  const readout = routingReadout(routing, 3, new Set(atlas.discovered));

  it('draws an arrow for every area that receives drops, strongest first, never for the area itself', () => {
    const edges = sourceEdges(readout);
    expect(edges.every((e) => e.to !== 'emberRoad')).toBe(true);
    expect(edges.map((e) => e.share)).toEqual([...edges.map((e) => e.share)].sort((a, b) => b - a));
    const pinned = edges.find((e) => e.to === 'furnaceYard')!;
    expect(pinned).toMatchObject({ pinned: true });
    expect(pinned.share).toBeGreaterThanOrEqual(0.4);
    expect(pinned.label).toBe(formatShare(pinned.share));
  });

  it('summarises the top rows for the dock, naming the own area "this area"', () => {
    const top = topSources(readout, 4);
    expect(top.length).toBeGreaterThan(1);
    expect(top[0].areaId).toBe('furnaceYard');
    expect(top.find((t) => t.own)?.name).toBe('this area');
    expect(topSources(null)).toEqual([]);
    expect(sourceEdges(null)).toEqual([]);
  });

  it('formats shares the way the readout does', () => {
    expect([0.004, 0.234, 0.5, 0.996, 1].map(formatShare)).toEqual(['<1%', '23%', '50%', '100%', '100%']);
  });
});

describe('passage slot rules', () => {
  const atlas = atlasOf(['cinderCrossing', 'emberRoad', 'boneApproach', 'ironMarch', 'pitOfEchoes', 'sealedReliquary']);
  const held = new Set(['reliquaryKey']);

  it('offers a held key whose area is charted and takes the tier, and the Pit for a Bounty map beside it', () => {
    const m = map('rimedOssuary', 3); // Bone Approach
    const opts = passageOptions(m, atlas, held);
    expect(opts.map((o) => o.id)).toEqual(['key:reliquaryKey']);
    const bounty: MapItem = { ...map('ironMarch', 3), bounty: true };
    expect(passageOptions(bounty, atlas, new Set()).map((o) => o.id)).toEqual(['pit']);
    expect(passageOptions(bounty, atlas, held).map((o) => o.id)).toEqual(['key:reliquaryKey', 'pit']);
    expect(passageOptions(null, atlas, held)).toEqual([]);
    // an uncharted door offers nothing
    expect(passageOptions(m, atlasOf(['cinderCrossing']), held)).toEqual([]);
  });

  it('says why a dropped currency cannot be a passage', () => {
    const m = map('rimedOssuary', 3);
    expect(passageRefusal(m, atlas, held, 'reliquaryKey')).toBeNull();
    expect(passageRefusal(m, atlas, held, 'scrap')).toMatch(/Only a key/);
    expect(passageRefusal(null, atlas, held, 'reliquaryKey')).toMatch(/Slot a map first/);
    expect(passageRefusal(m, atlasOf(['cinderCrossing']), held, 'reliquaryKey')).toMatch(/not charted/);
    expect(passageRefusal(m, atlas, new Set(), 'reliquaryKey')).toMatch(/inventory/);
    expect(passageRefusal(map('rimedOssuary', 9), atlas, held, 'reliquaryKey')).toMatch(/accepts maps up to Tier/);
  });
});

describe('Map Stash grouped by area', () => {
  it('sections a tier by area in chart region order, then depth, with each area\'s maps best first', () => {
    const maps = [
      map('furnaceYard', 5, { uid: 'f1' }), map('boneApproach', 3, { uid: 'o1' }), map('emberRoad', 3, { uid: 'e1' }),
      map('emberRoad', 3, { uid: 'e2', mods: [{ modId: 'x', value: 1 }] }), map('furnaceYard', 3, { uid: 'f2' }),
    ];
    const t3 = groupMapStash(maps)[2];
    expect(t3.sections.map((s) => [s.areaId, s.maps.length])).toEqual([['emberRoad', 2], ['furnaceYard', 1], ['boneApproach', 1]]);
    expect(t3.sections[0]).toMatchObject({ name: 'Ember Road', baseId: 'ashenForge' });
    expect(areaSortKey('emberRoad')[0]).toBeLessThan(areaSortKey('boneApproach')[0]);
    expect(groupMapStash(maps)[4].sections.map((s) => s.areaId)).toEqual(['furnaceYard']);
  });
});

describe('pin slots', () => {
  it('are 3 at rest', () => {
    expect(pinSlotCount(undefined)).toBe(3);
    expect(ATLAS_AREAS.length).toBeGreaterThan(20);
  });
});
