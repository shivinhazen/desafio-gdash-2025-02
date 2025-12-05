#!/usr/bin/env python3
"""Loader local que também registra sunrise/sunset no meta."""

import argparse
import csv
from pathlib import Path

from loader_common import (
    build_daily_meta,
    build_payload,
    find_time_header_index,
    load_env,
    login,
    parse_timestamp,
    post_payload,
)


def main():
    parser = argparse.ArgumentParser(description="Carrega CSV Open-Meteo local para a API GDASH")
    parser.add_argument(
        "--csv-path",
        "-f",
        dest="csv_path",
        type=str,
        default="docs/open-meteo-22.75S41.88W5m.csv",
        help="Caminho local do CSV Open-Meteo mais recente",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Não envia nada à API, apenas imprime resumo",
    )
    args = parser.parse_args()

    env = load_env(Path(__file__).resolve().parent.parent / ".env")
    api_base = env.get("API_URL", "http://localhost:3000")
    email = env.get("DEFAULT_ADMIN_EMAIL", "admin@example.com")
    password = env.get("DEFAULT_ADMIN_PASSWORD", "123456")
    city = env.get("COLLECTOR_CITY", "Localidade")

    token = None
    if not args.dry_run:
        token = login(api_base, email, password)
    source_label = "open-meteo-local"
    path = Path(args.csv_path)
    if not path.exists():
        raise FileNotFoundError(path)

    with path.open(newline="") as fh:
        lines = fh.readlines()
    lines = [line.rstrip("\n") for line in lines]
    daily_meta = build_daily_meta(lines)
    header_idx = find_time_header_index(lines)
    header_line = lines[header_idx].strip()
    data_lines = lines[header_idx + 1 :]
    reader = csv.DictReader(data_lines, fieldnames=[h.strip() for h in header_line.split(",")])

    total_rows = 0
    valid_hourly_rows = 0
    metrics_total = 0
    first_ts = None
    last_ts = None
    for row in reader:
        total_rows += 1
        raw_time = row.get("time") or ""
        normalized_time = raw_time.strip()
        if not normalized_time or "T" not in normalized_time:
            continue
        row["time"] = normalized_time
        valid_hourly_rows += 1
        payload = build_payload(row, city, source_label, daily_meta)
        if args.dry_run:
            metrics_total += len(payload["metrics"])
            parsed = parse_timestamp(payload["timestamp"])
            if parsed:
                if first_ts is None or parsed < first_ts:
                    first_ts = parsed
            if last_ts is None or parsed > last_ts:
                last_ts = parsed
            continue
        try:
            post_payload(api_base, token, payload)
            print(f"[enviado] {payload['timestamp']}")
        except Exception as err:
            print(f"[erro] falha ao enviar {payload['timestamp']}: {err}")

    if args.dry_run:
        print(f"Total de linhas lidas: {total_rows}")
        print(f"Registros válidos: {valid_hourly_rows}")
        print(f"Total de métricas extraídas: {metrics_total}")
        if first_ts:
            print(f"Primeiro timestamp: {first_ts.isoformat()}")
        if last_ts:
            print(f"Último timestamp: {last_ts.isoformat()}")
    else:
        print("Importação concluída.")


if __name__ == "__main__":
    main()
