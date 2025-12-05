#!/usr/bin/env bash
set -euo pipefail

SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$SCRIPT_ROOT/.."
APP_DIR="$REPO_ROOT/apps/collector-python"
ENV_FILE="$REPO_ROOT/.env"

usage() {
  cat <<'EOF'
Uso: ./scripts/run-collector.sh [seed|loop]

  seed  - roda uma janela histórica única usando sync_range
  loop  - roda sync_range em loop (dados quase em tempo real)
EOF
}

if [[ $# -ne 1 ]]; then
  usage
  exit 1
fi

MODE="$1"
case "$MODE" in
  seed|loop) ;;
  *)
    usage
    exit 1
    ;;
esac

if [[ -f "$ENV_FILE" ]]; then
  echo "[run-collector] Carregando variáveis de $ENV_FILE"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  echo "[run-collector] Aviso: .env não encontrado; prosseguindo com variáveis atuais"
fi

resolve_python() {
  if [[ -x "$REPO_ROOT/.venv/bin/python" ]]; then
    echo "$REPO_ROOT/.venv/bin/python"
    return
  fi
  if command -v python >/dev/null 2>&1; then
    echo "python"
    return
  fi
  if command -v python3 >/dev/null 2>&1; then
    echo "python3"
    return
  fi
  echo "[run-collector] Erro: não foi possível encontrar python/python3 ou .venv/bin/python" >&2
  exit 1
}

PYTHON_BIN="$(resolve_python)"

cd "$APP_DIR"
echo "[run-collector] Rodando modo '$MODE' com $PYTHON_BIN apps/collector-python/main.py"
"$PYTHON_BIN" main.py "$MODE"
