// Pins, Re-chart and Recycle over the real command path (brief D 5, slice P1): persisted account pins, the bench services as
// server-authoritative atomic commands, trade locks, hideout-only rules and Rook's generated map offers.
import { afterEach, describe, expect, it } from 'vitest';
import type { AtlasProgress } from '../../src/contracts/atlas';
import type { CharacterSave, MapItem } from '../../src/contracts/items';
import { rules } from '../../src/game';
import { newAtlas } from '../../src/game/progression/atlas';
import { createMapItem } from '../../src/game/progression';
import { ITEM_IN_TRADE } from '../../src/server/trade';
import { currencyStack, placeItem } from '../../src/game/items';
import { captureLogger, createClock, createLocalCharacter, LocalPlayer, savedCharacter, startTestServer } from './helpers';

type Server = Awaited<ReturnType<typeof startTestServer>>;
let server: Server | null = null;
afterEach(async () => { await server?.close(); server = null; });

async function setup(names: string[]) {
  const clock = createClock();
  server = await startTestServer({ logger: captureLogger(), game: { autoTick: false, now: clock.now } });
  const players = names.map((n) => new LocalPlayer(server!, createLocalCharacter(server!, n)));
  return { server, clock, players };
}

const chOf = (p: LocalPlayer): CharacterSave => p.session.record.ch;
const CHART: AtlasProgress = { ...newAtlas(), discovered: ['cinderCrossing', 'emberRoad', 'boneApproach', 'emberVault', 'furnaceYard', 'glassSepulchre'], completed: ['cinderCrossing', 'emberRoad'] };

/** A hand-picked set of maps and Scrap in the backpack of `p`, over the generated character. */
function stock(p: LocalPlayer, maps: MapItem[], scrap: number): void {
  const ch = chOf(p);
  let grid = { ...ch.backpack, entries: [] as typeof ch.backpack.entries };
  let x = 0;
  for (const item of [...maps, currencyStack('scrap', scrap, 'test-scrap')]) {
    const placed = placeItem(grid, item, x % grid.w, Math.floor(x / grid.w));
    if (!placed) throw new Error('no room');
    grid = placed;
    x += 1;
  }
  p.server.game.setCharacter(p.session, { ...ch, backpack: grid, atlas: CHART });
}
const map = (uid: string, areaId: MapItem['areaId'], tier: number, extra: Partial<MapItem> = {}): MapItem => ({ ...createMapItem(areaId, tier, uid), ...extra });
const scrapOf = (ch: CharacterSave): number => ch.backpack.entries.reduce((n, e) => n + (e.item.kind === 'currency' && e.item.currencyId === 'scrap' ? e.item.count : 0), 0);

describe('pins over the command path', () => {
  it('pins and unpins at once, persists, and refuses what the chart does not allow', async () => {
    const { server, players: [p] } = await setup(['Pia Pin']);
    p.server.game.setCharacter(p.session, { ...chOf(p), atlas: CHART });
    expect(p.command({ c: 'pinArea', areaId: 'emberRoad', pinned: true })).toMatchObject({ ok: true });
    expect(chOf(p).atlas!.pins).toEqual(['emberRoad']);
    expect(p.last('character')?.character.atlas?.pins).toEqual(['emberRoad']);
    expect(p.command({ c: 'pinArea', areaId: 'heartOfForge', pinned: true })).toMatchObject({ ok: false });
    expect(p.command({ c: 'pinArea', areaId: 'sealedReliquary', pinned: true })).toMatchObject({ ok: false });
    for (const id of ['boneApproach', 'furnaceYard'] as const) expect(p.command({ c: 'pinArea', areaId: id, pinned: true }).ok).toBe(true);
    const full = p.command({ c: 'pinArea', areaId: 'glassSepulchre', pinned: true });
    expect(full).toMatchObject({ ok: false });
    expect(full.ok ? '' : full.error).toMatch(/pins are in use/);
    expect(chOf(p).atlas!.pins).toEqual(['emberRoad', 'boneApproach', 'furnaceYard']);
    // the pins are frozen into the expedition at activation: the frozen table names them
    stock(p, [map('dev', 'emberRoad', 2)], 5);
    p.server.game.setCharacter(p.session, { ...chOf(p), atlas: { ...CHART, pins: ['boneApproach', 'furnaceYard'] } });
    const opened = rules.openMap({ ...chOf(p), mapDevice: map('dev', 'emberRoad', 2) }, {});
    expect(opened.ok && opened.value.setup.routing?.candidates.filter((c) => c.pinned).map((c) => c.areaId).sort()).toEqual(['boneApproach', 'furnaceYard']);
    expect(p.command({ c: 'pinArea', areaId: 'boneApproach', pinned: false }).ok).toBe(true);
    expect(chOf(p).atlas!.pins).toEqual(['furnaceYard']);
    p.server.game.flushSave(p.session);
    expect(savedCharacter(server, p.characterId).atlas!.pins).toEqual(['furnaceYard']);
  });
});

