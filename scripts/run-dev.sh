#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo ".env not found. Copy from .env.example and configure DEFAULT_ADMIN_EMAIL/PASSWORD." >&2
  exit 1
fi

export COMPOSE_PROJECT_NAME=gdash

echo "Starting infrastructure via Docker Compose..."
(cd infra && docker compose up --build -d)

echo "Launching frontend dev server..."
(cd apps/frontend && npm run dev -- --host 0.0.0.0 --port 4173)
