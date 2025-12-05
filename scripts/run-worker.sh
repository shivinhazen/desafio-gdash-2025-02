#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_ROOT/.."
ENV_FILE="$REPO_ROOT/.env"

cd "$REPO_ROOT"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${DEFAULT_ADMIN_EMAIL:=admin@example.com}"
: "${DEFAULT_ADMIN_PASSWORD:=123456}"
export API_AUTH_EMAIL="${API_AUTH_EMAIL:-$DEFAULT_ADMIN_EMAIL}"
export API_AUTH_PASSWORD="${API_AUTH_PASSWORD:-$DEFAULT_ADMIN_PASSWORD}"

export WORKER_API_URL="${WORKER_API_URL:-http://localhost:3000/api/weather/logs}"
export WORKER_RABBITMQ_URL="${WORKER_RABBITMQ_URL:-amqp://guest:guest@localhost:5672/}"
export WORKER_QUEUE="${WORKER_QUEUE:-weather-logs}"

export API_URL="$WORKER_API_URL"
export RABBITMQ_URL="$WORKER_RABBITMQ_URL"
export WEATHER_QUEUE="$WORKER_QUEUE"

echo "[run-worker] API_URL=$WORKER_API_URL"
echo "[run-worker] RabbitMQ=$WORKER_RABBITMQ_URL queue=$WORKER_QUEUE"

cd "$REPO_ROOT/apps/worker-go"
exec go run .
