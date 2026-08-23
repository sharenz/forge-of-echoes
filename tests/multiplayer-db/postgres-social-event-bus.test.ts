import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PostgresSocialEventBus, type SocialInvalidation } from "../../server/social/SocialEventBus";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://crafty:crafty@127.0.0.1:5434/crafty";

test("PostgreSQL social invalidations cross process-adapter boundaries", async () => {
  const publisher = new PostgresSocialEventBus(databaseUrl);
  const subscriber = new PostgresSocialEventBus(databaseUrl);
  await Promise.all([publisher.initialize(), subscriber.initialize()]);
  try {
    const expected: SocialInvalidation = {
      scope: "party",
      partyIds: [randomUUID()],
      publicPartiesChanged: true,
    };
    const received = new Promise<SocialInvalidation>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Timed out waiting for PostgreSQL NOTIFY")), 2_000);
      subscriber.subscribe((event) => {
        clearTimeout(timeout);
        resolve(event);
      });
    });
    await publisher.publish(expected);
    assert.deepEqual(await received, expected);
  } finally {
    await Promise.all([publisher.close(), subscriber.close()]);
  }
});
