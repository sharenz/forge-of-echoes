// Shared stash data and the one-time legacy merge. No writes happen here: CharacterStore commits the
// merged stash and stripped character rows in one SQLite transaction before exposing either in memory.
import { randomUUID } from 'node:crypto';
import type { CharacterSave, GridContainer, Item } from '../contracts/items';
import { CURRENCY_STASH_MAX, MAP_STASH_CAPACITY, MAX_STASH_TABS, MAX_PRESERVED_STASH_TABS } from '../contracts/items';
import { rules } from '../game';
import { autoPlace, createGrid, createStashTab } from '../game/items';
import { normalizeCharacterReport } from '../game/progression';
import { findCurrency } from '../data/items';
import { newAtlas } from '../game/progression/atlas';

export type AccountStorage = Pick<CharacterSave, 'stash' | 'stashCapacity' | 'currencyStash' | 'mapStash' | 'atlas'>;

export function storageOf(ch: CharacterSave): AccountStorage {
  return { stash: ch.stash, stashCapacity: ch.stashCapacity, currencyStash: ch.currencyStash, mapStash: ch.mapStash, atlas: ch.atlas };
}

export function sameStorage(a: AccountStorage, b: AccountStorage): boolean {
  return a.stash === b.stash && a.currencyStash === b.currencyStash && a.mapStash === b.mapStash && a.stashCapacity === b.stashCapacity && a.atlas === b.atlas;
}

/** Shared fields are a wire/rules projection, never a second persisted copy on a character. */
export function withoutStorage(ch: CharacterSave): CharacterSave {
  const { stashCapacity: _capacity, atlas: _atlas, ...rest } = ch;
  return { ...rest, stash: [], currencyStash: {}, mapStash: [] };
}

/** Initial and legacy items are re-keyed once; all rolls and crafting metadata stay byte-for-byte intact. */
export function namespaceItems(ch: CharacterSave): CharacterSave {
  if (ch.uidNamespace) return ch;
  const prefix = `${randomUUID()}:`;
  let nextUid = Math.max(1, ch.nextUid);
  const item = <T extends Item>(i: T): T => ({ ...i, uid: `${prefix}i${(nextUid++).toString(36)}` });
  const grid = (g: GridContainer): GridContainer => ({ ...g, entries: g.entries.map((e) => ({ ...e, item: item(e.item) })) });
  const equipment = Object.fromEntries(Object.entries(ch.equipment).map(([slot, i]) => [slot, item(i!)]));
  const backpack = grid(ch.backpack);
  const stash = ch.stash.map((t) => ({ ...t, grid: grid(t.grid) }));
  const mapDevice = ch.mapDevice ? item(ch.mapDevice) : null;
  const mapStash = ch.mapStash.map(item);
  return { ...ch, uidNamespace: prefix, nextUid, equipment, backpack, stash, mapDevice, mapStash };
}

export function mergeLegacyStorage(characters: readonly CharacterSave[]): AccountStorage {
  const seed = rules.createCharacter('Shared Stash', 1);
  const stash = (characters[0]?.stash ?? seed.stash).map((t) => ({ ...t }));
  const currencyStash: CharacterSave['currencyStash'] = {};
  const mapStash: CharacterSave['mapStash'] = [];
  const overflow: Item[] = [];
  for (let n = 0; n < characters.length; n++) {
    const ch = characters[n];
    if (n > 0) for (const tab of ch.stash) {
      if (tab.grid.entries.length) stash.push({ ...tab, name: `${ch.name}: ${tab.name}`.slice(0, 16) });
    }
    for (const map of ch.mapStash) {
      if (mapStash.length < MAP_STASH_CAPACITY) mapStash.push(map);
      else overflow.push(map);
    }
    for (const [id, count] of Object.entries(ch.currencyStash)) {
      const def = findCurrency(id);
      if (!def || !count) continue;
      const total = (currencyStash[def.id] ?? 0) + count;
      currencyStash[def.id] = Math.min(CURRENCY_STASH_MAX, total);
      for (let rest = total - CURRENCY_STASH_MAX; rest > 0;) {
        const amount = Math.min(def.maxStack, rest);
        overflow.push({ kind: 'currency', uid: `recovered:${randomUUID()}`, currencyId: def.id, count: amount });
        rest -= amount;
      }
    }
  }
  // Overflow goes into visible grid tabs, never into an inaccessible collection or a clamped counter.
  for (const item of overflow) {
    let placed = false;
    for (let n = 0; n < stash.length; n++) {
      const grid = autoPlace(stash[n].grid, item);
      if (grid) { stash[n] = { ...stash[n], grid }; placed = true; break; }
    }
    if (!placed) {
      const tab = createStashTab('Recovered');
      const grid = autoPlace(tab.grid, item);
      if (!grid) throw new Error(`Cannot recover item ${item.uid}`);
      stash.push({ ...tab, grid });
    }
  }
  const stashCapacity = Math.max(MAX_STASH_TABS, stash.length, ...characters.map((c) => c.stashCapacity ?? MAX_STASH_TABS));
  if (stashCapacity > MAX_PRESERVED_STASH_TABS) throw new Error('Legacy stash exceeds the supported recovery capacity');
  return { stash, stashCapacity, currencyStash, mapStash, atlas: newAtlas() };
}

/** Reuse item migrations and validation, but reject data loss rather than silently dropping overflow. */
export function parseAccountStorage(data: string): AccountStorage {
  const raw = JSON.parse(data) as Partial<AccountStorage>;
  if (!raw || !Array.isArray(raw.stash) || !Array.isArray(raw.mapStash) || !raw.currencyStash || typeof raw.currencyStash !== 'object') {
    throw new Error('Unreadable account storage');
  }
  const seed = rules.createCharacter('Shared Stash', 1);
  const result = normalizeCharacterReport({ ...seed, equipment: {}, backpack: createGrid(12, 5), mapDevice: null, ...raw, atlas: raw.atlas ?? newAtlas() });
  if (!result || result.lost.length || result.character.backpack.entries.length) throw new Error('Account storage needs recovery');
  const before = [...raw.stash.flatMap((t) => t.grid.entries.map((e) => e.item)), ...raw.mapStash];
  const after = [...result.character.stash.flatMap((t) => t.grid.entries.map((e) => e.item)), ...result.character.mapStash];
  const byId = new Map(after.map((i) => [i.uid, i]));
  if (raw.stash.length !== result.character.stash.length || before.length !== after.length || new Set(before.map((i) => i.uid)).size !== before.length || before.some((i) => {
    const kept = byId.get(i.uid);
    return !kept || kept.kind !== i.kind || ('count' in i && (!('count' in kept) || kept.count !== i.count));
  })) throw new Error('Account storage needs item recovery');
  const counts = (s: CharacterSave['currencyStash']) => JSON.stringify(Object.entries(s).filter(([, n]) => n !== 0).sort(([a], [b]) => a.localeCompare(b)));
  if (counts(raw.currencyStash) !== counts(result.character.currencyStash)) throw new Error('Account storage needs currency recovery');
  return storageOf(result.character);
}
