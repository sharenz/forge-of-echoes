import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { debugMerch } from '../../src/server/debug-merch-cli';
import { DEBUG_MERCHANT_DEFAULTS } from '../../src/game/progression/debug-merchant';
import { parseClientMessage } from '../../src/net';
import { createClock, createLocalCharacter, LocalPlayer, openMap, partyUp, startTestServer, walkIntoProp } from './helpers';

const dir = mkdtempSync(join(tmpdir(), 'forge-debug-merchant-'));
let server: Awaited<ReturnType<typeof startTestServer>>;
afterEach(async () => { vi.restoreAllMocks(); await server?.close(); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const buy = { c: 'buyDebugOffer' as const, offerId: 'currency:hasteScarab4', options: { ...DEBUG_MERCHANT_DEFAULTS, quantity: 10 } };

it('CLI activation is character-specific, updates live hideouts, serves visitors and persists purchases and activation', async () => {
  const dbPath = join(dir, 'live.db'), clock = createClock();
  const config = { dbPath, game: { autoTick: false, now: clock.now } };
  server = await startTestServer(config);
  const ownerId = createLocalCharacter(server, 'Eldurin'), guestId = createLocalCharacter(server, 'Guest');
  const alt = server.game.store.create('acct-Eldurin', 'Alt');
  if (!alt.ok) throw new Error(alt.error);
  let owner = new LocalPlayer(server, ownerId), guest = new LocalPlayer(server, guestId);
  expect(owner.view.props.some(p => p.kind === 'debugMerchant')).toBe(false);
  expect(owner.command(buy).ok).toBe(false);
  await expect(debugMerch(['u_Guest', 'Eldurin', 'enable'], dbPath)).rejects.toThrow('does not belong');
  expect(await debugMerch(['U_ELDURIN', 'eldurin', 'enable'], dbPath)).toContain('enabled');
  server.game.maintenance();
  expect(owner.view.props.filter(p => p.kind === 'debugMerchant')).toHaveLength(1);
  expect(server.db.debugMerchantEnabled(alt.character.id)).toBe(false);
  expect(guest.command(buy).ok).toBe(false);
  partyUp(owner, guest);
  expect(guest.command({ c: 'visitHideout', characterId: ownerId }).ok).toBe(true);
  const hostBag = owner.session.record.ch.backpack;
  expect(guest.command(buy).ok).toBe(true);
  expect(owner.session.record.ch.backpack).toEqual(hostBag);
  const guestBag = guest.session.record.ch.backpack;
  expect(guestBag.entries.some(e => e.item.kind === 'currency' && e.item.currencyId === 'hasteScarab4' && e.item.count === 10)).toBe(true);
  await server.close(); server = await startTestServer(config);
  owner = new LocalPlayer(server, ownerId); guest = new LocalPlayer(server, guestId);
  expect(owner.view.props.some(p => p.kind === 'debugMerchant')).toBe(true);
  expect(guest.session.record.ch.backpack).toEqual(guestBag);
  expect(guest.command({ c: 'visitHideout', characterId: ownerId }).ok).toBe(true);
  await debugMerch(['u_Eldurin', 'Eldurin', 'disable'], dbPath);
  // Stale panels lose purchasing access immediately, before the next visual refresh.
  expect(guest.command(buy).ok).toBe(false);
  server.game.maintenance();
  expect(owner.view.props.some(p => p.kind === 'debugMerchant')).toBe(false);
  expect(guest.session.record.ch.backpack).toEqual(guestBag);
}, 30_000);

it('requires an enabled hideout, validates commands and never grants an unsaved purchase', async () => {
  const clock = createClock();
  server = await startTestServer({ game: { autoTick: false, now: clock.now } });
  const p = new LocalPlayer(server, createLocalCharacter(server, 'Tester'));
  server.db.setDebugMerchant(p.characterId, true); server.game.maintenance();
  const before = p.session.record.ch;
  const failure = vi.spyOn(server.game.store, 'commit').mockReturnValueOnce(false);
  expect(p.command(buy).ok).toBe(false);
  expect(p.session.record.ch).toEqual(before);
  failure.mockRestore();
  for (const bad of [{ ...buy, ownerId: p.characterId }, { ...buy, options: { ...buy.options, quantity: 101 } }, { ...buy, options: { ...buy.options, itemLevel: 0 } }])
    expect(parseClientMessage(JSON.stringify({ t: 'cmd', id: 1, cmd: bad })).ok).toBe(false);
  openMap(p); walkIntoProp(p, 'portal', clock);
  expect(p.command(buy).ok).toBe(false);
});

it('CLI refuses bad arguments and nonexistent database paths without creating a new database', async () => {
  const path = join(dir, 'missing.db');
  await expect(debugMerch(['account', 'character', 'enable'], path)).rejects.toThrow('does not exist');
  expect(existsSync(path)).toBe(false);
  await expect(debugMerch(['account', 'character', 'anything'], path)).rejects.toThrow('Usage');
});
