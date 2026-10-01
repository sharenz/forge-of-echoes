#!/usr/bin/env bash
# One-time provisioning of the production VM (idempotent). Usage: npm run deploy:setup
set -euo pipefail
cd "$(dirname "$0")"
source ./config.sh
[ -f .env.deploy ] && source .env.deploy

echo "==> Provisioning $DEPLOY_HOST ($APP_DOMAIN)"
scp -q forge.service "$DEPLOY_HOST:/tmp/forge.service"
ssh "$DEPLOY_HOST" APP_DOMAIN="$APP_DOMAIN" APP_PORT="$APP_PORT" 'bash -s' <<'REMOTE'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

echo "--> packages"
apt-get update -qq
apt-get install -y -qq nodejs npm caddy rsync ufw unattended-upgrades curl >/dev/null
node -v

echo "--> swap"
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "--> unattended security upgrades"
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

echo "--> runtime user and directories"
id forge >/dev/null 2>&1 || useradd --system --home /opt/forge --shell /usr/sbin/nologin forge
mkdir -p /opt/forge/releases /var/lib/forge
chown -R forge:forge /var/lib/forge
chmod 750 /var/lib/forge

echo "--> systemd unit"
install -m 644 /tmp/forge.service /etc/systemd/system/forge.service
systemctl daemon-reload
systemctl enable forge.service >/dev/null 2>&1

echo "--> caddy (automatic HTTPS for $APP_DOMAIN)"
cat > /etc/caddy/Caddyfile <<CADDY
$APP_DOMAIN {
  encode zstd gzip
  reverse_proxy 127.0.0.1:$APP_PORT
}

# Plain-IP access redirects to the TLS hostname.
http:// {
  redir https://$APP_DOMAIN{uri} permanent
}
CADDY
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
systemctl enable caddy >/dev/null 2>&1
systemctl reload caddy 2>/dev/null || systemctl restart caddy

echo "--> firewall"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ufw status | head -8

echo "--> done"
REMOTE
echo "==> Provisioned. Deploy with: npm run deploy"
