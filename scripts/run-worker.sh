#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_ROOT/../apps/worker-go"

cd "$APP_DIR"

export WORKER_RABBITMQ_URL=amqp://guest:guest@localhost:5672/
export RABBITMQ_URL=$WORKER_RABBITMQ_URL
export API_URL=http://localhost:3000/api/weather/logs

go run .
