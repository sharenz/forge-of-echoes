import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "../../server/auth/password";
import { InMemoryPlayerRepository } from "../../server/persistence/InMemoryPlayerRepository";
import { AccountAuthError, AccountAuthService } from "../../server/services/AccountAuthService";

test("password hashes are salted, verifiable, and reject malformed input", async () => {
  const first = await hashPassword("correct horse battery staple");
  const second = await hashPassword("correct horse battery staple");
  assert.notEqual(first, second);
  assert.equal(await verifyPassword("correct horse battery staple", first), true);
  assert.equal(await verifyPassword("wrong password", first), false);
  assert.equal(await verifyPassword("correct horse battery staple", "garbage"), false);
});

test("account authentication issues durable sessions that can be revoked", async () => {
  const players = new InMemoryPlayerRepository();
  const auth = new AccountAuthService(players);
  await players.initialize();
  try {
    const registered = await auth.authenticate("Aster", "long-enough-password", "register");
    assert.equal(registered.account.handle, "aster");
    assert.equal(await players.isAuthSessionActive(registered.sessionId, registered.account.accountId), true);
    await assert.rejects(
      () => auth.authenticate("Aster", "wrong-password-value", "login"),
      (error: unknown) => error instanceof AccountAuthError && error.code === "invalid_credentials",
    );
    const loggedIn = await auth.authenticate("Aster", "long-enough-password", "login");
    await players.revokeAuthSession(loggedIn.sessionId, loggedIn.account.accountId);
    assert.equal(await players.isAuthSessionActive(loggedIn.sessionId, loggedIn.account.accountId), false);
  } finally {
    await players.close();
  }
});
