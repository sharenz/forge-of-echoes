#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { AdminDatabase, DEBUG_MERCHANT_ID } from "./database.mjs";
import { PromptInterruptedError, assertInteractive, clearScreen, pause, secret, select, style } from "./prompt.mjs";

const DEBUG_MERCHANT_NAME = "Veyra · Debug Artificer";

function usage() {
  return `Usage: crafty-cli <dev|prod>

Interactive Forge of Echoes super-admin console.

  crafty-cli dev    Manage the local Docker PostgreSQL realm
  crafty-cli prod   Manage production through the configured SSH host
`;
}

function banner(database) {
  const production = database.environment === "prod";
  const environment = production ? style.red("PRODUCTION") : style.green("DEVELOPMENT");
  process.stdout.write(`${style.magenta("◆")} ${style.bold("FORGE OF ECHOES · SUPER ADMIN")}  ${environment}\n`);
  process.stdout.write(`${style.dim(database.describeTarget())}\n\n`);
  if (production) process.stdout.write(`${style.red("⚠ Changes affect live player accounts.")}\n\n`);
}

function debugEnabled(account) {
  return account.merchantEntitlements.includes(DEBUG_MERCHANT_ID);
}

function characterSummary(account) {
  if (!account.characters.length) return "no characters";
  return account.characters.map((character) => `${character.name} Lv${character.level}`).join(", ");
}

function printAccounts(accounts) {
  if (!accounts.length) {
    process.stdout.write(`${style.yellow("No accounts found.")}\n`);
    return;
  }
  const handleWidth = Math.max(7, ...accounts.map((account) => account.handle.length));
  const rows = accounts.map((account) => ({
    account: account.handle.padEnd(handleWidth),
    characters: String(account.characterCount).padStart(5),
    level: String(account.highestLevel).padStart(3),
    debug: debugEnabled(account) ? "ENABLED " : "disabled",
    auth: account.passwordConfigured ? "ready" : "SETUP NEEDED",
    roster: characterSummary(account),
  }));
  process.stdout.write(`${style.bold("ACCOUNT".padEnd(handleWidth))}  ${style.bold("CHARS")}  ${style.bold("MAX")}  ${style.bold("AUTH")}          ${style.bold("DEBUG")}   ${style.bold("CHARACTERS")}\n`);
  process.stdout.write(`${"─".repeat(handleWidth)}  ─────  ───  ─────────────  ───────   ${"─".repeat(34)}\n`);
  for (const row of rows) {
    const status = row.debug.trim() === "ENABLED" ? style.green(row.debug) : style.dim(row.debug);
    const auth = row.auth === "ready" ? style.green(row.auth.padEnd(13)) : style.yellow(row.auth.padEnd(13));
    process.stdout.write(`${row.account}  ${row.characters}  ${row.level}  ${auth}  ${status}   ${row.roster}\n`);
  }
}

function hashPassword(password) {
  const salt = randomBytes(16);
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, 32, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, derived) => {
      if (error) reject(error);
      else resolve(`scrypt$16384$8$1$${salt.toString("base64url")}$${derived.toString("base64url")}`);
    });
  });
}

async function setAccountPassword(database) {
  clearScreen();
  banner(database);
  const accounts = loadAccounts(database);
  if (!accounts.length) {
    process.stdout.write(`${style.yellow("No accounts found.")}\n\n`);
    await pause();
    return;
  }
  const account = await select("Set or reset the password for which account?", [
    ...accounts.map((candidate) => ({
      label: `${candidate.handle} · ${candidate.passwordConfigured ? "password configured" : "setup required"}`,
      value: candidate,
    })),
    { label: "Back", value: null },
  ]);
  if (!account) return;
  const password = await secret("New password (10+ characters):");
  if (!password) return;
  const confirmation = await secret("Repeat password:");
  if (!confirmation) return;
  if (password !== confirmation) {
    process.stdout.write(`${style.red("Passwords did not match.")}\n\n`);
    await pause();
    return;
  }
  process.stdout.write(style.dim("Hashing password and revoking old sessions…"));
  const result = database.setAccountPassword(account.handle, await hashPassword(password));
  process.stdout.write("\r\u001b[2K");
  process.stdout.write(`${style.green("Password configured")} for ${style.bold(result.handle)}. Existing login sessions were revoked.\n\n`);
  await pause();
}

