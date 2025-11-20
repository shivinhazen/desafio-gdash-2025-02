#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_ROOT/../apps/collector-python"

cd "$APP_DIR"

# cria o virtualenv se não existir
if [[ ! -d ".venv" ]]; then
  python3 -m venv .venv
fi

source .venv/bin/activate

pip install -r requirements.txt

# usa RabbitMQ exposto pelo Docker Desktop
export COLLECTOR_BROKER_URL=${COLLECTOR_BROKER_URL:-amqp://guest:guest@localhost:5672/}

python main.py
