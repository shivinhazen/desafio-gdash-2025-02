#!/usr/bin/env python3
import argparse
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

import requests


def get_env(key: str, fallback: str) -> str:
    return os.environ.get(key, fallback)


def parse_date(value: str) -> datetime:
    return datetime.fromisoformat(value)


def build_archive_payloads(
    latitude: float,
    longitude: float,
    start_date: str,
    end_date: str,
    timezone_str: str,
) -> List[Dict[str, Any]]:
    url = "https://api.open-meteo.com/v1/archive"
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "start_date": start_date,
        "end_date": end_date,
        "hourly": "temperature_2m,relativehumidity_2m,precipitation,cloudcover,windspeed_10m,uv_index,weathercode",
        "daily": "sunrise,sunset,precipitation_sum,windspeed_10m_max",
        "timezone": timezone_str,
    }
    resp = requests.get(url, params=params, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    hourly = data.get("hourly", {})
    daily = data.get("daily", {})
    day_info = {
        day: {
            "sunrise": sunrise,
            "sunset": sunset,
            "precipitation_sum": precipitation,
            "windspeed_10m_max": max_wind,
        }
        for day, sunrise, sunset, precipitation, max_wind in zip(
            daily.get("time", []),
            daily.get("sunrise", []),
            daily.get("sunset", []),
            daily.get("precipitation_sum", []),
            daily.get("windspeed_10m_max", []),
        )
    }

    timestamps = hourly.get("time", [])
    payloads: List[Dict[str, Any]] = []
    for idx, iso in enumerate(timestamps):
        day_key = iso.split("T")[0]
        metrics = {
            "temperature": hourly.get("temperature_2m", [None])[idx],
            "humidity": hourly.get("relativehumidity_2m", [None])[idx],
            "rain": hourly.get("precipitation", [None])[idx],
            "clouds": hourly.get("cloudcover", [None])[idx],
            "wind_speed": hourly.get("windspeed_10m", [None])[idx],
            "uv_index": hourly.get("uv_index", [None])[idx],
            "weather_code": hourly.get("weathercode", [None])[idx],
        }
        meta = {
            "source": "open-meteo-archive",
            "latitude": str(latitude),
            "longitude": str(longitude),
        }
        if day_key in day_info:
            meta.update(
                {
                    "sunrise": day_info[day_key]["sunrise"],
                    "sunset": day_info[day_key]["sunset"],
                    "daily_precipitation": day_info[day_key]["precipitation_sum"],
                    "daily_max_wind": day_info[day_key]["windspeed_10m_max"],
                }
            )
        payloads.append(
            {
                "city": get_env("COLLECTOR_CITY", "Localidade"),
                "timestamp": iso,
                "source": "open-meteo-archive",
                "metrics": metrics,
                "meta": meta,
            }
        )
    return payloads


def login(api_base: str, email: str, password: str) -> str:
    url = f"{api_base.rstrip('/')}/api/auth/login"
    resp = requests.post(url, json={"email": email, "password": password}, timeout=10)
    resp.raise_for_status()
    data = resp.json()
    return data["access_token"]


def post_payload(api_url: str, token: str, payload: Dict[str, Any]) -> None:
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    resp = requests.post(api_url, json=payload, headers=headers, timeout=10)
    resp.raise_for_status()


def main() -> None:
    parser = argparse.ArgumentParser(description="Ingest Open-Meteo archive into GDASH API")
    parser.add_argument(
        "--days",
        type=int,
        default=int(get_env("ARCHIVE_DAYS", "7")),
        help="Number of past days to import (default from ARCHIVE_DAYS)",
    )
    parser.add_argument(
        "--api-url",
        default=get_env("API_URL", "http://localhost:3000/api/weather/logs"),
        help="GDASH weather logs endpoint",
    )
    parser.add_argument(
        "--start-date",
        help="Override start date (YYYY-MM-DD)",
    )
    parser.add_argument(
        "--end-date",
        help="Override end date (YYYY-MM-DD)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Fetch archive but do not POST to API",
    )
    args = parser.parse_args()

    latitude = float(get_env("COLLECTOR_LATITUDE", "-23.5505"))
    longitude = float(get_env("COLLECTOR_LONGITUDE", "-46.6333"))
    timezone_str = get_env("COLLECTOR_TIMEZONE", "auto")
    email = get_env("DEFAULT_ADMIN_EMAIL", "admin@example.com")
    password = get_env("DEFAULT_ADMIN_PASSWORD", "123456")
    api_base = get_env("API_URL", "http://localhost:3000")

    end_date = args.end_date or datetime.now(timezone.utc).date().isoformat()
    if args.start_date:
        start_date = args.start_date
    else:
        days_delta = timedelta(days=args.days)
        start_date = (datetime.now(timezone.utc).date() - days_delta).isoformat()

    print(f"Importando archive Open-Meteo de {start_date} até {end_date}")
    payloads = build_archive_payloads(latitude, longitude, start_date, end_date, timezone_str)
    print(f"Total de registros a importar: {len(payloads)}")

    token = login(api_base, email, password)
    errors = 0
    for idx, payload in enumerate(payloads, start=1):
        if args.dry_run:
            print(f"[dry-run] #{idx} -> {payload['timestamp']}")
            continue
        try:
            post_payload(args.api_url, token, payload)
            print(f"[{idx}/{len(payloads)}] {payload['timestamp']} enviado")
        except requests.HTTPError as err:
            errors += 1
            print(f"[erro] falha ao enviar {payload['timestamp']}: {err.response.status_code}")
        except Exception as err:
            errors += 1
            print(f"[erro] falha ao enviar {payload['timestamp']}: {err}")

    if errors:
        print(f"Import concluída com {errors} erros.")
    else:
        print("Import concluída com sucesso.")


if __name__ == "__main__":
    main()
