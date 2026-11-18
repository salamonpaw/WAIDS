#!/usr/bin/env python3
"""WAIDS — cron miesięczny: zrzut segmentacji za ostatni zamknięty miesiąc.

Uruchamiane wewnątrz kontenera backendu (ma dostęp do DATABASE_URL), nie na hoście:

    docker compose exec -T backend python3 cron_segmentation_snapshot.py

Wpis w /etc/cron.d instalowany przez deploy.sh (patrz sekcja "Diagnostyka + cron
segmentacji"). Idempotentne — bezpiecznie uruchomić ponownie ręcznie.
"""
from datetime import date, timedelta

from segmentation import generate_snapshot_for_month

if __name__ == "__main__":
    today = date.today()
    last_closed = date(today.year, today.month, 1) - timedelta(days=1)
    ym = last_closed.strftime("%Y-%m")
    result = generate_snapshot_for_month(ym)
    print(f"[seg-snapshot] {ym}: {result['klientow']} klientów "
          f"(okres {result['okres_od']} .. {result['okres_do']})")
