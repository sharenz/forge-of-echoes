#!/usr/bin/env bash
# Build locally, upload an immutable release, switch atomically, health-check, roll back on failure.
# Usage: npm run deploy            (SKIP_CHECKS=1 skips typecheck/tests)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
source scripts/deploy/config.sh
[ -f scripts/deploy/.env.deploy ] && source scripts/deploy/.env.deploy

RELEASE="$(date -u +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
echo "==> Release $RELEASE → $DEPLOY_HOST ($APP_DOMAIN)"

if [ "${SKIP_CHECKS:-0}" != "1" ]; then
  echo "--> typecheck + tests"
  npx tsc --noEmit
  npx vitest run --reporter=dot
fi
echo "--> building client"
npx vite build --logLevel warn

echo "--> uploading"
ssh "$DEPLOY_HOST" "mkdir -p $APP_DIR/releases/$RELEASE"
# Keep the systemd unit in sync with the repo (e.g. the drain timeout).
scp -q scripts/deploy/forge.service "$DEPLOY_HOST:/tmp/forge.service"
ssh "$DEPLOY_HOST" "install -m 644 /tmp/forge.service /etc/systemd/system/forge.service && systemctl daemon-reload"
rsync -az --delete \
  --include='/package.json' --include='/package-lock.json' \
  --include='/src/***' --include='/dist/***' \
  --exclude='*' \
  ./ "$DEPLOY_HOST:$APP_DIR/releases/$RELEASE/"

echo "--> installing runtime dependencies + activating"
ssh "$DEPLOY_HOST" RELEASE="$RELEASE" APP_DIR="$APP_DIR" DATA_DIR="$DATA_DIR" APP_PORT="$APP_PORT" KEEP="$KEEP_RELEASES" 'bash -s' <<'REMOTE'
set -euo pipefail
cd "$APP_DIR/releases/$RELEASE"
npm ci --omit=dev --no-audit --no-fund --loglevel=error
chown -R root:forge "$APP_DIR/releases/$RELEASE"
chmod -R g+rX,o-rwx "$APP_DIR/releases/$RELEASE"

PREV="$(readlink -f "$APP_DIR/current" 2>/dev/null || true)"
DB_PATH="$DATA_DIR/forge.db"
DB_BACKUP="$DATA_DIR/backups/pre-release-$RELEASE.db"
activated=0
backed_up=0
recover() {
  trap - ERR
  echo "!! deployment failed — recent logs:"; journalctl -u forge -n 40 --no-pager || true
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then
    systemctl stop forge
    if [ "$activated" = 1 ] && [ "$backed_up" = 1 ]; then
      # Keep the failed database for diagnosis, then restore the checkpoint from after the old server
      # saved and closed. Rolling back code alone cannot undo a database-format migration.
      for suffix in '' -wal -shm; do
        if [ -f "$DB_PATH$suffix" ]; then cp -p "$DB_PATH$suffix" "$DB_BACKUP.failed$suffix"; fi
      done
      rm -f "$DB_PATH-wal" "$DB_PATH-shm"
      cp "$DB_BACKUP" "$DB_PATH"
      chown forge:forge "$DB_PATH"
      chmod 660 "$DB_PATH"
    fi
    echo "!! rolling back to $PREV"
    ln -sfn "$PREV" "$APP_DIR/current.new" && mv -Tf "$APP_DIR/current.new" "$APP_DIR/current"
    systemctl start forge
  fi
  exit 1
}
trap recover ERR
# Stop before taking the backup: the drain saves changes players make during its countdown.
systemctl stop forge
if [ -f "$DB_PATH" ]; then
  mkdir -p "$DATA_DIR/backups"
  DB_PATH="$DB_PATH" DB_BACKUP="$DB_BACKUP" node --input-type=module <<'BACKUP'
import { DatabaseSync, backup } from 'node:sqlite';
import { chmodSync, existsSync } from 'node:fs';
if (existsSync(process.env.DB_BACKUP)) throw new Error('Release backup already exists');
const source = new DatabaseSync(process.env.DB_PATH, { readOnly: true });
await backup(source, process.env.DB_BACKUP);
source.close();
chmodSync(process.env.DB_BACKUP, 0o600);
const check = new DatabaseSync(process.env.DB_BACKUP, { readOnly: true });
if (check.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw new Error('Release backup is damaged');
check.close();
BACKUP
  backed_up=1
  echo "--> database backup: $DB_BACKUP"
fi
activated=1
ln -sfn "$APP_DIR/releases/$RELEASE" "$APP_DIR/current.new" && mv -Tf "$APP_DIR/current.new" "$APP_DIR/current"
systemctl start forge

ok=0
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$APP_PORT/api/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
if [ "$ok" != "1" ]; then
  recover
fi
trap - ERR
echo "--> healthy: $(curl -fsS http://127.0.0.1:$APP_PORT/api/health)"
# prune old releases
ls -1dt "$APP_DIR"/releases/* | tail -n +$((KEEP + 1)) | xargs -r rm -rf
REMOTE

echo "--> installing testing-merchant CLI"
scp -q scripts/deploy/debug_merch "$DEPLOY_HOST:/tmp/forge-debug_merch"
ssh "$DEPLOY_HOST" 'install -m 755 /tmp/forge-debug_merch /usr/local/bin/debug_merch'

echo "--> public check"
for i in $(seq 1 20); do
  if curl -fsS "https://$APP_DOMAIN/api/health" >/dev/null 2>&1; then
    echo "==> Live: https://$APP_DOMAIN"; exit 0
  fi
  sleep 3
done
echo "!! server is healthy on the VM but https://$APP_DOMAIN is not reachable yet (TLS issuance?). Check: ssh $DEPLOY_HOST journalctl -u caddy -n 50"
exit 1
