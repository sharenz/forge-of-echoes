#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "setup-vm.sh must run as root" >&2
  exit 1
fi

app_domain=${1:?app domain is required}
game_domain=${2:?game-server domain is required}

if [[ ! ${app_domain} =~ ^[A-Za-z0-9.-]+$ ]] || [[ ! ${game_domain} =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "domains may contain only letters, digits, dots, and hyphens" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install --yes ca-certificates curl docker.io docker-compose-v2 openssl rsync ufw unattended-upgrades
systemctl enable --now docker.service

if ! getent passwd crafty >/dev/null; then
  useradd --system --user-group --create-home --home-dir /srv/crafty --shell /usr/sbin/nologin crafty
fi
usermod --append --groups docker crafty
passwd --lock crafty >/dev/null 2>&1 || true

install -d -o crafty -g crafty -m 750 /srv/crafty/releases
install -d -o crafty -g crafty -m 750 /srv/crafty/shared

environment_file=/srv/crafty/shared/.env
postgres_password=""
auth_secret=""
if [[ -f ${environment_file} ]]; then
  postgres_password=$(sed -n 's/^POSTGRES_PASSWORD=//p' "${environment_file}" | head -n 1)
  auth_secret=$(sed -n 's/^CRAFTY_AUTH_SECRET=//p' "${environment_file}" | head -n 1)
fi
postgres_password=${postgres_password:-$(openssl rand -hex 32)}
auth_secret=${auth_secret:-$(openssl rand -hex 48)}

temporary_environment=$(mktemp)
trap 'rm -f "${temporary_environment}"' EXIT
printf '%s\n' \
  "APP_DOMAIN=${app_domain}" \
  "GAME_DOMAIN=${game_domain}" \
  "POSTGRES_DB=crafty" \
  "POSTGRES_USER=crafty" \
  "POSTGRES_PASSWORD=${postgres_password}" \
  "CRAFTY_AUTH_SECRET=${auth_secret}" \
  > "${temporary_environment}"
install -o root -g crafty -m 640 "${temporary_environment}" "${environment_file}"

if [[ ! -f /etc/docker/daemon.json ]]; then
  printf '%s\n' \
    '{' \
    '  "log-driver": "local",' \
    '  "log-opts": { "max-size": "20m", "max-file": "3" }' \
    '}' \
    > /etc/docker/daemon.json
  systemctl restart docker.service
fi

if ! swapon --show=NAME --noheadings | grep -qx '/swapfile'; then
  if [[ ! -f /swapfile ]]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
  fi
  swapon /swapfile
fi
if ! grep -q '^/swapfile ' /etc/fstab; then
  printf '%s\n' '/swapfile none swap sw 0 0' >> /etc/fstab
fi

ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

printf '%s\n' \
  'APT::Periodic::Update-Package-Lists "1";' \
  'APT::Periodic::Unattended-Upgrade "1";' \
  > /etc/apt/apt.conf.d/20auto-upgrades

sudo -u crafty -H docker info >/dev/null

touch /srv/crafty/.setup-complete
chown crafty:crafty /srv/crafty/.setup-complete

echo "Forge of Echoes VM setup complete"
echo "Application: https://${app_domain}"
echo "Game server: https://${game_domain}/healthz"
