"""Shared helpers for Open-Meteo CSV loaders."""

import csv
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

import requests

METRIC_FIELD_MAP: Dict[str, str] = {
    "temperature_2m (°C)": "temperature",
    "apparent_temperature (°C)": "apparent_temperature",
    "dew_point_2m (°C)": "dew_point",
    "wet_bulb_temperature_2m (°C)": "wet_bulb_temperature_2m",
    "relative_humidity_2m (%)": "humidity",
    "precipitation (mm)": "precipitation",
    "precipitation_probability (%)": "precipitation_probability",
    "precipitation_spread (mm)": "precipitation_spread",
    "rain (mm)": "rain",
    "showers (mm)": "showers",
    "snowfall (cm)": "snowfall",
    "snow_depth (m)": "snow_depth",
    "pressure_msl (hPa)": "pressure_msl",
    "surface_pressure (hPa)": "surface_pressure",
    "cloud_cover (%)": "cloud_cover",
    "cloud_cover_low (%)": "cloud_cover_low",
    "cloud_cover_mid (%)": "cloud_cover_mid",
    "cloud_cover_high (%)": "cloud_cover_high",
    "visibility (m)": "visibility",
    "cape (J/kg)": "cape",
    "convective_inhibition (J/kg)": "convective_inhibition",
    "shortwave_radiation (W/m²)": "shortwave_radiation",
    "shortwave_radiation_instant (W/m²)": "shortwave_radiation_instant",
    "direct_radiation (W/m²)": "direct_radiation",
    "direct_radiation_instant (W/m²)": "direct_radiation_instant",
    "diffuse_radiation (W/m²)": "diffuse_radiation",
    "diffuse_radiation_instant (W/m²)": "diffuse_radiation_instant",
    "direct_normal_irradiance (W/m²)": "direct_normal_irradiance",
    "direct_normal_irradiance_instant (W/m²)": "direct_normal_irradiance_instant",
    "global_tilted_irradiance (W/m²)": "global_tilted_irradiance",
    "global_tilted_irradiance_instant (W/m²)": "global_tilted_irradiance_instant",
    "terrestrial_radiation (W/m²)": "terrestrial_radiation",
    "terrestrial_radiation_instant (W/m²)": "terrestrial_radiation_instant",
    "sunshine_duration (s)": "sunshine_duration",
    "evapotranspiration (mm)": "evapotranspiration",
    "total_column_integrated_water_vapour (kg/m²)": "total_column_water_vapour",
    "soil_moisture_0_to_1cm (m³/m³)": "soil_moisture_0_to_1cm",
    "soil_moisture_1_to_3cm (m³/m³)": "soil_moisture_1_to_3cm",
    "soil_moisture_3_to_9cm (m³/m³)": "soil_moisture_3_to_9cm",
    "soil_moisture_9_to_27cm (m³/m³)": "soil_moisture_9_to_27cm",
    "soil_temperature_0cm (°C)": "soil_temperature_0cm",
    "soil_temperature_6cm (°C)": "soil_temperature_6cm",
    "soil_temperature_18cm (°C)": "soil_temperature_18cm",
    "soil_temperature_54cm (°C)": "soil_temperature_54cm",
    "uv_index ()": "uv_index",
    "uv_index_clear_sky ()": "uv_index_clear_sky",
    "weather_code (wmo code)": "weather_code",
    "is_day ()": "is_day",
    "wind_speed_10m (km/h)": "wind_speed_10m",
    "wind_speed_80m (km/h)": "wind_speed_80m",
    "wind_speed_120m (km/h)": "wind_speed_120m",
    "wind_speed_180m (km/h)": "wind_speed_180m",
    "wind_gusts_10m (km/h)": "wind_gusts_10m",
    "wind_direction_10m (°)": "wind_direction_10m",
    "wind_direction_80m (°)": "wind_direction_80m",
    "wind_direction_120m (°)": "wind_direction_120m",
    "wind_direction_180m (°)": "wind_direction_180m",
    "temperature_2m_spread (K)": "temperature_spread",
    "wind_speed_10m_spread (km/h)": "wind_speed_10m_spread",
    "wind_direction_10m_spread (°)": "wind_direction_10m_spread",
}

