import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createTestPlayer } from "../createTestPlayer";
import { Pool } from "pg";
import { ItemLockedError } from "../../server/persistence/errors";
import { PostgresPlayerRepository } from "../../server/persistence/PostgresPlayerRepository";
import { PostgresTradeRepository } from "../../server/persistence/PostgresTradeRepository";
import { TradeError } from "../../server/persistence/TradeRepository";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://crafty:crafty@127.0.0.1:5434/crafty";

test("PostgreSQL trade swaps item ownership atomically after matching revision acceptance", async () => {
  const players = new PostgresPlayerRepository(databaseUrl);
  const trades = new PostgresTradeRepository(databaseUrl);
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const suffix = randomUUID().slice(0, 8);
  const handles = [`trade_a_${suffix}`, `trade_b_${suffix}`, `trade_c_${suffix}`];
  const tradeIds: string[] = [];
  try {
    await players.initialize();
    const [alice, bob, charlie] = await Promise.all([
      createTestPlayer(players, { handle: handles[0], characterName: `Alice-${suffix}`, classId: "amazon" }),
      createTestPlayer(players, { handle: handles[1], characterName: `Bob-${suffix}`, classId: "barbarian" }),
      createTestPlayer(players, { handle: handles[2], characterName: `Charlie-${suffix}`, classId: "sorceress" }),
    ]);
    const aliceBefore = await players.loadProfile(alice.characterId);
    const bobBefore = await players.loadProfile(bob.characterId);
    assert.ok(aliceBefore && bobBefore);
    const aliceItem = aliceBefore.profile.inventory.entries.find((entry) => entry.item.kind === "map")!.item;
    const bobItem = bobBefore.profile.inventory.entries.find((entry) => entry.item.kind === "map")!.item;

    let trade = await trades.createTrade(alice.characterId, bob.characterId);
    tradeIds.push(trade.id);
    const discovered = await trades.listOpenTrades(bob.characterId);
    assert.deepEqual(discovered.map((candidate) => candidate.id), [trade.id], "incoming trades are discoverable by the target");
    assert.equal(discovered[0].participantDetails.find((participant) => participant.characterId === alice.characterId)?.characterName, alice.characterName);
    trade = await trades.setOffer(trade.id, alice.characterId, trade.revision, [aliceItem.id]);
    assert.equal(trade.offers.find((offer) => offer.characterId === alice.characterId)?.items[0].id, aliceItem.id, "both players inspect exact authoritative item data");
    await assert.rejects(
      () => trades.setOffer(trade.id, bob.characterId, trade.revision - 1, [bobItem.id]),
      (error) => error instanceof TradeError && error.code === "revision_conflict",
    );
    trade = await trades.setOffer(trade.id, bob.characterId, trade.revision, [bobItem.id]);
    const acceptanceResults = await Promise.all([
      trades.acceptTrade(trade.id, alice.characterId, trade.revision),
      trades.acceptTrade(trade.id, bob.characterId, trade.revision),
    ]);
    assert.ok(acceptanceResults.some((result) => result.state === "completed"));
    assert.equal((await trades.getTrade(trade.id, alice.characterId)).state, "completed");
    assert.equal((await trades.listOpenTrades(alice.characterId)).some((candidate) => candidate.id === trade.id), false);

    const aliceAfter = await players.loadProfile(alice.characterId);
    const bobAfter = await players.loadProfile(bob.characterId);
    assert.ok(aliceAfter && bobAfter);
    assert.ok(aliceAfter.profile.inventory.entries.some((entry) => entry.item.id === bobItem.id));
    assert.ok(!aliceAfter.profile.inventory.entries.some((entry) => entry.item.id === aliceItem.id));
    assert.ok(bobAfter.profile.inventory.entries.some((entry) => entry.item.id === aliceItem.id));
    assert.ok(!bobAfter.profile.inventory.entries.some((entry) => entry.item.id === bobItem.id));
    assert.equal(aliceAfter.revision, aliceBefore.revision + 1);
    assert.equal(bobAfter.revision, bobBefore.revision + 1);

    const lockTrade = await trades.createTrade(alice.characterId, bob.characterId);
    tradeIds.push(lockTrade.id);
    const lockItem = aliceAfter.profile.inventory.entries.find((entry) => entry.item.kind === "map")!.item;
    await trades.setOffer(lockTrade.id, alice.characterId, lockTrade.revision, [lockItem.id]);
    const unrelatedSave = await players.saveProfile(alice.characterId, aliceAfter.revision, {
      ...aliceAfter.profile,
      character: { ...aliceAfter.profile.character, xp: aliceAfter.profile.character.xp + 1 },
    });
    assert.equal(unrelatedSave.revision, aliceAfter.revision + 1, "an unchanged offered item does not freeze unrelated profile writes");
    const profileWithoutLockedItem = {
      ...unrelatedSave.profile,
      inventory: {
        ...unrelatedSave.profile.inventory,
        entries: unrelatedSave.profile.inventory.entries.filter((entry) => entry.item.id !== lockItem.id),
      },
    };
    await assert.rejects(
      () => players.saveProfile(alice.characterId, unrelatedSave.revision, profileWithoutLockedItem),
      (error) => error instanceof ItemLockedError && error.itemId === lockItem.id,
      "moving or deleting the offered item still exposes a typed lock conflict",
    );
    const competingTrade = await trades.createTrade(alice.characterId, charlie.characterId);
    tradeIds.push(competingTrade.id);
    await assert.rejects(
      () => trades.setOffer(competingTrade.id, alice.characterId, competingTrade.revision, [lockItem.id]),
      (error) => error instanceof TradeError && error.code === "item_locked",
    );
    await trades.cancelTrade(lockTrade.id, bob.characterId);
    const afterRelease = await trades.setOffer(competingTrade.id, alice.characterId, competingTrade.revision, [lockItem.id]);
    assert.deepEqual(afterRelease.offers.find((offer) => offer.characterId === alice.characterId)?.itemIds, [lockItem.id]);
    await trades.cancelTrade(competingTrade.id, charlie.characterId);
  } finally {
    if (tradeIds.length) await pool.query("DELETE FROM trades WHERE id = ANY($1::uuid[])", [tradeIds]);
    await pool.query("DELETE FROM accounts WHERE handle = ANY($1::text[])", [handles]);
    await pool.end();
    await trades.close();
    await players.close();
  }
});
