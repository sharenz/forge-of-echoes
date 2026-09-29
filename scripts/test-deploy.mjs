// Exercise the real remote activation block against disposable SQLite databases. Service/process and
// Linux ownership commands are stand-ins; backup, SQL migration, rollback and symlink changes are real.
// Run: node scripts/test-deploy.mjs
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const deploy = readFileSync(new URL('./deploy/deploy.sh', import.meta.url), 'utf8');
const remote = deploy.split("<<'REMOTE'\n")[1]?.split('\nREMOTE\n')[0];
assert.ok(remote, 'remote activation block exists');
const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'forge-deploy-test-')));
try {
  for (const scenario of ['healthy', 'bad-health', 'backup-refused']) {
    const root = join(fixture, scenario);
    const app = join(root, 'app'), data = join(root, 'data'), bin = join(root, 'bin');
    for (const dir of [bin, join(app, 'releases/old'), join(app, 'releases/new'), join(data, 'backups')]) mkdirSync(dir, { recursive: true });
    symlinkSync(join(app, 'releases/old'), join(app, 'current'));
    const dbPath = join(data, 'forge.db'), backupPath = join(data, 'backups/pre-release-new.db');
    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA user_version=2; CREATE TABLE writes(value TEXT); INSERT INTO writes VALUES ('before');");
    db.close();
    if (scenario === 'backup-refused') writeFileSync(backupPath, 'existing backup must not be overwritten');
    const command = (name, code) => writeFileSync(join(bin, name), `#!/usr/bin/env node\n${code}\n`, { mode: 0o755 });
    // The real systemd service and dependency installation must never be touched by this test.
    for (const name of ['npm', 'chown', 'sleep', 'journalctl', 'xargs']) command(name, 'process.exit(0);');
    command('readlink', `console.log(require('node:fs').realpathSync(process.argv.at(-1)));`);
    command('mv', `require('node:fs').renameSync(process.argv.at(-2), process.argv.at(-1));`);
    command('curl', `process.exit(process.env.DEPLOY_TEST_SCENARIO === 'bad-health' ? 1 : 0);`);
    command('systemctl', `
const { DatabaseSync } = require('node:sqlite');
const { realpathSync, existsSync, writeFileSync } = require('node:fs');
const active = realpathSync(process.env.APP_DIR + '/current').endsWith('/new');
const db = new DatabaseSync(process.env.DATA_DIR + '/forge.db');
if (process.argv[2] === 'stop' && !active && !existsSync(process.env.DATA_DIR + '/drained')) {
  db.exec("INSERT INTO writes VALUES ('last-drain-save')");
  writeFileSync(process.env.DATA_DIR + '/drained', 'yes');
}
if (process.argv[2] === 'start' && active) {
  db.exec("PRAGMA user_version=3; INSERT INTO writes VALUES ('new-release')");
}
db.close();
`);
    const result = spawnSync('bash', ['-s'], {
      input: remote, encoding: 'utf8', timeout: 30_000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, APP_DIR: app, DATA_DIR: data, APP_PORT: '1', RELEASE: 'new', KEEP: '5', DEPLOY_TEST_SCENARIO: scenario },
    });
    assert.equal(result.status, scenario === 'healthy' ? 0 : 1, result.stdout + result.stderr);
    const read = (path) => {
      const db = new DatabaseSync(path, { readOnly: true });
      const state = { version: db.prepare('PRAGMA user_version').get().user_version, writes: db.prepare('SELECT value FROM writes').all().map((r) => r.value) };
      db.close();
      return state;
    };
    const previous = { version: 2, writes: ['before', 'last-drain-save'] };
    const next = { version: 3, writes: [...previous.writes, 'new-release'] };
    assert.equal(realpathSync(join(app, 'current')), join(app, `releases/${scenario === 'healthy' ? 'new' : 'old'}`));
    assert.deepEqual(read(dbPath), scenario === 'healthy' ? next : previous);
    if (scenario === 'backup-refused') assert.equal(readFileSync(backupPath, 'utf8'), 'existing backup must not be overwritten');
    else assert.deepEqual(read(backupPath), previous);
    if (scenario === 'bad-health') assert.deepEqual(read(`${backupPath}.failed`), next);
    console.log(`PASS ${scenario}: drain saved, compatible database and code selected`);
  }
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
