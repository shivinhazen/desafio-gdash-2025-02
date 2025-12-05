#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT_NAME=${COMPOSE_PROJECT_NAME:-gdash}
COMPOSE_FILE="infra/docker-compose.yml"

echo "Stopping Docker Compose project '${PROJECT_NAME}'..."
docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" down --remove-orphans

echo
echo "Checking remaining services for '${PROJECT_NAME}':"
ps_output="$(docker compose -p "$PROJECT_NAME" -f "$COMPOSE_FILE" ps --all)"
echo "$ps_output"

if [[ "$(echo "$ps_output" | wc -l)" -le 1 ]]; then
  echo "All gdash containers have been stopped successfully."
else
  echo "Some containers are still running (listed above)."
fi
