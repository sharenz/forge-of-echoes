// Slice T0 (brief D): a map is bound to ONE Atlas area. The binding rules, the legacy migration (bindLegacyMaps), the
// passages that redirect a map, and the theme-derived area of drops and Rook's stock.
import { describe, expect, it } from 'vitest';
import type { AtlasAreaId, AtlasProgress } from '../../src/contracts/atlas';
import { ATLAS_AREA_IDS } from '../../src/contracts/atlas';
import type { CharacterSave, GridContainer, MapItem } from '../../src/contracts/items';
import { MAP_BASE_IDS } from '../../src/contracts/content';
import { createRng } from '../../src/core/rng';
import { ATLAS_AREAS, atlasTierCeiling, findAtlasArea } from '../../src/data/progression/atlas';
import { rules } from '../../src/game';
import {
  areaForTheme, bindLegacyChoice, bindLegacyMaps, createMapItem, hasUnboundMaps, isMapAddress, mapAddresses, normalizeCharacter,
  normalizeItem, restoreRunSetup,
} from '../../src/game/progression';
import { craftMap } from '../../src/game/progression/maps';
import { bareCharacter, expectErr, expectOk, kill, map, openAt, withBackpack } from './fixtures';

const legacyRaw = (uid: string, baseId: string, tier: number, extra: Record<string, unknown> = {}) =>
  ({ kind: 'map', uid, baseId, tier, rarity: 'normal', mods: [], quality: 0, corrupted: false, ...extra });
const progress = (discovered: readonly string[]): AtlasProgress => ({ discovered: [...discovered] as AtlasAreaId[], completed: [], clears: 0, treeVersion: 2 });
const mapsOf = (ch: CharacterSave): MapItem[] => {
  const out: MapItem[] = [];
  const grid = (g: GridContainer) => g.entries.forEach((e) => { if (e.item.kind === 'map') out.push(e.item); });
  grid(ch.backpack);
  ch.stash.forEach((t) => grid(t.grid));
  out.push(...ch.mapStash);
  if (ch.mapDevice) out.push(ch.mapDevice);
  if (ch.craftSlot?.kind === 'map') out.push(ch.craftSlot);
  return out;
};

describe('bound map items', () => {
  it('createMapItem takes the area: baseId is always the area theme, and unknown areas throw', () => {
    for (const a of ATLAS_AREAS) {
      const m = createMapItem(a.id, 3, 'x');
      expect(m).toMatchObject({ areaId: a.id, baseId: a.baseId });
    }
    expect(() => createMapItem('nowhere' as AtlasAreaId, 1, 'x')).toThrow();
  });

  it('names and describes the map by its area, with the ceiling and the unexplored note', () => {
    const m = createMapItem('furnaceYard', 4, 'u1');
    const d = rules.describeItem(m);
    expect(d.title).toBe('Furnace Yard map');
    expect(d.headerLines).toContain('Area: Furnace Yard (Forge)  Accepts up to Tier 5');
    expect(d.headerLines.some((l) => l.startsWith('Unexplored'))).toBe(false);
    const fogged = rules.describeItem(m, bareCharacter({ atlas: progress(['cinderCrossing']) }));
    expect(fogged.headerLines.some((l) => l.startsWith('Unexplored territory'))).toBe(true);
    expect(rules.describeItem(m, bareCharacter({ atlas: progress(['cinderCrossing', 'furnaceYard']) })).headerLines.some((l) => l.startsWith('Unexplored'))).toBe(false);
  });

  it('bindable areas exclude the sealed doors and the Pit of Echoes', () => {
    expect(mapAddresses().every(isMapAddress)).toBe(true);
    expect(mapAddresses().map((a) => a.id)).not.toEqual(expect.arrayContaining(['sealedReliquary']));
    expect(mapAddresses().some((a) => a.id === 'pitOfEchoes' || a.sealed)).toBe(false);
    expect(mapAddresses()).toHaveLength(ATLAS_AREAS.filter((a) => !a.sealed && !a.requiresBounty).length);
  });

  it('normalises a saved map: a valid area stands, the theme follows it, anything else is a legacy map', () => {
    const bound = normalizeItem(legacyRaw('a', 'rimedOssuary', 2, { areaId: 'emberRoad' }), 'a') as MapItem;
    expect(bound).toMatchObject({ areaId: 'emberRoad', baseId: 'ashenForge' });
    expect(bound.unbound).toBeUndefined();
    for (const areaId of ['moonPalace', undefined, 'sealedReliquary', 'pitOfEchoes', 'cinderCrossing' /* tier 2 > ceiling 1 */]) {
      const legacy = normalizeItem(legacyRaw('b', 'chainworks', 2, { areaId }), 'b') as MapItem;
      expect(legacy.unbound).toBe(true);
      expect(findAtlasArea(legacy.areaId)!.baseId).toBe(legacy.baseId);
      expect(atlasTierCeiling(findAtlasArea(legacy.areaId)!)).toBeGreaterThanOrEqual(2);
    }
    // an area alone is enough (the theme is derived), a nonsense one with no theme is not a map
    expect(normalizeItem({ kind: 'map', uid: 'c', areaId: 'ironMarch', tier: 2 }, 'c')).toMatchObject({ areaId: 'ironMarch', baseId: 'chainworks' });
    expect(normalizeItem(legacyRaw('d', 'nowhere', 1), 'd')).toBeNull();
  });
});

