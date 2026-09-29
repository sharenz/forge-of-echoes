// The special stash tabs over the real command path (GAME_SPEC §12, end): the Crafting Stash (slots addressed as
// "cstash:<currencyId>") and the Map Stash — moves with counts, quick-moves with the special tabs, "Deposit all",
// the hideout-only rule (withdrawing too), crafting straight from a slot, trade locks, an old-format character
// loaded from SQLite, and conservation under random command sequences. In-process: fake connections on a fake
// clock, the shared rules behind the server's authority checks.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { CURRENCY_IDS } from '../../src/contracts/content';
import type { CurrencyId } from '../../src/contracts/content';
import { CURRENCY_STASH_MAX, MAP_STASH_CAPACITY, currencyStashUid } from '../../src/contracts/items';
import type { CharacterSave, CurrencyStack, Item, MapItem } from '../../src/contracts/items';
import { TRADE_ACCEPT_LOCK_MS } from '../../src/contracts/net';
import type { Command } from '../../src/contracts/net';
import { LOCKED_CURRENCY_ERROR, rules } from '../../src/game';
import { GameDatabase } from '../../src/server';
import { missingItem } from '../../src/server/commands';
import { ITEM_IN_TRADE } from '../../src/server/trade';
import {
  LocalPlayer, captureLogger, createClock, createLocalCharacter, holdings, openMap, partyUp, savedCharacter, startTestServer, tick,
  uidsOf, walkIntoProp,
} from './helpers';
import type { Clock } from './helpers';

type Server = Awaited<ReturnType<typeof startTestServer>>;

let server: Server | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});

const dir = mkdtempSync(join(tmpdir(), 'forge-special-stash-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Pinned server entropy (crafting, loot): every run rolls the same. */
function pinnedEntropy(seed = 0x57a54123): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0);
}

async function setup(names: string[], logger = captureLogger()) {
  const clock = createClock();
  server = await startTestServer({ logger, game: { autoTick: false, now: clock.now, entropy: pinnedEntropy() } });
  const players = names.map((n) => new LocalPlayer(server!, createLocalCharacter(server!, n)));
  return { server, clock, players, logger };
}

/** Commands paced like a player (the per-socket command bucket refills at 15 per second). */
function actor(clock: Clock) {
  return (p: LocalPlayer, cmd: Command) => {
    clock.advance(100);
    return p.command(cmd);
  };
}

const chOf = (p: LocalPlayer): CharacterSave => p.session.record.ch;
const nameOf = (id: CurrencyId): string => rules.content.currencies[id].name;

function currencyIn(ch: CharacterSave): CurrencyStack[] {
  const out: CurrencyStack[] = [];
  for (const e of ch.backpack.entries) if (e.item.kind === 'currency') out.push(e.item);
  return out;
}

const bagStacks = (ch: CharacterSave, id: CurrencyId) => currencyIn(ch).filter((c) => c.currencyId === id);
const bagCount = (ch: CharacterSave, id: CurrencyId) => bagStacks(ch, id).reduce((n, c) => n + c.count, 0);
const slot = (ch: CharacterSave, id: CurrencyId): number => ch.currencyStash[id] ?? 0;

function bagStack(ch: CharacterSave, id: CurrencyId): CurrencyStack {
  const stack = bagStacks(ch, id)[0];
  if (!stack) throw new Error(`no ${id} in the backpack`);
  return stack;
}

function bagMaps(ch: CharacterSave): MapItem[] {
  return ch.backpack.entries.map((e) => e.item).filter((i): i is MapItem => i.kind === 'map');
}

function uniqueUids(ch: CharacterSave): boolean {
  const uids = uidsOf(ch);
  return new Set(uids).size === uids.length;
}

/** `a` asks `b` (by name) to trade and `b` accepts; returns the trade id. */
function openTrade(a: LocalPlayer, b: LocalPlayer): string {
  const from = b.mark();
  expect(a.command({ c: 'tradeRequest', name: b.session.name }).ok).toBe(true);
  const req = b.all('tradeRequest', from).at(-1);
  if (!req) throw new Error('no trade request arrived');
  expect(b.command({ c: 'tradeRespond', requestId: req.request.requestId, accept: true }).ok).toBe(true);
  const trade = a.last('trade')?.trade;
  if (!trade) throw new Error('no trade opened');
  return trade.tradeId;
}

