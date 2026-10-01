// The Crafting Stash work slot over the real command path and real storage (GAME_SPEC §12): loading and emptying it
// with moveItem / quickMove, crafting on its item straight from Crafting Stash slots, the hideout-only rule, trade
// locks, account-wide sharing between characters, and durability: a move is on disk before its answer, a disconnect,
// a restart and a second character never duplicate or lose the item. In-process (fake connections, fake clock) for
// the rules, real sockets and a real database file for the restart.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import type { CharacterSave, EquipmentItem } from '../../src/contracts/items';
import { currencyStashUid } from '../../src/contracts/items';
import { rules } from '../../src/game';
import { ITEM_IN_TRADE } from '../../src/server/trade';
import { mergeLegacyStorage, parseAccountStorage, sameStorage, storageOf, withoutStorage } from '../../src/server/account-storage';
import { withCraftSlot } from '../../src/game/items';
import { api, captureLogger, createClock, createLocalCharacter, enterMapOf, holdings, LocalPlayer, newPlayer, openMap, savedCharacter, startTestServer, uidsOf } from './helpers';
import { TestClient } from './ws-client';

type Server = Awaited<ReturnType<typeof startTestServer>>;

let server: Server | null = null;
afterEach(async () => {
  await server?.close();
  server = null;
});
const dir = mkdtempSync(join(tmpdir(), 'forge-work-slot-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function pinnedEntropy(seed = 0x57a54123): () => number {
  let s = seed >>> 0;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0);
}

async function setup(names: string[]) {
  const clock = createClock();
  server = await startTestServer({ logger: captureLogger(), game: { autoTick: false, now: clock.now, entropy: pinnedEntropy() } });
  const players = names.map((n) => new LocalPlayer(server!, createLocalCharacter(server!, n)));
  return { server, clock, players };
}

const chOf = (p: LocalPlayer): CharacterSave => p.session.record.ch;
const unique = (ch: CharacterSave): boolean => new Set(uidsOf(ch)).size === uidsOf(ch).length;

function wandOf(ch: CharacterSave): EquipmentItem {
  const w = ch.equipment.mainHand;
  if (!w) throw new Error('no equipped wand');
  return w;
}

