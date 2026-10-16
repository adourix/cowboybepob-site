#!/usr/bin/env bash
set -euo pipefail

# Native deployment helper for the existing abdulrahman account.
# It deliberately does not create a separate service user and does not
# replace/remove any existing Nginx configuration.
PROJECT_USER="abdulrahman"
APP_DIR="/home/${PROJECT_USER}/projects/cowboybepob"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/install-native.sh"
  exit 1
fi

if ! id "$PROJECT_USER" >/dev/null 2>&1; then
  echo "Required user '$PROJECT_USER' does not exist."
  exit 1
fi

apt-get update
apt-get install -y git curl ca-certificates build-essential nginx postgresql postgresql-contrib openssl python3

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

install -d -o "$PROJECT_USER" -g "$PROJECT_USER" "/home/${PROJECT_USER}/projects"

if [[ ! -d "$APP_DIR/.git" ]]; then
  sudo -u "$PROJECT_USER" git clone https://github.com/adourix/cowboybepob-site.git "$APP_DIR"
else
  sudo -u "$PROJECT_USER" git -C "$APP_DIR" pull --ff-only
fi

chown -R "$PROJECT_USER":"$PROJECT_USER" "$APP_DIR"

sudo -u "$PROJECT_USER" bash -lc "cd '$APP_DIR' && npm install && npm test && npm run typecheck && npm run build"

if [[ ! -f "$APP_DIR/.env" ]]; then
  echo "ERROR: $APP_DIR/.env is missing. Copy .env.example to .env and configure it before installing services."
  exit 1
fi

install -m 0644 "$APP_DIR/deploy/systemd/cowboybepob-api.service" /etc/systemd/system/cowboybepob-api.service
install -m 0644 "$APP_DIR/deploy/systemd/cowboybepob-worker.service" /etc/systemd/system/cowboybepob-worker.service

# Use conf.d so this installation is additive. Do not disable or remove the
# existing Lingo Store Nginx configuration or the default server.
install -m 0644 "$APP_DIR/deploy/nginx/cowboybepob.conf" /etc/nginx/conf.d/cowboybepob.conf

systemctl daemon-reload
nginx -t
systemctl enable cowboybepob-api cowboybepob-worker

cat <<'EOF'
Native installation prepared.

Project owner: abdulrahman
Project: /home/abdulrahman/projects/cowboybepob
Environment: /home/abdulrahman/projects/cowboybepob/.env
Customer/Admin site: http://SERVER_IP:5001
Private API: 127.0.0.1:5002

This script intentionally leaves existing Nginx server blocks untouched.
Before starting the services, make sure PostgreSQL/schema/migrations and .env are configured.
EOF