describe('special stash tabs: moves and counts', () => {
  it('deposits and withdraws with counts and the special tabs; nothing is created or lost, and the state is pushed and saved', async () => {
    const { server, clock, players: [p] } = await setup(['Stasher Sia']);
    const act = actor(clock);
    const start = holdings(chOf(p));
    const conserved = () => expect(holdings(chOf(p))).toEqual(start);

    // Drag part of a stack onto the Crafting Stash: 4 of the Scrap.
    const scrap = bagStack(chOf(p), 'scrap');
    expect(act(p, { c: 'moveItem', uid: scrap.uid, to: { kind: 'currencyStash' }, count: 4 })).toMatchObject({ ok: true });
    expect(slot(chOf(p), 'scrap')).toBe(4);
    expect(bagCount(chOf(p), 'scrap')).toBe(scrap.count - 4);
    // Ctrl-click with either Crafting Stash tab open files a whole stack into its own slot.
    const kindling = bagStack(chOf(p), 'kindling');
    expect(act(p, { c: 'quickMove', uid: kindling.uid, stashTab: 'currency' }).ok).toBe(true);
    const dust = bagStack(chOf(p), 'mapDust');
    expect(act(p, { c: 'quickMove', uid: dust.uid, stashTab: 'mapCurrency' }).ok).toBe(true);
    expect(chOf(p).currencyStash).toEqual({ scrap: 4, kindling: kindling.count, mapDust: dust.count });
    expect(bagStacks(chOf(p), 'kindling')).toEqual([]);
    conserved();

    // Shift+Ctrl-click takes exactly one back, onto the matching backpack stack.
    expect(act(p, { c: 'quickMove', uid: currencyStashUid('scrap'), stashTab: 'currency', count: 1 }).ok).toBe(true);
    expect(slot(chOf(p), 'scrap')).toBe(3);
    expect(bagStacks(chOf(p), 'scrap')).toEqual([expect.objectContaining({ uid: scrap.uid, count: scrap.count - 3 })]);
    // Dragging a slot onto a free cell withdraws there: 2 with a count, then the rest (a full stack) onto it.
    const cell = { kind: 'backpack', x: 11, y: 4 } as const;
    expect(chOf(p).backpack.entries.some((e) => e.x === 11 && e.y === 4)).toBe(false);
    expect(act(p, { c: 'moveItem', uid: currencyStashUid('kindling'), to: cell, count: 2 }).ok).toBe(true);
    const atCell = () => chOf(p).backpack.entries.find((e) => e.x === 11 && e.y === 4)?.item;
    expect(atCell()).toMatchObject({ kind: 'currency', currencyId: 'kindling', count: 2 });
    expect(act(p, { c: 'moveItem', uid: currencyStashUid('kindling'), to: cell }).ok).toBe(true);
    expect(atCell()).toMatchObject({ kind: 'currency', currencyId: 'kindling', count: kindling.count });
    expect(chOf(p).currencyStash).not.toHaveProperty('kindling');
    // An empty slot explains itself.
    expect(act(p, { c: 'quickMove', uid: currencyStashUid('kindling'), stashTab: 'currency' }).error)
      .toBe(`Your Crafting Stash holds no ${nameOf('kindling')}.`);
    conserved();

    // The Map Stash: Ctrl-click with it open, or drag onto it; each map keeps its uid.
    const [m1, m2] = bagMaps(chOf(p));
    expect(act(p, { c: 'quickMove', uid: m1.uid, stashTab: 'maps' }).ok).toBe(true);
    expect(act(p, { c: 'moveItem', uid: m2.uid, to: { kind: 'mapStash' } }).ok).toBe(true);
    expect(chOf(p).mapStash.map((m) => m.uid)).toEqual([m1.uid, m2.uid]);
    expect(bagMaps(chOf(p)).map((m) => m.uid)).not.toContain(m1.uid);
    // Withdraw: Ctrl-click back into the backpack; drag another straight onto the Map Device (own hideout).
    expect(act(p, { c: 'quickMove', uid: m1.uid, stashTab: 'maps' }).ok).toBe(true);
    expect(rules.findItem(chOf(p), m1.uid)?.location.kind).toBe('backpack');
    expect(act(p, { c: 'moveItem', uid: m2.uid, to: { kind: 'mapDevice' } }).ok).toBe(true);
    expect(chOf(p).mapDevice?.uid).toBe(m2.uid);
    // The device's map files back into the Map Stash with Ctrl-click while that tab is open.
    expect(act(p, { c: 'quickMove', uid: m2.uid, stashTab: 'maps' }).ok).toBe(true);
    expect(chOf(p).mapDevice).toBeNull();
    expect(chOf(p).mapStash.map((m) => m.uid)).toEqual([m2.uid]);
    // Wrong kinds are refused with the rules' reason and change nothing.
    const before = chOf(p);
    expect(act(p, { c: 'moveItem', uid: m1.uid, to: { kind: 'currencyStash' } }).error).toMatch(/Only currency/);
    expect(act(p, { c: 'quickMove', uid: scrap.uid, stashTab: 'maps' }).error).toMatch(/Only maps/);
    expect(act(p, { c: 'quickMove', uid: scrap.uid, stashTab: 7 }).error).toBe('That stash tab does not exist.');
    expect(chOf(p)).toBe(before);
    conserved();
    expect(uniqueUids(chOf(p))).toBe(true);

    // The owner's client got the new state (redacted), and the save carries both tabs.
    const pushed = p.last('character')!.character;
    expect(pushed.currencyStash).toEqual(chOf(p).currencyStash);
    expect(pushed.mapStash.map((m) => m.uid)).toEqual([m2.uid]);
    expect(pushed.rngState).toBe(0);
    server.game.flushSave(p.session);
    const saved = savedCharacter(server, p.characterId);
    expect(saved.currencyStash).toEqual(chOf(p).currencyStash);
    expect(saved.mapStash).toEqual(chOf(p).mapStash);
  });

  it('"Deposit all" files every currency stack; a nearly full slot takes what fits and the answer says what stayed', async () => {
    const { server, clock, players: [p] } = await setup(['Hoarder Hal']);
    const act = actor(clock);
    const before = chOf(p);
    const expected: Partial<Record<CurrencyId, number>> = {};
    let total = 0;
    for (const c of currencyIn(before)) {
      expected[c.currencyId] = (expected[c.currencyId] ?? 0) + c.count;
      total += c.count;
    }
    expect(total).toBeGreaterThan(0);
    expect(act(p, { c: 'depositAllCurrency' })).toMatchObject({ ok: true, message: `Stored ${total} currency in the Crafting Stash.` });
    expect(currencyIn(chOf(p))).toEqual([]);
    expect(chOf(p).currencyStash).toEqual(expected);
    expect(holdings(chOf(p))).toEqual(holdings(before));
    // Maps, flasks and gear stay where they were.
    expect(bagMaps(chOf(p))).toEqual(bagMaps(before));
    expect(chOf(p).belt).toEqual(before.belt);
    expect(act(p, { c: 'depositAllCurrency' }).error).toBe('There is no currency in your backpack.');

    // Take the Scrap back out (a Ctrl-click with no tab open still withdraws into the backpack).
    expect(act(p, { c: 'quickMove', uid: currencyStashUid('scrap'), stashTab: null }).ok).toBe(true);
    const scrap = bagCount(chOf(p), 'scrap');
    expect(scrap).toBe(expected.scrap);
    // Its slot is (nearly) full now: 3 fit, the rest stays in the backpack.
    server.game.setCharacter(p.session, { ...chOf(p), currencyStash: { ...chOf(p).currencyStash, scrap: CURRENCY_STASH_MAX - 3 } });
    expect(act(p, { c: 'depositAllCurrency' })).toMatchObject({
      ok: true,
      message: `Stored 3 currency in the Crafting Stash. ${scrap - 3} stayed in your backpack (${nameOf('scrap')}: slot full).`,
    });
    expect(slot(chOf(p), 'scrap')).toBe(CURRENCY_STASH_MAX);
    expect(bagCount(chOf(p), 'scrap')).toBe(scrap - 3);
    expect(act(p, { c: 'depositAllCurrency' }).error).toMatch(new RegExp(`full of ${nameOf('scrap')}`));
  });

  it('normal stash tabs and the special tabs exchange both ways with counts; the device\'s map files into the Map Stash', async () => {
    const { clock, players: [p] } = await setup(['Tabber Tove']);
    const act = actor(clock);
    const start = holdings(chOf(p));
    const conserved = () => expect(holdings(chOf(p))).toEqual(start);
    const tabStacks = (tab: number, id: CurrencyId) => chOf(p).stash[tab].grid.entries
      .map((e) => e.item).filter((i): i is CurrencyStack => i.kind === 'currency' && i.currencyId === id);
    const tabCount = (tab: number, id: CurrencyId) => tabStacks(tab, id).reduce((n, c) => n + c.count, 0);
    const at = (tab: number, x: number, y: number) => chOf(p).stash[tab].grid.entries.find((e) => e.x === x && e.y === y)?.item;

    // Ctrl-click with a count splits an ordinary stack between the backpack and a normal tab — both ways.
    const scrap = bagStack(chOf(p), 'scrap');
    expect(scrap.count).toBeGreaterThanOrEqual(8);
    expect(act(p, { c: 'quickMove', uid: scrap.uid, stashTab: 0, count: 6 }).ok).toBe(true);
    expect(bagCount(chOf(p), 'scrap')).toBe(scrap.count - 6);
    expect(tabCount(0, 'scrap')).toBe(6);
    const onTab = tabStacks(0, 'scrap')[0];
    expect(onTab.uid).not.toBe(scrap.uid);
    expect(act(p, { c: 'quickMove', uid: onTab.uid, stashTab: 0, count: 1 }).ok).toBe(true);
    expect(bagCount(chOf(p), 'scrap')).toBe(scrap.count - 5);
    expect(tabCount(0, 'scrap')).toBe(5);
    conserved();

    // A normal-tab stack into the Crafting Stash with a count; a slot out onto a chosen tab cell with a count,
    // then the rest of it onto the same cell (it stacks).
    expect(act(p, { c: 'moveItem', uid: onTab.uid, to: { kind: 'currencyStash' }, count: 3 }).ok).toBe(true);
    expect(slot(chOf(p), 'scrap')).toBe(3);
    expect(tabCount(0, 'scrap')).toBe(2);
    expect(act(p, { c: 'moveItem', uid: currencyStashUid('scrap'), to: { kind: 'stash', tab: 1, x: 7, y: 6 }, count: 2 }).ok).toBe(true);
    expect(at(1, 7, 6)).toMatchObject({ kind: 'currency', currencyId: 'scrap', count: 2 });
    expect(slot(chOf(p), 'scrap')).toBe(1);
    expect(act(p, { c: 'moveItem', uid: currencyStashUid('scrap'), to: { kind: 'stash', tab: 1, x: 7, y: 6 } }).ok).toBe(true);
    expect(at(1, 7, 6)).toMatchObject({ kind: 'currency', currencyId: 'scrap', count: 3 });
    expect(chOf(p).currencyStash).not.toHaveProperty('scrap');
    // A tab stack straight into the Crafting Stash, whole (no count).
    const cellStack = at(1, 7, 6)!;
    expect(act(p, { c: 'moveItem', uid: cellStack.uid, to: { kind: 'currencyStash' } }).ok).toBe(true);
    expect(at(1, 7, 6)).toBeUndefined();
    expect(slot(chOf(p), 'scrap')).toBe(3);
    conserved();

    // Maps: a normal-tab map into the Map Stash, and a Map Stash map out onto a chosen tab cell.
    const [m1, m2] = bagMaps(chOf(p));
    expect(act(p, { c: 'moveItem', uid: m1.uid, to: { kind: 'stash', tab: 0, x: 3, y: 3 } }).ok).toBe(true);
    expect(act(p, { c: 'moveItem', uid: m1.uid, to: { kind: 'mapStash' } }).ok).toBe(true);
    expect(chOf(p).mapStash.map((m) => m.uid)).toEqual([m1.uid]);
    expect(at(0, 3, 3)).toBeUndefined();
    expect(act(p, { c: 'moveItem', uid: m1.uid, to: { kind: 'stash', tab: 1, x: 11, y: 7 } }).ok).toBe(true);
    expect(at(1, 11, 7)?.uid).toBe(m1.uid);
    expect(chOf(p).mapStash).toEqual([]);
    // The device's map dragged onto the Map Stash.
    expect(act(p, { c: 'moveItem', uid: m2.uid, to: { kind: 'mapDevice' } }).ok).toBe(true);
    expect(act(p, { c: 'moveItem', uid: m2.uid, to: { kind: 'mapStash' } }).ok).toBe(true);
    expect(chOf(p).mapDevice).toBeNull();
    expect(chOf(p).mapStash.map((m) => m.uid)).toEqual([m2.uid]);
    // A Map Stash map dragged onto an occupied device swaps: the device's map goes into the Map Stash.
    expect(act(p, { c: 'moveItem', uid: m1.uid, to: { kind: 'mapDevice' } }).ok).toBe(true);
    expect(act(p, { c: 'moveItem', uid: m2.uid, to: { kind: 'mapDevice' } }).ok).toBe(true);
    expect(chOf(p).mapDevice?.uid).toBe(m2.uid);
    expect(chOf(p).mapStash.map((m) => m.uid)).toEqual([m1.uid]);
    conserved();
    expect(uniqueUids(chOf(p))).toBe(true);
  });

  it('a full Map Stash refuses every deposit with the reason and changes nothing; taking one out makes room for one', async () => {
    const { server, clock, players: [p] } = await setup(['Cartog Cyr']);
    const act = actor(clock);
    const [template, bagMap, deviceMap] = bagMaps(chOf(p));
    expect(act(p, { c: 'moveItem', uid: deviceMap.uid, to: { kind: 'mapDevice' } }).ok).toBe(true);
    const filler: MapItem[] = Array.from({ length: MAP_STASH_CAPACITY }, (_, k) => ({ ...template, uid: `full-${k}` }));
    server.game.setCharacter(p.session, { ...chOf(p), mapStash: filler });
    const start = holdings(chOf(p));
    const before = chOf(p);
    const full = `Your Map Stash is full: it holds at most ${MAP_STASH_CAPACITY} maps.`;
    expect(act(p, { c: 'moveItem', uid: bagMap.uid, to: { kind: 'mapStash' } }).error).toBe(full);
    expect(act(p, { c: 'quickMove', uid: bagMap.uid, stashTab: 'maps' }).error).toBe(full);
    expect(act(p, { c: 'moveItem', uid: deviceMap.uid, to: { kind: 'mapStash' } }).error).toBe(full);
    expect(act(p, { c: 'quickMove', uid: deviceMap.uid, stashTab: 'maps' }).error).toBe(full);
    expect(chOf(p)).toBe(before);

    // Take one out (Ctrl-click): exactly one fits again.
    expect(act(p, { c: 'quickMove', uid: 'full-0', stashTab: 'maps' }).ok).toBe(true);
    expect(rules.findItem(chOf(p), 'full-0')?.location.kind).toBe('backpack');
    expect(act(p, { c: 'moveItem', uid: bagMap.uid, to: { kind: 'mapStash' } }).ok).toBe(true);
    expect(chOf(p).mapStash).toHaveLength(MAP_STASH_CAPACITY);
    expect(chOf(p).mapStash.at(-1)?.uid).toBe(bagMap.uid);
    expect(act(p, { c: 'moveItem', uid: deviceMap.uid, to: { kind: 'mapStash' } }).error).toBe(full);
    expect(holdings(chOf(p))).toEqual(start);
    expect(uniqueUids(chOf(p))).toBe(true);
    // The full tab is pushed to the client and saved.
    expect(p.last('character')!.character.mapStash).toHaveLength(MAP_STASH_CAPACITY);
    server.game.flushSave(p.session);
    expect(savedCharacter(server, p.characterId).mapStash.map((m) => m.uid)).toEqual(chOf(p).mapStash.map((m) => m.uid));
  });
});