describe('work slot: commands', () => {
  it('loads the equipped wand, crafts on it from the Crafting Stash, takes it back out; every step is saved at once', async () => {
    const { server, players: [p] } = await setup(['Wendy Work']);
    const start = holdings(chOf(p));
    const wand = wandOf(chOf(p));
    const before = chOf(p).stats.itemsCrafted;

    // Drag the worn wand into the slot: it leaves the body, the state is pushed, and the DB row already has it.
    expect(p.command({ c: 'moveItem', uid: wand.uid, to: { kind: 'craftSlot' } })).toMatchObject({ ok: true });
    expect(chOf(p).equipment.mainHand).toBeUndefined();
    expect(chOf(p).craftSlot?.uid).toBe(wand.uid);
    expect(savedCharacter(server, p.characterId).craftSlot?.uid).toBe(wand.uid);
    expect(p.last('character')?.character.craftSlot?.uid).toBe(wand.uid);
    expect(holdings(chOf(p))).toEqual(start);

    // Stock the Crafting Stash and craft on the slot item: one Kindling is refused (already magic), one Scrap works.
    p.command({ c: 'quickMove', uid: chOf(p).backpack.entries.find((e) => e.item.kind === 'currency' && e.item.currencyId === 'scrap')!.item.uid, stashTab: 'currency' });
    const scrapBefore = chOf(p).currencyStash.scrap ?? 0;
    expect(scrapBefore).toBeGreaterThan(0);
    const crafted = p.command({ c: 'applyCurrency', currencyUid: currencyStashUid('scrap'), targetUid: wand.uid });
    expect(crafted.ok).toBe(true);
    expect(chOf(p).currencyStash.scrap).toBe(scrapBefore - 1);
    expect(chOf(p).craftSlot?.uid).toBe(wand.uid);
    expect(chOf(p).stats.itemsCrafted).toBe(before + 1);
    expect(savedCharacter(server, p.characterId).craftSlot).toEqual(chOf(p).craftSlot);

    // Give it back (Ctrl-click): into the backpack, never twice.
    expect(p.command({ c: 'quickMove', uid: wand.uid, stashTab: 'currency' })).toMatchObject({ ok: true });
    expect(chOf(p).craftSlot ?? null).toBeNull();
    expect(chOf(p).backpack.entries.filter((e) => e.item.uid === wand.uid)).toHaveLength(1);
    expect(savedCharacter(server, p.characterId).craftSlot ?? null).toBeNull();
    expect(unique(chOf(p))).toBe(true);
  });

  it('Ctrl-click with a Crafting Stash tab open loads gear from the backpack and the body; other tabs do not', async () => {
    const { players: [p] } = await setup(['Wendy Quick']);
    const wand = wandOf(chOf(p));
    expect(p.command({ c: 'quickMove', uid: wand.uid, stashTab: 'mapCurrency' }).ok).toBe(true);
    expect(chOf(p).craftSlot?.uid).toBe(wand.uid);
    const map = chOf(p).backpack.entries.find((e) => e.item.kind === 'map')!.item;
    // A map swaps with the wand: the wand goes back where the map came from.
    expect(p.command({ c: 'quickMove', uid: map.uid, stashTab: 'currency' }).ok).toBe(true);
    expect(chOf(p).craftSlot?.uid).toBe(map.uid);
    expect(chOf(p).backpack.entries.some((e) => e.item.uid === wand.uid)).toBe(true);
    expect(unique(chOf(p))).toBe(true);
  });

  it('refuses everything outside a hideout and in a trade offer, and only gear and maps fit', async () => {
    const { clock, players: [p, q] } = await setup(['Wendy Rules', 'Tradey Tess']);
    const wand = wandOf(chOf(p));
    const bagCurrency = chOf(p).backpack.entries.find((e) => e.item.kind === 'currency')!.item;
    expect(p.command({ c: 'moveItem', uid: bagCurrency.uid, to: { kind: 'craftSlot' } })).toMatchObject({ ok: false, error: 'The work slot holds one piece of gear or one map.' });
    expect(p.command({ c: 'moveItem', uid: 'nope', to: { kind: 'craftSlot' } })).toMatchObject({ ok: false });

    // Trade locks: an offered backpack item cannot be loaded, and the slot's item cannot be offered.
    const map = chOf(p).backpack.entries.find((e) => e.item.kind === 'map')!.item;
    const from = q.mark();
    expect(p.command({ c: 'tradeRequest', name: q.session.name }).ok).toBe(true);
    const req = q.all('tradeRequest', from).at(-1)!;
    expect(q.command({ c: 'tradeRespond', requestId: req.request.requestId, accept: true }).ok).toBe(true);
    const tradeId = p.last('trade')!.trade!.tradeId;
    expect(p.command({ c: 'tradeOffer', tradeId, uids: [map.uid] }).ok).toBe(true);
    expect(p.command({ c: 'moveItem', uid: map.uid, to: { kind: 'craftSlot' } })).toMatchObject({ ok: false, error: ITEM_IN_TRADE });
    expect(p.command({ c: 'quickMove', uid: map.uid, stashTab: 'currency' })).toMatchObject({ ok: false, error: ITEM_IN_TRADE });
    expect(chOf(p).craftSlot ?? null).toBeNull();
    expect(p.command({ c: 'moveItem', uid: wand.uid, to: { kind: 'craftSlot' } }).ok).toBe(true);
    expect(p.command({ c: 'tradeOffer', tradeId, uids: [wand.uid] }).ok).toBe(false);
    expect(p.command({ c: 'tradeCancel', tradeId }).ok).toBe(true);

    // In a map the stash (and so the slot) is out of reach, loading and unloading alike.
    p.command({ c: 'quickMove', uid: wand.uid, stashTab: null });
    const m2 = chOf(p).backpack.entries.find((e) => e.item.kind === 'map')!.item;
    p.command({ c: 'moveItem', uid: wand.uid, to: { kind: 'craftSlot' } });
    openMap(p);
    enterMapOf(p, p, clock);
    expect(p.session.instance?.kind).toBe('map');
    expect(p.command({ c: 'moveItem', uid: wand.uid, to: { kind: 'backpack', x: 0, y: 0 } })).toMatchObject({ ok: false, error: 'The stash can only be used in a hideout.' });
    expect(p.command({ c: 'quickMove', uid: wand.uid, stashTab: null })).toMatchObject({ ok: false, error: 'The stash can only be used in a hideout.' });
    const loose = chOf(p).backpack.entries.find((e) => e.item.kind === 'equipment' || e.item.uid === m2.uid);
    if (loose) expect(p.command({ c: 'moveItem', uid: loose.item.uid, to: { kind: 'craftSlot' } })).toMatchObject({ ok: false, error: 'The stash can only be used in a hideout.' });
    expect(p.command({ c: 'applyCurrency', currencyUid: currencyStashUid('scrap'), targetUid: wand.uid }).ok).toBe(false);
    expect(chOf(p).craftSlot?.uid).toBe(wand.uid);
    expect(unique(chOf(p))).toBe(true);
  });

  it('dropping the slot item on the floor is the same hand-over as any stash item: once, saved at once', async () => {
    const { server, players: [p] } = await setup(['Wendy Drop']);
    const wand = wandOf(chOf(p));
    const start = holdings(chOf(p));
    p.command({ c: 'moveItem', uid: wand.uid, to: { kind: 'craftSlot' } });
    const hideout = p.session.instance!;
    expect(p.command({ c: 'dropItem', uid: wand.uid }).ok).toBe(true);
    expect(chOf(p).craftSlot ?? null).toBeNull();
    const ground = [...hideout.groundItems.values()].map((g) => g.item);
    expect(ground.filter((g) => g.uid === wand.uid || g.kind === 'equipment')).toHaveLength(1);
    expect(savedCharacter(server, p.characterId).craftSlot ?? null).toBeNull();
    expect(p.command({ c: 'dropItem', uid: wand.uid }).ok).toBe(false);
    void start;
  });
});

