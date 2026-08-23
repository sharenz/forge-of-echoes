import assert from "node:assert/strict";
import test from "node:test";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import type { AuthoritativeProfile } from "../../server/persistence/PlayerRepository";
import { findFirstFit } from "../../app/game/item-container";
import { createGameServer } from "../../server/createGameServer";
import { InMemoryPlayerRepository } from "../../server/persistence/InMemoryPlayerRepository";
import { configureServerServices } from "../../server/services";
import { InMemoryCoordination } from "../../server/coordination/InMemoryCoordination";

const endpoint = "http://127.0.0.1:2568";

test("profile HTTP API authenticates and accepts commands without accepting state replacement", async () => {
  const repository = new InMemoryPlayerRepository();
  await repository.initialize();
  const coordination = new InMemoryCoordination(repository);
  const services = { authSecret: "profile-api-test-secret", players: repository, parties: coordination, expeditions: coordination };
  configureServerServices(services);
  let server: ColyseusTestServer | null = null;
  try {
    server = await boot(createGameServer(services));
    const accountResponse = await fetch(`${endpoint}/api/accounts/session`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3001" },
      body: JSON.stringify({ handle: "roster-player", password: "test-password-123", mode: "register" }),
    });
    assert.equal(accountResponse.status, 200);
    assert.equal(accountResponse.headers.get("access-control-allow-origin"), "http://localhost:3001");
    const account = await accountResponse.json() as { token: string; account: { accountId: string }; characters: unknown[] };
    assert.deepEqual(account.characters, []);
    const wrongPassword = await fetch(`${endpoint}/api/accounts/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle: "roster-player", password: "incorrect-password", mode: "login" }),
    });
    assert.equal(wrongPassword.status, 401);
    const duplicateRegistration = await fetch(`${endpoint}/api/accounts/session`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle: "roster-player", password: "another-password", mode: "register" }),
    });
    assert.equal(duplicateRegistration.status, 409);
    assert.equal((await fetch(`${endpoint}/api/profile`, { headers: { authorization: `Bearer ${account.token}` } })).status, 401, "account tokens cannot access character state");

    const createCharacter = (characterName: string, classId = "sorceress") => fetch(`${endpoint}/api/accounts/characters`, {
      method: "POST",
      headers: { authorization: `Bearer ${account.token}`, "content-type": "application/json" },
      body: JSON.stringify({ characterName, classId }),
    });
    const firstCharacterResponse = await createCharacter("RosterHero");
    assert.equal(firstCharacterResponse.status, 201);
    const firstCharacter = await firstCharacterResponse.json() as { session: { token: string; player: { characterId: string } }; characters: { level: number }[] };
    assert.equal(firstCharacter.characters.length, 1);
    assert.equal(firstCharacter.characters[0].level, 1, "the roster exposes the authoritative character level");
    const disabledClassResponse = await createCharacter("RosterAmazon", "amazon");
    assert.equal(disabledClassResponse.status, 400);
    const disabledAmazon = await repository.createCharacter(account.account.accountId, { characterName: "DisabledAmazon", classId: "amazon" });
    const disabledSelectionResponse = await fetch(`${endpoint}/api/accounts/select-character`, {
      method: "POST",
      headers: { authorization: `Bearer ${account.token}`, "content-type": "application/json" },
      body: JSON.stringify({ characterId: disabledAmazon.characterId }),
    });
    assert.equal(disabledSelectionResponse.status, 409);
    assert.equal((await disabledSelectionResponse.json() as { error: string }).error, "class_unavailable");
    const secondCharacterResponse = await createCharacter("RosterAlt", "sorceress");
    assert.equal(secondCharacterResponse.status, 201);
    const secondCharacter = await secondCharacterResponse.json() as { session: { player: { characterId: string } }; characters: unknown[] };
    assert.equal(secondCharacter.characters.length, 3);
    const duplicateResponse = await createCharacter("rosterhero", "sorceress");
    assert.equal(duplicateResponse.status, 409);
    assert.equal((await duplicateResponse.json() as { error: string }).error, "character_name_taken");

    const selectResponse = await fetch(`${endpoint}/api/accounts/select-character`, {
      method: "POST",
      headers: { authorization: `Bearer ${account.token}`, "content-type": "application/json" },
      body: JSON.stringify({ characterId: firstCharacter.session.player.characterId }),
    });
    assert.equal(selectResponse.status, 200);
    const selected = await selectResponse.json() as { token: string; player: { characterId: string } };
    assert.equal(selected.player.characterId, firstCharacter.session.player.characterId);
    assert.equal((await fetch(`${endpoint}/api/profile`, { headers: { authorization: `Bearer ${selected.token}` } })).status, 200);
    assert.notEqual(secondCharacter.session.player.characterId, selected.player.characterId);

    const session = firstCharacter.session;

    assert.equal((await fetch(`${endpoint}/api/profile`)).status, 401);
    const profileResponse = await fetch(`${endpoint}/api/profile`, { headers: { authorization: `Bearer ${session.token}` } });
    assert.equal(profileResponse.status, 200);
    const initial = await profileResponse.json() as AuthoritativeProfile;
    const weapon = initial.profile.equipped.mainHand!;
    const position = findFirstFit(initial.profile.inventory, weapon);
    assert.ok(position);

    const commandResponse = await fetch(`${endpoint}/api/profile/commands`, {
      method: "POST",
      headers: { authorization: `Bearer ${session.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        revision: initial.revision,
        command: { type: "move_item", itemId: weapon.id, destination: "backpack", ...position },
      }),
    });
    assert.equal(commandResponse.status, 200);
    const moved = await commandResponse.json() as AuthoritativeProfile;
    assert.equal(moved.profile.equipped.mainHand, undefined);
    assert.ok(moved.profile.inventory.entries.some((entry) => entry.item.id === weapon.id));

    const forgedResponse = await fetch(`${endpoint}/api/profile/commands`, {
      method: "POST",
      headers: { authorization: `Bearer ${session.token}`, "content-type": "application/json" },
      body: JSON.stringify({
        revision: moved.revision,
        command: { type: "grant_item", item: { id: "god-item", attackDamage: 999_999 } },
      }),
    });
    assert.equal(forgedResponse.status, 400);
    const unchanged = await (await fetch(`${endpoint}/api/profile`, { headers: { authorization: `Bearer ${session.token}` } })).json() as AuthoritativeProfile;
    assert.equal(unchanged.revision, moved.revision);

    const originalLoadProfile = repository.loadProfile.bind(repository);
    repository.loadProfile = async () => {
      throw new Error("synthetic repository outage");
    };
    const originalConsoleError = console.error;
    console.error = () => undefined;
    try {
      const failed = await fetch(`${endpoint}/api/profile`, { headers: { authorization: `Bearer ${session.token}` } });
      assert.equal(failed.status, 500);
      assert.deepEqual(await failed.json(), { error: "internal_server_error" });
    } finally {
      console.error = originalConsoleError;
      repository.loadProfile = originalLoadProfile;
    }

    const logout = await fetch(`${endpoint}/api/accounts/logout`, {
      method: "POST",
      headers: { authorization: `Bearer ${account.token}` },
    });
    assert.equal(logout.status, 204);
    assert.equal(
      (await fetch(`${endpoint}/api/profile`, { headers: { authorization: `Bearer ${session.token}` } })).status,
      401,
      "revoking the account login invalidates every derived character token",
    );
  } finally {
    await server?.cleanup();
    await server?.shutdown();
    await repository.close();
  }
});
