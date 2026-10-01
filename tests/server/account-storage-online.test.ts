import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { api, newPlayer, startTestServer } from './helpers';
import { TestClient } from './ws-client';

it('shares one stash over real sockets, serializes racing withdrawals, and survives restart and alt deletion', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'forge-account-stash-'));
  const options = { dbPath: join(dir, 'game.db'), saveDebounceMs: 60_000 };
  let server = await startTestServer(options);
  const clients: TestClient[] = [];
  try {
    const owner = await newPlayer(server.base, 'Shared Alpha');
    const made = await api<{ character: { id: string } }>(server.base, 'POST', '/api/characters', { name: 'Shared Beta' }, owner.token);
    expect(made.status).toBe(201);
    const a = await TestClient.connect(server.base, { token: owner.token, character: owner.characterId });
    const b = await TestClient.connect(server.base, { token: owner.token, character: made.body.character.id });
    clients.push(a, b);
    await a.waitFor('zone'); await b.waitFor('zone');
    const map = a.last('character')!.character.backpack.entries.find((e) => e.item.kind === 'map')!.item;
    expect((await a.command({ c: 'quickMove', uid: map.uid, stashTab: 0 })).ok).toBe(true);
    await b.waitFor('character', (m) => m.character.mapStash.some((i) => i.uid === map.uid));
    const results = await Promise.all([
      a.command({ c: 'quickMove', uid: map.uid, stashTab: 'maps' }),
      b.command({ c: 'quickMove', uid: map.uid, stashTab: 'maps' }),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const winner = results[0].ok ? a : b;
    const loser = winner === a ? b : a;
    await loser.waitFor('character', (m) => !m.character.mapStash.length, loser.mark() - 2);
    expect(winner.last('character')!.character.backpack.entries.filter((e) => e.item.uid === map.uid)).toHaveLength(1);
    expect((await winner.command({ c: 'quickMove', uid: map.uid, stashTab: 0 })).ok).toBe(true);
    expect((await a.command({ c: 'renameStashTab', tab: 0, name: 'Account Gear' })).ok).toBe(true);
    await b.waitFor('character', (m) => m.character.stash[0].name === 'Account Gear');
    await server.close(); // flush both halves, despite the deliberately long debounce
    server = await startTestServer(options);
    const deleted = await api(server.base, 'DELETE', `/api/characters/${owner.characterId}`, undefined, owner.token);
    expect(deleted.status).toBe(200);
    const again = await TestClient.connect(server.base, { token: owner.token, character: made.body.character.id });
    clients.push(again);
    await again.waitFor('zone');
    expect(again.last('character')!.character.stash[0].name).toBe('Account Gear');
    expect(again.last('character')!.character.mapStash.map((m) => m.uid)).toEqual([map.uid]);
    expect((await again.command({ c: 'quickMove', uid: map.uid, stashTab: 'maps' })).ok).toBe(true);
  } finally {
    for (const client of clients) client.close();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
