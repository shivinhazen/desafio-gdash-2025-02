#!/usr/bin/env bash
set -euo pipefail

INCLUDE_DOCKER=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --include-docker)
      INCLUDE_DOCKER=1
      ;;
    --)
      shift
      break
      ;;
    *)
      echo "Argumento desconhecido: $1" >&2
      exit 1
      ;;
  esac
  shift
done

# Padrões de processos que costumam travar o ambiente de desenvolvimento
patterns=(
  "node dist/main"
  "npm run start:prod"
)

found_host_candidate=0
container_only_detected=0

is_container_process() {
  local pid="$1"
  local cgroup_file="/proc/$pid/cgroup"

  if [[ ! -r "$cgroup_file" ]]; then
    return 1
  fi

  if grep -qiE 'docker|kubepods|containerd|podman|lxc|crio|runc' "$cgroup_file" >/dev/null 2>&1; then
    return 0
  fi

  return 1
}

drain_process() {
  local pattern="$1"
  local target_user="${SUDO_USER:-${USER:-$(id -un)}}"
  local matched=0
  local -a host_pids=()
  local -a container_entries=()
  declare -A host_users=()
  declare -A host_cmds=()
  local appended_container=0

  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    matched=1

    local user pid cmdline
    read -r user pid cmdline <<<"$line"
    [[ -z "$user" || -z "$pid" ]] && continue
    [[ ! "$pid" =~ ^[0-9]+$ ]] && continue

    # Filtra processos do host (usuário atual ou root de host) contra containers via cgroup.
    if [[ "$user" == "root" ]]; then
      if is_container_process "$pid"; then
        container_entries+=("$line")
        continue
      fi
      host_pids+=("$pid")
      host_users["$pid"]="$user"
      host_cmds["$pid"]="$cmdline"
      continue
    fi

    if [[ "$user" == "$target_user" ]]; then
      host_pids+=("$pid")
      host_users["$pid"]="$user"
      host_cmds["$pid"]="$cmdline"
    fi
  done < <(
    ps -eo user=,pid=,cmd= |
      grep -F -- "$pattern" |
      grep -v 'grep -F --' || true
  )

  if [[ $INCLUDE_DOCKER -eq 1 && ${#container_entries[@]} -gt 0 ]]; then
    appended_container=1
    echo "Incluindo processos em cgroup de container para '$pattern' por causa de --include-docker:"
    for entry in "${container_entries[@]}"; do
      local cuser cpid ccmd
      read -r cuser cpid ccmd <<<"$entry"
      printf '  PID %s (%s) %s\n' "$cpid" "$cuser" "$ccmd"
      host_pids+=("$cpid")
      host_users["$cpid"]="$cuser"
      host_cmds["$cpid"]="$ccmd"
    done
  fi

  if [[ $matched -eq 0 ]]; then
    echo "Nenhum processo correspondente a '$pattern' encontrado."
    return 0
  fi

  if [[ ${#host_pids[@]} -eq 0 ]]; then
    if [[ ${#container_entries[@]} -gt 0 ]]; then
      container_only_detected=1
      echo "Somente processos em cgroup de container foram encontrados para '$pattern'; todos serão ignorados."
      for entry in "${container_entries[@]}"; do
        local cuser cpid ccmd
        read -r cuser cpid ccmd <<<"$entry"
        printf '  Ignorando PID %s (%s) %s\n' "$cpid" "$cuser" "$ccmd"
      done
    else
      echo "Nenhum processo de host correspondente a '$pattern'."
    fi
    return 0
  fi

  found_host_candidate=1

  if [[ ${#container_entries[@]} -gt 0 && $appended_container -eq 0 ]]; then
    echo "Ignorando processos em cgroup de container para '$pattern':"
    for entry in "${container_entries[@]}"; do
      local cuser cpid ccmd
      read -r cuser cpid ccmd <<<"$entry"
      printf '  PID %s (%s) %s\n' "$cpid" "$cuser" "$ccmd"
    done
  fi

  echo "Processos de host detectados para '$pattern':"
  for pid in "${host_pids[@]}"; do
    printf '  PID %s (%s) %s\n' "$pid" "${host_users[$pid]}" "${host_cmds[$pid]}"
  done

  local -a pending=("${host_pids[@]}")
  declare -A perm_denied=()

  for attempt in {1..10}; do
    local -a next_round=()
    for pid in "${pending[@]}"; do
      [[ ! -d "/proc/$pid" ]] && continue

      local owner="${host_users[$pid]}"
      # Sem sudo, informamos a falta de permissão para processos root de host antes de seguir.
      if [[ $EUID -ne 0 && "$owner" == "root" ]]; then
        if [[ -n "${perm_denied[$pid]:-}" ]]; then
          continue
        fi
        if kill "$pid" >/dev/null 2>&1; then
          printf 'Solicitado TERM para PID %s (%s) %s\n' "$pid" "$owner" "${host_cmds[$pid]}"
        else
          printf 'Sem permissão para encerrar PID %s (%s); rode o script com sudo para forçar.\n' "$pid" "$owner" >&2
          perm_denied["$pid"]=1
        fi
        continue
      fi

      if kill "$pid" >/dev/null 2>&1; then
        printf 'Solicitado TERM para PID %s (%s) %s\n' "$pid" "$owner" "${host_cmds[$pid]}"
      else
        printf 'Falha ao mandar TERM para PID %s (%s); tentaremos novamente.\n' "$pid" "$owner" >&2
        next_round+=("$pid")
        continue
      fi
      next_round+=("$pid")
    done

    pending=()
    for pid in "${next_round[@]}"; do
      [[ -d "/proc/$pid" ]] && pending+=("$pid")
    done

    if [[ ${#pending[@]} -eq 0 ]]; then
      echo "Todos os processos de host para '$pattern' foram encerrados."
      return 0
    fi

    if [[ $attempt -lt 10 ]]; then
      sleep 1
    fi
  done

  local -a survivors=()
  for pid in "${host_pids[@]}"; do
    [[ -d "/proc/$pid" ]] && survivors+=("$pid")
  done

  if [[ ${#survivors[@]} -gt 0 ]]; then
    echo "Ainda existem processos de host para '$pattern' que não puderam ser encerrados:" >&2
    for pid in "${survivors[@]}"; do
      local owner="${host_users[$pid]}"
      local cmd="${host_cmds[$pid]}"
      if [[ -n "${perm_denied[$pid]:-}" ]]; then
        printf '  PID %s (%s) %s — falta permissão\n' "$pid" "$owner" "$cmd" >&2
      else
        printf '  PID %s (%s) %s\n' "$pid" "$owner" "$cmd" >&2
      fi
    done
    return 1
  fi

  echo "Todos os processos de host para '$pattern' foram encerrados."
  return 0
}

failures=0

for pat in "${patterns[@]}"; do
  if ! drain_process "$pat"; then
    failures=1
  fi
done

if [[ $failures -ne 0 ]]; then
  echo "Alguns processos de host permaneceram ativos. Veja os logs acima para detalhes." >&2
  exit 1
fi

if [[ $container_only_detected -eq 1 && $found_host_candidate -eq 0 ]]; then
  echo "Restaram apenas processos ligados a containers (ignorados pelo kill-host-api)."
else
  echo "Processos de API Node/npm de host finalizados com sucesso."
fi

exit 0
