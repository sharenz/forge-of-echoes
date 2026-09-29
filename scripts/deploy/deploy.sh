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
ssh "$DEPLOY_HOST" RELEASE="$RELEASE" APP_DIR="$APP_DIR" APP_PORT="$APP_PORT" KEEP="$KEEP_RELEASES" 'bash -s' <<'REMOTE'
set -euo pipefail
cd "$APP_DIR/releases/$RELEASE"
npm ci --omit=dev --no-audit --no-fund --loglevel=error
chown -R root:forge "$APP_DIR/releases/$RELEASE"
chmod -R g+rX,o-rwx "$APP_DIR/releases/$RELEASE"

PREV="$(readlink -f "$APP_DIR/current" 2>/dev/null || true)"
ln -sfn "$APP_DIR/releases/$RELEASE" "$APP_DIR/current.new" && mv -Tf "$APP_DIR/current.new" "$APP_DIR/current"
systemctl restart forge

ok=0
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$APP_PORT/api/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
if [ "$ok" != "1" ]; then
  echo "!! health check failed — recent logs:"; journalctl -u forge -n 40 --no-pager || true
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then
    echo "!! rolling back to $PREV"
    ln -sfn "$PREV" "$APP_DIR/current.new" && mv -Tf "$APP_DIR/current.new" "$APP_DIR/current"
    systemctl restart forge
  fi
  exit 1
fi
echo "--> healthy: $(curl -fsS http://127.0.0.1:$APP_PORT/api/health)"
# prune old releases
ls -1dt "$APP_DIR"/releases/* | tail -n +$((KEEP + 1)) | xargs -r rm -rf
REMOTE

echo "--> public check"
for i in $(seq 1 20); do
  if curl -fsS "https://$APP_DOMAIN/api/health" >/dev/null 2>&1; then
    echo "==> Live: https://$APP_DOMAIN"; exit 0
  fi
  sleep 3
done
echo "!! server is healthy on the VM but https://$APP_DOMAIN is not reachable yet (TLS issuance?). Check: ssh $DEPLOY_HOST journalctl -u caddy -n 50"
exit 1