describe('special stash tabs: where they work', () => {
  it('work in any hideout (withdrawals and crafting from a slot included) and nowhere else; the map device stays the owner\'s', async () => {
    const { clock, players } = await setup(['Home Hana', 'Guest Gil']);
    const [host, guest] = players;
    const act = actor(clock);
    partyUp(host, guest);
    // At home the guest files a map and the Kindling.
    const [gm1] = bagMaps(chOf(guest));
    expect(act(guest, { c: 'quickMove', uid: gm1.uid, stashTab: 'maps' }).ok).toBe(true);
    expect(act(guest, { c: 'quickMove', uid: bagStack(chOf(guest), 'kindling').uid, stashTab: 'currency' }).ok).toBe(true);
    const kindling = slot(chOf(guest), 'kindling');
    expect(kindling).toBeGreaterThanOrEqual(3);

    // In a party member's hideout the stash — special tabs included — is the guest's own and works as at home.
    expect(act(guest, { c: 'visitHideout', characterId: host.characterId }).ok).toBe(true);
    expect(guest.session.instance!.ownerId).toBe(host.characterId);
    const hostBefore = chOf(host);
    expect(act(guest, { c: 'quickMove', uid: currencyStashUid('kindling'), stashTab: 'currency', count: 1 }).ok).toBe(true);
    expect(slot(chOf(guest), 'kindling')).toBe(kindling - 1);
    // Crafting straight from a slot works there too: each use draws one from it.
    const robe = chOf(guest).equipment.chest!;
    expect(robe.rarity).toBe('normal');
    const crafted = act(guest, { c: 'applyCurrency', currencyUid: currencyStashUid('kindling'), targetUid: robe.uid });
    expect(crafted.ok).toBe(true);
    expect(crafted.message).toBeTruthy();
    expect(chOf(guest).equipment.chest!.rarity).toBe('magic');
    expect(slot(chOf(guest), 'kindling')).toBe(kindling - 2);
    // The map device is not the guest's: neither a drag from the Map Stash nor a Ctrl-clicked map loads it.
    const [gm2] = bagMaps(chOf(guest));
    let before = chOf(guest);
    expect(act(guest, { c: 'moveItem', uid: gm1.uid, to: { kind: 'mapDevice' } }).error).toMatch(/own hideout/);
    expect(act(guest, { c: 'quickMove', uid: gm2.uid, stashTab: null }).error).toMatch(/own hideout/);
    expect(chOf(guest)).toBe(before);
    expect(chOf(host)).toBe(hostBefore);

    // Inside a map nothing of the stash works — not even taking something out of it into the backpack.
    expect(act(guest, { c: 'visitHideout', characterId: guest.characterId }).ok).toBe(true);
    openMap(guest);
    walkIntoProp(guest, 'portal', clock, [host]);
    expect(guest.session.instance!.kind).toBe('map');
    const [gm3] = bagMaps(chOf(guest));
    before = chOf(guest);
    const scrapUid = bagStack(before, 'scrap').uid;
    const refused: Command[] = [
      { c: 'moveItem', uid: scrapUid, to: { kind: 'currencyStash' } },
      { c: 'moveItem', uid: currencyStashUid('kindling'), to: { kind: 'backpack', x: 11, y: 4 }, count: 1 },
      { c: 'quickMove', uid: currencyStashUid('kindling'), stashTab: null },
      { c: 'quickMove', uid: currencyStashUid('kindling'), stashTab: null, count: 1 },
      { c: 'quickMove', uid: scrapUid, stashTab: 'currency' },
      { c: 'quickMove', uid: gm3.uid, stashTab: 'maps' },
      { c: 'moveItem', uid: gm3.uid, to: { kind: 'mapStash' } },
      { c: 'quickMove', uid: gm1.uid, stashTab: null },
      { c: 'moveItem', uid: gm1.uid, to: { kind: 'backpack', x: 11, y: 4 } },
      { c: 'depositAllCurrency' },
      { c: 'discardItem', uid: gm1.uid },
    ];
    for (const cmd of refused) expect(act(guest, cmd).error, JSON.stringify(cmd)).toBe('The stash can only be used in a hideout.');
    // A Ctrl-clicked map with no tab open would go into the map device: not from inside a map either.
    expect(act(guest, { c: 'quickMove', uid: gm3.uid, stashTab: null }).error).toMatch(/own hideout/);
    expect(act(guest, { c: 'dropItem', uid: gm1.uid }).error).toBe('Stash items can only be dropped in a hideout.');
    expect(act(guest, { c: 'dropItem', uid: currencyStashUid('kindling') }).error).toBe('Stash items can only be dropped in a hideout.');
    expect(act(guest, { c: 'applyCurrency', currencyUid: currencyStashUid('kindling'), targetUid: robe.uid }).error)
      .toBe('Crafting only works in a hideout.');
    expect(chOf(guest)).toBe(before);

    // Back home: a Map Stash map can be dropped on the floor (public); a slot is not an item and cannot.
    expect(act(guest, { c: 'leaveMap' }).ok).toBe(true);
    expect(guest.session.instance).toMatchObject({ kind: 'hideout', ownerId: guest.characterId });
    expect(act(guest, { c: 'dropItem', uid: currencyStashUid('kindling') }).error).toBe('Take currency out of the Crafting Stash first.');
    expect(act(guest, { c: 'dropItem', uid: gm1.uid }).ok).toBe(true);
    expect(chOf(guest).mapStash).toEqual([]);
    expect([...guest.session.instance!.groundItems.values()].map((g) => g.item.uid)).toContain(gm1.uid);
  });

  it('map currency from its slot crafts a map in the Map Stash; an empty slot names the currency it lacks', async () => {
    const { clock, players: [p] } = await setup(['Crafter Cai']);
    const act = actor(clock);
    const [map] = bagMaps(chOf(p));
    expect(act(p, { c: 'moveItem', uid: map.uid, to: { kind: 'mapStash' } }).ok).toBe(true);
    expect(act(p, { c: 'quickMove', uid: bagStack(chOf(p), 'mapDust').uid, stashTab: 'mapCurrency' }).ok).toBe(true);
    const dust = slot(chOf(p), 'mapDust');
    expect(act(p, { c: 'applyCurrency', currencyUid: currencyStashUid('mapDust'), targetUid: map.uid }).ok).toBe(true);
    expect(slot(chOf(p), 'mapDust')).toBe(dust - 1);
    const crafted = chOf(p).mapStash.find((m) => m.uid === map.uid)!;
    expect(crafted.rarity).not.toBe('normal');
    expect(crafted.mods.length).toBeGreaterThan(0);
    expect(rules.findItem(chOf(p), map.uid)?.location.kind).toBe('mapStash');
    // Nothing of that currency deposited: the slot is empty and says so — the same words from every command
    // (dropping it on the floor too), and the same as the shared rules' own.
    const target = chOf(p).equipment.chest!.uid;
    const empty = currencyStashUid('reforge');
    const lacks = `Your Crafting Stash holds no ${nameOf('reforge')}.`;
    expect(act(p, { c: 'applyCurrency', currencyUid: empty, targetUid: target }).error).toBe(lacks);
    expect(act(p, { c: 'dropItem', uid: empty }).error).toBe(lacks);
    expect(act(p, { c: 'moveItem', uid: empty, to: { kind: 'backpack', x: 11, y: 4 } }).error).toBe(lacks);
    expect(act(p, { c: 'discardItem', uid: empty }).error).toBe(lacks);
    const ruled = rules.quickMove(chOf(p), empty, { stashTab: null });
    expect(ruled.ok ? null : ruled.error).toBe(missingItem(empty));
    expect(missingItem(empty)).toBe(lacks);
  });

  it('the map in the device is crafted only in its owner\'s own hideout, as it is only moved there', async () => {
    const { clock, players } = await setup(['Host Hux', 'Guest Gia']);
    const [host, guest] = players;
    const act = actor(clock);
    partyUp(host, guest);
    const [map] = bagMaps(chOf(guest));
    expect(act(guest, { c: 'moveItem', uid: map.uid, to: { kind: 'mapDevice' } }).ok).toBe(true);
    expect(act(guest, { c: 'moveItem', uid: bagStack(chOf(guest), 'mapDust').uid, to: { kind: 'currencyStash' }, count: 1 }).ok).toBe(true);

    // In the host's hideout neither Map Dust from the backpack nor from its Crafting Stash slot touches it, nor
    // does the bench.
    expect(act(guest, { c: 'visitHideout', characterId: host.characterId }).ok).toBe(true);
    const before = chOf(guest);
    const hostBefore = chOf(host);
    const dust = bagStack(before, 'mapDust');
    for (const currencyUid of [dust.uid, currencyStashUid('mapDust')]) {
      expect(act(guest, { c: 'applyCurrency', currencyUid, targetUid: map.uid }).error, currencyUid).toBe('The map device is in your own hideout.');
    }
    expect(act(guest, { c: 'benchCraft', targetUid: map.uid, recipeId: 'bench:focus' }).error).toBe('The map device is in your own hideout.');
    expect(act(guest, { c: 'benchClear', targetUid: map.uid }).error).toBe('The map device is in your own hideout.');
    expect(chOf(guest)).toBe(before);
    expect(chOf(host)).toBe(hostBefore);
    // Her other items still craft there (her stash and backpack are hers wherever she stands).
    const robe = before.equipment.chest!;
    expect(act(guest, { c: 'applyCurrency', currencyUid: bagStack(before, 'kindling').uid, targetUid: robe.uid }).ok).toBe(true);

    // At home the same Map Dust crafts it.
    expect(act(guest, { c: 'visitHideout', characterId: guest.characterId }).ok).toBe(true);
    const home = act(guest, { c: 'applyCurrency', currencyUid: currencyStashUid('mapDust'), targetUid: map.uid });
    expect(home.ok).toBe(true);
    expect(chOf(guest).mapDevice?.uid).toBe(map.uid);
    expect(chOf(guest).mapDevice?.rarity).not.toBe('normal');
    expect(slot(chOf(guest), 'mapDust')).toBe(0);
  });
});