describe('Re-chart and Recycle over the command path', () => {
  it('re-charts atomically through the bench command: Scrap and move together, a stale price is refused', async () => {
    const { players: [p] } = await setup(['Rita Rechart']);
    stock(p, [map('m1', 'emberRoad', 3, { quality: 9 })], 10);
    const before = chOf(p);
    expect(p.command({ c: 'benchCraft', targetUid: 'm1', recipeId: 'bench:rechart:furnaceYard', expectedScrap: 2 })).toMatchObject({ ok: false });
    expect(chOf(p)).toBe(before);
    expect(p.command({ c: 'benchCraft', targetUid: 'm1', recipeId: 'bench:rechart:boneApproach', expectedScrap: 3 })).toMatchObject({ ok: false });
    expect(chOf(p)).toBe(before);
    expect(p.command({ c: 'benchCraft', targetUid: 'm1', recipeId: 'bench:rechart:furnaceYard', expectedScrap: 3 })).toMatchObject({ ok: true });
    const moved = chOf(p).backpack.entries.find((e) => e.item.uid === 'm1')!.item as MapItem;
    expect(moved).toMatchObject({ areaId: 'furnaceYard', tier: 3, quality: 9, rechart: 1 });
    expect(scrapOf(chOf(p))).toBe(7);
  });

  it('recycles three maps into one, pays the tier in Scrap, and never half-does it', async () => {
    const { players: [p] } = await setup(['Rex Recycle']);
    stock(p, [map('a', 'emberRoad', 4, { quality: 2 }), map('b', 'emberRoad', 4), map('c', 'furnaceYard', 4, { quality: 5 })], 6);
    const before = chOf(p);
    expect(p.command({ c: 'benchRecycle', uids: ['a', 'b', 'c'], areaId: 'furnaceYard', expectedScrap: 3 })).toMatchObject({ ok: false }); // price is 4
    expect(p.command({ c: 'benchRecycle', uids: ['a', 'b', 'c'], areaId: 'boneApproach', expectedScrap: 4 })).toMatchObject({ ok: false }); // not a neighbour
    expect(p.command({ c: 'benchRecycle', uids: ['a', 'b', 'nope'], areaId: 'furnaceYard' })).toMatchObject({ ok: false });
    expect(chOf(p)).toBe(before);
    const done = p.command({ c: 'benchRecycle', uids: ['a', 'b', 'c'], areaId: 'furnaceYard', expectedScrap: 4 });
    expect(done).toMatchObject({ ok: true });
    const maps = chOf(p).backpack.entries.map((e) => e.item).filter((i): i is MapItem => i.kind === 'map');
    expect(maps).toHaveLength(1);
    expect(maps[0]).toMatchObject({ areaId: 'furnaceYard', tier: 4, rarity: 'normal', quality: 4, mods: [] });
    expect(scrapOf(chOf(p))).toBe(2);
  });

  it('recycles in the hideout', async () => {
    const { players: [p] } = await setup(['Hal Hideout']);
    stock(p, [map('a', 'emberRoad', 3), map('b', 'emberRoad', 3), map('c', 'emberRoad', 3), map('r', 'emberRoad', 3)], 20);
    expect(p.command({ c: 'benchRecycle', uids: ['a', 'b', 'c'], areaId: 'emberRoad' })).toMatchObject({ ok: true });
  });

  it('refuses to re-chart or recycle a map in an open trade offer', async () => {
    const { players: [a, b] } = await setup(['Ann Offer', 'Bob Other']);
    stock(a, [map('t1', 'emberRoad', 3), map('t2', 'emberRoad', 3), map('t3', 'emberRoad', 3), map('t4', 'emberRoad', 3)], 12);
    const from = b.mark();
    expect(a.command({ c: 'tradeRequest', name: 'Bob Other' }).ok).toBe(true);
    const req = b.all('tradeRequest', from).at(-1)!;
    expect(b.command({ c: 'tradeRespond', requestId: req.request.requestId, accept: true }).ok).toBe(true);
    const tradeId = a.all('trade').at(-1)!.trade!.tradeId;
    expect(a.command({ c: 'tradeOffer', tradeId, uids: ['t1'] }).ok).toBe(true);
    const before = chOf(a);
    const rechart = a.command({ c: 'benchCraft', targetUid: 't1', recipeId: 'bench:rechart:furnaceYard', expectedScrap: 3 });
    expect(rechart).toMatchObject({ ok: false, error: ITEM_IN_TRADE });
    const recycle = a.command({ c: 'benchRecycle', uids: ['t1', 't2', 't3'], areaId: 'emberRoad' });
    expect(recycle).toMatchObject({ ok: false, error: ITEM_IN_TRADE });
    expect(chOf(a)).toBe(before);
    // maps that are not in the offer still work
    expect(a.command({ c: 'benchRecycle', uids: ['t2', 't3', 't4'], areaId: 'emberRoad' })).toMatchObject({ ok: true });
  });
});
