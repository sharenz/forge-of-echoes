#!/usr/bin/env bash
set -Eeuo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
deploy_host=${DEPLOY_HOST:-crafty-prod}
deploy_ip=${DEPLOY_IP:-178.104.24.28}
ip_slug=${deploy_ip//./-}
app_domain=${APP_DOMAIN:-crafty.${ip_slug}.sslip.io}
game_domain=${GAME_DOMAIN:-game.crafty.${ip_slug}.sslip.io}

if [[ ! ${deploy_host} =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "Invalid DEPLOY_HOST" >&2
  exit 1
fi

echo "Preparing ${deploy_host} for Crafty"
echo "Application domain: ${app_domain}"
echo "Game-server domain: ${game_domain}"

ssh "${deploy_host}" "sudo -n bash -s -- '${app_domain}' '${game_domain}'" < "${project_root}/deploy/setup-vm.sh"

ssh "${deploy_host}" 'set -eu
getent passwd crafty
sudo -n test -f /srv/crafty/.setup-complete
sudo -n test "$(sudo -n stat -c %a /srv/crafty/shared/.env)" = 640
docker --version
docker compose version'