describe('special stash tabs: trade locks', () => {
  it('an offered stack cannot be deposited; "Deposit all" leaves it and says why; a withdrawal never tops it up; slots and stashed maps cannot be offered', async () => {
    const { server, clock, players } = await setup(['Lock Lia', 'Lock Leo']);
    const [lia, leo] = players;
    const act = actor(clock);
    const start = holdings(chOf(lia), chOf(leo));
    const leoScrap = bagCount(chOf(leo), 'scrap');
    // Lia files 4 Scrap and a map, then offers the rest of the Scrap stack.
    const scrap = bagStack(chOf(lia), 'scrap');
    const offered = scrap.count - 4;
    expect(act(lia, { c: 'moveItem', uid: scrap.uid, to: { kind: 'currencyStash' }, count: 4 }).ok).toBe(true);
    const [map] = bagMaps(chOf(lia));
    expect(act(lia, { c: 'quickMove', uid: map.uid, stashTab: 'maps' }).ok).toBe(true);
    const tradeId = openTrade(lia, leo);
    // Neither a Crafting Stash slot nor a Map Stash map can go into an offer: backpack items only.
    expect(act(lia, { c: 'tradeOffer', tradeId, uids: [currencyStashUid('scrap')] }).error).toMatch(/Only items in your backpack/);
    expect(act(lia, { c: 'tradeOffer', tradeId, uids: [map.uid] }).error).toMatch(/Only items in your backpack/);
    expect(act(lia, { c: 'tradeOffer', tradeId, uids: [scrap.uid] }).ok).toBe(true);

    // The offered stack is locked: no deposit by drag or Ctrl-click.
    const before = chOf(lia);
    expect(act(lia, { c: 'moveItem', uid: scrap.uid, to: { kind: 'currencyStash' } }).error).toBe(ITEM_IN_TRADE);
    expect(act(lia, { c: 'moveItem', uid: scrap.uid, to: { kind: 'currencyStash' }, count: 1 }).error).toBe(ITEM_IN_TRADE);
    expect(act(lia, { c: 'quickMove', uid: scrap.uid, stashTab: 'currency' }).error).toBe(ITEM_IN_TRADE);
    expect(chOf(lia)).toBe(before);
    // Withdrawing Scrap never tops up the locked stack: a new stack opens beside it.
    expect(act(lia, { c: 'quickMove', uid: currencyStashUid('scrap'), stashTab: 'currency', count: 2 }).ok).toBe(true);
    const stacks = bagStacks(chOf(lia), 'scrap');
    expect(stacks).toHaveLength(2);
    expect(stacks.find((c) => c.uid === scrap.uid)?.count).toBe(offered);
    expect(stacks.find((c) => c.uid !== scrap.uid)?.count).toBe(2);
    // Dropping a withdrawal right onto the locked stack's cell does not merge into it either.
    const lockedCell = chOf(lia).backpack.entries.find((e) => e.item.uid === scrap.uid)!;
    expect(act(lia, { c: 'moveItem', uid: currencyStashUid('scrap'), to: { kind: 'backpack', x: lockedCell.x, y: lockedCell.y }, count: 1 }).ok)
      .toBe(true);
    expect(chOf(lia).backpack.entries.find((e) => e.item.uid === scrap.uid)?.item).toMatchObject({ count: offered });

    // "Deposit all" files every other stack, leaves the offered one and says so.
    const deposit = act(lia, { c: 'depositAllCurrency' });
    expect(deposit.ok).toBe(true);
    expect(deposit.message).toMatch(new RegExp(`${offered} stayed in your backpack \\(in your trade offer\\)\\.$`));
    expect(currencyIn(chOf(lia)).map((c) => c.uid)).toEqual([scrap.uid]);
    expect(slot(chOf(lia), 'scrap')).toBe(4);
    // With only the offered stack left, it refuses and explains.
    expect(act(lia, { c: 'depositAllCurrency' }).error).toBe(LOCKED_CURRENCY_ERROR);

    // The trade is still open with the same offer, and completes: Leo gets the Scrap. Nothing was made or lost.
    expect(server.game.trades.tradeIdOf(lia.characterId)).toBe(tradeId);
    expect(lia.last('trade')!.trade!.yourItems).toEqual([expect.objectContaining({ uid: scrap.uid, count: offered })]);
    clock.advance(TRADE_ACCEPT_LOCK_MS);
    expect(lia.command({ c: 'tradeAccept', tradeId, accept: true }).ok).toBe(true);
    expect(leo.command({ c: 'tradeAccept', tradeId, accept: true }).ok).toBe(true);
    expect(server.game.trades.tradeIdOf(lia.characterId)).toBeNull();
    expect(bagCount(chOf(leo), 'scrap')).toBe(leoScrap + offered);
    expect(holdings(chOf(lia), chOf(leo))).toEqual(start);
    expect(uniqueUids(chOf(lia)) && uniqueUids(chOf(leo))).toBe(true);
  });
});

