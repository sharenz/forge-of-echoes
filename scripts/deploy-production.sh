#!/usr/bin/env bash
set -Eeuo pipefail

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
deploy_host=${DEPLOY_HOST:-crafty-prod}

if [[ ! ${deploy_host} =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "Invalid DEPLOY_HOST" >&2
  exit 1
fi

commit=$(git -C "${project_root}" rev-parse --short HEAD 2>/dev/null || printf 'working-tree')
release_id="$(date -u +%Y%m%dT%H%M%SZ)-${commit}"
release_directory="/srv/crafty/releases/${release_id}"
staging_directory="/tmp/crafty-release-${release_id}"

ssh "${deploy_host}" 'sudo -n test -f /srv/crafty/.setup-complete' || {
  echo "The VM is not initialized. Run make setup-prod first." >&2
  exit 1
}

echo "Uploading release ${release_id}"
ssh "${deploy_host}" "install -d -m 700 '${staging_directory}'"
rsync --archive --compress --delete \
  --exclude '.git/' \
  --exclude '.next/' \
  --exclude '.vinext/' \
  --exclude '.wrangler/' \
  --exclude 'dist/' \
  --exclude 'node_modules/' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'art/' \
  "${project_root}/" "${deploy_host}:${staging_directory}/"

printf '%s\n' "${release_id}" | ssh "${deploy_host}" "tee '${staging_directory}/.release-id' >/dev/null"
ssh "${deploy_host}" "sudo -n mv '${staging_directory}' '${release_directory}' && sudo -n chown -R crafty:crafty '${release_directory}'"

echo "Activating release ${release_id}"
ssh "${deploy_host}" "sudo -n -u crafty -H bash '${release_directory}/deploy/activate-release.sh' '${release_directory}'"

echo "Deployment complete"
ssh "${deploy_host}" 'sudo -n -u crafty -H sh -lc '\''cd /srv/crafty/current; RELEASE_ID=$(cat .release-id); export RELEASE_ID; docker compose --project-name crafty-prod --env-file /srv/crafty/shared/.env --file deploy/docker-compose.prod.yml ps'\'''