PHYSICAL_LIMITS: Dict[str, tuple[float, float]] = {
    "temperature": (-10.0, 50.0),
    "apparent_temperature": (-30.0, 60.0),
    "dew_point": (-30.0, 40.0),
    "wet_bulb_temperature_2m": (-30.0, 40.0),
    "humidity": (0.0, 100.0),
    "cloud_cover": (0.0, 100.0),
    "cloud_cover_low": (0.0, 100.0),
    "cloud_cover_mid": (0.0, 100.0),
    "cloud_cover_high": (0.0, 100.0),
    "precipitation": (0.0, 500.0),
    "precipitation_spread": (0.0, 500.0),
    "rain": (0.0, 500.0),
    "showers": (0.0, 500.0),
    "snowfall": (0.0, 1000.0),
    "snow_depth": (0.0, 20.0),
    "pressure_msl": (800.0, 1100.0),
    "surface_pressure": (800.0, 1100.0),
    "visibility": (0.0, 200_000.0),
    "cape": (0.0, 10_000.0),
    "convective_inhibition": (-10_000.0, 0.0),
    "shortwave_radiation": (0.0, 2000.0),
    "shortwave_radiation_instant": (0.0, 2000.0),
    "direct_radiation": (0.0, 2000.0),
    "direct_radiation_instant": (0.0, 2000.0),
    "diffuse_radiation": (0.0, 2000.0),
    "diffuse_radiation_instant": (0.0, 2000.0),
    "direct_normal_irradiance": (0.0, 2000.0),
    "direct_normal_irradiance_instant": (0.0, 2000.0),
    "global_tilted_irradiance": (0.0, 2000.0),
    "global_tilted_irradiance_instant": (0.0, 2000.0),
    "terrestrial_radiation": (0.0, 2000.0),
    "terrestrial_radiation_instant": (0.0, 2000.0),
    "soil_moisture_0_to_1cm": (0.0, 1.0),
    "soil_moisture_1_to_3cm": (0.0, 1.0),
    "soil_moisture_3_to_9cm": (0.0, 1.0),
    "soil_moisture_9_to_27cm": (0.0, 1.0),
    "soil_temperature_0cm": (-20.0, 60.0),
    "soil_temperature_6cm": (-20.0, 60.0),
    "soil_temperature_18cm": (-20.0, 60.0),
    "soil_temperature_54cm": (-20.0, 60.0),
    "uv_index": (0.0, 20.0),
    "uv_index_clear_sky": (0.0, 20.0),
    "wind_speed_10m": (0.0, 200.0),
    "wind_speed_80m": (0.0, 200.0),
    "wind_speed_120m": (0.0, 200.0),
    "wind_speed_180m": (0.0, 200.0),
    "wind_gusts_10m": (0.0, 250.0),
    "wind_direction_10m": (0.0, 360.0),
    "wind_direction_80m": (0.0, 360.0),
    "wind_direction_120m": (0.0, 360.0),
    "wind_direction_180m": (0.0, 360.0),
    "temperature_spread": (0.0, 50.0),
    "wind_speed_10m_spread": (0.0, 200.0),
    "wind_direction_10m_spread": (0.0, 360.0),
}

SANITIZATION_COUNTER = Counter()


def load_env(env_path: Path) -> Dict[str, str]:
    if not env_path.exists():
        return {}
    data: Dict[str, str] = {}
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        data[key.strip()] = value.strip()
    return data


def float_or_none(value: str):
    if value is None:
        return None
    value = value.strip()
    if value == "" or value.lower() == "nan":
        return None
    try:
        return float(value)
    except ValueError:
        return None


