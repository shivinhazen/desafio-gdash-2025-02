import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import pika
import requests

OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast"
HOURLY_FIELDS = [
    "temperature_2m",
    "relativehumidity_2m",
    "precipitation_probability",
    "precipitation",
    "windspeed_10m",
    "windgusts_10m",
    "winddirection_10m",
    "pressure_msl",
    "cloudcover",
    "uv_index",
]
DAILY_FIELDS = [
    "sunrise",
    "sunset",
]
OPEN_METEO_TIMEOUT = float(os.getenv("OPEN_METEO_TIMEOUT", "20"))
OPEN_METEO_RETRIES = int(os.getenv("OPEN_METEO_RETRIES", "3"))
OPEN_METEO_RETRY_BACKOFF = float(os.getenv("OPEN_METEO_RETRY_BACKOFF_SECONDS", "5"))


def sync_range(
    city: str,
    latitude: float,
    longitude: float,
    past_days: int,
    future_days: int,
    timezone_name: str,
    broker_url: str,
    queue_name: str,
    source_label: str,
) -> None:
    """Consulta Open-Meteo para uma janela histórica/futura e publica na fila."""
    logging.info(
        "sync_range start city=%s past_days=%d future_days=%d",
        city,
        past_days,
        future_days,
    )
    try:
        data = _fetch_hourly_window(latitude, longitude, past_days, future_days, timezone_name)
    except requests.RequestException as err:
        logging.error("falha ao buscar dados da Open-Meteo: %s", err)
        return

    daily_map = _build_daily_lookup(data.get("daily", {}))
    payloads = _build_payloads(
        data,
        city=city,
        latitude=latitude,
        longitude=longitude,
        timezone_name=timezone_name,
        past_days=past_days,
        future_days=future_days,
        source_label=source_label,
        daily_lookup=daily_map,
    )
    if not payloads:
        logging.warning("sync_range não gerou payloads para city=%s", city)
        return

    try:
        _publish_payloads(broker_url, queue_name, payloads)
    except Exception as err:
        logging.error("falha ao publicar payloads na fila %s: %s", queue_name, err)
        return

    logging.info("sync_range concluiu: %d registros enviados para %s", len(payloads), queue_name)


def _fetch_hourly_window(
    latitude: float,
    longitude: float,
    past_days: int,
    future_days: int,
    timezone_name: str,
) -> Dict[str, Any]:
    params = {
        "latitude": latitude,
        "longitude": longitude,
        "past_days": past_days,
        "forecast_days": future_days,
        "timezone": timezone_name,
        "hourly": ",".join(HOURLY_FIELDS),
        "daily": ",".join(DAILY_FIELDS),
    }
    last_err: Optional[requests.RequestException] = None
    for attempt in range(1, OPEN_METEO_RETRIES + 1):
        try:
            resp = requests.get(OPEN_METEO_URL, params=params, timeout=OPEN_METEO_TIMEOUT)
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as err:
            last_err = err
            logging.warning(
                "Open-Meteo tentativa %d/%d falhou: %s",
                attempt,
                OPEN_METEO_RETRIES,
                err,
            )
            if attempt < OPEN_METEO_RETRIES:
                sleep_seconds = OPEN_METEO_RETRY_BACKOFF * attempt
                logging.info("aguardando %.1fs antes de tentar novamente", sleep_seconds)
                time.sleep(sleep_seconds)
    if last_err:
        raise last_err
    raise RuntimeError("falha desconhecida na coleta com Open-Meteo")


def _build_payloads(
    data: Dict[str, Any],
    *,
    city: str,
    latitude: float,
    longitude: float,
    timezone_name: str,
    past_days: int,
    future_days: int,
    source_label: str,
    daily_lookup: Dict[str, Dict[str, str]],
) -> List[Dict[str, Any]]:
    hourly = data.get("hourly", {}) or {}
    times = hourly.get("time") or []
    offset_seconds = int(data.get("utc_offset_seconds", 0))
    payloads: List[Dict[str, Any]] = []

    for idx, time_str in enumerate(times):
        timestamp = _format_timestamp_with_offset(time_str, offset_seconds)
        metrics = _extract_metrics(hourly, idx)
        meta = {
            "latitude": f"{latitude}",
            "longitude": f"{longitude}",
            "timezone": timezone_name,
            "past_days": str(past_days),
            "future_days": str(future_days),
        }
        day_key = timestamp.split("T")[0] if "T" in timestamp else timestamp
        daily_meta = daily_lookup.get(day_key)
        if daily_meta:
            if daily_meta.get("sunrise"):
                meta["sunrise"] = daily_meta["sunrise"]
            if daily_meta.get("sunset"):
                meta["sunset"] = daily_meta["sunset"]
        payloads.append(
            {
                "city": city,
                "timestamp": timestamp,
                "source": source_label,
                "metrics": metrics,
                "meta": meta,
            }
        )
    return payloads


def _extract_metrics(hourly: Dict[str, Any], index: int) -> Dict[str, Any]:
    def pick(key: str) -> Optional[Any]:
        values = hourly.get(key)
        if not values or index >= len(values):
            return None
        return values[index]

    metrics: Dict[str, Any] = {}
    value_map = {
        "temperature": pick("temperature_2m"),
        "humidity": pick("relativehumidity_2m"),
        "rain_chance": pick("precipitation_probability"),
        "rain_mm": pick("precipitation"),
        "wind_speed": pick("windspeed_10m"),
        "wind_gust": pick("windgusts_10m"),
        "wind_direction": pick("winddirection_10m"),
        "pressure": pick("pressure_msl"),
        "cloud_cover": pick("cloudcover"),
        "uv_index": pick("uv_index"),
    }
    for key, value in value_map.items():
        if value is not None:
            metrics[key] = value
    return metrics


def _format_timestamp_with_offset(value: str, offset_seconds: int) -> str:
    try:
        naive = datetime.fromisoformat(value)
    except ValueError:
        return value
    tz = timezone(timedelta(seconds=offset_seconds))
    aware = naive.replace(tzinfo=tz)
    return aware.isoformat()


def _publish_payloads(broker_url: str, queue_name: str, payloads: List[Dict[str, Any]]) -> None:
    params = pika.URLParameters(broker_url)
    with pika.BlockingConnection(params) as connection:
        channel = connection.channel()
        channel.queue_declare(queue=queue_name, durable=True)
        for payload in payloads:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            channel.basic_publish(
                exchange="",
                routing_key=queue_name,
                body=body,
                properties=pika.BasicProperties(content_type="application/json", delivery_mode=2),
            )
def _build_daily_lookup(daily: Dict[str, Any]) -> Dict[str, Dict[str, str]]:
    times = daily.get("time") or []
    sunrises = daily.get("sunrise") or []
    sunsets = daily.get("sunset") or []
    lookup: Dict[str, Dict[str, str]] = {}
    for idx, date_key in enumerate(times):
        entry: Dict[str, str] = {}
        if idx < len(sunrises) and sunrises[idx]:
            entry["sunrise"] = sunrises[idx]
        if idx < len(sunsets) and sunsets[idx]:
            entry["sunset"] = sunsets[idx]
        if entry:
            lookup[date_key] = entry
    return lookup