function loadAccounts(database) {
  process.stdout.write(style.dim("Connecting to PostgreSQL…"));
  const accounts = database.listAccounts();
  process.stdout.write("\r\u001b[2K");
  return accounts;
}

async function listUsers(database) {
  clearScreen();
  banner(database);
  const accounts = loadAccounts(database);
  printAccounts(accounts);
  process.stdout.write(`\n${style.dim(`${accounts.length} account${accounts.length === 1 ? "" : "s"}`)}\n\n`);
  await pause();
}

async function changeDebugMerchant(database, enabled) {
  clearScreen();
  banner(database);
  const accounts = loadAccounts(database);
  const eligible = accounts.filter((account) => debugEnabled(account) !== enabled);
  if (!eligible.length) {
    process.stdout.write(`${style.yellow(enabled ? "The debug merchant is already enabled for every account." : "The debug merchant is not enabled for any account.")}\n\n`);
    await pause();
    return;
  }

  const account = await select(
    `${enabled ? "Enable" : "Disable"} ${DEBUG_MERCHANT_NAME} for which account?`,
    [
      ...eligible.map((candidate) => ({
        label: `${candidate.handle} · ${candidate.characterCount} character${candidate.characterCount === 1 ? "" : "s"} · ${characterSummary(candidate)}`,
        value: candidate,
      })),
      { label: "Back", value: null },
    ],
    { initial: 0 },
  );
  if (!account) return;

  const action = enabled ? "ENABLE" : "DISABLE";
  const confirmed = await select(
    `${action} debug merchant for account “${account.handle}” and all its characters?`,
    [
      { label: "Cancel", value: false },
      { label: `${action} ${DEBUG_MERCHANT_NAME}`, value: true },
    ],
    { initial: 0 },
  );
  if (!confirmed) return;

  process.stdout.write(style.dim(`${enabled ? "Granting" : "Revoking"} account entitlement…`));
  const result = database.setDebugMerchant(account.handle, enabled);
  process.stdout.write("\r\u001b[2K");
  const state = result.enabled ? style.green("enabled") : style.yellow("disabled");
  process.stdout.write(`${style.bold(DEBUG_MERCHANT_NAME)} is now ${state} for ${style.bold(result.handle)}.\n`);
  process.stdout.write(`${result.affectedCharacters} existing character${result.affectedCharacters === 1 ? "" : "s"} affected; future characters inherit the account setting.\n`);
  process.stdout.write(style.dim("The player must log out and back in to refresh merchant access.\n\n"));
  await pause();
}

export async function runCli(argv = process.argv.slice(2)) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(usage());
    return 0;
  }
  const environment = argv[0];
  if ((environment !== "dev" && environment !== "prod") || argv.length !== 1) {
    process.stderr.write(usage());
    return 2;
  }
  assertInteractive();
  const database = new AdminDatabase(environment);

  while (true) {
    clearScreen();
    banner(database);
    const command = await select("Choose an administrative command", [
      { label: "List users", value: "list-users" },
      { label: "Set / reset account password", value: "set-password" },
      { label: `Enable ${DEBUG_MERCHANT_NAME}`, value: "enable-debug" },
      { label: `Disable ${DEBUG_MERCHANT_NAME}`, value: "disable-debug" },
      { label: "Exit", value: "exit" },
    ]);
    if (!command || command === "exit") return 0;
    try {
      if (command === "list-users") await listUsers(database);
      if (command === "set-password") await setAccountPassword(database);
      if (command === "enable-debug") await changeDebugMerchant(database, true);
      if (command === "disable-debug") await changeDebugMerchant(database, false);
    } catch (error) {
      if (error instanceof PromptInterruptedError) throw error;
      process.stdout.write(`\n${style.red(style.bold("Command failed"))}\n${error instanceof Error ? error.message : String(error)}\n\n`);
      await pause();
    }
  }
}

function invokedAsMain(moduleUrl = import.meta.url, executablePath = process.argv[1]) {
  if (!executablePath) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(executablePath);
  } catch {
    return false;
  }
}

const isMainModule = invokedAsMain();
if (isMainModule) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  }).catch((error) => {
    if (error instanceof PromptInterruptedError) {
      process.stdout.write("\n");
      process.exitCode = 130;
      return;
    }
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
