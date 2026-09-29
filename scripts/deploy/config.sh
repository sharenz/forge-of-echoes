# Deployment settings (override via environment or scripts/deploy/.env.deploy).
DEPLOY_HOST="${DEPLOY_HOST:-crafty-prod}"
DEPLOY_IP="${DEPLOY_IP:-178.105.23.209}"
# Free TLS hostname derived from the IP; replace with a real domain pointing at DEPLOY_IP when available.
APP_DOMAIN="${APP_DOMAIN:-forge-of-echoes.${DEPLOY_IP//./-}.sslip.io}"
APP_DIR=/opt/forge
DATA_DIR=/var/lib/forge
APP_PORT=8787
KEEP_RELEASES=5