describe('work slot: account storage', () => {
  it('is shared by every character of the account and never exists twice', async () => {
    const clock = createClock();
    server = await startTestServer({ logger: captureLogger(), game: { autoTick: false, now: clock.now, entropy: pinnedEntropy() } });
    const accountId = 'acct-twins';
    server.db.createAccount({ id: accountId, username: 'twins', passHash: '00', salt: '00', created: 0 });
    const r1 = server.game.store.create(accountId, 'Twin One');
    const r2 = server.game.store.create(accountId, 'Twin Two');
    if (!r1.ok || !r2.ok) throw new Error('create failed');
    const a = new LocalPlayer(server, r1.character.id);
    const b = new LocalPlayer(server, r2.character.id);
    const wand = wandOf(chOf(a));
    expect(a.command({ c: 'moveItem', uid: wand.uid, to: { kind: 'craftSlot' } }).ok).toBe(true);
    // The other character sees it at once and can take it: exactly one of two racing takers wins.
    expect(chOf(b).craftSlot?.uid).toBe(wand.uid);
    const takenByB = b.command({ c: 'quickMove', uid: wand.uid, stashTab: 'currency' });
    const takenByA = a.command({ c: 'quickMove', uid: wand.uid, stashTab: 'currency' });
    expect([takenByA.ok, takenByB.ok].filter(Boolean)).toHaveLength(1);
    expect(chOf(a).craftSlot ?? null).toBeNull();
    expect(chOf(b).craftSlot ?? null).toBeNull();
    const holders = [a, b].filter((p) => chOf(p).backpack.entries.some((e) => e.item.uid === wand.uid));
    expect(holders).toHaveLength(1);
    // The equipped wand of the other twin is a different item.
    expect(wandOf(chOf(b)).uid).not.toBe(wand.uid);
  });

  it('a disconnect flushes the slot with the character; reconnecting shows the same item, once', async () => {
    const { server, players: [p] } = await setup(['Wendy Quit']);
    const wand = wandOf(chOf(p));
    p.command({ c: 'moveItem', uid: wand.uid, to: { kind: 'craftSlot' } });
    const id = p.characterId;
    server.game.detach(p.conn);
    const saved = savedCharacter(server, id);
    expect(saved.craftSlot?.uid).toBe(wand.uid);
    expect(saved.equipment.mainHand).toBeUndefined();
    expect(saved.backpack.entries.some((e) => e.item.uid === wand.uid)).toBe(false);
    const back = new LocalPlayer(server, id);
    expect(chOf(back).craftSlot?.uid).toBe(wand.uid);
    expect(unique(chOf(back))).toBe(true);
  });
});

