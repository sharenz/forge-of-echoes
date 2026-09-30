import { describe, expect, it } from 'vitest';
import { ATLAS_AREA_IDS, type AtlasAreaId } from '../../src/contracts/atlas';
import { ITEM_CLASSES } from '../../src/contracts/content';
import type { MapEventPlan } from '../../src/contracts/map-events';
import { ATLAS_AREAS, ATLAS_KEYS, ATLAS_START, atlasTierCeiling, findAtlasArea } from '../../src/data/progression/atlas';
import { getBase } from '../../src/data/items';
import { rules, restoreRunSetup, redactSetupForClient, withItemLocks } from '../../src/game';
import { mapEventOdds } from '../../src/game/progression/map-events';
import { categoryChances, killLuck } from '../../src/game/progression/loot';
import { currencyOnHand } from '../../src/game/progression/merchant';
import { createRng } from '../../src/core/rng';
import { bareCharacter, equip, expectOk, kill, map, withBackpack } from './fixtures';

const explored = { discovered: [...ATLAS_AREA_IDS], completed: [], clears: 0 };
const character = (tier = 3) => bareCharacter({ atlas: explored, mapDevice: map('ashenForge', tier),
  currencyStash: { scrap: 100, reliquaryKey: 2, gildedKey: 2, blackKey: 2, huntingKey: 2, riftKey: 2 } });
const expedition = (id: AtlasAreaId, tier = 3) => expectOk(rules.openMap(character(tier), id, 'ring')).setup;
function sequence(plan: MapEventPlan | null | undefined): MapEventPlan[] {
  return plan ? [plan, ...sequence(plan.next)] : [];
}

