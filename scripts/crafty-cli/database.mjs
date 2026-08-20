import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const DEBUG_MERCHANT_ID = "debug-artificer";

const CLI_DIRECTORY = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(CLI_DIRECTORY, "../..");

const LIST_ACCOUNTS_SQL = String.raw`
SELECT coalesce(json_agg(account_record ORDER BY account_record.handle), '[]'::json)::text
FROM (
  SELECT
    accounts.handle,
    accounts.created_at::text AS "createdAt",
    count(characters.id)::integer AS "characterCount",
    coalesce(max(characters.level), 0)::integer AS "highestLevel",
    coalesce(
      json_agg(
        json_build_object(
          'name', characters.name,
          'classId', characters.class_id,
          'level', characters.level
        ) ORDER BY characters.created_at, characters.id
      ) FILTER (WHERE characters.id IS NOT NULL),
      '[]'::json
    ) AS characters,
    coalesce(
      (
        SELECT json_agg(entitlements.merchant_id ORDER BY entitlements.merchant_id)
        FROM account_merchant_entitlements AS entitlements
        WHERE entitlements.account_id = accounts.id
      ),
      '[]'::json
    ) AS "merchantEntitlements"
  FROM accounts
  LEFT JOIN characters ON characters.account_id = accounts.id
  GROUP BY accounts.id, accounts.handle, accounts.created_at
) AS account_record;
`;

function merchantMutationSql(enabled) {
  const mutation = enabled
    ? String.raw`
INSERT INTO account_merchant_entitlements (account_id, merchant_id)
SELECT id, current_setting('crafty.merchant_id')
FROM accounts
WHERE handle = current_setting('crafty.account_handle')
ON CONFLICT (account_id, merchant_id) DO NOTHING;`
    : String.raw`
DELETE FROM account_merchant_entitlements
USING accounts
WHERE account_merchant_entitlements.account_id = accounts.id
  AND accounts.handle = current_setting('crafty.account_handle')
  AND account_merchant_entitlements.merchant_id = current_setting('crafty.merchant_id');`;

  return String.raw`
BEGIN;

SELECT set_config('crafty.account_handle', lower(:'account_handle'), false) AS account_handle \gset
SELECT set_config('crafty.merchant_id', :'merchant_id', false) AS merchant_id \gset

DO $block$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM accounts
    WHERE handle = current_setting('crafty.account_handle')
  ) THEN
    RAISE EXCEPTION 'Account "%" does not exist', current_setting('crafty.account_handle');
  END IF;
END
$block$;

${mutation}

SELECT json_build_object(
  'handle', accounts.handle,
  'merchantId', current_setting('crafty.merchant_id'),
  'enabled', EXISTS (
    SELECT 1
    FROM account_merchant_entitlements AS entitlements
    WHERE entitlements.account_id = accounts.id
      AND entitlements.merchant_id = current_setting('crafty.merchant_id')
  ),
  'affectedCharacters', count(characters.id)::integer
)::text
FROM accounts
LEFT JOIN characters ON characters.account_id = accounts.id
WHERE accounts.handle = current_setting('crafty.account_handle')
GROUP BY accounts.id, accounts.handle;

COMMIT;
`;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function parseEnvFile(contents) {
  const values = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function resolveDeployHost(projectRoot = PROJECT_ROOT, environment = process.env) {
  if (environment.DEPLOY_HOST) return environment.DEPLOY_HOST;
  try {
    return parseEnvFile(readFileSync(resolve(projectRoot, ".env.deploy"), "utf8")).DEPLOY_HOST || "crafty-prod";
  } catch {
    return "crafty-prod";
  }
}

function parseJsonOutput(output) {
  const value = output.trim();
  if (!value) throw new Error("PostgreSQL returned no result");
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`PostgreSQL returned an invalid response: ${value.slice(0, 240)}`);
  }
}

function failureMessage(environment, result) {
  const detail = (result.stderr || result.stdout || result.error?.message || "Unknown database error").trim();
  const hint = environment === "dev"
    ? "Ensure Docker is running and start PostgreSQL with npm run db:up."
    : "Verify SSH access, DEPLOY_HOST, and that the production stack is healthy.";
  return `${detail || "Database command failed"}\n${hint}`;
}

export class AdminDatabase {
  constructor(environment, options = {}) {
    if (environment !== "dev" && environment !== "prod") throw new Error("Environment must be dev or prod");
    this.environment = environment;
    this.projectRoot = options.projectRoot ?? PROJECT_ROOT;
    this.deployHost = options.deployHost ?? resolveDeployHost(this.projectRoot);
    this.runProcess = options.runProcess ?? spawnSync;
  }

  describeTarget() {
    return this.environment === "dev" ? "local Docker · crafty-postgres" : `production · ${this.deployHost}`;
  }

  listAccounts() {
    const accounts = this.queryJson(LIST_ACCOUNTS_SQL);
    if (!Array.isArray(accounts)) throw new Error("Account query did not return a list");
    return accounts;
  }

  setDebugMerchant(handle, enabled) {
    if (!/^[A-Za-z0-9_-]{2,24}$/.test(handle)) throw new Error("Invalid account handle");
    return this.queryJson(merchantMutationSql(enabled), {
      account_handle: handle.toLowerCase(),
      merchant_id: DEBUG_MERCHANT_ID,
    });
  }

  queryJson(sql, variables = {}) {
    const psqlArguments = [
      "--set", "ON_ERROR_STOP=1",
      "--no-align",
      "--tuples-only",
      "--quiet",
      ...Object.entries(variables).flatMap(([key, value]) => ["--set", `${key}=${value}`]),
    ];
    const result = this.environment === "dev"
      ? this.runProcess("docker", [
          "compose", "exec", "--no-TTY", "postgres", "psql",
          "--username", "crafty", "--dbname", "crafty", ...psqlArguments,
        ], { cwd: this.projectRoot, input: sql, encoding: "utf8" })
      : this.runProductionQuery(sql, psqlArguments);
    if (result.status !== 0 || result.error) throw new Error(failureMessage(this.environment, result));
    return parseJsonOutput(result.stdout);
  }

  runProductionQuery(sql, psqlArguments) {
    const innerCommand = [
      "set -a",
      ". /srv/crafty/shared/.env",
      "set +a",
      "cd /srv/crafty/current",
      "RELEASE_ID=$(cat .release-id)",
      "export RELEASE_ID",
      [
        "docker compose --project-name crafty-prod",
        "--env-file /srv/crafty/shared/.env",
        "--file deploy/docker-compose.prod.yml",
        "exec --no-TTY postgres psql",
        '--username "$POSTGRES_USER"',
        '--dbname "$POSTGRES_DB"',
        ...psqlArguments.map(shellQuote),
      ].join(" "),
    ].join("; ");
    const remoteCommand = `sudo -n -u crafty -H sh -lc ${shellQuote(innerCommand)}`;
    return this.runProcess("ssh", [this.deployHost, remoteCommand], {
      cwd: this.projectRoot,
      input: sql,
      encoding: "utf8",
    });
  }
}