describe('special stash tabs: characters saved before them', () => {
  it('an old-format character loads from SQLite with an empty Crafting Stash and Map Stash, uses them at once, and saves them', async () => {
    type OldSave = Omit<CharacterSave, 'currencyStash' | 'mapStash'>;
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/old-character-v1.json', import.meta.url), 'utf8')) as OldSave;
    expect(fixture).not.toHaveProperty('currencyStash');
    expect(fixture).not.toHaveProperty('mapStash');
    const dbPath = join(dir, 'old-character.db');
    const db = await GameDatabase.open(dbPath);
    expect(db.createAccount({ id: 'acct-old', username: 'old_timer', passHash: '00', salt: '00', created: 1 })).toBe(true);
    const row = (id: string, name: string, data: unknown) => ({
      id, accountId: 'acct-old', name, level: fixture.level, classId: 'sorceress', data: JSON.stringify(data), saveVersion: 1, created: 1, updated: 1,
    });
    // The row exactly as the previous release wrote it (save format 1, no special tabs) …
    expect(db.insertCharacter(row(fixture.id, fixture.name, fixture))).toBe('ok');
    // … and a damaged one with garbage where the special tabs go.
    expect(db.insertCharacter(row('ch-damaged', 'Broken Bo', { ...fixture, id: 'ch-damaged', name: 'Broken Bo', currencyStash: 'lots', mapStash: { 0: 'x' } })))
      .toBe('ok');
    db.close();

    const clock = createClock();
    server = await startTestServer({ dbPath, game: { autoTick: false, now: clock.now } });
    const act = actor(clock);
    const p = new LocalPlayer(server, fixture.id);
    const loaded = chOf(p);
    expect(loaded.currencyStash).toEqual({});
    expect(loaded.mapStash).toEqual([]);
    // Nothing else moved: level, the named stash tab and its items, the device's map, the backpack.
    expect(loaded.level).toBe(fixture.level);
    expect(loaded.stash[0].name).toBe('Loot');
    expect(loaded.stash[0].grid.entries.map((e) => e.item.uid)).toEqual(fixture.stash[0].grid.entries.map((e) => e.item.uid));
    expect(loaded.mapDevice?.uid).toBe(fixture.mapDevice!.uid);
    expect(holdings(loaded)).toEqual(holdings({ ...fixture, currencyStash: {}, mapStash: [] }));
    // The client is sent the normalised state.
    const pushed = p.last('character')!.character;
    expect(pushed.currencyStash).toEqual({});
    expect(pushed.mapStash).toEqual([]);

    // The special tabs work at once: a stash-tab stack straight into the Crafting Stash, the device's map into the
    // Map Stash, then everything else with "Deposit all".
    const glyph = loaded.stash[0].grid.entries.map((e) => e.item).find((i): i is CurrencyStack => i.kind === 'currency')!;
    expect(act(p, { c: 'moveItem', uid: glyph.uid, to: { kind: 'currencyStash' } }).ok).toBe(true);
    expect(act(p, { c: 'quickMove', uid: loaded.mapDevice!.uid, stashTab: 'maps' }).ok).toBe(true);
    expect(act(p, { c: 'depositAllCurrency' }).ok).toBe(true);
    const after = chOf(p);
    expect(slot(after, glyph.currencyId)).toBeGreaterThanOrEqual(glyph.count);
    expect(after.mapStash.map((m) => m.uid)).toEqual([fixture.mapDevice!.uid]);
    expect(currencyIn(after)).toEqual([]);
    expect(holdings(after)).toEqual(holdings(loaded));

    // The damaged row loads too: its garbage reads as empty tabs.
    const bo = new LocalPlayer(server, 'ch-damaged');
    expect(chOf(bo).currencyStash).toEqual({});
    expect(chOf(bo).mapStash).toEqual([]);

    // Shutdown writes the new format; a restart reads it back unchanged.
    await server.close();
    server = null;
    const reopened = await GameDatabase.open(dbPath);
    const stored = JSON.parse(reopened.characterById(fixture.id)!.data) as CharacterSave;
    reopened.close();
    expect(stored.currencyStash).toEqual(after.currencyStash);
    expect(stored.mapStash).toEqual(after.mapStash);
    server = await startTestServer({ dbPath, game: { autoTick: false, now: clock.now } });
    const again = new LocalPlayer(server, fixture.id);
    expect(chOf(again).currencyStash).toEqual(after.currencyStash);
    expect(chOf(again).mapStash).toEqual(after.mapStash);
    expect(holdings(chOf(again))).toEqual(holdings(after));
  });
});

