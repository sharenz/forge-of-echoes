import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createTestPlayer } from "../createTestPlayer";
import { Pool } from "pg";
import { PostgresPlayerRepository } from "../../server/persistence/PostgresPlayerRepository";
import { findFirstFit } from "../../app/game/item-container";
import { ProfileCommandService } from "../../server/services/ProfileCommandService";
import { AccountAuthService } from "../../server/services/AccountAuthService";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://crafty:crafty@127.0.0.1:5434/crafty";

test("PostgreSQL persists account identity and enforces item owner/location consistency", async () => {
  const repository = new PostgresPlayerRepository(databaseUrl);
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const suffix = randomUUID().slice(0, 8);
  const handle = `db_test_${suffix}`;
  const sameNameHandle = `${handle}_same_name`;
  const authenticatedHandle = `${handle}_auth`;
  try {
    await repository.initialize();
    const authenticated = await new AccountAuthService(repository).authenticate(authenticatedHandle, "database-test-password", "register");
    assert.equal(await repository.isAuthSessionActive(authenticated.sessionId, authenticated.account.accountId), true);
    await repository.revokeAuthSession(authenticated.sessionId, authenticated.account.accountId);
    assert.equal(await repository.isAuthSessionActive(authenticated.sessionId, authenticated.account.accountId), false);
    const first = await createTestPlayer(repository, { handle, characterName: `Hero-${suffix}`, classId: "sorceress" });
    const reloaded = await createTestPlayer(repository, { handle, characterName: "Forged replacement", classId: "barbarian" });
    assert.deepEqual(reloaded, first, "an existing account handle must resolve to the persisted character, not overwrite it");
    const account = await repository.createOrLoadAccount(handle);
    const rosterAlt = await repository.createCharacter(account.accountId, { characterName: `Alt-${suffix}`, classId: "amazon" });
    const incomplete = await pool.query<{ id: string }>(
      "INSERT INTO characters (account_id, name, class_id) VALUES ($1, $2, 'sorceress') RETURNING id",
      [account.accountId, `Incomplete-${suffix}`],
    );
    const roster = await repository.listCharacters(account.accountId);
    assert.deepEqual(roster.map((character) => character.characterId), [first.characterId, rosterAlt.characterId]);
    assert.deepEqual(roster.map((character) => character.level), [1, 1]);
    assert.equal(await repository.findAccountCharacter(account.accountId, incomplete.rows[0].id), null, "incomplete profiles are never exposed as playable characters");
    assert.equal(await repository.findCharacter(incomplete.rows[0].id), null);
    assert.deepEqual(await repository.findAccountCharacter(account.accountId, rosterAlt.characterId), rosterAlt);
    assert.deepEqual(account.merchantEntitlements, []);
    await pool.query(
      "INSERT INTO account_merchant_entitlements (account_id, merchant_id) VALUES ($1, 'debug-artificer')",
      [account.accountId],
    );
    assert.deepEqual((await repository.createOrLoadAccount(handle)).merchantEntitlements, ["debug-artificer"]);
    assert.deepEqual(await repository.listMerchantEntitlementsForCharacter(first.characterId), ["debug-artificer"]);
    assert.deepEqual(await repository.listMerchantEntitlementsForCharacter(rosterAlt.characterId), ["debug-artificer"]);
    const otherAccount = await repository.createOrLoadAccount(sameNameHandle);
    await assert.rejects(
      () => repository.createCharacter(otherAccount.accountId, { characterName: first.characterName.toLowerCase(), classId: "amazon" }),
      /character_name_taken/,
      "character names must be globally unique and case-insensitive",
    );
    assert.deepEqual(await repository.findCharacter(first.characterId), { ...first, level: 1 });
    const initialProfile = await repository.loadProfile(first.characterId);
    assert.ok(initialProfile);
    const weapon = initialProfile.profile.equipped.mainHand!;
    const backpackPosition = findFirstFit(initialProfile.profile.inventory, weapon);
    assert.ok(backpackPosition);
    const commands = new ProfileCommandService(repository);
    const moved = await commands.execute(first.characterId, initialProfile.revision, {
      type: "move_item", itemId: weapon.id, destination: "backpack", ...backpackPosition,
    });
    assert.equal(moved.profile.equipped.mainHand, undefined);
    assert.equal(moved.revision, initialProfile.revision + 1);
    const persistedMove = await repository.loadProfile(first.characterId);
    assert.ok(persistedMove?.profile.inventory.entries.some((entry) => entry.item.id === weapon.id));
    const bought = await commands.execute(first.characterId, moved.revision, { type: "buy_merchant_offer", merchantId: "cartographer-rook", offerId: "free-ashen-t1" });
    const purchasedMap = bought.profile.inventory.entries.at(-1)?.item;
    assert.equal(purchasedMap?.kind, "map");
    assert.match(purchasedMap!.id, /^[0-9a-f-]{36}$/i);
    const persistedPurchase = await repository.loadProfile(first.characterId);
    assert.ok(persistedPurchase?.profile.inventory.entries.some((entry) => entry.item.id === purchasedMap!.id));
    const debugPurchase = await commands.execute(first.characterId, bought.revision, {
      type: "buy_merchant_offer", merchantId: "debug-artificer", offerId: "impossible-velocity-boots",
    });
    const debugBoots = debugPurchase.profile.inventory.entries.find((entry) => entry.item.kind === "equipment" && entry.item.displayName === "Impossible Velocity Boots")?.item;
    assert.ok(debugBoots?.kind === "equipment");
    assert.equal(debugBoots.affixes[0].rolls[0].value, 1_000);

    const second = await createTestPlayer(repository, { handle: `${handle}_2`, characterName: `Ally-${suffix}`, classId: "amazon" });
    const itemId = randomUUID();
    await pool.query(
      "INSERT INTO item_instances (id, owner_character_id, kind, item_data) VALUES ($1, $2, 'currency', $3)",
      [itemId, first.characterId, { kind: "currency", id: itemId, baseId: "scrap", stackSize: 1 }],
    );
    await assert.rejects(
      () => pool.query(
        "INSERT INTO item_locations (item_id, character_id, location) VALUES ($1, $2, 'ground')",
        [itemId, second.characterId],
      ),
      /item_locations_owner_fkey/,
    );
    await pool.query(
      "INSERT INTO item_locations (item_id, character_id, location) VALUES ($1, $2, 'ground')",
      [itemId, first.characterId],
    );
  } finally {
    await pool.query("DELETE FROM accounts WHERE handle IN ($1, $2, $3, $4)", [handle, `${handle}_2`, sameNameHandle, authenticatedHandle]);
    await pool.end();
    await repository.close();
  }
});
