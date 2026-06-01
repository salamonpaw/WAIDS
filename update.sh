#!/usr/bin/env bash
set -e

cd /home/psalamon/apps/WAIDS

echo "1/5 Pobieram zmiany z GitHuba..."
git pull

echo "2/5 Buduję i uruchamiam kontenery..."
docker compose up -d --build

echo "3/5 Kopiuję frontend do /var/www/waids..."
sudo cp index.html /var/www/waids/index.html
sudo cp -r css/ /var/www/waids/css/
sudo cp -r js/  /var/www/waids/js/
sudo chown -R www-data:www-data /var/www/waids/index.html /var/www/waids/css/ /var/www/waids/js/

echo "4/5 Przeładowuję nginx..."
sudo systemctl reload nginx

echo "5/5 Sprawdzam API..."
curl -f http://127.0.0.1:8001/status

echo
echo "Gotowe. Aplikacja powinna działać pod: http://192.168.20.244"
