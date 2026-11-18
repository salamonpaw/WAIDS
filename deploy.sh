#!/bin/bash
# WAIDS — skrypt wdrożenia
# Użycie: sudo ./deploy.sh
# Dane w bazie NIE są kasowane (volume waids_pgdata persystentny).
#
# Całość jest w funkcji main() — bash parsuje cały plik przed wykonaniem, więc
# `git pull` nadpisujący ten skrypt w trakcie działania nie psuje bieżącego przebiegu.
# Jeśli pull zmienił deploy.sh, skrypt uruchamia się ponownie w nowej wersji.

main() {
set -e
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_DIR="/var/www/waids"
REAL_USER="${SUDO_USER:-$USER}"
cd "$APP_DIR"

if [ "$1" != "--pulled" ]; then
  echo "=== WAIDS deploy: $(date '+%Y-%m-%d %H:%M:%S') ==="
  # 1. Pobierz najnowszy kod (jako oryginalny użytkownik, nie root)
  echo "[1/5] git pull..."
  BEFORE="$(sha256sum "$APP_DIR/deploy.sh")"
  sudo -u "$REAL_USER" git pull
  if [ "$(sha256sum "$APP_DIR/deploy.sh")" != "$BEFORE" ]; then
    echo "      deploy.sh zmieniony — uruchamiam nową wersję"
    exec "$APP_DIR/deploy.sh" --pulled
  fi
fi

# Blokada — skrypt diagnostyczny (ops/waids_health.py) nie robi samonaprawy w trakcie deployu
touch /run/waids-deploy.lock
trap 'rm -f /run/waids-deploy.lock' EXIT

# Docker musi wstawać sam po restarcie VM (np. po awarii zasilania)
systemctl enable docker containerd >/dev/null 2>&1 || true

# Diagnostyka + samonaprawa co minutę (health.json dla ekranu logowania).
# Instalowane przed buildem — działa nawet gdy dalsza część deployu się wywali.
cat > /etc/cron.d/waids-health <<CRON
# WAIDS — diagnostyka + samonaprawa (generowane przez deploy.sh)
* * * * * root /usr/bin/python3 $APP_DIR/ops/waids_health.py >/dev/null 2>&1
CRON
chmod 644 /etc/cron.d/waids-health

# Segmentacja klientów — zrzut kroczących 12 mies. po zamknięciu miesiąca.
# Dzień 2., 03:00 — zostawia margines na ew. spóźnione importy produkcji za ostatni dzień miesiąca.
cat > /etc/cron.d/waids-segmentation <<CRON
# WAIDS — zrzut segmentacji za zamknięty miesiąc (generowane przez deploy.sh)
0 3 2 * * root cd $APP_DIR && docker compose exec -T backend python3 cron_segmentation_snapshot.py >> /var/log/waids-segmentation.log 2>&1
CRON
chmod 644 /etc/cron.d/waids-segmentation

# 2. Przebuduj i uruchom kontenery
echo "[2/5] Docker build + up..."
# Zatrzymaj legacy systemd service (jeśli jeszcze działa)
systemctl stop waids 2>/dev/null || true
# Zwolnij port 8001 gdyby coś go trzymało
fuser -k 8001/tcp 2>/dev/null || true
sleep 1
docker compose down --remove-orphans
# Usuń starą sieć Docker (fix DNS resolution między kontenerami)
docker network rm waids_waids_net 2>/dev/null || true
docker network rm subscription-checker_waids_net 2>/dev/null || true
docker compose up -d --build

# 3. Poczekaj aż backend odpowie (max 60s)
echo "[3/5] Czekam na backend..."
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:8001/version > /dev/null 2>&1; then
    echo "      Backend gotowy (${i}×2s)"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "      UWAGA: backend nie odpowiada po 60s — sprawdź: docker compose logs backend"
  fi
  sleep 2
done

# 4. Skopiuj frontend do nginx (rm+cp zamiast cp -r — unika problemu z nadpisywaniem)
echo "[4/5] Kopiowanie frontendu..."
cp "$APP_DIR/index.html" "$WEB_DIR/index.html"
rm -rf "$WEB_DIR/css" && cp -r "$APP_DIR/css" "$WEB_DIR/css"
rm -rf "$WEB_DIR/js"  && cp -r "$APP_DIR/js"  "$WEB_DIR/js"
chown -R www-data:www-data "$WEB_DIR/"

# 5. Odśwież health.json od razu (cron i tak robi to co minutę)
echo "[5/5] Diagnostyka..."
rm -f /run/waids-deploy.lock
/usr/bin/python3 "$APP_DIR/ops/waids_health.py" || echo "      UWAGA: waids_health.py zakończył się błędem"

echo ""
echo "=== Gotowe! ==="
curl -s http://127.0.0.1:8001/version && echo ""
}

main "$@"
exit
