#!/bin/bash
# WAIDS — skrypt wdrożenia
# Użycie: sudo ./deploy.sh
# Dane w bazie NIE są kasowane (volume waids_pgdata persystentny).

set -e
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_DIR="/var/www/waids"

echo "=== WAIDS deploy: $(date '+%Y-%m-%d %H:%M:%S') ==="

# 1. Pobierz najnowszy kod (jako oryginalny użytkownik, nie root)
echo "[1/4] git pull..."
cd "$APP_DIR"
REAL_USER="${SUDO_USER:-$USER}"
sudo -u "$REAL_USER" git pull

# 2. Przebuduj i uruchom kontenery
echo "[2/4] Docker build + up..."
docker compose down --remove-orphans
docker compose up -d --build

# 3. Poczekaj aż backend odpowie (max 60s)
echo "[3/4] Czekam na backend..."
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

# 4. Skopiuj frontend do nginx
echo "[4/4] Kopiowanie frontendu..."
cp "$APP_DIR/index.html"    "$WEB_DIR/index.html"
cp -r "$APP_DIR/css/"       "$WEB_DIR/css/"
cp -r "$APP_DIR/js/"        "$WEB_DIR/js/"
chown -R www-data:www-data  "$WEB_DIR/"

echo ""
echo "=== Gotowe! ==="
curl -s http://127.0.0.1:8001/version && echo ""
