#!/usr/bin/env bash
set -Eeuo pipefail

root=/srv/crafty
release_directory=${1:?release directory is required}
environment_file=${root}/shared/.env

if [[ ${release_directory} != "${root}/releases/"* ]] || [[ ! -d ${release_directory} ]]; then
  echo "Invalid release directory: ${release_directory}" >&2
  exit 1
fi
if [[ ! -r ${environment_file} ]]; then
  echo "Production environment is missing; run the setup script first" >&2
  exit 1
fi

cd "${release_directory}"

release_id=$(<"${release_directory}/.release-id")
previous_release=$(readlink -f "${root}/current" 2>/dev/null || true)

compose() {
  RELEASE_ID=${release_id} docker compose \
    --project-name crafty-prod \
    --env-file "${environment_file}" \
    --file "${release_directory}/deploy/docker-compose.prod.yml" \
    "$@"
}

echo "Building release ${release_id}"
compose build

drain_timeout_seconds=600
if [[ -n $(compose ps --status running --quiet game-server 2>/dev/null) ]]; then
  echo "Draining the active game server (up to ${drain_timeout_seconds}s)"
  if compose exec -T game-server node -e \
    "fetch('http://127.0.0.1:2567/admin/drain',{method:'POST'}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"; then
    drain_deadline=$((SECONDS + drain_timeout_seconds))
    while (( SECONDS < drain_deadline )); do
      if compose exec -T game-server node -e \
        "fetch('http://127.0.0.1:2567/healthz').then(r=>r.json()).then(h=>process.exit(h.activeMapRooms===0?0:2)).catch(()=>process.exit(3))"; then
        echo "All active maps have drained"
        break
      fi
      sleep 5
    done
    if (( SECONDS >= drain_deadline )); then
      echo "Drain deadline reached; continuing with a controlled restart" >&2
    fi
  else
    echo "Active release does not support draining; continuing with deployment" >&2
  fi
fi

ln -sfn "${release_directory}" "${root}/current"
if compose up --detach --remove-orphans --wait --wait-timeout 180; then
  echo "Release ${release_id} is healthy"
  compose ps
  exit 0
fi

echo "Release ${release_id} failed health checks" >&2
if [[ -n ${previous_release} && -d ${previous_release} && -r ${previous_release}/.release-id ]]; then
  previous_id=$(<"${previous_release}/.release-id")
  ln -sfn "${previous_release}" "${root}/current"
  echo "Rolling back to ${previous_id}" >&2
  RELEASE_ID=${previous_id} docker compose \
    --project-name crafty-prod \
    --env-file "${environment_file}" \
    --file "${previous_release}/deploy/docker-compose.prod.yml" \
    up --detach --remove-orphans --wait --wait-timeout 180
fi
exit 1
