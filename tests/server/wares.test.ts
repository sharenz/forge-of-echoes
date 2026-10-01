// Rook's wares board over the real command path (GAME_SPEC §9): per-character boards, atomic purchases, stale views refused, sold slots that
// survive a restart, level-up and rotation refreshes (04:00 UTC + n x 6 h), the doubling reroll price and a board per visitor.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { CharacterSave } from '../../src/contracts/items';
import type { MerchantBoard } from '../../src/contracts/game';
import { currencyOnHand } from '../../src/game/progression';
import { rerollCost, waresRotation, waresRotationStart } from '../../src/game/progression/wares';
import { captureLogger, createClock, createLocalCharacter, LocalPlayer, savedCharacter, startTestServer, fillBackpack } from './helpers';

const HOUR = 3_600_000;
const dir = mkdtempSync(join(tmpdir(), 'forge-wares-test-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

type Server = Awaited<ReturnType<typeof startTestServer>>;
let server: Server | null = null;
afterEach(async () => { await server?.close(); server = null; });

async function setup(names: string[], start = Date.UTC(2026, 9, 1, 12, 0, 0), dbPath?: string) {
  const clock = createClock(start);
  server = await startTestServer({ logger: captureLogger(), ...(dbPath ? { dbPath } : {}), game: { autoTick: false, now: clock.now } });
  const players = names.map((n) => new LocalPlayer(server!, createLocalCharacter(server!, n)));
  return { server, clock, players };
}

const chOf = (p: LocalPlayer): CharacterSave => p.session.record.ch;
const board = (p: LocalPlayer): MerchantBoard => {
  const r = p.command({ c: 'merchantWares' });
  if (!r.ok || !r.board) throw new Error('no board');
  return r.board;
};
const scrap = (p: LocalPlayer): number => currencyOnHand(chOf(p), 'scrap');

function giveScrap(p: LocalPlayer, count: number): void {
  const ch = chOf(p);
  const entries = ch.backpack.entries.map((e) => (e.item.kind === 'currency' && e.item.currencyId === 'scrap' ? { ...e, item: { ...e.item, count } } : e));
  p.server.game.setCharacter(p.session, { ...ch, backpack: { ...ch.backpack, entries } });
}

describe('the wares board', () => {
  it('is answered by the server per character: 4 maps and 8 items, the same one on every look, saved with the character', async () => {
    const { players: [p] } = await setup(['Wanda Ware']);
    const first = board(p);
    expect(first.wares).toHaveLength(12);
    expect(first.wares.map((w) => w.kind)).toEqual([...Array(4).fill('map'), ...Array(8).fill('item')]);
    expect(first.wares[0]).toMatchObject({ guaranteed: true });
    expect(first.wares[4]).toMatchObject({ featured: true });
    expect(first.rerollCost).toBe(3);
    expect(board(p)).toEqual(first);
    expect(chOf(p).wares).toMatchObject({ rotation: first.rotation, level: first.level, rerolls: 0, sold: [] });
    expect(savedCharacter(p.server, p.characterId).wares).toMatchObject({ rotation: first.rotation });
  });

  it('gives every visitor their own board in a shared hideout', async () => {
    const { players: [host, guest] } = await setup(['Host Hana', 'Guest Gil']);
    expect(host.command({ c: 'partyInvite', name: guest.session.name }).ok).toBe(true);
    const inv = guest.last('invite')!.invite;
    expect(guest.command({ c: 'partyRespond', inviteId: inv.inviteId, accept: true }).ok).toBe(true);
    expect(guest.command({ c: 'visitHideout', characterId: host.characterId }).ok).toBe(true);
    const hostBoard = board(host);
    const guestBoard = board(guest);
    expect(guestBoard.wares.map((w) => w.item)).not.toEqual(hostBoard.wares.map((w) => w.item));
    // The guest buys from their own board and pays with their own Scrap; the host's character does not change.
    const hostBefore = chOf(host);
    const before = scrap(guest);
    const bought = guest.command({ c: 'buyWare', wareId: guestBoard.wares[0].id });
    expect(bought).toMatchObject({ ok: true });
    expect(scrap(guest)).toBe(before - guestBoard.wares[0].price[0].count);
    expect(chOf(host)).toBe(hostBefore);
    // Someone else's ware id is a stale view of nothing: the epoch is shared, the slot is theirs.
    expect(host.command({ c: 'buyWare', wareId: hostBoard.wares[0].id }).ok).toBe(true);
    expect(chOf(host).wares!.sold).toEqual([0]);
    expect(chOf(guest).wares!.sold).toEqual([0]);
  });
});

describe('buying', () => {
  it('pays, delivers the exact item shown, marks the slot sold and saves it all at once; the same slot never sells twice', async () => {
    const { players: [p] } = await setup(['Bea Buyer']);
    const view = board(p);
    const ware = view.wares[3];
    const before = scrap(p);
    const bought = p.command({ c: 'buyWare', wareId: ware.id });
    expect(bought).toMatchObject({ ok: true });
    expect(bought.ok && bought.board!.wares[3].sold).toBe(true);
    expect(scrap(p)).toBe(before - ware.price[0].count);
    const owned = chOf(p).backpack.entries.map((e) => e.item).find((i) => i.kind === 'map' && !i.uid.startsWith('ware:') && i.uid !== 'x' && i.quality === (ware.item as { quality: number }).quality && i.areaId === (ware.item as { areaId: string }).areaId && i.tier === (ware.item as { tier: number }).tier && i.rarity === (ware.item as { rarity: string }).rarity && i.mods.length === (ware.item as { mods: unknown[] }).mods.length);
    expect(owned).toBeTruthy();
    // Written at once: the saved row already has the payment, the item and the sold slot.
    const saved = savedCharacter(p.server, p.characterId);
    expect(saved.wares!.sold).toEqual([3]);
    expect(currencyOnHand(saved, 'scrap')).toBe(before - ware.price[0].count);
    expect(saved.backpack.entries.some((e) => e.item.uid === owned!.uid)).toBe(true);
    const again = p.command({ c: 'buyWare', wareId: ware.id });
    expect(again).toMatchObject({ ok: false });
    expect(!again.ok && again.error).toMatch(/already sold/);
    expect(scrap(p)).toBe(before - ware.price[0].count);
  });

  it('refuses without changing anything when the Scrap or the room is missing, or the id is not on this board', async () => {
    const { players: [p] } = await setup(['Pat Poor']);
    const view = board(p);
    const dear = view.wares.reduce((a, b) => (b.price[0].count > a.price[0].count ? b : a));
    giveScrap(p, dear.price[0].count - 1);
    const before = chOf(p);
    const poor = p.command({ c: 'buyWare', wareId: dear.id });
    expect(poor).toMatchObject({ ok: false });
    expect(!poor.ok && poor.error).toMatch(/You need/);
    for (const bad of ['ware:1.1.1:3', 'ware:nonsense', `${view.wares[0].id}9`]) expect(p.command({ c: 'buyWare', wareId: bad }).ok).toBe(false);
    expect(chOf(p)).toBe(before);
    // No room: nothing is paid and the slot stays on sale.
    giveScrap(p, 500);
    fillBackpack(p, 0);
    const full = chOf(p);
    const noRoom = p.command({ c: 'buyWare', wareId: view.wares[1].id });
    expect(noRoom).toMatchObject({ ok: false });
    expect(chOf(p)).toBe(full);
    expect(chOf(p).wares!.sold).toEqual([]);
  });

  it('refuses the old Rook map offers by id (maps are wares now)', async () => {
    const { players: [p] } = await setup(['Old Ola']);
    const r = p.command({ c: 'buyOffer', offerId: 'map:cinderCrossing:1:plain' });
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.error).toMatch(/wares/);
    // The staples shelf is unchanged.
    expect(p.command({ c: 'buyOffer', offerId: 'flask-life' }).ok).toBe(true);
  });

  it('refuses a stale view: a new rotation, a level-up or a reroll since the board was shown', async () => {
    const { clock, players: [p] } = await setup(['Sid Stale']);
    giveScrap(p, 500);
    const view = board(p);
    const id = view.wares[0].id;
    // reroll
    expect(p.command({ c: 'rerollWares', epoch: view.epoch, cost: view.rerollCost }).ok).toBe(true);
    expect(p.command({ c: 'buyWare', wareId: id })).toMatchObject({ ok: false });
    // level-up
    const second = board(p);
    p.server.game.setCharacter(p.session, { ...chOf(p), level: chOf(p).level + 1 });
    expect(p.command({ c: 'buyWare', wareId: second.wares[0].id })).toMatchObject({ ok: false });
    // rotation
    const third = board(p);
    clock.advance(6 * HOUR);
    const late = p.command({ c: 'buyWare', wareId: third.wares[0].id });
    expect(late).toMatchObject({ ok: false });
    expect(!late.ok && late.error).toMatch(/new wares/);
    expect(chOf(p).wares!.sold).toEqual([]);
  });

  it('keeps the sold slots across a restart of the server (and stays unsold elsewhere)', async () => {
    const dbPath = join(dir, 'wares.db');
    const start = Date.UTC(2026, 9, 1, 12, 0, 0);
    const first = await setup(['Rex Restart'], start, dbPath);
    const p = first.players[0];
    giveScrap(p, 200);
    const characterId = p.characterId;
    const view = board(p);
    expect(p.command({ c: 'buyWare', wareId: view.wares[0].id }).ok).toBe(true);
    expect(p.command({ c: 'buyWare', wareId: view.wares[5].id }).ok).toBe(true);
    await server!.close();
    server = null;
    const clock = createClock(start + HOUR);
    server = await startTestServer({ logger: captureLogger(), dbPath, game: { autoTick: false, now: clock.now } });
    const back = new LocalPlayer(server, characterId);
    const after = board(back);
    expect(after.epoch).toBe(view.epoch);
    expect(after.wares.map((w) => w.sold)).toEqual(view.wares.map((_, i) => i === 0 || i === 5));
    expect(after.wares.map((w) => w.item)).toEqual(view.wares.map((w) => w.item));
    expect(back.command({ c: 'buyWare', wareId: view.wares[5].id })).toMatchObject({ ok: false });
    expect(back.command({ c: 'buyWare', wareId: view.wares[6].id })).toMatchObject({ ok: true });
  });
});

describe('refreshes', () => {
  it('rotates exactly at 04:00 UTC + n x 6 h', async () => {
    const t = (h: number, m: number, s = 0) => Date.UTC(2026, 9, 1, h, m, s);
    const { clock, players: [p] } = await setup(['Rota Rue'], t(3, 59, 59));
    const a = board(p);
    expect(a.rotation).toBe(waresRotation(t(3, 59, 59)));
    expect(a.nextRotationAt).toBe(t(4, 0));
    clock.advance(1000); // 04:00:00
    const b = board(p);
    expect(b.rotation).toBe(a.rotation + 1);
    expect(b.epoch).not.toBe(a.epoch);
    expect(b.nextRotationAt).toBe(t(10, 0));
    clock.advance(5 * HOUR + 59 * 60_000 + 59_000); // 09:59:59
    expect(board(p).epoch).toBe(b.epoch);
    clock.advance(1000); // 10:00:00
    expect(board(p).rotation).toBe(b.rotation + 1);
    expect(waresRotationStart(b.rotation + 1)).toBe(t(10, 0));
  });

  it('a level-up refreshes the board for that character (and sold slots clear)', async () => {
    const { players: [p] } = await setup(['Lev Up']);
    const before = board(p);
    expect(p.command({ c: 'buyWare', wareId: before.wares[0].id }).ok).toBe(true);
    p.server.game.setCharacter(p.session, { ...chOf(p), level: chOf(p).level + 1 });
    const after = board(p);
    expect(after.epoch).not.toBe(before.epoch);
    expect(after.level).toBe(before.level + 1);
    expect(after.wares.every((w) => !w.sold)).toBe(true);
    expect(after.rotation).toBe(before.rotation);
  });
});

describe('asking for new wares', () => {
  it('costs Scrap that doubles per use inside a rotation (3, 6, 12 ...), is refused when stale or unaffordable, and resets with the rotation', async () => {
    const { clock, players: [p] } = await setup(['Rita Reroll']);
    giveScrap(p, 200);
    const epochs: string[] = [];
    let spent = 0;
    for (let i = 0; i < 5; i++) {
      const view = board(p);
      expect(view.rerollCost).toBe(rerollCost(i));
      epochs.push(view.epoch);
      const r = p.command({ c: 'rerollWares', epoch: view.epoch, cost: view.rerollCost });
      expect(r).toMatchObject({ ok: true });
      expect(r.ok && r.board!.rerolls).toBe(i + 1);
      spent += view.rerollCost;
      expect(scrap(p)).toBe(200 - spent);
    }
    expect(spent).toBe(3 + 6 + 12 + 24 + 48);
    expect(new Set(epochs).size).toBe(5);
    const now = board(p);
    expect(now.rerollCost).toBe(48);
    // stale price / epoch: refused, nothing charged
    const before = scrap(p);
    expect(p.command({ c: 'rerollWares', epoch: now.epoch, cost: 3 })).toMatchObject({ ok: false });
    expect(p.command({ c: 'rerollWares', epoch: 'x.1.1', cost: 48 })).toMatchObject({ ok: false });
    expect(scrap(p)).toBe(before);
    giveScrap(p, 47);
    expect(p.command({ c: 'rerollWares', epoch: now.epoch, cost: 48 })).toMatchObject({ ok: false });
    expect(chOf(p).wares!.rerolls).toBe(5);
    // the next rotation starts over at the base price
    clock.advance(6 * HOUR);
    const next = board(p);
    expect(next.rerolls).toBe(0);
    expect(next.rerollCost).toBe(3);
  });

  it('is hideout-only like the rest of Rook', async () => {
    const { players: [p] } = await setup(['Hide Out']);
    expect(p.command({ c: 'merchantWares' }).ok).toBe(true);
  });
});