describe('extended Atlas routes and entry', () => {
  it('keeps every T10+ main route reachable when any one other non-start area is removed', () => {
    const targets = ATLAS_AREAS.filter(a => !a.sealed && !a.deadEnd && atlasTierCeiling(a) >= 10);
    expect(targets.map(atlasTierCeiling)).toEqual([11, 11, 13, 13, 15, 15]);
    for (const target of targets) for (const removed of ATLAS_AREAS.filter(a => a.id !== target.id && a.id !== ATLAS_START)) {
      const seen = new Set<AtlasAreaId>([ATLAS_START]), todo: AtlasAreaId[] = [ATLAS_START];
      while (todo.length) for (const next of findAtlasArea(todo.pop())!.neighbours) {
        if (next !== removed.id && !seen.has(next)) { seen.add(next); todo.push(next); }
      }
      expect(seen.has(target.id), `${target.id} without ${removed.id}`).toBe(true);
    }
    for (const area of ATLAS_AREAS.filter(a => a.deadEnd)) {
      expect(area.neighbours).toHaveLength(1);
      expect(atlasTierCeiling(area)).toBe(atlasTierCeiling(findAtlasArea(area.neighbours[0])!));
    }
  });

  it('pays only the correct key, retains its receipt and refuses offered keys without mutation', () => {
    for (const key of ATLAS_KEYS) {
      const ch = character(), before = structuredClone(ch);
      const r = expectOk(rules.openMap(ch, key.areaId, 'ring'));
      expect(r.setup.entranceKey).toBe(key.currencyId);
      expect(currencyOnHand(r.character, key.currencyId)).toBe(currencyOnHand(ch, key.currencyId) - 1);
      expect(restoreRunSetup(JSON.stringify(r.setup), r.setup.seed)).toEqual(r.setup);
      const empty = { ...ch, currencyStash: {} };
      expect(rules.openMap(empty, key.areaId, 'ring').ok).toBe(false);
      const offered = withBackpack(empty, [[{ kind: 'currency', uid: 'key', currencyId: key.currencyId, count: 1 }, 0, 0]]);
      expect(withItemLocks(rules, () => new Set(['key'])).openMap(offered, key.areaId, 'ring').ok).toBe(false);
      expect(ch).toEqual(before);
    }
  });

  it('requires a Bounty map for the Pit and preserves the original item separately from its guaranteed Echo', () => {
    const ch = character(5);
    expect(rules.openMap(ch, 'pitOfEchoes').ok).toBe(false);
    const source = { ...ch.mapDevice!, bounty: true };
    const setup = expectOk(rules.openMap({ ...ch, mapDevice: source }, 'pitOfEchoes')).setup;
    expect(setup.sourceMap).toEqual(source);
    expect(setup.map.mods.filter(m => m.modId === 'echo')).toHaveLength(1);
    expect(setup.event?.kind).toBe('hunted');
    const cfg = rules.buildRunConfig(setup, {} as never);
    expect(cfg.waves.count).toBe(7); expect(cfg.waves.bossWave).toBe(6);
    expect(cfg).toMatchObject({ bossLifeMultiplier: 1.5, bossDamageMultiplier: 1.25 });
    expect(restoreRunSetup(setup, setup.seed)).toEqual(setup);
    const echo = killLuck(setup, kill({ wave: 7 }), bareCharacter());
    expect(echo.quantity).toBe(killLuck(setup, kill({ wave: 6 }), bareCharacter()).quantity * 2);
  });

  it('freezes guaranteed chains and chosen rewards through restart, redacts plans and preserves a paid Bounty', () => {
    const expected = { blackPit: ['blackout', 'wound'], huntingGround: ['hunted', 'hunted', 'hunted'], riftNexus: ['echoRift', 'echoRift', 'echoRift'], sealedReliquary: ['secondCrown'], gildedVault: ['vaultbreakers'] } as const;
    for (const [id, kinds] of Object.entries(expected)) {
      const setup = expedition(id as AtlasAreaId, 1);
      expect(sequence(setup.event).map(e => e.kind)).toEqual(kinds);
      expect(sequence(setup.event).every(e => e.required)).toBe(true);
      expect(restoreRunSetup(setup, setup.seed)).toEqual(setup);
      expect(redactSetupForClient(setup)).not.toHaveProperty('event');
      const ch = character(1);
      const bounty = expectOk(rules.openMap({ ...ch, mapDevice: { ...ch.mapDevice!, bounty: true } }, id as AtlasAreaId, 'ring')).setup;
      expect(sequence(bounty.event).some(e => e.kind === 'hunted')).toBe(true);
      expect(sequence(bounty.event).length).toBeLessThanOrEqual(4);
      expect(restoreRunSetup(bounty, bounty.seed)).toEqual(bounty);
    }
    expect(rules.openMap(character(), 'huntingGround').ok).toBe(false);
  });
});