describe('legacy migration (bindLegacyMaps)', () => {
  it('prefers a charted area of the same theme within the tier ceiling', () => {
    const b = bindLegacyChoice('ashenForge', 3, 'u1', new Set(['cinderCrossing', 'emberRoad', 'boneApproach']));
    expect(b).toMatchObject({ areaId: 'emberRoad', baseId: 'ashenForge' });
    expect(b.migrated).toBeUndefined();
    expect(b.reveal).toBeUndefined();
  });

  it('then any charted area that fits (the smallest ceiling first), and the map says it changed theme', () => {
    const b = bindLegacyChoice('chainworks', 1, 'u2', new Set(['cinderCrossing', 'boneApproach']));
    expect(b.areaId).toBe('cinderCrossing'); // smallest ceiling that accepts T1
    expect(b).toMatchObject({ baseId: 'ashenForge', migrated: 'theme' });
  });

  it('as a last resort binds the shallowest fitting area and charts it', () => {
    const b = bindLegacyChoice('ashenForge', 9, 'u3', new Set(['cinderCrossing']));
    expect(atlasTierCeiling(findAtlasArea(b.areaId)!)).toBe(9);
    expect(b.reveal).toBe(b.areaId);
    expect(b.migrated).toBe('fog');
  });

  it('binds every place a map can live, charts a last-resort area, and is idempotent', () => {
    const raw = {
      ...bareCharacter({ atlas: progress(['cinderCrossing']) }),
      backpack: { w: 12, h: 5, entries: [{ item: legacyRaw('bp', 'ashenForge', 1), x: 0, y: 0 }] },
      stash: [{ name: 'Main', grid: { w: 12, h: 5, entries: [{ item: legacyRaw('st', 'rimedOssuary', 1), x: 0, y: 0 }] } }],
      mapStash: [legacyRaw('ms', 'chainworks', 1)],
      mapDevice: legacyRaw('md', 'ironColiseum', 1),
      craftSlot: legacyRaw('cs', 'ashenForge', 9),
    };
    const ch = normalizeCharacter(raw)!;
    expect(hasUnboundMaps(ch)).toBe(false);
    const maps = mapsOf(ch);
    expect(maps).toHaveLength(5);
    for (const m of maps) {
      expect(m.unbound).toBeUndefined();
      expect(findAtlasArea(m.areaId)!.baseId).toBe(m.baseId);
      expect(m.tier).toBeLessThanOrEqual(atlasTierCeiling(findAtlasArea(m.areaId)!));
    }
    const cs = ch.craftSlot as MapItem;
    expect(cs).toMatchObject({ migrated: 'fog' });
    expect(ch.atlas!.discovered).toContain(cs.areaId);
    expect(maps.filter((m) => m.uid !== 'cs').every((m) => m.areaId === 'cinderCrossing')).toBe(true);
    // idempotent and stable: binding again, or loading the saved result, changes nothing
    expect(bindLegacyMaps(ch)).toBe(ch);
    expect(normalizeCharacter(JSON.parse(JSON.stringify(ch)))).toEqual(ch);
  });

  it('500 random legacy maps over random discovery sets: none lost, every area accepts its tier, deterministic, theme kept when possible, no rng used', () => {
    const rng = createRng(2024);
    const ids = ATLAS_AREA_IDS as readonly string[];
    for (let round = 0; round < 25; round++) {
      const discovered = ['cinderCrossing', ...ids.filter(() => rng.chance(0.3 + round / 60))];
      const entries = Array.from({ length: 20 }, (_, i) => ({
        item: legacyRaw(`r${round}-${i}`, rng.pick(MAP_BASE_IDS), rng.int(1, 15), { quality: rng.int(0, 20), ...(rng.chance(0.2) ? { bounty: true } : {}), ...(rng.chance(0.2) ? { charted: true } : {}) }),
        x: i % 12, y: Math.floor(i / 12),
      }));
      const raw = { ...bareCharacter({ atlas: progress(discovered), rngState: 4242 }), backpack: { w: 12, h: 5, entries } };
      const once = normalizeCharacter(raw)!, again = normalizeCharacter(JSON.parse(JSON.stringify(raw)))!;
      expect(again).toEqual(once);
      expect(once.rngState).toBe(4242);
      const bound = mapsOf(once);
      expect(bound).toHaveLength(20);
      const charted = new Set(once.atlas!.discovered);
      for (const [i, m] of bound.sort((a, b) => a.uid.localeCompare(b.uid, undefined, { numeric: true })).entries()) {
        const before = entries.find((e) => e.item.uid === m.uid)!.item as Record<string, unknown>;
        const area = findAtlasArea(m.areaId)!;
        expect(isMapAddress(area), `${m.uid} is bound to an address`).toBe(true);
        expect(m.tier).toBe(before.tier);
        expect(m.quality).toBe(before.quality);
        expect(m.bounty ?? false).toBe(before.bounty ?? false);
        expect(m.charted ?? false).toBe(before.charted ?? false);
        expect(m.baseId).toBe(area.baseId);
        expect(m.tier).toBeLessThanOrEqual(atlasTierCeiling(area));
        // the fog is never skipped: the area was charted already, or this map is what charted it
        expect(charted.has(m.areaId), `${m.uid} (${i}) area charted`).toBe(true);
        const sameThemeCharted = mapAddresses().some((a) => a.baseId === before.baseId && discovered.includes(a.id) && atlasTierCeiling(a) >= (before.tier as number));
        if (sameThemeCharted) expect(area.baseId, `${m.uid} keeps its theme`).toBe(before.baseId);
      }
      // discovery only ever grows
      for (const id of discovered) expect(charted.has(id as AtlasAreaId)).toBe(true);
    }
  });

  it('binds an unbound map at activation with the same rules, and charts its area when it must', () => {
    const legacy = normalizeItem(legacyRaw('open', 'ashenForge', 9), 'open') as MapItem;
    expect(legacy.unbound).toBe(true);
    const ch = bareCharacter({ mapDevice: legacy, atlas: progress(['cinderCrossing']), currencyStash: { scrap: 9 } });
    const opened = expectOk(rules.openMap(ch));
    expect(opened.setup.map.areaId).toBe(opened.setup.atlasAreaId);
    expect(opened.setup.sourceMap?.unbound).toBeUndefined();
    expect(opened.character.atlas!.discovered).toContain(opened.setup.atlasAreaId);
  });
});

