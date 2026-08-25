import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import { createRateLimiter, FixedWindowRateLimiter, clientKey } from "../../server/http/rateLimit";
import { AccountAuthService, AccountAuthError } from "../../server/services/AccountAuthService";
import { InMemoryPlayerRepository } from "../../server/persistence/InMemoryPlayerRepository";

test("fixed window limiter admits the configured budget then recovers after the window", () => {
  let nowMilliseconds = 1_000_000;
  const limiter = new FixedWindowRateLimiter({
    windowMilliseconds: 10_000,
    maximumRequests: 3,
    now: () => nowMilliseconds,
  });
  for (let request = 0; request < 3; request += 1) {
    assert.equal(limiter.attempt("client-a", nowMilliseconds).allowed, true);
  }
  const blocked = limiter.attempt("client-a", nowMilliseconds);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1 && blocked.retryAfterSeconds <= 10);
  assert.equal(limiter.attempt("client-b", nowMilliseconds).allowed, true, "buckets are independent");
  nowMilliseconds += 10_001;
  assert.equal(limiter.attempt("client-a", nowMilliseconds).allowed, true, "a fresh window restores budget");
});

test("clientKey trusts forwarded chains only at the configured proxy depth", () => {
  const trustedLoopback = { socket: { remoteAddress: "127.0.0.1" }, headers: { "x-forwarded-for": "203.0.113.7 , 198.51.100.9" } };
  assert.equal(clientKey(trustedLoopback as never, 1), "198.51.100.9", "one hop reads the nearest entry");
  assert.equal(clientKey(trustedLoopback as never, 2), "203.0.113.7");
  const directAttacker = { socket: { remoteAddress: "203.0.113.50" }, headers: { "x-forwarded-for": "9.9.9.9" } };
  assert.equal(clientKey(directAttacker as never, 1), "203.0.113.50", "public peers cannot forge their key");
  const proxyWithoutHeader = { socket: { remoteAddress: "10.1.2.3" }, headers: {} };
  assert.equal(clientKey(proxyWithoutHeader as never, 1), "10.1.2.3");
});

test("express middleware answers 429 with Retry-After and isolates forwarded clients", async () => {
  let nowMilliseconds = 5_000_000;
  const app = express();
  app.use(createRateLimiter({ windowMilliseconds: 60_000, maximumRequests: 2, trustedProxyHops: 1, now: () => nowMilliseconds }));
  app.get("/probe", (_request, response) => response.json({ ok: true }));
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const probe = (forwardedFor?: string) => fetch(`http://127.0.0.1:${port}/probe`, {
      headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {},
    });
    assert.equal((await probe()).status, 200);
    assert.equal((await probe()).status, 200);
    const limited = await probe();
    assert.equal(limited.status, 429);
    assert.equal(await limited.json().then((body) => (body as { error: string }).error), "rate_limited");
    assert.ok(Number(limited.headers.get("retry-after")) >= 1);
    assert.equal((await probe("198.51.100.7")).status, 200, "forwarded clients receive their own budget");
    nowMilliseconds += 60_001;
    assert.equal((await probe()).status, 200, "the window reset restores the socket budget");
  } finally {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }
});

test("repeated login failures lock the handle even for the correct password, then recover", async () => {
  const repository = new InMemoryPlayerRepository();
  await repository.initialize();
  let nowMilliseconds = 2_000_000;
  const auth = new AccountAuthService(repository, { now: () => nowMilliseconds });
  await auth.authenticate("lockout-player", "correct-horse-password", "register");
  const expectFailure = async (handle: string, password: string, code: string) => {
    await assert.rejects(auth.authenticate(handle, password, "login"), (error: unknown) => (
      error instanceof AccountAuthError && error.code === code
    ));
  };
  for (let attempt = 0; attempt < 5; attempt += 1) await expectFailure("lockout-player", "wrong-password", "invalid_credentials");
  await expectFailure("lockout-player", "correct-horse-password", "account_locked");
  await expectFailure("unknown-handle", "whatever-password", "invalid_credentials");
  nowMilliseconds += 60_001;
  const authenticated = await auth.authenticate("lockout-player", "correct-horse-password", "login");
  assert.equal(authenticated.account.accountId.length > 0, true);
  await expectFailure("lockout-player", "wrong-password", "invalid_credentials");
  const stillOpen = await auth.authenticate("lockout-player", "correct-horse-password", "login");
  assert.equal(stillOpen.account.accountId, authenticated.account.accountId, "success resets the failure counter");
});
