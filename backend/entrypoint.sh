#!/usr/bin/env sh
set -eu

python - <<'PY'
import os
import time

import psycopg

dsn = os.environ.get("DATABASE_URL")
if not dsn:
    raise SystemExit("DATABASE_URL is not set")

for attempt in range(60):
    try:
        with psycopg.connect(dsn, connect_timeout=3) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1;")
        break
    except Exception as exc:  # noqa: BLE001
        print(f"[entrypoint] waiting for database ({attempt+1}/60): {exc}")
        time.sleep(1)
else:
    raise SystemExit("Database did not become available in time")
PY

python manage.py migrate --noinput
python manage.py collectstatic --noinput

python manage.py ensure_admin_user
python manage.py sync_inventory_data

exec gunicorn --bind 0.0.0.0:8000 --workers 2 kls.wsgi:application