describe('special-area rewards', () => {
  it('gives every new key its stated boss source and tier gate', () => {
    const sources = [
      ['gildedKey', 'emberVault', 3, 0.12], ['blackKey', 'emberRoad', 3, 0.08],
      ['huntingKey', 'ironMarch', 3, 0.08], ['riftKey', 'glassSepulchre', 5, 0.06],
    ] as const;
    for (const [currencyId, areaId, tier, chance] of sources) {
      const setup = expedition(areaId, tier), early = expedition(areaId, tier - 1);
      let count = 0;
      for (let seed = 0; seed < 1000; seed++) {
        const drops = rules.rollKillLoot(setup, kill({ isBoss: true }), createRng(seed), bareCharacter());
        count += drops.filter(i => i.kind === 'currency' && i.currencyId === currencyId).length;
        const belowGate = rules.rollKillLoot(early, kill({ isBoss: true }), createRng(seed), bareCharacter());
        expect(belowGate.some(i => i.kind === 'currency' && i.currencyId === currencyId)).toBe(false);
      }
      expect(count / 1000).toBeGreaterThan(chance - 0.03);
      expect(count / 1000).toBeLessThan(chance + 0.03);
    }
  });

  it('multiplies Hollow Ossuary quantity, including personal gear, without changing the other luck axis', () => {
    const hollow = expedition('hollowOssuary');
    const baseline = expectOk(rules.openMap({ ...character(), mapDevice: map('rimedOssuary', 3) })).setup;
    const ch = bareCharacter({ equipment: { belt: equip({ baseId: 'chainBelt', itemLevel: 88, rarity: 'magic', affixes: [{ affixId: 'itemQuantity', tier: 1 }] }) } });
    expect(rules.lootLuck(hollow, ch).itemQuantity).toBeCloseTo(rules.lootLuck(baseline, ch).itemQuantity * 1.3, 2);
    expect(rules.lootLuck(hollow, ch).itemRarity).toBe(rules.lootLuck(baseline, ch).itemRarity);
  });

  it('triples currency chances and guarantees without tripling gear or special ingredients', () => {
    const vault = expedition('gildedVault');
    const baseline = expectOk(rules.openMap({ ...character(), mapDevice: map('chainworks', 3) })).setup;
    const a = categoryChances(vault, kill()), b = categoryChances(baseline, kill());
    expect(a.currency).toBeCloseTo(b.currency * 3); expect(a.equipment).toBe(b.equipment); expect(a.map).toBe(b.map);
    for (let seed = 0; seed < 50; seed++) {
      const chest = rules.rollChestLoot(vault, createRng(seed), bareCharacter());
      expect(chest.filter(i => i.kind === 'currency').length).toBeGreaterThanOrEqual(12);
      expect(chest.filter(i => i.kind === 'currency').length).toBeLessThanOrEqual(15);
      expect(chest.filter(i => i.kind === 'equipment')).toHaveLength(2);
    }
  });

  it('gives all ten chosen classes their correct hunter reward and keeps keyed rewards eligible at low tiers', () => {
    for (const id of ITEM_CLASSES) {
      const setup = expectOk(rules.openMap(character(4), 'huntingGround', id)).setup;
      const result = rules.rollKillLoot(setup, kill({ eventReward: 'hunted' }), createRng(99), bareCharacter()).at(-1)!;
      expect(result.kind).toBe('equipment');
      if (result.kind === 'equipment') { expect(getBase(result.baseId).itemClass).toBe(id); expect(result.rarity).toBe('rare'); }
    }
    const black = rules.rollKillLoot(expedition('blackPit', 1), kill({ eventReward: 'wound' }), createRng(4), bareCharacter());
    expect(black).toEqual(expect.arrayContaining([expect.objectContaining({ currencyId: 'voidSplinter' }), expect.objectContaining({ currencyId: 'twinInk' })]));
    const nexus = expedition('riftNexus', 1), seen = new Set<string>();
    for (let seed = 0; seed < 90; seed++) {
      const items = rules.rollKillLoot(nexus, kill({ eventReward: 'echoRift' }), createRng(seed), bareCharacter());
      const last = items.at(-1)!; expect(last.kind).toBe('currency');
      if (last.kind === 'currency') seen.add(last.currencyId);
    }
    expect([...seen].sort()).toEqual(['echoShard', 'twinInk', 'voidSplinter']);
  });

  it('makes Shrine Field bossless with triple event odds and no impossible twin-boss roll', () => {
    const setup = expedition('shrineField', 5), cfg = rules.buildRunConfig(setup, {} as never);
    expect(cfg.waves.bossWave).toBe(0);
    const odds = mapEventOdds(setup.map, 'shrineField');
    expect(odds.secondCrown).toBe(0);
    expect(Object.values(odds).reduce((a, b) => a + b, 0)).toBeCloseTo(0.75);
    expect(cfg.waves.count).toBe(6);
    const ch = character(5);
    const echo = expectOk(rules.openMap({ ...ch, mapDevice: { ...ch.mapDevice!, mods: [{ modId: 'echo', value: 100 }] } }, 'shrineField')).setup;
    expect(rules.buildRunConfig(echo, {} as never).waves.count).toBe(7);
    expect(echo.summary.find(line => line.label === 'Area objective')?.value).toBe('Clear 7 waves');
  });
});