describe('openMap: the map decides, passages redirect', () => {
  const home = (tier: number, areaId: AtlasAreaId = 'ironMarch') => bareCharacter({ mapDevice: map(areaId, tier), currencyStash: { scrap: 50 } });

  it('runs the bound area; an undiscovered or too deep one cannot be opened and nothing is spent', () => {
    const ch = home(3, 'furnaceYard');
    const ok = expectOk(rules.openMap(ch));
    expect(ok.setup).toMatchObject({ atlasAreaId: 'furnaceYard' });
    expect(ok.setup.passage).toBeUndefined();
    const fogged = { ...ch, atlas: progress(['cinderCrossing']) };
    expect(expectErr(rules.openMap(fogged))).toMatch(/reveal/);
    const deep = { ...ch, mapDevice: { ...ch.mapDevice!, tier: 6 } };
    expect(expectErr(rules.openMap(deep))).toMatch(/up to Tier 5/);
    expect(fogged.currencyStash.scrap).toBe(50);
  });

  it('a key passage opens its sealed area with any map, spends the key, and records the bypassed area', () => {
    const ch = { ...home(4, 'furnaceYard'), currencyStash: { scrap: 50, reliquaryKey: 2 } };
    expect(expectErr(rules.openMap({ ...ch, currencyStash: { scrap: 50 } }, { passage: { kind: 'key', currencyId: 'reliquaryKey' } }))).toMatch(/Reliquary Key/);
    const r = expectOk(rules.openMap(ch, { passage: { kind: 'key', currencyId: 'reliquaryKey' } }));
    expect(r.setup).toMatchObject({ atlasAreaId: 'sealedReliquary', passage: { kind: 'key', currencyId: 'reliquaryKey' }, entranceKey: 'reliquaryKey' });
    expect(r.setup.map).toMatchObject({ areaId: 'sealedReliquary', baseId: 'rimedOssuary' });
    expect(r.setup.sourceMap).toMatchObject({ areaId: 'furnaceYard' });
    expect(r.character.currencyStash.reliquaryKey).toBe(1);
    // the passage survives a restart, and the bound area is what a refund returns
    const restored = restoreRunSetup(JSON.parse(JSON.stringify(r.setup)), r.setup.seed)!;
    expect(restored.passage).toEqual(r.setup.passage);
    expect(restored.sourceMap).toEqual(r.setup.sourceMap);
    // a key that is not a passage key is refused
    expect(expectErr(rules.openMap(ch, { passage: { kind: 'key', currencyId: 'scrap' } }))).toMatch(/not a passage key/);
    // the tier ceiling of the destination counts, not the map's own
    expect(expectErr(rules.openMap({ ...ch, mapDevice: map('crownFoundry', 9) }, { passage: { kind: 'key', currencyId: 'reliquaryKey' } }))).toMatch(/up to Tier 7/);
  });

  it('the Pit of Echoes opens only through the Bounty passage of a map bound to Iron March', () => {
    const bounty = (areaId: AtlasAreaId) => ({ ...home(4, areaId), mapDevice: { ...map(areaId, 4), bounty: true } });
    expect(expectErr(rules.openMap(home(4), { passage: { kind: 'bounty' } }))).toMatch(/Bounty/);
    expect(expectErr(rules.openMap(bounty('furnaceYard'), { passage: { kind: 'bounty' } }))).toMatch(/Iron March/);
    const r = expectOk(rules.openMap(bounty('ironMarch'), { passage: { kind: 'bounty' } }));
    expect(r.setup).toMatchObject({ atlasAreaId: 'pitOfEchoes', passage: { kind: 'bounty' } });
    expect(r.setup.sourceMap).toMatchObject({ areaId: 'ironMarch', bounty: true });
    expect(restoreRunSetup(JSON.parse(JSON.stringify(r.setup)), r.setup.seed)!.passage).toEqual({ kind: 'bounty' });
    // without the passage the Bounty map simply runs Iron March
    expect(expectOk(rules.openMap(bounty('ironMarch'))).setup.atlasAreaId).toBe('ironMarch');
  });

  it('openAt mirrors the old area choice for tests (a sealed area through its key)', () => {
    const ch = { ...home(4), currencyStash: { scrap: 50, gildedKey: 1 } };
    expect(expectOk(openAt(rules, ch, 'gildedVault')).setup.passage).toEqual({ kind: 'key', currencyId: 'gildedKey' });
  });
});