describe('special stash tabs: conservation', () => {
  it('no sequence of special-stash, trade, drop and pickup commands creates or destroys an item', async () => {
    const { server, clock, players, logger } = await setup(['Fuzz Ida', 'Fuzz Jon']);
    const [ida, jon] = players;
    partyUp(jon, ida);
    expect(ida.command({ c: 'visitHideout', characterId: jon.characterId }).ok).toBe(true);
    const hideout = jon.session.instance!;
    const total = () => {
      const ground = [...hideout.groundItems.values()].map((g) => g.item);
      const floor: CharacterSave = {
        ...ida.session.record.ch,
        backpack: { w: 0, h: 0, entries: [] }, equipment: {}, mapDevice: null, belt: [], currencyStash: {}, mapStash: [],
        stash: [{ name: 'ground', grid: { w: 99, h: 99, entries: ground.map((item, k) => ({ item, x: k, y: 0 })) } }],
      };
      return holdings(chOf(ida), chOf(jon), floor);
    };
    const start = total();
    // mulberry32, so a failure replays.
    let seed = 0x51a5;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T>(xs: readonly T[]): T | undefined => xs[Math.floor(rand() * xs.length)];
    const maybeCount = (max: number): number | undefined => (rand() < 0.5 ? undefined : 1 + Math.floor(rand() * Math.max(1, max)));
    const ok = new Map<string, number>();
    const tally = (what: string, r: { ok: boolean }) => {
      if (r.ok) ok.set(what, (ok.get(what) ?? 0) + 1);
    };
    const countOf = (item: Item, max = 1): number | undefined =>
      item.kind === 'currency' || item.kind === 'flask' ? maybeCount(Math.max(max, item.count)) : undefined;
    const cell = () => ({ kind: 'backpack' as const, x: Math.floor(rand() * 12), y: Math.floor(rand() * 5) });
    const tabCell = () => ({ kind: 'stash' as const, tab: 0, x: Math.floor(rand() * 12), y: Math.floor(rand() * 8) });
    const anyTab = () => pick(['currency', 'mapCurrency', 'maps', 0, null] as const)!;

    interface Turn {
      me: LocalPlayer;
      other: LocalPlayer;
      ch: CharacterSave;
      /** Backpack items, and the items on normal stash tab 0. */
      bag: Item[];
      tab: Item[];
      held: CurrencyId[];
      tradeId: string | null;
      step: number;
    }
    const isStack = (i: Item): i is CurrencyStack => i.kind === 'currency';
    // Every stash command path (source → destination, with and without a count), plus trades, drops and pickups
    // mixed in. Jon is at home; Ida visits him — so her map device is out of reach and his is not.
    const actions: [number, (t: Turn) => void][] = [
      // Into the Crafting Stash: a backpack stack or a normal-tab stack, part (count) or whole.
      [9, (t) => { const c = pick(t.bag.filter(isStack)); if (c) tally('deposit', t.me.command({ c: 'moveItem', uid: c.uid, to: { kind: 'currencyStash' }, count: maybeCount(c.count) })); }],
      [6, (t) => { const c = pick(t.tab.filter(isStack)); if (c) tally('tab → cstash', t.me.command({ c: 'moveItem', uid: c.uid, to: { kind: 'currencyStash' }, count: maybeCount(c.count) })); }],
      // Out of the Crafting Stash: onto a backpack cell, by Ctrl-click, or onto a normal-tab cell.
      [9, (t) => {
        const id = pick(t.held);
        if (!id) return;
        tally('withdraw', rand() < 0.5
          ? t.me.command({ c: 'moveItem', uid: currencyStashUid(id), to: cell(), count: maybeCount(60) })
          : t.me.command({ c: 'quickMove', uid: currencyStashUid(id), stashTab: pick(['currency', 'mapCurrency', null] as const)!, count: maybeCount(3) }));
      }],
      [6, (t) => { const id = pick(t.held); if (id) tally('cstash → tab', t.me.command({ c: 'moveItem', uid: currencyStashUid(id), to: tabCell(), count: maybeCount(60) })); }],
      // Ctrl-click from the backpack with any tab open (a count splits a stack), and from a normal tab back.
      [6, (t) => { const i = pick(t.bag); if (i) tally('quickMove', t.me.command({ c: 'quickMove', uid: i.uid, stashTab: anyTab(), count: countOf(i) })); }],
      [6, (t) => { const c = pick(t.bag.filter(isStack)); if (c) tally('split to tab', t.me.command({ c: 'quickMove', uid: c.uid, stashTab: 0, count: 1 + Math.floor(rand() * c.count) })); }],
      [6, (t) => { const i = pick(t.tab); if (i) tally('tab → backpack', t.me.command({ c: 'quickMove', uid: i.uid, stashTab: anyTab(), count: countOf(i) })); }],
      // Dragged onto a normal-tab cell (merging, splitting or swapping there).
      [6, (t) => { const i = pick(t.bag); if (i) tally('to tab', t.me.command({ c: 'moveItem', uid: i.uid, to: tabCell(), count: countOf(i) })); }],
      // The Map Stash: in from the backpack or a normal tab; out to the backpack, a normal tab or the device.
      [6, (t) => { const m = pick(t.bag.filter((i) => i.kind === 'map')); if (m) tally('file map', t.me.command({ c: 'moveItem', uid: m.uid, to: { kind: 'mapStash' } })); }],
      [4, (t) => { const m = pick(t.tab.filter((i) => i.kind === 'map')); if (m) tally('file tab map', t.me.command({ c: 'moveItem', uid: m.uid, to: { kind: 'mapStash' } })); }],
      [7, (t) => {
        const m = pick(t.ch.mapStash);
        if (!m) return;
        const r = rand();
        const to = r < 0.35 ? { kind: 'mapDevice' as const } : r < 0.65 ? tabCell() : cell();
        tally('take map', rand() < 0.6 ? t.me.command({ c: 'moveItem', uid: m.uid, to }) : t.me.command({ c: 'quickMove', uid: m.uid, stashTab: 'maps' }));
      }],
      // The device: loaded from the backpack or a normal tab (swapping its map back there) — refused for Ida …
      [5, (t) => {
        const m = pick([...t.bag, ...t.tab].filter((i) => i.kind === 'map'));
        if (m) tally('load device', t.me.command({ c: 'moveItem', uid: m.uid, to: { kind: 'mapDevice' } }));
      }],
      // … and its map dragged into the Map Stash, onto a tab or backpack cell, or Ctrl-clicked.
      [8, (t) => {
        const m = t.ch.mapDevice;
        if (!m) return;
        const r = rand();
        if (r < 0.5) tally('device → map stash', t.me.command({ c: 'moveItem', uid: m.uid, to: { kind: 'mapStash' } }));
        else if (r < 0.7) tally('device out', t.me.command({ c: 'moveItem', uid: m.uid, to: rand() < 0.5 ? tabCell() : cell() }));
        else tally('device out', t.me.command({ c: 'quickMove', uid: m.uid, stashTab: pick(['maps', null, 0] as const)! }));
      }],
      [3, (t) => tally('deposit all', t.me.command({ c: 'depositAllCurrency' }))],
      // Trades (offered items are locked against every command above).
      [6, (t) => {
        if (t.tradeId) return;
        const req = t.me.last('tradeRequest');
        if (req && rand() < 0.5) t.me.command({ c: 'tradeRespond', requestId: req.request.requestId, accept: rand() < 0.8 });
        else t.me.command({ c: 'tradeRequest', name: t.other.session.name });
      }],
      [5, (t) => {
        if (!t.tradeId) return;
        const n = Math.floor(rand() * 3);
        t.me.command({ c: 'tradeOffer', tradeId: t.tradeId, uids: [...new Set(Array.from({ length: n }, () => pick(t.bag)?.uid).filter((u): u is string => !!u))] });
      }],
      [6, (t) => {
        if (!t.tradeId) return;
        if (rand() < 0.7) clock.advance(TRADE_ACCEPT_LOCK_MS);
        t.me.command({ c: 'tradeAccept', tradeId: t.tradeId, accept: rand() < 0.95 });
      }],
      // Onto the floor (backpack, Map Stash, a normal tab or a Crafting Stash slot — which is refused) and back.
      [7, (t) => {
        const r = rand();
        const uid = r < 0.5 ? pick(t.bag)?.uid : r < 0.7 ? pick(t.ch.mapStash)?.uid : r < 0.9 ? pick(t.tab)?.uid : pick(t.held.map(currencyStashUid));
        if (uid) tally('drop', t.me.command({ c: 'dropItem', uid }));
      }],
      [7, (t) => {
        const drop = pick(hideout.run.view.drops.filter((d) => d.spec.owner === 0));
        // Sent raw: a click out of reach is answered later (or superseded), not at once.
        if (drop) t.me.send({ t: 'cmd', id: 50_000 + t.step, cmd: { c: 'pickup', dropId: drop.id } });
      }],
      [4, (t) => { const i = pick(t.bag); if (i) tally('backpack move', t.me.command({ c: 'moveItem', uid: i.uid, to: cell(), count: countOf(i) })); }],
    ];
    const weight = actions.reduce((n, [w]) => n + w, 0);
    for (let step = 0; step < 2500; step++) {
      const [me, other] = rand() < 0.5 ? [ida, jon] : [jon, ida];
      const ch = chOf(me);
      const turn: Turn = {
        me, other, ch, step,
        bag: ch.backpack.entries.map((e) => e.item),
        tab: ch.stash[0].grid.entries.map((e) => e.item),
        held: CURRENCY_IDS.filter((id) => slot(ch, id) > 0),
        tradeId: server.game.trades.tradeIdOf(me.characterId),
      };
      let roll = rand() * weight;
      const action = actions.find(([w]) => (roll -= w) < 0) ?? actions[actions.length - 1];
      action[1](turn);
      ida.input();
      jon.input();
      tick(server, clock);
      clock.advance(100);
      expect(total(), `step ${step}`).toEqual(start);
    }
    for (const p of players) expect(uniqueUids(chOf(p))).toBe(true);
    // The run really exercised every path (not a vacuous pass).
    const paths = [
      'deposit', 'tab → cstash', 'withdraw', 'cstash → tab', 'quickMove', 'split to tab', 'tab → backpack', 'to tab', 'file map',
      'file tab map', 'take map', 'load device', 'device → map stash', 'device out', 'deposit all', 'drop', 'backpack move',
    ];
    for (const what of paths) expect(ok.get(what) ?? 0, what).toBeGreaterThan(5);
    expect(logger.lines.filter((l) => l.msg === 'trade completed').length).toBeGreaterThan(0);
    expect(logger.lines.filter((l) => l.msg === 'ground item picked up').length).toBeGreaterThan(0);
  }, 60_000);
});
