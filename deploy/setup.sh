#!/usr/bin/env bash
# One-time setup of PBB Pickleball on a fresh Ubuntu 22.04/24.04 or Debian 12 VPS.
#
#   sudo bash deploy/setup.sh pbb.example.com
#
# Run it from a copy of this repository on the server (git clone, or upload the folder).
# It installs Node.js 22 and Caddy, runs the app as the "pbb" user under systemd on 127.0.0.1:8787,
# and serves it over HTTPS on your domain. Point the domain's A record at this server first.
# Safe to run again: existing settings and data are kept.
set -euo pipefail

DOMAIN="${1:-}"
if [[ -z "$DOMAIN" ]]; then echo "Usage: sudo bash deploy/setup.sh your-domain.com" >&2; exit 1; fi
if [[ $EUID -ne 0 ]]; then echo "Run with sudo." >&2; exit 1; fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR=/opt/pbb
DATA_DIR=/var/lib/pbb
ENV_FILE=/etc/pbb.env

echo "==> Installing packages"
apt-get update -y
apt-get install -y ca-certificates curl gnupg rsync debian-keyring debian-archive-keyring apt-transport-https ufw
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> Creating the pbb user and folders"
id pbb >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin pbb
mkdir -p "$APP_DIR" "$DATA_DIR"
chown pbb:pbb "$DATA_DIR"
chmod 750 "$DATA_DIR"

echo "==> Copying the app to $APP_DIR"
if [[ "$SOURCE_DIR" != "$APP_DIR" ]]; then
  rsync -a --delete --exclude node_modules --exclude dist --exclude .git "$SOURCE_DIR"/ "$APP_DIR"/
fi
cd "$APP_DIR"
npm ci --no-audit --no-fund
npm run build
chown -R root:root "$APP_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "==> Writing $ENV_FILE"
  PIN="$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 20)"
  cat > "$ENV_FILE" <<EOF
HOST=127.0.0.1
API_PORT=8787
DATA_FILE=$DATA_DIR/data.json
PUBLIC_BASE_URL=https://$DOMAIN
TRUST_PROXY=1
# Setup/recovery PIN: creates the first owner account and resets forgotten passwords.
ADMIN_PIN=$PIN
EOF
  chmod 640 "$ENV_FILE"
  chown root:pbb "$ENV_FILE"
fi

echo "==> Installing the service"
install -m 644 "$APP_DIR/deploy/pbb.service" /etc/systemd/system/pbb.service
sed "s/{DOMAIN}/$DOMAIN/" "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable --now pbb
systemctl restart pbb
systemctl reload caddy || systemctl restart caddy

echo "==> Firewall: SSH, HTTP, HTTPS only"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

sleep 2
systemctl --no-pager --lines=0 status pbb || true
echo
echo "Done. Open https://$DOMAIN and go to Organizer to create the owner account."
echo "Setup PIN: $(grep '^ADMIN_PIN=' "$ENV_FILE" | cut -d= -f2)"
echo "Data and backups: $DATA_DIR   Logs: journalctl -u pbb -f"
