#!/usr/bin/env bash
set -euo pipefail
APP_DIR="${APP_DIR:-/home/abdulrahman/projects/cowboybepob}"
ENV_FILE="${ENV_FILE:-$APP_DIR/.env}"
FAIL=0

check(){
  local name="$1"; shift
  if "$@" >/dev/null 2>&1; then echo "[OK]   $name"; else echo "[FAIL] $name"; FAIL=1; fi
}

[[ -d "$APP_DIR" ]] || { echo "[FAIL] app directory: $APP_DIR"; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo "[FAIL] env file: $ENV_FILE"; exit 1; }

set -a
source "$ENV_FILE"
set +a
API_PORT="${PORT:-5002}"

echo "== CowboyBepob Native Audit =="
echo "APP_DIR=$APP_DIR"
echo "PUBLIC_PORT=5001"
echo "API_PORT=$API_PORT"
echo
check "project owned by abdulrahman" bash -c "[[ \"$(stat -c '%U' '$APP_DIR')\" == 'abdulrahman' ]]"
check "node >= 20" bash -c '[[ "$(node -p "process.versions.node.split(\".\")[0]")" -ge 20 ]]'
check "npm available" command -v npm
check "psql available" command -v psql
check "postgresql active" systemctl is-active postgresql
check "nginx active" systemctl is-active nginx
check "API service active" systemctl is-active cowboybepob-api
check "worker service active" systemctl is-active cowboybepob-worker
check "API health" curl -fsS "http://127.0.0.1:${API_PORT}/health"
check "public site" curl -fsSI http://127.0.0.1:5001/
check "public health" curl -fsS http://127.0.0.1:5001/health
check "nginx config" nginx -t
check "API port listening" bash -c "ss -lnt | grep -q ':${API_PORT}'"
check "public port listening" bash -c 'ss -lnt | grep -q ":5001"'
check "database connectivity" psql "$DATABASE_URL" -c 'select 1'

cd "$APP_DIR"
echo
echo "== Typecheck =="
npm run typecheck
echo
echo "== Build =="
npm run build
echo

if [[ "$FAIL" -eq 0 ]]; then
  echo "AUDIT RESULT: PASS"
else
  echo "AUDIT RESULT: FAIL"
  exit 1
fi
