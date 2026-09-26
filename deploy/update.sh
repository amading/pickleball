#!/usr/bin/env bash
# Deploy a new version on the VPS. Run from an updated copy of the repository:
#
#   git pull && sudo bash deploy/update.sh
#
# Data in /var/lib/pbb is untouched; the server takes a backup before any data upgrade.
set -euo pipefail
if [[ $EUID -ne 0 ]]; then echo "Run with sudo." >&2; exit 1; fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR=/opt/pbb

if [[ "$SOURCE_DIR" != "$APP_DIR" ]]; then
  rsync -a --delete --exclude node_modules --exclude dist --exclude .git "$SOURCE_DIR"/ "$APP_DIR"/
fi
cd "$APP_DIR"
npm ci --no-audit --no-fund
npm run build
install -m 644 "$APP_DIR/deploy/pbb.service" /etc/systemd/system/pbb.service
systemctl daemon-reload
systemctl restart pbb
sleep 2
systemctl --no-pager --lines=5 status pbb
