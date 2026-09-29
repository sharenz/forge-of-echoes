import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterSave, Item, MapItem } from '../../src/contracts/items';
import { rules } from '../../src/game';
import { createGrid, createStashTab, placeItem } from '../../src/game/items';
import { GameDatabase } from '../../src/server/db';
import { CharacterStore } from '../../src/server/characters';
import { mergeLegacyStorage, namespaceItems, parseAccountStorage, withoutStorage } from '../../src/server/account-storage';
import { silentLogger } from '../../src/server/log';

let db: GameDatabase;
let store: CharacterStore;
afterEach(() => { vi.restoreAllMocks(); store?.flushAll(); db?.close(); });

async function setup() {
  db = await GameDatabase.open(':memory:');
  for (const id of ['account-a', 'account-b']) db.createAccount({ id, username: id, passHash: 'unused', salt: 'unused', created: 1 });
  store = new CharacterStore(db, silentLogger, { saveDebounceMs: 60_000, now: () => 1000 });
}

function create(name: string, account = 'account-a') {
  const result = store.create(account, name);
  if (!result.ok) throw new Error(result.error);
  return store.acquire(result.character.id)!;
}

function moved(ch: CharacterSave, uid: string, stashTab: number | null) {
  const result = rules.quickMove(ch, uid, { stashTab });
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function insert(ch: CharacterSave) {
  expect(db.insertCharacter({ id: ch.id, name: ch.name, accountId: 'account-a', level: ch.level, classId: ch.classId, data: JSON.stringify(ch), saveVersion: 1, created: 1, updated: 1 })).toBe('ok');
}

function items(ch: Pick<CharacterSave, 'stash' | 'mapStash'>): Item[] {
  return [...ch.stash.flatMap((t) => t.grid.entries.map((e) => e.item)), ...ch.mapStash];
}

describe('account-wide storage', () => {
  it('shares deposits immediately, prevents a second withdrawal, and persists both halves together', async () => {
    await setup();
    const a = create('First Hero');
    const b = create('Second Hero');
    const outsider = create('Other Account', 'account-b');
    expect(a.ch.uidNamespace).not.toBe(b.ch.uidNamespace);
    const notify = vi.fn();
    store.onSharedChange = notify;
    const map = a.ch.backpack.entries.find((e) => e.item.kind === 'map')!.item;
    store.set(a, moved(a.ch, map.uid, 0));
    expect(b.ch.mapStash).toBe(a.ch.mapStash);
    expect(b.ch.mapStash[0].uid).toBe(map.uid);
    expect(outsider.ch.mapStash).toHaveLength(0);
    expect(notify).toHaveBeenCalledWith(b);
    store.set(b, moved(b.ch, map.uid, 0));
    expect(a.ch.mapStash).toHaveLength(0);
    expect(rules.quickMove(a.ch, map.uid, { stashTab: 0 }).ok).toBe(false);
    // Flushing only A must also persist B's withdrawal of the item A deposited.
    store.flush(a);
    const again = new CharacterStore(db, silentLogger, { saveDebounceMs: 60_000, now: () => 2000 });
    const loadedA = again.acquire(a.id)!;
    const loadedB = again.acquire(b.id)!;
    expect(loadedA.ch.mapStash).toHaveLength(0);
    expect(loadedA.ch.backpack.entries.some((e) => e.item.uid === map.uid)).toBe(false);
    expect(loadedB.ch.backpack.entries.filter((e) => e.item.uid === map.uid)).toHaveLength(1);
    expect(JSON.parse(db.characterById(a.id)!.data).stash).toEqual([]);
    expect(JSON.parse(db.characterById(b.id)!.data).mapStash).toEqual([]);
    again.release(loadedA); again.release(loadedB);
  });

  it('uses one currency balance, keeps storage after deleting its depositor, and exposes it to a fresh alt', async () => {
    await setup();
    const a = create('Depositor');
    const b = create('Spender');
    const scrap = a.ch.backpack.entries.find((e) => e.item.kind === 'currency' && e.item.currencyId === 'scrap')!.item;
    if (scrap.kind !== 'currency') throw new Error('currency fixture');
    store.set(a, moved(a.ch, scrap.uid, 0));
    expect(b.ch.currencyStash.scrap).toBe(scrap.count);
    const one = rules.quickMove(b.ch, 'cstash:scrap', { stashTab: 'currency', count: 1 });
    if (!one.ok) throw new Error(one.error);
    store.set(b, one.value);
    expect(a.ch.currencyStash.scrap).toBe(scrap.count - 1);
    store.release(a);
    expect(store.delete('account-a', a.id)).toBe(true);
    const alt = create('Fresh Alt');
    expect(alt.ch.currencyStash.scrap).toBe(scrap.count - 1);
    expect(alt.ch.stash).toBe(b.ch.stash);
  });

  it('merges full legacy stashes without item loss, over-cap truncation, duplicate IDs or repeated migration', async () => {
    await setup();
    const originals: CharacterSave[] = [];
    for (let n = 0; n < 2; n++) {
      const base = rules.createCharacter(`Legacy ${n}`, n + 1);
      const map = base.backpack.entries.find((e) => e.item.kind === 'map')!.item as MapItem;
      const ch: CharacterSave = { ...base, stash: [], currencyStash: { scrap: 5000 }, mapStash: Array.from({ length: 400 }, (_, k) => ({ ...map, uid: `map${k}` })) };
      for (let t = 0; t < 8; t++) {
        let grid = createGrid(12, 8);
        for (let k = 0; k < 96; k++) grid = placeItem(grid, { kind: 'currency', uid: `tab${t}item${k}`, currencyId: 'scrap', count: 40 }, k % 12, Math.floor(k / 12))!;
        ch.stash.push({ name: `Tab ${t}`, grid });
      }
      originals.push(ch); insert(ch);
    }
    const a = store.acquire(originals[0].id)!;
    const b = store.acquire(originals[1].id)!;
    const all = items(a.ch);
    const currency = all.reduce((n, i) => n + (i.kind === 'currency' ? i.count : 0), a.ch.currencyStash.scrap ?? 0);
    expect(currency).toBe(10_000 + 2 * 8 * 96 * 40);
    expect(all.filter((i) => i.kind === 'map')).toHaveLength(800);
    expect(new Set(all.map((i) => i.uid)).size).toBe(all.length);
    expect(a.ch.stash.length).toBeGreaterThan(16);
    expect(a.ch.stashCapacity).toBe(a.ch.stash.length);
    const lastTab = a.ch.stash.length - 1;
    expect(rules.quickMove(a.ch, a.ch.stash[lastTab].grid.entries[0].item.uid, { stashTab: lastTab }).ok).toBe(true);
    expect(b.ch.mapStash).toBe(a.ch.mapStash);
    const committed = db.accountStorage('account-a')!.data;
    expect(parseAccountStorage(committed).stash).toEqual(a.ch.stash);
    store.release(a); store.release(b);
    const reloaded = store.acquire(originals[1].id)!;
    expect(JSON.stringify({ ...parseAccountStorage(committed) })).toBe(JSON.stringify(parseAccountStorage(db.accountStorage('account-a')!.data)));
    expect(items(reloaded.ch)).toEqual(all);
  });

  it('rolls back a failed migration and retries without duplicating any legacy holdings', async () => {
    await setup();
    const legacy = rules.createCharacter('Old Keeper', 10);
    const map = legacy.backpack.entries.find((e) => e.item.kind === 'map')!.item as MapItem;
    insert({ ...legacy, mapStash: [{ ...map, uid: 'legacy-map' }], currencyStash: { scrap: 12 } });
    const before = db.characterById(legacy.id)!.data;
    const failure = vi.spyOn(db, 'saveAccountStorage').mockImplementationOnce(() => { throw new Error('disk full'); });
    expect(() => store.acquire(legacy.id)).toThrow('disk full');
    expect(db.characterById(legacy.id)!.data).toBe(before);
    expect(db.accountStorage('account-a')).toBeNull();
    failure.mockRestore();
    const rec = store.acquire(legacy.id)!;
    expect(rec.ch.mapStash).toHaveLength(1);
    expect(rec.ch.currencyStash.scrap).toBe(12);
  });

  it('failed shared saves remain retryable; a failed immediate commit changes neither account nor character', async () => {
    await setup();
    const a = create('Durable Alpha');
    const b = create('Durable Beta');
    const map = a.ch.backpack.entries.find((e) => e.item.kind === 'map')!.item;
    const before = a.ch;
    expect(store.commit(a, moved(a.ch, map.uid, 0), () => { throw new Error('abort'); })).toBe(false);
    expect(a.ch).toBe(before);
    expect(b.ch.mapStash).toHaveLength(0);
    store.set(a, moved(a.ch, map.uid, 0));
    store.set(b, moved(b.ch, map.uid, 0));
    const failure = vi.spyOn(db, 'saveAccountStorage').mockImplementationOnce(() => { throw new Error('disk full'); });
    expect(store.flushTogether([a])).toBe(false);
    expect(a.dirty && b.dirty).toBe(true);
    expect(JSON.parse(db.characterById(a.id)!.data).backpack.entries.some((e: { item: Item }) => e.item.uid === map.uid)).toBe(true);
    failure.mockRestore();
    expect(store.flushTogether([b])).toBe(true);
    expect(a.dirty || b.dirty).toBe(false);
  });

  it('namespaces are preserved by save normalization and newly minted items cannot collide between alts', () => {
    const a = namespaceItems(rules.createCharacter('Namespace A', 1));
    const b = namespaceItems(rules.createCharacter('Namespace B', 1));
    expect(a.uidNamespace).not.toBe(b.uidNamespace);
    const parsed = rules.parseSave(JSON.stringify({ ...rules.newSave(), characters: [a] })).characters[0];
    expect(parsed.uidNamespace).toBe(a.uidNamespace);
    expect(parsed.backpack).toEqual(a.backpack);
    expect(withoutStorage(a).stash).toEqual([]);
    expect(mergeLegacyStorage([]).stash).toEqual([createStashTab('Main'), createStashTab('Maps')]);
  });

  it('refuses damaged shared storage rather than silently clamping a balance or discarding a duplicate item', () => {
    const ch = namespaceItems(rules.createCharacter('Saved Stash', 4));
    const storage = mergeLegacyStorage([ch]);
    expect(() => parseAccountStorage(JSON.stringify({ ...storage, currencyStash: { scrap: 5001 } }))).toThrow(/currency recovery/);
    const map = ch.backpack.entries.find((e) => e.item.kind === 'map')!.item;
    expect(() => parseAccountStorage(JSON.stringify({ ...storage, mapStash: [map, map] }))).toThrow(/item recovery/);
  });
});
