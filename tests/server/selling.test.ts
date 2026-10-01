import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { rules } from '../../src/game';
import { parseClientMessage } from '../../src/net';
import { createClock, createLocalCharacter, LocalPlayer, openMap, partyUp, startTestServer, walkIntoProp } from './helpers';

const dir = mkdtempSync(join(tmpdir(), 'forge-selling-'));
let server: Awaited<ReturnType<typeof startTestServer>>;
afterEach(async () => { vi.restoreAllMocks(); await server?.close(); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));
function prepare(p: LocalPlayer): void {
  const robe = p.session.record.ch.equipment.chest!;
  expect(p.command({ c: 'quickMove', uid: robe.uid, stashTab: null }).ok).toBe(true);
  expect(server.game.store.flushTogether([p.session.record])).toBe(true);
}
const itemOf = (p: LocalPlayer) => p.session.record.ch.backpack.entries.find(e => e.item.kind === 'equipment')!.item;
const sell = (p: LocalPlayer) => { const i = itemOf(p); return { c: 'sellItems' as const, uids: [i.uid], expectedScrap: rules.sellQuote(i)!.scrap }; };

it('a visitor sells their own equipment, pays their account stash once, and both sides survive restart', async () => {
  const clock = createClock(), config = { dbPath: join(dir, 'saved.db'), game: { autoTick: false, now: clock.now } };
  server = await startTestServer(config);
  const hostId = createLocalCharacter(server, 'Host'), guestId = createLocalCharacter(server, 'Seller');
  let host = new LocalPlayer(server, hostId), guest = new LocalPlayer(server, guestId);
  prepare(host); prepare(guest);
  const alt = server.game.store.create('acct-Seller', 'Seller Alt');
  if (!alt.ok) throw new Error(alt.error);
  const sibling = new LocalPlayer(server, alt.character.id);
  partyUp(host, guest); expect(guest.command({ c: 'visitHideout', characterId: hostId }).ok).toBe(true);
  const hostBag = host.session.record.ch.backpack, before = guest.session.record.ch.currencyStash.scrap ?? 0;
  const cmd = sell(guest);
  expect(guest.command({ ...cmd, uids: [itemOf(host).uid] }).ok).toBe(false);
  expect(guest.command(cmd).ok).toBe(true);
  expect(guest.session.record.ch.currencyStash.scrap).toBe(before + cmd.expectedScrap);
  expect(sibling.session.record.ch.currencyStash.scrap).toBe(before + cmd.expectedScrap);
  expect(host.session.record.ch.backpack).toEqual(hostBag);
  expect(guest.command(cmd).ok).toBe(false);
  await server.close(); server = await startTestServer(config);
  host = new LocalPlayer(server, hostId); guest = new LocalPlayer(server, guestId);
  expect(guest.session.record.ch.backpack.entries.some(e => cmd.uids.includes(e.item.uid))).toBe(false);
  expect(guest.session.record.ch.currencyStash.scrap).toBe(before + cmd.expectedScrap);
  expect(host.session.record.ch.backpack).toEqual(hostBag);
});

it('a failed database transaction keeps both the sold items and the old payout, and a retry pays once', async () => {
  server = await startTestServer({ game: { autoTick: false } });
  const p = new LocalPlayer(server, createLocalCharacter(server, 'Save Fail'));
  prepare(p);
  const cmd = sell(p), before = p.session.record.ch;
  const fail = vi.spyOn(server.db, 'saveAccountStorage').mockImplementationOnce(() => { throw new Error('injected save failure'); });
  expect(p.command(cmd).ok).toBe(false);
  expect(p.session.record.ch).toEqual(before);
  expect(JSON.parse(server.db.characterById(p.characterId)!.data).backpack).toEqual(before.backpack);
  fail.mockRestore();
  expect(p.command(cmd).ok).toBe(true);
  expect(p.command(cmd).ok).toBe(false);
  expect(p.session.record.ch.currencyStash.scrap).toBe((before.currencyStash.scrap ?? 0) + cmd.expectedScrap);
});

it('rejects trade-locked equipment, map sales, stale values and forged or duplicate inputs', async () => {
  const clock = createClock(); server = await startTestServer({ game: { autoTick: false, now: clock.now } });
  const p = new LocalPlayer(server, createLocalCharacter(server, 'Trader')), other = new LocalPlayer(server, createLocalCharacter(server, 'Buyer'));
  prepare(p);
  const cmd = sell(p);
  expect(p.command({ ...cmd, expectedScrap: cmd.expectedScrap + 1 }).ok).toBe(false);
  expect(p.command({ c: 'tradeRequest', name: other.session.name }).ok).toBe(true);
  expect(other.command({ c: 'tradeRespond', requestId: other.last('tradeRequest')!.request.requestId, accept: true }).ok).toBe(true);
  const tradeId = p.last('trade')!.trade!.tradeId;
  expect(p.command({ c: 'tradeOffer', tradeId, uids: cmd.uids }).ok).toBe(true);
  expect(p.command(cmd).ok).toBe(false);
  expect(p.command({ c: 'tradeCancel', tradeId }).ok).toBe(true);
  openMap(p); walkIntoProp(p, 'portal', clock);
  expect(p.command(cmd).ok).toBe(false);
  for (const bad of [{ ...cmd, uids: [] }, { ...cmd, uids: [...cmd.uids, ...cmd.uids] }, { ...cmd, price: 999 }, { ...cmd, expectedScrap: -1 }, { ...cmd, expectedScrap: 1.5 }, { ...cmd, uids: Array.from({ length: 61 }, (_, i) => `x${i}`) }])
    expect(parseClientMessage(JSON.stringify({ t: 'cmd', id: 1, cmd: bad })).ok).toBe(false);
});
