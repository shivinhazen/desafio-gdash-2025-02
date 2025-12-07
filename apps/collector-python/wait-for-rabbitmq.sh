#!/usr/bin/env bash
set -euo pipefail

HOST=""
PORT="5672"

# Derive host from SYNC_BROKER_URL or COLLECTOR_BROKER_URL; default to rabbitmq.
resolve_host() {
  local url="${SYNC_BROKER_URL:-${COLLECTOR_BROKER_URL:-}}"
  if [[ -n "$url" ]]; then
    # Use Python to parse the host part robustly.
    HOST="$(python - <<'PY'
import os
from urllib.parse import urlparse
url = os.environ.get("SYNC_BROKER_URL") or os.environ.get("COLLECTOR_BROKER_URL") or ""
parsed = urlparse(url)
host = parsed.hostname or ""
port = parsed.port or 5672
print(f"{host}:{port}")
PY
)"
    PORT="${HOST#*:}"
    HOST="${HOST%%:*}"
  fi
  if [[ -z "$HOST" ]]; then
    HOST="rabbitmq"
    PORT="5672"
  fi
}

resolve_host

echo "[wait-for-rabbitmq] Waiting for RabbitMQ at ${HOST}:${PORT}..."

for attempt in $(seq 1 30); do
  if python - "$HOST" "$PORT" <<'PY'
import socket, sys
host = sys.argv[1]
port = int(sys.argv[2])
with socket.socket() as s:
    s.settimeout(2)
    err = s.connect_ex((host, port))
    if err == 0:
        sys.exit(0)
sys.exit(1)
PY
  then
    echo "[wait-for-rabbitmq] RabbitMQ is up (attempt ${attempt})"
    exec "$@"
  fi
  echo "[wait-for-rabbitmq] RabbitMQ not ready yet (attempt ${attempt}), retrying in 2s..."
  sleep 2
done

echo "[wait-for-rabbitmq] Timeout waiting for RabbitMQ at ${HOST}:${PORT}" >&2
exit 1
