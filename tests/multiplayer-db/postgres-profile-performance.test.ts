import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { createTestPlayer } from "../createTestPlayer";
import { Client, Pool } from "pg";
import type { CurrencyItem, PlayerProfile, StashTab } from "../../app/game/domain";
import { PostgresPlayerRepository } from "../../server/persistence/PostgresPlayerRepository";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://crafty:crafty@127.0.0.1:5434/crafty";

function currency(): CurrencyItem {
  return { kind: "currency", id: randomUUID(), baseId: "scrap", stackSize: 1 };
}

function midGameProfile(profile: PlayerProfile): PlayerProfile {
  const tabs: StashTab[] = Array.from({ length: 7 }, (_, tabIndex) => ({
    id: `benchmark-tab-${tabIndex + 1}`,
    name: `Benchmark ${tabIndex + 1}`,
    container: {
      id: "stash",
      entries: Array.from({ length: 19 }, (_, itemIndex) => ({
        item: currency(),
        x: itemIndex % 12,
        y: Math.floor(itemIndex / 12),
      })),
    },
  }));
  return {
    ...profile,
    inventory: {
      id: "backpack",
      entries: Array.from({ length: 6 }, (_, index) => ({ item: currency(), x: index, y: 0 })),
    },
    stash: { activeTabId: tabs[0].id, tabs },
    equipped: {},
    flaskBelt: [null, null, null, null, null],
    mapDevice: null,
  };
}

test("mid-game profile persistence stays set-based and below the local latency budget", async (context) => {
  const repository = new PostgresPlayerRepository(databaseUrl);
  const cleanup = new Pool({ connectionString: databaseUrl, max: 1 });
  const suffix = randomUUID().slice(0, 8);
  const handle = `profile_bench_${suffix}`;
  const originalQuery = Client.prototype.query;
  let queryCount = 0;
  try {
    await repository.initialize();
    const player = await createTestPlayer(repository, {
      handle,
      characterName: `Bench-${suffix}`,
      classId: "sorceress",
    });
    const current = await repository.loadProfile(player.characterId);
    assert.ok(current);
    const profile = midGameProfile(current.profile);

    Client.prototype.query = function (this: Client, ...args: Parameters<typeof originalQuery>) {
      queryCount += 1;
      return originalQuery.apply(this, args);
    } as typeof originalQuery;
    const startedAt = performance.now();
    const saved = await repository.saveProfile(player.characterId, current.revision, profile);
    const duration = performance.now() - startedAt;
    Client.prototype.query = originalQuery;

    context.diagnostic(`${queryCount} queries, ${duration.toFixed(2)}ms for 139 items / 7 tabs`);
    assert.equal(saved.profile.stash.tabs.length, 7);
    assert.ok(queryCount <= 10, `expected at most 10 queries, received ${queryCount}`);
    assert.ok(duration <= 20, `expected at most 20ms locally, received ${duration.toFixed(2)}ms`);

    queryCount = 0;
    Client.prototype.query = function (this: Client, ...args: Parameters<typeof originalQuery>) {
      queryCount += 1;
      return originalQuery.apply(this, args);
    } as typeof originalQuery;
    const diffStartedAt = performance.now();
    await repository.mutateProfile(player.characterId, saved.revision, (currentProfile) => ({
      ...currentProfile,
      character: { ...currentProfile.character, xp: currentProfile.character.xp + 1 },
    }));
    const diffDuration = performance.now() - diffStartedAt;
    Client.prototype.query = originalQuery;
    context.diagnostic(`diff save: ${queryCount} queries, ${diffDuration.toFixed(2)}ms with no item/location changes`);
    assert.ok(queryCount <= 6, `expected at most 6 diff-save queries, received ${queryCount}`);
    assert.ok(diffDuration <= 10, `expected diff save at most 10ms locally, received ${diffDuration.toFixed(2)}ms`);
  } finally {
    Client.prototype.query = originalQuery;
    await cleanup.query("DELETE FROM accounts WHERE handle = $1", [handle]);
    await cleanup.end();
    await repository.close();
  }
});

test("a burst of 20 atomic character mutations serialises without revision conflicts or pool exhaustion", async () => {
  const repository = new PostgresPlayerRepository(databaseUrl);
  const cleanup = new Pool({ connectionString: databaseUrl, max: 1 });
  const suffix = randomUUID().slice(0, 8);
  const handle = `profile_burst_${suffix}`;
  try {
    await repository.initialize();
    const player = await createTestPlayer(repository, { handle, characterName: `Burst-${suffix}`, classId: "sorceress" });
    const before = await repository.loadProfile(player.characterId);
    assert.ok(before);
    const results = await Promise.all(Array.from({ length: 20 }, () => repository.mutateProfile(
      player.characterId,
      null,
      (current) => ({
        ...current,
        character: { ...current.character, xp: current.character.xp + 1 },
      }),
    )));
    const after = await repository.loadProfile(player.characterId);
    assert.equal(results.length, 20);
    assert.equal(after?.revision, before.revision + 20);
    assert.equal(after?.profile.character.xp, before.profile.character.xp + 20);
  } finally {
    await cleanup.query("DELETE FROM accounts WHERE handle = $1", [handle]);
    await cleanup.end();
    await repository.close();
  }
});
