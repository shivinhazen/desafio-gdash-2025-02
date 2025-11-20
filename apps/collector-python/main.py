"""Coletor Python para o pipeline climático."""

import json
import logging
import os
import time
from datetime import datetime, timezone

import pika
import requests


def get_env(key: str, default: str) -> str:
    return os.environ.get(key, default)


def fetch_weather(latitude: float, longitude: float) -> dict:
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "current_weather": "true",
        "hourly": "temperature_2m,relativehumidity_2m,precipitation,cloudcover",
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


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    latitude = float(get_env("COLLECTOR_LATITUDE", "-23.5505"))
    longitude = float(get_env("COLLECTOR_LONGITUDE", "-46.6333"))
    queue_name = get_env("COLLECTOR_QUEUE", "weather-logs")
    broker_url = get_env("COLLECTOR_BROKER_URL", "amqp://guest:guest@rabbitmq:5672/")
    interval = int(get_env("COLLECTOR_INTERVAL_SECONDS", "3600"))

    logging.info("Collector Python iniciado (latitude=%s longitude=%s)", latitude, longitude)

    while True:
        try:
            payload = fetch_weather(latitude, longitude)
            publish(payload, queue_name, broker_url)
            logging.info("evento publicado na fila %s (%s)", queue_name, payload["timestamp"])
        except Exception as err:
            logging.error("falha ao coletar ou publicar dados: %s", err)
        time.sleep(interval)


if __name__ == "__main__":
    main()