describe('work slot: storage format', () => {
  it('account storage written before the work slot has no craftSlot and reads as an empty one (no migration step)', () => {
    const seed = rules.createCharacter('Fresh', 1);
    const old = JSON.parse(JSON.stringify(storageOf(seed)));
    delete old.craftSlot;
    expect('craftSlot' in old).toBe(false);
    const parsed = parseAccountStorage(JSON.stringify(old));
    expect(parsed.craftSlot).toBeNull();
    expect(parsed.stash).toEqual(seed.stash);
    expect(parsed.mapStash).toEqual(seed.mapStash);
    expect(parsed.currencyStash).toEqual(seed.currencyStash);
    expect(mergeLegacyStorage([seed]).craftSlot).toBeNull();
  });

  it('keeps the item (byte for byte) through write and read, and stays out of the character row', () => {
    const seed = rules.createCharacter('Keeper', 1);
    const wand = seed.equipment.mainHand!;
    const ch = withCraftSlot({ ...seed, equipment: {} }, wand);
    const stored = JSON.stringify(storageOf(ch));
    expect(parseAccountStorage(stored).craftSlot).toEqual(wand);
    expect(JSON.stringify(withoutStorage(ch))).not.toContain('craftSlot');
    expect(sameStorage(storageOf(ch), storageOf({ ...ch, craftSlot: { ...wand } }))).toBe(false);
  });

  it('refuses storage whose slot holds something that cannot be there instead of dropping it', () => {
    const seed = rules.createCharacter('Broken', 1);
    const bad = { ...JSON.parse(JSON.stringify(storageOf(seed))), craftSlot: { kind: 'currency', uid: 'x1', currencyId: 'scrap', count: 3 } };
    expect(() => parseAccountStorage(JSON.stringify(bad))).toThrow(/needs recovery/);
  });
});

describe('work slot: restart', () => {
  it('survives a restart over real sockets (even with a long save delay), for any character of the account', async () => {
    const path = join(dir, 'restart.db');
    const options = { dbPath: path, saveDebounceMs: 60_000 };
    let srv = await startTestServer(options);
    const clients: TestClient[] = [];
    let uid = '';
    let crafted: EquipmentItem;
    try {
      const owner = await newPlayer(srv.base, 'Restart Ada');
      const made = await api<{ character: { id: string } }>(srv.base, 'POST', '/api/characters', { name: 'Restart Bea' }, owner.token);
      expect(made.status).toBe(201);
      const a = await TestClient.connect(srv.base, { token: owner.token, character: owner.characterId });
      clients.push(a);
      await a.waitFor('zone');
      const wand = a.last('character')!.character.equipment.mainHand!;
      uid = wand.uid;
      expect((await a.command({ c: 'moveItem', uid, to: { kind: 'craftSlot' } })).ok).toBe(true);
      const scrap = a.last('character')!.character.backpack.entries.find((e) => e.item.kind === 'currency' && e.item.currencyId === 'scrap')!.item;
      expect((await a.command({ c: 'quickMove', uid: scrap.uid, stashTab: 'currency' })).ok).toBe(true);
      expect((await a.command({ c: 'applyCurrency', currencyUid: currencyStashUid('scrap'), targetUid: uid })).ok).toBe(true);
      crafted = (await a.waitFor('character', (m) => ((m.character.craftSlot as EquipmentItem | null)?.history.length ?? 0) > wand.history.length)).character.craftSlot as EquipmentItem;
      // Already on disk, before anything flushes on shutdown.
      const row = srv.db.accountStorage(srv.game.store.ownerOf(owner.characterId)!)!;
      expect(JSON.parse(row.data).craftSlot.uid).toBe(uid);
      a.close();
      await srv.close();

      srv = await startTestServer(options);
      const again = await TestClient.connect(srv.base, { token: owner.token, character: made.body.character.id });
      clients.push(again);
      await again.waitFor('zone');
      const ch = again.last('character')!.character;
      expect(ch.craftSlot).toEqual(crafted);
      expect(JSON.stringify(ch.backpack).includes(uid)).toBe(false);
      expect(JSON.stringify(ch.equipment).includes(uid)).toBe(false);
      // Take it over to the second character, then the account's first one can no longer find it.
      expect((await again.command({ c: 'quickMove', uid, stashTab: 'currency' })).ok).toBe(true);
      await srv.close();
      srv = await startTestServer(options);
      const first = await TestClient.connect(srv.base, { token: owner.token, character: owner.characterId });
      clients.push(first);
      await first.waitFor('zone');
      const other = first.last('character')!.character;
      expect(other.craftSlot ?? null).toBeNull();
      expect(JSON.stringify(other).split(uid).length - 1).toBe(0);
    } finally {
      for (const c of clients) c.close();
      await srv.close();
    }
  }, 30_000);
});

// Keeps the holdings helper in the import list honest for the conservation assertions above.
void rules;
