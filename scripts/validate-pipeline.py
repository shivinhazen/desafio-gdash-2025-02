#!/usr/bin/env python3
import json
import os
import sys
from pathlib import Path
from typing import Optional
from urllib import request, error
from datetime import datetime, timezone

def load_env(env_path: Path) -> dict:
    data = {}
    if not env_path.exists():
        return data
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if '=' in line:
            key, value = line.split('=', 1)
            data[key.strip()] = value.strip()
    return data

env = load_env(Path(__file__).resolve().parent.parent / '.env')
api_base = env.get('API_URL', 'http://localhost:3000').rstrip('/')
login_url = f"{api_base}/api/auth/login"

email = env.get('DEFAULT_ADMIN_EMAIL', 'admin@example.com')
password = env.get('DEFAULT_ADMIN_PASSWORD', '123456')

headers = {'Content-Type': 'application/json'}

print('Validando pipeline com API:', login_url)

payload = json.dumps({'email': email, 'password': password}).encode('utf-8')
req = request.Request(login_url, data=payload, headers=headers, method='POST')
try:
    resp = request.urlopen(req)
    body = resp.read()
    token = json.loads(body.decode('utf-8')).get('access_token')
except error.HTTPError as err:
    print('Login falhou:', err.code, err.reason)
    print(err.read().decode('utf-8'))
    sys.exit(1)
except Exception as err:
    print('Erro ao chamar login:', err)
    sys.exit(1)

if not token:
    print('Login retornou 200 mas sem token.')
    sys.exit(1)

print('Access token recebido. Validando endpoints protegidos...')

def call(path: str, expect_text: bool = False, stream: bool = False):
    url = f"{api_base}/api/{path}"
    req = request.Request(url, headers={'Authorization': f'Bearer {token}'})
    try:
        resp = request.urlopen(req)
        data = resp.read() if expect_text or stream else resp.read()
        return resp.status, data
    except error.HTTPError as err:
        return err.code, err.read()

status_logs, data_logs = call('weather/logs?limit=5')
print(f"GET /weather/logs -> {status_logs}")
if status_logs == 200:
    try:
        logs = json.loads(data_logs.decode('utf-8'))
        print('  registros obtidos:', logs.get('total', 0))
        items = logs.get('items', [])
        if items:
            latest = items[0]
            ts = latest.get('timestamp')
            if ts:
                dt = datetime.fromisoformat(ts.replace('Z', '+00:00'))
                diff = datetime.now(timezone.utc) - dt
                minutes = diff.total_seconds() / 60
                status_line = 'OK'
                if minutes > 20:
                    status_line = 'ATENÇÃO: sem logs há mais de 20 min'
                elif minutes > 5:
                    status_line = 'Aviso: último log há mais de 5 min'
                print(f'  último log: {ts} ({minutes:.1f} min atrás) — {status_line}')
    except Exception:
        print('  não foi possível parsear logs')
else:
    print('  erro:', data_logs.decode('utf-8', errors='ignore'))

status_ins, data_ins = call('weather/insights')
print(f"GET /weather/insights -> {status_ins}")
if status_ins == 200:
    payload = json.loads(data_ins.decode('utf-8'))
    print('  insights:', payload)
else:
    print('  erro:', data_ins.decode('utf-8', errors='ignore'))

status_csv, _ = call('weather/export.csv', expect_text=True)
print(f"GET /weather/export.csv -> {status_csv}")
status_xlsx, _ = call('weather/export.xlsx', stream=True)
print(f"GET /weather/export.xlsx -> {status_xlsx}")