def sanitize_metric(metric_key: str, value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    bounds = PHYSICAL_LIMITS.get(metric_key)
    if not bounds:
        return value
    low, high = bounds
    if low <= value <= high:
        return value
    SANITIZATION_COUNTER[metric_key] += 1
    return None


def build_payload(row: Dict[str, str], city: str, source: str, daily_meta: Dict[str, Dict[str, str]]):
    metrics: Dict[str, float] = {}
    for csv_field, metric_key in METRIC_FIELD_MAP.items():
        raw_value = row.get(csv_field)
        if raw_value is None:
            continue
        numeric = float_or_none(raw_value)
        sanitized = sanitize_metric(metric_key, numeric)
        if sanitized is not None:
            metrics[metric_key] = sanitized
    meta = {
        "source_file": source,
        "timezone": row.get("timezone", "unknown"),
    }
    timestamp = row.get("time", "")
    date_key = timestamp.split("T")[0] if "T" in timestamp else timestamp
    daily = daily_meta.get(date_key)
    if daily:
        if daily.get("sunrise"):
            meta["sunrise"] = daily["sunrise"]
        if daily.get("sunset"):
            meta["sunset"] = daily["sunset"]
    return {
        "city": city,
        "timestamp": timestamp,
        "source": source,
        "metrics": metrics,
        "meta": meta,
    }


def parse_timestamp(value: str):
    if not value:
        return None
    normalized = value.strip()
    if normalized.endswith("Z"):
        normalized = normalized[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None


def build_daily_meta(lines: list[str]) -> Dict[str, Dict[str, str]]:
    for idx, line in enumerate(lines):
        stripped = line.strip()
        if not stripped.startswith("time,"):
            continue
        lower = stripped.lower()
        if "sunrise" not in lower or "sunset" not in lower:
            continue
        header_fields = [field.strip() for field in stripped.split(",")]
        sunrise_key = next((field for field in header_fields if "sunrise" in field.lower()), None)
        sunset_key = next((field for field in header_fields if "sunset" in field.lower()), None)
        if not sunrise_key or not sunset_key:
            continue
        daily: Dict[str, Dict[str, str]] = {}
        for row_line in lines[idx + 1:]:
            if not row_line.strip():
                break
            values = next(csv.reader([row_line]))
            if len(values) != len(header_fields):
                continue
            row = dict(zip(header_fields, values))
            time_val = (row.get("time") or "").strip()
            if not time_val:
                continue
            date_key = time_val.split("T")[0]
            entry: Dict[str, str] = {}
            sunrise_val = (row.get(sunrise_key) or "").strip()
            sunset_val = (row.get(sunset_key) or "").strip()
            if sunrise_val:
                entry["sunrise"] = sunrise_val
            if sunset_val:
                entry["sunset"] = sunset_val
            if entry:
                daily[date_key] = entry
        return daily
    return {}


def find_time_header_index(lines: list[str]) -> int:
    for idx, line in enumerate(lines):
        if line.strip().startswith("time,"):
            return idx
    raise RuntimeError("Cabeçalho com 'time,' não encontrado no CSV")


def resolve_api_url(api_base: str) -> str:
    if "://api:" in api_base:
        return api_base.replace("://api:", "://localhost:", 1)
    return api_base


def login(api_base: str, email: str, password: str) -> str:
    base = resolve_api_url(api_base)
    url = f"{base.rstrip('/')}/api/auth/login"
    resp = requests.post(url, json={"email": email, "password": password}, timeout=10)
    resp.raise_for_status()
    return resp.json()["access_token"]


def post_payload(api_base: str, token: str, payload: Dict):
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    url = f"{resolve_api_url(api_base).rstrip('/')}/api/weather/logs"
    resp = requests.post(url, json=payload, headers=headers, timeout=10)
    resp.raise_for_status()
