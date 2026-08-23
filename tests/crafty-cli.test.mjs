import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { AdminDatabase, DEBUG_MERCHANT_ID } from "../scripts/crafty-cli/database.mjs";
import { select } from "../scripts/crafty-cli/prompt.mjs";

test("the CLI starts when invoked through an npm-style executable symlink", () => {
  const directory = mkdtempSync(join(tmpdir(), "crafty-cli-"));
  const executable = join(directory, "crafty-cli");
  try {
    symlinkSync(resolve("scripts/crafty-cli/index.mjs"), executable);
    const result = spawnSync(executable, ["--help"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage: crafty-cli <dev\|prod>/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function successfulRunner(stdout) {
  const calls = [];
  return {
    calls,
    runProcess(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0, stdout, stderr: "" };
    },
  };
}

test("development admin queries use local Compose PostgreSQL and parse accounts", () => {
  const runner = successfulRunner('[{"handle":"roman","characterCount":2,"highestLevel":7,"characters":[],"merchantEntitlements":[]}]\n');
  const database = new AdminDatabase("dev", { projectRoot: "/project", runProcess: runner.runProcess });
  const accounts = database.listAccounts();
  assert.equal(accounts[0].handle, "roman");
  assert.deepEqual(runner.calls[0].args.slice(0, 7), ["compose", "exec", "--no-TTY", "postgres", "psql", "--username", "crafty"]);
  assert.equal(runner.calls[0].options.cwd, "/project");
  assert.match(runner.calls[0].options.input, /FROM accounts/);
});

test("production admin queries run only through the configured SSH host", () => {
  const runner = successfulRunner("[]\n");
  const database = new AdminDatabase("prod", { projectRoot: "/project", deployHost: "crafty-example", runProcess: runner.runProcess });
  assert.deepEqual(database.listAccounts(), []);
  assert.equal(runner.calls[0].command, "ssh");
  assert.equal(runner.calls[0].args[0], "crafty-example");
  assert.match(runner.calls[0].args[1], /sudo -n -u crafty/);
  assert.match(runner.calls[0].args[1], /docker compose --project-name crafty-prod/);
  assert.doesNotMatch(runner.calls[0].args[1], /127\.0\.0\.1|localhost/);
});

test("debug merchant enable and disable operations are account-scoped and parameterized", () => {
  const runner = successfulRunner('{"handle":"roman","merchantId":"debug-artificer","enabled":true,"affectedCharacters":2}\n');
  const database = new AdminDatabase("dev", { runProcess: runner.runProcess });
  const result = database.setDebugMerchant("Roman", true);
  assert.equal(result.enabled, true);
  assert.ok(runner.calls[0].args.includes("account_handle=roman"));
  assert.ok(runner.calls[0].args.includes(`merchant_id=${DEBUG_MERCHANT_ID}`));
  assert.match(runner.calls[0].options.input, /INSERT INTO account_merchant_entitlements/);

  runner.runProcess = (command, args, options) => {
    runner.calls.push({ command, args, options });
    return { status: 0, stdout: '{"handle":"roman","merchantId":"debug-artificer","enabled":false,"affectedCharacters":2}\n', stderr: "" };
  };
  database.runProcess = runner.runProcess;
  assert.equal(database.setDebugMerchant("roman", false).enabled, false);
  assert.match(runner.calls.at(-1).options.input, /DELETE FROM account_merchant_entitlements/);
  assert.throws(() => database.setDebugMerchant("unsafe account", true), /Invalid account handle/);
});

test("password reset is account-scoped, parameterized, and revokes sessions", () => {
  const runner = successfulRunner('{"handle":"roman","passwordConfigured":true,"sessionsRevoked":2}\n');
  const database = new AdminDatabase("dev", { runProcess: runner.runProcess });
  const result = database.setAccountPassword("Roman", "scrypt$16384$8$1$c2FsdA$aGFzaA");
  assert.equal(result.passwordConfigured, true);
  assert.ok(runner.calls[0].args.includes("account_handle=roman"));
  assert.ok(runner.calls[0].args.some((argument) => argument.startsWith("password_hash=scrypt$")));
  assert.match(runner.calls[0].options.input, /UPDATE accounts/);
  assert.match(runner.calls[0].options.input, /UPDATE auth_sessions/);
});

test("interactive selector responds to arrow keys and Enter", async () => {
  const input = new EventEmitter();
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = (enabled) => { input.isRaw = enabled; };
  input.resume = () => {};
  input.pause = () => {};
  const writes = [];
  const output = { isTTY: true, write: (value) => { writes.push(value); } };
  const selected = select("Choose", [
    { label: "First", value: "first" },
    { label: "Second", value: "second" },
  ], { input, output });
  queueMicrotask(() => {
    input.emit("keypress", "", { name: "down" });
    input.emit("keypress", "", { name: "return" });
  });
  assert.equal(await selected, "second");
  assert.equal(input.isRaw, false);
  assert.match(writes.join(""), /↑\/↓ move/);
});
