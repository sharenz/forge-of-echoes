import assert from "node:assert/strict";
import test from "node:test";
import { loadServerConfig } from "../../server/config";

test("development config is fully local by default", () => {
  const config = loadServerConfig({});

  assert.equal(config.environment, "development");
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 2567);
  assert.match(config.databaseUrl, /127\.0\.0\.1:5434/);
  assert.deepEqual(config.allowedOrigins, ["http://localhost:3001", "http://127.0.0.1:3001"]);
});

test("production config has no local database or secret fallback", () => {
  assert.throws(
    () => loadServerConfig({ NODE_ENV: "production" }),
    /DATABASE_URL is required in production/,
  );
});

test("production config supports container PORT and explicit public origins", () => {
  const config = loadServerConfig({
    NODE_ENV: "production",
    PORT: "8080",
    DATABASE_URL: "postgresql://postgres:secret@example.supabase.co:5432/postgres?sslmode=require",
    CRAFTY_AUTH_SECRET: "a-secure-production-secret-with-32-characters",
    ALLOWED_ORIGINS: "https://crafty.example, https://preview.crafty.example/",
  });

  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 8080);
  assert.deepEqual(config.allowedOrigins, ["https://crafty.example", "https://preview.crafty.example"]);
});
