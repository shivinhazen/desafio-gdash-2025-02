"""Coletor Python para o pipeline clim?tico."""

import argparse
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import pika
import requests

from sync_range import sync_range


def get_env(key: str, default: str) -> str:
    return os.environ.get(key, default)


def fetch_weather(latitude: float, longitude: float) -> dict:
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "current_weather": "true",
        "hourly": (
            "temperature_2m,relativehumidity_2m,precipitation,cloudcover,"
            "wind_speed_10m,uv_index,sunshine_duration,"
            "shortwave_radiation,direct_radiation,diffuse_radiation,"
            "direct_normal_irradiance,global_tilted_irradiance,"
            "soil_temperature_0_to_7cm,soil_temperature_7_to_28cm,"
            "soil_temperature_28_to_100cm,soil_temperature_100_to_255cm,"
            "soil_moisture_0_to_7cm,soil_moisture_7_to_28cm,"
            "soil_moisture_28_to_100cm,soil_moisture_100_to_255cm"
        ),
        "timezone": "auto",
    }
    resp = requests.get("https://api.open-meteo.com/v1/forecast", params=params, timeout=10)
    resp.raise_for_status()
    data = resp.json()

    payload = {
        "city": get_env("COLLECTOR_CITY", "Localidade"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "source": "open-meteo",
        "metrics": {
            "temperature": data.get("current_weather", {}).get("temperature"),
            "wind_speed": data.get("current_weather", {}).get("windspeed"),
            "weather_code": data.get("current_weather", {}).get("weathercode"),
            "humidity": data.get("hourly", {}).get("relativehumidity_2m", [None])[0],
            "rain": data.get("hourly", {}).get("precipitation", [0])[0],
            "clouds": data.get("hourly", {}).get("cloudcover", [0])[0],
            "uv_index": data.get("hourly", {}).get("uv_index", [None])[0],
            "sunshine_duration": data.get("hourly", {}).get("sunshine_duration", [None])[0],
            "shortwave_radiation": data.get("hourly", {}).get("shortwave_radiation", [None])[0],
            "direct_radiation": data.get("hourly", {}).get("direct_radiation", [None])[0],
            "diffuse_radiation": data.get("hourly", {}).get("diffuse_radiation", [None])[0],
            "direct_normal_irradiance": data.get("hourly", {}).get("direct_normal_irradiance", [None])[0],
            "global_tilted_irradiance": data.get("hourly", {}).get("global_tilted_irradiance", [None])[0],
            "soil_temperature_0_to_7cm": data.get("hourly", {}).get("soil_temperature_0_to_7cm", [None])[0],
            "soil_temperature_7_to_28cm": data.get("hourly", {}).get("soil_temperature_7_to_28cm", [None])[0],
            "soil_temperature_28_to_100cm": data.get("hourly", {}).get("soil_temperature_28_to_100cm", [None])[0],
            "soil_temperature_100_to_255cm": data.get("hourly", {}).get("soil_temperature_100_to_255cm", [None])[0],
            "soil_moisture_0_to_7cm": data.get("hourly", {}).get("soil_moisture_0_to_7cm", [None])[0],
            "soil_moisture_7_to_28cm": data.get("hourly", {}).get("soil_moisture_7_to_28cm", [None])[0],
            "soil_moisture_28_to_100cm": data.get("hourly", {}).get("soil_moisture_28_to_100cm", [None])[0],
            "soil_moisture_100_to_255cm": data.get("hourly", {}).get("soil_moisture_100_to_255cm", [None])[0],
        },
        "meta": {
            "latitude": str(latitude),
            "longitude": str(longitude),
        },
    }
    return payload


def publish(payload: dict, queue: str, broker_url: str) -> None:
    params = pika.URLParameters(broker_url)
    with pika.BlockingConnection(params) as connection:
        channel = connection.channel()
        channel.queue_declare(queue=queue, durable=True)
        channel.basic_publish(
            exchange="",
            routing_key=queue,
            body=json.dumps(payload).encode("utf-8"),
            properties=pika.BasicProperties(content_type="application/json", delivery_mode=2),
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="GDASH weather collector CLI")
    subparsers = parser.add_subparsers(dest="command")
    subparsers.add_parser("seed", help="Executa sync_range para seed (30 dias + 1 dia futuro)")
    subparsers.add_parser("loop", help="Executa sync_range periodicamente")
    subparsers.add_parser("legacy", help="Executa o loop original do collector")
    return parser.parse_args()


def legacy_loop() -> None:
    latitude = float(get_env("COLLECTOR_LATITUDE", "-23.5505"))
    longitude = float(get_env("COLLECTOR_LONGITUDE", "-46.6333"))
    queue_name = get_env("COLLECTOR_QUEUE", "weather-logs")
    broker_url = get_env("COLLECTOR_BROKER_URL", "amqp://guest:guest@rabbitmq:5672/")
    interval = int(get_env("COLLECTOR_INTERVAL_SECONDS", "3600"))

    logging.info("Collector Python legado iniciado (latitude=%s longitude=%s)", latitude, longitude)

    while True:
        try:
            payload = fetch_weather(latitude, longitude)
            publish(payload, queue_name, broker_url)
            logging.info("evento publicado na fila %s (%s)", queue_name, payload["timestamp"])
        except Exception as err:
            logging.error("falha ao coletar ou publicar dados: %s", err)
        time.sleep(interval)


def _env_with_fallback(primary: str, fallback: Optional[str], default: str) -> str:
    value = os.getenv(primary)
    if value:
        return value
    if fallback:
        fallback_value = os.getenv(fallback)
        if fallback_value:
            return fallback_value
    return default


def _read_sync_config(mode: str) -> Dict[str, Any]:
    city = _env_with_fallback("SYNC_CITY", "COLLECTOR_CITY", "Localidade")
    latitude = float(_env_with_fallback("SYNC_LATITUDE", "COLLECTOR_LATITUDE", "-23.5505"))
    longitude = float(_env_with_fallback("SYNC_LONGITUDE", "COLLECTOR_LONGITUDE", "-46.6333"))
    timezone_name = _env_with_fallback("SYNC_TIMEZONE", None, "America/Sao_Paulo")
    broker_url = _env_with_fallback("SYNC_BROKER_URL", "COLLECTOR_BROKER_URL", "amqp://guest:guest@rabbitmq:5672/")
    queue_name = _env_with_fallback("SYNC_QUEUE", "COLLECTOR_QUEUE", "weather-logs")
    source_label = _env_with_fallback("SYNC_SOURCE_LABEL", None, "open-meteo-sync")

    if mode == "seed":
        past_days = int(os.getenv("SYNC_PAST_DAYS_SEED", "30"))
        future_days = int(os.getenv("SYNC_FUTURE_DAYS_SEED", "1"))
    else:
        past_days = int(os.getenv("SYNC_PAST_DAYS_LOOP", "2"))
        future_days = int(os.getenv("SYNC_FUTURE_DAYS_LOOP", "1"))

    config: Dict[str, Any] = {
        "city": city,
        "latitude": latitude,
        "longitude": longitude,
        "past_days": past_days,
        "future_days": future_days,
        "timezone_name": timezone_name,
        "broker_url": broker_url,
        "queue_name": queue_name,
        "source_label": source_label,
    }
    if mode == "loop":
        config["interval"] = int(os.getenv("SYNC_LOOP_INTERVAL_SECONDS", "900"))
    return config


def run_seed() -> None:
    config = _read_sync_config("seed")
    logging.info("Iniciando sync seed (past_days=%d future_days=%d)", config["past_days"], config["future_days"])
    sync_range(**config)


def run_loop() -> None:
    config = _read_sync_config("loop")
    interval = config.pop("interval")
    logging.info("Iniciando sync loop (past_days=%d future_days=%d interval=%ds)", config["past_days"], config["future_days"], interval)
    while True:
        sync_range(**config)
        time.sleep(interval)


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    args = parse_args()
    if args.command == "seed":
        run_seed()
    elif args.command == "loop":
        run_loop()
    elif args.command == "legacy":
        legacy_loop()
    else:
        logging.info("Nenhum comando especificado; executando loop legado.")
        legacy_loop()


if __name__ == "__main__":
    main()