describe('theme-derived areas (Rook, and drops of runs frozen without routing)', () => {
  it('areaForTheme: a charted same-theme area, else any charted area that fits, else the shallowest fit next to the chart', () => {
    const charted = new Set(['cinderCrossing', 'emberRoad', 'boneApproach']);
    expect(areaForTheme('ashenForge', 3, 'k', charted)).toBe('emberRoad');
    expect(areaForTheme('chainworks', 2, 'k', charted)).toMatch(/^(emberRoad|boneApproach)$/); // theme absent: any charted area accepting T2
    // nothing charted (or next to the chart) accepts T6: the shallowest area that does
    expect(atlasTierCeiling(findAtlasArea(areaForTheme('choralCrypt', 6, 'k', charted))!)).toBe(7);
    // a chest map one tier up from the area being run is bound next to it: Cinder Crossing's neighbours take T2
    expect(areaForTheme('ashenForge', 2, 'k', new Set(['cinderCrossing']), 'cinderCrossing')).toMatch(/^(emberRoad|boneApproach)$/);
    for (const base of MAP_BASE_IDS) for (let t = 1; t <= 15; t++) {
      const id = areaForTheme(base, t, `k${t}`);
      expect(atlasTierCeiling(findAtlasArea(id)!)).toBeGreaterThanOrEqual(t);
      expect(isMapAddress(findAtlasArea(id)!)).toBe(true);
    }
  });

  it('every dropped map is bound to an area that accepts its tier and that the looter can open', () => {
    const looter = bareCharacter({ atlas: progress(['cinderCrossing', 'emberRoad', 'furnaceYard', 'boneApproach']) });
    const opened = expectOk(rules.openMap({ ...looter, mapDevice: map('furnaceYard', 5), currencyStash: { scrap: 9 } })).setup;
    const { routing: _routing, ...setup } = opened; // a run frozen before routing: themes are rolled and the area follows
    let seen = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const drops = [
        ...rules.rollKillLoot(setup, kill({ isBoss: true, wave: 6 }), createRng(seed), looter),
        ...rules.rollChestLoot(setup, createRng(seed), looter),
      ];
      for (const m of drops.filter((i): i is MapItem => i.kind === 'map')) {
        seen++;
        const area = findAtlasArea(m.areaId)!;
        expect(m.baseId).toBe(area.baseId);
        expect(m.tier).toBeLessThanOrEqual(atlasTierCeiling(area));
        if (m.tier <= 5) expect(looter.atlas!.discovered).toContain(m.areaId);
      }
    }
    expect(seen).toBeGreaterThan(200);
  });

  it('Rook sells maps of cleared areas (and the starting area), each bound to its area', () => {
    const fresh = bareCharacter({ atlas: progress(['cinderCrossing']) });
    expect(rules.rookMapAreas(fresh)).toEqual(['cinderCrossing']);
    const bought = expectOk(rules.buyOffer(fresh, 'map:cinderCrossing:1:plain'));
    expect(bought.item).toMatchObject({ kind: 'map', areaId: 'cinderCrossing', baseId: 'ashenForge', tier: 1 });
    expect(rules.rookMapOffers(fresh, 'cinderCrossing').find((o) => o.id === 'map:cinderCrossing:1:plain')!.label).toBe('Cinder Crossing map (Tier 1)');
    // charted is not cleared: no maps of an area you have only seen
    expect(expectErr(rules.buyOffer(fresh, 'map:emberRoad:1:plain'))).toMatch(/does not sell/);
  });
});

describe('Void Needle tier-up keeps the map openable', () => {
  it('moves a map at its area ceiling to a deeper area of its theme', () => {
    const m = createMapItem('cinderCrossing', 1, 'v1');
    let moved = 0, kept = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const r = craftMap(m, 'voidNeedle', createRng(seed));
      if (r.map.tier === 2) {
        moved++;
        const area = findAtlasArea(r.map.areaId)!;
        expect(atlasTierCeiling(area)).toBeGreaterThanOrEqual(2);
        expect(r.map.baseId).toBe(area.baseId);
        expect(r.message).toContain(area.name);
      } else kept++;
    }
    expect(moved).toBeGreaterThan(20);
    expect(kept).toBeGreaterThan(100);
    // inside the ceiling the map stays where it is
    const deep = createMapItem('furnaceYard', 2, 'v2');
    for (let seed = 1; seed <= 100; seed++) {
      const r = craftMap(deep, 'voidNeedle', createRng(seed)).map;
      expect(r.areaId).toBe('furnaceYard');
    }
  });
});
