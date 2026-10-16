#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/var/www/cowboybepob"
SERVICE_USER="cowboybepob"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/install-native.sh"
  exit 1
fi

apt-get update
apt-get install -y git curl ca-certificates build-essential nginx postgresql postgresql-contrib openssl python3

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /var/lib/cowboybepob --shell /usr/sbin/nologin "$SERVICE_USER"
fi

mkdir -p /var/www
if [[ ! -d "$APP_DIR/.git" ]]; then
  git clone https://github.com/adourix/cowboybepob-site.git "$APP_DIR"
else
  git -C "$APP_DIR" pull --ff-only
fi

chown -R "$SERVICE_USER":"$SERVICE_USER" "$APP_DIR"

sudo -u "$SERVICE_USER" bash -lc "cd '$APP_DIR' && npm install && npm run typecheck && npm run build"

install -d -m 0755 /etc/cowboybepob
if [[ ! -f /etc/cowboybepob/site.env ]]; then
  install -m 0600 /dev/null /etc/cowboybepob/site.env
  echo "Created /etc/cowboybepob/site.env; fill it before starting services."
fi

install -m 0644 "$APP_DIR/deploy/systemd/cowboybepob-api.service" /etc/systemd/system/cowboybepob-api.service
install -m 0644 "$APP_DIR/deploy/systemd/cowboybepob-worker.service" /etc/systemd/system/cowboybepob-worker.service
install -m 0644 "$APP_DIR/deploy/nginx/cowboybepob.conf" /etc/nginx/sites-available/cowboybepob.conf
ln -sfn /etc/nginx/sites-available/cowboybepob.conf /etc/nginx/sites-enabled/cowboybepob.conf
rm -f /etc/nginx/sites-enabled/default

systemctl daemon-reload
nginx -t
systemctl enable nginx cowboybepob-api cowboybepob-worker

echo "Native installation prepared."
echo "Public site: http://SERVER_IP:5001"
echo "Private API: 127.0.0.1:5002"
echo "Dev Vite: 0.0.0.0:5003"
echo "Configure /etc/cowboybepob/site.env, import db/schema.sql, then start services."
