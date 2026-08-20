import assert from "node:assert/strict";
import test from "node:test";
import { boot, type ColyseusTestServer } from "@colyseus/testing";
import { createGameServer } from "../../server/createGameServer";
import { InMemoryPlayerRepository } from "../../server/persistence/InMemoryPlayerRepository";
import { configureServerServices } from "../../server/services";
import { PartyService, type PartySnapshot, type PublicPartyListing } from "../../server/services/PartyService";
import { MapAdmissionService } from "../../server/services/MapAdmissionService";

const endpoint = "http://127.0.0.1:2568";

async function session(index: number): Promise<string> {
  const accountResponse = await fetch(`${endpoint}/api/accounts/session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ handle: `party-api-${index}` }),
  });
  assert.equal(accountResponse.status, 200);
  const account = await accountResponse.json() as { token: string };
  const characterResponse = await fetch(`${endpoint}/api/accounts/characters`, authenticated(account.token, "POST", {
    characterName: `PartyHero${index}`,
    classId: "sorceress",
  }));
  assert.equal(characterResponse.status, 201);
  return ((await characterResponse.json()) as { session: { token: string } }).session.token;
}

function authenticated(token: string, method = "GET", body?: unknown): RequestInit {
  return {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  };
}

test("four clients form a party through HTTP while the fifth is rejected", async () => {
  const repository = new InMemoryPlayerRepository();
  await repository.initialize();
  configureServerServices({ authSecret: "party-api-test-secret", players: repository, parties: new PartyService(), mapAdmissions: new MapAdmissionService() });
  let server: ColyseusTestServer | null = null;
  try {
    server = await boot(createGameServer());
    const tokens = await Promise.all(Array.from({ length: 5 }, (_, index) => session(index)));
    const soloResponse = await fetch(`${endpoint}/api/parties/solo`, authenticated(tokens[4], "POST", {}));
    assert.equal(soloResponse.status, 201);
    const solo = await soloResponse.json() as PartySnapshot;
    assert.equal(solo.visibility, "solo");
    assert.deepEqual(await (await fetch(`${endpoint}/api/parties`, authenticated(tokens[4]))).json(), [], "private hideouts are never discoverable");
    const createResponse = await fetch(`${endpoint}/api/parties`, authenticated(tokens[0], "POST", {}));
    assert.equal(createResponse.status, 201);
    const party = await createResponse.json() as PartySnapshot;
    const discoveryResponse = await fetch(`${endpoint}/api/parties`, authenticated(tokens[4]));
    assert.equal(discoveryResponse.status, 200);
    const discovery = await discoveryResponse.json() as PublicPartyListing[];
    assert.deepEqual(discovery, [{
      id: party.id,
      name: "PartyHero0's Party",
      leader: {
        characterId: party.leaderCharacterId,
        characterName: "PartyHero0",
        classId: "sorceress",
        level: 1,
      },
      memberCount: 1,
      maximumMembers: 4,
      activity: "hideout",
      activeMap: null,
    }]);
    assert.equal(JSON.stringify(discovery).includes("mapTicket"), false, "public discovery must not expose admission credentials");
    const leaderDiscovery = await (await fetch(`${endpoint}/api/parties`, authenticated(tokens[0]))).json() as PublicPartyListing[];
    assert.deepEqual(leaderDiscovery, [], "a member never sees their own party as a joinable listing");
    for (const token of tokens.slice(1, 4)) {
      const joinResponse = await fetch(`${endpoint}/api/parties/join`, authenticated(token, "POST", { partyId: party.id }));
      assert.equal(joinResponse.status, 200);
    }
    const full = await (await fetch(`${endpoint}/api/parties/current`, authenticated(tokens[0]))).json() as PartySnapshot;
    assert.equal(full.memberCharacterIds.length, 4);
    const fullDiscovery = await (await fetch(`${endpoint}/api/parties`, authenticated(tokens[4]))).json() as PublicPartyListing[];
    assert.equal(fullDiscovery[0].memberCount, 4);
    const fifthResponse = await fetch(`${endpoint}/api/parties/join`, authenticated(tokens[4], "POST", { partyId: party.id }));
    assert.equal(fifthResponse.status, 409);
    assert.deepEqual(await fifthResponse.json(), { error: "party_full" });
  } finally {
    await server?.cleanup();
    await server?.shutdown();
    await repository.close();
  }
});
