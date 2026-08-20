import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { signMapTicket, verifyMapTicket } from "../../server/auth/map-ticket";
import { signSessionToken, verifySessionToken } from "../../server/auth/session-token";

const secret = "test-secret-with-sufficient-length";
const claims = () => ({
  sessionId: randomUUID(),
  accountId: randomUUID(),
  characterId: randomUUID(),
  characterName: "Aster",
  classId: "sorceress" as const,
  expiresAt: Date.now() + 60_000,
});

test("signed multiplayer sessions reject tampering and expiration", () => {
  const validClaims = claims();
  const token = signSessionToken(validClaims, secret);
  assert.deepEqual(verifySessionToken(token, secret), validClaims);
  assert.equal(verifySessionToken(`${token.slice(0, -1)}x`, secret), null);
  assert.equal(verifySessionToken(token, "another-secret-that-is-long-enough"), null);
  assert.equal(verifySessionToken(token, secret, validClaims.expiresAt + 1), null);
});

test("map tickets bind one map item to an explicit party of at most four", () => {
  const memberIds = Array.from({ length: 4 }, () => randomUUID());
  const validClaims = {
    ticketId: randomUUID(),
    mapItemId: randomUUID(),
    ownerCharacterId: memberIds[0],
    allowedCharacterIds: memberIds,
    tier: 7,
    seed: 42,
    expiresAt: Date.now() + 60_000,
  };
  const ticket = signMapTicket(validClaims, secret);
  assert.deepEqual(verifyMapTicket(ticket, secret), validClaims);
  assert.equal(verifyMapTicket(`${ticket.slice(0, -1)}x`, secret), null);
  assert.equal(verifyMapTicket(ticket, secret, validClaims.expiresAt + 1), null);
  assert.throws(() => signMapTicket({ ...validClaims, allowedCharacterIds: [...memberIds, randomUUID()] }, secret));
});
